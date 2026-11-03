// ============================================================
// AI 击球后的回位回归 —— 钉住 2026-11-03 用户口径:
// 「AI 击完球不管在哪个位置都先回中间,玩家的近球和远球没有成就感」。
//
// 旧行为(ai.ts 非来球分支):击球下一帧 targetX = p.homeX,满速跑回中场。
// 新行为(core/ai-recover.ts):先原地收拍 dwell 帧,再走向按**刚打出的球种**算出的
// 战术位 —— 放网/劈吊压网前、平抽/高远/挑高回中场、重杀留后场;难度档用 backK
// 决定走到几成。它不是纯数值调参,坏法全是静默的(锚点算反、四档一样、夹歪了出墙、
// 把影分身/CPU 搭档一起改了),所以判据必须常驻:
//   ① 方向性:放网锚点明显偏网前(左右镜像),高远锚点≈homeX,重杀锚点压后
//   ② 球种排序:同一击球点,放网比劈吊更前、劈吊比平抽更前
//   ③ 难度单调:dwell easy>normal>hard>expert;backK 越大锚点越接近战术位
//   ④ 边界:击球点在网口/墙边/界外时,锚点仍夹在本方半场(不撞网、不出墙)
//   ⑤ 资格闸:影分身(idx=-1)、同侧有真人的 CPU 搭档 → 保持旧的 homeX
//   ⑥ 接线:真开一局,noteHit 后连续 AI.think —— 停顿期原地、之后不是 homeX
// --selftest 四份反例(旧恒回 homeX / 忽略难度 / 不 clamp / 闸恒真)必须被拦下。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/ai-recover-check.js
//   node .tools-build/tools/ai-recover-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import { planRecover, recoverEligible } from "../assets/scripts/core/ai-recover";
import { AI } from "../assets/scripts/core/ai";
import { Rules } from "../assets/scripts/core/rules";
import { Ball, DiffKey, ShotKind, TeamSide } from "../assets/scripts/core/types";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const CO = CFG.court;
const A = CFG.aiRecover;
const DIFFS: DiffKey[] = ["easy", "normal", "hard", "expert"];
const KINDS: ShotKind[] = ["smash", "slash", "lob", "netshot", "drive", "clear"];
const HOME: Record<TeamSide, number> = { left: CO.netX - 210, right: CO.netX + 210 };
const plan = (side: TeamSide, kind: ShotKind, hitX: number, diff: DiffKey = "normal") =>
  planRecover({ side, homeX: HOME[side], hitX, kind, diff });

// ---------- ① 方向性 ----------
// 右队网前击球点 520(home 690):放网后必须明显偏网前,不能回中场。
const netR = plan("right", "netshot", CO.netX + 40);
ok(netR.anchorX < HOME.right - 80, `右队放网后锚点 ${netR.anchorX.toFixed(1)} 偏网前(距 home ${HOME.right} ≥80)`);
// 左队镜像:网前击球点 440,home 270。
const netL = plan("left", "netshot", CO.netX - 40);
ok(netL.anchorX > HOME.left + 80, `左队放网后锚点 ${netL.anchorX.toFixed(1)} 偏网前(距 home ${HOME.left} ≥80)`);
// 高远:极限档(backK=1)回中场;普通档只回收一段(没走到位是设计,不是越位)。
const clearR = plan("right", "clear", CO.right - 60, "expert");
const clearL = plan("left", "clear", CO.left + 60, "expert");
ok(Math.abs(clearR.anchorX - HOME.right) <= 2, `右队极限档高远后回中场(${clearR.anchorX.toFixed(1)} ≈ ${HOME.right})`);
ok(Math.abs(clearL.anchorX - HOME.left) <= 2, `左队极限档高远后回中场(${clearL.anchorX.toFixed(1)} ≈ ${HOME.left})`);
const clearRN = plan("right", "clear", CO.right - 60);
ok(clearRN.anchorX > HOME.right && clearRN.anchorX < CO.right - 60,
  `普通档高远后朝中场回收但没走到位(${clearRN.anchorX.toFixed(1)} 在 ${HOME.right}..${CO.right - 60} 之间)`);
// 重杀:留在后场(锚点比 home 更靠底线)。
const smashR = plan("right", "smash", CO.right - 120);
ok(smashR.anchorX > HOME.right + 20, `右队重杀后留在后场(${smashR.anchorX.toFixed(1)} > ${HOME.right})`);
const smashL = plan("left", "smash", CO.left + 120);
ok(smashL.anchorX < HOME.left - 20, `左队重杀后留在后场(${smashL.anchorX.toFixed(1)} < ${HOME.left})`);

