/**
 * 游戏核心：第一人称控制、NPC 行为、命中判定、关卡流程
 */
import * as THREE from 'three';
import { WEAPONS_BY_ID, HEADSHOT_MULT, NPC_HP } from './config.js';
import { buildWorld, isBlocked } from './world.js';
import { buildCharacter, attachHitboxes, randomAppearance, animateCharacter } from './character.js';
import { WeaponView } from './weapon.js';
import { mulberry32, rand, clamp, lerp, damp, pick } from './utils.js';
import { sfx } from './audio.js';

const EYE_H = 1.66;
const BASE_FOV = 78;
// 仅当主输入指针为触摸（手机/平板）时才走触屏逻辑；带触摸屏的笔记本主指针是鼠标，按桌面处理
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const IS_TOUCH = COARSE && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
const MAX_FPS = 60;                       // 渲染帧上限，避免后台/高刷屏无节制满跑
const MIN_FRAME_MS = 1000 / MAX_FPS;

/* 2D 射线与 AABB 求交（用于子弹遮挡判断），返回最近命中距离 */
function rayBlockDist(colliders, ox, oz, dx, dz, maxDist = 120) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if ((c.h || 3) < 1.45) continue;      // 矮物可越过
    let tmin = 0, tmax = best;
    // X 轴
    if (Math.abs(dx) < 1e-6) {
      if (ox < c.minX || ox > c.maxX) continue;
    } else {
      let t1 = (c.minX - ox) / dx, t2 = (c.maxX - ox) / dx;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z 轴
    if (Math.abs(dz) < 1e-6) {
      if (oz < c.minZ || oz > c.maxZ) continue;
    } else {
      let t1 = (c.minZ - oz) / dz, t2 = (c.maxZ - oz) / dz;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best) best = tmin;
  }
  return best;
}


/**
 * 生成一关全部人物的外观参数。
 * 使用固定种子，保证「简报里的通缉令」与「进入现场后的实际 NPC」完全一致。
 * 返回 { criminalApps, civilApps }
 */
