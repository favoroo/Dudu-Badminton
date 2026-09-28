// ============================================================
// 比赛逻辑:状态机 SERVE → RALLY → POINT → OVER + 发球权 + 计分
// 按「队」组织:每队占球网一侧,一队可以 1 人或 2 人(双打)
// 本模块不碰渲染 / 音效,只往 events 里塞事件,由 game 层统一消费分发。
// (原版 rules.js 曾直接调 DD.FX.ballTrail 画球拖尾,属于表现层依赖泄漏;
//  Cocos 版改为注入钩子,game 层把拖尾函数挂进来,本模块依旧零渲染依赖)
// ============================================================
import { CFG } from "./config";
import { approach, rand } from "./utils";
import { Physics } from "./physics";
import { Player as Pl } from "./player";
import { AI } from "./ai";
import { Ball, DiffKey, GameEvent, Player, PlayerInput, TeamSide } from "./types";

const C = CFG;
const CO = C.court;
let frameTick = 0;

// 表现层钩子:球速够快时每隔一步被调一次,画拖尾是它的事,不是这里的事
let trailHook: ((b: Ball) => void) | null = null;
export function setTrailHook(fn: ((b: Ball) => void) | null): void {
  trailHook = fn;
}

export type MatchState = "MENU" | "SERVE" | "RALLY" | "POINT" | "PAUSED" | "OVER" | "DRILLS" | "DRILLDONE";

export interface RulesState {
  state: MatchState;
  mode: string;
  diff: DiffKey;
  ball: Ball | null;
  /** 左队在前,右队在后;同队两人索引 0=后场 1=前场 */
  players: Player[];
  /** 按队计分 */
  scores: [number, number];
  server: TeamSide;
  /** 双打时同队两人轮换发球 */
  serveIdx: number;
  serverPlayer: Player | null;
  rally: number;
  longestRally: number;
  msg: string;
  reason: string;
  timer: number;
  winner: TeamSide | null;
  timeScale: number;
  events: GameEvent[];
  pointNo: number;
  /** 平分延长:双方都到 winScore-1 后进入 */
  deuce: boolean;
  /** 以下字段在 newMatch / pause 时赋值 */
  humans?: number;
  serveWait: number;
  prevState?: MatchState;
}

const R: RulesState = {
  state: "MENU",
  mode: "1p",
  diff: "normal",
  ball: null,
  players: [],
  scores: [0, 0],
  server: "left",
  serveIdx: 0,
  serverPlayer: null,
  rally: 0,
  longestRally: 0,
  msg: "",
  reason: "",
  timer: 0,
  winner: null,
  timeScale: 1,
  events: [],
  pointNo: 0,
  deuce: false,
  serveWait: 0,
};

const emit = (t: string, data: Record<string, unknown>): void => { R.events.push(Object.assign({ t }, data)); };
const other = (s: TeamSide): TeamSide => (s === "left" ? "right" : "left");
const teamIdx = (s: TeamSide): number => (s === "left" ? 0 : 1);
const teamOf = (s: TeamSide): Player[] => R.players.filter((p) => p.side === s);
const mateOf = (p: Player): Player | null => teamOf(p.side).find((q) => q !== p) || null;
const rivalsOf = (p: Player): Player[] => teamOf(other(p.side));
const labelOf = (s: TeamSide): string => teamOf(s)[0].teamLabel;

// 该不该由这名球员去接:双打按「离落点更近的人接」。
// 不能用"球降到可击高度的点"分工 —— 羽毛球落地很陡,那个点永远偏靠前场网口,
// 结果后场的人整场碰不到球。落点在球被击出时就定死不再变,两人算出的结论一致。
function shouldChase(p: Player, x: number): boolean {
  const t = teamOf(p.side);
  if (t.length < 2) return true;
  const mate = t.find((q) => q !== p) as Player;
  const d = Math.abs(p.x - x) - Math.abs(mate.x - x);
  if (Math.abs(d) > 24) return d < 0;
  return p.zone === "back";                       // 差不多近时后场的人收
}

function makeBall(): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: true, owner: null,
    lastHitter: null, crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
  };
}

