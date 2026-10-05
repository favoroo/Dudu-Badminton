// ============================================================
// 渲染副本「跨实体残留」闸门 —— 防的是用户 2026-10-05 报的这条:
// 「AI 的皮肤是不是有问题?怎么是蓝色的原皮加上另一个皮肤的发型」。
//
// 现场截图:对练里 AI 穿着蓝球衣(阵营色,对的),头上却顶着一头烈焰少年的橙发,
// 胸前还多一道斜披巾。「你」装备的是烈焰少年 ⇒ 装扮从真人身上跑到了 CPU 身上。
//
// 根因不在皮肤表、不在 career,在 world 的**入参副本**:渲染要把 px/py 插值成帧间
// 位置又不许回写 core,于是每帧 Object.assign 一份副本再改 x/y。从前整个球场共用
// **同一个**副本对象,而 Object.assign 只拷「源对象自己有的键」:
//   playerSkin / racketSkin / faceSkin 是可选字段 —— player.create() 从不建键,
//   只有 career.applyToMatch() 把它们挂在「你」(players[0] 且非 AI)身上。
//   ⇒ 轮到 CPU 那一帧,这三个键没有任何人覆盖,上一名球员留下的皮肤就还在对象上,
//     被 drawPlayer 原封不动读走。绘制顺序是「离网远的先画」(byNetDist),
//     所以**先画的那个恒然后画的那个的装扮**;2v2 会串得更远,传说法阵会套到对手脚下。
//
// 同一个副本还顺带弄死了第二条:副本不是实体,所以 sprites 里 `ball.owner === p`
// 这类身份比较在对局里恒假 —— 发球托球姿势(serveHold)只在商店/出图里出现过,
// 真机从来没亮过。修法:副本挂 viewSrc 回指实体,比较走 entityOf() 那一跳。
//
// 判定:
//   ① 行为(真数据):用 player.create() 造「挂皮肤的真人 + 不挂的 CPU」,按真机
//      的绘制顺序连跑若干帧 —— CPU 的副本里不许出现任何皮肤键,真人的必须齐全;
//      再叠 2v2 与影分身实体,确认键的形状恒跟人走。
//   ② 身份:entityOf(副本) === 实体;entityOf(实体) === 实体(商店/出图那条路)。
//   ③ 源闸门 world.ts:三处 draw* 调用的入参(按实参位扫,不认变量名)必须绑自
//      viewOf();文件里不许再出现 Object.assign(副本一律走 viewOf,这条最省事也
//      最难绕);不许再有 `xxxView = {}` 形状的共享字段。
//   ④ 源闸门 sprites.ts:每一处 `ball.owner ===` 都必须比到 self/entityOf 上。
//
// --selftest:① 的旧形状(共享一个 {} + Object.assign)必须真的复现污染 —— 否则
// 这套判据是自欺;③④ 各喂一份改动前的源码片段,必须报警;正例片段必须全绿。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/view-leak-check.js
//   node .tools-build/tools/view-leak-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Player as Pl } from "../assets/scripts/core/player";
import { CFG } from "../assets/scripts/core/config";
import { viewOf, entityOf, type View } from "../assets/scripts/render/view-cache";
import type { Player, Theme } from "../assets/scripts/core/types";

/** 从 __dirname 向上找工程根(认这块招牌文件,避免选中 .tools-build 镜像) */
function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/render/view-cache.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/render/view-cache.ts)");
}

const ROOT = findRoot();
const selftest = process.argv.includes("--selftest");
const h = makeChecker({ printPass: true });

/** career.applyToMatch 会挂到「你」身上的那几个可选字段 —— 泄漏的就这三个键 */
const SKIN_KEYS = ["playerSkin", "racketSkin", "faceSkin"] as const;

