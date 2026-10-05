// ============================================================
// 技能键「冷却读数」回归 —— 防的是用户报的这句现场:
// 「技能按钮的冷却效果稍微明显一点,现在这个我透明度调低之后都看不太清了」。
//
// 现场数字(旧写法:冷却层每一笔都直接乘 Settings.padAlpha):
//   滑杆 0.2 时墨底 0.58 → 有效浓度 0.116、进度环 0.85 → 0.17、图标 0.5 → 0.10。
//   合成到亮场沙色底上,冷却态那颗键和就绪态那颗键的亮度只差 10% 出头 ——
//   玩家读出来的是「这颗键按不动,是不是坏了」,不是「这个技能还剩 3 秒」。
// 现在:冷却层浓度走 cdAlpha()(只跟随滑杆一部分,留下限),外加键心「还剩几秒」。
//
// 断言分六段,判据全是能在真机变成「看不见东西」的那类:
//   ① 滑杆全程(0.2..1.0):冷却浓度有下限、单调不减、不越 1;
//   ② 亮度对比 —— 按引擎真实的 sRGB 逐通道合成算:冷却态必须比就绪态压得下去,
//      而进度环与数字必须在墨底上提得起来(旧写法在②的第一条就红);
//   ③ 扫掠几何:扇形 + 环恒等于整圈、随剩余冷却单调、最小档上半径仍落在键圆内侧;
//   ④ 键心排版:字号随半径缩放、与键名标签不打架、不出圆(半径取最小档时最容易撞);
//   ⑤ 读数内容:冷却中永不显示 0.0、就绪时不显示、五款技能的起手读数与专属色齐活;
//   ⑥ 重画节奏:冷却门控的基准必须是「上次画上屏的值」—— 写错成「上一帧的喂值」时
//      stepTol 退化成相邻帧增量,长 CD 的阴影起手画一次后整段冻结,只在点按被拒时
//      跳进一截(用户现场:「阴影只能 1/3 地消失,不连续」,数字却在连续倒数)。
// 另带 --selftest:拿修好之前的真实写法当反例,断言它**会**被报警 ——
// 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/pad-cd-check.js
//   node .tools-build/tools/pad-cd-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import {
  CD, CD_TOP, cdAlpha, cdArcs, cdRingR, cdText, makeCdGate, skillAccent, blockedTapeVertices,
  CH, chargePipesMax, chargeSegArcs, chargeSegSpan, chargeSegGap, chargeRingR, chargeFullR, chargeText, drawCharge, type CdPen,
} from "../assets/scripts/input/pad-cd";
import { CFG } from "../assets/scripts/core/config";
import { PAD_BASE, PAD_LIMIT } from "../assets/scripts/core/settings";
import { textW } from "../assets/scripts/core/text-metrics";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