function mk(side: TeamSide, i: number, total: number, opts: Partial<Player>): Player {
  const jersey = side === "left" ? ["01", "02"][i] : ["07", "09"][i];
  const isLeft = side === "left";
  const back = isLeft ? CO.netX - 210 : CO.netX + 210;
  const front = isLeft ? CO.netX - 90 : CO.netX + 90;
  return Pl.create(side, Object.assign({ jersey }, opts, {
    homeX: total === 1 ? back : (i === 0 ? back : front),
    zone: total === 1 ? "all" : (i === 0 ? "back" : "front"),
  }));
}

function newMatch(mode: string, diff: DiffKey, humans?: number): void {
  R.mode = mode;
  R.diff = diff || "normal";
  const dbl = mode === "2v2";
  const n = dbl ? 2 : 1;
  R.humans = dbl ? (humans == null ? 1 : humans) : 1;
  R.players = [];

  // 左队:R.humans 名真人(索引 0 恒为 P1),其余是 CPU 搭档
  for (let i = 0; i < n; i++) {
    const human = i < (dbl ? (R.humans as number) : 1);
    R.players.push(mk("left", i, n, {
      theme: C.colors.red,
      label: dbl ? (i === 0 ? ((R.humans as number) === 1 ? "你" : "P1") : ((R.humans as number) === 1 ? "搭档" : "P2"))
                 : (mode === "1p" ? "你" : "P1"),
      isAI: !human,
      aiDiff: human ? null : R.diff,
      teamLabel: dbl ? "你方" : (mode === "1p" ? "你" : "红方"),
    }));
  }
  // 右队:双打全是 CPU;同屏双人(2p)时是真人 P2
  const rightHuman = !dbl && mode === "2p";
  for (let i = 0; i < n; i++) {
    R.players.push(mk("right", i, n, {
      theme: C.colors.blue,
      label: dbl ? "CPU" : (mode === "1p" ? "CPU" : "P2"),
      isAI: !rightHuman,
      aiDiff: rightHuman ? null : R.diff,
      teamLabel: dbl ? "CPU方" : (mode === "1p" ? "CPU" : "蓝方"),
    }));
  }
  const D = C.diffs[R.diff];
  R.players.forEach((p, idx) => {
    p.idx = idx;
    p.speedMul = p.isAI ? D.speed : 1;
    // 只有双打收紧 CPU 判定区,单打保持原样
    p.zoneScale = (p.isAI && dbl) ? C.doubles.aiZone : 1;
  });

  R.scores = [0, 0];
  R.server = "left";
  R.serveIdx = 0;
  R.winner = null;
  R.rally = 0;
  R.longestRally = 0;
  R.pointNo = 0;
  R.deuce = false;
  R.timeScale = 1;
  R.serveWait = 0;       // 发球蓄力计数:SERVE 状态每帧 +1,挥拍释放时查表定发球类型
  beginPoint();
}

function beginPoint(): void {
  const mates = teamOf(R.server);
  const s = mates[R.serveIdx % mates.length];
  R.serverPlayer = s;
  R.ball = makeBall();
  R.ball.owner = s;
  R.ball.lastHitter = R.server;
  R.rally = 0;
  R.state = "SERVE";
  R.timer = C.scoring.servePause;
  R.serveWait = 0;
  for (const p of R.players) AI.reset(p);
  emit("point-start", { server: R.server });
}

const handX = (p: Player): number => p.x + p.facing * 24;
const handY = (p: Player): number => p.y - C.player.h * 0.46;

// ---------- 击球落地 ----------
function applyShot(ball: Ball, shot: ShotLike): void {
  ball.vx = shot.vx;
  ball.vy = shot.vy;
  ball.lastHitter = shot.hitter.side;
  ball.crossed = false;
  ball.netted = false;
  ball.shot = shot;
  R.rally++;
  R.longestRally = Math.max(R.longestRally, R.rally);
  emit("hit", {
    side: shot.hitter.side, kind: shot.kind, q: shot.q, sweet: shot.sweet,
    perfect: shot.perfect, timingHint: shot.timingHint || null,
    x: shot.contactX, y: shot.contactY, power: shot.power,
    landX: shot.landX, steps: shot.steps, intoNet: shot.intoNet, rally: R.rally,
    vx: shot.vx, vy: shot.vy,
  });
}

