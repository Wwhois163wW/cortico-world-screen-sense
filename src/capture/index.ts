/** The capture engine this World carries: child process lifecycle plus request plumbing. */
export { CaptureClient, type CaptureClientOptions, type EngineLogger } from './client.ts';
export type {
  Answer, Button, ChildToMain, EngineRequest, InputResult, MainToChild,
  ScreenInfo, ScreenshotResult, Target, TypeResult, WindowEntry, Yield, ZoomResult,
} from './engine-ipc.ts';
export type { EngineErrorCode } from './engine/fail.ts';
export type { KeyCode } from './engine/keys.ts';
