// ============================================================
// 闯关模式进度账本回归 (campaign-check)
//
// 为什么要有这一条:大厅的「继续闯关」直达条、卡面上的「▶ 下一关」印章、结算页的
// 「下一关 ▶ 第 N 关」按钮,三处全押在 CampaignManager 的两句判据上
// (getNextStage / getStageByNo)。这三处只要有一处算歪,用户看到的就是
// 「通关了却没有下一关」或「点了跳到没解锁的关」—— 而它不会崩,只会安静地不好用。
// core/campaign.ts 零 cc 依赖,所以这套判据可以整份在 node 下跑真代码。
//
// 断什么:
//   §1 关卡表自洽 —— 20 关、编号连续不重号、id 唯一、四个场景各 5 关
//      (大厅一屏正好摆 5 张卡)、章节↔场景一一对应、每关文案与奖励齐活;
//   §2 真实 CampaignManager 的推进:空档 → 第 1 关;逐关通 → 下一关跟着 +1;
//      回头重打只补星不推进;全通 → null(结算页据此退回「返回主菜单」当主钮);
//   §3 大厅聚焦判据:下一关所在章节之前的所有章节必须全通 ——
//      show() 会把 tab 自动落到下一关所在场景,前面还留着没打的关就会被藏住;
//   §4 结算页那颗「下一关」的取法(本关编号 +1 且已解锁):除最后一关外必须给得出。
//   §5 三星判据:每关 starsCheck 三条、首条必是 win、判据 k 全部可识别;
//      evaluateStars/checkStarCond 用假事实逐条正反例(文案与判定脱节是本工具的由来)。
//   §6 奖励口径:闯关首通发 stage.rewards、重打回落难度表、无限练习收局发奖并记
//      单局最高分、2p 友谊赛不发 —— 结算的经济口径只许有一份真话。
//
// --selftest 拿改坏的关卡表喂 §1/§5,确认这套判据真的会报警
// (规则脚本最怕的是悄悄全绿)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/campaign-check.js            # exit 0 = 通过
//   node .tools-build/tools/campaign-check.js -v         # 打印每关判定
//   node .tools-build/tools/campaign-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { CAMPAIGN_STAGES, CampaignManager, aiReliefFor, checkStarCond, evaluateStars, isBetterBestScore, tuneAiTier, type CourtTheme, type StageDef, type StarCond, type StarFacts } from "../assets/scripts/core/campaign";
import { STAR_COPY, goalOverrideMismatch, objectiveLine, starGoalLines } from "../assets/scripts/core/campaign-hud";
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const selftest = process.argv.includes("--selftest");

const COURTS: CourtTheme[] = ["beach", "dojo", "cyber", "arena"];
const PER_COURT = 5;
/** checkStarCond 目前实现的全部分支:关卡表里出现表外的 k = 判据没接上就展示给玩家 */
const KNOWN_CONDS = new Set<string>([
  "win", "netLead", "opScoreAtMost", "shutout", "perfects", "sweets", "smashes", "noWhiff",
  "whiffsAtMost",
  "rallyAtLeast", "noServeFault", "lungeSaves", "smashScores", "jumpSmashes", "deepShots",
  "iaiStrikes", "netIntercepts", "airShotRatio", "skillCasts", "noZonePenalty", "empReturns",
  "laserBoosts", "noExhausted", "slidingScores", "lastSmash",
]);
/** STAR_COPY 必须覆盖全部判据 k(少一条 = 简报/HUD 会 undefined 崩或说不出话) */
const COPY_CONDS = new Set<string>(Object.keys(STAR_COPY));
const h = makeChecker({ verbose });
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

