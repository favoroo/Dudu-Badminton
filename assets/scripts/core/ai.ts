// ============================================================
// AI:和人类用同一套挥拍机制(会挥空、会打偏),只是时机更差、误差更大
// 关键是「自己重模拟球路」而不是直接读答案,所以调参不会让它未卜先知
// 但「重模拟准」不等于「接得到」:难度档靠三个真实生效的旋钮拉开 ——
//   read   每记来球只**认定一次**的站位偏差(一路认账,才会看走眼跑错地方)
//   zone   判定区缩放(人类侧的宽容判定区是给手指准备的,AI 不该白拿满额)
//   shotErr 出球误差(接 player.buildShot 的误差预算,会下网/出界 = 会送分)
// 三者都在 config.diffs 里,验收口径在 tools/ai-check.ts(真人替身能不能赢)。
// ============================================================
import { CFG } from "./config";
import { clamp, approach, rand } from "./utils";
import { Physics, FuturePt } from "./physics";
import { Player as Pl } from "./player";
import { Rules, RulesState } from "./rules";
import { Skills } from "./skills";
import { AiState, Ball, HitCostInput, Intercept, Player, PlayerInput } from "./types";

const C = CFG;
const CO = C.court;

function fresh(): AiState {
  return { tick: 0, targetX: 0, serveT: 0, serveDelay: 0, serveAim: C.aimDepth.deep, wantSmash: false, ic: null, swingLead: null, chasing: true,
    readErr: 0,       // 本记来球认定的站位偏差(px):每记球掷一次,之后一路认账
    readRolled: false,
    emotion: 0,           // 情绪值:-1(沮丧)到 1(亢奋),0=平静
    tauntCd: 0,           // 挑衅动作冷却
    celebrateT: 0,        // 庆祝动作剩余帧
    frustrateT: 0,        // 沮丧动作剩余帧
    pressure: 0,          // 连击压力 0..1 = fatigue 的读数(见 pressureOf)
    fatigue: 0,           // 本回合已花的体力(每拍按动作记,见 noteHit;每分随 reset 归零)
    noticeT: 0,           // 接球反应延迟剩余帧(新来球先愣几帧再启动)
    scrambleT: 0,         // 扑救俯冲剩余帧(够不到时的表现,只给渲染读)
    whiffsSeen: 0,        // 已计入的挥空数(检测中途扑空 → 沮丧)
    panicSwung: false,    // 本记来球是否已绝望挥拍过(每拍至多一次)
    hopeless: false,      // 本记来球是否已判定赶不上(供扑救表现读取)
    recvNoted: false,     // 起手快照是否已记(起手时记,击中时消费)
    recvKind: null,       // 快照:来球球种(lob/netshot/clear = 慢软球)
    recvRun: 0,           // 快照:起手时离防区中心的距离(px)—— 体力账本的主力项
    recvPower: 0,         // 快照:起手时来球有多重(0 = 读不到)
  };
}

// 状态挂在球员身上:同一个 AI 可以驱动两个球员(也方便 AI vs AI 回归测试)
// whiffsSeen 用当前挥空数打底:p.stats 跨分累计而 ai 状态每分重建,不预热会误报一次"扑空"
function reset(p: Player): void { p.ai = fresh(); p.ai.whiffsSeen = p.stats.whiffs; }

const D = (p: Player) => p.aiTier ?? (p.aiDiff ? C.diffs[p.aiDiff] : C.diffs.normal);
const SM = (p: Player) => (p.aiDiff ? C.aiSmashDefense[p.aiDiff] : C.aiSmashDefense.normal);

/**
 * 这一档 AI 的**真实**极速(px/帧):自估跑位距离必须和 player.update 的 maxV 同一批因子。
 *
 * 从前这里只乘 `C.player.vmax * em.speed`,而 player.ts:241-245 实际是
 * `PL.vmax · p.speedMul · (真人再乘 Gait.s) · staminaMul · vmaxMul` —— 于是任何带
 * 移速惩罚的关卡(第 2 关 accel/vmax 0.62/0.7、第 17 关体力、第 18 关溜冰)里,
 * AI 都按"满腿"去承诺它跑不到的球:站位算得准,人就是到不了,看上去像纯蠢。
 * 注意这里**不乘 Gait.s**:移速滑杆是真人侧的档位(见 AGENTS.md 的 gait 条),
 * AI 走 diffs.speed,两层刻意不叠。
 */
