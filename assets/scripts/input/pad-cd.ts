// ============================================================
// 技能键的「冷却读数」—— 纯函数 + 一份笔画,引擎与 node 共用。
//
// 为什么单独一个文件:用户报的现场是「透明度调低之后冷却都看不太清了」。
// 这不是错觉 —— 冷却的墨底、进度环、图标以前全都直接乘 Settings.padAlpha,
// 而滑杆最低能到 0.2:0.58 的墨底乘完剩 0.116,整颗键淡成一层雾,
// 玩家分辨不出「还在冷却」和「键坏了」。
//
// 判断:透明度滑杆调的是**按键本体有多碍眼**,不该把状态指示一起抹掉。
// 所以冷却这一层的浓度走 cdAlpha() —— 只跟随滑杆一部分(keep),给读数留下限;
// 就绪态(底色/描边/图标)仍完全跟随滑杆,玩家想要干净屏时还是干净的。
// 再把「还剩几秒」直接写在键心(cdText),这是手机游戏的通用读法,
// 也是唯一在最低透明度下仍然不会看错的信息。
//
// 为什么笔画也放这儿:paint() 所在的 touchpad.ts import cc,编译不进 tools/,
// 几何与浓度就断言不了(同 config.touchAim.commitPx 当年搬出来的理由)。
// 这里对 Graphics 只声明用到的那几个成员(结构上兼容 cc.Graphics,也兼容
// tools/cc-stub 的记录型 Graphics),颜色由调用方注入的工厂造 —— 于是
// 「真机画的」和「node 里出图/断言的」是同一份代码,不会各画各的。
//
// 分层:零 cc 依赖,只读 CFG.padSkin.cd 与 CFG.skills.list(铁律 3:数值只进 config)。
// 冷却的**来源**(s.cd / s.maxCd)在 core/skills.ts,这里只管怎么把它读出来。
// ============================================================
import { CFG } from "../core/config";
import { clamp } from "../core/utils";

/** 冷却视觉参数(config.ts padSkin.cd) */
export const CD = CFG.padSkin.cd;

/**
 * 本模块用到的 Graphics 子集。
 * 颜色写成 unknown:真正的 cc.Color 由 color 工厂造出来,这里不关心它的类型,
 * 只负责挂到笔上。这样同一份笔画既能喂 cc.Graphics,也能喂 node 侧的记录型替身。
 */
export interface CdPen {
  fillColor: unknown;
  strokeColor: unknown;
  lineWidth: number;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(cx: number, cy: number, r: number, a0: number, a1: number, counterclockwise?: boolean): void;
  close(): void;
  fill(): void;
  stroke(): void;
}

/** hex + alpha(0..1) → 颜色;touchpad 传 skinColor,预览工具传替身的 Color */
export type CdColor = (hex: string, a: number) => unknown;

/**
 * 扫掠基准 12 点方向。
 * UI 节点本地坐标 y 向上,而 cc 的 arc 落点是 (cx + r·cos a, cy + r·sin a),
 * 所以 **+π/2 才是正上方**,-π/2 是正下方(上一版写的是 -π/2,其实把起点钉在 6 点)。
 */
export const CD_TOP = Math.PI / 2;

/** 扫掠角度(弧度,一律「终点 < 起点」,理由见 cdArcs 的警告) */
export interface CdArcs {
  /** 墨底扇形:从 12 点顺时针扫到前沿,跨度 = 剩余冷却 */
  pie0: number; pie1: number;
  /** 就绪进度环:从前沿接着扫回 12 点,跨度 = 已经走完的冷却(冷却越久环越长) */
  ring0: number; ring1: number;
  /** 前沿亮点的终点(从 ring0 再往前 headSpan,不越过 12 点) */
  head1: number;
}

/**
 * 冷却层的有效透明度。
 * keep=0 时退化成原来的「完全跟随滑杆」;keep=1 时读数无视滑杆。
 * 0.82 的取法:滑杆最低 0.2 时读数仍有 0.856,而滑杆拉满时不会超过 1(不额外糊屏)。
 */
export function cdAlpha(padAlpha: number): number {
  const A = clamp(padAlpha, 0, 1);
  return clamp(A + (1 - A) * CD.keep, 0, 1);
}

/**
 * 冷却扇形与就绪进度环的起止角(cd = 剩余冷却 / 总冷却,0..1)。
 *
 * ⚠️ cc 的 Graphics.arc 在 counterclockwise=false 时会把 da 规范进 (-2π, 0]
 * (引擎源码 cocos/2d/assembler/graphics/helper.ts:`while (da > 0) da -= PI*2`)。
 * 换句话说**传 a1 > a0 画不出那一段,画的是它的补集** —— 100° 的弧会变成 260°,
 * 而「剩余冷却越多、墨底越大」这条直觉会整个反过来(旧代码就是这个坑:cd=0.75 时
 * 键上只有一角是暗的)。所以这里三个角全部排成递减序,da 天生为负,绕不出整圈。
 * tools/pad-cd-check.ts ③ 把这条钉住:任何一段跨度必须 = 名义值,不许是补集。
 */
export function cdArcs(cdRatio: number): CdArcs {
  const cd = clamp(cdRatio, 0, 1);
  const full = Math.PI * 2;
  const tip = CD_TOP - cd * full;            // 扇形前沿 = 进度环生长的指针
  const end = CD_TOP - full;                 // 绕一圈回到 12 点
  return {
    pie0: CD_TOP, pie1: tip,
    ring0: tip, ring1: end,
    head1: Math.max(tip - CD.headSpan, end),
  };
}

