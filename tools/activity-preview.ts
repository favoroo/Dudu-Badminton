// ============================================================
// 活动面板出图 —— 把每日/每周两屏在 node 里画成 SVG,再用 headless Chrome
// 光栅化,肉眼判一次行内排版(压字/进度条与读数的间距/三态用色)。
//
// 与 settle-preview / panel-preview 同一条口径:**盒子与形状都不另抄一份**。
//   · 行格与行内格子全部现读 activity-layout 的 rowBoxes/questRowParts/chestRowParts
//     —— 与 activity-panel 拿的是同一批函数,这张图不会画出一套面板其实没有的排版;
//   · 底块走 p5-shapes 的点列(plateDL / cardDL / blockDL / progressDL / chipDL)经
//     paintP5 落笔,与真机同一批多边形;
//   · 任务清单吃 core/activity.questsOf(真实轮换抽中的那三条),不是摆拍文案。
// 唯一"像而不是"的是 tab 的凹陷槽与已领按钮(cardDL locked 替身)—— 只占住格子,
// 不参与任何判据。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/activity-preview.js --out .tools-build/activity-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --screenshot=.tools-build/activity-preview/activity.png \
//     --window-size=1240,1180 --default-background-color=00000000 \
//     file://$PWD/.tools-build/activity-preview/activity.svg
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
import { CFG } from "../assets/scripts/core/config";
import {
  freshQuestSave, markClaimed, questViews, questsOf, type QuestSave,
} from "../assets/scripts/core/activity";
import type { ChestView, QuestView } from "../assets/scripts/core/activity";
import {
  ACT, BTN_TEXT, CHEST_TEXT, HEADER_TEXT, REFRESH_HINT, TAB_TEXT,
  chestRowParts, headerBoxes, questRowParts, rowBoxes, tabRow,
} from "../assets/scripts/ui/activity-layout";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const r2 = (v: number): number => Math.round(v * 100) / 100;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

/** 行的三态角色(activity-panel.rowRole 同款,预览里对齐真机用色) */
function rowRole(v: { claimable: boolean; claimed: boolean }): { face: string; glow: boolean; ink: string } {
  if (v.claimable) return { face: ROLE.star.face, glow: true, ink: C.paper };
  if (v.claimed) return { face: ROLE.off.face, glow: false, ink: C.dimDeep };
  return { face: ROLE.info.face, glow: false, ink: C.paper };
}

const SHEET_W = 1240;
const PANEL_H = ACT.ph;
const GAP_Y = 70;

