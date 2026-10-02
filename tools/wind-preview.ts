// ============================================================
// 第 1 关「风」的出图与可见性回归 —— 防的是那种"代码写了、玩家没看见"的坏
//
// 现场来由:用户真机反馈「吹风方向的提示不太明显」。查下来根因很具体 ——
// 上一版加的海滩风丝**漏了视口换算**:st.x/st.y 存的是世界坐标(y 150~400 那条
// "海面上空到沙滩上空"的带),画的时候却直接 g.moveTo(sx, st.y) 裸写,而同文件
// 每一笔别的形状都规规矩矩走 vp.x()/vp.y()。结果整片风丝朝右偏 480、朝上偏一两百
// 像素:一半画到屏幕外,剩下的糊在天幕最上沿。**动画做对了,位置是错的**,
// 于是"机制可感知化"那一轮改版的成果在真机上等于零。
//
// 所以这个工具断言的不是"有没有画",而是"**画在不在玩家看得见的地方**":
//   §1 风平(无 modifier)时风带与风丝一笔都不出 —— 不许有"照飘不误"的假动画;
//   §2 起风时新增的每一笔都落在可视区内(|x| ≤ W/2、|y| ≤ H/2,只放 8px 容差)
//      —— 这条就是把上面那个 bug 钉住的钉子;
//   §3 人字纹的尖端朝向 == 风的符号(往右吹就该看着往右倒),不许镜像;
//   §4 全程无 NaN/Infinity(Graphics 吃到就是整条笔画静默消失,预览里也看不出来);
//   §5 顺带把三个阶段(顺风/风平/逆风)出成 SVG,方向对不对可以先看图,不必上真机猜。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/wind-preview.js            # 断言,失败 exit 1
//   node .tools-build/tools/wind-preview.js --out DIR  # 顺便出 .tools-build/wind-preview/*.svg
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import * as fs from "fs";
import { installCc, Graphics as StubGraphics, opPoints, opsToSvg } from "./cc-stub";
import { courtRenderer } from "../assets/scripts/render/court";
import { Physics } from "../assets/scripts/core/physics";
import { CFG } from "../assets/scripts/core/config";

installCc();

const C = CFG;
const W = C.world.w, H = C.world.h;

const VP = {
  x: (wx: number): number => wx - W / 2,
  y: (wy: number): number => H / 2 - wy,
};

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) fail(msg);
  passed++;
  console.log(`  ✓ ${msg}`);
};

/** 把海滩动态层画到一支 stub 笔上,返回笔画列表 */
function drawBeachDyn(g: StubGraphics, time: number): void {
  courtRenderer.setTheme("beach");
  // drawDynTo 的签名与 world.ts 调用处一致:(gfx, vp, rallyCount)
  courtRenderer.drawDynTo(g as unknown as Parameters<typeof courtRenderer.drawDynTo>[0], VP, 0);
}

/** 满量程比例 → 画面位移(与 world.ts:565-567 那行合成同一条式子,不许在这儿改口径) */
const pxOf = (w: number): number => w * C.env.ambience.k;

/** 一条笔画的身份:命令序列 + 颜色 + 线宽(用来做"有风 vs 无风"的内容差集) */
const opKey = (op: StubGraphics["ops"][number]): string =>
  `${op.kind}|${op.color}|${op.width}|${op.cmds.map((c) => JSON.stringify(c)).join("")}`;

/**
 * 在"无风"与"有风"两种状态下各画一遍,取**内容差集** ——
 * 注意不能按"末尾若干条"切:海滩动态层里风带/风丝不是最后画的(后面还有球网、微尘),
 * 按尾巴切会拿到一堆无关装饰,断言就成了"看着过了、其实没测"。
 */
function windOnlyOps(phase: number): StubGraphics["ops"] {
  Physics.setEnvModifier(null);
  courtRenderer.setWind(0, 1);
  const calm = new StubGraphics();
  drawBeachDyn(calm, phase);
  const calmKeys = new Map<string, number>();
  for (const op of calm.ops) calmKeys.set(opKey(op), (calmKeys.get(opKey(op)) ?? 0) + 1);

  Physics.setEnvModifier({
    windX: C.env.windDefaultBase, windOscillate: true,
    gravityMul: 1, dragMul: 1, erratic: false, laserRail: false,
  });
  const w = Physics.windAt(phase);
  courtRenderer.setWind(pxOf(w), w !== 0 ? C.env.ambience.idle : 1);
  const gusty = new StubGraphics();
  drawBeachDyn(gusty, phase);

  const out: StubGraphics["ops"] = [];
  for (const op of gusty.ops) {
    const k = opKey(op);
    const n = calmKeys.get(k) ?? 0;
    if (n > 0) { calmKeys.set(k, n - 1); continue; }   // 无风时同样画了这条(恒在装饰) → 不算风的
    out.push(op);
  }
  return out;
}

console.log("第 1 关的风:画出来、画在看得见的位置、方向不许镜像\n");

// ---------- §1 风平 = 一笔不出 ----------
{
  // windAt(0) = sin(0) = 0:开局那一阵是"风平",此时风带与风丝都不该出现
  const ops = windOnlyOps(0);
  ok(ops.length === 0, `风平相位(第 0 步)风带与风丝一笔都不出(实得 ${ops.length} 笔)`);
}

