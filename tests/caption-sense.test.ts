import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScreenAlbum, albumStat, clearAlbum } from '../src/album.ts';
import { CaptionClient, CaptionError, CaptionPace, captionBody, captionText, ollamaBody, ollamaText, promptInLanguage, renderPrompt } from '../src/caption.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'screen-album-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const shot = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n]);
const meta = (n: number) => ({ at: 1000 + n, app: 'chrome.exe', title: `p${n}`, width: 768, height: 480 });

describe('ScreenAlbum', () => {
  it('同一画面只存一份,第二张指向已描述的那条', () => {
    const album = new ScreenAlbum(dir, 100);
    const first = album.save(shot(1), meta(1));
    album.caption(first.entry.id, 'browser open');
    const second = album.save(shot(1), meta(2));
    expect(second.duplicateOf).toBe(first.entry.id);
    expect(albumStat(dir).count).toBe(1);
  });

  it('描述写入后可从记录取回,重建相册仍然记得', () => {
    const album = new ScreenAlbum(dir, 100);
    const saved = album.save(shot(2), meta(1));
    album.caption(saved.entry.id, 'a terminal');
    const reopened = new ScreenAlbum(dir, 100);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.captionOf(saved.entry.id)).toBe('a terminal');
    expect(reopened.save(shot(2), meta(2)).duplicateOf).toBe(saved.entry.id);
  });

  it('超过保留张数时删最旧的截图与登记', () => {
    const album = new ScreenAlbum(dir, 2);
    album.save(shot(1), meta(1));
    album.save(shot(2), meta(2));
    album.save(shot(3), meta(3));
    expect(album.list().map((e) => e.hash).length).toBe(2);
    expect(albumStat(dir).count).toBe(2);
  });

  it('清除返回删除的份数,目录随之消失', () => {
    const album = new ScreenAlbum(dir, 100);
    album.save(shot(1), meta(1));
    album.save(shot(2), meta(2));
    expect(album.clear()).toBe(2);
    expect(albumStat(dir)).toEqual({ count: 0, bytes: 0 });
    expect(clearAlbum(dir)).toBe(0);
  });

  it('能按 id 取回、按时间取最新、按应用过滤、读回原图', () => {
    const album = new ScreenAlbum(dir, 100);
    const a = album.save(shot(1), { ...meta(1), app: 'chrome.exe' });
    const b = album.save(shot(2), { ...meta(2), app: 'Code.exe' });
    album.caption(b.entry.id, 'editor');
    expect(album.get(a.entry.id)?.app).toBe('chrome.exe');
    expect(album.latest()?.id).toBe(b.entry.id);
    expect(album.find({ limit: 10, app: 'code.exe' }).map((e) => e.id)).toEqual([b.entry.id]);
    expect(Array.from(album.read(b.entry.id)?.bytes ?? [])).toEqual(Array.from(shot(2)));
    expect(album.read('S999')).toBeNull();
  });
});

describe('CaptionPace', () => {
  it('最短间隔内不重复描述', () => {
    const pace = new CaptionPace({ minIntervalMs: 60_000, maxPerHour: 6 });
    expect(pace.due(0)).toBe(true);
    pace.mark(0);
    expect(pace.due(30_000)).toBe(false);
    expect(pace.due(60_000)).toBe(true);
  });

  it('每小时上限之外的描述跳过,一小时后恢复', () => {
    const pace = new CaptionPace({ minIntervalMs: 0, maxPerHour: 2 });
    pace.mark(0);
    pace.mark(1000);
    expect(pace.due(2000)).toBe(false);
    expect(pace.countInHour(2000)).toBe(2);
    expect(pace.due(3_601_000)).toBe(true);
  });
});

describe('CaptionClient', () => {
  it('请求体是单图 + 指令,关闭推理', () => {
    const body = captionBody('vision-mini', 'describe it', 'data:image/jpeg;base64,AA==', 120);
    expect(body.model).toBe('vision-mini');
    expect(body.max_tokens).toBe(120);
    expect(body.reasoning).toEqual({ enabled: false });
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } });
    expect(messages[0]!.content[1]).toEqual({ type: 'text', text: 'describe it' });
  });

  it('响应取第一段正文,形状不对时抛错', () => {
    expect(captionText({ choices: [{ message: { content: '  a browser  ' } }] })).toBe('a browser');
    expect(() => captionText({ choices: [] })).toThrow(CaptionError);
  });

  it('客户端发出请求并把正文交回', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'editor open' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CaptionClient({ baseUrl: 'http://127.0.0.1:1234/v1/', model: 'm', apiKey: 'k', timeoutMs: 5000, maxTokens: 64, prompt: 'p' }, fake);
    expect(await client.describe(shot(3))).toBe('editor open');
    expect(calls[0]!.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('描述语言跟随 Coo 的语言', () => {
    expect(promptInLanguage('describe', 'zh')).toContain('简体中文');
    expect(promptInLanguage('describe', 'en')).toContain('Answer in English');
  });
  it('非 2xx 抛 CaptionError 并带状态码', async () => {
    const fake = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const client = new CaptionClient({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'k', timeoutMs: 5000, maxTokens: 64, prompt: 'p' }, fake);
    await expect(client.describe(shot(4))).rejects.toMatchObject({ status: 401 });
  });

  it('Ollama 请求体:图片在 images 里、思考关闭', () => {
    const body = ollamaBody('gemma4:e2b', 'describe it', 'AA==', 120);
    expect(body.model).toBe('gemma4:e2b');
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    const messages = body.messages as Array<{ content: string; images: string[] }>;
    expect(messages[0]!.content).toBe('describe it');
    expect(messages[0]!.images).toEqual(['AA==']);
    expect((body.options as { num_predict: number }).num_predict).toBe(120);
  });

  it('Ollama 响应取 message.content;只有 thinking 时给出可读失败', () => {
    expect(ollamaText({ message: { content: '  a prompt window  ' } })).toBe('a prompt window');
    expect(() => ollamaText({ message: { content: '', thinking: 'thinking...' } })).toThrow(CaptionError);
    expect(() => ollamaText({})).toThrow(CaptionError);
  });

  it('ollama 协议的客户端请求 /api/chat 并解析 message.content', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ message: { content: 'a terminal window' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CaptionClient({ baseUrl: 'http://localhost:11434/', model: 'gemma4:e2b', apiKey: 'ollama', protocol: 'ollama', timeoutMs: 20000, maxTokens: 120, prompt: 'p' }, fake);
    expect(await client.describe(shot(5))).toBe('a terminal window');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(calls[0]!.body).think).toBe(false);
  });
});
describe('renderPrompt', () => {
  it('fills the window title and app, and leaves unknown placeholders alone', () => {
    const out = renderPrompt('已知："{window_title}" ({app}); {unknown}', { windowTitle: 'Bilibili - Chrome', app: 'chrome.exe' });
    expect(out).toContain('Bilibili - Chrome');
    expect(out).toContain('chrome.exe');
    expect(out).toContain('{unknown}');
  });

  it('normalises whitespace and truncates a very long title', () => {
    const out = renderPrompt('{window_title}', { windowTitle: 'a\nb' + 'x'.repeat(300) });
    expect(out.startsWith('a b')).toBe(true);
    expect(out.length).toBeLessThan(210);
  });
});