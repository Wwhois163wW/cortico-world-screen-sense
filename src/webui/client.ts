/** The screen album panel: thumbnails with time, app, title, one-line description, and the sensing state. */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { photoPanelText } from '../config.ts';
import './style.css';

interface Entry { id: string; at: number; app: string | null; title: string | null; caption: string | null }
interface State { enabled: boolean; captures: number; captions: number; intervalMinutes: number }

const photosPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const t = photoPanelText(ctx.language);
    const urls: string[] = [];

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const count = document.createElement('span');
    count.style.cssText = 'opacity:.75;font-size:13px';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const button = (label: string, danger = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:${danger ? 'rgba(200,60,60,.12)' : 'transparent'};color:inherit`;
      return b;
    };
    const refresh = button(t.refresh);
    const clear = button(t.clear, true);
    bar.append(count, spacer, refresh, clear);

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

    const load = async () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      grid.replaceChildren();
      count.textContent = t.loading;
      try {
        const state = await ctx.invoke<State>('state');
        const label = `${t.total(state.captures)} · ${state.enabled ? t.running : t.off}`;
        count.textContent = label;
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
          count.textContent = t.cleared(out.removed);
          await load();
        } catch (err) {
          count.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
        }
      })();
    });
    root.append(bar, grid);
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
