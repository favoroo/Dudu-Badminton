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
//   node .tools-build/tools/pose-preview.js --chars    # 全人物形象 × 待机/跑动/跨步
//   node .tools-build/tools/pose-preview.js --skins    # 全人物形象 × overhead 挥拍逐帧(试衣间)
//   node .tools-build/tools/pose-preview.js --spine-selftest   # 躯干判据的反例(必须判红)
//
// 断言为什么能锁定远臂:远臂是 drawPlayer 里**第一个 stroke()**(影子是 fill),笔画
// 顺序确定。旧代码是一条 3 点折线;新代码是「深袖 2 点 + 肤色小臂 2 点 + 手盘 fill」。
// ============================================================

// 顺序即语义:cc-stub 必须排在 sprites 之前。它在模块求值时就把 Module._load 打了补丁,
// 之后 sprites.ts 里的 require("cc") 才会命中替身。这里用静态 import 而不是动态 require,
// 因为 tsc 只顺着静态 import 建模块图 —— 动态 require 会让 sprites.ts 根本不参与编译、
// 不会被 emit 到 .tools-build。
import { installCc, Color as StubColor, Graphics as StubGraphics, StubOp, opPoints, opsToSvg } from "./cc-stub";
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
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0,
      lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
      deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    hideTag: true, groundY: CO.groundY,
    ...ov,
  };
}

