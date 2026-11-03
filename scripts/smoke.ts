/**
 * 真机冒烟：拉起采集引擎，读一次前台窗口，截一张图并打印尺寸。
 * 运行：pnpm run smoke
 */
import { CaptureClient, type ScreenInfo } from '../src/capture/index.ts';

const client = new CaptureClient({
  execArgv: () => ['--import', 'tsx'],
  timeoutText: () => 'screen capture timed out',
  exitedText: (code) => `screen capture engine exited (${code ?? 0})`,
});

try {
  const info = await client.request<ScreenInfo>({ op: 'info' });
  console.log('displays:', info.displays.length, '| foreground:', info.foregroundApp, '|', info.foreground);
  const shot = await client.request<{ width: number; height: number; jpeg: Uint8Array }>({
    op: 'screenshot', display: null, maxWidth: 640, maxHeight: 400, quality: 70,
  });
  console.log('screenshot:', `${shot.width}x${shot.height}`, '| jpeg bytes:', shot.jpeg.length);
} catch (err) {
  console.error('FAILED:', err);
  process.exitCode = 1;
} finally {
  client.stop();
}
