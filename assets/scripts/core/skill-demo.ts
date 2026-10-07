// ============================================================
// 技能配置弹窗里那块「怎么用」图示的**真值烘焙**(core,零 cc,可 node 回归)。
//
// 为什么长这样:演示最容易犯的病是「为画面另编一套参数」—— 手画一条抛物线、随手取个 q、
// 标注写「判定区变大」而实机是 1.55 倍。训练场 0.0.21 与教学 0.0.24 都栽过一次,
// 症状都一样:玩家照演示做,球根本不那么飞。这里从根上堵死:**演示不自己算任何一帧**,
// 而是把 `Rules.newMatch` + `Rules.step` 当真机一样跑一遍,逐帧抄下人物与球的位置。
// 于是:
//   · 弹道 = 引擎积分出来的那一条(与实机同一 Physics.step、同一 pace/gait 折算);
//   · 按下那一帧真的过了 `Skills.canActivate`(过不了就跑不出兑现,搜索也就搜不到);
//   · 「自动轰出那一拍」是 `Player.autoSwingDue` 那把尺子选的帧,不是演示挑的好看帧;
//   · 标注里的数字全部现读 CFG —— 改数值,演示与判据一起动,不存在第二份。
//
// 局面怎么摆:来球用 `core/drill-demo.simulateFeed`(训练场喂球机的真弧)的释放点与初速,
// 交回引擎继续积分;主人物站在「不跨步就够不着」的位置。按下那一帧**不写死**:
// `findCast` 从最早一帧起逐帧试,取**第一次真的兑现出这一拍**的帧(演示演的是它真会发生的
// 那一次,不是"我们假装它在第 40 帧生效")。跑不通的款(局面摆不出效果)烘焙返回 null,
// 面板就不画那块 —— 宁可没有图示,也不要一张假图示。
//
// ⚠ 这一跑走 `Rules.isolated()`:烘焙换上一块一次性的对局状态,跑完原样换回。
//   直接跑在全局 R 上会把玩家眼前那一局整块替换掉(state/比分/球员全变),而界面靠轮询
//   `R.state` 换屏 —— 后果就是「点一下技能,游戏突然自己开打了」(2026-10-07 现场)。
//   闸门:tools/skill-check.ts 的 G 段。
//
// ⚠ 分步文案住这个模块,不住 config.ts:数字仍然全部现读 CFG,只有「第几步说什么话」是
//   演示自己的产物(与 DRILLS[].demoSteps 同性质)。放这儿是因为它是演示的一部分、且只有
//   一个消费者;搬进 config 反而把「文案」与「算它的那段代码」拆两处,改数值的人看不见字。
//
// 依赖方向:types ← config ← drill-demo ← 本模块。本模块**不 import ui/render 任何东西**,
// 所以 tools/skill-demo-check 与 ui/skill-diagram 拿到的是同一份帧数据。
// ============================================================
import { CFG } from "./config";
import { Rules } from "./rules";
import type { RulesState } from "./rules";
import { Skills } from "./skills";
import { Player as Pl } from "./player";
import { simulateFeed } from "./drill-demo";
import { Ball, GameEvent, Player, PlayerInput, SkillId } from "./types";

const C = CFG;
const CO = C.court;

