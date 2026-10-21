// 点击音效（本地最小版）：优先使用 dsh-whale-widget 自带的音效文件，缺失时回退到 Web Audio 合成音。
//   - 开关状态存 localStorage（键 dsh-pet.sound.enabled，'0' = 关；默认开），
//     同一 partition 下所有桌宠窗口共享，重启桌面 Helper 后仍然有效。
//   - 音色存 localStorage（键 dsh-pet.sound.variant，默认 duck = 小黄鸭·按下）。
//   - 右键菜单「音效：开 / 关」+「点击音色 ▸」切换；切换音色时立即试听一声。
//   - 音频文件按相对路径引用隔壁 dsh-whale-widget 包（不复制素材，避免许可问题）：
//     两个插件同装在一个 profile 的 node_modules 下即可；widget 卸载/升级后找不到文件 →
//     自动回退合成音，不会静默报错。
// 只在桌面 Helper 的渲染进程里使用（index.html 以经典 script 引入）。
(function () {
  'use strict';

  const KEY_ON = 'dsh-pet.sound.enabled';
  const KEY_VARIANT = 'dsh-pet.sound.variant';
  const MASTER = 0.55;
  const FILE_VOLUME = 0.8;
  // 相对 index.html（runtime/electron-helper/）的音频路径：
  //   ../../     → 包根目录（assets/sfx/ 放用户自己加的音频）
  //   ../../../  → node_modules（隔壁 dsh-whale-widget 的预置音效，直接引用不复制素材）
  const WHALE = '../../../dsh-whale-widget/assets/';

  // id → { label, src }：src 为空 = 合成音
  const VARIANTS = {
    synth: { label: '合成「啵」', src: '' },
    duck: { label: '小黄鸭·按下', src: WHALE + 'Ya1.mp3' }, // widget 默认按压音（0.24s）
    ciallo: { label: 'Ciallo～', src: '../../assets/sfx/ciallo.mp3' }, // 用户自备（从 Downloads 复制进包）
    fx1: { label: '音效1·按下', src: WHALE + 'D1.mp3' }, // 0.07s
    orb: { label: 'Minecraft 经验球', src: WHALE + 'minecraft-exp-orb.wav' }, // 0.62s
    endA: { label: '任务结束音 A', src: WHALE + 'task-end-a.wav' }, // 1.66s
  };

  let ctx = null;
  let master = null;
  let enabled = readBool(KEY_ON, true);
  let variant = normalizeVariant(readString(KEY_VARIANT));
  // variant → HTMLAudioElement 或 { failed: true }
  const players = new Map();

  function readString(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function readBool(key, fallback) {
    const v = readString(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  }

  function normalizeVariant(id) {
    return Object.prototype.hasOwnProperty.call(VARIANTS, id) ? id : 'duck';
  }

  /** 惰性创建 AudioContext 与总音量节点（首次点击即用户手势，不会被自动播放策略拦） */
  function audio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** 单个振荡器 + 指数包络：从 fromHz 滑到 toHz，峰值 gain，dur 秒后衰减到静音 */
  function blip(c, opts) {
    const t0 = c.currentTime + (opts.delay || 0) + 0.001;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, t0);
    osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.slide);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** 合成音兜底：两声正弦短「啵」，基频每次 ±8% 随机 */
  function synthClick() {
    const c = audio();
    if (!c) return;
    const base = 880 * (0.92 + Math.random() * 0.16);
    blip(c, { type: 'sine', from: base, to: base * 0.3, slide: 0.075, peak: 0.22, dur: 0.13 });
    blip(c, { type: 'triangle', from: base * 0.5, to: base * 0.22, slide: 0.06, peak: 0.09, dur: 0.1 });
  }

  /** 取（或创建）某个音色对应的 audio 元素；文件加载失败则记 failed，之后永久走合成音 */
  function player(id) {
    if (players.has(id)) return players.get(id);
    const meta = VARIANTS[id];
    if (!meta || !meta.src) {
      players.set(id, { failed: true });
      return players.get(id);
    }
    const el = new Audio(meta.src);
    el.preload = 'auto';
    el.volume = FILE_VOLUME;
    const state = { el };
    el.addEventListener('error', () => {
      state.failed = true;
      el.dataset.failed = '1';
    });
    players.set(id, state);
    return state;
  }

  function playFile(state) {
    try {
      state.el.currentTime = 0; // 连点时从头再响，不叠成噪音
      const p = state.el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          state.failed = true; // 解码/权限/文件缺失 → 之后回退合成音
        });
      }
      return true;
    } catch {
      state.failed = true;
      return false;
    }
  }

  function click() {
    if (!enabled) return;
    if (variant === 'synth') {
      synthClick();
      return;
    }
    const state = player(variant);
    if (!state.failed && playFile(state)) return;
    synthClick(); // 文件不可用时的兜底（例如 widget 被卸载）
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(next) {
    enabled = !!next;
    try {
      localStorage.setItem(KEY_ON, enabled ? '1' : '0');
    } catch {
      // 隐私模式/存储不可用时只影响记忆，不影响本次会话
    }
    if (enabled) click(); // 开启的瞬间给一声确认
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  /** 当前音色 id */
  function getVariant() {
    return variant;
  }

  /** 切换音色；silent=true 时不试听（测试用） */
  function setVariant(id, silent) {
    variant = normalizeVariant(id);
    try {
      localStorage.setItem(KEY_VARIANT, variant);
    } catch {
      // 同上，只影响记忆
    }
    if (!silent && enabled) click(); // 换音色当场听一下
    return variant;
  }

  /** 右键菜单「点击音色」子项：选中项前缀 ✓，其余用全角空格占位保持对齐 */
  function menuItems() {
    return Object.keys(VARIANTS).map((id) => ({
      label: (id === variant ? '✓ ' : '\u3000') + VARIANTS[id].label,
      action: 'sound-variant',
      variant: id,
    }));
  }

  /** 供自检/排障：音色列表与各文件的加载状态（null = 还没试过，false = 加载失败） */
  function status() {
    const ready = {};
    for (const id of Object.keys(VARIANTS)) {
      if (!VARIANTS[id].src) {
        ready[id] = true;
        continue;
      }
      const state = players.get(id);
      ready[id] = state ? state.failed !== true : null;
    }
    return { enabled, variant, ready };
  }

  window.PetSound = { click, isEnabled, setEnabled, toggle, getVariant, setVariant, menuItems, status };
  // 提前建一个元素，让文件在第一次点击前就开始解码（点击时零延迟）；失败也没关系，click 里有兜底
  if (VARIANTS[variant].src) player(variant);
})();
