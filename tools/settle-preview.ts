// ============================================================
// 结算屏出图 —— 把 VICTORY/DEFEAT 那一屏在 node 里画成 SVG,再用 headless Chrome
// 光栅化,肉眼判一次竖排。
//
// 为什么需要它:这一轮改的是**观感**(用户 2026-10-06:「有些被遮挡了」)。
// settle-layout-check 能证明「任意两块的竖直盒子不相交、都不出卡片」,证明不了
// 「缝 7px 会不会太挤」「标语衬底从 88 收到 78 还站不站得住」—— 那是要看一眼的。
// 而仓库里两条真机路都不通:编辑器自动化封闭(AGENTS.md 坑 1)、Cocos 构建产物在
// 内置浏览器永久 hang(坑 2)。
//
// 与 panel-preview 同一条口径:**盒子与形状都不另抄一份**。
//   · 每一格的 y 全部现读 settleLayout() —— 与 settle-panel.place() 拿的是同一个函数,
//     所以这张图不会画出一套面板其实没有的排版;
//   · 底块走 p5-shapes 的点列(plateDL / cardDL / blockDL / bandDL / progressDL)经
//     paintP5 落笔,与真机同一批多边形。
//   · 唯一"像而不是"的是行动钮(ui-arcade 的 drawArcadeButton 依赖 cc、桩不住),
//     这里用 blockDL 替身 —— 它只占住那一格的高,不参与任何判据。
// 右侧叠一层虚线盒 + 格名:一眼看清"每一格到哪为止",压没压字不用量。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/settle-preview.js --out .tools-build/settle-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --screenshot=.tools-build/settle-preview/settle.png \
//     --window-size=1240,1820 --default-background-color=00000000 \
//     file://$PWD/.tools-build/settle-preview/settle.svg
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import type { Paint } from "../assets/scripts/ui/p5-shapes";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { paintP5, progressDL } from "../assets/scripts/ui/p5-paint";
import { blockDL, cardDL, plateDL } from "../assets/scripts/ui/p5-shapes";
import { C, ROLE, SLANT, inkFor } from "../assets/scripts/ui/p5-tokens";
import { CAMPAIGN_STAGES, type StarFacts } from "../assets/scripts/core/campaign";
import { objectiveResults } from "../assets/scripts/core/campaign-hud";
import { textW } from "../assets/scripts/core/text-metrics";
import { SETTLE, condRow, settleLayout } from "../assets/scripts/ui/settle-layout";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const r2 = (v: number): number => Math.round(v * 100) / 100;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 一块底:建一个记录型 Graphics,画完转成 SVG 片段(局部 y 向上 → SVG y 向下) */
function shape(cx: number, cy: number, draw: (g: Graphics) => void): string {
  const g = new StubGraphics() as unknown as Graphics;
  draw(g);
  return `<g transform="translate(${r2(cx)},${r2(cy)}) scale(1,-1)">${opsToSvg((g as unknown as StubGraphics).ops)}</g>`;
}
const dl = (cx: number, cy: number, paints: readonly Paint[]): string =>
  shape(cx, cy, (g) => paintP5(g, paints));

function txt(x: number, y: number, s: string, size: number, hex: string,
  o: { anchor?: "start" | "middle" | "end"; bold?: boolean } = {}): string {
  const weight = o.bold ? " font-weight=\"700\"" : "";
  return `<text x="${r2(x)}" y="${r2(y)}" fill="${hex}" font-size="${size}"${weight}`
    + ` font-family=${JSON.stringify(FONT)} text-anchor="${o.anchor ?? "middle"}`
    + `" dominant-baseline="middle">${esc(s)}</text>`;
}

/** 一屏结算的全部输入 —— flags 那一份与 settle-panel.show() 喂给 settleLayout 的同构 */
interface Variant {
  label: string;
  flags: { match: boolean; badge: boolean; rewards: boolean; newsLines: number; conds: number; caption: boolean };
  verdict: string; won: boolean; score: string; sub: string; badge: string;
  stats: Array<{ v: string; k: string; tone: string }>;
  coin: string; bonus: string; lv: string; exp: number;
  news: string[]; conds: string[];
  acts: Array<{ text: string; size: number; primary?: boolean }>;
  caption: string;
}

