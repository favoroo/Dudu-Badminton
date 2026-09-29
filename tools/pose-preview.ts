// ============================================================
// 姿势预览 / 远臂几何断言 —— 一次性验证脚本,不属于游戏运行时代码。
//
// 为什么能这么干:Cocos 构建产物在内置浏览器里永久 hang(HANDOFF.md 已记录),而本工程
// 的角色是**纯 cc.Graphics 折线/圆**、零图片零骨骼 —— 把 Graphics 换成"记录每一笔画"的
// 替身,就能在 node 里把 drawPlayer 直接 dump 成 SVG,肉眼比对姿势改动,不必启动编辑器,
// 也不用跑一次 30s 构建。
//
// 依赖已核对:sprites.ts 的运行时 cc 依赖只有 Color(palette.ts 的 new Color(r,g,b,a))
// 与 Graphics(文件头 Graphics.LineCap 是值用法);Physics/CFG/utils 都不 import cc;
// Viewport 只是 {x,y} 两个函数。
//
// 用法(在仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/pose-preview.js            # 出图 + 断言,有失败则 exit 1
//   node .tools-build/tools/pose-preview.js --out DIR  # 换输出目录
//
// 断言为什么能锁定远臂:远臂是 drawPlayer 里**第一个 stroke()**(影子是 fill),笔画
// 顺序确定。旧代码是一条 3 点折线;新代码是「深袖 2 点 + 肤色小臂 2 点 + 手盘 fill」。
// ============================================================

// 顺序即语义:cc-stub 必须排在 sprites 之前。它在模块求值时就把 Module._load 打了补丁,
// 之后 sprites.ts 里的 require("cc") 才会命中替身。这里用静态 import 而不是动态 require,
// 因为 tsc 只顺着静态 import 建模块图 —— 动态 require 会让 sprites.ts 根本不参与编译、
// 不会被 emit 到 .tools-build。
import { installCc, Graphics as StubGraphics, StubOp, opPoints, opsToSvg } from "./cc-stub";
import { drawPlayer, Viewport } from "../assets/scripts/render/sprites";
import { CFG } from "../assets/scripts/core/config";
import { Player, Ball, SwingStyle } from "../assets/scripts/core/types";

installCc();   // 幂等;真正的打补丁发生在 cc-stub 求值时

const CO = CFG.court, SW = CFG.swing;

/** 单位视口:不缩放,只做「世界(canvas,y 向下)→ Graphics(y 向上)」翻转 + 把球员摆到原点。
 *  人物脚底落在 (0,0),朝上为正;翻转与显示缩放交给 SVG 外层的 <g transform>。 */
const VP: Viewport = { x: (wx: number) => wx - 300, y: (wy: number) => CO.groundY - wy };

// ---------- 最小可用实体(字段形状对齐 career-panel 的 dummyPlayer) ----------

