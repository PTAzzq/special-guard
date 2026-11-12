/**
 * 写实像素立绘 NPC（billboard 人物渲染）
 * ---------------------------------------------------------------------------
 * 作用：把 NPC 的可见外观从 character.js 的 3D 人形模型换成
 *       assets/portraits/npc01..06.png 这套写实像素立绘，
 *       以 billboard（始终朝向玩家、按相对朝向左右镜像）方式绘制。
 *
 * 设计约束（与全局需求一一对应）：
 *  1. 只替换"可见外观"。命中盒仍由 character.js 的 attachHitboxes 挂在同一个
 *     Group 上（hitBody / hitHead 不可见 mesh），3D 坐标、AI 走动、卡墙规避、
 *     罪犯/平民判定与误杀判负逻辑全部沿用，不因换皮而改变。
 *  2. 通缉令复用同一张立绘（renderPortraitBoard 合成证件照），保证通缉令上的
 *     人确实存在于本局人群中（立绘编号 + 配色变体 + 身高 三重可判别特征）。
 *  3. 原 3D 模型构建代码（buildCharacter）完全保留，由 config.js 的 NPC_STYLE
 *     开关一键切回。
 *
 * 颜色变体：6 张立绘对一关几十个 NPC 必然大量重复，因此每张立绘派生 3 套轻微
 *          色调变体（原色 / 偏暖 / 偏冷），共 18 种组合，既能保证"风格统一"，
 *          又能让罪犯拥有全场唯一的"立绘+配色"组合用于辨认。
 */

import * as THREE from 'three';

const BASE_DIR = 'assets/portraits/';

const FILES = [
  'npc01.png', 'npc02.png', 'npc03.png', 'npc04.png', 'npc05.png', 'npc06.png'
];

export const PORTRAIT_COUNT = FILES.length;

/** 每张立绘的固有识别特征（通缉令用文字描述，必须与图片内容一致） */
export const PORTRAIT_INFO = [
  { name: '西装男', detail: '深蓝西装外套＋浅蓝衬衫、深色西裤、黑色短发，手持棕色公文包' },
  { name: '白领女', detail: '黑色西装外套＋白衬衫、灰色半身裙、黑色盘发，手持手机' },
  { name: '连帽头盔男', detail: '深灰连帽卫衣套装、深灰头盔，双手空置' },
  { name: '蓝夹克男', detail: '蓝色工装外套＋灰色圆领衫、深色长裤、灰色短发，手拎棕色纸袋' },
  { name: '工装男', detail: '橙色反光条工装外套、深色长裤、灰色短发，手持扫帚' },
  { name: '背包青年', detail: '深蓝连帽卫衣＋蓝色牛仔裤、黑色短发戴头戴式耳机，肩背黑色双肩包' }
];

/** 配色变体：轻微色调偏移，保持写实像素风统一 */
const VARIANT_FILTERS = [
  'none',
  'brightness(1.06) saturate(0.96) hue-rotate(9deg)',
  'brightness(0.9) saturate(1.06) hue-rotate(-11deg)'
];
export const PORTRAIT_VARIANTS = VARIANT_FILTERS.length;

const VARIANT_NAMES = ['原色', '暖调', '冷调'];

/* -------------------------------------------------------------------------- *
 * 资源加载
 * -------------------------------------------------------------------------- */
const rawImages = new Map();     // idx(1..6) -> HTMLImageElement（原图）
const canvasCache = new Map();   // `${idx}:${variant}` -> HTMLCanvasElement（变体图）
const texCache = new Map();      // `${idx}:${variant}` -> THREE.Texture
let loadingPromise = null;

export function normalizePortrait(idx) {
  const n = Math.round(Number(idx) || 1);
  return ((n - 1) % PORTRAIT_COUNT + PORTRAIT_COUNT) % PORTRAIT_COUNT + 1;
}

export function normalizeVariant(v) {
  const n = Math.round(Number(v) || 0);
  return ((n % PORTRAIT_VARIANTS) + PORTRAIT_VARIANTS) % PORTRAIT_VARIANTS;
}

