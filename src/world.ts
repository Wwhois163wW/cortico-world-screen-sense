/**
 * Screen sense: the foreground app switches into `screen-sense.focus` events, screenshots go into the
 * album, an auxiliary vision model writes one sentence per accepted switch, and the model can look an
 * old screenshot up again. Capture and input live in `src/capture/`; this World only decides what is
 * worth a wake-up and what reaches the context.
 *
 * The album panel can probe a local Ollama, write the chosen endpoint and model through `persist`,
 * and run one test description, so the vision part needs no hand-typed config.
 */
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import type { Language } from 'cortico/core/language.ts';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { childExecArgv } from 'cortico/extensions/runtime.ts';
import { nowIso, shortTime } from 'cortico/core/util.ts';
import { CaptureClient, type ScreenInfo } from './capture/index.ts';
import { ScreenAlbum, albumStat, clearAlbum } from './album.ts';
import { CaptionClient, CaptionPace, promptInLanguage } from './caption.ts';
import { SENSE_DEFAULTS, captionConfigGroup, captionStorageText, photoPanelText, senseConfigGroup, type SenseConfigSection } from './config.ts';
import { FocusGate, ignoreList, type FocusWake } from './focus.ts';
import { MODEL_TEXT, type ModelLanguage, type ModelText } from './model-text.ts';
import { OLLAMA_BASE, captionPatch, normalizeBaseUrl, normalizeModel, suggestModel } from './presets.ts';

const ENV_PROMPT_FILES: Record<ModelLanguage, string> = {
  zh: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
  en: fileURLToPath(new URL('./ENV_PROMPT.en.md', import.meta.url)),
};

export const SCREEN_SENSE_ID = 'screen-sense';

export interface ScreenSenseOptions {
  /** The live `worlds.screen-sense` section. */
  cfg: SenseConfigSection;
  timezone: string;
  /** Where the album and its registry live (`<data>/screen`). */
  dataDir: string;
  /** The language the bot reads, read at each use; Chinese when absent. */
  modelLanguage?: () => ModelLanguage;
  /** The app language for panels, storage text and the prompt template path; Chinese when absent. */
  language?: () => Language;
  /** The API key for the caption service, read through the deployment secret named in the config. */
  captionApiKey?: () => string;
  /** Writes a patch into `worlds.screen-sense`; the panel's one-click presets use it. */
  persist?: (patch: Record<string, unknown>) => void;
}

interface OllamaModel { name: string; size: number | null; family: string | null }

