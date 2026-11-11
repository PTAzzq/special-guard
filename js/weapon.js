/**
 * 第一人称武器视图：枪械模型 + 双臂 + 后坐 / 换弹 / 开镜动画
 * 独立的 weaponScene + weaponCamera，避免枪模型与场景墙体穿插。
 */
import * as THREE from 'three';
import { damp, clamp, texSoftDot } from './utils.js';

const MAT = {
  metalDark: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.42, metalness: 0.72 }),
  metalBlack: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.35, metalness: 0.8 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.78, metalness: 0.08 }),
  polymerTan: new THREE.MeshStandardMaterial({ color: 0x6b6047, roughness: 0.85, metalness: 0.05 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.72, metalness: 0.03 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x14202b, roughness: 0.1, metalness: 0.9 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.92, metalness: 0.02 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x353b32, roughness: 0.95, metalness: 0.02 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc79a72, roughness: 0.7, metalness: 0.0 })
};

const HIP_POS = new THREE.Vector3(0.165, -0.175, -0.40);
const HIP_ROT = new THREE.Euler(0.02, 0.08, 0.015);

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(r1, r2, len, m, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), m);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** 依据武器定义构建枪模型（枪口朝 -Z，握把参考点在原点） */
export function buildWeaponModel(def) {
  const g = new THREE.Group();
  const cfg = def.model;
  const W = cfg.bodyW;
  const L = cfg.len;
  let sightY = W * 0.85;
  let magGroup = null;

  if (cfg.kind === 'pistol' || cfg.kind === 'revolver') {
    const slideLen = L * 0.78;
    // 套筒
    g.add(box(W, W * 0.92, slideLen, MAT.metalDark, 0, 0.012, -slideLen * 0.42));
    // 枪管前端
    if (cfg.kind === 'revolver') {
      const barrel = cyl(W * 0.26, W * 0.26, L * 0.42, MAT.metalBlack);
      barrel.position.set(0, 0.012, -slideLen * 0.86);
      g.add(barrel);
      // 转轮
      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.5, W * 0.5, W * 0.95, 12), MAT.metalBlack);
      cylinder.position.set(0, 0.008, -slideLen * 0.28);
      g.add(cylinder);
      sightY = 0.012 + W * 0.46;
    } else {
      const barrel = cyl(W * 0.24, W * 0.24, L * 0.16, MAT.metalBlack);
      barrel.position.set(0, 0.012, -slideLen * 0.9);
      g.add(barrel);
      sightY = 0.012 + W * 0.46;
    }
    // 握把
    const grip = box(W * 0.88, L * 0.36, W * 0.92, MAT.polymer, 0, -L * 0.19, L * 0.05);
    grip.rotation.x = -0.16;
    g.add(grip);
    // 握把底 / 弹匣
    magGroup = new THREE.Group();
    magGroup.position.set(0, -L * 0.19, L * 0.05);
    magGroup.rotation.x = -0.16;
    const mag = box(W * 0.8, L * 0.30, W * 0.85, MAT.metalBlack, 0, -L * 0.02, 0);
    magGroup.add(mag);
    g.add(magGroup);
    // 扳机护圈
    const guard = box(W * 0.55, W * 0.12, W * 0.9, MAT.polymer, 0, -L * 0.10, -L * 0.06);
    g.add(guard);
    // 照门 / 准星
    g.add(box(W * 0.55, W * 0.16, W * 0.16, MAT.metalBlack, 0, sightY - 0.004, -slideLen * 0.82));
    g.add(box(W * 0.5, W * 0.14, W * 0.14, MAT.metalBlack, 0, sightY - 0.004, -slideLen * 0.05));
  } else if (cfg.kind === 'rifle') {
    const bodyMat = cfg.wood ? MAT.wood : MAT.polymer;
    // 机匣
    g.add(box(W * 1.05, W * 1.0, L * 0.36, MAT.metalDark, 0, 0.015, -L * 0.28));
    if (cfg.bullpup) {
      // 无托：机匣与枪托一体
      g.add(box(W * 1.0, W * 1.15, L * 0.30, bodyMat, 0, 0.005, L * 0.05));
      // 提把 / 光瞄
      g.add(box(W * 0.6, W * 0.5, L * 0.22, MAT.metalBlack, 0, 0.015 + W * 0.72, -L * 0.12));
      sightY = 0.015 + W * 1.02;
    } else {
      // 枪托
      if (cfg.stock) {
        g.add(box(W * 0.85, W * 0.95, L * 0.24, bodyMat, 0, 0.0, L * 0.10));
        g.add(box(W * 0.9, W * 1.15, W * 0.6, bodyMat, 0, -0.005, L * 0.20));
      }
      // 光学瞄具
      const scopeBase = box(W * 0.42, W * 0.42, L * 0.20, MAT.metalBlack, 0, 0.015 + W * 0.68, -L * 0.30);
      g.add(scopeBase);
      sightY = 0.015 + W * 0.90;
    }
    // 护木
    g.add(box(W * 0.92, W * 0.86, L * 0.26, bodyMat, 0, 0.012, -L * 0.55));
    // 枪管
    const barrel = cyl(W * 0.18, W * 0.18, L * 0.30, MAT.metalBlack);
    barrel.position.set(0, 0.02, -L * 0.78);
    g.add(barrel);
    // 准星
    g.add(box(W * 0.16, W * 0.42, W * 0.16, MAT.metalBlack, 0, 0.02 + W * 0.5, -L * 0.66));
    // 握把
    const grip = box(W * 0.78, L * 0.22, W * 0.8, MAT.polymer, 0, -L * 0.13, -L * 0.12);
    grip.rotation.x = -0.30;
    g.add(grip);
    // 弹匣
    magGroup = new THREE.Group();
    magGroup.position.set(0, -L * 0.11, -L * 0.32);
    const mag = box(W * 0.72, L * 0.20, W * 0.9, MAT.metalDark, 0, -L * 0.09, 0);
    mag.rotation.x = 0.12;
    magGroup.add(mag);
    g.add(magGroup);
    // 扳机护圈
    g.add(box(W * 0.5, W * 0.14, W * 0.75, MAT.polymer, 0, -L * 0.065, -L * 0.20));
  } else { // sniper
    const bodyMat = cfg.wood ? MAT.wood : MAT.polymerTan;
    // 机匣
    g.add(box(W * 1.0, W * 1.0, L * 0.34, MAT.metalDark, 0, 0.012, -L * 0.26));
    // 枪托（较长）
    g.add(box(W * 0.85, W * 1.05, L * 0.30, bodyMat, 0, -0.005, L * 0.10));
    g.add(box(W * 0.95, W * 1.3, W * 0.7, bodyMat, 0, -0.005, L * 0.23));
    // 护木
    g.add(box(W * 0.85, W * 0.8, L * 0.26, bodyMat, 0, 0.008, -L * 0.52));
    // 长枪管
    const barrel = cyl(W * 0.16, W * 0.16, L * 0.36, MAT.metalBlack);
    barrel.position.set(0, 0.018, -L * 0.80);
    g.add(barrel);
    if (cfg.muzzleBrake) {
      const brake = box(W * 0.42, W * 0.36, W * 0.55, MAT.metalBlack, 0, 0.018, -L * 0.97);
      g.add(brake);
    }
    // 瞄准镜
    const scopeLen = cfg.scope || 0.32;
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.42, W * 0.42, scopeLen, 14), MAT.metalBlack);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.012 + W * 0.95, -L * 0.30);
    g.add(scope);
    // 镜片
    const lens = new THREE.Mesh(new THREE.CircleGeometry(W * 0.36, 16), MAT.glass);
    lens.position.set(0, 0.012 + W * 0.95, -L * 0.30 - scopeLen / 2 - 0.001);
    lens.rotation.y = Math.PI;
    g.add(lens);
    // 镜架
    for (const dz of [-scopeLen * 0.3, scopeLen * 0.3]) {
      g.add(box(W * 0.3, W * 0.55, W * 0.22, MAT.metalBlack, 0, 0.012 + W * 0.5, -L * 0.30 + dz));
    }
    sightY = 0.012 + W * 0.95;
    // 握把
    const grip = box(W * 0.75, L * 0.20, W * 0.78, MAT.polymer, 0, -L * 0.11, -L * 0.10);
    grip.rotation.x = -0.28;
    g.add(grip);
    // 弹匣
    magGroup = new THREE.Group();
    magGroup.position.set(0, -L * 0.09, -L * 0.28);
    magGroup.add(box(W * 0.7, L * 0.14, W * 0.85, MAT.metalDark, 0, -L * 0.06, 0));
    g.add(magGroup);
    // 扳机
    g.add(box(W * 0.45, W * 0.12, W * 0.7, MAT.polymer, 0, -L * 0.055, -L * 0.18));
    // 两脚架（简化）
    for (const s of [1, -1]) {
      const leg = box(W * 0.1, L * 0.16, W * 0.1, MAT.metalBlack, s * W * 0.35, -L * 0.10, -L * 0.68);
      leg.rotation.z = s * 0.3;
      g.add(leg);
    }
  }

  // 枪口位置
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -L * (cfg.kind === 'pistol' || cfg.kind === 'revolver' ? 0.95 : cfg.kind === 'rifle' ? 0.94 : 0.99));
  g.add(muzzle);

  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    group: g, mag: magGroup, muzzle, sightY, cfg,
    magBaseY: magGroup ? magGroup.position.y : 0
  };
}

