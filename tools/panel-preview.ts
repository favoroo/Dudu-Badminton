// ============================================================
// P5 面板语法出图 —— 在 node 里把「新底板 / 新色块 / 新开关 / 新滑杆」画成 SVG,
// 再用 headless Chrome 光栅化,肉眼判一眼风格。
//
// 为什么需要它:这一轮赌注是**观感**,而断言只能证明「不压字、不出框、对比够」,
// 证明不了「这像不像 P5」。项目里编辑器自动化封闭(AGENTS.md 坑 1)、Cocos 构建产物
// 在内置浏览器永久 hang(坑 2),所以风格必须在 node 里先看见一次再往四个面板铺。
//
// 与 brief-preview 的关键差别:**不重抄配色与形状**。
// brief-preview 是「同形不同源」(把面板的配色版式在工具里再抄一遍),那份图只能证明
// 排版算得对,证明不了面板真长这样。这里直接 import p5-shapes(零 cc 点列)+ p5-paint
// (只用 cc 的 Color/Graphics,恰好是 cc-stub 桩得住的两个类)——
// 出的图与真机上画的是**同一批多边形**,风格错了在这张图上就错。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/panel-preview.js --out .tools-build/panel-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --screenshot=.tools-build/panel-preview/panels.png \
//     --window-size=1400,1180 --default-background-color=00000000 \
//     file://$PWD/.tools-build/panel-preview/panels.svg
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import type { CardOpts, Paint } from "../assets/scripts/ui/p5-shapes";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { C, ROLE, SLANT, inkFor } from "../assets/scripts/ui/p5-tokens";
import { CFG, RARITY_META } from "../assets/scripts/core/config";
import { textW } from "../assets/scripts/core/text-metrics";
import { APP_VERSION_NAME } from "../assets/scripts/core/version";
import { ASSIST_COPY, ASSIST_COPY_SIZE, assistLayout, SET, aboutLayout, controlLayout, donePos, mediaLayout, MODE_TIP_SIZE, MOVE_MODES, SETTINGS_TABS, tabBoxes } from "../assets/scripts/ui/settings-layout";
import { padDiagramDL } from "../assets/scripts/ui/pad-diagram";
import {
  cardRow, cardRows, CMP, resumeRow as cmpResume, tabRow as campTabRow,
} from "../assets/scripts/ui/campaign-layout";
import { cardBoxes as drillCardBoxes, DRILL } from "../assets/scripts/ui/drill-layout";
import { accBandH, accShelf, accSlotRowCounts, accSlotRows, cardFxLines, cardFxYs, cardLine, CARD_TEXT, gridCols as shopGridCols, rowTopY, SHELF, SHOP, shopContent, shopStats, shopTabs, shopTopBar, STAT, statCardDL, statCells, TOAST, toastBox, toastWidth } from "../assets/scripts/ui/shop-shelf";
import { CONFIRM_PAD_RESET, layoutConfirm } from "../assets/scripts/ui/confirm-layout";
import type { Profile } from "../assets/scripts/core/career";
import { Career } from "../assets/scripts/core/career";
import { milestoneViews } from "../assets/scripts/core/milestone";
import {
  drawBevelSlot, drawHalftone, drawIconBtn, drawP5Block, drawP5Card, drawPosterPlate, drawRankBadge,
  drawSliderFace, drawStarGlyph, drawToggleFace, paintP5, progressDL, sliderDL,
} from "../assets/scripts/ui/p5-paint";
import { chipDL, chipHeight, chipWidth } from "../assets/scripts/ui/p5-shapes";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const SHEET_W = 1360, SHEET_H = 1140;

/** 顶栏五格的标签(2026-10-06 拆件重构:逐槽搭配的「形象」放第一格,打包买的「套装」次之;
 *  「面部皮肤」并入形象页的 chip)。长度必须与 shop-shelf 算出来的格数一致 ——
 *  这里以前把六个名字抄在三处,改一处漏两处。 */
const SHOP_TABS = ["形象", "套装", "球拍皮肤", "羽毛球皮肤", "生涯战绩"];
/** 各出图页高亮哪一格(顺序变了要跟着改,别按记忆写数字) */
const TAB_LOOK = 0, TAB_SET = 1, TAB_STATS = 4;
if (SHOP_TABS.length !== SHOP.tabs.n) {
  throw new Error(`出图标签 ${SHOP_TABS.length} 个 ≠ SHOP.tabs.n = ${SHOP.tabs.n},顶栏会少画/多画一格`);
}
/** 一个"什么都没买"的档案起点(各表第一项 price 0 = 默认拥有) */
const BASE_DEFAULTS = (["player", "racket", "shuttle", "face"] as const).map((k) => CFG.skins[k][0].id);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 一块底:建一个记录型 Graphics,画完转成 SVG 片段(局部 y 向上 → SVG y 向下) */
function shape(cx: number, cy: number, draw: (g: Graphics) => void): string {
  const g = new StubGraphics();
  draw(g as unknown as Graphics);
  return `<g transform="translate(${r2(cx)},${r2(cy)}) scale(1,-1)">${opsToSvg(g.ops)}</g>`;
}

/** 一行字(中心锚或左/右锚;SVG 的 y 向下,所以直接给屏幕 y) */
function txt(x: number, y: number, s: string, size: number, hex: string, opts: { anchor?: "start" | "middle" | "end"; bold?: boolean } = {}): string {
  const weight = opts.bold ? " font-weight=\"700\"" : "";
  return `<text x="${r2(x)}" y="${r2(y)}" fill="${hex}" font-size="${size}"${weight} font-family=${JSON.stringify(FONT)} text-anchor="${opts.anchor ?? "middle"}" dominant-baseline="middle">${esc(s)}</text>`;
}

/** 小标题注记:标在样张左上,方便对着代码找 */
function tag(x: number, y: number, s: string): string {
  return txt(x, y, s, 11, "#7e8bb0", { anchor: "start" });
}

// ============================================================
// ① 语法样张:一层一块,标着名字
// ============================================================

