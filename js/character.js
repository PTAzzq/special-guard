/**
 * 人物系统
 * 关键要求：场景NPC 与通缉令头像必须由同一套buildCharacter 渲染。
 * 因此通缉令头像直接复用本模块（wanted.js 调用同一函数，只是换了相机与灯光）。
 *
 * 3D 人形采用"真骨骼分层"
 *   root
 *   ├─ torso（髋部固定，躯干在髋部之上整体起伏摇摆/前倾）
 *   │  ├─ head（跟随躯干，可独立点头回头）
 *   │  ├─ armL →elbowL（上臂/ 前臂两段，肘关节可屈伸
 *   │  └─ armR →elbowR
 *   ├─ legL →thighL →kneeL（大腿/ 小腿两段，膝关节可屈伸
 *   └─ legR →thighR →kneeR
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
import { pickFace, buildHeadGeometry, buildFaceTexture, buildHairTexture, buildHairGeometry, buildCapGeometry, headSurfaceZ, HEAD_HWF } from './head.js';

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
 *   3D 人形的服装色、体型、身高、发型全部取自这张对照表，因此立绘→3D"之后，
 *   人群的视觉辨识度（谁穿西装、谁橙工装、谁背双肩包）保持连续。
 * ======================================================================== */
export const NPC_LOOKS = [
  {
    id: 1, name: '西装男',
    detail: '深藏青西装外套＋浅灰白衬衫、深色领带、灰色西裤、黑皮鞋，右手提棕色公文包',
    upper: { n: '深藏青西装', c: '#232b36' }, shirt: '#dde4eb', tie: '#20242c',
    pants: { n: '灰色西裤', c: '#5e646d' }, skin: { n: '白皙', c: '#e9c6a4' },
    hairStyle: '短发', hairColor: '深棕', build: BUILDS[1], height: 181,
    extras: { suit: true, briefcase: '#7a5232', shoe: '#14161a', shoeRough: 0.34, holdPose: 'case' }
  },
  {
    id: 2, name: '西装女',
    detail: '黑色西装外套＋白衬衫、灰色半身短裙、黑色高跟鞋，棕色低马尾，右手举着手机',
    upper: { n: '黑色西装', c: '#1c1d22' }, shirt: '#f0f3f7', tie: null,
    pants: { n: '灰色短裙', c: '#63676f' }, skin: { n: '白皙', c: '#ead0b4' },
    hairStyle: '马尾', hairColor: '浅棕', build: BUILDS[0], height: 167,
    extras: { skirt: true, suit: true, heel: true, phoneHold: true, shoe: '#131418', shoeRough: 0.34, holdPose: 'phone' }
  },
  {
    id: 3, name: '头盔工装男',
    detail: '深灰连帽卫衣＋深灰工装裤、深灰头盔带护目挡片、深色运动鞋，双手空置',
    upper: { n: '深灰卫衣', c: '#383c43' }, shirt: null, tie: null,
    pants: { n: '深灰工装裤', c: '#2a2e34' }, skin: { n: '浅棕', c: '#d8b189' },
    hairStyle: '寸头', hairColor: '黑色', build: BUILDS[2], height: 184,
    extras: { hood: true, helmet: '#2c3037', shoe: '#25282d', shoeRough: 0.70 }
  },
  {
    id: 4, name: '深蓝夹克中年男',
    detail: '深蓝夹克外套＋灰色圆领衫、深色长裤、灰白运动鞋，花白短发，右手提棕色纸袋',
    upper: { n: '深蓝夹克', c: '#24384f' }, shirt: '#8e949c', tie: null,
    pants: { n: '深色长裤', c: '#262b33' }, skin: { n: '小麦色', c: '#c39a69' },
    hairStyle: '短发', hairColor: '花白', build: BUILDS[1], height: 176,
    extras: { jacket: true, paperbag: '#b98a52', shoe: '#c9cac6', shoeRough: 0.76, holdPose: 'bag' }
  },
  {
    id: 5, name: '背包青年',
    detail: '黑色连帽卫衣＋蓝色牛仔裤、黑色短发，头戴大耳机，肩背军绿色双肩包',
    upper: { n: '黑色卫衣', c: '#1a1c20' }, shirt: null, tie: null,
    pants: { n: '蓝色牛仔裤', c: '#3d5a86' }, skin: { n: '浅棕', c: '#d8b189' },
    hairStyle: '短发', hairColor: '黑色', build: BUILDS[0], height: 172,
    extras: { hood: true, backpack: '#4a5343', backpackStrap: '#1a1c20', headphones: '#17191e', shoe: '#1b1d21', shoeRough: 0.66 }
  },
  {
    id: 6, name: '反光衣老伯',
    detail: '橙色反光条背心＋深色长袖衫、深色长裤、深灰工作鞋，花白短发，右手持长柄扫帚',
    upper: { n: '深色长袖衫', c: '#23262b' }, shirt: null, tie: null, stripe: '#cfd4d9',
    vest: { n: '橙色反光背心', c: '#d8641f' },
    pants: { n: '深色长裤', c: '#2e3238' }, skin: { n: '古铜色', c: '#a97a52' },
    hairStyle: '短发', hairColor: '花白', build: BUILDS[1], height: 170,
    extras: { vest: '#d8641f', stripes: true, stripe: '#cfd4d9', broom: true, shoe: '#3a3d42', shoeRough: 0.80, holdPose: 'broom' }
  }
];

export const LOOK_VARIANTS = 3;
export const VARIANT_NAMES = ['原色', '暖调', '冷调'];

/** hex →HSL，用于生成"暖调 / 冷调"三种配色变体 */
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
 * 把「立绘编号+ 配色变体」写进外观对象（原地修改）。
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
  app.hat = '';
  app.beard = look.beard || '';
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
 * 给一关的全部人物分配「立绘编号+ 配色变体」，用于 3D 人形外观。
 * 规则与立绘版一致：罪犯组合全场唯一且形象两两不同，平民只从剩余组合取，
 * 保证"凭外观配色锁定通缉目标"依然公平。
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

/** 通缉令上展示的可判别特征（与模型参数严格对应）*/
export function describeFeatures(app) {
  // 立绘模式下人物形象由图片决定，特征文案必须描述图片本身
  if (app && app.portrait) return portraitFeatures(app);

  // 3D 人形：外观由 NPC_LOOKS 这张"立绘对照表"驱动，文案口径与立绘版保持一致。
  if (app && app.look) {
    const n = NPC_LOOKS.length;
    const look = NPC_LOOKS[((app.look - 1) % n + n) % n];
    return [
      `身高约${app.heightCm} cm`,
      `${app.build.n}体型`,
      `外形：${look.name}`,
      `衣着：${look.detail}`,
      `配色：${VARIANT_NAMES[app.variant] || '原色'}`,
      `肤色：${app.skin.n}`
    ];
  }

  const list = [];
  list.push(`身高约${app.heightCm} cm`);
  list.push(`${app.build.n}体型`);
  list.push(`上衣：${app.upper.n}`);
  list.push(`发型：${app.hairStyle === '秃顶' ? '秃顶' : app.hairStyle + '色' + app.hairColor + '色'}`);
  if (app.beard !== '') list.push(`面部：${app.beard}`);
  if (app.glasses) list.push('戴眼镜');
  if (app.hat !== '') list.push(`头部：${app.hat}`);
  list.push(`肤色：${app.skin.n}`);
  return list;
}

/* ---------- 几何合并：同材质静态部件合并为单个 mesh，降低draw call ---------- */
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

/** 部件描述：几何+ 局部位移/缩放/旋转 */
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

/* ====================== 人体标准比例（严格7.5 头身）====================== */
/**
 * 全部比例以身高为 1，取成年男性标准人体测量标志点点
 *   颅顶 1.000 →眼线 0.948 →下巴 0.8667 →肩峰 0.820 →乳头 0.720
 *   腰0.630 →膝0.485 →指尖 0.385
 *   髋大转子 0.530 →膝0.285 →踝0.039 →脚底 0
 * 按headCount = 7.5 →头高 = 1/7.5 = 0.13333、肩峰宽 0.245、髋宽0.19、
 * 旧版踝被钉在地面(0)、头高0.157、腿长0.467、肩峰半宽0.098。
 * 所以看起来"头大、身短、肩窄"——本表全部按解剖标志点重算。
 */
