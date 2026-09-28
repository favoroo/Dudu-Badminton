// ============================================================
// AI:和人类用同一套挥拍机制(会挥空、会打偏),只是时机更差、误差更大
// 关键是「自己重模拟球路」而不是直接读答案,所以调参不会让它未卜先知
// ============================================================
import { CFG } from "./config";
import { clamp, approach, rand } from "./utils";
import { Physics } from "./physics";
import { Player as Pl } from "./player";
import { Rules, RulesState } from "./rules";
import { AiState, Ball, Intercept, Player, PlayerInput } from "./types";

const C = CFG;
const CO = C.court;

function fresh(): AiState {
  return { tick: 0, targetX: 0, serveT: 0, wantSmash: false, ic: null, swingLead: null, chasing: true,
    emotion: 0,           // 情绪值:-1(沮丧)到 1(亢奋),0=平静
    tauntCd: 0,           // 挑衅动作冷却
    celebrateT: 0,        // 庆祝动作剩余帧
    frustrateT: 0,        // 沮丧动作剩余帧
  };
}

// 状态挂在球员身上:同一个 AI 可以驱动两个球员(也方便 AI vs AI 回归测试)
function reset(p: Player): void { p.ai = fresh(); }

const D = (p: Player) => (p.aiDiff ? C.diffs[p.aiDiff] : C.diffs.normal);

interface FutureLike { x: number; y: number; vx: number; vy: number }

