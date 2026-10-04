// ============================================================
// 结算谢幕演出回归 —— 钉住「不崩、不报错、只会安静地不好看/胜负没分化」的坏:
//
// 用户现场:「比分到了之后就直接弹窗结算了,可以多加一点效果(失败和胜利的不一样)」。
// 入场演出全靠 tween 摆出来,任何一步接错都是静默的:斜带忘了挂、胜负两条路径
// 抄成了同一条、节拍叠罗汉把卡片拖到三秒后才来 —— tsc 不报、运行时不炸、玩家只
// 觉得「跟从前没区别」。所以把时间轴从 CFG.fx.settleCine 烘成纯函数
// (ui/settle-cine.ts 的 buildCine),这份工具断言三件事:
//   ① 胜负真的分化:斜带/星芒/轻震仅胜利,冷 veil 仅失败,标语 slam≠descend,
//     卡片 pop≠sink,失败暗幕必须压得更慢;
//   ② 时间不打架:暗幕升完卡片才来、标语落定不晚于卡片、总时长不超防拖沓红线
//     (内容逐行浮现的行数 settle-panel.rowNodes=10 是跨模块契约,钉在这里);
//   ③ 训练模式不出仪式:重开频繁,dim 一步到位、卡片 0.28s 弹入(旧行为)。
//
// --selftest 喂三份反例,必须各自被点名:旧单一快路径(无斜带/无veil/无星芒/
// 零留白)/ 拖沓档(beatLose 3s)/ 阶梯过大(rowStagger 0.5)。
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/settle-cine-check.js
//   node .tools-build/tools/settle-cine-check.js --selftest
// ============================================================
import * as fs from "fs";
import { CFG } from "../assets/scripts/core/config";
import { buildCine, type CinePlan } from "../assets/scripts/ui/settle-cine";

