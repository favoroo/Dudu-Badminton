// ============================================================
// 新手操作教学:滑轨版操作的状态机
//
// 为什么照 drill.ts 的骨架:教学的命脉同样是「练的动作和真实对局完全同源」——
// 世界推进仍交给 Rules.step(mode "tutorial"),本模块只做三件 rules 不该管的事:
//   ① 生成喂球机的输入(只有「击球」实操阶段放球,其余阶段抱球 —— 抱着球
//      才有安静的场地让人练移动/起跳;一拍一落是结构必然,不靠运气)
//   ② 逐帧轮询两个不需判球的门控(移动进圈 / 起跳离地)
//   ③ 吃掉 rules 抛来的「这一回合结束」事实(tut-end),判它算不算一拍有效回球
// 依赖方向单向:rules 只读 C.tutorial,绝不引用 Tutorial,否则成环。
//
// 与 Drill 的分工:Drill 判「球练得好不好」(落点/滞空/球种),Tutorial 判
// 「操作会不会」(进圈/离地/回球过网落界内)—— 后者宽得多,教学是教会不是考试。
// ============================================================
import { CFG, TUTORIAL_TOPICS } from "./config";
import { Settings, type MoveMode } from "./settings";
import { Rules, RulesState } from "./rules";
import { Player, PlayerInput } from "./types";

const C = CFG;

// ---------- 回合事实(rules 的 tutorial 分支 emit "tut-end" 的载荷) ----------

export interface TutEndFact {
  scorer: string;
  reason?: string;
  lastHitter: string | null;
  crossed: boolean;
  netted: boolean;
  landX?: number;
}

// ---------- 内部状态 ----------

let topic = 0;             // 面板正在看的主题 0..2(讲解页/实操页共用)
let practicing = false;    // 实操态(大卡收成横幅,场上可操作)还是讲解态
let gates: boolean[] = [false, false, false];
let dwell = 0;             // 移动门控:连续站在圈内的帧数
let hitCount = 0;          // 击球门控:已打回的有效拍数
let failMsg = "";          // 最近一次击球失败的提示(横幅第二行读它)
let savedMode: MoveMode | null = null;   // 教学期间临时切滑轨,原设置存这里,退出恢复
let t = 0;                 // 喂球机的节拍计数器(feederInput 用)

const reset = (): void => {
  topic = 0; practicing = false;
  gates = [false, false, false];
  dwell = 0; hitCount = 0; failMsg = "";
};

// ---------- 开课 / 结课 ----------

// 必须在 Rules.newMatch("tutorial") 之后调:那时 R 的形状已经建好了
function begin(): void {
  reset();
  const R = Rules.R;
  R.server = "right";          // 发球权恒为右:score() 的教学分支不碰它,喂球循环自持
  R.serveIdx = 0;
  for (const p of R.players) {
    if (p.side === "right") p.label = "喂球机";
    if (p.side === "left" && !p.isAI) p.label = "你";
  }
  // 教学按滑轨教:当前不是滑轨就**内存态**临时切过去(persist=false 不写盘),
  // 原设置记下来,退出(end)恢复 —— 摇杆老玩家来体验教学,出门时操作方式原样带回家。
  const cur = Settings.moveMode;
  savedMode = cur !== "slider" ? cur : null;
  if (savedMode) Settings.setPart({ moveMode: "slider" }, false);
  Rules.beginPoint();
}

/** 结课(面板 hide / 退回主菜单 / 重开):恢复操作方式并清状态,重复调无害 */
function end(): void {
  if (savedMode) {
    Settings.setPart({ moveMode: savedMode }, false);
    savedMode = null;
  }
  reset();
}

// ---------- 面板驱动的进度 ----------

function setTopic(i: number): void {
  const t = Math.max(0, Math.min(TUTORIAL_TOPICS.length - 1, i));
  if (t !== topic) { topic = t; dwell = 0; failMsg = ""; }
}

function setPracticing(p: boolean): void {
  if (p !== practicing) {
    practicing = p;
    dwell = 0;
    failMsg = "";
  }
}

// ---------- 门控轮询(game-root 每个模拟步调一次) ----------

