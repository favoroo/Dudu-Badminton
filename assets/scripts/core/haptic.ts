// ============ 触觉反馈的分级与排队(纯逻辑,零 cc 依赖)============
// 为什么单独一层:震动这件事,平台调用只有 4 行(见 game/haptics.ts),真正难的是
// 「哪一下该震多重、两件事同时发生时谁先响」—— 而这两条恰恰是打击感分级的一部分,
// 必须能在 node 下断言,不然只能上真机猜。所以这里只有查表 + 排队,不 import cc、
// 不调 Date.now(时间一律由调用方注入),CFG.haptic 是唯一数值来源。
//
// 三条设计决定:
// 1) 强度 = 时长 × 振幅两维。旧实现只有 12/24/40ms 三个时长点,而线性马达手机
//    12~24ms 的 one-shot 基本无感 —— 于是六档打击在触觉通道上被压成"全都一样"。
//    现在 amp 1..255 直接给 Android VibrationEffect,与 fx.hitstop*/shake*/punch* 同序。
// 2) 设备不支持控振幅时,把振幅差折进时长差(0.6 + 0.8·amp/255 倍率),
//    这样「轻/标准/强」在老机型上依然拉开,而不是全体塌成一个默认幅度。
// 3) 排队而不是抢占。Android 的 Vibrator.vibrate 会直接**截断**当前震动,
//    同帧「完美重扣 + 得分」若互相抢占,用户读到的就是断掉的第一下;
//    所以来者一律排在队尾,由 tick 按 gapMs 逐段放出。抢占阈值 preemptRatio
//    只用来决定"队列已满时挤掉谁"。
import { CFG } from "./config";

/** 会震的时机:击球五档 + 技能两型 + 扣杀落地 + 得分 + 胜负。普通对拉/按键不在表里 = 不震。 */
export type HapticKey =
  | "sweet" | "perfect" | "smash" | "sweetSmash" | "perfectSmash"
  | "skill" | "skillLight"
  | "landSmash" | "score" | "win" | "lose";

/** 一段脉冲。amp 是「意图值」1..255:真正下发时若设备不可控振幅,由适配层换成 -1(默认幅度)。 */
export interface HapticSeg {
  ms: number;
  amp: number;
  key: HapticKey;
}

/** 设备能力,由 game/haptics.ts 反射探测一次后缓存 */
export interface HapticCaps {
  hasVibrator: boolean;
  hasAmplitude: boolean;
}

export type GateResult = "fire" | "queue" | "swallow";

interface Pulse { ms: number; amp: number; segs?: number }

const C = CFG.haptic;

/** 一次事件最多展开几段:多段是给"炸开"用的,不是用来放机关枪的 */
const MAX_SEGS = 4;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * 击球六档 → 震动键。**普通档返回 null**,这条判据在这里而不是调用点里,
 * 因为「只在特殊击打震」是要能被 haptic-check 断言的规则,不是散在各处的 if。
 * 分支顺序与 game-root.ts 的 tier 判定同源(perfect+smash 优先于 sweet+smash)。
 */
export function shotKey(smash: boolean, sweet: boolean, perfect: boolean): HapticKey | null {
  if (perfect && smash) return "perfectSmash";
  if (smash && sweet) return "sweetSmash";
  if (smash) return "smash";
  if (perfect) return "perfect";
  if (sweet) return "sweet";
  return null;
}

/** 表里有没有这个键(拼错时让回归红,而不是运行时静默不震) */
export function hasPulse(key: HapticKey): boolean {
  return pulseOf(key) !== null;
}

function pulseOf(key: HapticKey): Pulse | null {
  const table = C as unknown as Record<string, Pulse | undefined>;
  const p = table[key];
  return p && Number.isFinite(p.ms) && Number.isFinite(p.amp) ? p : null;
}

/** 强度档 id → 滑杆下标;认不出退到默认档(与 pace/gait 的IndexOf 同语义) */
export function hapticIndexOf(levelId: string): number {
  const i = C.levels.findIndex((l) => l.id === levelId);
  if (i >= 0) return i;
  const d = C.levels.findIndex((l) => l.id === C.default);
  return d >= 0 ? d : 0;
}

export function hapticLevelId(index: number): string {
  const l = C.levels[clamp(Math.round(index), 0, C.levels.length - 1)];
  return l.id;
}

export function hapticLabel(levelId: string): string {
  return C.levels[hapticIndexOf(levelId)].label;
}

/** 震感的相对强弱:时长 × 振幅。排队挤位与抢占判断都只用这一个量纲。 */
export function segPower(s: HapticSeg): number {
  return s.ms * s.amp;
}

/**
 * 把一次事件摊成要下发的若干段。返回空数组 = 这一震不该发生(无马达/键不在表里)。
 * caps.hasAmplitude 为假时 amp 仍保留意图值(供排队比强弱),下发由适配层折成默认幅度。
 */