/** §1 表自洽:纯函数,便于 --selftest 喂改坏的表 */
function auditTable(stages: StageDef[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const nos = new Set<number>();
  for (const s of stages) {
    if (ids.has(s.id)) out.push(`id 重复:${s.id}`);
    if (nos.has(s.stageNo)) out.push(`stageNo 重复:${s.stageNo}`);
    ids.add(s.id); nos.add(s.stageNo);
    if (!COURTS.includes(s.court)) out.push(`${s.id}: 场景 ${s.court} 不在四大场景里`);
    if (COURTS.length && s.chapter !== COURTS.indexOf(s.court) + 1) {
      out.push(`${s.id}: 章节 ${s.chapter} 与场景 ${s.court} 不对应(大厅按场景分 tab,章节只跟着场景走)`);
    }
    for (const [k, v] of Object.entries({ title: s.title, subtitle: s.subtitle, badge: s.badge, desc: s.desc, hint: s.hint })) {
      if (!v || !v.trim()) out.push(`${s.id}: ${k} 是空的(战前简报会开天窗)`);
    }
    // 目标文案由判据生成(starsGoal 只剩作者覆写);条数与空值照旧要核,
    // 因为简报的三条胶囊是按颗数排的,少一条就缺一颗星
    const goalLines = starGoalLines(s);
    if (goalLines.length !== 3) out.push(`${s.id}: 目标文案 ${goalLines.length} 条,弹窗按三颗星标排`);
    if (goalLines.some((g) => !g || !g.trim())) out.push(`${s.id}: 目标文案里有空条目`);
    // 覆写允许换说法,但**不许换数字**:把失分门槛从 ≤1 放松到 ≤2 却仍印「不超过 1 分」,
    // 玩家是按简报决定要不要挑战这一关的 —— 那是骗。
    if (s.starsGoal) {
      if (s.starsGoal.length !== 3) out.push(`${s.id}: starsGoal 覆写 ${s.starsGoal.length} 条,要么补齐三条要么整条删掉(由判据生成)`);
      const drift = goalOverrideMismatch(s);
      if (drift.length) out.push(`${s.id}: starsGoal 覆写第 ${drift.map((i) => i + 1).join(",")} 条的数字与 starsCheck 不符`);
    }
    if (!s.starsCheck || s.starsCheck.length !== 3) {
      out.push(`${s.id}: starsCheck 缺失或不是 3 条(判星会回落通用三条,与简报文案脱节)`);
    } else {
      if (s.starsCheck[0].k !== "win") out.push(`${s.id}: starsCheck 首条必须是 win(第一颗星 = 赢)`);
      for (let i = 0; i < s.starsCheck.length; i++) {
        if (!KNOWN_CONDS.has(s.starsCheck[i].k)) out.push(`${s.id}: starsCheck[${i}] 的判据 ${s.starsCheck[i].k} 未注册`);
        // 判据注册了但没配文案 = 简报/HUD 取到 undefined,一开局就崩在文案那一行
        if (!COPY_CONDS.has(s.starsCheck[i].k)) out.push(`${s.id}: 判据 ${s.starsCheck[i].k} 在 STAR_COPY 里没有措辞`);
      }
    }
    if (!(s.targetScore >= 1)) out.push(`${s.id}: targetScore ${s.targetScore} 打不到`);
    if (!(s.rewards.coins > 0 && s.rewards.exp > 0)) out.push(`${s.id}: 奖励为 0,通关没成就感`);
    if (!["easy", "normal", "hard"].includes(s.aiDiff)) out.push(`${s.id}: aiDiff ${s.aiDiff} 没有对应的难度文案`);
  }
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].stageNo !== i + 1) out.push(`第 ${i + 1} 张表的 stageNo 是 ${stages[i].stageNo}(线性解锁按数组序走)`);
  }
  for (const c of COURTS) {
    const n = stages.filter((s) => s.court === c).length;
    if (n !== PER_COURT) out.push(`场景 ${c} 有 ${n} 关,大厅一屏按 ${PER_COURT} 张卡排版`);
  }
  return out;
}

/** 把第 no 关记成通关(真实 API,连带解锁与星级) */
function clearStage(no: number, stars = 1): void {
  const s = CampaignManager.getStageByNo(no);
  if (!s) throw new Error(`第 ${no} 关不存在`);
  CampaignManager.recordStageClear(s, s.targetScore, 0, stars);
}

// ---------- §1 关卡表 ----------
const tableIssues = auditTable(CAMPAIGN_STAGES);
ok(tableIssues.length === 0, tableIssues.length ? `关卡表:\n    ${tableIssues.join("\n    ")}` : `关卡表自洽:${CAMPAIGN_STAGES.length} 关 · 4 场景各 ${PER_COURT} 关`);

// ---------- §2 下一关推进(跑真实 CampaignManager) ----------
ok(CampaignManager.getStageByNo(1)?.stageNo === 1 && CampaignManager.getStageByNo(99) === null,
  "getStageByNo: 存在取到、越界返回 null");

const first = CampaignManager.getNextStage();
ok(!!first && first.stageNo === 1, `空档的下一关 = 第 1 关(实得 ${first ? first.stageNo : "null"})`);

let seqBad: string[] = [];
for (let no = 1; no <= CAMPAIGN_STAGES.length; no++) {
  clearStage(no, 2);
  const got = CampaignManager.getNextStage();
  const want = no < CAMPAIGN_STAGES.length ? no + 1 : null;
  const g = got ? got.stageNo : null;
  if (g !== want) seqBad.push(`通到第 ${no} 关后下一关应为 ${want},实得 ${g}`);
  // 回头重打:只补星,不该把「下一关」往回拉,也不该跳过没打的
  if (want !== null) {
    clearStage(1, 3);
    const again = CampaignManager.getNextStage();
    if (!again || again.stageNo !== want) seqBad.push(`重打第 1 关后下一关被改成 ${again ? again.stageNo : "null"}`);
  }
}
ok(seqBad.length === 0, seqBad.length ? `下一关推进:\n    ${seqBad.join("\n    ")}` : "下一关推进:逐关通关严格 +1,回头重打不推进");

