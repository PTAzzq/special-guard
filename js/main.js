/**
 * 入口：装配游戏与界面，处理加载、横竖屏与鼠标锁定提示
 */
import { Game } from './game.js';
import { createUI } from './ui.js';
import { LEVELS } from './config.js';
import { preloadPortraits } from './pixelart.js';

const canvas = document.getElementById('game');
const elLoading = document.getElementById('loading');
const elRotate = document.getElementById('rotate-tip');

// 仅当主输入指针为触摸（手机/平板）时才走触屏逻辑；带触摸屏的笔记本主指针是鼠标，按桌面处理
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const IS_TOUCH = COARSE && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

let game = null;
let ui = null;

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  elRotate.classList.toggle('hidden', !(IS_TOUCH && portrait));
}

function boot() {
  try {
    game = new Game(canvas);
    ui = createUI(game);
    game.hooks = ui.hooks;
    ui.refreshMenu();

    // 鼠标锁定失败提示（例如浏览器冷却期内）
    document.addEventListener('pointerlockerror', () => {
      if (game.state === 'playing' && !IS_TOUCH) {
        ui.toast('鼠标未锁定，点击画面即可恢复视角控制', 'bad');
      }
    });

    // 首次运行给出提示
    requestAnimationFrame(() => {
      elLoading.classList.add('hidden');
      document.getElementById('screen-main').classList.remove('hidden');
      ui.toast(IS_TOUCH ? '已识别触屏设备，建议横屏游玩' : '建议使用鼠标键盘游玩，点击画面锁定视角', '');
    });

    // 全局异常提示，避免白屏无反馈
    window.addEventListener('error', ev => {
      console.error(ev.error || ev.message);
    });

    // 自动化测试入口：index.html?level=1 直接开局（正常游玩不需要该参数）
    const autoLv = parseInt(new URLSearchParams(location.search).get('level') || '', 10);
    if (autoLv >= 1) {
      const lv = LEVELS.find(l => l.id === autoLv) || LEVELS[autoLv - 1];
      if (lv) setTimeout(() => ui.startLevel(lv), 260);
    }
  } catch (err) {
    console.error(err);
    elLoading.innerHTML = `<div class="loading-inner">
      <div class="loading-title">启动失败</div>
      <div class="loading-sub" style="color:#ff6a5e;letter-spacing:0">${String(err && err.message || err)}</div>
      <div class="loading-sub">请用本地 http 服务打开（start.bat），直接双击 index.html 无法加载 ES 模块</div>
    </div>`;
  }
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 220));
checkOrientation();

// 让加载页至少停留一小段时间，避免闪烁。
// 立绘必须先就位：通缉令头像是用 canvas 同步合成的，缺图会退化成色块。
setTimeout(() => {
  const bootSafely = () => boot();
  preloadPortraits()
    .then(bootSafely)
    .catch(err => {
      console.warn('[portrait] 立绘预加载异常，按缺图降级启动', err);
      bootSafely();
    });
}, 320);

// 方便调试
window.__guard = () => ({ game, ui, LEVELS, IS_TOUCH });
