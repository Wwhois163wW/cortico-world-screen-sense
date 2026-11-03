/**
 * One-click description presets: normalize hand-typed values and point out a model name that differs
 * only in separators or case (`gemma4e2b` → `gemma4:e2b`), the typo that makes Ollama answer 404.
 */

export const OLLAMA_BASE = 'http://localhost:11434';

/** Trim and drop trailing slashes; `/` alone stays empty. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function normalizeModel(raw: string): string {
  return raw.trim();
}

/** The model in `models` that is the same once separators and case are ignored; null when none differs from `input`. */
export function suggestModel(input: string, models: readonly string[]): string | null {
  const key = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = key(input);
  if (!want) return null;
  const hit = models.find((model) => key(model) === want);
  return hit && hit !== input ? hit : null;
}

export interface CaptionPreset {
  protocol: 'openai' | 'ollama';
  baseUrl: string;
  model: string;
  enabled?: boolean;
}

/** The config patch a preset writes, relative to `worlds.screen-sense`. */
export function captionPatch(input: CaptionPreset): { caption: Record<string, unknown> } {
  return {
    caption: {
      enabled: input.enabled ?? true,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: normalizeModel(input.model),
    },
  };
}