// ---------- 亮度:引擎的 UI 混合就发生在 sRGB 通道上,所以照这个模型合成 ----------
type RGB = [number, number, number];
function rgbOf(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** fg 以 alpha 叠在 bg 上(逐通道,与引擎一致:不在线性空间混合) */
function over(fg: RGB, a: number, bg: RGB): RGB {
  const k = Math.max(0, Math.min(1, a));
  return [
    fg[0] * k + bg[0] * (1 - k),
    fg[1] * k + bg[1] * (1 - k),
    fg[2] * k + bg[2] * (1 - k),
  ];
}
/** 709 相对亮度(通道先线性化) —— 只用来比「谁更暗」 */
function lum(c: RGB): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** 最坏背景:亮场(海滩)沙色 —— 深墨底在这里最难压出对比,暗场不构成威胁 */
const BG = rgbOf("#d9c9a4");
const ACCENTS = CFG.skills.list.map((s) => s.accent);

/**
 * 引擎真实行为(cocos/2d/assembler/graphics/helper.ts):counterclockwise=false 时
 * `if (|da| >= 2π) da = -2π; else while (da > 0) da -= 2π;` —— 传 a1 > a0 不会画那一段,
 * 画的是它的补集。所以「名义跨度」和「实际画出来的跨度」必须分开算,断言只能信后者。
 */
function ccSpan(a0: number, a1: number): number {
  const TAU = Math.PI * 2;
  let da = a1 - a0;
  if (Math.abs(da) >= TAU) da = -TAU;
  else while (da > 0) da -= TAU;
  return Math.abs(da);
}

/** 滑杆档位:与设置页那根 0.05 一档的透明度滑杆同源 */
function alphas(): number[] {
  const out: number[] = [];
  for (let a = PAD_LIMIT.alphaMin; a <= PAD_LIMIT.alphaMax + 1e-9; a += 0.05) {
    out.push(Math.round(a * 100) / 100);
  }
  return out;
}

/** 就绪态那颗键的亮度(底色完全跟随滑杆 —— 这是玩家要的「按键别碍眼」) */
const idleLum = (A: number): number =>
  lum(over(rgbOf(CFG.padSkin.idleFill), CFG.padSkin.idleFillA * A, BG));
/** 冷却态墨底亮度:aCd 由外面喂进来,于是新旧两种浓度算法共用同一个判据 */
const pieLum = (aCd: number): number => lum(over(
  rgbOf(CD.sweep), CD.sweepA * aCd,
  over(rgbOf(CD.fill), CD.fillA * aCd, BG),
));
const ringLum = (accent: string, aCd: number): number =>
  lum(over(rgbOf(accent), CD.ringA * aCd, BG));
const numLum = (aCd: number): number => lum(over(
  rgbOf(CD.num), CD.numA * aCd,
  over(rgbOf(CD.sweep), CD.sweepA * aCd, BG),
));

console.log("技能键冷却读数:浓度下限 / 亮度对比 / 扫掠几何 / 键心排版 / 倒计时读数 / 重画节奏\n");

// ---------- ① 滑杆全程都不许把读数抹掉 ----------
{
  const S = alphas();
  let minRead = Infinity;
  let mono = true;
  let prev = -1;
  for (const A of S) {
    const a = cdAlpha(A);
    minRead = Math.min(minRead, a);
    if (a < prev - 1e-9 || a > 1 + 1e-9) mono = false;
    prev = a;
  }
  ok(minRead >= 0.8, `冷却层有效浓度全程 >= 0.8(滑杆最低 ${PAD_LIMIT.alphaMin} 时仍有 ${minRead.toFixed(3)})`);
  ok(mono, "滑杆越淡、读数不越淡(单调不减,且不会越过 1 去糊屏)");
  ok(cdAlpha(1) === 1, "滑杆拉满时不额外加浓(想要完全透明还是给得到)");
  ok(S.every((A) => cdAlpha(A) >= A - 1e-9), "读数只会比按键本体更实,不会更淡");
  ok(CFG.padSkin.cd.keep > 0 && CFG.padSkin.cd.keep < 1,
    `keep = ${CFG.padSkin.cd.keep}(0 = 完全随滑杆 = 这次要修的 bug,1 = 无视滑杆 = 想淡也淡不掉)`);
}

// ---------- ② 亮度对比 ----------
{
  const S = alphas();
  let worstDim = 0;
  let worstDimAt = 0;
  let worstRing = Infinity;
  let worstNum = Infinity;
  for (const A of S) {
    const aCd = cdAlpha(A);
    const r = pieLum(aCd) / idleLum(A);
    if (r > worstDim) { worstDim = r; worstDimAt = A; }
    for (const accent of ACCENTS) worstRing = Math.min(worstRing, ringLum(accent, aCd) / pieLum(aCd));
    worstNum = Math.min(worstNum, numLum(aCd) / pieLum(aCd));
  }
  ok(worstDim <= 0.4, `冷却态墨底全程比就绪态那颗键暗 —— 最差亮度比 ${worstDim.toFixed(3)}(滑杆 ${worstDimAt})`);
  ok(worstRing >= 4, `五款技能的进度环都在墨底上亮 4 倍以上(最差 ${worstRing.toFixed(1)}×)`);
  ok(worstNum >= 6, `键心数字在墨底上亮 6 倍以上(最差 ${worstNum.toFixed(1)}×,暗底白字不许糊)`);

  // 旧写法的账:每一笔直接乘滑杆,同一判据下冷却态和就绪态几乎同亮度
  const legacyA = PAD_LIMIT.alphaMin;
  const legacyPie = lum(over(
    rgbOf("#000000"), 0.58 * legacyA,
    over(rgbOf("#0e121a"), 0.45 * legacyA, BG),
  ));
  console.log(`  · 对照 @滑杆 ${legacyA}:旧写法亮度比 ${(legacyPie / idleLum(legacyA)).toFixed(3)} → 现在 ${(pieLum(cdAlpha(legacyA)) / idleLum(legacyA)).toFixed(3)}(越小越压得住)`);
}

// ---------- ③ 扫掠几何(含引擎的 arc 角度规范:da 会被绕进 (-2π, 0])----------
{
  let contiguous = true;
  let pieExact = true;
  let ringExact = true;
  let monotone = true;
  let wrapBug = "";
  let prevPie = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const cd = i / 200;
    const a = cdArcs(cd);
    if (Math.abs(a.pie1 - a.ring0) > 1e-9) contiguous = false;
    if (Math.abs(ccSpan(a.pie0, a.pie1) - cd * Math.PI * 2) > 1e-9) pieExact = false;
    if (Math.abs(ccSpan(a.ring0, a.ring1) - (1 - cd) * Math.PI * 2) > 1e-9) ringExact = false;
    if (a.pie1 > a.pie0 || a.ring1 > a.ring0 || a.head1 > a.ring0) wrapBug = wrapBug || `cd=${cd.toFixed(2)}`;
    if (a.head1 < a.ring1 - 1e-9) wrapBug = wrapBug || `前沿亮点越过 12 点 @cd=${cd.toFixed(2)}`;
    if (a.pie0 - a.pie1 < prevPie - 1e-12) monotone = false;   // cd 越大扇形越大(角度递减排,所以取跨度)
    prevPie = a.pie0 - a.pie1;
  }
  ok(!wrapBug, `三段弧全是「终点 < 起点」(da 为负才不会被引擎绕成补集)${wrapBug ? ` → ${wrapBug}` : ""}`);
  ok(pieExact, "墨底扇形的实际跨度 = 剩余冷却(cd·2π),不是它的补集");
  ok(ringExact, "进度环的实际跨度 = 已走完的冷却((1-cd)·2π),冷却走完它合成整圈");
  ok(contiguous, "扇形前沿与进度环起点同一点(不留缝、不重叠)");
  ok(monotone, "剩余冷却越多墨底扇形越大(冷却在走 = 阴影在退、环在长,不会倒着走)");
  const full = cdArcs(1);
  const empty = cdArcs(0);
  ok(full.ring1 - full.ring0 > -1e-9, "起手那一帧进度环长度为 0(整颗键还在冷却)");
  ok(empty.pie1 - empty.pie0 > -1e-9, "冷却走完那一帧墨底为空(整圈都是就绪环)");
  ok(CD_TOP === Math.PI / 2, "12 点基准是 +π/2(UI 本地 y 向上;-π/2 是正下方,旧写法把起点钉在 6 点)");

  // 半径:用户把键拖到最小 + 小屏缩到 scaleMin,到最大档,环与扇形都得画得出来
  const rLo = PAD_LIMIT.rMin * CFG.padSkin.scaleMin;
  const rHi = Math.max(PAD_BASE.lunge.r, PAD_LIMIT.rMax) * CFG.padSkin.scaleMax;
  let ringOk = true;
  for (let r = rLo; r <= rHi; r += 0.5) {
    const rr = cdRingR(r);
    if (!(rr > 0 && rr < r - CD.ringW / 2) || !(r - 1 > 0)) ringOk = false;
  }
  ok(ringOk, `进度环中心半径在 r=${rLo.toFixed(1)}..${rHi.toFixed(1)} 全区间都落在键圆内侧`);
  ok(CD.ringW >= 3.5, `进度环粗 ${CD.ringW}(旧值 2.5 在亮场上等于一条若隐若现的头发丝)`);
  ok(CD.headSpan > 0 && CD.headW >= CD.ringW, `前沿亮点 ${CD.headW}px 宽 / ${CD.headSpan.toFixed(2)}rad 长,比环更粗才认得出指针`);
}