type ShotLike = NonNullable<Ball["shot"]>;

// 同队两人不许叠在同一个位置
function separate(): void {
  for (const side of ["left", "right"] as TeamSide[]) {
    const t = teamOf(side);
    if (t.length < 2) continue;
    const [a, b] = t;
    const min = C.player.w + 4;
    const d = b.x - a.x;
    if (Math.abs(d) < min) {
      const push = (min - Math.abs(d)) / 2 * (d >= 0 ? 1 : -1);
      a.x -= push; b.x += push;
    }
  }
}

// ---------- 单步 ----------
function step(inputs: PlayerInput[]): void {
  if ((C.frozen as string[]).includes(R.state)) return;

  const ball = R.ball as Ball;
  for (const p of R.players) {
    const inp = inputs[p.idx];
    p.lastInp = inp;
    Pl.update(p, inp, ball);
  }
  separate();

  if (ball.held) {
    const o = ball.owner as Player;
    ball.x = handX(o); ball.y = handY(o);
    ball.px = ball.x; ball.py = ball.y;
    R.serveWait++;
    // 发球:挥拍进入窗口即释放,落点由起拍那一下的击球键(远/近)决定
    if (o.swingT >= C.swing.windup && o.swingT <= C.swing.windup + 2) {
      // 发球博弈:蓄力时长决定发球类型
      const sv = C.serve;
      let q = 0.8, forced: { depth: number } | null = null;
      if (R.serveWait < sv.flickThresh) {
        // 偷后场:快速平球偷袭
        q = sv.flick.q;
        forced = { depth: sv.flick.depthBias };
      } else if (R.serveWait > sv.clearThresh) {
        // 高远发球:高弧线压底线
        q = sv.clear.q;
        forced = { depth: sv.clear.depthBias };
      }
      const shot = Pl.buildShot(o, ball, { q, sweet: false, dEdge: 0.05, forced: forced || undefined });
      // 发球类型后处理:微调弧度和速度
      if (forced) {
        const cfg = R.serveWait < sv.flickThresh ? sv.flick : sv.clear;
        shot.vx *= cfg.speedMul;
        shot.vy += cfg.loftDelta * (o.side === "left" ? -1 : 1) * 0.3;
      }
      releaseBall(ball);
      R.state = "RALLY";
      o.swingHit = true;                       // 这一拍已用掉,不能再顺手补一杆
      o.hitLock = C.swing.doubleHitLock;
      applyShot(ball, shot);
      emit("serve", { side: o.side, type: forced ? (R.serveWait < sv.flickThresh ? "flick" : "clear") : "normal" });
    }
    if (R.timer > 0) R.timer--;
    return;
  }

  if (R.state === "POINT") {
    R.timer--;
    if (R.timer <= 0) beginPoint();
    return;
  }

  // 球飞行
  Physics.step(ball);
  // 球体形变恢复:每帧向 1 逼近,击球瞬间的压扁逐渐回到正常
  ball.sqPrev = ball.sq;
  ball.sq = approach(ball.sq, 1, C.fx.ballSquashRecovery || 0.15);
  const minTrailSpeed = (ball.shot && (ball.shot.sweet || ball.shot.perfect)) ? 4 : 6;
  if (frameTick++ % 2 === 0 && Math.hypot(ball.vx, ball.vy) > minTrailSpeed) {
    trailHook && trailHook(ball);
  }

  // 撞网:擦网后自由落体,落哪侧算哪侧
  const net = Physics.checkNet(ball);
  if (net && !ball.netted) {
    ball.netted = true;
    ball.x = CO.netX + (ball.vx > 0 ? -C.shuttle.radius : C.shuttle.radius) * 0.6;
    ball.vx = -ball.vx * 0.10 + rand(-0.3, 0.3);
    ball.vy = Math.abs(ball.vy) * 0.15 + 0.6;
    emit("net", { x: CO.netX, y: net.y, side: ball.lastHitter });
  }

  // 过网标记
  if (!ball.crossed && ((ball.vx > 0 && ball.x > CO.netX) || (ball.vx < 0 && ball.x < CO.netX))) {
    ball.crossed = true;
    if (ball.netted) emit("let", { side: ball.lastHitter });   // 擦网过网
  }

  // 挥拍命中:同一队每回合只能击球一次(由 tryHit 内的 lastHitter 判定保证)
  for (const p of R.players) {
    const shot = Pl.tryHit(p, ball);
    if (shot) { applyShot(ball, shot); break; }
  }

  // 边线外飞出画面
  if (ball.x < -30 || ball.x > C.world.w + 30) {
    score(other(ball.lastHitter as TeamSide), "出界");
    return;
  }
  // 落地
  if (ball.y >= CO.groundY - 2) {
    ball.y = CO.groundY - 2;
    ball.py = ball.y; ball.px = ball.x;   // 同步插值基准,消除落地抽搐
    ball.vx = 0; ball.vy = 0;
    const landSide: TeamSide = ball.x < CO.netX ? "left" : "right";
    const out = ball.x < CO.left || ball.x > CO.right;
    const hitter = ball.lastHitter as TeamSide;
    const isSmash = !!(ball.shot && ball.shot.kind === "smash" && !ball.netted);
    let scorer: TeamSide, reason: string;
    if (out) { scorer = other(hitter); reason = "出界"; }
    else if (landSide === hitter) { scorer = other(hitter); reason = ball.netted ? "下网" : "未过网"; }
    else { scorer = hitter; reason = ball.netted ? "擦网得分" : isSmash ? "扣杀得分" : "落地"; }
    emit("land", { x: ball.x, y: CO.groundY, out, scorer, isSmash });
    score(scorer, reason);
  }
}

