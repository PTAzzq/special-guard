/**
 * 头部：程序化 UV 贴图 + 按人类头骨变形的头部几何
 *
 * 设计要点
 *  1) 头骨不再是"球体 + 拼装件"，而是一个参数化曲面：球面经纬网格 → 球体纵向拉伸
 *     → 下颌收窄 → 后脑弧 → 颧弓 / 眉弓 / 眼窝 / 鼻梁 / 唇部 / 颏部等骨相起伏，
 *     全部由 headPoint() 一次性形变出来，法线用 computeVertexNormals 得到，
 *     因此侧脸、半侧脸、仰视都不会露出"球与球之间的缝"。
 *  2) UV 采用等距圆柱（equirectangular）展开：u = (经度 + π) / 2π（0.5 = 正脸，
 *     0/1 = 后脑接缝），v = 0 下巴 → 1 颅顶。所有五官都画在同一张离屏 Canvas 上，
 *     通过 pxOf()/pyOf() 与几何共用同一套坐标换算，贴图与几何严丝合缝。
 *  3) 六款长相由 FACE_PRESETS 驱动：脸型宽窄（jaw）、颧骨、眉眼间距、眼裂大小、
 *     鼻长鼻宽、唇厚唇宽、胡须、痣、皱纹深浅各不相同；肤色/发色取自角色外观表。
 *  4) 全部内容由代码绘制，不使用任何外部图片素材。
 */

import * as THREE from 'three';
import { mulberry32 } from './utils.js';

const PI2 = Math.PI * 2;

/** 头半宽 / 头半深（以"头高 = 1"为单位，与 character.js 的 HEAD_HW/HEAD_HD 同源） */
export const HEAD_HWF = 0.312;
export const HEAD_HDF = 0.418;

/**
 * 人像解剖学基准（v：下巴 = 0 → 颅顶 = 1，单位 = 头高）
 *  眼线 0.500  颅顶-颏底中线
 *  眉   0.560  眼线上方 6%
 *  鼻底 0.330  眼线下方 17%
 *  口裂 0.222  鼻底(0.330)-颏底(0) 上 1/3
 *  耳   0.322~0.538  跨眼线到鼻底
 * 侧影前后关系：鼻尖最前 → 上唇略后 → 下唇再后 → 颏前点略后于上唇，全程不越过鼻尖-颏连线。
 */
