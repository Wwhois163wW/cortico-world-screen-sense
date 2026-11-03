/** The screen album panel: thumbnails with time, app, title, one-line description, and the caption helper. */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { photoPanelText } from '../config.ts';
import './style.css';

interface Entry { id: string; at: number; app: string | null; title: string | null; caption: string | null }
interface State {
  enabled: boolean;
  captures: number;
  captions: number;
  captionEnabled: boolean;
  pollMs: number;
  lastCaptionAt: number | null;
  lastError: string | null;
}
interface DetectResult { ok: boolean; baseUrl: string; models?: Array<{ name: string }>; error?: string }
interface ApplyResult { ok: boolean; model?: string; error?: string }
interface TestResult { ok: boolean; ms?: number; caption?: string; error?: string; suggestion?: string | null }

const photosPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const t = photoPanelText(ctx.language);
    const urls: string[] = [];

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';

    const button = (label: string, danger = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:${danger ? 'rgba(200,60,60,.12)' : 'transparent'};color:inherit`;
      return b;
    };

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const count = document.createElement('span');
    count.style.cssText = 'opacity:.75;font-size:13px';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const refresh = button(t.refresh);
    const clear = button(t.clear, true);
    bar.append(count, spacer, refresh, clear);

    const assist = document.createElement('div');
    assist.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px';
    const captionState = document.createElement('span');
    captionState.style.cssText = 'opacity:.8';
    const detect = button(t.detect);
    const modelSelect = document.createElement('select');
    modelSelect.style.cssText = 'font:inherit;font-size:13px;padding:4px 8px;border-radius:6px;background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45);display:none';
    const useModel = button(t.useModel);
    useModel.style.display = 'none';
    const test = button(t.test);
    assist.append(captionState, spacer.cloneNode() as HTMLElement, detect, modelSelect, useModel, test);

    const notice = document.createElement('div');
    notice.style.cssText = 'font-size:12px;opacity:.8;min-height:16px;white-space:pre-wrap';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;align-content:start';

    const stamp = (at: number) => {
      try { return new Date(at).toLocaleString(ctx.language); } catch { return new Date(at).toISOString().slice(11, 16); }
    };

    const card = async (entry: Entry) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid rgba(128,128,128,.3);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:rgba(128,128,128,.06)';
      const img = document.createElement('img');
      img.alt = entry.title ?? entry.id;
      img.style.cssText = 'width:100%;display:block;background:rgba(0,0,0,.15);cursor:zoom-in;aspect-ratio:16/10;object-fit:contain';
      img.addEventListener('click', () => { if (img.src) window.open(img.src, '_blank'); });
      try {
        const blob = await ctx.invokeBinary('image', [entry.id]);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
      } catch {
        img.alt = t.failed;
      }
      const meta = document.createElement('div');
      meta.style.cssText = 'padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.4';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;opacity:.8';
      const time = document.createElement('span');
      time.textContent = stamp(entry.at);
      const app = document.createElement('span');
      app.textContent = entry.app ?? '?';
      app.style.cssText = 'font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%';
      head.append(time, app);
      const title = document.createElement('div');
      title.textContent = entry.title ?? '';
      title.style.cssText = 'opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const caption = document.createElement('div');
      caption.textContent = entry.caption ?? t.noCaption;
      meta.append(head, title, caption);
      box.append(img, meta);
      return box;
    };

    const stateLine = (state: State): string => {
      const parts = [
        t.total(state.captures),
        state.enabled ? t.running : t.off,
        state.captionEnabled ? t.captionOn : t.captionOff,
      ];
      if (state.lastError) parts.push(state.lastError);
      return parts.join(' · ');
    };

    const load = async () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      grid.replaceChildren();
      count.textContent = t.loading;
      try {
        const state = await ctx.invoke<State>('state');
        count.textContent = stateLine(state);
        captionState.textContent = state.captionEnabled ? t.captionOn : t.captionOff;
        const data = await ctx.invoke<{ total: number; entries: Entry[] }>('list', [{ limit: 24 }]);
        if (data.entries.length === 0) {
          const empty = document.createElement('div');
          empty.textContent = t.empty;
          empty.style.cssText = 'opacity:.7;font-size:13px';
          grid.append(empty);
          return;
        }
        for (const entry of data.entries) grid.append(await card(entry));
      } catch (err) {
        count.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    refresh.addEventListener('click', () => void load());
    clear.addEventListener('click', () => {
      if (!window.confirm(t.clearConfirm)) return;
      void (async () => {
        try {
          const out = await ctx.invoke<{ removed: number }>('clear', []);
          notice.textContent = t.cleared(out.removed);
          await load();
        } catch (err) {
          notice.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
        }
      })();
    });

    detect.addEventListener('click', () => {
      detect.disabled = true;
      notice.textContent = t.detecting;
      void (async () => {
        try {
          const result = await ctx.invoke<DetectResult>('detect');
          if (!result.ok) {
            notice.textContent = t.detectFailed(result.error ?? '');
            return;
          }
          if (!result.models || result.models.length === 0) {
            notice.textContent = t.noModels;
            return;
          }
          modelSelect.replaceChildren(...result.models.map((model) => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.name;
            return option;
          }));
          modelSelect.style.display = '';
          useModel.style.display = '';
          notice.textContent = `${result.baseUrl} · ${result.models.length} 个模型`;
          modelSelect.dataset.baseUrl = result.baseUrl;
        } catch (err) {
          notice.textContent = t.detectFailed(err instanceof Error ? err.message : String(err));
        } finally {
          detect.disabled = false;
        }
      })();
    });

    useModel.addEventListener('click', () => {
      const model = modelSelect.value;
      const baseUrl = modelSelect.dataset.baseUrl ?? '';
      if (!model) return;
      useModel.disabled = true;
      void (async () => {
        try {
          const result = await ctx.invoke<ApplyResult>('apply', [{ protocol: 'ollama', baseUrl, model }]);
          notice.textContent = result.ok ? t.applied(result.model ?? model) : (result.error ?? '');
          await load();
        } catch (err) {
          notice.textContent = err instanceof Error ? err.message : String(err);
        } finally {
          useModel.disabled = false;
        }
      })();
    });

    test.addEventListener('click', () => {
      test.disabled = true;
      notice.textContent = t.testing;
      void (async () => {
        try {
          const result = await ctx.invoke<TestResult>('test');
          if (result.ok) notice.textContent = t.testOk(result.ms ?? 0, result.caption ?? '');
          else notice.textContent = [t.testFailed(result.error ?? ''), result.suggestion ? t.suggestion(result.suggestion) : ''].filter(Boolean).join('\n');
        } catch (err) {
          notice.textContent = t.testFailed(err instanceof Error ? err.message : String(err));
        } finally {
          test.disabled = false;
        }
      })();
    });

    root.append(bar, assist, notice, grid);
    ctx.root.append(root);
    void load();
    return {
      dispose() {
        for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      },
    };
  },
};

const bundle: WebUiClientBundle = { panels: { photos: photosPanel } };
export default bundle;