const PROP = {
  headCount: 7.5,
  crownY: 1.0000,
  chinY: 1 - 1 / 7.5,   // 0.86667
  neckBaseY: 0.8500,
  shoulderY: 0.8200,
  nippleY: 0.7200,
  elbowY: 0.6300,
  wristY: 0.4850,
  fingerY: 0.3850,
  hipY: 0.5300,
  kneeY: 0.2850,
  ankleY: 0.0390,
  shoulderHalf: 0.1335,  // 肩峰半宽（含三角肌外缘）
  jointHalf: 0.1135,     // 肩关节（肱骨头）中心半宽
  hipHalf: 0.0940        // 髋关节中心半径
};

/* 头部局部坐标：原点 = 颈根（绝对高度0.85h），单位同身高比 */
const HEAD_H = 1 / PROP.headCount;               // 0.13333
const HEAD_CHIN = PROP.chinY - PROP.neckBaseY;   // 0.01667
const HEAD_TIP = HEAD_CHIN + HEAD_H;             // 0.15000
const HEAD_EYE = HEAD_CHIN + HEAD_H * 0.500;     // 0.08333 眼线 = 颅顶-颏底中线（ANAT.EYE_V）
const HEAD_BROW = HEAD_CHIN + HEAD_H * 0.560;    // 0.09133 眉线 = 眼线+16%
const HEAD_NOSE = HEAD_CHIN + HEAD_H * 0.330;    // 0.06067 鼻底 = 眼线-117%
const HEAD_MOUTH = HEAD_CHIN + HEAD_H * 0.222;   // 0.04567 口裂 = 鼻底-颏底的1/3
const HEAD_HW = HEAD_H * 0.312;                  // 0.0416 头半宽（头宽 = 0.624 头高，接近真人）
const HEAD_HD = HEAD_H * 0.418;                  // 0.0557 头半深（头深 ≈0.835 头高）
const HEAD_CY = HEAD_CHIN + HEAD_H * 0.620;      // 0.09933 颅球中心
const HEAD_SY = (HEAD_TIP - 0.0020 - HEAD_CY) / HEAD_HW; // 颅球纵向缩放：颅顶落在0.148

/**
 * 构建一个3D 人形。真骨骼分组，动画由关节点旋转驱动。
 * @param {object} app 外观参数（applyLook / randomAppearance 的产物）
 * @param {object} opts { fine:boolean 是否高精度（近景/通缉令头像用 true，远景LOD 用false）}
 */