/** 手臂（前臂 + 手），从屏幕外侧伸向握持点 */
function buildArm(side) {
  const arm = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.34, 10), MAT.sleeve);
  fore.rotation.x = Math.PI / 2;
  fore.position.set(side * 0.03, 0.015, 0.19);
  fore.rotation.z = side * -0.12;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.075, 0.085), MAT.glove);
  hand.position.set(side * 0.008, 0.0, 0.015);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.05), MAT.glove);
  thumb.position.set(side * -0.03, 0.022, 0.005);
  thumb.rotation.z = side * 0.4;
  arm.add(fore, hand, thumb);
  return arm;
}

export class WeaponView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 12);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // 光照：暖色主光 + 冷色补光，模拟户外/室内混合环境
    const amb = new THREE.AmbientLight(0xffffff, 1.35);
    const key = new THREE.DirectionalLight(0xfff0dd, 2.1);
    key.position.set(0.9, 1.4, 0.9);
    const fill = new THREE.DirectionalLight(0x9fb4cc, 0.85);
    fill.position.set(-1.2, 0.2, 0.6);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.6);
    rim.position.set(-0.4, -0.6, -0.8);
    this.scene.add(amb, key, fill, rim);

    this.armR = buildArm(1);
    this.armL = buildArm(-1);
    this.root.add(this.armR, this.armL);

    this.hold = new THREE.Group();      // 枪体容器
    this.root.add(this.hold);

    this.def = null;
    this.model = null;
    this.sightY = 0.03;
    this.recoil = 0;         // 0..1
    this.recoilRot = 0;
    this.reloadT = -1;
    this.swayX = 0; this.swayY = 0;
    this.bobT = 0;
    this.flashT = 0;

    // 枪口火光
    const flashTex = texSoftDot();
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, color: 0xffdd99, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.scale.set(0.28, 0.28, 0.28);
    this.hold.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffcc77, 0, 1.2, 2);
    this.hold.add(this.flashLight);
  }

  setWeapon(def) {
    if (this.model) {
      this.hold.remove(this.model.group);
      this.model.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.def = def;
    this.model = buildWeaponModel(def);
    this.sightY = this.model.sightY;
    this.hold.add(this.model.group);
    this.flash.position.copy(this.model.muzzle.position);
    this.flashLight.position.copy(this.model.muzzle.position);
    this.reloadT = -1;
    this.recoil = 0;

    // 手部位置按枪种调整
    const kind = def.model.kind;
    if (kind === 'pistol' || kind === 'revolver') {
      this.armR.position.set(0.035, -def.model.len * 0.20, def.model.len * 0.04);
      this.armR.rotation.set(0.15, 0.12, 0);
      this.armL.position.set(-0.035, -def.model.len * 0.22, def.model.len * 0.02);
      this.armL.rotation.set(0.2, -0.35, 0.2);
    } else if (kind === 'rifle') {
      this.armR.position.set(0.03, -def.model.len * 0.14, -def.model.len * 0.12);
      this.armR.rotation.set(0.1, 0.1, 0);
      this.armL.position.set(-0.03, def.model.len * 0.02, -def.model.len * 0.56);
      this.armL.rotation.set(-0.15, 0.3, -0.25);
    } else {
      this.armR.position.set(0.03, -def.model.len * 0.11, -def.model.len * 0.10);
      this.armR.rotation.set(0.1, 0.1, 0);
      this.armL.position.set(-0.03, def.model.len * 0.015, -def.model.len * 0.52);
      this.armL.rotation.set(-0.2, 0.3, -0.22);
    }
  }

  fire() {
    this.recoil = Math.min(1, this.recoil + 0.65 + (this.def ? this.def.recoil * 0.06 : 0.1));
    this.recoilRot = Math.min(0.5, this.recoilRot + 0.06 + (this.def ? this.def.recoil * 0.012 : 0.02));
    this.flashT = 0.055;
    this.flashMat.opacity = 1;
    this.flashLight.intensity = 6;
    this.flash.material.rotation = Math.random() * Math.PI;
    const sc = 0.2 + Math.random() * 0.16;
    this.flash.scale.set(sc, sc, sc);
  }

  startReload() { this.reloadT = 0; }

  /**
   * @param {number} dt
   * @param {object} s { adsT 0..1, moving, sprint, lookDX, lookDY }
   */
  update(dt, s) {
    const ads = clamp(s.adsT, 0, 1);
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.recoilRot = damp(this.recoilRot, 0, 7, dt);
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.35, -0.05, 0.05), 8, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.25, -0.04, 0.04), 8, dt);

    // 行走摆动
    if (s.moving) this.bobT += dt * (s.sprint ? 11 : 7.5);
    else this.bobT += dt * 1.6;
    const bobAmp = (s.moving ? (s.sprint ? 0.022 : 0.013) : 0.0025) * (1 - ads * 0.65);
    const bobX = Math.sin(this.bobT) * bobAmp;
    const bobY = Math.abs(Math.cos(this.bobT)) * bobAmp * 0.8;

    // 基础位姿
    let px = HIP_POS.x + bobX;
    let py = HIP_POS.y + bobY;
    let pz = HIP_POS.z;
    let rx = HIP_ROT.x, ry = HIP_ROT.y, rz = HIP_ROT.z;

    // 开镜位姿：让瞄准线（或瞄具）落在屏幕中心
    const adsX = 0;
    const adsY = -this.sightY - 0.005;
    const adsZ = -0.30;
    px = px + (adsX - px) * ads;
    py = py + (adsY - py) * ads;
    pz = pz + (adsZ - pz) * ads;
    rx = rx * (1 - ads);
    ry = ry * (1 - ads);
    rz = rz * (1 - ads);

    // 后坐
    pz += this.recoil * 0.075;
    py += this.recoilRot * 0.05;
    rx -= this.recoilRot * 1.0;

    // 换弹动画
    if (this.reloadT >= 0) {
      const rt = this.reloadT;
      const dip = Math.sin(Math.min(1, rt) * Math.PI);      // 0→1→0
      rz += dip * 0.55;
      rx += dip * 0.28;
      py -= dip * 0.10;
      pz += dip * 0.02;
      if (this.model && this.model.mag) {
        const magDrop = rt < 0.5 ? Math.min(1, rt / 0.32) : Math.max(0, 1 - (rt - 0.5) / 0.25);
        this.model.mag.position.y = (this.model.magBaseY !== undefined ? this.model.magBaseY : 0) - magDrop * 0.16;
      }
    } else if (this.model && this.model.mag) {
      this.model.mag.position.y = this.model.magBaseY !== undefined ? this.model.magBaseY : 0;
    }

    // 摆动叠加
    px += this.swayX * (1 - ads * 0.7);
    py += this.swayY * (1 - ads * 0.7);

    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);

    // 枪口火光衰减
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 90);
      this.flashMat.opacity = Math.max(0, this.flashT / 0.055);
    } else {
      this.flashMat.opacity = 0;
      this.flashLight.intensity = 0;
    }

    // 相机 fov 由外部控制，此处仅跟随比例
    this.camera.aspect = s.aspect || 16 / 9;
    this.camera.updateProjectionMatrix();
  }
}
