// ============================================================
// 形象合成出图 + 像素级外观保持断言(2026-10-06 拆件重构)。
//
// look-compose-check 证的是「合成出的 SkinDef 与拆件前逐键相等」—— 那是**字段级**。
// 这一支证的是更强的那条:把同一帧交给 drawPlayer,老路径(直接挂那条 def)与新路径
// (逐槽合成出那份 def)吐出的**笔画流必须逐条一字不差**。字段相等但渲染层读法不同
// (比如某个 key 换了名字、某处读的是 theme 而不是 skin)只有这一支抓得到。
//
// 另外出两张人看的图:
//   ① 13 套逐套 —— 老路径 vs 新路径并排,肉眼看有没有哪套"字段对但看着不一样";
//   ② 本体件逐件 —— 每件穿在身上的全身像(商店卡片就是这条通道画的)。
//
// Cocos 编辑器对自动化封闭,唯一能自证的路就是把 cc.Graphics 换成记录型替身、
// 在 node 里 dump SVG(pose-preview / aura-preview / acc-preview 同一套路)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/look-preview.js            # 断言 + 出 look.html
//   # 肉眼看:headless Chrome 光栅化 look.svg
// ============================================================
import fs from "fs";
// 顺序即语义:cc-stub 必须在 sprites 之前求值(它在模块求值时给 Module._load 打补丁)
import { installCc, Graphics as StubGraphics, StubOp, opsToSvg } from "./cc-stub";
installCc();
import { __resetPoseState, drawPlayer, Viewport } from "../assets/scripts/render/sprites";
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import { Rules } from "../assets/scripts/core/rules";
import { Player, SkinDef } from "../assets/scripts/core/types";

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/look-preview";
})();
fs.mkdirSync(OUT, { recursive: true });

const h = { checks: 0, fails: 0 };
const ok = (c: boolean, m: string): void => { h.checks++; if (!c) h.fails++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const T = 30;               // 固定帧:同帧重画才可比
const BASE: string[] = (["player", "racket", "shuttle", "face"] as const).map((k) => CFG.skins[k][0].id);

function dummy(skin: SkinDef, theme: { main: string; dark: string; glow: string; name: string }): Player {
  return {
    side: "left", isAI: false,
    theme, jersey: "01", aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 0, y: CFG.court.groundY, vx: 0, vy: 0, px: 0, py: CFG.court.groundY, homeX: 0,
    facing: 1, onGround: true, coyote: 0, jumpBuf: 0, sq: 1, sqPrev: 1, recoverT: 0,
    runPhase: 0, runAmt: 0, runStep: 0, blinkSeed: 0,
    swingT: -1, swingStyle: "over" as const, swingHit: false, swingQ: 0, swingBuf: 0,
    swingBufAim: null, swingAim: "mid", swingRadius: 52,
    racket: { x: 0, y: 0, ang: 0 }, racketPrev: { x: 0, y: 0 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0, zoneScale: 1, score: 0,
    smashGlow: 0, sweetGlow: 0, perfectGlow: 0, heat: 0, hitRecoil: 0,
    lungeT: -1, lungeDir: 0, lungeCd: 0, lungeShotT: 0,
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0, lungeShots: 0, jumpSmashes: 0,
      iaiStrikes: 0, skillCasts: 0, deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    playerSkin: skin, hideTag: true, groundY: CFG.court.groundY,
    faceSkin: Career.skinOf("face"),
    racketSkin: Career.skinOf("racket"),
    acc: Career.look().acc,
  } as unknown as Player;
}

/** 渲染一帧,交出笔画(与真机同一入口 drawPlayer) */
function render(p: Player): StubOp[] {
  __resetPoseState();
  const vp: Viewport = { x: (wx: number) => wx, y: (wy: number) => CFG.court.groundY - wy };
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], vp, p, T, 1, null);
  return g.ops;
}

/** 笔画流签名:**命令 + 颜色 + 线宽 + 全部数值**都进串,差一个像素或一号色就不是一回事。
 *  (第一版只收了几何坐标,于是"纯换色"的上衣/肤色/球袜/球鞋全被判成"没改到画面" ——
 *  判据测错了方向,而它给出的假绿更危险:换错色这条回归会一路绿灯上线。) */
function sig(ops: StubOp[]): string {
  return ops.map((o) => `${o.kind}:${o.color}:${o.width}:` + o.cmds.map((c) =>
    `${c.t}:${[c.x, c.y, c.cx, c.cy, c.rx, c.ry, c.w, c.h, c.dx, c.dy]
      .map((v) => (v === undefined ? "-" : (Math.round(v * 1e4) / 1e4).toString())).join(",")}`,
  ).join("|")).join(";");
}

const finite = (ops: StubOp[]): boolean => ops.every((o) => o.cmds.every((c) =>
  [c.x, c.y, c.cx, c.cy, c.rx, c.ry, c.w, c.h, c.dx, c.dy]
    .every((v) => v === undefined || Number.isFinite(v))));

/** 把存档摆回拆件前的样子:owned 只有皮肤、acc 只有老四键、没有迁移标记 */
function asOldSave(setId: string): void {
  const p = Career.profile();
  p.owned = [...BASE, setId];
  p.acc = { face: "", upper: "", lower: "", hand: "" };
  delete p.lookMigrated;
  p.equipped = {
    player: setId, racket: BASE[1], shuttle: BASE[2], face: BASE[3],
  };
  Career.profile();
}

Rules.newMatch("1p", "normal");

