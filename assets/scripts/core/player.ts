// ============================================================
// 角色:移动 / 跳跃(coyote + 缓冲 + 可变跳高)/ 挥拍状态机 / 扫掠命中
// 手感要点集中在这里,数值全在 config.ts
// ============================================================
import { CFG } from "./config";
import { clamp, lerp, approach, sweptHit } from "./utils";
import { Physics, FuturePt, flightFramesToClosest } from "./physics";
import { Gait } from "./gait";
import { Skills } from "./skills";
import { Ball, HitOpt, Player as PlayerEntity, PlayerInput, ShotResult, SwingBestShot } from "./types";

// 本模块导出的 Player(值:移动/挥拍/命中的 API)与 types 的 Player 实体(类型)
// 同名对外,调用方 `import { Player } from "./player"` 两个语义都拿得到,
// 与老仓库「DD.Player 既是命名空间又是概念」的心智一致
export type Player = PlayerEntity;

const C = CFG;
const CO = C.court, PL = C.player, SW = C.swing;
const SPAN = C.shot.farOffset - C.shot.nearOffset;

export interface PlayerModifier {
  accelMul?: number;
  vmaxMul?: number;
  jumpMul?: number;
  frictionMul?: number;
  reachMul?: number;
  cooldownMul?: number;
  staminaSystem?: boolean;
  forbiddenNetZone?: number;
  iaiStrike?: boolean;
  zenFocus?: boolean;
}

let activePlayerModifier: PlayerModifier | null = null;

export function setPlayerModifier(mod: PlayerModifier | null): void {
  activePlayerModifier = mod;
}

export function getPlayerModifier(): PlayerModifier | null {
  return activePlayerModifier;
}

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
    lungeAutoT: 0,                  // 跨步自动回球待发窗剩余帧(>0=系统替玩家按这一拍)
    smashAutoT: 0,                  // 重击代出一拍待发窗剩余帧(>0=附魔到点由系统轰出暴扣)
    skill: Skills.initSkillState((opts.skill && opts.skill.id) || "lunge"),
    flashT: 0,
    focusT: 0,
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0,
      lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
      deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    stamina: activePlayerModifier?.staminaSystem ? 100 : undefined,
    isExhausted: false,
    zenMeter: 0,
    forbiddenWarn: 0,
    sliding: 0,
  };
}

/**
 * 击球合法半场判定:
 * 严格规则要求球在击球方本侧半场,但羽毛球实战中球头探过球网垂直面或网顶正上方即可击打。
 * 旧逻辑硬卡严格 x < netX,导致球抵网口(x=480~485)时时机环亮起、玩家按了却因 1px 被判挥空。
 * 低球给 netReachTolLow(6px,约球头半宽),高于网顶的高球(y <= netTopY)给 netReachTolHigh(12px),允许网前抢网扑球。
 */