export function plan(key: HapticKey, levelId: string, caps: HapticCaps): HapticSeg[] {
  if (!caps.hasVibrator) return [];
  const raw = pulseOf(key);
  if (!raw) return [];
  const lv = C.levels[hapticIndexOf(levelId)];
  const n = clamp(Math.round(raw.segs ?? 1), 1, MAX_SEGS);
  const amp = clamp(Math.round(raw.amp * lv.ampMul), 1, 255);
  let ms = Math.round(raw.ms * lv.msMul);
  // 无振幅控制:把幅度差折成时长差(强弱仍然单调,只是靠时长表达)
  if (!caps.hasAmplitude) ms = Math.round(ms * (0.6 + (0.8 * amp) / 255));
  ms = clamp(ms, C.floorMs, C.capMs);
  const out: HapticSeg[] = [];
  for (let i = 0; i < n; i++) out.push({ ms, amp, key });
  return out;
}

/**
 * 震动闸门:同一时刻只有一段在响,后续段与后续事件按 gapMs 间隔逐段放行。
 * 时间全部外部注入 —— 真机用 Date.now,回归脚本可以用假时钟把三段节奏钉死。
 */
export class HapticGate {
  private active = false;
  private curEnd = 0;
  private curPower = 0;
  private queue: HapticSeg[] = [];
  private lastFireAt = new Map<HapticKey, number>();
  /** 反射桥确认不可用时由适配层置真:从此静默,不再白烧 JNI 往返 */
  private dead = false;

  /** 桥坏了 / 面板收起:清干净并静默 */
  disable(): void {
    this.dead = true;
    this.clear();
  }

  enable(): void {
    this.dead = false;
  }

  /** 丢弃所有待发放(暂停、关面板、退到后台时用),不留"关掉以后还震一下"的尾巴 */
  clear(): void {
    this.active = false;
    this.curPower = 0;
    this.queue.length = 0;
  }

  /** 现在有没有在震/在排队:设置页试震连点时用来避免叠成一坨 */
  busy(): boolean {
    return this.active || this.queue.length > 0;
  }

  /**
   * 提交一次事件(一串同键脉冲)。
   * fire = 立即下发第一段;queue = 已排到队尾,由 tick 放;swallow = 被规则吞掉。
   */
  submit(now: number, burst: HapticSeg[]): GateResult {
    if (this.dead || burst.length === 0) return "swallow";
    const key = burst[0].key;
    const power = segPower(burst[0]);
    // 规则 A 防连打:同键在 throttleMs 内只认第一次
    const prev = this.lastFireAt.get(key);
    if (prev !== undefined && now - prev < C.throttleMs) return "swallow";
    // 规则 B 防自堆:队列里还排着同键就不再排第二次
    if (this.queue.some((s) => s.key === key)) return "swallow";
    // 规则 C 队列上限:待发放最多 maxQueued 段。满了先按强弱挤掉最弱的一段,
    // 挤不动就不进;装得下也只装到上限为止(一次事件的后续段按顺序截断,不整串堆进来)
    if (this.queue.length >= C.maxQueued) {
      let wi = 0;
      let wp = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const p = segPower(this.queue[i]);
        if (p < wp) { wp = p; wi = i; }
      }
      if (power < wp * C.preemptRatio) return "swallow";
      this.queue.splice(wi, 1);
    }
    const room = C.maxQueued - this.queue.length;
    const take = burst.length <= room ? burst : burst.slice(0, room);
    if (take.length === 0) return "swallow";
    const idle = !this.active && this.queue.length === 0;
    if (idle) {
      this.start(now, take);
      return "fire";
    }
    this.queue.push(...take);
    return "queue";
  }

  /**
   * 每帧调一次(真实帧循环,不要放进模拟循环 —— 定格期间不放)。
   * 返回该帧应该下发的一段,没有就 null。
   */
  tick(now: number): HapticSeg | null {
    if (this.dead) return null;
    if (this.active && now < this.curEnd) return null;
    if (this.queue.length === 0) { this.active = false; return null; }
    if (now < this.curEnd + C.gapMs) return null;
    const seg = this.queue.shift() as HapticSeg;
    this.active = true;
    this.curEnd = now + seg.ms;
    this.curPower = segPower(seg);
    this.lastFireAt.set(seg.key, now);
    return seg;
  }

  private start(now: number, burst: HapticSeg[]): void {
    this.active = true;
    this.curEnd = now + burst[0].ms;
    this.curPower = segPower(burst[0]);
    this.lastFireAt.set(burst[0].key, now);
    // 同一事件的后续段紧贴当前这段放(排到队首,不插到别的事件后面)
    if (burst.length > 1) this.queue.unshift(...burst.slice(1));
  }

  /** 仅供回归脚本读状态,运行时不参与判定 */
  peek(): { active: boolean; curEnd: number; curPower: number; queued: number } {
    return { active: this.active, curEnd: this.curEnd, curPower: this.curPower, queued: this.queue.length };
  }
}
