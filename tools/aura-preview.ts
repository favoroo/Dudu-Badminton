// ============================================================
// 传说皮肤「脚下法阵」出图 + 几何断言 —— 一次性验证脚本,不属于游戏运行时代码。
//
// 为什么要有这个工具:这是纯画面改动,崩不了、也不报错,坏只会坏成「还是很难看」或
// 「某一层没跟地面透视对齐」。而 Cocos 编辑器对自动化封闭、内置浏览器跑不了构建产物,
// 所以唯一能在会话里自证的这条路,就是把 cc.Graphics 换成记录型替身、在 node 里 dump
// SVG、再用 headless Chrome 光栅化肉眼看 —— 与 pose-preview / panel-preview 同一套路。
//
// 钉住的九条(都是「不会崩、只会安静地难看」的那类坏):
//   1 有限坐标        2 逐帧确定(零 rand)  3 包络不越界(不许糊到人物身上)
//   4 透视扁率(不许哪层偷偷画成正圆)      5 每帧笔画预算(中低端机)
//   6 alpha 上限      7 离地淡出真的在缩放   8 缩略图 LOD 生效
//   9 齿环与外断环反向对转(整套法阵的读感就在这条上)
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/aura-preview.js                 # 断言 + 出 SVG/HTML
//   node .tools-build/tools/aura-preview.js --selftest      # 七份改坏的反例必须全被报警
//   # 肉眼看:把 HTML 交给 headless Chrome 光栅化
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//     --screenshot=.tools-build/aura-preview/aura.png --window-size=1500,1400 \
//     file://$PWD/.tools-build/aura-preview/aura.html
// ============================================================
import fs from "fs";
// 顺序即语义:cc-stub 必须在 aura/sprites 之前求值(它在模块求值时给 Module._load 打补丁)
import { installCc, Graphics as StubGraphics, Color as StubColor, StubOp, opPoints, opsToSvg } from "./cc-stub";
import { drawFootSigil, AURA_COLORS, SigilSpec } from "../assets/scripts/render/aura";
import { withAlpha } from "../assets/scripts/render/palette";
import { __resetPoseState, drawPlayer, Viewport } from "../assets/scripts/render/sprites";
import { CFG } from "../assets/scripts/core/config";
import { Player } from "../assets/scripts/core/types";

installCc();

const A = CFG.fx.aura;
const CO = CFG.court;
const PW = CFG.player.w;
const TAU = Math.PI * 2;

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/aura-preview";
})();
fs.mkdirSync(OUT, { recursive: true });

// ---------- 采样:把一帧法阵画进记录型 Graphics ----------

type Gfx = Parameters<typeof drawFootSigil>[0];

function sigil(ov: Partial<SigilSpec> = {}): { ops: StubOp[]; spec: SigilSpec } {
  const spec: SigilSpec = {
    cx: 0, cy: 0, rx: PW * A.radiusK, kx: 1, ky: 1, t: 0, key: "gold", vis: 1, ...ov,
  };
  const g = new StubGraphics();
  drawFootSigil(g as unknown as Gfx, spec);
  return { ops: g.ops, spec };
}

interface OpBox { w: number; h: number; x0: number; x1: number; y0: number; y1: number; n: number; alpha: number }

/** 一条笔画的包围盒 + alpha(从 css 串里抠)。stroke 要把线宽算进去 ——
 *  溢光那三层是 5~12px 的宽带子,只看路径点会量不到它真正占的地面。 */
function box(op: StubOp): OpBox {
  const pts = opPoints(op);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const pad = op.kind === "stroke" ? op.width / 2 : 0;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const m = /,([0-9.]+)\)$/.exec(op.color);
  return {
    w: x1 - x0, h: y1 - y0, x0, x1, y0, y1, n: pts.length,
    alpha: m ? parseFloat(m[1]) : 1,
  };
}

// ---------- 断言 ----------

