/**
 * 人物系统
 * 关键要求：场景 NPC 与通缉令头像必须由同一套 buildCharacter 渲染，
 * 因此通缉令头像直接复用本模块（wanted.js 调用同一函数，只是换了相机与灯光）。
 *
 * 3D 人形采用"真骨骼分组"：
 *   root
 *   ├─ torso（髋部固定，躯干在髋部之上整体起伏/摇摆/前倾）
 *   │   ├─ head（跟随躯干，可独立点头/回头）
 *   │   ├─ armL → elbowL（上臂 / 前臂两段，肘关节可屈）
 *   │   └─ armR → elbowR
 *   ├─ legL → thighL → kneeL（大腿 / 小腿两段，膝关节可屈）
 *   └─ legR → thighR → kneeR
 * 动画 animateCharacter 只驱动关节角度，因此迈腿、屈膝、摆臂、转身、起伏、
 * 呼吸、受伤缩身、蹲伏全部是真实三维姿态，而不是贴图前后位移。
 */
import * as THREE from 'three';
import {
  SKIN_TONES, UPPER_COLORS, PANTS_COLORS, HAIR_STYLES, HAIR_COLORS,
  HAIR_COLOR_HEX, BEARD_STYLES, HATS, BUILDS
} from './config.js';
import { pick, rand, randInt, mulberry32 } from './utils.js';
import { portraitFeatures } from './pixelart.js';

