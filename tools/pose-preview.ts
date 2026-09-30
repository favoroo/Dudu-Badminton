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
//   node .tools-build/tools/pose-preview.js --faces    # 面部款式 × 表情网格(商店脸面配色验收)
//
// 断言为什么能锁定远臂:远臂是 drawPlayer 里**第一个 stroke()**(影子是 fill),笔画
// 顺序确定。旧代码是一条 3 点折线;新代码是「深袖 2 点 + 肤色小臂 2 点 + 手盘 fill」。
// ============================================================

// 顺序即语义:cc-stub 必须排在 sprites 之前。它在模块求值时就把 Module._load 打了补丁,
// 之后 sprites.ts 里的 require("cc") 才会命中替身。这里用静态 import 而不是动态 require,
// 因为 tsc 只顺着静态 import 建模块图 —— 动态 require 会让 sprites.ts 根本不参与编译、
// 不会被 emit 到 .tools-build。
import { installCc, Graphics as StubGraphics, StubOp, opPoints, opsToSvg } from "./cc-stub";
import { __resetPoseState, drawHeadStill, drawPlayer, drawRacketStill, Viewport } from "../assets/scripts/render/sprites";
import { CFG } from "../assets/scripts/core/config";
import { Ball, FaceKind, Player, SwingStyle } from "../assets/scripts/core/types";

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

interface Named { name: string; held: boolean; holdBall?: boolean; bigHand?: boolean; foot?: "planted"; p: Player; ball?: Ball; ops?: StubOp[] }

// 发球托球:p 与 ball.owner 必须是同一实例(drawPlayer 里用 === 判持球归属)。
// 球按 rules.handX/handY 同源数值摆:非持拍手自然后摆的手心 x-28、0.515H
const hold: Named = (() => {
  const p = mkPlayer();
  return { name: "serve-hold 发球托球", held: true, holdBall: true, bigHand: true, p,
    ball: mkBall({ x: p.x - 28, y: CO.groundY - CFG.player.h * 0.515, live: false, held: true, owner: p }) };
})();

// 发球接球半程:球飞回手(flyT=6/12)途中,持拍臂向 SERVE_POSE 渐入(serveK≈0.93)、
// 屈膝沉降同步落位 —— 验「球落手的同时拍沉下去」而不是瞬间切换。
// owner 必须与 p 同实例(serveK 用 === 判持球归属),否则权重不生效
const catchMid: Named = (() => {
  const p = mkPlayer();
  return { name: "serve-catch 接球半程", held: false, bigHand: true, p,
    ball: mkBall({ flying: true, flyT: 6, live: false, held: false, owner: p, x: 280, y: CO.groundY - 60 }) };
})();

/** held = 会持续保持几十帧的姿势(待机/跑动/空中/跨步/情绪);反之为只存在几帧的过渡姿势。
 *  为什么要分:肘折角 ≥28° 这条只对 held 姿势成立 —— 手臂从「垂在身后」抬到「举在头后」时
 *  前臂必须绕肘翻折方向,中途必然经过伸直(旧代码的 recover 中点 bend 恰好过 0)。那是真实
 *  手臂的样子,不是棍子。棍子的判据是「长期保持的姿势看不出肘」+「没有手」+「整条同色」,
 *  所以过渡姿势改由两条恒等不变量兜底:两段等长、有手掌。 */
