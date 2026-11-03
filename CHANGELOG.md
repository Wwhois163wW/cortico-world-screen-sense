# Changelog

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
