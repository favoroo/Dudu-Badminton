// ============================================================
// 场边飘字「车道分配」回归 —— 防的是用户报的那个现场:
// 「同时触发多个特殊击打(跳杀+重击附魔),左侧的标签会重叠」。
//
// 根因不是标签多了,是旧错行只数条数且 Math.min(n,2) 封顶两行 —— 一拍最多
// 同帧出生四条场边字(档位+技能+跳杀+热手),第 3、4 条叠回同一点;行高还
// 只看新字自己的 size*1.9。现在分配逻辑在 assets/scripts/render/float-lane.ts
// (零 cc 纯函数),这里断言:
//   1) 最坏同帧四条(30star+30star+26+21 全左侧)两两占位盒不交,且全部压在
//      地面线上方的限额内(第 4 条允许轻微探过地面线,好过叠字);
//   2) 混合尺寸(先小后大 / 先大后小)按各自盒高排,不叠;
//   3) 左右侧互不干扰;
//   4) 非成员(头顶起手字 laneH=0)与已隐藏的字不占行;
//   5) 旧字上浮过锚点后,新字回锚点行(堆叠从锚点重新开始)。
// 另带 --selftest:拿旧算法(计数 + min(n,2) + size*1.9)当反例,断言它
// **会**被同一个重叠探测器报警 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/float-lane-check.js
// ============================================================
import { makeChecker } from "./harness";
import { nextLaneY, type LaneRecord } from "../assets/scripts/render/float-lane";
import { CFG } from "../assets/scripts/core/config";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const FX = CFG.fx;
const ANCHOR = FX.floatSide.y;
const NETX = CFG.court.netX;
const GROUND = CFG.court.groundY;
const GAP = FX.floatLaneGap ?? 8;

/** 占位盒两两求交(世界 y 向下,盒 = [y-h/2, y+h/2]) */
function overlapPairs(placed: { y: number; h: number }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1e-9) out.push(`#${i + 1}×#${j + 1}`);
    }
  }
  return out;
}

/** 模拟 world.floatSpawn 的堆叠语义:laneH = size*1.7,成员才进 records */
const boxH = (size: number): number => size * 1.7;
const maxCenter = (size: number): number => GROUND - size * 0.6;
function spawn(records: LaneRecord[], wx: number, size: number): { y: number; h: number } {
  const y = nextLaneY(records, { wx, netX: NETX, anchorY: ANCHOR, boxH: boxH(size), gap: GAP, maxCenter: maxCenter(size) });
  records.push({ active: true, wx, wy: y, laneH: boxH(size) });
  return { y, h: boxH(size) };
}

console.log("场边飘字车道分配:不叠 / 不入地 / 两侧独立\n");

// ---------- ① 锚点数值钉住(下面所有期望值都从它们推出来) ----------
ok(ANCHOR === 298, `floatSide.y == 298(实得 ${ANCHOR};改了要同步这里的期望值)`);
ok(GROUND === 470, `court.groundY == 470(实得 ${GROUND})`);
ok(GAP === 8, `floatLaneGap == 8(实得 ${GAP})`);

