/** Config section `worlds.screen-sense`: foreground app sensing, the screen album and its descriptions. */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';

/** Where the vision model listens: an OpenAI-compatible `/chat/completions`, or Ollama's native `/api/chat`. */
export const CAPTION_PROTOCOLS = ['openai', 'ollama'] as const;
export type CaptionProtocol = (typeof CAPTION_PROTOCOLS)[number];

export interface CaptionConfig {
  /** Describe the screen after accepted focus switches; needs baseUrl, model and (for openai) the API key. */
  enabled: boolean;
  /** `openai`: OpenAI-compatible; `ollama`: Ollama's native API, which takes images and can disable thinking. */
  protocol: CaptionProtocol;
  /** OpenAI-compatible up to `/chat/completions` (typically ending in `/v1`), or Ollama's root (`http://localhost:11434`). */
  baseUrl: string;
  model: string;
  /** Deployment secret that holds the API key; read through the same secret file as the rest of the app. */
  secretName: string;
  /** Shortest gap between two descriptions. */
  minIntervalMs: number;
  /** Most descriptions an hour; 0 = no limit. */
  maxPerHour: number;
  maxWidth: number;
  maxHeight: number;
  timeoutMs: number;
  maxTokens: number;
  prompt: string;
  /** Album size; older screenshots are deleted past it. */
  keepFiles: number;
}

export const CAPTION_DEFAULTS: CaptionConfig = {
  enabled: false,
  protocol: 'openai',
  baseUrl: '',
  model: '',
  secretName: 'DESKTOP_PET_CAPTION_API_KEY',
  minIntervalMs: 60_000,
  maxPerHour: 6,
  maxWidth: 768,
  maxHeight: 480,
  timeoutMs: 15_000,
  maxTokens: 120,
  prompt: 'Describe this screen in one short sentence: which app is in front and what the person is doing. Do not guess; say when it is unclear.',
  keepFiles: 200,
};

export interface SenseConfig {
  /** Report app switches as `screen-sense.focus` events; off leaves the engine alone. */
  enabled: boolean;
  /** How often the foreground window is sampled, milliseconds. */
  pollMs: number;
  /** The new app must stay in front this long before the switch counts, milliseconds. */
  dwellMs: number;
  /** Wake the bot at most this many times an hour; 0 = no limit. */
  maxWakesPerHour: number;
  /** Count a title change inside the same app as a switch. */
  followTitle: boolean;
  /** App names to ignore, comma separated, case insensitive. */
  ignoreApps: string;
  /** Optional screen descriptions from an auxiliary vision model. */
  caption: CaptionConfig;
}

export type SenseConfigSection = SenseConfig;

/** Defaults for a deployment that enables this World. */
export const SENSE_DEFAULTS: SenseConfig = {
  enabled: false,
  pollMs: 2000,
  dwellMs: 8000,
  maxWakesPerHour: 3,
  followTitle: false,
  ignoreApps: '',
  caption: CAPTION_DEFAULTS,
};