// ---------- ④ 键心排版:数字不许和键名标签打架 ----------
{
  const rLo = PAD_LIMIT.rMin * CFG.padSkin.scaleMin;
  const rHi = Math.max(PAD_BASE.lunge.r, PAD_LIMIT.rMax) * CFG.padSkin.scaleMax;
  const nameLH = Math.round(CFG.padSkin.labelSize * 1.22);
  let gapMin = Infinity;
  let fitMin = Infinity;
  let fsMin = Infinity;
  let overRound = "";
  for (let r = rLo; r <= rHi; r += 0.5) {
    const fs = Math.max(9, Math.round(r * CD.numK));      // 与 touchpad.sizeCdLabel 同式
    fsMin = Math.min(fsMin, fs);
    const numBottom = CD.numY * r - fs * 1.1 / 2;
    const nameTop = -r * 0.62 + nameLH / 2;               // 键名贴在键圆 -0.62r(touchpad.syncLabel)
    gapMin = Math.min(gapMin, numBottom - nameTop);
    if (CD.numY * r + fs * 1.1 / 2 > r - 2) overRound = overRound || `r=${r.toFixed(1)}`;
    fitMin = Math.min(fitMin, (1.6 * r) / textW("6.0", fs));  // 最长读数:magnet 6.0s
  }
  ok(gapMin >= 1, `数字底边与键名标签顶边全程留缝 >= 1px(最窄 ${gapMin.toFixed(1)}px @ r=${rLo.toFixed(1)})`);
  ok(!overRound, `数字不出键圆${overRound ? ` → ${overRound}` : ""}`);
  ok(fitMin >= 1, `数字横向放得进 1.6r 的弦(最小档余量 ${((fitMin - 1) * 100).toFixed(0)}%)`);
  ok(fsMin >= 9, `字号随半径缩放(= numK·r),最小档仍有 ${fsMin}px;写死字号会在最大档小得像标点`);
}