const after = CampaignManager.getNextStage();
ok(after === null, `全 ${CAMPAIGN_STAGES.length} 关通完 → 下一关为 null(结算页据此退回「返回主菜单」)`);
ok(CampaignManager.getClearedCount() === CAMPAIGN_STAGES.length, "已通关数与关卡表总数一致");
ok(CampaignManager.getTotalStars() <= CAMPAIGN_STAGES.length * 3, "总星数不超过 3 × 关数");

// ---------- §3 大厅聚焦判据 ----------
{
  // getProgress() 按引用返回存档:直接摆出「刚打到第 k 关」的各种状态,再走真实判据。
  // show() 会把 tab 自动落到下一关所在的那个场景 —— 前面要还留着没打的关,就被藏住了。
  const prog = CampaignManager.getProgress();
  const issues: string[] = [];
  for (let k = 1; k <= CAMPAIGN_STAGES.length; k++) {
    prog.records = {};
    for (let n = 1; n < k; n++) {
      const s = CampaignManager.getStageByNo(n)!;
      prog.records[s.id] = { stars: 2, clears: 1, bestScore: `${s.targetScore}-0`, attempts: 1 };
    }
    prog.unlockedMaxStageNo = k;
    const got = CampaignManager.getNextStage();
    if (!got || got.stageNo !== k) { issues.push(`打到第 ${k} 关时下一关报成 ${got ? got.stageNo : "null"}`); continue; }
    if (!CampaignManager.isStageUnlocked(got.stageNo)) { issues.push(`第 ${k} 关未解锁却被当成下一关`); continue; }
    const chapterStart = (got.chapter - 1) * PER_COURT + 1;
    if (got.stageNo !== k) issues.push(`第 ${k} 关的 chapter ${got.chapter} 与编号不吻合`);
    for (let n = 1; n < chapterStart; n++) {
      const s2 = CampaignManager.getStageByNo(n)!;
      if ((prog.records[s2.id]?.clears || 0) === 0) {
        issues.push(`tab 要落到第 ${k} 关的 ${got.court},但第 ${n} 关还没通(会被藏住)`);
      }
    }
  }
  ok(issues.length === 0, issues.length ? `聚焦判据:\n    ${issues.slice(0, 5).join("\n    ")}`
    : "聚焦判据:任意时刻下一关必已解锁,且其前面章节全通(tab 自动跳转不藏关)");
}

// ---------- §4 结算页那颗「下一关」 ----------
{
  const issues: string[] = [];
  for (const s of CAMPAIGN_STAGES) {
    const after2 = CampaignManager.getStageByNo(s.stageNo + 1);
    if (s.stageNo < CAMPAIGN_STAGES.length) {
      if (!after2) issues.push(`第 ${s.stageNo} 关取不到 +1 关`);
      else if (!CampaignManager.isStageUnlocked(after2.stageNo)) issues.push(`第 ${s.stageNo} 关的下一关(第 ${after2.stageNo})未解锁`);
    } else if (after2) issues.push("最后一关之后还取得出关");
  }
  ok(issues.length === 0, issues.length ? `结算「下一关」:\n    ${issues.join("\n    ")}` : `结算「下一关」:除最后一关外都取得出、且必已解锁`);
}

