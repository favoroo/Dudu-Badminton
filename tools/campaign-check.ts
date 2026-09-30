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
//
// --selftest 拿四份改坏的关卡表喂 §1,确认这套判据真的会报警
// (规则脚本最怕的是悄悄全绿)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/campaign-check.js            # exit 0 = 通过
//   node .tools-build/tools/campaign-check.js -v         # 打印每关判定
//   node .tools-build/tools/campaign-check.js --selftest
// ============================================================
import { CAMPAIGN_STAGES, CampaignManager, type CourtTheme, type StageDef } from "../assets/scripts/core/campaign";

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const selftest = process.argv.includes("--selftest");

const COURTS: CourtTheme[] = ["beach", "dojo", "cyber", "arena"];
const PER_COURT = 5;
let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (cond || verbose) console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

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
    if (s.starsGoal.length !== 3) out.push(`${s.id}: starsGoal ${s.starsGoal.length} 条,弹窗按三颗星标排`);
    if (s.starsGoal.some((g) => !g || !g.trim())) out.push(`${s.id}: starsGoal 里有空条目`);
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

// ---------- --selftest:改坏的表必须被报警 ----------
if (selftest) {
  const mutate = (fn: (s: StageDef[]) => StageDef[], want: RegExp, label: string): void => {
    const issues = auditTable(fn(CAMPAIGN_STAGES.slice()));
    ok(issues.some((i) => want.test(i)), `反例(${label})被报警${issues.length ? `:${issues[0]}` : ":一条都没报"}`);
  };
  mutate((s) => { s[3] = { ...s[3], stageNo: s[2].stageNo }; return s; }, /stageNo 重复/, "stageNo 撞号");
  mutate((s) => s.slice(0, 19), /第 20|只有|关,大厅一屏|自洽|编号连续|场景 arena 有/, "少一关");
  mutate((s) => { s[0] = { ...s[0], starsGoal: ["赢得对局", "净胜 2 分"] as unknown as [string, string, string] }; return s; }, /starsGoal 2 条/, "三星目标只剩两条");
  mutate((s) => { s[0] = { ...s[0], chapter: 3 }; return s; }, /章节 3 与场景 beach 不对应/, "章节与场景错位");
  mutate((s) => { s[0] = { ...s[0], desc: "  " }; return s; }, /desc 是空的/, "情境说明被清空");
}

console.log(`${bad === 0 ? "✓" : "✗"} 闯关进度:${CAMPAIGN_STAGES.length} 关表自洽 + 下一关推进 + 聚焦判据 + 结算取关,${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