/** 一帧抄下来的位置与读数 —— 绘制层只许读这些字段,不许再算 */
export interface DemoSnap {
  /** 帧号(= frames 下标) */
  t: number;
  /** 主角脚底(世界坐标,y 向下) */
  x: number;
  y: number;
  /** 移速(图示用它决定拖尾朝哪边 —— 跨步往左冲,风道就该甩在右边) */
  vx: number;
  facing: number;
  onGround: boolean;
  sq: number;
  /** < 0 = 没在挥拍 */
  swingT: number;
  /** ≥ 0 = 跨步冲量期 */
  lungeT: number;
  /** 球:null = 这一帧没有活球(还没喂出来) */
  ball: { x: number; y: number; vx: number; vy: number } | null;
  /**
   * 判定区圆心与半径 —— 现读 `Player.strikeZone`,也就是 tryHit 用的那一个。
   * 画它的理由:跨步的 ×1.55、时空的 ×1.25 是**这款技能最该被看懂的一件事**,
   * 而它一旦只用文字说,就是一句"判定区变大"。圈画出来,大多少一眼就有数。
   */
  zone: { x: number; y: number; r: number };
  /**
   * 引力吸球的吸附点(= 拍前位),现读 `Skills.magnetAimPoint`。
   * 记它而不是让绘制层自己估"拍前大概这么远":漩涡与电弧的落点必须和真牵引的目标是同一个点。
   */
  aim: { x: number; y: number };
  /** 键面此刻按得下去吗(= Skills.canActivate,与实机点亮/置灰同一判据) */
  ready: boolean;
  /** 技能键面(与实机同一份状态:冷却环/蓄能环就照它画) */
  cd: number;
  maxCd: number;
  buffT: number;
  /** 代拍窗剩余(>0 = 系统在等"该按的那一拍") */
  autoT: number;
  /** 闪现折跃起点(null = 不在折跃期) */
  flashFrom: { x: number; y: number } | null;
  flashHoldT: number;
  flashStrikeT: number;
  /** 时空领域剩余帧(>0 = 领域开着) */
  focusT: number;
  /** 怒气存量(1 点 = 一管的 1%) */
  rage: number;
  /** 影分身:slot 才是身份(颜色/防区),下标会随消散漂 */
  clones: { slot: number; x: number; y: number; hits: number; spawnT: number; despawnT: number }[];
  /** 这一帧真出手了 */
  hit: boolean;
  /** 这一拍是系统代打的(一键化) */
  auto: boolean;
  /** 兑现的那一拍是不是这一款技能加成的一拍 */
  bySkill: boolean;
  /** 这一拍是影分身接的(影分身的「兑现」不长在 skillKind 上) */
  byClone: boolean;
  /** 球种(引擎解出来的,不是演示标的) */
  kind: string;
  /** 这一拍的落点 x(引擎算的) */
  landX: number;
}

/** 分步讲解的一步:钉在哪一帧、说什么 */
export interface DemoStep {
  name: string;
  text: string;
  frame: number;
}

export interface SkillDemoBake {
  id: SkillId;
  frames: DemoSnap[];
  /** 按下技能键那一帧 */
  cast: number;
  /** 兑现那一拍那一帧(-1 = 没兑现,烘焙不会返回这种) */
  hit: number;
  steps: DemoStep[];
  /** 演示取景的世界 x 区间(主角这一侧 + 来球最远处) */
  view: { x0: number; x1: number };
  /** 一个循环的帧数 */
  loop: number;
}

// ---------- 局面参数 ----------

/** 搜索按下帧的起点与步长:逐帧试到第一次真兑现为止 */
const CAST_MIN = 2;
const CAST_MAX = 150;
const CAST_STRIDE = 2;
/** 兑现之后再演这么多帧(球飞出去、收势) */
const TAIL = 74;
/** 单局最多跑这么多帧(球落地/得分就停) */
const HARD_STOP = 320;
/** 影分身局面里预先站好几枚(真机是每分召一次,三枚要三分攒;演示演的是满防线) */
const PRE_CLONES = 2;

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 主角站位:每款一个「不用这款技能就够不着」的位置 */
function standOf(id: SkillId): { x: number; depth: number } {
  // 来球深浅(喂球机的 aimDepth)与主角站位配套:深球落到他身后,他才需要技能。
  const deep = C.aimDepth.deep;
  const mid = C.aimDepth.mid;
  switch (id) {
    case "lunge": return { x: CO.netX - 210, depth: deep };      // 球压他反手底线,站着差一截
    case "flash": return { x: CO.netX - 250, depth: deep };      // 高球在头顶,不折跃只能等它掉下来
    case "magnet": return { x: CO.netX - 150, depth: deep };     // 球已经飞到他身后,吸回来
    case "focus": return { x: CO.netX - 300, depth: deep };      // 差得远,靠领域超速跑位
    case "smash": return { x: CO.netX - 230, depth: mid };       // 就位的一球,预开启等它到点
    case "shadow": return { x: CO.netX - 330, depth: mid };      // 人退到底线,球交给分身接
    default: return { x: CO.netX - 230, depth: mid };            // rage
  }
}