export function buildCharacter(app, opts = {}) {
  const fine = opts.fine !== false;
  const seg = fine ? 14 : 8;                 // 主干旋转分段
  const segS = fine ? 8 : 6;                 // 小件分段
  const sphW = fine ? 14 : 8, sphH = fine ? 12 : 6;

  const h = (app.heightCm || 175) / 100;     // 身高（米）
  const buildW = (app.build && app.build.w) || 1;
  const wf = 0.93 + (buildW - 0.9) * 0.70;   // 体型宽度系数 0.93 / 1.00 / 1.09
  const ex = app.extras || {};

  /* ——关键高度（米）——*/
  const hipY = PROP.hipY * h;
  const ankleY = PROP.ankleY * h;
  const thighLen = (PROP.hipY - PROP.kneeY) * h;      // 0.245h
  const shinLen = (PROP.kneeY - PROP.ankleY) * h;     // 0.246h
  const legLen = hipY;                                // 髋高=地面 0.53h
  const torsoH = (PROP.neckBaseY - PROP.hipY) * h;    // 0.32h
  const armUpper = (PROP.shoulderY - PROP.elbowY) * h; // 0.19h
  const armFore = (PROP.elbowY - PROP.wristY) * h;     // 0.145h
  const shoulderX = PROP.jointHalf * wf * h;
  const hipHalfX = PROP.hipHalf * wf * h;

  /* ——材质：一个材质= 一个draw call，新增材质都只服务近景细节——*/
  const C = {
    skin: mat(app.skin.c, 0.72),
    ur: mat(app.upper.c, 0.88),                   // 上衣主体
    urD: mat(shadeHex(app.upper.c, 0.78), 0.90),  // 外套/翻领/袖口（深一档拉层次）
    urL: mat(shadeHex(app.upper.c, 1.14), 0.86),  // 衣摆/领口亮部
    pt: mat(app.pants.c, 0.92),
    ptD: mat(shadeHex(app.pants.c, 0.80), 0.92),
    hair: mat(app.hairHex || '#2b1c14', 0.84),
    shoe: mat('#1d1f24', 0.56),
    sole: mat('#0f1013', 0.88),
    white: mat('#e7e2da', 0.56),
    iris: mat('#5a4126', 0.36),
    pupil: mat('#0a0b0d', 0.26),
    lip: mat('#a5665f', 0.62),
    dark: mat('#15161a', 0.70),
    accent: mat(ex.shirt || '#cfd6de', 0.84),
    tie: mat(ex.tie || '#2a3442', 0.70),
    stripe: mat(ex.stripe || '#e6d055', 0.45, 0.15),
    metal: mat('#b9bfc6', 0.35, 0.78)
  };
  if (ex.helmet) C.helmet = mat(ex.helmet, 0.55, 0.20);
  if (ex.backpack) C.bag = mat(ex.backpack, 0.88);
  if (ex.bag) C.handbag = mat(ex.bag, 0.85);
  if (ex.headphones) C.phone = mat(ex.headphones, 0.50, 0.20);
  /* ——服装分件 / 手持道具材质 ——*/
  if (ex.vest) C.vest = mat(ex.vest, 0.74);
  if (ex.briefcase) { C.caseBody = mat(ex.briefcase, 0.52); C.caseTrim = mat(shadeHex(ex.briefcase, 0.62), 0.46); }
  if (ex.paperbag) { C.kraft = mat(ex.paperbag, 0.92); C.kraftD = mat(shadeHex(ex.paperbag, 0.80), 0.94); }
  if (ex.phoneHold) { C.phoneShell = mat('#1b1d22', 0.40, 0.30); C.screen = mat('#9dbfdc', 0.18, 0.05); }
  if (ex.broom) { C.broomStick = mat('#c9762a', 0.74); C.bristle = mat('#a5702f', 0.94); }
  if (ex.shoe) {
    C.shoe = mat(ex.shoe, ex.shoeRough || 0.62);
    C.sole = mat(shadeHex(ex.shoe, 0.70), 0.86);
  }

  const root = new THREE.Group();
  root.name = 'character';

  /* ——部件桶：同材质合并成一个mesh；detail 桶是"近景细节"，远景LOD 隐藏 ——*/
  const buckets = new Map();
  const add = (material, part, detail) => {
    const key = material.uuid + (detail ? '|f' : '|b');
    let b = buckets.get(key);
    if (!b) { b = { material, detail: !!detail, parts: [] }; buckets.set(key, b); }
    b.parts.push(part);
  };
  const flush = (parent, prefix) => {
    for (const b of buckets.values()) {
      const m = mergeParts(b.parts, b.material, prefix + (b.detail ? '_d' : ''));
      if (b.detail) m.userData.fine = true;
      parent.add(m);
    }
    buckets.clear();
  };

  /* ======================= 躯干（骨骼根：髋部） ======================= */
  const torso = new THREE.Group();
  torso.position.set(0, hipY, 0);
  root.add(torso);
  const T = y => (y - PROP.hipY) * h;   // 绝对高度比→躯干局部米

  // 骨盆（臀 + 腹股沟）
  add(C.pt, P(cyl(0.093 * wf * h, 0.086 * wf * h, 0.080 * h, seg), 0, T(0.556), 0, 1, 1, 0.76));
  add(C.pt, P(sph(0.055 * wf * h, sphW, sphH), 0, T(0.548), -0.026 * h, 1.62, 0.92, 0.78));
  // 髋部两侧（转子隆起）
  for (const s of [-1, 1]) add(C.pt, P(sph(0.0445 * wf * h, sphW, sphH), s * 0.0790 * wf * h, T(0.548), 0, 1.04, 0.90, 0.88));
  // 腰（最细处 0.63）
  add(C.ur, P(cyl(0.083 * wf * h, 0.089 * wf * h, 0.072 * h, seg), 0, T(0.622), 0, 1, 1, 0.72));
  // 胸廓（下宽上略窄）
  add(C.ur, P(cyl(0.0925 * wf * h, 0.0800 * wf * h, 0.140 * h, seg), 0, T(0.720), 0, 1, 1, 0.70));
  add(C.ur, P(cyl(0.0920 * wf * h, 0.0965 * wf * h, 0.055 * h, seg), 0, T(0.792), 0, 1, 1, 0.66));
  // 胸肌前凸
  add(C.ur, P(sph(0.064 * wf * h, sphW, sphH), 0, T(0.730), 0.026 * h, 1.34, 0.95, 0.62));
  // 背部（肩胛隆起）
  add(C.ur, P(sph(0.070 * wf * h, sphW, sphH), 0, T(0.758), -0.028 * h, 1.24, 1.06, 0.55));
  // 肩带 / 锁骨）
  add(C.ur, P(sph(0.064 * wf * h, sphW, sphH), 0, T(0.800), -0.002 * h, 1.72, 0.52, 0.62));

  // 斜方肌：颈根 →肩峰的斜坡过渡（关键：解除脖子插在方肩上的僵硬感）
  for (const s of [-1, 1]) {
    add(C.skin, P(sph(0.0445 * wf * h, sphW, sphH), s * 0.0640 * wf * h, T(0.812), -0.008 * h, 1.36, 0.58, 0.92, 0, 0, s * -0.24));
    add(C.skin, P(cyl(0.011 * wf * h, 0.016 * wf * h, 0.062 * h, segS), s * 0.020 * wf * h, T(0.812), 0.020 * h, 1, 1, 0.8, 0, 0, s * 0.42), true); // 胸锁乳突肌
  }
  // 颈（圆柱略前倾，撑起下颌）
  add(C.skin, P(cyl(0.0305 * wf * h, 0.0355 * wf * h, 0.098 * h, seg), 0, T(0.820), 0.004 * h, 1, 1, 0.94, 0.06, 0, 0));
  // 颈后（项部）与颈窝，消除"细棍脖子"的断裂感
  add(C.skin, P(sph(0.0245 * wf * h, sphW, sphH), 0, T(0.828), -0.018 * h, 1.10, 0.80, 0.86), true);
  add(C.skin, P(sph(0.0130 * wf * h, segS, 6), 0, T(0.846), 0.030 * h, 1.20, 0.55, 0.70), true);

  /* ——服装层次：下摆/ 门襟 / 翻领 / 衬衫领/ 领带 / 腰带 / 口袋 ——*/
  add(C.urL, P(cyl(0.096 * wf * h, 0.100 * wf * h, 0.018 * h, seg), 0, T(0.588), 0, 1, 1, 0.755)); // 衣摆
  add(C.urD, P(cyl(0.0885 * wf * h, 0.0905 * wf * h, 0.020 * h, seg), 0, T(0.648), 0, 1, 1, 0.735)); // 腰节
  add(C.dark, P(box(0.005 * h, 0.180 * h, 0.004 * h), 0, T(0.700), 0.070 * h, 1, 1, 1, -0.02, 0, 0), true); // 门襟拉链
  for (const s of [-1, 1]) {
    // 翻领（外套开襟）
    add(C.urD, P(box(0.030 * wf * h, 0.115 * h, 0.008 * h), s * 0.036 * wf * h, T(0.752), 0.063 * h, 1, 1, 1, 0.05, 0, s * 0.30), true);
    // 侧口袋
    add(C.urD, P(box(0.034 * wf * h, 0.040 * h, 0.006 * h), s * 0.072 * wf * h, T(0.665), 0.058 * h, 1, 1, 1, 0, s * -0.6, 0), true);
  }
  // 腰带 + 带扣
  add(C.dark, P(cyl(0.087 * wf * h, 0.089 * wf * h, 0.022 * h, seg), 0, T(0.575), 0, 1, 1, 0.745), true);
  add(C.metal, P(box(0.022 * h, 0.014 * h, 0.006 * h), 0, T(0.575), 0.066 * h), true);

  // 衬衫领+ 领带（西装男 / 白领女/ 蓝夹克内搭）
  if (ex.shirt) {
    add(C.accent, P(cyl(0.040 * wf * h, 0.049 * wf * h, 0.030 * h, seg), 0, T(0.808), 0.004 * h, 1, 1, 0.88), true);
    for (const s of [-1, 1]) {
      add(C.accent, P(box(0.024 * h, 0.030 * h, 0.006 * h), s * 0.020 * h, T(0.796), 0.058 * h, 1, 1, 1, 0.10, 0, s * 0.55), true);
    }
    if (ex.tie) {
      add(C.tie, P(box(0.017 * h, 0.016 * h, 0.008 * h), 0, T(0.798), 0.068 * h, 1, 1, 1, 0.12, 0, 0), true);
      add(C.tie, P(box(0.020 * h, 0.088 * h, 0.008 * h), 0, T(0.752), 0.070 * h, 1, 1, 1, 0.10, 0, 0), true);
    }
  }
  // 反光背心（老伯）：橙色马甲套在深色长袖衫外，前开襟露内搭
  if (ex.vest) {
    add(C.vest, P(cyl(0.0990 * wf * h, 0.0930 * wf * h, 0.150 * h, seg), 0, T(0.712), 0, 1, 1, 0.72));
    add(C.vest, P(cyl(0.0935 * wf * h, 0.0890 * wf * h, 0.070 * h, seg), 0, T(0.625), 0, 1, 1, 0.74));
    // 肩部（背心肩带压住双肩）
    for (const s of [-1, 1]) {
      add(C.vest, P(box(0.040 * wf * h, 0.016 * h, 0.058 * h), s * 0.0450 * wf * h, T(0.806), 0.004 * h, 1, 1, 1, 0, 0, s * 0.06), true);
    }
    // 前开襟（露出深色内搭的一道竖缝）
    add(C.dark, P(box(0.011 * h, 0.218 * h, 0.007 * h), 0, T(0.705), 0.0712 * h, 1, 1, 1, 0.01, 0, 0), true);
    // 胸口小口袋
    add(C.vest, P(box(0.030 * wf * h, 0.026 * h, 0.006 * h), 0.048 * wf * h, T(0.700), 0.0700 * h, 1, 1, 1, 0, -0.35, 0), true);
  }
  // 反光条（橙色背心上两道银色反光条 + 两侧竖条）
  if (ex.stripes) {
    const rs = ex.vest ? 0.1005 : 0.100;
    add(C.stripe, P(cyl(rs * wf * h, rs * wf * h, 0.014 * h, seg), 0, T(0.690), 0, 1, 1, 0.715));
    add(C.stripe, P(cyl((rs - 0.004) * wf * h, (rs - 0.004) * wf * h, 0.011 * h, seg), 0, T(0.638), 0, 1, 1, 0.735));
    if (ex.vest) {
      for (const s of [-1, 1]) {
        add(C.stripe, P(box(0.010 * h, 0.150 * h, 0.006 * h), s * 0.0400 * wf * h, T(0.700), 0.0700 * h, 1, 1, 1, 0, 0, 0), true);
      }
    }
  }
  // 西装外套（西装男 / 西装女）：左右开襟前片+ 大驳领+ 衬衫 V 区
  if (ex.suit) {
    add(C.accent, P(box(0.050 * h, 0.080 * h, 0.006 * h), 0, T(0.778), 0.0600 * h, 1, 1, 1, 0.06, 0, 0), true);
    for (const s of [-1, 1]) {
      // 前襟（自胸口收到腰节，做出西装的开襟V 形）
      add(C.ur, P(box(0.056 * wf * h, 0.215 * h, 0.018 * h), s * 0.0410 * wf * h, T(0.705), 0.0555 * h, 1, 1, 1, 0.02, s * 0.06, 0), true);
      // 驳头（翻领）：上宽下窄，朝外掀开
      add(C.urD, P(box(0.034 * wf * h, 0.112 * h, 0.010 * h), s * 0.0320 * wf * h, T(0.765), 0.0630 * h, 1, 1, 1, 0.06, 0, s * 0.36), true);
      // 袖口袖扣
      add(C.metal, P(box(0.006 * h, 0.005 * h, 0.002 * h), s * 0.026 * wf * h, T(0.630), 0.018 * h), true);
    }
    // 下摆开衩
    add(C.urD, P(box(0.004 * h, 0.070 * h, 0.004 * h), 0, T(0.600), -0.0700 * h, 1, 1, 1, 0, 0, 0), true);
  }
  // 夹克（深蓝夹克男）：立领 + 下摆罗纹 + 前拉链
  if (ex.jacket) {
    add(C.urD, P(cyl(0.0940 * wf * h, 0.0960 * wf * h, 0.032 * h, seg), 0, T(0.589), 0, 1, 1, 0.740), true);
    for (const s of [-1, 1]) {
      add(C.urD, P(box(0.032 * wf * h, 0.062 * h, 0.014 * h), s * 0.038 * wf * h, T(0.800), 0.045 * h, 1, 1, 1, 0.10, 0, s * -0.55), true);
    }
    add(C.metal, P(box(0.006 * h, 0.170 * h, 0.003 * h), 0, T(0.700), 0.0720 * h), true);
  }
  // 半身裙（白领女）：A 字，下摆稍宽
  if (ex.skirt) {
    add(C.pt, P(cyl(0.092 * wf * h, 0.126 * wf * h, 0.150 * h, seg), 0, T(0.500), 0, 1, 1, 0.80));
    add(C.ptD, P(cyl(0.127 * wf * h, 0.129 * wf * h, 0.010 * h, seg), 0, T(0.428), 0, 1, 1, 0.80), true);
  } else {
    // 裤腰头（西裤/牛仔裤都有的层次）
    add(C.ptD, P(cyl(0.090 * wf * h, 0.092 * wf * h, 0.016 * h, seg), 0, T(0.566), 0, 1, 1, 0.76), true);
  }
  // 连帽（卫衣）：颈后兜帽，向背部铺开
  if (ex.hood) {
    add(C.ur, P(sph(0.080 * wf * h, sphW, sphH), 0, T(0.790), -0.052 * h, 1.10, 0.92, 0.86));
    add(C.urD, P(cyl(0.088 * wf * h, 0.098 * wf * h, 0.016 * h, seg), 0, T(0.795), -0.048 * h, 1, 1, 0.80), true);
  }
  // 双肩包
  if (ex.backpack) {
    add(C.bag, P(box(0.150 * wf * h, 0.190 * h, 0.080 * h), 0, T(0.730), -0.108 * h));
    add(C.bag, P(box(0.098 * h, 0.052 * h, 0.086 * h), 0, T(0.822), -0.106 * h), true);
    for (const s of [-1, 1]) add(C.dark, P(box(0.020 * h, 0.150 * h, 0.012 * h), s * 0.070 * h, T(0.760), 0.040 * h, 1, 1, 1, 0, 0, s * 0.06), true);
  }
  flush(torso, 'torso');

  /* ======================= 头（跟随躯干，可独立转动）======================= */
  const head = new THREE.Group();
  head.position.set(0, torsoH, 0);   // 原点 = 颈根
  torso.add(head);
  const H = v => v * h;              // 头部比例 （）

  /* ——头部：程序化 UV 贴图 + 头骨变形几何 ——
     不再用球体+ 拼装件堆脸：颅骨、下颌、颧弓、眉弓、眼窝、鼻梁、唇、颏等
     全部由headPoint() 在同一个参数化曲面上形变出来，五官画在同一张Canvas 贴图上，
     因此正脸 / 3-4 侧脸 / 后脑都不会出现球与球之间的缝隙和粘连。*/
  const faceP = pickFace(app.look || (((app.buildIdx || 0) + (app.heightBucket || 0) + (app.glasses ? 3 : 0)) % 6 + 1));
  app.face = faceP;
  app.faceName = faceP.name;
  const headUnit = HEAD_H * h;                    // "头高 = 1" （）
  const headGeo = buildHeadGeometry(faceP, fine ? { segW: 64, segH: 44 } : { segW: 36, segH: 26 });
  headGeo.scale(headUnit, headUnit, headUnit);
  headGeo.translate(0, H(HEAD_CHIN), 0);          // 几何以"下巴 = 0"建模，平移到颈根坐标。
  const headMap = buildFaceTexture({
    skin: app.skin.c, hair: app.hairHex,
    beard: (app.beard && app.beard !== '') ? app.beard : faceP.beard,
    hairStyle: app.hairStyle,
    face: faceP, quality: fine ? 2048 : 1024
  });
  const headSkinMat = new THREE.MeshStandardMaterial({ map: headMap, roughness: 0.70, metalness: 0.0 });
  headSkinMat.name = 'headSkin';
  const headMesh = new THREE.Mesh(headGeo, headSkinMat);
  headMesh.name = 'headSkin';
  headMesh.userData.face = faceP;
  head.add(headMesh);

  /* ——眼球：保留几何，缩小到真人比例（半径 ≈0.030 头高，约 12mm 级），嵌入眼窝——
     巩膜横向拉成杏仁形、竖向压扁，保证不超出贴图画出的眼裂）
     虹膜 / 瞳孔 / 角膜高光沿眼眶法线逐层外推，所以侧脸看是眼球而不是白球。*/
  const rEye = 0.0282 * headUnit;   // 真人比例：眼球直径≈0.056 头高（约 13mm）
  for (const s of [-1, 1]) {
    const exU = s * 0.132 * faceP.eyeGap;                    // 头高单位
    const surfZ = headSurfaceZ(exU, faceP.eyeY, faceP);      // 该处骨面 z
    const aOut = Math.asin(Math.max(-0.9, Math.min(0.9, exU / HEAD_HWF)));
    const nx = Math.sin(aOut), nz = Math.cos(aOut);
    const cx = exU * headUnit;
    const cy = H(HEAD_CHIN + faceP.eyeY * HEAD_H);
    const cz = (surfZ - 0.0240) * headUnit;   // 往里嵌，避免凸出
    add(C.white, P(sph(rEye, sphW, sphH), cx, cy, cz, 1.80, 0.66, 0.94, 0, aOut, 0), true);
    // 虹膜 = 真人比例（约占眼裂宽度45%），随眼眶法线外推，侧视也能看到虹膜弧面
    add(C.iris, P(sph(rEye * 0.78, sphW, sphH), cx + nx * rEye * 0.34, cy - rEye * 0.02, cz + nz * rEye * 0.34, 1.0, 1.0, 0.66, 0, aOut, 0), true);
    add(C.pupil, P(sph(rEye * 0.34, sphW, sphH), cx + nx * rEye * 0.50, cy - rEye * 0.02, cz + nz * rEye * 0.50, 1.0, 1.0, 0.50, 0, aOut, 0), true);
    // 角膜高光（小、偏上内侧）
    add(C.white, P(sph(rEye * 0.085, 6, 5), cx + nx * rEye * 0.56 - s * rEye * 0.20, cy + rEye * 0.16, cz + nz * rEye * 0.56, 1.0, 1.0, 0.6), true);
  }

  // 耳：耳廓 + 耳轮 + 耳垂（耳长 0.177 头高，上缘齐眼线 0.505、下缘齐鼻底 0.328）
  for (const s of [-1, 1]) {
    add(C.skin, P(sph(0.0112 * h, sphW, sphH), s * 0.0416 * h, H(HEAD_CHIN + HEAD_H * 0.4165), -0.003 * h, 0.34, 1.065, 1.04), true);
    add(C.skin, P(tor(0.0062 * h, 0.0018 * h, 5, 10), s * 0.0434 * h, H(HEAD_CHIN + HEAD_H * 0.428), -0.004 * h, 1, 1, 1, 0, Math.PI / 2, 0), true);
    add(C.skin, P(sph(0.0046 * h, segS, 6), s * 0.0426 * h, H(HEAD_CHIN + HEAD_H * 0.336), -0.002 * h, 1.0, 1.0, 0.9), true);
  }

  /* ——发型：与头骨同一套参数曲面的"发壳"，只保留发际线以上部分——
     因此发型轮廓跟着头骨走（后脑有弧、两鬓后退、后颈下延），不再是把一个球扣在头上。
     具体发际线高度、外扩倍率、后颈下延量由head.js 的hairLineV / HAIR_GEO 统一控制。
     与UV 贴图里画的那条发际线完全同一条曲线。*/
  const hs = app.hairStyle;
  if (hs !== '秃顶') {
    const hairGeo = buildHairGeometry(faceP, hs, fine ? { segW: 56, segH: 40 } : { segW: 32, segH: 22 });
    hairGeo.scale(headUnit, headUnit, headUnit);
    hairGeo.translate(0, H(HEAD_CHIN), 0);
    // 发壳用程序化毛发贴图（发丝走向+ 束状明暗），避免纯色块面和黑帽感
    const hairMat = new THREE.MeshStandardMaterial({
      map: buildHairTexture({ hair: app.hairHex, hairStyle: hs, seed: (faceP.id || 1) + (app.buildIdx || 0) }),
      color: 0xffffff, roughness: 0.66, metalness: 0.0
    });
    hairMat.name = 'hairShellMat';
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.name = 'hairShell';
    head.add(hairMesh);
  }
  // 发型附加件（马尾 / 盘发髻/ 鬓角 / 后发帘），位置按新头骨重新定义
  if (hs === '马尾') {
    add(C.hair, P(cyl(0.010 * h, 0.014 * h, 0.080 * h, segS), 0, H(HEAD_CHIN + 0.030), -HEAD_HD * 1.16, 1, 1, 1, -0.32, 0, 0), true);
    add(C.hair, P(sph(0.016 * h, sphW, sphH), 0, H(HEAD_CHIN + 0.058), -HEAD_HD * 1.02, 1.1, 0.9, 0.9), true);
  } else if (hs === '盘发') {
    add(C.hair, P(sph(0.021 * h, sphW, sphH), 0, H(HEAD_CHIN + HEAD_H * 0.55), -HEAD_HD * 1.06, 1.15, 1.0, 0.88), true);
  } else if (hs === '中长发') {
    add(C.hair, P(box(0.090 * h, 0.075 * h, 0.024 * h), 0, H(HEAD_CHIN + 0.022), -HEAD_HD * 0.92, 1, 1, 1, 0.06, 0, 0), true);
  } else if (hs === '背头') {
    add(C.hair, P(box(0.070 * h, 0.011 * h, 0.030 * h), 0, H(HEAD_CHIN + HEAD_H * 0.965), -HEAD_HD * 0.34, 1, 1, 1, 0.10, 0, 0), true);
  } else if (hs === '秃顶') {
    add(C.hair, P(sph(0.014 * h, sphW, sphH), -0.030 * h, H(HEAD_CHIN + HEAD_H * 0.66), -0.010 * h, 1.1, 1.3, 1.1), true);
  }

  /* ——眼镜 / 帽子 / 头盔 / 耳机 ——*/
  if (app.glasses) {
    for (const s of [-1, 1]) {
      // 镜圈/镜片前移到眼球表面之外（z ≈0.0565h），镜架不再"嵌进脸里"
      add(C.metal, P(tor(0.0098 * h, 0.0012 * h, 5, 14), s * 0.0182 * h, H(HEAD_EYE), 0.0565 * h, 1, 1, 1, 0, 0, 0), true);
      add(C.white, P(cyl(0.0093 * h, 0.0093 * h, 0.0010 * h, segS), s * 0.0182 * h, H(HEAD_EYE), 0.0565 * h, 1, 1, 1, Math.PI / 2, 0, 0), true);
    }
    add(C.metal, P(box(0.0125 * h, 0.0014 * h, 0.0014 * h), 0, H(HEAD_EYE + 0.0015), 0.0568 * h), true);
    for (const s of [-1, 1]) add(C.metal, P(box(0.032 * h, 0.0016 * h, 0.0016 * h), s * 0.0320 * h, H(HEAD_EYE + 0.002), 0.0470 * h, 1, 1, 1, 0, s * 0.62, 0), true);
  }
  // 壳状物（帽/ 头盔）同样贴着新头骨生成，不再用悬空球体
  const skullShell = (k, minV, material) => {
    const g = buildCapGeometry(faceP, { scale: k, minV, segW: fine ? 40 : 24, segH: fine ? 28 : 18 });
    g.scale(headUnit, headUnit, headUnit);
    g.translate(0, H(HEAD_CHIN), 0);
    head.add(new THREE.Mesh(g, material));
  };
  if (app.hat === '鸭舌帽') {
    skullShell(1.075, 0.545, C.dark);
    add(C.dark, P(box(0.086 * h, 0.008 * h, 0.052 * h), 0, H(HEAD_BROW + 0.008), HEAD_HD * 1.16, 1, 1, 1, -0.12, 0, 0));
  } else if (app.hat === '渔夫帽') {
    skullShell(1.085, 0.575, C.dark);
    add(C.dark, P(cyl(HEAD_HW * 1.20 * h, HEAD_HW * 1.55 * h, 0.007 * h, seg), 0, H(HEAD_CHIN + HEAD_H * 0.585), -0.004 * h));
  }
  if (ex.helmet) {
    skullShell(1.105, 0.500, C.helmet);
    add(C.helmet, P(box(0.078 * h, 0.012 * h, 0.030 * h), 0, H(HEAD_BROW + 0.012), HEAD_HD * 1.20, 1, 1, 1, -0.14, 0, 0), true);
    add(C.dark, P(box(0.070 * h, 0.014 * h, 0.008 * h), 0, H(HEAD_EYE + 0.006), HEAD_HD * 1.06, 1, 1, 1, 0, 0, 0), true); // 护目挡片
  }
  if (ex.headphones) {
    // 头梁（跨过头顶）+ 两侧大耳罩（罩杯 + 软垫圈），读作"大耳机"
    add(C.phone, P(tor(HEAD_HW * 1.16 * h, 0.0060 * h, 6, 16), 0, H(HEAD_CY + 0.006), -0.004 * h, 1, 1, 1, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) {
      add(C.phone, P(cyl(0.0205 * h, 0.0205 * h, 0.0150 * h, segS), s * HEAD_HW * 1.13 * h, H(HEAD_CY - 0.004), -0.004 * h, 1, 1, 1, 0, 0, Math.PI / 2));
      add(C.dark, P(tor(0.0208 * h, 0.0042 * h, 5, 14), s * HEAD_HW * 1.19 * h, H(HEAD_CY - 0.004), -0.004 * h, 1, 1, 1, 0, Math.PI / 2, 0), true);
      // 连接头梁的滑杆
      add(C.phone, P(box(0.0060 * h, 0.030 * h, 0.0080 * h), s * HEAD_HW * 1.11 * h, H(HEAD_CY + 0.036), -0.004 * h), true);
    }
  }
  flush(head, 'head');

  /* ======================= 手臂：肩 →上臂 →（肘）前臂 →手掌五指 ======================= */
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderX, T(PROP.shoulderY), 0);
    torso.add(shoulder);

    // 三角肌（包住肩关节，形成肩峰外缘）
    add(C.ur, P(sph(0.0355 * wf * h, sphW, sphH), side * 0.004 * h, 0.002 * h, 0, 1.02, 1.26, 0.96));
    // 上臂（近端粗、远端细）
    add(C.ur, P(cyl(0.0302 * wf * h, 0.0243 * wf * h, armUpper * 0.94, seg), 0, -armUpper * 0.49, 0, 1, 1, 0.94));
    // 肱二头肌
    add(C.ur, P(sph(0.0276 * wf * h, sphW, sphH), 0, -armUpper * 0.42, 0.004 * h, 1.0, 1.32, 1.06));
    // 袖口（服装层次）
    add(C.urD, P(cyl(0.0250 * wf * h, 0.0258 * wf * h, 0.013 * h, seg), 0, -armUpper * 0.955, 0, 1, 1, 0.96));
    flush(shoulder, side < 0 ? 'armL' : 'armR');

    const elbow = new THREE.Group();
    elbow.position.set(0, -armUpper, 0);
    shoulder.add(elbow);
    add(C.skin, P(sph(0.0238 * wf * h, sphW, sphH), 0, 0, 0));
    // 前臂
    add(C.skin, P(cyl(0.0253 * wf * h, 0.0158 * wf * h, armFore * 0.92, seg), 0, -armFore * 0.48, 0, 1, 1, 0.94));
    add(C.skin, P(sph(0.0236 * wf * h, sphW, sphH), 0, -armFore * 0.33, 0.001 * h, 1.0, 1.26, 0.98));
    // 肘
    add(C.skin, P(sph(0.0150 * wf * h, sphW, sphH), 0, -armFore * 0.97, 0, 1.0, 0.92, 0.86));
    flush(elbow, side < 0 ? 'foreL' : 'foreR');

    /* 手掌（始终显示，远景 LOD 也不隐藏）*/
    const hand = new THREE.Group();
    hand.position.set(0, -armFore, 0);
    elbow.add(hand);
    // 掌主体：略带弧度的方块
    add(C.skin, P(box(0.0330 * wf * h, 0.0440 * h, 0.0155 * h), 0, -0.0245 * h, 0.0015 * h, 1, 1, 1, 0.05, 0, 0));
    add(C.skin, P(sph(0.0180 * wf * h, sphW, sphH), 0, -0.0260 * h, 0.0020 * h, 0.94, 1.30, 0.62));
    // 鱼际（拇指根肉垫）
    add(C.skin, P(sph(0.0105 * h, sphW, sphH), side * 0.0150 * h, -0.0165 * h, 0.0055 * h, 1.0, 1.20, 0.95));
    // 拇指（两节）
    add(C.skin, P(cyl(0.0054 * h, 0.0046 * h, 0.0195 * h, segS), side * 0.0205 * h, -0.0170 * h, 0.0075 * h, 1.0, 1.0, 1.0, 0.10, 0, side * 0.55));
    add(C.skin, P(sph(0.0049 * h, segS, 6), side * 0.0238 * h, -0.0248 * h, 0.0088 * h));
    add(C.skin, P(cyl(0.0048 * h, 0.0041 * h, 0.0165 * h, segS), side * 0.0268 * h, -0.0310 * h, 0.0100 * h, 1.0, 1.0, 1.0, 0.16, 0, side * 0.28), true);
    add(C.skin, P(sph(0.0044 * h, segS, 6), side * 0.0292 * h, -0.0385 * h, 0.0112 * h, 1.0, 1.15, 1.15), true);
    // 四指：食指/ 中指 / 无名指/ 小指，各 3 节（近景细节）
    const fingers = [
      { x: -0.0122, seg: [0.0215, 0.0175, 0.0135], w: 0.0090 },
      { x: -0.0040, seg: [0.0235, 0.0195, 0.0145], w: 0.0092 },
      { x: 0.0040, seg: [0.0225, 0.0185, 0.0140], w: 0.0088 },
      { x: 0.0122, seg: [0.0180, 0.0150, 0.0115], w: 0.0080 }
    ];
    for (const f of fingers) {
      let py = -0.0455 * h;
      let pz = 0.0018 * h;
      const rw = f.w * h * 0.52;
      for (let i = 0; i < f.seg.length; i++) {
        const L = f.seg[i] * h;
        const rx = 0.10 + i * 0.13;
        // 指节：圆柱（远端渐细、指腹略扁）
        add(C.skin, P(cyl(rw * 0.94, rw * 0.80, L * 1.06, segS), side * f.x * h, py - L * 0.5, pz + i * 0.0022 * h, 1.0, 1.0, 0.88, rx, 0, 0), true);
        // 指关节：球（做出骨节凸起）
        add(C.skin, P(sph(rw * 1.06, segS, 6), side * f.x * h, py + 0.0006 * h, pz + i * 0.0022 * h + 0.0004 * h, 1.0, 1.0, 0.95), true);
        py -= L * 0.97;
        pz += i * 0.0006 * h;
      }
      // 指尖（圆指腹）
      add(C.skin, P(sph(rw * 0.86, segS, 6), side * f.x * h, py + 0.0035 * h, pz + 0.0035 * h, 1.0, 1.10, 1.20), true);
    }
    flush(hand, side < 0 ? 'handL' : 'handR');
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  /* ——随身物品 ——*/
  if (ex.bag) {
    const bag = new THREE.Group();
    bag.position.set(0, -armFore * 1.02, 0);
    armR.elbow.add(bag);
    add(C.handbag, P(box(0.072 * h, 0.085 * h, 0.098 * h), 0, -0.060 * h, 0.010 * h));
    add(C.handbag, P(box(0.074 * h, 0.010 * h, 0.100 * h), 0, -0.018 * h, 0.010 * h), true);
    add(C.dark, P(tor(0.026 * h, 0.005 * h, 5, 10), 0, -0.006 * h, 0, 1, 1, 1, Math.PI / 2, 0, 0));
    flush(bag, 'handbag');
  }
  if (ex.phone) {
    add(C.dark, P(box(0.030 * h, 0.058 * h, 0.008 * h), 0, -armFore * 1.08, 0.012 * h), true);
  }

  /* ——手持道具：分工件挂在右手的掌根处，随笔直/抬臂动画一起运动——
     挂在 hand（腕关节）而不是elbow，手臂摆动时公文包/纸袋/扫帚/手机会随手腕一起晃动。*/
  if (ex.briefcase) {
    const cs = new THREE.Group();
    cs.position.set(0.004 * h, -0.010 * h, 0.004 * h);   // 提手顶端穿过掌心，避免箱子悬在手下
    armR.hand.add(cs);
    // 提手（半环，穿过掌心）
    add(C.caseTrim, P(tor(0.0165 * h, 0.0030 * h, 6, 14), 0, -0.0100 * h, 0), true);
    add(C.caseTrim, P(box(0.0060 * h, 0.011 * h, 0.0060 * h), -0.0155 * h, -0.0140 * h, 0), true);
    add(C.caseTrim, P(box(0.0060 * h, 0.011 * h, 0.0060 * h), 0.0155 * h, -0.0140 * h, 0), true);
    // 箱体（宽 0.235h≈.42m / 高0.150h≈.27m / 厚0.062h≈.11m）
    add(C.caseBody, P(box(0.235 * h, 0.150 * h, 0.062 * h), 0, -0.0955 * h, 0), true);
    // 箱盖分缝
    add(C.caseTrim, P(box(0.238 * h, 0.0055 * h, 0.0655 * h), 0, -0.0640 * h, 0), true);
    // 两侧锁扣
    for (const s of [-1, 1]) add(C.caseTrim, P(box(0.016 * h, 0.013 * h, 0.0075 * h), s * 0.072 * h, -0.0575 * h, 0.0315 * h), true);
    // 底部包角
    for (const s of [-1, 1]) add(C.caseTrim, P(box(0.020 * h, 0.020 * h, 0.064 * h), s * 0.104 * h, -0.158 * h, 0), true);
    flush(cs, 'briefcase');
  }

  if (ex.paperbag) {
    const pg = new THREE.Group();
    pg.position.set(0.004 * h, -0.010 * h, 0.004 * h);   // 提手顶端穿过掌心，避免纸袋悬空
    armR.hand.add(pg);
    // 提手（纸袋细绳）
    add(C.kraftD, P(tor(0.0135 * h, 0.0016 * h, 5, 10), 0, -0.0080 * h, 0), true);
    // 袋身（宽 0.118h≈.21m / 高0.150h≈.27m / 厚0.068h≈
    add(C.kraft, P(box(0.118 * h, 0.150 * h, 0.068 * h), 0, -0.096 * h, 0), true);
    // 袋口折边
    add(C.kraftD, P(box(0.122 * h, 0.012 * h, 0.072 * h), 0, -0.027 * h, 0), true);
    // 袋底折边
    add(C.kraftD, P(box(0.120 * h, 0.009 * h, 0.070 * h), 0, -0.166 * h, 0), true);
    // 侧面压痕
    for (const s of [-1, 1]) add(C.kraftD, P(box(0.0022 * h, 0.130 * h, 0.070 * h), s * 0.0585 * h, -0.096 * h, 0), true);
    flush(pg, 'paperbag');
  }

  if (ex.phoneHold) {
    const ph = new THREE.Group();
    ph.position.set(0.002 * h, -0.032 * h, 0.010 * h);
    ph.rotation.set(-0.62, 0.10, 0);      // 屏幕朝内上方，看着手机屏幕
    armR.hand.add(ph);
    add(C.phoneShell, P(box(0.044 * h, 0.086 * h, 0.0075 * h), 0, 0, 0), true);
    add(C.screen, P(box(0.038 * h, 0.078 * h, 0.0022 * h), 0, 0, 0.0045 * h), true);
    add(C.dark, P(box(0.014 * h, 0.0030 * h, 0.0030 * h), 0, 0.0455 * h, 0.0010 * h), true);
    flush(ph, 'phoneInHand');
  }

  if (ex.broom) {
    const br = new THREE.Group();
    br.position.set(0.008 * h, -0.028 * h, 0.012 * h);
    br.rotation.set(0.10, 0, -0.045);      // 略向前倾，帚头落在脚前
    armR.hand.add(br);
    // 木柄：握点向上0.26h，向下到 0.45h（总长 0.71h≈.28m）
    add(C.broomStick, P(cyl(0.0058 * h, 0.0068 * h, 0.260 * h, segS), 0, 0.130 * h, 0), true);
    add(C.broomStick, P(cyl(0.0068 * h, 0.0062 * h, 0.450 * h, segS), 0, -0.155 * h, 0), true);
    // 柄头
    add(C.broomStick, P(sph(0.0088 * h, segS, 6), 0, 0.262 * h, 0, 1.0, 0.80, 1.0), true);
    // 捆扎带
    add(C.dark, P(cyl(0.0098 * h, 0.0098 * h, 0.014 * h, seg), 0, -0.334 * h, 0), true);
    // 帚毛（上窄下散）
    add(C.bristle, P(cyl(0.020 * h, 0.052 * h, 0.098 * h, seg), 0, -0.390 * h, 0, 1.0, 1.0, 0.62), true);
    add(C.bristle, P(box(0.080 * h, 0.016 * h, 0.040 * h), 0, -0.442 * h, 0), true);
    flush(br, 'broom');
  }

  /* ======================= 腿：髋→大腿 →（膝）小腿 →（踝）→======================= */
  const makeLeg = (side) => {
    // 裙装（西装女）：裙摆以下露出小腿/大腿皮肤，并收细腿围，避免"裙+裤"观感
    const legMat = ex.skirt ? C.skin : C.pt;
    const legMatD = ex.skirt ? C.skin : C.ptD;
    const legSlim = ex.skirt ? 0.82 : 1;
    const hip = new THREE.Group();
    hip.position.set(side * hipHalfX, hipY, 0);
    root.add(hip);
    // 大腿
    add(legMat, P(cyl(0.0445 * wf * h * legSlim, 0.0330 * wf * h * legSlim, thighLen * 0.96, seg), 0, -thighLen * 0.47, 0, 1, 1, 0.97));
    add(legMat, P(sph(0.0385 * wf * h * legSlim, sphW, sphH), 0, -thighLen * 0.26, 0.002 * h, 1.02, 1.42, 0.96));
    // 裤外缝（层次线，裙装时省略）
    if (!ex.skirt) add(legMatD, P(box(0.0022 * h, thighLen * 0.76, 0.0055 * h), side * 0.0355 * wf * h, -thighLen * 0.46, 0.0005 * h), true);
    flush(hip, side < 0 ? 'thighL' : 'thighR');

    const knee = new THREE.Group();
    knee.position.set(0, -thighLen, 0);
    hip.add(knee);
    add(legMat, P(sph(0.0325 * wf * h * legSlim, sphW, sphH), 0, 0, 0.002 * h, 1.0, 0.96, 0.98));
    // 小腿
    add(legMat, P(cyl(0.0350 * wf * h * legSlim, 0.0205 * wf * h * legSlim, shinLen * 0.94, seg), 0, -shinLen * 0.48, 0, 1, 1, 0.97));
    // 腓肠肌
    add(legMat, P(sph(0.0300 * wf * h * legSlim, sphW, sphH), 0, -shinLen * 0.30, -0.004 * h, 1.03, 1.52, 0.92));
    flush(knee, side < 0 ? 'shinL' : 'shinR');

    const foot = new THREE.Group();
    foot.position.set(0, -shinLen, 0);   // 踝关节（绝对 0.039h）
    knee.add(foot);
    // 鞋踝部
    add(C.shoe, P(cyl(0.0240 * wf * h, 0.0268 * wf * h, 0.032 * h, seg), 0, 0.004 * h, 0.004 * h, 1, 1, 1.06));
    // 鞋身（含足背斜面）
    add(C.shoe, P(sph(0.0285 * wf * h, sphW, sphH), 0, -0.0175 * h, 0.024 * h, 1.00, 0.74, 2.05));
    // 鞋头
    add(C.shoe, P(sph(0.0268 * wf * h, sphW, sphH), 0, -0.0215 * h, 0.076 * h, 0.96, 0.60, 1.10));
    // 鞋跟）
    add(C.shoe, P(box(0.0470 * wf * h, 0.032 * h, 0.038 * h), 0, -0.0215 * h, -0.020 * h));
    if (ex.heel) {
      // 高跟鞋（西装女）：只保留前掌薄底 + 细跟柱，后跟离地形成明显跟高
      add(C.sole, P(box(0.0510 * wf * h, 0.009 * h, 0.074 * h), 0, -0.0345 * h, 0.058 * h));
      add(C.sole, P(cyl(0.0078 * wf * h, 0.0118 * wf * h, 0.040 * h, segS), 0, -0.0192 * h, -0.0330 * h));
      add(C.shoe, P(box(0.040 * wf * h, 0.011 * h, 0.030 * h), 0, -0.0040 * h, -0.0320 * h), true);
      // 鞋口浅口（低口露脚背）
      add(C.shoe, P(cyl(0.0215 * wf * h, 0.0235 * wf * h, 0.008 * h, segS), 0, 0.0005 * h, 0.010 * h, 1, 1, 1.02), true);
    } else {
      // 鞋底（底面严格落在y = 0）
      add(C.sole, P(box(0.0510 * wf * h, 0.011 * h, 0.138 * h), 0, -0.0335 * h, 0.028 * h));
      add(C.sole, P(box(0.0500 * wf * h, 0.008 * h, 0.034 * h), 0, -0.0350 * h, -0.024 * h), true);
      // 鞋带
      for (let i = 0; i < 3; i++) {
        add(C.dark, P(box(0.0290 * wf * h, 0.0022 * h, 0.0030 * h), 0, -0.0085 * h - i * 0.0050 * h, 0.034 * h + i * 0.011 * h), true);
      }
    }
    flush(foot, 'foot');
    return { hip, knee, foot };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  /* ======================= 汇总userData ======================= */
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
    elbowL: armL.elbow, elbowR: armR.elbow,
    handL: armL.hand, handR: armR.hand
  };
  root.userData.height = h;
  root.userData.heightCm = app.heightCm || 175;
  root.userData.legLen = legLen;
  root.userData.torsoH = torsoH;
  root.userData.thighLen = thighLen;
  root.userData.shinLen = shinLen;
  root.userData.ankleH = ankleY;
  root.userData.headH = HEAD_H * h;
  root.userData.heads = PROP.headCount;
  root.userData.crownY = PROP.crownY * h;
  root.userData.chinY = PROP.chinY * h;
  root.userData.neckBaseY = PROP.neckBaseY * h;
  root.userData.shoulderY = PROP.shoulderY * h;
  root.userData.shoulderHalf = PROP.shoulderHalf * wf * h;
  root.userData.headCenterY = (PROP.chinY + HEAD_H * 0.5) * h;   // 头高几何中心 0.9333h
  root.userData.headY = legLen + torsoH;
  root.userData.headRel = torsoH;
  root.userData.fine = fine;
  root.userData.rig = {
    thighLen, shinLen, ankleH: ankleY, armUpper, armFore,
    strideMax: 0.62,      // 最大髋关节摆幅（弧度）
    kneeMax: 1.05,        // 最大膝关节屈曲
    armMax: 0.52
  };

  // LOD：显式标记的细节件+ 顶点数很少的小件，由 game.js 按距离显式隐藏
  const fineMeshes = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    o.receiveShadow = false;
    const g = o.geometry;
    const vc = g && g.attributes && g.attributes.position ? g.attributes.position.count : 0;
    if (o.userData.fine || (vc > 0 && vc < 240)) {
      o.userData.fine = true;
      o.castShadow = false;
      fineMeshes.push(o);
    } else {
      o.castShadow = fine;
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

/**
 * 命中盒：不可见、参与射线检测。
 * 尺寸随新骨骼重算——躯干盒贴合肩宽与髋宽，头部盒严格罩住新比例下的小颅骨，
 * 保证"爆头即毙/四肢擦弹不误判"的旧手感不变。
 */
export function attachHitboxes(root) {
  const h = root.userData.height;
  const app = root.userData.app;
  const wf = 0.93 + (((app && app.build && app.build.w) || 1) - 0.9) * 0.70;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.215 * h * wf, 0.700 * h, 0.180 * h), hitMat);
  body.position.y = 0.485 * h;          // 覆盖 0.135h ~ 0.835h（躯干+ 髋部）
  body.name = 'hitBody';

  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.125 * h, 0.140 * h, 0.130 * h), hitMat);
  headBox.position.y = 0.9333 * h;      // 头高几何中心（下巴0.8667 ~ 颅顶 1.0）
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

  // 步频：慢走约 1.5 步/秒，快跑约2.2 步/秒
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
  const kneeFor = (phase) => {
    const c = Math.cos(phase);
    const swingKnee = Math.pow(Math.max(0, c), 1.5) * (0.55 + 0.45 * sn) * Math.min(1, amp / 0.34);
    const stanceKnee = (0.07 + 0.10 * sn) * Math.max(0, -c);
    return (swingKnee + stanceKnee) * (moving ? 1 : 0) + (moving ? 0.05 : 0.055);
  };
  const kneeLT = kneeFor(ph);
  const kneeRT = kneeFor(ph + Math.PI);

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

  /* ——持物手：右手提公文包/纸袋、举手机、握扫帚时，右臂不该跟着走路大幅前后甩——
     持物时压低右臂摆幅、加大外张角（让道具避开大腿与胯部），并按道具类型改肘关节角。*/
  const holdPose = (u.app && u.app.extras && u.app.extras.holdPose) || null;
  let holdArmRT = 0, holdElbowRT = 0, holdSplayR = 0, holdArmAmpK = 1;
  if (holdPose === 'phone') {
    holdArmRT = -0.30; holdElbowRT = -1.16; holdSplayR = -0.12; holdArmAmpK = 0.16;
  } else if (holdPose === 'case' || holdPose === 'bag') {
    holdArmRT = -0.06; holdElbowRT = -0.05; holdSplayR = -0.22; holdArmAmpK = 0.22;
  } else if (holdPose === 'broom') {
    holdArmRT = -0.10; holdElbowRT = -0.26; holdSplayR = -0.26; holdArmAmpK = 0.20;
  }

  // --- 躯干：上下起伏 + 左右摇摆 + 肩髋反向扭转 + 前倾 ---
  const legLen = u.legLen || 0.53 * (u.height || 1.75);
  // 起伏交给髋部"接地补偿"产生（见下方 hipDrop），这里只保留极小的步伐余振
  const bobAmp = moving ? 0.004 * sn : 0;
  const bob = -bobAmp * Math.abs(sinL);
  const breatheY = moving ? 0 : Math.sin(u.breathe) * 0.0032;
  // torso 与双腿都挂在 root 上，站位高度基准均为 legLen（髋高）
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
  p.armR.rotation.x = damp(p.armR.rotation.x, armRT * holdArmAmpK + holdArmRT, lam, dt);
  if (p.elbowL) p.elbowL.rotation.x = damp(p.elbowL.rotation.x, elbowLT, lam, dt);
  if (p.elbowR) p.elbowR.rotation.x = damp(p.elbowR.rotation.x, elbowRT * holdArmAmpK + holdElbowRT, lam, dt);

  p.torso.rotation.x = damp(p.torso.rotation.x, leanT, 10, dt);
  p.torso.rotation.z = damp(p.torso.rotation.z, rollT, 12, dt);
  p.torso.rotation.y = damp(p.torso.rotation.y, twistT, 12, dt);
  p.head.rotation.y = damp(p.head.rotation.y, headT.y, 10, dt);
  p.head.rotation.x = damp(p.head.rotation.x, headT.x, 10, dt);

  // 手臂自然外张，避免与躯干穿插（持物侧额外外张，让公文包/纸袋/扫帚避开大腿）
  const splay = moving ? 0.085 : 0.065;
  p.armL.rotation.z = damp(p.armL.rotation.z, splay, 8, dt);
  p.armR.rotation.z = damp(p.armR.rotation.z, -splay + holdSplayR, 8, dt);

  // --- 髋部接地补偿：让支撑腿脚掌始终踩在地面上，避免"太空步"浮空 ---
  // 腿伸直时髋高 = 踝高 + 大腿 + 小腿；迈步时支撑腿垂直投影变短，髋部按同等量下沉，
  // 支撑脚贴地、摆动脚抬起，身体自然产生真人步行的上下起伏。
  const thighLen = rig.thighLen || legLen * 0.46;
  const shinLen = rig.shinLen || legLen * 0.46;
  const ankleH = rig.ankleH || 0;
  const reachOf = (t, k) => ankleH + thighLen * Math.cos(t) + shinLen * Math.cos(t + k);
  const reachL = reachOf(p.thighL.rotation.x, p.kneeL.rotation.x);
  const reachR = reachOf(p.thighR.rotation.x, p.kneeR.rotation.x);
  const hipDrop = moving ? Math.max(0, legLen - Math.max(reachL, reachR)) : 0;
  u.hipDrop = hipDrop;
  const hipY = legLen - hipDrop;
  p.thighL.position.y = hipY;
  if (p.thighR !== p.thighL) p.thighR.position.y = hipY;
  p.torso.position.y = damp(p.torso.position.y, torsoYT - hipDrop, 18, dt);

  u.moveSpeed = speed;
  u.moving = moving;
}

/** 死亡倒地姿态：向前扑倒并让四肢松开（game.js 死亡后仍会以 moveSpeed=0 调用动画）*/
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
