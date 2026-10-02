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
import type { CardOpts } from "../assets/scripts/ui/p5-shapes";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { C, ROLE, SLANT, inkFor } from "../assets/scripts/ui/p5-tokens";
import { RARITY_META } from "../assets/scripts/core/config";
import { APP_VERSION_NAME } from "../assets/scripts/core/version";
import { SET, aboutLayout, controlLayout, donePos, mediaLayout, SETTINGS_TABS, tabBoxes } from "../assets/scripts/ui/settings-layout";
import {
  cardRow, cardRows, CMP, resumeRow as cmpResume, tabRow as campTabRow,
} from "../assets/scripts/ui/campaign-layout";
import { cardBoxes as drillCardBoxes, DRILL } from "../assets/scripts/ui/drill-layout";
import { gridCols as shopGridCols, SHELF, SHOP, shopContent, shopTabs, shopTopBar } from "../assets/scripts/ui/shop-shelf";
import {
  drawBevelSlot, drawHalftone, drawP5Block, drawP5Card, drawPosterPlate, drawRankBadge,
  drawSliderFace, drawStarGlyph, drawToggleFace, sliderDL,
} from "../assets/scripts/ui/p5-paint";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const SHEET_W = 1360, SHEET_H = 1140;

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

function panelsSheet(): string {
  const out: string[] = [];

  // ---------- ① 设置(760×424)----------
  {
    const c = cell(40, 40, SET.pw, SET.ph, ROLE.primary.face, "设置");
    out.push(c.head);
    const dp = donePos();
    out.push(block(c, { left: dp.x - 75, right: dp.x + 75, cy: dp.y, h: SET.doneBtn.h }, ROLE.primary.face, "完成", 15, SLANT.button));
    tabBoxes().forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.primary.face : null, SETTINGS_TABS[i].label, 15)));
    const K = controlLayout();
    out.push(block(c, K.sectionMove, ROLE.star.face, "移动方式", 13, SLANT.band));
    K.modes.forEach((b, i) => out.push(block(c, b, i === 1 ? ROLE.primary.face : null, ["摇杆", "滑轨", "按键"][i], 15)));
    K.actions.forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.primary.face : null, i === 0 ? "调整位置" : "重置默认", 16, SLANT.button)));
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

  // ---------- ④ 商店(880×470)----------
  {
    const c = cell(40 + DRILL.pw + 80, 40 + SET.ph + 90 + SET.ph + 90, SHOP.pw, SHOP.ph, ROLE.star.face, "生涯与商店");
    const T = shopTopBar();
    out.push(block(c, T.lv, ROLE.primary.face, "Lv.4", 18, SLANT.band));
    out.push(txt(c.X((T.lvName.left + T.lvName.right) / 2), c.Y(T.lvName.cy), "业余好手", 13, C.dim));
    out.push(shape(c.X((T.exp.left + T.exp.right) / 2), c.Y(T.exp.cy),
      (g) => { drawBevelSlot(g, T.exp.right - T.exp.left, T.exp.h, SLANT.block); }));
    out.push(txt(c.X((T.coins.left + T.coins.right) / 2), c.Y(T.coins.cy), "700", 18, C.acid, { bold: true }));
    shopTabs().forEach((b, i) => out.push(block(c, b, i === 0 ? ROLE.star.face : null,
      ["角色皮肤", "球拍皮肤", "羽毛球皮肤", "面部皮肤", "生涯战绩"][i], 15)));
    const K = shopContent(330);
    const rarity = ["common", "legendary", "legendary", "epic", "epic", "epic", "rare", "rare"] as const;
    const owned = [true, false, false, false, false, false, false, false];
    const cols = shopGridCols(rarity.length), cwid = SHELF.cardW, chgt = SHELF.cardH, gp = SHELF.gap;
    const totalW = cols * cwid + (cols - 1) * gp;
    rarity.forEach((r, i) => {
      const f = RARITY_META[r].color;
      const col = i % cols, row = Math.floor(i / cols);
      const bx = (K.grid.left + K.grid.right) / 2 - totalW / 2 + col * (cwid + gp);
      const by = K.grid.cy + K.grid.h / 2 - SHELF.padTop - row * (chgt + gp) - chgt / 2;
      out.push(shape(c.X(bx + cwid / 2), c.Y(by), (g) => drawP5Card(g, cwid, chgt, f, { bandH: 24, teeth: 0, locked: !owned[i], glow: owned[i] })));
      out.push(txt(c.X(bx + cwid / 2), c.Y(by + chgt / 2 - 12), RARITY_META[r].name, 10, owned[i] ? inkFor(f) : C.dimDeep, { bold: true }));
      out.push(txt(c.X(bx + cwid / 2), c.Y(by - 18), ["经典红", "球场之王", "金羽宗师", "樱花少女", "赛博骇客", "猫系少女", "烈焰少年", "萌芽豆丁"][i], 12, owned[i] ? C.paper : C.dimDeep));
      out.push(txt(c.X(bx + cwid / 2), c.Y(by - 42), owned[i] ? "已拥有" : "Lv.8 解锁", 11, owned[i] ? C.good : C.dim));
    });
    out.push(block(c, K.action, ROLE.star.face, "装备上身", 16, SLANT.button));
  }
  return out.join("\n");
}

const SYNTAX_H = 1040;
// 拼装图 1:1:宽 = 40 + 880 + 80 + 880 + 40,高 = 四行面板摞起来
// 行 1:设置(操控页) + 闯关大厅;行 2:设置(声音画面) + 设置(关于);行 3:训练场 + 商店
const PANELS_W = 40 + 880 + 80 + 880 + 40;
const PANELS_H = 1068 + 470 + 60;

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