// ---------- ⑤ 读数内容与技能色表 ----------
{
  ok(cdText(0) === "", "就绪时键心不显示数字");
  ok(cdText(0.001) === "0.1" && cdText(0.05) === "0.1", "冷却中最低显示 0.1,永不显示 0.0(0.0 看着像就绪)");
  let mono = true;
  let prev = Infinity;
  for (let s = 6; s >= 0; s -= 0.01) {
    const v = parseFloat(cdText(s) || "0");
    if (v > prev + 1e-9) mono = false;
    prev = v;
  }
  ok(mono, "读数随冷却流逝单调不增");
  // 起手读数必须 = 技能表那格的秒数(向上取到 0.1)—— 从表里推,不写死数字:
  // 技能表 cooldownFrames 由另一处在改(skill-check 管它),这里只钉「换算不许错」。
  const badFirsts = CFG.skills.list
    .map((sk) => {
      const sec = sk.cooldownFrames / 60;
      const want = Math.max(CD.numMin, Math.ceil(sec * 10) / 10).toFixed(1);
      return cdText(sec) === want ? "" : `${sk.id} 表里 ${sec}s → 键心 ${cdText(sec)}`;
    })
    .filter(Boolean);
  ok(badFirsts.length === 0, `五款技能起手读数与技能表对得上${badFirsts.length ? ` → ${badFirsts.join(" / ")}` : ""}`);
  ok(CFG.skills.list.every((sk) => cdText(sk.cooldownFrames / 60).length > 0),
    "起手读数全都不是空串(表里出现 0 帧冷却会在这里露出来)");
  ok(CFG.skills.list.every((sk) => /^#[0-9a-f]{6}$/i.test(sk.accent)), "每款技能都有专属色,进度环按它上色");
  ok(skillAccent("no-such-skill") === CFG.skills.list[0].accent, "技能表查不到时回落第一款,不会画出透明笔");
  ok(CD.stepTol > 0 && CD.stepTol <= 0.01, `重画阈值 ${CD.stepTol}(旧值 0.015 让 6 秒档的扫掠每 9° 跳一格)`);
}

// ---------- ⑥ 重画节奏:门控基准 = 「上次画上屏的值」,不是「上一帧的喂值」 ----------
{
  // game-root 每渲染帧喂一次 clamp(s.cd / s.maxCd, 0, 1);s.cd 每模拟步 -1,
  // 所以比例沿整段冷却线性下行:起手 1 → 走完 0(60Hz 固定步长)。
  const feed = (maxCd: number): number[] =>
    Array.from({ length: maxCd + 1 }, (_, f) => 1 - f / maxCd);

  ok(makeCdGate().step(0) === false, "门控初值 = 0(就绪态),同值喂入不触发重画");
  const g0 = makeCdGate();
  g0.sync(0.5);
  ok(g0.step(0.5) === false, "sync 把基准对齐到刚画上屏的值,同值喂入不触发重画");
  ok(g0.step(0.5 + CD.stepTol * 2) === true, "累计变化跨过阈值的那一下必须触发重画");

  // 这段节奏只对**冷却款**成立。充能款(怒气重击)的 cooldownFrames 是 20 帧防连点,
  // 键面根本不画这条扫掠 —— touchpad.paint 里 drawCooldown 与 drawCharge 是互斥分支。
  // 把它一起卷进「整段冷却必须重画 ≥30 次」只会得到一条假红(rage 数学上最多 21 次),
  // 而下一个看到红的人多半去把 rage 的 cooldownFrames 调大 —— 那才是真把假冷却装回键面。
  const cdSkills = CFG.skills.list.filter((sk) => sk.kind !== "charge");
  ok(cdSkills.length === CFG.skills.list.length - 1,
    `冷却款 ${cdSkills.length} 款 + 充能款 1 款 = 全表 ${CFG.skills.list.length}(这段判据的覆盖面自己要对账)`);

  for (const sk of cdSkills) {
    const maxCd = sk.cooldownFrames;
    const gate = makeCdGate();
    let repaints = 0;
    let maxLag = 0;
    let frozen = 0;
    let maxFrozen = 0;
    for (const ratio of feed(maxCd)) {
      if (gate.step(ratio)) { repaints++; frozen = 0; }
      else { frozen++; maxFrozen = Math.max(maxFrozen, frozen); }
      maxLag = Math.max(maxLag, Math.abs(gate.painted - ratio));
    }
    ok(maxLag <= CD.stepTol + 1e-9,
      `${sk.id}: 屏上阴影与真值的滞后全程 ≤ stepTol(实测 ${maxLag.toFixed(4)};基准写错会冻结到 1)`);
    ok(maxFrozen <= Math.ceil(CD.stepTol * maxCd) + 2,
      `${sk.id}: 最长不重画 ${maxFrozen} 帧,不超过阈值档 × 总帧 + 2(约每 ${Math.max(1, Math.round(CD.stepTol * maxCd))} 帧必前进)`);
    ok(repaints >= 30,
      `${sk.id}: 整段冷却重画 ${repaints} 次 ≥ 30(扫掠是连续的,不是几大格)`);
  }

  // ---------- 充能层的节奏:大跳而不是逐帧下行 ----------
  // 怒气的喂法是"每次命中涨 perHit×系数"(5 / 9 / 10 / 14 点,即 5%~14%),中间几十帧一动不动。
  // 判据要保证的是:① 每一次命中都跨过阈值 ⇒ 环一定前进(不许冻在旧值,那是"打了球环不动");
  // ② 释放归零那一下也一定重画(整管清空是这条键最重要的一次变化);
  // ③ 一帧之内什么都不涨时不许白白重画(重画整键不便宜,见 frame-cost-check)。
  {
    const RG = CFG.skills.rage;
    const tol = CH.stepTol;
    ok(tol > 0 && tol <= 0.02, `充能环阈值 ${tol}(太大就跳格、太小就每帧重画)`);
    const gains = [RG.perHit, RG.perHit * RG.sweetMul, RG.perHit * RG.smashMul, RG.perHit * RG.bothMul];
    for (const g of gains) {
      const gate = makeCdGate();
      const step = g / RG.max;
      ok(gate.step(step), `一记 +${g} 点(${(step * 100).toFixed(0)}%)必须跨过阈值 ${tol}`);
    }
    // 攒满全程:每一次命中都重画一次,一次都不许漏
    const gate = makeCdGate();
    let rage = 0, drawn = 0, hits = 0;
    while (rage < RG.max) {
      rage = Math.min(rage + RG.perHit, RG.max); hits++;
      const ratio = rage / RG.max;
      // 命中之间几十帧静止:那些帧喂同一个值,不该重画(第③条)
      if (gate.step(ratio)) drawn++;
      ok(gate.step(ratio) === false, `同一比例第 ${hits} 次喂入不重复重画(静止帧不烧笔)`);
      for (let idle = 0; idle < 20; idle++) {
        if (gate.step(ratio)) drawn++;   // 空转 20 帧:一次都不该加
      }
    }
    ok(drawn === hits, `蓄满 ${hits} 拍 ⇒ 环前进 ${drawn} 次,一一相等(漏一次就是"打了球环不动")`);
    // 释放归零:整管清空那一下必须重画
    ok(gate.step(0), "释放归零(100% → 0%)跨过阈值,键面立刻清空而不是留着满环骗人");
  }
}

// ---------- ⑦ 技能受阻态(门槛未满足)内嵌封条与原因文字几何与排版断言 ----------
{
  const rLo = PAD_LIMIT.rMin * CFG.padSkin.scaleMin;
  const rHi = Math.max(PAD_BASE.lunge.r, PAD_LIMIT.rMax) * CFG.padSkin.scaleMax;
  const nameLH = Math.round(CFG.padSkin.labelSize * 1.22);
  let vertexOut = "";
  let gapMin = Infinity;
  let textOverflow = "";
  const allReasons = Object.values(CFG.skills.blockText);

  for (let r = rLo; r <= rHi; r += 0.5) {
    const pts = blockedTapeVertices(r);
    // 1. 封条四个顶点必须全部内嵌在按键圆内,并留有安全边距
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x, pts[i].y);
      if (d > r - 2) {
        vertexOut = vertexOut || `r=${r.toFixed(1)} 顶点${i}距离=${d.toFixed(1)} > ${r - 2}`;
      }
    }
    // 2. 封条底边与底部键名顶边必须留出安全垂直间隔(不叠字)
    const tapeBottom = pts[0].y; // 左下/右下顶点 y
    const nameTop = -r * 0.62 + nameLH / 2;
    gapMin = Math.min(gapMin, tapeBottom - nameTop);

    // 3. 所有阻断原因文字在字号缩放后横向必须能容纳在封条有效宽度内
    const fs = Math.max(7, Math.round(r * 0.26));
    const tapeW = r * (CD.tapeW ?? 1.44);
    const availW = tapeW - r * (CD.tapeSkewK ?? 0.07); // 扣除动感斜切内缩
    for (const txt of allReasons) {
      const tw = textW(txt, fs);
      if (tw > availW) {
        textOverflow = textOverflow || `r=${r.toFixed(1)} 字号=${fs}「${txt}」宽=${tw.toFixed(1)} > 容纳宽=${availW.toFixed(1)}`;
      }
    }
  }

  ok(!vertexOut, `受阻封条四个顶点在全半径区间(r=${rLo.toFixed(1)}..${rHi.toFixed(1)})严格落在键圆内侧${vertexOut ? ` → ${vertexOut}` : ""}`);
  ok(gapMin >= 1, `封条底边与技能名顶边留有充裕间隙(最窄 ${gapMin.toFixed(1)}px ≥ 1px)`);
  ok(!textOverflow, `全阻断原因文本(含「球没过来」等 ${allReasons.length} 句)横向完全嵌在封条内${textOverflow ? ` → ${textOverflow}` : ""}`);

  // 4. 文字颜色在封条底板上的对比度
  const tapeLum = lum(rgbOf(CD.tapeBg ?? "#080b12"));
  const textLum = lum(rgbOf(CD.hintColor ?? "#f8fafc"));
  const contrast = (textLum + 0.05) / (tapeLum + 0.05);
  ok(contrast >= 7.0, `受阻文字在封条墨底上的对比度达到 ${contrast.toFixed(1)}:1 (≥ 7.0:1 保证亮场下极佳可读性)`);
}

