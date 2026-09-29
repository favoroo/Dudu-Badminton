// ============================================================
// 完美重扣即时回放(老 replay.js 的 TS 移植,零 Cocos 依赖,可在 node 下回归):
// 环形缓冲区存 90 帧快照(1.5s @60Hz),perfect smash 时延迟触发;
// 回放期间主循环冻结游戏逻辑,快照逐帧驱动渲染,播完或任意键/点按跳过。
// 快照写入的是 px/py + x/y(渲染插值对两端),使任意 alpha 下插值恒等于快照;
// 真实状态在 trigger 后第一帧存起,回放结束 restore 归还,不污染逻辑。
// ============================================================
import type { Ball, Player, SwingStyle } from "./types";

/** 回放需要的最小状态结构(Rules.R 结构兼容;不 import rules 避免依赖成环) */
export interface ReplayState {
  ball: Ball | null;
  players: Player[];
}

const BUF_SIZE = 90;         // 90 帧 = 1.5 秒 @60Hz
const REPLAY_DURATION = 90;  // 回放总帧数(整个缓冲)

interface BallSnap {
  x: number; y: number; vx: number; vy: number;
  live: boolean; held: boolean; sq: number; sqPrev: number;
}

interface PlayerSnap {
  x: number; y: number; vx: number; vy: number;
  facing: number; swingT: number; swingStyle: SwingStyle;
  swingRadius: number; onGround: boolean;
  sq: number; sqPrev: number; runAmt: number; runPhase: number;
  lungeT: number; lungeDir: number;
}

interface FrameSnap { ball: BallSnap; players: PlayerSnap[] }

interface OrigState { ball: BallSnap; players: PlayerSnap[] }

export class Replay {
  private buffer: (FrameSnap | undefined)[] = new Array(BUF_SIZE);
  private head = 0;
  private filled = 0;
  private replaying = false;
  private replayFrame = 0;
  private replayStart = 0;
  private overlayA = 0;
  private orig: OrigState | null = null;

  constructor() {
    this.reset();
  }

  /** 清空缓冲(换局/重开时调用:上局的残帧不该混进本局的回放) */
  reset(): void {
    this.buffer = new Array(BUF_SIZE);
    this.head = 0;
    this.filled = 0;
    this.replaying = false;
    this.replayFrame = 0;
    this.overlayA = 0;
    this.orig = null;
  }