function primitivesSheet(): string {
  const out: string[] = [];
  let y = 74;
  out.push(txt(SHEET_W / 2, 34, "P5 面板语法 · 样张(与真机同一批多边形)", 20, C.paper, { bold: true }));

  // L1 衬纸
  const plateW = 420, plateH = 150;
  out.push(shape(40 + plateW / 2, y + plateH / 2, (g) => drawPosterPlate(g, plateW, plateH, { bandHex: C.slash, halftone: true })));
  out.push(tag(40, y - 4, "L1 衬纸 drawPosterPlate:斜切硬阴影 → 错位红副衬 → 墨面 → 平直下缘 → 网点"));
  y += plateH + 34;

  // L3 四种角色色块
  const roles: Array<keyof typeof ROLE> = ["primary", "star", "drill", "info", "record", "off"];
  const bw = 150, bh = 62, gap = 18;
  roles.forEach((rk, i) => {
    const x = 40 + i * (bw + gap);
    const face = ROLE[rk].face;
    out.push(shape(x + bw / 2, y + bh / 2, (g) => drawP5Block(g, bw, bh, face, SLANT.block)));
    out.push(txt(x + bw / 2, y + bh / 2, rk.toUpperCase(), 15, inkFor(face), { bold: true }));
  });
  out.push(tag(40, y - 12, "L3 实底大色块 drawP5Block:色占满整面,字色由 inkFor(面色) 算,不手拍"));
  y += bh + 40;

  // 卡片:墨面 + 一条 accent 色带(一屏十几张的表面用它,别整面实底)
  const cardW = 150, cardH = 132;
  const cards: Array<[string, CardOpts]> = [
    ["已通关", {}],
    ["下一关", { glow: true }],
    ["可挑战", {}],
    ["已锁定", { locked: true, teeth: 0 }],
  ];
  cards.forEach(([nm, o], i) => {
    const x = 40 + i * (cardW + 18);
    const acc = [ROLE.record.face, ROLE.star.face, ROLE.info.face, C.line][i];
    out.push(shape(x + cardW / 2, y + cardH / 2, (g) => drawP5Card(g, cardW, cardH, acc, o)));
    out.push(txt(x + cardW / 2, y + 20, `STAGE 0${i + 1}`, 10, o.locked ? C.dimDeep : acc, { bold: true }));
    out.push(txt(x + cardW / 2, y + 58, "烈日刺目", 15, o.locked ? C.dimDeep : C.paper, { bold: true }));
    out.push(txt(x + cardW / 2, y + 82, "抢 7 分", 11, o.locked ? C.dimDeep : C.paperDim));
    out.push(txt(x + cardW / 2, y + cardH - 12, nm, 10, C.dim));
  });
  out.push(tag(40, y - 12, "卡片 drawP5Card:墨面 + 顶部一条 accent 色带 + 同色 keyline —— 大色块留给少数大面,卡片色只占一条带"));
  y += cardH + 34;

  // L2 分区色带 + L3′ 凹陷槽
  out.push(shape(40 + 110, y + 13, (g) => drawP5Block(g, 220, 26, ROLE.info.face, SLANT.band)));
  out.push(txt(40 + 110 - 100 + 10, y + 13, "声音与震动", 14, inkFor(ROLE.info.face), { anchor: "start", bold: true }));
  out.push(shape(40 + 330 + 110, y + 13, (g) => drawBevelSlot(g, 330, 26, SLANT.block)));
  out.push(tag(40, y - 12, "L2 分区色带(10°)  ·  L3′ 凹陷槽 drawBevelSlot:上缘压暗下缘接光,故意不描边"));
  y += 26 + 40;

  // tab 两态
  const tabW = 176, tabH = SLANT ? 44 : 44;
  out.push(shape(40 + tabW / 2, y + tabH / 2, (g) => drawP5Block(g, tabW, tabH, ROLE.primary.face, SLANT.block)));
  out.push(txt(40 + tabW / 2, y + tabH / 2, "操控", 15, inkFor(ROLE.primary.face), { bold: true }));
  out.push(shape(40 + tabW + 16 + tabW / 2, y + tabH / 2, (g) => drawBevelSlot(g, tabW, tabH, SLANT.block)));
  out.push(txt(40 + tabW + 16 + tabW / 2, y + tabH / 2, "声音画面", 15, C.dim));
  out.push(tag(40, y - 12, "tab 两态:选中=实底色块(凸) / 未选=凹陷槽(凹) —— 旧写法是圆角矩形 + 5% 白描边,1.1:1"));
  y += tabH + 40;

  // 开关两态
  const tgW = 260, tgH = 44;
  out.push(shape(40 + tgW / 2, y + tgH / 2, (g) => drawToggleFace(g, tgW, tgH, true, ROLE.star.face)));
  out.push(txt(40 + 14, y + tgH / 2, "音效", 15, inkFor(ROLE.star.face), { anchor: "start", bold: true }));
  out.push(txt(40 + tgW - 8, y + tgH / 2, "开", 13, inkFor(ROLE.star.face), { anchor: "end" }));
  const y2 = y + tgH + 14;
  out.push(shape(40 + tgW / 2, y2 + tgH / 2, (g) => drawToggleFace(g, tgW, tgH, false, ROLE.star.face)));
  out.push(txt(40 + 14, y2 + tgH / 2, "音乐", 15, C.dim, { anchor: "start" }));
  out.push(txt(40 + tgW - 8, y2 + tgH / 2, "关", 13, C.dim, { anchor: "end" }));
  out.push(tag(40, y - 12, "开关整行:开=实底色块 + 墨字,关=凹陷槽 + dim 字;右端斜纹是记号,状态另有「开/关」读数"));
  y = y2 + tgH + 40;

  // 滑杆三档
  const slW = 300;
  [0.25, 0.6, 1].forEach((t, i) => {
    const yy = y + i * 40;
    out.push(shape(40 + slW / 2, yy + 20, (g) => drawSliderFace(g, sliderDL(slW, 14, t, ROLE.star.face, 5))));
    out.push(txt(40 + slW + 16, yy + 20, `${Math.round(t * 100)}%`, 13, C.paperDim, { anchor: "start" }));
  });
  out.push(tag(40, y - 6, "滑杆:凹陷槽轨道 + 同斜率实底填充 + 斜切方块旋钮 + 刻度(旧:玻璃胶囊 + 白实心圆)"));
  y += 3 * 40 + 30;

  // 印章件
  const iy = y + 22;
  out.push(shape(60, iy, (g) => { drawStarGlyph(g, 0, 0, 13, true, ROLE.star.face); drawStarGlyph(g, 30, 0, 13, true, ROLE.star.face); drawStarGlyph(g, 60, 0, 13, false, C.dim); }));
  out.push(txt(150, iy, "← 四尖星等级(实/实/空),替掉 ★☆ 文本与三个光滑圆点", 12, "#7e8bb0", { anchor: "start" }));
  out.push(shape(560, iy, (g) => {
    drawRankBadge(g, "lock", 26, C.dimDeep, -60, 0);
    drawRankBadge(g, "next", 26, ROLE.star.face, 0, 0);
    drawRankBadge(g, "best", 26, ROLE.star.face, 60, 0);
    drawRankBadge(g, "own", 26, ROLE.drill.face, 120, 0);
  }));
  out.push(txt(700, iy, "← 状态印章 lock / next / best / own(全 Graphics:原生无彩色 emoji 字体,🔒 会变方框)", 12, "#7e8bb0", { anchor: "start" }));
  y += 60;

  // 图标按钮:实底斜方纯色块(关闭 ✕ 等小键)—— P5 斩劈红纯色块 + 厚底边 + 硬阴影 + 纯白 ✕
  const ibS = 40, ibY = y + 20;
  const ibRow: Array<[string, string, string]> = [
    ["primary.face(关闭键实底纯色块)", ROLE.primary.face, ROLE.primary.edge],
    ["primary.dk(旧暗色对照)", ROLE.primary.dk, ROLE.primary.edge],
    ["off(中性对照)", C.navy2, C.line],
  ];
  ibRow.forEach(([nm, face, edge], i) => {
    const x = 40 + i * 250;
    out.push(shape(x + ibS / 2, ibY, (g) => drawIconBtn(g, ibS, face, edge)));
    out.push(txt(x + ibS / 2, ibY, "✕", 15, C.paper, { bold: true }));
    out.push(tag(x, ibY + 38, nm));
  });
  out.push(tag(40, y - 12, "图标按钮 iconBtnDL:实底纯色块 = block 配方小件版(斩劈红实底/厚底边/主面/顶缘高光/提亮描边),斜切吃 SLANT.button 档"));
  return out.join("\n");
}