const POSES: Named[] = [
  { name: "idle 待机", held: true, foot: "planted", p: mkPlayer() },
  { name: "run-fwd 跑动前相", held: true, p: mkPlayer({ runAmt: 1, runPhase: Math.PI / 2, vx: 6 }) },
  { name: "run-lift 跑动抬腿", held: true, p: mkPlayer({ runAmt: 1, runPhase: 0, vx: 6 }) },
  { name: "run-back 跑动后相", held: true, p: mkPlayer({ runAmt: 1, runPhase: -Math.PI / 2, vx: 6 }) },
  { name: "air 空中", held: true, p: mkPlayer({ onGround: false, vy: -2, runAmt: 0 }) },
  { name: "air-fall 下落展腿", held: true, p: mkPlayer({ onGround: false, vy: 4, runAmt: 0 }) },
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
  { name: "lunge-net 跨步上网", held: true, p: mkPlayer({ lungeT: 7, lungeDir: 1, runAmt: 0.35, vx: 3 }) },
  { name: "lunge-back 跨步后退", held: true, p: mkPlayer({ lungeT: 7, lungeDir: -1, runAmt: 0.35, vx: -3 }) },
  { name: "celebrate 庆祝", held: true, foot: "planted", p: mkPlayer({ ai: mkAi({ celebrateT: 15 }) }) },
  { name: "frustrate 沮丧", held: true, foot: "planted", p: mkPlayer({ ai: mkAi({ frustrateT: 12 }) }) },
  // 来球在右上方:验「远侧手指向来球」只在抬起时轻推、且手不缩回躯干后
  { name: "idle+ball 待机有球", held: true, foot: "planted", p: mkPlayer(), ball: mkBall({ x: 520, y: 250 }) },
  // 来球预备架拍:快速来球逼近(vx=-14 朝我方)→ readyK≈0.95,拍抬到肩前、屈膝沉降、远臂后上平衡
  { name: "ready 架拍", held: true, foot: "planted", p: mkPlayer(), ball: mkBall({ x: 340, y: 280, vx: -14 }) },
  // under 蓄力提跟(poseU≈0.09 引拍期)+ over 蹬伸(接触帧,远侧后腿提跟)
  { name: "under-crouch 蓄力提跟", held: false, p: mkPlayer({ swingT: 2, swingStyle: "under", swingHit: true }) },
  { name: "over-drive 蹬伸", held: false, p: mkPlayer({ swingT: 9, swingStyle: "over", swingHit: true }) },
  // 挥空踉跄:硬直窗中段(swingT=19 > windup+active),躯干前冲 + 远臂划大弧
  { name: "whiff 挥空踉跄", held: false, p: mkPlayer({ swingT: 19, swingStyle: "over", swingHit: false }) },
  // 收拍回弹峰值:easeOutBack 过冲顶点在 recK≈0.64 → recoverT≈3.6,拍子甩过头一点
  { name: "recover-end 回弹", held: false, p: mkPlayer({ swingT: -1, recoverT: 4, swingStyle: "over", lastSwingStyle: "over" }) },
  // 发球接球半程:球飞回手途中(flyT=6/12),持拍臂向 SERVE_POSE 渐入、屈膝沉降同步落位
  catchMid,
  // 发球挥拍(serveSwing=true):松球(f2,远臂还在托球位附近)、发力中段(f8)、随挥(f14)。
  // 持拍臂从 SERVE_POSE 低持位出发,远臂走松球专属轨迹(206/250 → 170/198)
  { name: "serve-swing-f2 松球", held: false, p: mkPlayer({ swingT: 2, swingStyle: "under", swingHit: true, serveSwing: true }) },
  { name: "serve-swing-f8 发力", held: false, p: mkPlayer({ swingT: 8, swingStyle: "under", swingHit: true, serveSwing: true }) },
  { name: "serve-swing-f14 随挥", held: false, p: mkPlayer({ swingT: 14, swingStyle: "under", swingHit: true, serveSwing: true }) },
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
  __resetPoseState();
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], VP, p, 0, 0, ball);
  return g.ops;
}

/** 不隔离状态的连续渲染:模拟真实对局的逐帧推进(分腿垫步触发链用) */
function renderCont(p: Player, ball: Ball | null): StubOp[] {
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], VP, p, 0, 0, ball);
  return g.ops;
}