/** Text for the console config groups. `zh` and `en` are complete; other languages read English until translated. */
function senseText(language: Language) {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    group: '焦点感知',
    groupDesc: '采样前台应用，切换够久才算一次。',
    enabledTitle: '感知前台应用',
    enabledDesc: '把前台应用的切换作为事件；只读应用名与标题，不截图。',
    pollTitle: '采样间隔',
    pollDesc: '每隔这么久读一次前台窗口。',
    dwellTitle: '停留时长',
    dwellDesc: '新应用待够这么久才算切换，避免 Alt-Tab 连按。',
    maxTitle: '每小时上限',
    maxDesc: '一小时最多唤醒几次；0 表示不限。',
    followTitleTitle: '标题变化也算',
    followTitleDesc: '同一应用内标题变化也当作切换。',
    ignoreTitle: '忽略的应用',
    ignoreDesc: '逗号分隔，大小写不敏感。',
    captionGroup: '屏幕描述',
    captionGroupDesc: '描述失败的原因显示在相册面板顶部。',
    captionEnabledTitle: '用辅助视觉描述屏幕',
    captionEnabledDesc: '切换应用后把画面交给视觉模型写一句话；原图留在相册。',
    captionBaseUrlTitle: '视觉服务地址',
    captionBaseUrlDesc: 'ollama 填服务根地址（如 http://localhost:11434）；openai 填到 /chat/completions 之前。',
    captionProtocolTitle: '协议',
    captionProtocolDesc: '本地 Ollama 选 ollama；其它服务选 openai。',
    captionModelTitle: '视觉模型',
    captionModelDesc: '可点相册面板的「检测本机 Ollama」自动选择；例如 gemma4:e2b。',
    captionKeyTitle: '密钥名',
    captionKeyDesc: 'openai 协议用；ollama 不需要，可留空。',
    captionIntervalTitle: '最短间隔',
    captionIntervalDesc: '两次描述之间至少隔这么久。',
    captionMaxTitle: '每小时上限',
    captionMaxDesc: '一小时最多描述几次；0 表示不限。',
    captionKeepTitle: '相册保留张数',
    captionKeepDesc: '超过后删掉最旧的截图。',
    storage: {
      label: '屏幕相册',
      note: '删掉保存的截图与描述；此前的描述条目不再能取回原图。',
      stat: (n: number) => `${n} 张截图`,
      cleared: (n: number) => `已删除 ${n} 张截图`,
    },
  } : {
    group: 'Focus sensing',
    groupDesc: 'Samples the foreground app; a switch must last to count.',
    enabledTitle: 'Sense the foreground app',
    enabledDesc: 'Turns foreground app switches into events; reads the app name and window title only, no screenshots.',
    pollTitle: 'Sampling interval',
    pollDesc: 'How often the foreground window is read.',
    dwellTitle: 'Dwell time',
    dwellDesc: 'The new app must stay in front this long to count, so holding Alt-Tab does not fire.',
    maxTitle: 'Hourly limit',
    maxDesc: 'Wake the bot at most this many times an hour; 0 = no limit.',
    followTitleTitle: 'Count title changes',
    followTitleDesc: 'A title change inside the same app also counts.',
    ignoreTitle: 'Ignored apps',
    ignoreDesc: 'Comma separated, case insensitive.',
    captionGroup: 'Screen descriptions',
    captionGroupDesc: 'A failed description is reported at the top of the album panel.',
    captionEnabledTitle: 'Describe the screen with auxiliary vision',
    captionEnabledDesc: 'After a switch, a vision model writes one sentence; the image stays in the album.',
    captionBaseUrlTitle: 'Vision service URL',
    captionBaseUrlDesc: 'For ollama the service root (e.g. http://localhost:11434); for openai up to /chat/completions.',
    captionProtocolTitle: 'Protocol',
    captionProtocolDesc: 'ollama for a local Ollama, openai for everything else.',
    captionModelTitle: 'Vision model',
    captionModelDesc: 'Pick it with "Detect local Ollama" in the album panel; e.g. gemma4:e2b.',
    captionKeyTitle: 'Secret name',
    captionKeyDesc: 'Used by the openai protocol; not needed for ollama.',
    captionIntervalTitle: 'Shortest gap',
    captionIntervalDesc: 'At least this long between two descriptions.',
    captionMaxTitle: 'Hourly limit',
    captionMaxDesc: 'Most descriptions an hour; 0 = no limit.',
    captionKeepTitle: 'Screenshots kept',
    captionKeepDesc: 'Older screenshots are deleted past this count.',
    storage: {
      label: 'Screen album',
      note: 'Deletes the saved screenshots and descriptions; earlier descriptions can no longer bring their image back.',
      stat: (n: number) => `${n} screenshot${n === 1 ? '' : 's'}`,
      cleared: (n: number) => `Deleted ${n} screenshot${n === 1 ? '' : 's'}`,
    },
  };
}

/** The screen album's storage part text, in the app language. */
export function captionStorageText(language: Language) {
  return senseText(language).storage;
}

/** The photos panel's own text, in the browser's language. */
export interface PhotoPanelText {
  title: string;
  description: string;
  refresh: string;
  clear: string;
  clearConfirm: string;
  cleared: (n: number) => string;
  empty: string;
  loading: string;
  failed: string;
  total: (n: number) => string;
  running: string;
  off: string;
  captionOn: string;
  captionOff: string;
  detect: string;
  detecting: string;
  models: string;
  useModel: string;
  applied: (model: string) => string;
  test: string;
  testing: string;
  testOk: (ms: number, text: string) => string;
  testFailed: (message: string) => string;
  detectFailed: (message: string) => string;
  noModels: string;
  suggestion: (model: string) => string;
  noCaption: string;
}