function releaseBall(ball: Ball): void {
  ball.held = false;
  ball.live = true;
  ball.owner = null;
}

function score(scorerSide: TeamSide, reason: string): void {
  if (R.state === "POINT" || R.state === "OVER") return;

  // 训练场:喂球专项不记分、不换手、不判胜负。把这一回合的事实原样抛出去,
  // 由 Drill 决定「算不算本关要练的那一拍」和「什么时候喂下一球」。
  // 位置很关键 —— 必须在上面那条早退之后、R.scores++ 之前:
  // 放在早退之前会重复抛,放在自增之后就是按比赛发钱,经济直接崩。
  // scores/server 一动不动,于是 winScore 永不触发、发球权恒在喂球机一侧,
  // 「停顿 → beginPoint → 重新持球 → 释放」这条既有链路自己就把喂球循环跑起来了。
  if (R.mode === "drill") {
    R.state = "POINT";
    R.timer = C.drill.pointPause;
    R.reason = reason;
    const s = R.ball && R.ball.shot;
    emit("drill-end", {
      scorer: scorerSide, reason,
      lastHitter: R.ball && R.ball.lastHitter, crossed: R.ball && R.ball.crossed, netted: R.ball && R.ball.netted,
      rally: R.rally, landX: R.ball && R.ball.x,
      kind: s && s.kind, q: s && s.q, sweet: !!(s && s.sweet), perfect: !!(s && s.perfect),
      // 关卡判据要的客观量:瞄准深度 / 落点 / 滞空 / 接触点离地高度
      shot: s ? { depth: s.depth, landX: s.landX, steps: s.steps, deg: s.deg, contactH: CO.groundY - s.contactY } : null,
    });
    return;
  }

  R.scores[teamIdx(scorerSide)]++;
  R.server = other(scorerSide);      // 输的一方拿发球权(家里定的规则,不是真实羽毛球规则)
  R.serveIdx++;                      // 双打:同队两人轮换发球
  R.pointNo++;
  R.state = "POINT";
  R.timer = C.scoring.pointPause;
  R.reason = reason;
  R.msg = `${labelOf(scorerSide)} 得分 · ${reason}`;
  // 平分延长:双方都到 winScore-1(如 10-10)后需领先 deuceMinLead 才获胜
  const si = teamIdx(scorerSide), oi = teamIdx(other(scorerSide));
  const s = R.scores[si], o = R.scores[oi];
  const w = C.scoring.winScore;
  const inDeuce = s >= w - 1 && o >= w - 1;
  const cap = C.scoring.deuceCap;
  const matchOver = s >= w && (!inDeuce || s - o >= C.scoring.deuceMinLead || (cap > 0 && s >= cap));
  // 首次进入平分:发事件,UI/BGM 据此切换紧张模式
  if (inDeuce && !R.deuce) {
    R.deuce = true;
    emit("deuce", { score: R.scores.slice() });
  }
  emit("score", { side: scorerSide, reason, matchOver, score: R.scores.slice() });
  if (matchOver) {
    R.winner = scorerSide;
    R.state = "OVER";
    emit("match-over", { winner: scorerSide });
  }
}

