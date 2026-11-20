import { describe, expect, it } from 'vitest';
import { DEFAULT_SENSITIVE_KEYWORDS, isLocalEndpoint, redactSensitive, sensitiveContext } from '../src/privacy.ts';

const opts = { ignoreApps: '', sensitiveKeywords: '' };

describe('sensitiveContext', () => {
  it('skips private apps and their titles', () => {
    expect(sensitiveContext('WeChat.exe', 'chat', opts)).toBe('private-app');
    expect(sensitiveContext('Code.exe', '银行转账', opts)).toBe('sensitive-title');
    expect(sensitiveContext('Code.exe', 'main.ts', opts)).toBeNull();
  });

  it('honours extra ignored apps and keywords', () => {
    expect(sensitiveContext('Notes.exe', 'x', { ignoreApps: 'notes', sensitiveKeywords: '' })).toBe('private-app');
    expect(sensitiveContext('Code.exe', 'internal', { ignoreApps: '', sensitiveKeywords: 'internal' })).toBe('sensitive-title');
  });

  it('ships a non-empty default keyword list', () => {
    expect(DEFAULT_SENSITIVE_KEYWORDS).toContain('password');
    expect(DEFAULT_SENSITIVE_KEYWORDS).toContain('银行');
  });
});

describe('redactSensitive', () => {
  it('redacts sensitive words and secrets', () => {
    const out = redactSensitive('页面显示密码 hunter2 和 user@example.com 与 sk-abcdefghijklmnop', '');
    expect(out).toContain('[已过滤]');
    expect(out).not.toContain('password');
    expect(out).not.toContain('user@example.com');
    expect(out).not.toContain('sk-abcdefghijklmnop');
  });

  it('never returns an empty description', () => {
    expect(redactSensitive('密码', '')).toBe('[已过滤]');
  });
});

describe('isLocalEndpoint', () => {
  it('accepts localhost and private addresses', () => {
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1:8080/v1')).toBe(true);
    expect(isLocalEndpoint('http://192.168.1.5:8080')).toBe(true);
    expect(isLocalEndpoint('http://172.20.0.2:1234')).toBe(true);
  });

  it('rejects public endpoints and malformed addresses', () => {
    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://example.com')).toBe(false);
    expect(isLocalEndpoint('')).toBe(false);
  });
});
