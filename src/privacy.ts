/**
 * Privacy filtering at the sensing layer.
 *
 * The producer may run against a local vision model, but "local" must not be an assumption:
 * sensitive apps/titles are skipped before any screenshot or event, cloud endpoints are refused
 * unless explicitly allowed, and description text is redacted before it reaches the event stream.
 */
import { URL } from 'node:url';

const PRIVATE_APPS = [
  'wechat', 'weixin', 'qq', 'discord', 'telegram', 'slack', 'teams', 'zoom', 'webex',
  'outlook', 'thunderbird', 'foxmail', 'feishu', 'lark', 'dingtalk', 'wecom',
  'whatsapp', 'signal', 'skype', 'mail', '1password', 'bitwarden', 'keepass', 'lastpass',
  'keeper', 'wallet', 'bank',
];

export const DEFAULT_SENSITIVE_KEYWORDS = [
  '密码', '口令', '验证码', '动态码', '身份证', '银行卡', '银行', '支付', '钱包', '私钥', '助记词',
  '恢复码', '双重验证', '无痕', '隐私模式', '隐身',
  'password', 'passcode', 'bank', 'banking', 'wallet', 'seed phrase', 'private key',
  'recovery code', '2fa', 'verification code', 'credit card', 'cvv', 'incognito', 'inprivate',
];

export interface PrivacyOptions {
  /** Extra ignored app fragments from the user config. */
  ignoreApps: string;
  /** Comma separated sensitive words for titles and descriptions. */
  sensitiveKeywords: string;
}

function words(value: string): string[] {
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/** Why this foreground context must not be captured; null means it is safe. */
export function sensitiveContext(app: string | null | undefined, title: string | null | undefined, opts: PrivacyOptions): string | null {
  const a = (app ?? '').trim().toLowerCase();
  const t = (title ?? '').trim().toLowerCase();
  const extra = words(opts.ignoreApps);
  if (a && [...PRIVATE_APPS, ...extra].some((name) => name && a.includes(name))) return 'private-app';
  const keywords = [...words(opts.sensitiveKeywords), ...DEFAULT_SENSITIVE_KEYWORDS.map((word) => word.toLowerCase())];
  if (t && keywords.some((word) => word && t.includes(word))) return 'sensitive-title';
  return null;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b1[3-9]\d{9}\b/g,
  /\b\d{16,19}\b/g,
];

/** Redact sensitive words and obvious secrets from a description before it becomes an event. */
export function redactSensitive(text: string, sensitiveKeywords: string): string {
  let out = text;
  for (const word of words(sensitiveKeywords)) {
    if (!word) continue;
    out = out.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[已过滤]');
  }
  for (const word of DEFAULT_SENSITIVE_KEYWORDS) {
    out = out.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[已过滤]');
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[已过滤]');
  return out.replace(/\[已过滤\](?:\s*\[已过滤\])+/g, '[已过滤]').trim() || '[已过滤]';
}

/** True for loopback and private-network endpoints; a cloud URL must be allowed explicitly. */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost')) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    const match = /^172\.(\d{1,3})\./.exec(host);
    if (match) {
      const second = Number(match[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}
export type SafetyLabel = 'nsfw' | 'filter' | null;

/** The vision model may answer with just [nsfw] / [filter]; keep only the mark, never the details. */
export function captionSafety(text: string): { label: SafetyLabel; text: string } {
  const value = text.trim();
  if (/\[?\s*nsfw\s*\]?/i.test(value)) return { label: 'nsfw', text: '[nsfw]' };
  if (/\[?\s*filter\s*\]?/i.test(value)) return { label: 'filter', text: '[filter]' };
  return { label: null, text: value };
}