let fails = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} ${name} —— ${detail}`);
  if (!ok) fails++;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** 卡片内容行数 = settle-panel startRows 的 rowNodes 长度(跨模块契约,钉在判据里) */
const ROWS = 10;
/** 单行浮现用时:riseIn 的 dur / 失败淡入时长,与 settle-panel 的调用一致 */
const RISE = 0.5;
/** 从 show() 到全部内容落定的防拖沓红线(秒)。留白+入场+逐行,再长玩家就烦了 */
const TOTAL_CAP = 2.6;

/** 单条计划的时间自洽;返回不合格项(空数组 = 全过) */
function judgePlan(p: CinePlan, tag: string): string[] {
  const bad: string[] = [];
  if (p.dim.delay < 0 || p.dim.dur < 0) bad.push(`${tag} 暗幕时间为负`);
  if (p.dim.delay + p.dim.dur > p.card.at + 0.02) {
    bad.push(`${tag} 暗幕还没升完卡片就来了(${(p.dim.delay + p.dim.dur).toFixed(2)}s > ${p.card.at}s)`);
  }
  if (p.verdict.at > p.card.at + 0.02) bad.push(`${tag} 标语比卡片还晚入场(大字会砸在空卡片位上)`);
  if (p.verdict.at + p.verdict.dur < p.card.at - 0.02) bad.push(`${tag} 标语早于卡片就落定了`);
  if (p.rows < 0 || p.rows > 0.12) bad.push(`${tag} 行阶梯越界(${p.rows}s,0.12s 以上逐行就变成逐个报幕)`);
  const total = p.card.at + p.card.dur + p.rows * ROWS + RISE;
  if (total > TOTAL_CAP) bad.push(`${tag} 总时长 ${total.toFixed(2)}s 超红线 ${TOTAL_CAP}s(拖沓)`);
  return bad;
}

/** 胜负两条计划必须分化;返回不合格项 */
function judgeDivergence(win: CinePlan, lose: CinePlan): string[] {
  const bad: string[] = [];
  if (!win.bands || win.bands.colors.length < 3) bad.push("胜利没有扫场斜带");
  if (win.bands && !(win.bands.alpha > 0 && win.bands.alpha < 0.8)) bad.push("胜利斜带 alpha 越界(0=没画,≥0.8=糊场)");
  if (lose.bands) bad.push("失败不该有斜带(冷幕缓沉才是败局语汇)");
  if (!win.burst || win.burst.r <= 0) bad.push("胜利没有标语星芒爆");
  if (lose.burst) bad.push("失败不该有星芒爆");
  if (!lose.veil || lose.veil.edgeA <= lose.veil.centerA) bad.push("失败没有冷 veil(或 center/edge 倒挂)");
  if (win.veil) bad.push("胜利不该有冷 veil");
  if (win.verdict.mode !== "slam" || lose.verdict.mode !== "descend") bad.push("标语演出没分化(胜=slam / 败=descend)");
  if (win.card.mode !== "pop" || lose.card.mode !== "sink") bad.push("卡片入场没分化(胜=pop / 败=sink)");
  if (!(win.card.shakeAmp > 0) || lose.card.shakeAmp !== 0) bad.push("轻震没分化(仅胜利砸落时震)");
  if (!(lose.dim.dur > win.dim.dur)) bad.push("失败暗幕应压得更慢(落差感)");
  return bad;
}

const S = CFG.fx.settleCine;
const WIN = buildCine(true, true);
const LOSE = buildCine(false, true);
const DRILL = buildCine(true, false);

// ============================================================
// ① 胜负分化
// ============================================================
{
  const bad = judgeDivergence(WIN, LOSE);
  check("① 胜负两条入场路径真的分化", bad.length === 0,
    bad.length ? bad.join(" / ") : `胜=${WIN.card.mode}+${WIN.verdict.mode}+斜带,败=${LOSE.card.mode}+${LOSE.verdict.mode}+冷幕`);
}

// ============================================================
// ② 时间轴自洽(两条各查一遍)
// ============================================================
{
  const bad = [...judgePlan(WIN, "胜利"), ...judgePlan(LOSE, "失败")];
  check("② 时间不打架、总时长不超红线", bad.length === 0,
    bad.length ? bad.join(" / ")
      : `胜利卡片 ${WIN.card.at}s / 失败卡片 ${LOSE.card.at}s,行阶梯 ${WIN.rows}s × ${ROWS} 行`);
}

// ============================================================
// ③ config 数值口径(色值/留白节拍上限)
// ============================================================
{
  const colors = S.bandsColors as string[];
  const hexBad = colors.filter((c) => !HEX.test(c));
  check("③ 扫场斜带三色齐且都是合法 hex", colors.length >= 3 && hexBad.length === 0,
    colors.join(" "));
  check("③ 留白节拍上限(胜利 1.2s / 失败 1.4s 之内)", S.beatWin < 1.2 && S.beatLose < 1.4,
    `beatWin=${S.beatWin} beatLose=${S.beatLose}`);
  check("③ 星芒爆不糊场", S.burstR > 0 && S.burstR <= 200 && S.burstPoints >= 8 && S.burstPoints <= 16,
    `r=${S.burstR} points=${S.burstPoints}`);
  check("③ 失败冷 veil 比基础暗幕更收敛(edge 更深)", S.loseVeilEdge > S.loseVeilCenter,
    `center=${S.loseVeilCenter} edge=${S.loseVeilEdge}`);
}

// ============================================================
// ④ 训练模式不出仪式(重开频繁,保持旧快速入场)
// ============================================================
{
  check("④ 训练结算保持旧快速入场", !DRILL.cinematic && DRILL.card.at === 0 && DRILL.dim.dur === 0
    && DRILL.bands === null && DRILL.burst === null && DRILL.veil === null && DRILL.rows === 0,
    `cinematic=${DRILL.cinematic} card.at=${DRILL.card.at}`);
}

// ============================================================
// ⑤ 跨模块接线(settle-panel 真的在消费这份时间轴 + 跳过监听有卸)
// ============================================================
const PANEL_SRC = fs.readFileSync("assets/scripts/ui/settle-panel.ts", "utf8");
check("⑤ settle-panel 消费 buildCine(时间轴没有变成没人读的死配置)",
  PANEL_SRC.indexOf("buildCine(") >= 0 && PANEL_SRC.indexOf("./settle-cine") >= 0,
  "import + 调用都在");
check("⑤ 跳过监听有配对卸载(点按快进的 TOUCH_END 必须有 off)",
  PANEL_SRC.indexOf(".on(Node.EventType.TOUCH_END") >= 0 && PANEL_SRC.indexOf(".off(Node.EventType.TOUCH_END") >= 0,
  "on/off 成对(ui-hide-check 之外的双保险)");

// ============================================================
// selftest:三份反例必须各自被点名
// ============================================================
if (process.argv.indexOf("--selftest") >= 0) {
  const keep = JSON.parse(JSON.stringify(S)) as typeof S;

  // 反例 1:旧单一快路径 —— 胜负同拍、无斜带/无 veil/无星芒/零阶梯(改版前的行为)
  S.bandsColors = []; S.bandsAlpha = 0;
  S.beatWin = 0; S.beatLose = 0;
  S.dimDelayWin = 0; S.dimDurWin = 0; S.dimDelayLose = 0; S.dimDurLose = 0;
  S.loseVeilCenter = 0; S.loseVeilEdge = 0;
  S.rowStagger = 0; S.cardShakeAmp = 0; S.burstR = 0; S.burstPoints = 0;
  S.verdictDescend = 0; S.cardSinkDur = 0.28;
  const badOld = judgeDivergence(buildCine(true, true), buildCine(false, true));
  check("selftest-1 旧单一快路径被点名(胜负没分化)", badOld.length > 0,
    badOld[0] || "居然没拦住 —— 这把尺子没牙齿");

  // 反例 2:拖沓档 —— 失败卡片三秒后才来,庆祝段早就收场了卡片还在半路
  Object.assign(S, JSON.parse(JSON.stringify(keep)));
  S.beatLose = 3;
  S.bandsDur = 2;
  const badSlow = judgePlan(buildCine(false, true), "失败");
  check("selftest-2 拖沓档被点名(总时长超红线)", badSlow.length > 0,
    badSlow[0] || "居然没拦住 —— 这把尺子没牙齿");

  // 反例 3:阶梯过大 —— 逐行浮现变成逐个报幕
  Object.assign(S, JSON.parse(JSON.stringify(keep)));
  S.rowStagger = 0.5;
  const badRows = judgePlan(buildCine(true, true), "胜利");
  check("selftest-3 阶梯过大被点名", badRows.length > 0,
    badRows[0] || "居然没拦住 —— 这把尺子没牙齿");

  Object.assign(S, JSON.parse(JSON.stringify(keep)));
}

console.log(process.argv.indexOf("--selftest") >= 0
  ? (fails === 0 ? "settle-cine-check --selftest: 反例全部被拦住 ✓" : `settle-cine-check --selftest: ${fails} 处未拦住 ✗`)
  : (fails === 0 ? "settle-cine-check: 全部通过 ✓" : `settle-cine-check: ${fails} 项失败 ✗`));
process.exit(fails === 0 ? 0 : 1);
