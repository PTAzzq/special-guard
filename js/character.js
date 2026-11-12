/**
 * 人物系统
 * 关键要求：场景 NPC 与通缉令头像必须由同一套 buildCharacter 渲染，
 * 因此通缉令头像直接复用本模块（wanted.js 调用同一函数，只是换了相机与灯光）。
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

/** 生成一套随机外观参数（罪犯与平民共用同一分布） */
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
    // 身高：按体型略微偏移，整体落在 162~192cm
    const heightCm = Math.round(rand(rng, 162, 192));
    const glasses = rng() < 0.22;
    const app = {
      skin, upper, pants, hairStyle, hairColor, hairHex: HAIR_COLOR_HEX[hairColor],
      beard, hat, build, heightCm, glasses,
      buildIdx: BUILDS.indexOf(build),
      heightBucket: Math.floor((heightCm - 162) / 8)   // 0..3
    };
    // 避免与已有目标特征完全撞车（保证通缉令可唯一辨识）
    const clash = avoid.some(a =>
      a.upper.c === app.upper.c && a.hairStyle === app.hairStyle &&
      a.heightBucket === app.heightBucket && a.beard === app.beard
    );
    if (!clash) return app;
  }
  // 兜底：随机返回
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
  // 立绘模式下人物形象由图片决定，特征文案必须描述图片本身，否则玩家无法据此辨认
  if (app && app.portrait) return portraitFeatures(app);
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

