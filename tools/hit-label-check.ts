// ============================================================
// 击球飘字的**归因闸门** —— game/game-root.ts 的 hit 分支里,只有玩家自己打出来的
// 那一拍才许出字。
//
// 现场(2026-10-27 用户指令):「AI 击球的时候不要弹右侧那些标签,只有玩家击打才触发,
// 不然标签太多了 太乱了」。0.0.16~0.0.17 那轮同类指令(「AI 的特殊击球标签不要显示,
// 只显示玩家的」)是**逐条**加的闸 —— 起手五字、技能命中、跨步、热手、跳杀都挡住了,
// 档位「黄金重扣!!/扣杀!!/好球」与球种小字「平抽/劈吊/放网」漏在闸外,于是对手那一侧
// 每一拍都在长标签。逐条加闸这件事本身就是漏的来源,所以这次把闸收到**唯一出口**上,
// 再用这道 check 把「出口只有一个」钉死。
//
// 为什么扫源码而不是跑对局:接线住在 game/game-root.ts(import cc ⇒ node 里跑不动),
// 而它坏的方式是静默的 —— 多一句 `this.world.float(...)` 不崩、不报错、类型检查全绿,
// 只有真机上对手那边又冒出一列字(出图也看不见:它是逐帧飘字)。
//
// 判据(判据只吃文本,不重新实现一遍 drain):
//   ① hit 分支里不许直接调 world.float / world.floatSys / floatSideLab —— 一律走 hitLabel;
//   ② hitLabel 本体必须有 `e.isAI === true` 早退 —— 归因闸就长在它身上,对手(AI)/
//      CPU 搭档/影分身/喂球机都在里面(影分身 idx=-1,不许按位反查 R.players);
//   ③ 连拍里程碑(★N 拍)是 rally 级的、**两侧都放** ⇒ 必须住在 rallyMilestone 里,
//      不许搬回 hit 分支(搬回去会被 ① 拦 —— 那是刻意的:它走的是另一条出口);
//   ④ 触觉/按键辉光不是字,是「你的操作反馈」⇒ 那两行必须吃 !hitterIsAI。
//
// --selftest:五份反例必须被同一套判据拦下 —— ① 档位字绕过 hitLabel(旧写法)、
//   ② hitLabel 失闸、③ 里程碑搬回分支、④ 触觉失闸、⑤ 锚点失效(判据必须 fail-closed,
//   静默通过是这套断言最坏的死法)。同一份判据对**正确写法**必须零报警。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/hit-label-check.js
//   node .tools-build/tools/hit-label-check.js --selftest
// ============================================================
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { makeChecker } from "./harness";

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/game/game-root.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/game/game-root.ts)");
}
const ROOT = findRoot();
const GAME = join(ROOT, "assets/scripts/game/game-root.ts");

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

/** hit 分支的边界:case 标签到它的下一条 case(hit 与 serve 之间整段就是 hit 的体)。
 *  两个锚点缺一不可 —— 缺了就是判据本身失效,必须报错而不是静默放行。 */
const HIT_BEGIN = 'case "hit": {';
const HIT_END = 'case "serve": {';
/** hit 分支里不许直接出字的调用(击球飘字唯一出口 = hitLabel) */
const SPAWN_CALLS = ["this.world.float(", "this.world.floatSys(", "this.floatSideLab("];
/** 「不是字、但是你的操作反馈」的那两处:各自得吃归因闸 */
const FEEL_CALLS = ["haptic(", "pulseSwing("];
/** 归因闸的两种写法(!hitterIsAI 直判 / ownHit 别名)。注意必须含 `!` ——
 *  `hitterIsAI && haptic(...)` 是把闸装反了,一样要拦。 */
const HUMAN_GUARD = /!hitterIsAI|\bownHit\b/;

/** 源码判据:吃 game-root.ts 原文 + 一个标签,交回问题清单(空 = 通过)。
 *  先剥注释 —— 注释里写「不许调 this.world.float(」是**说明**,不该被算成违规。 */
export function checkHitLabel(raw: string, fileLabel: string): string[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  const i0 = src.indexOf(HIT_BEGIN);
  const i1 = src.indexOf(HIT_END, i0 < 0 ? 0 : i0 + HIT_BEGIN.length);
  if (i0 < 0 || i1 < 0) {
    return [`${fileLabel}:切不出 hit 分支(锚点 ${HIT_BEGIN} → ${HIT_END} 必须都在)—— 判据失效,先看分支是不是被改名/挪走了`];
  }
  const body = src.slice(i0 + HIT_BEGIN.length, i1);

  // ① 唯一出口:hit 分支里不许有任何直接的飘字调用
  for (const call of SPAWN_CALLS) {
    for (let k = body.indexOf(call); k >= 0; k = body.indexOf(call, k + 1)) {
      out.push(`${fileLabel}:hit 分支里直接调 ${call}… —— 击球飘字只许走 hitLabel(它自带归因闸),旧写法就是这么漏了对手那一侧的`);
    }
  }

  // ② 出口自己必须带闸
  const h0 = src.indexOf("private hitLabel(");
  if (h0 < 0) {
    out.push(`${fileLabel}:找不到 hitLabel —— 击球飘字的唯一出口没了,归因又散回各调用点(下一条新标签就是下一次漏)`);
  } else {
    const h1 = src.indexOf("\n  }", h0);
    const hb = src.slice(h0, h1 < 0 ? src.length : h1);
    if (!/e\.isAI === true/.test(hb) || !/\breturn\b/.test(hb)) {
      out.push(`${fileLabel}:hitLabel 缺「e.isAI === true → return」的早退 —— 对手/CPU 搭档/影分身/喂球机又会飘字`);
    }
  }

  // ③ rally 级里程碑必须住自己的出口(搬回 hit 分支会被 ① 拦)
  if (!/private rallyMilestone\(/.test(src)) {
    out.push(`${fileLabel}:找不到 rallyMilestone —— 连拍里程碑(★N 拍)是 rally 级的两侧字,它该住在自己的出口里`);
  }

  // ④ 触觉/按键辉光:不是字,但同样是「只给自己的拍」。闸要么在同一行
  //    (`if (hk && !hitterIsAI) haptic(hk);`),要么在紧邻上一行的 if 头上
  //    (`if (!hitterIsAI && (sweet || perfect)) {` 然后换行调用)—— 两种都是本文件的写法。
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!FEEL_CALLS.some((c) => t.includes(c))) continue;
    let guarded = HUMAN_GUARD.test(t);
    if (!guarded) {
      // 向上看最近的一条非空行:它得是 `if (…闸…) {` 这样的头部
      for (let j = i - 1; j >= 0; j--) {
        const p = lines[j].trim();
        if (!p) continue;
        guarded = /if\s*\(/.test(p) && HUMAN_GUARD.test(p);
        break;
      }
    }
    if (!guarded) {
      out.push(`${fileLabel}:${t.slice(0, 72)} —— 触觉/按键辉光是「你的操作反馈」,必须吃 !hitterIsAI(对手打出来的好球不该震你/亮你的键)`);
    }
  }
  return out;
}