/** 逐帧输入:主角默认「朝球跑」—— 跑得到跑不到正是每款技能要解决的同一件事 */
function driveInput(id: SkillId, f: number, hero: Player, ball: Ball | null): PlayerInput {
  const inp = emptyInput();
  if (!ball) return inp;
  // 影分身那局主角**不追球**(追到了就轮不到分身接),站着看
  if (id === "shadow") return inp;
  const gap = ball.x - hero.x;
  if (Math.abs(gap) > 6) { inp.left = gap < 0; inp.right = gap > 0; }
  // 只有时空领域需要"人自己按那一拍":它给的是跑得动 + 打得狠,不替玩家起手
  // (闪现/吸球的状态机自己起拍,跨步/重击/怒气各有各的代拍窗 —— 这里再按一次就是抢戏)。
  // 按下的那一帧不是挑出来的好看帧,是实机那把择帧尺子 Player.autoSwingDue 说的"就是现在"。
  if (id === "focus" && Pl.autoSwingDue(hero, ball, "auto")) inp.swingAim = C.aimDepth.mid;
  return inp;
}

/** 摆一局面:真喂球弧 + 真人主角 + 装了这款技能 */
function setup(id: SkillId, standX: number, depth: number): boolean {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  const rival = R.players[1];
  hero.isAI = false;
  hero.skill = Skills.initSkillState(id);
  hero.skill2 = undefined;
  hero.shadowCast = false;
  hero.shadowClones = [];
  Skills.resetPoint(hero);
  hero.x = standX;
  hero.y = CO.groundY;
  hero.px = hero.x; hero.py = hero.y;
  hero.vx = 0; hero.vy = 0;
  hero.onGround = true;
  hero.facing = 1;
  if (id === "rage") hero.rage = C.skills.rage.max;   // 演示演「满管按一下」,攒的过程另有一步标注
  if (id === "shadow") {
    // 「同场三枚」是真机里三分攒出来的(每分只能召一次)。演示要演满防线怎么守,所以用**真工厂**
    // 先补 PRE_CLONES 枚(0/1 号),这一拍按下去进去的是最后一枚 —— 摆的是能到达的状态,不是假剪影。
    for (let i = 0; i < PRE_CLONES; i++) Pl.spawnShadowClone(hero);
    for (const sc of hero.shadowClones ?? []) {
      sc.spawnT = 0;                       // 成影演出早演完了
      sc.entity.x = sc.entity.homeX;       // 各自已经站回自己的防区
      sc.entity.px = sc.entity.x;
    }
    hero.shadowCast = false;               // 本分还没召过(那几枚是上一分攒下的)
  }

  const feed = simulateFeed(depth, 0);
  if (!feed) return false;
  const ball = R.ball as Ball;
  ball.x = feed.released.x;
  ball.y = feed.released.y;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = feed.shot.vx;
  ball.vy = feed.shot.vy;
  ball.live = true;
  ball.held = false;
  ball.owner = null;
  ball.lastHitter = "right";
  ball.crossed = true;
  ball.netted = false;
  ball.shot = null;
  ball.magnetPull = null;
  ball.flying = false;
  ball.flyT = 0;
  rival.x = CO.netX + 300;
  rival.y = CO.groundY;
  R.state = "RALLY";
  R.events.length = 0;
  return true;
}

