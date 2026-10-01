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
import { Pace } from "./pace";
import { Player as Pl } from "./player";
import { AI } from "./ai";
import { Skills } from "./skills";
import { Ball, DiffKey, GameEvent, Player, PlayerInput, TeamSide } from "./types";
import { CampaignManager, StageDef } from "./campaign";

const C = CFG;
const CO = C.court;
// 拖尾抽稀计数(每两步画一次)。故意与环境相位时钟分开:那是物理相位,这是一根
// 表现层的节流指针,混用会让"隔步画拖尾"跟风的正弦同相,看起来像拖尾在呼吸。
let trailTick = 0;

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
  /** 当前闯关挑战关卡 (campaign 模式独占) */
  activeStage?: StageDef | null;
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
/** 每侧一块持久缓冲:teamOf 每步被 AI/规则调用七八次,旧版每次都 filter 出新数组。
 *  所有调用点都是「取完当场用完」(find/map/reduce/解构),不外泄引用,复用安全;
 *  左右各一块,同侧嵌套调用不存在。 */
const teamBuf: Record<TeamSide, Player[]> = { left: [], right: [] };
const teamOf = (s: TeamSide): Player[] => {
  const out = teamBuf[s];
  out.length = 0;
  for (const p of R.players) if (p.side === s) out.push(p);
  return out;
};
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
    // 磁轨充能标记必须是**建好的键**:physics 用 `in` 判断能不能写(前瞻用的 scratch
    // 对象上没有它,不该被顺手改脏)。从前这里从不建键,于是那条 guard 恒假 ——
    // 「电浆充能」整个机制在数据层就没落地过,更没人画过它。
    laserBoosted: false,
    sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
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

/**
 * 把难度档落到每个球员身上(脚速 / 判定区 / 出球误差)。
 * 单开成导出函数有两个原因:
 *   1. 任何在 newMatch **之后**才把 isAI 翻真的地方(回归里的 makeAllAI、以后的
 *      「玩家中途退出、CPU 接管」)都必须再调一次它,否则那个人挂着 AI 的脑子
 *      却拿真人的脚速与判定区 —— sim-check 的左队一直就是这样(speedMul 1、zoneScale 1)。
 *   2. 档位参数只有一个写入点,读代码的人不必去猜「谁还会改这些字段」。
 */
function applyAiTier(): void {
  const dbl = R.mode === "2v2";
  const D = C.diffs[R.diff];
  R.players.forEach((p, idx) => {
    p.idx = idx;
    if (!p.isAI) { p.speedMul = 1; p.zoneScale = 1; p.aiAimErr = 0; return; }
    p.speedMul = D.speed;
    // 判定区:人类那套很宽容(手指来不及),CPU 不该白拿满额 —— 双打的 aiZone
    // 与档位 zone 取 min,保证双打的行为与收紧前逐位一致。
    p.zoneScale = dbl ? Math.min(C.doubles.aiZone, D.zone) : D.zone;
    // 出球误差:接 player.ts buildShot 里那条 `err += p.aiAimErr`(此前无人赋值,
    // 所以菜单上「入门 · 常打飞」一直是句空话)。
    p.aiAimErr = D.shotErr;

    // AI 技能配置分配: 难度越高越能解锁高阶技能
    if (R.diff === "easy") {
      p.skill = Skills.initSkillState("lunge");
    } else if (R.diff === "normal") {
      p.skill = Skills.initSkillState("lunge");
    } else {
      p.skill = Skills.initSkillState("lunge");
    }
  });
}

function resetModifiers(): void {
  R.activeStage = null;
  Physics.setEnvModifier(null);
  Pl.setPlayerModifier(null);
}