function selfVmax(p: Player, em: { speed: number }): number {
  const mod = Pl.getPlayerModifier();
  const inFocus = (p.focusT ?? 0) > 0;
  // focus 的超速加成挂在 player.ts 的 vmaxMul 那一层(自己给自己开的领域也算),
  // 不吃它的话 AI 会低估自己 → 明明赶得上却站着看。axisCap 是输入侧的缩尺,不预估。
  const focusMul = inFocus ? (C.skills.focus.playerSpeedMul ?? 4.2) : 1;
  const vmaxMul = (mod?.vmaxMul ?? 1) * focusMul;
  const staminaMul = p.isExhausted ? 0.65 : 1;
  // em.speed 已含情绪/连击压力的加减成;speedMul 是 applyAiTier 落的档位基础值。
  // 两者同源于 diffs.speed,这里以 speedMul 为"事实",情绪只作它自己的那份估计。
  return C.player.vmax * p.speedMul * (em.speed / (D(p).speed || 1)) * vmaxMul * staminaMul;
}

// 把球往前推 n 步(不改原对象)
// 这里**不再自己抄一份循环**。从前它只算阻尼与 Pace.g,不认重力倍率、不认侧风、
// 不认颤抖 —— 于是风关和低重力关里 AI 是按"另一条球路"跑位的:球实际往右飘,
// 它往左等。接别人的球必须按真弧来(Physics.future 默认口径 truth),风是"打"的
// 技巧、不该变成"接"的运气;AI 自己出球照旧走 solveShot 的 aim 口径,跟玩家一样
// 会被风吹偏 —— 不对称只留在"读别人的球"这一侧。
// 阻尼/速度封顶/环境量的折算全部由 physics 负责,本层不许再出现积分数值。
const futureInto = Physics.futureInto;
/** 每个前瞻调用点一块持久缓冲(点对象原地改写,消费即弃 —— 见 Physics.futureInto)。
 *  旧版每步 future() new 数组 + n 个点,AI 每步 ~340 个短命对象,是周期性 GC 尖峰主源;
 *  各点各用各的缓冲,即便 think() 里多处前瞻互相嵌套也不会互相覆盖。 */
const landPtsBuf: FuturePt[] = [];
const entryPtsBuf: FuturePt[] = [];
const interceptPtsBuf: FuturePt[] = [];
const jumpPtsBuf: FuturePt[] = [];

/**
 * 球还有几帧落到地面(-1 = 在预测窗口内不落地)。
 * 「绝望挥拍」用它决定什么时候补那一杆空拍:球将落地时起手,挥空动画正好压在球落地那一刻。
 */
function landFrames(ball: Ball): number {
  const pts = futureInto(ball, 150, landPtsBuf);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].y >= CO.groundY - 2) return i;
  }
  return -1;
}

/**
 * 球还有几帧进入判定区(-1 = 整个窗口都进不来)。
 * 判定区很大,所以不能"一进区就起手" —— 那样命中永远落在窗口第 1 帧,
 * 质量最低、误差最大。要按「提前量 = 窗口中心」起手才打得出甜蜜点。
 */
function entryLead(p: Player, ball: Ball, radius: number): number {
  const SW = C.swing;
  const probe = {
    x: p.x, y: p.y, facing: p.facing,
    swingRadius: radius, swingStyle: p.swingStyle, zoneScale: p.zoneScale,
  };
  const pts = futureInto(ball, SW.windup + SW.active + 6, entryPtsBuf);
  for (let f = 0; f < pts.length; f++) {
    const q = pts[f];
    if (p.side === "left" ? q.x > CO.netX - 2 : q.x < CO.netX + 2) return -1;
    probe.x = p.x + p.vx * f;
    probe.y = p.y + Math.min(0, p.vy) * f;
    if (Pl.ballInZone(probe, q as Ball)) return f;
  }
  return -1;
}

// 追球点:重模拟,找球进入我方「可击高度」的位置
// topH = 允许的最高拦截点:站立约 140px,跳起能到 220px(扣杀要提前在高点等球)
// contactH > 0 时启用「接球截面」兜底:球从可击高度降到地面的水平滑行超过
// contactDrift(平飘球,常见于网前短球/平抽),按「第一次降到可击高度」站位
// 会让球从头顶飞过落在身后(判定区背后是死角)—— 改等球下落穿过接球截面,
// 站位贴近实际落点。陡坠球(高远/吊球)滑行小,维持原截点,回合照常能终结。
function intercept(p: Player, ball: Ball, topH: number, contactH = 0): Intercept {
  const pts = futureInto(ball, 150, interceptPtsBuf);
  let best: Intercept | null = null;
  let iBest = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const mine = p.side === "left" ? q.x < CO.netX - 4 : q.x > CO.netX + 4;
    if (!mine) continue;
    const h = CO.groundY - q.y;
    if (h < topH) { best = { x: q.x, y: q.y, t: i, h }; iBest = i; break; }
  }
  if (best && contactH > 0) {
    let landX = best.x;
    for (let i = iBest; i < pts.length; i++) {
      landX = pts[i].x;
      if (pts[i].y >= CO.groundY - 2) break;
    }
    if (Math.abs(landX - best.x) > C.aiReach.contactDrift) {
      for (let i = iBest; i < pts.length; i++) {
        const q = pts[i];
        if (CO.groundY - q.y <= contactH) { best = { x: q.x, y: q.y, t: i, h: CO.groundY - q.y }; break; }
      }
    }
  }
  if (!best) {
    const last = pts[pts.length - 1] || ball;
    best = { x: last.x, y: CO.groundY - 40, t: pts.length, h: 40 };
  }
  return best;
}

