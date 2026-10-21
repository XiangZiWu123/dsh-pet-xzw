// 换装层：读取 ~/.dsh/dsh-pet/outfits/outfits.js 里的 window.PET_OUTFITS，
// 提供「服装包 → 动画 URL」的映射与静态立绘模式。
//   - 动画包（A-lite）：outfits/<id>/webm/<动画名>.webm，名单由 scan.mjs 扫描生成；
//     包里有同名文件就用包里的，没有就回退原版素材（sprite.switchTo 里做）。
//   - 静态立绘（B）：outfits/<id>/stand.png，一张图顶替全部动画。
//   - 选择存 localStorage dsh-pet.outfit；切回 default 即原版动画。
(function () {
  'use strict';

  const KEY = 'dsh-pet.outfit';
  // 兜底相对路径：从 runtime/electron-helper/ 上溯 6 层到 ~/.dsh/ 再进 dsh-pet/outfits/。
  // 插件目录被 junction/symlink 指到别的盘时（例如装到 D:），页面真实路径不在 C:，这条会跨盘失效；
  // 所以启动时以 host 的 /outfits 给出的绝对 file:// 根目录为准。
  let root = '../../../../../../dsh-pet/outfits/';

  function list() {
    const raw = window.PET_OUTFITS;
    if (!Array.isArray(raw)) return [];
    return raw.filter((o) => o && typeof o.id === 'string' && o.id);
  }

  function find(id) {
    return list().find((o) => o.id === id) || null;
  }

  function currentId() {
    try {
      return localStorage.getItem(KEY) || 'default';
    } catch {
      return 'default';
    }
  }

  function current() {
    const o = find(currentId());
    // default / 找不到的 id 都按原版处理
    return o && o.id !== 'default' ? o : null;
  }

  /** 该动画在服装包里的 URL；没有则返回 null（调用方回落原版素材） */
  function urlFor(anim) {
    const o = current();
    if (!o || o.static) return null;
    if (Array.isArray(o.animations) && o.animations.indexOf(anim) < 0) return null;
    return root + encodeURIComponent(o.id) + '/webm/' + encodeURIComponent(anim) + '.webm';
  }

  function standUrl() {
    const o = current();
    if (!o || !o.static) return null;
    return root + encodeURIComponent(o.id) + '/' + encodeURIComponent(o.stand || 'stand.png');
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** 悬空姿势是“被拎着”的定格，混进待机会像挂在半空，不进待机池 */
  const HELD = ['被鼠标拖拽悬空反馈'];

  /**
   * 动画包在场时把各动画池收窄到包里有的素材，切回原版时还原。
   * 待机池收全部有素材的镜头（被拎着那种除外），分类池只在整类都覆盖时保留：
   * 否则只剩一两个动作，会变成机械重复。
   */
  function poolFor(all, pack) {
    const has = (n) => pack.animations.indexOf(n) >= 0;
    const keep = (pool) => {
      if (!Array.isArray(pool)) return pool;
      const kept = pool.filter(has);
      return kept.length ? kept : pool;
    };
    const cats = (all.categories || [])
      .map((c) => ({ c, kept: c.actions.filter(has) }))
      .filter(({ c, kept }) => kept.length === c.actions.length && kept.length > 0)
      .map(({ c, kept }) => ({ ...c, actions: kept }));
    const face = pack.animations.indexOf('待机呼吸休闲') >= 0 ? ['待机呼吸休闲'] : [];
    const idle = face.concat(pack.animations.filter((n) => face.indexOf(n) < 0 && HELD.indexOf(n) < 0));
    return {
      ...all,
      idle: idle.length ? idle : keep(all.idle),
      turn: keep(all.turn),
      drag: keep(all.drag),
      clicks: keep(all.clicks),
      moves: all.moves ? { ...all.moves, actions: keep(all.moves.actions) } : all.moves,
      categories: cats,
    };
  }

  /** 把当前选择应用到某个 sprite（boot 与切换时都走这里） */
  function apply(sprite) {
    if (!sprite) return;
    const pack = current();
    trace((pack ? pack.id : 'default') + '|' + (sprite.anim || '-') + '|apply');
    // 池子：原版用全部动作；动画包只挑包里有的，避免播到一半换回原版素材
    if (pack && !pack.static) {
      if (!sprite.__allAnims) sprite.__allAnims = clone(sprite.animations);
      sprite.animations = poolFor(sprite.__allAnims, pack);
    } else if (sprite.__allAnims) {
      sprite.animations = sprite.__allAnims;
    }
    sprite.outfitSrc = urlFor;
    const stand = standUrl();
    if (stand) {
      sprite.setStaticMode(stand);
      return;
    }
    const wasStatic = sprite.staticMode;
    sprite.clearStaticMode();
    // 播完再换会慢一拍：立刻重载一次。当前这条动作在包里没有素材（比如正在玩魔方）就换成待机首段，
    // 否则 switchTo 拿不到包里的 URL，会静静回落到原版素材。
    if (!wasStatic) {
      const keep = sprite.anim && urlFor(sprite.anim) ? sprite.anim : null;
      const next = keep || (sprite.animations.idle && sprite.animations.idle[0]) || sprite.anim;
      if (next) {
        try {
          sprite.switchTo(next, sprite.once);
        } catch (e) {
          console.warn('[dsh-pet] 换装切换失败，改用直接换源：' + e.message);
        }
        // 双缓冲切换要等新素材 loadeddata 才换前台，任何一步没生效就会停在原版上；
        // 这里兜底核对几次，前台还不是包里素材就直接把前台换掉，保证点了就变。
        for (const delay of [350, 900, 1800]) {
          setTimeout(() => {
            try {
              forceVideo(sprite, next);
            } catch {
              /* 兜底失败就维持现状 */
            }
          }, delay);
        }
      }
    }
  }

  /** 换装诊断：窗口标题写着最近一次换装走到哪一步（无边框窗口，标题不可见，只给我排查用） */
  function trace(msg) {
    try {
      document.title = 'dsh-pet|' + msg;
    } catch {
      /* 标题写不进去就算了 */
    }
  }

  /** 前台的视频还不是包里的素材时，直接换源播放（换装兜底）。 */
  function forceVideo(sprite, anim) {
    const pack = current();
    const src = urlFor(anim);
    if (!pack || !src) return;
    const el = sprite.front === 0 ? sprite.videoA : sprite.videoB;
    if (!el) return;
    if ((el.src || '').indexOf(encodeURIComponent(pack.id)) >= 0) {
      trace(pack.id + '|' + anim + '|ok');
      return;
    }
    el.pause();
    el.onended = () => sprite.handleEnded && sprite.handleEnded();
    el.src = src;
    el.loop = false;
    el.muted = true;
    el.playsInline = true;
    el.load();
    el.play().catch(() => {});
    sprite.anim = anim;
    sprite.pending = null;
    trace(pack.id + '|' + anim + '|forced');
  }

  function setOutfit(id) {
    const next = find(id) ? id : 'default';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 存储不可用时只影响记忆 */
    }
    for (const s of sprites) apply(s);
    return next;
  }

  // 静态立绘的呼吸动画（放在 JS 里注入，避免再改 index.html）
  const style = document.createElement('style');
  style.textContent =
    '.pet-stand{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;' +
    'opacity:0;transition:opacity .25s ease;animation:petStandBreathe 3.6s ease-in-out infinite}' +
    '@keyframes petStandBreathe{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(-2px) scaleY(1.008)}}' +
    '@media (prefers-reduced-motion: reduce){.pet-stand{animation:none}}';
  document.head.appendChild(style);

  // 服装包清单与绝对根目录由 host 提供：页面可能跑在 junction 后的真实路径上，相对路径会跨盘失效
  fetch(BASE + '/outfits')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      if (typeof d.root === 'string' && d.root) root = d.root;
      if (Array.isArray(d.list)) window.PET_OUTFITS = d.list;
      for (const s of sprites) apply(s);
    })
    .catch(() => {
      /* host 不可达：维持相对路径与已有的 window.PET_OUTFITS */
    });

  window.PetWardrobe = { list, current, currentId, setOutfit, urlFor, standUrl, apply };
})();