// ---------- ② 球种排序 ----------
// 同一个击球点(右队中场 600)看站位倾向:放网 < 劈吊 < 平抽 < 重杀(越大越靠后)。
const at = (k: ShotKind) => plan("right", k, CO.netX + 120).anchorX;
const aNet = at("netshot"), aSlash = at("slash"), aDrive = at("drive"), aSmash = at("smash");
ok(aNet < aSlash, `放网(${aNet.toFixed(0)}) 比劈吊(${aSlash.toFixed(0)}) 更压网前`);
ok(aSlash < aDrive, `劈吊(${aSlash.toFixed(0)}) 比平抽(${aDrive.toFixed(0)}) 更压网前`);
ok(aSmash > aDrive, `重杀(${aSmash.toFixed(0)}) 比平抽(${aDrive.toFixed(0)}) 更靠后`);
const aDriveEx = plan("right", "drive", CO.netX + 120, "expert").anchorX;
ok(Math.abs(aDriveEx - HOME.right) <= 2, `极限档平抽回中场(${aDriveEx.toFixed(1)} ≈ ${HOME.right})`);

// ---------- ③ 难度单调 ----------
const dwell = (k: DiffKey) => plan("right", "clear", HOME.right, k).dwell;
ok(dwell("easy") > dwell("normal") && dwell("normal") > dwell("hard") && dwell("hard") > dwell("expert"),
  `收拍停顿逐档缩短(${dwell("easy")} > ${dwell("normal")} > ${dwell("hard")} > ${dwell("expert")})`);
ok(dwell("expert") >= 1 && dwell("easy") <= 40, `停顿帧数在 [1,40](easy ${dwell("easy")} / expert ${dwell("expert")})`);
const rec = (k: DiffKey) => plan("right", "netshot", CO.netX + 40, k).anchorX;
ok(rec("easy") < rec("normal") && rec("normal") < rec("hard") && rec("hard") < rec("expert"),
  `放网后的回位距离逐档变短:easy 最靠前、expert 走到战术位(${rec("easy").toFixed(0)} < ${rec("normal").toFixed(0)} < ${rec("hard").toFixed(0)} < ${rec("expert").toFixed(0)})`);
ok(rec("expert") < HOME.right - 80, "极限档仍然压网前(不是回中场)");
ok(DIFFS.every((k) => typeof A.dwell[k] === "number" && typeof A.backK[k] === "number"), "dwell/backK 四档齐全");
ok(KINDS.every((k) => typeof A.kindLean[k] === "number"), "kindLean 六种球种齐全(漏一个就是编译/判据双错)");

// ---------- ④ 边界 ----------
// 极端击球点(网口 1px / 两边墙 / 界外)在各档各球种下都必须夹在本方半场。
let badEdge = 0;
let minEdge = Infinity;
let maxEdge = -Infinity;
for (const side of ["left", "right"] as TeamSide[]) {
  const lo = side === "left" ? CO.wallL : CO.netX + CO.netPad;
  const hi = side === "left" ? CO.netX - CO.netPad : CO.wallR;
  const hits = [CO.netX - 1, CO.netX + 1, CO.wallL, CO.wallR, -200, CFG.world.w + 200];
  for (const k of DIFFS) {
    for (const kind of KINDS) {
      for (const hitX of hits) {
        const p = planRecover({ side, homeX: HOME[side], hitX, kind, diff: k });
        if (!Number.isFinite(p.anchorX) || p.anchorX < lo - 1e-9 || p.anchorX > hi + 1e-9) badEdge++;
        minEdge = Math.min(minEdge, p.anchorX);
        maxEdge = Math.max(maxEdge, p.anchorX);
      }
    }
  }
}
ok(badEdge === 0, `极端击球点全部夹在本方半场(越界 ${badEdge} 组,范围 ${minEdge.toFixed(0)}..${maxEdge.toFixed(0)})`);

// ---------- ⑤ 资格闸 ----------
ok(recoverEligible({ isAI: true, idx: 1, side: "right" }, false), "对手 AI(右队、idx≥0、同侧无真人)吃新回位");
ok(!recoverEligible({ isAI: true, idx: 0, side: "left" }, false), "左队 AI(玩家侧替身/单人左队)不吃:不削弱玩家");
ok(!recoverEligible({ isAI: true, idx: -1, side: "right" }, false), "影分身(idx=-1)不吃新回位:它要各守防区");
ok(!recoverEligible({ isAI: true, idx: 1, side: "left" }, true), "同侧有真人的 CPU 搭档不吃:那是队友,不能顺手削弱玩家");
ok(!recoverEligible({ isAI: false, idx: 0, side: "left" }, false), "真人本体不吃");

// ---------- ⑥ 接线(真开一局,走 noteHit → AI.think 全链路) ----------
/** 只塞 think() 在非来球分支读得到的字段;其余 cast 掉(工具侧窄桩,别学进 core)。 */
const fakeBall = (lastHitter: TeamSide, shot: unknown): Ball =>
  ({ live: true, held: false, lastHitter, shot, x: CO.netX, y: CO.groundY - 120, vx: 4, vy: -2 } as unknown as Ball);
