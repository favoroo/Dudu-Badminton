// ============================================================
// 球拍 / 羽毛球 / 脸面 商品画廊出图(2026-11-02 皮肤逐件优化)。
// look-preview 管人物套装与本体件、acc-preview 管穿戴件,这两类之外的商品
// (拍/球/脸)此前没有一张能肉眼巡检的图 —— 本工具补上这一格:
// 每件商品一张大图,与上场同一套绘制入口(drawRacketStill / drawShuttle /
// drawHeadStill),皮肤换了图跟着换。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/skin-gallery.js --out .tools-build/skin-gallery
//   # 肉眼看:headless Chrome 光栅化 gallery.html
// ============================================================
import fs from "fs";
// 顺序即语义:cc-stub 必须在 sprites 之前求值
import { installCc, Graphics as StubGraphics, StubOp, opsToSvg } from "./cc-stub";
installCc();
import { drawHeadStill, drawRacketStill, drawShuttle, Viewport } from "../assets/scripts/render/sprites";
import { CFG } from "../assets/scripts/core/config";
import { Ball, Player, SkinDef } from "../assets/scripts/core/types";

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/skin-gallery";
})();
fs.mkdirSync(OUT, { recursive: true });

const T = 30;
const vp: Viewport = { x: (wx: number) => wx, y: (wy: number) => -wy };

function dummyPlayer(racketSkin: SkinDef | null): Player {
  return {
    side: "left", isAI: false,
    theme: { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a", name: "画廊" },
    jersey: "01", aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, homeX: 0,
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
    racketSkin: racketSkin ?? undefined, hideTag: true, groundY: 0,
  } as unknown as Player;
}

function dummyBall(): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: false, owner: null,
    lastHitter: null, crossed: false, netted: false,
    shot: null, sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  } as unknown as Ball;
}

const THEME = { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a", name: "画廊" };

/** 与 look-preview 同一套 SVG 变换:内容 y 向上 ⇒ 组上 scale(s,-s) 翻回,锚在框底 */
function frame(ops: StubOp[], w: number, h: number, s: number, lift: number, bg = "#151a26"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="100%" height="100%" fill="${bg}"/>`
    + `<g transform="translate(${w / 2}, ${h - lift}) scale(${s}, ${-s})">${opsToSvg(ops)}</g>`
    + `</svg>`;
}

const cells: string[] = [];
// 轻量判据(与 look-preview/acc-preview 同款):每件商品必须画出东西、坐标必须有限。
// 拍/球/脸的绘制坏法全是静默的(注册表漏 key、NaN 坐标),不登记进 test-all 就没人跑。
let checks = 0, failed = 0;
function audit(label: string, ops: StubOp[]): void {
  checks++;
  let ok = ops.length > 3;
  if (ok) for (const op of ops) for (const cmd of op.cmds) {
    for (const v of [cmd.x, cmd.y, cmd.cx, cmd.cy, cmd.rx, cmd.ry, cmd.w, cmd.h, cmd.dx, cmd.dy]) {
      if (v !== undefined && !Number.isFinite(v)) { ok = false; break; }
    }
    if (!ok) break;
  }
  if (!ok) { failed++; console.error(`✗ ${label}:笔画 ${ops.length} 或坐标非有限`); }
}

// ---------- 球拍 8 款 ----------
for (const s of CFG.skins.racket) {
  const g = new StubGraphics();
  drawRacketStill(g as never, vp, 0, 0, 1, dummyPlayer(s.id === "r-std" ? null : s));
  audit(`拍 ${s.id}`, g.ops);
  const tag = [s.rarity ?? "经典", s.price ? `${s.price} 金币` : "默认", s.decal ? `贴章 ${s.decal}` : "", s.swingFx ? `挥光 ${s.swingFx}` : ""].filter(Boolean).join(" · ");
  cells.push(`<div class="cell"><span class="lab">${s.name}(${tag})</span>${frame(g.ops, 190, 260, 2.4, 30)}</div>`);
}

cells.push(`<div class="sep"></div>`);

// ---------- 羽毛球 8 款 ----------
for (const s of CFG.skins.shuttle) {
  const g = new StubGraphics();
  drawShuttle(g as never, vp, dummyBall(), s.id === "s-std" ? null : s);
  audit(`球 ${s.id}`, g.ops);
  const tag = [s.rarity ?? "经典", s.price ? `${s.price} 金币` : "默认", s.trailStyle ? `拖尾 ${s.trailStyle}` : ""].filter(Boolean).join(" · ");
  cells.push(`<div class="cell"><span class="lab">${s.name}(${tag})</span>${frame(g.ops, 190, 190, 3.2, 95)}</div>`);
}

cells.push(`<div class="sep"></div>`);

// ---------- 脸面 9 款 ----------
for (const s of CFG.skins.face) {
  const g = new StubGraphics();
  drawHeadStill(g as never, vp, 0, 0, 2.2, THEME, s.faceStyle ?? "skin", "normal", T);
  audit(`脸 ${s.id}`, g.ops);
  const tag = [s.rarity ?? "免费", s.price ? `${s.price} 金币` : "免费"].filter(Boolean).join(" · ");
  cells.push(`<div class="cell"><span class="lab">${s.name}(${tag})</span>${frame(g.ops, 190, 190, 2.2, 95)}</div>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>skin gallery</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:20px}
.cell{display:inline-block;margin:6px;padding:6px;border:1px solid #232a3a;vertical-align:top}
.lab{display:block;color:#ffe14d;font-size:12px;margin-bottom:4px}
.sep{width:100%;height:10px}
svg{background:#151a26}
</style>
<h2>商品画廊:球拍 / 羽毛球 / 脸面(与上场同一套绘制)</h2>
${cells.join("\n")}
`;
fs.writeFileSync(`${OUT}/gallery.html`, html);
console.log(`出图: ${OUT}/gallery.html(球拍 ${CFG.skins.racket.length} / 球 ${CFG.skins.shuttle.length} / 脸 ${CFG.skins.face.length})`);
if (failed > 0) {
  console.error(`✗ ${failed}/${checks} 件商品出图异常`);
  process.exit(1);
}
console.log(`✓ 全部通过(${checks} 件)`);