function newMatch(mode: string, diff: DiffKey, humans?: number): void {
  resetModifiers();

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
                 : (mode === "1p" || mode === "endless" ? "你" : "P1"),
      isAI: !human,
      aiDiff: human ? null : R.diff,
      teamLabel: dbl ? "你方" : (mode === "1p" || mode === "endless" ? "你" : "红方"),
    }));
  }
  // 右队:双打全是 CPU;同屏双人(2p)时是真人 P2
  const rightHuman = !dbl && mode === "2p";
  for (let i = 0; i < n; i++) {
    R.players.push(mk("right", i, n, {
      theme: C.colors.blue,
      label: dbl ? "AI" : (mode === "1p" || mode === "endless" ? "AI" : "P2"),
      isAI: !rightHuman,
      aiDiff: rightHuman ? null : R.diff,
      teamLabel: dbl ? "AI方" : (mode === "1p" || mode === "endless" ? "AI" : "蓝方"),
    }));
  }
  applyAiTier();

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

function startCampaign(stage: StageDef): void {
  R.activeStage = stage;
  CampaignManager.recordAttempt(stage.id);

  Physics.setEnvModifier({
    // oscillate 却没有 windX 时兜 config 那个基准,别在逻辑里写字面量 ——
    // 从前这里 `|| 0.18` 抄了一份,改 config 不会跟着动,而且没人知道还有个隐藏默认值
    windX: stage.modifiers.physics?.windX ?? (stage.modifiers.physics?.windOscillate ? C.env.windDefaultBase : 0),
    windOscillate: !!stage.modifiers.physics?.windOscillate,
    gravityMul: stage.modifiers.physics?.gravityMul ?? 1,
    dragMul: stage.modifiers.physics?.dragMul ?? 1,
    erratic: !!stage.modifiers.physics?.erratic,
    laserRail: !!stage.modifiers.physics?.laserRail,
  });

  Pl.setPlayerModifier(stage.modifiers.player || null);

  R.mode = "campaign";
  R.diff = stage.aiDiff;
  R.humans = 1;
  R.players = [];

  // 左队真人
  R.players.push(mk("left", 0, 1, {
    theme: C.colors.red,
    label: "你",
    isAI: false,
    aiDiff: null,
    teamLabel: "你",
  }));

  // 右队 AI
  R.players.push(mk("right", 0, 1, {
    theme: C.colors.blue,
    label: "AI",
    isAI: true,
    aiDiff: stage.aiDiff,
    teamLabel: "AI",
  }));

  applyAiTier();

  if (stage.aiSkill) {
    const aiPlayer = R.players.find((p) => p.side === "right");
    if (aiPlayer) {
      aiPlayer.skill = Skills.initSkillState(stage.aiSkill);
    }
  }

  if (stage.modifiers.player?.cooldownMul) {
    const cMul = stage.modifiers.player.cooldownMul;
    for (const p of R.players) {
      if (p.skill) {
        p.skill.maxCd = Math.round(p.skill.maxCd * cMul);
        p.skill.cd = 0;
      }
    }
  }

  if (stage.isMatchPointStart) {
    R.scores = [10, 10];
    // 这里从前还顺手 R.deuce = true,后果是第 20 关从第一拍起 HUD 就印
    // 「平分 · 净胜 2 分」并砸 DEUCE 横幅 —— 而这一关真正的规则是**丢一分即败**
    // (见下面 score() 的 deathmatch 分支)。赛点判定改吃关卡 targetScore 之后,
    // 10:10 不再是赛点、11:10 才是,紧张层该来的时候照样来。
    R.deuce = false;
  } else {
    R.scores = [0, 0];
    R.deuce = false;
  }

  R.server = "left";
  R.serveIdx = 0;
  R.winner = null;
  R.rally = 0;
  R.longestRally = 0;
  R.pointNo = 0;
  R.timeScale = 1;
  R.serveWait = 0;
  beginPoint();
}

