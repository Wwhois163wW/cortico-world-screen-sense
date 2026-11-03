/**
 * 屏幕相册：截图字节按内容哈希存盘，`registry.jsonl` 只追加，读时取每个 id 的最后一条。
 * 相册在 `data/screen/` 下，清除动作由存储项或额度淘汰触发。
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AlbumEntry {
  id: string;
  /** 毫秒时间戳。 */
  at: number;
  app: string | null;
  title: string | null;
  hash: string;
  file: string;
  width: number;
  height: number;
  /** 一句话描述；还没描述时为 null。 */
  caption: string | null;
  /** 描述失败的原因。 */
  failed?: string;
}

type Line = {
  id: string; at: number; app: string | null; title: string | null;
  hash: string; file: string; width: number; height: number;
  caption?: string | null; failed?: string;
};

const REGISTRY = 'registry.jsonl';

export class ScreenAlbum {
  private readonly entries = new Map<string, AlbumEntry>();
  /** 内容哈希 → 最近一次带描述的 id；同一画面不重复喂视觉模型。 */
  private readonly captioned = new Map<string, string>();
  private seq = 0;

  constructor(private readonly dir: string, private readonly keepFiles: number) {
    this.load();
  }

  /** 存一张截图，返回它的记录与同一画面的旧记录（有的话）。 */
  save(jpeg: Uint8Array, meta: { at: number; app: string | null; title: string | null; width: number; height: number }): { entry: AlbumEntry; duplicateOf: string | null } {
    const hash = createHash('sha256').update(jpeg).digest('hex').slice(0, 20);
    mkdirSync(this.dir, { recursive: true });
    const file = `${hash}.jpg`;
    const path = join(this.dir, file);
    if (!existsSync(path)) writeFileSync(path, jpeg);
    this.seq += 1;
    const entry: AlbumEntry = { id: `S${this.seq}`, at: meta.at, app: meta.app, title: meta.title, hash, file, width: meta.width, height: meta.height, caption: null };
    this.entries.set(entry.id, entry);
    this.append(entry);
    this.prune();
    return { entry, duplicateOf: this.captioned.get(hash) ?? null };
  }

  /** 记录一句话描述；同一内容的后续截图沿用这条描述。 */
  caption(id: string, text: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.caption = text;
    this.captioned.set(entry.hash, id);
    this.append(entry);
  }

  fail(id: string, reason: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.failed = reason.slice(0, 300);
    this.append(entry);
  }

  /** 某个内容的描述，没有时 null。 */
  captionOf(id: string): string | null {
    return this.entries.get(id)?.caption ?? null;
  }

  get(id: string): AlbumEntry | null {
    return this.entries.get(id) ?? null;
  }

  /** 最近的一张。 */
  latest(): AlbumEntry | null {
    let newest: AlbumEntry | null = null;
    for (const entry of this.entries.values()) if (!newest || entry.at > newest.at) newest = entry;
    return newest;
  }

  /** 最近的若干张，可按前台应用过滤；新的在前。 */
  find(opts: { limit: number; app?: string }): AlbumEntry[] {
    const app = opts.app?.trim().toLowerCase();
    const out = [...this.entries.values()].filter((entry) => !app || (entry.app ?? '').toLowerCase() === app);
    return out.sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.floor(opts.limit)));
  }

  /** 读回某张截图的字节；记录或文件不在时 null。 */
  read(id: string): { bytes: Uint8Array; mime: string } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    try {
      return { bytes: readFileSync(join(this.dir, entry.file)), mime: 'image/jpeg' };
    } catch {
      return null;
    }
  }

  list(): AlbumEntry[] {
    return [...this.entries.values()].sort((a, b) => a.at - b.at);
  }

  stat(): { count: number; bytes: number } {
    return { count: this.entries.size, bytes: dirBytes(this.dir) };
  }

  clear(): number {
    const count = this.entries.size;
    rmSync(this.dir, { recursive: true, force: true });
    this.entries.clear();
    this.captioned.clear();
    this.seq = 0;
    return count;
  }

  private prune(): void {
    if (this.keepFiles <= 0 || this.entries.size <= this.keepFiles) return;
    const oldest = [...this.entries.values()].sort((a, b) => a.at - b.at).slice(0, this.entries.size - this.keepFiles);
    for (const entry of oldest) {
      this.entries.delete(entry.id);
      if (![...this.entries.values()].some((other) => other.hash === entry.hash)) {
        rmSync(join(this.dir, entry.file), { force: true });
      }
    }
    this.rewrite();
  }

  private load(): void {
    const file = join(this.dir, REGISTRY);
    if (!existsSync(file)) return;
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record: Line;
      try { record = JSON.parse(line) as Line; } catch { continue; }
      if (!record?.id) continue;
      const at = Number(record.at) || 0;
      this.entries.set(record.id, {
        id: record.id, at, app: record.app ?? null, title: record.title ?? null,
        hash: record.hash, file: record.file, width: Number(record.width) || 0, height: Number(record.height) || 0,
        caption: record.caption ?? null, ...(record.failed ? { failed: record.failed } : {}),
      });
      if (record.caption) this.captioned.set(record.hash, record.id);
      const n = Number(record.id.replace(/^S/, ''));
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }

  private append(entry: AlbumEntry): void {
    const line: Line = {
      id: entry.id, at: entry.at, app: entry.app, title: entry.title,
      hash: entry.hash, file: entry.file, width: entry.width, height: entry.height,
      caption: entry.caption, ...(entry.failed ? { failed: entry.failed } : {}),
    };
    try { appendFileSync(join(this.dir, REGISTRY), `${JSON.stringify(line)}\n`, 'utf8'); } catch { /* 相册写失败不影响主流程 */ }
  }

  private rewrite(): void {
    const lines = [...this.entries.values()].map((entry) => JSON.stringify({
      id: entry.id, at: entry.at, app: entry.app, title: entry.title,
      hash: entry.hash, file: entry.file, width: entry.width, height: entry.height,
      caption: entry.caption, ...(entry.failed ? { failed: entry.failed } : {}),
    } satisfies Line));
    try { writeFileSync(join(this.dir, REGISTRY), lines.length ? `${lines.join('\n')}\n` : '', 'utf8'); } catch { /* 同上 */ }
  }
}

/** 相册目录的份数与字节数；目录不存在时都是 0。 */
export function albumStat(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith('.jpg'));
    return { count: files.length, bytes: files.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** 删掉整个相册目录，返回删掉的截图份数。 */
export function clearAlbum(dir: string): number {
  const { count } = albumStat(dir);
  rmSync(dir, { recursive: true, force: true });
  return count;
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.jpg')).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
  } catch {
    return 0;
  }
}