export function portraitUrl(idx) {
  return BASE_DIR + FILES[normalizePortrait(idx) - 1];
}

/** 立绘宽高比（未加载时给一个安全默认值） */
export function portraitAspect(idx) {
  const img = rawImages.get(normalizePortrait(idx));
  return img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.42;
}

function makeVariantCanvas(img, variant) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  const f = VARIANT_FILTERS[variant];
  if (f && f !== 'none' && 'filter' in ctx) ctx.filter = f;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  return c;
}

/**
 * 预加载 6 张立绘并派生配色变体。
 * 必须在进入关卡前完成（通缉令头像是同步合成的 dataURL）。
 */
export function preloadPortraits() {
  if (loadingPromise) return loadingPromise;
  const jobs = [];
  for (let i = 1; i <= PORTRAIT_COUNT; i++) {
    jobs.push(new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        rawImages.set(i, img);
        for (let v = 0; v < PORTRAIT_VARIANTS; v++) {
          try {
            canvasCache.set(i + ':' + v, makeVariantCanvas(img, v));
          } catch (e) {
            console.warn('[portrait] 变体生成失败', i, v, e);
          }
        }
        resolve(img);
      };
      img.onerror = () => {
        console.warn('[portrait] 立绘加载失败：' + portraitUrl(i));
        resolve(null);
      };
      img.src = portraitUrl(i);
    }));
  }
  loadingPromise = Promise.all(jobs);
  return loadingPromise;
}

export function portraitsReady() {
  return rawImages.size === PORTRAIT_COUNT;
}

function getCanvas(idx, variant) {
  const key = normalizePortrait(idx) + ':' + normalizeVariant(variant);
  return canvasCache.get(key) || null;
}

function getTexture(idx, variant) {
  const key = normalizePortrait(idx) + ':' + normalizeVariant(variant);
  if (texCache.has(key)) return texCache.get(key);
  const canvas = canvasCache.get(key);
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  // 放大用最近邻保住像素颗粒；缩小用 mipmap+线性，避免远处闪烁
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/* -------------------------------------------------------------------------- *
 * 接地阴影贴片（立绘是平片，没有实体投影，用一张软阴影保住"站在地上"的观感）
 * -------------------------------------------------------------------------- */
let blobTex = null;
function getBlobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

/* -------------------------------------------------------------------------- *
 * 构建 billboard 人物
 * -------------------------------------------------------------------------- */
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const BLOB_QUAT = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);

const _qGroup = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _right = new THREE.Vector3();

/**
 * 用立绘构建一个 NPC 的根节点。
 * 返回结构与 buildCharacter 保持一致（Group + userData.app/height），
 * 因此 attachHitboxes / 命中判定 / AI 全部可直接复用。
 * @param {object} app randomAppearance 生成的外观对象（需带 portrait / variant）
 */
export function buildPortraitActor(app) {
  const root = new THREE.Group();
  root.name = 'character';

  const h = app.heightCm / 100;
  const idx = normalizePortrait(app.portrait);
  const variant = normalizeVariant(app.variant);
  const asp = portraitAspect(idx);
  const width = h * asp;

  const tex = getTexture(idx, variant);
  const mat = new THREE.MeshBasicMaterial({
    map: tex || null,
    color: tex ? 0xffffff : 0x8f9aa8,
    // 立绘是抠好的透明 PNG：开 alphaTest 走不透明通道，既保住像素硬边，
    // 又避免透明排序把远处人物画到近处人物之上
    transparent: false,
    alphaTest: 0.34,
    depthWrite: true,
    // 镜像靠 scale.x = -1 实现，必须双面，否则负缩放会翻转绕序被背面剔除
    side: THREE.DoubleSide,
    // 立绘是"自带光照"的绘画素材，不参与场景光照/色调映射，保证与通缉令一致
    toneMapped: false
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.name = 'portrait';
  plane.scale.set(width, h, 1);
  plane.position.set(0, h * 0.5, 0);
  plane.userData.noShadow = true;
  plane.renderOrder = 0;
  root.add(plane);

  // 接地阴影
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52 * h * app.build.w, 0.30 * h),
    new THREE.MeshBasicMaterial({
      map: getBlobTexture(), transparent: true, depthWrite: false,
      toneMapped: false, opacity: 0.9
    })
  );
  blob.name = 'portraitShadow';
  blob.position.set(0, 0.014, 0);
  blob.userData.noShadow = true;
  blob.renderOrder = -1;
  root.add(blob);

  // 与 buildCharacter 对齐的 userData 契约
  root.userData = {
    app,
    height: h,
    // 立绘没有 parts，头部命中盒中心由此给出；与 3D 版头部位置基本一致
    headY: h * 0.885,
    billboard: true,
    portrait: idx,
    variant,
    plane,
    blob,
    baseWidth: width,
    baseY: h * 0.5,
    mirror: 1,
    roll: 0,
    phase: Math.random() * Math.PI * 2,
    fineMeshes: []
  };

  return root;
}