/** 事件是开放形状 `{ t, [key: string]: unknown }`(types.GameEvent),取值统一走读数器 */
const evNum = (e: GameEvent, k: string): number => Number(e[k] ?? 0);
const evStr = (e: GameEvent, k: string): string => { const v = e[k]; return typeof v === "string" ? v : ""; };

function snap(R: RulesState, id: SkillId): DemoSnap {
  const hero = R.players[0];
  const ball = R.ball;
  const s = hero.skill;
  const autoT = id === "lunge" ? (hero.lungeAutoT ?? 0)
    : id === "smash" ? (hero.smashAutoT ?? 0)
      : id === "rage" ? (hero.rageAutoT ?? 0) : 0;
  // 只认主角这一拍(对方/分身打的不算兑现)
  const ev = R.events.find((e) => e.t === "hit" && e.side === hero.side);
  const clones = (hero.shadowClones ?? []).map((sc) => ({
    slot: sc.slot,
    x: sc.entity.x,
    y: sc.entity.y,
    hits: sc.hits,
    spawnT: sc.spawnT,
    despawnT: sc.despawnT,
  }));
  const z = Pl.strikeZone(hero, ball ? Math.hypot(ball.vx || 0, ball.vy || 0) : 0);
  return {
    t: 0,
    x: hero.x, y: hero.y, vx: hero.vx, facing: hero.facing, onGround: hero.onGround, sq: hero.sq,
    swingT: hero.swingT, lungeT: hero.lungeT,
    ball: ball && ball.live && !ball.held ? { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy } : null,
    zone: { x: z.x, y: z.y, r: z.r },
    aim: Skills.magnetAimPoint(hero),
    ready: !!s?.ready,
    cd: s ? s.cd : 0,
    maxCd: s ? s.maxCd : 0,
    buffT: s ? s.buffT : 0,
    autoT,
    flashFrom: hero.flashFrom ? { x: hero.flashFrom.x, y: hero.flashFrom.y } : null,
    flashHoldT: hero.flashHoldT ?? 0,
    flashStrikeT: hero.flashStrikeT ?? 0,
    focusT: hero.focusT ?? 0,
    rage: hero.rage ?? 0,
    clones,
    hit: !!ev,
    auto: !!ev && !!ev!.autoHit,
    bySkill: !!ev && ev!.skillKind === id,
    byClone: !!ev && !!ev!.isAI,
    kind: ev ? evStr(ev, "kind") : "",
    landX: ev ? evNum(ev, "landX") : 0,
  };
}

/** 跑一次:第 cast 帧按下技能键,兑现之后再演 TAIL 帧 */
/** 这一帧是不是「这一款技能真的兑现了」:影分身兑现的是分身接那一拍,不长在 skillKind 上 */
function payoff(s: DemoSnap, id: SkillId): boolean {
  return s.hit && (id === "shadow" ? s.byClone : s.bySkill);
}

function runOnce(id: SkillId, cast: number): DemoSnap[] | null {
  const st = standOf(id);
  if (!setup(id, st.x, st.depth)) return null;
  const R = Rules.R;
  const hero = R.players[0];
  const out: DemoSnap[] = [];
  let hitFrame = -1;

  for (let f = 0; f < HARD_STOP; f++) {
    const inp = driveInput(id, f, hero, R.ball);
    if (f === cast) {
      inp.skillPressed = true;
      inp.skillDir = hero.facing;
    }
    R.events.length = 0;
    Rules.step([inp, emptyInput()]);
    const s = snap(R, id);
    s.t = f;
    out.push(s);
    if (payoff(s, id) && hitFrame < 0) hitFrame = f;
    // 按下去根本没响(门槛没过)→ 这一帧不是演示该演的那一帧,换下一帧试
    if (f === cast && !activated(id, hero)) return null;
    if (hitFrame >= 0 && f >= hitFrame + TAIL) break;
    // 这一分打完了就收:演示不演下一分的发球,而 rules 在 POINT→SERVE 那一步会把球挂到
    // 发球人手上 —— 手工摆出来的局面没有 serverPlayer,继续 step 就是 null.owner 崩在 handX。
    if (R.state !== "RALLY") break;
    if (hitFrame < 0 && f > cast + TAIL * 2) break;
  }
  return hitFrame >= 0 ? out : null;
}

