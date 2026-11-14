/**
 * 程序化场景构建（当前为占位素材，后续可替换为真实模型/贴图）
 * 返回 { scene, colliders, bounds, spawn, npcArea }
 * colliders 为 XZ 平面 AABB，用于玩家/NPC 碰撞。
 */
import * as THREE from 'three';
import {
  mulberry32, rand, randInt, pick,
  texAsphalt, texSidewalk, texGrass, texWood, texWall, texWindowWall, texMetal, texSoftDot
} from './utils.js';

const AABB = (cx, cz, w, d, h = 3) => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });

export function isBlocked(colliders, x, z, r = 0.36) {
  for (const c of colliders) {
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  }
  return false;
}

function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.62, bottom);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ground(scene, size, tex, color = 0xffffff, x = 0, z = 0, y = 0) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.96, metalness: 0.02 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function lampPost(scene, colliders, rng, x, z, night = false) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3238, roughness: 0.6, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8), poleMat);
  pole.position.y = 2.6;
  pole.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), poleMat);
  arm.position.set(0.45, 5.15, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.32), poleMat);
  head.position.set(0.85, 5.06, 0);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe0a0, emissiveIntensity: night ? 3.5 : 1.2, roughness: 0.4 });
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.28), bulbMat);
  bulb.position.set(0.85, 4.97, 0);
  g.add(pole, arm, head, bulb);
  if (night) {
    const pl = new THREE.PointLight(0xffd9a0, 22, 16, 2);
    pl.position.set(0.85, 4.9, 0);
    g.add(pl);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  colliders.push(AABB(x, z, 0.4, 0.4, 5));
  return g;
}

function trashBin(scene, colliders, x, z) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.8, metalness: 0.3 });
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.95, 10), mat);
  bin.position.set(x, 0.48, z);
  bin.castShadow = true;
  scene.add(bin);
  colliders.push(AABB(x, z, 0.8, 0.8, 0.95));
}

function car(scene, colliders, x, z, rotY, colorHex) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.65 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b242c, roughness: 0.15, metalness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 4.3), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glassMat);
  cabin.position.set(0, 1.13, -0.15);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.95 });
  for (const [wx, wz] of [[0.95, 1.35], [-0.95, 1.35], [0.95, -1.35], [-0.95, -1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.32, wz);
    g.add(w);
  }
  g.add(body, cabin);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  const halfW = Math.abs(Math.cos(rotY)) * 0.95 + Math.abs(Math.sin(rotY)) * 2.15;
  const halfD = Math.abs(Math.cos(rotY)) * 2.15 + Math.abs(Math.sin(rotY)) * 0.95;
  colliders.push(AABB(x, z, halfW * 2, halfD * 2, 1.5));
}