let fails = 0;
const ok = (name: string, pass: boolean, detail = ""): void => {
  if (!pass) fails++;
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 椭圆归一化角:把地面投影拉回正圆再取角度(判断某层转了多少) */
function normAngle(p: { x: number; y: number }, rx: number, flat: number): number {
  return Math.atan2(p.y / (rx * flat), p.x / rx);
}

function runChecks(label: string): number {
  console.log(`\n${label}`);
  const base = sigil({ t: 37 });
  const ops = base.ops, spec = base.spec;
  const boxes = ops.map(box);

  // 1 有限坐标
  const allPts = ops.flatMap(opPoints);
  ok("1 坐标全有限(没有 NaN 笔画)", allPts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    `${allPts.length} 点`);

  // 2 逐帧确定:同一 t 画两次必须逐字节相同(证明零 rand / 零跨帧状态)
  const again = sigil({ t: 37 });
  ok("2 同帧重画逐字节一致(逐帧零 rand)", JSON.stringify(again.ops) === JSON.stringify(ops));

  // 3 包络:横向不许宽过人物跨距、升尘不许高过小腿 —— 判据钉在**人物尺寸**上而不是
  //    法阵自己的配置上,否则「outerK 撑到 6」这种改坏会把尺子一起放大,量不出来。
  const envW = PW * 1.45;
  const envUp = CFG.player.h * 0.32;
  const envDn = CFG.player.h * 0.26;
  const outX = boxes.filter((b) => b.x0 < -envW || b.x1 > envW);
  const outY = boxes.filter((b) => b.y1 > envUp || b.y0 < -envDn);
  ok("3 包络内(不宽过人物、不高过小腿)", outX.length === 0 && outY.length === 0,
    `半宽 ≤ ${envW.toFixed(1)}px / 上沿 ≤ ${envUp.toFixed(1)}px${outX.length ? ` · ${outX.length} 笔横向越界` : ""}${outY.length ? ` · ${outY.length} 笔纵向越界` : ""}`);

  // 4 透视扁率:任何一条「宽笔画」都必须是压扁到地面平面上的,不许画成正圆
  //    (星尘/光尘那种小颗粒本来就又窄又高,不参与这条)
  const fat = boxes.filter((b) => b.w > 15 && b.h / b.w > 0.75);
  ok("4 地面层全按 flat 压扁(没有哪层是正圆)", fat.length === 0,
    `flat=${A.flat}${fat.length ? ` · ${fat.length} 笔又宽又圆` : ""}`);

  // 5 每帧笔画预算:这圈东西每帧都要重画,中低端机上不是免费的
  ok("5 每帧笔画 ≤ 16", ops.length <= 16, `实测 ${ops.length} 笔`);

  // 6 alpha 上限:脚下的一圈光不许把球场糊住
  const maxA = Math.max(...boxes.map((b) => b.alpha));
  ok("6 alpha ≤ 0.95(不糊场)", maxA <= 0.955, `峰值 ${maxA.toFixed(3)}`);

  // 7 离地淡出:vis 减半 ⇒ 每一笔浓度同步减半(1/32 量化容差)
  const half = sigil({ t: 37, vis: 0.5 });
  const halfBoxes = half.ops.map(box);
  const scaled = half.ops.length === ops.length
    && halfBoxes.every((b, i) => Math.abs(b.alpha - boxes[i].alpha * 0.5) <= 1 / 32 + 1e-3);
  ok("7 vis 真的在缩放每一笔", scaled, `${ops.length} vs ${half.ops.length} 笔`);
  ok("7b vis=0 一笔不画", sigil({ t: 37, vis: 0 }).ops.length === 0);

  // 8 缩略图 LOD:半宽低于 moteMinPx 时升尘层必须缺席(26px 的卡片上撒细点只会糊成噪点)
  const thumb = sigil({ t: 37, kx: 0.6, ky: 0.6 });
  const big = sigil({ t: 37, kx: 1.5, ky: 1.5 });
  ok("8 卡片缩略图不画升尘", thumb.ops.length === big.ops.length - 1,
    `缩略 ${thumb.ops.length} 笔 / 实机 ${big.ops.length} 笔`);

  // 9 对转:齿环与外断环必须反向 —— 「两圈反着转」就是这套法阵的全部读感
  const cogN = A.teeth * 4;
  const outerN = A.outerSegs * 5;
  const later = sigil({ t: 37 + 60 }).ops.map(opPoints);
  const spinOf = (n: number): number | null => {
    const i = ops.findIndex((op, k) => op.kind === "stroke" && opPoints(op).length === n && boxes[k].w > 10);
    if (i < 0 || later[i].length === 0) return null;
    let d = normAngle(later[i][0], spec.rx, A.flat) - normAngle(opPoints(ops[i])[0], spec.rx, A.flat);
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  };
  const sCog = spinOf(cogN), sOuter = spinOf(outerN);
  ok("9 齿环与外断环反向对转", sCog !== null && sOuter !== null && sCog * sOuter < 0,
    `60 帧:齿环 ${sCog === null ? "找不到" : `${(sCog * 57.3).toFixed(1)}°`} / 外环 ${sOuter === null ? "找不到" : `${(sOuter * 57.3).toFixed(1)}°`}`);

  return fails;
}

// ---------- 反例(selftest):把六处「改坏」灌回配置,对应判据必须报警 ----------

function runSelftest(): number {
  console.log("\n反例自检 —— 每一条都必须被上面的判据拦下(拦不下说明这把尺子没牙齿)");
  const snap = JSON.parse(JSON.stringify(A)) as typeof A;
  const caught: string[] = [];
  const missed: string[] = [];
  const bad = (name: string, breakIt: () => void): void => {
    fails = 0;
    breakIt();
    runChecks(`  · 反例:${name}`);
    if (fails > 0) caught.push(name); else missed.push(name);
    Object.assign(A, JSON.parse(JSON.stringify(snap)));
  };

  bad("溢光 alpha 拉到糊满整场", () => { A.bloomA[0] = 1.6; A.bloomA[1] = 1.4; A.bloomA[2] = 1.2; });
  bad("外断环半径撑到半个屏幕", () => { A.outerK = 6; });
  bad("升尘长到 90px 高(糊到脸上)", () => { A.moteRise = 90; });
  bad("缩略图 LOD 关掉(卡片糊成噪点)", () => { A.moteMinPx = 0; });
  bad("外环改成与齿环同向(对转没了)", () => { A.spinOuter = A.spinCore; });
  bad("每层各画各的扁率(阵散成两圈)", () => { A.flat = 0.9; });
  bad("笔画数失控(星尘撒 40 颗)", () => { A.stars = 40; A.motes = 40; });

  for (const n of caught) console.log(`  ✅ ${n} 被拦下`);
  for (const n of missed) console.log(`  ❌ ${n} 没被拦下`);
  return missed.length;
}

// ---------- 旧写法对照(sprites.ts 删掉的那 24 行,原样搬来只为出图对照) ----------
// 与 pad-cd-preview「末列是旧写法对照」同套路:改版前后的差距要能一眼看出来,
// 否则下一次有人觉得「这圈东西是不是可以简化回一个圈」时无从反驳。

function legacySigil(t: number, kx: number, ky: number): StubOp[] {
  const ac = AURA_COLORS.gold;
  const g = new StubGraphics();
  const vs = Math.sqrt(Math.abs(kx * ky)) || 1;
  const pulse = 1 + Math.sin(t * 0.085) * 0.09;
  const rx0 = PW * 0.95 * pulse, ry0 = 8.5 * pulse;
  g.strokeColor = withAlphaStr(ac.a, 0.34);
  g.lineWidth = 2.2 * vs;
  g.ellipse(0, 0, rx0 * kx, ry0 * ky);
  g.stroke();
  g.strokeColor = withAlphaStr(ac.b, 0.22);
  g.lineWidth = 1.2 * vs;
  g.ellipse(0, 0, rx0 * 1.28 * kx, ry0 * 1.3 * ky);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const oa = t * 0.055 + (i * TAU) / 3;
    const rise = 6 + Math.sin(t * 0.05 + i * 2.1) * 4;
    g.fillColor = withAlphaStr(i === 1 ? ac.b : ac.a, 0.8);
    g.circle(Math.cos(oa) * rx0 * 1.12 * kx, (Math.sin(oa) * ry0 * 1.12 + rise) * ky, 1.6 * vs);
    g.fill();
  }
  return g.ops;
}

