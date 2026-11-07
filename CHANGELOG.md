# Changelog

## 0.1.9

- UI 与文档统一使用「窥屏助手」（此前面板仍写屏幕感知，和包名/简介不一致）
- 视觉描述提示词独立为可编辑文件 `src/CAPTION_PROMPT.md` / `.en.md`，在扩展页的提示词文档中可直接修改；缺省回退到配置里的 prompt
- 环境提示词与视觉提示词分列，便于分别调整
## 0.1.8

- 事件增加结构化 `meta`：`focus` 带 app/title/previousMs，`screenshot` 带 app/title/photoId/caption
- README 增加事件契约（消费方通过 `host.store` 订阅；图片仍不出事件）
## 0.1.7

- 更新包简介（中文/英文）：从规格说明改成一句价值描述，保留「窥屏助手」语气与事实边界
- README 英文摘要同步
## 0.1.6

- 英文卡片名从自造的「Screen Peep」改回 `Screen Sense`，与技术标识一致；中文名「窥屏助手」不变
- 代码与配置中没有 `peep` 标识：World id、配置键、事件名一直沿用 `screen-sense`
## 0.1.5

- 对外品牌改为「窥屏助手」（英文 Screen Peep）；World id、配置键与事件名保持 `screen-sense`，升级不丢配置
- README 按品牌重写：两阶段视角、隐私边界、真实默认值与正确的数据流向（云端视觉端点会收到截图用于描述）
- 修正文案中的事实：Phase 1 仍会唤醒主模型、默认关闭、`caption.protocol` 默认 openai、无自动密码管理器过滤、事件不含图片哈希、采集引擎为 fork 子进程
## 0.1.4

- 标签按功能边界收紧：`memory`、`experimental`、`sensitive-data`；去掉 `external-setup`（Phase 1 装完即用，Ollama/云端是 Phase 2 可选路径）
- 简介与 README 写明 Phase 1（前台切换事件）与 Phase 2（截图 + 视觉描述）以及密钥/成本
## 0.1.3

- README 排版：英文摘要与发布前检查段前补空行（npm 页面显示修正）
## 0.1.2

- 市场元信息：`cortico.displayName`、英文 `locales`、图标 `assets/icon.svg`
- 声明 `cortico.tags`：`memory`、`external-setup`、`experimental`、`sensitive-data`
- `describe.json` 用官方 `describe:extension` 重新生成，与代码一致
- README：Owner 行、英文摘要、兼容性、市场标签说明、发布前检查（`check:extension` / `describe:extension`）

## 0.1.1

- 相册面板新增「检测本机 Ollama」「选择模型」「测试描述」：探测本地模型、一键写入配置（协议/地址/模型/开描述），并立即验证一句描述
- 面板顶部显示描述开关与最近一次失败原因
- 配置拆成「焦点感知」与「屏幕描述」两组；说明改短，密钥名标注 ollama 不需要
- 模型名只差分隔符时给出纠正建议（`gemma4e2b` → `gemma4:e2b`）；地址去尾斜杠
- 模型留空时自动使用本机 Ollama 探测到的模型
- `state` 改为返回 `pollMs` 与描述状态、最近错误；修正 2 秒采样显示为 0 的问题
## 0.1.0

- 第一个版本：焦点感知（停留时长、每小时上限、忽略应用、自身进程忽略）
- 截图相册（内容哈希去重、保留张数、清空）
- 异步视觉描述（OpenAI 兼容 / Ollama 原生，描述语言跟随 Coo）
- 相册面板（缩略图、时间、应用、标题、描述）
- 工具：`screen_photo_list`、`screen_photo_show`、`screen_sense_status`
- 自带采集引擎（Windows / macOS / Linux），子进程隔离
