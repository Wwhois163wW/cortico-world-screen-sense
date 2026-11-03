Owner: `src/index.ts`

# cortico-world-screen-sense
[![CI](https://github.com/Wwhois163wW/cortico-world-screen-sense/actions/workflows/ci.yml/badge.svg)](https://github.com/Wwhois163wW/cortico-world-screen-sense/actions/workflows/ci.yml)

Cortico World：**屏幕感知**。把前台应用切换变成事件，把截图留在相册，用辅助视觉模型写一句话描述，模型需要时再取回原图。

默认关闭。启用后会读前台窗口的应用名与标题、按节奏截图；原图只存在本机相册，描述才会进入模型上下文。
## English summary

A Cortico World for Coopanion: it turns foreground-app switches into `screen-sense.focus` events, keeps screenshots in a local album, and lets an auxiliary vision model write one sentence per look. The image itself never enters the bot's context unless the bot calls `screen_photo_show`. Off by default; descriptions need a local Ollama or an OpenAI-compatible vision endpoint.

## 两个阶段

- **Phase 1（默认）**：前台应用切换 → `screen-sense.focus` 事件。装完即用，零额外配置，唤醒次数有上限（默认 3 次/小时）。
- **Phase 2（可选）**：接受切换后截图进相册，再由视觉模型写一句话描述 → `screen-sense.screenshot` 事件。图不进主模型上下文，需要 Ollama 或一个 OpenAI 兼容的视觉端点。

## 密钥与成本

- 只开 Phase 1：不需要密钥，也没有模型成本，只有焦点事件带来的少量主模型调用。
- Phase 2 用本机 Ollama：不需要密钥，图不出本机；代价是本地算力。
- Phase 2 用云端视觉端点：需要在部署密钥文件里配一个 key（`caption.secretName`），每张描述图按该服务的价格计费。默认 `minIntervalMs=60000`、`maxPerHour=6`，可自行调低或关闭。

## 隐私

- 进程只读**前台窗口**（应用名、标题）并截图，不读剪贴板、不读文件、不读输入内容。
- 启用 `caption` 时，截图会发送到**你自己配置的视觉端点**：本地 Ollama 不出本机；填云端地址时请确认对方的隐私条款。
- 相册在部署数据目录的 `screen/` 下，按内容哈希去重；可在设置页查看与清空。
- 每个小时最多唤醒 Coo `maxWakesPerHour` 次（默认 3），描述还有独立的频率上限。

## 安装

发布到 npm 后，在 Coopanion 的扩展安装入口填入包名：

```
cortico-world-screen-sense
```

本地开发可先打包再安装：

```bash
pnpm install
pnpm run build         # 生成 dist/webui.js（面板需要）
pnpm pack              # 得到 cortico-world-screen-sense-0.1.0.tgz
```

然后在 Coopanion 里从本地 tgz 安装。装好后在「高级模式 → World 总览」里会多出**屏幕感知**页，包含「屏幕相册」面板与配置。

### 视觉描述不用手填

相册面板顶部有三件事：

- **检测本机 Ollama**：探测 `http://localhost:11434` 上的模型；
- 在下拉里选一个模型，点 **使用这个模型**：自动写入协议、地址、模型并打开描述；
- **测试描述**：立刻跑一句，返回耗时与文本；失败会显示原因，模型名只差分隔符时给出纠正建议（例如 `gemma4e2b` → `gemma4:e2b`）。

## 配置（`worlds.screen-sense.*`）

配置分两组：**焦点感知**（采样、停留、每小时上限、忽略应用）与**屏幕描述**（协议、地址、模型、密钥名、节奏、保留张数）。日常只需要在面板里点「检测本机 Ollama」；下面的表格是完整字段。

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | false | 打开感知；启用/停用即时生效 |
| `pollMs` | 2000 | 前台窗口采样间隔 |
| `dwellMs` | 8000 | 新应用要停留这么久才算一次切换 |
| `maxWakesPerHour` | 3 | 每小时最多唤醒几次；0 不限 |
| `followTitle` | false | 同一应用内标题变化也算切换 |
| `ignoreApps` | 空 | 忽略的应用，逗号分隔，大小写不敏感；自身进程自动忽略 |
| `caption.enabled` | false | 打开异步描述 |
| `caption.protocol` | `openai` | `openai` 走 `/chat/completions`；`ollama` 走原生 `/api/chat`（关思考，正文不会为空） |
| `caption.baseUrl` | 空 | openai 填到 `/chat/completions` 之前（通常带 `/v1`）；ollama 填服务根地址 |
| `caption.model` | 空 | 视觉模型名 |
| `caption.secretName` | `DESKTOP_PET_CAPTION_API_KEY` | 部署密钥文件里的变量名；ollama 不需要 |
| `caption.minIntervalMs` | 60000 | 两次描述的最短间隔 |
| `caption.maxPerHour` | 6 | 每小时最多描述几次 |
| `caption.keepFiles` | 200 | 相册保留张数 |

本地 Ollama 配法示例：

```json
{
  "caption": {
    "enabled": true,
    "protocol": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "gemma4:e2b",
    "minIntervalMs": 60000,
    "maxPerHour": 3
  }
}
```

实测 `gemma4:e2b`（`think:false`）约 6 秒一句；它有英文偏置，中文提示词也可能回英文。

## 事件与工具

事件：

- `screen-sense.focus`：前台应用切换（文本含应用名、窗口标题、上一个应用在前台的秒数）
- `screen-sense.screenshot`：辅助视觉对刚才那一帧的一句话描述；原图留在相册

工具：

- `screen_photo_list`：按时间列出相册里的截图与描述
- `screen_photo_show`：取回一张原图再看一眼（会重新进入上下文）
- `screen_sense_status`：报告是否运行中，以及相册计数

## 系统要求

- Node ≥ 22
- Windows、macOS、Linux；Linux 需要 X11（`DISPLAY`）
- 采集引擎是子进程，崩溃不会带崩 Coo

## 市场标签

包在 `cortico.tags` 里声明了三个标签：`memory`（相册是“看过的屏幕”的视觉记忆）、`experimental`（只在 Coopanion 0.2.17 上验证过）、`sensitive-data`（持续读取前台窗口与屏幕，描述启用时图会发到你配置的视觉端点）。

没有声明 `external-setup`、`requires-key`、`high-cost`：Phase 1 装完即用，Ollama 与云端密钥都是 Phase 2 的可选路径，成本和限速写在上面的「密钥与成本」里。也没有 `computer-use`、`unsafe`：本 World 不发鼠标键盘输入，不执行代码。

## 兼容性与验证

- Cortico World 契约 `api: 6`；真机验证环境为 Coopanion 0.2.17（Windows 11）。
- `src/capture/` 有 Windows、macOS、Linux 三份引擎实现；Windows 实测过，macOS/Linux 未实测，Linux 需要 X11（`DISPLAY`）。
- 主模型上下文里只有一句话描述，截图只进相册；视觉端点失败会显示在相册面板顶部。

## 发布前检查

官方工具（在 Cortico 仓库根目录跑）：

```bash
pnpm check:extension <本包目录>
```

它会检查 manifest、入口、默认配置下的构造、`describe.json` 与代码是否一致、`cortico.tags` 是否在词表内、`CHANGELOG.md` 是否有当前版本标题。改了工具/事件/配置组/提示词后，先重新生成自描述：

```bash
pnpm describe:extension <本包目录>
```

`CHANGELOG.md` 每个版本一个 `## x.y.z` 段，市场按它显示更新说明。
## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run smoke      # 真机读一次前台窗口并截图，打印尺寸
```

`cortico/*` 由开发依赖 `cortico`（框架源码包）提供，发布后由宿主运行时解析。CI 在 Node 22 上跑 `typecheck`、`test` 与 `build`，并检查面板 bundle 是否生成。

## 发布

```bash
pnpm run build
npm publish --access public
```

`prepublishOnly` 会先跑类型检查、测试与面板构建。

## 许可

AGPL-3.0-or-later。采集引擎与 `cortico-world-desktop-pet` 的 CUA 引擎同源。