/** The photos panel's text; `zh` and `zh-Hant` are Chinese, other languages read English until translated. */
export function photoPanelText(language: Language): PhotoPanelText {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    title: '屏幕相册',
    description: 'Coo 看过的屏幕截图：时间、前台应用、窗口标题与一句话描述。原图只在这里，模型要用才取回。',
    refresh: '刷新',
    clear: '清空相册',
    clearConfirm: '删除相册里的全部截图与描述？此操作不可撤销。',
    cleared: (n) => `已删除 ${n} 张截图`,
    empty: '相册里还没有截图。开启焦点感知与屏幕描述后，切一次应用就会出现第一张。',
    loading: '读取中…',
    failed: '读取失败',
    total: (n) => `${n} 张截图`,
    running: '运行中',
    off: '已关闭',
    captionOn: '描述开着',
    captionOff: '描述关着',
    detect: '检测本机 Ollama',
    detecting: '检测中…',
    models: '选择模型',
    useModel: '使用这个模型',
    applied: (model) => `已使用 ${model}，正在重建描述`,
    test: '测试描述',
    testing: '测试中…',
    testOk: (ms, text) => `${ms} ms · ${text}`,
    testFailed: (message) => `测试失败：${message}`,
    detectFailed: (message) => `检测失败：${message}`,
    noModels: '本机 Ollama 没有可用模型',
    suggestion: (model) => `你是不是要 ${model}？`,
    noCaption: '（还没有描述）',
  } : {
    title: 'Screen album',
    description: 'Screenshots Coo has looked at: time, foreground app, window title and a one-line description. The image itself stays here until the model asks for it.',
    refresh: 'Refresh',
    clear: 'Clear album',
    clearConfirm: 'Delete every screenshot and description in the album? This cannot be undone.',
    cleared: (n) => `Deleted ${n} screenshot${n === 1 ? '' : 's'}`,
    empty: 'No screenshots yet. With focus sensing and screen descriptions on, switching apps adds the first one.',
    loading: 'Loading…',
    failed: 'Could not load',
    total: (n) => `${n} screenshot${n === 1 ? '' : 's'}`,
    running: 'running',
    off: 'off',
    captionOn: 'descriptions on',
    captionOff: 'descriptions off',
    detect: 'Detect local Ollama',
    detecting: 'Detecting…',
    models: 'Model',
    useModel: 'Use this model',
    applied: (model) => `Using ${model}; rebuilding descriptions`,
    test: 'Test description',
    testing: 'Testing…',
    testOk: (ms, text) => `${ms} ms · ${text}`,
    testFailed: (message) => `Test failed: ${message}`,
    detectFailed: (message) => `Detection failed: ${message}`,
    noModels: 'The local Ollama has no models',
    suggestion: (model) => `Did you mean ${model}?`,
    noCaption: '(no description yet)',
  };
}

/** The focus sensing group: sampling and the wake-up budget. */
export function senseConfigGroup(language: Language = 'zh'): ConfigGroup {
  const t = senseText(language);
  const K = 'worlds.screen-sense';
  return {
    id: 'world:screen-sense',
    owner: 'world:screen-sense',
    schema: {
      type: 'object',
      title: t.group,
      description: t.groupDesc,
      properties: {
        [`${K}.enabled`]: { type: 'boolean', title: t.enabledTitle, description: t.enabledDesc, 'x-hot': true },
        [`${K}.pollMs`]: { type: 'integer', title: t.pollTitle, description: t.pollDesc, minimum: 250, maximum: 60000, 'x-suffix': 'ms', 'x-hot': true },
        [`${K}.dwellMs`]: { type: 'integer', title: t.dwellTitle, description: t.dwellDesc, minimum: 0, maximum: 600000, 'x-suffix': 'ms', 'x-hot': true },
        [`${K}.maxWakesPerHour`]: { type: 'integer', title: t.maxTitle, description: t.maxDesc, minimum: 0, maximum: 60, 'x-hot': true },
        [`${K}.followTitle`]: { type: 'boolean', title: t.followTitleTitle, description: t.followTitleDesc, 'x-hot': true },
        [`${K}.ignoreApps`]: { type: 'string', title: t.ignoreTitle, description: t.ignoreDesc, 'x-hot': true },
      },
    },
  };
}

/** The description group: the vision endpoint and how often it may look. */
export function captionConfigGroup(language: Language = 'zh'): ConfigGroup {
  const t = senseText(language);
  const K = 'worlds.screen-sense';
  return {
    id: 'world:screen-sense:caption',
    owner: 'world:screen-sense',
    schema: {
      type: 'object',
      title: t.captionGroup,
      description: t.captionGroupDesc,
      properties: {
        [`${K}.caption.enabled`]: { type: 'boolean', title: t.captionEnabledTitle, description: t.captionEnabledDesc, 'x-hot': true },
        [`${K}.caption.protocol`]: { type: 'string', title: t.captionProtocolTitle, description: t.captionProtocolDesc, enum: [...CAPTION_PROTOCOLS], 'x-hot': true },
        [`${K}.caption.baseUrl`]: { type: 'string', title: t.captionBaseUrlTitle, description: t.captionBaseUrlDesc, 'x-hot': true },
        [`${K}.caption.model`]: { type: 'string', title: t.captionModelTitle, description: t.captionModelDesc, 'x-hot': true },
        [`${K}.caption.secretName`]: { type: 'string', title: t.captionKeyTitle, description: t.captionKeyDesc },
        [`${K}.caption.minIntervalMs`]: { type: 'integer', title: t.captionIntervalTitle, description: t.captionIntervalDesc, minimum: 5000, maximum: 3_600_000, 'x-suffix': 'ms', 'x-hot': true },
        [`${K}.caption.maxPerHour`]: { type: 'integer', title: t.captionMaxTitle, description: t.captionMaxDesc, minimum: 0, maximum: 60, 'x-hot': true },
        [`${K}.caption.keepFiles`]: { type: 'integer', title: t.captionKeepTitle, description: t.captionKeepDesc, minimum: 0, maximum: 5000, 'x-hot': true },
      },
    },
  };
}