/** 服装贴图（格子衬衫等）——使用少量差异化纹理增强写实感 */
function makeShirtTexture(baseHex, rng) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseHex; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 64; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(64, i); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- 几何合并：把同材质静态部件合并为单个 mesh，降低 draw call ---------- */
function mergeParts(parts, material, name) {
  const pos = [], nor = [], uv = [];
  for (const p of parts) {
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const g = src.clone();
    g.applyMatrix4(p.matrix);
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i++) pos.push(P[i]);
    const N = g.attributes.normal ? g.attributes.normal.array : null;
    if (N) for (let i = 0; i < N.length; i++) nor.push(N[i]);
    const U = g.attributes.uv ? g.attributes.uv.array : null;
    if (U) for (let i = 0; i < U.length; i++) uv.push(U[i]);
    g.dispose();
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
 * 构建写实比例人形（部件按关节分组并合并同材质几何，兼顾细节与开销）
 * @param {object} app 外观参数
 * @param {object} opts { avatar:boolean } avatar 模式不加入命中盒
 */
export function buildCharacter(app, opts = {}) {
  const h = app.heightCm / 100;
  const w = app.build.w;
  const root = new THREE.Group();
  root.name = 'character';

  const skinHex = app.skin.c;
  const skinMat = mat(skinHex, 0.62);
  const lipMat = mat(shadeHex(skinHex, 0.84), 0.52);
  const upperMat = mat(app.upper.c, 0.92);
  const upperDarkMat = mat(shadeHex(app.upper.c, 0.78), 0.94);
  const pantsMat = mat(app.pants.c, 0.94);
  const shoeMat = mat('#17171a', 0.55);
  const soleMat = mat('#0e0e10', 0.8);
  const hairMat = mat(app.hairHex, 0.78);
  const scleraMat = mat('#e8e6e2', 0.35);
  const irisMat = mat('#3a2a1e', 0.28);
  const pupilMat = mat('#0a0908', 0.25);
  const beardMat = mat(shadeHex(app.hairHex, 0.95), 0.86);
  const metalMat = mat('#8d8375', 0.35, 0.85);

  // ---- 尺寸参数（写实比例，约 7.2 头身） ----
  const legLen = 0.47 * h;
  const torsoH = 0.30 * h;
  const torsoW = 0.215 * h * w;
  const torsoD = 0.115 * h * w;
  const headR = 0.0665 * h;
  const headY = legLen + torsoH + 0.062 * h + headR * 0.95;
  const shoulderY = legLen + torsoH - 0.02 * h;

  const skinParts = [];      // 头部皮肤
  const hairParts = [];      // 头发/眉毛/胡须
  const detailParts = [];    // 眼部等近景细节

  /* ---------------- 头部 ---------------- */
  const head = new THREE.Group();
  head.position.y = headY;

  // 颅骨与面部体积
  skinParts.push(P(sph(headR, 19, 15), 0, 0, 0, 0.90, 1.08, 0.94));
  skinParts.push(P(sph(headR * 0.80, 18, 14), 0, -headR * 0.60, headR * 0.06, 1.00, 0.74, 0.96));   // 下颌
  skinParts.push(P(sph(headR * 0.30, 14, 12), headR * 0.55, -headR * 0.16, headR * 0.56, 1.0, 0.95, 1.02)); // 颧骨
  skinParts.push(P(sph(headR * 0.30, 14, 12), -headR * 0.55, -headR * 0.16, headR * 0.56, 1.0, 0.95, 1.02));
  skinParts.push(P(sph(headR * 0.28, 14, 10), 0, -headR * 0.90, headR * 0.36, 1.15, 0.62, 0.92));   // 下巴
  // 眉骨
  skinParts.push(P(sph(headR * 0.30, 14, 10), headR * 0.34, headR * 0.34, headR * 0.76, 1.18, 0.36, 0.60));
  skinParts.push(P(sph(headR * 0.30, 14, 10), -headR * 0.34, headR * 0.34, headR * 0.76, 1.18, 0.36, 0.60));
  // 鼻梁/鼻头/鼻翼
  skinParts.push(P(sph(headR * 0.125, 12, 10), 0, -headR * 0.02, headR * 0.92, 0.85, 2.15, 1.10));
  skinParts.push(P(sph(headR * 0.155, 14, 12), 0, -headR * 0.235, headR * 0.975, 1.05, 0.88, 1.05));
  skinParts.push(P(sph(headR * 0.10, 10, 8), headR * 0.14, -headR * 0.27, headR * 0.86, 1.0, 0.85, 0.9));
  skinParts.push(P(sph(headR * 0.10, 10, 8), -headR * 0.14, -headR * 0.27, headR * 0.86, 1.0, 0.85, 0.9));
  // 耳朵（耳廓 + 耳垂）
  for (const s of [1, -1]) {
    skinParts.push(P(tor(headR * 0.15, headR * 0.045, 8, 14), s * headR * 0.86, -headR * 0.06, -headR * 0.02, 1, 1.15, 1, 0, s * Math.PI * 0.5, 0));
    skinParts.push(P(sph(headR * 0.075, 10, 8), s * headR * 0.87, -headR * 0.19, -headR * 0.02, 1, 0.9, 0.7));
  }

  // 嘴唇
  detailParts.push(P(sph(headR * 0.26, 12, 8), 0, -headR * 0.44, headR * 0.83, 1.30, 0.30, 0.55)); // 上唇
  detailParts.push(P(sph(headR * 0.24, 12, 8), 0, -headR * 0.56, headR * 0.82, 1.25, 0.28, 0.55)); // 下唇

  // 眉毛
  for (const s of [1, -1]) {
    hairParts.push(P(box(headR * 0.38, headR * 0.085, headR * 0.09), s * headR * 0.33, headR * 0.305, headR * 1.005, 1, 1, 1, 0, 0, s * 0.16));
  }

  // 头部皮肤部件合并
  head.add(mergeParts(skinParts, skinMat, 'headSkin'));

  // 眼睛（白 + 虹膜 + 瞳孔）
  const eyeWhiteParts = [], irisPartsArr = [], pupilPartsArr = [];
  for (const s of [1, -1]) {
    eyeWhiteParts.push(P(sph(headR * 0.135, 10, 8), s * headR * 0.34, headR * 0.20, headR * 0.82, 1.05, 0.92, 0.55));
    irisPartsArr.push(P(sph(headR * 0.062, 10, 8), s * headR * 0.34, headR * 0.19, headR * 0.895, 1, 1, 0.45));
    pupilPartsArr.push(P(sph(headR * 0.030, 8, 6), s * headR * 0.34, headR * 0.19, headR * 0.925, 1, 1, 0.4));
  }
  const eyeGroup = new THREE.Group();
  eyeGroup.add(mergeParts(eyeWhiteParts, scleraMat, 'eyeWhite'));
  eyeGroup.add(mergeParts(irisPartsArr, irisMat, 'iris'));
  eyeGroup.add(mergeParts(pupilPartsArr, pupilMat, 'pupil'));
  head.add(eyeGroup);

  // 嘴唇
  const lipGroup = new THREE.Group();
  lipGroup.add(mergeParts(detailParts, lipMat, 'lips'));
  head.add(lipGroup);

  // ---- 头发 ----
  const style = app.hairStyle;
  if (style === '秃顶') {
    for (const s of [1, -1]) {
      hairParts.push(P(sph(headR * 0.34, 12, 10), s * headR * 0.80, -headR * 0.12, -headR * 0.10, 0.55, 1.5, 1.9));
    }
    hairParts.push(P(sph(headR * 0.7, 12, 8), 0, -headR * 0.30, -headR * 0.55, 1.05, 0.55, 0.65));
  } else if (style === '寸头') {
    hairParts.push(P(sph(headR * 0.98, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.295), 0, headR * 0.46, -headR * 0.02, 0.94, 0.62, 0.99));
  } else if (style === '背头') {
    hairParts.push(P(sph(headR * 1.03, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.37), 0, headR * 0.36, -headR * 0.03, 0.96, 0.98, 1.02));
    hairParts.push(P(sph(headR * 0.62, 14, 10), 0, headR * 0.78, headR * 0.52, 1.35, 0.42, 0.72));
  } else if (style === '中长发') {
    hairParts.push(P(sph(headR * 1.06, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.40), 0, headR * 0.30, -headR * 0.02, 0.98, 1.05, 1.02));
    hairParts.push(P(sph(headR * 0.86, 16, 12), 0, -headR * 0.28, -headR * 0.72, 1.15, 1.30, 0.55));
    for (const s of [1, -1]) hairParts.push(P(sph(headR * 0.30, 12, 10), s * headR * 0.86, -headR * 0.18, -headR * 0.18, 0.55, 1.7, 1.5));
  } else if (style === '马尾') {
    hairParts.push(P(sph(headR * 1.02, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.38), 0, headR * 0.33, -headR * 0.02, 0.99, 1.0, 1.0));
    hairParts.push(P(cap(headR * 0.20, headR * 0.95, 12), 0, -headR * 0.70, -headR * 1.02, 1, 1, 1, 0.28, 0, 0));
  } else if (style === '卷发') {
    hairParts.push(P(sph(headR * 1.04, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), 0, headR * 0.30, -headR * 0.02, 1, 1, 1));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      hairParts.push(P(sph(headR * 0.30, 12, 10),
        Math.cos(a) * headR * 0.70, headR * (0.48 + Math.sin(a * 2) * 0.16), Math.sin(a) * headR * 0.68));
    }
  } else {
    hairParts.push(P(sph(headR * 1.03, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.37), 0, headR * 0.34, -headR * 0.02, 0.97, 1.02, 1.0));
    for (const s of [1, -1]) hairParts.push(P(sph(headR * 0.26, 12, 10), s * headR * 0.84, -headR * 0.12, -headR * 0.12, 0.55, 1.5, 1.4));
  }

  // ---- 胡须 ----
  if (app.beard !== '无') {
    if (app.beard === '胡茬') {
      hairParts.push(P(sph(headR * 0.95, 18, 12, 0, Math.PI * 2, Math.PI * 0.50, Math.PI * 0.30), 0, -headR * 0.04, headR * 0.02, 0.93, 1.0, 0.96));
    } else if (app.beard === '络腮胡') {
      hairParts.push(P(sph(headR * 0.92, 18, 12, 0, Math.PI * 2, Math.PI * 0.54, Math.PI * 0.44), 0, 0, 0, 0.96, 1.05, 0.96));
      hairParts.push(P(sph(headR * 0.55, 14, 10), 0, -headR * 0.78, headR * 0.44, 1.35, 0.85, 0.75));
    } else {
      hairParts.push(P(sph(headR * 0.42, 14, 10), 0, -headR * 0.80, headR * 0.56, 1.0, 1.25, 0.6));
      hairParts.push(P(sph(headR * 0.40, 14, 10), 0, -headR * 0.33, headR * 0.82, 1.5, 0.30, 0.6));
    }
  }

  // 头发与眉毛合并
  head.add(mergeParts(hairParts, hairMat, 'hair'));

  // ---- 眼镜 ----
  if (app.glasses) {
    const frameMat = mat('#2b2b2b', 0.45, 0.5);
    const gParts = [];
    for (const s of [1, -1]) {
      gParts.push(P(tor(headR * 0.24, headR * 0.032, 6, 14), s * headR * 0.34, headR * 0.20, headR * 0.90, 1, 1, 1));
    }
    gParts.push(P(box(headR * 0.24, headR * 0.045, headR * 0.05), 0, headR * 0.20, headR * 0.92));
    for (const s of [1, -1]) gParts.push(P(box(headR * 0.06, headR * 0.04, headR * 0.55), s * headR * 0.80, headR * 0.16, headR * 0.60));
    head.add(mergeParts(gParts, frameMat, 'glasses'));
  }

  // ---- 帽子 ----
  if (app.hat !== '无') {
    const hatMat = mat(app.hat === '鸭舌帽' ? '#2f3640' : '#5a5445', 0.92);
    const hp = [];
    hp.push(P(cyl(headR * 1.00, headR * 1.06, headR * 0.64, 20), 0, headR * 0.80, 0, 1, 1, 1));
    hp.push(P(sph(headR * 0.98, 16, 10), 0, headR * 1.10, 0, 0.98, 0.55, 0.98));
    if (app.hat === '鸭舌帽') {
      hp.push(P(sph(headR * 0.95, 16, 10), 0, headR * 0.56, headR * 0.70, 1.35, 0.12, 1.05));
    } else {
      hp.push(P(cyl(headR * 1.62, headR * 1.62, headR * 0.075, 22), 0, headR * 0.52, 0, 1, 1, 1));
    }
    head.add(mergeParts(hp, hatMat, 'hat'));
  }

  // ---- 颈部 ----
  const neckParts = [
    P(cyl(0.0255 * h, 0.0365 * h, 0.092 * h, 14), 0, legLen + torsoH + 0.026 * h, 0, 1, 1, 1),
    P(sph(0.037 * h, 12, 10), 0, legLen + torsoH + 0.056 * h, 0, 1.12, 0.50, 1.0),   // 颈肩过渡
    P(sph(0.030 * h, 12, 10), 0, legLen + torsoH + 0.070 * h, 0, 1.05, 0.58, 1.0)    // 咽喉/下颌衔接
  ];
  root.add(mergeParts(neckParts, skinMat, 'neck'));

  /* ---------------- 躯干 ---------------- */
  const torso = new THREE.Group();
  torso.position.y = legLen;
  const upperParts = [];
  // 胸腔（椭圆截面）
  upperParts.push(P(cyl(torsoW * 0.50, torsoW * 0.455, torsoH * 0.64, 14), 0, torsoH * 0.66, 0, 1, 1, torsoD / torsoW));
  // 腹部
  upperParts.push(P(cyl(torsoW * 0.455, torsoW * 0.425, torsoH * 0.44, 14), 0, torsoH * 0.23, 0, 1, 1, torsoD / torsoW * 1.02));
  // 肩三角肌
  for (const s of [1, -1]) {
    upperParts.push(P(sph(torsoW * 0.345, 16, 12), s * torsoW * 0.455, torsoH * 0.895, 0, 1.06, 1.02, 1.0));
  }
  // 衣领
  upperParts.push(P(cyl(torsoW * 0.30, torsoW * 0.36, 0.024 * h, 14), 0, torsoH * 0.985, 0, 1, 1, torsoD / torsoW * 1.1));
  // 门襟 + 扣子
  upperParts.push(P(box(torsoW * 0.05, torsoH * 0.86, torsoD * 0.16), 0, torsoH * 0.52, torsoD * 0.52));
  torso.add(mergeParts(upperParts, upperMat, 'upper'));

  const btnParts = [];
  for (let i = 0; i < 4; i++) {
    btnParts.push(P(cyl(0.006 * h, 0.006 * h, 0.004 * h, 10), 0, torsoH * (0.78 - i * 0.17), torsoD * 0.58, 1, 1, 1, Math.PI * 0.5, 0, 0));
  }
  torso.add(mergeParts(btnParts, metalMat, 'buttons'));

  // 腰带 + 皮带扣
  const beltParts = [P(cyl(torsoW * 0.445, torsoW * 0.445, 0.030 * h, 14), 0, torsoH * 0.015, 0, 1, 1, torsoD / torsoW * 1.03)];
  torso.add(mergeParts(beltParts, mat('#1f1b18', 0.72), 'belt'));
  torso.add(mergeParts([P(box(0.030 * h, 0.022 * h, 0.010 * h), 0, torsoH * 0.015, torsoD * 0.46)], metalMat, 'buckle'));
  root.add(torso);

  /* ---------------- 手臂（pivot 在肩） ---------------- */
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const armLen = 0.30 * h;
  for (const [g, side] of [[armL, 1], [armR, -1]]) {
    g.position.set(side * (torsoW * 0.50 + 0.010 * h), shoulderY, 0);
    // 袖子（上臂 + 肘）
    const sleeveParts = [
      P(sph(0.033 * h * w, 14, 12), 0, -0.014 * h, 0, 1.06, 0.98, 1.04),               // 肩关节（覆盖接缝）
      P(cyl(0.036 * h * w, 0.030 * h * w, armLen * 0.56, 14), 0, -armLen * 0.27, 0, 1, 1, 1),
      P(sph(0.032 * h * w, 14, 10), 0, -armLen * 0.55, 0, 1, 0.92, 1)                  // 肘
    ];
    g.add(mergeParts(sleeveParts, upperMat, 'sleeve'));
    // 小臂 + 手掌 + 手指
    const skinArm = [
      P(cyl(0.028 * h * w, 0.021 * h * w, armLen * 0.50, 14), 0, -armLen * 0.79, 0, 1, 1, 1),
      P(sph(0.025 * h, 12, 10), 0, -armLen * 1.02, 0, 1.05, 0.85, 0.9),                 // 腕
      P(sph(0.024 * h, 14, 12), 0, -armLen * 1.12, 0.004 * h, 1.25, 1.35, 0.65),        // 手掌
    ];
    // 四指 + 拇指
    for (let i = 0; i < 4; i++) {
      skinArm.push(P(box(0.0095 * h, 0.030 * h, 0.011 * h), (i - 1.5) * 0.012 * h, -armLen * 1.27, 0.007 * h, 1, 1, 1, 0.12, 0, 0));
    }
    skinArm.push(P(box(0.011 * h, 0.024 * h, 0.012 * h), side * 0.026 * h, -armLen * 1.15, 0.012 * h, 1, 1, 1, 0, 0, side * -0.7));
    g.add(mergeParts(skinArm, skinMat, 'armSkin'));
    root.add(g);
  }

  /* ---------------- 腿 ---------------- */
  const legGroupL = new THREE.Group();
  const legGroupR = new THREE.Group();
  for (const [g, side] of [[legGroupL, 1], [legGroupR, -1]]) {
    g.position.set(side * 0.048 * h, legLen, 0);
    const pantsParts = [
      P(cyl(0.052 * h * w, 0.040 * h, legLen * 0.56, 16), 0, -legLen * 0.28, 0, 1, 1, 1),      // 大腿
      P(sph(0.040 * h, 14, 12), 0, -legLen * 0.55, 0, 1, 0.95, 1),                              // 膝
      P(cyl(0.038 * h, 0.026 * h, legLen * 0.46, 16), 0, -legLen * 0.78, 0, 1, 1, 1)            // 小腿
    ];
    g.add(mergeParts(pantsParts, pantsMat, 'pants'));
    const shoeParts = [
      P(box(0.052 * h * w, 0.020 * h, 0.135 * h), 0, -legLen + 0.010 * h, 0.024 * h, 1, 1, 1),   // 鞋底
      P(sph(0.028 * h, 14, 12), 0, -legLen + 0.032 * h, 0.062 * h, 1.6, 0.85, 1.5),              // 鞋头
      P(box(0.046 * h * w, 0.032 * h, 0.095 * h), 0, -legLen + 0.034 * h, 0.004 * h, 1, 1, 1),    // 鞋面
      P(sph(0.020 * h, 12, 10), 0, -legLen + 0.052 * h, -0.020 * h, 1.15, 1.05, 0.9)              // 鞋跟
    ];
    g.add(mergeParts(shoeParts, shoeMat, 'shoe'));
    g.add(mergeParts([P(box(0.054 * h * w, 0.006 * h, 0.138 * h), 0, -legLen + 0.001 * h, 0.024 * h, 1, 1, 1)], soleMat, 'sole'));
    root.add(g);
  }

  head.castShadow = true;
  root.add(head);

  root.userData.app = app;
  root.userData.parts = {
    head, torso, legL: legGroupL, legR: legGroupR, armL, armR,
    hairGroup: head, chest: torso, detail: [eyeGroup, lipGroup]
  };
  root.userData.height = h;
  // 标记"精细小件"：远处（>20m）隐藏，肉眼几乎无差，能显著降低远处人物的顶点开销
  const fine = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    if (/^(eyeWhite|iris|pupil|lips|buttons|buckle|sole)$/.test(o.name)) {
      o.userData.fine = true;
      fine.push(o);
    }
    o.castShadow = !o.userData.fine;
  });
  root.userData.fineMeshes = fine;
  root.userData.legLen = legLen;
  return root;
}