export const ANAT = {
  EYE_V: 0.500,
  BROW_DV: 0.060,
  NOSE_BASE_V: 0.330,
  MOUTH_V: 0.222,
  CHIN_V: 0.070,
  EAR_TOP_V: 0.505,
  EAR_BOT_V: 0.328
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const g1 = (d, s) => Math.exp(-(d * d) / (2 * s * s));
const g2 = (dx, dy, sx, sy) => Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* ======================================================================== *
 * 一、六款长相参数
 *   字段（除注明外都是"相对基准的倍率"）：
 *     jaw      下颌宽窄        cheek  颧骨突出
 *     eyeGap   双眼间距        eyeSize 眼裂大小
 *     eyeY     眼线高度        browY  眉毛高度（相对眼线）
 *     brow     眉毛粗细        noseW  鼻宽      noseL 鼻长
 *     mouthW   嘴宽            lipFull 唇厚
 *     stubble  胡茬浓度 0~1    wrinkle 皱纹/法令纹深浅 0~1
 *     beard    默认胡须造型    mole   痣的位置 [x, v] 或 null
 *     iris     虹膜颜色
 * ======================================================================== */
export const FACE_PRESETS = [
  {
    id: 1, name: '国字脸·浓眉',
    jaw: 1.05, cheek: 1.05, eyeGap: 1.02, eyeSize: 0.98, eyeY: 0.500, browY: 0.560, mouthV: 0.222,
    brow: 1.30, noseW: 1.06, noseL: 1.02, mouthW: 1.02, lipFull: 0.86,
    stubble: 0.0, wrinkle: 0.35, beard: '无', mole: null, iris: '#4a3220', age: 0.35
  },
  {
    id: 2, name: '鹅蛋脸·细眉',
    jaw: 0.90, cheek: 0.90, eyeGap: 0.99, eyeSize: 1.10, eyeY: 0.502, browY: 0.561, mouthV: 0.224,
    brow: 0.72, noseW: 0.90, noseL: 0.98, mouthW: 0.94, lipFull: 1.10,
    stubble: 0.0, wrinkle: 0.12, beard: '无', mole: [0.148, 0.315], iris: '#3a2a1c', age: 0.15
  },
  {
    id: 3, name: '方脸·压眉',
    jaw: 1.12, cheek: 1.10, eyeGap: 1.04, eyeSize: 0.88, eyeY: 0.498, browY: 0.558, mouthV: 0.221,
    brow: 1.55, noseW: 1.15, noseL: 0.97, mouthW: 1.08, lipFull: 0.80,
    stubble: 0.55, wrinkle: 0.45, beard: '胡茬', mole: null, iris: '#2e2418', age: 0.5
  },
  {
    id: 4, name: '长脸·平眉',
    jaw: 0.95, cheek: 0.98, eyeGap: 1.00, eyeSize: 0.95, eyeY: 0.500, browY: 0.559, mouthV: 0.222,
    brow: 1.10, noseW: 1.00, noseL: 1.18, mouthW: 0.98, lipFull: 0.92,
    stubble: 0.15, wrinkle: 0.62, beard: '无', mole: [-0.125, 0.395], iris: '#40301e', age: 0.62
  },
  {
    id: 5, name: '宽脸·圆鼻',
    jaw: 1.02, cheek: 1.12, eyeGap: 0.97, eyeSize: 0.92, eyeY: 0.499, browY: 0.557, mouthV: 0.221,
    brow: 1.20, noseW: 1.24, noseL: 0.92, mouthW: 1.10, lipFull: 1.02,
    stubble: 0.75, wrinkle: 0.70, beard: '络腮胡', mole: null, iris: '#332617', age: 0.7
  },
  {
    id: 6, name: '瘦长脸·淡眉',
    jaw: 0.86, cheek: 0.94, eyeGap: 1.08, eyeSize: 1.06, eyeY: 0.502, browY: 0.562, mouthV: 0.223,
    brow: 0.80, noseW: 0.94, noseL: 1.06, mouthW: 0.92, lipFull: 1.04,
    stubble: 0.0, wrinkle: 0.08, beard: '无', mole: null, iris: '#453018', age: 0.1
  }
];

export function pickFace(index) {
  const n = FACE_PRESETS.length;
  const i = ((Math.round(Number(index) || 0) % n) + n) % n;
  return FACE_PRESETS[i];
}

/* ======================================================================== *
 * 二、头骨轮廓与形变
 * ======================================================================== */

/* 下半张脸的横向倍率表 [v, 相对椭球基准宽度的倍率]
 * 真人：颧弓（v≈0.50）最宽 → 下颌角（v≈0.30）约颧弓的 0.90 → 颏部（v≈0.06）仍有近 0.55 宽度。
 * 旧版在 v<0.48 一路按 30% 线性收窄，把下颌收到接近零宽，正脸于是成了"锥子腮 / 猴腮"。
 */
const JAW_W = [
  [0.000, 1.34], [0.030, 1.22], [0.060, 1.12], [0.100, 1.02],
  [0.150, 0.962], [0.210, 0.918], [0.280, 0.900], [0.340, 0.912],
  [0.400, 0.952], [0.460, 0.996], [0.510, 1.010], [0.560, 1.008],
  [0.660, 0.998], [0.780, 0.994], [1.000, 1.000]
];
/* 颅面横向修正表 [v, 倍率]
 * 纯椭球/球面在正脸投影上是"上窄下宽"，实测颞部（v≈0.72）比真人窄 0.04~0.05 头高，
 * 导致额头被"夹尖"、颧骨以下显得外张，正是"尖嘴猴腮"的几何来源。
 * 真人正脸宽度曲线：颧弓（v≈0.55~0.60）最宽 → 颞部/额部仍保持 0.30~0.33 → 下颌角 0.26 → 颏 0.10。
 * 该表把球面宽度掰回真人曲线，且同步作用于发壳（发壳也走 headProfile）。
 */
const W_FIX = [
  [0.000, 0.780], [0.030, 0.800], [0.060, 0.850], [0.100, 0.880],
  [0.150, 0.900], [0.210, 0.930], [0.280, 0.960], [0.340, 0.980],
  [0.400, 0.990], [0.480, 1.000], [0.550, 1.030], [0.620, 1.060],
  [0.700, 1.090], [0.780, 1.110], [0.850, 1.080], [0.920, 1.030],
  [1.000, 1.000]
];
function widthFixK(v) {
  if (v <= W_FIX[0][0]) return W_FIX[0][1];
  for (let i = 1; i < W_FIX.length; i++) {
    if (v <= W_FIX[i][0]) {
      const a = W_FIX[i - 1], b = W_FIX[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return lerp(a[1], b[1], t * t * (3 - 2 * t));
    }
  }
  return W_FIX[W_FIX.length - 1][1];
}

function jawWidthK(v) {
  if (v <= JAW_W[0][0]) return JAW_W[0][1];
  for (let i = 1; i < JAW_W.length; i++) {
    if (v <= JAW_W[i][0]) {
      const a = JAW_W[i - 1], b = JAW_W[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return lerp(a[1], b[1], t * t * (3 - 2 * t));
    }
  }
  return JAW_W[JAW_W.length - 1][1];
}

/* 下颌前面（颏部实体）纵向补正表 [v, 向前补正量（头高单位）]
 * 椭球曲面在下半张脸收缩过快，会让颏部大幅后退 → 视觉上就是"尖嘴、没下巴、猴腮"。
 * 真人侧影：鼻尖最前，上唇次之，下唇再后，颏前点仅略后于上唇，颏唇沟（v≈0.17）略内收。
 */
const MAND_Z = [
  [0.000, 0.000], [0.012, 0.008], [0.030, 0.016], [0.050, 0.020],
  [0.070, 0.019], [0.095, 0.018], [0.120, 0.018], [0.150, 0.011],
  [0.175, 0.004], [0.200, 0.000]
];
function mandibleZ(v) {
  if (v <= MAND_Z[0][0] || v >= MAND_Z[MAND_Z.length - 1][0]) return 0;
  for (let i = 1; i < MAND_Z.length; i++) {
    if (v <= MAND_Z[i][0]) {
      const a = MAND_Z[i - 1], b = MAND_Z[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return lerp(a[1], b[1], t * t * (3 - 2 * t));
    }
  }
  return 0;
}

/** 该高度(v)的横向 / 前后缩放：下颌收敛、颞部微收、后脑略饱满 */
export function headProfile(v, face) {
  const f = face || FACE_PRESETS[0];
  let wx = 1, wz = 1;
  // 颅面横向：先把球面掰回真人正脸宽度曲线（颞部/额部加宽、颏底收窄）
  wx *= widthFixK(v);
  // 下颌 / 颏部横向：按解剖表收敛（下颌角窄于颧弓，但颏部保留"方圆形"宽度）
  wx *= jawWidthK(v);
  // jaw 参数只调节下颌角一带的宽窄，不改变颧弓与颏宽
  wx *= 1 + (f.jaw - 1) * 0.55 * g1(v - 0.285, 0.135);
  // 颧弓最宽处稍作外扩
  wx *= 1 + 0.035 * g1(v - 0.50, 0.085) * (f.cheek - 1) * 3.2;
  // 颞部（太阳穴）微收，避免"圆桶脸"
  wx *= 1 - 0.014 * g1(v - 0.72, 0.075);
  // 前后厚度：下颌收量减小，避免下半张脸被压成"薄片"
  if (v < 0.50) {
    const t = (0.50 - v) / 0.50;
    wz *= 1 - 0.062 * Math.pow(t, 1.75);
  }
  // 后脑略饱满：枕骨弧
  wz *= 1 + 0.045 * g1(v - 0.60, 0.16);
  return { wx, wz };
}

/**
 * 求解一个经度方向上的头部表面点（含所有骨相起伏）
 * @param sx,sy,sz 单位球方向分量（sy = cosθ，从 1 到 -1；sz = 0.894 表示正前）
 * @param v 0 下巴 → 1 颅顶
 */
export function headPoint(sx, sy, sz, v, face) {
  const f = face || FACE_PRESETS[0];
  const { wx, wz } = headProfile(v, f);
  let x = sx * HEAD_HWF * wx;
  let z = sz * HEAD_HDF * wz;
  const y = v;

  const front = Math.max(0, sz);          // 正面遮罩：1 = 正前，0 = 侧/后
  const ff = Math.pow(front, 1.15);
  const ax = Math.abs(x);

  /* —— 下颌前面：给颏部补出实体，抵消椭球在下半张脸的后缩 ——
     横向用指数衰减：中轴（颏前点）最强，到两侧（下颌角）自然减弱，不会出现方盒脸。 */
  {
    const mz = mandibleZ(v);
    if (mz !== 0) z += mz * Math.exp(-Math.pow(ax / 0.185, 2) * 1.25) * ff;
  }

  // —— 眼窝：让眼球"陷进去"而不是浮在脸上 ——
  const eyeX = 0.132 * f.eyeGap;
  z -= 0.0150 * g2(ax - eyeX, v - f.eyeY, 0.070, 0.045) * ff;
  // 眉弓：骨性隆起，与贴图眉线同高（眼线上方 6%），压出眼窝深度
  z += 0.0092 * g2(ax - eyeX, v - (f.eyeY + ANAT.BROW_DV), 0.082, 0.022) * ff;
  // 眶下（颧上）过渡
  z += 0.0040 * g2(ax - eyeX, v - (f.eyeY - 0.055), 0.078, 0.030) * ff;

  // —— 鼻 ——
  const nTip = ANAT.NOSE_BASE_V;            // 鼻底（鼻下点），眼线下方 17%
  const nRoot = nTip + 0.235 * f.noseL;     // 鼻根（眉间下）
  // 纵向平滑遮罩：旧版用 if 硬切区间，会在鼻底下方 0.285 处留下 3.5% 头高的台阶（"胡子沿/鸟嘴"感）
  const nMask = sstep(nTip - 0.004, nTip + 0.009, v) * (1 - sstep(nRoot - 0.006, nRoot + 0.032, v));
  if (nMask > 0.001) {
    const tn = clamp01((nRoot - v) / (nRoot - nTip));   // 0 鼻根 → 1 鼻尖
    const brow = 0.026 + 0.020 * Math.pow(tn, 0.85) * f.noseW;  // 鼻梁→鼻头逐渐变宽
    const amp = 0.008 + 0.030 * Math.pow(tn, 1.15);            // 鼻梁→鼻尖逐渐变高
    const nm = nMask * ff;
    z += amp * g1(x, brow) * nm;
    // 鼻尖球
    z += 0.0085 * g2(x, v - (nTip + 0.016), 0.030 * f.noseW, 0.026) * nm;
    // 鼻翼
    z += 0.0092 * g2(ax - 0.043 * f.noseW, v - (nTip + 0.020), 0.019 * f.noseW, 0.019) * nm;
    // 鼻孔凹陷
    z -= 0.0072 * g2(ax - 0.028 * f.noseW, v - (nTip + 0.004), 0.013 * f.noseW, 0.011) * nm;
    // 鼻根下凹（山根）
    z -= 0.0045 * g2(x, v - (nRoot - 0.012), 0.030, 0.024) * nm;
  }

  /* —— 中轴剖面整形（真人侧颜）：把"平板脸 + 鼻下硬台阶"掰成
     额-鼻根凹-鼻尖凸-鼻下收-上唇-口缝-下唇-颏唇沟-颏前点 的 S 形曲线 ——
     每项都是正中最强、向两侧按高斯衰减的前脸软组织起伏。 */
  {
    // ① 鼻根（nasion）：眉间下方最凹处，是侧颜"立体感"的关键负形
    z -= 0.0215 * g2(x, v - 0.452, 0.058, 0.028) * ff;
    // ② 鼻尖：抬成全脸最前点（略前于上唇与颏）
    z += 0.0125 * g2(x, v - 0.357, 0.035, 0.023) * ff;
    // ③ 鼻下点（subnasale）：保留内收，但幅度减小，消掉鼻下"鸟嘴台阶"
    z -= 0.0060 * g2(x, v - 0.328, 0.052, 0.018) * ff;
    // ④ 上颌骨+上唇：整体前移，让上唇成为仅次于鼻尖的前突软组织
    z += 0.0260 * g2(x, v - 0.252, 0.095, 0.034) * ff;
    // ④b 口裂（上下唇分离沟）：与贴图口缝同高 0.222，让侧颜真的读出"上下唇"
    z -= 0.0100 * g2(x, v - 0.222, 0.072, 0.012) * ff;
    // ⑤ 下唇前移（略弱于上唇）
    z += 0.0160 * g2(x, v - 0.188, 0.080, 0.028) * ff;
    // ⑥ 颏唇沟（mento-labial sulcus）：下唇与颏之间的浅凹
    z -= 0.0085 * g2(x, v - 0.156, 0.072, 0.020) * ff;
    // ⑦ 颏前点：下巴补出实体，避免"没下巴"
    /* 颏部遮罩：下巴在球面下半部朝"前下"，纯 front 遮罩会衰减到 0.45，
       导致下巴推不出去。这里用"前+下"混合遮罩，后脑仍为 0。 */
    const cdMask = Math.min(1, Math.max(0, sz * 0.72 - sy * 0.55) * 1.15);
    z += 0.0090 * g2(x, v - 0.112, 0.064, 0.036) * cdMask;
    // ⑦b 颏部整体（颏前点→颏底）实体：上下不对称衰减，保证下巴垂直立住、
    //     而不是从颏唇沟一路斜着退回颈部
    {
      const d = v - 0.098;
      const sv = d < 0 ? 0.030 : 0.058;
      z += 0.0420 * Math.exp(-(d * d) / (2 * sv * sv)) * Math.exp(-Math.pow(x / 0.085, 2)) * cdMask;
    }
    // ⑦c 颏底-颏前段实体：补足下巴下半段的前后厚度，避免下巴"斜着退回脖子"
    {
      const d = v - 0.055;
      const sv = d < 0 ? 0.032 : 0.030;
      z += 0.0500 * Math.exp(-(d * d) / (2 * sv * sv)) * Math.exp(-Math.pow(x / 0.082, 2)) * cdMask;
    }
    // ⑨ 上脸（眶周-眉弓-额下部）整体后收：真人鼻尖应明显前于眉弓，
    //    否则侧颜读作"平鼻梁+突眉骨"的猿面
    z -= 0.0200 * g2(x, v - 0.525, 0.090, 0.070) * ff;
    // ⑧ 颊侧填充：颧弓到下颌的过渡不要一刀切收（消除"猴腮"凹陷感）
    z += 0.0070 * g2(ax - 0.150, v - 0.330, 0.075, 0.070) * ff;
  }

  // —— 唇：口裂位于鼻底-颏底上 1/3；唇凸量小于旧版，保证不越过"鼻尖-颏"连线 ——
  const mv = (f.mouthV !== undefined ? f.mouthV : ANAT.MOUTH_V);
  const mw = 0.058 * f.mouthW;
  z += 0.0058 * f.lipFull * g2(x, v - (mv + 0.024), mw, 0.014) * ff;   // 上唇
  z += 0.0055 * f.lipFull * g2(x, v - (mv - 0.022), mw * 0.95, 0.017) * ff; // 下唇
  z -= 0.0040 * g2(x, v - mv, mw * 1.15, 0.0055) * ff;                 // 口缝
  // 颏唇沟
  z -= 0.0036 * g2(x, v - (mv - 0.052), mw * 1.0, 0.014) * ff;

  // —— 颏部（下巴）：在 mandibleZ 的基础块上再补一点颏窿（方圆颏，不是尖下巴）——
  z += 0.0045 * g2(x, v - ANAT.CHIN_V, 0.055, 0.042) * ff;
  // —— 颧骨 ——
  z += 0.0060 * g2(ax - 0.168, v - 0.492, 0.052, 0.046) * ff;
  // —— 额部 ——
  z += 0.0055 * g1(v - 0.805, 0.065) * ff;

  return [x, y, z];
}

/** 给定正面横向位置 x 与高度 v，求该处表面 z（用于把眼球放进眼窝） */
export function headSurfaceZ(x, v, face) {
  const sr = Math.sqrt(Math.max(1e-4, 1 - Math.pow(2 * v - 1, 2)));
  const { wx } = headProfile(v, face);
  const s = clamp(x / (HEAD_HWF * wx * sr), -0.995, 0.995);
  const a = Math.asin(s);
  const sz = Math.cos(a) * sr;
  return headPoint(Math.sin(a) * sr, 2 * v - 1, sz, v, face)[2];
}

/**
 * 头部几何：经纬网格 → 头骨形变。UV 与贴图一一对应。
 * 坐标单位为"头高 = 1"，xy 原点在（中轴，下巴），由调用方缩放并平移到头部局部。
 */
export function buildHeadGeometry(face, opt = {}) {
  const segW = opt.segW || 64;
  const segH = opt.segH || 44;
  const n = (segW + 1) * (segH + 1);
  const pos = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const idx = [];
  let pi = 0, ui = 0;
  for (let iy = 0; iy <= segH; iy++) {
    const tv = iy / segH;
    const theta = tv * Math.PI;
    const cy = Math.cos(theta), sr = Math.sin(theta);
    const v = (cy + 1) / 2;
    for (let ix = 0; ix <= segW; ix++) {
      const u = ix / segW;
      const a = (u - 0.5) * PI2;
      const p = headPoint(Math.sin(a) * sr, cy, Math.cos(a) * sr, v, face);
      pos[pi++] = p[0]; pos[pi++] = p[1]; pos[pi++] = p[2];
      uvs[ui++] = u; uvs[ui++] = v;
    }
  }
  for (let iy = 0; iy < segH; iy++) {
    for (let ix = 0; ix < segW; ix++) {
      const a0 = iy * (segW + 1) + ix;
      const b0 = a0 + 1;
      const c0 = a0 + segW + 1;
      const d0 = c0 + 1;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ======================================================================== *
 * 三、UV 贴图绘制
 * ======================================================================== */
const texCache = new Map();

function hex2rgb(hex) {
  const s = String(hex || '#e9c6a4').replace('#', '');
  return [parseInt(s.substring(0, 2), 16), parseInt(s.substring(2, 4), 16), parseInt(s.substring(4, 6), 16)];
}
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function shade(c, k) { return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)]; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
function hexStr(c) {
  const f = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${f(c[0])}${f(c[1])}${f(c[2])}`;
}

/* 正脸发际线（眉间点）高度 v：真人额高 = 脸高（发际线→颏底）的 1/3，
 * 眉 0.560 时发际线应落在 0.875 左右；旧值 0.905 让额头占到近 40%，视觉上"发际线过高、眼睛偏下"。 */
export function hairLineV(a, hairStyle) {
  const t = Math.abs(a) / Math.PI;                      // 0 正脸 → 1 后脑
  let v = 0.875 - 0.055 * Math.pow(t, 0.70)
    - 0.055 * g1(Math.abs(a) - 1.25, 0.30)              // 两鬓（太阳穴上方）自然后退
    - 0.300 * sstep(0.42, 0.95, t);                     // 后脑 → 后颈
  if (hairStyle === '背头') v += 0.014;                 // 额角后梳
  if (hairStyle === '寸头') v -= 0.006;
  if (hairStyle === '中长发' || hairStyle === '马尾' || hairStyle === '盘发') v -= 0.012;
  return v;
}

/** 发型几何参数：外壳半径倍率 / 后颈下延 / 表面起伏 */
const HAIR_GEO = {
  '寸头':   { scale: 1.020, skirt: 0.06, bump: 0.000 },
  '短发':   { scale: 1.046, skirt: 0.10, bump: 0.0015 },
  '背头':   { scale: 1.052, skirt: 0.05, bump: 0.0010 },
  '中长发': { scale: 1.060, skirt: 0.34, bump: 0.0010 },
  '马尾':   { scale: 1.050, skirt: 0.26, bump: 0.0008 },
  '卷发':   { scale: 1.070, skirt: 0.12, bump: 0.0060 },
  '盘发':   { scale: 1.050, skirt: 0.30, bump: 0.0008 },
  '秃顶':   { scale: 1.030, skirt: 0.02, bump: 0.0000 }
};

/**
 * 通用"外壳"几何：与头骨同一套参数曲面，整体按 scale 外扩，只保留 v >= minV 的部分。
 * 帽壳 / 头盔 / 耳机箍都用它，保证任何角度都贴合头骨而不是一个悬空的球。
 */
export function buildCapGeometry(face, opt = {}) {
  const scale = opt.scale || 1.08;
  const minV = opt.minV === undefined ? 0.5 : opt.minV;
  const segW = opt.segW || 40, segH = opt.segH || 28;
  const CY = 0.62;
  const pos = [], uvs = [], idx = [];
  const rows = [];
  for (let iy = 0; iy <= segH; iy++) {
    const tv = iy / segH, theta = tv * Math.PI;
    const cy = Math.cos(theta), sr = Math.sin(theta);
    const v = (cy + 1) / 2;
    const row = [];
    for (let ix = 0; ix <= segW; ix++) {
      const u = ix / segW, a = (u - 0.5) * PI2;
      const p = headPoint(Math.sin(a) * sr, cy, Math.cos(a) * sr, v, face);
      const x = p[0] * scale, y = CY + (p[1] - CY) * scale, z = p[2] * scale;
      pos.push(x, y, z); uvs.push(u, v);
      row.push({ i: pos.length / 3 - 1, keep: v >= minV });
    }
    rows.push(row);
  }
  for (let iy = 0; iy < segH; iy++) {
    for (let ix = 0; ix < segW; ix++) {
      const p00 = rows[iy][ix], p10 = rows[iy][ix + 1];
      const p01 = rows[iy + 1][ix], p11 = rows[iy + 1][ix + 1];
      if (!(p00.keep && p10.keep && p01.keep && p11.keep)) continue;
      idx.push(p00.i, p01.i, p10.i, p10.i, p01.i, p11.i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 发壳几何：与头骨同一套参数曲面，整体外扩一点并只保留发际线以上部分，
 * 所以发型轮廓跟着头骨走，不会像贴一个球那样"扣"在头上。
 * 坐标单位同 buildHeadGeometry（头高 = 1，原点 = 下巴）。
 */
export function buildHairGeometry(face, hairStyle, opt = {}) {
  const style = HAIR_GEO[hairStyle] || HAIR_GEO['短发'];
  const segW = opt.segW || 48, segH = opt.segH || 36;
  const CY = 0.62;                       // 缩放中心 = 颅腔中心，避免外壳整体下移
  const pos = [], uvs = [], idx = [], mask = [];
  const push = (p, u, v) => { pos.push(p[0], p[1], p[2]); uvs.push(u, v); return pos.length / 3 - 1; };
  const rows = [];
  for (let iy = 0; iy <= segH; iy++) {
    const tv = iy / segH;
    const theta = tv * Math.PI;
    const cy = Math.cos(theta), sr = Math.sin(theta);
    const v = (cy + 1) / 2;
    const row = [];
    for (let ix = 0; ix <= segW; ix++) {
      const u = ix / segW;
      const a = (u - 0.5) * PI2;
      const p = headPoint(Math.sin(a) * sr, cy, Math.cos(a) * sr, v, face);
      // 外扩（以颅腔中心为球心）
      const dx = p[0], dy = p[1] - CY, dz = p[2];
      const k = style.scale + (style.bump ? style.bump * Math.sin(7.0 * a) * Math.sin(11.0 * theta) : 0);
      let x = dx * k, y = CY + dy * k, z = dz * k;
      // 后颈下延：发壳越过发际线一路垂到颈后
      const back = sstep(0.30, 1.0, Math.abs(a) / Math.PI);
      const lim = hairLineV(a, hairStyle) - 0.02 - style.skirt * back;
      row.push({ i: push([x, y, z], u, v), keep: v >= lim, v, a });
    }
    rows.push(row);
  }
  for (let iy = 0; iy < segH; iy++) {
    for (let ix = 0; ix < segW; ix++) {
      const p00 = rows[iy][ix], p10 = rows[iy][ix + 1];
      const p01 = rows[iy + 1][ix], p11 = rows[iy + 1][ix + 1];
      if (!(p00.keep && p10.keep && p01.keep && p11.keep)) continue;
      idx.push(p00.i, p01.i, p10.i, p10.i, p01.i, p11.i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const hairTexCache = new Map();

/**
 * 程序化毛发贴图：与发壳同一套 UV（u = 经度、v = 高度），
 * 画发丝走向 + 束状明暗 + 发根/发梢渐变，避免纯色块面看起来像"黑帽子"。
 */
export function buildHairTexture(opt = {}) {
  const hex = opt.hair || '#2b1c14';
  const style = opt.hairStyle || '短发';
  const seed = opt.seed || 1;
  const key = hex + '|' + style + '|' + seed;
  if (hairTexCache.has(key)) return hairTexCache.get(key);

  const W = 1024, H = Math.round(1024 * 780 / 2048);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const base = hex2rgb(hex);
  const rnd = mulberry32((seed * 7919 + hex.length * 131 + style.length * 17) | 0);

  ctx.fillStyle = hexStr(shade(base, 1.15));
  ctx.fillRect(0, 0, W, H);

  // 束状明暗：横向低频条带（同一经度上的发束明暗），柔化
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const wBand = (0.012 + rnd() * 0.05) * W;
    const g = ctx.createLinearGradient(x - wBand, 0, x + wBand, 0);
    const light = rnd() < 0.5;
    g.addColorStop(0, rgba(shade(base, light ? 1.45 : 0.62), 0));
    g.addColorStop(0.5, rgba(shade(base, light ? 1.45 : 0.62), 0.16 + rnd() * 0.10));
    g.addColorStop(1, rgba(shade(base, light ? 1.45 : 0.62), 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - wBand, 0, wBand * 2, H);
  }

  // 发丝：沿 v 方向的细长笔触，带轻微弯曲（卷发弯度更大）
  const curl = style === '卷发' ? 1.9 : (style === '中长发' || style === '马尾' || style === '盘发' ? 1.15 : 0.85);
  const nStrand = 2600;
  for (let i = 0; i < nStrand; i++) {
    const x0 = rnd() * W;
    const y0 = rnd() * H;
    const len = (0.05 + rnd() * 0.22) * H;
    const amp = (2 + rnd() * 9) * curl;
    const light = rnd();
    const col = light < 0.34 ? shade(base, 1.15 + rnd() * 0.75)
      : (light < 0.72 ? shade(base, 0.72 + rnd() * 0.20) : shade(base, 1.02 + rnd() * 0.30));
    ctx.strokeStyle = rgba(col, 0.10 + rnd() * 0.22);
    ctx.lineWidth = Math.max(0.8, (0.4 + rnd() * 1.5));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const seg = 4;
    for (let k = 1; k <= seg; k++) {
      const t = k / seg;
      const y = y0 + len * t;
      const x = x0 + Math.sin(t * Math.PI * 1.6 + i) * amp * t;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 顶部（v→1，颅顶）稍亮：受光面
  const gTop = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  gTop.addColorStop(0, rgba(shade(base, 1.55), 0.30));
  gTop.addColorStop(1, rgba(shade(base, 1.55), 0));
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, W, H * 0.42);

  // 发梢（v 小）略暗，贴近后颈
  const gBot = ctx.createLinearGradient(0, H, 0, H * 0.62);
  gBot.addColorStop(0, rgba(shade(base, 0.55), 0.34));
  gBot.addColorStop(1, rgba(shade(base, 0.55), 0));
  ctx.fillStyle = gBot;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  hairTexCache.set(key, tex);
  return tex;
}

/**
 * 生成头部 UV 贴图
 * @param {{skin:string, hair:string, beard:string, face:object, seed:number, quality:number}} opt
 */
export function buildFaceTexture(opt = {}) {
  const face = opt.face || FACE_PRESETS[0];
  const skinHex = opt.skin || '#e9c6a4';
  const hairHex = opt.hair || '#2b1c14';
  const beard = opt.beard || face.beard || '无';
  const quality = opt.quality || 2048;
  const key = [face.id, skinHex, hairHex, beard, quality, opt.hairStyle || '短发'].join('|');
  if (texCache.has(key)) return texCache.get(key);

  const W = quality;
  const H = Math.round(quality * 780 / 2048);   // 与球面等距展开的宽高比一致
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const skin = hex2rgb(skinHex);
  const hair = hex2rgb(hairHex);

  /* —— 解剖基准纵坐标：贴图与几何共用同一套 v，避免"贴图画在 0.62、几何在 0.50"的错位 —— */
  const V_EYE = face.eyeY;
  const V_BROW = face.browY;
  const V_NBASE = face.noseBase !== undefined ? face.noseBase : ANAT.NOSE_BASE_V;   // 鼻底
  const V_NROOT = V_NBASE + 0.235 * face.noseL;                                      // 鼻根
  const V_NTIP = V_NBASE + 0.016;                                                    // 鼻尖
  const V_MOUTH = face.mouthV !== undefined ? face.mouthV : ANAT.MOUTH_V;            // 口裂

  /* —— 坐标换算：头高单位 → 像素 —— */
  const pxOf = x => W * (0.5 + Math.asin(clamp(x / HEAD_HWF, -0.998, 0.998)) / PI2);
  const pyOf = v => H * (1 - v);
  // 水平方向每"头高单位"对应多少像素（含等距投影的横向压缩）
  const kx = x => {
    const d = Math.sqrt(Math.max(0.0016, HEAD_HWF * HEAD_HWF - Math.min(x * x, HEAD_HWF * HEAD_HWF * 0.994)));
    return W / PI2 / d;
  };

  /* —— 画笔：软边椭圆（multiply 压暗 / screen 提亮） —— */
  const blob = (x, v, rx, rv, color, a0, blend) => {
    const cx = pxOf(x), cy = pyOf(v);
    const R = Math.max(rx * kx(x), rv * H, 1.2);
    const sy = (rv * H) / R;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, rgba(color, a0));
    g.addColorStop(0.45, rgba(color, a0 * 0.72));
    g.addColorStop(1, rgba(color, 0));
    ctx.save();
    ctx.globalCompositeOperation = blend || 'multiply';
    ctx.translate(cx, cy);
    ctx.scale(1, sy);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, PI2); ctx.fill();
    ctx.restore();
  };
  // 硬边椭圆（用于唇、鼻孔等明确形状）
  const oval = (x, v, rx, rv, color, a0, rot) => {
    ctx.save();
    ctx.globalAlpha = a0 === undefined ? 1 : a0;
    ctx.fillStyle = color;
    ctx.translate(pxOf(x), pyOf(v));
    ctx.rotate(rot || 0);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(1, rx * kx(x)), Math.max(1, rv * H), 0, 0, PI2);
    ctx.fill();
    ctx.restore();
  };
  const path = (pts, close) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const X = pxOf(p[0]), Y = pyOf(p[1]);
      if (i === 0) ctx.moveTo(X, Y);
      else if (p.length >= 4) ctx.quadraticCurveTo(pxOf(p[2]), pyOf(p[3]), X, Y);
      else ctx.lineTo(X, Y);
    }
    if (close) ctx.closePath();
  };

  /* ---------- 1. 皮肤底色：轻微的冷暖与明暗过渡 ---------- */
  ctx.fillStyle = hexStr(skin);
  ctx.fillRect(0, 0, W, H);
  // 额头受光略亮、下颌略暗
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, rgba(shade(skin, 1.03), 0.55));
  vg.addColorStop(0.55, rgba(skin, 0));
  vg.addColorStop(1, rgba(shade(skin, 0.86), 0.55));
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  // 左右两侧（太阳穴→耳前）压暗，让正脸更立体
  blob(-0.245, 0.60, 0.075, 0.13, [118, 92, 80], 0.34);
  blob(0.245, 0.60, 0.075, 0.13, [118, 92, 80], 0.34);
  blob(-0.30, 0.40, 0.075, 0.12, [110, 86, 76], 0.30);
  blob(0.30, 0.40, 0.075, 0.12, [110, 86, 76], 0.30);
  // 侧脸与后脑：整片压暗（自然的球面漫反射衰减）
  for (const s of [-1, 1]) {
    const cx = pxOf(s * 0.26);
    const g = ctx.createLinearGradient(cx, 0, cx + s * W * 0.17, 0);
    g.addColorStop(0, 'rgba(96,74,66,0)');
    g.addColorStop(0.55, 'rgba(96,74,66,0.28)');
    g.addColorStop(1, 'rgba(96,74,66,0.50)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    const x0 = s > 0 ? cx : cx - W * 0.16;
    ctx.fillRect(x0, 0, W * 0.16, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 2. 眼窝阴影 / 眉弓下暗部 ---------- */
  const eyeX = 0.132 * face.eyeGap;
  for (const s of [-1, 1]) {
    blob(s * eyeX, face.eyeY + 0.004, 0.062 * face.eyeSize, 0.040 * face.eyeSize, [92, 66, 58], 0.55);
    blob(s * eyeX, face.eyeY + 0.030, 0.070, 0.022, [88, 62, 54], 0.34);   // 上睑褶
    blob(s * eyeX, face.eyeY - 0.030, 0.058, 0.016, [96, 70, 62], 0.26);   // 下睑卧蚕下缘
    blob(s * eyeX, face.eyeY - 0.028, 0.046, 0.011, [255, 238, 224], 0.26, 'screen'); // 卧蚕高光
  }

  /* ---------- 3. 鼻子：鼻梁高光 + 鼻侧阴影 + 鼻头 ---------- */
  // 鼻梁高光：用一串软边椭圆叠出"鼻背弧面"的受光带（不再是硬边矩形长条）
  {
    const bTop = V_NROOT - 0.020, bBot = V_NBASE + 0.042;   // 鼻根 → 鼻头，随解剖基准自动跟随
    const bRX = [0.019, 0.020, 0.019, 0.017, 0.015, 0.012];
    const bRV = [0.015, 0.018, 0.019, 0.019, 0.017, 0.013];
    const bA = [0.05, 0.08, 0.10, 0.11, 0.09, 0.06];
    ctx.save();
    ctx.filter = `blur(${Math.max(1, 0.004 * H).toFixed(1)}px)`;   // 轻微模糊，消除高光带的椭圆边缘
    for (let i = 0; i < bRX.length; i++) {
      const v = lerp(bTop, bBot, i / (bRX.length - 1));
      blob(0, v, bRX[i] * face.noseW, bRV[i], [255, 246, 234], bA[i] * 0.88, 'screen');
    }
    ctx.restore();
    ctx.save();
    ctx.filter = `blur(${Math.max(1, 0.006 * H).toFixed(1)}px)`;
    blob(0, V_BROW + 0.080, 0.078, 0.078, [255, 246, 234], 0.09, 'screen');
    ctx.restore();
    // T 区（眉心→额头下段）整体微提亮，避免鼻梁高光孤零零成一条亮带
    blob(0, V_BROW + 0.080, 0.078, 0.078, [255, 246, 234], 0.09, 'screen');
  }
  ctx.save();
  ctx.filter = `blur(${Math.max(1, 0.005 * H).toFixed(1)}px)`;
  for (const s of [-1, 1]) {
    blob(s * 0.030 * face.noseW, V_NBASE + 0.125, 0.016 * face.noseW, 0.062, [104, 74, 62], 0.26);  // 鼻梁侧影（柔化+降对比）
    blob(s * 0.040 * face.noseW, V_NBASE + 0.040, 0.020 * face.noseW, 0.028, [96, 66, 58], 0.30);   // 鼻翼侧影
    blob(s * 0.026 * face.noseW, V_NBASE - 0.012, 0.015 * face.noseW, 0.012, [58, 34, 30], 0.62);   // 鼻孔
  }
  ctx.restore();
  blob(0, V_NTIP + 0.006, 0.020, 0.016, [255, 240, 226], 0.36, 'screen');   // 鼻头高光
  blob(0, V_NBASE - 0.030, 0.044, 0.014, [92, 62, 54], 0.22);                // 鼻底投影（柔化）
  // 鼻唇沟
  for (const s of [-1, 1]) {
    blob(s * 0.052, V_MOUTH + 0.023, 0.017, 0.048, [98, 70, 60], 0.22 + 0.26 * face.wrinkle);
  }

  /* ---------- 4. 颧骨高光 / 面颊体积 ---------- */
  for (const s of [-1, 1]) {
    blob(s * 0.172, V_EYE + 0.012, 0.055, 0.042, [255, 238, 222], 0.20, 'screen');
    blob(s * 0.185, V_EYE - 0.100, 0.048, 0.055, [118, 90, 78], 0.20);      // 颊部下缘阴影
  }
  blob(0, 0.795, 0.115, 0.045, [255, 242, 228], 0.16, 'screen');     // 额头高光
  blob(0, ANAT.CHIN_V + 0.010, 0.038, 0.030, [255, 238, 222], 0.18, 'screen');     // 下巴高光
  blob(0, ANAT.CHIN_V - 0.036, 0.082, 0.024, [96, 70, 62], 0.26);                 // 下颌下暗部（减弱，避免与颈部出现色差断层）

  /* ---------- 5. 眼睛：眼裂内暗底 + 睫毛线 + 上下睑线 ---------- */
  const eyeW = 0.058 * face.eyeSize;
  const eyeH2 = 0.0245 * face.eyeSize;
  for (const s of [-1, 1]) {
    const cx = s * eyeX;
    // 眼裂内的暗底（眼球几何会盖住中央，只留下睫毛线/眼白边缘）
    ctx.save();
    ctx.beginPath();
    const X = pxOf(cx), Y = pyOf(face.eyeY);
    const RX = eyeW * kx(cx), RY = eyeH2 * H;
    ctx.moveTo(X - RX, Y);
    ctx.quadraticCurveTo(X, Y - RY * 1.35, X + RX, Y - RY * 0.10);
    ctx.quadraticCurveTo(X, Y + RY * 1.15, X - RX, Y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(58,38,32,0.86)';
    ctx.fill();
    ctx.restore();
    // 上睫毛线（粗、深、外眼角上挑）
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(mix(hair, [0, 0, 0], 0.25), 0.92);
    ctx.lineWidth = Math.max(1.2, 0.0052 * H * (0.9 + 0.3 * face.brow));
    path([
      [cx - eyeW * 0.98, face.eyeY - 0.0012],
      [cx, face.eyeY + 0.0165 * face.eyeSize, cx + eyeW * 0.98, face.eyeY + 0.0016]
    ]);
    ctx.stroke();
    // 下睑线（浅）
    ctx.strokeStyle = rgba(mix(skin, [70, 44, 40], 0.55), 0.55);
    ctx.lineWidth = Math.max(1, 0.0026 * H);
    path([
      [cx - eyeW * 0.86, face.eyeY + 0.0022],
      [cx, face.eyeY - 0.0175 * face.eyeSize, cx + eyeW * 0.86, face.eyeY + 0.0024]
    ]);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 6. 眉毛 ---------- */
  const browColor = mix(hair, [0, 0, 0], 0.10);
  for (const s of [-1, 1]) {
    const inner = s * (0.048 * face.eyeGap);
    const outer = s * (0.228 * (0.92 + 0.14 * face.eyeGap));
    const yIn = face.browY - 0.004;
    const yOut = face.browY + 0.012;
    const thick = 0.019 * face.brow;
    const N = 14;
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = lerp(inner, outer, t);
      const y = lerp(yIn, yOut, t) + 0.011 * Math.sin(Math.PI * Math.pow(t, 0.75));
      const w = thick * (0.55 + 0.75 * Math.sin(Math.PI * (0.15 + 0.85 * t))) * (1 - 0.42 * t);
      top.push([x, y + w * 0.5]);
      bot.unshift([x, y + 0.002]);
      bot.push([x, y - w * 0.5]);
    }
    // bot.unshift 会打乱顺序，这里直接按顺序重建
    const shape = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = lerp(inner, outer, t);
      const y = lerp(yIn, yOut, t) + 0.011 * Math.sin(Math.PI * Math.pow(t, 0.75));
      const w = thick * (0.55 + 0.75 * Math.sin(Math.PI * (0.15 + 0.85 * t))) * (1 - 0.42 * t);
      shape[i] = [x, y, w];
    }
    ctx.save();
    path(shape.map(p => [p[0], p[1] + p[2] * 0.5]));
    for (let i = shape.length - 1; i >= 0; i--) ctx.lineTo(pxOf(shape[i][0]), pyOf(shape[i][1] - shape[i][2] * 0.5));
    ctx.closePath();
    ctx.fillStyle = rgba(browColor, 0.90);
    ctx.fill();
    ctx.restore();
    void top; void bot;
    // 眉尾淡出
    blob(outer, lerp(yIn, yOut, 1) + 0.004, 0.026, 0.010, mix(browColor, skin, 0.45), 0.55, 'source-over');
  }

  /* ---------- 7. 嘴 ---------- */
  const mv = V_MOUTH;
  const lipC = mix(skin, [152, 84, 80], 0.42);
  const lipD = mix(lipC, [104, 56, 56], 0.38);
  const lipSoft = mix(lipC, skin, 0.42);   // 唇缘过渡色：与周围肤色接近，避免硬边
  const mwx = 0.062 * face.mouthW;
  // 上唇（含唇珠）
  ctx.save();
  path([
    [-mwx, mv + 0.004],
    [0, mv + 0.036 * face.lipFull, -mwx * 0.55, mv + 0.026 * face.lipFull],
    [0, mv + 0.034 * face.lipFull, mwx * 0.55, mv + 0.026 * face.lipFull],
    [mwx, mv + 0.004]
  ]);
  ctx.lineTo(pxOf(mwx), pyOf(mv - 0.002));
  ctx.lineTo(pxOf(-mwx), pyOf(mv - 0.002));
  ctx.closePath();
  // 羽化底：模糊填充，让唇缘融进皮肤
  ctx.save();
  ctx.filter = `blur(${Math.max(2, 0.010 * H).toFixed(1)}px)`;
  ctx.fillStyle = rgba(lipSoft, 0.55);
  ctx.fill();
  ctx.restore();
  // 主体：略收缩 + 柔边
  ctx.filter = `blur(${Math.max(1, 0.0032 * H).toFixed(1)}px)`;
  ctx.fillStyle = rgba(lipD, 0.62);
  ctx.fill();
  ctx.filter = 'none';
  ctx.restore();
  // 下唇
  ctx.save();
  path([
    [-mwx * 0.96, mv - 0.002],
    [0, mv - 0.040 * face.lipFull, -mwx * 0.5, mv - 0.034 * face.lipFull],
    [0, mv - 0.038 * face.lipFull, mwx * 0.5, mv - 0.034 * face.lipFull],
    [mwx * 0.96, mv - 0.002]
  ]);
  ctx.closePath();
  ctx.save();
  ctx.filter = `blur(${Math.max(2, 0.011 * H).toFixed(1)}px)`;
  ctx.fillStyle = rgba(lipSoft, 0.60);
  ctx.fill();
  ctx.restore();
  ctx.filter = `blur(${Math.max(1, 0.0030 * H).toFixed(1)}px)`;
  ctx.fillStyle = rgba(lipC, 0.58);
  ctx.fill();
  ctx.filter = 'none';
  ctx.restore();
  // 唇面细纹（竖向淡纹，破掉"平涂色块"）
  ctx.save();
  ctx.strokeStyle = rgba(shade(lipD, 0.94), 0.16);
  ctx.lineWidth = Math.max(1, 0.0012 * H);
  for (let i = -6; i <= 6; i++) {
    const x = mwx * 0.82 * (i / 6);
    const wy = Math.abs(i / 6);
    ctx.beginPath();
    ctx.moveTo(pxOf(x), pyOf(mv + 0.002));
    ctx.lineTo(pxOf(x * 0.92), pyOf(mv - 0.030 * face.lipFull * (1 - 0.35 * wy)));
    ctx.stroke();
  }
  ctx.restore();
  // 唇缝
  ctx.save();
  ctx.strokeStyle = rgba(mix(lipD, [42, 20, 22], 0.6), 0.85);
  ctx.lineWidth = Math.max(1.2, 0.0026 * H);
  ctx.lineCap = 'round';
  path([
    [-mwx * 0.98, mv + 0.002],
    [0, mv - 0.0035, -mwx * 0.4, mv + 0.0005],
    [0, mv + 0.001, mwx * 0.4, mv + 0.0015],
    [mwx * 0.98, mv + 0.003]
  ]);
  ctx.stroke();
  ctx.restore();
  // 下唇高光 / 嘴角阴影 / 人中
  blob(0, mv - 0.020, 0.030, 0.014, [255, 236, 226], 0.22, 'screen');
  for (const s of [-1, 1]) {
    blob(s * mwx * 1.02, mv + 0.002, 0.012, 0.012, [86, 54, 50], 0.45);
    blob(s * 0.017, mv + 0.030, 0.007, 0.026, [104, 74, 64], 0.28);
  }
  // 眨眼/笑纹（年长角色）
  for (const s of [-1, 1]) {
    if (face.age > 0.4) {
      blob(s * (eyeX + 0.055), face.eyeY - 0.012, 0.030, 0.014, [96, 68, 58], 0.20 * face.age);
    }
    if (face.wrinkle > 0.45) {
      blob(s * 0.088, V_EYE - 0.128, 0.010, 0.055, [100, 72, 62], 0.16 * face.wrinkle);  // 泪沟
    }
  }
  blob(0, V_BROW + 0.100, 0.055, 0.012, [255, 240, 226], 0.10, 'screen');          // 眉间高光

  /* ---------- 8. 皮肤细节噪声（毛孔/雀斑） ---------- */
  const rnd = mulberry32((face.id * 9176 + 13) | 0);
  // 低频色斑（皮下血色不均，避免整脸塑料平板感；强度压得很淡，不形成可见斑块）
  for (let i = 0; i < 22; i++) {
    const x = (rnd() * 2 - 1) * 0.26;
    const v = 0.14 + rnd() * 0.72;
    const warm = rnd() < 0.6;
    blob(x, v, 0.06 + rnd() * 0.07, 0.06 + rnd() * 0.08,
      warm ? [238, 196, 178] : [206, 172, 164], 0.012 + rnd() * 0.016, 'screen');
  }
  // 高频毛孔/皮纹：更细更淡
  ctx.save();
  for (let i = 0; i < 3200; i++) {
    const x = (rnd() * 2 - 1) * 0.29;
    const v = rnd();
    if (Math.abs(x) > 0.30) continue;
    const dark = rnd() < 0.5;
    ctx.fillStyle = dark ? rgba(shade(skin, 0.86), 0.025 + 0.030 * rnd()) : rgba(shade(skin, 1.10), 0.025 + 0.030 * rnd());
    const r = 0.0009 + rnd() * 0.0018;
    ctx.beginPath();
    ctx.ellipse(pxOf(x), pyOf(v), Math.max(0.5, r * kx(x)), Math.max(0.5, r * H), 0, 0, PI2);
    ctx.fill();
  }
  ctx.restore();

  /* ---------- 9. 胡须 ---------- */
  const beardDensity = Math.max(face.stubble || 0, beard === '无' ? 0 : 0.6);
  const beardTop = a => 0.235 + 0.30 * sstep(0, 1.15, Math.abs(a));
  if (beard === '络腮胡') {
    // 用"密度掩膜 + 上万根毛发笔触"铺胡子：边缘靠密度自然淡出，
    // 不再整片半透明平铺，避免出现"灰色薄纱/贴纸"与硬边遮罩感
    const beardCol = shade(hair, 0.66);
    const mask = (x, v) => {
      const a = Math.asin(clamp(x / HEAD_HWF, -0.999, 0.999));
      const top = beardTop(a);
      let m = sstep(top - 0.052, top, v) * sstep(0.000, 0.018, v);
      m *= 1 - sstep(2.00, 2.34, Math.abs(a));
      const md = Math.hypot(x / (mwx * 1.36), (v - mv + 0.004) / 0.043);
      m *= sstep(1.00, 1.46, md);
      return Math.max(0, Math.min(1, m));
    };
    // 底层（只铺在掩膜中心区，且随掩膜权重衰减）
    for (let px = 0; px < W; px += 2) {
      const x = Math.sin((px / W - 0.5) * PI2) * HEAD_HWF;
      for (let v = 0.004; v < 0.62; v += 0.010) {
        const m = mask(x, v);
        if (m < 0.42) continue;
        ctx.fillStyle = rgba(beardCol, 0.22 * (m - 0.42) / 0.58 + 0.05);
        ctx.fillRect(px, pyOf(v), 2, Math.max(1, 0.010 * H + 1));
      }
    }
    // 细颗粒（1px 级，低对比）：远看是密实的胡青，近看不出现栅栏纹
    for (let i = 0; i < 42000; i++) {
      const a = (rnd() * 2 - 1) * 2.34;
      const x = Math.sin(a) * HEAD_HWF;
      const v = 0.002 + rnd() * 0.60;
      const m = mask(x, v);
      if (rnd() > m * 1.02) continue;
      const dark = rnd() < 0.55;
      ctx.fillStyle = dark
        ? rgba(shade(beardCol, 0.68 + rnd() * 0.24), 0.055 + rnd() * 0.085)
        : rgba(shade(beardCol, 1.10 + rnd() * 0.25), 0.045 + rnd() * 0.070);
      const r = 0.0006 + rnd() * 0.0009;
      ctx.beginPath();
      ctx.ellipse(pxOf(x), pyOf(v), Math.max(0.6, r * kx(x)), Math.max(0.6, r * H), 0, 0, PI2);
      ctx.fill();
    }
    // 极淡的方向性短线（打破均匀颗粒，但对比低到不会形成条纹）
    for (let i = 0; i < 2600; i++) {
      const a = (rnd() * 2 - 1) * 2.30;
      const x = Math.sin(a) * HEAD_HWF;
      const v = 0.002 + rnd() * 0.58;
      const m = mask(x, v);
      if (rnd() > m) continue;
      const X = pxOf(x), Y = pyOf(v);
      const th = -1.30 + (rnd() - 0.5) * 1.9;
      const L = (0.004 + rnd() * 0.010) * H;
      ctx.strokeStyle = rgba(shade(beardCol, 0.62 + rnd() * 0.35), 0.035 + rnd() * 0.055);
      ctx.lineWidth = Math.max(0.8, 0.0008 * H);
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X + Math.cos(th) * L * 0.4, Y + Math.sin(th) * L);
      ctx.stroke();
    }
    // 胡须下缘的自身投影，让下颌有体积
    blob(0, 0.030, 0.080, 0.020, [40, 28, 24], 0.18 * 1, 'multiply');
    // 上唇小胡子：掩膜内密集短笔触，边缘自然、不压到唇线
    const mTop = mv + 0.048 * face.lipFull + 0.006;
    for (let i = 0; i < 5200; i++) {
      const x = (rnd() * 2 - 1) * 0.070;
      const v = mv + 0.024 + rnd() * 0.030;
      const inMask = 1 - sstep(0.030, 0.070, Math.abs(x)) * (rnd() < 0.5 ? 1 : 0.4);
      const edge = sstep(mv + 0.020, mTop, v) * (1 - sstep(mTop - 0.006, mTop, v) * 0.0);
      if (rnd() > inMask * edge) continue;
      ctx.strokeStyle = rgba(shade(beardCol, 0.60 + rnd() * 0.55), 0.07 + rnd() * 0.13);
      ctx.lineWidth = Math.max(0.8, 0.0009 * H);
      ctx.beginPath();
      ctx.moveTo(pxOf(x), pyOf(v));
      ctx.lineTo(pxOf(x) + (rnd() - 0.5) * 2.0, pyOf(v) - (0.002 + rnd() * 0.006));
      ctx.stroke();
    }
  } else if (beard === '山羊胡') {
    blob(0, 0.128, 0.045, 0.055, hair, 0.85, 'source-over');
    blob(0, mv + 0.030, 0.038, 0.014, hair, 0.7, 'source-over');
  }
  // 胡茬颗粒：密度由 stubble / 造型决定
  if (beardDensity > 0.02) {
    ctx.save();
    for (let i = 0; i < 3000 * beardDensity; i++) {
      const a = (rnd() * 2 - 1) * 1.9;
      const x = Math.sin(a) * 0.30;
      const top = beardTop(a) + 0.03;
      const v = rnd() * top;
      // 嘴与鼻翼周围不画胡茬（软过渡，避免出现"灰雾糊嘴"）
      const md = Math.hypot((x) / (mwx * 1.55), (v - mv + 0.004) / 0.055);
      if (md < 1) continue;
      const fade = Math.min(1, (md - 1) / 0.75);
      ctx.fillStyle = rgba(hair, (0.05 + 0.13 * beardDensity * rnd()) * fade);
      const r = 0.0011 + rnd() * 0.0018;
      ctx.beginPath();
      ctx.ellipse(pxOf(x), pyOf(v), Math.max(0.5, r * kx(x)), Math.max(0.5, r * H * 1.4), 0, 0, PI2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 10. 痣 ---------- */
  if (face.mole) {
    const [mx, mv2] = face.mole;
    blob(mx, mv2, 0.010, 0.012, [78, 48, 40], 0.55, 'source-over');
    oval(mx, mv2, 0.0075, 0.0085, rgba(mix([70, 40, 34], hair, 0.3), 0.92), 0.95);
    blob(mx, mv2 + 0.008, 0.007, 0.006, [255, 240, 230], 0.12, 'screen');
  }

  /* ---------- 11. 发际线与头皮：任何角度都不露"光头缝" ---------- */
  const hairlineV = a => hairLineV(a, opt.hairStyle);
  for (let px = 0; px < W; px += 2) {
    const a = (px / W - 0.5) * PI2;
    const yTop = 0;
    const yLine = pyOf(hairlineV(a));
    ctx.fillStyle = rgba(hair, 1);
    ctx.fillRect(px, yTop, 2, Math.max(0, yLine));
    // 发际线柔边
    const g = ctx.createLinearGradient(0, yLine, 0, yLine + H * 0.035);
    g.addColorStop(0, rgba(hair, 0.85));
    g.addColorStop(1, rgba(hair, 0));
    ctx.fillStyle = g;
    ctx.fillRect(px, yLine, 2, H * 0.035);
  }
  // 后脑完整覆盖（斜后视角不露皮肤）
  for (let px = 0; px < W; px += 2) {
    const a = (px / W - 0.5) * PI2;
    if (Math.abs(a) < 1.55) continue;
    const yb = pyOf(0.30);
    ctx.fillStyle = rgba(hair, 0.96);
    ctx.fillRect(px, pyOf(hairlineV(a)), 2, Math.max(0, yb - pyOf(hairlineV(a))));
  }

  /* ---------- 12. 收尾：四周接缝羽化，避免 wrap 处出现硬边 ---------- */
  const edge = ctx.createLinearGradient(0, 0, W * 0.04, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, W * 0.04, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.name = 'headUV_' + key;
  texCache.set(key, tex);
  if (typeof window !== 'undefined') {
    window.__headTextures = window.__headTextures || {};
    window.__headTextures[key] = cv;
  }
  return tex;
}

export function clearFaceTextureCache() { texCache.clear(); }