// 选落点:对手站得靠后就打短、靠网就打深;双打取「最靠后的那个对手」做判断
function chooseDepth(p: Player, rivals: Player[], ballH: number, aggr: boolean): number {
  // 「后场空了」要比到对方底线,不能比到网 —— 否则后场人站在中场就算"空",
  // AI 就永远只打短球,两个前场隔网互啄,回合打不完
  const base = (o: Player) => (o.side === "left" ? CO.left : CO.right);
  const guarded = Math.min(...rivals.map((o) => Math.abs(o.x - base(o))));
  const emptyDeep = guarded > C.doubles.deepGuard;
  // 显式深浅配比:保证两种球都会出现,前后场队友才都有球打
  const deepBias = (emptyDeep ? 0.78 : 0.40) + (aggr && ballH > 120 ? 0.1 : 0);
  const goDeep = Math.random() < deepBias;
  if (aggr && ballH > 120) return goDeep ? rand(0.84, 1.02) : rand(0.04, 0.2);
  return goDeep ? rand(0.72, 0.98) : rand(0.06, 0.3);
}

// (原 zoneHome() 已删:双打"各自防区 home 位"的两臂都 return p.homeX —— 那是一层
//  包装在骗读代码的人"这里区分了防区"。真要做双打分区,得先有分区逻辑,等它有那天。)

/**
 * 定这一拍发球:先按档位抽**类型**,再到该类型的蓄力带里抽帧数,顺带看对手站位定深浅。
 *
 * 为什么必须"先类型、后延迟":rules 那边是拿 serveWait 反查类型的(<22 = 偷后场、
 * >65 = 高远)。从前默认带 [40,90] **正好跨在 65 上**,于是入门档约一半"标准发球"
 * 执行成高飘高远球(球多飞一倍时间,等玩家摆好姿势来扣)—— 用户现场那句
 * 「他发球我就得分了」就是这条;而 flick 概率 0.15×aggr≈1.8%、clear 分支还要求
 * aggr>0.3 永远进不去,等于入门档只有一种球。现在三条带互不相交(见 serveMix.bands),
 * **想发什么和实际发出什么构造上不可能错档**。
 * 深浅只对"标准发球"生效:偷后场/高远在 rules 里走 forced 弹道,自带 depthBias。
 */
function planServe(p: Player): { delay: number; aim: number } {
  const mix = C.serveMix[p.aiDiff ?? "normal"] ?? C.serveMix.normal;
  const B = C.serveMix.bands;
  const roll = Math.random();
  const band = roll < mix.flick ? B.flick : roll < mix.flick + mix.clear ? B.clear : B.standard;
  const delay = band[0] + Math.random() * Math.max(0, band[1] - band[0]);
  // 看人下菜:对手贴着底线站,再压深球等于喂球 —— 改发短的比例抬到 vsBackCamper;
  // 对手不蹲底线(站中场或压网)时,发深才是舒服球,短球比例 = 1 - vsNetRusher。
  const rival = Rules.rivalsOf(p)[0];
  const camper = !!rival
    && Math.abs(rival.x - (rival.side === "left" ? CO.left : CO.right)) <= C.doubles.deepGuard;
  const goShort = Math.random() < (camper ? mix.vsBackCamper : 1 - mix.vsNetRusher);
  return { delay, aim: goShort ? C.aimDepth.near : C.aimDepth.deep };
}

/**
 * 看风下手:把"想打的深浅"按当前风挪一格。
 *
 * 出球解算走的是 `intent="aim"`(**故意**不认侧风,见 physics 的 IntegrateIntent),
 * 所以风会真把 AI 的球吹偏 —— 从前 ai.ts 全程没读过 windAt,风关里 AI 等于自杀式送分。
 * 这一层补多少由档位 `windSense` 说了算:入门 0(玩家读通风向后仍要能赢)、
 * 普通 0.55、大师 0.85。补的是**决策**,不是解算:solveShot 一律不许改口径,
 * 否则"看风下手的余地"这个机制当场被 AI 顺手解没(env-check §3 就是钉这条的)。
 *
 * 符号:dir = 我方这一拍球前进的方向(左队 +1 / 右队 -1);风与 dir 同号 = 顺风,
 * 球会被推得**更深** → 收力(减 depth);异号 = 逆风,球被按在网前 → 压深(加 depth)。
 * 风取"起手之后 windup 帧"那一点的值 —— 起手到释放之间风还会变,读释放那一刻的才对症。
 */