/**
 * 行走/待机：用上下起伏 + 轻微倾斜替代原来的骨骼步态。
 * 参数签名与 animateCharacter(root, dt, moveSpeed) 完全一致，调用处可直接互换。
 */
export function animatePortraitActor(root, dt, moveSpeed) {
  const u = root.userData;
  if (!u || !u.plane) return;
  const walking = moveSpeed > 0.2;
  u.phase += dt * (walking ? 5.4 * Math.min(moveSpeed / 1.5, 1.7) : 0.9);
  const bob = walking
    ? (0.014 + Math.min(0.014, moveSpeed * 0.007)) * Math.abs(Math.sin(u.phase))
    : 0.004 * Math.sin(u.phase * 0.8);
  u.plane.position.y = u.baseY + bob;
  u.roll = (walking ? 0.038 : 0.012) * Math.sin(u.phase);
}

/**
 * billboard 朝向与镜像。每帧在渲染前调用。
 * 目标世界朝向 = 倒地倾角(group.rotation.x) × 绕 Y 轴对准相机，
 * 再乘上局部 roll，得到"始终正脸看玩家、走路带轻微摇摆"的观感。
 */
export function updatePortraitFacing(root, camera) {
  const u = root.userData;
  if (!u || !u.plane) return;

  const p = root.position;
  const dx = camera.position.x - p.x;
  const dz = camera.position.z - p.z;
  if (dx * dx + dz * dz < 1e-8) return;

  // ---- 镜像：NPC 朝向与相机右向量的点积决定（±0.12 滞回，避免正对时抖动）----
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0;
  const rl = Math.hypot(_right.x, _right.z);
  if (rl > 1e-6) {
    _right.x /= rl; _right.z /= rl;
    const fx = Math.sin(root.rotation.y), fz = Math.cos(root.rotation.y);
    const dot = fx * _right.x + fz * _right.z;
    if (dot > 0.12) u.mirror = 1;
    else if (dot < -0.12) u.mirror = -1;
  }
  const sx = u.baseWidth * u.mirror;
  if (u.plane.scale.x !== sx) u.plane.scale.x = sx;

  // ---- 朝向 ----
  _qGroup.copy(root.quaternion);                 // NPC 根节点世界旋转（父级为 scene）
  _euler.setFromQuaternion(_qGroup, 'YXZ');
  _qTilt.setFromAxisAngle(X_AXIS, _euler.x);     // 只取倒地倾角，Y 由下面重算
  _qYaw.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz));
  _qRoll.setFromAxisAngle(Z_AXIS, u.roll || 0);

  _qInv.copy(_qGroup).invert();
  u.plane.quaternion.copy(_qInv).multiply(_qTilt).multiply(_qYaw).multiply(_qRoll);

  // 阴影贴片始终保持水平躺在地上（抵消根节点的倒地旋转）
  if (u.blob) {
    u.blob.position.set(0, 0.014, 0);
    u.blob.quaternion.copy(_qInv).multiply(BLOB_QUAT);
  }
}

/* -------------------------------------------------------------------------- *
 * 通缉令：把同一张立绘合成证件照
 * -------------------------------------------------------------------------- */
const boardCache = new Map();

/**
 * 合成通缉令头像（与场景内 NPC 同一立绘 + 同一配色变体）。
 * @returns {string} JPEG dataURL
 */