// ---------- ⑧ 蓄能环(充能款技能:怒气重击,多管分段版)----------
// 这一整段是新增件专用的判据,但钉的是三条**旧**规矩有没有在新代码里复发:
// 补集角序(坑 8)、透明度下限(用户原话「透明度调低之后冷却都看不太清了」)、排版不撞键名。
// 2026-10-05 多管蓄力:环改成 N 段管,判据跟着走"记录笔"路线 —— 把 drawCharge 真正
// 画出的每一笔弧记下来逐笔对账(名义跨度/递减序/笔数),不再只测纯函数。
{
  const TAU = Math.PI * 2;
  const PIPES = chargePipesMax();
  const SPAN = chargeSegSpan(PIPES);
  const ACCENT = skillAccent("rage");
  /** 记录笔:把 drawCharge 画出的每笔弧(角度 + 色相 + 浓度)抓下来逐笔断言 */
  interface ArcRec { a0: number; a1: number; hex: string; a: number }
  const record = (fill: number, pipes: number): ArcRec[] => {
    const arcs: ArcRec[] = [];
    const pen: CdPen = {
      fillColor: null, strokeColor: null, lineWidth: 0,
      moveTo() {}, lineTo() {}, close() {}, fill() {},
      arc(_cx, _cy, _r, a0, a1) {
        const c = pen.strokeColor as { hex: string; a: number } | null;
        arcs.push({ a0, a1, hex: c?.hex ?? "", a: c?.a ?? 0 });
      },
      stroke() {},
    };
    drawCharge(pen, (hex, a) => ({ hex, a }), 30, fill, "rage", 1, pipes);
    return arcs;
  };
  const kindOf = (r: ArcRec): "track" | "fill" | "head" | "full" => {
    if (r.hex === ACCENT) return Math.abs(r.a - CH.ringA) < 1e-9 ? "fill" : "full";
    if (Math.abs(r.a - CH.trackA) < 1e-9) return "track";
    return "head";
  };
  const spanOf = (r: ArcRec): number => Math.abs(r.a0 - r.a1);

  // (a) 补集规矩 + 名义跨度:每一笔的"实际跨度"必须等于"名义跨度",一段都不许多画出来。
  const FILLS = [0.01, 0.05, 0.12, 0.34, 0.5, 0.66, 0.67, 0.99, 1];
  let spanBad = "";
  for (let P = 0; P <= PIPES; P++) {
    for (const f of FILLS) {
      // 满槽时喂值端保证 fill=0(ragePipeFillOf 在整管边界恒 0):P=PIPES 且 f>0 是病态输入,不测
      if (P === PIPES && f > 0) continue;
      for (const r of record(f, P)) {
        if (!(r.a1 < r.a0)) spanBad = spanBad || `P=${P} f=${f}:有弧不是递减序(引擎会画成补集)`;
        const k = kindOf(r);
        const s = spanOf(r);
        if (k === "track" && Math.abs(s - SPAN) > 1e-9) spanBad = spanBad || `P=${P} f=${f}:底槽 ${s.toFixed(3)} ≠ 段名义 ${SPAN.toFixed(3)}`;
        if (k === "full" && Math.abs(s - TAU) > 1e-9) spanBad = spanBad || `P=${P} f=${f}:满怒外环 ${s.toFixed(3)} ≠ 整圈`;
        if (k === "head" && s > CH.headSpan + 1e-9) spanBad = spanBad || `P=${P} f=${f}:亮头 ${s.toFixed(3)} 越过 headSpan`;
      }
      // 填充总量:accent 弧的总跨度必须 = (P + f) × 段名义跨度 —— 环上读出的总量与存量一笔账
      const fillTotal = record(f, P).filter((r) => kindOf(r) === "fill").reduce((acc, r) => acc + spanOf(r), 0);
      const want = (P + f) * SPAN;
      if (Math.abs(fillTotal - want) > 1e-9) spanBad = spanBad || `P=${P} f=${f}:填充总跨 ${fillTotal.toFixed(3)} ≠ 名义 ${want.toFixed(3)}`;
      // 段数对账:已满管每段整段,进行中那管恰一段(填多少算多少)
      const fillArcs = record(f, P).filter((r) => kindOf(r) === "fill");
      const wantArcs = P + (f > 0 && P < PIPES ? 1 : 0);
      if (fillArcs.length !== wantArcs) spanBad = spanBad || `P=${P} f=${f}:填充笔数 ${fillArcs.length} ≠ ${wantArcs}`;
    }
  }
  // 段间缺口:相邻段顶之间必须留出缺口(单管时为 0,连续环)
  if (PIPES > 1) {
    const g0 = chargeSegArcs(0, PIPES), g1 = chargeSegArcs(1, PIPES);
    if (Math.abs(g0.a1 - g1.a0 - chargeSegGap(PIPES)) > 1e-9) spanBad = spanBad || "段间缺口宽度与名义不符";
  }
  ok(spanBad === "", `分段蓄能环逐笔对账(${PIPES} 管,段名义 ${(SPAN / TAU * 360).toFixed(1)}°,缺口 ${(chargeSegGap(PIPES) / TAU * 360).toFixed(1)}°)${spanBad ? ` → ${spanBad}` : ""}`);

  // (b) 环必须整条在键圆里,最小档也不例外(与冷却环同一条判据)
  const rLo = PAD_LIMIT.rMin * CFG.padSkin.scaleMin;
  const rHi = Math.max(PAD_BASE.lunge.r, PAD_LIMIT.rMax) * CFG.padSkin.scaleMax;
  let out = "";
  for (let r = rLo; r <= rHi; r += 0.5) {
    if (chargeRingR(r) + CH.ringW / 2 >= r) out = out || `ring r=${r.toFixed(1)}`;
    if (chargeFullR(r) + CH.fullRingW / 2 >= r) out = out || `full r=${r.toFixed(1)}`;
  }
  ok(out === "", `蓄能环与满怒外环都在键圆内侧(最小档 r=${rLo.toFixed(1)})${out ? ` → ${out}` : ""}`);

  // (c) 浓度下限:透明度滑杆拉到底,环与百分比仍然读得出来(①②那两条判据的充能版)
  let keepMin = 1;
  for (const a of alphas()) keepMin = Math.min(keepMin, cdAlpha(a));
  ok(keepMin >= CD.keep, `充能环的有效浓度全程 ≥ ${CD.keep}(滑杆最低 ${PAD_LIMIT.alphaMin} 时仍有 ${keepMin.toFixed(3)})`);
  const darkLum = lum(over(rgbOf(CH.head), CH.trackA * cdAlpha(PAD_LIMIT.alphaMin), BG));
  const readyLum = lum(over(rgbOf(CFG.padSkin.idleFill), CFG.padSkin.idleFillA * PAD_LIMIT.alphaMin, BG));
  ok(Math.abs(darkLum - readyLum) > 0.02, `最低滑杆下底槽与就绪态亮度差 ${Math.abs(darkLum - readyLum).toFixed(3)} > 0.02(读得出"在充能")`);

  // (d) 读数内容:空槽不印 0%、按"管"印总百分比、单调不降
  ok(chargeText(0, 0) === "", "空槽不印「0%」(环本来就没有,留个字反而像坏了还在报数)");
  ok(chargeText(1, 0) === "100%", `一管满印「${chargeText(1, 0)}」(不是 1、不是 99%)`);
  ok(chargeText(0, 0.5) === "50%", `半管印「${chargeText(0, 0.5)}」`);
  ok(chargeText(2, 0.5) === "250%", `两管半印「${chargeText(2, 0.5)}」(多管读法:管数 + 当前管填充)`);
  ok(chargeText(PIPES, 0) === `${PIPES * 100}%`, `满槽印「${chargeText(PIPES, 0)}」`);
  let txtPrev = -1, txtBad = "";
  for (let P = 0; P <= PIPES; P++) {
    for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
      const num = Number((chargeText(P, f) || "0").replace("%", ""));
      if (num < txtPrev - 1e-9) txtBad = txtBad || `P=${P} f=${f}:读数倒退`;
      txtPrev = num;
    }
  }
  ok(txtBad === "", `百分比单调不降${txtBad ? ` → ${txtBad}` : ""}`);

  // (e) 排版:百分比比倒计时宽("300%" 4 字 vs "3.5" 3 字),所以字号另收一档(pctK)
  const widest = `${PIPES * 100}%`;
  const nameLH = Math.round(CFG.padSkin.labelSize * 1.22);
  let gapMin = Infinity, fitMin = Infinity, overRound = "";
  for (let r = rLo; r <= rHi; r += 0.5) {
    const fs = Math.max(9, Math.round(r * CH.pctK));          // 与 touchpad.sizeCdLabel(rec.r, CH.pctK) 同式
    const bottom = CD.numY * r - fs * 1.1 / 2;                 // 圆心沿用 numY,只换字号
    const nameTop = -r * 0.62 + nameLH / 2;
    gapMin = Math.min(gapMin, bottom - nameTop);
    if (CD.numY * r + fs * 1.1 / 2 > r - 2) overRound = overRound || `r=${r.toFixed(1)}`;
    fitMin = Math.min(fitMin, (1.6 * r) / textW(widest, fs));
  }
  ok(gapMin >= 1, `百分比底边与键名标签顶边全程留缝 >= 1px(最窄 ${gapMin.toFixed(1)}px @ r=${rLo.toFixed(1)})`);
  ok(fitMin >= 1, `「${widest}」放得进 1.6r 的弦(最小档余量 ${((fitMin - 1) * 100).toFixed(0)}%)`);
  ok(!overRound, `百分比不出键圆${overRound ? ` → ${overRound}` : ""}`);
  ok(CH.pctK <= CD.numK, `充能字号系数 ${CH.pctK} <= 倒计时 ${CD.numK}(那句更宽,必须收着摆)`);
  // 键心读数与受阻封条**同住一个腰位**(numY === hintY)⇒ 同屏只能有一个有字。
  // 冷却款是天然满足的(受阻那一下 cd 已走完 ⇒ cdText 空串),充能款不是:
  // armed 的 240 帧里怒气还挂在管上,chargeText 是非空的"100%",不互斥就糊成"1重击中%"
  // (出图肉眼判抓到的真实现场)。这条判据钉的是"那个几何耦合仍然存在",
  // 让字的行为在 touchpad.syncCdLabel(它读 skillBlock),两边一缺一多都会红。
  ok(CD.numY === (CD.hintY ?? 0.08), `读数腰位 numY ${CD.numY} == 封条腰位 hintY ${CD.hintY}(同位 ⇒ 必须互斥让字)`);
  ok(chargeText(1, 0) !== "" && chargeText(0, 0.5) !== "", "充能款受阻时读数本身是非空的(所以互斥只能靠调用方)");
  ok(cdText(0) === "", "冷却款走完时读数自然为空 ⇒ 旧技能从来不会撞,这条改动不影响它们");

  // (f) 笔数预算:多管分段后封顶 = 未满管底槽 + 已满管填充 + 亮头 + 外环
  //     (3 管 = 6 笔最忙帧;这条键在彩带/礼花之外还挂着图标与呼吸,帧成本要数得过来)
  const strokes = (fill: number, pipes: number): number => record(fill, pipes).length;
  ok(strokes(0, 0) === 0, "空槽一笔不画(不留一个孤零零的底槽圈,那会被读成坏了)");
  ok(strokes(0.5, 0) === PIPES + 2, `半管 ${PIPES + 2} 笔(${PIPES} 段底槽 + 填充 + 亮头),实测 ${strokes(0.5, 0)}`);
  ok(strokes(0, 1) === (PIPES - 1) + 1 + 1, `整管 ${((PIPES - 1) + 1 + 1)} 笔(未满管底槽 + 该管填充 + 外环),实测 ${strokes(0, 1)}`);
  ok(strokes(0.5, PIPES - 1) === 1 + (PIPES - 1) + 1 + 1 + 1, `两管半 6 笔(底槽 + 满管×2 + 半管 + 亮头 + 外环),实测 ${strokes(0.5, PIPES - 1)}`);
  ok(strokes(0, PIPES) === PIPES + 1, `满槽 ${PIPES + 1} 笔(${PIPES} 段填充 + 外环,底槽被填满不必再描),实测 ${strokes(0, PIPES)}`);
  ok(strokes(0.5, PIPES - 1) <= 2 * PIPES + 2, `最忙帧笔数 ${strokes(0.5, PIPES - 1)} 不越预算 2×${PIPES}+2`);
}