function mkPlayer(ov: Partial<Player> = {}): Player {
  return {
    side: "left", isAI: false,
    theme: { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a", name: "red" },
    jersey: "01",
    aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 300, y: CO.groundY, vx: 0, vy: 0, px: 300, py: CO.groundY, homeX: 300,
    facing: 1, onGround: true, coyote: 0, jumpBuf: 0,
    sq: 1, sqPrev: 1, recoverT: 0,
    runPhase: 0, runAmt: 0, runStep: 0, blinkSeed: 0,
    swingT: -1, swingStyle: "over", swingHit: false,
    swingQ: 0, swingBuf: 0, swingBufAim: null, swingAim: "mid",
    swingRadius: 52,
    racket: { x: 0, y: 0, ang: 0 }, racketPrev: { x: 0, y: 0 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0,
    zoneScale: 1, score: 0, smashGlow: 0, sweetGlow: 0, perfectGlow: 0, heat: 0,
    hitRecoil: 0, lungeT: -1, lungeDir: 0, lungeCd: 0, lungeShotT: 0,
    stats: { hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0 },
    hideTag: true, groundY: CO.groundY,
    ...ov,
  };
}

function mkAi(ov: Partial<NonNullable<Player["ai"]>> = {}): NonNullable<Player["ai"]> {
  return {
    tick: 0, targetX: 300, serveT: 0, wantSmash: false, ic: null, swingLead: null,
    chasing: false, emotion: 0, tauntCd: 0, celebrateT: 0, frustrateT: 0, ...ov,
  };
}

function mkBall(ov: Partial<Ball> = {}): Ball {
  return {
    x: 300, y: 300, px: 300, py: 300, vx: -6, vy: 3,
    live: true, held: false, owner: null,
    lastHitter: null, crossed: false, netted: false, ...ov,
  } as Ball;
}

// ---------- 姿势清单 ----------

interface Named { name: string; held: boolean; holdBall?: boolean; p: Player; ball?: Ball }

// 发球托球:p 与 ball.owner 必须是同一实例(drawPlayer 里用 === 判持球归属)。
// 球按 rules.handX/handY 同源数值摆:非持拍手自然后摆的手心 x-28、0.515H
const hold: Named = (() => {
  const p = mkPlayer();
  return { name: "serve-hold 发球托球", held: true, holdBall: true, p,
    ball: mkBall({ x: p.x - 28, y: CO.groundY - CFG.player.h * 0.515, live: false, held: true, owner: p }) };
})();

/** held = 会持续保持几十帧的姿势(待机/跑动/空中/跨步/情绪);反之为只存在几帧的过渡姿势。
 *  为什么要分:肘折角 ≥28° 这条只对 held 姿势成立 —— 手臂从「垂在身后」抬到「举在头后」时
 *  前臂必须绕肘翻折方向,中途必然经过伸直(旧代码的 recover 中点 bend 恰好过 0)。那是真实
 *  手臂的样子,不是棍子。棍子的判据是「长期保持的姿势看不出肘」+「没有手」+「整条同色」,
 *  所以过渡姿势改由两条恒等不变量兜底:两段等长、有手掌。 */
const POSES: Named[] = [
  { name: "idle 待机", held: true, p: mkPlayer() },
  { name: "run-fwd 跑动前相", held: true, p: mkPlayer({ runAmt: 1, runPhase: Math.PI / 2, vx: 6 }) },
  { name: "run-back 跑动后相", held: true, p: mkPlayer({ runAmt: 1, runPhase: -Math.PI / 2, vx: 6 }) },
  { name: "air 空中", held: true, p: mkPlayer({ onGround: false, vy: -2, runAmt: 0 }) },
  { name: "over-windup 引拍", held: false, p: mkPlayer({ swingT: 0, swingStyle: "over", swingHit: true }) },
  // blendIn 只有 3 帧,swingT=0 那帧远臂还停在待机角 —— 想验「两臂同举指来球」必须看过渡末帧。
  // 球放在右上方,顺带验 ±12° 的轻推有没有把手推出背缘/推进后脑遮挡圆。
  { name: "over-blend 引拍到位", held: false, p: mkPlayer({ swingT: 3, swingStyle: "over", swingHit: true }),
    ball: mkBall({ x: 560, y: 230 }) },
  { name: "over-early 下压初段", held: false, p: mkPlayer({ swingT: 6, swingStyle: "over", swingHit: true }),
    ball: mkBall({ x: 560, y: 230 }) },
  { name: "over-contact 击球", held: false, p: mkPlayer({ swingT: 9, swingStyle: "over", swingHit: true }) },
  { name: "over-follow 随挥", held: false, p: mkPlayer({ swingT: 19, swingStyle: "over", swingHit: true }) },
  { name: "under-start 挑球起手", held: false, p: mkPlayer({ swingT: 0, swingStyle: "under", swingHit: true }) },
  { name: "under-end 挑球收势", held: false, p: mkPlayer({ swingT: 19, swingStyle: "under", swingHit: true }) },
  { name: "recover 收拍", held: false, p: mkPlayer({ swingT: -1, recoverT: 3, swingStyle: "over", lastSwingStyle: "over" }) },
  { name: "lunge-net 跨步上网", held: true, p: mkPlayer({ lungeT: 7, lungeDir: 1, runAmt: 0.8, vx: 3 }) },
  { name: "lunge-back 跨步后退", held: true, p: mkPlayer({ lungeT: 7, lungeDir: -1, runAmt: 0.8, vx: -3 }) },
  { name: "celebrate 庆祝", held: true, p: mkPlayer({ ai: mkAi({ celebrateT: 15 }) }) },
  { name: "frustrate 沮丧", held: true, p: mkPlayer({ ai: mkAi({ frustrateT: 12 }) }) },
  // 来球在右上方:验「远侧手指向来球」只在抬起时轻推、且手不缩回躯干后
  { name: "idle+ball 待机有球", held: true, p: mkPlayer(), ball: mkBall({ x: 520, y: 250 }) },
  // 发球托球:球钉在 rules.handX/handY(x-facing*28、y-0.515H),远臂后摆手心托球。
  // holdBall = 断言换成「手正好托在球下」—— 肘/手在体侧属于本姿势的预期,不走背缘外露检查。
  // 注意 p 与 ball.owner 必须是同一实例(drawPlayer 里用 === 判持球归属)
  hold,
];

// ---------- 远臂几何反解 ----------

interface Pt { x: number; y: number }
interface Arm { sh: Pt; el: Pt; hd: Pt | null }

/** 从笔画序列反解远臂的 肩/肘/手。
 *  旧代码:stroke#1 一条 3 点折线。
 *  新代码:stroke#1 = 深袖 2 点,stroke#2 = 肤色小臂 2 点(首点与袖末点重合)→ 拼成 3 点。 */
function farArm(ops: StubOp[]): Arm | null {
  const strokes = ops.filter((o) => o.kind === "stroke");
  if (!strokes.length) return null;
  const a = opPoints(strokes[0]);
  if (a.length >= 3) return { sh: a[0], el: a[1], hd: a[2] };
  if (a.length < 2) return null;
  if (strokes.length < 2) return { sh: a[0], el: a[1], hd: null };
  const b = opPoints(strokes[1]);
  if (b.length < 2 || Math.hypot(b[0].x - a[1].x, b[0].y - a[1].y) > 0.6) {
    return { sh: a[0], el: a[1], hd: null };
  }
  return { sh: a[0], el: a[1], hd: b[b.length - 1] };
}

/** 手盘:远臂笔画之后、质心落在手位附近的一个 fill 环(circleAA 自采样 36 段) */
function handDisc(ops: StubOp[], arm: Arm): number | null {
  if (!arm.hd) return null;
  let strokesSeen = 0;
  for (const o of ops) {
    if (o.kind === "stroke") { if (++strokesSeen > 2) break; continue; }
    const pts = opPoints(o);
    if (pts.length < 20) continue;                 // 影子(单个 ellipse)不算手盘
    const c = { x: 0, y: 0 };
    for (const q of pts) { c.x += q.x / pts.length; c.y += q.y / pts.length; }
    if (Math.hypot(c.x - arm.hd.x, c.y - arm.hd.y) > 1.5) continue;
    let r = 0;
    for (const q of pts) r = Math.max(r, Math.hypot(q.x - c.x, q.y - c.y));
    return r;
  }
  return null;
}

/** 肘折角(度):相邻两段方向向量的夹角。手臂伸直 = 0(棍子),折叠越多值越大。
 *  旧代码实测 4.8°~55.3° 乱跳(手位是硬点、肘位是定值,两段还不等长) */
function deflection(a: Arm): number {
  if (!a.hd) return 0;
  const t1 = Math.atan2(a.el.y - a.sh.y, a.el.x - a.sh.x);
  const t2 = Math.atan2(a.hd.y - a.el.y, a.hd.x - a.el.x);
  let d = Math.abs((t2 - t1) * 180 / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// ---------- 跑 ----------

function render(p: Player, ball: Ball | null): StubOp[] {
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], VP, p, 0, 0, ball);
  return g.ops;
}

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/pose-preview";
})();

