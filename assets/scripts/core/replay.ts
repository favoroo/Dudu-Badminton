// ============================================================
// 精彩即时回放(零 Cocos 依赖,可在 node 下回归):
// 预分配环形缓冲区存 90 帧快照(1.5s @60Hz),在推入过程中零 GC 分配;
// 仅在死球/得分结算时播放(绝不对打中倒带);
// 回放期间快照逐帧驱动渲染,任意键/点击即刻跳过恢复。
// ============================================================
import type { Ball, Player, SwingStyle } from "./types";

/** 回放需要的最小状态结构(Rules.R 结构兼容;不 import rules 避免依赖成环) */
export interface ReplayState {
  ball: Ball | null;
  players: Player[];
}

const BUF_SIZE = 90;         // 90 帧 = 1.5 秒 @60Hz
const REPLAY_DURATION = 90;  // 回放总帧数(整个缓冲)
const MAX_PLAYERS = 4;       // 最多 4 名球员(双打 2v2)

interface BallSnap {
  x: number; y: number; vx: number; vy: number;
  live: boolean; held: boolean; sq: number; sqPrev: number;
}

interface PlayerSnap {
  x: number; y: number; vx: number; vy: number;
  facing: number; swingT: number; swingStyle: SwingStyle;
  swingRadius: number; onGround: boolean;
  sq: number; sqPrev: number; runAmt: number; runPhase: number;
  lungeT: number; lungeDir: number; lungeShotT: number;
}

interface FrameSnap {
  valid: boolean;
  ball: BallSnap;
  playerCount: number;
  players: PlayerSnap[];
}

function makeBallSnap(): BallSnap {
  return { x: 0, y: 0, vx: 0, vy: 0, live: false, held: false, sq: 1, sqPrev: 1 };
}

function makePlayerSnap(): PlayerSnap {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    facing: 1, swingT: 0, swingStyle: "over",
    swingRadius: 55, onGround: true,
    sq: 1, sqPrev: 1, runAmt: 0, runPhase: 0,
    lungeT: 0, lungeDir: 0, lungeShotT: 0,
  };
}

function makeFrameSnap(): FrameSnap {
  const players: PlayerSnap[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push(makePlayerSnap());
  }
  return {
    valid: false,
    ball: makeBallSnap(),
    playerCount: 0,
    players,
  };
}

export class Replay {
  // 预先分配环形缓冲对象,杜绝运行时 push 产生任何临时垃圾对象
  private readonly buffer: FrameSnap[] = [];
  private readonly orig: FrameSnap = makeFrameSnap();
  private hasOrig = false;

  private head = 0;
  private filled = 0;
  private pending = false;
  private replaying = false;
  private replayFrame = 0;
  private replayStart = 0;
  private overlayA = 0;

  constructor() {
    for (let i = 0; i < BUF_SIZE; i++) {
      this.buffer.push(makeFrameSnap());
    }
    this.reset();
  }

  /** 清空缓冲(换局/重开时调用:上局的残帧不该混进本局的回放) */
  reset(): void {
    for (let i = 0; i < BUF_SIZE; i++) {
      this.buffer[i].valid = false;
      this.buffer[i].playerCount = 0;
    }
    this.head = 0;
    this.filled = 0;
    this.pending = false;
    this.replaying = false;
    this.replayFrame = 0;
    this.overlayA = 0;
    this.hasOrig = false;
  }

  /** 设置/查询是否有回放正在排队等待触发 */
  setPending(p: boolean): void {
    this.pending = p;
  }

  isPending(): boolean {
    return this.pending || this.replaying;
  }

  /** 每模拟步推入快照(零 GC:就地写入预分配槽位) */
  push(R: ReplayState): void {
    if (this.replaying) return;
    const b = R.ball;
    if (!b) return;

    const frame = this.buffer[this.head];
    frame.valid = true;

    // 复制球体状态
    const fb = frame.ball;
    fb.x = b.x; fb.y = b.y; fb.vx = b.vx; fb.vy = b.vy;
    fb.live = b.live; fb.held = b.held; fb.sq = b.sq; fb.sqPrev = b.sqPrev;

    // 复制球员状态(最多 MAX_PLAYERS 名)
    const pCount = Math.min(R.players.length, MAX_PLAYERS);
    frame.playerCount = pCount;
    for (let i = 0; i < pCount; i++) {
      const p = R.players[i];
      const fp = frame.players[i];
      fp.x = p.x; fp.y = p.y; fp.vx = p.vx; fp.vy = p.vy;
      fp.facing = p.facing;
      fp.swingT = p.swingT;
      fp.swingStyle = p.swingStyle;
      fp.swingRadius = p.swingRadius;
      fp.onGround = p.onGround;
      fp.sq = p.sq; fp.sqPrev = p.sqPrev;
      fp.runAmt = p.runAmt;
      fp.runPhase = p.runPhase;
      fp.lungeT = p.lungeT;
      fp.lungeDir = p.lungeDir;
      fp.lungeShotT = p.lungeShotT;
    }

    this.head = (this.head + 1) % BUF_SIZE;
    if (this.filled < BUF_SIZE) this.filled++;
  }