/* ------------------------------- 街道 ------------------------------- */
function buildStreet(scene, colliders, rng, night = false) {
  const size = 44;
  scene.background = skyTexture(night ? '#060a12' : '#7c94ad', night ? '#101a26' : '#c9d6e0');
  scene.fog = new THREE.Fog(night ? 0x0a1220 : 0xbccbd8, night ? 18 : 34, night ? 55 : 78);

  ground(scene, size, texAsphalt(11), night ? 0x9aa2ac : 0xffffff);
  // 人行道
  const walkTex = texSidewalk(12);
  for (const sx of [-11.5, 11.5]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(9, size), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 }));
    w.rotation.x = -Math.PI / 2;
    w.position.set(sx, 0.02, 0);
    w.receiveShadow = true;
    scene.add(w);
  }
  // 马路中线
  for (let z = -18; z <= 18; z += 4.5) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.2), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9 }));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.03, z);
    scene.add(dash);
  }

  // 两侧楼体
  const windowTex = texWindowWall(21);
  const wallTex = texWall(22, night ? '#3d3a36' : '#7a736a');
  for (const side of [-1, 1]) {
    let z = -18;
    while (z < 18) {
      const depth = rand(rng, 6, 10);
      const h = rand(rng, 9, 17);
      const w = rand(rng, 7, 10);
      const mat = new THREE.MeshStandardMaterial({
        map: rng() > 0.35 ? windowTex : wallTex,
        color: night ? 0x8892a0 : 0xffffff,
        roughness: 0.92, metalness: 0.05,
        emissive: night ? 0x2a2418 : 0x000000,
        emissiveIntensity: night ? 0.5 : 0
      });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), mat);
      b.position.set(side * (15 + w / 2), h / 2, z + depth / 2);
      b.castShadow = true;
      b.receiveShadow = true;
      scene.add(b);
      colliders.push(AABB(b.position.x, b.position.z, w, depth));
      // 门头 / 招牌
      if (rng() > 0.45) {
        const signMat = new THREE.MeshStandardMaterial({
          color: pick(rng, [0x8a2f2f, 0x2f4f8a, 0x2f7a4a, 0x8a7a2f]),
          emissive: night ? pick(rng, [0xff5533, 0x33aaff, 0x33ff99]) : 0x000000,
          emissiveIntensity: night ? 2.2 : 0
        });
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 3.2), signMat);
        sign.position.set(side * (15 - 0.1), 3.4, z + depth / 2);
        scene.add(sign);
      }
      z += depth + rand(rng, 0.6, 2.2);
    }
  }

  // 路灯
  for (let z = -16; z <= 16; z += 11) {
    lampPost(scene, colliders, rng, -12.6, z, night);
    lampPost(scene, colliders, rng, 12.6, z + 5, night);
  }

  // 车辆
  const carColors = [0x2a2d33, 0x7a1f24, 0x1f3a6b, 0x8d8f93, 0x1d4a3a];
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    car(scene, colliders, side * rand(rng, 7.5, 9.5), rand(rng, -15, 15), 0, pick(rng, carColors));
  }

  // 垃圾桶 / 消防栓
  for (let i = 0; i < 6; i++) trashBin(scene, colliders, (rng() > 0.5 ? 1 : -1) * rand(rng, 11, 13), rand(rng, -16, 16));

  // 夜间霓虹补光
  if (night) {
    const p1 = new THREE.PointLight(0xff6a3a, 26, 22, 2); p1.position.set(-9, 4, -6); scene.add(p1);
    const p2 = new THREE.PointLight(0x3aa0ff, 24, 22, 2); p2.position.set(9, 4, 8); scene.add(p2);
  }

  return { bounds: 12.5, spawn: { x: 0, z: 11 } };
}

