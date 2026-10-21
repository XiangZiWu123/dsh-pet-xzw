// 桌宠玩法层：久坐/喝水提醒、时段问候、亲密度+签到、猜拳、投喂/心情、随机彩蛋、TTS 朗读、主题。
// 全部只动桌面 Helper 渲染层；语音走 voice.js（固定台词本地 mp3 + 任意文本走主进程 TTS）。
//   状态：localStorage dsh-pet.play.state（每只宠物一份）
//   设置：localStorage dsh-pet.play.config（所有窗口共享；改了一处，其它窗口经 storage 事件同步主题）
//   全局计时（提醒/问候/彩蛋）只在 petIndex === 0 的窗口跑，多开不会每只都提醒。
(function () {
  'use strict';

  const KEY_STATE = 'dsh-pet.play.state';
  const KEY_CFG = 'dsh-pet.play.config';

  const LINES = {
    break1: '坐太久啦，起来伸个懒腰吧。',
    break2: '该起来动一动啦，腰会酸的哦。',
    break3: '站起来走两步，我陪你。',
    water1: '记得喝口水呀，别光顾着写代码。',
    water2: '杯子空了吧？去接点水。',
    water3: '喝口水，休息一下嘛。',
    greet_morning: '早上好呀，今天也要元气满满哦。',
    greet_noon: '中午啦，记得吃饭，别饿着。',
    greet_afternoon: '下午好，困的话就摸会儿鱼吧。',
    greet_evening: '晚上好，今天辛苦啦。',
    greet_night: '这么晚还不睡？早点休息哦。',
    greet_dawn: '天快亮了，你还没睡吗？',
    checkin_first: '今天也见到你啦，签到成功！',
    checkin_streak: '连续签到好多天啦，真棒！',
    checkin_level: '亲密度升级啦，我更喜欢你了。',
    checkin_low: '今天第一次摸我，好开心。',
    rps_win: '我赢啦！再来一局嘛。',
    rps_lose: '呜，我输啦，不服再来。',
    rps_draw: '平局！我们心有灵犀呢。',
    rps_start: '石头剪刀布，你出什么？',
    feed1: '谢谢投喂，白饭最好吃啦！',
    feed2: '啊呜一口，好吃！',
    feed_full: '吃不下啦，肚子圆滚滚的。',
    feed_hungry: '我饿了，可以喂我一点吗？',
    egg1: '咦，捡到一枚 token！',
    egg2: '刚才好像有什么东西飞过去了。',
    egg3: 'Ciallo～今天也要加油哦。',
    egg4: '嘘，我在偷偷摸鱼呢。',
    theme1: '换好新衣服啦，好看吗？',
    theme2: '这个颜色我喜欢。',
    recharge: '充值到账啦，又吃到大白饭啦！',
  };

  const GREETINGS = {
    morning: { id: 'greet_morning', text: LINES.greet_morning },
    noon: { id: 'greet_noon', text: LINES.greet_noon },
    afternoon: { id: 'greet_afternoon', text: LINES.greet_afternoon },
    evening: { id: 'greet_evening', text: LINES.greet_evening },
    night: { id: 'greet_night', text: LINES.greet_night },
    dawn: { id: 'greet_dawn', text: LINES.greet_dawn },
  };

  const THEMES = {
    default: { label: '原色', filter: '' },
    warm: { label: '暖阳', filter: 'sepia(.16) saturate(1.12) brightness(1.03)' },
    sakura: { label: '樱花', filter: 'hue-rotate(-14deg) saturate(1.16) brightness(1.03)' },
    cool: { label: '冷调', filter: 'hue-rotate(12deg) saturate(1.06) brightness(1.03)' },
    night: { label: '夜色', filter: 'brightness(.86) saturate(1.04) hue-rotate(-6deg)' },
  };

  const DEFAULTS = {
    breakEnabled: true,
    breakMin: 45,
    tts: true,
    eggs: true,
    theme: 'default',
    notesRemind: true,
    notifyVoice: true,
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 存储不可用时只影响记忆 */
    }
  }

  function readState() {
    const s = readJson(KEY_STATE, { pets: {} });
    if (!s || typeof s !== 'object') return { pets: {} };
    if (!s.pets || typeof s.pets !== 'object') s.pets = {};
    return s;
  }

  function readCfg() {
    return Object.assign({}, DEFAULTS, readJson(KEY_CFG, {}));
  }

  // ---------- 便签（存在本地，最多 50 条） ----------
  const KEY_NOTES = 'dsh-pet.notes';

  function readNotes() {
    const arr = readJson(KEY_NOTES, []);
    return Array.isArray(arr) ? arr.filter((n) => n && typeof n.text === 'string' && n.text.trim()) : [];
  }

  function writeNotes(list) {
    writeJson(KEY_NOTES, list.slice(-50));
  }

  /** 未完成的便签（旧数据没有 done 字段，一律当作未完成） */
  function undoneNotes() {
    return readNotes().filter((n) => n.done !== true);
  }

  function dayKey(d) {
    const t = d || new Date();
    return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
  }

  function periodOf(date) {
    const h = date.getHours();
    if (h >= 4 && h < 6) return 'dawn';
    if (h >= 6 && h < 11) return 'morning';
    if (h >= 11 && h < 14) return 'noon';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }

  function inActiveHours(date) {
    const h = date.getHours();
    return h >= 9 && h < 22; // 久坐提醒只在白天工作时段
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 便签输入框 / 小游戏面板的样式（只注入一次）
  const extraStyle = document.createElement('style');
  extraStyle.textContent =
    '.pet-note-input{position:fixed;z-index:2147483000;background:#fff;border:1px solid rgba(0,0,0,.15);' +
    'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);padding:8px;width:240px}' +
    '.pet-note-input textarea{width:100%;border:none;outline:none;resize:none;font:13px/1.5 "Microsoft YaHei UI",sans-serif;' +
    'color:#2b2b2b;background:transparent}' +
    '.pet-game{position:fixed;z-index:2147483000;background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);' +
    'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:10px;font:13px/1.4 "Microsoft YaHei UI",sans-serif;color:#2b2b2b}' +
    '.pet-game-grid{display:grid;grid-template-columns:repeat(4,44px);gap:6px}' +
    '.pet-game-card{width:44px;height:44px;border-radius:8px;background:#3a63ff;color:#fff;display:flex;' +
    'align-items:center;justify-content:center;font-size:20px;cursor:pointer;user-select:none}' +
    '.pet-game-card.flipped{background:#eef2ff;color:#2b2b2b}' +
    '.pet-game-card.matched{background:#e8f7ee;color:#2b9e57;cursor:default}' +
    '.pet-game-tip{font-size:12px;color:#888;margin-bottom:8px}' +
    '.pet-note-card{position:fixed;z-index:2147482000;width:150px;padding:10px 10px 9px;background:#fff3b0;color:#5a4a12;' +
    'border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none;opacity:0;' +
    'transform:translateY(6px) rotate(-2deg);transition:opacity .25s ease,transform .25s ease;' +
    'font:12px/1.5 "Microsoft YaHei UI",sans-serif}' +
    '.pet-note-card.is-on{opacity:1;transform:translateY(0) rotate(-2deg)}' +
    '.pet-note-label{font-size:10px;color:#a08a2a;margin-bottom:4px;letter-spacing:1px}' +
    '.pet-note-text{white-space:pre-wrap;word-break:break-word;max-height:72px;overflow:hidden}' +
    '.pet-note-card::before{content:"";position:absolute;left:50%;top:-5px;width:10px;height:10px;margin-left:-5px;' +
    'border-radius:50%;background:#e5533d;box-shadow:0 1px 2px rgba(0,0,0,.25)}';
  document.head.appendChild(extraStyle);

  class PetPlay {
    constructor(sprite) {
      this.sprite = sprite;
      this.petId = sprite.pet.id;
      this.timers = [];
      this.rpsMenu = null;
      this.lastSayAt = 0;
      this.tick = this.tick.bind(this);
      this.applyTheme(readCfg().theme);
      window.__dshPetDebug = window.__dshPetDebug || {};
      window.__dshPetDebug.ttsOn = readCfg().tts;
      // 全局计时只在第一只宠物的窗口跑：多开时不会每只都在提醒
      if (CONFIG.petIndex === 0) {
        this.timers.push(window.setInterval(this.tick, 60000));
        this.timers.push(window.setTimeout(() => this.maybeGreet(true), 4000));
        this.timers.push(window.setTimeout(() => this.maybeHungry(), 12000));
      }
      window.addEventListener('storage', (e) => {
        if (e.key === KEY_CFG) this.applyTheme(readCfg().theme);
      });
    }

    dispose() {
      for (const t of this.timers) {
        window.clearInterval(t);
        window.clearTimeout(t);
      }
      this.timers = [];
      if (this.rpsMenu) {
        this.rpsMenu.close();
        this.rpsMenu = null;
      }
      if (this.noteDialog) {
        this.noteDialog.close();
        this.noteDialog = null;
      }
      if (this.gameClose) {
        this.gameClose();
        this.gameClose = null;
      }
      if (this.tapTimer) {
        window.clearTimeout(this.tapTimer);
        this.tapTimer = null;
      }
      if (this.tapGame) {
        this.tapGame.root.remove();
        this.tapGame = null;
      }
      if (this.noteCardTimer) {
        window.clearTimeout(this.noteCardTimer);
        this.noteCardTimer = null;
      }
      if (this.noteCard) {
        this.noteCard.remove();
        this.noteCard = null;
      }
      this.stopRechargeWatch();
    }

    // ---------- 气泡 + 语音 ----------
    say(id, text, anim, ms, noVoice) {
      const sp = this.sprite;
      if (anim) {
        sp.stopMove();
        sp.playOnce(anim);
      }
      sp.whisperOn = true;
      sp.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });
      sp.whisperImage = '';
      sp.renderBubble();
      if (sp.whisperTimer !== null) window.clearTimeout(sp.whisperTimer);
      sp.whisperTimer = window.setTimeout(() => {
        sp.whisperOn = false;
        sp.renderBubble();
      }, ms || 8000);
      this.lastSayAt = Date.now();
      if (!noVoice && window.PetVoice) {
        if (id) window.PetVoice.speakId(id);
        else window.PetVoice.speakText(text);
      }
    }

    // ---------- 时段问候 ----------
    maybeGreet(force) {
      const now = new Date();
      const p = periodOf(now);
      const key = dayKey(now) + ':' + p;
      const st = readState();
      const pet = st.pets[this.petId] || {};
      if (!force && pet.greetKey === key) return;
      pet.greetKey = key;
      st.pets[this.petId] = pet;
      writeJson(KEY_STATE, st);
      const g = GREETINGS[p];
      if (!g) return;
      this.say(g.id, g.text, '东张西望', 9000);
    }

    // ---------- 一分钟一拍：问候换段 / 久坐喝水 / 彩蛋 ----------
    tick() {
      const now = Date.now();
      this.maybeGreet(false);
      this.maybeBreak(now);
      this.maybeEgg(now);
      this.decayMood(now);
      this.remindNote();
      this.maybeNoteDigest();
    }

    maybeBreak(now) {
      const cfg = readCfg();
      if (!cfg.breakEnabled) return;
      if (!inActiveHours(new Date(now))) return;
      const st = readState();
      const last = Number(st.lastBreak) || 0;
      if (!last) {
        // 首次运行：从现在开始计时，避免刚装好就立刻被提醒
        st.lastBreak = now;
        writeJson(KEY_STATE, st);
        return;
      }
      if (now - last < Math.max(5, Number(cfg.breakMin) || 45) * 60000) return;
      const n = (Number(st.breakCount) || 0) + 1;
      st.lastBreak = now;
      st.breakCount = n;
      writeJson(KEY_STATE, st);
      const isBreak = n % 2 === 1;
      const id = isBreak ? pick(['break1', 'break2', 'break3']) : pick(['water1', 'water2', 'water3']);
      this.say(id, LINES[id], isBreak ? '超大伸懒腰' : '悠闲哼歌', 9000);
    }

    maybeEgg(now) {
      const cfg = readCfg();
      if (!cfg.eggs) return;
      if (!inActiveHours(new Date(now))) return;
      const sp = this.sprite;
      if (sp.menuOpen || sp.chatOpen || sp.whisperOn || sp.workOn) return;
      if (now - (this.lastSayAt || 0) < 5 * 60000) return;
      if (Math.random() > 0.02) return; // 约每分钟 2%，平均 ~50 分钟一次
      const id = pick(['egg1', 'egg2', 'egg3', 'egg4']);
      const anims = { egg1: '点击回应-开心跃动', egg2: '东张西望', egg3: '点击回应-害羞惊讶', egg4: '照镜子' };
      this.say(id, LINES[id], anims[id], 7000);
    }

    // ---------- 心情：不回访会缓慢下降，投喂/签到回升 ----------
    decayMood(now) {
      const st = readState();
      const pet = st.pets[this.petId] || (st.pets[this.petId] = {});
      if (pet.lastMoodAt === undefined) {
        pet.lastMoodAt = now;
        pet.mood = pet.mood === undefined ? 70 : pet.mood;
        st.pets[this.petId] = pet;
        writeJson(KEY_STATE, st);
        return;
      }
      if (now - pet.lastMoodAt < 30 * 60000) return;
      const steps = Math.floor((now - pet.lastMoodAt) / (30 * 60000));
      pet.mood = Math.max(0, (Number(pet.mood) || 0) - steps * 3);
      pet.lastMoodAt = now;
      st.pets[this.petId] = pet;
      writeJson(KEY_STATE, st);
    }

    maybeHungry() {
      const st = readState();
      const pet = st.pets[this.petId] || {};
      const mood = Number.isFinite(Number(pet.mood)) ? Number(pet.mood) : 70;
      if (mood < 30 && !this.sprite.workOn) {
        this.say('feed_hungry', LINES.feed_hungry, '原地下蹲玩玩具汽车', 7000);
      }
    }

    // ---------- 点击：签到 / 亲密度 ----------
    onClick() {
      // 点击挑战进行中：只计数，不触发签到/亲密度，避免刷屏
      if (this.tapGame && Date.now() < this.tapGame.until) {
        this.tapGame.count++;
        this.tapGame.el.textContent = String(this.tapGame.count);
        return;
      }
      const now = Date.now();
      const dk = dayKey();
      const st = readState();
      const pet = st.pets[this.petId] || (st.pets[this.petId] = {});
      let lineId = null;
      if (pet.lastCheckin !== dk) {
        // 每天第一次点击：签到现在这天 + 说一次「今天第一次摸我」。之后当天再点不再念这句。
        const yesterday = dayKey(new Date(now - 86400000));
        pet.streak = pet.lastCheckin === yesterday ? (Number(pet.streak) || 0) + 1 : 1;
        pet.lastCheckin = dk;
        pet.intimacy = (Number(pet.intimacy) || 0) + 5;
        pet.mood = Math.min(100, (Number(pet.mood) || 70) + 5);
        lineId = 'checkin_low';
      } else {
        pet.intimacy = (Number(pet.intimacy) || 0) + 1;
      }
      const level = Math.floor((Number(pet.intimacy) || 0) / 20);
      if (level > (Number(pet.level) || 0)) {
        pet.level = level;
        lineId = 'checkin_level';
      }
      st.pets[this.petId] = pet;
      writeJson(KEY_STATE, st);
      if (lineId) {
        let text = LINES[lineId];
        if (lineId === 'checkin_low') {
          text += '（连续 ' + (Number(pet.streak) || 1) + ' 天 · 亲密度 ' + (Number(pet.intimacy) || 0) + '）';
        } else if (lineId === 'checkin_level') {
          text += '（亲密度 ' + (Number(pet.intimacy) || 0) + '）';
        }
        this.say(lineId, text, '点击回应-开心跃动', 6000);
      }
    }

    // ---------- 喂零食 ----------
    feed() {
      const now = Date.now();
      const st = readState();
      const pet = st.pets[this.petId] || (st.pets[this.petId] = {});
      const mood = Number(pet.mood);
      if (now - (Number(pet.lastFeed) || 0) < 60000) {
        this.say('feed_full', LINES.feed_full, '点击回应-傲娇生气', 6000);
        return;
      }
      pet.lastFeed = now;
      pet.mood = Math.min(100, (Number.isFinite(mood) ? mood : 70) + 14);
      pet.intimacy = (Number(pet.intimacy) || 0) + 2;
      pet.lastMoodAt = now;
      const level = Math.floor(pet.intimacy / 20);
      st.pets[this.petId] = pet;
      writeJson(KEY_STATE, st);
      const id = pick(['feed1', 'feed2']);
      this.say(id, LINES[id] + '（心情 ' + pet.mood + '）', '吃白饭', 8000);
      if (level > (Number(pet.level) || 0)) {
        pet.level = level;
        st.pets[this.petId] = pet;
        writeJson(KEY_STATE, st);
      }
    }

    // ---------- 便签 ----------
    openNoteInput() {
      if (this.noteDialog) {
        this.noteDialog.close();
        return;
      }
      const sp = this.sprite;
      const r = sp.hit.getBoundingClientRect();
      sp.stopMove();
      const root = document.createElement('div');
      root.className = 'pet-note-input';
      const ta = document.createElement('textarea');
      ta.rows = 1;
      ta.maxLength = 120;
      ta.placeholder = '记一条便签，回车保存';
      root.appendChild(ta);
      document.body.appendChild(root);
      root.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 260)) + 'px';
      root.style.top = Math.max(6, r.top - 68) + 'px';
      // 面板先在 DOM 里定位好，再上报可交互区域（否则主进程仍按“光标不在宠物上”穿透）
      sp.chatOpen = true;
      sp.setInteractive(true);
      sp.syncInputBusy();
      ta.focus();
      const onDocDown = (e) => {
        if (!root.contains(e.target)) close();
      };
      const close = () => {
        if (!this.noteDialog) return;
        document.removeEventListener('mousedown', onDocDown, true);
        root.remove();
        this.noteDialog = null;
        sp.chatOpen = false;
        sp.syncInputBusy();
        if (!sp.inputBusy()) sp.setInteractive(false);
      };
      const submit = () => {
        const t = ta.value.trim();
        if (!t) return;
        close();
        this.addNote(t);
      };
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') {
          close();
        }
      });
      document.addEventListener('mousedown', onDocDown, true);
      this.noteDialog = { close };
    }

    addNote(text) {
      const t = String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!t) return;
      const list = readNotes();
      list.push({ text: t, ts: Date.now(), done: false });
      writeNotes(list);
      this.say(null, '记下啦：' + t, '轻快记录', 7000, true);
    }

    viewNotes() {
      const all = readNotes();
      const list = undoneNotes();
      if (!list.length) {
        this.say(
          null,
          all.length ? '便签都做完啦，真棒！' : '便签本是空的，右键「玩法 → 便签 → 记一条」写点东西吧。',
          '东张西望',
          7000,
          true,
        );
        return;
      }
      const tail = list
        .slice(-5)
        .map((n, i) => i + 1 + '. ' + n.text)
        .join('；');
      const doneCount = all.length - list.length;
      this.say(
        null,
        '还有 ' + list.length + ' 条没做' + (doneCount ? '（已完成 ' + doneCount + ' 条）' : '') + '：' + tail,
        '轻快记录',
        14000,
        true,
      );
    }

    /** 把一条便签标记完成（按 ts 匹配） */
    completeNote(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n)) return;
      const list = readNotes();
      const note = list.find((x) => Number(x.ts) === n);
      if (!note || note.done === true) return;
      note.done = true;
      note.doneAt = Date.now();
      writeNotes(list);
      const left = list.filter((x) => x.done !== true).length;
      this.say(null, '搞定一条：「' + note.text + '」' + (left ? '还剩 ' + left + ' 条。' : '全部做完啦！'), '点击回应-开心跃动', 7000);
    }

    clearDoneNotes() {
      const list = readNotes();
      const done = list.filter((x) => x.done === true).length;
      writeNotes(list.filter((x) => x.done !== true));
      this.say(null, done ? '清掉了 ' + done + ' 条已完成的便签。' : '还没有已完成的便签。', '点击回应-元气挥手', 5000, true);
    }

    clearNotes() {
      const n = readNotes().length;
      writeNotes([]);
      this.say(null, n ? '便签已经清空啦（删了 ' + n + ' 条）。' : '便签本来就是空的。', '点击回应-元气挥手', 5000, true);
    }

    /** 每分钟在宠物旁边浮一张便签（只提醒未完成的，轮流显示，10 秒自动淡出） */
    remindNote() {
      const cfg = readCfg();
      if (!cfg.notesRemind) return;
      const list = undoneNotes();
      if (!list.length) return;
      const sp = this.sprite;
      if (document.hidden || sp.menuOpen || sp.chatOpen || sp.dragState.active) return;
      if (this.noteDialog || this.gameClose) return;
      if (this.noteCard) return; // 上一张还没消失，不叠加
      const idx = (this.noteCursor || 0) % list.length;
      this.noteCursor = idx + 1;
      this.showNoteCard(list[idx].text, list.length, idx + 1);
    }

    /** 晚上 21 点后汇总一次今天还没做完的便签（每天一次） */
    maybeNoteDigest() {
      const cfg = readCfg();
      if (!cfg.notesRemind) return;
      const now = new Date();
      if (now.getHours() < 21) return;
      const dk = dayKey(now);
      let last = '';
      try {
        last = localStorage.getItem('dsh-pet.notes.digest') || '';
      } catch {
        /* 存储不可用就每次都提醒 */
      }
      if (last === dk) return;
      const list = undoneNotes();
      if (!list.length) return;
      try {
        localStorage.setItem('dsh-pet.notes.digest', dk);
      } catch {
        /* 忽略 */
      }
      const tail = list
        .slice(0, 3)
        .map((n) => n.text)
        .join('、');
      this.say(
        null,
        '今天还有 ' + list.length + ' 条便签没做：' + tail + (list.length > 3 ? '…' : ''),
        '轻快记录',
        12000,
        true,
      );
    }

    showNoteCard(text, total, index) {
      const sp = this.sprite;
      const r = sp.hit.getBoundingClientRect();
      const card = document.createElement('div');
      card.className = 'pet-note-card';
      const label = document.createElement('div');
      label.className = 'pet-note-label';
      label.textContent = '便签 ' + index + '/' + total;
      const body = document.createElement('div');
      body.className = 'pet-note-text';
      body.textContent = text;
      card.appendChild(label);
      card.appendChild(body);
      document.body.appendChild(card);
      const w = card.offsetWidth || 150;
      const h = card.offsetHeight || 80;
      let left = r.right + 10;
      if (left + w > window.innerWidth - 6) left = r.left - w - 10;
      if (left < 6) left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left));
      const top = Math.max(6, Math.min(window.innerHeight - h - 6, r.top + 12));
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      this.noteCard = card;
      window.requestAnimationFrame(() => card.classList.add('is-on'));
      this.noteCardTimer = window.setTimeout(() => {
        card.classList.remove('is-on');
        window.setTimeout(() => {
          card.remove();
          if (this.noteCard === card) this.noteCard = null;
        }, 260);
        this.noteCardTimer = null;
      }, 10000);
    }

    // ---------- 小游戏：记忆翻牌 ----------
    openMemory() {
      if (this.gameClose) {
        this.gameClose();
        return;
      }
      const sp = this.sprite;
      const r = sp.hit.getBoundingClientRect();
      sp.stopMove();
      const root = document.createElement('div');
      root.className = 'pet-game';
      const tip = document.createElement('div');
      tip.className = 'pet-game-tip';
      tip.textContent = '翻开两张一样的就配对';
      const closeBtn = document.createElement('div');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'position:absolute;right:6px;top:4px;width:20px;height:20px;line-height:18px;' +
        'text-align:center;border-radius:50%;cursor:pointer;color:#999;font-size:16px';
      closeBtn.addEventListener('click', () => close());
      root.appendChild(tip);
      root.appendChild(closeBtn);
      const grid = document.createElement('div');
      grid.className = 'pet-game-grid';
      root.appendChild(grid);
      const symbols = ['🐟', '🍚', '🎀', '💙', '🐟', '🍚', '🎀', '💙'];
      for (let i = symbols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
      }
      let flipped = [];
      let matched = 0;
      let lock = false;
      symbols.forEach((s) => {
        const el = document.createElement('div');
        el.className = 'pet-game-card';
        el.addEventListener('click', () => {
          if (lock || el.classList.contains('flipped') || el.classList.contains('matched')) return;
          el.textContent = s;
          el.classList.add('flipped');
          flipped.push({ el, s });
          if (flipped.length < 2) return;
          const [a, b] = flipped;
          if (a.s === b.s) {
            a.el.classList.add('matched');
            b.el.classList.add('matched');
            matched++;
            flipped = [];
            if (matched === 4) {
              close();
              this.say(null, '全部配对啦，你真厉害！', '点击回应-开心跃动', 7000);
            }
          } else {
            lock = true;
            setTimeout(() => {
              a.el.textContent = '';
              b.el.textContent = '';
              a.el.classList.remove('flipped');
              b.el.classList.remove('flipped');
              flipped = [];
              lock = false;
            }, 600);
          }
        });
        grid.appendChild(el);
      });
      document.body.appendChild(root);
      root.style.left = Math.max(6, Math.min(r.left, window.innerWidth - root.offsetWidth - 6)) + 'px';
      root.style.top = Math.max(6, r.top - root.offsetHeight - 10) + 'px';
      // 面板定位后再上报可交互区域，否则主进程会把点击判成“穿透到下层窗口”
      sp.chatOpen = true;
      sp.setInteractive(true);
      sp.syncInputBusy();
      const onKey = (e) => {
        if (e.key === 'Escape') close();
      };
      const close = () => {
        if (!this.gameClose) return;
        document.removeEventListener('keydown', onKey, true);
        root.remove();
        this.gameClose = null;
        sp.chatOpen = false;
        sp.syncInputBusy();
        if (!sp.inputBusy()) sp.setInteractive(false);
      };
      document.addEventListener('keydown', onKey, true);
      this.gameClose = close;
    }

    // ---------- 小游戏：10 秒点击挑战 ----------
    startTapGame() {
      if (this.tapGame) return;
      const sp = this.sprite;
      const r = sp.hit.getBoundingClientRect();
      const root = document.createElement('div');
      root.className = 'pet-game';
      const tip = document.createElement('div');
      tip.className = 'pet-game-tip';
      tip.textContent = '10 秒内点我，看能点几下';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:26px;font-weight:700;text-align:center;color:#3a63ff';
      label.textContent = '0';
      root.appendChild(tip);
      root.appendChild(label);
      document.body.appendChild(root);
      root.style.left = Math.max(6, Math.min(r.left, window.innerWidth - root.offsetWidth - 6)) + 'px';
      root.style.top = Math.max(6, r.top - root.offsetHeight - 10) + 'px';
      const until = Date.now() + 10000;
      this.tapGame = { until, count: 0, el: label, root };
      this.say(null, '10 秒内点我，看你能点几下！', '点击回应-元气挥手', 3000);
      this.tapTimer = window.setTimeout(() => {
        const n = this.tapGame ? this.tapGame.count : 0;
        if (this.tapGame) this.tapGame.root.remove();
        this.tapGame = null;
        this.tapTimer = null;
        const msg = '你点了我 ' + n + ' 下！' + (n >= 30 ? '好快的手速～' : '再来一次嘛。');
        this.say(null, msg, '点击回应-开心跃动', 7000);
      }, 10000);
    }

    // ---------- 充值 ----------
    openRecharge() {
      const url = 'https://platform.deepseek.com/top_up';
      if (window.petBridge && window.petBridge.openUrl) window.petBridge.openUrl(url);
      this.say(null, '充值页面打开啦，到账后我会喊你～', '点击回应-元气挥手', 5000);
      this.startRechargeWatch();
    }

    /** 当前余额（money 形态）的数值；拿不到返回 null */
    balanceTotal() {
      try {
        if (!balance || balance.ok !== true || balance.shape !== 'money') return null;
        const n = Number(balance.total);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    }

    /** 打开充值页后盯 20 分钟：每 30 秒让宿主刷一次余额，涨了就庆祝（期间不弹余额气泡） */
    startRechargeWatch() {
      this.stopRechargeWatch();
      this.rechargeWatch = { base: this.balanceTotal(), until: Date.now() + 20 * 60000, check: null, poll: null };
      this.sprite.rechargeWatch = true;
      this.rechargeWatch.check = window.setInterval(() => {
        const w = this.rechargeWatch;
        if (!w) return;
        if (Date.now() > w.until) {
          this.stopRechargeWatch();
          return;
        }
        const cur = this.balanceTotal();
        if (cur === null) return;
        if (w.base === null) {
          w.base = cur;
          return;
        }
        if (cur > w.base + 0.005) {
          this.stopRechargeWatch();
          this.celebrateRecharge(cur);
        }
      }, 5000);
      this.rechargeWatch.poll = window.setInterval(() => {
        if (!this.rechargeWatch) return;
        S.postAction(BALANCE_URL).catch(() => {});
      }, 30000);
    }

    stopRechargeWatch() {
      if (!this.rechargeWatch) return;
      window.clearInterval(this.rechargeWatch.check);
      window.clearInterval(this.rechargeWatch.poll);
      this.rechargeWatch = null;
      if (this.sprite) this.sprite.rechargeWatch = false;
    }

    celebrateRecharge(total) {
      const n = Number(total);
      this.say(
        'recharge',
        '充值到账啦！又吃到大白饭啦～' + (Number.isFinite(n) ? '（余额 ' + n.toFixed(2) + '）' : ''),
        '点击回应-开心跃动',
        10000,
      );
    }

    // ---------- 猜拳 ----------
    openRps() {
      if (this.rpsMenu) {
        this.rpsMenu.close();
        this.rpsMenu = null;
        return;
      }
      const sp = this.sprite;
      const r = sp.hit.getBoundingClientRect();
      sp.stopMove();
      // 和右键菜单同一套穿透守卫：菜单开着期间整窗保持可交互（否则光标移出身体就被翻回穿透）
      sp.menuOpen = true;
      sp.setInteractive(true);
      sp.syncInputBusy();
      this.say('rps_start', LINES.rps_start, '东张西望', 5000);
      this.rpsMenu = S.mountContextMenu({
        tree: [
          { label: '石头 ✊', action: 'rock' },
          { label: '剪刀 ✌', action: 'scissors' },
          { label: '布 ✋', action: 'paper' },
        ],
        x: r.left + r.width / 2,
        y: r.top - 10,
        clamp: sp.visibleClampRect ? sp.visibleClampRect() : null,
        onAction: (leaf) => this.finishRps(leaf.action),
        onClose: () => {
          this.rpsMenu = null;
          sp.menuOpen = false;
          sp.syncInputBusy();
          if (!sp.inputBusy()) sp.setInteractive(false);
        },
      });
    }

    finishRps(player) {
      this.rpsMenu = null;
      const moves = ['rock', 'scissors', 'paper'];
      const names = { rock: '石头', scissors: '剪刀', paper: '布' };
      const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
      const petMove = pick(moves);
      let id;
      let anim;
      if (player === petMove) {
        id = 'rps_draw';
        anim = '东张西望';
      } else if (beats[player] === petMove) {
        id = 'rps_lose'; // 玩家赢 → 宠物输
        anim = '点击回应-傲娇生气';
      } else {
        id = 'rps_win';
        anim = '点击回应-开心跃动';
      }
      const st = readState();
      const pet = st.pets[this.petId] || (st.pets[this.petId] = {});
      pet.rps = pet.rps || { w: 0, l: 0, d: 0 };
      if (id === 'rps_win') pet.rps.w++;
      else if (id === 'rps_lose') pet.rps.l++;
      else pet.rps.d++;
      st.pets[this.petId] = pet;
      writeJson(KEY_STATE, st);
      this.say(
        id,
        '你出' + names[player] + '，我出' + names[petMove] + '。' + LINES[id] + '（我 ' + pet.rps.w + ' 胜）',
        anim,
        8000,
      );
    }

    // ---------- 主题 ----------
    applyTheme(id) {
      const theme = THEMES[id] || THEMES.default;
      const stage = this.sprite.stage;
      if (!stage) return;
      stage.style.transition = 'filter .45s ease';
      stage.style.filter = theme.filter;
    }

    setTheme(id) {
      const cfg = readCfg();
      cfg.theme = THEMES[id] ? id : 'default';
      writeJson(KEY_CFG, cfg);
      this.applyTheme(cfg.theme);
      const lineId = pick(['theme1', 'theme2']);
      this.say(lineId, LINES[lineId] + '（' + THEMES[cfg.theme].label + '）', '整体换装试色', 7000);
    }

    // ---------- 菜单 ----------
    menuItems() {
      const cfg = readCfg();
      const st = readState();
      const pet = st.pets[this.petId] || {};
      const intimacy = Number(pet.intimacy) || 0;
      const streak = Number(pet.streak) || 0;
      const mood = Number.isFinite(Number(pet.mood)) ? Number(pet.mood) : 70;
      return [
        {
          label: '玩法',
          children: [
            { label: '签到 · 亲密度 ' + intimacy + ' · 连续 ' + streak + ' 天', action: 'play-status' },
            { label: '便签', children: [
              { label: '记一条', action: 'play-note-add' },
              { label: '查看（未完成 ' + undoneNotes().length + ' 条）', action: 'play-note-view' },
              ...(undoneNotes().length
                ? [{
                    label: '完成一条',
                    children: undoneNotes().slice(-8).map((n) => ({
                      label: n.text.length > 14 ? n.text.slice(0, 14) + '…' : n.text,
                      action: 'play-note-done',
                      noteTs: n.ts,
                    })),
                  }]
                : []),
              { label: '清空已完成（' + (readNotes().length - undoneNotes().length) + ' 条）', action: 'play-note-clear-done' },
              { label: '每分钟提醒：' + (cfg.notesRemind ? '开' : '关'), action: 'play-toggle-note-remind' },
              { label: '清空全部', action: 'play-note-clear' },
            ] },
            { label: '小游戏', children: [
              { label: '猜拳（我 ' + (pet.rps?.w || 0) + ' 胜）', action: 'play-rps' },
              { label: '记忆翻牌', action: 'play-memory' },
              { label: '点击挑战（10 秒）', action: 'play-tap' },
            ] },
            { label: '喂零食（心情 ' + mood + '）', action: 'play-feed' },
            { label: '久坐提醒：' + (cfg.breakEnabled ? '开' : '关'), action: 'play-toggle-break' },
            { label: '朗读：' + (cfg.tts ? '开' : '关'), action: 'play-toggle-tts' },
            { label: '语音播报：' + (cfg.notifyVoice ? '开' : '关'), action: 'play-toggle-notify-voice' },
            { label: '随机彩蛋：' + (cfg.eggs ? '开' : '关'), action: 'play-toggle-eggs' },
            // 换装：服装包来自 ~/.dsh/dsh-pet/outfits/（A 方案接动画包，B 方案接静态立绘 PNG）
            ...(window.PetWardrobe && window.PetWardrobe.list().length > 1
              ? [
                  {
                    label: '换装',
                    children: window.PetWardrobe.list().map((o) => ({
                      label: (o.id === window.PetWardrobe.currentId() ? '✓ ' : '\u3000') + (o.label || o.id),
                      action: 'play-outfit',
                      outfit: o.id,
                    })),
                  },
                ]
              : []),
            {
              label: '主题',
              children: Object.keys(THEMES).map((id) => ({
                label: (id === cfg.theme ? '✓ ' : '\u3000') + THEMES[id].label,
                action: 'play-theme',
                theme: id,
              })),
            },
          ],
        },
      ];
    }

    onMenuAction(leaf) {
      if (!leaf || typeof leaf !== 'object' || !String(leaf.action || '').startsWith('play-')) return false;
      const cfg = readCfg();
      switch (leaf.action) {
        case 'play-status': {
          const st = readState();
          const pet = st.pets[this.petId] || {};
          const mood = Number.isFinite(Number(pet.mood)) ? Number(pet.mood) : 70;
          this.say(
            null,
            '亲密度 ' +
              (Number(pet.intimacy) || 0) +
              '，连续签到 ' +
              (Number(pet.streak) || 0) +
              ' 天，心情 ' +
              mood +
              '。今天我陪你呀。',
            '女仆屈膝礼仪',
            8000,
          );
          return true;
        }
        case 'play-rps':
          this.openRps();
          return true;
        case 'play-note-add':
          this.openNoteInput();
          return true;
        case 'play-note-view':
          this.viewNotes();
          return true;
        case 'play-note-done':
          this.completeNote(leaf.noteTs);
          return true;
        case 'play-note-clear-done':
          this.clearDoneNotes();
          return true;
        case 'play-note-clear':
          this.clearNotes();
          return true;
        case 'play-toggle-note-remind':
          cfg.notesRemind = !cfg.notesRemind;
          writeJson(KEY_CFG, cfg);
          this.say(null, cfg.notesRemind ? '好呀，每分钟给你看一眼便签。' : '便签提醒先关掉。', '点击回应-元气挥手', 5000);
          return true;
        case 'play-toggle-notify-voice':
          cfg.notifyVoice = !cfg.notifyVoice;
          writeJson(KEY_CFG, cfg);
          this.say(null, cfg.notifyVoice ? '任务状态我会念给你听。' : '状态播报先关掉。', '点击回应-元气挥手', 5000);
          return true;
        case 'play-memory':
          this.openMemory();
          return true;
        case 'play-tap':
          this.startTapGame();
          return true;
        case 'play-feed':
          this.feed();
          return true;
        case 'play-toggle-break':
          cfg.breakEnabled = !cfg.breakEnabled;
          writeJson(KEY_CFG, cfg);
          this.say(null, cfg.breakEnabled ? '久坐提醒打开啦。' : '久坐提醒先关掉。', '点击回应-元气挥手', 5000);
          return true;
        case 'play-toggle-tts':
          cfg.tts = !cfg.tts;
          writeJson(KEY_CFG, cfg);
          this.say(null, cfg.tts ? '好呀，我会念给你听。' : '那我先安静一点。', '点击回应-元气挥手', 5000);
          return true;
        case 'play-toggle-eggs':
          cfg.eggs = !cfg.eggs;
          writeJson(KEY_CFG, cfg);
          this.say(null, cfg.eggs ? '彩蛋打开啦，留意我哦。' : '彩蛋先收起来。', '点击回应-害羞惊讶', 5000);
          return true;
        case 'play-theme':
          this.setTheme(leaf.theme);
          return true;
        case 'play-outfit': {
          if (!window.PetWardrobe) return true;
          window.PetWardrobe.setOutfit(leaf.outfit);
          const pack = window.PetWardrobe.current();
          const lineId = pack && pack.static ? 'theme1' : 'theme2';
          this.say(lineId, LINES[lineId] + (pack ? '（' + (pack.label || pack.id) + '）' : ''), '整体换装试色', 7000);
          return true;
        }
        default:
          return false;
      }
    }
  }

  // 朗读钩子：events.js 在本文件之后会重新定义 showWhisper，直接在这里 patch 会被覆盖，
  // 所以只暴露入口，由 renderer.js（最后一个脚本）在所有定义完成后再包一层。
  window.PetTTS = {
    readAloud(text) {
      const cfg = readCfg();
      if (!cfg.tts || !window.PetVoice || !text) return;
      window.PetVoice.speakText(String(text).slice(0, 220));
    },
    /** 任务状态播报：只在状态变化时调用（由 renderer 包 onWorkTick 触发） */
    announce(state) {
      const cfg = readCfg();
      if (!cfg.tts || !cfg.notifyVoice || !window.PetVoice) return;
      const map = {
        success: '这一轮搞定啦，真棒！',
        error: '这一步好像没跑通，你看一下。',
        waiting: '需要你确认一下哦。',
      };
      const text = map[state];
      if (text) window.PetVoice.speakText(text);
    },
    /** 手动查看余额时朗读一句（renderer 在 showBalanceNow 之后调用） */
    speakBalance(state) {
      const cfg = readCfg();
      if (!cfg.tts || !window.PetVoice || !state || state.ok !== true) return;
      let text;
      if (state.shape === 'money') {
        const unit = state.currency === 'USD' ? '美元' : '元';
        text = '当前余额 ' + (state.total ?? '未知') + ' ' + unit;
        if (state.tier === 'peak') text += '，还算充足。';
        else if (state.tier === 'idle') text += '，有点紧张了，记得充值哦。';
        else text += '。';
      } else {
        const rows = S.balanceBubbleView(state);
        text = '当前额度：' + rows.map((r) => r.text).join('，') + '。';
      }
      window.PetVoice.speakText(text);
    },
  };

  const origDispose = PetSprite.prototype.dispose;
  PetSprite.prototype.dispose = function disposeWithPlay() {
    if (this.play) {
      this.play.dispose();
      this.play = null;
    }
    origDispose.call(this);
  };

  window.PetPlay = PetPlay;
  window.__dshPetDebug = window.__dshPetDebug || {};
  window.__dshPetDebug.playLoaded = true;
})();