// 分腿垫步条目:readyK 爬升沿触发(纯渲染层状态),用连续渲染推进到包络峰值。
// 垫步是「对手击球瞬间」的反应步,来球信息刚成立(readyK 过阈值)那帧起跳。
// 注意球的高差:球在 y=250 时肩点距离里竖直分量占 150,水平距离要 ≤90(球 x≥390
// 逼近到 x≈380)readyK 才爬得过 0.22 阈值 —— 第一帧先放远处球建立低基线。
{
  const p = mkPlayer();
  renderCont(p, mkBall({ x: 620, y: 250, vx: -12 }));   // 远球:readyK≈0,建立爬升沿基线
  const ball = mkBall({ x: 380, y: 250, vx: -12 });
  renderCont(p, ball);                                   // 逼近:readyK≈0.27 爬过阈值 → 触发
  for (let i = 0; i < 6; i++) renderCont(p, ball);       // 推进到 sin 包络峰值附近
  const peakOps = renderCont(p, ball);                   // 峰值帧直接捕获(隔离渲染会 reset 掉垫步状态)
  POSES.push({ name: "split-step 分腿垫步", held: true, foot: "planted", p, ball, ops: peakOps });
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

// ---- --faces 模式:面部款式 × 表情 网格出图(改脸面配色后的肉眼验收),不做几何断言 ----
//   node .tools-build/tools/pose-preview.js --faces [--out DIR]
// 用商店同款 drawHeadStill(内部就是 drawHead)画大头像;faceT=666 让贴纸走「定格」分支,
// pop 完成且不淡出,每格都能看到表情 + 贴纸的最终成色。
if (process.argv.includes("--faces")) {
  // 全部脸面款式(config.faceStyles 注册表):肤色系支持人物 skinTone 覆写,
  // 这里顺带验一款自定义肤色的可读性(萌芽豆丁式的暖肤)
  const STYLE_KEYS = Object.keys(CFG.faceStyles);
  const STYLES: { label: string; style: string }[] = STYLE_KEYS.map((k) => ({ label: `${k}`, style: k }));
  STYLES.push({ label: "skin+tan 自定义肤色", style: "skin" });
  const EXPRS: FaceKind[] = ["normal", "fierce", "star", "wow", "oops", "happy", "sad", "cheer", "ko"];
  const RED = { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a", name: "red" };
  // 方形小画布,头像居中(单位视口 y 取负 = 预翻转,给外层 scale(6,-6) 再翻回来);
  // 画布右侧留出贴纸位(头侧 +hr*1.12 处的星/泡/汗滴/爱心不能被裁掉)
  const VP2: Viewport = { x: (wx: number) => wx, y: (wy: number) => -wy };
  const faceSvg = (ops: StubOp[], bg: string, title: string): string => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="340" viewBox="0 0 340 340">
<title>${title}</title>
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(170,170) scale(6,-6)">
${opsToSvg(ops)}
</g>
</svg>`;
  };
  const headSvg = (style: string, expr: FaceKind, bg: string, tan: boolean): string => {
    const g = new StubGraphics();
    drawHeadStill(g as unknown as Parameters<typeof drawHeadStill>[0], VP2, 0, 0, 1, RED, style, expr, 0.4,
      tan ? "#e0a878" : undefined);
    return faceSvg(g.ops, bg, `${style}-${expr}`);
  };
  const cells: string[] = [];
  for (const { label, style } of STYLES) {
    const tan = style.includes("tan");
    const key = tan ? "skin" : style;
    for (const expr of EXPRS) {
      // 单张 SVG 一并落盘(face-<款>-<表情>.svg / .light.svg),供转 PNG 做视觉验收
      const s = headSvg(key, expr, "#12161f", tan), l = headSvg(key, expr, "#d8ecd2", tan);
      const file = `${style}-${expr}`;
      fs.writeFileSync(`${OUT}/face-${file}.svg`, s);
      fs.writeFileSync(`${OUT}/face-${file}.light.svg`, l);
      cells.push(`<div class="c"><b>${label} · ${expr}</b>` +
        `<div class="pair">${s}${l}</div></div>`);
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>face preview</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:8px;text-align:center}
.c b{display:block;margin-bottom:6px;font-weight:600}
.c svg{max-width:292px;height:auto}
.pair{display:flex;gap:4px;justify-content:center}</style>
<h2>面部款式 × 表情预览(左:暗球场底 / 右:亮球场底)</h2>
<div class="grid">${cells.join("")}</div>
`;
  fs.writeFileSync(`${OUT}/faces.html`, html);
  console.log(`面部款式预览: ${OUT}/faces.html(${STYLES.length} 款 × ${EXPRS.length} 表情 × 暗/亮两底)`);
  process.exit(0);
}

// ---- --rackets 模式:全 8 款球拍皮肤特写网格出图(验收球拍机械结构与工业质感) ----
//   node .tools-build/tools/pose-preview.js --rackets [--out DIR]
if (process.argv.includes("--rackets")) {
  const rackets = CFG.skins.racket;
  const VP2: Viewport = { x: (wx: number) => wx, y: (wy: number) => -wy };
  const racketSvg = (ops: StubOp[], bg: string, title: string): string => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
<title>${title}</title>
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(240, 405) scale(6.2, -6.2)">
${opsToSvg(ops)}
</g>
</svg>`;
  };
  const renderRacketCard = (sk: typeof rackets[0], bg: string): { svg: string; ops: StubOp[] } => {
    const g = new StubGraphics();
    const p = mkPlayer({ racketSkin: sk });
    drawRacketStill(g as unknown as Parameters<typeof drawRacketStill>[0], VP2, 0, 0, 1, p);
    return { svg: racketSvg(g.ops, bg, `${sk.name} (${sk.id})`), ops: g.ops };
  };

  const cells: string[] = [];
  let racketFails = 0;
  for (const sk of rackets) {
    const dark = renderRacketCard(sk, "#10131c");
    const light = renderRacketCard(sk, "#dce5d8");
    fs.writeFileSync(`${OUT}/racket-${sk.id}.svg`, dark.svg);
    fs.writeFileSync(`${OUT}/racket-${sk.id}.light.svg`, light.svg);

    // 针对每款球拍的几何结构断言:拍框 stroke 必须完整存在
    const hasFrameStroke = dark.ops.some((o) => o.kind === "stroke" && o.cmds.length >= 36);
    if (!hasFrameStroke) {
      console.error(`✗ 球拍 ${sk.name} (${sk.id}) 拍框未正确描边(stroke 缺失)`);
      racketFails++;
    }

    cells.push(`<div class="c"><b>${sk.name}</b> <span class="tag">${sk.id}</span>
      <div class="meta">手胶: <span class="dot" style="background:${sk.grip || '#20242f'}"></span> 中杆: <span class="dot" style="background:${sk.shaft || '#efe7d8'}"></span> 拍框: <span class="dot" style="background:${sk.frame || '#ff8a6a'}"></span></div>
      <div class="pair">${dark.svg}${light.svg}</div></div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>racket preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:10px;padding:12px;text-align:center}
.c b{font-size:15px;color:#fff}
.tag{font-size:11px;color:#7e8b9b;margin-left:4px}
.meta{margin:8px 0;font-size:12px;color:#94a3b8;display:flex;align-items:center;justify-content:center;gap:6px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(255,255,255,0.4)}
.c svg{max-width:145px;height:auto;border-radius:6px}
.pair{display:flex;gap:8px;justify-content:center}
</style>
<h2>球拍全款式工业精修特写(左:暗色球场底 / 右:明亮球场底)</h2>
<p style="color:#8ca0b8">包含:防脱底盖/烫金底标、螺旋吸汗手胶、封口胶带、控制锥盖、高模量立体中杆、内置T头加固喉部、现代方头破风拍框、高张力内嵌拍弦、专属贴花徽记</p>
<div class="grid">${cells.join("")}</div>
`;
  fs.writeFileSync(`${OUT}/rackets.html`, html);
  console.log(`球拍款式预览: ${OUT}/rackets.html(${rackets.length} 款 × 暗/亮两底)`);
  if (racketFails > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// ---- --chars 模式:全人物形象档案(每款角色 idle/run/lunge 三姿势 × 暗/亮底) ----
//   node .tools-build/tools/pose-preview.js --chars [--out DIR]
// 验收人物形象系统:发型/头饰/脸面/球衣纹样/体型档在真实姿势下的组合效果。
if (process.argv.includes("--chars")) {
  const chars = CFG.skins.player;
  const VP2: Viewport = { x: (wx: number) => wx, y: (wy: number) => -wy };
  const charSvg = (ops: StubOp[], bg: string, title: string): string => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="430" viewBox="0 0 300 430">
<title>${title}</title>
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(150, 385) scale(3.0, -3.0)">
${opsToSvg(ops)}
</g>
</svg>`;
  };
  const renderChar = (sk: typeof chars[0], act: "idle" | "run" | "lunge", bg: string): { svg: string; ops: StubOp[] } => {
    __resetPoseState();
    const p = mkPlayer({
      theme: { main: sk.main ?? "#ff4d4d", dark: sk.dark ?? "#a8202c", glow: sk.glow ?? "#ff8a6a", name: sk.name },
      playerSkin: sk,
      // 模拟真人装备位:applyToMatch 恒挂 faceSkin(默认 face-auto = 跟随人物默认脸)
      faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
      runAmt: act === "run" ? 1 : 0, runPhase: act === "run" ? 0 : 0, vx: act === "run" ? 6 : 0,
      lungeT: act === "lunge" ? 7 : -1, lungeDir: act === "lunge" ? 1 : 0,
    });
    const g = new StubGraphics();
    drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], { x: (wx: number) => wx - 300, y: (wy: number) => CO.groundY - wy }, p, 0.4, 0, null);
    return { svg: charSvg(g.ops, bg, `${sk.name} ${act}`), ops: g.ops };
  };
  const cells: string[] = [];
  for (const sk of chars) {
    const row: string[] = [];
    for (const act of ["idle", "run", "lunge"] as const) {
      const dark = renderChar(sk, act, "#12161f");
      const light = renderChar(sk, act, "#d8ecd2");
      if (act === "idle") {
        fs.writeFileSync(`${OUT}/char-${sk.id}.svg`, dark.svg);
        fs.writeFileSync(`${OUT}/char-${sk.id}.light.svg`, light.svg);
      }
      row.push(`<div class="triple">${dark.svg}${light.svg}</div>`);
    }
    cells.push(`<div class="c"><b>${sk.name}</b> <span class="tag">${sk.id}${sk.body && sk.body !== "standard" ? " · " + sk.body : ""}${sk.face ? " · " + sk.face : ""}</span>
      <div class="acts"><span>待机</span><span>跑动</span><span>跨步</span></div>${row.join("")}</div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>character preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:16px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:10px;padding:12px;text-align:center}
.c b{font-size:15px;color:#fff}
.tag{font-size:11px;color:#7e8b9b;margin-left:4px}
.acts{display:flex;justify-content:space-around;font-size:11px;color:#8ca0b8;margin:6px 0 2px}
.triple{display:flex;gap:4px;justify-content:center}
.c svg{max-width:96px;height:auto;border-radius:6px}
</style>
<h2>全人物形象档案(每款:待机 / 跑动 / 跨步,各暗亮两底)</h2>
<div class="grid">${cells.join("")}</div>
`;
  fs.writeFileSync(`${OUT}/chars.html`, html);
  console.log(`人物形象预览: ${OUT}/chars.html(${chars.length} 款 × 3 姿势 × 暗/亮两底)`);
  process.exit(0);
}

const rows: string[] = [];
let fails = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) fails++;
  rows.push(`  ${ok ? "✓" : "✗"} ${name.padEnd(26)} ${detail}`);
}

const DARK_FULL = "rgba(168,32,44,1.000)";   // 持拍上臂/近侧大腿:th.dark 全不透明(远侧那颗是 0.68/0.78)
const SKIN_FULL = "rgba(242,196,145,1.000)"; // 持拍小臂/近侧膝皮肤:SKIN 全不透明(远侧那颗是 0.62/0.78)
const SOCK_FULL = "rgba(242,239,230,1.000)"; // 近侧球袜 #f2efe6(远侧 #cdc9bd 压暗)

/** 肩部高度线:Graphics y 向上,肩在 ~70、髋在 ~34(单位视口,未压扁)。
 *  近侧大腿/膝皮肤与持拍臂的深袖/小臂同色,按笔画起点的高度区分:手臂起点高于肩线。 */
const SHOULDER_Y = 52;

/** 持拍臂的 肩/肘/手:深袖/小臂与腿段同色,取起点在肩线之上的那条(腿段起点在髋部) */
function nearArm(ops: StubOp[]): Arm | null {
  const up = ops.find((o) => o.kind === "stroke" && o.color === DARK_FULL && (opPoints(o)[0]?.y ?? -99) > SHOULDER_Y);
  const fo = ops.find((o) => o.kind === "stroke" && o.color === SKIN_FULL && (opPoints(o)[0]?.y ?? -99) > SHOULDER_Y);
  if (!up || !fo) return null;
  const a = opPoints(up), b = opPoints(fo);
  if (a.length < 2 || b.length < 2) return null;
  return { sh: a[0], el: a[a.length - 1], hd: b[b.length - 1] };
}

interface Leg { hip: Pt; knee: Pt; ankle: Pt }

/** 近侧腿的 髋/膝/踝:大腿(DARK_FULL,起点低于肩线)→ 膝皮肤段(SKIN_FULL,起点≈膝)
 *  → 球袜(SOCK_FULL,起点≈皮肤段末端)。腿是 legIK 反解的,三段共线链。 */
function nearLeg(ops: StubOp[]): Leg | null {
  const close = (a: Pt | undefined, b: Pt | undefined): boolean =>
    !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 1.6;
  const thigh = ops.find((o) => o.kind === "stroke" && o.color === DARK_FULL && (opPoints(o)[0]?.y ?? 99) < SHOULDER_Y);
  if (!thigh) return null;
  const tp = opPoints(thigh);
  if (tp.length < 2) return null;
  const hip = tp[0], knee = tp[1];
  const skin = ops.find((o) => o.kind === "stroke" && o.color === SKIN_FULL && close(opPoints(o)[0], knee));
  if (!skin) return null;
  const knee2 = opPoints(skin)[opPoints(skin).length - 1];
  const sock = ops.find((o) => o.kind === "stroke" && o.color === SOCK_FULL && close(opPoints(o)[0], knee2));
  if (!sock) return null;
  const sp = opPoints(sock);
  return { hip, knee, ankle: sp[sp.length - 1] };
}

// ---- 逐姿势:出图 + 断言 ----
const sheet: { name: string; dark: string; light: string }[] = [];
for (const { name, held, holdBall, bigHand, foot, p, ball, ops: preOps } of POSES) {
  const ops = preOps ?? render(p, ball ?? null);
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
  // 手盘半径:发球托球/接球姿势的掌心放大到 3.8(兜球手型),其余恒 3.3
  const discTarget = bigHand ? 3.8 : 3.3;
  check(name + " 有手掌", disc !== null && Math.abs(disc - discTarget) <= 0.3,
    disc === null ? "缺手盘(棍子特征)" : `r=${disc.toFixed(2)} (期望 ${discTarget})`);

  // 球拍完整性:拍框外圈 stroke 必须存在(点数 ≥ 36,杜绝 fill 吃掉 path 导致无边框的 bug)
  const hasFrame = ops.some((o) => o.kind === "stroke" && o.cmds.length >= 36);
  check(name + " 拍框描边完整", hasFrame, hasFrame ? "包含立体拍框" : "拍框描边丢失");

  // 持拍臂两段等长(armIK 的不变量,与远臂同一条):手钉弧线时肘不再漂移
  const na = nearArm(ops);
  if (na && na.hd) {
    const nUa = Math.hypot(na.el.x - na.sh.x, na.el.y - na.sh.y);
    const nFa = Math.hypot(na.hd.x - na.el.x, na.hd.y - na.el.y);
    check(name + " 近臂等长", Math.abs(nUa - nFa) <= 0.9, `ua=${nUa.toFixed(2)} fa=${nFa.toFixed(2)} (差需 ≤0.9)`);
  } else {
    rows.push(`  · ${name.padEnd(26)} 近臂未解析(跳过等长检查)`);
  }

  // 腿部几何:两段真关节(rig.legIK)的不变量 —— 段长恒定、站立脚贴地、膝折向网侧
  const leg = nearLeg(ops);
  if (leg) {
    const thighL = CFG.player.h * 0.34 * 0.55, shinL = CFG.player.h * 0.34 * 0.45;
    const lThigh = Math.hypot(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y);
    const lShin = Math.hypot(leg.ankle.x - leg.knee.x, leg.ankle.y - leg.knee.y);
    check(name + " 腿段恒长", Math.abs(lThigh - thighL) <= 0.8 && Math.abs(lShin - shinL) <= 0.8,
      `thigh=${lThigh.toFixed(2)}/${thighL.toFixed(1)} shin=${lShin.toFixed(2)}/${shinL.toFixed(1)}`);
    // 膝在髋-踝连线的网侧(+x,facing=1):人腿只能向后弯,反了就是腿画反
    const mx = (leg.hip.x + leg.ankle.x) / 2;
    check(name + " 膝朝网侧", leg.knee.x >= mx - 1.2, `knee.x=${leg.knee.x.toFixed(1)} mid.x=${mx.toFixed(1)}`);
    if (foot === "planted") {
      // 站立类姿势:踝必须贴地(接地约束)。鞋底在踝下方,踝离地过高 = 悬浮
      check(name + " 站立贴地", Math.abs(leg.ankle.y) <= 4, `ankle.y=${leg.ankle.y.toFixed(1)} (需 |y|≤4)`);
    }
  } else {
    check(name + " 腿部几何", false, "近侧腿未解析(大腿/膝皮肤/球袜链断了)");
  }
}

// ---- 连续性:整条时间轴逐帧扫,「远臂不许比持拍臂更跳」 ----
// 为什么用相对口径:blendIn 只有 3 帧(50ms),持拍臂在这 3 帧里从待机手位甩到弧线
// 起点,单帧方向变化本来就有 50~90° —— 那是设计意图,不是 bug。绝对阈值要么松到没意义、
// 要么把正常挥拍判成失败。持拍臂是同一套窗口驱动的基准,拿它当标尺最诚实。
const SWING_FRAMES = SW.windup + SW.active + SW.recover;   // 20

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

// ---- 架拍渐入连续性:来球从远到近扫一遍,远臂依旧不许比持拍臂更跳 ----
// readyK 随来球逼近 smoothstep 爬升,躯干/远臂/持拍臂三条都被同一个权重拉着走;
// 若哪一条(尤其远臂)在爬升中突跳,架拍就会「抖一下」而不是「提起来」。
{
  const armDir = (a: Arm | null): number | null =>
    a && a.hd ? Math.atan2(a.hd.y - a.sh.y, a.hd.x - a.sh.x) * 180 / Math.PI : null;
  let prev: { far: number; near: number } | null = null;
  let wf = 0, wn = 0, at = 0;
  for (let f = 0; f <= 34; f++) {
    // 球从远处飞向肩前(vx=-12 朝我方),readyK 随距离递增
    const ops = render(mkPlayer(), mkBall({ x: 620 - f * 9, y: 250, vx: -12, vy: 2 }));
    const far = armDir(farArm(ops)), near = armDir(nearArm(ops));
    if (prev && far !== null && near !== null) {
      let df = Math.abs(far - prev.far); if (df > 180) df = 360 - df;
      let dn = Math.abs(near - prev.near); if (dn > 180) dn = 360 - dn;
      if (df > wf) { wf = df; wn = dn; at = f; }
    }
    if (far !== null && near !== null) prev = { far, near };
  }
  check("连续性 ready 渐入", wf <= wn + 0.5,
    `远臂单帧最大跳变 ${wf.toFixed(1)}° @f${at} vs 持拍臂 ${wn.toFixed(1)}°`);
}

// ---- 发球:起拍对齐 + 松球轨迹连续性 ----
// 发球是唯一「静止几十帧后起拍」的动作:起拍首帧的显示位必须 ≈ 等待位(SERVE_POSE),
// 否则长等待结束时拍子会跳一下(旧版举拍 68° → 弧线 -34° 的 102° 急翻就发生在这里);
// 挥拍全程远臂(松球专属轨迹)同样不许比持拍臂更跳。
{
  const holdOps = render(hold.p, hold.ball ?? null);
  const f0Ops = render(mkPlayer({ swingT: 0, swingStyle: "under", swingHit: true, serveSwing: true }), null);
  const hp = nearArm(holdOps)?.hd ?? null;
  const sp0 = nearArm(f0Ops)?.hd ?? null;
  const d = hp && sp0 ? Math.hypot(hp.x - sp0.x, hp.y - sp0.y) : 99;
  check("发球起拍对齐", d <= 2.5, `等待位 → 起拍首帧手位差 ${d.toFixed(1)}px (需 ≤2.5)`);

  const armDir = (a: Arm | null): number | null =>
    a && a.hd ? Math.atan2(a.hd.y - a.sh.y, a.hd.x - a.sh.x) * 180 / Math.PI : null;
  // 只扫挥拍段(0..SWING_FRAMES-1):收拍期近臂走 easeOutBack 起步很慢,而远臂要从
  // 松球轨迹终点摆回托球位 —— 「远不许比近更跳」的相对判据在收拍期不成立(常规挥拍
  // 的收拍期能过,只因近臂的 blendIn 大跳把整条时间轴的上限抬高了,发球起拍已无大跳)
  const sv = (f: number): { far: number | null; near: number | null } => {
    const p = mkPlayer({ swingT: f, swingStyle: "under", swingHit: true, serveSwing: true });
    const ops = render(p, null);
    return { far: armDir(farArm(ops)), near: armDir(nearArm(ops)) };
  };
  let wfs = 0, wns = 0, atS = 0, prevS: { far: number; near: number } | null = null;
  for (let f = 0; f < SWING_FRAMES; f++) {
    const { far, near } = sv(f);
    if (prevS && far !== null && near !== null) {
      let df = Math.abs(far - prevS.far); if (df > 180) df = 360 - df;
      let dn = Math.abs(near - prevS.near); if (dn > 180) dn = 360 - dn;
      if (df > wfs) { wfs = df; wns = dn; atS = f; }
    }
    if (far !== null && near !== null) prevS = { far, near };
  }
  check("连续性 serve 松球", wfs <= wns + 0.5,
    `远臂单帧最大跳变 ${wfs.toFixed(1)}° @f${atS} vs 持拍臂 ${wns.toFixed(1)}°`);
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