function windAdjustedDepth(p: Player, depth: number): number {
  const E = C.env;
  const sense = D(p).windSense;
  if (!sense || !E.aiWindDepth) return depth;
  const w = Physics.windAt(Physics.envPhase() + C.swing.windup);
  if (!w) return depth;
  const dir = p.side === "left" ? 1 : -1;
  const norm = clamp(w / E.windFullScale, -1, 1);
  return clamp(depth - dir * norm * E.aiWindDepth * sense, 0, 1.06);
}

/**
 * 一拍的体力成本(纯函数,判据全在这里 —— tools/stamina-check 直接打它当靶子)。
 * 单位与 CFG.aiStamina.capacity 同一把尺,负数 = 这一拍反而回了一点气。
 *
 * 为什么不再是「rally 第几拍」:发球本身也走 applyShot → rally++,数拍子的曲线等于
 * 玩家一发球对面就掉血(用户现场)。费不费力只看这一拍实际发生了什么:
 * 被拉开多远(run,主力连续项)+ 来球有多重(power,第二连续项),
 * 再按动作标签(跨步/腾空/跳杀/技能)与球种(接重杀/劈吊/平抽、自己扣杀)各加一笔。
 * 站那把一记慢软球回过去 = 负成本,这就是「轻松接球喘口气」。
 */
function staminaCost(x: HitCostInput): number {
  const A = C.aiStamina;
  // 接发(rally==2):来球力量费(powK)免 —— 站定接发 0,大跑位接发仍扣 run(合理:跑大跑位该掉血)。
  // 用户现场:「第一次发球他接球为什么会掉体力啊,太蠢了」—— 发球 power 普遍 > powFree,
  // 站定接也被 powK 扣一笔;接发这一拍的"来球重"不该算消耗(开局仪式),但"跑了多远"照算。
  // soft 分支在前面:软球接发(lob/clear)走回气,不进这里。
  const desperate = x.lunge || x.air || x.jumpSmash || x.skill;
  const soft = !desperate && x.run <= A.softRun && x.recvKind !== null && A.softKinds.includes(x.recvKind);
  if (soft) return A.give;
  let c = A.base
    + (A.runK * Math.max(0, x.run - A.runFree)) / 100
    + (x.isServeReturn ? 0 : (A.powK * Math.max(0, x.power - A.powFree)) / 10);
  if (x.lunge) c += A.lunge;
  if (x.air) c += A.air;
  if (x.jumpSmash) c += A.jumpSmash;
  if (x.skill) c += A.skill;
  if (x.ownSmash) c += A.ownSmash;
  if (x.recvKind === "smash") c += A.recvSmash;
  else if (x.recvKind === "slash") c += A.recvSlash;
  return clamp(c, A.minBeat, A.maxBeat);
}

/**
 * 连击压力 P∈[0,1] = 本回合已花的体力 × 本档 crush 闸门。
 * 展示端(hud / game-root)一律用 `1 - P/crush` 反归一化,所以三档都能看到全程 0~100%。
 * 只放大 readErr、加时机误差、略降跑速,不碰物理与判定区几何。
 */
function pressureOf(d: ReturnType<typeof D>, S: AiState): number {
  return clamp(S.fatigue / C.aiStamina.capacity, 0, 1) * d.crush;
}

/**
 * 体力记账:rules.applyShot 在 AI 每次真实击中时调用(rally++ 同一处)。
 * 读 think() 起手瞬间记下的快照(来球球种 / 跑了多远 / 来球多重)+ 这一拍的出球标签定成本。
 * 发球与挥空拿不到快照(recvNoted 为假)→ 直接 return,所以**发球天然不掉体力**。
 * drill 模式的喂球机也照记(它的血条被 hud 显式收起),别以为疲劳读数坏了。
 */
function noteHit(p: Player, shot: NonNullable<Ball["shot"]>): void {
  const S = p.ai;
  if (!S || !S.recvNoted) return;
  S.recvNoted = false;                     // 无论扣不扣,快照都要消费掉(每拍一次)
  const d = D(p);
  const c = staminaCost({
    run: S.recvRun,
    power: S.recvPower,
    recvKind: S.recvKind,
    lunge: !!shot.lungeShot,
    air: !!shot.airborne,
    jumpSmash: !!shot.jumpSmash,
    skill: !!shot.skillKind,
    ownSmash: shot.kind === "smash",
    isServeReturn: Rules.R.rally === 2,    // 接发是 rally 第 2 拍(发球 rally++ 到 1,接发到 2):整拍免费
  });
  // 只有回气吃 softGate(easy=0):新手回球 80% 是慢软球,一路回血会把
  // 「把他打累 → 他漏球」这条正反馈整个抹掉。扣账三档都走,由 crush 定多少。
  S.fatigue = clamp(S.fatigue + (c < 0 ? c * d.softGate : c), 0, C.aiStamina.capacity);
}

interface EmotionMods { aggr: number; timingErr: number; speed: number }

