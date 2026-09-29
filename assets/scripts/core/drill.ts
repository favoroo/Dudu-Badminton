// ============================================================
// 训练场:喂球机 + 达标判定 + 星级账本
//
// 为什么不自己管球:训练的命脉是「手感和比赛完全同源」——同一套 strikeZone、
// 同一条 solveShot 弹道、同一种 classify 定性,肌肉记忆才迁移得进真实对局。
// 所以世界推进仍然交给 Rules.step,本模块只做两件 rules 不该管的事:
//   ① 生成喂球机的输入(把 swingAim 当数值用,指定落点深度;用起跳帧数指定喂球高度)
//   ② 吃掉 rules 抛来的「这一回合结束」事实,判它算不算本关要练的那一拍
// 依赖方向是单向的:rules 只读 C.drill,绝不引用 Drill,否则就成环。
// ============================================================
import { CFG, DRILLS } from "./config";
import { Rules, RulesState } from "./rules";
import { DrillDef, Player, PlayerInput } from "./types";

const C = CFG;

let def: DrillDef | null = null;   // 当前关卡(DRILLS 里的一条)
let acc: DrillAcc | null = null;   // 本次训练的账本
let t = 0;                         // 喂球机的节拍计数器
let swungBase = 0;                 // 上一球结束时玩家累计的起手数,用来差出「这一球有没有出手」

export interface DrillAcc {
  valid: number; sweet: number; perfect: number; qSum: number;
  attempts: number; plays: number; done: boolean;
}

const newAcc = (): DrillAcc => ({ valid: 0, sweet: 0, perfect: 0, qSum: 0, attempts: 0, plays: 0, done: false });

// ---------- 关卡查表 ----------
const byId = (id: string): DrillDef | null => (DRILLS || []).find((d) => d.id === id) || null;
const cur = (): DrillDef | null => def;

// ---------- 开一关:复位账本,把发球权焊死在喂球机那一侧 ----------
// 必须在 Rules.newMatch("drill") 之后调:那时 R 的形状已经建好了
function begin(id: string): void {
  def = byId(id) || DRILLS[0];
  acc = newAcc();
  t = 0;
  swungBase = 0;
  const R = Rules.R;
  R.server = "right";          // 发球权恒为右:score() 的训练分支不碰它,所以喂球循环自持
  R.serveIdx = 0;
  // 计分条上「AI / P2」这些标签是给比赛写的,训练场叫「喂球机」更容易读
  for (const p of R.players) {
    if (p.side === "right") p.label = "喂球机";
    if (p.side === "left" && !p.isAI) p.label = "你";
  }
  Rules.beginPoint();
}

// ---------- 喂球机的输入 ----------
// 每步都会被 game 层调一次(替换掉右队的 AI.think)。
// 关键:它永远不对活球起手 —— 只会把球发出去,所以「一拍一落」是结构上必然,不靠运气。
function feederInput(p: Player, R: RulesState): PlayerInput {
  const inp: PlayerInput = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  const ball = R.ball;
  // 球不在手上(飞行中 / 停顿中)就把节拍清零:beginPoint 重喂是「同一帧突然回到 SERVE」,
  // 不复位的话第二球起计数器早就越过出球那一帧,喂球机会抱着球永远不发
  if (!def || !ball || !ball.held || ball.owner !== p) { t = 0; return inp; }

  // 先回位:喂球点固定在 p.homeX,不然喂球弧线每次都换
  const dx = p.homeX - p.x;
  if (Math.abs(dx) > 8) {
    inp.left = dx < 0; inp.right = dx > 0;
    t = 0;
    return inp;
  }
  t++;
  if (t <= C.drill.settle) return inp;         // 站稳:边跑边发会歪
  const k = t - C.drill.settle;
  const F = def.feed;
  // 直接把 0..1 的落点深度交给 swingAim(player.depthOf 允许数值直传,这是喂球的原语)。
  // 别和 def.wantKey 混:wantKey 是「要求玩家按哪个键」,和喂球机把球送到哪没关系。
  const depth = F.depth;

  // 用 >= 而不是 ===:挥拍进行中 Player 会自己忽略重复的 aim,所以连续给是安全的,
  // 而万一某一拍没把球放出去,下一拍马上补 —— 不会卡成抱球不动
  if (F.jumpLead > 0) {
    // 起跳后第 jumpLead 帧那一拍才放球:持球点跟着人往上走,所以「喂得多高」= 「第几帧放球」
    if (k === 1) { inp.jumpPressed = true; inp.jumpHeld = true; }
    else if (k < 1 + C.player.jumpApex) inp.jumpHeld = true;   // 保持按到顶点,否则 jumpCut 会截断上升
    if (k >= 1 + F.jumpLead) inp.swingAim = depth;
  } else if (k >= 2) {
    inp.swingAim = depth;                     // 不跳:站立位低手抛,喂出来是高吊弧
  }
  return inp;
}

