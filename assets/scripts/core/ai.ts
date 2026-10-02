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
import { AiState, Ball, Intercept, Player, PlayerInput } from "./types";

const C = CFG;
const CO = C.court;

function fresh(): AiState {
  return { tick: 0, targetX: 0, serveT: 0, wantSmash: false, ic: null, swingLead: null, chasing: true,
    readErr: 0,       // 本记来球认定的站位偏差(px):每记球掷一次,之后一路认账
    readRolled: false,
    emotion: 0,           // 情绪值:-1(沮丧)到 1(亢奋),0=平静
    tauntCd: 0,           // 挑衅动作冷却
    celebrateT: 0,        // 庆祝动作剩余帧
    frustrateT: 0,        // 沮丧动作剩余帧
    pressure: 0,          // 连击压力 0..1(rally 越长越大,见 rallyPressure)
    noticeT: 0,           // 接球反应延迟剩余帧(新来球先愣几帧再启动)
    scrambleT: 0,         // 扑救俯冲剩余帧(够不到时的表现,只给渲染读)
    whiffsSeen: 0,        // 已计入的挥空数(检测中途扑空 → 沮丧)
    panicSwung: false,    // 本记来球是否已绝望挥拍过(每拍至多一次)
    hopeless: false,      // 本记来球是否已判定赶不上(供扑救表现读取)
  };
}

// 状态挂在球员身上:同一个 AI 可以驱动两个球员(也方便 AI vs AI 回归测试)
// whiffsSeen 用当前挥空数打底:p.stats 跨分累计而 ai 状态每分重建,不预热会误报一次"扑空"
function reset(p: Player): void { p.ai = fresh(); p.ai.whiffsSeen = p.stats.whiffs; }

const D = (p: Player) => (p.aiDiff ? C.diffs[p.aiDiff] : C.diffs.normal);
const SM = (p: Player) => (p.aiDiff ? C.aiSmashDefense[p.aiDiff] : C.aiSmashDefense.normal);

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

// 各自防区的home位:双打时不追球的人待在这儿,避免两人叠一起
function zoneHome(p: Player): number {
  const mates = Rules.teamOf(p.side);
  if (mates.length < 2) return p.homeX;
  return p.homeX;
}

/**
 * 连击压力 P∈[0,1]:本回合 rally 越长越大,再乘本档 crush 闸门。
 * 这是「回合拖长 → AI 开始漏」的唯一来源,不碰物理/判定区几何:
 * 只放大 readErr、加时机误差、略降跑速,所以「慢球仍能对拉」的性质不变。
 * rally 与 HUD 的「x N 连击」大字同源(rules.R.rally),前 startAt 拍照常不吃压力。
 */
function rallyPressure(d: ReturnType<typeof D>): number {
  const AP = C.aiPressure;
  return clamp(clamp((Rules.R.rally - AP.startAt) / AP.span, 0, 1) * d.crush, 0, 1);
}

interface EmotionMods { aggr: number; timingErr: number; speed: number }

// 情绪修正:落后时更激进(认真起来),领先时略放松
// composure 是档位闸门(0=情绪只改表情,不改强度):旧结构让 AI **落后时跑得更快、
// 时机更准**,于是玩家越落后面对的是越强的对手 —— 与「入门档要能得分」正面冲突。
// aggr 不闸:输了才认真猛扣是看得见的性格,而且不加难度。
// 连击压力(pr)另走一条:把情绪往「急躁/沮丧」压 + 额外时机误差 + 降跑速 —— 见 rallyPressure。
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
  S.pressure = rallyPressure(d);         // 连击压力:本回合 rally 越长越大(先算,情绪修正要吃它)
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
      S.serveT++;
      // AI 发球博弈:难度越高越会用偷后场和高远球
      const aggr = em.aggr;
      const serveRoll = Math.random();
      let serveDelay = 40 + Math.random() * 50;  // 默认:标准发球
      if (serveRoll < 0.15 * aggr) {
        serveDelay = 8 + Math.random() * 12;      // 偷后场(flick):快速出手
      } else if (serveRoll > 0.85 && aggr > 0.3) {
        serveDelay = 70 + Math.random() * 30;     // 高远发球(clear):故意拖延
      }
      if (S.serveT > serveDelay) {
        S.serveT = 0;
        // 起拍即定落点:大部分发深球压底线,偶尔发短球
        inp.swingAim = Math.random() < 0.72 ? C.aimDepth.deep : C.aimDepth.near;
      }
    }
    return inp;
  }

  if (state === "POINT" || state === "OVER") {
    const dx = zoneHome(p) - p.x;
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
    const runTo = (x: number) => Math.abs(x - p.x) / (C.player.vmax * em.speed);
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
    // 连击压力在这里加码:回合越往后,这一掷的误差越大(rallyPressure 见上)。
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
    S.targetX = S.chasing ? clamp(ic.x + err, lo, hi) : zoneHome(p);
    S.ic = S.chasing ? ic : null;
  } else if (!incoming) {
    p.zoneScale = baseZone;
    p.aiAimErr = d.shotErr;
    S.targetX = zoneHome(p);
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
        const runToTime = Math.abs(S.ic.x - p.x) / (C.player.vmax * em.speed);
        if (S.ic.t < runToTime - 2 || dist > 200) {
          inp.skillPressed = true;
        }
      }
    } else if (sId === "focus") {
      // 时空减速:对手球速过快或落后时开启领域
      if (Math.hypot(ball.vx, ball.vy) > 13 || em.aggr > 0.45) {
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
  if (lead >= 0 && p.swingT < 0 && S.swingLead !== null && lead <= S.swingLead) inp.swingAim = depth;

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

export const AI = { think, reset, onScore };
