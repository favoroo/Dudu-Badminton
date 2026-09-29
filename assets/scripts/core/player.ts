// ============================================================
// 角色:移动 / 跳跃(coyote + 缓冲 + 可变跳高)/ 挥拍状态机 / 扫掠命中
// 手感要点集中在这里,数值全在 config.ts
// ============================================================
import { CFG } from "./config";
import { clamp, lerp, approach, sweptHit } from "./utils";
import { Physics } from "./physics";
import { Ball, Player as PlayerEntity, PlayerInput, ShotResult } from "./types";

// 本模块导出的 Player(值:移动/挥拍/命中的 API)与 types 的 Player 实体(类型)
// 同名对外,调用方 `import { Player } from "./player"` 两个语义都拿得到,
// 与老仓库「DD.Player 既是命名空间又是概念」的心智一致
export type Player = PlayerEntity;

const C = CFG;
const CO = C.court, PL = C.player, SW = C.swing;
const SPAN = C.shot.farOffset - C.shot.nearOffset;

function create(side: PlayerEntity["side"], opts: Partial<PlayerEntity> & { homeX?: number } = {}): PlayerEntity {
  const homeX = opts.homeX ?? (side === "left" ? CO.netX - 200 : CO.netX + 200);
  return {
    side, isAI: !!opts.isAI, theme: opts.theme, label: opts.label,
    aiDiff: opts.aiDiff || null, ai: null, zone: opts.zone || "all",
    teamLabel: opts.teamLabel || opts.label || side, idx: 0, jersey: opts.jersey || "0",
    x: homeX, y: CO.groundY, vx: 0, vy: 0,
    px: homeX, py: CO.groundY, homeX,
    facing: side === "left" ? 1 : -1,
    onGround: true, coyote: 0, jumpBuf: 0,
    sq: 1, sqPrev: 1,             // squash / stretch(Prev 供渲染插值,消 60Hz 阶跃)
    recoverT: 0,                  // 收拍回摆计时:挥拍结束后从弧线终点摆回待机
    runPhase: 0, runAmt: 0, runStep: 0, // 步频相位(随位移累积)/跑姿权重/落脚计数
    blinkSeed: Math.random() * 220,     // 眨眼周期相位,各角色错开
    face: "normal", faceT: 0,           // 表情状态:game 层事件设置,这里只负责衰减
    swingT: -1, swingStyle: "over", swingHit: false, swingQ: 0,
    swingBuf: 0, swingBufAim: null, swingAim: "mid",
    swingRadius: SW.radiusBase,
    racket: { x: homeX, y: CO.groundY - 40, ang: 0 },
    racketPrev: { x: homeX, y: CO.groundY - 40 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0, zoneScale: 1,
    score: 0,
    smashGlow: 0,
    sweetGlow: 0,
    perfectGlow: 0,
    heat: 0,                        // 连击热手:本分内连续 sweet/perfect 计数(rules 在 beginPoint 清零)
    hitRecoil: 0,                   // 击球身体后仰(度):命中瞬间设值,每帧衰减回 0
    lungeT: -1,                     // 跨步救球:-1=未激活,>=0=当前帧计数
    lungeDir: 0,                    // 跨步方向(1=右,-1=左)
    lungeCd: 0,                     // 跨步冷却:>0 不许再跨,移动照常
    lungeShotT: 0,                  // 跨步后特殊击球窗口倒计时(>0=窗口内)
    stats: { hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0 },
  };
}

const inOwnCourt = (p: PlayerEntity, x: number): boolean => (p.side === "left" ? x < CO.netX : x > CO.netX);

// 瞄准:落点跟着击球键走 —— 远球键 = 深球压底线,近球键 = 短球放网前。
// AI 不按键盘,直接给数值深度;两种来源共用 C.aimDepth 这一张表,不会两处跑偏。
function depthOf(aim: string | number | null | undefined): number {
  if (typeof aim === "number") return aim;
  return (C.aimDepth as Record<string, number>)[aim ?? ""] ?? C.aimDepth.mid;
}

function startSwing(p: PlayerEntity, ball: Ball | null, aim?: string | number | null): void {
  p.swingT = 0;
  p.swingHit = false;
  p.swingQ = 0;
  p.swingAim = aim ?? "mid";
  p.swingStyle = ball && CO.groundY - ball.y > 95 ? "over" : "under";
  p.swingRadius = Physics.reachRadius(ball);
  p.racketPrev = Physics.racketHead(p, 0, p.swingRadius);
}

// 命中窗口内的位置 → 质量 0..1(窗口正中 = 甜蜜点)
function qualityAt(elapsed: number): number {
  const a = elapsed - SW.windup - 0.5;
  return clamp(1 - Math.abs(a - (SW.active - 1) / 2) / (SW.active / 2), 0, 1);
}

/** 最佳按拍提前量(帧):qualityAt 峰值对应的挥拍帧 —— 想踩窗口正中,球到判定区心前这么多帧就得按 */
export const PRESS_LEAD_FRAMES = SW.windup + 0.5 + (SW.active - 1) / 2;

function update(p: PlayerEntity, inp: PlayerInput, ball: Ball | null): void {
  p.px = p.x; p.py = p.y; p.sqPrev = p.sq;

  // ---------- 跨步救球状态机 ----------
  // 触发判断放在持续推进之前:按下当帧立即爆发(旧结构先推进再判触发,移动中按下
  // 会先吃 1 帧旧移动逻辑再起步,手感和视觉上都像「顿了一下」)。
  const LG = C.lunge;
  // 触发:地面、未在挥拍、未在跨步中、冷却完毕、按下跨步键。
  // 方向由输入层解(摇杆 → 当前按着的方向键 → 最近按过的);都没给时兜底 ——
  // 有移动惯性就顺势跨(不逆转去向),完全静止才朝网。
  if (inp.lungePressed && p.onGround && p.swingT < 0 && p.lungeT < 0 && p.lungeCd <= 0) {
    p.lungeT = 0;
    p.lungeDir = inp.lungeDir ? inp.lungeDir
      : (Math.abs(p.vx) > 1 ? (p.vx > 0 ? 1 : -1) : p.facing);
    p.lungeShotT = LG.shotWindow;  // 启动跨步后特殊击球窗口
    p.sq = 0.85;  // 跨步时身体压低
    // 跨步是冲量,叠加在当前水平速度上 —— 跑动中跨步 = 跑速 + 爆发,不再被替换成
    // 爆发速(旧逻辑 vx=dir×15 把跑速抹掉,跑动时只比干跑快一点点,「跨了像没跨」)。
    p.vx += p.lungeDir * LG.speed;
    inp.onLunge && inp.onLunge(p);
  }
  if (p.lungeT >= 0) {
    p.lungeT++;
    // 跨步中:vx 在触发帧已锁定(含跑速+爆发),这里只推进帧数与判定区扩大;不重写
    // vx,以免把叠加后的高速又抹回纯爆发速。移动覆盖段跳过正常加速/摩擦,保住锁定值。
    if (p.lungeT >= LG.duration) {
      p.lungeT = -1;
      p.lungeCd = LG.cooldownFrames;  // 进冷却:移动照常,只是不许立刻再跨
    }
  } else if (p.lungeCd > 0) {
    p.lungeCd--;
  }

  // ---------- 水平:加速度 + 摩擦 ----------
  // 模式优先级:
  // 1. targetX 优先(滑轨模式):精准平滑定点刹停。进入 slowDownDist 减速,进入 arriveEps 绝对落定。
  // 2. 摇杆优先:非零且超过死区时给出模拟量 → 半速小碎步、边界缓冲都是可能的;
  // 3. 键盘/按钮模式下 moveAxis 未定义或为 0,回落到旧的离散左右键。
  // |mv| 同时用作速度上限的缩尺:小推 = 慢走,大推 = 快冲;|mv|==1 时与旧逻辑严格等价。
  const targetX = inp.targetX;
  const SC = C.sliderControl;
  let mv = 0;
  let axisCap = 1;
  const isSliderActive = targetX !== undefined;

  if (isSliderActive) {
    const dx = targetX - p.x;
    if (Math.abs(dx) <= (SC?.arriveEps ?? 1.5)) {
      p.x = targetX;
      p.vx = 0;
      mv = 0;
      axisCap = 0;
    } else {
      const dir = dx > 0 ? 1 : -1;
      const dist = Math.abs(dx);
      // 减速缓冲带:若距离小于 slowDownDist,按比例线性收缩速度上限,避免超调与来回震荡
      const slowDist = SC?.slowDownDist ?? 22;
      axisCap = dist < slowDist ? Math.max(0.2, dist / slowDist) : 1;
      mv = dir * axisCap;
    }
  } else {
    const axis = inp.moveAxis ?? 0;
    mv = Math.abs(axis) > 0.15 ? axis : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    axisCap = Math.min(1, Math.abs(mv));
  }

  // 跨步中:覆盖正常移动逻辑(速度已锁定)。
  // 爆发结束没有慢速恢复期 —— 惯性交给正常摩擦/输入接管(旧 35% 硬钳会把 15px/帧
  // 一帧刹到 3.2,移动中跨步比干跑还慢,手感像急刹)。冷却只限制再次跨步。
  if (p.lungeT >= 0) {
    // 跨步中:速度由 lunge 逻辑控制,跳过正常加速
  } else if (isSliderActive && axisCap === 0) {
    // 精准定点刹停达成:vx 已置零,无需摩擦
  } else {
    const maxV = PL.vmax * p.speedMul * axisCap;
    const accel = PL.accel * (p.onGround ? 1 : PL.airAccelMul) * p.speedMul;
    if (mv !== 0) p.vx += mv * accel;
    else p.vx *= p.onGround ? PL.groundFriction : PL.airFriction;
    if (mv !== 0) {
      p.vx = clamp(p.vx, -maxV, maxV);
    }
  }
  if (Math.abs(p.vx) < 0.04) p.vx = 0;
  // 横向安全钳制:跨步是叠加冲量,跑动中爆发可达 vmax+speed,钳制要留够余量
  const xvCap = Math.max(12, PL.vmax + LG.speed + 3);
  p.x += clamp(p.vx, -xvCap, xvCap);

  // 侧视球场:始终面向球网,拍面方向 = 出球方向
  p.facing = p.side === "left" ? 1 : -1;

  const minX = p.side === "left" ? CO.wallL : CO.netX + 10;
  const maxX = p.side === "left" ? CO.netX - 10 : CO.wallR;
  if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }

  // ---------- 跳跃:coyote + 输入缓冲 + 松键截断 ----------
  if (p.onGround) p.coyote = PL.coyote; else if (p.coyote > 0) p.coyote--;
  if (inp.jumpPressed) p.jumpBuf = PL.jumpBuffer; else if (p.jumpBuf > 0) p.jumpBuf--;
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = PL.jumpV; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
    p.sq = PL.jumpStretch;
    inp.onJump && inp.onJump(p);
  }
  if (!inp.jumpHeld && p.vy < 0 && !p.onGround) p.vy *= PL.jumpCut;

  p.vy += PL.gravity;
  p.y += p.vy;
  if (p.y >= CO.groundY) {
    if (!p.onGround) {
      // 扣杀落地:比正常落地蹲得更深(渲染层据此增强膝盖弯曲/躯干前倾)
      const smashLand = p.swingHit && p.swingStyle === "over";
      p.sq = smashLand ? (C.fx.landSquashSmash || 0.62) : PL.landSquash;
      inp.onLand && inp.onLand(p, p.vy);
    }
    p.y = CO.groundY; p.vy = 0; p.onGround = true;
  }
  p.sq = approach(p.sq, 1, 0.05);
  // 击球后仰恢复:每帧向 0 逼近
  if (p.hitRecoil) p.hitRecoil = approach(p.hitRecoil, 0, C.fx.recoilDecay || 0.12);

  // ---------- 步频:相位随位移累积,步频/步幅自然随速度;落脚触发尘土钩子 ----------
  if (p.onGround) p.runPhase += Math.abs(p.vx) * PL.runPhaseK;
  const running = p.onGround && Math.abs(p.vx) > 0.4;
  p.runAmt = approach(p.runAmt, running ? 1 : 0, 0.25);
  const stepIdx = Math.floor(p.runPhase / Math.PI);
  if (stepIdx !== p.runStep) {
    p.runStep = stepIdx;
    if (running && Math.abs(p.vx) > PL.footstepSpeed) inp.onFootstep && inp.onFootstep(p);
  }

  // ---------- 挥拍状态机 ----------
  // 提前按下的缓冲连落点一起记:先按击球键再进挥拍窗口,打出去的还是那拍。
  // 挥拍中也记录(原来直接丢弃,拇指稍早一按就丢输入):收招时仍在 buffer
  // 窗口内的按键自动续拍,与跳跃 jumpBuffer 同一套手感;更早的按键自然过期,
  // whiff 惩罚照旧,不助长乱按。hitstop 顿帧期保留的输入边沿照常从这里消化。
  if (inp.swingAim != null) { p.swingBuf = SW.buffer; p.swingBufAim = inp.swingAim; }
  if (p.swingT >= 0) {
    p.swingT++;
    const total = Physics.swingTotal() + (p.swingHit ? 0 : SW.whiffExtra);
    if (p.swingT >= total) {
      if (!p.swingHit) { p.stats.whiffs++; inp.onWhiff && inp.onWhiff(p); }
      p.swingT = -1;
      p.recoverT = SW.blendOut;    // 收拍回摆:渲染端把弧线终点插回待机姿势
      // 收招瞬间消化排队的击球键(挥拍尾声 ~7 帧内按下的就无缝接续下一拍)
      if (p.swingBuf > 0) { startSwing(p, ball, p.swingBufAim); p.swingBuf = 0; }
    }
  } else if (p.swingBuf > 0) {
    startSwing(p, ball, p.swingBufAim); p.swingBuf = 0;
  }
  // 滑动手势覆盖落点:startSwing 设的初值是 mid,挥拍期间手指横滑提交方向后,
  // 实时覆盖 p.swingAim。tryHit → buildShot 读的就是这里的最终值。
  // 键盘路径在 press 时就定好了 ±1,这一步等价于立即覆盖(保持一致)。
  if (p.swingT >= 0 && inp.swingSwipe != null) {
    if (inp.swingSwipe > 0) p.swingAim = "deep";
    else if (inp.swingSwipe < 0) p.swingAim = "near";
    // swingSwipe === 0 → 不覆盖,保留 startSwing 的 mid(由物理自动决定球种)
  }
  if (p.swingBuf > 0) p.swingBuf--;
  if (p.recoverT > 0) p.recoverT--;
  if (p.hitLock > 0) p.hitLock--;
  if (p.contactFlash > 0) p.contactFlash--;
  if (p.smashGlow > 0) p.smashGlow--;
  if (p.sweetGlow > 0) p.sweetGlow--;
  if (p.perfectGlow > 0) p.perfectGlow--;
  if (p.lungeShotT > 0) p.lungeShotT--;
  if ((p.faceT ?? 0) > 0) p.faceT = (p.faceT as number) - 1;

  p.racketPrev = p.racket;
  p.racket = Physics.racketHead(p, p.swingT >= 0 ? p.swingT : 0, p.swingRadius);
}

