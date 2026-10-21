# dsh-pet-xzw 使用与维护指南

给自己的备忘：这个插件是什么、装在哪、怎么改、坏了怎么修。

---

## 一、这是什么

| 项 | 值 |
|---|---|
| GitHub | `https://github.com/XiangZiWu123/dsh-pet-xzw` |
| 来源 | fork 自 `PC2005-cloud/dsh-pet`，基线 `v0.3.7`，已合并上游 `main`（57 条提交） |
| 许可 | MIT（保留上游 LICENSE 与版权声明） |
| 包名 / 插件 id | `dsh-pet-xzw` |
| 本地仓库 | `D:\dsh-plugins\dsh-pet-xzw`（包本体在其下的 `dsh-pet\` 子目录） |
| 已装位置 | `C:\Users\lenovo\.dsh\profiles\desktop\node_modules\dsh-pet-xzw` → junction 到上面的包目录 |
| 用户数据 | `C:\Users\lenovo\.dsh\dsh-pet`（服装、语音、记忆）**永远不要改名** |

与上游的差异（本地定制层，9 个文件）：

- `features.js` 玩法层（签到/猜拳/投喂/彩蛋/主题/换装菜单/朗读钩子）
- `voice.js` + `sound.js` 语音与音效
- `wardrobe.js` 换装（清单加载、动画池过滤、强制换源）
- `main.js` / `preload.js` TTS IPC 与按句缓存
- `sprite.js` / `renderer.js` / `index.html` 接线

---

## 二、装在哪、怎么重启

```
C:\Users\lenovo\.dsh\profiles\desktop\
├─ package.json              依赖 + dsh.profile.bundles（两者都要有 dsh-pet-xzw）
└─ node_modules\dsh-pet-xzw  → junction → D:\dsh-plugins\dsh-pet-xzw\dsh-pet
```

改了什么，需要怎么重启：

| 改的东西 | 生效方式 |
|---|---|
| `runtime/electron-helper/*.js`、`index.html`（渲染端） | 插件关掉再打开（重载页面） |
| `src/host/*.ts`（宿主路由/配置） | `pnpm build` 后**重启 DSH** |
| `~/.dsh/dsh-pet/tts/worker.mjs` | 下一次合成即生效（每次新起进程） |
| `assets/**` | 重启 DSH（主进程读图标/素材路径） |

---

## 三、日常使用：右键菜单地图

右键宠物 → 

- **玩法**：签到 / 猜拳 / 投喂 / 彩蛋 / 换装 / 主题 / 朗读 / 语音播报
- **点击音色**：合成「啵」、小黄鸭、Ciallo～、音效1、Minecraft 经验球、任务结束音
- **查看余额 / 充值**：手动查余额会语音播报（周期刷新保持安静）
- **回到初始位置 / 重载配置 / 关闭 DeepSeek Harness**

---

## 四、换装系统（最常改的一块）

### 目录

```
~/.dsh/dsh-pet/outfits/
├─ outfits.js          # scan.mjs 生成，别手改
├─ scan.mjs            # 扫描目录 → 重写 outfits.js
└─ 冬装兜帽/
   ├─ outfit.json      # {"label":"冬装兜帽"}（可选）
   ├─ stand.png        # 静态立绘模式（可选）
   └─ webm/*.webm      # 动画包：文件名必须与动画名完全一致
```

### 两种服装包

- **静态**：只有 `stand.png`（640×360 透明），切换后不播动画，靠 CSS 呼吸 + 点击弹动。
- **动画（A-lite）**：`webm/<动画名>.webm`，**包里没有的动画自动回退原版素材**。

### 加一套衣服

1. 建目录，放 `stand.png` 或 `webm/`；
2. 可选写 `outfit.json`（只影响菜单显示名）；
3. 运行：

```sh
cd ~/.dsh/dsh-pet/outfits
node scan.mjs
```

4. 右键「玩法 → 换装」里选它。

### 当前这套冬装

- 27 个动作：待机、转向、3 个移动、5 个点击回应、6 个工作状态、3 个碎碎念、6 个余额档位、拖拽、吃白饭
- 待机池 = 包里全部素材（26 条，排除「被鼠标拖拽悬空反馈」）
- 随机分类池整类覆盖才保留，否则整类去掉（避免一直循环同一个动作）

### 换装的三个已知机制

- 切换时如果当前动作包里没素材，会立刻切到待机首段（否则会静默回退原版）；
- 池子过滤后「分类池」为空，闲置时约 90% 待机、5% 转向、5% 移动；
- 服装清单由宿主 `/dsh-pet-7340/outfits` 提供绝对路径（页面经 junction 跑在 D 盘，相对路径跨盘会失效）。

---

## 五、语音系统（第二常改）

### 两类语音

| 类型 | 例子 | 来源 | 延迟 |
|---|---|---|---|
| 固定台词 | 问候、签到、投喂、换装、兜底句 | `assets/voice-features/<id>.mp3`（预生成） | 0 |
| 动态文本 | 余额播报、表情包朗读、碎碎念、对话 | edge-tts 实时合成（`~/.dsh/dsh-pet/tts-cache` 缓存） | 1~2 秒（首次） |

### 配置

`~/.dsh/dsh-pet/tts/voice-config.json`：

```json
{ "voice": "zh-CN-XiaoyiNeural", "rate": "+4%", "pitch": "+12Hz", "volume": "+0%" }
```

换音色：改这里 → `node gen.mjs --force` 重新生成固定台词（动态语音立即用新音色；缓存键含配置，会自动失效）。

### 加一句固定台词

1. `tts/lines.json` 加 `"id": "文本"`；
2. `cd ~/.dsh/dsh-pet/tts && node gen.mjs`（只补缺失的）；
3. 代码里用 `speakId('id')`。

### 失败与重试

- `worker.mjs` 对每句最多重试 2 次（429 退避 900ms，其它 400ms）；
- 渲染端 5 秒上限，到点播同音色兜底句「网络有点不顺…」；
- **绝不切换成系统音色**（音色突变比少念一句更出戏）。

仓库里带了 worker 的重试版，换机器时跑一次：

```sh
cd D:\dsh-plugins\dsh-pet-xzw\dsh-pet
node extras/tts/install-tts-worker.mjs
```

---

## 六、代码结构速查

```
D:\dsh-plugins\dsh-pet-xzw\
├─ NAMING.md                  命名对照表
├─ dsh-pet\                   包本体
│  ├─ package.json            name/bin/repository/dsh 元数据
│  ├─ cordis.patch.yml        插件挂载声明（id 与 name 必须等于包名）
│  ├─ runtime/electron-helper\ 桌面端运行时（手写 JS，改这里不用构建）
│  │  ├─ main.js              主进程：托盘、窗口、TTS、bridge
│  │  ├─ src\ 的镜像          preload/renderer/sprite/features/voice/sound/wardrobe
│  │  └─ index.html           CSP + 脚本加载顺序
│  ├─ src\host\index.ts       宿主路由（/config /state /outfits /anim …）
│  ├─ src\shared\             浏览器与桌面共用纯逻辑（构建成 shared-core.js）
│  ├─ assets\                 webm / voice-features / sfx / memes / fonts / config.jsonc
│  ├─ extras\tts\             worker 重试版 + 安装脚本
│  └─ scripts\prepare.js      发布清单（files 由它整份覆盖，加目录要加在这里）
```

---

## 七、改代码与发布

```sh
cd D:\dsh-plugins\dsh-pet-xzw\dsh-pet
pnpm install            # 搬过目录用 pnpm install --force
pnpm build              # tsdown → lib/，并重建 runtime/electron-helper/shared-core.js
pnpm typecheck
pnpm test               # 945 条
```

推送：

```sh
cd D:\dsh-plugins\dsh-pet-xzw
git add <具体文件>
git commit -m "fix(...): ..."
git push
```

（GitHub 走 SSH 443，已配好 `~/.ssh/config`。）

---

## 八、跟进上游

```sh
cd D:\dsh-plugins\dsh-pet-xzw
git fetch upstream --tags
git merge upstream/main
```

冲突基本只在 `sprite.js`（静态立绘 / 输入租约 / 第三方 url 那几段）。
合并后必须重跑 `pnpm install`（上游可能加依赖）、`pnpm build`、`pnpm test`。

---

## 九、故障排查表

| 症状 | 原因 | 处理 |
|---|---|---|
| 插件不加载、`/dsh-pet-7340/*` 全 404 | profile 的 `dsh.profile.bundles` 里没有它 | 加回 `dsh-pet-xzw` |
| 同上，且改了目录后出现 | pnpm 的 `node_modules/*` 是绝对路径 junction，搬目录后全部悬空（报 `Cannot find package '@deepseek-ai/dsh-home-paths'`） | `pnpm install --force` |
| 右键菜单没有「换装」 | 服装清单没加载（路径跨盘 / CSP） | 访问 `/dsh-pet-7340/outfits` 看是否 200；清单条数应为 10 |
| 点了换装没变化 | 当前动作包里没素材，或池子没过滤 | 看窗口标题诊断（`pack\|anim\|apply/ok`） |
| 余额念成「未知」 | 上游改成多币种，金额在 `wallets[].total` | 已修；新代码兼容三种形态 |
| 切换点击音色仍是合成波 | 音效文件路径跨盘失效 → 永久回退合成音 | 已修；每个音色带绝对路径候选 |
| 语音延迟大 / 被吞 | 固定台词 mp3 缺失、或合成重试退避太长 | 确认 `assets/voice-features` 有 33 条；worker 已降为 2 次重试 |
| 宠物被全屏播放器盖住 | Windows 置顶争夺 | 退出全屏即恢复，不是 bug |

---

## 十、数据与备份

```
~/.dsh/dsh-pet/
├─ outfits/      服装包（9 套 + 原版）
├─ tts/          voice-config / lines.json / worker.mjs / gen.mjs
├─ tts-cache/    动态语音缓存（可删，删了重合成）
└─ memory.json   记忆
```

备份：

- `D:\dsh-plugins\_backup\dsh-pet-custom-0.3.7`（切 fork 前的完整旧安装）
- `node_modules\dsh-pet.old`（旧的已安装包，63MB，确认稳定后可删）
- profile 的 `package.json.bak-before-fork` / `.bak-before-bundle`

---

## 十一、许可与素材

- 代码：MIT，保留上游 `LICENSE` 与版权声明；
- 服装立绘（冬装来自 Coopanion）、表情包、edge-tts 音色属于第三方素材，**自己用没问题，公开发布前需单独确认授权**；
- 上游仓库：`https://github.com/PC2005-cloud/dsh-pet`