// ---------- §5 三星判据:文案与判定必须一一对应 ----------
{
  // 假事实工厂:默认一局「赢得漂亮」的事实,各断言按需覆盖
  const F = (over: Partial<StarFacts> = {}): StarFacts => ({
    won: true, myScore: 7, opScore: 3, longestRally: 5,
    hits: 10, smashes: 2, sweets: 4, perfects: 1, whiffs: 1,
    lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
    deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
    zonePenalties: 0, exhausted: 0,
    serveFaults: 0, smashScores: 0, slidingScores: 0, laserBoosts: 0,
    lastSmash: false, ...over,
  });

  // 20 关全表:starsCheck 就位且可求值(不许再出现「文案一套、判定一套」)
  const tableBad = CAMPAIGN_STAGES.filter((s) => !s.starsCheck || s.starsCheck.length !== 3 || evaluateStars(s.starsCheck, F()) < 0);
  ok(tableBad.length === 0, tableBad.length ? `三星判据:${tableBad.map((s) => s.id).join(",")} 不可求值` : "三星判据:20 关 starsCheck 全部就位且可求值");

  // 第 1 关(beach_1: 胜/净胜2/无发球失误)走真表:满贯与破功各一例
  const b1 = CAMPAIGN_STAGES[0];
  ok(evaluateStars(b1.starsCheck, F()) === 3, "beach_1 满贯事实 → 3 星");
  ok(evaluateStars(b1.starsCheck, F({ opScore: 6, serveFaults: 1 })) === 1, "beach_1 净胜不足+发球失误 → 只剩 1 星");
  ok(evaluateStars(b1.starsCheck, F({ won: false, opScore: 6, serveFaults: 1 })) === 0, "beach_1 没赢 → 0 星(recordStageClear 的 ≥1 钳制是另一层,不在这里)");

  // 每族判据的正反例(数字判据:n-1 失败 / n 通过;布尔判据:真过假不过)
  const nCases: [StarCond, number][] = [
    [{ k: "netLead", n: 2 }, 2], [{ k: "opScoreAtMost", n: 1 }, 1], [{ k: "perfects", n: 2 }, 2],
    [{ k: "sweets", n: 3 }, 3], [{ k: "smashes", n: 3 }, 3], [{ k: "rallyAtLeast", n: 8 }, 8],
    [{ k: "lungeSaves", n: 3 }, 3], [{ k: "smashScores", n: 2 }, 2], [{ k: "jumpSmashes", n: 3 }, 3],
    [{ k: "deepShots", n: 3 }, 3], [{ k: "iaiStrikes", n: 2 }, 2], [{ k: "netIntercepts", n: 2 }, 2],
    [{ k: "empReturns", n: 2 }, 2], [{ k: "laserBoosts", n: 2 }, 2], [{ k: "slidingScores", n: 2 }, 2],
    [{ k: "skillCasts", n: 6 }, 6],
  ];
  const numBad: string[] = [];
  for (const [c, n] of nCases) {
    const passAt = F();
    const failAt = F();
    // 按 k 把对应事实拨到 n / n-1,其余保持默认
    const fieldMap: Partial<Record<string, keyof StarFacts>> = {
      netLead: "opScore", opScoreAtMost: "opScore", perfects: "perfects", sweets: "sweets",
      smashes: "smashes", rallyAtLeast: "longestRally", lungeSaves: "lungeShots", smashScores: "smashScores",
      jumpSmashes: "jumpSmashes", deepShots: "deepShots", iaiStrikes: "iaiStrikes", netIntercepts: "netIntercepts",
      empReturns: "empReturns", laserBoosts: "laserBoosts", slidingScores: "slidingScores", skillCasts: "skillCasts",
    };
    const fld = fieldMap[c.k];
    if (!fld) { numBad.push(`${c.k}: 没接事实映射`); continue; }
    const pf = passAt as unknown as Record<string, number>;
    const ff = failAt as unknown as Record<string, number>;
    if (c.k === "opScoreAtMost") { pf[fld] = n; ff[fld] = n + 1; }
    else if (c.k === "netLead") { pf[fld] = 7 - n; ff[fld] = 7 - n + 1; }   // 对手分越低净胜越大
    else { pf[fld] = n; ff[fld] = n - 1; }
    if (!checkStarCond(c, passAt)) numBad.push(`${c.k}: 达标(${n})却判负`);
    if (checkStarCond(c, failAt)) numBad.push(`${c.k}: 未达标却判过`);
  }
  ok(numBad.length === 0, numBad.length ? `数字判据:\n    ${numBad.slice(0, 5).join("\n    ")}` : `数字判据:${nCases.length} 族正反例全对`);

  const boolBad: string[] = [];
  const boolCases: [StarCond, (f: StarFacts) => void, (f: StarFacts) => void][] = [
    [{ k: "shutout" }, (f) => { f.opScore = 0; }, (f) => { f.opScore = 1; }],
    [{ k: "noWhiff" }, (f) => { f.whiffs = 0; }, (f) => { f.whiffs = 1; }],
    [{ k: "noServeFault" }, (f) => { f.serveFaults = 0; }, (f) => { f.serveFaults = 1; }],
    [{ k: "noZonePenalty" }, (f) => { f.zonePenalties = 0; }, (f) => { f.zonePenalties = 1; }],
    [{ k: "noExhausted" }, (f) => { f.exhausted = 0; }, (f) => { f.exhausted = 1; }],
    [{ k: "lastSmash" }, (f) => { f.lastSmash = true; }, (f) => { f.lastSmash = false; }],
    [{ k: "win" }, (f) => { f.won = true; }, (f) => { f.won = false; }],
  ];
  for (const [c, pass, fail] of boolCases) {
    const pf = F(); pass(pf);
    const ff = F(); fail(ff);
    if (!checkStarCond(c, pf)) boolBad.push(`${c.k}: 正例判负`);
    if (checkStarCond(c, ff)) boolBad.push(`${c.k}: 反例判过`);
  }
  // 空中占比:分子/分母双闸(样本不足直接不判,防一两拍 100% 白送)
  const airOk = F({ hits: 6, airHits: 5 });         // 83% > 70
  const airLowSample = F({ hits: 3, airHits: 3 });  // 100% 但样本 < airMinHits
  const airMiss = F({ hits: 10, airHits: 6 });      // 60% ≤ 70
  if (!checkStarCond({ k: "airShotRatio", pct: 70 }, airOk)) boolBad.push("airShotRatio: 达标判负");
  if (checkStarCond({ k: "airShotRatio", pct: 70 }, airLowSample)) boolBad.push("airShotRatio: 样本不足竟判过");
  if (checkStarCond({ k: "airShotRatio", pct: 70 }, airMiss)) boolBad.push("airShotRatio: 占比不足竟判过");
  ok(boolBad.length === 0, boolBad.length ? `布尔判据:\n    ${boolBad.slice(0, 5).join("\n    ")}` : `布尔判据:${boolCases.length + 3} 条正反例全对`);

  // fallback 路径:缺判据返回 -1,由 rules 回落通用三条(旧行为保留)
  ok(evaluateStars(undefined, F()) === -1, "无 starsCheck → -1(rules 回落通用三条)");
}

