/**
 * 《特种守护》 - 全局配置
 * 武器价格 = 参考民用市场售价（美元）÷ 10 取整
 */

export const GAME_TITLE = '特种守护';
export const SAVE_KEY = 'special_guard_save_v1';
export const CLEAR_REWARD = 100;      // 每次通关奖励游戏币
export const NPC_HP = 100;            // 人物基础血量
export const HEADSHOT_MULT = 2.5;     // 爆头伤害倍率

/* ------------------------------------------------------------------ *
 * 人物外观开关（换皮回退用）
 *  NPC_STYLE = 'portrait' → 使用 assets/portraits/npc01..06.png 写实像素立绘
 *  NPC_STYLE = 'model'    → 使用 character.js 原来的 3D 人形模型
 * 两套外观共用同一套命中盒、AI、罪犯判定，改这一个常量即可整体回退。
 * ------------------------------------------------------------------ */
export const NPC_STYLE = 'portrait';
/* 回退开关：默认 'portrait'（像素立绘）。
 * 想恢复原来的 3D 模型人物，把上面 NPC_STYLE 改成 'model'，
 * 或者不改代码、直接在网址后加 ?npc=model 临时切回。 */
const _qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const USE_PORTRAIT_NPC = (_qs && _qs.get('npc') === 'model') ? false : NPC_STYLE === 'portrait';

/* ------------------------------------------------------------------ *
 * 像素化后期
 *  PIXEL_SCALE < 1 时，3D 场景按降采样分辨率渲染，再由 CSS(pixelated) 放大，
 *  得到统一的像素颗粒感。只影响 WebGL canvas，HUD/面板/弹窗全部是 DOM，
 *  始终按 devicePixelRatio 清晰渲染，不会被模糊。
 *  1 = 关闭（等比原生分辨率）
 * ------------------------------------------------------------------ */
export const PIXEL_SCALE = 0.6;

/* ------------------------------------------------------------------ *
 * 武器库：1 把免费左轮 + 5 手枪 + 5 步枪 + 5 狙击枪
 * dmg 单发伤害 / rpm 理论射速 / mag 弹匣容量 / reload 换弹秒
 * recoil 后坐力强度 / spread 腰射散布(度) / ads 是否可开镜 / zoom 开镜倍率
 * auto 是否全自动 / bolt 是否单发拉栓
 * ------------------------------------------------------------------ */