/** 按下当帧是否真的进入了这款技能的状态 */
function activated(id: SkillId, hero: Player): boolean {
  switch (id) {
    case "lunge": return hero.lungeT >= 0;
    case "flash": return (hero.flashHoldT ?? 0) > 0 || !!hero.flashFrom;
    case "magnet": return !!hero.skill?.magnetPulling;
    case "focus": return (hero.focusT ?? 0) > 0;
    // 影分身:局面里已经站着 PRE_CLONES 枚,按下当帧必须**多出一枚**才算召出来了
    case "shadow": return (hero.shadowClones ?? []).length > PRE_CLONES;
    default: return (hero.skill?.buffT ?? 0) > 0;
  }
}

// ---------- 分步文案(数字全现读 CFG) ----------

const sec = (frames: number): string => `${(frames / 60).toFixed(frames % 60 === 0 ? 0 : 1)} 秒`;
/** 不足一秒的时长说「N 帧」而不是一句「0.1 秒」—— 键面 CD 那类读数走秒,动作段数帧才读得出来 */
const dur = (frames: number): string => frames < 60 ? `${frames} 帧` : sec(frames);

function stepsOf(id: SkillId, frames: DemoSnap[], cast: number, hit: number): DemoStep[] {
  const LG = C.lunge, SM = C.skills.smash, FL = C.skills.flash;
  const MG = C.skills.magnet, FO = C.skills.focus, SH = C.skills.shadow, RG = C.skills.rage;
  const cdTxt = sec(Skills.defOf(id).cooldownFrames);
  const land = frames[hit]?.landX ?? 0;
  const castSnap = frames[cast];
  switch (id) {
    case "lunge":
      return [
        { name: "什么时候按", text: `球快到底线、站着差一截时按 · 冷却 ${sec(LG.cooldownFrames)}`, frame: Math.max(0, cast - 12) },
        { name: "跨过去", text: `一步冲 ${Math.round(LG.speed * LG.duration)} px,判定区 ×${LG.reachMul},${dur(LG.duration)}就落地`, frame: cast + LG.duration },
        { name: "那一拍替你打", text: `落地后 ${LG.autoWindow} 帧内球一到就自动起手,落点压到 ${LG.autoAim} 深(第 ${hit} 帧真的扣出去了)`, frame: hit },
        { name: "球回去了", text: `这一拍落点 x=${Math.round(land)}(引擎解出来的,不是画的) · 跨完带风 ${dur(LG.shotWindow)}内击球再加力`, frame: Math.min(frames.length - 1, hit + 40) },
      ];
    case "smash":
      return [
        { name: "提前按", text: `对方刚出手就能按(球还在对面也行)· 附魔挂 ${sec(SM.buffDuration)}`, frame: Math.max(0, cast - 6) },
        { name: "等到点", text: `按下之后 ${SM.autoWindow} 帧内,球一到就替你轰,不用自己踩时机环`, frame: cast + 20 },
        { name: "自动暴扣", text: `无视高度必定重扣、顶档质量,初速 +${SM.speedBoost} 压角 ${SM.powerDeg}°`, frame: hit },
        { name: "挥空不罚", text: `没扣出去就一分不付 —— 冷却在真兑现那一拍才开跑`, frame: Math.min(frames.length - 1, hit + 40) },
      ];
    case "flash": {
      const h = castSnap?.ball ? Math.round(CO.groundY - castSnap.ball.y) : 0;
      return [
        { name: "球要够高", text: `离地 ${FL.minHeight} px 以上才点亮按键(这一帧实测 ${h} px)`, frame: Math.max(0, cast - 8) },
        { name: "折跃到球下面", text: `瞬移到球的下方高点站定,悬空最高 ${FL.maxHover} px,原地留一道雷光`, frame: cast + 1 },
        { name: "悬空举拍", text: `停 ${FL.holdFrames} 帧不吃重力,之后 ${FL.strikeFrames} 帧内必定劈扣(质量 ${FL.guaranteedQ})`, frame: cast + FL.holdFrames },
        { name: "越高越狠", text: `接触点 ≥${FL.apexHeight} px 进顶点档,水平 ×${FL.apexVxMul} 垂直 ×${FL.apexVyMul}`, frame: Math.min(frames.length - 1, hit + 30) },
      ];
    }
    case "magnet":
      return [
        { name: "球在活球期", text: `球在空中就能按,挥拍中也不拦(只挡"球已被牵引中")· 冷却 ${cdTxt}`, frame: Math.max(0, cast - 8) },
        { name: "力场展开", text: `拍前起 ${MG.vortexRadius} px 的吸积漩涡,${MG.arcBranches} 道引力电弧`, frame: cast + 1 },
        { name: "抓回拍前", text: `${MG.pullFrames} 帧把全场那颗球拽到身前,跟着人走(跳起来就吸到高处)`, frame: cast + MG.pullFrames },
        { name: "强力回抽", text: `初速 +${MG.speedBoost} 压向对方深场(${MG.reboundDepth});空中释放直接转跳杀`, frame: Math.min(frames.length - 1, hit + 36) },
      ];
    case "focus":
      return [
        { name: "张开领域", text: `全场拖到球的 ${Math.round(FO.ballSlow * 100)}%、对手 ${Math.round(FO.rivalSlow * 100)}%,上限 ${sec(FO.duration)}`, frame: cast + 6 },
        { name: "超速跑位", text: `自己移速 ×${FO.playerSpeedMul},一整个场子都够得着(判定区同时放宽 ×${FO.zoneReachMul})`, frame: cast + 40 },
        { name: "领域里那一拍", text: `接球即顶档:初速 +${FO.speedBoost} 压弧 ${FO.powerDeg}°`, frame: hit },
        { name: "收尾才付钱", text: `接完球再缓 ${FO.postHitFrames} 帧脱离领域,冷却从那一刻才开始走`, frame: Math.min(frames.length - 1, hit + 40) },
      ];
    case "shadow":
      return [
        { name: "每分一次", text: `本分还能召一次,同场最多 ${SH.slots.length} 枚 · 训练场与教学不生效`, frame: Math.max(0, cast - 4) },
        { name: "三色各守一方", text: SH.slots.map((s, i) => `${i + 1} 号守${["后场", "中场", "网前"][i] ?? "?"}`).join("、") + "(防区按站位中点现算)", frame: cast + SH.spawnFrames },
        { name: "替接这一拍", text: `每枚接满 ${SH.maxHits} 球才消散,只有一枚会追同一颗球(其余守自己的线)`, frame: hit },
        { name: "跨分补满", text: `带着没用满的额度活到下一分,那一分开局补回 ${SH.maxHits} 球;已消散的不复活`, frame: Math.min(frames.length - 1, hit + 40) },
      ];
    case "rage":
      return [
        { name: "打一拍攒一点", text: `普通 ${RG.perHit} · 又准 ${Math.round(RG.perHit * RG.sweetMul)} · 敢杀 ${Math.round(RG.perHit * RG.smashMul)} · 又准又杀 ${Math.round(RG.perHit * RG.bothMul)}(发球不涨)`, frame: Math.max(0, cast - 10) },
        { name: `满一管 ${RG.max}`, text: `最多攒 ${RG.pipes} 管,键面是蓄能环 + 百分比,永不变灰`, frame: Math.max(0, cast - 2) },
        { name: "按一下耗一管", text: `满管必暴扣(初速 +${RG.speedMax} 压弧 ${RG.powerMax}°),不满一管也能把零头放出去(+${RG.speedMin}/${RG.powerMin}°起)`, frame: hit },
        { name: "释放才算数", text: `挥空、窗走完、跨分都不扣怒气 —— 攒的是出手权,不罚白等`, frame: Math.min(frames.length - 1, hit + 40) },
      ];
  }
  return [];
}