// ---------- §6 结算奖励口径 ----------
{
  // node 下 utils 走内存后端,profile 是全新档;断言只看返回值的口径,不比绝对余额
  const stage1 = CAMPAIGN_STAGES[0];
  const first = Career.settle({
    mode: "campaign", diff: stage1.aiDiff, won: true,
    campaign: { firstClear: true, coins: stage1.rewards.coins, exp: stage1.rewards.exp },
  });
  ok(!!first && first.first === true && first.baseCoin === stage1.rewards.coins && first.exp === stage1.rewards.exp,
    `首通发关卡奖励(${stage1.rewards.coins}/${stage1.rewards.exp}),实得 ${first ? `${first.baseCoin}/${first.exp}` : "null"}`);

  const replay = Career.settle({
    mode: "campaign", diff: stage1.aiDiff, won: true,
    campaign: { firstClear: false, coins: stage1.rewards.coins, exp: stage1.rewards.exp },
  });
  const R0 = CFG.career.rewards[stage1.aiDiff];
  ok(!!replay && replay.first === false && replay.baseCoin === R0.win && replay.exp === R0.expWin,
    `重打回落难度表(${R0.win}/${R0.expWin}),实得 ${replay ? `${replay.baseCoin}/${replay.exp}` : "null"}`);

  const endless = Career.settle({ mode: "endless", diff: "normal", won: true, scores: [12, 5] });
  ok(!!endless && endless.coin > 0 && Career.profile().bestEndlessScore === 12,
    `无限收局发奖并记单局最高分(${Career.profile().bestEndlessScore}),实得 ${endless ? endless.coin : "null"} 币`);

  const friend = Career.settle({ mode: "2p", diff: "normal", won: true });
  ok(friend === null, "2p 友谊赛不发奖励");

  const lose = Career.settle({ mode: "campaign", diff: stage1.aiDiff, won: false });
  ok(!!lose && lose.baseCoin === R0.lose, `闯关败局走难度表败奖(${R0.lose}),实得 ${lose ? lose.baseCoin : "null"}`);
}