function shadeHex(hex, k) {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) * k));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) * k));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) * k));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

/** 给角色挂上射击命中盒（不可见，参与射线检测） */
export function attachHitboxes(root) {
  const h = root.userData.height;
  const app = root.userData.app;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.215 * h * app.build.w, 0.72 * h, 0.18 * h), hitMat);
  body.position.y = 0.50 * h;
  body.name = 'hitBody';

  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.16 * h, 0.16 * h, 0.16 * h), hitMat);
  // 3D 模型取头部 mesh 的高度；立绘（billboard）没有 parts，由 buildPortraitActor 给出 headY
  headBox.position.y = root.userData.parts
    ? root.userData.parts.head.position.y
    : (root.userData.headY || 0.885 * h);
  headBox.name = 'hitHead';

  root.add(body, headBox);
  root.userData.hitBody = body;
  root.userData.hitHead = headBox;
  return root;
}

/** 行走/呼吸动画 */
export function animateCharacter(root, dt, moveSpeed) {
  const p = root.userData.parts;
  if (!p) return;
  const u = root.userData;
  u.phase = (u.phase || 0) + dt * (moveSpeed > 0.2 ? 6.0 * Math.min(moveSpeed / 1.6, 1.6) : 0.8);
  const t = u.phase;
  const amp = moveSpeed > 0.2 ? Math.min(0.55, 0.28 + moveSpeed * 0.12) : 0.03;
  p.legL.rotation.x = Math.sin(t) * amp * (moveSpeed > 0.2 ? 1 : 0.15);
  p.legR.rotation.x = -Math.sin(t) * amp * (moveSpeed > 0.2 ? 1 : 0.15);
  p.armL.rotation.x = -Math.sin(t) * amp * 0.7;
  p.armR.rotation.x = Math.sin(t) * amp * 0.7;
  p.torso.position.y = (root.userData.legLen || 0) + Math.abs(Math.sin(t)) * (moveSpeed > 0.2 ? 0.012 : 0.004);
  p.head.rotation.y = Math.sin(t * 0.35) * 0.06;
}
