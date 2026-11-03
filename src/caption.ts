/**
 * 外挂视觉：把一张截图描述成一句话，供 `desktop-pet.screen` 事件使用。
 * 支持 OpenAI 兼容 `/chat/completions` 与 Ollama 原生 `/api/chat`（后者可关思考，避免正文为空）；
 * 单次尝试、不重试、不阻塞主循环；模型与端点只在本模块里。
 */

import type { CaptionProtocol } from './config.ts';

export interface CaptionClientOptions {
  /** 到 `/chat/completions` 为止的基地址（Ollama 为服务根），末尾斜杠会被去掉。 */
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxTokens: number;
  prompt: string;
  /** 缺省 `openai`。 */
  protocol?: CaptionProtocol;
}

export class CaptionError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'CaptionError';
  }
}

/** 请求体：单图 + 一句指令；`reasoning` 关闭（OpenRouter 与部分本地服务认）。 */
export function captionBody(model: string, prompt: string, dataUrl: string, maxTokens: number): Record<string, unknown> {
  return {
    model,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: prompt },
      ],
    }],
  };
}

/** 从 OpenAI 兼容响应里取第一段正文；形状不对时抛错。 */
export function captionText(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new CaptionError('响应缺 choices[0].message.content', 0, '');
  return content.trim();
}

/** 描述用 Coo 说话的那种语言：默认提示词是英文，这里补一句要求。 */
export function promptInLanguage(prompt: string, language: 'zh' | 'en'): string {
  return language === 'zh' ? `${prompt} 用简体中文回答，只给一句话。` : `${prompt} Answer in English, one sentence.`;
}

/** Ollama 原生请求体：图片放在 `images` 里（纯 base64），`think: false` 让正文不落进思考流。 */
export function ollamaBody(model: string, prompt: string, base64: string, maxTokens: number): Record<string, unknown> {
  return {
    model,
    stream: false,
    think: false,
    messages: [{ role: 'user', content: prompt, images: [base64] }],
    options: { num_predict: maxTokens, temperature: 0.2 },
  };
}

/** 从 Ollama `/api/chat` 响应取正文；思考模型把正文留在 `thinking` 时给出可读的失败原因。 */
export function ollamaText(payload: unknown): string {
  const message = (payload as { message?: { content?: unknown; thinking?: unknown } } | null)?.message;
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (content) return content;
  const thinking = typeof message?.thinking === 'string' ? message.thinking.trim() : '';
  if (thinking) throw new CaptionError('模型只给了思考过程（正文为空）；确认服务端支持 think:false，或换非思考模型', 0, thinking.slice(0, 500));
  throw new CaptionError('响应缺 message.content', 0, '');
}

export class CaptionClient {
  private readonly baseUrl: string;

  constructor(private readonly opts: CaptionClientOptions, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  }

  /** 描述一张 JPEG。失败抛 `CaptionError` 或网络错误，调用方决定记 failed 还是丢弃。 */
  async describe(jpeg: Uint8Array): Promise<string> {
    const base64 = Buffer.from(jpeg).toString('base64');
    const ollama = this.opts.protocol === 'ollama';
    const url = ollama ? `${this.baseUrl}/api/chat` : `${this.baseUrl}/chat/completions`;
    const body = ollama
      ? ollamaBody(this.opts.model, this.opts.prompt, base64, this.opts.maxTokens)
      : captionBody(this.opts.model, this.opts.prompt, `data:image/jpeg;base64,${base64}`, this.opts.maxTokens);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.max(1000, this.opts.timeoutMs));
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new CaptionError(`视觉请求 ${res.status}`, res.status, text.slice(0, 2000));
      const payload = JSON.parse(text) as unknown;
      return ollama ? ollamaText(payload) : captionText(payload);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 描述节奏：最短间隔 + 每小时上限。纯计时，不碰 IO。 */
export class CaptionPace {
  private lastAt: number | null = null;
  private readonly times: number[] = [];

  constructor(private readonly opts: { minIntervalMs: number; maxPerHour: number }) {}

  /** 现在能不能描述一张。 */
  due(nowMs: number): boolean {
    if (this.lastAt !== null && nowMs - this.lastAt < this.opts.minIntervalMs) return false;
    if (this.opts.maxPerHour <= 0) return true;
    this.prune(nowMs);
    return this.times.length < this.opts.maxPerHour;
  }

  /** 记一次描述（成功发出请求后调用）。 */
  mark(nowMs: number): void {
    this.lastAt = nowMs;
    this.times.push(nowMs);
  }

  countInHour(nowMs: number): number {
    this.prune(nowMs);
    return this.times.length;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - 60 * 60_000;
    while (this.times.length > 0 && this.times[0]! < cutoff) this.times.shift();
  }
}