// ============================================================
// ② 四块面板的拼装示意(用真尺寸摆,判「铺满一屏还像不像 P5」)
// ============================================================

/**
 * 四块面板拼装 —— **一律 1:1**,不吃缩放。
 *
 * 为什么:上一版把坐标按 0.67 缩进格位,但 shape() 里没有 scale 变换,于是衬纸按 1:1 画、
 * 内容按缩小坐标摆 —— 每张图都在溢出格位,而溢出的是**出图工具**不是面板,看着像 bug 却不是。
 * 1:1 还顺带多给一层保证:这张图上的字号与间距就是真机上那套数。
 *
 * 坐标全部来自各面板的 layout 纯函数(settings-layout / campaign-layout / drill-layout /
 * shop-shelf.SHOP)—— 这一格证明的是「那套算术摆得开」,不是我另摆一遍。
 */
function cell(px: number, py: number, pw: number, ph: number, bandHex: string, title: string, teeth = 0): {
  X: (v: number) => number; Y: (v: number) => number; cx: number; cy: number; head: string;
} {
  const cx = px + pw / 2, cy = py + ph / 2 + 20;
  const X = (v: number): number => cx + v;
  const Y = (v: number): number => cy - v;         // cc 的 y 向上 → SVG 向下
  const head = shape(cx, cy, (g) => drawPosterPlate(g, pw, ph, { bandHex, teeth, halftone: true }))
    + txt(X(-pw / 2 + 36), Y(ph / 2 - 26), title, 20, C.paper, { anchor: "start", bold: true });
  return { X, Y, cx, cy, head };
}

function block(c: { X: (v: number) => number; Y: (v: number) => number }, b: { left: number; right: number; cy: number; h: number }, face: string | null, text: string, size: number, slant = SLANT.block): string {
  const w = b.right - b.left, cx = (b.left + b.right) / 2;
  const g = face
    ? (gg: Graphics) => drawP5Block(gg, w, b.h, face, slant)
    : (gg: Graphics) => drawBevelSlot(gg, w, b.h, slant);
  return shape(c.X(cx), c.Y(b.cy), g)
    + txt(c.X(cx), c.Y(b.cy), text, size, face ? inkFor(face) : C.dim, { bold: !!face });
}

/** 色签(fit-content 斜切片):与 makeChip 走同一份 chipDL,出图与真机同形同源 */
function chip(c: { X: (v: number) => number; Y: (v: number) => number }, x: number, y: number,
  text: string, size: number, face: string): string {
  return shape(c.X(x), c.Y(y), (g) => paintP5(g, chipDL(text, size, face)))
    + txt(c.X(x), c.Y(y), text, size, inkFor(face), { bold: true });
}

/** 商店/履历两页共用的顶栏(与 career-panel._buildTopBar 取同一批数) */
function shopTopRow(c: { X: (v: number) => number; Y: (v: number) => number }): string {
  const T = shopTopBar();
  return [
    block(c, T.lv, ROLE.primary.face, "Lv.4", 20, SLANT.band),
    txt(c.X(T.lvName.left), c.Y(T.lvName.cy), "业余好手", 14, C.paperDim, { anchor: "start", bold: true }),
    txt(c.X(T.expNum.right), c.Y(T.expNum.cy), "77 / 215 EXP", 11, C.dim, { anchor: "end" }),
    shape(c.X((T.exp.left + T.exp.right) / 2), c.Y(T.exp.cy), (g) => {
      const dl = progressDL(T.exp.right - T.exp.left, T.exp.h, 77 / 215, C.acid);
      paintP5(g, dl.track); paintP5(g, dl.fill);
    }),
    txt(c.X((T.coins.left + T.coins.right) / 2), c.Y(T.coins.cy), "1760", 18, C.acid, { bold: true }),
  ].join("\n");
}