function beginPoint(): void {
  // 球速档位在这里落地(而不是面板改完立刻生效):此刻场上没有飞行中的球,
  // 换重力不会让谁的残程拐一下。训练场每球重喂也走这条路,所以「改完下一球就是新档」
  // 在对局与训练场里同时成立。
  Pace.commit();
  const mates = teamOf(R.server);
  const s = mates[R.serveIdx % mates.length];
  R.serverPlayer = s;
  const old = R.ball;
  if (old) {
    // 复用落地的球,从落点飞入手中(而非闪现)
    old.flyFromX = old.x; old.flyFromY = old.y;
    old.vx = 0; old.vy = 0;
    old.flying = true; old.flyT = C.scoring.flyToHandFrames;
    old.held = false; old.live = false;
    old.owner = s; old.lastHitter = R.server;
    old.crossed = false; old.netted = false;
    old.shot = null;
    old.sq = 1; old.sqPrev = 1;
  } else {
    // 首球:无历史球,直接到位
    R.ball = makeBall();
    R.ball.owner = s;
    R.ball.lastHitter = R.server;
  }
  R.rally = 0;
  R.state = "SERVE";
  R.timer = C.scoring.servePause;
  R.serveWait = 0;
  for (const p of R.players) { AI.reset(p); Skills.resetPoint(p); p.heat = 0; }   // 连击热手与技能随新的一分复位
  emit("point-start", { server: R.server });
}

