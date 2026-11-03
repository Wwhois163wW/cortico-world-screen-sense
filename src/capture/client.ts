/**
 * Engine child lifecycle and request plumbing for screen capture and input.
 * Owns the child process, the pending calls and their timeouts; the caller keeps permission,
 * yielding policy, coordinates and text. Imports no `cortico/*`; the caller passes the loader
 * arguments the current runtime needs for TypeScript.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ChildToMain, EngineRequest, MainToChild } from './engine-ipc.ts';
import type { EngineErrorCode } from './engine/fail.ts';

const ENGINE_FILE = fileURLToPath(new URL('./engine-child.ts', import.meta.url));
const ENGINE_TIMEOUT_MS = 30_000;
/** Input requests; anything else only reads. */
const INPUT_OPS: ReadonlySet<string> = new Set(['click', 'move', 'drag', 'scroll', 'type', 'key', 'focus']);

/** Minimal logger the caller hands in; its `child('engine')` labels engine output. */
export interface EngineLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

export interface CaptureClientOptions {
  /** Node arguments for the child (`--import tsx` in a source checkout); empty when the host runs compiled code. */
  execArgv?: () => string[];
  log?: () => EngineLogger | null | undefined;
  /** Text for an engine failure code; the caller owns the wording. */
  errorText?: (code: EngineErrorCode, args: readonly (string | number)[]) => string;
  /** Text for an unanswered request past its deadline. */
  timeoutText?: () => string;
  /** Text for a child that exited with a nonzero code (undefined: exited cleanly). */
  exitedText?: (code?: number) => string;
  /** Called after the child exits, before pending calls fail. */
  onExit?: () => void;
}

interface Pending {
  engine: ChildProcess;
  done: (value: unknown) => void;
  fail: (error: Error) => void;
  timer: NodeJS.Timeout;
}


export class CaptureClient {
  private engine: ChildProcess | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private exitValue: number | null = null;
  private actingCount = 0;

  constructor(private readonly opts: CaptureClientOptions = {}) {}

  /** Whether an engine child is up. */
  get connected(): boolean {
    return this.engine !== null;
  }

  /** The last nonzero exit code, until the next start; null after a clean exit or before the first start. */
  get exitCode(): number | null {
    return this.exitValue;
  }

  /** Input requests this client has in flight. */
  acting(): boolean {
    return this.actingCount > 0;
  }

  /** One request; an abort after it went out sends a cancel and the call still resolves with what the engine reports. */
  async request<T>(req: EngineRequest, signal?: AbortSignal): Promise<T> {
    if (!this.engine) {
      this.engine = this.spawn();
      this.exitValue = null;
    }
    const id = ++this.seq;
    const engine = this.engine;
    const acting = INPUT_OPS.has(req.op);
    if (acting) {
      this.actingCount += 1;
    }
    const call = new Promise<T>((done, fail) => {
      const wait = 'yield' in req ? req.yield.maxWaitMs : req.op === 'confirm' ? req.timeoutMs : 0;
      const cancel = (): void => { if (engine.connected) engine.send({ cancel: id } satisfies MainToChild); };
      const unlisten = (): void => signal?.removeEventListener('abort', cancel);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        unlisten();
        fail(new Error(this.opts.timeoutText?.() ?? 'engine timeout'));
        if (this.engine === engine) {
          this.engine = null;
          engine.kill('SIGKILL');
        }
      }, ENGINE_TIMEOUT_MS + wait);
      this.pending.set(id, { engine, done: (value) => { unlisten(); done(value as T); }, fail: (error) => { unlisten(); fail(error); }, timer });
      signal?.addEventListener('abort', cancel, { once: true });
      engine.send({ id, req } satisfies MainToChild);
    });
    if (!acting) return call;
    try {
      return await call;
    } finally {
      this.actingCount -= 1;
    }
  }

  /** Ends the child and fails what is still pending with `reason`; a later request starts a fresh one. */
  stop(reason = 'engine stopped'): void {
    const engine = this.engine;
    this.engine = null;
    this.exitValue = null;
    if (!engine) return;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.fail(new Error(reason));
      this.pending.delete(id);
    }
    engine.kill();
  }

  private spawn(): ChildProcess {
    const child = fork(ENGINE_FILE, [], {
      execArgv: this.opts.execArgv?.() ?? [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const log = this.opts.log?.();
    const forward = (data: Buffer): void => {
      for (const line of data.toString().split(/\r?\n/)) if (line.trim()) log?.warn(line);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.on('message', (msg: ChildToMain) => {
      const pending = this.pending.get(msg.id);
      if (!pending || pending.engine !== child) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok) pending.done(msg.value);
      else pending.fail(new Error(msg.code ? (this.opts.errorText?.(msg.code, msg.args ?? []) ?? String(msg.code)) : msg.error));
    });
    child.on('exit', (code) => {
      if (this.engine === child) {
        this.engine = null;
        this.exitValue = code === 0 ? null : code;
      }
      this.opts.onExit?.();
      const why = this.opts.exitedText?.(code === 0 ? undefined : code ?? undefined) ?? `engine exited (${code})`;
      for (const [id, pending] of this.pending) {
        if (pending.engine !== child) continue;
        clearTimeout(pending.timer);
        pending.fail(new Error(why));
        this.pending.delete(id);
      }
    });
    return child;
  }
}