/** palette.withAlpha 的返回类型转成替身 Color(运行时两者同形:palette 里的
 *  `new Color` 走的就是 cc-stub 打补丁后的那个类) */
function withAlphaStr(hex: string, a: number): StubColor {
  return withAlpha(hex, a) as unknown as StubColor;
}

// ---------- 出图 ----------

const DARK = "#12161f";
/** 球场地面色(暖绿,与 court 地板同量级)—— 法阵在亮场上会不会糊,只能在这上面判 */
const COURT = "#d8ecd2";

function sheet(title: string, cells: string[], cols: number): string {
  return `<div class="block"><h2>${title}</h2><div class="grid" style="grid-template-columns:repeat(${cols},1fr)">
${cells.map((c) => `<div class="c">${c}</div>`).join("")}
</div></div><div class="sep"></div>`;
}

function frame(ops: StubOp[], s: number, bg: string, w = 260, h = 150): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(${w / 2}, ${h * 0.62}) scale(${s}, ${-s})">${opsToSvg(ops)}</g>
</svg>`;
}

function playerFrame(sk: Player["playerSkin"], t: number, scale: number, bg: string, w: number, hh: number): string {
  __resetPoseState();
  const p = {
    side: "left", isAI: false,
    theme: { main: sk?.main ?? "#f5f2e6", dark: sk?.dark ?? "#8a6a1c", glow: sk?.glow ?? "#ffd24d", name: sk?.name ?? "x" },
    jersey: "01", aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 0, y: CO.groundY, vx: 0, vy: 0, px: 0, py: CO.groundY, homeX: 0,
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
    playerSkin: sk, hideTag: true, groundY: CO.groundY,
    faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
  } as unknown as Player;
  const vp: Viewport = { x: (wx: number) => wx, y: (wy: number) => CO.groundY - wy };
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], vp, p, t, 0, null);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}">
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(${w / 2}, ${hh - 14}) scale(${scale}, ${-scale})">${opsToSvg(g.ops)}</g>
</svg>`;
}