// 持球位置:非持拍手(持拍臂对侧)自然后摆的手心 —— 球在身体后侧,与体前的拍明显
// 分开,一眼读出「一手拍、一手球」。数值与 sprites.ts 远臂托球姿势同源:远肩(-9,-72)
// + 悬挂角(206/250)反解 → 手在 x-28、0.515H 处。发球释放点=这里,solveShot 按新触球点
// 重新瞄准,弹道自洽。用 p.y 而非 CO.groundY:跳起发球时球跟着人走,不会留在地面高度。
const handX = (p: Player): number => p.x - p.facing * 28;
const handY = (p: Player): number => p.y - C.player.h * 0.515;

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
    side: shot.hitter.side, idx: shot.hitter.idx, kind: shot.kind, q: shot.q, sweet: shot.sweet,
    perfect: shot.perfect, timingHint: shot.timingHint || null,
    x: shot.contactX, y: shot.contactY, power: shot.power,
    landX: shot.landX, steps: shot.steps, intoNet: shot.intoNet, rally: R.rally,
    vx: shot.vx, vy: shot.vy, heat: shot.hitter.heat, lungeShot: !!shot.lungeShot,
    aim: shot.aim ?? null,
    skillKind: shot.skillKind || null,
    jumpSmash: !!shot.jumpSmash,
    timingGrade: shot.timingGrade,
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
  // 环境相位时钟**只在这里推进**:整仓库唯一一处。从前 physics.step 自己 ++,
  // 于是 UI 前瞻(predictPath / flightFramesTo,每渲染帧上百步)把颤抖球的相位吹成
  // 伪随机 —— 看着"飘忽不定",其实既不可预判也不可复现,那是 bug 不是机制。
  // 放进球update之前:发球蓄力与每分停顿期间风照吹(风向标因此有连续节奏可追);
  // hitstop/慢放期间主循环不调 Rules.step,指针与球一起定格,不会自己走。
  Physics.tickEnv();

  const ball = R.ball as Ball;
  for (const p of R.players) {
    const inp = inputs[p.idx];
    p.lastInp = inp;
    Pl.update(p, inp, ball);
  }
  separate();

  // 得分后球从落点飞入手中:ease-out 插值,期间不可释放/不可击打
  if (ball.flying) {
    const o = ball.owner as Player;
    const tx = handX(o), ty = handY(o);
    const total = C.scoring.flyToHandFrames;
    const elapsed = total - ball.flyT;
    ball.flyT--;
    if (ball.flyT <= 0) {
      // 动画结束:球到位,进入正常持球
      ball.x = tx; ball.y = ty;
      ball.px = tx; ball.py = ty;
      ball.flying = false; ball.held = true;
    } else {
      const t = (elapsed + 1) / total;
      const e = 1 - Math.pow(1 - t, 3);  // ease-out cubic
      ball.px = ball.x; ball.py = ball.y;
      ball.x = ball.flyFromX + (tx - ball.flyFromX) * e;
      ball.y = ball.flyFromY + (ty - ball.flyFromY) * e;
      ball.vx = ball.x - ball.px;
      ball.vy = ball.y - ball.py;
    }
    return;
  }

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
        // 偷后场/高远是 forced 弹道,瞄准档位根本没参与 —— 在源头清掉,免得下面 applyShot
        // 的 hit 事件照常上报 aim,飘出与实际弹道不符的「深球·重/短球·轻」(谎报比不飘更糟)
        shot.aim = undefined;
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

  // 引力吸球:球沿吸力轨道平滑牵引至球员身前
  if (ball.magnetPull) {
    const mp = ball.magnetPull;
    mp.t--;
    const progress = 1 - mp.t / mp.total;
    const ease = 1 - Math.pow(1 - progress, 2);
    ball.px = ball.x; ball.py = ball.y;
    ball.x = mp.fromX + (mp.targetX - mp.fromX) * ease;
    ball.y = mp.fromY + (mp.targetY - mp.fromY) * ease;
    ball.vx = ball.x - ball.px;
    ball.vy = ball.y - ball.py;
    if (mp.t <= 0) {
      ball.magnetPull = null;
      // 牵引到位，立即触发吸球回击
      mp.player.swingHit = true;
      mp.player.hitLock = C.swing.doubleHitLock;
      const shot = Pl.buildShot(mp.player, ball, { q: 1.0, sweet: true });
      applyShot(ball, shot);
    }
    return;
  }

  if (R.state === "POINT") {
    R.timer--;
    if (R.timer <= 0) beginPoint();
    return;
  }

  // 闪现扣杀的"时停":折跃落位后到那一拍出手之前,把整颗球按在半空。
  // 演出上是"时间停了、只有出手的人还在动";机制上是"必中窗口里球不许逃逸"。
  // 没有这一条,对着快速下坠的球按闪现,球会在蓄力那几帧里落地 —— 技能空有冷却,
  // 玩家看到的还是"我闪过去了却打不到"。判定链照常跑(蓄力走完那一帧就得扣出去)。
  const strikeHold = R.players.some((q) => q.skill?.id === "flash" && (q.flashHoldT ?? 0) > 0);
  if (strikeHold) {
    for (const p of R.players) {
      const shot = Pl.tryHit(p, ball);
      if (shot) { applyShot(ball, shot); break; }
    }
    return;
  }

  // 球飞行
  // 风不再在这里就地改写 activeModifier.windX(从前它把"关卡声明的基准幅度"覆盖成
  // 瞬时正弦值,于是 getEnvModifier() 读回来的不是关卡那个数,兜底还得靠字面量 0.18)。
  // 现在 windX 恒为基准,任一时刻的风由 physics 按环境相位算 —— 界面与物理读同一句真话。
  Physics.step(ball);
  // 球体形变恢复:每帧向 1 逼近,击球瞬间的压扁逐渐回到正常
  ball.sqPrev = ball.sq;
  ball.sq = approach(ball.sq, 1, C.fx.ballSquashRecovery || 0.15);
  const minTrailSpeed = (ball.shot && (ball.shot.sweet || ball.shot.perfect)) ? 4 : 6;
  if (trailTick++ % 2 === 0 && Math.hypot(ball.vx, ball.vy) > minTrailSpeed) {
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

  // 闯关挑战模式:按关卡目标分/一球胜负/连赢判定
  if (R.mode === "campaign" && R.activeStage) {
    const stage = R.activeStage;
    const isPlayer = scorerSide === "left";
    const myScore = R.scores[0];
    const opScore = R.scores[1];

    let matchOver = false;
    let winner: TeamSide | null = null;

    if (stage.deathmatch) {
      if (!isPlayer) {
        matchOver = true;
        winner = "right";
      } else if (myScore >= stage.targetScore && myScore - opScore >= 2) {
        matchOver = true;
        winner = "left";
      }
    } else {
      if (myScore >= stage.targetScore) {
        matchOver = true;
        winner = "left";
      } else if (opScore >= stage.targetScore) {
        matchOver = true;
        winner = "right";
      }
    }

    emit("score", { side: scorerSide, reason, matchOver, score: R.scores.slice() });

    if (matchOver) {
      R.winner = winner;
      R.state = "OVER";
      R.reason = winner === "left" ? "通关成功" : "挑战失败";
      R.msg = winner === "left" ? `挑战成功！${stage.title}` : `挑战失败，请再接再厉！`;
      let stars = 0;
      if (winner === "left") {
        stars = 1;
        if (myScore - opScore >= 2) stars++;
        if (opScore === 0 || R.longestRally >= 8) stars++;
        const res = CampaignManager.recordStageClear(stage, myScore, opScore, stars);
        emit("campaign-clear", {
          stageId: stage.id,
          stageNo: stage.stageNo,
          stars,
          firstClear: res.firstClear,
          newStars: res.newStars,
          rewards: stage.rewards,
          score: R.scores.slice(),
        });
      }
      emit("match-over", {
        winner,
        scores: R.scores.slice(),
        longestRally: R.longestRally,
        mode: R.mode,
        stage,
        stars,
      });
    }
    return;
  }

  // 无限模式:不判赛点与终局,比分正常累加,倒计时结束后继续发球
  if (R.mode === "endless") {
    emit("score", { side: scorerSide, reason, matchOver: false, score: R.scores.slice() });
    return;
  }

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
  if (R.mode === "campaign" && R.activeStage) {
    startCampaign(R.activeStage);
  } else {
    newMatch(R.mode, R.diff, R.humans);
  }
}

