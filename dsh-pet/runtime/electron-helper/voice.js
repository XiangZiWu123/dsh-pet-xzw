// 语音层：固定台词播本地 mp3（edge-tts 预生成），任意文本走主进程 TTS（带缓存），
// 任何一步失败都回退系统语音——绝不静默没声。
//   - 开关：localStorage dsh-pet.voice.enabled（'0' = 关）
//   - 固定台词：../../assets/voice-features/<id>.mp3（由 ~/.dsh/dsh-pet/tts/gen.mjs 生成）
//   - 任意文本：window.petBridge.tts(text) → base64 mp3 → Blob 播放
//   - 同一时刻只播一句；后一句会打断前一句
(function () {
  'use strict';

  const KEY_ON = 'dsh-pet.voice.enabled';
  const FIXED_DIR = '../../assets/voice-features/';
  const VOLUME = 0.9;

  let enabled = (() => {
    try {
      return localStorage.getItem(KEY_ON) !== '0';
    } catch {
      return true;
    }
  })();

  let seq = 0; // 递增序号：合成返回时发现已过期就丢弃
  let current = null; // { audio, url }

  function stop() {
    seq++;
    if (current) {
      try {
        current.audio.pause();
        current.audio.src = '';
      } catch {
        /* 已释放 */
      }
      if (current.url) URL.revokeObjectURL(current.url);
      current = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* 无语音引擎 */
      }
    }
  }

  function play(src, isObjectUrl) {
    stop();
    const audio = new Audio(src);
    audio.volume = VOLUME;
    current = { audio, url: isObjectUrl ? src : '' };
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    audio.addEventListener('ended', () => {
      if (current && current.audio === audio) current = null;
      if (isObjectUrl) URL.revokeObjectURL(src);
    });
    return true;
  }

  /** 播固定台词（预生成的 mp3，零延迟） */
  function speakId(id) {
    if (!enabled || !id) return false;
    return play(FIXED_DIR + id + '.mp3', false);
  }

  /** 播任意文本：优先 edge-tts（主进程缓存），失败回退系统语音 */
  async function speakText(text) {
    if (!enabled) return false;
    const clean = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!clean) return false;
    const my = ++seq;
    if (window.petBridge && typeof window.petBridge.tts === 'function') {
      try {
        const res = await window.petBridge.tts(clean);
        if (my !== seq) return false; // 期间又来了新的一句
        if (res && res.ok && res.b64) {
          const bin = atob(res.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
          return play(url, true);
        }
      } catch {
        /* 落到固定兜底句 */
      }
      if (my !== seq) return false;
    }
    // 合成失败（多为 edge-tts 429 限流或断网）：播同一音色的固定一句，
    // 绝不突然换成系统音色——音色突变比少念一句更出戏
    if (speakId('tts_fail')) return true;
    return systemSpeak(clean);
  }

  /** 兜底：Web Speech API（离线，音色取决于系统） */
  function systemSpeak(text) {
    if (!window.speechSynthesis) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      u.pitch = 1.15;
      u.volume = VOLUME;
      const voices = window.speechSynthesis.getVoices();
      const zh = voices.find((v) => /zh[-_]CN/i.test(v.lang));
      if (zh) u.voice = zh;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(next) {
    enabled = !!next;
    try {
      localStorage.setItem(KEY_ON, enabled ? '1' : '0');
    } catch {
      /* 存储不可用只影响记忆 */
    }
    if (!enabled) stop();
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  window.PetVoice = { speakId, speakText, stop, isEnabled, setEnabled, toggle };
})();
