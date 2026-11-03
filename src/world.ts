/**
 * Screen sense: the foreground app switches into `screen-sense.focus` events, screenshots into the
 * album, an auxiliary vision model writes one sentence per accepted switch, and the model can look
 * an old screenshot up again. Capture and input live in `src/capture/`; this World only
 * decides what is worth a wake-up and what reaches the context.
 */
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { childExecArgv } from 'cortico/extensions/runtime.ts';
import { nowIso, shortTime } from 'cortico/core/util.ts';
import { CaptureClient, type ScreenInfo } from './capture/index.ts';
import { ScreenAlbum, albumStat, clearAlbum } from './album.ts';
import { CaptionClient, CaptionPace, promptInLanguage } from './caption.ts';
import { SENSE_DEFAULTS, captionStorageText, photoPanelText, senseConfigGroup, type SenseConfigSection } from './config.ts';
import { FocusGate, ignoreList, type FocusWake } from './focus.ts';
import { MODEL_TEXT, type ModelLanguage, type ModelText } from './model-text.ts';

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
}

/** The panel and tool declarations; `tools()` binds the handlers. */
const TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
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
    description: 'Report whether screen sensing is running, whether it is paused, and how many screenshots and descriptions the album holds.',
    parameters: { type: 'object', properties: {} },
  },
];

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
    return TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] }));
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
      panels: [{ id: 'photos', title: t.title, description: t.description, getMethods: ['list', 'image', 'state', 'clear'] }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      config: [senseConfigGroup(language)],
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
      await this.push('screen-sense.focus', this.t.focus(wake.app, wake.title, seconds), 'debounce');
      void this.captionScreen(wake);
    } catch (err) {
      this.host?.log.child('capture').debug('焦点采样失败', { err: String(err) });
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
      await this.push('screen-sense.screenshot', this.t.screenshot(wake.app, wake.title, text), 'piggyback');
    } catch (err) {
      this.host?.log.child('capture').debug('屏幕描述失败', { err: String(err) });
    } finally {
      this.captionBusy = false;
    }
  }

  private startCaptions(): void {
    const cfg = this.opts.cfg.caption;
    const protocol = cfg.protocol ?? 'openai';
    const key = this.opts.captionApiKey?.() ?? '';
    if (!cfg.enabled || !cfg.baseUrl.trim() || !cfg.model.trim() || (!key && protocol !== 'ollama')) return;
    this.captioner = new CaptionClient({
      baseUrl: cfg.baseUrl, model: cfg.model, apiKey: key, protocol,
      timeoutMs: cfg.timeoutMs, maxTokens: cfg.maxTokens,
      prompt: promptInLanguage(cfg.prompt, this.modelLanguage()),
    });
    this.pace = new CaptionPace({ minIntervalMs: cfg.minIntervalMs, maxPerHour: cfg.maxPerHour });
  }

  /* ---------- data ---------- */

  private async push(type: string, text: string, trigger: 'debounce' | 'piggyback'): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.pushEvent({ type, source: this.id, senderKey: type, ts: nowIso(this.opts.timezone), text }, { trigger });
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
    return { text: this.t.status(this.opts.cfg.enabled, entries.length, entries.filter((entry) => entry.caption).length) };
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
          intervalMinutes: Math.round(this.opts.cfg.pollMs / 60000 * 10) / 10,
        };
      }
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
