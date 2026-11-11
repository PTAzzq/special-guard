/** 通用工具：随机数、数学、程序化贴图 */
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (r, a, b) => a + r() * (b - a);
export const randInt = (r, a, b) => Math.floor(a + r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function makeColorHex(c) {
  return typeof c === 'string' ? new THREE.Color(c) : c;
}

/* ---------------- 程序化贴图（写实风低模占位素材） ---------------- */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

function finish(c, repeatX = 1, repeatY = 1, aniso = 4) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 沥青路面 */
export function texAsphalt(seed = 1) {
  const { c, ctx } = canvas2d(256, 256);
  const r = mulberry32(seed);
  ctx.fillStyle = '#33353a'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 40 + Math.floor(r() * 50);
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + r() * 0.5})`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(20,20,22,${0.2 + r() * 0.3})`;
    ctx.lineWidth = 0.6 + r();
    ctx.moveTo(r() * 256, r() * 256);
    ctx.lineTo(r() * 256, r() * 256);
    ctx.stroke();
  }
  return finish(c, 8, 8);
}

/** 人行道 / 地砖 */
export function texSidewalk(seed = 2, base = '#8d8b86') {
  const { c, ctx } = canvas2d(256, 256);
  const r = mulberry32(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const g = 120 + Math.floor(r() * 60);
    ctx.fillStyle = `rgba(${g},${g},${g - 6},${r() * 0.35})`;
    ctx.fillRect(r() * 256, r() * 256, 2, 2);
  }
  ctx.strokeStyle = 'rgba(70,70,70,0.55)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  return finish(c, 12, 12);
}

/** 草地 */
export function texGrass(seed = 3) {
  const { c, ctx } = canvas2d(256, 256);
  const r = mulberry32(seed);
  ctx.fillStyle = '#3f5230'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const gr = 60 + Math.floor(r() * 70);
    ctx.fillStyle = `rgba(${Math.floor(gr * 0.6)},${gr},${Math.floor(gr * 0.35)},${0.2 + r() * 0.6})`;
    const x = r() * 256, y = r() * 256;
    ctx.fillRect(x, y, 1, 2 + r() * 3);
  }
  return finish(c, 16, 16);
}

/** 木地板 */
export function texWood(seed = 4, dark = false) {
  const { c, ctx } = canvas2d(256, 256);
  const r = mulberry32(seed);
  const base = dark ? '#41291a' : '#6b4a2e';
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  const plank = 64;
  for (let y = 0; y < 256; y += plank) {
    for (let x = 0; x < 256; x += 128) {
      const off = (y / plank) % 2 === 0 ? 0 : 64;
      const g = dark ? 30 + r() * 30 : 60 + r() * 50;
      ctx.fillStyle = `rgba(${Math.floor(g * 1.5)},${Math.floor(g * 0.95)},${Math.floor(g * 0.6)},0.55)`;
      ctx.fillRect(x + off, y, 126, plank - 2);
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(20,10,5,${0.05 + r() * 0.18})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const yy = y + r() * plank;
        ctx.moveTo(x + off, yy);
        ctx.bezierCurveTo(x + off + 40, yy + r() * 3, x + off + 85, yy - r() * 3, x + off + 126, yy + r() * 2);
        ctx.stroke();
      }
    }
  }
  return finish(c, 6, 6);
}

/** 砖墙 / 楼体外墙 */
export function texWall(seed = 5, base = '#6f6a63', brick = true) {
  const { c, ctx } = canvas2d(256, 256);
  const r = mulberry32(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  if (brick) {
    const bh = 20, bw = 48;
    for (let y = 0, row = 0; y < 256; y += bh, row++) {
      for (let x = -bw; x < 256 + bw; x += bw) {
        const off = row % 2 ? bw / 2 : 0;
        const g = 90 + Math.floor(r() * 40);
        ctx.fillStyle = `rgba(${g},${g - 6},${g - 12},0.55)`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  } else {
    for (let i = 0; i < 5000; i++) {
      const g = 100 + Math.floor(r() * 50);
      ctx.fillStyle = `rgba(${g},${g},${g},${r() * 0.25})`;
      ctx.fillRect(r() * 256, r() * 256, 3, 3);
    }
  }
  // 污渍
  for (let i = 0; i < 12; i++) {
    const g = ctx.createRadialGradient(r() * 256, r() * 256, 2, r() * 256, r() * 256, 30 + r() * 40);
    g.addColorStop(0, 'rgba(30,28,25,0.30)');
    g.addColorStop(1, 'rgba(30,28,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return finish(c, 3, 2);
}

/** 建筑窗户幕墙 */
export function texWindowWall(seed = 6) {
  const { c, ctx } = canvas2d(256, 512);
  const r = mulberry32(seed);
  ctx.fillStyle = '#3a3d42'; ctx.fillRect(0, 0, 256, 512);
  for (let y = 8; y < 512; y += 52) {
    for (let x = 8; x < 256; x += 46) {
      const lit = r() > 0.55;
      if (lit) {
        const g = 180 + Math.floor(r() * 60);
        ctx.fillStyle = `rgba(${g},${Math.floor(g * 0.85)},${Math.floor(g * 0.55)},0.9)`;
      } else {
        ctx.fillStyle = 'rgba(28,36,44,0.95)';
      }
      ctx.fillRect(x, y, 36, 40);
      ctx.strokeStyle = 'rgba(120,124,130,0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, 36, 40);
    }
  }
  return finish(c, 1, 1);
}

/** 金属 */
export function texMetal(seed = 7, base = '#6a6d72') {
  const { c, ctx } = canvas2d(128, 128);
  const r = mulberry32(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3000; i++) {
    const g = 90 + Math.floor(r() * 70);
    ctx.fillStyle = `rgba(${g},${g},${g},${0.1 + r() * 0.3})`;
    ctx.fillRect(r() * 128, r() * 128, 1 + r() * 6, 1);
  }
  return finish(c, 2, 2);
}

/** 生成圆点柔光贴图（用于粒子/灯光贴图） */
export function texSoftDot() {
  const { c, ctx } = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,240,210,0.55)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 木纹/布纹等，用于衣物可选项 */
export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function shade(hex, k) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v * k), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