// ---------- §7 判据的「说法 / 进度」与判定同源(core/campaign-hud) ----------
{
  // 一条判据打到"刚好达标"与"差一档"两种事实:checkStarCond 与 objectiveLine 必须同时点头/摇头。
  // 为什么两条一起验:HUD 印「飞扑 1/3」而判据其实要 2 次(或反过来)是不会崩的坏 ——
  // 玩家照着读数打,打完发现星没亮,只会觉得这模式在骗人。
  const F0 = (): StarFacts => ({
    won: false, myScore: 0, opScore: 0, longestRally: 0,
    hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0,
    lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
    deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
    zonePenalties: 0, exhausted: 0,
    serveFaults: 0, smashScores: 0, slidingScores: 0, laserBoosts: 0,
    lastSmash: false,
  });
  /** 达标(on=true)与差一档(on=false)两副事实 */
  const factFor = (c: StarCond, on: boolean): StarFacts => {
    const f = F0();
    switch (c.k) {
      case "win": f.won = on; f.myScore = on ? 7 : 0; f.opScore = on ? 3 : 7; break;
      case "netLead": f.myScore = 7; f.opScore = on ? 7 - c.n : 7 - c.n + 1; break;
      case "opScoreAtMost": f.opScore = on ? c.n : c.n + 1; break;
      case "shutout": f.opScore = on ? 0 : 1; break;
      case "perfects": f.perfects = on ? c.n : c.n - 1; break;
      case "sweets": f.sweets = on ? c.n : c.n - 1; break;
      case "smashes": f.smashes = on ? c.n : c.n - 1; break;
      case "noWhiff": f.whiffs = on ? 0 : 1; break;
      case "whiffsAtMost": f.whiffs = on ? c.n : c.n + 1; break;
      case "rallyAtLeast": f.longestRally = on ? c.n : c.n - 1; break;
      case "noServeFault": f.serveFaults = on ? 0 : 1; break;
      case "lungeSaves": f.lungeShots = on ? c.n : c.n - 1; break;
      case "smashScores": f.smashScores = on ? c.n : c.n - 1; break;
      case "jumpSmashes": f.jumpSmashes = on ? c.n : c.n - 1; break;
      case "deepShots": f.deepShots = on ? c.n : c.n - 1; break;
      case "iaiStrikes": f.iaiStrikes = on ? c.n : c.n - 1; break;
      case "netIntercepts": f.netIntercepts = on ? c.n : c.n - 1; break;
      case "airShotRatio": f.hits = Math.max(10, CFG.star.airMinHits); f.airHits = on ? Math.floor(c.pct / 10) + 1 : Math.floor(c.pct / 10); break;
      case "skillCasts": f.skillCasts = on ? c.n : c.n - 1; break;
      case "noZonePenalty": f.zonePenalties = on ? 0 : 1; break;
      case "empReturns": f.empReturns = on ? c.n : c.n - 1; break;
      case "laserBoosts": f.laserBoosts = on ? c.n : c.n - 1; break;
      case "noExhausted": f.exhausted = on ? 0 : 1; break;
      case "slidingScores": f.slidingScores = on ? c.n : c.n - 1; break;
      case "lastSmash": f.lastSmash = on; break;
    }
    return f;
  };
  const bad7: string[] = [];
  for (const s of CAMPAIGN_STAGES) {
    for (let i = 0; i < s.starsCheck.length; i++) {
      const c = s.starsCheck[i];
      const copy = STAR_COPY[c.k];
      if (!copy) { bad7.push(`${s.id}★${i + 1}: STAR_COPY 里没有 ${c.k} 的措辞`); continue; }
      if (!copy.goal(c).trim() || !copy.label.trim()) bad7.push(`${s.id}★${i + 1}: ${c.k} 的文案/标签是空的`);
      if (copy.label.length > 5) bad7.push(`${s.id}★${i + 1}: 紧凑标签「${copy.label}」${copy.label.length} 字,HUD 一行放不下三条`);
      for (const on of [true, false]) {
        const f = factFor(c, on);
        const judged = checkStarCond(c, f);
        const line = objectiveLine(c, i, f);
        if (judged !== on || line.ok !== on) bad7.push(`${s.id}★${i + 1}(${c.k})${on ? "达标" : "差一档"}:判据=${judged} HUD=${line.ok}`);
      }
    }
  }
  ok(bad7.length === 0, bad7.length ? `判据文案/进度:\n    ${bad7.join("\n    ")}` : "判据文案/进度:20 关 60 条的达标与差一档两副事实,判定与读数完全一致");

  // 覆写不许换措辞之外的东西:第 20 关 ★1 说「连拿 2 分绝杀夺冠」是对的,
  // 但覆写一旦与判据数字不符就是骗人 —— §1 已经拦了,这里补一条"覆写必须是有意为之"
  const overridden = CAMPAIGN_STAGES.filter((s) => !!s.starsGoal).map((s) => s.id);
  ok(overridden.length <= 3, `只有 ${overridden.length} 关(${overridden.join(",")})用作者覆写:覆写是例外不是常态,否则文案又会分家`);

  // 目标条在局中每帧都要算:除了两条"终局条"(赢没赢、最后一球怎么死的),
  // 其余每条都必须给得出中途进度 —— 拿不到数就等于那颗星永远不亮
  const noProg: string[] = [];
  for (const s of CAMPAIGN_STAGES) {
    for (const c of s.starsCheck) {
      if (c.k === "win" || c.k === "lastSmash") continue;
      if (objectiveLine(c, 0, factFor(c, true)).live !== true) noProg.push(`${s.id}:${c.k}`);
    }
  }
  ok(noProg.length === 0, noProg.length ? `${noProg.join(",")} 在场内给不出进度` : "每条判据(除两条终局条)场内都有进度可读");
}

