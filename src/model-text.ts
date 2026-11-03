/** 这个 World 让模型读到的文本：事件正文与工具回执，中英各一份。 */
import type { AlbumEntry } from './album.ts';

const zh = {
  focus: (app: string, title: string | null, seconds: number) =>
    `[focus] 前台切到 ${app}${title ? `(窗口:${title})` : ''};上一个应用在前台 ${seconds} 秒。`,
  screenshot: (app: string, title: string | null, caption: string) =>
    `[screen] 你刚看了一眼屏幕(${app}${title ? `,${title}` : ''}):${caption}`,
  photoEmpty: '相册里还没有截图。',
  photoListHead: (n: number) => `[photo] 相册里最近的 ${n} 张:`,
  photoLine: (entry: AlbumEntry, clock: string) =>
    `${entry.id} ${clock} ${entry.app ?? '?'}${entry.title ? `(${entry.title})` : ''}:${entry.caption ?? '(还没描述)'}`,
  photoMissing: (id: string) => `相册里没有${id ? ` ${id}` : '这张'};可能已被清除,或被保留张数淘汰。`,
  photoShown: (entry: AlbumEntry, clock: string) =>
    `[photo] ${entry.id} ${clock} ${entry.app ?? '?'}${entry.title ? `(${entry.title})` : ''}:${entry.caption ?? '(还没描述)'};原图见附件。`,
  status: (running: boolean, captures: number, captions: number) =>
    running
      ? `[sense] 感知运行中;相册 ${captures} 张,已描述 ${captions} 张。`
      : '[sense] 感知关着。',
};

const en: typeof zh = {
  focus: (app, title, seconds) =>
    `[focus] The foreground switched to ${app}${title ? ` (window: ${title})` : ''}; the previous app had been in front for ${seconds} s.`,
  screenshot: (app, title, caption) =>
    `[screen] You just looked at the screen (${app}${title ? `, ${title}` : ''}): ${caption}`,
  photoEmpty: 'The album has no screenshots yet.',
  photoListHead: (n) => `[photo] The ${n} most recent screenshots in the album:`,
  photoLine: (entry, clock) =>
    `${entry.id} ${clock} ${entry.app ?? '?'}${entry.title ? ` (${entry.title})` : ''}: ${entry.caption ?? '(no description yet)'}`,
  photoMissing: (id) => `The album has no ${id || 'such screenshot'}; it may have been cleared or dropped past the kept count.`,
  photoShown: (entry, clock) =>
    `[photo] ${entry.id} ${clock} ${entry.app ?? '?'}${entry.title ? ` (${entry.title})` : ''}: ${entry.caption ?? '(no description yet)'}; the image is attached.`,
  status: (running, captures, captions) =>
    running
      ? `[sense] Sensing is running; ${captures} screenshots in the album, ${captions} described.`
      : '[sense] Sensing is off.',
};

export type ModelLanguage = 'zh' | 'en';
export type ModelText = typeof zh;
export const MODEL_TEXT: Record<ModelLanguage, ModelText> = { zh, en };