// ---------- selftest:修好之前的真实写法必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿旧写法当反例(浓度线性跟随滑杆 / 22 号字写死在圆心 / 弧度排成递增被引擎绕成补集 / 门控基准每帧覆盖 / 文字外挂在键圆外)");
  const S = alphas();
  /** 旧判据:冷却层就是「再乘一次滑杆」 */
  const legacyAlpha = (A: number): number => A;

  /** 旧角度写法(起点 -π/2、终点随 cd 递增)必须被③拦住:引擎把每段 da 绕成补集 */
  const legacyArcs = (cd: number): { pie0: number; pie1: number; ring0: number; ring1: number } => {
    const top = -Math.PI / 2;
    const head = top + cd * Math.PI * 2;
    return { pie0: top, pie1: head, ring0: head, ring1: top + Math.PI * 2 };
  };
  const L75 = legacyArcs(0.75);
  ok(L75.pie1 > L75.pie0 && L75.ring1 > L75.ring0, "旧写法两段弧都是「终点 > 起点」—— 正好踩中引擎的 da 规范化");
  ok(Math.abs(ccSpan(L75.pie0, L75.pie1) - 0.75 * Math.PI * 2) > 1e-6,
    `旧写法@cd=0.75 真正画出的墨底只有 ${(ccSpan(L75.pie0, L75.pie1) / (Math.PI * 2) * 100).toFixed(0)}%(名义 75%)—— 剩余冷却读反了`);
  const N75 = cdArcs(0.75);
  ok(Math.abs(ccSpan(N75.pie0, N75.pie1) - 0.75 * Math.PI * 2) < 1e-9,
    "现在的角度排布在同一个 ccSpan 判据下给出名义跨度");
  ok(N75.pie1 < N75.pie0 && N75.ring1 < N75.ring0 && N75.head1 <= N75.ring0,
    "三段弧全按递减排(新写法在「终点 < 起点」这条判据下干净)");

  const low = S.filter((A) => A <= 0.75);          // 用户报的正是这一带:滑杆调低之后
  const floorViol = low.filter((A) => legacyAlpha(A) < 0.8);
  ok(floorViol.length === low.length,
    `旧写法在滑杆 ${PAD_LIMIT.alphaMin}..0.75 这 ${low.length} 档全部够不到浓度下限(用户报的就是这一带)`);

  const legacyPieLum = (A: number): number => lum(over(
    rgbOf("#000000"), 0.58 * legacyAlpha(A),
    over(rgbOf("#0e121a"), 0.45 * legacyAlpha(A), BG),
  ));
  const worstLegacy = Math.max(...S.map((A) => legacyPieLum(A) / idleLum(A)));
  ok(worstLegacy > 0.4, `旧写法按②的第一条判据要红(最差亮度比 ${worstLegacy.toFixed(3)},几乎压不出阴影)`);
  const worstLive = Math.max(...S.map((A) => pieLum(cdAlpha(A)) / idleLum(A)));
  ok(worstLive <= 0.4, "新写法在同一条判据下干净");

  /** 反例排版:字号写死 22、圆心贴 0(不随半径缩放、不避让键名)—— ④必须拦住这种写法 */
  const rMin = PAD_LIMIT.rMin * CFG.padSkin.scaleMin;
  const nameTop = -rMin * 0.62 + Math.round(CFG.padSkin.labelSize * 1.22) / 2;
  const numBottomLegacy = 0 - 22 * 1.1 / 2;
  ok(numBottomLegacy < nameTop,
    `反例排版@r=${rMin.toFixed(1)}:数字底边 ${numBottomLegacy.toFixed(1)} 压过键名顶边 ${nameTop.toFixed(1)}`);
  const numBottomLive = CD.numY * rMin - Math.max(9, Math.round(rMin * CD.numK)) * 1.1 / 2;
  ok(numBottomLive >= nameTop + 1, "现在的排版在同一条判据下留得住缝");

  /** 旧读数:直接 toFixed(1),最后 50ms 显示 0.0 */
  const legacyText = (sec: number): string => (sec > 0 ? (Math.round(sec * 10) / 10).toFixed(1) : "");
  ok(legacyText(0.04) === "0.0", "旧读数会显示 0.0(看着像已经就绪)");
  ok(cdText(0.04) === "0.1", "新读数同一点显示 0.1");

  /** 反例几何:环位写成固定像素偏移 —— 最小档会顶穿键圆 */
  const fixedRingR = rMin - 1.5 + 6 / 2;
  ok(fixedRingR > rMin, `反例几何@r=${rMin.toFixed(1)}:环外沿 ${fixedRingR.toFixed(1)} 顶出键圆`);
  ok(cdRingR(rMin) + CD.ringW / 2 < rMin, "现在的环位按 ringW 比例内收,最小档也在圆内");

  /** 反例门控(2026-10-03 现场「阴影只能 1/3 地消失」):比较基准 = 上一帧的喂值,
   *  且每帧被无条件覆盖 → stepTol 比的是相邻帧增量 = 1/maxCd,长 CD 全程低于阈值,
   *  扫掠中途永不重画:阴影起手画一次后冻结,只在点按被拒时跳进一截。
   *  结尾就绪翻转的那次强制重画也算给它,中段的冻结照样救不回来 —— ⑥必须拦住。 */
  const legacySweep = (maxCd: number): { repaints: number; maxLag: number } => {
    let prevFed = 0;
    let painted = 0;
    let repaints = 0;
    let maxLag = 0;
    for (let f = 0; f <= maxCd; f++) {
      const ratio = 1 - f / maxCd;
      if (Math.abs(prevFed - ratio) > CD.stepTol) { repaints++; painted = ratio; }
      prevFed = ratio;                       // ← 病根:基准每帧被覆盖
      maxLag = Math.max(maxLag, Math.abs(painted - ratio));
    }
    repaints++;                              // 结尾 skillReady 翻转的强制重画(阴影整块消失)
    return { repaints, maxLag };
  };
  const freezeIds = CFG.skills.list
    .filter((sk) => 1 / sk.cooldownFrames <= CD.stepTol)   // 每帧增量够不着阈值的长 CD
    .map((sk) => sk.id);
  ok(freezeIds.length >= 4, `每帧增量够不着阈值的长 CD 有 ${freezeIds.length} 款(${freezeIds.join(" / ")})`);
  for (const sk of CFG.skills.list.filter((x) => freezeIds.includes(x.id))) {
    const legacy = legacySweep(sk.cooldownFrames);
    ok(legacy.maxLag > CD.stepTol * 4,
      `${sk.id}: 旧门控的屏上滞后峰值 ${legacy.maxLag.toFixed(3)} 远超 stepTol —— ⑥的第一条拦得住`);
    ok(legacy.repaints < 30,
      `${sk.id}: 旧门控整段冷却只重画 ${legacy.repaints} 次(< 30)—— ⑥的第三条也拦`);
  }

  /** 旧写法反例:原因文字挂在键上方 r * 1.42 处,完全超出键圆外 */
  const legacyHintY = 1.42;
  const legacyDist = rMin * legacyHintY;
  ok(legacyDist > rMin, `旧写法@r=${rMin.toFixed(1)}:原因文字距离中心 ${legacyDist.toFixed(1)}px 远超出键圆(${rMin.toFixed(1)}px)—— ⑦必须拦下`);

  // ---------- 蓄能环的两条反例:同一类病在新代码上复发 ----------
  /** 反例 1:角度排成递增序(a1 > a0)。cc 会把 da 绕进 (-2π,0],于是画出来的是**补集**:
   *  充了 20% 键上暗着 80%,读起来就是"这管是反的"。⑧(a) 的第一条判据正是这个形状。 */
  const ascendingFill0 = CD_TOP;
  const ascendingFill1 = CD_TOP + 0.2 * Math.PI * 2;
  const ascActual = ccSpan(ascendingFill0, ascendingFill1);
  const ascNominal = ascendingFill1 - ascendingFill0;
  ok(Math.abs(ascActual - ascNominal) > 1,
    `递增角序反例:名义 ${(ascNominal / 6.283 * 360).toFixed(0)}° 实际画出 ${(ascActual / 6.283 * 360).toFixed(0)}°(补集)—— ⑧(a) 拦得住`);
  // 现写法必须没有这个毛病(同一条判据在正向样本上放行,否则判据是摆设):
  // 多管分段后,取 0 号段内 20% 填充的那笔弧 —— 记录笔抓的是 drawCharge 真画的角度。
  {
    const seg = chargeSegArcs(0, chargePipesMax());
    const tip = seg.a0 - 0.2 * chargeSegSpan(chargePipesMax());
    ok(Math.abs(ccSpan(seg.a0, tip) - 0.2 * chargeSegSpan(chargePipesMax())) < 1e-9,
      "现写法的 20% 段内填充实际就是名义跨度,不是它的补集");
  }

  /** 反例 2:浓度直接乘滑杆原值(旧冷却就是这么被透明度抹掉的)。
   *  滑杆最低 0.2 时环只剩 0.19 浓度,合成到亮场上与就绪态差不到 0.02 亮度 ⇒ 看不见。 */
  const linearA = PAD_LIMIT.alphaMin * CH.ringA;
  const flooredA = cdAlpha(PAD_LIMIT.alphaMin) * CH.ringA;
  const lumLinear = lum(over(rgbOf(CFG.skills.list.find((s) => s.id === "rage")!.accent), linearA, BG));
  const lumFloored = lum(over(rgbOf(CFG.skills.list.find((s) => s.id === "rage")!.accent), flooredA, BG));
  const idle = lum(over(rgbOf(CFG.padSkin.idleFill), CFG.padSkin.idleFillA * PAD_LIMIT.alphaMin, BG));
  ok(Math.abs(lumLinear - idle) < Math.abs(lumFloored - idle),
    `线性浓度反例:与就绪态亮度差 ${Math.abs(lumLinear - idle).toFixed(3)},留下限后 ${Math.abs(lumFloored - idle).toFixed(3)} —— ⑧(c) 拦得住`);
  ok(Math.abs(lumFloored - idle) > 0.02, "现写法在最低滑杆下仍读得出来(差 > 0.02)");
  const liveDist = rMin * (CD.hintY ?? 0.08);
  ok(liveDist < rMin * 0.5, `现在的内嵌文字中心距离仅 ${liveDist.toFixed(1)}px,居中内嵌在按键圆内`);
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
