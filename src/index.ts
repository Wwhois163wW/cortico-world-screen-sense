/** Package entry: the default export is the `WorldDefinition`. */
import { SCREEN_SENSE } from './definition.ts';

export default SCREEN_SENSE;
export { SCREEN_SENSE, screenSenseDefinition, type ScreenSenseAssembly, type ScreenSenseConfigSection } from './definition.ts';
export { ScreenSenseWorld, SCREEN_SENSE_ID } from './world.ts';
export { SENSE_DEFAULTS, senseConfigGroup, photoPanelText, type SenseConfig } from './config.ts';
export { ScreenAlbum } from './album.ts';
export { FocusGate, ignoreList, type FocusGateOptions, type FocusSample, type FocusWake } from './focus.ts';
export { CaptionClient, CaptionPace, promptInLanguage } from './caption.ts';
export type { ModelLanguage, ModelText } from './model-text.ts';