const TONE: Record<string, string> = { gold: C.acid, hot: ROLE.power.face, cyan: C.cyan, plain: C.paper };
const SHEET_W = 1240;
const ROW_H = SETTLE.cardH + 96;

function drawVariant(v: Variant, top: number): string {
  const L = settleLayout(v.flags);
  const out: string[] = [];
  const cx = SHEET_W / 2, cy = top + 52 + SETTLE.cardH / 2;
  /** 卡内坐标(y 向上)→ SVG */
  const P = (x: number, y: number): [number, number] => [cx + x, cy - y];

  out.push(txt(24, top + 24, v.label, 15, "#9fb0d8", { anchor: "start", bold: true }));
  out.push(txt(SHEET_W - 24, top + 24,
    `在场块 ${L.blocks.length} · 摊派缝 ${L.gap.toFixed(1)}px · 需高 ${L.needH.toFixed(0)} / 卡高 ${SETTLE.cardH}`,
    12, "#5f6f96", { anchor: "end" }));

  // —— 卡片衬纸(与 kit.panel 同一份 plateDL)——
  out.push(dl(cx, cy, plateDL(SETTLE.cardW, SETTLE.cardH, { bandHex: ROLE.primary.face })));

  // —— 大标语衬底:真机画在 cine 层(压在卡片之上),位置 = L.y.verdict ——
  const [vx, vy] = P(0, L.y.verdict);
  out.push(dl(vx, vy, blockDL(SETTLE.bandW, SETTLE.bandH, v.won ? C.slash : C.navy2, 9)));
  out.push(txt(vx, vy, v.verdict, SETTLE.verdictSize, v.won ? C.paper : C.dim, { bold: true }));

  // —— 头部:比分(比赛)/ 关卡名+星(训练) + 荣誉胶囊 ——
  const headY = v.flags.match ? L.y.score : L.y.sub;
  const [hx, hy] = P(0, headY);
  out.push(txt(hx, hy, v.flags.match ? v.score : v.sub,
    v.flags.match ? SETTLE.scoreSize : SETTLE.subSize, C.paper, { bold: v.flags.match }));
  if (v.badge) {
    const w = Math.min(SETTLE.cardW - 60, textW(v.badge, SETTLE.badgeSize) + 34);
    const [bx, by] = P(0, L.y.badge);
    out.push(dl(bx, by, blockDL(w, SETTLE.badgeH, C.acid, SLANT.band)));
    out.push(txt(bx, by, v.badge, SETTLE.badgeSize, inkFor(C.acid), { bold: true }));
  }

  // —— 六格战报 ——
  for (let i = 0; i < v.stats.length; i++) {
    const c2 = i % SETTLE.statCols, row = Math.floor(i / SETTLE.statCols);
    const [sx, sy] = P((c2 - 1) * (SETTLE.cellW + SETTLE.cellGap), L.y[`stat${row}`]);
    out.push(dl(sx, sy, cardDL(SETTLE.cellW, SETTLE.cellH, C.line, { bandH: 0, alpha: 0.6 })));
    out.push(txt(sx, sy - 8, v.stats[i].v, 20, TONE[v.stats[i].tone] ?? C.paper, { bold: true }));
    out.push(txt(sx, sy + 13, v.stats[i].k, 12, C.dim));
  }

  // —— 奖励三行 ——
  if (v.flags.rewards) {
    const [ax, ay] = P(0, L.y.coin);
    out.push(txt(ax, ay, v.coin, SETTLE.coinSize, C.acid, { bold: true }));
    const [bx2, by2] = P(0, L.y.bonus);
    out.push(txt(bx2, by2, v.bonus, SETTLE.bonusSize, C.dim));
    const [lx, ly] = P(SETTLE.lvX, L.y.bar);
    out.push(txt(lx, ly, v.lv, SETTLE.lvSize, C.paper));
    const [gx, gy] = P(SETTLE.barX, L.y.bar);
    const bar = progressDL(SETTLE.barW, SETTLE.barH, v.exp, C.acid);
    out.push(dl(gx, gy, bar.track));
    out.push(dl(gx, gy, bar.fill));
  }

  // —— 升级 / 上新(整块居中在它那两格里)——
  if (v.news.length) {
    const [nx, ny] = P(0, L.y.news);
    for (let i = 0; i < v.news.length; i++) {
      out.push(txt(nx, ny + (i - (v.news.length - 1) / 2) * SETTLE.newsLineH, v.news[i], SETTLE.newsSize, C.acid));
    }
  }

  // —— 关卡目标逐条 ——
  if (v.conds.length) {
    const row = condRow(v.conds);
    const [ox, oy] = P(0, L.y.obj);
    for (let i = 0; i < v.conds.length; i++) {
      out.push(txt(ox + row.x[i], oy, v.conds[i], SETTLE.objSize, i === 0 ? C.acid : C.dim));
    }
  }

  // —— 行动钮 + 下一关小字(blockDL 替身,只为占住那一格)——
  const widths = v.acts.map((a) => Math.min(SETTLE.btnMaxW, Math.max(
    v.acts.length >= 3 ? SETTLE.btnMinWide : SETTLE.btnMinPair,
    Math.round(textW(a.text, a.size) + SETTLE.btnPad))));
  let x = -(widths.reduce((s, w) => s + w, 0) + SETTLE.btnGap * (widths.length - 1)) / 2;
  for (let i = 0; i < v.acts.length; i++) {
    const [bx, by] = P(x + widths[i] / 2, L.y.buttons);
    out.push(dl(bx, by, blockDL(widths[i], SETTLE.btnH, v.acts[i].primary ? C.slash : C.navy2, SLANT.button)));
    out.push(txt(bx, by, v.acts[i].text, v.acts[i].size, C.paper));
    x += widths[i] + SETTLE.btnGap;
  }
  if (v.caption) {
    const [px, py] = P(0, L.y.caption);
    out.push(txt(px, py, v.caption, SETTLE.captionSize, C.dim));
  }

  // —— 排版盒子:虚线框 + 格名,压没压字一眼看得见 ——
  for (const it of L.items) {
    const by = cy - it.cy;
    out.push(`<rect x="${r2(cx - SETTLE.cardW / 2 + 8)}" y="${r2(by - it.h / 2)}"`
      + ` width="${r2(SETTLE.cardW - 16)}" height="${r2(it.h)}" fill="none"`
      + ` stroke="#4de1ff" stroke-opacity="0.3" stroke-dasharray="3 4"/>`);
    out.push(txt(cx + SETTLE.cardW / 2 - 4, by, it.key, 9, "#4de1ff", { anchor: "end" }));
  }
  return out.join("\n");
}

