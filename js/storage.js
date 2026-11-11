/** localStorage 存档：货币、已购枪械、装备、关卡解锁与统计 */
import { SAVE_KEY, LEVELS } from './config.js';

const DEFAULT_SAVE = () => ({
  coins: 0,
  owned: ['revolver'],
  equipped: 'revolver',
  unlocked: 1,
  cleared: {},          // {levelId: {best: 秒, times: n}}
  stats: { shots: 0, hits: 0, headshots: 0, criminals: 0, civilians: 0, clears: 0, fails: 0 },
  lastLevel: 1
});

let cache = null;

export function loadSave() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { cache = DEFAULT_SAVE(); persist(); return cache; }
    const data = JSON.parse(raw);
    cache = Object.assign(DEFAULT_SAVE(), data);
    cache.stats = Object.assign(DEFAULT_SAVE().stats, data.stats || {});
    if (!Array.isArray(cache.owned) || !cache.owned.includes('revolver')) cache.owned = ['revolver', ...(cache.owned || [])];
    cache.unlocked = Math.max(1, Math.min(LEVELS.length, cache.unlocked || 1));
    return cache;
  } catch (e) {
    console.warn('存档读取失败，已重建', e);
    cache = DEFAULT_SAVE();
    return cache;
  }
}

export function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('存档写入失败', e);
  }
}

export function addCoins(n) {
  const s = loadSave();
  s.coins = Math.max(0, s.coins + n);
  persist();
  return s.coins;
}

export function buyWeapon(id, price) {
  const s = loadSave();
  if (s.owned.includes(id)) return { ok: false, msg: '已拥有该武器' };
  if (s.coins < price) return { ok: false, msg: '游戏币不足' };
  s.coins -= price;
  s.owned.push(id);
  persist();
  return { ok: true, msg: '购买成功' };
}

export function equipWeapon(id) {
  const s = loadSave();
  if (!s.owned.includes(id)) return false;
  s.equipped = id;
  persist();
  return true;
}

export function recordClear(levelId, timeLeft) {
  const s = loadSave();
  const rec = s.cleared[levelId] || { best: 0, times: 0 };
  rec.times += 1;
  rec.best = Math.max(rec.best, Math.round(timeLeft));
  s.cleared[levelId] = rec;
  s.stats.clears += 1;
  s.coins += 100;
  if (levelId >= s.unlocked && levelId < LEVELS.length) s.unlocked = levelId + 1;
  s.lastLevel = Math.min(LEVELS.length, levelId + 1);
  persist();
  return s;
}

export function recordFail() {
  const s = loadSave();
  s.stats.fails += 1;
  persist();
}

export function resetSave() {
  cache = DEFAULT_SAVE();
  persist();
  return cache;
}
