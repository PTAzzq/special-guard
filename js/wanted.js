/**
 * 通缉令头像渲染
 * 复用 character.js 的 buildCharacter —— 与场景 NPC 完全同一套模型与材质，
 * 保证通缉令上的人确实存在于本局人群外观体系中（不使用任何外部图片）。
 */
import * as THREE from 'three';
import { buildCharacter, describeFeatures } from './character.js';
import { USE_PORTRAIT_NPC } from './config.js';
import { renderPortraitBoard } from './pixelart.js';

let renderer = null;
let scene = null;
let cam = null;
let holder = null;
let bg = null;
const cache = new Map();

function keyOf(app) {
  return [app.look || 0, app.variant || 0,
    app.skin.c, app.upper.c, app.pants.c, app.hairStyle, app.hairColor,
    app.beard, app.hat, app.build.n, app.heightCm, app.glasses ? 1 : 0].join('|');
}

function ensure() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(320, 400);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f26);

  cam = new THREE.PerspectiveCamera(24, 320 / 400, 0.05, 12);

  holder = new THREE.Group();
  scene.add(holder);

  const amb = new THREE.AmbientLight(0xffffff, 1.15);
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  key.position.set(0.9, 1.9, 1.6);
  const fill = new THREE.DirectionalLight(0xa9c4e0, 0.9);
  fill.position.set(-1.6, 1.2, 1.0);
  const rim = new THREE.DirectionalLight(0xffd9a8, 0.8);
  rim.position.set(0, 1.0, -1.4);
  scene.add(amb, key, fill, rim);

  // 证件照背景（暖灰渐变）
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#3a4048');
  g.addColorStop(1, '#1c2026');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  bg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), new THREE.MeshBasicMaterial({ map: tex }));
  scene.add(bg);
}

/**
 * 渲染一名罪犯的正面头像
 * @returns {string} dataURL
 */
export function renderWantedAvatar(app) {
  // 立绘模式：直接合成同一张立绘的证件照，保证通缉令与场景内 NPC 完全一致
  if (USE_PORTRAIT_NPC && app && app.portrait) return renderPortraitBoard(app);

  const k = keyOf(app);
  if (cache.has(k)) return cache.get(k);

  ensure();
  // 清空旧模型
  for (let i = holder.children.length - 1; i >= 0; i--) {
    const ch = holder.children[i];
    holder.remove(ch);
    ch.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }

  const ch = buildCharacter(app);
  // 只取上半身：抬高相机对准头部，下方由背景板/画幅裁切。
  // 新骨骼里 head 挂在 torso 下，头顶世界高度要用「腿长 + 躯干高 + 颅球中心」换算，
  // 这样任意身高/体型的罪犯都能在 320x400 画幅里正脸居中。
  const headY = ch.userData.legLen + ch.userData.torsoH + 0.062 * ch.userData.height;
  holder.add(ch);

  cam.aspect = 320 / 400;
  // 3/4 侧脸，便于同时看清五官与体型/发型特征
  cam.position.set(0.30, headY + 0.07, 0.78);
  cam.lookAt(0, headY - 0.05, 0);
  cam.updateProjectionMatrix();

  bg.position.set(0, headY + 0.05, -0.55);

  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.92);

  holder.remove(ch);
  ch.traverse(o => { if (o.isMesh) o.geometry.dispose(); });

  cache.set(k, url);
  return url;
}

/** 通缉令条目数据 */
export function makeWantedEntry(app, index) {
  return {
    index,
    app,
    // 非 0 表示这一条目用的是像素立绘（UI 侧据此切换图片裁切方式）
    portrait: USE_PORTRAIT_NPC && app.portrait ? app.portrait : 0,
    avatar: renderWantedAvatar(app),
    features: describeFeatures(app)
  };
}