// ---------- 对外 ----------

const memo = new Map<SkillId, SkillDemoBake | null>();

/** 连播时当前在第几步:锚帧单调不减,所以取「最后一个不超过当前帧的」(与画面同步,不各说各话) */
export function stepAt(b: SkillDemoBake, t: number): number {
  let i = 0;
  for (let k = 0; k < b.steps.length; k++) if (b.steps[k].frame <= t) i = k;
  return i;
}

/** 某款技能的演示烘焙(记忆化:一款只跑一次搜索) */
export function bake(id: SkillId): SkillDemoBake | null {
  if (memo.has(id)) return memo.get(id) ?? null;
  // 整次烘焙包在一次性状态里跑:烘焙要 newMatch + 几百次 step,直接跑在实机状态上
  // 就是把玩家眼前那一局换掉(状态轮询下一帧读到 state≠MENU ⇒ 点技能=开局)。
  const made = Rules.isolated(() => bakeNow(id));
  memo.set(id, made);
  return made;
}

/**
 * 按下帧的搜索顺序。跨步/闪现是**掐时机**的技能 —— 演最早那一帧,画面是"冲过去然后干等",
 * 教的恰好不是它的手感;演最后一帧还来得及的那一次,才看得见"来不及之前的那一步"。
 * 其余几款是**预开启**语义(按下之后还有一大段等待,那正是要讲的),所以取最早那一帧。
 */