// ---------- 正题:真实源码 ----------
const issues = checkHitLabel(readFileSync(GAME, "utf8"), "game-root");
ok(issues.length === 0, `hit 分支的击球飘字只从 hitLabel 出,且它自带归因闸(问题 ${issues.length} 条)`);
for (const s of issues) console.log(`   · ${s}`);

// ---------- selftest:五份反例 + 一份正样本 ----------
/** 与 game-root 同构的最小样本(锚点 / 唯一出口 / 里程碑出口 / 两处非字反馈),
 *  反例都是在这份**正确写法**上做手术得来的 —— 有正样本才证明判据有放行的一侧。 */
const GOOD = `
  private hitLabel(e: GameEvent, lab: FloatLabel | null | undefined, anchor: "side" | "ball" = "side"): void {
    if (!lab || e.isAI === true) return;
    const x = e.x as number, y = e.y as number;
    if (anchor === "side") this.floatSideLab(lab, x);
    else this.world.float(x, y + (lab.dy ?? -22), lab.text, lab.color, lab.size, lab.life, -1, lab.plate);
  }

  private rallyMilestone(e: GameEvent): void {
    if (e.rally === 6) this.world.float(C.world.w / 2, 72, "★ 6 拍激烈相持! ★", "#ffe14d", 18, 38);
  }

  private drain(): void {
    for (const e of R.events) {
      switch (e.t) {
        case "hit": {
          const hitterIsAI = e.isAI === true;
          const hk = shotKey(smash, sweet, perfect);
          if (hk && !hitterIsAI) haptic(hk);
          if (!hitterIsAI && (sweet || perfect)) {
            touchPad.pulseSwing(perfect ? "perfect" : "sweet");
          }
          this.hitLabel(e, K.floatTierGood);
          this.rallyMilestone(e);
          break;
        }
        case "serve": {
          this.world.floatSys(C.world.w / 2, 60, "高远发球", "#c0d8ff", 16, 36);
          break;
        }
      }
    }
  }
`;

if (process.argv.includes("--selftest")) {
  console.log("\nselftest:五份反例必须被同一套判据拦下");

  ok(checkHitLabel(GOOD, "样本").length === 0, "正样本(唯一出口 + 归因闸 + 里程碑出口)零报警");

  // 反例 A(旧写法,0.0.17 那轮):档位字直接出字,不经过出口 ⇒ 对手那一侧又长字
  const badA = GOOD.replace("this.hitLabel(e, K.floatTierGood);",
    "if (lab) this.floatSideLab(lab, e.x as number);");
  ok(badA !== GOOD && checkHitLabel(badA, "反例A").length > 0, "反例A 档位字绕过 hitLabel —— 被拦");

  // 反例 B:出口失闸(归因闸被删 = AI/分身/喂球机全体复活)
  const badB = GOOD.replace("if (!lab || e.isAI === true) return;", "if (!lab) return;");
  ok(badB !== GOOD && checkHitLabel(badB, "反例B").length > 0, "反例B hitLabel 缺 isAI 早退 —— 被拦");

  // 反例 C:里程碑搬回 hit 分支(旧形状:没有 rallyMilestone,★N 拍直接住在分支里)
  const badC = GOOD
    .replace(/  private rallyMilestone\(e: GameEvent\): void \{[\s\S]*?\n  \}\n/, "")
    .replace("this.rallyMilestone(e);", 'this.world.float(C.world.w / 2, 72, "★ 6 拍激烈相持! ★", "#ffe14d", 18, 38);');
  ok(badC !== GOOD && checkHitLabel(badC, "反例C").length > 0, "反例C 里程碑搬回 hit 分支 —— 被拦");

  // 反例 D:触觉失闸(每拍都在嗡嗡 = 什么都读不出来)
  const badD = GOOD.replace("if (hk && !hitterIsAI) haptic(hk);", "if (hk) haptic(hk);");
  ok(badD !== GOOD && checkHitLabel(badD, "反例D").length > 0, "反例D 触觉不吃 isAI 闸 —— 被拦");

  // 反例 E:锚点失效 —— 判据必须 fail-closed(静默全绿是这套断言最坏的死法)
  const badE = GOOD.replace('case "hit": {', 'case "swing": {');
  ok(badE !== GOOD && checkHitLabel(badE, "反例E").length > 0, "反例E 分支锚点找不到 —— 报错而不是静默放行");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);