const fs = require("fs") as typeof import("fs");
fs.mkdirSync(OUT, { recursive: true });

const SCALE = 3.2, OX = 230, OY = 560;
function svg(ops: StubOp[], bg: string, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OX * 2}" height="${OY + 30}" viewBox="0 0 ${OX * 2} ${OY + 30}">
<title>${title}</title>
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(${OX},${OY}) scale(${SCALE},${-SCALE})">
${opsToSvg(ops)}
</g>
</svg>`;
}

const rows: string[] = [];
let fails = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) fails++;
  rows.push(`  ${ok ? "✓" : "✗"} ${name.padEnd(26)} ${detail}`);
}

// ---- 逐姿势:出图 + 断言 ----
const sheet: { name: string; dark: string; light: string }[] = [];
for (const { name, held, holdBall, p, ball } of POSES) {
  const ops = render(p, ball ?? null);
  const arm = farArm(ops);
  const file = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");   // 中文名只留 ASCII 段做文件名
  const dark = svg(ops, "#12161f", name), light = svg(ops, "#d8ecd2", name);
  fs.writeFileSync(`${OUT}/${file}.svg`, dark);
  fs.writeFileSync(`${OUT}/${file}.light.svg`, light);
  sheet.push({ name, dark, light });
  if (!arm) { check(name, false, "没找到任何笔画"); continue; }

  // Graphics 的 y 向上 → 折回 B 帧局部坐标(y 向下,+x 朝网)。facing=1 且未压扁时 x 直接可比。
  const rel = (q: Pt): Pt => ({ x: q.x - arm.sh.x, y: -(q.y - arm.sh.y) });
  const el = rel(arm.el), hd = arm.hd ? rel(arm.hd) : null;
  const def = deflection(arm);
  const lUa = Math.hypot(arm.el.x - arm.sh.x, arm.el.y - arm.sh.y);
  const lFa = arm.hd ? Math.hypot(arm.hd.x - arm.el.x, arm.hd.y - arm.el.y) : 0;
  const disc = handDisc(ops, arm);

  if (holdBall && ball) {
    // 托球姿势:断言换成「手托在球下」。球按 rules.handX/handY 同源数值摆,手/球偏差
    // >2.5 判脱手(呼吸微摆 ±1.5° 折算 ~1px,留了余量)。远臂在体前是本姿势的预期,
    // 背缘外露两条检查不适用 —— 否则好姿势反而报错。
    const brel = { x: VP.x(ball.x) - arm.sh.x, y: -((CO.groundY - ball.y) - arm.sh.y) };
    const gap = hd ? Math.hypot(hd.x - brel.x, hd.y - brel.y) : 99;
    check(name + " 手托在球下", gap <= 2.5, `hand-ball gap=${gap.toFixed(1)} (需 ≤2.5)`);
  } else {
    check(name + " 肘外露", el.x <= -9.5, `elbow.x=${el.x.toFixed(1)} (需 ≤ -9.5)`);
    check(name + " 手外露", !!hd && hd.x <= -9.5, hd ? `hand.x=${hd.x.toFixed(1)}` : "无手");
  }
  // 肘折只对 held 姿势设地板值;过渡姿势伸直是真实手臂,由下面两条不变量兜底
  if (held) check(name + " 肘折可见", def >= 28, `deflection=${def.toFixed(1)}° (需 ≥28°)`);
  else rows.push(`  · ${name.padEnd(26)} 过渡姿势,肘折 ${def.toFixed(1)}°(伸直合法,不设地板)`);
  check(name + " 两段等长", Math.abs(lUa - 16) <= 0.6 && Math.abs(lFa - 14.5) <= 0.6,
    `ua=${lUa.toFixed(2)} fa=${lFa.toFixed(2)}`);
  check(name + " 有手掌", disc !== null && Math.abs(disc - 3.3) <= 0.3,
    disc === null ? "缺手盘(棍子特征)" : `r=${disc.toFixed(2)}`);
}

// ---- 连续性:整条时间轴逐帧扫,「远臂不许比持拍臂更跳」 ----
// 为什么用相对口径:blendIn 只有 3 帧(50ms),持拍臂在这 3 帧里从待机手位甩到弧线
// 起点,单帧方向变化本来就有 50~90° —— 那是设计意图,不是 bug。绝对阈值要么松到没意义、
// 要么把正常挥拍判成失败。持拍臂是同一套窗口驱动的基准,拿它当标尺最诚实。
const SWING_FRAMES = SW.windup + SW.active + SW.recover;   // 20
const DARK_FULL = "rgba(168,32,44,1.000)";   // 持拍上臂:th.dark 全不透明(远侧那颗是 0.68)
const SKIN_FULL = "rgba(242,196,145,1.000)"; // 持拍小臂:SKIN 全不透明(远侧那颗是 0.62)

/** 持拍臂的 肩/肘/手:靠 alpha=1 的专属配色认,新旧代码都成立(远侧两段都压了 alpha) */
function nearArm(ops: StubOp[]): Arm | null {
  const up = ops.find((o) => o.kind === "stroke" && o.color === DARK_FULL);
  const fo = ops.find((o) => o.kind === "stroke" && o.color === SKIN_FULL);
  if (!up || !fo) return null;
  const a = opPoints(up), b = opPoints(fo);
  if (a.length < 2 || b.length < 2) return null;
  return { sh: a[0], el: a[a.length - 1], hd: b[b.length - 1] };
}

function dirs(style: SwingStyle, frame: number): { far: number | null; near: number | null } {
  const p = frame < SWING_FRAMES
    ? mkPlayer({ swingT: frame, swingStyle: style, swingHit: true })
    // 收拍段:游戏里 swingT 触到 total 的那一步会先置 recoverT=blendOut 再同帧 --,故首帧是 5
    : mkPlayer({ swingT: -1, recoverT: Math.max(0, SW.blendOut - (frame - SWING_FRAMES) - 1),
      swingStyle: style, lastSwingStyle: style });
  const ops = render(p, null);
  const dir = (a: Arm | null): number | null =>
    a && a.hd ? Math.atan2(a.hd.y - a.sh.y, a.hd.x - a.sh.x) * 180 / Math.PI : null;
  return { far: dir(farArm(ops)), near: dir(nearArm(ops)) };
}

function worstStep(get: (s: SwingStyle, f: number) => number | null, style: SwingStyle): { deg: number; at: number } {
  let worst = 0, at = -1, prev = get(style, 0);
  for (let f = 1; f <= SWING_FRAMES + SW.blendOut + 1; f++) {
    const cur = get(style, f);
    if (prev !== null && cur !== null) {
      let d = Math.abs(cur - prev);
      if (d > 180) d = 360 - d;
      if (d > worst) { worst = d; at = f; }
    }
    prev = cur;
  }
  return { deg: worst, at };
}

for (const style of ["over", "under"] as SwingStyle[]) {
  const cache = new Map<number, { far: number | null; near: number | null }>();
  const g = (s: SwingStyle, f: number) => {
    if (!cache.has(f)) cache.set(f, dirs(s, f));
    return cache.get(f) as { far: number | null; near: number | null };
  };
  const far = worstStep((s, f) => g(s, f).far, style);
  const near = worstStep((s, f) => g(s, f).near, style);
  check(`连续性 ${style}`, far.deg <= near.deg + 0.5,
    `远臂单帧最大跳变 ${far.deg.toFixed(1)}° @f${far.at} vs 持拍臂 ${near.deg.toFixed(1)}° @f${near.at}`);
}

// ---- 汇总 ----
console.log(`远臂几何断言 —— 输出目录 ${OUT}/(每姿势暗/亮两张背景,亮底查压暗是否够读)`);
console.log(rows.join("\n"));
console.log(`\n${fails === 0 ? "全部通过 ✓" : `${fails} 项失败 ✗`}`);

const html = `<!doctype html><meta charset="utf-8"><title>pose preview</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(600px,1fr));gap:14px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:8px;text-align:center}
.c b{display:block;margin-bottom:6px;font-weight:600}
.c svg{max-width:292px;height:auto}
.pair{display:flex;gap:4px;justify-content:center}
pre{white-space:pre-wrap}</style>
<h2>drawPlayer 姿势预览 —— 远侧手臂(左:暗球场底 / 右:亮球场底)</h2>
<pre>${rows.join("\n")}</pre>
<div class="grid">${sheet.map((s) => `<div class="c"><b>${s.name}</b><div class="pair">${s.dark}${s.light}</div></div>`).join("")}</div>
`;
fs.writeFileSync(`${OUT}/index.html`, html);
console.log(`预览页: ${OUT}/index.html`);
process.exit(fails === 0 ? 0 : 1);