// ---------- 三屏:现场图那一屏 / 最坏的一屏 / 训练场 ----------

const ST2 = CAMPAIGN_STAGES[1], ST3 = CAMPAIGN_STAGES[2];
const facts: StarFacts = {
  won: true, myScore: 21, opScore: 19, longestRally: 27, hits: 52, smashes: 14, sweets: 21,
  perfects: 28, whiffs: 0, lungeShots: 3, jumpSmashes: 2, iaiStrikes: 1, skillCasts: 4,
  deepShots: 6, netIntercepts: 2, airHits: 5, empReturns: 3, zonePenalties: 1, exhausted: 0,
  serveFaults: 0, smashScores: 4, slidingScores: 1, laserBoosts: 2, lastSmash: true,
};
const conds = objectiveResults(ST2, facts).map((c, i) => `★${i + 1} ${c.detail}`);
const MENU = { text: "返回主菜单", size: 16 };
const MATCH_STATS = [
  { v: "27", k: "最长回合 · 拍", tone: "gold" }, { v: "14", k: "你的扣杀", tone: "hot" },
  { v: "100%", k: "甜区命中率", tone: "gold" }, { v: "28", k: "完美击球", tone: "cyan" },
  { v: "52", k: "全场击球", tone: "plain" }, { v: "0", k: "失误挥空", tone: "plain" },
];