// 情绪修正:落后时更激进(认真起来),领先时略放松
// composure 是档位闸门(0=情绪只改表情,不改强度):旧结构让 AI **落后时跑得更快、
// 时机更准**,于是玩家越落后面对的是越强的对手 —— 与「入门档要能得分」正面冲突。
// aggr 不闸:输了才认真猛扣是看得见的性格,而且不加难度。
// 连击压力(pr)另走一条:把情绪往「急躁/沮丧」压 + 额外时机误差 + 降跑速 —— 见 pressureOf。
function emotionModifiers(p: Player, S: AiState, d: ReturnType<typeof D>): EmotionMods {
  const R = Rules.R;
  const myIdx = p.side === "left" ? 0 : 1;
  const myScore = R.scores[myIdx];
  const oppScore = R.scores[1 - myIdx];
  const diff = myScore - oppScore;
  const pr = S.pressure;   // 连击压力 0..1(已乘本档 crush)
  const AP = C.aiPressure;
  // 情绪目标:落后 → 负(沮丧/认真),领先 → 正(亢奋/放松);长回合把目标再往沮丧压一点
  const targetEmotion = clamp(diff / 5 - pr * 0.5, -1, 1);
  S.emotion = approach(S.emotion, targetEmotion, 0.08);
  const c = d.composure;
  // 返回修正后的难度参数(注意 emotion 落后时为负,别按直觉读反 —— 从前 speed 那行
  // 注释写反过:「落后跑更快」实际公式是落后收步,调整手感时以公式为准)
  return {
    aggr: d.aggr * (1 - S.emotion * 0.25),        // 落后时更激进(+25%),领先时更保守(-25%)
    timingErr: d.timingErr * (1 + S.emotion * 0.2 * c) + pr * AP.timingAdd, // 落后更准(composure 闸)+ 长回合手抖
    speed: d.speed * (1 + S.emotion * 0.08 * c) * (1 - pr * AP.speedMul),   // 落后收步更稳(composure 闸)·长回合腿沉
  };
}

type Diff = ReturnType<typeof D>;

/**
 * 这一拍有多难读(0..1) —— 决定本记球吃多少 `diffs.read`。
 * 为什么必须加权:误差全局放大就会把每一拍都变成 winner,回合掉到三五拍,
 * 而用户明确要「保留长回合,只要得分变成可能」。所以慢高球只吃 readFloor
 * (高远对拉照常打得起来),快球与需要长距离跑位的球才吃满 —— 失分点集中在难球。
 * 速度口径与 player.strikeZone「来球越快判定区越小」同源(都读世界速度、不折档):
 * 慢档里 AI 也更少看走眼,那正是「慢一档更好接」的另一半。
 */
function readHardness(p: Player, ball: Ball, ic: Intercept, d: Diff): number {
  const SW = C.swing;
  const AR = C.aiRead;
  const spd = clamp((Math.hypot(ball.vx, ball.vy) - SW.zoneFullSpeed) / SW.zoneTightenSpan, 0, 1);
  const run = clamp(Math.abs(ic.x - p.x) / AR.runRef, 0, 1);
  const k = clamp(spd * AR.speedMix + run * (1 - AR.speedMix), 0, 1);
  return clamp(d.readFloor + k * (AR.hardMax - d.readFloor), 0, AR.hardMax);
}