const flame = CFG.skins.player.find((s) => s.id === "p-flame")!;      // 烈焰少年:发型 + 斜披巾
const rose = CFG.skins.racket.find((s) => s.id === "r-rose")!;        // 带颜色的拍框
const RED: Theme = { name: "red", main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a" };
const BLUE: Theme = { name: "blue", main: "#3ea6ff", dark: "#1c5caa", glow: "#9fd0ff" };

/** 真机口径:create() 出来的名单里只有真人被 applyToMatch 挂了皮肤 */
function mkRoster(): Player[] {
  const netX = CFG.court.netX;
  const me = Pl.create("left", { theme: RED, jersey: "01" });
  me.playerSkin = flame; me.racketSkin = rose;
  me.faceSkin = { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" };
  const cpu = Pl.create("right", { isAI: true, theme: BLUE, jersey: "07" });
  // 站位照截图来:CPU 离网更远 ⇒ 它先画,于是穿上"后画的那个"的装扮
  me.x = netX - 260; cpu.x = netX + 345;
  return [me, cpu];
}

// ---------- ① 行为:按真机的绘制顺序连跑,副本里的键必须恒跟实体同形状 ----------
/** 与 world.byNetDist 同序:离网远的先画(串染的方向因此固定是"后画染先画") */
function drawOrder(players: Player[], netX: number): Player[] {
  return players.slice().sort((a, b) => Math.abs(netX - b.x) - Math.abs(netX - a.x));
}

/** 跑 FRAMES 帧,返回「每个实体的副本上多出来的皮肤键」 */
function runFrames(players: Player[], shared: boolean, frames = 3): string[] {
  const cache = new WeakMap<Player, View<Player>>();
  const one = {} as Player;                       // 旧形状:全场共用一个副本
  const bad: string[] = [];
  for (let i = 0; i < frames; i++) {
    for (const p of drawOrder(players, CFG.court.netX)) {
      const v = shared ? Object.assign(one, p) : viewOf(cache, p);
      v.x = p.x + i * 0.5;                        // 渲染只做这件事
      for (const k of SKIN_KEYS) {
        const has = (v as unknown as Record<string, unknown>)[k] !== undefined;
        const should = (p as unknown as Record<string, unknown>)[k] !== undefined;
        if (has !== should) bad.push(`${p.side}${p.idx}/${p.isAI ? "CPU" : "me"}#${i}:${k}`);
      }
    }
  }
  return bad;
}

const roster = mkRoster();
h.ok(roster[0].playerSkin !== undefined
  && (roster[1] as unknown as Record<string, unknown>).playerSkin === undefined,
  "前提:create() 不给 CPU 建皮肤键(泄漏的地基;哪天 create() 补了 null 键,这条判据要跟着换口径)");
h.ok(runFrames(roster, false).length === 0, "① 一人一份副本:CPU 读不到真人的 playerSkin/racketSkin/faceSkin");

// 2v2 + 影分身:四个实名 + 三个分身同屏,串染面更大,一并量
const wide: Player[] = [];
for (let i = 0; i < 4; i++) {
  const p = Pl.create(i < 2 ? "left" : "right", { isAI: i >= 2, theme: i < 2 ? RED : BLUE, jersey: `0${i}` });
  if (i === 0) { p.playerSkin = flame; p.racketSkin = rose; }
  if (i === 1) { p.playerSkin = CFG.skins.player.find((s) => s.id === "p-king")!; }   // 带法阵的传说款
  wide.push(p);
}
const host = wide[0];
for (let s = 0; s < 3; s++) {
  const c = Pl.create("left", { isAI: true, theme: { ...RED, glow: CFG.skills.shadow.slots[s].tint } });
  c.idx = -1;
  wide.push(c);
}
h.ok(runFrames(wide, false).length === 0, "① 2v2 + 满编影分身同屏:每个人的副本只带自己的键(法阵不会套到对手脚下)");

// 实体整批重建(下一局)不该被上一局的副本形状污染
h.ok(runFrames(mkRoster(), false).length === 0, "① 换局重建名单:新实体拿到干净副本");

// ---------- ② 身份:副本必须回指实体 ----------
const idCache = new WeakMap<Player, View<Player>>();
const meView = viewOf(idCache, roster[0]);
h.ok(entityOf(meView) === roster[0], "② entityOf(副本) === 实体(发球托球那两处身份比较才成立)");
h.ok(entityOf(roster[1]) === roster[1], "② entityOf(实体) === 实体(商店/出图直接传实体的那条路)");
h.ok(viewOf(idCache, roster[0]) === meView, "② 同一实体恒拿同一个副本对象(不每帧 new,GC 治理不反弹)");

// ---------- ③ world.ts 源闸门 ----------
/** 抠出某个调用名的全部调用,返回实参数组(按逗号切,尊重嵌套括号) */
function callArgs(src: string, callee: string): string[][] {
  const out: string[][] = [];
  for (let i = src.indexOf(callee + "("); i >= 0; i = src.indexOf(callee + "(", i + 1)) {
    if (i > 0 && /[\w.]/.test(src[i - 1])) continue;         // 跳过 drawPlayerXxx / x.drawPlayer
    let depth = 0, cur = "", args: string[] = [];
    for (let j = i + callee.length; j < src.length; j++) {
      const ch = src[j];
      if (ch === "(") { depth++; if (depth === 1) continue; }
      else if (ch === ")") { depth--; if (depth === 0) { args.push(cur); break; } }
      else if (ch === "," && depth === 1) { args.push(cur); cur = ""; continue; }
      if (depth >= 1) cur += ch;
    }
    out.push(args.map((a) => a.trim()));
  }
  return out;
}

/** 抠掉注释:闸门要看的是代码,不是"文件里有人写过这句话"
 *  (踩中现场:修好之后 sprites 的注释里引用了旧写法 `ball.owner === p`,正则把它当现行犯了) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** world.ts:三处 draw* 的入参必须绑自 viewOf();不许再出现共享字段或裸 Object.assign */
function auditWorld(raw: string): string[] {
  const src = stripComments(raw);
  const issues: string[] = [];
  if (!/from "\.\/view-cache"/.test(src)) issues.push("world.ts 没 import view-cache(副本机制绕过了它)");
  const views = new Set<string>();
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*viewOf\(/g)) views.add(m[1]);
  if (views.size === 0) issues.push("world.ts 里没有任何 viewOf(...) 副本");
  for (const m of src.matchAll(/Object\.assign\(\s*(\w+)/g)) {
    if (!views.has(m[1])) issues.push(`Object.assign 直接拷进共享对象 ${m[1]}(跨实体残留的源头)`);
  }
  if (/(\w*[Vv]iew)\s*=\s*\{\}/.test(src)) issues.push("仍有 `xxxView = {}` 形状的共享副本字段");
  for (const callee of ["drawPlayer", "drawShuttle", "drawShadowClone"]) {
    for (const args of callArgs(src, callee)) {
      const target = args[2] ?? "";
      const name = target.split(/[.\s[]/)[0];
      if (!views.has(name)) issues.push(`${callee} 的入参 ${target || "(空)"} 不是 viewOf 的副本`);
    }
  }
  return issues;
}

/** sprites.ts:每一处 ball.owner 身份比较都必须走回指那一跳 */
function auditSprites(raw: string): string[] {
  const src = stripComments(raw);
  const issues: string[] = [];
  const cmp = [...src.matchAll(/ball\.owner === (\w+)/g)];
  if (cmp.length === 0) return ["sprites.ts 里找不到 ball.owner 的身份比较(判据地基变了,来核)"];
  if (!/entityOf\(/.test(src)) issues.push("sprites.ts 没 import entityOf(副本 ≠ 实体,比较会恒假)");
  for (const m of cmp) {
    if (m[1] === "p") issues.push("ball.owner === p 直接比副本 ⇒ 对局里恒假(发球托球姿势再也不亮)");
  }
  return issues;
}

const worldSrc = readFileSync(join(ROOT, "assets/scripts/render/world.ts"), "utf8");
const spritesSrc = readFileSync(join(ROOT, "assets/scripts/render/sprites.ts"), "utf8");
const wIssues = auditWorld(worldSrc);
h.ok(wIssues.length === 0, wIssues.length ? `world.ts:\n  ${wIssues.join("\n  ")}` : "③ world.ts:三处 draw* 入参全是按实体缓存的副本,无共享对象");
const sIssues = auditSprites(spritesSrc);
h.ok(sIssues.length === 0, sIssues.length ? `sprites.ts:\n  ${sIssues.join("\n  ")}` : "④ sprites.ts:ball.owner 的身份比较都走 entityOf 那一跳");

// ---------- --selftest:旧形状必须被点名 ----------
if (selftest) {
  const oldShared = mkRoster();
  const leak = runFrames(oldShared, true, 3);
  h.ok(leak.length > 0 && leak.some((l) => l.includes("CPU") && l.includes("playerSkin")),
    `反例(全场共用一个副本)复现了现场:${leak.slice(0, 3).join(" ")}${leak.length > 3 ? " …" : ""}`);

  const OLD_WORLD = [
    `import { drawPlayer, drawShuttle, drawShadowClone } from "./sprites";`,
    `  private playerView = {} as Player;`,
    `      Object.assign(pv, p);`,
    `      pv.x = rx; pv.y = ry;`,
    `      drawPlayer(g, this.vp, pv, animT, alpha, ball);`,
    `        Object.assign(bv, ball);`,
    `        drawShuttle(g, this.vp, bv, skin, 0, null);`,
    `        Object.assign(cv, c);`,
    `        drawShadowClone(g, this.vp, cv, animT, alpha, ball, {});`,
  ].join("\n");
  h.ok(auditWorld(OLD_WORLD).length >= 4, `反例(旧 world.ts 共享副本)被报警:${auditWorld(OLD_WORLD).length} 条`);
  const GOOD_WORLD = worldSrc;
  h.ok(auditWorld(GOOD_WORLD).length === 0, "正例(现在的 world.ts)全绿");

  const OLD_SPRITES = `const serveHold = !!(ball && ball.held && ball.owner === p && !swinging);`;
  h.ok(auditSprites(OLD_SPRITES).length >= 1, `反例(旧 sprites.ts 裸比副本)被报警`);
  h.ok(auditSprites(spritesSrc).length === 0, "正例(现在的 sprites.ts)全绿");
}

console.log(`${h.bad === 0 ? "✓" : "✗"} 渲染副本闸门:${h.checks} 条断言,${h.bad} 处问题`);
process.exit(h.bad > 0 ? 1 : 0);