export function makeNpcApps(level) {
  const rng = mulberry32(level.id * 7919 + 104729);
  const total = level.criminals + level.civilians;

  const criminalApps = [];
  for (let i = 0; i < level.criminals; i++) {
    criminalApps.push(randomAppearance(rng, criminalApps));
  }
  const colorCount = {};
  criminalApps.forEach(a => { colorCount[a.upper.c] = (colorCount[a.upper.c] || 0) + 1; });
  const quota = Math.max(2, Math.ceil(total / 11));
  const civilApps = [];
  for (let i = 0; i < level.civilians; i++) {
    let app = null;
    for (let t = 0; t < 60; t++) {
      const cand = randomAppearance(rng, [...criminalApps, ...civilApps]);
      if ((colorCount[cand.upper.c] || 0) < quota) { app = cand; break; }
    }
    if (!app) app = randomAppearance(rng, [...criminalApps, ...civilApps]);
    colorCount[app.upper.c] = (colorCount[app.upper.c] || 0) + 1;
    civilApps.push(app);
  }
  return { criminalApps, civilApps };
}

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.isTouch = IS_TOUCH;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.25 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = !IS_TOUCH;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;   // 比 PCFSoft 便宜，观感差异小
    this.renderer.shadowMap.autoUpdate = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 300);
    this.camera.rotation.order = 'YXZ';

    this.weaponView = new WeaponView();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 160;

    this.state = 'idle';       // idle | ready | playing | paused | ending | over
    this.level = null;
    this.weapon = null;
    this.colliders = [];
    this.npcs = [];
    this.hitboxes = [];
    this.sparks = [];
    this.world = null;

    this.player = {
      pos: new THREE.Vector3(0, EYE_H, 14),
      yaw: 0, pitch: 0, pitchKick: 0, bobT: 0,
      vel: new THREE.Vector3(), speed: 0
    };

    this.touchMove = { x: 0, y: 0 };
    this.keys = new Set();
    this.wantAds = false;
    this.adsT = 0;
    this.fireHeld = false;
    this.firePrev = false;
    this.fireCd = 0;
    this.fireStreak = 0;
    this.ammo = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.timeLeft = 0;
    this.locked = false;
    this.lockedOut = false;   // 打开通缉令时暂停视角输入

    this.stats = { shots: 0, hits: 0, headshots: 0 };

    this._hudT = 0;
    this._boundKeyDown = e => this.onKeyDown(e);
    this._boundKeyUp = e => this.onKeyUp(e);
    this._boundMouseMove = e => this.onMouseMove(e);
    this._boundMouseDown = e => this.onMouseDown(e);
    this._boundMouseUp = e => this.onMouseUp(e);
    this._boundLockChange = () => this.onLockChange();
    this._boundResize = () => this.resize();
    this._boundCtx = e => e.preventDefault();

    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup', this._boundKeyUp);
    window.addEventListener('resize', this._boundResize);
    document.addEventListener('pointerlockchange', this._boundLockChange);
    // 绑在 window 上：即使存在全屏覆盖层（触摸层/HUD）也不会吞掉开火与转视角
    window.addEventListener('mousemove', this._boundMouseMove);
    window.addEventListener('mousedown', this._boundMouseDown);
    window.addEventListener('mouseup', this._boundMouseUp);
    canvas.addEventListener('contextmenu', this._boundCtx);

    this.resize();
    this.lastT = performance.now();
    this._nextFrame = 0;
    this._hidden = false;
    this.minFrameMs = MIN_FRAME_MS;
    this._onVis = () => {
      this._hidden = document.hidden;
      if (!this._hidden) { this.lastT = performance.now(); this._nextFrame = 0; }
    };
    this._onBlur = () => { this.minFrameMs = 1000 / 20; };
    this._onFocus = () => { this.minFrameMs = MIN_FRAME_MS; this.lastT = performance.now(); this._nextFrame = 0; };
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focus', this._onFocus);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ------------------------------ 尺寸 ------------------------------ */
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponView.camera.aspect = w / h;
    this.weaponView.camera.updateProjectionMatrix();
  }

  /* ------------------------------ 输入 ------------------------------ */
  onKeyDown(e) {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.hooks.onToggleWanted) this.hooks.onToggleWanted();
      return;
    }
    if (e.code === 'Escape') return;
    if (e.code === 'KeyR') { this.startReload(); return; }
    this.keys.add(e.code);
  }
  onKeyUp(e) { this.keys.delete(e.code); }

  onMouseMove(e) {
    // 未拿到指针锁定时也允许转视角（自由视角兜底），避免整局无法瞄准
    if (this.state !== 'playing') return;
    if (this.lockedOut) return;
    const sens = 0.0022 * (this.adsT > 0.5 ? 0.55 : 1);
    this.look(e.movementX * sens, e.movementY * sens);
  }

  notice(text, kind) {
    const now = performance.now();
    if (this._noticeText === text && this._noticeAt && now - this._noticeAt < 1500) return;
    this._noticeText = text;
    this._noticeAt = now;
    if (this.hooks.onNotice) this.hooks.onNotice(text, kind);
  }

  onMouseDown(e) {
    if (this.state !== 'playing') return;
    if (this.lockedOut) return;
    // 顺手申请指针锁定，但绝不吞掉这次点击：未锁定也要能开火/开镜
    if (!this.isTouch && !this.locked) this.requestLock();
    if (e.button === 0) {
      this.fireHeld = true;
    } else if (e.button === 2) {
      this.setAds(true);
    }
  }
  onMouseUp(e) {
    if (e.button === 0) this.fireHeld = false;
    if (e.button === 2) this.setAds(false);
  }

  requestLock() {
    const el = this.canvas;
    if (!el.requestPointerLock) return;
    try {
      const p = el.requestPointerLock();
      if (p && p.catch) {
        p.catch(err => {
          this.notice('浏览器拒绝锁定鼠标视角，已按自由视角继续（可继续开火，点画面可重试锁定）', 'warn');
          if (err) this.lastLockError = err.message || String(err);
        });
      }
    } catch (err) {
      this.lastLockError = err && err.message;
      this.notice('当前环境无法锁定鼠标视角，已按自由视角继续', 'warn');
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked && this.state === 'playing' && !this.isTouch) {
      this.pause();
    }
    if (this.hooks.onLockChange) this.hooks.onLockChange(this.locked);
  }

  /** 视角旋转（弧度） */
  look(dYaw, dPitch) {
    const p = this.player;
    p.yaw -= dYaw;
    p.pitch = clamp(p.pitch - dPitch, -1.35, 1.35);
    this.lastLookDX = dYaw;
    this.lastLookDY = dPitch;
  }

  setAds(on) {
    if (!this.weapon) return;
    if (on && this.weapon.ads === false) {
      this.wantAds = false;
      this.notice('该武器没有瞄具，无法开镜', 'warn');
      return;
    }
    this.wantAds = on;
  }
  toggleAds() { this.setAds(!this.wantAds); }

  /* ---------------------------- 关卡启动 ---------------------------- */
  start(level, weaponId) {
    this.clearWorld();
    this.level = level;
    this.weapon = WEAPONS_BY_ID[weaponId] || WEAPONS_BY_ID.revolver;

    this.world = buildWorld(level.scene);
    this.scene = this.world.scene;
    this.colliders = this.world.colliders;

    this.player.pos.set(this.world.spawn.x, EYE_H, this.world.spawn.z);
    this.player.yaw = 0;
    this.player.pitch = 0;
    this.player.pitchKick = 0;
    this.player.vel.set(0, 0, 0);
    this.player.speed = 0;

    this.weaponView.setWeapon(this.weapon);
    this.ammo = this.weapon.mag;
    this.reloading = false;
    this.reloadT = 0;
    this.fireCd = 0;
    this.fireStreak = 0;
    this.fireHeld = false;
    this.wantAds = false;
    this.adsT = 0;
    this.timeLeft = level.time;
    this.stats = { shots: 0, hits: 0, headshots: 0 };
    this.criminalTotal = level.criminals;
    this.criminalKilled = 0;
    this.civilianKilled = 0;
    this.pendingEnd = null;
    this.lockedOut = false;
    this._noticeAt = 0;
    this._noticeText = '';
    this.sparks.forEach(s => this.scene.remove(s.sprite));
    this.sparks = [];

    this.spawnNpcs(level);
    this.state = 'ready';
    this.resize();
    if (this.hooks.onHud) this.hooks.onHud(this.hudData());
  }

  beginPlay() {
    if (this.state !== 'ready') return;
    this.state = 'playing';
    if (!this.isTouch) this.requestLock();
    if (this.hooks.onHud) this.hooks.onHud(this.hudData());
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.fireHeld = false;
    this.wantAds = false;
    if (this.hooks.onPause) this.hooks.onPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (!this.isTouch) this.requestLock();
  }

  clearWorld() {
    if (!this.world) return;
    this.scene.traverse(o => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        // 材质为跨角色共享缓存，不在此处释放
      }
    });
    this.world = null;
    this.npcs = [];
    this.hitboxes = [];
    this.colliders = [];
  }

  /* ---------------------------- NPC 生成 ---------------------------- */
  spawnNpcs(level) {
    const { criminalApps, civilApps } = makeNpcApps(level);
    const total = level.criminals + level.civilians;
    const rng = mulberry32(level.id * 104729 + 7);

    // 3) 位置
    const b = this.world.bounds - 1.2;
    const px = this.world.spawn.x, pz = this.world.spawn.z;
    const spots = [];
    const tryFill = (minGap, minPlayerDist, maxGuard) => {
      let guard = 0;
      while (spots.length < total && guard < maxGuard) {
        guard++;
        const x = rand(rng, -b, b), z = rand(rng, -b, b);
        if (isBlocked(this.colliders, x, z, 0.55)) continue;
        if (Math.hypot(x - px, z - pz) < minPlayerDist) continue;
        let ok = true;
        for (const s of spots) {
          if (Math.hypot(s.x - x, s.z - z) < minGap) { ok = false; break; }
        }
        if (!ok) continue;
        spots.push({ x, z });
      }
    };
    tryFill(2.0, 8.0, 6000);
    if (spots.length < total) tryFill(1.3, 6.0, 6000);
    if (spots.length < total) tryFill(0.9, 4.0, 8000);

    // 洗牌
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }

    const wantedList = [];
    const colorList = [];
    let ci = 0, vi = 0;

    for (let i = 0; i < total; i++) {
      const isCriminal = i < level.criminals;
      const app = isCriminal ? criminalApps[ci] : civilApps[vi];
      const idx = isCriminal ? ci++ : vi++;
      const spot = spots[i] || { x: rand(rng, -b, b), z: rand(rng, -b, b) };

      const group = buildCharacter(app);
      group.position.set(spot.x, 0, spot.z);
      const yaw = rng() * Math.PI * 2;
      group.rotation.y = yaw;
      if (!this.isTouch) {
        group.traverse(o => { if (o.isMesh && o.name !== 'hitBody' && o.name !== 'hitHead') o.castShadow = true; });
      }
      attachHitboxes(group);
      this.scene.add(group);

      const npc = {
        group, app, isCriminal, idx,
        pos: new THREE.Vector3(spot.x, 0, spot.z),
        yaw,
        hp: NPC_HP,
        dead: false,
        dieT: 0,
        walkT: rand(rng, 0.2, 2.5),
        target: { x: spot.x, z: spot.z },
        baseSpeed: isCriminal ? rand(rng, 1.2, 1.7) : rand(rng, 0.85, 1.55),
        fleeing: false,
        phase: rng() * 10,
        hitBody: group.userData.hitBody,
        hitHead: group.userData.hitHead
      };
      npc.hitBody.userData.npc = npc;
      npc.hitHead.userData.npc = npc;
      this.hitboxes.push(npc.hitBody, npc.hitHead);
      this.npcs.push(npc);

      if (isCriminal) {
        wantedList.push({ npc, app, index: idx });
        colorList.push({ color: app.upper.n, hex: app.upper.c });
      }
    }

    if (this.hooks.onWanted) this.hooks.onWanted(wantedList, level);
  }

  /* ---------------------------- 主循环 ---------------------------- */
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (this._hidden) { this.lastT = now; return; }      // 后台标签页完全不渲染
    if (this._nextFrame === 0) this._nextFrame = now;
    if (now + 0.5 < this._nextFrame) return;             // 限帧：未到下一帧时间点直接返回
    this._nextFrame += this.minFrameMs;
    if (this._nextFrame < now) this._nextFrame = now;    // 落后过多则重新对齐，避免追帧

    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.06);

    if (this.state === 'playing') {
      this.update(dt);
    } else if (this.state === 'ready' || this.state === 'paused' || this.state === 'ending') {
      this.updateIdle(dt);
    }

    // 阴影贴图隔帧重算，静止场景几乎无差别，可省掉近一半阴影 draw call
    this._frameNo = (this._frameNo || 0) + 1;
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = (this._frameNo % 2 === 0);
    }
    this.render(dt);

    // 帧率统计（供性能自检/调试读取）
    this._fpsAcc = (this._fpsAcc || 0) + dt;
    this._fpsN = (this._fpsN || 0) + 1;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }

  updateIdle(dt) {
    for (const n of this.npcs) {
      if (n.dead) { this.animateDeath(n, dt); continue; }
      animateCharacter(n.group, dt * 0.4, 0);
    }
    this.weaponView.reloadT = this.reloading ? this.reloadT : -1;
    this.weaponView.update(dt, {
      adsT: this.adsT, moving: false, sprint: false,
      lookDX: 0, lookDY: 0, aspect: this.camera.aspect
    });
    this.updateSparks(dt);
    if (this.pendingEnd) {
      this.pendingEnd.t -= dt;
      if (this.pendingEnd.t <= 0) {
        const r = this.pendingEnd.result;
        this.pendingEnd = null;
        this.finish(r);
      }
    }
  }

  update(dt) {
    this.elapsed = (this.elapsed || 0) + dt;
    // 计时
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.fail('timeout');
      return;
    }

    this.updatePlayer(dt);
    this.updateNpcs(dt);
    this.updateCombat(dt);
    this.updateSparks(dt);

    this._hudT += dt;
    if (this._hudT > 0.08) {
      this._hudT = 0;
      if (this.hooks.onHud) this.hooks.onHud(this.hudData());
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    let inputF = 0, inputR = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) inputF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) inputF -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) inputR += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) inputR -= 1;
    inputF += -this.touchMove.y;
    inputR += this.touchMove.x;
    const l = Math.hypot(inputF, inputR);
    if (l > 1) { inputF /= l; inputR /= l; }

    const sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.wantAds && l > 0.1 && !this.reloading;
    const maxSpeed = sprinting ? 6.2 : (this.adsT > 0.4 ? 2.3 : 4.35);

    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
    const rightX = Math.cos(p.yaw), rightZ = -Math.sin(p.yaw);
    let wx = fwdX * inputF + rightX * inputR;
    let wz = fwdZ * inputF + rightZ * inputR;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) { wx /= wl; wz /= wl; }

    const targetSpeed = wl > 0.05 ? maxSpeed : 0;
    p.speed = damp(p.speed, targetSpeed, 14, dt);
    const step = p.speed * dt;

    if (p.speed > 0.05 && wl > 0.001) {
      const nx = p.pos.x + wx * step;
      const nz = p.pos.z + wz * step;
      const R = 0.34;
      if (!isBlocked(this.colliders, nx, p.pos.z, R)) p.pos.x = nx;
      if (!isBlocked(this.colliders, p.pos.x, nz, R)) p.pos.z = nz;
      const lim = this.world.bounds + 0.6;
      p.pos.x = clamp(p.pos.x, -lim, lim);
      p.pos.z = clamp(p.pos.z, -lim, lim);
    }

    // 走路镜头起伏
    if (p.speed > 0.3) p.bobT += dt * (sprinting ? 11 : 7.4);
    const camBob = Math.sin(p.bobT * 2) * 0.012 * (p.speed / 4.3) * (1 - this.adsT * 0.8);

    // 后坐恢复
    p.pitchKick = damp(p.pitchKick, 0, 8, dt);

    this.camera.position.set(p.pos.x, EYE_H + camBob, p.pos.z);
    this.camera.rotation.set(p.pitch + p.pitchKick, p.yaw, 0, 'YXZ');

    // 开镜插值
    const canAds = this.weapon && this.weapon.ads;
    this.adsT = damp(this.adsT, (this.wantAds && canAds) ? 1 : 0, 13, dt);
    const zoom = lerp(1, this.weapon ? this.weapon.zoom : 1, this.adsT);
    this.camera.fov = BASE_FOV / zoom;
    this.camera.updateProjectionMatrix();
    this.weaponView.camera.fov = 58 / lerp(1, 1.25, this.adsT);
    this.weaponView.camera.updateProjectionMatrix();

    // 武器视图动画
    this.weaponView.reloadT = this.reloading ? this.reloadT : -1;
    this.weaponView.update(dt, {
      adsT: this.adsT,
      moving: p.speed > 0.4,
      sprint: sprinting,
      lookDX: this.lastLookDX || 0,
      lookDY: this.lastLookDY || 0,
      aspect: this.camera.aspect
    });
    this.lastLookDX = 0;
    this.lastLookDY = 0;
  }

  /** 选一个不在障碍物内部的可达游荡点，避免 NPC 把墙当目标原地顶墙 */
  pickWanderTarget(n, spread = 9) {
    const lim = this.world.bounds;
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = rand(Math.random, 2.5, spread);
      const tx = clamp(n.pos.x + Math.cos(ang) * r, -lim, lim);
      const tz = clamp(n.pos.z + Math.sin(ang) * r, -lim, lim);
      if (!isBlocked(this.colliders, tx, tz, 0.65)) {
        n.target.x = tx; n.target.z = tz;
        n.walkT = rand(Math.random, 1.8, 5.5);
        return;
      }
    }
    n.walkT = rand(Math.random, 1.0, 2.0);
  }

  updateNpcs(dt) {
    const px = this.player.pos.x, pz = this.player.pos.z;
    for (const n of this.npcs) {
      if (n.dead) { this.animateDeath(n, dt); continue; }

      const dxp = n.pos.x - px, dzp = n.pos.z - pz;
      const distP = Math.hypot(dxp, dzp) || 0.001;

      let speed = n.baseSpeed;
      let tx = n.target.x, tz = n.target.z;

      if (n.isCriminal && distP < 15) {
        // 察觉玩家后转身逃跑
        n.fleeing = true;
        speed = 3.5;
        const awayX = dxp / distP, awayZ = dzp / distP;
        const sideX = -awayZ, sideZ = awayX;
        const wobble = Math.sin(this.elapsed * 1.4 + n.phase) * 0.55;
        tx = n.pos.x + (awayX + sideX * wobble) * 6;
        tz = n.pos.z + (awayZ + sideZ * wobble) * 6;
        n.walkT = 0.6;
      } else if (distP < 1.15 && !n.isCriminal) {
        // 平民给玩家让路
        speed = 1.1;
        tx = n.pos.x + (dxp / distP) * 3;
        tz = n.pos.z + (dzp / distP) * 3;
        n.walkT = 0.5;
      } else {
        n.walkT -= dt;
        const dTargetX = n.target.x - n.pos.x, dTargetZ = n.target.z - n.pos.z;
        if (n.walkT <= 0 || Math.hypot(dTargetX, dTargetZ) < 0.6) {
          this.pickWanderTarget(n);
        }
        tx = n.target.x; tz = n.target.z;
      }

      const dx = tx - n.pos.x, dz = tz - n.pos.z;
      const dl = Math.hypot(dx, dz);
      let moving = 0;
      if (dl > 0.12) {
        let dirX = dx / dl, dirZ = dz / dl;

        // 前方被挡：向左右试探绕行，避免顶着墙原地蹭（这是原先"卡墙"的直接原因）
        if (isBlocked(this.colliders, n.pos.x + dirX * 0.55, n.pos.z + dirZ * 0.55, 0.32)) {
          if (!n.avoidDir) n.avoidDir = Math.random() < 0.5 ? 1 : -1;
          let found = false;
          for (const k of [0.9, 1.4, 1.95]) {
            const a = n.avoidDir * k;
            const bx = dirX * Math.cos(a) - dirZ * Math.sin(a);
            const bz = dirX * Math.sin(a) + dirZ * Math.cos(a);
            if (!isBlocked(this.colliders, n.pos.x + bx * 0.65, n.pos.z + bz * 0.65, 0.32)) {
              dirX = bx; dirZ = bz; found = true; break;
            }
          }
          if (!found) { n.avoidDir = -n.avoidDir; n.walkT = 0; }
        }

        const stepLen = speed * dt;
        const beforeX = n.pos.x, beforeZ = n.pos.z;
        const sx = dirX * stepLen, sz = dirZ * stepLen;
        let movedX = false, movedZ = false;
        if (!isBlocked(this.colliders, n.pos.x + sx, n.pos.z, 0.32)) { n.pos.x += sx; movedX = true; }
        if (!isBlocked(this.colliders, n.pos.x, n.pos.z + sz, 0.32)) { n.pos.z += sz; movedZ = true; }
        if (!movedX && !movedZ) {
          n.walkT = 0;
          n.avoidDir = -(n.avoidDir || 1);
        }

        // 卡死检测：实际位移远小于期望位移 → 换一个可达目标点
        const realMove = Math.hypot(n.pos.x - beforeX, n.pos.z - beforeZ);
        n.stuckT = realMove < stepLen * 0.35 ? (n.stuckT || 0) + dt : 0;
        if (n.stuckT > 0.45) {
          n.stuckT = 0;
          this.pickWanderTarget(n);
          n.avoidDir = -(n.avoidDir || 1);
        }
        moving = realMove > 0.00005 ? speed : 0;

        // 平滑转向（朝实际可行方向）
        const desired = Math.atan2(dirX, dirZ);
        let diff = desired - n.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        n.yaw += diff * Math.min(1, dt * 6);
      }

      const lim = this.world.bounds;
      n.pos.x = clamp(n.pos.x, -lim, lim);
      n.pos.z = clamp(n.pos.z, -lim, lim);

      n.group.position.set(n.pos.x, n.group.position.y, n.pos.z);
      n.group.rotation.y = n.yaw;
      animateCharacter(n.group, dt, moving);
    }

    // 远处人物 LOD：细节小件隐藏、关闭阴影投射，节省大量顶点与阴影开销
    for (const n of this.npcs) {
      if (n.dead || !n.group) continue;
      const fine = n.group.userData.fineMeshes;
      if (!fine) continue;
      const dist = Math.hypot(n.pos.x - px, n.pos.z - pz);
      const show = dist < 20;
      if (n._fineShown !== show) {
        n._fineShown = show;
        for (const m of fine) m.visible = show;
      }
      const shadowOn = dist < 16;
      if (n._shadowOn !== shadowOn) {
        n._shadowOn = shadowOn;
        n.group.traverse(o => { if (o.isMesh && !o.userData.fine) o.castShadow = shadowOn; });
      }
    }

    // 与玩家保持最小间距：只推开 NPC，绝不推玩家（否则玩家会被挤进墙里）
    for (const n of this.npcs) {
      if (n.dead) continue;
      const dx = n.pos.x - px, dz = n.pos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.52) {
        const ux = dx / d, uz = dz / d;
        const nx2 = n.pos.x + ux * (0.52 - d), nz2 = n.pos.z + uz * (0.52 - d);
        if (!isBlocked(this.colliders, nx2, nz2, 0.3)) {
          n.pos.x = nx2; n.pos.z = nz2;
          n.group.position.x = n.pos.x; n.group.position.z = n.pos.z;
        }
      }
    }

    // 简易互斥分离
    const list = this.npcs;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.62 && d > 0.0001) {
          const push = (0.62 - d) * 0.5;
          const ux = dx / d, uz = dz / d;
          const nax = a.pos.x - ux * push, naz = a.pos.z - uz * push;
          const nbx = b.pos.x + ux * push, nbz = b.pos.z + uz * push;
          if (!isBlocked(this.colliders, nax, naz, 0.3)) { a.pos.x = nax; a.pos.z = naz; }
          if (!isBlocked(this.colliders, nbx, nbz, 0.3)) { b.pos.x = nbx; b.pos.z = nbz; }
          a.group.position.x = a.pos.x; a.group.position.z = a.pos.z;
          b.group.position.x = b.pos.x; b.group.position.z = b.pos.z;
        }
      }
    }
  }

  animateDeath(n, dt) {
    n.dieT += dt;
    const t = clamp(n.dieT / 0.75, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    n.group.rotation.x = -1.45 * e;
    n.group.position.y = -0.02 * e;
    if (n.dieT > 0.2 && !n.fellSound) { n.fellSound = true; sfx.bodyFall(); }
  }

  /* ---------------------------- 战斗 ---------------------------- */
  updateCombat(dt) {
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.reloading) {
      this.reloadT += dt / this.weapon.reload;
      if (this.reloadT >= 1) {
        this.reloading = false;
        this.reloadT = 0;
        this.ammo = this.weapon.mag;
        sfx.reloadEnd();
      }
    }

    const wantFire = this.fireHeld || this.touchFire;
    if (wantFire) this.tryFire();
    if (!wantFire) this.fireStreak = 0;
    this.firePrev = wantFire;
  }

  startReload() {
    if (!this.weapon || this.reloading) return;
    if (this.ammo >= this.weapon.mag) {
      if (this.state === 'playing') this.notice('弹匣已满，无需换弹', 'warn');
      return;
    }
    if (this.state !== 'playing' && this.state !== 'ready') return;
    this.reloading = true;
    this.reloadT = 0;
    this.weaponView.startReload();
    sfx.reloadStart();
  }

  tryFire() {
    if (this.state !== 'playing') return;
    if (this.reloading) return;
    if (this.fireCd > 0) return;
    // 半自动需要松开重按
    if (!this.weapon.auto && this.firePrev) return;

    if (this.ammo <= 0) {
      if (!this.firePrev) { sfx.dryFire(); this.startReload(); }
      return;
    }

    this.ammo -= 1;
    this.stats.shots += 1;
    this.fireCd = 60 / this.weapon.rpm;
    this.weaponView.fire();
    sfx.shot(this.weapon);

    // 后坐
    const rk = this.weapon.recoil * 0.011 * (1 - this.adsT * 0.35);
    this.player.pitch = clamp(this.player.pitch + rk, -1.35, 1.35);
    this.player.yaw += (Math.random() - 0.5) * rk * 0.8;
    this.player.pitchKick += rk * 0.35;

    // 散布
    this.fireStreak = Math.min(10, this.fireStreak + 1);
    let spread = this.weapon.spread
      * (1 - this.adsT * 0.62)
      * (this.player.speed > 0.5 ? 1.6 : 1)
      * (1 + this.fireStreak * 0.10);
    if (this.weapon.bolt) spread *= 0.5;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const rad = Math.tan(spread * Math.PI / 180);
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * rad;
    dir.addScaledVector(rightV, Math.cos(ang) * rr).addScaledVector(upV, Math.sin(ang) * rr).normalize();

    const origin = this.camera.position.clone();
    this.raycaster.set(origin, dir);

    const hits = this.raycaster.intersectObjects(this.hitboxes, false);
    const wallDist = rayBlockDist(this.colliders, origin.x, origin.z, dir.x, dir.z, 160);

    let targetHit = null;
    if (hits.length) {
      const h = hits[0];
      if (h.distance <= wallDist) {
        const npc = h.object.userData.npc;
        if (npc && !npc.dead) targetHit = { npc, head: h.object.name === 'hitHead', dist: h.distance, point: h.point };
      }
    }

    if (targetHit) {
      this.stats.hits += 1;
      if (targetHit.head) this.stats.headshots += 1;
      this.damageNpc(targetHit.npc, this.weapon.dmg * (targetHit.head ? HEADSHOT_MULT : 1), targetHit.head, targetHit.point);
    } else {
      // 环境弹着
      const d = Math.min(wallDist, 45);
      const pt = origin.clone().addScaledVector(dir, d);
      this.spawnSpark(pt, 0xffd08a);
    }
  }

  damageNpc(npc, dmg, head, point) {
    npc.hp -= dmg;
    if (npc.hp > 0) {
      if (this.hooks.onHitmarker) this.hooks.onHitmarker(head ? 'head' : 'body');
      sfx.hit();
      this.spawnSpark(point || npc.pos.clone().setY(1.4), 0xd23b3b);
      return;
    }

    // 死亡
    npc.dead = true;
    npc.dieT = 0;
    this.hitboxes = this.hitboxes.filter(h => h !== npc.hitBody && h !== npc.hitHead);
    this.spawnSpark(point || npc.pos.clone().setY(1.4), 0xd23b3b);
    if (head) sfx.headshot();

    if (npc.isCriminal) {
      this.criminalKilled += 1;
      if (this.hooks.onHitmarker) this.hooks.onHitmarker('kill');
      if (this.hooks.onKill) this.hooks.onKill(npc);
      if (this.criminalKilled >= this.criminalTotal) {
        this.pendingEnd = { t: 0.9, result: { win: true } };
        this.state = 'ending';
      }
    } else {
      this.civilianKilled += 1;
      if (this.hooks.onHitmarker) this.hooks.onHitmarker('civil');
      this.fail('civilian');
    }
  }

  spawnSpark(pos, color) {
    if (!this.scene) return;
    const tex = this._sparkTex || (this._sparkTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    sp.scale.set(0.28, 0.28, 0.28);
    this.scene.add(sp);
    this.sparks.push({ sprite: sp, life: 0.22, max: 0.22 });
    if (this.sparks.length > 30) {
      const old = this.sparks.shift();
      this.scene.remove(old.sprite);
      old.sprite.material.dispose();
    }
  }

  updateSparks(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.sprite);
        s.sprite.material.dispose();
        this.sparks.splice(i, 1);
      } else {
        s.sprite.material.opacity = s.life / s.max;
        const k = 1 + (1 - s.life / s.max) * 0.8;
        s.sprite.scale.set(0.28 * k, 0.28 * k, 0.28 * k);
      }
    }
  }

  /* ---------------------------- 结算 ---------------------------- */
  fail(reason) {
    if (this.state === 'over' || this.pendingEnd) return;
    this.pendingEnd = { t: 0.55, result: { win: false, reason } };
    this.state = 'ending';
    this.fireHeld = false;
    this.touchFire = false;
    this.wantAds = false;
  }

  finish(result) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.releaseLock();
    const payload = {
      win: !!result.win,
      reason: result.reason || null,
      level: this.level,
      timeLeft: Math.max(0, this.timeLeft),
      shots: this.stats.shots,
      hits: this.stats.hits,
      headshots: this.stats.headshots,
      accuracy: this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0,
      criminals: this.criminalTotal,
      criminalKilled: this.criminalKilled,
      civilians: this.level ? this.level.civilians : 0,
      civilianKilled: this.civilianKilled,
      weaponId: this.weapon ? this.weapon.id : 'revolver'
    };
    if (result.win) sfx.win(); else sfx.lose();
    if (this.hooks.onFinish) this.hooks.onFinish(payload);
  }

  hudData() {
    const w = this.weapon || WEAPONS_BY_ID.revolver;
    return {
      time: Math.max(0, this.timeLeft),
      ammo: this.ammo,
      mag: w.mag,
      reloading: this.reloading,
      reloadProgress: this.reloadT,
      weaponName: w.name,
      weaponClass: w.cls,
      ads: this.adsT,
      zoom: w.zoom,
      isScope: w.cls === '狙击枪',
      criminalsTotal: this.criminalTotal,
      criminalsLeft: Math.max(0, this.criminalTotal - this.criminalKilled),
      civiliansAlive: this.level ? Math.max(0, this.level.civilians - this.civilianKilled) : 0,
      civiliansTotal: this.level ? this.level.civilians : 0,
      civilianKilled: this.civilianKilled,
      tutorial: !!(this.level && this.level.tutorial),
      levelName: this.level ? this.level.name : '',
      levelId: this.level ? this.level.id : 1,
      totalAmmo: null
    };
  }

  /* ---------------------------- 输入桥（触屏/UI） ---------------------------- */
  setTouchMove(x, y) { this.touchMove.x = x; this.touchMove.y = y; }
  setFireHeld(on) { this.fireHeld = on; if (on && this.state === 'playing') sfx.ensure(); }
  lookBy(dx, dy) {
    const sens = 0.0032 * (this.adsT > 0.5 ? 0.5 : 1);
    this.look(dx * sens, dy * sens);
  }

  /* ---------------------------- 渲染 ---------------------------- */
  render(dt) {
    if (!this.scene) return;
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.state !== 'idle') {
      r.clearDepth();
      r.render(this.weaponView.scene, this.weaponView.camera);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._boundKeyDown);
    window.removeEventListener('keyup', this._boundKeyUp);
    window.removeEventListener('resize', this._boundResize);
    document.removeEventListener('pointerlockchange', this._boundLockChange);
    window.removeEventListener('mouseup', this._boundMouseUp);
    this.clearWorld();
    this.renderer.dispose();
  }
}
