import { describe, expect, it } from 'vitest';
import { FocusGate, ignoreList, type FocusGateOptions } from '../src/focus.ts';

const base: FocusGateOptions = { dwellMs: 8000, maxWakesPerHour: 3, followTitle: false, ignoreApps: [] };
const gate = (over: Partial<FocusGateOptions> = {}) => new FocusGate({ ...base, ...over });
const other = { app: 'Code.exe', title: 'a.ts' };

describe('FocusGate', () => {
  it('第一个采样只建立基线,不返回切换', () => {
    expect(gate().observe(other, 0)).toBeNull();
  });

  it('新应用待够停留时长才返回切换,并带上一个应用停留了多久', () => {
    const g = gate();
    g.observe(other, 0);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 1000)).toBeNull();
    const wake = g.observe({ app: 'chrome.exe', title: 'docs' }, 10_000);
    expect(wake).toEqual({ app: 'chrome.exe', title: 'docs', previousApp: 'Code.exe', previousMs: 1000 });
  });

  it('停留时长内切回去不算一次切换', () => {
    const g = gate();
    g.observe(other, 0);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 1000)).toBeNull();
    expect(g.observe(other, 2000)).toBeNull();
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 3000)).toBeNull();
    expect(g.countInHour(3000)).toBe(0);
  });

  it('只换标题不算切换,除非打开标题跟随', () => {
    const g = gate();
    g.observe(other, 0);
    expect(g.observe({ app: 'Code.exe', title: 'b.ts' }, 1000)).toBeNull();
    expect(g.observe({ app: 'Code.exe', title: 'b.ts' }, 20_000)).toBeNull();

    const t = gate({ followTitle: true });
    t.observe(other, 0);
    t.observe({ app: 'Code.exe', title: 'b.ts' }, 1000);
    expect(t.observe({ app: 'Code.exe', title: 'b.ts' }, 20_000)).toMatchObject({ app: 'Code.exe', title: 'b.ts' });
  });

  it('忽略名单里的应用不产生切换,但仍更新基线', () => {
    const g = gate({ ignoreApps: ['keepass.exe'] });
    g.observe(other, 0);
    expect(g.observe({ app: 'KeePass.exe', title: 'vault' }, 1000)).toBeNull();
    expect(g.observe({ app: 'KeePass.exe', title: 'vault' }, 20_000)).toBeNull();
    g.observe({ app: 'chrome.exe', title: 'docs' }, 21_000);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 30_000))
      .toMatchObject({ previousApp: 'KeePass.exe', previousMs: 20_000 });
  });

  it('每小时上限之外的切换直接丢掉', () => {
    const g = gate({ maxWakesPerHour: 1 });
    g.observe(other, 0);
    g.observe({ app: 'a.exe', title: null }, 1000);
    expect(g.observe({ app: 'a.exe', title: null }, 10_000)).not.toBeNull();
    g.observe({ app: 'b.exe', title: null }, 20_000);
    expect(g.observe({ app: 'b.exe', title: null }, 30_000)).toBeNull();
    expect(g.countInHour(30_000)).toBe(1);
    g.observe({ app: 'c.exe', title: null }, 3_700_000);
    expect(g.observe({ app: 'c.exe', title: null }, 3_710_000)).not.toBeNull();
  });

  it('取不到前台应用时只清掉待定项', () => {
    const g = gate();
    g.observe(other, 0);
    g.observe({ app: 'chrome.exe', title: 'docs' }, 1000);
    expect(g.observe({ app: null, title: null }, 2000)).toBeNull();
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 3000)).toBeNull();
    expect(g.countInHour(3000)).toBe(0);
  });

  it('停留时长 0 时,第一次看到新应用就返回', () => {
    const g = gate({ dwellMs: 0 });
    g.observe(other, 0);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 1000)).toMatchObject({ app: 'chrome.exe', previousMs: 1000 });
  });

  it('忽略名单解析:去空白、去空项', () => {
    expect(ignoreList(' a.exe, ,B.Exe ')).toEqual(['a.exe', 'B.Exe']);
  });

  it('settle 只重设基线,不返回切换也不计入上限', () => {
    const g = gate();
    g.observe(other, 0);
    g.settle({ app: 'chrome.exe', title: 'docs' }, 1000);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 5000)).toBeNull();
    expect(g.countInHour(5000)).toBe(0);
    g.observe({ app: 'slack.exe', title: null }, 6000);
    expect(g.observe({ app: 'slack.exe', title: null }, 15_000)).toMatchObject({ previousApp: 'chrome.exe' });
  });

  it('settle 拿不到前台应用时什么都不改', () => {
    const g = gate();
    g.observe(other, 0);
    g.settle({ app: null, title: null }, 1000);
    g.observe({ app: 'chrome.exe', title: 'docs' }, 2000);
    expect(g.observe({ app: 'chrome.exe', title: 'docs' }, 10_000)).toMatchObject({ previousApp: 'Code.exe' });
  });
});