const variants: Variant[] = [
  {
    // 用户那张现场图:ST2 通关、有下一关、三条目标、没有升级/上新
    label: "① 闯关通关(现场图那一屏):VICTORY 衬底 / 比分 / 称号 / 目标三条 / 下一关小字",
    flags: { match: true, badge: true, rewards: true, newsLines: 0, conds: 3, caption: true },
    verdict: "VICTORY!", won: true, score: "21 : 19", sub: "",
    badge: `★ 关卡突破 · ${ST2.title} (${ST2.badge})`, stats: MATCH_STATS,
    coin: "首通奖励 金币 +242 · 经验 +70", bonus: "基础 180 · 表现 +40 · 连胜 ×1.1(2 连胜)",
    lv: "Lv.4", exp: 0.82, news: [], conds,
    acts: [{ text: `下一关 ▶ 第 ${ST3.stageNo} 关`, size: 16, primary: true }, { text: "重打本关", size: 15 }, MENU],
    caption: `第 ${ST3.stageNo} 关「${ST3.title}」· 抢 ${ST3.targetScore} 分`,
  },
  {
    // 最坏的一屏:七块全在场 —— 摊派缝最薄的那一张
    label: "② 极端:两行升级/上新 + 三条目标 + 下一关小字全在场(缝最薄的一张)",
    flags: { match: true, badge: true, rewards: true, newsLines: 2, conds: 3, caption: true },
    verdict: "VICTORY!", won: true, score: "21 : 15", sub: "",
    badge: `★ 关卡突破 · ${ST3.title} (${ST3.badge})`,
    stats: [
      { v: "34", k: "最长回合 · 拍", tone: "gold" }, { v: "22", k: "你的扣杀", tone: "hot" },
      { v: "88%", k: "甜区命中率", tone: "gold" }, { v: "41", k: "完美击球", tone: "cyan" },
      { v: "96", k: "全场击球", tone: "plain" }, { v: "2", k: "失误挥空", tone: "plain" },
    ],
    coin: "首通奖励 金币 +318 · 经验 +120", bonus: "基础 240 · 表现 +52 · 连胜 ×1.15(4 连胜)",
    lv: "Lv.7", exp: 0.35,
    news: ["↑ 连升 2 级 → Lv.9 · 奖励金币 +260", "新品上架:烈焰少年 · 猫须少女 · 星纹拍 · 极光球"],
    conds,
    acts: [{ text: "下一关 ▶ 第 12 关", size: 16, primary: true }, { text: "重打本关", size: 15 }, MENU],
    caption: "第 12 关「逆风翻盘」· 抢 11 分",
  },
  {
    // 训练场:没有比分/称号/目标,块数最少 —— 缝封顶在 maxGap 并整组居中
    label: "③ 训练场收局:无比分、无称号、无目标(块最少,缝封顶后整组居中)",
    flags: { match: false, badge: false, rewards: true, newsLines: 1, conds: 0, caption: false },
    verdict: "训练完成!", won: true, score: "", sub: "贴墙准星 ★★★",
    badge: "",
    stats: [
      { v: "18/20", k: "有效拍数", tone: "gold" }, { v: "11", k: "完美击球", tone: "cyan" },
      { v: "14", k: "甜区命中", tone: "gold" }, { v: "92%", k: "平均质量", tone: "hot" },
      { v: "23", k: "喂球回合", tone: "plain" }, { v: "31", k: "你的击球", tone: "plain" },
    ],
    coin: "首次通关 金币 +90 · 经验 +30", bonus: "基础 60 · 表现 +30",
    lv: "Lv.3", exp: 0.55, news: ["↑ 升级 Lv.4 · 奖励金币 +80"], conds: [],
    acts: [{ text: "再练一次", size: 18, primary: true }, MENU], caption: "",
  },
];

const SHEET_H = ROW_H * variants.length + 24;
const body = variants.map((v, i) => drawVariant(v, 12 + i * ROW_H)).join("\n");
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`,
  `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#141824"/>`,
  body, `</svg>`,
].join("\n");

const outIdx = process.argv.indexOf("--out");
const dir = outIdx >= 0 ? process.argv[outIdx + 1] : ".tools-build/settle-preview";
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "settle.svg"), svg);
writeFileSync(join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>settle</title>`
  + `<body style="margin:0;background:#000"><img src="settle.svg"></body>`);

// 出图与面板读同一份排版:拿三屏的 verdict 格名当探针,分家了就当场炸
for (const v of variants) {
  if (!settleLayout(v.flags).items.some((i) => i.key === "verdict")) {
    throw new Error(`${v.label}:排版里没有 verdict 格 —— 出图与面板分家了`);
  }
}
console.log(`settle-preview → ${dir}/settle.svg(${variants.length} 屏,缝 ${variants.map((v) => settleLayout(v.flags).gap.toFixed(1)).join(" / ")}px)`);