/** 一块面板的全部内容:kind 决定清单与文案,views 决定三态 */
function drawPanel(kind: "daily" | "weekly", views: { list: QuestView[]; chest: ChestView }, cy: number): string {
  const out: string[] = [];
  const cx = SHEET_W / 2;
  /** 面板局部坐标(y 向上)→ SVG */
  const P = (x: number, y: number): [number, number] => [cx + x, cy - y];

  out.push(txt(24, cy - PANEL_H / 2 - 24, `活动面板 · ${TAB_TEXT[kind]}(${REFRESH_HINT[kind]})`, 15, "#9fb0d8", { anchor: "start", bold: true }));

  // 衬纸 + 标题行
  out.push(dl(cx, cy, plateDL(ACT.pw, ACT.ph, { bandHex: ROLE.star.face })));
  const H = headerBoxes();
  out.push(txt(P(H.tag.left, H.tag.cy)[0], P(H.tag.left, H.tag.cy)[1], HEADER_TEXT.tag, ACT.tag.size, ROLE.star.face, { anchor: "start" }));
  out.push(txt(P(H.title.left, H.title.cy)[0], P(H.title.left, H.title.cy)[1], HEADER_TEXT.title, ACT.title.size, C.paper, { anchor: "start", bold: true }));
  out.push(txt(P(H.hint.right, H.hint.cy)[0], P(H.hint.right, H.hint.cy)[1], REFRESH_HINT[kind], ACT.hint.size, C.dim, { anchor: "end" }));
  // ✕(blockDL 替身,只占格子)
  out.push(dl(...P(ACT.close.x, ACT.close.cy), blockDL(ACT.close.vis, ACT.close.vis, ROLE.primary.face, SLANT.button)));
  out.push(txt(P(ACT.close.x, ACT.close.cy)[0], P(ACT.close.x, ACT.close.cy)[1], "✕", 14, C.paper));

  // 两格 tab(选中 = 实底大色块;未选 = 墨面替身)
  const tabs = tabRow();
  tabs.forEach((b, i) => {
    const key = i === 0 ? "daily" : "weekly";
    const sel = kind === key;
    const w = b.right - b.left;
    const [tx, ty] = P(b.left + w / 2, b.cy);
    out.push(dl(tx, ty, sel ? blockDL(w, b.h, ROLE.star.face, SLANT.block) : cardDL(w, b.h, C.line, { bandH: 0, locked: true })));
    out.push(txt(tx, ty, TAB_TEXT[key], ACT.tab.size, sel ? inkFor(ROLE.star.face) : C.dim));
  });

  // 行区:任务行 ×3 + 宝箱行
  const rows = rowBoxes();
  views.list.forEach((v, i) => {
    const r = rows[i];
    const w = r.right - r.left;
    const { face, glow, ink } = rowRole(v);
    const rc = P(r.left + w / 2, r.cy);
    out.push(dl(rc[0], rc[1], cardDL(w, r.h, face, { bandH: 0, glow })));

    const p = questRowParts(r);
    // 标题 / 进度读数 / 奖励
    out.push(txt(P(p.title.left, p.title.cy)[0], P(p.title.left, p.title.cy)[1], v.title, 15, ink, { anchor: "start" }));
    const claimedInk = v.claimed ? C.dimDeep : C.dim;
    out.push(txt(P(p.prog.left, p.prog.cy)[0], P(p.prog.left, p.prog.cy)[1], `${v.prog}/${v.target}`, ACT.prog.size, v.claimable ? C.acid : claimedInk, { anchor: "start" }));
    out.push(txt(P(p.reward.right, p.reward.cy)[0], P(p.reward.right, p.reward.cy)[1], `+${v.coin}币 +${v.exp}经验`, ACT.reward.size, v.claimed ? C.dimDeep : C.acid, { anchor: "end" }));

    // 进度条(track+fill 同一把 progressDL,条心摆在 bar 格中心);已领置灰
    const t = v.target > 0 ? Math.min(v.prog / v.target, 1) : 0;
    const bar = progressDL(ACT.bar.w, ACT.bar.h, t, v.claimed ? C.dimDeep : C.acid);
    out.push(dl(...P((p.bar.left + p.bar.right) / 2, p.bar.cy), bar.track));
    out.push(dl(...P((p.bar.left + p.bar.right) / 2, p.bar.cy), bar.fill));

    // 三态按钮:可领 = 荧光黄实底大色块;已领/进行中 = 墨面替身
    const bw = p.btn.right - p.btn.left;
    const [bx, by] = P((p.btn.left + p.btn.right) / 2, p.btn.cy);
    if (v.claimable) {
      out.push(dl(bx, by, blockDL(bw, p.btn.h, ROLE.star.face, SLANT.block)));
      out.push(txt(bx, by, BTN_TEXT.claim, ACT.btn.size, inkFor(ROLE.star.face), { bold: true }));
    } else {
      out.push(dl(bx, by, cardDL(bw, p.btn.h, C.line, { bandH: 0, locked: true })));
      out.push(txt(bx, by, v.claimed ? BTN_TEXT.claimed : BTN_TEXT.locked, ACT.btn.size, C.dimDeep));
    }
  });

  // 宝箱行
  const cr = rows[rows.length - 1];
  const cw = cr.right - cr.left;
  const chest = views.chest;
  const cface = chest.claimable ? ROLE.star.face : chest.claimed ? ROLE.off.face : ROLE.info.face;
  const cglow = chest.claimable;
  const cc = P(cr.left + cw / 2, cr.cy);
  out.push(dl(cc[0], cc[1], cardDL(cw, cr.h, cface, { bandH: 0, glow: cglow })));
  const cp = chestRowParts(cr);
  out.push(txt(P(cp.title.left, cp.title.cy)[0], P(cp.title.left, cp.title.cy)[1], CHEST_TEXT.title, 15, C.acid, { anchor: "start" }));
  const subText = chest.claimed ? CHEST_TEXT.claimed : kind === "daily" ? CHEST_TEXT.daily : CHEST_TEXT.weekly;
  out.push(txt(P(cp.sub.left, cp.sub.cy)[0], P(cp.sub.left, cp.sub.cy)[1], subText, 11, C.dim, { anchor: "start" }));
  out.push(txt(P(cp.reward.right, cp.reward.cy)[0], P(cp.reward.right, cp.reward.cy)[1], `+${chest.coin}币`, ACT.reward.size, chest.claimed ? C.dimDeep : C.acid, { anchor: "end" }));
  const cbw = cp.btn.right - cp.btn.left;
  const [cbx, cby] = P((cp.btn.left + cp.btn.right) / 2, cp.btn.cy);
  if (chest.claimable) {
    out.push(dl(cbx, cby, blockDL(cbw, cp.btn.h, ROLE.star.face, SLANT.block)));
    out.push(txt(cbx, cby, BTN_TEXT.claim, ACT.btn.size, inkFor(ROLE.star.face), { bold: true }));
  } else {
    out.push(dl(cbx, cby, cardDL(cbw, cp.btn.h, C.line, { bandH: 0, locked: true })));
    out.push(txt(cbx, cby, chest.claimed ? BTN_TEXT.claimed : BTN_TEXT.locked, ACT.btn.size, C.dimDeep));
  }

  // 排版盒子:虚线框 + 格名,压没压字一眼看得见
  for (const [b, nm] of [
    ...rows.map((b, i): [typeof b, string] => [b, i === rows.length - 1 ? "chest" : `quest${i}`]),
    ...tabRow().map((b, i): [typeof b, string] => [b, `tab${i}`]),
  ]) {
    const by = cy - b.cy;
    out.push(`<rect x="${r2(cx + b.left + 6)}" y="${r2(by - b.h / 2)}" width="${r2(b.right - b.left - 12)}" height="${r2(b.h)}" fill="none" stroke="#4de1ff" stroke-opacity="0.28" stroke-dasharray="3 4"/>`);
    out.push(txt(cx + b.right - 4, by, nm, 9, "#4de1ff", { anchor: "end" }));
  }
  return out.join("\n");
}

