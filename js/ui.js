/**
 * 界面层：菜单、武器库、关卡、简报、通缉令、HUD、结算、触屏控制
 */
import { LEVELS, WEAPONS, WEAPONS_BY_ID, SCENE_LABEL, CLEAR_REWARD } from './config.js';
import { loadSave, buyWeapon, equipWeapon, recordClear, recordFail, resetSave } from './storage.js';
import { makeWantedEntry } from './wanted.js';
import { makeNpcApps } from './game.js';
import { fmtTime, clamp } from './utils.js';

const $ = id => document.getElementById(id);
// 仅当主输入指针为触摸（手机/平板）时才走触屏逻辑；带触摸屏的笔记本主指针是鼠标，按桌面处理
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const IS_TOUCH = COARSE && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

const SCREENS = ['screen-main', 'screen-armory', 'screen-levels', 'screen-brief', 'screen-result', 'screen-pause'];

function bar(label, ratio, valueText) {
  const r = clamp(ratio, 0, 1);
  return `<div class="stat-row"><span class="s-name">${label}</span>
    <span class="stat-bar"><i style="width:${(r * 100).toFixed(0)}%"></i></span>
    <span class="s-val">${valueText}</span></div>`;
}

export function createUI(game) {
  let currentLevel = null;
  let wantedOpen = false;
  let wantedCache = new Map();   // levelId -> entries

  /* ------------------------- 屏幕切换 ------------------------- */
  function hideAllScreens() {
    SCREENS.forEach(id => $(id).classList.add('hidden'));
  }
  function showScreen(id) {
    hideAllScreens();
    $(id).classList.remove('hidden');
  }
  function hideHud() {
    $('hud').classList.add('hidden');
    $('touch-controls').classList.add('hidden');
    closeWanted(true);
  }
  function showHud() {
    $('hud').classList.remove('hidden');
    if (IS_TOUCH) $('touch-controls').classList.remove('hidden');
  }

  /* ------------------------- 主菜单 ------------------------- */
  function refreshMenu() {
    const s = loadSave();
    $('menu-coins').textContent = s.coins;
    const w = WEAPONS_BY_ID[s.equipped] || WEAPONS_BY_ID.revolver;
    $('menu-equipped').textContent = w.name;
    const lv = Math.min(LEVELS.length, s.unlocked);
    $('btn-play').textContent = s.stats.clears > 0 ? `继续行动 · 第 ${lv} 关` : '开始行动';
  }

  /* ------------------------- 武器库 ------------------------- */
  const GROUPS = [
    { key: '起始配发', match: w => w.id === 'revolver' },
    { key: '手枪', match: w => w.cls === '手枪' && w.id !== 'revolver' },
    { key: '步枪', match: w => w.cls === '步枪' },
    { key: '狙击枪', match: w => w.cls === '狙击枪' }
  ];

  function refreshArmory() {
    const s = loadSave();
    $('armory-coins').textContent = s.coins;
    const host = $('armory-groups');
    host.innerHTML = '';

    GROUPS.forEach(g => {
      const list = WEAPONS.filter(g.match);
      if (!list.length) return;
      const wrap = document.createElement('div');
      wrap.className = 'arm-group';
      wrap.innerHTML = `<div class="arm-group-title">${g.key}<span style="font-size:11px;color:#767d87;letter-spacing:0">${list.length} 款</span></div>`;
      const cards = document.createElement('div');
      cards.className = 'arm-cards';

      list.forEach(w => {
        const owned = s.owned.includes(w.id);
        const equipped = s.equipped === w.id;
        const card = document.createElement('div');
        card.className = 'gun-card' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '');
        const badge = equipped ? '<span class="gun-badge eq">已装备</span>'
          : owned ? '<span class="gun-badge on">已购</span>' : '';

        const tags = [];
        if (w.auto) tags.push('全自动');
        if (w.bolt) tags.push('栓动单发');
        tags.push(w.ads ? `可开镜 ${w.zoom}×` : '无瞄具');

        card.innerHTML = `
          ${badge}
          <div class="gun-name">${w.name}<span class="gun-cn">${w.cls}</span></div>
          <div class="gun-stats">
            ${bar('伤害', w.dmg / 140, w.dmg)}
            ${bar('射速', w.rpm / 900, w.rpm + ' rpm')}
            ${bar('弹匣', w.mag / 50, w.mag + ' 发')}
            ${bar('换弹', 1 - clamp((w.reload - 1.5) / 2.2, 0, 1), w.reload + ' s')}
            ${bar('后坐', 1 - clamp(w.recoil / 5, 0, 1), w.recoil.toFixed(1))}
            ${bar('精度', 1 - clamp(w.spread / 2.6, 0, 1), w.spread.toFixed(1))}
          </div>
          <div class="gun-tags">${tags.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="gun-foot">
            <span class="gun-price ${w.price === 0 ? 'free' : ''}">${w.price === 0 ? '免费' : w.price + ' 币'}</span>
            <button class="${owned ? (equipped ? 'gun-buy owned-btn' : 'gun-buy equip-btn') : 'gun-buy'}"
              data-id="${w.id}" ${equipped ? 'disabled' : ''}>
              ${equipped ? '使用中' : owned ? '装备' : (s.coins >= w.price ? '购买' : '币不足')}
            </button>
          </div>`;

        const btn = card.querySelector('button');
        btn.addEventListener('click', () => {
          const st = loadSave();
          if (st.owned.includes(w.id)) {
            equipWeapon(w.id);
            toast(`已装备 ${w.name}`, 'good');
          } else {
            const r = buyWeapon(w.id, w.price);
            if (r.ok) {
              equipWeapon(w.id);
              toast(`购买成功：${w.name}`, 'good');
            } else {
              toast(r.msg, 'bad');
            }
          }
          refreshArmory();
          refreshMenu();
        });
        cards.appendChild(card);
      });

      wrap.appendChild(cards);
      host.appendChild(wrap);
    });
  }

  /* ------------------------- 关卡选择 ------------------------- */
  function refreshLevels() {
    const s = loadSave();
    $('levels-coins').textContent = s.coins;
    const host = $('level-grid');
    host.innerHTML = '';
    LEVELS.forEach(lv => {
      const locked = lv.id > s.unlocked;
      const cleared = !!s.cleared[lv.id];
      const card = document.createElement('div');
      card.className = 'level-card' + (locked ? ' locked' : '') + (cleared ? ' cleared' : '');
      const flag = locked ? '<span class="lv-flag lock">未解锁</span>'
        : lv.tutorial ? '<span class="lv-flag tut">教学</span>'
          : cleared ? '<span class="lv-flag">已通关</span>' : '';
      card.innerHTML = `${flag}
        <div class="lv-top"><span class="lv-no">${String(lv.id).padStart(2, '0')}</span><span class="lv-scene">${SCENE_LABEL[lv.scene]}</span></div>
        <div class="lv-info">
          ${lv.name}<br>
          通缉 <b>${lv.criminals}</b> · 平民 <b>${lv.civilians}</b> · 时限 <b>${lv.time}s</b>
        </div>`;
      if (!locked) {
        card.addEventListener('click', () => showBrief(lv));
      } else {
        card.addEventListener('click', () => toast('通过上一关后解锁', 'bad'));
      }
      host.appendChild(card);
    });
  }

  /* ------------------------- 通缉令渲染 ------------------------- */
  function getWantedEntries(level) {
    if (wantedCache.has(level.id)) return wantedCache.get(level.id);
    const { criminalApps } = makeNpcApps(level);
    const entries = criminalApps.map((app, i) => makeWantedEntry(app, i));
    wantedCache.set(level.id, entries);
    return entries;
  }

  function wantedCardHtml(e) {
    // 立绘模式的头像是整身像，用 pf-portrait 切到 contain，避免被 cover 裁掉关键识别特征
    const imgCls = e.portrait ? ' class="pf-portrait"' : '';
    return `<div class="wcard">
      <div class="wcard-photo"><img${imgCls} src="${e.avatar}" alt="目标 ${e.index + 1}"><span class="wcard-tag">WANTED</span></div>
      <div class="wcard-body">
        <div class="wcard-no">目标 ${String(e.index + 1).padStart(2, '0')}</div>
        <div class="wcard-feat">${e.features.map(f => `<div>· ${f}</div>`).join('')}</div>
      </div>
    </div>`;
  }

  function renderWantedInto(hostEl, level, compact) {
    const entries = getWantedEntries(level);
    hostEl.className = 'wanted-list' + (compact ? ' compact' : '');
    hostEl.innerHTML = entries.map(wantedCardHtml).join('');
    return entries;
  }

  /* ------------------------- 关卡简报 ------------------------- */
  function showBrief(level) {
    currentLevel = level;
    const s = loadSave();
    const w = WEAPONS_BY_ID[s.equipped] || WEAPONS_BY_ID.revolver;
    $('brief-title').textContent = `第 ${level.id} 关 · ${level.name}`;
    $('brief-scene').textContent = SCENE_LABEL[level.scene];
    $('brief-criminals').textContent = `${level.criminals} 人`;
    $('brief-civilians').textContent = `${level.civilians} 人`;
    $('brief-time').textContent = `${level.time} 秒`;
    $('brief-weapon').textContent = w.name;
    renderWantedInto($('brief-wanted'), level, true);
    showScreen('screen-brief');
    hideHud();
  }

  function startLevel(level) {
    const s = loadSave();
    currentLevel = level;
    hideAllScreens();
    hideHud();
    showHud();
    game.start(level, s.equipped);
    game.beginPlay();
    $('tutorial-hint').classList.toggle('hidden', !level.tutorial);
  }

  /* ------------------------- 结算 ------------------------- */
  function showResult(res) {
    hideAllScreens();
    hideHud();
    const save = loadSave();
    const badge = $('result-badge');
    const lvl = res.level;
    if (res.win) {
      badge.textContent = '任务完成';
      badge.classList.remove('fail');
      $('result-reason').textContent = `第 ${lvl.id} 关 · ${lvl.name} — 通缉目标已全部清除`;
    } else {
      badge.textContent = '任务失败';
      badge.classList.add('fail');
      $('result-reason').textContent = res.reason === 'civilian'
        ? '误杀平民 — 行动被立即中止'
        : '计时归零 — 通缉目标已逃脱';
    }

    const items = [
      ['剩余时间', fmtTime(res.timeLeft), ''],
      ['命中率', res.accuracy + '%', ''],
      ['爆头数', res.headshots, ''],
      ['击毙罪犯', `${res.criminalKilled}/${res.criminals}`, ''],
      ['误杀平民', res.civilianKilled, res.civilianKilled > 0 ? 'bad' : ''],
      ['本关奖励', res.win ? `+${CLEAR_REWARD}` : '+0', res.win ? 'gold' : '']
    ];
    $('result-stats').innerHTML = items.map(([k, v, cls]) =>
      `<div class="rs-item"><div class="rs-v ${cls === 'gold' ? 'gold' : ''}" ${cls === 'bad' ? 'style="color:#ff6a5e"' : ''}>${v}</div><div class="rs-k">${k}</div></div>`
    ).join('');

    const nextBtn = $('btn-result-next');
    const nextLevel = LEVELS.find(l => l.id === lvl.id + 1);
    if (res.win && nextLevel && nextLevel.id <= save.unlocked) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = `下一关 · ${nextLevel.name}`;
      nextBtn.onclick = () => showBrief(nextLevel);
    } else if (res.win && !nextLevel) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = '全部关卡已通关';
      nextBtn.onclick = () => showScreen('screen-main') || refreshMenu();
    } else {
      nextBtn.classList.add('hidden');
    }

    $('btn-result-retry').onclick = () => startLevel(lvl);
    $('btn-result-menu').onclick = () => { refreshMenu(); showScreen('screen-main'); };

    showScreen('screen-result');
    refreshMenu();
  }

  /* ------------------------- 通缉令面板（局内） ------------------------- */
  function openWanted() {
    if (!currentLevel) return;
    renderWantedInto($('wanted-list'), currentLevel, false);
    $('wanted-sub').textContent = `本局共 ${currentLevel.criminals} 名目标 · 依特征在人群中辨认后开火`;
    $('wanted-overlay').classList.remove('hidden');
    wantedOpen = true;
    game.lockedOut = true;
  }
  function closeWanted(force) {
    if (!wantedOpen && !force) return;
    $('wanted-overlay').classList.add('hidden');
    wantedOpen = false;
    game.lockedOut = false;
  }
  function toggleWanted() {
    if (wantedOpen) closeWanted(); else openWanted();
  }

  /* ------------------------- 提示 / 命中 ------------------------- */
  let toastTimer = null;
  function toast(text, kind = '') {
    const area = $('toast-area');
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    area.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .3s';
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 320);
    }, 1400);
    while (area.children.length > 3) area.firstChild.remove();
  }

  function hitmarker(kind) {
    const hm = $('hitmarker');
    hm.className = '';
    void hm.offsetWidth;
    hm.className = 'show' + (kind === 'head' ? ' head' : kind === 'civil' ? ' civil' : '');
  }

  /* ------------------------- HUD ------------------------- */
  function onHud(d) {
    const t = $('hud-timer');
    t.textContent = fmtTime(d.time);
    t.classList.toggle('warn', d.time <= 15);
    $('hud-criminals').textContent = `${d.criminalsLeft} / ${d.criminalsTotal}`;
    $('hud-civilians').textContent = d.civiliansAlive;
    $('hud-ammo').textContent = d.ammo;
    $('hud-mag').textContent = d.mag;
    document.querySelector('.ammo-num').classList.toggle('empty', d.ammo === 0);
    $('hud-weapon').textContent = d.weaponName;
    $('hud-cls').textContent = d.weaponClass;
    $('hud-level-name').textContent = d.levelName;
    $('hud-level-id').textContent = String(d.levelId).padStart(2, '0');

    const rb = $('reload-bar');
    if (d.reloading) {
      rb.classList.remove('hidden');
      $('reload-fill').style.width = (clamp(d.reloadProgress, 0, 1) * 100).toFixed(0) + '%';
    } else {
      rb.classList.add('hidden');
    }

    // 开镜视觉
    const scoped = d.isScope && d.ads > 0.72;
    $('scope-overlay').classList.toggle('hidden', !scoped);
    $('scope-overlay').classList.toggle('active', scoped);
    $('crosshair').classList.toggle('ads', d.ads > 0.55);
    $('tutorial-hint').classList.toggle('hidden', !d.tutorial || d.time < 0.1);
  }

  /* ------------------------- 触屏 ------------------------- */
  function initTouch() {
    const joy = $('joystick');
    const knob = $('joystick-knob');
    const zone = $('look-zone');
    let joyId = null, joyCX = 0, joyCY = 0;
    const R = 46;

    function joyStart(e) {
      const t = e.changedTouches[0];
      const rect = joy.getBoundingClientRect();
      joyCX = rect.left + rect.width / 2;
      joyCY = rect.top + rect.height / 2;
      joyId = t.identifier;
      joyMove(e);
      e.preventDefault();
    }
    function joyMove(e) {
      if (joyId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        game.setTouchMove(dx / R, dy / R);
      }
      e.preventDefault();
    }
    function joyEnd(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyId = null;
          knob.style.transform = 'translate(0,0)';
          game.setTouchMove(0, 0);
        }
      }
    }
    joy.addEventListener('touchstart', joyStart, { passive: false });
    joy.addEventListener('touchmove', joyMove, { passive: false });
    joy.addEventListener('touchend', joyEnd);
    joy.addEventListener('touchcancel', joyEnd);

    // 视角拖动
    let lookId = null, lastX = 0, lastY = 0;
    zone.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    }, { passive: true });
    zone.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        const dx = t.clientX - lastX, dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        if (game.state === 'playing') game.lookBy(dx, dy);
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchend', e => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    });

    // 开火
    const fireBtn = $('btn-touch-fire');
    fireBtn.addEventListener('touchstart', e => { game.setFireHeld(true); e.preventDefault(); }, { passive: false });
    fireBtn.addEventListener('touchend', e => { game.setFireHeld(false); e.preventDefault(); }, { passive: false });
    fireBtn.addEventListener('touchcancel', () => game.setFireHeld(false));

    $('btn-touch-reload').addEventListener('touchstart', e => { game.startReload(); e.preventDefault(); }, { passive: false });
    $('btn-touch-ads').addEventListener('touchstart', e => { game.toggleAds(); e.preventDefault(); }, { passive: false });
  }

  /* ------------------------- 事件绑定 ------------------------- */
  function bind() {
    $('btn-play').addEventListener('click', () => {
      const s = loadSave();
      const lv = LEVELS.find(l => l.id === Math.min(s.unlocked, LEVELS.length)) || LEVELS[0];
      showBrief(lv);
    });
    $('btn-armory').addEventListener('click', () => { refreshArmory(); showScreen('screen-armory'); });
    $('btn-armory-back').addEventListener('click', () => { refreshMenu(); showScreen('screen-main'); });
    $('btn-levels').addEventListener('click', () => { refreshLevels(); showScreen('screen-levels'); });
    $('btn-levels-back').addEventListener('click', () => { refreshMenu(); showScreen('screen-main'); });
    $('btn-brief-back').addEventListener('click', () => { refreshLevels(); showScreen('screen-levels'); });
    $('btn-brief-start').addEventListener('click', () => startLevel(currentLevel));

    $('btn-reset').addEventListener('click', () => {
      if (confirm('确定要重置全部存档吗？已购买的武器与游戏币都会清空。')) {
        resetSave();
        wantedCache.clear();
        refreshMenu();
        toast('存档已重置', 'good');
      }
    });

    $('btn-wanted').addEventListener('click', () => toggleWanted());
    $('btn-close-wanted').addEventListener('click', () => closeWanted());

    $('btn-resume').addEventListener('click', () => {
      hideAllScreens();
      showHud();
      game.resume();
    });
    $('btn-pause-wanted').addEventListener('click', () => { openWanted(); });
    $('btn-quit').addEventListener('click', () => {
      game.state = 'idle';
      game.releaseLock();
      hideHud();
      refreshMenu();
      showScreen('screen-main');
    });

    window.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Escape' && wantedOpen) { closeWanted(); }
    });

    if (IS_TOUCH) initTouch();
  }

  /* ------------------------- hooks ------------------------- */
  const hooks = {
    onHud,
    onWanted() { },
    onFinish(res) {
      const save = loadSave();
      if (res.win) {
        const before = save.coins;
        recordClear(res.level.id, res.timeLeft);
        toast(`通关奖励 +${CLEAR_REWARD} 游戏币`, 'good');
      } else {
        recordFail();
      }
      setTimeout(() => showResult(res), 260);
    },
    onNotice(t, k) { toast(t, k || ''); },
    onHitmarker: hitmarker,
    onKill(npc) { },
    onPause() {
      hideAllScreens();
      showScreen('screen-pause');
    },
    onToggleWanted() { toggleWanted(); },
    onLockChange(locked) {
      if (!locked && game.state === 'playing' && !IS_TOUCH) {
        // 暂停逻辑已在 game.pause() 内触发 onPause
      }
    }
  };

  bind();

  return {
    hooks,
    refreshMenu,
    refreshArmory,
    refreshLevels,
    showBrief,
    startLevel,
    showResult,
    toast,
    hideAllScreens,
    showScreen,
    get currentLevel() { return currentLevel; }
  };
}
