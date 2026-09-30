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
// 断言分五段,判据全是能在真机变成「看不见东西」的那类:
//   ① 滑杆全程(0.2..1.0):冷却浓度有下限、单调不减、不越 1;
//   ② 亮度对比 —— 按引擎真实的 sRGB 逐通道合成算:冷却态必须比就绪态压得下去,
//      而进度环与数字必须在墨底上提得起来(旧写法在②的第一条就红);
//   ③ 扫掠几何:扇形 + 环恒等于整圈、随剩余冷却单调、最小档上半径仍落在键圆内侧;
//   ④ 键心排版:字号随半径缩放、与键名标签不打架、不出圆(半径取最小档时最容易撞);
//   ⑤ 读数内容:冷却中永不显示 0.0、就绪时不显示、五款技能的起手读数与专属色齐活。
// 另带 --selftest:拿修好之前的真实写法当反例,断言它**会**被报警 ——
// 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/pad-cd-check.js
//   node .tools-build/tools/pad-cd-check.js --selftest
// ============================================================
import {
  CD, CD_TOP, cdAlpha, cdArcs, cdRingR, cdText, skillAccent,
} from "../assets/scripts/input/pad-cd";
import { CFG } from "../assets/scripts/core/config";
import { PAD_BASE, PAD_LIMIT } from "../assets/scripts/core/settings";
import { textW } from "../assets/scripts/ui/text-metrics";

let fails = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${msg}`); } else { console.log(`  ✓ ${msg}`); }
}

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

console.log("技能键冷却读数:浓度下限 / 亮度对比 / 扫掠几何 / 键心排版 / 倒计时读数\n");

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

// ---------- selftest:修好之前的真实写法必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿旧写法当反例(浓度线性跟随滑杆 / 22 号字写死在圆心 / 弧度排成递增被引擎绕成补集)");
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
}

console.log(`\n${fails === 0 ? "✓" : "✗"} ${checks} 项断言,失败 ${fails}`);
process.exit(fails === 0 ? 0 : 1);
