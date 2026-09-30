// 「人到底赢不赢得了」回归(Cocos 移植新增,老仓库没有对应物)。
//
// 为什么必须有这一份:serve-check 测的是「AI 接不接得住发球」,reach-check 测的是
// 「真人自己接不接得住球」,sim-check 测的是「世界自洽不自洽」。**没有任何一条在测
// 胜负**。于是出现用户反馈的那种局面:入门档 AI 四五十拍怎么都能接住,一分都拿不下来
// —— 每一摊单看都"正常",合起来是死的。这类问题只有把「能不能赢」变成打印出来的数字
// 才拦得住,靠手感讨论永远吵不出结果。
//
// 口径:左队换成「脚本化真人替身」,右队交给真档位 AI(core/ai 在这里是被测对象,
// 不是替身的实现依赖)。替身的全部能力都来自**游戏本来就给真人看的东西** ——
// 落点预测圈(ball.shot.landX)与按拍预告(Physics.flightFramesTo 对
// player.PRESS_LEAD_FRAMES,与 game-root.updateSwingCue 同式),再叠真人代价:
// 反应帧、按拍时机抖动、走位死区。
//
// 三条纪律(否则这工具会变成第二个"看起来绿着"的回归):
//   1. **替身不许借用 core/ai 的 intercept/future** —— 那等于造一个"未卜先知的真人",
//      测出来的胜率没有意义。下面有一条自检把这个约束钉在源码上。
//   2. 样本要够大。单局方差 ±8% 起(serve-check 同样教训),每档跑 N 局取总。
//   3. 替身自己必须像个能打的普通人:它的挥拍命中率有下限断言兜着 —— 否则
//      「胜率不达标」会被误读成「AI 还得再削」,削弱方向就跑偏了。
//
// 数值是**护栏不是目标**:用户明确要「回合长度不变,只让得分可能」,所以除了胜率,
// 还断言回合均值不许塌(否则就是把 AI 打成了不会接球的稻草人)。
//
// 用法(先 npx tsc -p tools/tsconfig.json):
//   node .tools-build/tools/ai-check.js
//   AI_CHECK_MATCHES=25 node .tools-build/tools/ai-check.js                     # 加样本
//   AI_TUNE='{"easy":{"read":110,"zone":0.75}}' node .tools-build/tools/ai-check.js  # 试数值,不改源码
import * as fs from "fs";
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { CFG } from "../assets/scripts/core/config";
import { Player, PRESS_LEAD_FRAMES } from "../assets/scripts/core/player";
import { flightFramesTo } from "../assets/scripts/core/physics";
import { clamp, rand } from "../assets/scripts/core/utils";
import { Ball, DiffKey, Player as Pl, PlayerInput } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