// ---------- 本关判据 ----------
// 四条门槛各堵一类误判,顺序不能省:
//   lastHitter —— 喂球自己下网/落地也算「左方得分」,不挡就会被白送一分
//   crossed && !netted —— 未过网不算练成
//   scorer === "left" —— 等价于「落在对方界内」(出界与落我方都会判成 right 得分)
//   want —— 以 Physics.classify 为唯一裁判,不另立球种体系
// 再往下是这一关特有的约束:某些球种(尤其 drive)在 classify 里只剩 6° 出射角窄带,
// 单靠球种做不出能稳定练成的关,必须补深度/滞空/落点这类客观量。
export interface DrillEndFact {
  scorer: string;
  reason?: string;
  lastHitter: string | null;
  crossed: boolean;
  netted: boolean;
  rally?: number;
  landX?: number;
  kind?: string;
  q?: number;
  sweet?: boolean;
  perfect?: boolean;
  shot?: { depth: number; landX: number; steps: number; deg: number; contactH: number } | null;
}

function matches(d: DrillDef | null, e: DrillEndFact | null): boolean {
  if (!d || !e) return false;
  if (e.lastHitter !== "left") return false;
  if (!e.crossed || e.netted) return false;
  if (e.scorer !== "left") return false;
  if (d.want.indexOf(e.kind as never) < 0) return false;
  const s = e.shot || {} as NonNullable<DrillEndFact["shot"]>;
  if (d.minDepth != null && (s.depth == null || s.depth < d.minDepth)) return false;
  if (d.maxDepth != null && (s.depth == null || s.depth > d.maxDepth)) return false;
  if (d.minLandX != null && (s.landX == null || s.landX < d.minLandX)) return false;
  if (d.maxLandX != null && (s.landX != null && s.landX > d.maxLandX)) return false;
  if (d.minSteps != null && (s.steps == null || s.steps < d.minSteps)) return false;
  if (d.maxSteps != null && (s.steps != null && s.steps > d.maxSteps)) return false;
  if (d.minContact != null && (s.contactH == null || s.contactH < d.minContact)) return false;
  if (d.maxContact != null && s.contactH != null && s.contactH > d.maxContact) return false;
  return true;
}

// 玩家这一球到底有没有起手(挥空也算,没碰球就不算)
const swungTotal = (): number => {
  const R = Rules.R;
  let n = 0;
  for (const p of R.players) if (p.side === "left") n += p.stats.hits + p.stats.whiffs;
  return n;
};

// ---------- 每一球结束:记分,不记分 ----------
function onEnd(e: DrillEndFact): void {
  if (!def || !acc) return;
  const swung = swungTotal();
  const tried = swung > swungBase;      // 差出「这一球里玩家起手了吗」
  swungBase = swung;
  acc.plays++;
  if (tried) acc.attempts++;            // 没人碰的喂球不计次:不该让玩家被一个和自己无关的计数拦住
  if (!matches(def, e)) return;
  acc.valid++;
  if (e.sweet) acc.sweet++;
  if (e.perfect) acc.perfect++;
  acc.qSum += e.q || 0;
  if (acc.valid >= (def.goal || C.drill.defaultGoal)) acc.done = true;
}

// ---------- 星级:全部用已有机制算,不发明新指标 ----------
// ★1 达标 · ★2 达标且多数踩到甜蜜窗 · ★3 还要有一记完美且平均质量过硬
function starsOf(a: DrillAcc | null): number {
  const goal = def ? (def.goal || C.drill.defaultGoal) : 1;
  const S = C.drill.star;
  if (!a || a.valid < goal) return 0;
  const avgQ = a.qSum / Math.max(1, a.valid);
  if (a.perfect >= 1 && avgQ >= S.avgQ3) return 3;
  if (a.sweet >= Math.ceil(goal * S.sweetRatio)) return 2;
  return 1;
}

const prog = (): DrillAcc => acc || newAcc();
const stars = (): number => starsOf(acc);

// HUD 训练态那一句:关卡名 + 还差几拍 + 这一关的时机提示
function goalText(): string {
  if (!def) return "";
  const g = def.goal || C.drill.defaultGoal;
  const p = prog();
  return `${def.label} ${Math.min(p.valid, g)}/${g} · ${def.cue}`;
}

// 结算面板要的整份账(奖励由 Career.settleDrill 按「是否首次」决定,这里只交事实)
export interface DrillResult {
  def: DrillDef | null;
  stars: number;
  valid: number;
  goal: number;
  sweet: number;
  perfect: number;
  attempts: number;
  plays: number;
  avgQ: number;
}

function result(): DrillResult {
  const goal = def ? (def.goal || C.drill.defaultGoal) : 1;
  return {
    def,
    stars: starsOf(acc),
    valid: acc!.valid,
    goal,
    sweet: acc!.sweet,
    perfect: acc!.perfect,
    attempts: acc!.attempts,
    plays: acc!.plays,
    avgQ: acc!.valid ? acc!.qSum / acc!.valid : 0,
  };
}

function reset(): void { def = null; acc = null; t = 0; swungBase = 0; }

export const Drill = {
  cur, begin, feederInput, matches, onEnd,
  prog, stars, goalText, result, reset,
};
