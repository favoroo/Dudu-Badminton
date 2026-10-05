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
 * 读数的有效透明度:把「按键淡出滑杆」和「状态读数」解耦的一般式。
 * keep=0 时退化成原来的「完全跟随滑杆」;keep=1 时读数无视滑杆。
 * 为什么必须有下限:玩家调淡的是**按键**,不是「这颗键现在什么状态」这条信息 ——
 * 线性相乘时滑杆 0.2 会把墨底压到 0.116,合成到亮场上与就绪态只差 10%,
 * 读出来就是「这键坏了」。(见 AGENTS 的记忆:看不见的控件就是 bug)
 * 留在零 cc 的本文件里而不是 touchpad:这样 node 侧能断言,判据 pad-cd-check。
 */
export function alphaFloor(padAlpha: number, keep: number): number {
  const A = clamp(padAlpha, 0, 1);
  return clamp(A + (1 - A) * clamp(keep, 0, 1), 0, 1);
}

/**
 * 冷却层的有效透明度。
 * keep=0 时退化成原来的「完全跟随滑杆」;keep=1 时读数无视滑杆。
 * 0.82 的取法:滑杆最低 0.2 时读数仍有 0.856,而滑杆拉满时不会超过 1(不额外糊屏)。
 */
export function cdAlpha(padAlpha: number): number {
  return alphaFloor(padAlpha, CD.keep);
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

/**
 * 受阻封条四个顶点的坐标(按顺时针:[左下, 右下, 右上, 左上])
 * 供 touchpad 绘制与 pad-cd-check 几何安全断言共用
 */
export function blockedTapeVertices(r: number): { x: number; y: number }[] {
  const w = r * (CD.tapeW ?? 1.44);
  const h = r * (CD.tapeH ?? 0.42);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const cy = r * (CD.hintY ?? 0.08);
  const skew = r * (CD.tapeSkewK ?? 0.07);
  return [
    { x: -hw - skew, y: cy - hh },
    { x: hw - skew, y: cy - hh },
    { x: hw + skew, y: cy + hh },
    { x: -hw + skew, y: cy + hh },
  ];
}

/**
 * 画「受阻态(门槛未满足)」的 P5 动感斜切封条底衬:
 * 居中内嵌在按键腰部(y = r * hintY,与冷却倒计时数字同高度重心)。
 * 封条底色为高浓度墨黑(抗亮场沙色穿透),带精致暗粉灰描边与向左动感斜切,
 * 将原本游离在外面的「球没过来」等提示彻底内嵌融合进按键,保持极佳的 P5 街机质感。
 */
export function drawBlockedTape(pen: CdPen, color: CdColor, r: number, padAlpha: number): void {
  const A = cdAlpha(padAlpha);
  const pts = blockedTapeVertices(r);
  const tracePath = (): void => {
    pen.moveTo(pts[0].x, pts[0].y);
    pen.lineTo(pts[1].x, pts[1].y);
    pen.lineTo(pts[2].x, pts[2].y);
    pen.lineTo(pts[3].x, pts[3].y);
    pen.close();
  };

  // 1. 墨黑底衬填充(遮挡背后的斜杠与暗化图标,保证内嵌文字极高辨识度)
  pen.fillColor = color(CD.tapeBg ?? "#080b12", (CD.tapeBgA ?? 0.92) * A);
  tracePath();
  pen.fill();

  // 2. 细精致暗粉灰外框描边(P5 街机质感)
  pen.strokeColor = color(CD.tapeEdge ?? "#5a454a", (CD.tapeEdgeA ?? 0.85) * A);
  pen.lineWidth = CD.tapeEdgeW ?? 1.2;
  tracePath();
  pen.stroke();
}

// ============================================================
// 「蓄能环」读数 —— kind: "charge" 的技能(当前 = 怒气重击)用。
//
// 为什么不复用上面那套冷却函数:cdRatio 的语义是「还剩多久能用」,而三处行为焊死在它上面
// (键体变灰并藏图标、键心印秒数、就绪脉冲要求 cdRatio<=0)。蓄能是它的**反向量**
// (越多越好、永远不该让键变灰),把怒气塞进 cdRatio 就会得到"怒气越满键越暗"这种荒谬读数。
// 所以这里是兄弟函数,共用的是**规矩**而不是实现:
//   ① 角度一律排成「终点 < 起点」的递减序(见上面 cdArcs 的警告与 AGENTS.md 坑 8)
//      —— cc 的 Graphics.arc 在 counterclockwise=false 时把 da 规范进 (-2π, 0],
//      传 a1 > a0 画不出那一段、画的是它的补集。症状是"充了 20% 却暗了 80%"。
//   ② 所有 alpha 一律过 cdAlpha(padAlpha) —— 透明度滑杆拉到底也不许把读数抹掉
//      (用户原话「透明度调低之后冷却都看不太清了」,同一款病不许在新增件上复发)。
//
// 多管分段(2026-10-05,氮气式):怒气重击改成最多攒 3 管,键面跟着从"一条环"改成
// "N 段管"—— 每管占整圈的 1/pipes,段间留一道缺口当管与管的分界,攒满哪管哪管整段点亮。
// 量纲在此分家:这里画与印的都吃「管」(ragePipesOf/ragePipeFillOf 喂进来),
// 强度与档位仍走 rageRatioOf 那条线,两条量纲不许互相顶替。
// 分层照旧:零 cc 依赖(只 import config 与 utils),所以几何能在 node 下断言
// (tools/pad-cd-check.ts 的 charge 段),真机画的与断言吃的是同一份代码。
// ============================================================

/** 蓄能环参数(config.ts padSkin.cd.charge) */
export const CH = CD.charge ?? {
  // 兜底只在配置缺键时生效(老档/半截配置),正常路径读的是 config 里那一份。
  // 数值与 config 保持同源抄写 —— 加了 charge 段请顺手删掉这里的对应项。
  ringW: 5.5, ringA: 0.95, trackA: 0.25,
  head: "#ffffff", headA: 1, headW: 6.5, headSpan: 0.5,
  fullRingW: 2.2, fullRingA: 0.9,
  pctK: 0.42, pctY: 0.08, stepTol: 0.008, segGap: 0.16,
};

/** 蓄能技能的管数上限(config.skills.rage.pipes;当前唯一 charge 款是怒气重击) */
export function chargePipesMax(): number {
  return Math.max(1, Math.round(CFG.skills.rage.pipes ?? 1));
}

/** 段间缺口(弧度):单管(pipes<=1)时强制 0 = 一条连续满环,旧读法原样保留 */
export function chargeSegGap(pipes: number): number {
  return pipes <= 1 ? 0 : (CH.segGap ?? 0.16);
}

/** 每段名义跨度(弧度):整圈减去段间缺口再均分 */
export function chargeSegSpan(pipes: number): number {
  return (Math.PI * 2 - chargeSegGap(pipes) * pipes) / pipes;
}

/**
 * 第 seg 段(0 起)的起止角(全部递减序:a0 段顶在先、a1 段底在后,补集规矩见 cdArcs)。
 * 0 号段从 12 点起顺时针;第 i 段的段顶 = 12 点 − i×(段跨度 + 缺口)。
 */
export function chargeSegArcs(seg: number, pipes: number): { a0: number; a1: number } {
  const span = chargeSegSpan(pipes);
  const a0 = CD_TOP - seg * (span + chargeSegGap(pipes));
  return { a0, a1: a0 - span };
}

/** 蓄能环中心半径:与冷却环同一条内收式,环线整条落在键圆内侧、不啃描边 */
export function chargeRingR(r: number): number {
  return r - CH.ringW / 2 - 0.5;
}

/** 满怒外环半径:贴描边内侧,与 isFlashReady 那圈双白环同一族读法 */
export function chargeFullR(r: number): number {
  return Math.max(r - CH.ringW - CH.fullRingW / 2 - 1, 1);
}

/**
 * 怒气读数(管量纲):pipesBanked = 已满的整管数、fill = 进行中那管的填充。
 * 印的是**总充能百分比**(如 50% / 100% / 250% / 300%),与分段环读的是同一笔账
 * (P + fill 恰 = rage/max)。0 充能**不印 "0%"** —— 空槽时环本来就没有,留一个字在键心
 * 反而像"坏了但还在报数"(同 cdText 不印 0.0 的那条理由:读数不许撒谎)。
 */
export function chargeText(pipesBanked: number, fill: number): string {
  const pipes = clamp(Math.round(pipesBanked), 0, chargePipesMax());
  const total = pipes + clamp(fill, 0, 1);
  if (total <= 0) return "";
  const pct = Math.round(total * 100);
  return pct <= 0 ? "" : `${pct}%`;
}

/**
 * 画蓄能环(多管分段版):未满管的底槽弧 + 已满管整段点亮 + 进行中管的填充弧与白亮头
 * (+ 攒着至少一整管时的那圈满怒外环)。
 * 调用方只在 kind==="charge" 时调,且负责把 lineCap/lineJoin 设成 ROUND。
 * 笔画封顶 = 未满管底槽 + 已满管填充 + 亮头 + 外环(3 管 = 最多 8 笔;
 * pad-cd-check 的笔数预算按这个口径钉)。空槽(P<=0 且 fill<=0)一笔不画 ——
 * 旧口径:读数不许撒谎,环本来就没有。
 */
export function drawCharge(pen: CdPen, color: CdColor, r: number, fill: number, skillId: string, padAlpha: number, pipesBanked = 0): void {
  const pipesMax = chargePipesMax();
  const P = clamp(Math.round(pipesBanked), 0, pipesMax);
  const f = clamp(fill, 0, 1);
  if (P <= 0 && f <= 0) return;
  const A = cdAlpha(padAlpha);
  const ringR = chargeRingR(r);
  const accent = skillAccent(skillId);
  const span = chargeSegSpan(pipesMax);
  // 进行中那段的几何(P < pipesMax 才存在;P = pipesMax 时 fill 恒 0,由喂值端保证)
  const cur = P < pipesMax ? chargeSegArcs(P, pipesMax) : null;
  const tip = cur ? cur.a0 - f * span : 0;

  // 1. 底槽:只描还没点亮的那几段(满管那几段会被填充整段盖住,重复描是白烧笔)
  if (P < pipesMax) {
    pen.strokeColor = color(CH.head, CH.trackA * A);
    pen.lineWidth = CH.ringW;
    for (let i = P; i < pipesMax; i++) {
      const seg = chargeSegArcs(i, pipesMax);
      pen.arc(0, 0, ringR, seg.a0, seg.a1, false);
      pen.stroke();
    }
  }

  // 2. 已满的管:整段点亮(技能专属色 —— 与冷却环同一条"谁的怒气一眼可辨"的规矩)
  if (P > 0) {
    pen.strokeColor = color(accent, CH.ringA * A);
    pen.lineWidth = CH.ringW;
    for (let i = 0; i < P; i++) {
      const seg = chargeSegArcs(i, pipesMax);
      pen.arc(0, 0, ringR, seg.a0, seg.a1, false);
      pen.stroke();
    }
  }

  // 3. 进行中那管:从段顶顺时针长出去 + 前沿白亮头(静态截图里也看得出"充到这儿了")
  if (cur && f > 0) {
    pen.strokeColor = color(accent, CH.ringA * A);
    pen.lineWidth = CH.ringW;
    pen.arc(0, 0, ringR, cur.a0, tip, false);
    pen.stroke();

    const head0 = Math.min(tip + CH.headSpan, cur.a0);
    if (head0 > tip + 1e-6) {
      pen.strokeColor = color(CH.head, CH.headA * A);
      pen.lineWidth = CH.headW;
      pen.arc(0, 0, ringR, head0, tip, false);
      pen.stroke();
    }
  }

  // 4. 满怒外环:至少攒着一整管就点亮(它同时是 syncReadyPulse 呼吸的那一层底)
  if (P >= 1) {
    pen.strokeColor = color(accent, CH.fullRingA * A);
    pen.lineWidth = CH.fullRingW;
    pen.arc(0, 0, chargeFullR(r), CD_TOP, CD_TOP - Math.PI * 2, false);
    pen.stroke();
  }
}