export const WEAPONS = [
  // ---- 起始武器 ----
  {
    id: 'revolver', name: '基础左轮手枪', cls: '手枪', price: 0, refPrice: '配发制式（免费）',
    dmg: 70, rpm: 120, mag: 6, reload: 2.8, recoil: 3.0, spread: 1.6,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'revolver', len: 0.30, bodyW: 0.055, barrel: 0.22 },
    desc: '开局配发的六发转轮手枪，威力尚可但装填慢、后坐明显。'
  },
  // ---- 5 把手枪 ----
  {
    id: 'glock17', name: 'Glock 17', cls: '手枪', price: 60, refPrice: '≈600 美元',
    dmg: 40, rpm: 320, mag: 17, reload: 1.8, recoil: 1.3, spread: 1.3,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'pistol', len: 0.30, bodyW: 0.05, barrel: 0.19 },
    desc: '可靠的勤务手枪，弹匣大、射速快，适合近距连点。'
  },
  {
    id: 'sigp320', name: 'SIG P320', cls: '手枪', price: 60, refPrice: '≈600 美元',
    dmg: 42, rpm: 300, mag: 15, reload: 1.9, recoil: 1.4, spread: 1.2,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'pistol', len: 0.31, bodyW: 0.052, barrel: 0.20 },
    desc: '模块化设计，握持稳定，精度略优于同级。'
  },
  {
    id: 'beretta92', name: 'Beretta 92FS', cls: '手枪', price: 70, refPrice: '≈700 美元',
    dmg: 45, rpm: 280, mag: 15, reload: 2.0, recoil: 1.4, spread: 1.3,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'pistol', len: 0.33, bodyW: 0.05, barrel: 0.225 },
    desc: '经典开窗式套筒手枪，威力更足，节奏偏慢。'
  },
  {
    id: 'cz75', name: 'CZ 75', cls: '手枪', price: 70, refPrice: '≈700 美元',
    dmg: 46, rpm: 270, mag: 16, reload: 2.0, recoil: 1.2, spread: 1.0,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'pistol', len: 0.32, bodyW: 0.048, barrel: 0.21 },
    desc: '全钢结构，后坐柔和、散布极小，适合爆头。'
  },
  {
    id: 'deagle', name: 'Desert Eagle', cls: '手枪', price: 180, refPrice: '≈1800 美元',
    dmg: 95, rpm: 140, mag: 7, reload: 2.7, recoil: 4.5, spread: 1.8,
    ads: true, zoom: 1.20, auto: false, bolt: false,
    model: { kind: 'pistol', len: 0.40, bodyW: 0.07, barrel: 0.27 },
    desc: '大口径手枪，两枪即可放倒目标，但后坐极大。'
  },
  // ---- 5 把步枪 ----
  {
    id: 'ar15', name: 'AR-15', cls: '步枪', price: 90, refPrice: '≈900 美元',
    dmg: 55, rpm: 700, mag: 30, reload: 2.2, recoil: 1.1, spread: 1.1,
    ads: true, zoom: 1.4, auto: true, bolt: false,
    model: { kind: 'rifle', len: 0.72, bodyW: 0.06, barrel: 0.34, stock: true },
    desc: '通用性极强的入门步枪，后坐小、射速快。'
  },
  {
    id: 'ak47', name: 'AK-47', cls: '步枪', price: 110, refPrice: '≈1100 美元',
    dmg: 65, rpm: 600, mag: 30, reload: 2.5, recoil: 1.8, spread: 1.4,
    ads: true, zoom: 1.4, auto: true, bolt: false,
    model: { kind: 'rifle', len: 0.76, bodyW: 0.062, barrel: 0.38, stock: true, wood: true },
    desc: '大威力老将，两枪致命，代价是明显的枪口跳动。'
  },
  {
    id: 'auga3', name: 'AUG A3', cls: '步枪', price: 200, refPrice: '≈2000 美元',
    dmg: 58, rpm: 680, mag: 30, reload: 2.3, recoil: 0.9, spread: 1.0,
    ads: true, zoom: 1.6, auto: true, bolt: false,
    model: { kind: 'rifle', len: 0.70, bodyW: 0.062, barrel: 0.33, bullpup: true },
    desc: '无托结构，重心靠后，自带 1.6 倍光学瞄具。'
  },
  {
    id: 'scarl', name: 'SCAR-L', cls: '步枪', price: 300, refPrice: '≈3000 美元',
    dmg: 62, rpm: 620, mag: 30, reload: 2.2, recoil: 1.2, spread: 1.0,
    ads: true, zoom: 1.6, auto: true, bolt: false,
    model: { kind: 'rifle', len: 0.74, bodyW: 0.064, barrel: 0.36, stock: true },
    desc: '特种作战常用平台，伤害与稳定性均衡。'
  },
  {
    id: 'hk416', name: 'HK416', cls: '步枪', price: 350, refPrice: '≈3500 美元',
    dmg: 58, rpm: 750, mag: 30, reload: 2.0, recoil: 0.8, spread: 0.9,
    ads: true, zoom: 1.6, auto: true, bolt: false,
    model: { kind: 'rifle', len: 0.73, bodyW: 0.063, barrel: 0.35, stock: true },
    desc: '短行程活塞结构，弹道极稳，连发最好控。'
  },
  // ---- 5 把狙击枪（全部支持开镜） ----
  {
    id: 'rem700', name: 'Remington 700', cls: '狙击枪', price: 90, refPrice: '≈900 美元',
    dmg: 110, rpm: 45, mag: 5, reload: 3.0, recoil: 4.0, spread: 0.15,
    ads: true, zoom: 4, auto: false, bolt: true,
    model: { kind: 'sniper', len: 0.95, bodyW: 0.06, barrel: 0.52, stock: true, scope: 0.34 },
    desc: '入门栓动狙击枪，一枪致命，需手动拉栓。'
  },
  {
    id: 'svd', name: 'SVD', cls: '狙击枪', price: 200, refPrice: '≈2000 美元',
    dmg: 95, rpm: 130, mag: 10, reload: 3.2, recoil: 3.0, spread: 0.25,
    ads: true, zoom: 4, auto: false, bolt: false,
    model: { kind: 'sniper', len: 0.98, bodyW: 0.062, barrel: 0.54, stock: true, wood: true, scope: 0.30 },
    desc: '半自动狙击枪，射速快，适合连续处理多个目标。'
  },
  {
    id: 'awm', name: 'AWM', cls: '狙击枪', price: 600, refPrice: '≈6000 美元',
    dmg: 135, rpm: 42, mag: 5, reload: 3.6, recoil: 4.2, spread: 0.12,
    ads: true, zoom: 6, auto: false, bolt: true,
    model: { kind: 'sniper', len: 1.02, bodyW: 0.062, barrel: 0.58, stock: true, scope: 0.38 },
    desc: '高精度栓动狙击步枪，6 倍镜覆盖整条街区。'
  },
  {
    id: 'm82', name: 'Barrett M82A1', cls: '狙击枪', price: 900, refPrice: '≈9000 美元',
    dmg: 170, rpm: 35, mag: 10, reload: 4.4, recoil: 6.0, spread: 0.18,
    ads: true, zoom: 5, auto: false, bolt: false,
    model: { kind: 'sniper', len: 1.14, bodyW: 0.075, barrel: 0.62, stock: true, scope: 0.36, muzzleBrake: true },
    desc: '反器材步枪，任何部位命中基本即倒，后坐惊人。'
  },
  {
    id: 'm200', name: 'CheyTac M200', cls: '狙击枪', price: 1200, refPrice: '≈12000 美元',
    dmg: 200, rpm: 30, mag: 7, reload: 4.6, recoil: 5.0, spread: 0.08,
    ads: true, zoom: 8, auto: false, bolt: true,
    model: { kind: 'sniper', len: 1.20, bodyW: 0.064, barrel: 0.66, stock: true, scope: 0.42 },
    desc: '顶级远距离系统，8 倍镜、极高伤害与极低散布。'
  }
];