export function renderPortraitBoard(app) {
  const idx = normalizePortrait(app.portrait);
  const variant = normalizeVariant(app.variant);
  const key = idx + ':' + variant + ':' + app.heightCm;
  if (boardCache.has(key)) return boardCache.get(key);

  const W = 320, H = 400;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // 背景与 wanted.js 的 3D 证件照保持同一套暖灰渐变，观感统一
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3a4048');
  g.addColorStop(1, '#1c2026');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 底部标尺线（身高参照），呼应"身高约 xx cm"这条特征
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let y = 40; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(y % 80 === 0 ? 16 : 8, y);
    ctx.stroke();
  }

  const src = getCanvas(idx, variant) || rawImages.get(idx);
  if (src) {
    const sw = src.naturalWidth || src.width;
    const sh = src.naturalHeight || src.height;
    // contain：整身立绘，按高度 92% 居中，底部留 4% 边距
    const scale = Math.min((H * 0.92) / sh, (W * 0.94) / sw);
    const w = sw * scale, hh = sh * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, (W - w) / 2, H - H * 0.04 - hh, w, hh);
  }

  // 轻微暗角 + 顶部提亮，接近原证件照的布光
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.2, W / 2, H * 0.5, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const url = c.toDataURL('image/jpeg', 0.92);
  boardCache.set(key, url);
  return url;
}

/* -------------------------------------------------------------------------- *
 * 通缉令特征文案
 * -------------------------------------------------------------------------- */
export function portraitFeatures(app) {
  const info = PORTRAIT_INFO[normalizePortrait(app.portrait) - 1];
  const list = [];
  list.push(`身高约 ${app.heightCm} cm`);
  list.push(`${app.build.n}体型`);
  list.push(`外形：${info.name}`);
  list.push(`衣着：${info.detail}`);
  list.push(`配色：${VARIANT_NAMES[normalizeVariant(app.variant)]}`);
  return list;
}

/* -------------------------------------------------------------------------- *
 * 立绘组合分配：罪犯拿到全场唯一组合，平民从剩余组合里轮转
 * -------------------------------------------------------------------------- */
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * 给一关的全部人物分配「立绘编号 + 配色变体」。
 * 约定：罪犯的组合在全场唯一（不与任何其他人重复），平民只从剩余组合里取，
 * 这样玩家可以只凭"形象+配色"锁定目标，误杀判负逻辑依然公平。
 */
export function assignPortraitLooks(criminalApps, civilApps, rng) {
  const combos = [];
  for (let p = 1; p <= PORTRAIT_COUNT; p++) {
    for (let v = 0; v < PORTRAIT_VARIANTS; v++) combos.push({ portrait: p, variant: v });
  }
  shuffle(combos, rng);

  // 罪犯优先占满不同立绘：一关最多 5 名罪犯而共有 6 张立绘，
  // 因此同关通缉目标形象两两不同，玩家根据画风即可区分，不会出现"两张通缉令长得一样"。
  const portraitOrder = shuffle([...Array(PORTRAIT_COUNT)].map((_, i) => i + 1), rng);
  const used = new Set();
  criminalApps.forEach((app, i) => {
    let pick = null;
    if (i < portraitOrder.length) {
      const p = portraitOrder[i];
      // 该立绘下挑一个尚未占用的配色
      const cand = combos.filter(c => c.portrait === p && !used.has(c.portrait + ':' + c.variant));
      pick = cand[0] || { portrait: p, variant: i % PORTRAIT_VARIANTS };
    } else {
      pick = combos.find(c => !used.has(c.portrait + ':' + c.variant)) || combos[i % combos.length];
    }
    app.portrait = pick.portrait;
    app.variant = pick.variant;
    used.add(pick.portrait + ':' + pick.variant);
  });

  let free = combos.filter(c => !used.has(c.portrait + ':' + c.variant));
  if (!free.length) free = combos.slice();
  shuffle(free, rng);
  civilApps.forEach((app, i) => {
    const c = free[i % free.length];
    app.portrait = c.portrait;
    app.variant = c.variant;
  });
}