function panelsSheet(): string {
  const out: string[] = [];  // ---------- ① 设置(760×424)----------
  {
    const c = cell(40, 40, SET.pw, SET.ph, ROLE.primary.face, "设置");
    out.push(c.head);
    const dp = donePos();
    out.push(block(c, { left: dp.x - 75, right: dp.x + 75, cy: dp.y, h: SET.doneBtn.h }, ROLE.primary.face, "完成", 15, SLANT.button));
    tabBoxes().forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.primary.face : null, SETTINGS_TABS[i].label, 15)));
    const K = controlLayout();
    out.push(block(c, K.sectionMove, ROLE.star.face, "移动方式", 13, SLANT.band));
    K.modes.forEach((b, i) => out.push(block(c, b, i === 1 ? ROLE.primary.face : null, ["摇杆", "滑轨", "按键"][i], 15)));
    out.push(txt(c.X(K.modeTip.left), c.Y(K.modeTip.cy), MOVE_MODES[1].tip, MODE_TIP_SIZE, C.paperDim, { anchor: "start" }));
    K.actions.forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.primary.face : null, i === 0 ? "调整位置" : "重置默认", 16, SLANT.button)));
    // 移动方式图示:与真机**同一批多边形**(pad-diagram 出点列 → paintP5 落笔),
    // 这张样张画歪了就是真机画歪了,不是"工具里另摆一遍"。
    {
      const D = K.diagram, dw = D.right - D.left, dx = (D.left + D.right) / 2;
      out.push(shape(c.X(dx), c.Y(D.cy), (g) => drawBevelSlot(g, dw, D.h, SLANT.block, C.ink)));
      out.push(shape(c.X(dx), c.Y(D.cy), (g) => paintP5(g, padDiagramDL("slider", 112, dw, D.h))));
    }
    out.push(block(c, K.sectionFeel, ROLE.drill.face, "手感", 13, SLANT.band));
    K.tiers.forEach((t, i) => {
      out.push(txt(c.X(t.name.left), c.Y(t.y), i === 0 ? "球速" : "移速", 14, C.paper, { anchor: "start" }));
      const sw = t.slider.right - t.slider.left;
      out.push(shape(c.X(t.slider.left + sw / 2), c.Y(t.y),
        (g) => drawSliderFace(g, sliderDL(sw, 14, i === 0 ? 0.2 : 0.5, ROLE.star.face, 8))));
      out.push(txt(c.X(t.caption.left), c.Y(t.y), i === 0 ? "超慢 · 慢 30%" : "标准", 13, C.paperDim, { anchor: "start" }));
    });
    // 声音画面页:排在同一张纸的右半会互相盖住,单开一格在下面
    const m = cell(40, 40 + SET.ph + 90, SET.pw, SET.ph, ROLE.primary.face, "设置 · 声音画面");
    out.push(m.head);
    const M = mediaLayout();
    out.push(block(m, M.sectionLeft, ROLE.info.face, "声音与震动", 13, SLANT.band));
    out.push(block(m, M.sectionRight, ROLE.star.face, "画面", 13, SLANT.band));
    M.toggles.forEach((r, i) => {
      out.push(shape(m.X((r.toggle.left + r.toggle.right) / 2), m.Y(r.toggle.cy),
        (g) => drawToggleFace(g, r.toggle.right - r.toggle.left, r.toggle.h, i < 2, ROLE.star.face)));
      out.push(txt(m.X(r.toggle.left + 14), m.Y(r.toggle.cy), r.label, 15, i < 2 ? inkFor(ROLE.star.face) : C.dim, { anchor: "start", bold: i < 2 }));
      out.push(txt(m.X(r.toggle.right - 8), m.Y(r.toggle.cy), i < 2 ? "开" : "关", 13, i < 2 ? inkFor(ROLE.star.face) : C.dim, { anchor: "end" }));
      if (r.vol) {
        const vw = r.vol.right - r.vol.left;
        out.push(shape(m.X(r.vol.left + vw / 2), m.Y(r.vol.cy),
          (g) => drawSliderFace(g, sliderDL(vw, 14, i === 0 ? 0.8 : 0.55, ROLE.star.face, 0))));
      }
    });
    M.hints.forEach((b, i) => out.push(block(m, b, i === 0 ? ROLE.star.face : null, ["落点预测圈", "屏幕震动", "飘字提示"][i], 15)));
    const ST = M.strength;
    out.push(txt(m.X(ST.name.left), m.Y(ST.name.cy), "强度", 14, C.paper, { anchor: "start" }));
    out.push(shape(m.X((ST.slider.left + ST.slider.right) / 2), m.Y(ST.slider.cy),
      (g) => drawSliderFace(g, sliderDL(ST.slider.right - ST.slider.left, 14, 0.5, ROLE.star.face, 3))));
    out.push(txt(m.X(ST.caption.left), m.Y(ST.caption.cy), "标准", 13, C.paperDim, { anchor: "start" }));
    out.push(block(m, M.test.btn, null, "试震", 15, SLANT.button));
    out.push(txt(m.X(M.test.status.left), m.Y(M.test.status.cy), "原生 Android · 系统报告本机无振动马达", 11, C.dim, { anchor: "start" }));
    // 关于页:更新整条链路的入口(首页那颗「检查更新」搬进来了)。
    // 这张样张画的是**查到新版本**那一态 —— 没更新时「浏览器下载」那颗键压根不建(用户指令)。
    const a = cell(40 + SET.pw + 80, 40 + CMP.ph + 90, SET.pw, SET.ph, ROLE.primary.face, "设置 · 关于(查到新版本时)");
    out.push(a.head);
    tabBoxes().forEach((b, i) => out.push(block(a, b, i === 2 ? ROLE.primary.face : null, SETTINGS_TABS[i].label, 15)));
    const A = aboutLayout();
    out.push(block(a, A.section, ROLE.record.face, "版本与更新", 13, SLANT.band));
    out.push(txt(a.X(A.verName.left), a.Y(A.verName.cy), "当前版本", 14, C.paper, { anchor: "start" }));
    out.push(txt(a.X(A.verValue.left), a.Y(A.verValue.cy), APP_VERSION_NAME, 15, C.acid, { anchor: "start" }));
    out.push(block(a, A.checkBtn, ROLE.primary.face, "检查更新", 16, SLANT.button));
    out.push(block(a, A.siteBtn, null, "浏览器下载", 15, SLANT.button));
    out.push(txt(a.X(A.status.left), a.Y(A.status.cy), "发现新版本 v0.0.22 · 可点上方「浏览器下载」 · 上次检查 10-02 19:22", 11, C.dim, { anchor: "start" }));
    out.push(txt(a.X(A.hint.left), a.Y(A.hint.cy), "应用内下载不动就点「浏览器下载」,用浏览器存安装包再装", 11, C.dim, { anchor: "start" }));
    // 辅助页:自动击打那一颗开关 + 三行说明。为什么要出图 —— 这一页整页只有一颗开关,
    // 版式判据(不撞/不溢出/标签宽)全绿也可能长得像"半成品";而三行说明是这个开关最容易被
    // 省掉的部分,省掉之后玩家第一次遇到"它为什么不捞那个明显能到的球"就会以为游戏坏了。
    const g2 = cell(40 + SET.pw + 80 + 880 + 80, 610, SET.pw, SET.ph, ROLE.primary.face, "设置 · 辅助");
    out.push(g2.head);
    tabBoxes().forEach((b, i) => out.push(block(g2, b, i === 1 ? ROLE.primary.face : null, SETTINGS_TABS[i].label, 15)));
    const SS = assistLayout();
    out.push(block(g2, SS.section, ROLE.drill.face, "辅助", 13, SLANT.band));
    out.push(shape(g2.X((SS.toggle.left + SS.toggle.right) / 2), g2.Y(SS.toggle.cy),
      (gg) => drawToggleFace(gg, SS.toggle.right - SS.toggle.left, SS.toggle.h, true, ROLE.star.face)));
    out.push(txt(g2.X(SS.toggle.left + 14), g2.Y(SS.toggle.cy), "自动击打", 15, inkFor(ROLE.star.face), { anchor: "start", bold: true }));
    out.push(txt(g2.X(SS.toggle.right - 8), g2.Y(SS.toggle.cy), "开", 13, inkFor(ROLE.star.face), { anchor: "end" }));
    out.push(txt(g2.X(SS.scope.left), g2.Y(SS.scope.cy), ASSIST_COPY.scope, ASSIST_COPY_SIZE, C.paperDim, { anchor: "start" }));
    out.push(txt(g2.X(SS.tip.left), g2.Y(SS.tip.cy), ASSIST_COPY.tip, ASSIST_COPY_SIZE, C.paper, { anchor: "start" }));
    out.push(txt(g2.X(SS.landingHint.left), g2.Y(SS.landingHint.cy), ASSIST_COPY.landing, ASSIST_COPY_SIZE, C.dim, { anchor: "start" }));
  }

  // ---------- ② 闯关大厅(880×480)----------
  {
    const c = cell(40 + SET.pw + 80, 40, CMP.pw, CMP.ph, ROLE.primary.face, "巅峰闯关模式");
    out.push(txt(c.X(CMP.colX), c.Y(222), "PVE CHALLENGE", 10, ROLE.primary.face, { anchor: "start", bold: true }));
    const inner = cardRows();
    campTabRow().forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.primary.face : null,
      ["阳光海滩", "竹林道场", "赛博街区", "黄昏馆"][i], 14)));
    const names = ["海风突变", "深陷流沙", "烈日刺目", "热带沙尘暴", "热浪低重力"];
    const faces = [ROLE.record.face, ROLE.record.face, ROLE.star.face, ROLE.info.face, C.line];
    cardRow().forEach((b, i) => {
      const locked = i === 4, next = i === 2;
      const w = b.right - b.left, cx = (b.left + b.right) / 2;
      out.push(shape(c.X(cx), c.Y(b.cy), (g) => drawP5Card(g, w, b.h, faces[i], { locked, glow: next })));
      out.push(txt(c.X(cx), c.Y(b.cy + inner.no.cy), `STAGE 0${i + 1}`, 10, locked ? C.dimDeep : inkFor(faces[i]), { bold: true }));
      out.push(txt(c.X(cx), c.Y(b.cy + inner.title.cy), names[i], 17, locked ? C.dimDeep : C.paper, { bold: true }));
      out.push(txt(c.X(cx), c.Y(b.cy + inner.goal.cy), "抢 7 分", 13, locked ? C.dimDeep : C.good));
      out.push(txt(c.X(cx), c.Y(b.cy + inner.diff.cy), `难度: ${["入门", "入门", "普通", "普通", "普通"][i]}`, 11, locked ? C.dimDeep : C.dim));
      if (next) out.push(block(c, { ...inner.state, cy: b.cy + inner.state.cy }, ROLE.primary.face, "下一关", 12, SLANT.band));
      for (let k = 0; k < 3; k++) {
        const sx = (inner.stars.left + inner.stars.right) / 2 + (k - 1) * 20;
        out.push(shape(c.X(sx), c.Y(b.cy + inner.stars.cy), (g) => drawStarGlyph(g, 0, 0, 8, !locked && i < 2, ROLE.star.face)));
      }
      if (locked) out.push(shape(c.X(cx), c.Y(b.cy + 6), (g) => drawRankBadge(g, "lock", 22, C.dimDeep)));
    });
    const label = "继续闯关 · 第 3 关「烈日刺目」";
    const hint = "【盲区球影】抢 7 分 · 难度 普通 · 首通 +200 金币 +80 经验";
    const R = cmpResume(label, hint);
    out.push(block(c, R.bar, ROLE.primary.face, label, 16, SLANT.button));
    out.push(txt(c.X(R.hint.left), c.Y(R.hint.cy), hint, 12, C.dim, { anchor: "start" }));
  }

  // ---------- ③ 训练场(880×470)----------
  {
    const c = cell(40, 40 + SET.ph + 90 + SET.ph + 90, DRILL.pw, DRILL.ph, ROLE.drill.face, "训练场");
    const cb = drillCardBoxes();
    const names = ["后场重杀", "高远对拉", "网前点击", "网前搓放", "平抽快挡", "低位挑高"];
    const tags = ["SMASH", "CLEAR", "SLASH", "NET", "DRIVE", "LOB"];
    const stars = [3, 3, 0, 0, 2, 1];
    cb.forEach((b, i) => {
      const w = b.right - b.left, cx = (b.left + b.right) / 2, done = stars[i] > 0;
      out.push(shape(c.X(cx), c.Y(b.cy), (g) => drawP5Card(g, w, b.h, ROLE.drill.face, { bandH: 30, teeth: 0, locked: !done })));
      out.push(txt(c.X(b.left + 12), c.Y(b.cy + 45), tags[i], 12, done ? inkFor(ROLE.drill.face) : C.dimDeep, { anchor: "start", bold: true }));
      out.push(txt(c.X(cx), c.Y(b.cy + 8), names[i], 20, done ? C.paper : C.dimDeep, { bold: true }));
      out.push(txt(c.X(cx), c.Y(b.cy - 24), "目标 3 拍有效球", 12, done ? C.paperDim : C.dimDeep));
      for (let k = 0; k < 3; k++) {
        out.push(shape(c.X(b.right - 46 + k * 16), c.Y(b.cy + 45), (g) => drawStarGlyph(g, 0, 0, 7, k < stars[i], ROLE.star.face)));
      }
    });
    // 引导页(大画布 + 四张分步卡 + 演示键)与卡列表页互斥,同框画出来是**假重叠** ——
    // 那一页的肉眼验收交给 drill-diagram-preview:它把六关 × 四步全出成图。
    out.push(txt(c.X(DRILL.left), c.Y(-DRILL.ph / 2 + 24), "(引导页见 drill-diagram-preview,不与本页同框)", 11, C.dimDeep, { anchor: "start" }));
  }

  // ---------- ④ 形象套装页(880×470)----------
  // 卡片清单/稀有度/名字/解锁门槛/状态行**全部读真数据**:Career.shelfSets 与面板吃的是
  // 同一条判据。旧版这里把 8 个名字、8 个稀有度和一句「Lv.8 解锁」写死在工具里 ——
  // 于是它把免费底款「经典红」画在套装页上(真货架早已排除),还给 Lv.3 的樱花少女标 Lv.8。
  // 出图编参数就等于没出图。
  {
    const c = cell(40 + DRILL.pw + 80, 40 + SET.ph + 90 + SET.ph + 90, SHOP.pw, SHOP.ph, ROLE.star.face, "生涯与商店");
    out.push(shopTopRow(c));
    shopTabs().forEach((b, i) => out.push(block(c, b, i === TAB_SET ? ROLE.star.face : null, SHOP_TABS[i], 15)));
    const K = shopContent(330);
    // 摆拍档案:Lv.4 + 手里有经典红与樱花少女的两件 ⇒ 同时演出"已拥有/补齐/未解锁"三种读数
    const prof = Career.profile();
    prof.level = 4;
    prof.coins = 1760;
    prof.owned = [...BASE_DEFAULTS, "p-red", "j-blossom", "hr-twin"];
    const sets = Career.shelfSets();
    const cols = shopGridCols(sets.length), cwid = SHELF.cardW, chgt = SHELF.cardH, gp = SHELF.gap;
    const totalW = cols * cwid + (cols - 1) * gp;
    sets.forEach((s, i) => {
      const f = RARITY_META[s.rarity ?? "common"].color;
      const col = i % cols, row = Math.floor(i / cols);
      const bx = (K.grid.left + K.grid.right) / 2 - totalW / 2 + col * (cwid + gp);
      const by = K.grid.cy + K.grid.h / 2 - SHELF.padTop - row * (chgt + gp) - chgt / 2;
      const pr = Career.setPriceFor(s, prof.owned);
      const got = pr.have, lock = !Career.unlocked(s);
      out.push(shape(c.X(bx + cwid / 2), c.Y(by), (g) => drawP5Card(g, cwid, chgt, f, { bandH: 24, teeth: 0, locked: !got && lock, glow: got })));
      out.push(txt(c.X(bx + cwid / 2), c.Y(by + chgt / 2 - 12), RARITY_META[s.rarity ?? "common"].name, 10, got ? inkFor(f) : C.dimDeep, { bold: true }));
      out.push(txt(c.X(bx + cwid / 2), c.Y(by - 18), s.name, 12, got || !lock ? C.paper : C.dimDeep));
      const status = got ? "已集齐整套" : lock ? `Lv.${s.unlockLevel} 解锁`
        : pr.lack < pr.total ? `补齐 ${pr.charge}` : `整套 ${pr.charge}`;
      out.push(txt(c.X(bx + cwid / 2), c.Y(by - 42), status, 11, got ? C.good : lock ? C.dim : "#ffd24d"));
    });
    const sel = sets[0];
    // 2026-10-07 起,一级套装卡的按钮是「看组成」入口(点卡只选中,成交在二级「一键穿戴」)
    out.push(block(c, K.action, ROLE.info.face, `看${sel.name}的组成`, 16, SLANT.button));
    // 底部提示带:与面板同一批数(shop-shelf.TOAST / toastWidth),字色由 block() 走
    // inkFor(面色)。旧写法是 Label 自己抄 COL.gold = 同一支 #ffe14d,整条黄到读不出字
    // —— 这一格就是用户那张截图的对照。
    {
      const msg = `已整套穿上「${sel.name}」· ${Career.setItems(sel).length} 件一并到手`;
      out.push(block(c, toastBox(toastWidth(textW(msg, TOAST.size))), TOAST.face, msg, TOAST.size, SLANT.band));
    }
  }

  // ---------- ⑤ 生涯战绩(履历页:与货架页共用衬纸与 tab,互斥显示)----------
  {
    const c = cell(40 + DRILL.pw + 80 + SHOP.pw + 80, 40 + SET.ph + 90 + SET.ph + 90, SHOP.pw, SHOP.ph, ROLE.record.face, "生涯战绩");
    out.push(shopTopRow(c));
    shopTabs().forEach((b, i) => out.push(block(c, b, i === TAB_STATS ? ROLE.star.face : null, SHOP_TABS[i], 15)));
    // 只喂 statCells 会读的那几个键(版式与文案都是真函数出的,数字是摆拍的)。
    // 里程碑三态一屏看全(2026-10-07):胜率/扣杀/完美/甜区喂「可领」(发光 + 金色领取行,
    // 胜率摆拍先领过第 1 档 ⇒ 合计是两档之和)、最长相持喂「已领满」、无限纪录留 0 分喂「下一档」
    // —— 视图全部出自 core/milestone 的真函数,不另摆一套假状态。
    const mock = {
      level: 4, exp: 77, coins: 1760, bestEndlessScore: 0, drills: {},
      stats: { matches: 22, wins: 15, smashes: 662, sweets: 1173, perfects: 952, hits: 4982, maxRally: 46 },
    } as unknown as Profile;
    const mv = milestoneViews(mock.stats, 0, ["ms-winRate-1", "ms-maxRally-1", "ms-maxRally-2", "ms-maxRally-3"]);
    const boxes = shopStats(330);
    const gridCy = shopContent(330).grid.cy;
    statCells(mock, 18, mv).forEach((s, i) => {
      const b = boxes[i];
      const cw = b.right - b.left, ch = b.h;
      const x = (b.left + b.right) / 2, y = b.cy - gridCy;
      const d = statCardDL(cw, ch, s);
      const face = ROLE[s.role].face;
      const rule: Paint[] = [{ kind: "stroke", hex: face, a: 0.5, lw: STAT.ruleW,
        pts: [[d.rule.x0, d.rule.y], [d.rule.x1, d.rule.y]] }];
      out.push(shape(c.X(x), c.Y(y), (g) => {
        drawP5Card(g, cw, ch, face, { bandH: 0, glow: !!s.claim });
        paintP5(g, rule);
      }));
      out.push(chip(c, x + d.chip.x, y + d.chip.y, s.name, STAT.chipSize, face));
      const numCx = x + d.num.x + d.num.w / 2;
      out.push(txt(c.X(numCx), c.Y(y + d.num.y), s.num, STAT.numSize, C.paper, { bold: true }));
      if (s.unit) out.push(txt(c.X(x + d.unit.x + d.unit.w / 2), c.Y(y + d.unit.y), s.unit, STAT.unitSize, C.paperDim));
      if (s.sub) out.push(txt(c.X(x + d.sub.x), c.Y(y + d.sub.y), s.sub, STAT.subSize, s.claim ? C.acid : C.dimDeep));
    });
    out.push(tag(40 + DRILL.pw + 80 + SHOP.pw + 80, 40 + SET.ph + 90 + SET.ph + 90 + SHOP.ph + 24,
      "里程碑三态:发光卡 = 整卡可点领金币+经验(副行金色);「下一档 N」= 未达标;「已领满」= 收讫。状态全读 core/milestone 真视图"));
  }

  // ---------- ⑥ 二次确认弹窗(点「重置默认」先问那一句)----------
  // 为什么要出图:这张弹窗的全部风险都在「文案一长就撞」,而断言只能证明算术没坏。
  // 坐标一个不抄 —— 卡高、四块的 cy、两颗键的 cx,全是 layoutConfirm 算出来的那一份。
  {
    const c = cell(40, PANELS_ROW4, SET.pw, SET.ph, ROLE.primary.face, "二次确认弹窗");
    out.push(c.head);
    const L = layoutConfirm(CONFIRM_PAD_RESET);
    out.push(shape(c.X(0), c.Y(0), (g) => drawPosterPlate(g, L.cardW, L.cardH, { bandHex: ROLE.primary.face })));
    for (const it of L.items) {
      const hex = it.key === "title" ? C.acid : it.key === "body" ? C.paper : C.dim;
      it.lines.forEach((l, k) => out.push(txt(
        c.X(0), c.Y(it.cy + (it.h / 2 - (k + 0.5) * it.lineH)), l, it.size, hex,
        { bold: it.key === "title" },
      )));
    }
    for (const b of L.buttons) {
      const face = b.key === "action" ? ROLE.primary.face : null;
      out.push(shape(c.X(b.cx), c.Y(b.cy), (g) => (face
        ? drawP5Block(g, b.w, b.h, face, SLANT.button)
        : drawBevelSlot(g, b.w, b.h, SLANT.button))));
      out.push(txt(c.X(b.cx), c.Y(b.cy), b.text, b.size, face ? inkFor(face) : C.dim, { bold: !!face }));
    }
    out.push(tag(40, PANELS_ROW4 + SET.ph + 24,
      `卡高 ${L.cardH} = 内边距 + 标题 + ${L.items[1].lines.length} 行正文 + 补充行 + 按钮行,全在 confirm-layout 算;`
      + "真文案与四行长文案各量一遍见 panel-check ⑪"));
  }

  // ---------- ⑦ 形象页(顶栏五格,货架窗顶**两行**槽位子页签) ----------
  // 出图与真机同源:tab 数、子页签排布、货架让位(accShelf 把**可视窗**变矮)、卡片三行字
  // (CARD_TEXT / cardFxLines)全吃 shop-shelf 那一份算术;商品读 config 真数据。
  // 卡片整组套一个 SVG clipPath = 那扇变矮的窗:子页签带里再也不会透出卡片,
  // 这件事在真机上是 Mask 做的,预览里不裁就等于没验。
  {
    const c = cell(40 + SET.pw + 80, PANELS_ROW4, SHOP.pw, SHOP.ph, ROLE.star.face, "商店 · 形象页");
    out.push(shopTopRow(c));
    shopTabs().forEach((b, i) => out.push(block(c, b, i === TAB_LOOK ? ROLE.star.face : null, SHOP_TABS[i], 15)));
    const K = shopContent(SHELF.h);
    const slotRows = accSlotRowCounts(CFG.accSlots.map((s) => s.row));
    const band = accBandH(slotRows.length);
    const shelf = accShelf(slotRows.length);
    const winCy = K.grid.cy - band / 2;          // 裁切窗中心:窗底不动,顶边让到 chip 之下
    out.push(`<defs><clipPath id="accWin"><rect x="${r2(c.X(K.grid.left))}" y="${r2(c.Y(winCy + shelf.h / 2))}"`
      + ` width="${r2(SHELF.w)}" height="${r2(shelf.h)}"/></clipPath></defs>`);
    // 货架:上衣那一槽(款最多,三排要滚 —— 用户 2026-10-07 截图正是这一格)
    const items = CFG.accessories.filter((x) => x.slot === "jersey");
    const cols = shopGridCols(items.length), cwid = SHELF.cardW, chgt = SHELF.cardH, gp = SHELF.gap;
    const totalW = cols * cwid + (cols - 1) * gp;
    out.push('<g clip-path="url(#accWin)">');
    items.forEach((a, i) => {
      const f = a.rarity === "common" ? "#3a4258" : RARITY_META[a.rarity].color;
      const col = i % cols, row = Math.floor(i / cols);
      const bx = (K.grid.left + K.grid.right) / 2 - totalW / 2 + col * (cwid + gp);
      const by = winCy + rowTopY(row, shelf) - chgt / 2;
      const owned = i === 0;
      const cx = c.X(bx + cwid / 2), Y = (v: number): number => c.Y(by + v);
      out.push(shape(cx, Y(0), (g) => drawP5Card(g, cwid, chgt, f, { bandH: 24, teeth: 0, locked: false, glow: owned })));
      out.push(txt(cx, Y(chgt / 2 - 12), a.rarity === "common" ? "经典" : RARITY_META[a.rarity].name, 10, inkFor(f), { bold: true }));
      out.push(txt(cx, Y(CARD_TEXT.nameY), cardLine(a.name, CARD_TEXT.nameSize), CARD_TEXT.nameSize, C.paper, { bold: true }));
      out.push(txt(cx, Y(CARD_TEXT.statusY), cardLine(owned ? "已拥有" : `金币 ${a.price}`, CARD_TEXT.statusSize),
        CARD_TEXT.statusSize, owned ? C.good : "#ffd24d"));
      const fx = cardFxLines(a.desc);
      cardFxYs(fx.length).forEach((fy, k) => {
        out.push(txt(cx, Y(fy), fx[k], CARD_TEXT.fxSize, "#7e9bd8"));
      });
    });
    out.push('</g>');
    // 槽位子页签两行:钉在网格窗顶部、不随滚动;选中槽 = info 青实底
    accSlotRows(K.grid, slotRows).forEach((b, i) => {
      const meta = CFG.accSlots[i];
      if (!meta) return;
      out.push(block(c, b, i === 3 ? ROLE.info.face : null, meta.name, 13, SLANT.band));
    });
    out.push(block(c, K.action, ROLE.primary.face, "购买 · 48 金币", 16, SLANT.button));
    out.push(tag(40 + SET.pw + 80, PANELS_ROW4 + SHOP.ph + 24,
      `形象页:${CFG.accSlots.length} 个槽排成 ${slotRows.join("+")} 两行,各槽限装一件、跨槽叠加;`
      + `子页签带高 ${band} 从**裁切窗**让位(accShelf(${slotRows.length}).h = ${shelf.h}),`
      + `所以卡片滚到哪儿都不会穿到 chip 背后;卖点小字按卡宽折两行、装不下才截尾`));
  }
  return out.join("\n");
}

