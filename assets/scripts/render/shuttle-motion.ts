// ============================================================
// 羽毛球本体的"运动学外观"状态机 —— 只算视觉量,不碰任何游戏状态。
//
// 为什么要单独立一个文件:老画法把球的态度写死成 `atan2(vy, vx)`
// (sprites.drawShuttle),于是变向的那一帧球头会"啪"地整只翻过去 —— 现实中
// 羽毛球是被空气拖着转的,永远追着速度方向、且会过冲。要的是"活着在飞",
// 不是"贴着速度矢量的图标"。同理:翻滚、羽片受力炸开、压扁回弹的过冲,
// 都需要**跨帧记忆**,而 Ball 结构体不许加字段(drill-anim/career-panel
// 与两个 tools 都在手搓 Ball 字面量),所以这份记忆住在渲染层。
//
// 铁律对账:本文件零 cc、只读 core/config;由 world.ts 每渲染帧推进一次,
// 不回写 ball 的任何字段 —— 逻辑层看不见它,关掉它游戏照样跑。
// ============================================================
import { CFG } from "../core/config";
import { clamp, rand } from "../core/utils";
import { springTo, wrapAngle } from "./easing";

const C = CFG;

/** 击球档位(与 ribbon 的档位同源;0 最克制,4 最炫) */
export const TIER_NORMAL = 0;
export const TIER_SWEET = 1;
export const TIER_SMASH = 2;
export const TIER_SWEET_SMASH = 3;
export const TIER_FIRE = 4;

/**
 * 球体视觉状态。ang 是**滞后角**:球头指向,弹性追踪真实速度方向;
 * roll 让羽片明暗交替(无贴图也能读出自转);splay 是被击中的那一下
 * 裙摆炸开的余量; wob/wobPhase 是压扁回弹的过冲振荡; pop 是命中整球缩放。
 */
export interface ShuttleMotion {
  ang: number;
  angVel: number;
  roll: number;
  splay: number;
  wob: number;
  wobPhase: number;
  pop: number;
  tier: number;
  heat: number;
  lastSpeed: number;
  /** 静止/持球时的朝向计时(让发球前的球也有轻微呼吸,不是死物) */
  idle: number;
}

export function makeShuttleMotion(): ShuttleMotion {
  return {
    ang: Math.PI / 2, angVel: 0, roll: rand(0, Math.PI * 2), splay: 0,
    wob: 0, wobPhase: 0, pop: 0, tier: TIER_NORMAL, heat: 0, lastSpeed: 0, idle: 0,
  };
}

/**
 * 击球瞬间冲入:由 game 层在 hit 事件里喂(world.shuttleImpact),与震屏/白闪同一入口。
 * strength≈档位强度;tier 决定 pop 幅度与染色余量。
 */
export function shuttleImpact(m: ShuttleMotion, tier: number, strength = 1, heat = 0): void {
  const f = C.fx;
  m.tier = tier;
  m.heat = heat;
  // 命中越狠,pop 与裙摆炸开越大(普通拍只轻颤一下,不给炫技)
  const popK = tier >= TIER_SMASH ? (f.shuttlePopSmash || 0.1) : (f.shuttlePopSmash || 0.1) * 0.35;
  m.pop = Math.max(m.pop, popK * (0.6 + 0.4 * strength));
  m.splay = Math.max(m.splay, 0.35 + 0.65 * clamp(strength, 0, 1));
  m.wob = 1;
  m.wobPhase = 0;
}

/**
 * 每渲染帧推进一步(dt 为渲染帧数,通常 1)。
 * 只读速度/压扁值,**不写回 ball**。
 */
export function advanceShuttle(m: ShuttleMotion, vx: number, vy: number, sq: number, dt = 1): void {
  const f = C.fx;
  const sp = Math.hypot(vx, vy);
  // 静止(发球持球/死球)时球头朝下,给一点呼吸,不做"啪地翻面"
  const target = sp > 0.35 ? Math.atan2(vy, vx) : Math.PI / 2;
  if (sp <= 0.35) m.idle += dt; else m.idle = 0;

  // 弹性追踪:比"最短弧"追,过冲后再被拽回来 —— 变向时看得出空气阻力
  const delta = wrapAngle(target - m.ang);
  const step = springTo(0, delta, m.angVel, f.shuttleAlignK || 0.3, f.shuttleAlignDamp || 0.66);
  m.ang = wrapAngle(m.ang + step[0]);
  m.angVel = step[1];

  // 翻滚:速度越快转得越急(实际是绕飞行轴的滚转,靠羽片明暗交替体现)
  m.roll += (f.shuttleRollK || 0.0055) * sp * dt;
  if (m.roll > Math.PI * 2) m.roll -= Math.PI * 2;

  // 受力外扩:速度突变(被抽到的那一帧)决定裙摆炸开量;空气随后慢慢收拢
  const dv = Math.abs(sp - m.lastSpeed);
  const splayTarget = clamp(dv * (f.featherSplayK || 0.075), 0, 1);
  m.splay = Math.max(m.splay * Math.pow(f.featherSplayDecay || 0.88, dt), splayTarget);
  m.lastSpeed = sp;

  // 压扁回弹振荡:命中给满幅,之后指数衰减;振幅由"还有多扁"缩放(见 shuttleWobble)
  m.wob *= Math.pow(f.shuttleWobDamp || 0.74, dt);
  m.wobPhase += (f.shuttleWobFreq || 0.62) * dt;
  if (m.wob < 0.01) m.wob = 0;

  // 命中整球缩放 pop
  m.pop *= Math.pow(f.shuttlePopDecay || 0.7, dt);
  if (m.pop < 0.002) m.pop = 0;
}

/**
 * 回弹位移(叠加进 sqX/sqY 的相对量):压扁越深、回弹过冲越明显,恢复到位后自动静止。
 * 老实现是 approach 单调爬回 1,看着像块橡皮。
 */
export function shuttleWobble(m: ShuttleMotion, sq: number): number {
  const f = C.fx;
  const flatten = clamp(1 - sq, 0, 0.6) / 0.6;       // 1=刚被抽扁, 0=已恢复
  return Math.sin(m.wobPhase) * m.wob * (f.shuttleWobK || 0.13) * flatten;
}