  /** 快照:球 + 全体球员(渲染插值对 px/py 不入快照,回放时两端同写即可) */
  private snapshot(R: ReplayState): FrameSnap | null {
    const b = R.ball;
    if (!b) return null;
    return {
      ball: {
        x: b.x, y: b.y, vx: b.vx, vy: b.vy,
        live: b.live, held: b.held, sq: b.sq, sqPrev: b.sqPrev,
      },
      players: R.players.map((p) => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        facing: p.facing, swingT: p.swingT, swingStyle: p.swingStyle,
        swingRadius: p.swingRadius, onGround: p.onGround,
        sq: p.sq, sqPrev: p.sqPrev, runAmt: p.runAmt, runPhase: p.runPhase,
        lungeT: p.lungeT, lungeDir: p.lungeDir,
      })),
    };
  }

  /** 每模拟步推入快照(仅 RALLY 态;回放中不记录) */
  push(R: ReplayState): void {
    if (this.replaying) return;
    const snap = this.snapshot(R);
    if (!snap) return;
    this.buffer[this.head] = snap;
    this.head = (this.head + 1) % BUF_SIZE;
    if (this.filled < BUF_SIZE) this.filled++;
  }

  /** 触发回放(由 game 层在完美重扣后延迟调用;缓冲太少不触发) */
  trigger(): void {
    if (this.replaying) return;
    if (this.filled < 30) return;
    this.replaying = true;
    this.replayFrame = 0;
    this.replayStart = (this.head - Math.min(this.filled, REPLAY_DURATION) + BUF_SIZE) % BUF_SIZE;
    this.overlayA = 0;
  }

  /** 推进回放(每消耗一个模拟步调一次;返回 false 表示已结束) */
  step(): boolean {
    if (!this.replaying) return false;
    this.replayFrame++;
    this.overlayA = Math.min(1, this.overlayA + 0.06);
    if (this.replayFrame >= REPLAY_DURATION) {
      this.stop();
      return false;
    }
    return true;
  }

  private stop(): void {
    this.replaying = false;
    this.replayFrame = 0;
    this.overlayA = 0;
  }

  /** 跳过回放(任意键/点按) */
  skip(): void {
    if (this.replaying) this.stop();
  }

  isActive(): boolean {
    return this.replaying;
  }

  /** 转播氛围渐入度 0..1(表现层据此画暗角/压暗/水印) */
  overlayAlpha(): number {
    return this.overlayA;
  }

  /** 把当前帧快照写进渲染状态(px/py 与 x/y 同写,任意插值系数下都输出快照位置) */
  applySnapshot(R: ReplayState): void {
    if (!this.replaying) return;
    const idx = (this.replayStart + this.replayFrame) % BUF_SIZE;
    const snap = this.buffer[idx];
    const b = R.ball;
    if (!snap || !b) return;
    // 真实状态只在回放第一帧存一次(restore 的数据源)
    if (this.replayFrame === 1 && !this.orig) {
      this.orig = {
        ball: {
          x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          live: b.live, held: b.held, sq: b.sq, sqPrev: b.sqPrev,
        },
        players: R.players.map((p) => ({
          x: p.x, y: p.y, vx: p.vx, vy: p.vy,
          facing: p.facing, swingT: p.swingT, swingStyle: p.swingStyle,
          swingRadius: p.swingRadius, onGround: p.onGround,
          sq: p.sq, sqPrev: p.sqPrev, runAmt: p.runAmt, runPhase: p.runPhase,
          lungeT: p.lungeT, lungeDir: p.lungeDir,
        })),
      };
    }
    const sb = snap.ball;
    b.px = b.x = sb.x;
    b.py = b.y = sb.y;
    b.vx = sb.vx; b.vy = sb.vy;
    b.live = sb.live; b.held = sb.held;
    b.sq = b.sqPrev = sb.sq;
    for (let i = 0; i < R.players.length; i++) {
      const p = R.players[i];
      const sp = snap.players[i];
      if (!sp) continue;
      p.px = p.x = sp.x;
      p.py = p.y = sp.y;
      p.vx = sp.vx; p.vy = sp.vy;
      p.facing = sp.facing;
      p.swingT = sp.swingT;
      p.swingStyle = sp.swingStyle;
      p.swingRadius = sp.swingRadius;
      p.onGround = sp.onGround;
      p.sq = p.sqPrev = sp.sq;
      p.runAmt = sp.runAmt;
      p.runPhase = sp.runPhase;
      p.lungeT = sp.lungeT;
      p.lungeDir = sp.lungeDir;
    }
  }

  /** 回放结束后归还真实状态(跳过时下一模拟步前也要调) */
  restore(R: ReplayState): void {
    const orig = this.orig;
    const b = R.ball;
    if (!orig || !b) { this.orig = null; return; }
    const ob = orig.ball;
    b.px = b.x = ob.x;
    b.py = b.y = ob.y;
    b.vx = ob.vx; b.vy = ob.vy;
    b.live = ob.live; b.held = ob.held;
    b.sq = ob.sq; b.sqPrev = ob.sqPrev;
    for (let i = 0; i < R.players.length; i++) {
      const p = R.players[i];
      const op = orig.players[i];
      if (!op) continue;
      p.px = p.x = op.x;
      p.py = p.y = op.y;
      p.vx = op.vx; p.vy = op.vy;
      p.facing = op.facing;
      p.swingT = op.swingT;
      p.swingStyle = op.swingStyle;
      p.swingRadius = op.swingRadius;
      p.onGround = op.onGround;
      p.sq = op.sq; p.sqPrev = op.sqPrev;
      p.runAmt = op.runAmt;
      p.runPhase = op.runPhase;
      p.lungeT = op.lungeT;
      p.lungeDir = op.lungeDir;
    }
    this.orig = null;
  }
}