function pause(): void {
  if ((C.frozen as string[]).includes(R.state)) return;
  R.prevState = R.state;
  R.state = "PAUSED";
  emit("paused", {});
}

function resume(): void {
  if (R.state !== "PAUSED") return;
  R.state = R.prevState || "RALLY";
  emit("resumed", {});
}

function restart(): void {
  newMatch(R.mode, R.diff, R.humans);
}

// 赛点
function isMatchPoint(): boolean {
  const w = C.scoring.winScore;
  const s0 = R.scores[0], s1 = R.scores[1];
  // 平分期间:领先一方且领先 ≥ 1 分即为赛点
  if (R.deuce) return Math.abs(s0 - s1) >= 1 && Math.max(s0, s1) >= w - 1;
  // 常规:任一方到 winScore-1
  return s0 === w - 1 || s1 === w - 1;
}

// 赛点归属信息
function matchPointInfo(): { active: boolean; side: TeamSide | "both" | null; label: string } {
  const w = C.scoring.winScore;
  const s0 = R.scores[0], s1 = R.scores[1];
  if (R.deuce) {
    // 平分期间:领先方有赛点;同分则无
    if (s0 === s1) return { active: false, side: null, label: "" };
    const side = s0 > s1 ? "left" : "right";
    const deuceLabel = R.deuce ? "平分延长 · " : "";
    if (side === "left") return { active: true, side: "left", label: R.mode === "1p" ? `★ ${deuceLabel}赛末点 (你方)` : `★ ${deuceLabel}赛末点 (红方)` };
    return { active: true, side: "right", label: R.mode === "1p" ? `★ ${deuceLabel}赛末点 (对手)` : `★ ${deuceLabel}赛末点 (蓝方)` };
  }
  const l = s0 === w - 1;
  const r = s1 === w - 1;
  if (l && r) return { active: true, side: "both", label: "决胜赛点 · 赛末点" };
  if (l) return { active: true, side: "left", label: R.mode === "1p" ? "★ 赛末点 (你方)" : "★ 赛末点 (红方)" };
  if (r) return { active: true, side: "right", label: R.mode === "1p" ? "★ 赛末点 (对手)" : "★ 赛末点 (蓝方)" };
  return { active: false, side: null, label: "" };
}

export interface TeamStats {
  hits: number; smashes: number; sweets: number; perfects: number; whiffs: number;
  sweetRate: number; perfectRate: number;
}

const statsOf = (s: TeamSide): TeamStats => {
  const res = teamOf(s).reduce((acc, p) => {
    acc.hits += p.stats.hits; acc.smashes += p.stats.smashes;
    acc.sweets += p.stats.sweets; acc.perfects += p.stats.perfects;
    acc.whiffs += p.stats.whiffs;
    return acc;
  }, { hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0 } as TeamStats);
  res.sweetRate = res.hits > 0 ? Math.round((res.sweets / res.hits) * 100) : 0;
  res.perfectRate = res.hits > 0 ? Math.round((res.perfects / res.hits) * 100) : 0;
  return res;
};

export const Rules = {
  R, newMatch, step, restart, pause, resume, isMatchPoint, matchPointInfo, beginPoint,
  teamOf, other, teamIdx, mateOf, rivalsOf, shouldChase, statsOf, labelOf, setTrailHook,
};