export const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

/* ------------------------------------------------------------------ *
 * 10 个关卡
 * ------------------------------------------------------------------ */
export const LEVELS = [
  { id: 1,  name: '街区初战',       scene: 'street', criminals: 1, civilians: 8,  time: 180, tutorial: true },
  { id: 2,  name: '街面追踪',       scene: 'street', criminals: 1, civilians: 10, time: 150 },
  { id: 3,  name: '双人通缉',       scene: 'street', criminals: 2, civilians: 12, time: 150 },
  { id: 4,  name: '午夜酒吧',       scene: 'bar',    criminals: 2, civilians: 14, time: 130 },
  { id: 5,  name: '吧台三人组',     scene: 'bar',    criminals: 3, civilians: 16, time: 120 },
  { id: 6,  name: '酒吧清场',       scene: 'bar',    criminals: 3, civilians: 18, time: 110 },
  { id: 7,  name: '公园围捕',       scene: 'park',   criminals: 4, civilians: 20, time: 100 },
  { id: 8,  name: '公园追逃',       scene: 'park',   criminals: 4, civilians: 22, time: 90  },
  { id: 9,  name: '公园五人组',     scene: 'park',   criminals: 5, civilians: 25, time: 80  },
  { id: 10, name: '夜间街区大案',   scene: 'night',  criminals: 5, civilians: 28, time: 70  }
];

export const SCENE_LABEL = {
  street: '街道',
  bar: '酒吧',
  park: '公园',
  night: '夜间街区'
};

/* ------------------------------------------------------------------ *
 * 人物外观素材池（通缉令与场景共用同一套参数）
 * ------------------------------------------------------------------ */
export const SKIN_TONES = [
  { n: '白皙', c: '#e9c6a4' },
  { n: '浅棕', c: '#d8b189' },
  { n: '小麦色', c: '#c39a69' },
  { n: '古铜色', c: '#a97a52' },
  { n: '深棕色', c: '#84573a' },
  { n: '黑褐色', c: '#5f3d29' }
];

export const UPPER_COLORS = [
  { n: '深蓝', c: '#25415e' },
  { n: '藏青', c: '#1c2a44' },
  { n: '墨绿', c: '#2c4436' },
  { n: '酒红', c: '#6a2530' },
  { n: '棕色', c: '#5b3d2b' },
  { n: '黑色', c: '#1b1b1f' },
  { n: '灰色', c: '#7c7f85' },
  { n: '米白', c: '#cfc7b6' },
  { n: '橙色', c: '#b1552a' },
  { n: '紫色', c: '#4a3560' },
  { n: '天蓝', c: '#3f7ba8' },
  { n: '浅粉', c: '#c98f96' }
];

export const PANTS_COLORS = [
  { n: '深蓝牛仔', c: '#2c3a52' },
  { n: '黑色', c: '#1e1e22' },
  { n: '卡其', c: '#8a7a5c' },
  { n: '深灰', c: '#4a4d52' },
  { n: '军绿', c: '#3d4a35' }
];

export const HAIR_STYLES = ['短发', '寸头', '背头', '中长发', '马尾', '卷发', '秃顶'];
export const HAIR_COLORS = ['黑色', '深棕', '浅棕', '栗色', '花白'];
export const HAIR_COLOR_HEX = {
  '黑色': '#181413', '深棕': '#2b1c14', '浅棕': '#5a3d24', '栗色': '#3b2418', '花白': '#9a958d'
};
export const BEARD_STYLES = ['无', '胡茬', '络腮胡', '山羊胡'];
export const HATS = ['无', '鸭舌帽', '渔夫帽'];
export const BUILDS = [
  { n: '偏瘦', w: 0.90 },
  { n: '中等', w: 1.00 },
  { n: '壮实', w: 1.13 }
];

/* 场景配置：可行走范围、NPC 数量上限等 */
export const WORLD = {
  street: { size: 44, bounds: 19.5 },
  bar:    { size: 30, bounds: 12.0 },
  park:   { size: 46, bounds: 20.5 },
  night:  { size: 44, bounds: 19.5 }
};