// ---------- 纪律 1 的自检:替身那一路不许出现 AI 的私有预测 ----------
// 找本文件的**源码**(编译产物在 .tools-build 下)。找不到源码就报错 ——
// 静默跳过等于这条断言不存在。
{
  const cand = [
    __filename.replace("/.tools-build/", "/").replace(/\.js$/, ".ts"),
    __filename.replace(/\.tools-build[/\\]tools[/\\]/, "").replace(/\.js$/, ".ts"),
    __filename.replace(/\.js$/, ".ts"),
  ];
  const found = cand.find((f) => fs.existsSync(f));
  if (!found) {
    failures++;
    console.log("  ✗ 找不到 tools/ai-check.ts 源码,替身纯净性自检无法执行");
  } else {
    const src = fs.readFileSync(found, "utf8");
    // 锚点用拼接写:否则 indexOf 会先命中"这段检查代码自己",定位到错误的区间
    const A = "function serve" + "Input(me";
    const B = "// ===== " + "单局 =====";
    const from = src.indexOf(A), to = src.indexOf(B);
    const body = from >= 0 && to > from ? src.slice(from, to) : "";
    assert(body.length > 500, `替身自检:没能定位替身代码段(from=${from} to=${to} file=${found})`);
    assert(!/intercept\(|future\(|entryLead\(/.test(body),
      "替身内不得出现 intercept/future/entryLead(只能用 UI 给真人的落点圈与按拍预告)");
  }
}

// ---------- 调平时试数值用(不改源码);正式跑回归请留空 ----------
const TUNE: Record<string, Record<string, number>> = process.env.AI_TUNE
  ? JSON.parse(process.env.AI_TUNE as string) as Record<string, Record<string, number>> : {};
for (const k of Object.keys(TUNE) as DiffKey[]) {
  const row = C.diffs[k];
  if (!row) { failures++; console.log(`  ✗ AI_TUNE 里有不认识的档位 ${k}`); continue; }
  for (const f of Object.keys(TUNE[k])) (row as unknown as Record<string, unknown>)[f] = TUNE[k][f];
}
if (Object.keys(TUNE).length) console.log(`  ⚠ AI_TUNE 生效(仅调参用,不是出货数值):${JSON.stringify(TUNE)}`);

const empty = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
});

// ===== 真人替身的代价(单位全是帧,与 reach-check 同一套语言) =====
const REACT_FRAMES = 10;    // 看到对手击球 → 才开始朝落点跑(反应 + 触屏提交)
const DEADBAND = 12;        // 离目标这么近就不再微调(人不会逐帧对齐)
const LEAD_JITTER = 4;      // 按拍时机抖动 ±帧(看了按拍预告也还是会早/晚几帧)
// 落点圈画的是地上的**落点**,真人是迎着球去的(球到落点之前就该打),所以替身朝网口
// 迎前几 px。不给这一条是系统性冤枉替身 —— 胜率被压低,然后误去把 AI 削过头。
const MEET_NET = 34;
// 起手不做「每球只按一次」的锁:真人接不到会连按两下(与 player.ts 的 swingBuf 一致)。
// 替身不跨步、不跳杀:真人这两件事做得更少,口径偏保守(替身能赢 → 玩家更能赢)。

// —— 起手次数上限 —— 真人一拍接不住会再补一下,但不会像按键盘连打那样无限补。
// 不设上限时替身会变成"无限补拍的墙":实测挥拍命中率 100%、AI 对局均回合冲到 170+ 拍,
// 那测的就不是"人能不能赢",而是"谁更有耐心"。2 次是既宽容又不失控的折中。
const PRESSES_PER_BALL = 2;
// —— 替身自己的走位误差 ——
// 不给这一条,替身就是"完美站位 + 逐帧重算"的超级球员,实测它对旧版入门 AI 的得分率
// 高达 75%、回合 36 拍 —— 那不是玩家,是第二台 AI。玩家会说「四五十来回拿不到分」。
// 所以这个数是**标定**出来的:调它让替身对「改动前的入门 AI」只赢到 ~15% 的分,
// 把替身钉住之后再去量新档位(标定口径与现场数值记在文件末「标定」段)。
// 于是本工具测的是「同一个普通人,面对改动前后各档,赢面变成多少」—— 有参照系。
//
// 【标定现场 · 2026-09-30】把 AI 侧退回旧数值(read 0 / zone 1 / shotErr 0 / composure 1,
// 即"站位零误差的旧入门档")跑 6 局:
//   PROXY_READ=20 → 得分 49% 赢 3/6 局 回合 60.7 (替身=第二台 AI,不算人)
//   PROXY_READ=25 → 得分 45% 赢 1/6 局 回合 49.1
//   PROXY_READ=32 → 得分 43% 赢 0/6 局 回合 35.6 p50 24   ← 取这个
//   PROXY_READ=65 → 得分 28% 赢 0/6 局 回合 10.2 (回合塌了,测不出"长回合赢不了")
// 取 32 的理由:它同时复现了用户报的两个症状 —— **回合很长(35 拍)且一局都赢不下**。
// 注意:回合长度对替身强弱**极敏感**(±20→60 拍,±65→10 拍),所以本工具的绝对值
// 不是产品指标,**同一替身下"旧数值 vs 新数值"的相对变化**才是。改任何一档数值,
// 都要连同这几行标定数一起重跑,别单独引用一个 avg 回合数当结论。
const PROXY_READ = Number(process.env.AI_CHECK_PROXY_READ ?? 32);

/** 真人能站到的区间(与 player.ts 的夹取同源) */
const STAND = { min: CO.wallL, max: CO.netX - CO.netPad };

interface HumanState {
  token: unknown;      // 本记来球的身份(ball.shot 对象引用)
  react: number;       // 还没反应过来的剩余帧
  lead: number;        // 本记球认定的按拍提前量(每记球只掷一次,像真人一样一路认账)
  presses: number;     // 本记球已经起手几次
  readErr: number;     // 本记球认定的走位偏差(px):每记球掷一次,和真人一样一路认账
  aimIdx: number;      // 交替出球:深/短轮换,逼 AI 前后场都跑
  serveT: number;
  serveDelay: number;
}

const freshState = (): HumanState => ({
  token: null, react: 0, lead: PRESS_LEAD_FRAMES, presses: 0, readErr: 0, aimIdx: 0, serveT: 0, serveDelay: 45,
});

/** 发球:走回位 → 蓄力 → 起拍定落点(与 serve-check 的脚本发球机同思路) */
function serveInput(me: Pl, S: HumanState): PlayerInput {
  const inp = empty();
  const dx = me.homeX - me.x;
  if (Math.abs(dx) > 6) { inp.left = dx < 0; inp.right = dx > 0; return inp; }
  S.serveT++;
  if (S.serveT > S.serveDelay) {
    S.serveT = 0;
    S.serveDelay = 40 + Math.round(rand(0, 25));
    inp.swingAim = S.aimIdx++ % 3 === 2 ? C.aimDepth.near : C.aimDepth.deep;
  }
  return inp;
}

/**
 * 一帧的真人输入:落点圈 → 跑位,按拍预告 → 起手。
 * 全程只用 Player.strikeZone / flightFramesTo / PRESS_LEAD_FRAMES 这三个「UI 本来就在用」
 * 的公开量,不碰 AI 的私有预测。
 */
function humanInput(me: Pl, ball: Ball, state: string, S: HumanState): PlayerInput {
  const inp = empty();

  if (ball.held && ball.owner === me) return serveInput(me, S);

  const incoming = ball.live && !ball.held && ball.lastHitter !== me.side && state === "RALLY";
  if (!incoming) {
    S.token = null;
    const dx = me.homeX - me.x;
    if (Math.abs(dx) > DEADBAND) { inp.left = dx < 0; inp.right = dx > 0; }
    return inp;
  }

  // 新的一记来球:起一次反应计时、掷一次时机、补拍额度重置
  if (S.token !== ball.shot) {
    S.token = ball.shot;
    S.react = REACT_FRAMES;
    S.presses = 0;
    S.readErr = rand(-PROXY_READ, PROXY_READ);
    S.lead = PRESS_LEAD_FRAMES + Math.round(rand(-LEAD_JITTER, LEAD_JITTER));
  }
  if (S.react > 0) { S.react--; return inp; }   // 反应期内不动也不挥

  // —— 跑位:落点预测圈给的就是 ball.shot.landX(再朝网口迎前一点,加自己的走位误差)——
  const land = ball.shot && ball.shot.landX != null ? ball.shot.landX : ball.x + ball.vx * 8;
  const dx = clamp(land + me.facing * MEET_NET + S.readErr, STAND.min, STAND.max) - me.x;
  if (Math.abs(dx) > DEADBAND) { inp.left = dx < 0; inp.right = dx > 0; }

  // —— 起手:与 game-root.updateSwingCue 同式(球到判定区心还剩几帧 vs 最佳提前量) ——
  if (me.swingT < 0 && S.presses < PRESSES_PER_BALL) {
    const z = Player.strikeZone(me, Math.hypot(ball.vx, ball.vy));
    const fc = flightFramesTo(ball, z.x, z.y, z.r * C.swingCue.arriveRadius, C.swingCue.horizonFrames);
    if (fc !== null && fc <= S.lead) {
      S.presses++;
      inp.swingAim = S.aimIdx++ % 4 === 3 ? C.aimDepth.near : C.aimDepth.deep;
    }
  }
  return inp;
}

// ===== 单局 =====
const MAX_STEPS_PER_MATCH = 60 * 60 * 30;
const FAULT = ["出界", "下网", "未过网"];        // 打的人自己失误
const WINNER = ["落地", "扣杀得分", "擦网得分"];  // 打的人打死,接的人漏

interface ShotCounts { ph: number; pw: number; ah: number; aw: number }
interface TierStat {
  matches: number; proxyMatchWins: number;
  proxyPoints: number; aiPoints: number;
  rallies: number[];
  aiServes: number; aiServeReceived: number;
  aiFaulted: number;    // AI 自己打下网/出界(送分)
  aiMissed: number;     // AI 没接到(真人打死)
  proxyFaulted: number;
  proxyMissed: number;
  shots: ShotCounts;    // 跨局累加
  unfinished: number;
}

const newStat = (): TierStat => ({
  matches: 0, proxyMatchWins: 0, proxyPoints: 0, aiPoints: 0, rallies: [],
  aiServes: 0, aiServeReceived: 0, aiFaulted: 0, aiMissed: 0,
  proxyFaulted: 0, proxyMissed: 0, shots: { ph: 0, pw: 0, ah: 0, aw: 0 }, unfinished: 0,
});

function runMatch(diff: DiffKey, st: TierStat): void {
  Rules.newMatch("1p", diff);
  const me = Rules.R.players[0];
  const S = freshState();
  let steps = 0;
  let myServePending = false;
  while (steps < MAX_STEPS_PER_MATCH && Rules.R.state !== "OVER") {
    const R = Rules.R;
    const ins: PlayerInput[] = [];
    for (const p of R.players) {
      if (!R.ball) { ins[p.idx] = empty(); continue; }
      ins[p.idx] = p === me ? humanInput(me, R.ball, R.state, S) : AI.think(p, R.ball, R.state);
    }
    const rally = R.rally;
    Rules.step(ins);
    for (const ev of R.events) {
      if (ev.t === "serve" && ev.side === "left") { myServePending = true; st.aiServes++; }
      if (ev.t === "hit" && ev.side === "right" && myServePending) { st.aiServeReceived++; myServePending = false; }
      if (ev.t === "score") {
        const byProxy = ev.side === "left";
        const why = String(ev.reason ?? "");
        st.rallies.push(rally);
        if (byProxy) st.proxyPoints++; else st.aiPoints++;
        // 归属要反过来看:reason 描述的是**打最后一拍的人**(失分方),不是得分方。
        // 「出界/下网/未过网」= 打的人自己失误;「落地/扣杀/擦网」= 打的人打死、接的人漏。
        // 早先按得分方归类,结果打印成"AI 打飞 0",差点让我以为 shotErr 这条杠杆是死的。
        const hitterIsAI = !byProxy;              // 得分方是对手 ⇔ 最后拍是 AI 打的
        if (FAULT.includes(why)) { if (hitterIsAI) st.aiFaulted++; else st.proxyFaulted++; }
        else if (WINNER.includes(why)) { if (hitterIsAI) st.aiMissed++; else st.proxyMissed++; }
        myServePending = false;
      }
    }
    R.events.length = 0;
    steps++;
  }
  // 挥拍账要**每局结束就取**:下一局 newMatch 会重建球员、stats 归零
  const hp = Rules.statsOf("left"), ha = Rules.statsOf("right");
  st.shots.ph += hp.hits; st.shots.pw += hp.whiffs;
  st.shots.ah += ha.hits; st.shots.aw += ha.whiffs;
  st.matches++;
  if (Rules.R.state !== "OVER") {
    st.unfinished++;
    console.log(`  ! 一局在 ${MAX_STEPS_PER_MATCH} 步内没打完(按当前比分计)—— 回合失控的信号`);
  }
  if (Rules.R.scores[0] >= Rules.R.scores[1]) st.proxyMatchWins++;
}

function measure(diff: DiffKey, matches: number): TierStat {
  const st = newStat();
  for (let i = 0; i < matches; i++) runMatch(diff, st);
  return st;
}

const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pctl = (a: number[], q: number): number => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
const hitRate = (h: number, w: number): string =>
  (h + w ? `${((h / (h + w)) * 100).toFixed(0)}%(${h}/${h + w})` : "—");

const MATCHES_PER_DIFF = Number(process.env.AI_CHECK_MATCHES ?? 12);
// 标定时只跑一档(AI_CHECK_DIFFS=easy),省时间;正式回归留空跑三档
const DIFFS = (process.env.AI_CHECK_DIFFS ?? "easy,normal,hard").split(",") as DiffKey[];
interface Row { diff: DiffKey; pointRate: number; avgRally: number; receive: number; st: TierStat }
const rows: Row[] = [];

console.log(`=== 真人替身 vs 档位 AI:每档 ${MATCHES_PER_DIFF} 局(11 分制)===`);
console.log(`    替身口径:落点圈 + 按拍预告 + 迎前 ${MEET_NET}px + 走位误差 ±${PROXY_READ}px`
  + ` + 反应 ${REACT_FRAMES} 帧 + 时机抖动 ±${LEAD_JITTER} 帧 + 死区 ${DEADBAND}px + 每球最多补 ${PRESSES_PER_BALL} 拍`
  + `(触屏玩家还要再多花几帧,见 reach-check §4)`);
for (const diff of DIFFS) {
  const st = measure(diff, MATCHES_PER_DIFF);
  const total = st.proxyPoints + st.aiPoints;
  const pointRate = total ? st.proxyPoints / total : 0;
  const receive = st.aiServes ? st.aiServeReceived / st.aiServes : 0;
  rows.push({ diff, pointRate, avgRally: avg(st.rallies), receive, st });
  console.log(`  ${diff.padEnd(6)} 真人得分率 ${pct(pointRate)}(${st.proxyPoints}:${st.aiPoints})`
    + ` · 赢下 ${st.proxyMatchWins}/${st.matches} 局`
    + ` · 回合 avg ${avg(st.rallies).toFixed(1)} p50 ${pctl(st.rallies, 0.5)} max ${Math.max(0, ...st.rallies)}`
    + ` · AI 接发 ${pct(receive)}`);
  console.log(`         得分来源:AI 漏接 ${st.aiMissed} · AI 打飞 ${st.aiFaulted}`
    + ` ‖ 真人漏接 ${st.proxyMissed} · 真人打飞 ${st.proxyFaulted}`
    + ` · 挥拍命中 真人 ${hitRate(st.shots.ph, st.shots.pw)} / AI ${hitRate(st.shots.ah, st.shots.aw)}`);
}

const rateOf = (d: string): number => rows.find((r) => r.diff === d)?.pointRate ?? 0;
const rallyOf = (d: string): number => rows.find((r) => r.diff === d)?.avgRally ?? 0;

// 只跑部分档位 = 标定模式:打印数字就够,跨档断言无从判定
if (DIFFS.length < 3) {
  console.log(`\n(标定模式:只跑了 ${DIFFS.join("/")},跳过三档断言 —— 这不是回归判定)`);
  process.exit(failures ? 1 : 0);
}

// —— 真需求:三档必须拉开,入门档要打得动 ——
assert(rateOf("easy") >= 0.55, `入门:真人得分率应 ≥55%(实际 ${pct(rateOf("easy"))})`);
assert(rateOf("normal") >= 0.40 && rateOf("normal") <= 0.62,
  `普通:真人得分率应在 40%~62%(实际 ${pct(rateOf("normal"))})`);
assert(rateOf("hard") <= 0.45, `大师:真人得分率应 ≤45%(实际 ${pct(rateOf("hard"))})`);
assert(rateOf("easy") > rateOf("normal") + 0.06,
  `入门必须明显好过普通(只差 ${pct(rateOf("easy") - rateOf("normal"))})`);
assert(rateOf("normal") > rateOf("hard") + 0.04,
  `普通必须明显好过大师(只差 ${pct(rateOf("normal") - rateOf("hard"))})`);

// —— 护栏:不许把 AI 打成不会接球的稻草人(用户要保留长回合) ——
for (const d of ["easy", "normal", "hard"] as DiffKey[]) {
  assert(rallyOf(d) >= 10, `${d}:回合均值应 ≥10 拍(实际 ${rallyOf(d).toFixed(1)})—— 掉了是削弱过头,不是"能得分"`);
  assert(rateOf(d) <= 0.85, `${d}:真人得分率不该高到 ${pct(rateOf(d))}(AI 变成送分机器)`);
}
const hardRow = rows.find((r) => r.diff === "hard");
assert((hardRow?.receive ?? 0) >= 0.85,
  `大师接发率应 ≥85%(实际 ${pct(hardRow?.receive ?? 0)})—— 顶档不许被这次改动砍废`);
// 纪律 3:替身自己必须能打
if (hardRow) {
  const s = hardRow.st.shots;
  assert(s.ph / Math.max(1, s.ph + s.pw) >= 0.6,
    `替身挥拍命中率应 ≥60%(实际 ${hitRate(s.ph, s.pw)})—— 替身太菜会让削弱方向跑偏`);
}

if (failures) {
  console.log(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log("\n真人可赢性回归 ✓");