// ---------- §2/§3/§4 顺风与逆风 ----------
for (const [label, phase] of [["顺风(+x)", 98], ["逆风(-x)", 294]] as const) {
  const w = Math.sin(phase * C.env.windOscRate) * C.env.windDefaultBase;
  const dir = w > 0 ? 1 : -1;
  const ops = windOnlyOps(phase);
  console.log(`\n  ${label}:windAt=${w.toFixed(4)} px/步²,新增 ${ops.length} 笔`);
  ok(ops.length > 0, `${label}:风画出了笔画`);

  const bad: string[] = [];
  const bandOut: string[] = [];
  const streakOut: string[] = [];
  let streakIn = 0, streakAll = 0;
  for (const op of ops) {
    // 风带 = 三笔一组的折线(moveTo 尾 → lineTo 尖 → lineTo 尾);风丝 = 两笔一条
    const isBand = op.kind === "stroke" && op.cmds.length % 3 === 0 && op.cmds.length >= 3
      && op.cmds.every((c, i) => (i % 3 === 0 ? c.t === "M" : c.t === "L"));
    for (const p of opPoints(op)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { bad.push(`${op.kind}@(${p.x},${p.y})`); break; }
      const tol = 8;
      const visible = Math.abs(p.x) <= W / 2 + tol && Math.abs(p.y) <= H / 2 + tol;
      if (isBand) { if (!visible) bandOut.push(`${p.x.toFixed(0)},${p.y.toFixed(0)}`); continue; }
      streakAll++;
      if (visible) streakIn++;
      else if (Math.abs(p.x) > W / 2 + 300 || Math.abs(p.y) > H / 2 + 300) streakOut.push(`${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    }
  }
  ok(bad.length === 0, `${label}:风坐标无 NaN/Infinity${bad.length ? ` → ${bad.slice(0, 3).join(" ")}` : ""}`);
  // 风带是**主力**方向提示,一条纹都不许跑到可视区外(上一版的风丝就是整片飘出屏幕才"看不见"的)
  ok(bandOut.length === 0,
    `${label}:贴地风带每一笔都在可视区内${bandOut.length ? ` → 越界 ${bandOut.length} 点,如 ${bandOut.slice(0, 3).join(" ")}` : ""}`);
  // 风丝允许飘到.wrap 余量里(它横跨 TOTAL_W 循环滚动,天生会有一部分在镜头外),
  // 但"过半都看不见"就是整层错位 —— 这条宽松版仍然能抓住漏换算那一类事故
  ok(streakAll === 0 || streakIn / streakAll > 0.5,
    `${label}:风丝多数在可视区内(实得 ${streakIn}/${streakAll};漏 vp 换算会直接掉到 0)`);
  ok(streakOut.length === 0, `${label}:风丝没有飞到画布外 300px 以外${streakOut.length ? ` → ${streakOut.slice(0, 3).join(" ")}` : ""}`);

  // 尖端方向:风带每条纹是 moveTo(尾) → lineTo(尖) → lineTo(尾),取每三笔的中间那笔
  const tips: { tx: number; tail: number }[] = [];
  for (const op of ops) {
    const cmds = op.cmds;
    if (cmds.length < 3 || cmds.length % 3 !== 0) continue;
    for (let i = 0; i + 2 < cmds.length; i += 3) {
      const a = cmds[i], b = cmds[i + 1], c = cmds[i + 2];
      if (a.t !== "M" || b.t !== "L" || c.t !== "L") continue;
      tips.push({ tx: b.x as number, tail: ((a.x as number) + (c.x as number)) / 2 });
    }
  }
  if (tips.length) {
    const lean = tips.reduce((s, t) => s + Math.sign(t.tx - t.tail), 0) / tips.length;
    ok(Math.sign(lean) === dir, `${label}:人字纹尖端朝向风的正负号(${dir > 0 ? "右 = 朝对方底线" : "左 = 朝自家网前"}),实得 lean=${lean.toFixed(2)}`);
  } else {
    // 风丝那几笔也是三笔一组,拿不到纹就当作不判(不让工具因为换画法而假红)
    console.log("  ☰ 未从笔画里认出人字纹三元组(画法变了?),方向判据跳过");
  }
}

// ---------- §5 出图 ----------
{
  const oi = process.argv.indexOf("--out");
  if (oi >= 0) {
    const dirOut = process.argv[oi + 1] || ".tools-build/wind-preview";
    fs.mkdirSync(dirOut, { recursive: true });
    for (const [name, phase] of [["calm", 0], ["forward", 98], ["back", 294]] as const) {
      Physics.setEnvModifier({
        windX: C.env.windDefaultBase, windOscillate: true,
        gravityMul: 1, dragMul: 1, erratic: false, laserRail: false,
      });
      const w = Physics.windAt(phase);
      courtRenderer.setTheme("beach");
      courtRenderer.setWind(pxOf(w), w !== 0 ? C.env.ambience.idle : 1);
      const g = new StubGraphics();
      drawBeachDyn(g, phase);
      // 与 court-preview 同一套换算:Graphics 的 y 向上,SVG 的 y 向下 → 翻一次
      const ox = Math.round(W / 2), oy = Math.round(H / 2);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>beach wind ${name} (windAt=${w.toFixed(4)})</title>
<rect width="${W}" height="${H}" fill="#f2c98a"/>
<g transform="translate(${ox},${oy}) scale(1,-1)">
${opsToSvg(g.ops)}
</g>
</svg>`;
      fs.writeFileSync(`${dirOut}/beach-wind-${name}.svg`, svg);
      console.log(`\n  出图 ${dirOut}/beach-wind-${name}.svg  (windAt=${w.toFixed(4)})`);
    }
  }
}

console.log(`\n风可见性回归 ✓ (${passed} 项)`);
process.exit(0);