// 把球往前推 n 步(不改原对象)
function future(ball: FutureLike, n: number): FutureLike[] {
  let { x, y, vx, vy } = ball;
  const out: FutureLike[] = [];
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(vx, vy);
    const d = Math.max(C.shuttle.dragMin, 1 - C.shuttle.dragK * Math.min(sp, C.shuttle.maxSpeed));
    vx *= d; vy *= d; vy += C.shuttle.gravity;
    x += vx; y += vy;
    out.push({ x, y, vx, vy });
  }
  return out;
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
  const pts = future(ball, SW.windup + SW.active + 6);
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
// topH = 允许的最高拦截点:站立约 98px,跳起能到 220px(扣杀要提前在高点等球)
function intercept(p: Player, ball: Ball, topH: number): Intercept {
  const pts = future(ball, 150);
  let best: Intercept | null = null;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const mine = p.side === "left" ? q.x < CO.netX - 4 : q.x > CO.netX + 4;
    if (!mine) continue;
    const h = CO.groundY - q.y;
    if (h < topH) { best = { x: q.x, y: q.y, t: i, h }; break; }
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

interface EmotionMods { aggr: number; timingErr: number; speed: number }

// 情绪修正:落后时更激进(认真起来),领先时略放松
function emotionModifiers(p: Player, S: AiState, d: ReturnType<typeof D>): EmotionMods {
  const R = Rules.R;
  const myIdx = p.side === "left" ? 0 : 1;
  const myScore = R.scores[myIdx];
  const oppScore = R.scores[1 - myIdx];
  const diff = myScore - oppScore;
  // 情绪目标:落后 → 负(沮丧/认真),领先 → 正(亢奋/放松)
  const targetEmotion = clamp(diff / 5, -1, 1);
  S.emotion = approach(S.emotion, targetEmotion, 0.08);
  // 返回修正后的难度参数
  return {
    aggr: d.aggr * (1 - S.emotion * 0.25),        // 落后时更激进(+25%),领先时更保守(-25%)
    timingErr: d.timingErr * (1 + S.emotion * 0.2), // 落后时更准(-20%),领先时更松(+20%)
    speed: d.speed * (1 + S.emotion * 0.08),        // 落后时跑更快
  };
}

function think(p: Player, ball: Ball, state: string): PlayerInput {
  const S = p.ai || (p.ai = fresh());
  const inp: PlayerInput = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  const d = D(p);
  const em = emotionModifiers(p, S, d);  // 情绪修正后的参数

  // 冷却/动作计时
  if (S.tauntCd > 0) S.tauntCd--;
  if (S.celebrateT > 0) S.celebrateT--;
  if (S.frustrateT > 0) S.frustrateT--;

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
  const incoming = ball.live && !ball.held && ball.lastHitter !== p.side;
  S.tick--;
  if (incoming && S.tick <= 0) {
    S.tick = d.tick;
    const runTo = (x: number) => Math.abs(x - p.x) / (C.player.vmax * em.speed);
    // 从最高可行拦截点往下逐级试:能跳就压,不能跳就老实退到位
    const aggr = Rules.teamOf(p.side).length > 1 ? Math.min(0.88, em.aggr + C.doubles.aggrBonus) : em.aggr;
    S.wantSmash = Math.random() < aggr;          // 本回合是否处于进攻心态
    const ladder = S.wantSmash ? [C.aiReach.attack, C.aiReach.stand, 92] : [C.aiReach.stand, 92];
    let ic: Intercept | null = null;
    for (const topH of ladder) {
      const c = intercept(p, ball, topH);
      const jumping = topH > C.aiReach.attack - 4;
      const need = (jumping ? C.player.jumpApex : 0) + 6;
      if (c.t >= runTo(c.x) + need) { ic = c; S.wantSmash = jumping || S.wantSmash; break; }
    }
    if (!ic) ic = intercept(p, ball, 90);
    const err = (Math.random() * 2 - 1) * d.aimErr;
    const lo = p.side === "left" ? CO.wallL : CO.netX + 10;
    const hi = p.side === "left" ? CO.netX - 10 : CO.wallR;
    // 双打:落点归队友就回防区待命,别两个人叠在一起
    const claimX = ball.shot && ball.shot.landX != null ? ball.shot.landX : ic.x;
    S.chasing = Rules.shouldChase(p, claimX);
    S.targetX = S.chasing ? clamp(ic.x + err, lo, hi) : zoneHome(p);
    S.ic = S.chasing ? ic : null;
  } else if (!incoming) {
    S.targetX = zoneHome(p);
    S.wantSmash = false;
    S.ic = null;
    S.chasing = false;
  }

  // ---------- 跑位 ----------
  const dx = S.targetX - p.x;
  if (Math.abs(dx) > 8) { inp.left = dx < 0; inp.right = dx > 0; }

  // ---------- 起跳扣杀 ----------
  // 不靠预定拦截点(球在高位停留太短),改反应式:
  // 若 jumpApex 帧后球会落到我头顶附近的高点,现在就跳,最高正好迎上
  if (S.wantSmash && S.chasing && p.onGround && incoming && ball.live && !ball.held) {
    const q = future(ball, C.player.jumpApex)[C.player.jumpApex - 1];
    if (q && Math.abs(q.x - p.x) < 62) {
      const h = CO.groundY - q.y;
      const mine = p.side === "left" ? q.x < CO.netX - 6 : q.x > CO.netX + 6;
      if (mine && h > C.aiReach.stand && h < C.aiReach.jump) inp.jumpPressed = true;
    }
  }

  // ---------- 跨步救球 ----------
  // 球低且刚好超出正常步幅,但 lunge 能救到:果断跨步
  if (p.onGround && p.swingT < 0 && p.lungeT < 0 && incoming && ball.live && !ball.held) {
    const dist = Math.abs(ball.x - p.x);
    const reach = p.swingRadius * 1.1;
    const lungeReach = reach * (C.lunge.reachMul || 1.45);
    const h = CO.groundY - ball.y;
    // 球在网前高度以下、距离超出正常但进入跨步范围
    if (dist > reach && dist < lungeReach && h < C.aiReach.stand * 0.7) {
      // 面朝球的方向才跨步(反向说明已经跑过了)
      const ballDir = ball.x > p.x ? 1 : -1;
      if (ballDir === p.facing) {
        inp.lungePressed = true;
        inp.lungeDir = p.facing;
      }
    }
  }

  // ---------- 起手时机:按「提前量 = 窗口中心」起手,起手即定落点深浅 ----------
  const SW = C.swing;
  const center = SW.windup + SW.active / 2;
  if (!incoming) S.swingLead = null;
  const radius = Physics.reachRadius(ball);
  const lead = (ball.live && !ball.held && S.chasing !== false) ? entryLead(p, ball, radius) : -1;
  if (incoming && S.swingLead === null) {
    // 每拍只掷一次:负=早起手,正=晚起手,晚过头就漏球
    S.swingLead = center + Math.round(rand(-em.timingErr, em.timingErr));
  }
  const depth = chooseDepth(p, Rules.rivalsOf(p), CO.groundY - ball.y, S.wantSmash);
  if (lead >= 0 && p.swingT < 0 && S.swingLead !== null && lead <= S.swingLead) inp.swingAim = depth;

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