const inOwnCourt = (p: PlayerEntity, x: number, y?: number): boolean => {
  const isHigh = y !== undefined && y <= CO.netTopY;
  const tol = isHigh ? (C.swing.netReachTolHigh ?? 12) : (C.swing.netReachTolLow ?? 6);
  return p.side === "left" ? x <= CO.netX + tol : x >= CO.netX - tol;
};

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
  p.swingBest = null;   // 峰值追踪记账清零:新一拍从空账开始
  p.swingAim = aim ?? "mid";
  p.swingStyle = ball && CO.groundY - ball.y > 95 ? "over" : "under";
  p.swingRadius = Physics.reachRadius(ball);
  p.racketPrev = Physics.racketHead(p, 0, p.swingRadius);
  // 发球起拍标记:起拍时球还握在手上 = 这一拍是发球。每次起拍覆盖,无需清理;
  // 渲染层据此走发球专属的出发姿势与远臂松球轨迹(纯视觉,不参与判定)
  p.serveSwing = !!(ball && ball.held && ball.owner === p);
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

  // ---------- 动态技能与跨步救球状态机 ----------
  // 触发判断放在持续推进之前:按下当帧立即爆发
  const skillHit = inp.skillPressed || inp.lungePressed;
  // 滑轨模式下方向解析:若 targetX 存在且与当前位置有明显位移,以目标几何方位为最高优先级(身后往后,身前往前);
  // 否则取明确传入的 skillDir/lungeDir(来自滑轨最后滑动手势或摇杆/按键);全无则兜底 undefined 由各技能决定
  let dir = inp.skillDir ?? inp.lungeDir;
  if (inp.targetX !== undefined && Math.abs(inp.targetX - p.x) > 4) {
    dir = inp.targetX > p.x ? 1 : -1;
  }
  if (skillHit && ball && Skills.canActivate(p, ball)) {
    const success = Skills.activate(p, ball, dir);
    if (success && p.skill) {
      p.stats.skillCasts++;             // 三星判据「释放技能 N 次」:lunge 也是五技能之一,计入
      inp.onSkill && inp.onSkill(p, p.skill.id);
      if (p.skill.id === "lunge") {
        if (inp.onLunge) inp.onLunge(p);
        inp.targetX = undefined; // 跨步冲量接管,清空当帧定点避免与跨步初速度竞争
      }
    }
  }

  // 推进技能状态机
  if (ball) {
    Skills.update(p, ball);
  }

  const LG = C.lunge;
  const SM = C.skills.smash;
  if (p.lungeT >= 0) {
    p.lungeT++;
    // 跨步中:vx 在触发帧已锁定(含跑速+爆发),这里只推进帧数与判定区扩大
    if (p.lungeT >= LG.duration) {
      p.lungeT = -1;
      p.lungeCd = p.skill ? p.skill.cd : LG.cooldownFrames;
    }
  } else if (p.lungeCd > 0) {
    p.lungeCd--;
  }
  if (p.lungeShotT > 0) {
    p.lungeShotT--;
  }
  // 自动回球待发窗:与上面同一条规矩 —— 计时器只在这里递减一次。
  // 【坑】lungeShotT 曾被这里的旧孪生行(文件末尾那批衰减里)多减一次,于是配置 60 帧
  // (= 1 秒,与技能文案"1 秒内激活强力暴击"同源)实际只有 30 帧。修回诚实值之后
  // 若实测过强,降 CFG.lunge.shotWindow 这个数值,别把重复递减留着当削弱手段。
  if ((p.lungeAutoT ?? 0) > 0) p.lungeAutoT = (p.lungeAutoT ?? 0) - 1;
  // 重击「代出一拍」待发窗:与上面同一条规矩 —— 计时器只在这里递减一次。
  // 【坑】附魔 buffT 与冷却 cd 的递减在 Skills.update(上面几十行)里,这里再写一行就是
  // 每帧两减:4 秒附魔变 2 秒、3.5 秒冷却变 1.75 秒 —— 与 lungeShotT 从前那个 bug 同一形状,
  // 判据 tools/smash-check.ts 的 ⑬。
  if ((p.smashAutoT ?? 0) > 0) p.smashAutoT = (p.smashAutoT ?? 0) - 1;

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
  const inFocus = (p.focusT ?? 0) > 0;
  const focusSpeedMul = inFocus ? (C.skills.focus.playerSpeedMul ?? 4.2) : 1;
  const focusAccelMul = inFocus ? (C.skills.focus.playerAccelMul ?? 4.5) : 1;

  if (p.lungeT >= 0) {
    // 跨步中:速度由 lunge 物理冲量完全控制,不被滑轨定点刹停截断
    mv = 0;
    axisCap = 0;
  } else if (isSliderActive) {
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
      const slowDist = (SC?.slowDownDist ?? 22) * (inFocus ? 2.5 : 1);
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
  const mod = activePlayerModifier;
  if (p.stamina !== undefined) {
    if (Math.abs(p.vx) > 0.8) {
      p.stamina = Math.max(0, p.stamina - 0.16);
    } else if (p.onGround) {
      p.stamina = Math.min(100, p.stamina + 0.34);
    }
    p.isExhausted = p.stamina < 25;
    // 三星判据「全程体力未枯竭」:取曾经发生语义,进过枯竭态就记账(可恢复,但记录不撤销)
    if (p.isExhausted) p.stats.exhausted = 1;
  }

  // 禁足区警报与僵直
  if (p.forbiddenWarn && p.forbiddenWarn > 0) {
    p.forbiddenWarn--;
    p.vx = 0;
  } else if (mod?.forbiddenNetZone && p.side === "left") {
    const dangerX = CO.netX - mod.forbiddenNetZone;
    if (p.x >= dangerX) {
      p.forbiddenWarn = 24;
      p.vx = -3.5;
      p.stats.zonePenalties++;          // 三星判据「未触发任何禁区惩罚」
    }
  }

  let maxV = PL.vmax;
  if ((p.flashHoldT ?? 0) > 0) {
    // 闪现悬空:人已经定在球的下风高点,这一拍不接受任何移动输入(摇杆/滑轨的拇指稍一动
    // 就把人从球底下拽走,那又是"闪到了却打不到"),横向速度一并清零。
    p.vx = 0;
  } else if (p.lungeT >= 0) {
    // 跨步中:速度由 lunge 逻辑控制,跳过正常加速
  } else if (isSliderActive && axisCap === 0) {
    // 精准定点刹停达成:vx 已置零,无需摩擦
  } else if (!p.forbiddenWarn || p.forbiddenWarn <= 0) {
    // 真人侧多乘一层「移速档位」(core/gait.ts),AI 不叠这层 —— 它已经有 diffs.speed 写进
    // p.speedMul,两层叠一起会让难度档和玩家设置互相污染,回归就在测玩家偏好。
    // 时空减速(focus)激活时赋予倍率加成:对抗世界 slowmo 0.35 并赋予超速移动能力。
    // accel 与 vmax 同比例乘:只提极速不提起步会显得"推起来肉";
    // 跨步冲量与跳跃弹道故意不跟着乘(lunge.speed / jumpV 是另一套手感)。
    const accelMul = (mod?.accelMul ?? 1) * focusAccelMul;
    const vmaxMul = (mod?.vmaxMul ?? 1) * focusSpeedMul;
    const staminaMul = p.isExhausted ? 0.65 : 1;
    const smBase = p.speedMul * (p.isAI ? 1 : Gait.s) * staminaMul;
    maxV = PL.vmax * smBase * vmaxMul * axisCap;
    const accel = PL.accel * (p.onGround ? 1 : PL.airAccelMul) * smBase * accelMul;
    const fMul = mod?.frictionMul ?? 1;
    const baseFriction = p.onGround ? (fMul < 0.5 ? Math.max(0.94, PL.groundFriction + (1 - fMul) * 0.1) : PL.groundFriction) : PL.airFriction;
    const friction = inFocus && mv === 0 ? Math.min(baseFriction, 0.68) : baseFriction;
    if (mv !== 0) p.vx += mv * accel;
    else p.vx *= friction;
    if (mv !== 0) {
      p.vx = clamp(p.vx, -maxV, maxV);
    }
    p.sliding = fMul < 0.5 && Math.abs(p.vx) > 1.2 && mv === 0 ? p.vx : 0;
  }
  if (Math.abs(p.vx) < 0.04) p.vx = 0;
  // 横向安全钳制:跨步是叠加冲量,跑动中爆发可达 vmax+speed,钳制要留够余量。
  // 跑动那一项按同一层 sm 放大(移速档「极快」时真人 vmax 13.8 + 跨步 15 + 3 才够,
  // 不放大就会把跨步冲量凭空削掉一截);时空减速高速也确保容纳。
  const xvCap = Math.max(12, Math.max(PL.vmax * p.speedMul * (p.isAI ? 1 : Gait.s) + LG.speed + 3, maxV + 3));
  if (isSliderActive && targetX !== undefined && p.lungeT < 0) {
    const stepVx = clamp(p.vx, -xvCap, xvCap);
    if ((p.x - targetX) * (p.x + stepVx - targetX) <= 0) {
      p.x = targetX;
      p.vx = 0;
    } else {
      p.x += stepVx;
    }
  } else {
    p.x += clamp(p.vx, -xvCap, xvCap);
  }

  // 侧视球场:始终面向球网,拍面方向 = 出球方向
  p.facing = p.side === "left" ? 1 : -1;

  const minX = p.side === "left" ? CO.wallL : CO.netX + CO.netPad;
  const maxX = p.side === "left" ? CO.netX - CO.netPad : CO.wallR;
  if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }

  // ---------- 跳跃:coyote + 输入缓冲 + 松键截断 ----------
  if (p.onGround) p.coyote = PL.coyote; else if (p.coyote > 0) p.coyote--;
  if (inp.jumpPressed) p.jumpBuf = PL.jumpBuffer; else if (p.jumpBuf > 0) p.jumpBuf--;
  const jumpMul = (mod?.jumpMul ?? 1) * (p.isExhausted ? 0.55 : 1);
  if (p.jumpBuf > 0 && p.coyote > 0 && (!p.forbiddenWarn || p.forbiddenWarn <= 0)) {
    p.vy = PL.jumpV * jumpMul; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
    p.sq = PL.jumpStretch;
    if (p.stamina !== undefined) p.stamina = Math.max(0, p.stamina - 12);
    inp.onJump && inp.onJump(p);
  }
  if (!inp.jumpHeld && p.vy < 0 && !p.onGround) p.vy *= PL.jumpCut;

  if ((p.flashHoldT ?? 0) > 0) {
    // 闪现蓄力期悬停:不吃重力 —— 主循环那几帧定格 + 这里的人定半空,合起来读作"时停里
    // 已经把球扣在拍上,只是世界还没放行"。蓄力一结束重力立刻接管,落地姿态照常。
    p.vy = 0;
  } else {
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
      if (!p.swingHit) {
        p.stats.whiffs++;
        if (activePlayerModifier?.zenFocus) p.zenMeter = 0;
        inp.onWhiff && inp.onWhiff(p);
      }
      p.swingT = -1;
      p.recoverT = SW.blendOut;    // 收拍回摆:渲染端把弧线终点插回待机姿势
      // 收招瞬间消化排队的击球键(挥拍尾声 ~7 帧内按下的就无缝接续下一拍)
      if (p.swingBuf > 0) { startSwing(p, ball, p.swingBufAim); p.swingBuf = 0; }
    }
  } else if (p.swingBuf > 0 && (p.flashHoldT ?? 0) <= 0) {
    // 闪现悬空期不接受手动起拍:那一拍由技能状态机在蓄力结束时发出。
    // 允许的话就是两次挥拍抢同一条时间线,人还悬在半空,球自然打不到。
    startSwing(p, ball, p.swingBufAim); p.swingBuf = 0;
    // 玩家自己按了击打 = 这一拍归他瞄(落点用他滑的方向),技能欠的那一拍当场撤销承诺。
    // 排在上面的手动分支之后正是为了这件事:自动那拍永远不跟手动那拍抢。
    // 两扇窗一起清:重击的附魔不清(那一拍照旧必定暴扣,只是不再由系统代按)。
    p.lungeAutoT = 0;
    p.smashAutoT = 0;
  } else if ((p.lungeAutoT ?? 0) > 0 && !p.isAI && C.lunge.autoReturn && ball && Player.autoSwingDue(p, ball)) {
    // 跨步自动回球:窗口内替玩家按这一拍,起手帧与时机环收满那一帧同源(见 autoSwingDue)。
    // 走 startSwing → tryHit 的**真实**峰值追踪,不碰 flashStrikeT 那条必中分支 ——
    // 用户拍板"不加必中":走位误差、贴墙夹取照样把这拍做坏,只是不用再惦记第二次点击。
    // 起手**不**清 lungeAutoT:它是判定区尾段的开关,清掉会把尾段从正在进行的挥拍里抽走,
    // 那一拍反而够不着刚才自己判成"该打"的球。不重复出拍由 p.swingT < 0(整条 else-if 链)
    // 与 ball.lastHitter(打完就是自家球)两头钉死。
    startSwing(p, ball, LG.autoAim);
  } else if ((p.smashAutoT ?? 0) > 0 && !p.isAI && SM.autoReturn && p.skill
    && p.skill.id === "smash" && p.skill.buffT > 0 && ball && Player.autoSwingDue(p, ball, "smash")) {
    // 重击一键化(2026-10-04):上弦之后到点替玩家把那一记暴扣轰出去 —— 择帧与跨步共用同一条
    // autoSwingDue(够不着/界外/将死/隔网/自家球一律不起手),不另编一套时机,免得两处跑偏。
    // 排在跨步那一支之后是有意的:两扇窗同时开着时先让跨步代拍,因为它自带判定区尾段倍率,
    // 够得着的可能性更大;而那一拍同时吃 lungeShotT + buffT,与玩家自己按时的行为完全一致。
    // 起手**当场清窗**(与 lungeAutoT 相反):它不兼判定区开关,留着只会在替玩家挥空之后
    // 隔二十帧再代一下、又代一下,读起来就是"人物自己乱挥半天"。一次施放最多代一拍。
    // 不加必中:不碰 flashStrikeT,那一拍的"必定暴扣"由 modifyShot 在真打时兑现,
    // 走位误差照样决定这一拍能不能碰到球 —— 代劳的是时机,不是判定。
    p.smashAutoT = 0;
    startSwing(p, ball, SM.autoAim);
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
  /** 跨步自动回球待发窗剩余帧(只真人有;AI 的残缺探针不带 ⇒ `?? 0` 兜底,漏一处就是白给 CPU 手长) */
  lungeAutoT?: number;
}

