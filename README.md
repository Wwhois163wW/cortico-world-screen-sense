Owner: `src/index.ts`

# cortico-world-screen-sense（窥屏助手）
[![CI](https://github.com/Wwhois163wW/cortico-world-screen-sense/actions/workflows/ci.yml/badge.svg)](https://github.com/Wwhois163wW/cortico-world-screen-sense/actions/workflows/ci.yml)

> **“~一眼盯帧~。用超轻量事件流让桌宠感知前台动静，默默用余光猜你在干嘛。”**

**窥屏助手（screen-sense）** 是为 Coopanion 量身打造的屏幕轻量感知与活动速写扩展（Cortico World）。

窥屏助手让桌宠在避免把截图灌进主模型的前提下感知你的屏幕变化：**前台应用切换时探头看一下，把画面记进本机私密相册，让辅助小模型写一句速写（Caption）放进事件流**。桌宠知道你是在写代码、刷视频还是在发呆摸鱼，但**原图不进入主模型上下文，不抢焦点、节约 Token，合法窥屏，点到为止**。

> 对外名称是「窥屏助手」；npm 包名、World id、配置键与事件名沿用 `screen-sense`，这样从 0.1.x 升级不会丢配置。

---

## 🐾 两阶段窥屏法则

| 阶段 | 它在做什么 | 算力与钱包消耗 | 隐私与数据流向 |
| :--- | :--- | :--- | :--- |
| **Phase 1：探头感知**<br>*(默认关闭，启用后装完即用)* | 盯着前台窗口看。当你在某个应用停留超过 8 秒（`dwellMs`）才记一次切换，防抖滤除连环 Alt-Tab。向事件流发送 `screen-sense.focus`。 | **无视觉模型费用**。纯系统级窗口标题与进程采样；焦点事件仍会唤醒主模型，次数受 `maxWakesPerHour`（默认 3 次/小时）限制。 | 只读前台窗口的应用名与标题，不扫剪贴板，不读按键输入，不落盘。 |
| **Phase 2：一眼盯帧**<br>*(可选，视觉速写)* | 发生有效切换时咔嚓拍一张放进本机相册，让辅助视觉模型用一句话总结你在干啥。 | **本地 Ollama：0 API 费用**，只花本机算力；云端端点：按该服务的图片/Token 价格计费。主模型日常只收到一句话文本。 | 截图只存本机相册；**本地 Ollama 时像素不出本机**；用云端视觉端点时，截图会发给该端点用于描述。原图不会因为描述而进入主模型上下文。 |

---

## 两份提示词

- **环境提示词**：`src/ENV_PROMPT.md` / `.en.md`，注入给模型，说明焦点事件、截图与相册工具。
- **视觉描述提示词**：`src/CAPTION_PROMPT.md` / `.en.md`，发给视觉模型。支持变量 `{window_title}`（当前前台标题）与 `{app}`（进程名），每次描述时实时渲染；模板每次描述前重新读取，UI 改完立即生效。
- 用户编辑的模板视为完整指令，不再自动追加语言后缀；只有内置回退提示词（配置里的 `caption.prompt`）会补“只用一句话”的要求。
- 两份都可以在扩展页的提示词文档里直接编辑；视觉提示词为空或读取失败时回退到配置里的 `caption.prompt`。

## 🔒 合法窥屏：隐私与边界守则

- **只看前台，绝不越界**：只抓取当前激活的前台窗口元数据与屏幕图像，不窥探后台窗口、剪贴板、个人文件或击键历史。
- **本地优先（Local-First）**：Phase 2 搭配本机 Ollama（推荐 `gemma4:e2b` 或 `qwen2.5-vl:3b`）运行时，**像素不出本机**。用云端视觉端点时，截图只发给它，不发主模型端点。
- **避嫌名单**：`ignoreApps` 可手动忽略密码管理器、无痕窗口或特定终端；扩展自身进程自动忽略。不会自动识别这些应用。
- **主上下文里没有图**：描述只以一句话事件进入上下文；只有桌宠主动调用 `screen_photo_show` 调阅原图时，那张图才会进入主模型上下文并产生图片 Token。
- **不提供操作能力**：本 World 不暴露任何鼠标、键盘或窗口操作工具，模型无法通过它操作电脑；采集引擎运行在独立子进程中，驱动异常不会带崩 Coopanion 本体。

---

## ⚙️ 快速上手

### 1. 安装

发布至 npm 后，在 Coopanion 扩展管理中输入包名：

```text
cortico-world-screen-sense
```

本地手动打包安装：

```bash
pnpm install
pnpm run build     # 生成面板所需的 dist/webui.js
pnpm pack          # 得到 cortico-world-screen-sense-<version>.tgz
```

在 Coopanion 扩展面板安装该 `.tgz`，重启后在「高级模式 → World 总览」里找到**窥屏助手**，打开 `enabled`。

### 2. 相册面板与一键测试

在「屏幕相册」面板中，不需要手填 API：

1. 点击 **检测本机 Ollama**，扫描 `http://localhost:11434` 上的模型；
2. 在下拉框选择视觉模型（如 `gemma4:e2b`），点击 **使用这个模型** 完成绑定；
3. 点击 **测试描述**，立刻抓一帧并展示视觉模型生成的速写与耗时。

---

## 📋 完整配置表（`worlds.screen-sense.*`）

### 1. 前台感知（Phase 1）

| 配置键 | 默认值 | 作用说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关：是否允许感知前台窗口（即时生效） |
| `pollMs` | `2000` | 前台窗口采样周期（毫秒） |
| `dwellMs` | `8000` | 驻留判定（毫秒）：新窗口持续停留超过该时长才算一次切换 |
| `maxWakesPerHour` | `3` | 每小时最多唤醒桌宠几次（0 = 不限） |
| `followTitle` | `false` | 同一应用内标题变化是否也算切换（如浏览器换 Tab） |
| `ignoreApps` | `""` | 忽略的应用，逗号分隔；自身进程自动忽略 |

### 2. 视觉速写（Phase 2）

| 配置键 | 默认值 | 作用说明 |
| --- | --- | --- |
| `caption.enabled` | `false` | 是否开启异步视觉速写 |
| `caption.protocol` | `"openai"` | `openai` 走 OpenAI 兼容 `/chat/completions`；`ollama` 走原生 `/api/chat`（会关思考） |
| `caption.baseUrl` | `""` | 服务地址；ollama 填根地址（如 `http://localhost:11434`），openai 填到 `/chat/completions` 之前 |
| `caption.model` | `""` | 视觉模型名，必须与端点里的名称完全一致（如 `gemma4:e2b`） |
| `caption.secretName` | `"DESKTOP_PET_CAPTION_API_KEY"` | 部署密钥文件里的变量名；仅云端视觉端点需要，ollama 不需要 |
| `caption.minIntervalMs` | `60000` | 两次速写的最短间隔（毫秒） |
| `caption.maxPerHour` | `6` | 每小时最多速写几次（0 = 不限） |
| `caption.keepFiles` | `200` | 本机相册最大保留张数，超过后淘汰最旧的 |

---

## 🧩 事件与工具

### 事件

- **`screen-sense.focus`**：你切换了前台应用。附带应用名、窗口标题、上一个应用停留了多少秒。
- **`screen-sense.screenshot`**：辅助视觉对刚抓的一帧给出的一句话速写。原图留在相册，事件里只有文字。

### 事件契约（给消费方扩展）

事件是公开契约，其它 World 可以用 `host.store.range({ fromCursor, source: 'screen-sense' })` 增量订阅，不需要依赖本扩展的代码：

- `screen-sense.focus`：`meta = { kind: 'focus', app, title, previousMs }`
- `screen-sense.screenshot`：`meta = { kind: 'screenshot', app, title, photoId, caption }`

约定：

- 消费方按 `type` 与 `meta.kind` 过滤；新增事件类型或新增 meta 字段属于 minor，改名/删除属于 major。
- 事件里永远没有原图；需要图片的能力留在本 World，或由模型调用 `screen_photo_show`。
- 首次启动可回填最近一段时间；之后从持久化游标增量读取，避免重放整库。
- 本 World 不知道消费方存在，停用/卸载生产方时消费方应自行降级。


### 工具

- **`screen_photo_list`**：按时间列出相册里的截图与速写，可按应用过滤。
- **`screen_photo_show`**：取回一张原图看一眼；这一步会把图片放进主模型上下文。
- **`screen_sense_status`**：报告感知是否运行、描述是否开启，以及相册计数与最近一次失败原因。

---

## 🛠️ 系统要求与开发

- **运行环境**：Node.js ≥ 22
- **操作系统**：Windows 实测 11；macOS / Linux 有对应引擎实现但未实测，Linux 需要 X11（`DISPLAY`）
- **契约**：Cortico World `api: 6`，已在 Coopanion 0.2.17 上真机验证
- **开源协议**：AGPL-3.0-or-later

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run smoke      # 真机读一次前台窗口并截图，打印尺寸
```

改了工具、事件、配置组或提示词后，在 Cortico 仓库根目录重新生成自描述并检查：

```bash
pnpm describe:extension <本包目录>
pnpm check:extension <本包目录>
```

市场标签：`memory`、`experimental`、`sensitive-data`。Phase 1 装完即用，Ollama 与云端密钥都是 Phase 2 的可选路径，因此不声明 `external-setup` / `requires-key`；成本与限速见上表。