/* -------------------------------- 酒吧 -------------------------------- */
function buildBar(scene, colliders, rng) {
  const W = 26, D = 22, H = 4.2;
  scene.background = skyTexture('#12100e', '#1c1815');
  scene.fog = new THREE.Fog(0x120f0d, 16, 42);

  ground(scene, Math.max(W, D), texWood(31, true), 0xffffff);

  // 天花
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x231d19, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);

  // 四面墙
  const wallTex = texWall(32, '#4a3a2e', false);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92 });
  const addWall = (cx, cz, w, d, h = H) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(cx, h / 2, cz);
    m.receiveShadow = true;
    scene.add(m);
    colliders.push(AABB(cx, cz, w, d));
  };
  addWall(0, -D / 2, W, 0.4);
  addWall(0, D / 2, W, 0.4);
  addWall(-W / 2, 0, 0.4, D);
  addWall(W / 2, 0, 0.4, D);

  // 吧台
  const barMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.55, metalness: 0.25 });
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.16, 1.3), new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.35, metalness: 0.2 }));
  barTop.position.set(0, 1.12, -7.4);
  barTop.castShadow = true;
  const barBody = new THREE.Mesh(new THREE.BoxGeometry(9.5, 1.05, 1.1), barMat);
  barBody.position.set(0, 0.52, -7.4);
  scene.add(barTop, barBody);
  colliders.push(AABB(0, -7.4, 9.5, 1.4, 1.2));

  // 酒架 + 瓶子
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 });
  for (let s = 0; s < 2; s++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.4), shelfMat);
    shelf.position.set(0, 1.7 + s * 0.7, -10.4);
    scene.add(shelf);
    for (let i = 0; i < 22; i++) {
      const bottleMat = new THREE.MeshStandardMaterial({
        color: pick(rng, [0x2f5a3a, 0x6b3a1a, 0x3a4a6b, 0x8a7a3a, 0x6b1f2a]),
        roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9
      });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, rand(rng, 0.24, 0.36), 8), bottleMat);
      b.position.set(-4.2 + i * 0.4, 1.86 + s * 0.7, -10.4);
      scene.add(b);
    }
  }
  // 酒架背板
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(9.4, 2.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x1e1410, roughness: 0.9 }));
  backPanel.position.set(0, 2.0, -10.6);
  scene.add(backPanel);
  colliders.push(AABB(0, -10.4, 9.6, 0.6, 3.2));

  // 卡座（桌 + 椅）
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x3f2a1c, roughness: 0.6, metalness: 0.15 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a1f24, roughness: 0.85 });
  const spots = [
    [-8, -3], [8, -3], [-8, 3], [8, 3], [-3, 6], [3, 6], [-1, -2.5]
  ];
  for (const [x, z] of spots) {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14), tableMat);
    table.position.set(x, 0.76, z);
    table.castShadow = true;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.74, 8), tableMat);
    leg.position.set(x, 0.38, z);
    scene.add(table, leg);
    for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const cx = x + Math.cos(ang) * 0.95, cz = z + Math.sin(ang) * 0.95;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), seatMat);
      seat.position.set(cx, 0.46, cz);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), seatMat);
      back.position.set(cx + Math.cos(ang) * 0.2, 0.72, cz + Math.sin(ang) * 0.2);
      const sLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), tableMat);
      sLeg.position.set(cx, 0.22, cz);
      scene.add(seat, back, sLeg);
    }
    colliders.push(AABB(x, z, 1.7, 1.7, 1.05));
  }

  // 吊灯（暖光）
  const dot = texSoftDot();
  const lampSpots = [[-6, -4], [6, -4], [0, 2], [-6, 6], [6, 6]];
  for (const [x, z] of lampSpots) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 5), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    wire.position.set(x, H - 0.55, z);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.36, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x2e2a26, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.4 }));
    shade.position.set(x, H - 1.2, z);
    shade.rotation.x = Math.PI;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: 0xffcf88, emissiveIntensity: 4 }));
    bulb.position.set(x, H - 1.36, z);
    const pl = new THREE.PointLight(0xffb769, 16, 12, 2);
    pl.position.set(x, H - 1.4, z);
    scene.add(wire, shade, bulb, pl);
  }

  // 霓虹灯牌
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), new THREE.MeshBasicMaterial({ color: 0xff4a7a }));
  neon.position.set(0, 3.1, -10.5);
  scene.add(neon);
  const neonLight = new THREE.PointLight(0xff4a7a, 14, 14, 2);
  neonLight.position.set(0, 3.0, -9.5);
  scene.add(neonLight);

  // 环境光（室内偏暗）
  scene.add(new THREE.AmbientLight(0x6b5a48, 1.5));
  return { bounds: 10.5, spawn: { x: 0, z: 9 } , indoor: true };
}

