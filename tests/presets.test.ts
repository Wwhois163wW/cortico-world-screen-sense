import { describe, expect, it } from 'vitest';
import { OLLAMA_BASE, captionPatch, normalizeBaseUrl, normalizeModel, suggestModel } from '../src/presets.ts';

describe('normalizeBaseUrl', () => {
  it('trims and drops trailing slashes', () => {
    expect(normalizeBaseUrl('  http://localhost:11434/  ')).toBe(OLLAMA_BASE);
    expect(normalizeBaseUrl('http://localhost:11434//')).toBe(OLLAMA_BASE);
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });
});

describe('normalizeModel', () => {
  it('trims surrounding space', () => {
    expect(normalizeModel('  gemma4:e2b ')).toBe('gemma4:e2b');
  });
});

describe('suggestModel', () => {
  it('points out a model that differs only in separators or case', () => {
    expect(suggestModel('gemma4e2b', ['gemma4:e2b', 'qwen2.5vl:7b'])).toBe('gemma4:e2b');
    expect(suggestModel('Gemma4:E2B', ['gemma4:e2b'])).toBe('gemma4:e2b');
  });

  it('returns null when the name matches or nothing is close', () => {
    expect(suggestModel('gemma4:e2b', ['gemma4:e2b'])).toBeNull();
    expect(suggestModel('gemma4e2b', ['qwen2.5vl:7b'])).toBeNull();
    expect(suggestModel('', ['gemma4:e2b'])).toBeNull();
  });
});

describe('captionPatch', () => {
  it('writes normalized caption fields and enables descriptions by default', () => {
    expect(captionPatch({ protocol: 'ollama', baseUrl: 'http://localhost:11434/', model: ' gemma4:e2b ' })).toEqual({
      caption: { enabled: true, protocol: 'ollama', baseUrl: OLLAMA_BASE, model: 'gemma4:e2b' },
    });
  });

  it('keeps an explicit enabled=false', () => {
    expect(captionPatch({ protocol: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm', enabled: false })).toEqual({
      caption: { enabled: false, protocol: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm' },
    });
  });
});