/**
 * 挥拍判定区:以肩为圆心、略朝击球方向偏移的一个圆域。
 * 不用「拍头那个点」做判定 —— 羽毛球落地角 60~75°,几乎是垂直砸下来,
 * 拿弧线上的一个点去迎它,重合窗口只有一两帧,人根本按不到。
 * 拍头扫掠只作为视觉 + 额外补判(球真撞上拍头时一定算)。
 *
 * 判定区。普通来球给得很宽容(所以容易接到球),但球速越快区子越小 ——
 * 不然重杀也能随手捞起来,回合永远打不完。
 * AI 的 entryLead 用残缺探针(只有位置/朝向/半径)调用,所以这里收结构化子集;
 * 缺省字段的行为与原版 JS 完全一致(lungeT 未定义时视为不在跨步中)。
 */
export interface ZoneProbe {
  x: number; y: number; facing: number;
  swingRadius: number;
  zoneScale?: number;
  lungeT?: number;
  lungeDir?: number;
}

function strikeZone(p: ZoneProbe, speed: number) {
  const rad = p.swingRadius;
  const fast = clamp(((speed || 0) - C.swing.zoneFullSpeed) / C.swing.zoneTightenSpan, 0, 1);
  // 跨步救球:判定区扩大,延伸方向由跨步方向决定(缺省为面向方向)
  const isLunging = (p.lungeT ?? -1) >= 0;
  const lungeMul = isLunging ? C.lunge.reachMul : 1;
  const reachDir = isLunging ? (p.lungeDir || p.facing) : p.facing;
  return {
    x: p.x + reachDir * rad * 0.34 * lungeMul,
    y: p.y + SW.pivotY - rad * 0.06,
    r: (rad * 0.92 + SW.headR) * (p.zoneScale ?? 1) * lerp(1, C.swing.zoneFastMul, fast) * lungeMul,
  };
}