const matCache = new Map();
function mat(hex, rough = 0.88, metal = 0.0, cacheKey) {
  const key = cacheKey || `${hex}|${rough}|${metal}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
  matCache.set(key, m);
  return m;
}

/* ======================================================================== *
 * 一、外观主题：复刻 assets/portraits/npc01~06.png 六个角色的配色与体型
 *   3D 人形的服装色、体型、身高、发型全部取自这张对照表，因此"立绘改 3D"之后，
 *   人群的视觉辨识度（谁穿西装、谁橙工装、谁背双肩包）保持连续。
 * ======================================================================== */
export const NPC_LOOKS = [
  {
    id: 1, name: '西装男',
    detail: '深蓝西装外套＋浅蓝衬衫、深色西裤、黑色短发，手持棕色公文包',
    upper: { n: '深蓝西装', c: '#25415e' }, shirt: '#a9c0d4', tie: '#2a3442',
    pants: { n: '深色西裤', c: '#23252b' }, skin: { n: '白皙', c: '#e9c6a4' },
    hairStyle: '短发', hairColor: '深棕', build: BUILDS[1], height: 181,
    extras: { bag: '#6b4a2f' }
  },
  {
    id: 2, name: '白领女',
    detail: '黑色西装外套＋白衬衫、灰色半身裙、黑色盘发，手持手机',
    upper: { n: '黑色西装', c: '#1e1f24' }, shirt: '#eceff3', tie: null,
    pants: { n: '灰色半身裙', c: '#4a4d52' }, skin: { n: '白皙', c: '#ead0b4' },
    hairStyle: '盘发', hairColor: '黑色', build: BUILDS[0], height: 167,
    extras: { skirt: true, phone: true }
  },
  {
    id: 3, name: '连帽头盔男',
    detail: '深灰连帽卫衣套装、深灰头盔，双手空置',
    upper: { n: '深灰卫衣', c: '#33373d' }, shirt: null, tie: null,
    pants: { n: '深灰卫裤', c: '#2b2f35' }, skin: { n: '浅棕', c: '#d8b189' },
    hairStyle: '寸头', hairColor: '黑色', build: BUILDS[2], height: 184,
    extras: { hood: true, helmet: '#3d434b' }
  },
  {
    id: 4, name: '蓝夹克男',
    detail: '蓝色工装外套＋灰色圆领衫、深色长裤、灰色短发，手拎棕色纸袋',
    upper: { n: '蓝色工装外套', c: '#2f6f9e' }, shirt: '#8b9099', tie: null,
    pants: { n: '深色长裤', c: '#2c3a52' }, skin: { n: '小麦色', c: '#c39a69' },
    hairStyle: '短发', hairColor: '花白', build: BUILDS[1], height: 176,
    extras: { bag: '#a97c4b' }
  },
  {
    id: 5, name: '工装男',
    detail: '橙色反光条工装外套、深色长裤、灰色短发，手持扫帚',
    upper: { n: '橙色工装', c: '#b1552a' }, shirt: null, tie: null, stripe: '#e6d055',
    pants: { n: '深色长裤', c: '#3a3d42' }, skin: { n: '古铜色', c: '#a97a52' },
    hairStyle: '短发', hairColor: '花白', build: BUILDS[1], height: 174,
    extras: { stripes: true }
  },
  {
    id: 6, name: '背包青年',
    detail: '深蓝连帽卫衣＋蓝色牛仔裤、黑色短发戴头戴式耳机，肩背黑色双肩包',
    upper: { n: '深蓝连帽卫衣', c: '#1f3a5f' }, shirt: null, tie: null,
    pants: { n: '蓝色牛仔裤', c: '#33507a' }, skin: { n: '浅棕', c: '#d8b189' },
    hairStyle: '短发', hairColor: '黑色', build: BUILDS[0], height: 172,
    extras: { hood: true, backpack: '#1a1c22', headphones: '#22242a' }
  }
];

export const LOOK_VARIANTS = 3;
export const VARIANT_NAMES = ['原色', '暖调', '冷调'];

/** hex ↔ HSL，用于生成"暖调 / 冷调"三种配色变体 */
function hexToHsl(hex) {
  const s = hex.replace('#', '');
  const r = parseInt(s.substring(0, 2), 16) / 255;
  const g = parseInt(s.substring(2, 4), 16) / 255;
  const b = parseInt(s.substring(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let hh = 0, ss = 0;
  if (mx !== mn) {
    const d = mx - mn;
    ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) hh = ((b - r) / d + 2) / 6;
    else hh = ((r - g) / d + 4) / 6;
  }
  return { h: hh * 360, s: ss, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = v => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 配色变体：0 原色 / 1 暖调（更亮更暖）/ 2 冷调（更暗更冷） */
export function tintHex(hex, variant) {
  const v = ((Math.round(Number(variant) || 0) % LOOK_VARIANTS) + LOOK_VARIANTS) % LOOK_VARIANTS;
  if (!v) return hex;
  const hsl = hexToHsl(hex);
  if (v === 1) return hslToHex(hsl.h + 8, Math.min(1, hsl.s * 0.97 + 0.02), Math.min(0.9, hsl.l + 0.035));
  return hslToHex(hsl.h - 9, Math.min(1, hsl.s * 1.05), Math.max(0.06, hsl.l - 0.03));
}

/**
 * 把「立绘编号 + 配色变体」写进外观对象（原地修改）。
 * 3D 模型与通缉令文案都读这些字段，所以两处外观永远一致。
 */
export function applyLook(app, lookIdx, variant = 0) {
  const n = NPC_LOOKS.length;
  const idx = ((Math.round(Number(lookIdx) || 1) - 1) % n + n) % n;
  const look = NPC_LOOKS[idx];
  const v = ((Math.round(Number(variant) || 0) % LOOK_VARIANTS) + LOOK_VARIANTS) % LOOK_VARIANTS;

  app.look = look.id;
  app.lookName = look.name;
  app.lookDetail = look.detail;
  app.variant = v;
  app.variantName = VARIANT_NAMES[v];
  app.upper = { n: look.upper.n, c: tintHex(look.upper.c, v) };
  app.pants = { n: look.pants.n, c: tintHex(look.pants.c, v) };
  app.skin = { n: look.skin.n, c: look.skin.c };
  app.hairStyle = look.hairStyle;
  app.hairColor = look.hairColor;
  app.hairHex = HAIR_COLOR_HEX[look.hairColor] || '#2b1c14';
  app.hat = '无';
  app.beard = look.beard || '无';
  app.glasses = !!look.glasses;
  app.build = look.build;
  app.buildIdx = BUILDS.indexOf(look.build);
  app.heightCm = look.height + Math.round(rand(Math.random, -2, 2));
  app.heightBucket = Math.max(0, Math.floor((app.heightCm - 162) / 8));
  app.extras = Object.assign({}, look.extras, {
    shirt: look.shirt || null,
    tie: look.tie || null,
    stripe: look.stripe || null
  });
  delete app.portrait;
  return app;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * 给一关的全部人物分配「立绘编号 + 配色变体」，用于 3D 人形外观。
 * 规则与立绘版一致：罪犯组合全场唯一且形象两两不同，平民只从剩余组合取，
 * 保证"凭外形+配色锁定通缉目标"依然公平。
 */
export function assignModelLooks(criminalApps, civilApps, rng) {
  const rngs = typeof rng === 'function' ? rng : Math.random;
  const combos = [];
  for (let l = 1; l <= NPC_LOOKS.length; l++) {
    for (let v = 0; v < LOOK_VARIANTS; v++) combos.push({ look: l, variant: v });
  }
  shuffleInPlace(combos, rngs);

  const lookOrder = shuffleInPlace(NPC_LOOKS.map((_, i) => i + 1), rngs);
  const used = new Set();
  const keyOf = c => c.look + ':' + c.variant;

  criminalApps.forEach((app, i) => {
    let picked;
    if (i < lookOrder.length) {
      const lk = lookOrder[i];
      const cand = combos.filter(c => c.look === lk && !used.has(keyOf(c)));
      picked = cand[0] || { look: lk, variant: i % LOOK_VARIANTS };
    } else {
      picked = combos.find(c => !used.has(keyOf(c))) || combos[i % combos.length];
    }
    used.add(keyOf(picked));
    applyLook(app, picked.look, picked.variant);
  });

  let free = combos.filter(c => !used.has(keyOf(c)));
  if (!free.length) free = combos.slice();
  shuffleInPlace(free, rngs);
  civilApps.forEach((app, i) => {
    const c = free[i % free.length];
    applyLook(app, c.look, c.variant);
  });
}

/** 生成一套随机外观参数（无立绘主题时的兜底分布，罪犯与平民共用） */
export function randomAppearance(rng, avoid = []) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const skin = pick(rng, SKIN_TONES);
    const upper = pick(rng, UPPER_COLORS);
    const pants = pick(rng, PANTS_COLORS);
    const hairStyle = pick(rng, HAIR_STYLES);
    const hairColor = pick(rng, HAIR_COLORS);
    const beard = pick(rng, BEARD_STYLES);
    const hat = pick(rng, HATS);
    const build = pick(rng, BUILDS);
    const heightCm = Math.round(rand(rng, 162, 192));
    const glasses = rng() < 0.22;
    const app = {
      skin, upper, pants, hairStyle, hairColor, hairHex: HAIR_COLOR_HEX[hairColor],
      beard, hat, build, heightCm, glasses,
      buildIdx: BUILDS.indexOf(build),
      heightBucket: Math.floor((heightCm - 162) / 8)   // 0..3
    };
    const clash = avoid.some(a =>
      a.upper.c === app.upper.c && a.hairStyle === app.hairStyle &&
      a.heightBucket === app.heightBucket && a.beard === app.beard
    );
    if (!clash) return app;
  }
  return {
    skin: pick(rng, SKIN_TONES), upper: pick(rng, UPPER_COLORS), pants: pick(rng, PANTS_COLORS),
    hairStyle: pick(rng, HAIR_STYLES), hairColor: pick(rng, HAIR_COLORS),
    hairHex: HAIR_COLOR_HEX[pick(rng, HAIR_COLORS)], beard: pick(rng, BEARD_STYLES),
    hat: pick(rng, HATS), build: pick(rng, BUILDS), heightCm: randInt(rng, 162, 192),
    glasses: rng() < 0.22, buildIdx: 1, heightBucket: 1
  };
}

/** 通缉令上展示的可判别特征（与模型参数严格对应） */
export function describeFeatures(app) {
  // 立绘模式下人物形象由图片决定，特征文案必须描述图片本身
  if (app && app.portrait) return portraitFeatures(app);

  // 3D 人形：外观由 NPC_LOOKS 这张"立绘对照表"驱动，文案口径与立绘版保持一致
  if (app && app.look) {
    const n = NPC_LOOKS.length;
    const look = NPC_LOOKS[((app.look - 1) % n + n) % n];
    return [
      `身高约 ${app.heightCm} cm`,
      `${app.build.n}体型`,
      `外形：${look.name}`,
      `衣着：${look.detail}`,
      `配色：${VARIANT_NAMES[app.variant] || '原色'}`,
      `肤色：${app.skin.n}`
    ];
  }

  const list = [];
  list.push(`身高约 ${app.heightCm} cm`);
  list.push(`${app.build.n}体型`);
  list.push(`上衣：${app.upper.n}`);
  list.push(`发型：${app.hairStyle === '秃顶' ? '秃顶' : app.hairStyle + '（' + app.hairColor + '）'}`);
  if (app.beard !== '无') list.push(`面部：${app.beard}`);
  if (app.glasses) list.push('戴眼镜');
  if (app.hat !== '无') list.push(`头部：${app.hat}`);
  list.push(`肤色：${app.skin.n}`);
  return list;
}

/* ---------- 几何合并：同材质静态部件合并为单个 mesh，降低 draw call ---------- */
function mergeParts(parts, material, name) {
  const pos = [], nor = [], uv = [];
  for (const p of parts) {
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const g2 = src.clone();
    g2.applyMatrix4(p.matrix);
    const PA = g2.attributes.position.array;
    for (let i = 0; i < PA.length; i++) pos.push(PA[i]);
    const NA = g2.attributes.normal ? g2.attributes.normal.array : null;
    if (NA) for (let i = 0; i < NA.length; i++) nor.push(NA[i]);
    const UA = g2.attributes.uv ? g2.attributes.uv.array : null;
    if (UA) for (let i = 0; i < UA.length; i++) uv.push(UA[i]);
    g2.dispose();
    if (src !== p.geo) src.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length === pos.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  else geo.computeVertexNormals();
  if (uv.length === (pos.length / 3) * 2) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  if (name) m.name = name;
  return m;
}

const _pV = new THREE.Vector3();
const _pQ = new THREE.Quaternion();
const _pE = new THREE.Euler();
const _pS = new THREE.Vector3();

/** 部件描述：几何 + 局部位移/缩放/旋转 */
function P(geo, x, y, z, sx, sy, sz, rx, ry, rz) {
  _pE.set(rx || 0, ry || 0, rz || 0);
  _pQ.setFromEuler(_pE);
  _pV.set(x || 0, y || 0, z || 0);
  _pS.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
  const m = new THREE.Matrix4().compose(_pV, _pQ, _pS);
  return { geo, matrix: m };
}
const sph = (r, w, h) => new THREE.SphereGeometry(r, w || 11, h || 9);
const cyl = (rt, rb, hh, seg) => new THREE.CylinderGeometry(rt, rb, hh, seg || 12, 1, false);
const cap = (r, len, seg) => new THREE.CapsuleGeometry(r, len, 4, seg || 8);
const box = (a, b, c) => new THREE.BoxGeometry(a, b, c);
const tor = (r, t, a, b) => new THREE.TorusGeometry(r, t, a || 6, b || 12);
/**
 * 构建一个 3D 人形。真骨骼分组，动画由关节点旋转驱动。
 * @param {object} app 外观参数（applyLook / randomAppearance 的产物）
 * @param {object} opts { fine:boolean 是否高精度（近景/通缉令头像用 true，远景 LOD 用 false） }
 */
export function buildCharacter(app, opts = {}) {
  const fine = opts.fine !== false;
  const seg = fine ? 12 : 8;
  const sphW = fine ? 12 : 8, sphH = fine ? 10 : 6;

  const h = (app.heightCm || 175) / 100;          // 身高（米）
  const bw = (app.build && app.build.w) || 1;     // 体型系数
  const ex = app.extras || {};

  const thighLen = 0.245 * h;
  const shinLen = 0.222 * h;
  const legLen = thighLen + shinLen;
  const torsoH = 0.335 * h;
  const headR = 0.0705 * h;
  const hipW = 0.057 * h * bw;
  const shoulderX = 0.098 * h * bw;
  const armUpper = 0.146 * h;
  const armFore = 0.132 * h;

  const C = {
    skin: mat(app.skin.c, 0.74),
    upper: mat(app.upper.c, 0.9),
    pants: mat(app.pants.c, 0.92),
    hair: mat(app.hairHex || '#2b1c14', 0.85),
    shoe: mat('#191a1e', 0.62),
    dark: mat('#15161a', 0.7),
    eye: mat('#0e0f12', 0.35),
    white: mat('#eceef1', 0.55),
    accent: mat(ex.shirt || '#cfd6de', 0.85),
    tie: mat(ex.tie || '#2a3442', 0.7),
    stripe: mat(ex.stripe || '#e6d055', 0.45, 0.15)
  };
  if (ex.helmet) C.helmet = mat(ex.helmet, 0.55, 0.2);
  if (ex.backpack) C.bag = mat(ex.backpack, 0.88);
  if (ex.bag) C.handbag = mat(ex.bag, 0.85);
  if (ex.headphones) C.phone = mat(ex.headphones, 0.5, 0.2);
  if (ex.skirt) C.skirt = C.pants;

  const root = new THREE.Group();
  root.name = 'character';

  /* ---------------- 躯干（髋部为躯干根，动画里做起伏/摇摆/前倾） ---------------- */
  const torso = new THREE.Group();
  torso.position.set(0, legLen, 0);
  root.add(torso);
  const buckets = new Map();
  const add = (bucket, part) => {
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(part);
  };
  const flush = (parent, prefix) => {
    for (const [material, list] of buckets) {
      parent.add(mergeParts(list, material, prefix));
    }
    buckets.clear();
  };

  // 骨盆
  add(C.pants, P(cyl(0.088 * h * bw, 0.082 * h * bw, 0.085 * h, seg), 0, 0.042 * h, 0));
  // 腰腹
  add(C.upper, P(cyl(0.093 * h * bw, 0.088 * h * bw, 0.10 * h, seg), 0, 0.128 * h, 0));
  // 胸腔
  add(C.upper, P(cyl(0.104 * h * bw, 0.096 * h * bw, 0.135 * h, seg), 0, 0.245 * h, 0));
  // 胸口轻微前凸，增加写实度
  add(C.upper, P(sph(0.062 * h, sphW, sphH), 0, 0.245 * h, 0.048 * h * bw, 1.0 * bw, 1.25, 0.55));
  // 肩
  add(C.upper, P(sph(0.045 * h * bw, sphW, sphH), shoulderX, torsoH * 0.845, 0));
  add(C.upper, P(sph(0.045 * h * bw, sphW, sphH), -shoulderX, torsoH * 0.845, 0));
  // 衬衫领口 / 领带（西装男、白领女）
  if (ex.shirt) {
    add(C.accent, P(cyl(0.05 * h * bw, 0.058 * h * bw, 0.05 * h, seg), 0, torsoH * 0.86, 0.012 * h));
    if (ex.tie) add(C.tie, P(box(0.022 * h, 0.10 * h, 0.012 * h), 0, torsoH * 0.74, 0.055 * h * bw));
  }
  // 反光条（橙工装男）
  if (ex.stripes) {
    add(C.stripe, P(cyl(0.098 * h * bw, 0.098 * h * bw, 0.014 * h, seg), 0, 0.30 * h, 0));
    add(C.stripe, P(cyl(0.096 * h * bw, 0.096 * h * bw, 0.012 * h, seg), 0, 0.20 * h, 0));
  }
  // 半身裙（白领女）
  if (ex.skirt) {
    add(C.skirt, P(cyl(0.098 * h * bw, 0.135 * h * bw, 0.155 * h, seg), 0, -0.055 * h, 0));
  }
  // 连帽（卫衣）：颈后兜帽
  if (ex.hood) {
    add(C.upper, P(sph(0.082 * h, sphW, sphH), 0, torsoH * 0.80, -0.045 * h, 1.1 * bw, 0.85, 0.9));
  }
  // 双肩包
  if (ex.backpack) {
    add(C.bag, P(box(0.155 * h * bw, 0.19 * h, 0.085 * h), 0, 0.245 * h, -0.098 * h));
    add(C.bag, P(box(0.10 * h, 0.055 * h, 0.09 * h), 0, 0.355 * h, -0.10 * h));
  }
  flush(torso, 'torso');

  /* ---------------- 头（跟随躯干） ---------------- */
  const head = new THREE.Group();
  head.position.set(0, torsoH, 0);
  torso.add(head);
  root.userData.headY = legLen + torsoH;
  root.userData.headRel = torsoH;

  // 颈
  add(C.skin, P(cyl(0.030 * h, 0.034 * h, 0.055 * h, seg), 0, -0.012 * h, 0));
  // 颅
  add(C.skin, P(sph(headR, sphW, sphH), 0, 0.062 * h, 0, 1, 1.10, 0.96));
  // 下颌 / 脸颊
  add(C.skin, P(sph(headR * 0.78, sphW, sphH), 0, 0.032 * h, 0.012 * h, 1, 0.9, 0.95));
  // 鼻
  add(C.skin, P(sph(headR * 0.17, 8, 6), 0, 0.058 * h, headR * 0.94));
  // 眼 + 眉
  for (const s of [-1, 1]) {
    add(C.white, P(sph(headR * 0.155, 8, 6), s * headR * 0.36, 0.075 * h, headR * 0.80, 1, 0.85, 0.5));
    add(C.eye, P(sph(headR * 0.085, 8, 6), s * headR * 0.36, 0.075 * h, headR * 0.90));
    add(C.hair, P(box(headR * 0.34, headR * 0.06, headR * 0.10), s * headR * 0.36, 0.105 * h, headR * 0.86));
    add(C.skin, P(sph(headR * 0.14, 8, 6), s * headR * 0.98, 0.062 * h, 0, 0.6, 1.2, 0.9)); // 耳
  }
  // 口
  add(mat('#8d5a52', 0.8), P(box(headR * 0.30, headR * 0.07, headR * 0.06), 0, 0.028 * h, headR * 0.86));

  // 发型
  const hs = app.hairStyle;
  if (hs === '秃顶') {
    add(C.hair, P(sph(headR * 1.01, sphW, sphH), 0, 0.06 * h, -0.006 * h, 1, 0.62, 1));
  } else if (hs === '寸头') {
    add(C.hair, P(sph(headR * 1.04, sphW, sphH), 0, 0.070 * h, -0.004 * h, 1, 0.95, 1));
  } else if (hs === '背头') {
    add(C.hair, P(sph(headR * 1.06, sphW, sphH), 0, 0.078 * h, -0.008 * h, 1, 0.90, 1.02));
    add(C.hair, P(box(headR * 1.55, headR * 0.22, headR * 0.30), 0, 0.128 * h, -0.02 * h));
  } else if (hs === '中长发') {
    add(C.hair, P(sph(headR * 1.08, sphW, sphH), 0, 0.072 * h, -0.010 * h, 1, 1.0, 1.05));
    add(C.hair, P(box(headR * 1.7, headR * 1.0, headR * 0.5), 0, 0.005 * h, -0.075 * h));
  } else if (hs === '马尾') {
    add(C.hair, P(sph(headR * 1.05, sphW, sphH), 0, 0.074 * h, -0.008 * h, 1, 0.95, 1));
    add(C.hair, P(cyl(headR * 0.20, headR * 0.30, headR * 1.15, 8), 0, -0.05 * h, -0.10 * h, 1, 1, 1, 0.35, 0, 0));
  } else if (hs === '卷发') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      add(C.hair, P(sph(headR * 0.42, 8, 6), Math.cos(a) * headR * 0.72, 0.072 * h + Math.sin(a) * headR * 0.30, Math.sin(a) * headR * 0.68));
    }
    add(C.hair, P(sph(headR * 1.06, sphW, sphH), 0, 0.076 * h, -0.008 * h, 1, 0.95, 1));
  } else if (hs === '盘发') {
    add(C.hair, P(sph(headR * 1.06, sphW, sphH), 0, 0.076 * h, -0.008 * h, 1, 0.95, 1));
    add(C.hair, P(sph(headR * 0.45, sphW, sphH), 0, 0.02 * h, -headR * 1.02));
  } else { // 短发
    add(C.hair, P(sph(headR * 1.055, sphW, sphH), 0, 0.076 * h, -0.008 * h, 1, 0.92, 1.02));
  }

  // 胡须
  if (app.beard === '胡茬') {
    add(mat('#3a2c22', 0.9), P(sph(headR * 0.80, 8, 6), 0, 0.030 * h, 0.012 * h, 1, 0.85, 0.95));
  } else if (app.beard === '络腮胡') {
    add(C.hair, P(sph(headR * 0.88, sphW, sphH), 0, 0.028 * h, 0.010 * h, 1, 0.92, 1));
    add(C.hair, P(box(headR * 0.55, headR * 0.30, headR * 0.20), 0, 0.012 * h, headR * 0.72));
  } else if (app.beard === '山羊胡') {
    add(C.hair, P(box(headR * 0.34, headR * 0.26, headR * 0.16), 0, 0.008 * h, headR * 0.74));
  }

  // 眼镜
  if (app.glasses) {
    const lensMat = mat('#98a3ae', 0.25, 0.5);
    for (const s of [-1, 1]) {
      add(lensMat, P(tor(headR * 0.20, headR * 0.028, 5, 10), s * headR * 0.34, 0.075 * h, headR * 0.92));
    }
    add(lensMat, P(box(headR * 0.26, headR * 0.03, headR * 0.03), 0, 0.075 * h, headR * 0.92));
  }

  // 帽子
  if (app.hat === '鸭舌帽') {
    add(C.dark, P(sph(headR * 1.10, sphW, sphH), 0, 0.082 * h, -0.006 * h, 1, 0.62, 1));
    add(C.dark, P(box(headR * 1.5, headR * 0.10, headR * 0.85), 0, 0.086 * h, headR * 0.78));
  } else if (app.hat === '渔夫帽') {
    add(C.dark, P(cyl(headR * 0.92, headR * 1.0, headR * 0.45, seg), 0, 0.098 * h, 0));
    add(C.dark, P(cyl(headR * 1.55, headR * 1.55, headR * 0.07, seg), 0, 0.070 * h, 0));
  }
  // 头盔（连帽头盔男）
  if (ex.helmet) {
    add(C.helmet, P(sph(headR * 1.14, sphW, sphH), 0, 0.072 * h, -0.006 * h, 1, 1.02, 1.04));
    add(C.helmet, P(box(headR * 1.7, headR * 0.16, headR * 0.30), 0, 0.052 * h, headR * 0.95));
  }
  // 头戴式耳机
  if (ex.headphones) {
    add(C.phone, P(tor(headR * 1.06, headR * 0.075, 6, 14), 0, 0.072 * h, 0, 1, 1, 1, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) {
      add(C.phone, P(cyl(headR * 0.26, headR * 0.26, headR * 0.14, 10), s * headR * 1.02, 0.062 * h, 0, 1, 1, 1, 0, 0, Math.PI / 2));
    }
  }
  flush(head, 'head');

  /* ---------------- 手臂：上臂 → 肘 → 前臂 ---------------- */
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderX * 1.03, torsoH * 0.845, 0);
    torso.add(shoulder);
    add(C.upper, P(cyl(0.036 * h * bw, 0.031 * h * bw, armUpper, seg), 0, -armUpper / 2, 0));
    if (side === -1 && C.accent && ex.shirt) {
      // 衬衫袖口颜色略浅，增强层次
      add(C.upper, P(cyl(0.0325 * h * bw, 0.0325 * h * bw, 0.02 * h, seg), 0, -armUpper * 0.98, 0));
    }
    flush(shoulder, side < 0 ? 'armL' : 'armR');

    const elbow = new THREE.Group();
    elbow.position.set(0, -armUpper, 0);
    shoulder.add(elbow);
    add(C.upper, P(sph(0.028 * h * bw, 8, 6), 0, 0, 0));
    add(C.skin, P(cyl(0.026 * h * bw, 0.022 * h * bw, armFore * 0.86, seg), 0, -armFore * 0.5, 0));
    add(C.skin, P(sph(0.031 * h, 8, 6), 0, -armFore * 0.94, 0, 1, 0.95, 0.72));
    flush(elbow, side < 0 ? 'foreL' : 'foreR');
    return { shoulder, elbow };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // 随身物品：挂在右手
  if (ex.bag) {
    const hand = new THREE.Group();
    hand.position.set(0, -armFore * 1.02, 0);
    armR.elbow.add(hand);
    add(C.handbag, P(box(0.075 * h, 0.085 * h, 0.10 * h), 0, -0.055 * h, 0.01 * h));
    add(C.dark, P(tor(0.026 * h, 0.005 * h, 5, 8), 0, -0.005 * h, 0, 1, 1, 1, Math.PI / 2, 0, 0));
    flush(hand, 'handbag');
  }
  if (ex.phone) {
    add(C.dark, P(box(0.030 * h, 0.058 * h, 0.008 * h), 0, -armFore * 1.05, 0.012 * h));
  }

  /* ---------------- 腿：大腿 → 膝 → 小腿 ---------------- */
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * hipW, legLen, 0);
    root.add(hip);
    add(C.pants, P(cyl(0.052 * h * bw, 0.042 * h * bw, thighLen, seg), 0, -thighLen / 2, 0));
    flush(hip, side < 0 ? 'thighL' : 'thighR');

    const knee = new THREE.Group();
    knee.position.set(0, -thighLen, 0);
    hip.add(knee);
    add(C.pants, P(sph(0.040 * h * bw, 8, 6), 0, 0, 0));
    add(C.pants, P(cyl(0.040 * h * bw, 0.031 * h * bw, shinLen * 0.93, seg), 0, -shinLen * 0.5, 0));
    flush(knee, side < 0 ? 'shinL' : 'shinR');

    const foot = new THREE.Group();
    foot.position.set(0, -shinLen, 0);
    knee.add(foot);
    add(C.shoe, P(box(0.052 * h * bw, 0.030 * h, 0.098 * h), 0, -0.013 * h, 0.022 * h));
    add(C.shoe, P(sph(0.026 * h, 8, 6), 0, -0.016 * h, 0.070 * h, 1.1, 0.7, 1.15));
    flush(foot, 'foot');
    return { hip, knee, foot };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  root.userData.app = app;
  root.userData.parts = {
    torso,
    head,
    // 兼容旧字段名（game.js / wanted.js 只读不写）
    legL: legL.hip, legR: legR.hip,
    armL: armL.shoulder, armR: armR.shoulder,
    // 新关节
    thighL: legL.hip, thighR: legR.hip,
    kneeL: legL.knee, kneeR: legR.knee,
    footL: legL.foot, footR: legR.foot,
    elbowL: armL.elbow, elbowR: armR.elbow
  };
  root.userData.height = h;
  root.userData.heightCm = app.heightCm || 175;
  root.userData.legLen = legLen;
  root.userData.torsoH = torsoH;
  root.userData.thighLen = thighLen;
  root.userData.shinLen = shinLen;
  root.userData.fine = fine;
  root.userData.rig = {
    thighLen, shinLen, armUpper, armFore,
    strideMax: 0.62,      // 最大髋关节摆幅（弧度）
    kneeMax: 1.05,        // 最大膝关节屈曲
    armMax: 0.52
  };

  // LOD：登记"细小部件"，由 game.js 按距离显示/隐藏（远处省顶点与阴影开销）
  const fineMeshes = [];
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = fine && !o.userData.fine;
      o.receiveShadow = false;
      const g = o.geometry;
      const vc = g && g.attributes && g.attributes.position ? g.attributes.position.count : 0;
      if (vc > 0 && vc < 260) {
        o.userData.fine = true;
        fineMeshes.push(o);
      }
    }
  });
  root.userData.fineMeshes = fineMeshes;
  return root;
}
function shadeHex(hex, k) {
  const s = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(s.substring(0, 2), 16) * k));
  const g = Math.min(255, Math.round(parseInt(s.substring(2, 4), 16) * k));
  const b = Math.min(255, Math.round(parseInt(s.substring(4, 6), 16) * k));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

/** 给角色挂上射击命中盒（不可见，参与射线检测）。尺寸与旧版完全一致，仅头部盒贴合新骨骼高度 */
export function attachHitboxes(root) {
  const h = root.userData.height;
  const app = root.userData.app;
  const bw = (app && app.build && app.build.w) || 1;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.215 * h * bw, 0.72 * h, 0.18 * h), hitMat);
  body.position.y = 0.50 * h;
  body.name = 'hitBody';

  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.16 * h, 0.16 * h, 0.16 * h), hitMat);
  // 新骨骼下 head 是 torso 的子节点，必须用世界高度 = 腿长 + 躯干高 + 颅球中心偏移
  const headWorldY = (root.userData.legLen || 0.47 * h) +
    (root.userData.torsoH || 0.335 * h) + 0.062 * h;
  headBox.position.y = root.userData.parts && root.userData.torsoH
    ? headWorldY
    : (root.userData.headY || 0.885 * h);
  headBox.name = 'hitHead';

  root.add(body, headBox);
  root.userData.hitBody = body;
  root.userData.hitHead = headBox;
  return root;
}

const TAU = Math.PI * 2;
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 真人化行走动画（关节角度驱动，非贴图位移）
 *  - 大腿前后摆动 + 小腿摆动相屈膝、支撑相轻屈
 *  - 手臂与对侧腿反相摆动，前摆时肘部自然弯折
 *  - 躯干随步伐上下起伏、左右摇摆，肩髋反向扭转，走路带轻微前倾
 *  - 站立时呼吸微动，停下后各关节平滑回到站立姿态
 * @param root buildCharacter 的返回值
 * @param dt 帧间隔
 * @param moveSpeed 当前水平移动速度（m/s），0 表示站立
 */
export function animateCharacter(root, dt, moveSpeed) {
  const p = root.userData.parts;
  if (!p || !p.thighL) return;
  const u = root.userData;
  const rig = u.rig || { strideMax: 0.62, kneeMax: 1.05, armMax: 0.52 };
  const speed = Math.max(0, Number(moveSpeed) || 0);
  const moving = speed > 0.15;
  const sn = clamp01(speed / 1.7);           // 0..1 速度归一
  const ramp = Math.min(1, sn * 2.4);        // 起步加速时摆幅平滑增长

  // 步频：慢走约 1.5 步/秒，快跑约 2.2 步/秒
  const freq = moving ? 1.45 + sn * 0.75 : 0.28;
  u.phase = (u.phase || 0) + dt * TAU * freq;
  u.breathe = (u.breathe || 0) + dt * TAU * 0.26;
  const ph = u.phase;

  const amp = (0.30 + 0.34 * sn) * (moving ? ramp : 0);   // 髋摆幅
  const sinL = Math.sin(ph);
  const sinR = Math.sin(ph + Math.PI);

  // --- 大腿 ---
  const thighLT = -sinL * amp;
  const thighRT = -sinR * amp;

  // --- 小腿屈膝：摆动相（cos>0 的那半周）明显屈曲，支撑相轻微屈曲 ---
  const kneeFor = (phase, swing) => {
    const c = Math.cos(phase);
    const swingKnee = Math.pow(Math.max(0, c), 1.5) * (0.55 + 0.45 * sn) * Math.min(1, amp / 0.34);
    const stanceKnee = (0.07 + 0.10 * sn) * Math.max(0, -c);
    return (swingKnee + stanceKnee) * (moving ? 1 : 0) + (moving ? 0.05 : 0.055);
  };
  const kneeLT = kneeFor(ph, true);
  const kneeRT = kneeFor(ph + Math.PI, true);

  // --- 脚踝：抵消大腿+小腿角度，让脚掌接近水平，并在后蹬时脚尖下压 ---
  const footLT = -(thighLT + kneeLT) * 0.62 + (moving ? 0.10 * Math.max(0, -sinL) : 0);
  const footRT = -(thighRT + kneeRT) * 0.62 + (moving ? 0.10 * Math.max(0, -sinR) : 0);

  // --- 手臂：与对侧腿反相（左臂配右腿） ---
  const armAmp = (0.24 + 0.30 * sn) * (moving ? ramp : 0);
  const armLT = sinL * armAmp;
  const armRT = sinR * armAmp;
  // 前摆时肘部弯折更多，站立时自然微屈
  const elbowFor = (s) => {
    if (!moving) return -0.16;
    return -(0.12 + 0.42 * Math.max(0, s) * (0.5 + 0.5 * sn));
  };
  const elbowLT = elbowFor(sinL);
  const elbowRT = elbowFor(sinR);

  // --- 躯干：上下起伏 + 左右摇摆 + 肩髋反向扭转 + 前倾 ---
  const legLen = u.legLen || 0.47 * (u.height || 1.75);
  // 起伏交给髋部"接地补偿"产生（见下方 hipDrop），这里只保留极小的步伐余振
  const bobAmp = moving ? 0.004 * sn : 0;
  const bob = -bobAmp * Math.abs(sinL);
  const breatheY = moving ? 0 : Math.sin(u.breathe) * 0.0032;
  const torsoYT = legLen + bob + breatheY;
  const leanT = moving ? 0.055 + 0.075 * sn : 0.012 + Math.sin(u.breathe) * 0.006;
  const rollT = moving ? Math.sin(ph) * (0.030 + 0.030 * sn) : Math.sin(u.breathe * 0.7) * 0.008;
  const twistT = moving ? -Math.sin(ph) * (0.055 + 0.075 * sn) : 0;

  // --- 头：反向抵消躯干扭转，保持视线稳定，并偶发轻微转头 ---
  const headT = {
    y: moving ? Math.sin(ph) * 0.030 : Math.sin(u.breathe * 0.5) * 0.05,
    x: moving ? -0.03 : Math.sin(u.breathe * 0.63) * 0.02
  };

  // --- 平滑写入关节 ---
  const lam = moving ? 16 : 6;
  p.thighL.rotation.x = damp(p.thighL.rotation.x, thighLT, lam, dt);
  p.thighR.rotation.x = damp(p.thighR.rotation.x, thighRT, lam, dt);
  p.kneeL.rotation.x = damp(p.kneeL.rotation.x, kneeLT, lam, dt);
  p.kneeR.rotation.x = damp(p.kneeR.rotation.x, kneeRT, lam, dt);
  if (p.footL) p.footL.rotation.x = damp(p.footL.rotation.x, footLT, lam, dt);
  if (p.footR) p.footR.rotation.x = damp(p.footR.rotation.x, footRT, lam, dt);
  p.armL.rotation.x = damp(p.armL.rotation.x, armLT, lam, dt);
  p.armR.rotation.x = damp(p.armR.rotation.x, armRT, lam, dt);
  if (p.elbowL) p.elbowL.rotation.x = damp(p.elbowL.rotation.x, elbowLT, lam, dt);
  if (p.elbowR) p.elbowR.rotation.x = damp(p.elbowR.rotation.x, elbowRT, lam, dt);

  p.torso.rotation.x = damp(p.torso.rotation.x, leanT, 10, dt);
  p.torso.rotation.z = damp(p.torso.rotation.z, rollT, 12, dt);
  p.torso.rotation.y = damp(p.torso.rotation.y, twistT, 12, dt);
  p.head.rotation.y = damp(p.head.rotation.y, headT.y, 10, dt);
  p.head.rotation.x = damp(p.head.rotation.x, headT.x, 10, dt);

  // 手臂自然外张，避免与躯干穿插
  const splay = moving ? 0.05 : 0.035;
  p.armL.rotation.z = damp(p.armL.rotation.z, splay, 8, dt);
  p.armR.rotation.z = damp(p.armR.rotation.z, -splay, 8, dt);

  // --- 髋部接地补偿：让支撑腿脚掌始终踩在地面上，避免"太空步"浮空 ---
  // 腿伸直时髋高 = legLen；迈步时支撑腿的垂直投影变短，髋部需同步下沉相同的量，
  // 这样支撑脚贴地、摆动脚抬起，身体自然产生真人步行的上下起伏。
  const thighLen = rig.thighLen || legLen * 0.52;
  const shinLen = rig.shinLen || legLen * 0.48;
  const reachOf = (t, k) => thighLen * Math.cos(t) + shinLen * Math.cos(t + k);
  const reachL = reachOf(p.thighL.rotation.x, p.kneeL.rotation.x);
  const reachR = reachOf(p.thighR.rotation.x, p.kneeR.rotation.x);
  const dropT = moving ? Math.max(0, legLen - Math.max(reachL, reachR)) * 0.85 : 0;
  const hipDrop = damp(u.hipDrop || 0, dropT, 14, dt);
  u.hipDrop = hipDrop;
  const hipY = legLen - hipDrop;
  p.thighL.position.y = hipY;
  if (p.thighR !== p.thighL) p.thighR.position.y = hipY;
  p.torso.position.y = damp(p.torso.position.y, torsoYT - hipDrop, 18, dt);

  u.moveSpeed = speed;
  u.moving = moving;
}

/** 死亡倒地姿态：向前扑倒并让四肢松开（game.js 死亡后仍会以 moveSpeed=0 调用动画） */
export function applyDeathPose(root, t) {
  const p = root.userData && root.userData.parts;
  if (!p) return;
  const k = Math.min(1, t);
  root.rotation.x = -1.45 * k;
  p.torso.rotation.x = 0.18 * k;
  p.head.rotation.x = 0.22 * k;
  if (p.armL) { p.armL.rotation.x = -1.1 * k; p.armL.rotation.z = 0.5 * k; }
  if (p.armR) { p.armR.rotation.x = -0.9 * k; p.armR.rotation.z = -0.5 * k; }
  if (p.elbowL) p.elbowL.rotation.x = -0.5 * k;
  if (p.elbowR) p.elbowR.rotation.x = -0.5 * k;
  if (p.thighL) { p.thighL.rotation.x = 0.25 * k; }
  if (p.thighR) { p.thighR.rotation.x = -0.1 * k; }
}