function strikeZone(p: ZoneProbe, speed: number) {
  const rad = p.swingRadius;
  const fast = clamp(((speed || 0) - C.swing.zoneFullSpeed) / C.swing.zoneTightenSpan, 0, 1);
  // 跨步救球:判定区扩大,延伸方向由跨步方向决定(缺省为面向方向)
  const isLunging = (p.lungeT ?? -1) >= 0;
  // 冲量那 6 帧吃满倍率;之后的「自动回球待发窗」吃一个较小的尾段 —— 球真正被打到通常在
  // 冲量结束之后(最佳按拍帧 ≈ 起手后第 9 帧),尾段一点不给,跨步"手变长"这个卖点就从来没
  // 作用在真正那一拍上(这是旧行为,不是疏忽:旧口径下玩家自己按,早过了就认了)。
  // 尾段只放大半径、**不改延伸方向**(仍是 facing):向后跨步时 lungeDir 与 facing 相反,
  // 让它撑满整窗会把身前的球判成"太靠背后"而拒接 —— 那是把机制做成副作用。
  const lungeMul = isLunging ? C.lunge.reachMul
    : ((p.lungeAutoT ?? 0) > 0 && C.lunge.autoReturn ? C.lunge.reachTailMul : 1);
  const reachDir = isLunging ? (p.lungeDir || p.facing) : p.facing;
  const extraReach = activePlayerModifier?.reachMul ?? 1;
  const off = Physics.strikeOffset(rad, reachDir, lungeMul);
  return {
    x: p.x + off.dx,
    y: p.y + off.dy,
    r: (rad * 0.92 + SW.headR) * (p.zoneScale ?? 1) * lerp(1, C.swing.zoneFastMul, fast) * lungeMul * extraReach,
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

// ---------- 一键自动回球:替玩家按那一拍(跨步 2026-10-04 / 重击同日)----------
const autoPtsBuf: FuturePt[] = [];

/** 一帧前瞻的三份账(全部按「从现在数第几帧」计,0 = 此刻) */
interface BallFuture {
  /** 球进入自己半场那一帧(-1 = 前瞻窗口内一直不在自己半场) */
  cross: number;
  /** 落地那一帧(horizon+1 = 窗口内不落地) */
  land: number;
  /** 落地横向位置(与 rules 的出界判据同一条:x ∈ [CO.left, CO.right] 才算界内) */
  landX: number;
}

/**
 * 按真实积分往前看这条弧(含风与阻尼),一次扫描同时供"过没过网 / 会不会出界 / 来不来得及"三条判据。
 * 为什么必须往前看:来球多数还在网的另一侧(网前抢点尤其如此),而 tryHit 判的是**接触那一帧**
 * 球过没过网 —— 按下当帧就用 inOwnCourt 卡,等于给自动多加一条手动没有的限制。
 */
function ballFuture(p: PlayerEntity, ball: Ball, horizon: number): BallFuture {
  const pts = Physics.futureInto(ball, horizon, autoPtsBuf);
  const out: BallFuture = { cross: inOwnCourt(p, ball.x, ball.y) ? 0 : -1, land: horizon + 1, landX: ball.x };
  for (let i = 0; i < pts.length; i++) {
    const f = i + 1;
    if (out.cross < 0 && inOwnCourt(p, pts[i].x, pts[i].y)) out.cross = f;
    if (pts[i].y >= CO.groundY - 2) { out.land = f; out.landX = pts[i].x; break; }
  }
  return out;
}

/**
 * 代劳那一拍的来源。两条一键化(跨步 / 重击)共用**同一把择帧尺子**,只有四个门控数值各取
 * 一份 config —— 分开两套逻辑迟早一边修好、另一边还在按早按晚。
 */
export type AutoSwingSrc = "lunge" | "smash";

/**
 * 「就是现在」判据:起手帧与时机环收满那一帧**同源** —— game-root.updateSwingCue 拿
 * flightFramesToClosest 算「还有几帧到判定区心」,给玩家的提示额外提前
 * swingCue.reactFrames(10 帧,补"看到→按下"的反应时间)。机器不吃反应,所以门槛就是
 * fc <= PRESS_LEAD_FRAMES 本身:按下后第 9 帧的质量峰,正好落在球过判定区心那一帧。
 * 够不着的球 flightFramesToClosest 返回 null(最近逼近仍超出判定半径)⇒ 绝不起手,
 * 不留"为了兑现机制而挥空"的幽灵拍。每帧重算,所以窗口里玩家改滑轨、风把球带偏,
 * 判读跟着走 —— 宁可晚一帧,不会按早。
 */
function autoSwingDue(p: PlayerEntity, ball: Ball | null, src: AutoSwingSrc = "lunge"): boolean {
  if (!ball || !ball.live || ball.held || ball.flying) return false;   // flying = 得分后球飞回手里
  if (ball.lastHitter === p.side) return false;                        // 自己刚打出去的那一拍
  if (p.hitLock > 0) return false;                                     // 双重击球锁还没解
  const LG = src === "smash" ? C.skills.smash : C.lunge;
  const z = strikeZone(p, Math.hypot(ball.vx || 0, ball.vy || 0));
  const fc = flightFramesToClosest(ball, z.x, z.y, z.r, LG.autoHorizon);
  if (fc === null || fc > PRESS_LEAD_FRAMES) return false;
  const fut = ballFuture(p, ball, LG.autoLandHorizon);
  // 隔网球:接触那一帧球必须在自己半场。判据放宽到"整条命中窗之内会过网",而不是"到最近逼近帧
  // 为止"—— 挥拍有 windup+active 十几帧的窗口,球在窗口里任何一帧过网都打得着(真过不了网的
  // tryHit 自己会拒)。按下当帧就卡 inOwnCourt 等于给自动多加一条手动没有的限制:网前抢点那
  // 一类球全被拒掉,而玩家自己按却打得着(实测差 9 格)。
  if (fut.cross < 0 || fut.cross > SW.windup + SW.active) return false;
  if (fut.land <= LG.autoLandHorizon) {
    // 要飞出边线的球:正确打法是让它落地、把这分收下。替玩家捞回去等于把到手的分还给人家。
    if (fut.landX < CO.left - LG.autoOutMargin || fut.landX > CO.right + LG.autoOutMargin) return false;
    // 挥拍最早也要起拍后第 windup+1 帧才可能接触:球已经在地上了,别空挥。
    if (fut.land <= SW.windup + 1) return false;
    // 球活不到"结算"那一刻就别起手。峰值追账(见 tryHit 头注)只记账不出手,要等球**离开判定区**
    // 或走完窗才结算 —— 贴地快死球死在区里,这一拍永远结不出来:人物明明扫到球,分还是丢了,
    // 读起来就是"它替我挥了个空"。门槛实测取 2 帧(132 格可救来球):0 帧 → 27 格空挥、救到 90;
    // 2 帧 → 24 格空挥、救到 92;3 帧 → 20 格空挥但只救到 87。剩下的 24 格连完美手动也救不到。
    if (fut.land <= fc + LG.autoSettleGrace) return false;
  }
  return true;
}

// 命中判定:挥拍窗口内 + 球在判定区(或真撞上拍头)。
//
// 【结算帧 = 窗口内球离判定区心最近的那帧 —— 挥拍峰值追踪,2026-10-01】
// 旧口径是「球一碰判定区就先到先得」,质量取那一帧的挥拍相位。但球进区比球过心早
// r/v 帧(慢球约 7 帧),想踩甜蜜就得让「球进区第一帧」恰好落在按下后第 9 帧(质量峰),
// 而时机环教的按拍点锚在球心 —— 按环收满按 = 系统性早按,先到先得把这点偏差放大成
// qRaw 崩塌(慢球必出普通球)。玩家「明明按着光环来点,就是没触发」的根因在这。
// 现在窗口内只记账不结算:球离开判定区(之后距离只增不减)或挥拍窗走完时,按账上
// 最优帧出手 —— 按拍对准球心 → 结算帧 ≈ 质量峰帧 → qRaw 顶格;早/晚按的偏差直接进
// qualityAt,不再被进区帧摊薄。闪现保底不走追踪:技能承诺「必中即时」,当场出手。
function tryHit(p: PlayerEntity, ball: Ball): ShotResult | null {
  if (p.swingT < SW.windup || p.swingT > SW.windup + SW.active) return null;
  if (p.swingHit || p.hitLock > 0) return null;
  if (!ball.live || ball.held) return null;
  if (!inOwnCourt(p, ball.x, ball.y)) return null;         // 不能越过网去够(含网口球头/高球抢网容差)
  if (ball.lastHitter === p.side) return null;             // 同队一回合只许击球一次

  const guar = (p.flashStrikeT ?? 0) > 0;
  const edge = guar ? 0 : ballInZone(p, ball);
  const headR = C.swing.headR + C.shuttle.radius;
  const headHit = guar ? false : sweptHit(p.racketPrev.x, p.racketPrev.y, p.racket.x, p.racket.y,
    ball.px, ball.py, ball.x, ball.y, headR);
  const atEdge = edge !== null || headHit;
  const windowEnd = p.swingT >= SW.windup + SW.active;

  if (guar && atEdge) {
    // 保底那一下按 guaranteedQ 上报质量:踩没踩准不由玩家负责,反馈档级直接给到顶。
    // strikeHold 把球按在半空等着,再等「更好的帧」违背必中承诺 → 当场出手
    const gq = Math.max(qualityAt(p.swingT), C.skills.flash.guaranteedQ);
    return settle(p, ball, {
      q: gq, qRaw: gq, dEdge: 0, dRaw: 0,
      bx: ball.x, by: ball.y, bpx: ball.px, bpy: ball.py, swingT: p.swingT,
    });
  }
  if (atEdge) {
    // 记账:这一帧若是目前最佳接触(综合质量最高)就存下,先不出手
    const qRaw = qualityAt(p.swingT);
    const dEdge = headHit ? Math.min(edge ?? 1, 0.35) : edge as number;
    const q = clamp(qRaw - dEdge * 0.28, 0, 1);
    if (!p.swingBest || q > p.swingBest.q) {
      p.swingBest = { q, qRaw, dEdge, dRaw: edge ?? 2, bx: ball.x, by: ball.y, bpx: ball.px, bpy: ball.py, swingT: p.swingT };
    }
  } else if (p.swingBest) {
    return settleBest(p, ball);              // 球已离开判定区 → 账上那帧就是最佳接触
  }
  // 球仍在区内但已从最佳接触点折返远去 → 后面只会有更差的帧,当场出手。
  // 比较用未封顶的 dRaw:拍头扫掠那笔的 dEdge 封在 0.35,拿它比会把正在接近的球
  // 误判成远去,峰还没到就出手。也不能只等「出区/窗尾」:陡坠的重杀从区顶砸到地
  // 都出不了圆(圆底在地面以下),等到落地球都死透了 —— 按准了却接不到杀,更冤。
  if (p.swingBest && edge !== null && edge > p.swingBest.dRaw) {
    return settleBest(p, ball);
  }
  if (windowEnd && p.swingBest) {
    return settleBest(p, ball);              // 慢球/大判定区:球到窗尾都没出区,按账上最优出手
  }
  return null;
}

function settleBest(p: PlayerEntity, ball: Ball): ShotResult | null {
  const best = p.swingBest as SwingBestShot | null;
  return best ? settle(p, ball, best) : null;
}

// 按峰值追踪的记账快照出手:弹道从「最佳接触帧」的球位起,挥拍相位也取那一帧 ——
// 结算晚 1~3 帧只影响出手时机,不影响质量口径(质量的账在记账帧已经定死)。
function settle(p: PlayerEntity, ball: Ball, best: SwingBestShot): ShotResult {
  const dEdge = best.dEdge;
  const qRaw = best.qRaw;
  const q = clamp(qRaw - dEdge * 0.28, 0, 1);
  const sweet = qRaw >= 1 - C.sweet.coreRatio;
  const perfect = qRaw >= 1 - C.perfect.coreRatio;

  p.swingBest = null;
  p.swingHit = true;
  p.swingQ = q;
  p.hitLock = SW.doubleHitLock;
  p.contactFlash = 8;
  p.stats.hits++;
  // 甜蜜/完美统计**按物理质量**记,与后面 ShotResult 上报的档位是两本账:
  // 技能钩子(modifyShot)会把 opt.sweet/perfect 抬到顶档去兑现反馈分级,
  // 但那是"这一拍有多凶",不是"这一拍按得多准" —— 别把 buff 折进统计,否则三星判据与
  // 命中率报表会被技能洗白,连击热手(下面 heat)也跟着虚涨。
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
  // 跳杀:空中 + 击球点够高 = 必然扣杀并加力(真人与 AI 同一通道;闪现折跃天然满足)。
  // 击球点高度取记账帧的球位(结算晚 1~3 帧,球已被打出去,当帧位置不再是击球点)。
  // 注意:若输入为 near(左滑短球),意图是起跳收力点杀/劈吊,不转扣杀。
  const isNear = typeof p.swingAim === "string" ? p.swingAim === "near" : (typeof p.swingAim === "number" && p.swingAim < C.shotClass.netDepth);
  const jumpSmash = !p.onGround && (CO.groundY - best.by) >= C.jumpSmash.minHeight && !isNear;
  // 出手瞬间把球钉回记账帧的接触点:结算比记账晚 1~2 帧,球又飞/坠了一段,而弹道是
  // 按接触点解的 —— 从当帧位置起飞整段偏移(下坠中的慢球尤其明显:低 20px 起飞 = 下网)。
  // px/py 一并回到记账帧的上一帧位,渲染插值/拍头扫掠看到的仍是「飞向接触点」的那一段。
  ball.px = best.bpx; ball.py = best.bpy;
  ball.x = best.bx; ball.y = best.by;
  const shot = buildShot(p, ball, { q, sweet, perfect, dEdge, heat: hot ? heatBefore : 0, lungeShot, jumpSmash });
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
  // 时机教学:真人恒上报带符号时机档(0=正中,负=早,正=晚),量化时机条每拍都画;
  // 没踩进甜蜜窗时再给「早了/晚了」文字提示 —— 踩准了就不打扰。
  // 语义 = 挥拍质量峰(按下后第 PRESS_LEAD_FRAMES 帧)相对结算帧(球过判定区心)的偏差:
  // 结算帧在峰后 = 按早了(球到心时挥拍已经收力),在峰前 = 按晚了。
  if (!p.isAI) {
    const half = SW.active / 2;
    shot.timingGrade = clamp((PRESS_LEAD_FRAMES - best.swingT) / half, -1, 1);
    if (!sweet) {
      shot.timingHint = shot.timingGrade < 0 ? "early" : "late";
    }
  }
  if (shot.kind === "smash") {
    p.smashGlow = 10;
  }
  if (activePlayerModifier?.iaiStrike && qRaw >= 0.94) {
    shot.iaiStrike = true;
    shot.vx *= 1.35;
    shot.vy *= 0.75;
  }
  if (activePlayerModifier?.zenFocus) {
    if (sweet || perfect) {
      p.zenMeter = (p.zenMeter ?? 0) + 1;
      if (p.zenMeter >= 2) {
        p.focusT = 180;
        p.zenMeter = 0;
      }
    }
  }
  return shot;
}

// 由瞄准 + 击球点高度 + 击球质量解出这一拍
function buildShot(p: PlayerEntity, ball: Ball, opt: HitOpt = {}): ShotResult {
  // 技能钩子必须排在解构**之前**:modifyShot 会改写 opt.sweet/perfect/q。
  // 旧写法是先解构常量再调钩子(2026-10-03 前),那三个写入全成死值 —— err 不清零、
  // perfectBoost/perfect.powerDeg 不生效,ShotResult 还按旧档上报,于是「下次挥击必定暴扣」
  // 的技能永远拿不到顶档反馈(晚按 9 帧的附魔拍实测 q=0.30、8 次同参 8 个落点)。
  // 钩子只读球员状态 + opt.lungeShot/opt.q,不依赖误差计算,前置安全。
  const sm = Skills.modifyShot(p, opt);
  const q = opt.q ?? 0.5, sweet = !!opt.sweet, perfect = !!opt.perfect, dEdge = opt.dEdge ?? 0;
  const dir = p.side === "left" ? 1 : -1;
  const h = CO.groundY - ball.y;
  const rawAim = opt.forced ? opt.forced.depth : depthOf(p.swingAim);
  // 网前高球自适应扑推:
  // 当击球点在网前近网处(离网 <= 35px)且高出网顶(y <= netTopY - 15),若玩家未明确指定打深球(默认 mid 档),
  // 意图倾向于前场扑杀/下切推压(depth=0.32),打出干脆利落的前场扑球,避免反解成后场慢平高球。
  const isNetHigh = Math.abs(ball.x - CO.netX) <= 35 && ball.y <= CO.netTopY - 15;
  const aim = (isNetHigh && p.swingAim === "mid" && !opt.forced) ? 0.32 : rawAim;

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
  // 技能与连击热手加成统一在此汇聚
  const lungeShot = !!opt.lungeShot;
  const heatBoost = Math.min((opt.heat || 0) * C.heat.speedBonus, C.heat.speedBonusMax);
  const jm = !!opt.jumpSmash;
  const boost = Math.min(
    (perfect ? C.shot.perfectBoost : sweet ? C.shot.sweetBoost : 0) + heatBoost
      + sm.speedBoost + (jm ? C.jumpSmash.speedBoost : 0),
    C.shuttle.maxSpeed - C.shot.speedMax);
  let powerDeg = (perfect ? C.perfect.powerDeg : sweet ? C.sweet.powerDeg : 0)
    + sm.powerDeg;
  // 跳杀:空中高球必然扣杀 —— 弧度先夹到压弧上限(力度已并入上方 boost 预算)
  if (jm) {
    powerDeg += C.jumpSmash.powerDeg;
  }
  let loft = clamp(Physics.loftFor(depth, h, q) - powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg);
  if (jm) {
    loft = Math.min(loft, C.jumpSmash.maxLoftDeg);
  }
  if (sm.forceSmash) {
    loft = Math.min(loft, 10);
  }

  const shot = Physics.solveShot(ball.x, ball.y, dir, depth, loft, boost);
  if (sm.forceSmash || jm) {
    shot.kind = "smash";
  }
  if (shot.kind === "smash" && !opt.preview) p.stats.smashes++;
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
    jumpSmash: jm,
    // 瞄准档位只在字符串瞄准(真人路径 mid/deep/near)时有意义;AI 直接给数值深度,不上报
    aim: typeof p.swingAim === "string" ? p.swingAim : undefined,
    skillKind: sm.skillKind,
    // 三星判据用的出手瞬间状态:空中占比 / 极滑滑行(极滑关 frictionMul<0.5 且速度够快)
    airborne: !p.onGround,
    sliding: (activePlayerModifier?.frictionMul ?? 1) < 0.5 && Math.abs(p.vx) >= C.star.slideSpeed,
  };
}

/**
 * 球种预告:按真实 buildShot 通道预演「这一拍打出去是什么球种」,给击球键上方的徽标用。
 * 用甜蜜点下限当基准质量(预告回答的是「踩准了会打出什么」),落点误差的随机项仍在 ——
 * 预告与实打共用同一条代码路径,config 怎么改都不会出现「徽标一套判定、实球另一套」。
 * 跳杀成因前置:空中 + 高球直接报扣杀,不等求解器反推。
 * **preview: true 是这条通道的安全带**:buildShot 里的技能钩子会消耗 buff,而本函数
 * 每个真实帧(按 ≤10 帧节流)跑一次。旧写法没有它 —— 按下重击后的第一记预告就把附魔
 * 清零,玩家看到「按了没反应、下一拍还是普通球」还白付冷却(判据 tools/smash-check.ts)。
 */
function previewKind(p: PlayerEntity, ball: Ball): ShotResult["kind"] {
  const isNear = typeof p.swingAim === "string" ? p.swingAim === "near" : false;
  if (!p.onGround && (CO.groundY - ball.y) >= C.jumpSmash.minHeight) {
    if (isNear) return "slash";
    return "smash";
  }
  const q = 1 - C.sweet.coreRatio;
  return buildShot(p, ball, { q, sweet: true, dEdge: 0, heat: 0, preview: true }).kind;
}

// `autoSwingDue`/`ballFuture` 挂上导出面不是巧合:上面的 update 走的是 `Player.autoSwingDue(...)`
// 这一条对象调用,tools/lunge-check.ts 的 --selftest 才能把它换成反例(与 Skills.modifyShot
// 被 player.ts 按对象调用同一个道理 —— 直接闭包调用是换不掉的,那套反例就没牙齿)。
export const Player = { create, update, tryHit, buildShot, previewKind, depthOf, strikeZone, ballInZone, autoSwingDue, ballFuture, setPlayerModifier, getPlayerModifier };