  /** 触发回放(由 game 层在得分/赛点死球停顿阶段调用;缓冲过少则忽略) */
  trigger(): boolean {
    if (this.replaying) return false;
    if (this.filled < 30) {
      this.pending = false;
      return false;
    }
    this.replaying = true;
    this.pending = false;
    this.replayFrame = 0;
    this.replayStart = (this.head - Math.min(this.filled, REPLAY_DURATION) + BUF_SIZE) % BUF_SIZE;
    this.overlayA = 0;
    this.hasOrig = false;
    return true;
  }

  /** 推进回放(每步调一次;返回 false 表示已结束) */
  step(): boolean {
    if (!this.replaying) return false;
    this.replayFrame++;
    this.overlayA = Math.min(1, this.overlayA + 0.08);
    if (this.replayFrame >= REPLAY_DURATION) {
      this.stop();
      return false;
    }
    return true;
  }

  private stop(): void {
    this.pending = false;
    this.replaying = false;
    this.replayFrame = 0;
    this.overlayA = 0;
  }

  /** 跳过回放(任意键/触屏) */
  skip(): void {
    this.pending = false;
    if (this.replaying) this.stop();
  }

  isActive(): boolean {
    return this.replaying;
  }

  /** 转播氛围渐入度 0..1(表现层据此画暗角/压暗/水印) */
  overlayAlpha(): number {
    return this.overlayA;
  }

  /**
   * 把当前帧快照写入渲染状态(px/py 与 x/y 同写,消除插值抖动);
   * 并在首帧将真实状态备份至预分配的 orig 槽中
   */
  applySnapshot(R: ReplayState): void {
    if (!this.replaying) return;
    const idx = (this.replayStart + this.replayFrame) % BUF_SIZE;
    const snap = this.buffer[idx];
    const b = R.ball;
    if (!snap || !snap.valid || !b) return;

    // 真实状态只在回放第一帧备份一次(就地写入 orig,零 GC)
    if (!this.hasOrig) {
      this.hasOrig = true;
      const ob = this.orig.ball;
      ob.x = b.x; ob.y = b.y; ob.vx = b.vx; ob.vy = b.vy;
      ob.live = b.live; ob.held = b.held; ob.sq = b.sq; ob.sqPrev = b.sqPrev;
      const oCount = Math.min(R.players.length, MAX_PLAYERS);
      this.orig.playerCount = oCount;
      for (let i = 0; i < oCount; i++) {
        const p = R.players[i];
        const op = this.orig.players[i];
        op.x = p.x; op.y = p.y; op.vx = p.vx; op.vy = p.vy;
        op.facing = p.facing;
        op.swingT = p.swingT;
        op.swingStyle = p.swingStyle;
        op.swingRadius = p.swingRadius;
        op.onGround = p.onGround;
        op.sq = p.sq; op.sqPrev = p.sqPrev;
        op.runAmt = p.runAmt;
        op.runPhase = p.runPhase;
        op.lungeT = p.lungeT;
        op.lungeDir = p.lungeDir;
        op.lungeShotT = p.lungeShotT;
      }
    }

    // 写入羽毛球
    const sb = snap.ball;
    b.px = b.x = sb.x;
    b.py = b.y = sb.y;
    b.vx = sb.vx; b.vy = sb.vy;
    b.live = sb.live; b.held = sb.held;
    b.sq = b.sqPrev = sb.sq;

    // 写入球员
    const count = Math.min(R.players.length, snap.playerCount);
    for (let i = 0; i < count; i++) {
      const p = R.players[i];
      const sp = snap.players[i];
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
      p.lungeShotT = sp.lungeShotT;
    }
  }

  /** 回放结束后归还真实状态 */
  restore(R: ReplayState): void {
    if (!this.hasOrig) return;
    const b = R.ball;
    if (b) {
      const ob = this.orig.ball;
      b.px = b.x = ob.x;
      b.py = b.y = ob.y;
      b.vx = ob.vx; b.vy = ob.vy;
      b.live = ob.live; b.held = ob.held;
      b.sq = ob.sq; b.sqPrev = ob.sqPrev;
    }
    const count = Math.min(R.players.length, this.orig.playerCount);
    for (let i = 0; i < count; i++) {
      const p = R.players[i];
      const op = this.orig.players[i];
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
      p.lungeShotT = op.lungeShotT;
    }
    this.hasOrig = false;
  }
}

/** 全局回放单例:GameRoot 驱动,UIManager 与输入层可直接观察状态 */
export const replay = new Replay();

