// ============================================================
// 终局庆祝段的时钟档位 (celebration)
//
// 为什么要有这个模块:主循环从前对 CFG.frozen 里的六个状态一视同仁 ——
// 「不推进世界 + 每 4 真实帧才重画一次(≈15fps)」。这条省电逻辑对 MENU /
// CAREER / DRILLS 完全成立(面板糊满整屏,球场根本没人看),但**终局两态是反例**:
// 结算卡只有 560×490,屏幕左右两条边仍把球场露在人眼前,而这一刻恰恰是全场
// 最该动的地方 —— 礼花要落、最后一拍的火花要散尽、胜利那行字要淡出。
// 旧写法的后果(用户 2026-10-04 现场:「胜利时的这个礼花效果会有点卡顿」):
// fx.step() 只被 world.stepFx 调用,于是 60 片纸屑出生后一帧都没走过,钉在半空
// 直到结算卡关掉;顺带 hitstop 的 stopFrames 在 frozen 态也永不递减。
//
// 所以把"这一帧走什么时钟"做成一张纯函数真值表,主循环只照它执行:
//   sim        —— 世界真在打:模拟步 + 表现层,渲染按 hitstop 节奏降频
//   celebrate  —— 世界停、表现层不停:只走 stepFx,渲染满帧
//   still      —— 面板态:全冻,渲染每 4 帧一次(省电)
// 判据与 config 同源(CFG.frozen / CFG.fx.confetti.states),节点可跑:
// 验收 tools/confetti-check.ts(含 --selftest 喂旧那份"六个态一视同仁"的档位表)。
// ============================================================
import { CFG } from "./config";

export type ClockMode = "sim" | "celebrate" | "still";

/** frozen 表(CFG.frozen)与庆祝态表(CFG.fx.confetti.states)的读法,零 cc */
function inList(list: string[], state: string): boolean {
  return list.indexOf(state) >= 0;
}

/**
 * 这一帧该走哪档时钟。
 * @param state 比赛状态(Rules.R.state)
 * @param busy 表现层还有没有东西要放(world.presentationBusy():粒子池 / 飘字 / 残影)
 *
 * celebrate 只在「终局态 且 还有东西在放」时开 —— busy 恒会随有限寿命归零,
 * 所以这一档**自己收得回去**,渲染降频必然还给省电逻辑,不需要额外计时器。
 */
export function clockOf(state: string, busy: boolean): ClockMode {
  const frozen = CFG.frozen as string[];
  if (!inList(frozen, state)) return "sim";
  if (busy && inList(CFG.fx.confetti.states as string[], state)) return "celebrate";
  return "still";
}

/**
 * 这一渲染帧画不画。
 * @param clock 本帧档位(clockOf 的结果)
 * @param stopFrames hitstop 剩余帧
 * @param frameT 真实帧计数(GameRoot.frameT,不是模拟帧)
 *
 * 三条节奏各有理由:sim 定格期每 2 帧(画面逐像素相同)、celebrate 满帧
 * (礼花上升段最快 ~13px/帧,15fps 会抽成跳格)、still 每 4 帧(没人看球场)。
 */
export function renderDue(clock: ClockMode, stopFrames: number, frameT: number): boolean {
  if (clock === "celebrate") return true;
  if (clock === "sim") return stopFrames <= 0 || frameT % 2 === 0;
  return frameT % 4 === 0;
}
