# XZW 定制版命名清单

这份文档是 dsh-pet fork 的“名字对照表”：每个名字对应什么、写在哪里、改名会影响什么。
清单同时放在仓库根目录和桌面（`XZW-命名清单.md`）。

## 一、名字对照

| 名字 | 值 | 对应什么 / 写在哪 |
|---|---|---|
| GitHub 仓库 | `dsh-pet-xzw` | 仓库名；已在 GitHub 上改名，旧地址自动重定向 |
| npm 包名 / 插件 id | `dsh-pet-xzw` | `dsh-pet/package.json` 的 `name`；`dsh-pet/cordis.patch.yml` 的 `id` 与 `name`；profile `package.json` 的依赖键 |
| 命令行 | `dsh-pet-xzw-standalone` | `package.json` 的 `bin`，独立模式 CLI |
| 插件显示名 | `桌宠 · XZW` | 插件管理页与 README 的展示名（由包名派生，没有单独字段） |
| 数据目录 | `~/.dsh/dsh-pet` | **故意不改**：服装包、记忆、语音缓存都在这，改名会丢数据 |
| 桥协议 | `dsh-pet-bridge` | 主进程 ↔ 渲染端，改了要同时动 `main.js`、`constants.js`、`preload.js` |
| HTTP 路由前缀 | `/dsh-pet-7340` | 全部接口（config / state / outfits / anim …），保持不动 |
| 冬装服装包 id | `冬装兜帽` | `~/.dsh/dsh-pet/outfits/冬装兜帽/`，出现在 `outfits.js` 与 webm 地址里 |
| 本地源码 | `D:\dsh-plugins\dsh-pet-xzw\dsh-pet` | 仓库根（外层目录建议同步改名，非必须） |
| 安装位置 | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-pet-xzw` | 指向 D 盘的 junction |
| 上游基线 | `PC2005-cloud/dsh-pet` @ `v0.3.7` | fork 起点，已合并上游 `main`（57 条提交） |

## 二、为什么有两组名字不动

- **数据目录 `~/.dsh/dsh-pet`**：8 套服装、记忆、语音缓存、设置全在这里。改名等于换宠物，需要整套迁移脚本，收益为零。
- **桥协议 `dsh-pet-bridge` 与路由前缀 `/dsh-pet-7340`**：分布在主进程、预加载、渲染端三处，是内部契约；对外不可见，改了只会增加出错面。

## 三、改名后要同步的地方

1. `dsh-pet/package.json`：`name`、`bin`、`repository`、`homepage`、`bugs`
2. `dsh-pet/cordis.patch.yml`：`insert` 里的 `id` 与 `name`（两者都必须等于包名，商城预检按它比对）
3. profile 的 `package.json`：`dependencies` 键、`dsh.profile.bundles` 项
4. `node_modules` 下的目录名（junction 重建）
5. `pnpm build` 重跑一次（`prepare.js` 会重写 `files` 清单）
6. 重启 DSH

> **搬目录之后必须补一刀**：pnpm 的 `node_modules/*` 链接是**绝对路径**（指向 `.pnpm/...` 的 junction），
> 把仓库目录改名或搬盘会让它们全部悬空，插件加载时报
> `Cannot find package '@deepseek-ai/dsh-home-paths'`。搬完执行一次
> `pnpm install --force` 重建链接即可（实测 25 秒）。

## 四、仓库里额外带的东西

| 路径 | 内容 |
|---|---|
| `dsh-pet/extras/tts/worker.mjs` | 带 3 次退避重试的 edge-tts worker（429 限流不再直接失败） |
| `dsh-pet/extras/tts/install-tts-worker.mjs` | 把它装到 `~/.dsh/dsh-pet/tts/worker.mjs`（换机器时跑一次） |

装法：

```sh
node extras/tts/install-tts-worker.mjs
```

## 五、许可

代码遵循原项目的 MIT 许可，保留上游 `LICENSE` 与版权声明；本仓库是在 `PC2005-cloud/dsh-pet` 基础上的定制版。
服装立绘、表情包、音色属于第三方素材，公开发布前需单独确认授权。