/* -------------------------------- 公园 -------------------------------- */
function buildPark(scene, colliders, rng) {
  const size = 46;
  scene.background = skyTexture('#5f8cba', '#cbe0ea');
  scene.fog = new THREE.Fog(0xa9c3d4, 32, 70);

  ground(scene, size, texGrass(41), 0xffffff);

  // 十字小径
  const pathMat = new THREE.MeshStandardMaterial({ map: texSidewalk(42, '#a39b8c'), roughness: 0.95 });
  for (const rot of [0, Math.PI / 2]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.2, size), pathMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = rot;
    p.position.y = 0.02;
    p.receiveShadow = true;
    scene.add(p);
  }

  // 树
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3727, roughness: 0.95 });
  const leafMats = [0x2f4a24, 0x3d5a2b, 0x28421f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  for (let i = 0; i < 16; i++) {
    let x, z, tries = 0;
    do {
      x = rand(rng, -19, 19); z = rand(rng, -19, 19); tries++;
    } while (tries < 20 && (Math.abs(x) < 3.4 || Math.abs(z) < 3.4 || isBlocked(colliders, x, z, 1.6)));
    const h = rand(rng, 4.2, 7.5);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 8), trunkMat);
    trunk.position.set(x, h / 2, z);
    trunk.castShadow = true;
    scene.add(trunk);
    const leafMat = pick(rng, leafMats);
    for (let k = 0; k < 3; k++) {
      const r = rand(rng, 1.1, 1.9);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), leafMat);
      crown.position.set(x + rand(rng, -0.8, 0.8), h - 0.4 + k * 0.85, z + rand(rng, -0.8, 0.8));
      crown.castShadow = true;
      scene.add(crown);
    }
    colliders.push(AABB(x, z, 0.7, 0.7, 6));
  }

  // 长椅
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x513524, roughness: 0.85 });
  for (const [x, z, r] of [[-6, 5, 0], [6, -5, Math.PI], [-6, -6, 0], [7, 6, Math.PI]]) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.55), benchMat);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.1), benchMat);
    back.position.set(0, 0.72, -0.24);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.5), benchMat);
    l1.position.set(-0.8, 0.22, 0);
    const l2 = l1.clone(); l2.position.x = 0.8;
    g.add(seat, back, l1, l2);
    g.position.set(x, 0, z);
    g.rotation.y = r;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    colliders.push(AABB(x, z, 2.2, 1.2, 1.0));
  }

  // 路灯
  for (const [x, z] of [[-3.2, -3.2], [3.2, 3.2], [-3.2, 9], [3.2, -9]]) lampPost(scene, colliders, rng, x, z, false);

  // 灌木
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2c4523, roughness: 0.95 });
  for (let i = 0; i < 14; i++) {
    const x = rand(rng, -18, 18), z = rand(rng, -18, 18);
    if (isBlocked(colliders, x, z, 1.0)) continue;
    const b = new THREE.Mesh(new THREE.SphereGeometry(rand(rng, 0.5, 0.9), 8, 6), bushMat);
    b.position.set(x, 0.4, z);
    b.scale.y = 0.7;
    scene.add(b);
    colliders.push(AABB(x, z, 1.1, 1.1, 0.9));
  }

  return { bounds: 19.5, spawn: { x: 0, z: 16 } };
}

/* ------------------------------ 对外入口 ------------------------------ */
export function buildWorld(key) {
  const scene = new THREE.Scene();
  const colliders = [];
  const rng = mulberry32(20261110 + key.length * 97 + (key === 'bar' ? 13 : key === 'park' ? 27 : 0));

  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x4a4438, key === 'bar' ? 0.55 : 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(key === 'night' ? 0x9fb6d8 : 0xfff2df, key === 'night' ? 0.55 : 1.9);
  sun.position.set(-14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0012;
  scene.add(sun);
  scene.add(sun.target);

  let info;
  if (key === 'bar') info = buildBar(scene, colliders, rng);
  else if (key === 'park') info = buildPark(scene, colliders, rng);
  else info = buildStreet(scene, colliders, rng, key === 'night');

  return {
    scene, colliders, sun,
    bounds: info.bounds,
    spawn: info.spawn,
    indoor: !!info.indoor
  };
}