// ---------- ② 最坏同帧四条:档位 star30 + 技能 star30 + 跳杀26 + 热手21,全左侧 ----------
{
  const records: LaneRecord[] = [];
  const l1 = spawn(records, 100, 30);
  const l2 = spawn(records, 100, 30);
  const l3 = spawn(records, 100, 26);
  const l4 = spawn(records, 100, 21);
  const all = [l1, l2, l3, l4];
  ok(l1.y === ANCHOR, `第 1 条落在锚点行 ${ANCHOR}(实得 ${l1.y})`);
  const ov = overlapPairs(all);
  ok(ov.length === 0, `四条占位盒两两不交${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  ok(l1.y < l2.y && l2.y < l3.y && l3.y < l4.y,
    `四条行位严格递减向下(${all.map((p) => p.y.toFixed(1)).join(" < ")})`);
  ok(l4.y === maxCenter(21), `第 4 条被夹在地面线上方限额 ${maxCenter(21)}(实得 ${l4.y})`);
  ok(all.every((p) => p.y + p.h / 2 < GROUND + 0.25 * 21 + 1e-9),
    "占位盒最多探过地面线 ~0.25 字高,不会排进球场地面深处");
}

// ---------- ③ 混合尺寸:先小后大 / 先大后大都不叠 ----------
{
  const records: LaneRecord[] = [];
  const s1 = spawn(records, 100, 16);   // 「好球」
  const s2 = spawn(records, 100, 30);   // 随后一条 star
  ok(overlapPairs([s1, s2]).length === 0, `小字(16)后跟大字(30)不叠(行距 ${(s2.y - s1.y).toFixed(1)})`);
  const records2: LaneRecord[] = [];
  const b1 = spawn(records2, 100, 30);
  const b2 = spawn(records2, 100, 16);
  ok(overlapPairs([b1, b2]).length === 0, `大字(30)后跟小字(16)不叠(行距 ${(b2.y - b1.y).toFixed(1)})`);
  ok(Math.abs(b2.y - b1.y - (8 + boxH(30) / 2 + boxH(16) / 2)) < 1e-9, "行距 = 前行盒高/2 + gap + 自身盒高/2(按前行实际占位算,不再用新字行高)");
}

// ---------- ④ 左右侧互不干扰 ----------
{
  const records: LaneRecord[] = [];
  spawn(records, 100, 30);
  spawn(records, 100, 30);
  spawn(records, 100, 26);
  const right = spawn(records, 860, 30);
  ok(right.y === ANCHOR, `右侧第一条不受左侧三条影响,回锚点行(实得 ${right.y})`);
}

// ---------- ⑤ 非成员(laneH=0)与已隐藏的字不占行 ----------
{
  const withNoise: LaneRecord[] = [];
  spawn(withNoise, 100, 30);
  spawn(withNoise, 100, 30);
  spawn(withNoise, 100, 26);
  withNoise.push({ active: false, wx: 100, wy: 1000, laneH: boxH(30) });   // 已隐藏的幽灵
  withNoise.push({ active: true, wx: 100, wy: 1000, laneH: 0 });           // 头顶起手字(非成员)
  const clean: LaneRecord[] = [];
  spawn(clean, 100, 30);
  spawn(clean, 100, 30);
  spawn(clean, 100, 26);
  const n4 = spawn(withNoise, 100, 21);
  const c4 = spawn(clean, 100, 21);
  ok(n4.y === c4.y, `幽灵字与非成员字不把后到的行推下去(${n4.y} == ${c4.y})`);
}

// ---------- ⑥ 旧字上浮过锚点后,新字回锚点行 ----------
{
  const records: LaneRecord[] = [{ active: true, wx: 100, wy: ANCHOR - 98, laneH: boxH(16) }];
  const y = nextLaneY(records, { wx: 100, netX: NETX, anchorY: ANCHOR, boxH: boxH(30), gap: GAP, maxCenter: maxCenter(30) });
  ok(y === ANCHOR, `旧字已浮到锚点上方,新字回锚点行而不是跟着往上排(实得 ${y})`);
}

// ---------- ⑦ selftest:旧算法(计数 + min(n,2) + size*1.9)必须被同一个探测器拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:旧错行算法当反例");
  /** 旧 world.floatSpawn:数同侧带板字条数,行位 = 锚点 + min(n,2)*size*1.9 */
  const legacySpawn = (placed: { y: number; h: number; plated: boolean }[], size: number): { y: number; h: number; plated: boolean } => {
    let n = 0;
    for (const o of placed) if (o.plated) n++;
    return { y: ANCHOR + Math.min(n, 2) * size * 1.9, h: size * 1.7, plated: true };
  };
  // 等字号四连:第 3、4 条 y 完全相同 —— 旧现场「叠回同一点」的最直观复现
  const eq: { y: number; h: number; plated: boolean }[] = [];
  for (let i = 0; i < 4; i++) eq.push(legacySpawn(eq, 26));
  ok(eq[2].y === eq[3].y, `等字号时第 3、4 条 y 完全相同(${eq[2].y})—— 叠回同一点`);
  ok(overlapPairs(eq).length > 0, "旧算法等字号四连被探测器报警");
  // 真实最坏组合(30/30/26/21):行高只看新字,倒挂成 355 → 396.8 → 377.8
  const burst: { y: number; h: number; plated: boolean }[] = [];
  for (const s of [30, 30, 26, 21]) burst.push(legacySpawn(burst, s));
  const legacyOv = overlapPairs(burst);
  ok(legacyOv.length >= 2, `旧算法真实四连被报警 ${legacyOv.length} 处(${legacyOv.join(" / ")})`);
  // 同一个探测器下,新算法干净
  const records: LaneRecord[] = [];
  const now = [spawn(records, 100, 30), spawn(records, 100, 30), spawn(records, 100, 26), spawn(records, 100, 21)];
  ok(overlapPairs(now).length === 0, "同一探测器下新算法零报警");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
