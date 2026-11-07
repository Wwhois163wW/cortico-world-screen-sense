/** 窥屏助手 World 的定义：id、默认配置、构造与自描述。 */
import { describeTools, type WorldDefinition, type WorldDescribe } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
import type { ModelLanguage } from './model-text.ts';
import { SENSE_DEFAULTS, type SenseConfig } from './config.ts';
import { SCREEN_SENSE_ID, SCREEN_SENSE_TOOL_DECLS, ScreenSenseWorld } from './world.ts';

export interface ScreenSenseAssembly {
  /** The language the bot reads; Chinese when absent. */
  modelLanguage?: () => ModelLanguage;
  /** The app language; Chinese when absent. */
  language?: () => Language;
}

export type ScreenSenseConfigSection = SenseConfig;

const DESCRIBE: WorldDescribe = {
  tools: describeTools(
    SCREEN_SENSE_TOOL_DECLS.map(({ name, description, parameters, tags }) => ({
      name,
      description,
      parameters,
      tags,
    })),
    {
      screen_photo_list: { zh: '按时间列出相册里的屏幕截图与一句话描述。', en: 'Lists the screen album by time, with one-line descriptions.' },
      screen_photo_show: { zh: '从相册取回一张截图再看一眼,默认最近一张。', en: 'Fetches one screenshot from the album to look at again, the most recent by default.' },
      screen_sense_status: { zh: '报感知是否在运行，以及相册的截图与描述数量。', en: 'Reports whether sensing runs, and the album counts.' },
    },
  ),
  events: [
    {
      type: 'screen-sense.focus',
      description: { zh: '前台应用切换,已按停留时长与每小时上限筛过。', en: 'The foreground app changed, already filtered by dwell time and the hourly limit.' },
    },
    {
      type: 'screen-sense.screenshot',
      description: { zh: '辅助视觉对刚才那一句画面的一句话描述;原图留在相册。', en: 'One sentence the auxiliary vision model made of that look; the image stays in the album.' },
    },
  ],
};

export function screenSenseDefinition(assembly: ScreenSenseAssembly = {}): WorldDefinition<ScreenSenseConfigSection> {
  return {
    id: SCREEN_SENSE_ID,
    get label() {
      return assembly.language?.() === 'en' ? 'Screen sense' : '窥屏助手';
    },
    defaults: () => structuredClone(SENSE_DEFAULTS),
    create: (ctx) => new ScreenSenseWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
      captionApiKey: () => ctx.secret(ctx.cfg.caption.secretName),
      persist: (patch) => ctx.persist(patch as never),
      modelLanguage: () => assembly.modelLanguage?.() ?? 'zh',
      language: () => assembly.language?.() ?? 'zh',
    }),
    describe: DESCRIBE,
  };
}

export const SCREEN_SENSE = screenSenseDefinition();