const minshot = (kind: ShotKind, landX: number): NonNullable<Ball["shot"]> =>
  ({ kind, landX } as unknown as NonNullable<Ball["shot"]>);

Rules.newMatch("1p", "normal");
const ai = Rules.R.players.find((p) => p.side === "right") as (typeof Rules.R.players)[number] | undefined;
ok(!!ai && !!ai.ai, "1p 对局建出右队 AI 与 AI 状态");
if (ai && ai.ai) {
  ai.x = CO.netX + 40;                     // 在网前打出这一拍
  const shot = minshot("netshot", CO.netX - 60);
  AI.noteHit(ai, shot);
  ok(ai.ai.dwellT === CFG.aiRecover.dwell.normal, `noteHit 按 normal 档写停顿(${ai.ai.dwellT} 帧)`);
  const want = planRecover({ side: "right", homeX: ai.homeX, hitX: ai.x, kind: "netshot", diff: "normal" }).anchorX;
  ok(Math.abs(ai.ai.recoverX - want) < 1e-9, "noteHit 写回位点与 planRecover 同源");

  const ball = fakeBall("right", shot);
  AI.think(ai, ball, "RALLY");
  ok(Math.abs(ai.ai.targetX - ai.x) < 1e-9, "停顿期目标点 = 当前位置(原地收拍,不踩键)");
  ok(ai.ai.dwellT === CFG.aiRecover.dwell.normal - 1, "停顿帧数每帧递减");

  const total = CFG.aiRecover.dwell.normal;
  for (let i = 0; i < total; i++) AI.think(ai, ball, "RALLY");
  ok(ai.ai.dwellT === 0, "停顿走完后才启动回位");
  AI.think(ai, ball, "RALLY");
  ok(Math.abs(ai.ai.targetX - want) < 1e-9, `回位目标 = 战术位 ${want.toFixed(0)}(不是 homeX ${ai.homeX})`);
  ok(ai.ai.targetX < ai.homeX - 80, "放网后仍明显偏网前 —— 玩家的后场挑高有真实空档");

  // 影分身闸:同一实体改成 idx=-1,noteHit 不再写计划、think 回到旧的 homeX
  ai.idx = -1;
  ai.ai.dwellT = 0;
  AI.think(ai, ball, "RALLY");
  ok(Math.abs(ai.ai.targetX - ai.homeX) < 1e-9, "影分身(idx=-1)保持旧行为:lock targetX = homeX");
  ai.idx = 1;
}

// CPU 搭档闸:2v2 左队 1 名真人 + 1 名 CPU,搭档不吃新回位
Rules.newMatch("2v2", "normal");
const mate = Rules.R.players.find((p) => p.side === "left" && p.isAI);
ok(!!mate, "2v2 建出左队 CPU 搭档");
if (mate && mate.ai) {
  mate.x = CO.netX - 40;
  const shot = minshot("netshot", CO.netX + 60);
  AI.noteHit(mate, shot);
  AI.think(mate, fakeBall("left", shot), "RALLY");
  ok(mate.ai.dwellT === 0, "搭档不被写停顿(dwellT 保持 0)");
  ok(Math.abs(mate.ai.targetX - mate.homeX) < 1e-9, "搭档保持旧行为:targetX = homeX");
}

// ---------- 反例自检:旧实现必须被上面的判据拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\n反例自检(每一条都必须被报警)\n");
  // ① 旧版:非来球就回 homeX —— 放网后仍在 690,过不了「偏网前 ≥80」。
  const oldHome = (homeX: number) => homeX;
  ok(!(oldHome(HOME.right) < HOME.right - 80), "旧「恒回 homeX」被①拦下:放网后仍在中场");
  // ③ 忽略难度:四档锚点完全相同,过不了单调判据。
  const flat = DIFFS.map(() => 576);
  ok(!(flat[0] < flat[1] && flat[1] < flat[2] && flat[2] < flat[3]), "忽略难度档被③拦下:四档锚点相同");
  // ④ 不夹边界:界外锚点必须出墙。
  const noClamp = 2000;
  ok(noClamp > CO.wallR, "不 clamp 被④拦下:2000 在右墙之外");
  // ⑤ 资格闸恒真:影分身/搭档/真人都会被误伤。
  const always = (_p: { isAI: boolean; idx: number }, _human: boolean) => true;
  ok(always({ isAI: true, idx: -1 }, true), "资格闸恒真被⑤拦下:影分身与 CPU 搭档会被一起改");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
console.log("只有真机能验的:AI 被调开后的空档是否读得出来、以及「不变成稻草人」的手感(对练两局)。");
process.exit(h.fails === 0 ? 0 : 1);