// ---------- 两屏:今天真实抽中的每日清单 × 三态摆拍;每周固定清单 × 三态摆拍 ----------

const now = new Date();
const dailyDefs = questsOf("daily", now);
/** 每周清单就是 config 全量(questsOf("weekly") 同一把函数,别另滤一遍) */
const CFG_WEEKLY = questsOf("weekly", now);
const mkSave = (patch: (q: QuestSave) => void): QuestSave => {
  const q = freshQuestSave(now);
  patch(q);
  return q;
};

const dailySave = mkSave((q) => {
  // 三态各摆一行:可领 / 进行中 / 已领;宝箱可领
  dailyDefs.forEach((d, i) => {
    if (i === 0) q.daily.prog[d.id] = d.target;
    else if (i === 1) q.daily.prog[d.id] = Math.min(7, d.target);
    else { q.daily.prog[d.id] = d.target; q.daily.claimed.push(d.id); }
  });
});
const dailyV = questViews(dailySave, now);

const weeklySave = mkSave((q) => {
  // 每周三条:进行中 / 可领 / 刚过半;宝箱已领
  CFG_WEEKLY.forEach((d, i) => {
    if (i === 0) q.weekly.prog[d.id] = Math.min(2, d.target);
    else if (i === 1) q.weekly.prog[d.id] = d.target;
    else q.weekly.prog[d.id] = Math.min(21, d.target);
  });
  markClaimed(q, "w-chest", now);
});
const weeklyV = questViews(weeklySave, now);

const SHEET_H = PANEL_H * 2 + GAP_Y * 3;
const body = [
  drawPanel("daily", { list: dailyV.daily, chest: dailyV.dailyChest }, GAP_Y + PANEL_H / 2),
  drawPanel("weekly", { list: weeklyV.weekly, chest: weeklyV.weeklyChest }, GAP_Y * 2 + PANEL_H * 1.5),
].join("\n");

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`,
  `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#141824"/>`,
  body, `</svg>`,
].join("\n");

const outIdx = process.argv.indexOf("--out");
const dir = outIdx >= 0 ? process.argv[outIdx + 1] : ".tools-build/activity-preview";
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "activity.svg"), svg);
writeFileSync(join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>activity</title>`
  + `<body style="margin:0;background:#000"><img src="activity.svg"></body>`);

// 出图与面板读同一份排版:行数对不上就当场炸(分家探针)
if (rowBoxes().length !== 4) throw new Error("排版里不是 4 行(3 任务 + 宝箱)—— 出图与面板分家了");
console.log(`activity-preview → ${dir}/activity.svg(每日 ${dailyV.daily.length} 条 + 每周 ${weeklyV.weekly.length} 条,两屏)`);