function frame(): void {
  if (!practicing) return;
  const R = Rules.R;
  const me = R.players.find((p) => p.side === "left" && !p.isAI);
  if (!me) return;
  if (topic === 0 && !gates[0]) {
    // 移动:站在目标圈里连续停稳 dwellFrames 帧才算(拖过去路过一下不算)
    const T = C.tutorial;
    if (Math.abs(me.x - T.moveTargetX) <= T.moveEps) dwell++;
    else dwell = 0;
    if (dwell >= T.dwellFrames) gates[0] = true;
  } else if (topic === 2 && !gates[2]) {
    // 起跳:人离地就算(上滑/双击都汇到同一个跳跃,不必分辨手势)
    if (!me.onGround) gates[2] = true;
  }
}

// ---------- 每一球结束:判「这一拍算不算」 ----------

/** 击球失败的针对性提示(只有击球实操用得到;三种失败各指一条调法) */
function diagnose(e: TutEndFact): string {
  if (e.lastHitter !== "left") return "等球飞到身前,再按击球键";
  if (e.netted) return "下网了:等球落低一点、仰角给足";
  if (e.scorer !== "left") return "出界了:劲收一点,按住往左滑";
  return "";
}

/** 一拍有效 = 真人打的、过了网、落在对方界内(球种/落点不挑 —— 教学只教「打回去」) */
function validReturn(e: TutEndFact): boolean {
  return e.lastHitter === "left" && e.crossed && !e.netted && e.scorer === "left";
}

function onEnd(e: TutEndFact): void {
  if (!practicing || topic !== 1) return;
  if (validReturn(e)) {
    failMsg = "";
    hitCount++;
    if (hitCount >= C.tutorial.hitGoal) gates[1] = true;
  } else {
    failMsg = diagnose(e);
  }
}

// ---------- 喂球机的输入(照 Drill.feederInput 骨架) ----------

// 只有击球实操放球。多等几拍再挥(普通喂球 k>=2,这里 k>=8):发球类型由持球
// 时长(serveWait)定档,太快会落进「偷后场」的快平球带(flickThresh=22),
// 对第一次接球的人太狠;多等几拍稳稳落在普通发球带里,depth 0.5 是最舒服的中场球。
const FEED_HOLD_FRAMES = 8;

function feederInput(p: Player, R: RulesState): PlayerInput {
  const inp: PlayerInput = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  const ball = R.ball;
  // 球不在手上就把节拍清零(POINT 停顿/飞行途中),否则第二球起计数器早越过了出球帧
  if (!ball || !ball.held || ball.owner !== p) { t = 0; return inp; }

  // 非击球实操(或已练成)一律抱球:场地安静,人才敢专心练移动/起跳
  if (!practicing || topic !== 1 || gates[1]) { t = 0; return inp; }

  // 先回位:喂球点固定在 p.homeX,不然喂球弧线每次都换
  const dx = p.homeX - p.x;
  if (Math.abs(dx) > 8) {
    inp.left = dx < 0; inp.right = dx > 0;
    t = 0;
    return inp;
  }
  t++;
  if (t <= C.tutorial.settle) return inp;      // 站稳:边跑边发会歪
  const k = t - C.tutorial.settle;
  if (k >= FEED_HOLD_FRAMES) inp.swingAim = C.tutorial.feed.depth;
  return inp;
}

// ---------- HUD / 面板读数 ----------

const topicOf = (i: number) => TUTORIAL_TOPICS[Math.max(0, Math.min(TUTORIAL_TOPICS.length - 1, i))];
const doneCount = (): number => gates.filter(Boolean).length;
const allDone = (): boolean => gates.every(Boolean);
const gateDone = (i: number): boolean => !!gates[i];
const hitProgress = (): { done: number; goal: number } => ({ done: hitCount, goal: C.tutorial.hitGoal });
const curTopic = (): number => topic;
const isPracticing = (): boolean => practicing;
const curFail = (): string => failMsg;
const dwellProgress = (): number => Math.min(1, dwell / Math.max(1, C.tutorial.dwellFrames));

/** HUD 顶栏那一句(照 Drill.goalText 的口径:做什么 + 进度) */
function goalText(): string {
  const T = topicOf(topic);
  const head = `教学 ${doneCount()}/${TUTORIAL_TOPICS.length}`;
  return practicing ? `${head} · ${T.practice}` : `${head} · 先看讲解,再去练「${T.label}」`;
}

export const Tutorial = {
  begin, end, setTopic, setPracticing, frame, onEnd, feederInput,
  goalText, topicOf, doneCount, allDone, gateDone, hitProgress,
  curTopic, isPracticing, curFail, dwellProgress,
};