const SYNTAX_H = 1100;
// 拼装图 1:1:宽 = 40 + 880 + 80 + 880 + 80 + 设置(辅助页 760) + 40
// 行 1:设置(操控页) + 闯关大厅;行 2:设置(声音画面) + 设置(关于) + 设置(辅助);行 3:训练场 + 商店
// 行 3 现在是三格:训练场 + 商店 + 履历页(与商店共用衬纸的另一面)
const PANELS_W = 40 + 880 + 80 + 880 + 80 + 880 + 40;
// 第 4 行:二次确认弹窗 + 配饰页(610 那一行塞不下 —— 上面声音画面/关于两格底缘 978,弹窗 610 起必撞)
const PANELS_ROW4 = 1068 + 470 + 60;
const PANELS_H = PANELS_ROW4 + 470 + 60;

function sheet(body: string, w: number, h: number, bg: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${bg}"/>`,
    body,
    `</svg>`,
  ].join("\n");
}

const outIdx = process.argv.indexOf("--out");
const dir = outIdx >= 0 ? process.argv[outIdx + 1] : ".tools-build/panel-preview";
mkdirSync(dir, { recursive: true });
// 两张:①语法样张(判形状对不对) ②四块面板拼装(判铺满一屏还像不像 P5)
// 深色底是故意贴近真机 —— 面板身后那座球场被 dim 压过之后就是这个亮度。
writeFileSync(join(dir, "syntax.svg"), sheet(primitivesSheet(), SHEET_W, SYNTAX_H, "#0d0f16"));
writeFileSync(join(dir, "panels.svg"), sheet(panelsSheet(), PANELS_W, PANELS_H, "#141824"));
writeFileSync(join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>P5 panel syntax</title>`
  + `<body style="margin:0;background:#000;color:#888;font:13px sans-serif">`
  + `<p>syntax</p><img src="syntax.svg">`
  + `<p>panels</p><img src="panels.svg"></body>`);
// 网点预算:这是这套语法里唯一按面积堆绘制量的件,出图时顺手报一次
const probe = new StubGraphics();
const dots = drawHalftone(probe as unknown as Graphics, 880 - 24, 76, { rampW: 880, rampH: 480 });
console.log(`写出 ${join(dir, "syntax.svg")} 与 ${join(dir, "panels.svg")}`);
console.log(`网点预算:880 宽面板的标题带(76 高)= ${dots} 点/层(红线 ${900})`);