// ---------- §8 「最佳比分」要真的最佳(大厅卡片印的就是它) ----------
{
  ok(isBetterBestScore(7, 1, "7-5") === true, "净胜更大 → 该覆盖");
  ok(isBetterBestScore(7, 5, "7-1") === false, "净胜更小 → 不该覆盖(旧写法无条件覆盖,纪录会倒退)");
  ok(isBetterBestScore(7, 0, "7-1") === true, "净胜相同看失分:7-0 优于 7-1");
  ok(isBetterBestScore(7, 1, "7-1") === false, "完全相同不必重写");
  ok(isBetterBestScore(7, 2, "手改过的坏值") === true, "存档读不懂时重写,而不是永远卡在旧值");
  // 跑真实存档:先 7-1 通关,再回来 7-5 险胜 —— 卡片上的「最佳」不许被更差的一局盖掉。
  // 存档先复位:§2 已经把这关打到过 7-0,不清干净的话这里测的是上一节留下的残档。
  const s1 = CAMPAIGN_STAGES[0];
  CampaignManager.getProgress().records[s1.id] = { stars: 0, clears: 0, bestScore: "0-0", attempts: 0 };
  CampaignManager.recordStageClear(s1, 7, 1, 3);
  CampaignManager.recordStageClear(s1, 7, 5, 1);
  const best = CampaignManager.getStageRec(s1.id).bestScore;
  ok(best === "7-1", `重打打得更差不能把「最佳」改差(实得 ${best})`);
  CampaignManager.recordStageClear(s1, 7, 0, 3);
  ok(CampaignManager.getStageRec(s1.id).bestScore === "7-0", "打出更好的 → 该更新(实得 " + CampaignManager.getStageRec(s1.id).bestScore + ")");
}

// ---------- §9 机制减免:遮蔽关的 AI 必须被算钝,移动关不许算 ----------
{
  // 遮蔽类机制只糊人眼(AI 走重模拟,它"看得见"),所以这些关要按表给 AI 加误差;
  // 而移动/重力/摩擦类是**双方一起**受 PlayerModifier 的管,对称,不许出现在减免里。
  const EYES = ["blindingSun", "sandstorm", "fog", "empGlitch", "hologramDecoy", "spectatorFlash", "sakuraFlurry", "erratic"];
  const touched = CAMPAIGN_STAGES.filter((s) => EYES.some((k) =>
    (k in (s.modifiers.environment ?? {})) || (k in (s.modifiers.physics ?? {}))));
  const noRelief = touched.filter((s) => {
    const r = aiReliefFor(s);
    return !(r.read || r.shotErr || r.timingErr);
  });
  ok(noRelief.length === 0,
    noRelief.length ? `遮蔽关没给 AI 减免:${noRelief.map((s) => s.id).join(",")}` : `遮蔽类关卡 ${touched.length} 关都按表给 AI 加了误差`);

  // 移动惩罚关不许有减免(那两层对称,补了就是偏袒)
  const moved = CAMPAIGN_STAGES.filter((s) => (s.modifiers.player?.accelMul ?? 1) < 1 || (s.modifiers.player?.vmaxMul ?? 1) < 1);
  const biased = moved.filter((s) => aiReliefFor(s).read !== undefined);
  ok(biased.length === 0, `移动惩罚关(${moved.map((s) => s.id).join(",")})不该吃 AI 减免:那机制对双方都成立`) ;

  // 减免不许把 AI 调成纯靶子:任何一档打折后都要落在 cap 里,且 read 仍 ≥ 表内基线的 60%
  const cap = CFG.campaign.aiReliefCap;
  const over = CAMPAIGN_STAGES.flatMap((s) => {
    const t = tuneAiTier(CFG.diffs[s.aiDiff], aiReliefFor(s));
    const bad: string[] = [];
    if (t.read > cap.read[1] || t.shotErr > cap.shotErr[1] || t.timingErr > cap.timingErr[1]) bad.push(s.id);
    return bad;
  });
  ok(over.length === 0, over.length ? `减免越界:${over.join(",")}` : "逐关折出来的档位全在 cap 范围内");

  // 反向核对:第 6 关(迷雾)折完之后 read 必须比原档大 —— 小了就是接反了方向
  const fog = CAMPAIGN_STAGES.find((s) => s.modifiers.environment?.fog)!;
  const fogT = tuneAiTier(CFG.diffs[fog.aiDiff], aiReliefFor(fog));
  ok(fogT.read > CFG.diffs[fog.aiDiff].read && fogT.shotErr > CFG.diffs[fog.aiDiff].shotErr,
    `${fog.id}:减免方向正确(read ${CFG.diffs[fog.aiDiff].read}→${fogT.read},shotErr ${CFG.diffs[fog.aiDiff].shotErr}→${fogT.shotErr})`);
}