/** 进度环中心半径:整条环线落在键圆内侧,不啃描边 */
export function cdRingR(r: number): number {
  return r - CD.ringW / 2 - 0.5;
}

/**
 * 剩余秒数 → 键心文字。
 * 冷却中永不显示 "0.0":s.cd 到 0 的那帧键就亮了,但倒数最后几十毫秒里显示 0.0
 * 会被读成「已经就绪、我按了却没反应」—— 那是另一种「看不见冷却」。
 */
export function cdText(cdSec: number): string {
  if (!(cdSec > 0)) return "";
  return Math.max(CD.numMin, Math.ceil(cdSec * 10) / 10).toFixed(1);
}

/**
 * 冷却扫掠的重画门控。
 *
 * 基准必须是「上一次画上屏的值」:setSkillState 每帧都会被喂最新的 cdRatio,
 * 如果拿「上一帧喂值」当基准,stepTol 比较的就退化成相邻帧增量(= 1/maxCd)——
 * 四款长 CD(smash/flash/magnet/focus)每帧增量 0.003~0.005,全都低于阈值,
 * 扫掠中途就再也不重画:阴影起手画一次后整段冻结,只在玩家点按被拒的键
 * (upOf 无条件重画)时跳进一截 —— 现场就是「阴影只能 1/3 地消失,不连续」。
 * 这里把基准的推进收进 step()/sync() 两个口子,谁都不许在外面另抄一份。
 */
export interface CdGate {
  /** 当前基准 = 上一次画上屏的 cdRatio(只读暴露,回归工具拿它对账「屏上滞后」) */
  readonly painted: number;
  /** 距上次重画的累计变化超过 CD.stepTol 才允许重画;返回 true 时基准已同步到 ratio */
  step(ratio: number): boolean;
  /** 其他重画路径(down/upOf/apply 画过屏后)调用:把基准对齐到刚画上屏的值 */
  sync(ratio: number): void;
}

export function makeCdGate(): CdGate {
  let painted = 0;
  return {
    get painted(): number { return painted; },
    step(ratio: number): boolean {
      if (Math.abs(painted - ratio) > CD.stepTol) {
        painted = ratio;
        return true;
      }
      return false;
    },
    sync(ratio: number): void {
      painted = ratio;
    },
  };
}

/** 技能专属色(进度环按它上色,让「谁的冷却」也一眼可辨);表里没有就回落第一款 */
export function skillAccent(skillId: string): string {
  const list = CFG.skills.list as Array<{ id: string; accent: string }>;
  const hit = list.find((s) => s.id === skillId);
  return (hit ? hit.accent : list[0].accent);
}

/**
 * 画冷却层:墨底扇形 + 技能色就绪进度环 + 交界处的白色前沿。
 * 调用方负责把 lineCap/lineJoin 设成 ROUND(引擎枚举只能在 import cc 的一侧取到),
 * 并且只在 cd > 0 时调用 —— 就绪态一笔都不画。
 */
export function drawCooldown(pen: CdPen, color: CdColor, r: number, cdRatio: number, skillId: string, padAlpha: number): void {
  const cd = clamp(cdRatio, 0, 1);
  if (cd <= 0) return;
  const A = cdAlpha(padAlpha);
  const arcs = cdArcs(cd);
  const ringR = cdRingR(r);

  // 剩余冷却:墨底扇形,随冷却走完从前沿一路让空回 12 点
  pen.fillColor = color(CD.sweep, CD.sweepA * A);
  pen.moveTo(0, 0);
  pen.arc(0, 0, r - 1, arcs.pie0, arcs.pie1, false);
  pen.lineTo(0, 0);
  pen.close();
  pen.fill();

  // 就绪进度环:技能专属色,冷却走完它合成整圈(起手那一帧环长 0,不画,免得留一个圆头点)
  if (arcs.ring1 < arcs.ring0 - 1e-6) {
    pen.strokeColor = color(skillAccent(skillId), CD.ringA * A);
    pen.lineWidth = CD.ringW;
    pen.arc(0, 0, ringR, arcs.ring0, arcs.ring1, false);
    pen.stroke();
  }

  // 前沿亮点:扇形与环的交界钉一段更粗的白 —— 静态截图里也看得出「这根在走」,
  // 走满一圈就是亮了。环还没长出来(cd 满格)时那一段长度为 0,不画。
  if (arcs.head1 < arcs.ring0 - 1e-6) {
    pen.strokeColor = color(CD.head, CD.headA * A);
    pen.lineWidth = CD.headW;
    pen.arc(0, 0, ringR, arcs.ring0, arcs.head1, false);
    pen.stroke();
  }
}

/**
 * 画「就绪但门槛未满足」的斜杠:键上一道斜切墨线,与冷却扇形一眼区分。
 * 冷却会自己走完,门槛不满足是**局势**问题(人在空中/挥拍中/球没过来)——
 * 视觉上必须两种「按不了」长得不一样,玩家才知道该等 CD 还是该改站位。
 * 原因文字(touchpad 键上方)走 Label,不在这份 Graphics 笔画里。
 */
export function drawBlockedSlash(pen: CdPen, color: CdColor, r: number, padAlpha: number): void {
  const A = cdAlpha(padAlpha);
  const inset = r * (1 - CD.slashInset);
  pen.strokeColor = color(CD.slashColor, CD.slashA * A);
  pen.lineWidth = CD.slashW;
  pen.moveTo(-inset, -inset);
  pen.lineTo(inset, inset);
  pen.stroke();
}