// 「正在打球」:发球准备 / 相持 / 得分停顿三态。
// HUD 的显隐和触屏虚拟按键的显隐是同一个判据 —— 之前 hud.ts 自己抄了一份
// 三态比较,现在两边都读这一条,加对局态只改一处。
// 可传 state(默认读 R.state):HUD 的 sync 是外部喂进来的 R,让它显式传参更诚实。
// 注意训练场的 SERVE/RALLY/POINT 也算(CAREER/DRILLS 那些面板态不算)。
function isPlaying(state: MatchState = R.state): boolean {
  return state === "SERVE" || state === "RALLY" || state === "POINT";
}

// 这一局的"获胜分"。闯关每关各有 targetScore(3/4/5/12),其余模式吃全局 winScore。
// 从前赛点判定两处都写死 C.scoring.winScore=11,而抢 3 分的关卡比分永远到不了 10,
// 于是**整个闯关模式永远不判赛点**:赛点斩劈横幅、暗角、BGM 紧张层、赛点慢放、赛末哨
// 在 19 个关卡里全部静默 —— HUD 印错 "TO 11" 只是这一条最容易看见的症状。
function winTarget(): number {
  return R.mode === "campaign" && R.activeStage ? R.activeStage.targetScore : C.scoring.winScore;
}

// 赛点判定:任一方距获胜只差 1 分(供 BGM/HUD/镜头切紧张模式)
function isMatchPoint(): boolean {
  if (R.mode === "drill" || R.mode === "endless") return false;
  const w = winTarget();
  const s0 = R.scores[0], s1 = R.scores[1];
  // 平分期间:领先 1 分即赛点(下一分可能赢)
  if (R.deuce) return Math.abs(s0 - s1) >= 1 && Math.max(s0, s1) >= w - 1;
  // 常规:任一方到 winScore-1
  return s0 === w - 1 || s1 === w - 1;
}

// 赛点归属信息
function matchPointInfo(): { active: boolean; side: TeamSide | "both" | null; label: string } {
  if (R.mode === "drill" || R.mode === "endless") return { active: false, side: null, label: "" };
  const w = winTarget();
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
  R, newMatch, startCampaign, resetModifiers, step, restart, pause, resume, isMatchPoint, isPlaying, matchPointInfo, beginPoint, winTarget,
  applyAiTier,
  teamOf, other, teamIdx, mateOf, rivalsOf, shouldChase, statsOf, labelOf, setTrailHook,
};