// 球在判定区内吗(返回 null = 不在;否则返回归一化的勉强程度 0=区心 1=边缘)
function ballInZone(p: ZoneProbe, ball: Ball): number | null {
  const z = strikeZone(p, Math.hypot(ball.vx || 0, ball.vy || 0));
  const isLunging = (p.lungeT ?? -1) >= 0;
  const effDir = isLunging ? (p.lungeDir || p.facing) : p.facing;
  const dx = (ball.x - z.x) * effDir, dy = ball.y - z.y;
  if (dx < -z.r * 0.34) return null;                       // 太靠背后,够不着
  const d = Math.hypot(dx, dy);
  return d <= z.r ? clamp(d / z.r, 0, 1) : null;
}

export interface HitOpt {
  q?: number; sweet?: boolean; perfect?: boolean; dEdge?: number;
  /** 连击热手:本次命中「之前」的连续好球数(0 = 无加成;发球等直调路径不带) */
  heat?: number;
  /** 跨步后特殊击球窗口内命中(buildShot 叠加 shotBoost + shotPowerDeg) */
  lungeShot?: boolean;
  /** 发球等场景直接指定落点深度(绕过瞄准表) */
  forced?: { depth: number };
}

// 命中判定:挥拍窗口内 + 球在判定区(或真撞上拍头)
function tryHit(p: PlayerEntity, ball: Ball): ShotResult | null {
  if (p.swingT < SW.windup || p.swingT > SW.windup + SW.active) return null;
  if (p.swingHit || p.hitLock > 0) return null;
  if (!ball.live || ball.held) return null;
  if (!inOwnCourt(p, ball.x)) return null;                 // 不能越过网去够
  if (ball.lastHitter === p.side) return null;             // 同队一回合只许击球一次

  const edge = ballInZone(p, ball);
  const headR = C.swing.headR + C.shuttle.radius;
  const headHit = sweptHit(p.racketPrev.x, p.racketPrev.y, p.racket.x, p.racket.y,
    ball.px, ball.py, ball.x, ball.y, headR);
  if (edge === null && !headHit) return null;

  const dEdge = headHit ? Math.min(edge ?? 1, 0.35) : edge as number;
  const qRaw = qualityAt(p.swingT);
  const q = clamp(qRaw - dEdge * 0.28, 0, 1);
  const sweet = qRaw >= 1 - C.sweet.coreRatio;
  const perfect = qRaw >= 1 - C.perfect.coreRatio;

  p.swingHit = true;
  p.swingQ = q;
  p.hitLock = SW.doubleHitLock;
  p.contactFlash = 8;
  p.stats.hits++;
  if (sweet) {
    p.stats.sweets++;
    p.sweetGlow = 12;
  }
  if (perfect) {
    p.stats.perfects++;
    p.perfectGlow = 14;
  }

  // 连击热手:连续 sweet/perfect 累积热度(断一拍立刻清零)。
  // 传给 buildShot 的是命中「前」的热度 —— 第一拍好球不白给,连到第二拍才开始涨凶。
  const hot = sweet || perfect;
  const heatBefore = p.heat;
  p.heat = hot ? Math.min(heatBefore + 1, C.heat.maxStreak) : 0;

  const lungeShot = p.lungeShotT > 0;
  const shot = buildShot(p, ball, { q, sweet, perfect, dEdge, heat: hot ? heatBefore : 0, lungeShot });
  // 球体接触瞬间形变:按档位设压扁比
  ball.sqPrev = ball.sq;
  ball.sq = (shot.kind === "smash")
    ? (C.fx.ballSquashSmash || 0.55)
    : (sweet || perfect)
    ? (C.fx.ballSquashSweet || 0.65)
    : (C.fx.ballSquashNormal || 0.75);
  // 击球身体后仰:扣杀最明显,给"物理反作用力"的重量感
  p.hitRecoil = (shot.kind === "smash")
    ? (C.fx.recoilSmash || 6)
    : (C.fx.recoilNormal || 3);
  // 时机教学:命中了但不甜、且在窗口里偏了半程以上,告诉玩家该往哪边调
  // (只给真人;AI 的时机误差是难度参数,不该"被教学")
  if (!p.isAI && qRaw < 0.5) {
    shot.timingHint = p.swingT < SW.windup + (SW.active - 1) / 2 ? "early" : "late";
  }
  if (shot.kind === "smash") {
    p.smashGlow = 10;
  }
  return shot;
}