function emit(): void {
  const keys = Object.keys(AURA_COLORS);
  const FRAMES = [0, 14, 28, 42, 56, 70];
  const parts: string[] = [];

  // 新旧对照:每格上旧下新,同一帧时钟、同一尺度
  const cmp: string[] = [];
  for (const [label, sc, bg] of [["实机 1:1 · 亮球场", 1.15, COURT], ["放大 2.4× · 暗商店底", 2.4, DARK]] as const) {
    for (const t of [0, 28, 56]) {
      cmp.push(`<span class="lab">${label} · t=${t} · 旧(两根光滑椭圆环 + 三颗圆点)</span>`
        + frame(legacySigil(t, 1, 1), sc, bg, 250, 120)
        + `<span class="lab">${label} · t=${t} · 新(六层法阵)</span>`
        + frame(sigil({ t }).ops, sc, bg, 250, 120));
    }
  }
  parts.push(sheet("新旧对照(每格上旧下新)", cmp, 3));

  for (const key of keys) {
    const cells = FRAMES.map((t) => {
      const ops = sigil({ t, key, kx: 1, ky: 1 }).ops;
      return `<span class="lab">t=${t}</span>` + frame(ops, 2.6, DARK, 240, 132)
        + frame(ops, 2.6, COURT, 240, 132);
    });
    parts.push(sheet(`法阵本体 · ${key}(暗场 / 亮场对照)`, cells, 6));
  }

  // 实机尺度:整人 + 法阵,看它到底压不压得住、会不会糊到腿
  for (const id of ["p-king", "p-sage"]) {
    const sk = CFG.skins.player.find((s) => s.id === id);
    if (!sk) continue;
    const cells = [0, 30, 60, 90].map((t) =>
      `<span class="lab">t=${t} · 实机 1:1</span>` + playerFrame(sk, t, 1.15, COURT, 200, 190)
      + `<span class="lab">t=${t} · 放大 2.4×</span>` + playerFrame(sk, t, 2.4, DARK, 260, 300));
    parts.push(sheet(`整人对照 · ${sk.name}(aura: ${sk.aura})`, cells, 4));
  }

  // 商店两种尺度:卡片 0.6× 缩略图 / 试衣间 1.5×
  const shopCells: string[] = [];
  for (const id of ["p-king", "p-sage"]) {
    const sk = CFG.skins.player.find((s) => s.id === id);
    if (!sk) continue;
    shopCells.push(`<span class="lab">卡片 0.6×(静止)</span>` + playerFrame(sk, 0, 0.6, "#1a1f2e", 120, 110));
    shopCells.push(`<span class="lab">试衣间 1.5×(t=0 / 45)</span>`
      + playerFrame(sk, 0, 1.5, "#0d1220", 170, 200) + playerFrame(sk, 45, 1.5, "#0d1220", 170, 200));
  }
  parts.push(sheet("商店尺度", shopCells, 4));

  const page = (body: string[]): string =>
    `<!doctype html><meta charset="utf-8"><title>legendary aura preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:20px}
h2{font-size:14px;margin:0 0 8px;color:#ffe14d;font-weight:600}
.grid{display:grid;gap:10px}
.c{background:#151a26;padding:8px;border-radius:6px;text-align:center}
.c svg{display:block;margin:2px auto;border-radius:4px}
.lab{display:block;color:#7e8aa3;font-size:11px;margin-top:4px}
.sep{height:18px}
</style>${body.join("")}`;
  fs.writeFileSync(`${OUT}/aura.html`, page(parts));
  // 「整人对照」单独再落一张:一页 3400px 高的图缩到屏幕上看不出细节,
  // 想判「法阵压不压得住、有没有糊到腿」只截这一页
  const nSig = Object.keys(AURA_COLORS).length;
  fs.writeFileSync(`${OUT}/aura-people.html`, page(parts.slice(1 + nSig)));
  fs.writeFileSync(`${OUT}/aura-sigil.html`, page(parts.slice(0, 1 + nSig)));
  for (const key of keys) {
    const ops = sigil({ t: 28, key }).ops;
    fs.writeFileSync(`${OUT}/sigil-${key}.svg`, frame(ops, 3.2, DARK, 300, 170));
  }
  console.log(`\n出图:${OUT}/aura.html(+ sigil-*.svg)`);
}

if (process.argv.includes("--selftest")) {
  runChecks("基线(正常配置)");
  if (fails !== 0) { console.log(`\n基线就没过(${fails} 条),反例自检无意义`); process.exit(1); }
  const bad = runSelftest();
  console.log(bad === 0 ? "\n✅ 反例全部被拦下" : `\n❌ ${bad} 条反例漏网`);
  process.exit(bad === 0 ? 0 : 1);
}

runChecks("基线(正常配置)");
emit();
if (fails > 0) { console.log(`\n❌ ${fails} 条判据未过`); process.exit(1); }
console.log("✅ 全部判据通过");
