// ============================================================
// 球速档位(时间膨胀)—— 全仓库唯一可以在运行期改写的物理量
// ------------------------------------------------------------
// 为什么不是「把 shot.speedMax 调小」:弹道是反解的(θ 定弧度、二分初速命中落点),
// 砍上限只会让深球够不到底线 —— 实测低点深球落点 798 → 696 → 611,训练场「高远球」
// 关的 minLandX 会直接挂。玩家嫌的其实不是「这一拍有多凶」,而是
// 「从看见球到必须出手之间有几帧」。
//
// 所以做时间膨胀:设每帧位移系数 s(<1 = 更慢),让同一发球的**空间轨迹逐点不变**,
// 只是用 1/s 倍的帧走完。推导(连续式,再回到每步 dt=1 的 Euler):
//   原解 x(t):dx/dt = v,dv/dt = -K|v|v + G
//   令 X(t) = x(s·t),则 V = dX/dt = s·v(st),dV/dt = s²·a(st) = -K|V|V + s²·G
//   ⇒ 重力 ×s²、一切速度类上限/初速 ×s、**阻力系数 K 形式不变**
// K 不许跟着乘 s:阻力是 v² 项,s² 已经被 |V|² 自己吸收掉了。实测同一发重杀(s=0.92)
// K 不动时落点平均漂 2.5px,把 K 也乘 s 会漂 12.2px、顶点高漂 5 倍 —— 那不是放慢,
// 是换了颗球。缩放自证钉在 tools/reach-check.ts 第①段,手滑就会红。
//
// 换来的是什么:玩家侧的帧预算(swing.active / buffer / 最佳提前量 PRESS_LEAD_FRAMES /
// AI 的 entryLead)一个字都不用改,就白多出 1/s 倍的反应时间;来球速度本身变小,
// Player.strikeZone 那条「来球越快判定区越小」(swing.zoneFastMul)自动放宽,
// 不需要为触屏另开一条平台特例。掉帧跳步时每帧丢的**空间**也同比变小。
//
// 不随档缩放的量(它们是**玩家侧**预算,与球无关,别到处乘):
//   swing.*(windup/active/recover/buffer)、player.tapCommitFrames/jumpApex/coyote、
//   lunge.shotWindow、scoring.servePause/pointPause、serve.flickThresh/clearThresh、
//   diffs.*.tick/timingErr、diffs.*.read/zone/shotErr(AI 的站位认定误差是**空间量**、
//     判定区缩放与出球误差跟着几何走,乘 s 等于偷偷改了难度档的相对关系)、
//   fx.hitstop*/slowmo*(变速另有 world.timeScale 那条链)、
//   swingCue.horizonFrames / rampFrames 与 landing.urgentFrames —— 它们是「距球进入判定区
//     还剩几帧」的**剩余帧**预算,不是总滞空帧数:不乘档 = 预告在真实时间里同样提前
//     0.66s 亮起,慢档里只是这段预告覆盖的空间更短。乘了反而让 UI 提前量跟着档变,
//     而按拍时机是玩家侧的,与档无关。
//
// 载体为什么单开一个模块,而不是往 CFG 上写派生值:全仓库没有任何一处在运行期改写
// CFG。一旦把 s 乘进 shuttle.gravity 落盘,这个数就再也读不出「作者值还是档位后值」,
// 而重力被乘两次是静默灾难。这里照 core/utils.ts 的 installStorageBackend 风格:
// 模块级 let + 显式 apply/request/commit,派生值在切换时算好,主循环零乘法。
//
// 生效时机:request 只挂起,由 rules.beginPoint() 调 commit —— 暂停页改完回场时场上
// 可能正飞着一颗按旧时钟解出来的球,立刻换重力会让它的残程拐一下,玩家会当 bug。
// 训练场每球重喂也走 beginPoint,所以「改完下一球就是新档」在两种模式下同时成立。
// ============================================================
import { CFG } from "./config";

/** 档位定义:数值表只住 config.pace.tiers,这里只做查表与派生 */
export interface PaceTier {
  id: string;
  /** 每帧位移相对量(<1 = 更慢) */
  s: number;
  /** 设置面板上给人看的两字档名 */
  label: string;
  /** 一行说明(如「慢 20%(默认)」) */
  note: string;
}

/** 认不出就退回默认档:坏存档 / 手滑打错 id 都不许让物理变成 NaN */
export function paceTierById(id: unknown): PaceTier {
  const T = CFG.pace.tiers;
  if (typeof id === "string") {
    const hit = T.find((t) => t.id === id);
    if (hit) return hit;
  }
  return T.find((t) => t.id === CFG.pace.default) ?? T[0];
}

/** 档位在表里的下标(设置面板那根 step=1 的滑杆用它定位) */
export function paceIndexOf(id: unknown): number {
  const i = CFG.pace.tiers.findIndex((t) => t.id === (typeof id === "string" ? id : ""));
  return i < 0 ? 0 : i;
}

const clampS = (v: number): number =>
  Math.min(CFG.pace.max, Math.max(CFG.pace.min, v));

let active: PaceTier = paceTierById(CFG.pace.default);
let pending: PaceTier | null = null;

// 派生值:切换档位的瞬间算好,物理每步只读字段(不做乘法,更不做查表)
let S = clampS(active.s);
let GRAV = CFG.shuttle.gravity * S * S;
let VMAX = CFG.shuttle.maxSpeed * S;

function setTier(t: PaceTier): void {
  active = t;
  S = clampS(t.s);
  GRAV = CFG.shuttle.gravity * S * S;
  VMAX = CFG.shuttle.maxSpeed * S;
}

export const Pace = {
  /** 当前生效系数 */
  get s(): number { return S },
  /** 档位后的重力 = 基准重力 × s²(物理单步积分读这个) */
  get g(): number { return GRAV },
  /** 档位后的速度硬上限 = 基准 maxSpeed × s */
  get vmax(): number { return VMAX },
  /** 基准初速 → 世界初速:shot.speedMin/speedMax 与各类 boost 预算走这里 */
  shot(v: number): number { return v * S },
  /** 世界速度 → 基准速度:classify 的球种标签与 career 奖励走这里,不随档漂移 */
  ref(v: number): number { return v / S },
  /** 基准帧预算 → 世界帧:球慢了,同样长度的**空间**要用更多帧走完(前瞻/紧迫度) */
  frames(n: number): number { return n / S },
  /** 世界帧实测 → 基准帧:训练场按帧判球速的判据(minSteps/maxSteps)用它折回 */
  refFrames(n: number): number { return n * S },
  id(): string { return active.id },
  tier(): PaceTier { return active },
  /** 启动时直接生效(此刻场上没有球在飞) */
  apply(id: unknown): void { pending = null; setTier(paceTierById(id)); },
  /** 面板改档:只挂起,等下一球 */
  request(id: unknown): void { pending = paceTierById(id); },
  /** 下一球起生效 —— 只由 rules.beginPoint() 调用 */
  commit(): void { if (pending !== null) { setTier(pending); pending = null; } },
  /** 有没有挂着的档(面板提示「下一球起生效」用) */
  get hasPending(): boolean { return pending !== null },
  /** 相对上一版原速的百分比文案(设置面板那行标签用) */
  labelOf(t: PaceTier): string {
    const pct = Math.round((1 - t.s) * 100);
    return pct === 0 ? t.label : `${t.label} · ${pct > 0 ? "慢" : "快"} ${Math.abs(pct)}%`;
  },
};