// 由瞄准 + 击球点高度 + 击球质量解出这一拍
function buildShot(p: PlayerEntity, ball: Ball, opt: HitOpt = {}): ShotResult {
  const q = opt.q ?? 0.5, sweet = !!opt.sweet, perfect = !!opt.perfect, dEdge = opt.dEdge ?? 0;
  const dir = p.side === "left" ? 1 : -1;
  const h = CO.groundY - ball.y;
  const aim = opt.forced ? opt.forced.depth : depthOf(p.swingAim);

  let err = C.aimErr.base + dEdge * C.aimErr.edge;
  if (Math.abs(p.vx) > 2.4) err += C.aimErr.moving;
  if (!p.onGround) err += C.aimErr.airborne;
  if (perfect) err = 0;                     // 完美击球:瞄哪打哪(最高技艺换确定性)
  else if (sweet) err *= C.sweet.errBonus;
  err += p.aiAimErr || 0;
  const depth = Math.max(0, aim + (Math.random() * 2 - 1) * err / SPAN);

  // 力量兑现:踩得准 → 弧度额外压平 + 初速上限放宽,求解器自动用更快的初速
  // 补同一个落点 → 球更凶、到得更早。低击球点会被「安全过网角」兜底抬回来,不会乱下网。
  // 连击热手在同一预算上再加余量,但总 boost 封在物理上限的差额里(25→30),
  // 不与 shuttle.maxSpeed 冲突。
  // 跨步后窗口内击球(lungeShot):额外加 boost + 压弧度,同一预算封顶,不绕过 classify。
  const lungeShot = !!opt.lungeShot;
  const heatBoost = Math.min((opt.heat || 0) * C.heat.speedBonus, C.heat.speedBonusMax);
  const boost = Math.min(
    (perfect ? C.shot.perfectBoost : sweet ? C.shot.sweetBoost : 0) + heatBoost
      + (lungeShot ? C.lunge.shotBoost : 0),
    C.shuttle.maxSpeed - C.shot.speedMax);
  const powerDeg = (perfect ? C.perfect.powerDeg : sweet ? C.sweet.powerDeg : 0)
    + (lungeShot ? C.lunge.shotPowerDeg : 0);
  const loft = clamp(Physics.loftFor(depth, h, q) - powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg);

  const shot = Physics.solveShot(ball.x, ball.y, dir, depth, loft, boost);
  if (shot.kind === "smash") p.stats.smashes++;
  return {
    kind: shot.kind, q, sweet, perfect,
    // 报「真正打出去的深度」而不是瞄的那个数:求解器可能把落点往场内收过
    depth: shot.depth,
    vx: shot.vx, vy: shot.vy, power: shot.speed, deg: shot.deg,
    landX: shot.trace.landX, steps: shot.trace.steps,
    intoNet: shot.trace.hitNet,
    contactX: ball.x, contactY: ball.y,
    hitter: p,
    heat: p.heat,
    lungeShot,
  };
}

export const Player = { create, update, tryHit, buildShot, depthOf, strikeZone, ballInZone };