function castOrder(id: SkillId): number[] {
  const out: number[] = [];
  for (let c = CAST_MIN; c <= CAST_MAX; c += CAST_STRIDE) out.push(c);
  if (id === "lunge" || id === "flash") out.reverse();
  return out;
}

function bakeNow(id: SkillId): SkillDemoBake | null {
  for (const cast of castOrder(id)) {
    const frames = runOnce(id, cast);
    if (!frames) continue;
    const hit = frames.findIndex((f) => payoff(f, id));
    if (hit < 0) continue;
    let x0 = CO.wallL, x1 = CO.netX;
    for (const f of frames) {
      x0 = Math.min(x0, f.x - 60, f.ball ? f.ball.x : x0);
      x1 = Math.max(x1, f.x + 60, f.ball ? f.ball.x : x1);
    }
    return {
      id, frames, cast, hit,
      // 步序必须自上而下(第③步不能停在第②步之前):锚帧是算出来的,跨步那款
      // 「冲量走完」与「代拍兑现」只差几帧,不钳就会出现 88 → 86 的倒序。
      steps: clampSteps(stepsOf(id, frames, cast, hit), frames.length),
      view: { x0, x1: Math.min(x1, CO.netX + 40) },
      loop: frames.length,
    };
  }
  return null;
}

/** 锚帧单调不减 + 都落在片子里 */
function clampSteps(steps: DemoStep[], loop: number): DemoStep[] {
  let prev = 0;
  return steps.map((s) => {
    const frame = Math.max(prev, Math.min(loop - 1, Math.round(s.frame)));
    prev = frame;
    return { ...s, frame };
  });
}

/** 一款演示要演多久(帧)—— 面板的循环时钟用它,不自己数 */
export function loopFrames(id: SkillId): number {
  return bake(id)?.loop ?? 0;
}

export function invalidate(): void { memo.clear(); }

export const SkillDemo = { bake, loopFrames, stepAt, invalidate };
