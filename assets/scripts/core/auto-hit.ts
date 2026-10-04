// ============================================================
// 自动击打(辅助模式)—— 系统替真人起手「每一拍」
// ------------------------------------------------------------
// 为什么要有它:手机上一记回球要在几十毫秒里同时做完「看时机 + 按击球键 + 滑方向」,
// 这是纯操作税。跨步/重击/怒气三条一键化已经证明系统可以替玩家挑准那一帧
// (Player.autoSwingDue,与时机环/键面辉光同一把尺子),本次把它做成全局开关:
// 开起来后人物的每一拍回球都由系统起手,玩家只管移动、瞄准与放技能。
//
// 三条与三条一键化**刻意不同**的地方(别顺手照抄):
//   ① **没有"窗"**:那三条由技能 activate 开一扇 autoWindow 帧的窗,过期不起手就交还手动;
//      这条逐帧轮询,所以 config 里**故意不给 autoWindow 这个键** —— 缺它就是"没有窗"的证据。
//      代价是必须另加限次:flightFramesToClosest 从第 0 帧起扫(physics.ts),球已在判定区心时
//      fc = 0 当即判"该按",不限次就是 smashAutoT 注释里警告的「人物自己乱挥半天」。
//      那三条靠"起手当场清窗"免费拿到限次,这条没有窗 ⇒ 用每球计数(见 autoTriesPerBall)。
//   ② **不借手长**:绝不写 p.lungeAutoT —— 那个字段同时是 strikeZone 判定区尾段倍率
//      (C.lunge.reachTailMul)的开关,写了就等于白送手长,把"够不着"这一类失误抹掉。
//      判据 tools/auto-hit-check.ts ③ 每帧钉住这一点。
//   ③ **不接管发球**:发球类型由"按下快慢"决定(偷后场 <22 帧 / 高远 >65 帧),那是玩家的手艺,
//      不给机器。结构上是**四重**不沾(逐条实测过,拆掉任一条都还拦得住):握在手里的球
//      `live=false`、`held=true`、beginPoint 期间还有 `flying` 那一段、以及 `lastHitter` 挂在
//      发球方身上(→ autoSwingDue 第二条直接拒);释放本身又只在 rules 的 `if (ball.held)` 里。
//      判据 auto-hit-check ② 逐条点名,--selftest 的反例要四道全拆才"接管"得动发球。
//
// 为什么单独一个模块,而不是 player.ts 直接读 Settings:与 core/gait.ts 同一条理由 ——
// settings.ts 刻意不 import 玩法模块(tools/settings-check.ts 要能独立造实例),而玩法侧要能被
// 回归工具一键开关且**不碰存档**。所以这里只存内存态,由 game-root 在启动与 Settings.onChange
// 里喂进来;模式门控由 rules 报(newMatch / startCampaign 是全仓唯一两处写 R.mode 的地方),
// 于是任何调 Rules.newMatch 的工具自动拿到正确门控。
//
// 默认关(模块初值与 Settings.autoHit 都是 false)⇒ serve-check / ai-check / sim-check 的
// 替人基线纹丝不动:那些替身从不打开这个开关,而关掉时 player.ts 的分支第一个合取项就短路,
// 连 autoSwingDue 都不会被调用(判据 ⑥ 用计数壳钉住"零调用零写入")。
// ============================================================
import { CFG } from "./config";

/** 用户在设置页拨的那个开关(内存态,写盘由 settings.ts 负责) */
let userFlag = false;
/** 当前这一场是不是"允许代打"的模式(由 rules 报进来) */
let modeOK = false;
/** 最后一次报进来的模式,只给判据/面板读数用,不参与判定 */
let lastMode = "";

/** 这个模式允不允许代打(训练场与新手教学判的就是"你会不会这一拍",被代打等于把判据糊过去) */
export function autoHitEligible(mode: string): boolean {
  return CFG.autoHit.modes.indexOf(mode) >= 0;
}

export const AutoHit = {
  /** 生效读数:config 总闸 && 用户开关 && 模式合格。player.ts 每步只读这一个数 */
  get on(): boolean { return CFG.autoHit.enabled && userFlag && modeOK; },
  /** 用户开关本身(与"开了但模式不合格"分开读,否则面板与判据分不清是谁拦的) */
  get flag(): boolean { return userFlag; },
  /** 模式门控读数 */
  get modeAllowed(): boolean { return modeOK },
  /** 当前模式名(读数) */
  get mode(): string { return lastMode; },
  /** 设置页 / 回归工具写开关 */
  request(flag: boolean): void { userFlag = !!flag; },
  /** 开场时报模式:newMatch / startCampaign 各调一次,门控与模式同源 */
  onMatch(mode: string): void { lastMode = mode; modeOK = autoHitEligible(mode); },
  eligible: autoHitEligible,
  /** 回到"没开"的初值(回归工具跑完一轮要还原,别把状态带给下一段判据) */
  reset(): void { userFlag = false; modeOK = false; lastMode = ""; },
};