function mkAi(ov: Partial<NonNullable<Player["ai"]>> = {}): NonNullable<Player["ai"]> {
  return {
    tick: 0, targetX: 300, serveT: 0, wantSmash: false, ic: null, swingLead: null,
    readErr: 0, readRolled: false,
    chasing: false, emotion: 0, tauntCd: 0, celebrateT: 0, frustrateT: 0,
    pressure: 0, noticeT: 0, scrambleT: 0, whiffsSeen: 0, panicSwung: false, hopeless: false, ...ov,
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

interface Named { name: string; held: boolean; holdBall?: boolean; bigHand?: boolean; foot?: "planted";
  /** hang = 静止垂挂姿势(待机/架拍/沮丧…):远臂手盘必须**贴着**躯干髋段背缘,离体 >2.5 判「尾巴」 */
  hang?: boolean;
  p: Player; ball?: Ball; ops?: StubOp[] }

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
  { name: "idle 待机", held: true, hang: true, foot: "planted", p: mkPlayer() },
  // 前摆相手压向身体(贴身约束管这一相);后摆手甩到身后属正常步态,只受 6.5 的「不是尾巴」上限
  { name: "run-fwd 跑动前相", held: true, hang: true, p: mkPlayer({ runAmt: 1, runPhase: Math.PI / 2, vx: 6 }) },
  { name: "run-lift 跑动抬腿", held: true, hang: true, p: mkPlayer({ runAmt: 1, runPhase: 0, vx: 6 }) },
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
  { name: "frustrate 沮丧", held: true, hang: true, foot: "planted", p: mkPlayer({ ai: mkAi({ frustrateT: 12 }) }) },
  // 来球在右上方:验「远侧手指向来球」只在抬起时轻推、且手不缩回躯干后
  { name: "idle+ball 待机有球", held: true, hang: true, foot: "planted", p: mkPlayer(), ball: mkBall({ x: 520, y: 250 }) },
  // 来球预备架拍:快速来球逼近(vx=-14 朝我方)→ readyK≈0.95,拍抬到肩前、屈膝沉降、远臂后上平衡
  { name: "ready 架拍", held: true, hang: true, foot: "planted", p: mkPlayer(), ball: mkBall({ x: 340, y: 280, vx: -14 }) },
  // under 蓄力提跟(poseU≈0.09 引拍期)+ over 蹬伸(接触帧,远侧后腿提跟)
  { name: "under-crouch 蓄力提跟", held: false, p: mkPlayer({ swingT: 2, swingStyle: "under", swingHit: true }) },
  { name: "over-drive 蹬伸", held: false, p: mkPlayer({ swingT: 9, swingStyle: "over", swingHit: true }) },
  // 挥空踉跄:硬直窗中段(swingT=19 > windup+active),躯干前冲 + 远臂划大弧(刻意失衡)
  { name: "whiff 挥空踉跄", held: false, p: mkPlayer({ swingT: 19, swingStyle: "over", swingHit: false }) },
  // 收拍回弹峰值:easeOutBack 过冲顶点在 recK≈0.64 → recoverT≈3.6,拍子甩过头一点
  { name: "recover-end 回弹", held: false, p: mkPlayer({ swingT: -1, recoverT: 4, swingStyle: "over", lastSwingStyle: "over" }) },
  // 发球接球半程:球飞回手途中(flyT=6/12),持拍臂向 SERVE_POSE 渐入、屈膝沉降同步落位
  catchMid,
  // 发球挥拍(serveSwing=true):松球(f2,远臂还在托球位附近)、发力中段(f8)、随挥(f14)。
  // 持拍臂从 SERVE_POSE 低持位出发,远臂走松球专属轨迹(206/250 → 232/270 贴身垂挂位);
  // 前几帧手还离体 7~8 —— 那是刻意后伸托球(rules.handX 钉死),held:false 不参与贴身约束。
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

// ---- --skins 模式:皮肤 × overhead 挥拍(试衣间那 2.2s 循环的逐帧摊开) ----
//   node .tools-build/tools/pose-preview.js --skins [--out DIR]
// 为什么单开一个模式:--chars 只画 idle/run/lunge,而 over-* 那几格走 mkPlayer 默认值、
// **不挂 playerSkin** —— 「皮肤 × 过头挥拍」这个组合此前没有任何模式渲染过,腰部台阶与
// 拼色溢出就是这么漏过去的。这里按挥拍帧摊开,亮底专查色块画到背景上、暗底专查接缝。
if (process.argv.includes("--skins")) {
  const SK = CFG.skins.player;
  const total = SW.windup + SW.active + SW.recover;
  const FRAMES = [0, 3, 6, 9, 14, 19];
  const VP2: Viewport = { x: (wx: number) => wx - 300, y: (wy: number) => CO.groundY - wy };
  const skinSvg = (ops: StubOp[], bg: string, title: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="430" viewBox="0 0 300 430">
<title>${title}</title>
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(150, 385) scale(3.0, -3.0)">
${opsToSvg(ops)}
</g>
</svg>`;
  const cells: string[] = [];
  for (const sk of SK) {
    const cols: string[] = [];
    for (const f of FRAMES) {
      __resetPoseState();
      const p = mkPlayer({
        theme: { main: sk.main ?? "#ff4d4d", dark: sk.dark ?? "#a8202c", glow: sk.glow ?? "#ff8a6a", name: sk.name },
        playerSkin: sk,
        faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
        swingT: f, swingStyle: "over", swingHit: false,
      });
      const g = new StubGraphics();
      drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], VP2, p, 0, 0, null);
      if (f === 9) {
        fs.writeFileSync(`${OUT}/swing-${sk.id}.svg`, skinSvg(g.ops, "#12161f", `${sk.name} 发力帧`));
        fs.writeFileSync(`${OUT}/swing-${sk.id}.light.svg`, skinSvg(g.ops, "#d8ecd2", `${sk.name} 发力帧 亮底`));
      }
      cols.push(`<div class="fr"><span>u=${(f / total).toFixed(2)}</span>${
        skinSvg(g.ops, "#12161f", "")}${skinSvg(g.ops, "#d8ecd2", "")}</div>`);
    }
    cells.push(`<div class="c"><b>${sk.name}</b> <span class="tag">${sk.id}${
      sk.body && sk.body !== "standard" ? " · " + sk.body : ""}${sk.jersey ? " · " + sk.jersey : ""}</span>
      <div class="frs">${cols.join("")}</div></div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>skin swing preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(760px,1fr));gap:16px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:10px;padding:12px}
.c b{font-size:15px;color:#fff}
.tag{font-size:11px;color:#7e8b9b;margin-left:4px}
.frs{display:flex;gap:6px;justify-content:center;margin-top:8px}
.fr{text-align:center}
.fr span{font-size:10px;color:#8ca0b8;display:block}
.fr svg{width:88px;height:auto;border-radius:6px}
.fr svg+svg{display:block;margin-top:4px}
</style>
<h2>皮肤 × overhead 挥拍(每款 6 帧,左暗底看接缝 / 右亮底看色块溢出)</h2>
<div class="grid">${cells.join("")}</div>
`;
  fs.writeFileSync(`${OUT}/skins.html`, html);
  console.log(`皮肤挥拍预览: ${OUT}/skins.html(${SK.length} 款 × ${FRAMES.length} 帧 × 暗/亮两底)`);
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
for (const { name, held, hang, holdBall, bigHand, foot, p, ball, ops: preOps } of POSES) {
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
    // ---------- 远臂与身体轮廓的关系(这次重做的核心判据) ----------
    // 旧断言只有「肘/手相对远肩 ≤ -9.5」一条**地板**:它只保证手臂露出躯干背缘,不保证
    // 手臂还在身体旁边 —— 于是谁都可以靠「再往外甩」满足它,待机甩到 hug=8.24 就变成一条
    // 脱离身体的尾巴(用户看到的正是这个)。现在补上天花板,把「贴身」变成可验收的机制。
    // BACK = 躯干**髋段**背缘(唯一不随 lean 动的边);hug > 0 = 手与身体之间有背景空隙,
    // hug < 0 = 手盘压进躯干(远臂画在躯干之前,压过头就被整个吞掉)。
    const BACK = -CFG.player.w * 0.40;
    check(name + " 肘外露", el.x <= -8.0, `elbow.x=${el.x.toFixed(1)} (需 ≤ -8.0)`);
    check(name + " 手外露", !!hd && hd.x <= -8.0, hd ? `hand.x=${hd.x.toFixed(1)}` : "无手");
    if (hd) {
      const hug = BACK - (arm.sh.x + hd.x + (disc ?? 3.3));   // >0 手与身体之间有背景空隙
      check(name + " 手不被吞", hug >= (hang ? -3.0 : -5.0),
        `hug=${hug.toFixed(1)} (需 ≥ ${hang ? -3.0 : -5.0},更负=手盘大半被躯干盖掉)`);
      if (hd.y > 0 && held) {
        // 只在「会持续保持几十帧」的姿势上要求贴身:手垂在肩线以下 = 挂着的臂,必须贴着
        // 身体;举过肩线的(空中/跨步上网/庆祝/引拍)读作伸手不是尾巴,改走头遮挡圆判据。
        // 挥拍/松球/踉跄这些 held:false 的过渡帧允许大幅甩臂 —— 那是动作,不是构图错误。
        const cap = hang ? 2.5 : 6.5;
        check(name + (hang ? " 手贴轮廓" : " 手不脱体"), hug <= cap,
          `hug=${hug.toFixed(1)} (需 ≤ ${cap}${hang ? ";静止垂挂却离体 = 读作尾巴" : ";这条臂不该离身体这么远"})`);
      }
      if (hd.y <= 0) {
        // 后脑遮挡圆:「撞进后脑手就消失」在 sprites/poses 里被 4 处注释引用过,却从来没有
        // 断言兜着。头心(F 局部)=(2+(lean-2)*0.6, bodyTop-hr*1.12),lean 由远肩 x 反解;
        // headDy/serveDip/runShDy 都在 ±4 内,阈值取 0 = 允许正好贴着头后缘(庆祝挥拳的构图)。
        const hr = CFG.player.h * 0.21;                     // POSES 不挂皮肤 → 恒 standard 体型
        const hcx = 2 + (arm.sh.x + 9) * (0.6 / 0.9) - arm.sh.x;
        const clear = Math.hypot(hd.x - hcx, hd.y + hr * 1.12) - hr - (disc ?? 3.3);
        check(name + " 手不进后脑", clear >= 0, `headGap=${clear.toFixed(1)} (需 ≥0,负=手画进头里被吞)`);
      }
    }
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

  // 球拍完整性:拍框外圈 stroke 必须存在(点数 ≥ 整圈采样段数,杜绝 fill 吃掉 path
  // 导致无边框的 bug;sprites.ts 的 CIRCLE_SEGS=20,拍框是 21 点闭环)
  const hasFrame = ops.some((o) => o.kind === "stroke" && o.cmds.length >= 20);
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

// ---- 挥拍全程「不许在朝正后方时伸直」----
// 上臂从「举在头后」转到「垂在胯侧」必然经过「朝正后方」(角度 180 附近)。若那一刻
// 两段刚好对齐(折角≈0),屏幕上就是一根横着戳出去的木棍 —— 旧版线性 lerp 的折角零点
// 正好落在 u=0.556 / 上臂 194° 处,这就是用户说「后面那只手别扭」里最难看的一帧。
// 判据只钉这一件事实:上臂朝后(160~205°)时,肘折必须看得见。
{
  const inBack = (ea: number) => ea >= 160 && ea <= 205;
  for (const style of ["over", "under"] as SwingStyle[]) {
    let worst = 999, at = -1, worstEA = 0;
    for (let f = 0; f <= SWING_FRAMES; f++) {
      const a = farArm(render(mkPlayer({ swingT: f, swingStyle: style, swingHit: true }), null));
      if (!a || !a.hd) continue;
      // 记录点是 Graphics 空间(y 向上),与 fea 的「0=朝网、正=向上」同向,直接 atan2 即可
      const ea = (Math.atan2(a.el.y - a.sh.y, a.el.x - a.sh.x) * 180 / Math.PI + 360) % 360;
      if (!inBack(ea)) continue;
      const def = deflection(a);
      if (def < worst) { worst = def; at = f; worstEA = ea; }
    }
    if (at < 0) rows.push(`  · 挥拍 ${style.padEnd(6)} 无「朝正后方」帧(检查是否轨迹改太小)`);
    else check(`伸直窗 ${style}`, worst >= 20,
      `朝后那帧(上臂 ${worstEA.toFixed(0)}° @f${at})折角 ${worst.toFixed(1)}° (需 ≥20,否则读作横着的木棍)`);
  }
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

// ---------- 躯干脊柱判据:台阶 / 衣摆贴髋 / 覆盖物不出轮廓 ----------
// 用户报的「挥拍时腰部显示有问题」= 躯干由三块横移量不同的矩形叠成,中间那块被肩段整个
// 盖死(死代码),于是只剩 3 单位搭接去扛 4.8 单位的横向偏移;球衣拼色带又锚在肩段的 x 上,
// 画到身体外面去了。下面三条把这件事变成可验收机制:
//  ① 把躯干改回任何「分段矩形」→ 左缘出现一处大跳变,红。
//  ② 任何漏掉 body.torso 的衣摆写法(compact 露背景洞 / tall 垂成长衫)→ 红。
//  ③ 任何自己算 x 的纹样/明暗(旧 twoTone 在网侧多画 4.8)→ 红。
// 判据与形状无关(矩形和脊柱带都能量),所以它钉的是「轮廓连续」这件事,不是某种实现。
// 反例由 --spine-selftest 兜着,防止这三条哪天悄悄变成永远全绿摆设。

/** 与 cc-stub 的 Color.css() 同式的颜色签名 —— 断言靠它从一堆笔画里认出某一笔。
 *  alpha 换算必须与 palette.withAlpha 一致(Math.round(a*255)),否则签名对不上。 */
function cssOf(hex: string, a = 1): string {
  const c = new StubColor(hex);
  c.a = Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255);
  return c.css();
}
/** 同上,但直接给分量(sprites.ts 里那些 "rgba(255,255,255,0.18)" 字面量走的是 pal 解析) */
function cssLit(r: number, g: number, b: number, a: number): string {
  return new StubColor(r, g, b, Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255)).css();
}

/** 一笔在 y 处的左右缘;不在该高度上返回 null。4 点(矩形)左右缘恒定,
 *  ≥6 点的偶数点闭合折线按「前半背缘 / 后半前缘」插值(正是 torsoBand 的出点顺序)。 */
function spanAtY(p: Pt[], y: number): { lo: number; hi: number } | null {
  if (!p.length) return null;
  const ys = p.map((q) => q.y);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y < y0 - 0.01 || y > y1 + 0.01) return null;
  if (p.length >= 6 && p.length % 2 === 0) {
    const half = p.length / 2;
    const at = (chain: Pt[]): number => {
      const e = chain[chain.length - 1];
      if (y >= chain[0].y) return chain[0].x;
      if (y <= e.y) return e.x;
      for (let i = 1; i < chain.length; i++) {
        if (chain[i].y <= y) {
          const a = chain[i - 1], b = chain[i];
          return a.x + (b.x - a.x) * ((y - a.y) / ((b.y - a.y) || 1));
        }
      }
      return e.x;
    };
    const bx = at(p.slice(0, half)), fx = at(p.slice(half).reverse());
    return { lo: Math.min(bx, fx), hi: Math.max(bx, fx) };
  }
  const xs = p.map((q) => q.x);
  return { lo: Math.min(...xs), hi: Math.max(...xs) };
}

/** 从一组 fill 里量出躯干:底色并集的纵向边界、左缘阶梯(总位移与最大单处跳变)、
 *  以及 watch 点名的覆盖物最坏溢出多少单位。找不到主色填充返回 null。
 *  主色不只用在衣身上(发带/猫耳/蝴蝶结也吃 th.main),所以要认得出哪几笔才是躯干:
 *  anchorY/h 给一条「髋点起、按该体型躯干高收口」的解剖学窗口 —— 只有落在窗口里、且自身
 *  不高过衣身的同色笔才算数(旧画法的三块矩形全在窗口内,头饰那一大坨在窗口外)。 */
function measureSpine(fills: StubOp[], mainCss: string, watch: Set<string>,
  anchorY?: number, h?: number): {
    topY: number; hemY: number; shift: number; jump: number; atJump: number; over: number; overColor: string;
    /** 躯干在该高度的左右缘(窗口内的主色笔并集);该高度没有衣身返回 null */
    span(y: number): { lo: number; hi: number } | null;
  } | null {
  const inBand = (p: Pt[]): boolean => {
    if (anchorY === undefined || h === undefined) return true;
    const ys = p.map((q) => q.y);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return (y1 - y0) <= h + 2 && y1 >= anchorY - 1 && y0 <= anchorY + h + 1;
  };
  const mains = fills.filter((o) => o.color === mainCss && inBand(opPoints(o)));
  if (!mains.length) return null;
  const pts = (o: StubOp): Pt[] => opPoints(o);
  const span = (y: number): { lo: number; hi: number } | null => {
    let lo = Infinity, hi = -Infinity;
    for (const o of mains) {
      const s = spanAtY(pts(o), y);
      if (s) { lo = Math.min(lo, s.lo); hi = Math.max(hi, s.hi); }
    }
    return lo <= hi ? { lo, hi } : null;
  };
  const all = mains.flatMap(pts);
  const topY = Math.max(...all.map((q) => q.y)), hemY = Math.min(...all.map((q) => q.y));
  let shift = 0, jump = 0, atJump = 0;
  const lo: number[] = [];
  const ys: number[] = [];
  for (let y = hemY; y <= topY + 0.001; y += 1) {
    const s = span(Math.min(y, topY));
    if (s) { lo.push(s.lo); ys.push(Math.min(y, topY)); }
  }
  if (lo.length >= 2) {
    shift = lo[lo.length - 1] - lo[0];
    for (let i = 1; i < lo.length; i++) {
      const d = lo[i] - lo[i - 1];
      if (Math.abs(d) > Math.abs(jump)) { jump = d; atJump = ys[i]; }
    }
  }
  let over = 0, overColor = "";
  for (const o of fills) {
    if (!watch.has(o.color)) continue;
    for (const r of pts(o)) {
      const s = span(r.y);
      if (!s) continue;
      const v = Math.max(s.lo - 0.6 - r.x, r.x - (s.hi + 0.6));
      if (v > over) { over = v; overColor = o.color; }
    }
  }
  return { topY, hemY, shift, jump, atJump, over, overColor, span };
}

// ---- --spine-selftest:反例必须被报警 ----
//   node .tools-build/tools/pose-preview.js --spine-selftest
// 上面三条判据如果哪天写坏了(边界算反、颜色签名对不上导致 watch 恒空),它们会对任何
// 画法都返回「通过」。这里喂一份**旧画法**的合成笔画:三块横移量不同的矩形 + 一块锚在
// 肩段的拼色带 —— 正是用户截图里那个样子。它必须被 ① 和 ③ 双双判红。
if (process.argv.includes("--spine-selftest")) {
  const rect = (x0: number, y0: number, x1: number, y1: number, color: string): StubOp => ({
    kind: "fill", color, width: 0, cap: "butt", join: "miter",
    cmds: [{ t: "M", x: x0, y: y0 }, { t: "L", x: x1, y: y0 }, { t: "L", x: x1, y: y1 }, { t: "L", x: x0, y: y1 }],
  });
  const MAIN = "#e8e4f0", GLOW = "#b8c8e8";
  // 旧写法在 tall 体型 + 发力帧(lean=4.8)的实际出图:髋段不移、肩段移满、腰段被盖住
  const old = [
    rect(-16.8, 34, 11.2, 56.04, cssOf(MAIN)),        // 下段(髋)
    rect(-12.23, 55.28, 15.49, 63.64, cssOf(MAIN)),   // 中段(腰)
    rect(-12, 53, 16, 72, cssOf(MAIN)),               // 上段(肩)
    rect(-12, 34, 16, 51.1, cssOf(GLOW, 0.85)),       // twoTone 色带:锚在肩段 x 上
  ];
  const m = measureSpine(old, cssOf(MAIN), new Set([cssOf(GLOW, 0.85)]));
  const badStep = !!m && Math.abs(m.jump) > 0.45 * Math.abs(m.shift) + 0.6;
  const badOver = !!m && m.over > 0;
  console.log(`反例(旧画法三块矩形 + 肩段锚点的拼色带):`);
  console.log(`  ${badStep ? "✓ 被判红" : "✗ 放过了"} 腰部无台阶   总位移 ${m?.shift.toFixed(1)} 最大跳变 ${m?.jump.toFixed(1)} @y=${m?.atJump.toFixed(0)}`);
  console.log(`  ${badOver ? "✓ 被判红" : "✗ 放过了"} 纹样不出轮廓 溢出 ${m?.over.toFixed(2)} 单位(${m?.overColor})`);
  if (!m) { console.log("\n判据失效:反例里认不出躯干 ✗"); process.exit(1); }
  process.exit(badStep && badOver ? 0 : 1);
}

{
  const H = CFG.player.h, W = CFG.player.w;
  const TW = W * 0.66;
  const ptsOf = (o: StubOp): Pt[] => opPoints(o);

  const SK = CFG.skins.player;
  const TORSO_CASES: { label: string; sk: typeof SK[0] | null; ov: Partial<Player> }[] = [
    { label: "无皮肤 待机", sk: null, ov: {} },
    { label: "无皮肤 退防跨步", sk: null, ov: { lungeT: 7, lungeDir: -1 } },
    { label: "宗师 引拍 u=.14", sk: SK.find((s) => s.id === "p-sage")!, ov: { swingT: 3 } },
    { label: "宗师 断点 u=.27", sk: SK.find((s) => s.id === "p-sage")!, ov: { swingT: 6 } },
    { label: "宗师 发力 u=.41", sk: SK.find((s) => s.id === "p-sage")!, ov: { swingT: 9 } },
    { label: "球王 发力 twoTone", sk: SK.find((s) => s.id === "p-king")!, ov: { swingT: 9 } },
    { label: "豆丁 发力 compact", sk: SK.find((s) => s.id === "p-sprout")!, ov: { swingT: 9 } },
    { label: "豆丁 退防跨步", sk: SK.find((s) => s.id === "p-sprout")!, ov: { lungeT: 7, lungeDir: -1 } },
    { label: "猫少女 发力 sash", sk: SK.find((s) => s.id === "p-cat")!, ov: { swingT: 9 } },
    { label: "骇客 发力 stripes", sk: SK.find((s) => s.id === "p-cyber")!, ov: { swingT: 9 } },
    { label: "樱少女 发力 trim", sk: SK.find((s) => s.id === "p-blossom")!, ov: { swingT: 9 } },
  ];
  for (const tc of TORSO_CASES) {
    const sk = tc.sk;
    const main = sk?.main ?? "#ff4d4d", dark = sk?.dark ?? "#a8202c";
    const mainCss = cssOf(main);
    const p = mkPlayer({
      theme: { main, dark, glow: sk?.glow ?? "#ff8a6a", name: sk?.name ?? "red" },
      playerSkin: sk ?? undefined,
      // 纹样只在挂了 playerSkin 时渲染,而 drawHead 的肤色款要 faceSkin —— 两个都得给,
      // 否则「皮肤 × 挥拍」这一格根本没在测纹样(旧覆盖缺口就是这么漏掉这个 bug 的)。
      faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
      swingStyle: "over", swingHit: false, ...tc.ov,
    });
    const ops = render(p, null);
    const body = CFG.bodies[sk?.body ?? "standard"] ?? CFG.bodies.standard;
    const fills = ops.filter((o) => o.kind === "fill");
    // ② 衣摆贴髋:躯干底边必须落在大腿笔画的髋点上(短裤就是那段 th.dark 圆头笔画,
    //    差 3 单位 = compact 露背景洞,差 6 单位 = tall 衣摆垂成长衫)。
    //    髋点同时当作认躯干的解剖学窗口原点 —— 头饰也吃 th.main,不能只按颜色认。
    const thigh = ops.find((o) => o.kind === "stroke" && o.color === cssOf(dark)
      && ptsOf(o).length === 2 && ptsOf(o)[0].y < SHOULDER_Y);
    const hipGy = thigh ? ptsOf(thigh)[0].y : NaN;
    // ③ 覆盖物不出轮廓:躯干的明暗/领口/下摆与球衣纹样,所有顶点都得夹在左右缘之间。
    //    按颜色签名点名要查的笔画 —— 躯干的纵向范围里还坐着远臂手盘、拍柄这些**本来就该
    //    在轮廓外**的部件,按「落在躯干带里」筛会把它们一起抓进来假红。
    const glowCss = (a: number): string => cssOf(sk?.glow ?? "#ff8a6a", a);
    const JERSEY_FILLS: Record<string, string[]> = {
      twoTone: [glowCss(0.85)],                   // 球场之王 / 金羽宗师:腰腹以下整段
      stripes: [glowCss(0.9), glowCss(0.55)],     // 赛博骇客:前胸两道竖纹
      trim: [glowCss(0.95), glowCss(0.7)],        // 樱花少女 / 萌芽豆丁:两颗樱点
      sash: [],                                   // 烈焰少年 / 猫系少女:斜带是描边,单独量端点
    };
    const watch = new Set<string>([
      cssLit(255, 255, 255, 0.18), cssLit(0, 0, 0, 0.22),        // 前缘受光 / 背缘背光
      cssLit(255, 255, 255, 0.20), cssLit(255, 255, 255, 0.10),  // 下摆亮边 / 侧条纹
      cssOf(dark),                                               // 领口(twoTone 的腰带同色)
      ...(sk?.jersey ? JERSEY_FILLS[sk.jersey] ?? [] : []),
    ]);
    const torsoH = H * body.torso;
    const m = measureSpine(fills, mainCss, watch, hipGy, torsoH);
    if (!m) {
      check(`${tc.label} 躯干可识别`, false, `髋 y=${hipGy.toFixed(1)} 窗口高 ${torsoH.toFixed(0)} 内找不到主色填充`);
      continue;
    }
    const { topY, hemY, span } = m;
    // ① 台阶:左缘沿高度的跳变,任何一处都不许吃掉总位移的 45%(留 0.6 的量化余量)
    check(`${tc.label} 腰部无台阶`, Math.abs(m.jump) <= 0.45 * Math.abs(m.shift) + 0.6,
      `总位移 ${m.shift.toFixed(1)} 单位,最大单处跳变 ${m.jump.toFixed(1)} @y=${m.atJump.toFixed(0)}`
      + `(上限 ${(0.45 * Math.abs(m.shift) + 0.6).toFixed(1)})`);
    check(`${tc.label} 衣摆贴髋`, Number.isFinite(hipGy) && Math.abs(hemY - hipGy) <= 1,
      `衣摆 y=${hemY.toFixed(1)} 髋 y=${Number.isFinite(hipGy) ? hipGy.toFixed(1) : "未找到"} (体型 ${sk?.body ?? "standard"})`);
    check(`${tc.label} 躯干高度合体型档`, Math.abs((topY - hemY) - torsoH) <= 1.5,
      `躯干 ${(topY - hemY).toFixed(1)} vs H·body.torso ${torsoH.toFixed(1)}`);
    // 斜披巾:5 宽的描边,两个端点各自内收半个笔宽才算贴在轮廓上
    let over = m.over, overColor = m.overColor;
    if (sk?.jersey === "sash") {
      for (const o of ops) {
        if (o.kind !== "stroke" || o.color !== glowCss(0.92)) continue;
        for (const r of ptsOf(o)) {
          const s = span(r.y);
          if (!s) continue;
          const v = Math.max(s.lo + 2 - r.x, r.x - (s.hi - 2));
          if (v > over) { over = v; overColor = "sash 端点"; }
        }
      }
    }
    check(`${tc.label} 纹样不出轮廓`, over <= 0,
      over <= 0 ? "明暗/领口/下摆/纹样全部夹在躯干左右缘内" : `最坏溢出 ${over.toFixed(2)} 单位(${overColor})`);
    // 衣宽不该被改动带跑(脊柱化只搬 x,不改宽度)
    const w0 = span(topY - 0.5), w1 = span(hemY + 0.5);
    check(`${tc.label} 衣宽恒定`, !!w0 && !!w1
      && Math.abs((w0.hi - w0.lo) - TW) <= 1.2 && Math.abs((w1.hi - w1.lo) - TW) <= 1.2,
      `肩 ${(w0 ? w0.hi - w0.lo : NaN).toFixed(1)} / 髋 ${(w1 ? w1.hi - w1.lo : NaN).toFixed(1)} vs W·0.66 ${TW.toFixed(1)}`);
  }
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
