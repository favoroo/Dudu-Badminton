// ============================================================
// 「调整位置」编辑器顶栏的行布局 —— 零 cc 依赖,所以能在 node 下回归(tools/strip-check.ts)。
//
// 为什么要单独成文件:这一栏要在 760 宽里塞下 名称 / 大小滑杆 / 透明度 / 透明度滑杆 /
// 重置默认 / 完成 六件事。上一版是各写各的绝对 x,结果两颗按钮(37..187、205..355)
// 正好把「透明度」标签(40..120)和透明度滑杆(154..334)整个压在底下 —— 滑杆先建、
// 按钮后建,兄弟序高的盖低的,于是那一栏看上去只有两颗按钮,用户直接反馈「没看到透明度滑杆」。
// 手调数字错一次就是这样:改成一条游标累加的行,宽度算给它、位置也从它读,
// 谁溢出/谁压住谁由 strip-check 断言,不再靠肉眼在 760 里挪像素。
//
// 依赖纪律:只 import ./text-metrics(同样零 cc),不 import cc —— 否则 node 下跑不了。
// ============================================================
import { textW } from "./text-metrics";

export type StripKey = "name" | "size" | "alphaName" | "alpha" | "reset" | "done";
export type StripKind = "label" | "slider" | "button";

export interface StripItem {
  key: StripKey;
  kind: StripKind;
  /** 屏上实际文案(面板照它建 Label / Button,文案与宽度不会各说各话) */
  text: string;
  fontSize: number;
  /** 相对整行中心的左缘;row 整体居中于面板 */
  left: number;
  w: number;
  right: number;
  center: number;
}

export interface StripLayout {
  items: StripItem[];
  rowW: number;
  panelW: number;
  /** 最窄可视屏(16:9 = 960)下,整行左右各还剩多少 */
  margin: number;
}

/** 顶栏面板宽 = settings-panel.PW;行内两侧各留 18 */
export const STRIP_PANEL_W = 760;
export const STRIP_SIDE_PAD = 18;
export const STRIP_GAP = 12;

/**
 * 各件占宽。滑杆给 160 是下限而不是审美:轨道本身只有 14 高,手指点的是 34 高的触摸区,
 * 再窄就变成「拖半天挪不了两档」。透明度 0.2~1.0 按 0.05 一档,160 宽 = 每档 8px,够分。
 */
const W_NAME = 44;
const W_ALPHA_NAME = 52;
const W_SLIDER = 160;
const W_RESET = 120;
const W_DONE = 100;

const FONT_LABEL = 14;
const FONT_RESET = 15;
const FONT_DONE = 16;

/** 按钮文字两侧各要留的下限(padding + 阴影),低于它就是「字压到边框」 */
export const BTN_TEXT_PAD = 24;

/**
 * 排一行:名称 → 大小滑杆 → 透明度 → 透明度滑杆 → 重置默认 → 完成。
 * @param modeName 当前选中槽位的名称标签(摇杆 / 滑轨 / 大小)
 */
export function stripLayout(modeName: string): StripLayout {
  const spec: Array<{ key: StripKey; kind: StripKind; text: string; fontSize: number; w: number }> = [
    { key: "name", kind: "label", text: modeName, fontSize: FONT_LABEL, w: W_NAME },
    { key: "size", kind: "slider", text: "", fontSize: 0, w: W_SLIDER },
    { key: "alphaName", kind: "label", text: "透明度", fontSize: FONT_LABEL, w: W_ALPHA_NAME },
    { key: "alpha", kind: "slider", text: "", fontSize: 0, w: W_SLIDER },
    { key: "reset", kind: "button", text: "重置默认", fontSize: FONT_RESET, w: W_RESET },
    { key: "done", kind: "button", text: "完成", fontSize: FONT_DONE, w: W_DONE },
  ];
  const rowW = spec.reduce((a, s) => a + s.w, 0) + STRIP_GAP * (spec.length - 1);
  let cur = -rowW / 2;
  const items: StripItem[] = spec.map((s) => {
    const it: StripItem = {
      key: s.key, kind: s.kind, text: s.text, fontSize: s.fontSize,
      left: cur, w: s.w, right: cur + s.w, center: cur + s.w / 2,
    };
    cur += s.w + STRIP_GAP;
    return it;
  });
  return {
    items, rowW, panelW: STRIP_PANEL_W,
    margin: STRIP_PANEL_W / 2 - STRIP_SIDE_PAD - rowW / 2,
  };
}

/** 取某一件的位置;写错 key 直接抛,不留「undefined 摆在 (0,0)」这种暗雷 */
export function stripAt(layout: StripLayout, key: StripKey): StripItem {
  const it = layout.items.find((i) => i.key === key);
  if (!it) throw new Error(`strip layout 里没有 ${key}`);
  return it;
}

/** 文案放不放得进自己的框(面板的 Label 是 Overflow.CLAMP,超了就是静默截字) */
export function stripTextOverflow(layout: StripLayout): string[] {
  const bad: string[] = [];
  for (const it of layout.items) {
    if (it.kind === "slider" || !it.text) continue;
    const need = textW(it.text, it.fontSize) + (it.kind === "button" ? BTN_TEXT_PAD : 0);
    if (need > it.w) bad.push(`${it.key}:「${it.text}」需 ${need} > 框宽 ${it.w}`);
  }
  return bad;
}

/** 两件是否压在彼此身上 —— 正是「透明度滑杆看不见」的判据 */
export function stripOverlaps(layout: StripLayout): string[] {
  const bad: string[] = [];
  for (let i = 0; i < layout.items.length; i++) {
    for (let j = i + 1; j < layout.items.length; j++) {
      const a = layout.items[i], b = layout.items[j];
      if (a.right > b.left + 0.5) bad.push(`${a.key}(${a.left}..${a.right}) 压住 ${b.key}(${b.left}..${b.right})`);
    }
  }
  return bad;
}
