/**
 * 焦点感知：把前台窗口采样变成"值得打扰模型"的切换。所有判定都在这里，World 只负责采样与投递。
 * 不上屏、不存图：只读应用名与窗口标题。
 */

export interface FocusSample {
  /** 前台窗口所属程序；取不到时为 null。 */
  app: string | null;
  /** 前台窗口标题；取不到时为 null。 */
  title: string | null;
}

export interface FocusWake {
  app: string;
  title: string | null;
  /** 切换前那个应用。 */
  previousApp: string | null;
  /** 前一个应用在前台停留了多久，毫秒。 */
  previousMs: number;
}

export interface FocusGateOptions {
  /** 新应用要在前台待够这么久才算一次切换，毫秒。 */
  dwellMs: number;
  /** 任意一小时内最多返回几次；0 表示不限。 */
  maxWakesPerHour: number;
  /** 忽略的应用名，大小写不敏感。 */
  ignoreApps: readonly string[];
  /** true 时同一应用内的标题变化也算一次切换。 */
  followTitle: boolean;
}

const HOUR_MS = 60 * 60_000;

export class FocusGate {
  private app: string | null = null;
  private title: string | null = null;
  private since = 0;
  private pending: { app: string; title: string | null; atMs: number } | null = null;
  private readonly wakes: number[] = [];
  private readonly ignored: ReadonlySet<string>;

  constructor(private readonly opts: FocusGateOptions) {
    this.ignored = new Set(opts.ignoreApps.map((name) => name.trim().toLowerCase()).filter((name) => name !== ''));
  }

  /** 采样一次。返回非 null 表示这一拍应当唤醒模型。 */
  observe(sample: FocusSample, nowMs: number): FocusWake | null {
    const app = sample.app?.trim() || null;
    if (app === null) {
      this.pending = null;
      return null;
    }
    if (this.ignored.has(app.toLowerCase())) {
      if (this.app !== app) this.adopt(app, sample.title, nowMs);
      else this.pending = null;
      return null;
    }
    if (this.app === null) {
      this.adopt(app, sample.title, nowMs);
      return null;
    }
    const key = this.keyOf(app, sample.title);
    if (key === this.keyOf(this.app, this.title)) {
      this.pending = null;
      return null;
    }
    if (!this.pending || this.pendingKey() !== key) {
      this.pending = { app, title: sample.title, atMs: nowMs };
      if (this.opts.dwellMs > 0) return null;
    }
    const atMs = this.pending!.atMs;
    if (nowMs - atMs < this.opts.dwellMs) return null;
    if (!this.allowed(nowMs)) {
      this.pending = null;
      return null;
    }
    const wake: FocusWake = {
      app: this.pending!.app,
      title: this.pending!.title,
      previousApp: this.app,
      previousMs: Math.max(0, atMs - this.since),
    };
    this.adopt(wake.app, wake.title, atMs);
    this.wakes.push(nowMs);
    return wake;
  }

  /** 不唤醒地重设基线：桌宠自己操作电脑后、全屏结束后、感知恢复时的第一拍用它。 */
  settle(sample: FocusSample, nowMs: number): void {
    const app = sample.app?.trim() || null;
    if (app === null) return;
    this.adopt(app, sample.title, nowMs);
  }

  /** 任意一小时内已返回的次数，测试与日志用。 */
  countInHour(nowMs: number): number {
    this.prune(nowMs);
    return this.wakes.length;
  }

  private adopt(app: string, title: string | null, atMs: number): void {
    this.app = app;
    this.title = title;
    this.since = atMs;
    this.pending = null;
  }

  private pendingKey(): string {
    return this.keyOf(this.pending!.app, this.pending!.title);
  }

  private keyOf(app: string, title: string | null): string {
    return this.opts.followTitle ? `${app}\u0000${title ?? ''}` : app;
  }

  private allowed(nowMs: number): boolean {
    if (this.opts.maxWakesPerHour <= 0) return true;
    this.prune(nowMs);
    return this.wakes.length < this.opts.maxWakesPerHour;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - HOUR_MS;
    while (this.wakes.length > 0 && this.wakes[0]! < cutoff) this.wakes.shift();
  }
}

/** 配置里的逗号分隔名单；空项丢掉。 */
export function ignoreList(value: string): string[] {
  return value.split(',').map((name) => name.trim()).filter((name) => name !== '');
}