function think(p: Player, ball: Ball, state: string): PlayerInput {
  const S = p.ai || (p.ai = fresh());
  const inp: PlayerInput = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  const d = D(p);
  const incoming = ball.live && !ball.held && ball.lastHitter !== p.side;
  S.pressure = pressureOf(d, S);   // 本回合已花的体力(先算,情绪修正要吃它)
  const em = emotionModifiers(p, S, d);  // 情绪 + 压力修正后的参数

  // 连击压力极大(体力枯竭 <= 25%): 角色面部呈现流汗/疲倦表情
  if (S.pressure >= 0.75 && (p.faceT ?? 0) <= 0 && incoming) {
    p.face = "sad";
    p.faceT = 20;
  }

  // 冷却/动作计时
  if (S.tauntCd > 0) S.tauntCd--;
  if (S.celebrateT > 0) S.celebrateT--;
  if (S.frustrateT > 0) S.frustrateT--;
  if (S.scrambleT > 0) S.scrambleT--;
  // 中途扑空:挥空数涨了 → 短促沮丧(情绪动作,不改强度)。p.stats 跨分累计,
  // ai 状态每分重建,所以 whiffsSeen 在 reset() 里用当前值打底(否则每分会误报一次)。
  if (p.stats.whiffs > S.whiffsSeen) {
    S.whiffsSeen = p.stats.whiffs;
    // 拼了没够到(panicSwung)比普通扑空更懊恼 —— frustrateT 只喂渲染,不改强度
    if (S.frustrateT <= 0 && Math.random() < (S.panicSwung ? 0.9 : 0.5)) S.frustrateT = 22;
  }

  // ---------- 发球 ----------
  if (ball.held && ball.owner === p) {
    const dx = p.homeX - p.x;
    if (Math.abs(dx) > 10) { inp.left = dx < 0; inp.right = dx > 0; S.serveT = 0; }
    else {
      // 站定了才定案:serveT 从 0 变 1 的那一帧抽一次(类型 + 深浅),之后一路照这个数执行。
      // 走回发球位会把 serveT 清 0,所以"移动—回来"会重抽一次,这是应该的:换人了。
      if (S.serveT === 0) { const plan = planServe(p); S.serveDelay = plan.delay; S.serveAim = plan.aim; }
      S.serveT++;
      if (S.serveT > S.serveDelay) {
        S.serveT = 0;
        inp.swingAim = S.serveAim;
      }
    }
    return inp;
  }

  if (state === "POINT" || state === "OVER") {
    const dx = p.homeX - p.x;
    if (Math.abs(dx) > 24) { inp.left = dx < 0; inp.right = dx > 0; }
    return inp;
  }

  // ---------- 周期重规划(反应速度) ----------
  const isSmash = incoming && ball.shot?.kind === "smash";
  const sm = SM(p);
  const baseZone = Rules.R.mode === "2v2" ? Math.min(C.doubles.aiZone, d.zone) : d.zone;
  if (isSmash) {
    p.zoneScale = baseZone * sm.zoneMul;
    p.aiAimErr = d.shotErr + sm.shotErrAdd;
  } else {
    p.zoneScale = baseZone;
    p.aiAimErr = d.shotErr;
  }

  S.tick--;
  if (incoming && S.tick <= 0) {
    S.tick = d.tick;
    const runTo = (x: number) => Math.abs(x - p.x) / selfVmax(p, em);
    // 从最高可行拦截点往下逐级试:面对扣杀必须立足防守,不尝试高空迎击
    const aggr = Rules.teamOf(p.side).length > 1 ? Math.min(0.88, em.aggr + C.doubles.aggrBonus) : em.aggr;
    S.wantSmash = isSmash ? false : (Math.random() < aggr); // 本回合是否处于进攻心态
    const ladder = S.wantSmash
      ? [C.aiReach.attack, C.aiReach.stand, 92]
      : (isSmash ? [92, C.aiReach.contact] : [C.aiReach.stand, 92]);
    let ic: Intercept | null = null;
    let reachable = false;
    for (const topH of ladder) {
      const c = intercept(p, ball, topH, topH > C.aiReach.attack - 4 ? 0 : C.aiReach.contact);
      const jumping = topH > C.aiReach.attack - 4;
      const need = (jumping ? C.player.jumpApex : 0) + 6;
      if (c.t >= runTo(c.x) + need) { ic = c; S.wantSmash = jumping || S.wantSmash; reachable = true; break; }
    }
    if (!ic) ic = intercept(p, ball, isSmash ? C.aiReach.contact : 90, C.aiReach.contact);
    // 「怎么都赶不上」:连最低拦截点都来不及到位 —— 用来触发扑救俯冲表现 + 绝望挥拍(不改判定)
    S.hopeless = !reachable;
    // 站位偏差:**每记来球只认定一次**,之后每次重规划都沿用同一个数。
    // 旧写法在这里重掷 ±d.aimErr,均值归零 → 几次重规划下来收敛到真实落点,
    // 92px 等于没写(用户反馈「入门 AI 怎么都能接住」的头号根因)。认定之后它就
    // 一路全速跑向自己那个错的点,最后差一点够不到 —— 这才是「看走眼」。
    // 连击压力在这里加码:这一回合他花掉多少体力,决定这一掷的误差有多大(pressureOf 见上)。
    // 扣杀突袭:重杀难以准确判断深浅,额外放大站位误差并增加反应延迟。
    if (!S.readRolled) {
      S.readRolled = true;
      if (isSmash) {
        S.noticeT = Math.max(S.noticeT, sm.noticeAdd);
      }
      const smashRead = isSmash ? sm.readMul : 1;
      S.readErr = (Math.random() * 2 - 1) * d.read * smashRead * (1 + S.pressure * C.aiPressure.readMul) * readHardness(p, ball, ic, d);
    }
    const err = S.readErr;
    const lo = p.side === "left" ? CO.wallL : CO.netX + CO.netPad;
    const hi = p.side === "left" ? CO.netX - CO.netPad : CO.wallR;
    // 双打:落点归队友就回防区待命,别两个人叠在一起
    const claimX = ball.shot && ball.shot.landX != null ? ball.shot.landX : ic.x;
    S.chasing = Rules.shouldChase(p, claimX);
    // backBias:向后墙方向偏移站位。角色恒面向球网,判定区圆心在身前 ~25px;
    // 不偏的话球落点在 AI 脚下或身后,身后是 dx<-r*0.34 的判定死角,entryLead 永远返回 -1。
    // 高远球尤其严重(落点深、误差余量小)—— 入门档高远发球漏接 40% 全因这条。
    // 偏 15px 是兼顾值:高远发球 easy 从 61%→78%,标准发球不受明显影响(95%→98%)。
    S.targetX = S.chasing ? clamp(ic.x + err - p.facing * C.aiReach.backBias, lo, hi) : p.homeX;
    S.ic = S.chasing ? ic : null;
  } else if (!incoming) {
    p.zoneScale = baseZone;
    p.aiAimErr = d.shotErr;
    S.targetX = p.homeX;
    S.wantSmash = false;
    S.ic = null;
    S.chasing = false;
    S.panicSwung = false;                   // 新来球:绝望挥拍额度复位
    S.hopeless = false;
    S.noticeT = d.notice;                   // 球在对面手/飞向别处时,把"愣神"预置好
  }

  // ---------- 反应延迟(拟人) ----------
  // 新来球成立的前几帧先愣着不动也不挥:真人看到对手出拍也要反应时间,不是逐帧盯球。
  // 放在重规划之后、跑位之前 —— targetX 照常算好,只是这几帧先不执行。
  if (incoming && S.noticeT > 0) { S.noticeT--; return inp; }

  // ---------- 跑位 ----------
  const dx = S.targetX - p.x;
  if (Math.abs(dx) > 8) { inp.left = dx < 0; inp.right = dx > 0; }

  // ---------- 起跳扣杀 ----------
  // 不靠预定拦截点(球在高位停留太短),改反应式:
  // 若 jumpApex 帧后球会落到我头顶附近的高点,现在就跳,最高正好迎上
  if (S.wantSmash && S.chasing && p.onGround && incoming && ball.live && !ball.held) {
    const q = futureInto(ball, C.player.jumpApex, jumpPtsBuf)[C.player.jumpApex - 1];
    if (q && Math.abs(q.x - p.x) < 62) {
      const h = CO.groundY - q.y;
      const mine = p.side === "left" ? q.x < CO.netX - 6 : q.x > CO.netX + 6;
      if (mine && h > C.aiReach.stand && h < C.aiReach.jump) inp.jumpPressed = true;
    }
  }

  // ---------- AI 技能决策系统 ----------
  if (p.skill && incoming && ball.live && !ball.held && Skills.canActivate(p, ball)) {
    const sId = p.skill.id;
    if (sId === "lunge") {
      // 强力跨步救球:球低且刚好超出正常步幅,但跨步能救到
      const dist = Math.abs(ball.x - p.x);
      const reach = p.swingRadius * 1.1;
      const lungeReach = reach * (C.lunge.reachMul || 1.55);
      const h = CO.groundY - ball.y;
      if (dist > reach && dist < lungeReach && h < C.aiReach.stand * 0.7) {
        const ballDir = ball.x > p.x ? 1 : -1;
        if (ballDir === p.facing) {
          inp.skillPressed = true;
          inp.skillDir = p.facing;
          inp.lungePressed = true;
          inp.lungeDir = p.facing;
        }
      }
    } else if (sId === "smash") {
      // 百分百重击:进攻心态强且即将来球在攻击范围内预先附魔
      if (S.wantSmash && Math.abs(ball.x - p.x) < 130 && Math.random() < 0.6) {
        inp.skillPressed = true;
      }
    } else if (sId === "flash") {
      // 闪现扣杀:球在己方高空 (>= 120px) 且处于下落/高点时,凌空暴扣绝杀
      const h = CO.groundY - ball.y;
      if (h >= 120 && (S.wantSmash || Math.random() < 0.75)) {
        inp.skillPressed = true;
      }
    } else if (sId === "magnet") {
      // 引力吸球:预测失位或面对网前低短球时,触发引力吸球保命与反击
      const dist = Math.abs(ball.x - p.x);
      const h = CO.groundY - ball.y;
      if (dist > p.swingRadius * 1.15 && h < C.aiReach.stand * 0.8) {
        inp.skillPressed = true;
      } else if (S.ic && S.chasing) {
        const runToTime = Math.abs(S.ic.x - p.x) / selfVmax(p, em);
        if (S.ic.t < runToTime - 2 || dist > 200) {
          inp.skillPressed = true;
        }
      }
    } else if (sId === "focus") {
      // 时空减速:对手球速过快或落后时开启领域
      if (Math.hypot(ball.vx, ball.vy) > 13 || em.aggr > 0.45) {
        inp.skillPressed = true;
      }
    } else if (sId === "rage") {
      // 怒气重击:**只在满怒才放**。半管就放等于把资源换成一个普通强度球,而 CPU 不懂
      // "下一分还能接着攒"这层经济 —— 那层判断归玩家,给 AI 放开会把技能按成空响。
      //
      // 今天这段到不了:aiSkillByDiff 四档恒 "lunge",关卡 aiSkill 只出现过 smash/magnet/flash。
      // 写它是因为**不该出现"装了 rage 的 AI 一声不吭"那种中间态** —— 要么给个明确策略,
      // 要么别让它装上(rage-check ⑬ 钉住"rage 不在 AI 技能表里",这一句就是那条断言的注脚)。
      // AI 也永远拿不到 rageAutoT 代拍窗(activate 里按 !p.isAI 给零),它的准头归 diffs.* 管。
      if (Skills.rageRatioOf(p) >= 1) {
        inp.skillPressed = true;
      }
    }
  }

  // ---------- 起手时机:按「提前量 = 窗口中心」起手,起手即定落点深浅 ----------
  const SW = C.swing;
  const center = SW.windup + SW.active / 2;
  if (!incoming) {
    S.swingLead = null;
    // 「新的一记来球」的边界就是这里:自己击球后 incoming 转假,对手击打后转真。
    // 认定误差与起手时机共用这一个复位点 —— 两者都是「每拍只掷一次」。
    S.readRolled = false;
    S.readErr = 0;
    S.recvNoted = false;            // 质量快照同拍复位(noteHit 消费不掉的(挥空/发球)在这里清)
  }
  const radius = Physics.reachRadius(ball);
  const lead = (ball.live && !ball.held && S.chasing !== false) ? entryLead(p, ball, radius) : -1;
  if (incoming && S.swingLead === null) {
    // 每拍只掷一次:负=早起手,正=晚起手,晚过头就漏球
    // 扣杀来球穿窗极快,时机抖动额外放大,起手稍有偏差即会挥空
    const smashTiming = isSmash ? sm.timingAdd : 0;
    const totalTiming = em.timingErr + smashTiming;
    S.swingLead = center + Math.round(rand(-totalTiming, totalTiming));
  }
  const depth = chooseDepth(p, Rules.rivalsOf(p), CO.groundY - ball.y, S.wantSmash);
  // 出球前最后一格:看风收力/压深(入门档 windSense=0 等于不补,机制仍归玩家)
  if (lead >= 0 && p.swingT < 0 && S.swingLead !== null && lead <= S.swingLead) {
    // 起手瞬间记体力账本的输入(此时 ball.shot 仍是**来球**的信息,击中后就被换掉了):
    // 来球球种 + 跑了多远 + 来球有多重 —— noteHit 在真实击中时按它们定成本。
    if (!S.recvNoted) {
      S.recvNoted = true;
      S.recvKind = ball.shot ? ball.shot.kind : null;
      S.recvRun = Math.abs(p.x - p.homeX);
      S.recvPower = ball.shot ? ball.shot.power : 0;
    }
    inp.swingAim = windAdjustedDepth(p, depth);
  }

  // ---------- 够不到也要扑一下:鱼跃俯冲(只做表现) ----------
  // 旧行为:赶不上的球 AI 就杵在 targetX 上看它落地 —— 用户反馈的「接不到时站在那不动」。
  // 这里在判定「怎么都赶不上」且球快落地时置 scrambleT,渲染层据此做一次前倾伸臂的鱼跃
  // (sprites.ts),game-root 在置位那一帧补一记扑空音效。
  // **刻意不产生真实挥拍**:真挥拍会命中那些"看着赶不上、其实被 entryLead 的低估 velocity
  // 判成 -1"的球 —— 实测入门档接发率会从 86% 抬到 100%,那是借表现之名改平衡。
  // 表现归表现:这里不写 inp,人物照旧够不到,只是不再呆站着。
  if (incoming && S.chasing && ball.live && !ball.held && p.swingT < 0) {
    const mine = p.side === "left" ? ball.x < CO.netX : ball.x > CO.netX;
    const inCourt = ball.x > CO.left && ball.x < CO.right;
    if (mine && inCourt && S.hopeless && S.scrambleT <= 0) {
      const lf = landFrames(ball);
      // 球快落地了才扑(扑太早像在演)
      if (lf >= 0 && lf <= C.aiReach.scrambleFrames) {
        S.scrambleT = C.aiReach.scrambleFrames;
        S.panicSwung = true;   // 供"拼了没够到"的沮丧加权(仅表现)
      }
    }
  }

  return inp;
}

// 得分/失分时触发情绪动作
function onScore(p: Player, scored: boolean): void {
  const S = p.ai;
  if (!S) return;
  if (scored) {
    // 得分:偶尔庆祝(概率随情绪)
    if (S.emotion > 0.2 && S.tauntCd <= 0 && Math.random() < 0.3 + S.emotion * 0.3) {
      S.celebrateT = 30;
      S.tauntCd = 120;
    }
  } else {
    // 失分:偶尔沮丧
    if (S.emotion < -0.2 && Math.random() < 0.25) {
      S.frustrateT = 25;
    }
  }
}

// staminaCost / pressureOf 导出是给 tools/stamina-check 当靶子的:
// 成本判据与归一化契约都是纯函数,不必真拖一局才能验
export const AI = { think, reset, onScore, noteHit, staminaCost, pressureOf };