// ---------- ① 像素级外观保持:老路径 vs 新路径,同帧笔画流必须逐字相同 ----------
{
  const diffs: string[] = [];
  for (const want of CFG.skins.player) {
    asOldSave(want.id);
    const L = Career.look();
    // 老路径:直接把那条 def 挂上去(拆件前 applyToMatch 干的事)
    const oldTheme = {
      main: want.main || "#ff4d4d", dark: want.dark || "#a8202c",
      glow: want.glow || "#ff8a6a", name: want.name,
    };
    const a = sig(render(dummy(want, oldTheme)));
    // 新路径:逐槽合成出来的那份
    const b = sig(render(dummy(L.skin, L.theme)));
    if (a !== b) {
      // 找出第一处不同,方便定位是哪根旋钮
      const pa = a.split(";"), pb = b.split(";");
      let at = pa.findIndex((x, i) => x !== pb[i]);
      if (at < 0) at = Math.min(pa.length, pb.length);
      diffs.push(`${want.id}: 第 ${at} 笔起分叉(${pa.length} vs ${pb.length} 笔)`);
    }
  }
  ok(diffs.length === 0,
    `13 套逐套:老路径与新路径同帧笔画流**逐字相同**(${diffs.join(" | ") || "全绿"})`);
}

// ---------- ② 每件本体件真的改到了画面 ----------
{
  asOldSave("p-red");
  const b0 = Career.look();
  const base = sig(render(dummy(b0.skin, b0.theme)));
  const parts = CFG.accessories.filter((c) => c.kind === "part" && c.price > 0);
  const same: string[] = [];
  for (const c of parts) {
    const L = Career.lookOfCandidate(c);
    if (sig(render(dummy(L.skin, L.theme))) === base) same.push(`${c.id}(${c.slot})`);
  }
  ok(same.length === 0,
    `${parts.length} 件付费本体件每件都真的改到画面(${same.join("、") || "无一与基线相同"})`);
}

// ---------- ③ 坐标全部有限 + 同帧确定性 ----------
{
  const bad: string[] = [];
  for (const s of CFG.skins.player) {
    asOldSave(s.id);
    const ops = render(dummy(Career.look().skin, Career.look().theme));
    if (!finite(ops)) bad.push(`${s.id} 坐标不有限`);
    const again = render(dummy(Career.look().skin, Career.look().theme));
    if (sig(ops) !== sig(again)) bad.push(`${s.id} 同帧重画不一致`);
  }
  ok(bad.length === 0, `全部套装坐标有限、同帧重画逐字一致(${bad.join("、") || "全绿"})`);
}

// ---------- 出图 ----------
const W = 118, H = 150;
/** 出图框:与 acc-preview 同一套变换 —— render() 的 vp.y 把世界 y 翻成"向上为正",
 *  所以必须 scale(s, -s) 再翻回 SVG 的向下为正,锚点落在框底。
 *  (第一版直接拿 viewBox 去框负 y 区间,结果小人上半身整个画到框外,只剩两条腿。) */
const frame = (ops: StubOp[], bg: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  + `<rect width="100%" height="100%" fill="${bg}"/>`
  + `<g transform="translate(${W / 2}, ${H - 14}) scale(1.05, -1.05)">${opsToSvg(ops)}</g>`
  + `</svg>`;

const cells: string[] = [];
// A. 13 套:老路径 | 新路径 并排
for (const s of CFG.skins.player) {
  asOldSave(s.id);
  const L = Career.look();
  const oldOps = render(dummy(s, {
    main: s.main || "#ff4d4d", dark: s.dark || "#a8202c", glow: s.glow || "#ff8a6a", name: s.name,
  }));
  const newOps = render(dummy(L.skin, L.theme));
  cells.push(`<div class="row"><span class="lab">${s.name} · 老路径 | 新路径(逐槽合成)</span>`
    + `<span class="pair">${frame(oldOps, "#151a26")}${frame(newOps, "#151a26")}`
    + `<em>${sig(oldOps) === sig(newOps) ? "一致" : "不一致"}</em></span></div>`);
}
// B. 本体件逐件穿在身上(商店卡片就是这条通道)
asOldSave("p-red");
for (const c of CFG.accessories.filter((x) => x.kind === "part")) {
  const L = Career.lookOfCandidate(c);
  cells.push(`<div class="cell"><span class="lab">${c.name}(${CFG.accSlots.find((m) => m.key === c.slot)?.name})</span>`
    + frame(render(dummy(L.skin, L.theme)), "#10141d") + "</div>");
}

const html = `<!doctype html><meta charset="utf-8"><title>look preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:20px}
.row{margin:0 0 14px;padding:8px;border:1px solid #232a3a}
.cell{display:inline-block;margin:6px;padding:6px;border:1px solid #232a3a;vertical-align:top}
.lab{display:block;color:#ffe14d;font-size:11px;margin-bottom:4px}
.pair{display:inline-flex;gap:6px;align-items:center}
em{color:#7ee0a8;font-style:normal;font-size:11px}
svg{background:#151a26}
</style>
<h2>形象合成:老路径 vs 新路径(同帧 drawPlayer 笔画)</h2>
${cells.join("\n")}
`;
fs.writeFileSync(`${OUT}/look.html`, html);
fs.writeFileSync(`${OUT}/look.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${Math.ceil(cells.length / 8) * 180}"><foreignObject width="1600" height="100%">
<div xmlns="http://www.w3.org/1999/xhtml">${html.replace(/^[\s\S]*?<body>/, "").replace(/<\/body>[\s\S]*$/, "")}</div></foreignObject></svg>`);
console.log(`\n出图: ${OUT}/look.html`);

console.log(h.fails ? `✗ ${h.fails}/${h.checks} 条失败` : `✓ 全部通过(${h.checks} 条)`);
process.exit(h.fails ? 1 : 0);