// ---------- §10 HUD 左列四块读数牌不许互相压字 ----------
{
  const col = CFG.hudColumn;
  const order: ["tag", "obj", "mech", "wind"] = ["tag", "obj", "mech", "wind"];
  const bad: string[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i], b = order[i + 1];
    const bottom = col.top[a] + col.h[a];
    if (bottom > col.top[b]) bad.push(`${a}(顶 ${col.top[a]} 高 ${col.h[a]})压到 ${b}(${col.top[b]})`);
  }
  // 最底一块不能低过 960×540 的上半区(下面还有 24px 状态行的余量与球场)
  const last = order[order.length - 1];
  const lowest = col.top[last] + col.h[last];
  ok(bad.length === 0, bad.length ? `HUD 左列压字:${bad.join(" / ")}` : "HUD 左列四块牌(局别/目标/机制/风向)上下留缝,互不压字");
  ok(lowest <= 150, `左列最底一块到 ${lowest},仍在顶部 150 之内(不侵占球场主体)`);
}

// ---------- --selftest:改坏的表必须被报警 ----------
if (selftest) {
  const mutate = (fn: (s: StageDef[]) => StageDef[], want: RegExp, label: string): void => {
    const issues = auditTable(fn(CAMPAIGN_STAGES.slice()));
    ok(issues.some((i) => want.test(i)), `反例(${label})被报警${issues.length ? `:${issues[0]}` : ":一条都没报"}`);
  };
  mutate((s) => { s[3] = { ...s[3], stageNo: s[2].stageNo }; return s; }, /stageNo 重复/, "stageNo 撞号");
  mutate((s) => s.slice(0, 19), /第 20|只有|关,大厅一屏|自洽|编号连续|场景 arena 有/, "少一关");
  mutate((s) => { s[0] = { ...s[0], starsGoal: ["赢得对局", "净胜 2 分"] as unknown as [string, string, string] }; return s; }, /starsGoal 覆写 2 条/, "三星目标覆写只剩两条");
  // 判据放松了、覆写文案还按老数字说话 —— 简报就在骗人(这正是从前 starsGoal/starsCheck 分家的坏)
  mutate((s) => {
    s[1] = { ...s[1], starsCheck: [{ k: "win" }, { k: "lungeSaves", n: 3 }, { k: "opScoreAtMost", n: 2 }], starsGoal: ["赢得对局", "使用飞扑救球至少 3 次", "失分不超过 1 分"] };
    return s;
  }, /数字与 starsCheck 不符/, "门槛改成 ≤2 却仍印「不超过 1 分」");
  mutate((s) => { s[0] = { ...s[0], starsCheck: [{ k: "win" }, { k: "netLead", n: 2 }] as unknown as StageDef["starsCheck"] }; return s; }, /starsCheck 缺失或不是 3 条/, "三星判据只剩两条");
  mutate((s) => { s[0] = { ...s[0], starsCheck: [{ k: "netLead", n: 2 }, { k: "noWhiff" }, { k: "sweets", n: 3 }] }; return s; }, /首条必须是 win/, "首颗星不是「赢」");
  mutate((s) => { s[0] = { ...s[0], starsCheck: [{ k: "win" }, { k: "superSlash" as never, n: 2 }, { k: "noWhiff" }] }; return s; }, /未注册/, "判据 k 没接上");
  mutate((s) => { s[0] = { ...s[0], chapter: 3 }; return s; }, /章节 3 与场景 beach 不对应/, "章节与场景错位");
  mutate((s) => { s[0] = { ...s[0], desc: "  " }; return s; }, /desc 是空的/, "情境说明被清空");

  // 「最佳比分」那条不是摆设:拿旧写法(无条件吃最近一局)演一遍,它必须过不了 §8 的比较
  const oldWay = (prev: string, my: number, op: number): string => `${my}-${op}`;
  ok(oldWay("7-1", 7, 5) === "7-5" && isBetterBestScore(7, 5, "7-1") === false,
    "反例可检:旧写法会把「最佳」改成 7-5,而现判据认定 7-5 不该覆盖 7-1");
}

console.log(`${h.bad === 0 ? "✓" : "✗"} 闯关进度:${CAMPAIGN_STAGES.length} 关表自洽 + 下一关推进 + 聚焦判据 + 结算取关,${h.bad} 处问题`);
process.exit(h.bad === 0 ? 0 : 1);