/** The panel and tool declarations; `tools()` binds the handlers. */
export const SCREEN_SENSE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'screen_photo_list',
    tags: ['read'],
    description: 'List the most recent screenshots in the screen album with their time, app, window title and one-line description. Use it to find a look again; the image itself comes from screen_photo_show.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many of the most recent ones to list; default 10.' },
        app: { type: 'string', description: 'Only screenshots taken while this app was in front.' },
      },
    },
  },
  {
    name: 'screen_photo_show',
    tags: ['read'],
    description: 'Fetch one screenshot from the album and look at it again. Defaults to the most recent one. The image costs context like any other picture.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id from screen_photo_list; omitted means the most recent screenshot.' },
      },
    },
  },
  {
    name: 'screen_sense_status',
    tags: ['read'],
    description: 'Report whether screen sensing is running, whether screen descriptions are on, and how many screenshots and descriptions the album holds.',
    parameters: { type: 'object', properties: {} },
  },
];

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class ScreenSenseWorld implements World {
  readonly id = SCREEN_SENSE_ID;

  private host: WorldHost | null = null;
  private capture: CaptureClient | null = null;
  private focus: FocusGate | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampling = false;

  private readonly album: ScreenAlbum;
  private captioner: CaptionClient | null = null;
  private pace: CaptionPace | null = null;
  private captionBusy = false;
  /** The last description failure, shown in the album panel; null after a success. */
  private lastError: string | null = null;
  private lastCaptionAt: number | null = null;

  constructor(private readonly opts: ScreenSenseOptions) {
    this.album = new ScreenAlbum(join(opts.dataDir, 'screen'), Math.max(0, Math.floor(opts.cfg.caption.keepFiles)));
  }

  /** Only values; the prompt text is in ENV_PROMPT.md. */
  envPromptVars(): Record<string, string> {
    return {};
  }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      screen_photo_list: async (args) => this.photoList(args),
      screen_photo_show: async (args) => this.photoShow(args),
      screen_sense_status: async () => this.statusOutcome(),
    };
    return SCREEN_SENSE_TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] }));
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.capture = new CaptureClient({
      execArgv: () => childExecArgv(),
      log: () => host.log.child('capture'),
      errorText: () => 'screen capture failed',
      timeoutText: () => 'screen capture timed out',
      exitedText: (code) => `screen capture engine exited (${code ?? 0})`,
    });
    if (!this.opts.cfg.enabled) return;
    this.startSampling();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.focus = null;
    this.captioner = null;
    this.pace = null;
    this.capture?.stop('screen sense stopped');
    this.capture = null;
    this.host = null;
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const t = photoPanelText(language);
    return {
      label: language === 'zh' || language === 'zh-Hant' ? '屏幕感知' : 'Screen sense',
      panels: [{ id: 'photos', title: t.title, description: t.description, getMethods: ['list', 'image', 'state', 'clear', 'detect', 'apply', 'test'] }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      config: [senseConfigGroup(language), captionConfigGroup(language)],
      storage: [{
        key: 'screens',
        label: captionStorageText(language).label,
        kind: 'disk',
        location: 'data/screen/',
        danger: true,
        note: captionStorageText(language).note,
        stat: () => captionStorageText(language).stat(albumStat(join(this.opts.dataDir, 'screen')).count),
        clear: () => captionStorageText(language).cleared(clearAlbum(join(this.opts.dataDir, 'screen'))),
      }],
      promptDocs: [{
        key: `worlds.${SCREEN_SENSE_ID}.envPrompt`,
        title: language === 'zh' || language === 'zh-Hant' ? '屏幕感知环境' : 'Screen sense',
        description: language === 'zh' || language === 'zh-Hant'
          ? '说明焦点事件、屏幕描述与相册工具。'
          : 'Explains the focus events, screen descriptions and album tools.',
        path: ENV_PROMPT_FILES[this.modelLanguage()],
        role: 'envPrompt',
      }],
    };
  }

  /* ---------- sampling ---------- */

  private startSampling(): void {
    if (this.timer) clearInterval(this.timer);
    this.focus = new FocusGate({
      dwellMs: this.opts.cfg.dwellMs,
      maxWakesPerHour: this.opts.cfg.maxWakesPerHour,
      followTitle: this.opts.cfg.followTitle,
      // its own window (the settings window or the pet window) is not the person switching apps
      ignoreApps: [...ignoreList(this.opts.cfg.ignoreApps), basename(process.execPath)],
    });
    this.startCaptions();
    this.timer = setInterval(() => { void this.poll(); }, Math.max(250, this.opts.cfg.pollMs));
  }

  /** One sample; an accepted switch becomes a focus event, then one description. Samples never overlap. */
  private async poll(): Promise<void> {
    const gate = this.focus, capture = this.capture;
    if (!gate || !capture || this.sampling) return;
    this.sampling = true;
    try {
      const info = await capture.request<ScreenInfo>({ op: 'info' });
      const sample = { app: info.foregroundApp ?? null, title: info.foreground ?? null };
      const wake = gate.observe(sample, Date.now());
      if (!wake) return;
      const seconds = Math.round(wake.previousMs / 1000);
      await this.push('screen-sense.focus', this.t.focus(wake.app, wake.title, seconds), 'debounce', { kind: 'focus', app: wake.app, title: wake.title, previousMs: wake.previousMs });
      void this.captionScreen(wake);
    } catch (err) {
      this.host?.log.child('capture').debug('焦点采样失败', { err: errText(err) });
    } finally {
      this.sampling = false;
    }
  }

  /** One look described after an accepted switch; the image stays in the album, only the sentence enters the context. */
  private async captionScreen(wake: FocusWake): Promise<void> {
    const capture = this.capture, captioner = this.captioner, pace = this.pace;
    if (!capture || !captioner || !pace || this.captionBusy) return;
    const now = Date.now();
    if (!pace.due(now)) return;
    this.captionBusy = true;
    try {
      const shot = await capture.request<{ width: number; height: number; jpeg: Uint8Array }>({ op: 'screenshot', display: null, maxWidth: this.opts.cfg.caption.maxWidth, maxHeight: this.opts.cfg.caption.maxHeight, quality: 75 });
      const saved = this.album.save(Buffer.from(shot.jpeg), { at: now, app: wake.app, title: wake.title, width: shot.width, height: shot.height });
      if (saved.duplicateOf) return;
      pace.mark(now);
      const text = await captioner.describe(shot.jpeg);
      this.album.caption(saved.entry.id, text);
      this.lastCaptionAt = Date.now();
      this.lastError = null;
      await this.push('screen-sense.screenshot', this.t.screenshot(wake.app, wake.title, text), 'piggyback', { kind: 'screenshot', app: wake.app, title: wake.title, photoId: saved.entry.id, caption: text });
    } catch (err) {
      this.lastError = errText(err);
      this.host?.log.child('caption').warn('屏幕描述失败', { err: this.lastError });
    } finally {
      this.captionBusy = false;
    }
  }

  /** (Re)build the captioner and its pace from the live config; called at start and after a preset applies. */
  private startCaptions(): void {
    this.captioner = null;
    this.pace = null;
    const cfg = this.opts.cfg.caption;
    if (!cfg.enabled) return;
    const protocol = cfg.protocol;
    const key = this.opts.captionApiKey?.() ?? '';
    if (!key && protocol !== 'ollama') {
      this.lastError = 'openai 协议需要密钥';
      return;
    }
    const baseUrl = normalizeBaseUrl(cfg.baseUrl || (protocol === 'ollama' ? OLLAMA_BASE : ''));
    if (!baseUrl) {
      this.lastError = '先填视觉服务地址';
      return;
    }
    const model = normalizeModel(cfg.model);
    if (!model) {
      this.lastError = '先填视觉模型（可用面板的「检测本机 Ollama」）';
      if (protocol === 'ollama') void this.autoPickModel(baseUrl);
      return;
    }
    this.useModel({ protocol, baseUrl, model, key, cfg });
  }

  private useModel(input: { protocol: 'openai' | 'ollama'; baseUrl: string; model: string; key: string; cfg: SenseConfigSection['caption'] }): void {
    this.captioner = new CaptionClient({
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.key,
      protocol: input.protocol,
      timeoutMs: input.cfg.timeoutMs,
      maxTokens: input.cfg.maxTokens,
      prompt: promptInLanguage(input.cfg.prompt, this.modelLanguage()),
    });
    this.pace = new CaptionPace({ minIntervalMs: input.cfg.minIntervalMs, maxPerHour: input.cfg.maxPerHour });
    this.lastError = null;
  }

  /** Fill the model from the local Ollama when the config leaves it empty; the panel writes it permanently. */
  private async autoPickModel(baseUrl: string): Promise<void> {
    const detected = await this.detectOllama(baseUrl);
    if (!detected.ok || detected.models.length === 0) {
      if (!detected.ok) this.lastError = `检测本机 Ollama 失败：${detected.error}`;
      return;
    }
    const vision = detected.models.find((model) => /(gemma|qwen|llava|minicpm|moondream|vision)/i.test(model.name));
    const key = this.opts.captionApiKey?.() ?? '';
    this.useModel({ protocol: 'ollama', baseUrl, model: (vision ?? detected.models[0]!).name, key, cfg: this.opts.cfg.caption });
    this.host?.log.child('caption').info('自动使用本机 Ollama 模型', { model: (vision ?? detected.models[0]!).name });
  }

  /* ---------- panel actions ---------- */

  private async detectOllama(rawBase?: string): Promise<{ ok: true; baseUrl: string; models: OllamaModel[] } | { ok: false; baseUrl: string; error: string }> {
    const cfg = this.opts.cfg.caption;
    const baseUrl = normalizeBaseUrl(rawBase ?? (cfg.protocol === 'ollama' && cfg.baseUrl.trim() ? cfg.baseUrl : OLLAMA_BASE));
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`Ollama 返回 ${res.status}`);
      const body = await res.json() as { models?: Array<{ name?: unknown; size?: unknown; details?: { family?: unknown } }> };
      const models = (body.models ?? [])
        .filter((model) => typeof model.name === 'string')
        .map((model) => ({
          name: model.name as string,
          size: typeof model.size === 'number' ? model.size : null,
          family: typeof model.details?.family === 'string' ? model.details.family : null,
        }));
      return { ok: true, baseUrl, models };
    } catch (err) {
      return { ok: false, baseUrl, error: errText(err) };
    }
  }

  private applyPreset(raw: unknown): { ok: true; protocol: string; baseUrl: string; model: string } | { ok: false; error: string } {
    const input = (raw ?? {}) as Record<string, unknown>;
    const protocol = input.protocol === 'openai' ? 'openai' : 'ollama';
    const baseUrl = normalizeBaseUrl(String(input.baseUrl ?? '')) || (protocol === 'ollama' ? OLLAMA_BASE : '');
    const model = normalizeModel(String(input.model ?? ''));
    if (!baseUrl) return { ok: false, error: '缺少服务地址' };
    if (!model) return { ok: false, error: '缺少模型' };
    if (!this.opts.persist) return { ok: false, error: '当前宿主不支持写配置' };
    this.opts.persist(captionPatch({ protocol, baseUrl, model, enabled: input.enabled !== false }) as never);
    this.startCaptions();
    return { ok: true, protocol, baseUrl, model };
  }

  /** Run one description against the latest screenshot (or a small gray frame) and report the verdict. */
  private async captionTest(): Promise<Record<string, unknown>> {
    const cfg = this.opts.cfg.caption;
    const protocol = cfg.protocol;
    const baseUrl = normalizeBaseUrl(cfg.baseUrl || (protocol === 'ollama' ? OLLAMA_BASE : ''));
    if (!baseUrl) return { ok: false, error: '先填视觉服务地址' };
    const model = normalizeModel(cfg.model);
    if (!model) return { ok: false, error: '先填视觉模型' };
    const key = this.opts.captionApiKey?.() ?? '';
    if (!key && protocol !== 'ollama') return { ok: false, error: 'openai 协议需要密钥' };
    const client = new CaptionClient({
      baseUrl, model, apiKey: key, protocol,
      timeoutMs: cfg.timeoutMs, maxTokens: cfg.maxTokens,
      prompt: promptInLanguage(cfg.prompt, this.modelLanguage()),
    });
    const started = Date.now();
    try {
      const text = await client.describe(this.sampleJpeg());
      this.lastCaptionAt = Date.now();
      this.lastError = null;
      return { ok: true, ms: Date.now() - started, caption: text, model, baseUrl };
    } catch (err) {
      const error = errText(err);
      this.lastError = error;
      const detected = protocol === 'ollama' ? await this.detectOllama(baseUrl) : null;
      const models = detected?.ok ? detected.models.map((entry) => entry.name) : [];
      return { ok: false, ms: Date.now() - started, error, models, suggestion: suggestModel(model, models) };
    }
  }

  /** The latest screenshot, or a plain gray frame when the album is empty. */
  private sampleJpeg(): Uint8Array {
    const latest = this.album.latest();
    const got = latest ? this.album.read(latest.id) : null;
    if (got) return got.bytes;
    const width = 64, height = 64;
    const rgba = Buffer.alloc(width * height * 4, 128);
    return new Uint8Array(jpeg.encode({ data: rgba, width, height }, 70).data);
  }

  /* ---------- data ---------- */

  private async push(type: string, text: string, trigger: 'debounce' | 'piggyback', meta?: Record<string, unknown>): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.pushEvent({ type, source: this.id, senderKey: type, ts: nowIso(this.opts.timezone), text, ...(meta ? { meta } : {}) }, { trigger });
  }

  private photoList(args: Record<string, unknown>): ToolOutcome {
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(50, Math.max(1, Math.round(args.limit))) : 10;
    const app = typeof args.app === 'string' && args.app.trim() ? args.app.trim() : undefined;
    const entries = this.album.find({ limit, ...(app ? { app } : {}) });
    if (entries.length === 0) return { text: this.t.photoEmpty };
    return { text: [this.t.photoListHead(entries.length), ...entries.map((entry) => this.t.photoLine(entry, this.clock(entry.at)))].join('\n') };
  }

  private async photoShow(args: Record<string, unknown>): Promise<ToolOutcome> {
    const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : null;
    const entry = id ? this.album.get(id) : this.album.latest();
    if (!entry) return { text: this.t.photoMissing(id ?? ''), failed: true };
    const got = this.album.read(entry.id);
    if (!got) return { text: this.t.photoMissing(entry.id), failed: true };
    const text = this.t.photoShown(entry, this.clock(entry.at));
    return { text, blobs: [{ bytes: got.bytes, mime: got.mime, name: `${entry.id}.jpg`, fallbackText: text }] };
  }

  private async statusOutcome(): Promise<ToolOutcome> {
    const entries = this.album.list();
    return {
      text: this.t.status(
        this.opts.cfg.enabled,
        entries.length,
        entries.filter((entry) => entry.caption).length,
        this.opts.cfg.caption.enabled,
        this.lastError,
      ),
    };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'photos') return null;
    switch (method) {
      case 'list': {
        const raw = (args[0] ?? {}) as Record<string, unknown>;
        const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.min(50, Math.max(1, Math.round(raw.limit))) : 24;
        return {
          total: this.album.list().length,
          entries: this.album.find({ limit }).map((entry) => ({ id: entry.id, at: entry.at, app: entry.app, title: entry.title, caption: entry.caption })),
        };
      }
      case 'image': {
        const got = this.album.read(String(args[0] ?? ''));
        if (!got) return null;
        return { $binary: { mime: got.mime, base64: Buffer.from(got.bytes).toString('base64') } };
      }
      case 'state': {
        const entries = this.album.list();
        return {
          enabled: this.opts.cfg.enabled,
          captures: entries.length,
          captions: entries.filter((entry) => entry.caption).length,
          captionEnabled: this.opts.cfg.caption.enabled,
          pollMs: this.opts.cfg.pollMs,
          lastCaptionAt: this.lastCaptionAt,
          lastError: this.lastError,
        };
      }
      case 'detect':
        return this.detectOllama();
      case 'apply':
        return this.applyPreset(args[0]);
      case 'test':
        return this.captionTest();
      case 'clear':
        return { removed: this.album.clear() };
      default:
        return null;
    }
  }

  private clock(atMs: number): string {
    return shortTime(this.opts.timezone, new Date(atMs));
  }

  private get t(): ModelText {
    return MODEL_TEXT[this.modelLanguage()];
  }

  private modelLanguage(): ModelLanguage {
    return this.opts.modelLanguage?.() ?? 'zh';
  }
}

/** The defaults this World seeds its config section with. */
export const SCREEN_SENSE_DEFAULTS = SENSE_DEFAULTS;
