// ============================================================
// 面板退场的「触摸卫生」静态自检 —— 防的是用户报的这条:
// 「进无限模式后,所有按钮点了都没反应」。
//
// 根因不在逻辑,在引擎的派发规则:UI 触摸默认吞噬(`UIEvent.preventSwallow` 为 false:
// 谁先接住 TOUCH_START,渲染层级在它之下的节点一个都收不到),而吞噬只看
// 「这个节点还 active + 还挂着 TOUCH_* 监听」,与监听里做了什么无关。
// 本仓库的面板退场统一走 ui-arcade.fadeOutHide —— 它刻意不 deactivate 整树
// (原生侧 Graphics 的渲染数据会在 onDisable 被清,重显就隐身),
// 只关掉子树里的 Button / BlockInputEvents 组件。裸 TOUCH 监听不归它管。
//
// 于是「用 fadeOutHide 收起、节点又留在场上」的面板,只要给自己挂过裸 TOUCH 监听,
// 关掉之后那块隐形区域继续吃触摸:遮罩是整屏的 → 暂停键/摇杆/击球键一起全灭
// (无限练习弹窗的「点遮罩关闭」正是这一条);可视窗只有半屏 → 中间一条点不动
// (更新弹窗的日志拖动同样中招)。
//
// 判定(只看会 fadeOutHide(this.root) 的 ui/ 面板):
//   退场后节点若已彻底离场 —— 回调里 destroy —— 免检;
//   否则要求:
//     1) 出现过的每一种 TOUCH_* 都必须既有 .on 也有 .off(随显示/隐藏挂卸);
//     2) show 路径要有 cancelFade(this.root),否则退场时禁用的 Button 回不来
//        (文件里本就有 destroy 的一次性面板免检 —— 它不需要复原路径);
//     3) 退场回调里**不许** this.root.active = false:节点留在场上,触摸是干净了,
//        但原生侧 Graphics 的渲染数据会在 onDisable 被清、重显不重传 → 第二次打开
//        整屏底块透明只剩字(要真离场就 destroy,否则纯 fadeOutHide)。
// 第二道闸在 ui-manager.ts:凡 this.menu.hide() 的入口,方法体内必须也有 this.menu.show()
//   —— 浮在 MENU 之上的一屏不挂任何 Rules 状态,状态没有变化沿 onState 就不会再跑,
//      菜单只能由面板的关闭回调命令式请回来(少这一句 = 关完只剩一座空球场,卡死)。
// 另附 --selftest:每条规则各拿一个改动前的真实写法当反例,确认这套正则会报警
// (规则脚本最怕的是悄悄全绿)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/ui-hide-check.js          # exit 0 = 通过
//   node .tools-build/tools/ui-hide-check.js -v       # 打印每个面板的判定明细
//   node .tools-build/tools/ui-hide-check.js --selftest
// ============================================================
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

/** 从 __dirname 向上找工程根(认这块招牌文件,避免选中 .tools-build 镜像) */
function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/ui/ui-arcade.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/ui/ui-arcade.ts)");
}

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const selftest = process.argv.includes("--selftest");
const UI_DIR = join(findRoot(), "assets/scripts/ui");

/** 收起整棵 root(带不带回调都算) */
const FADES_ROOT = /fadeOutHide\(\s*this\.root\b/;
/** 退场动画放完后把整树请出场:节点不在了,监听自然也不在了。
 *  只认 fadeOutHide 的第二个参数(回调)里的 destroy ——
 *  往后随便扫几百字符会把「面板里另有小件开关」误判成整树离场。 */
const LEAVES_SCENE = /fadeOutHide\(\s*this\.root\s*,[\s\S]{0,160}?\.destroy\(\)/;
/** ⚠ 退场回调里 `this.root.active = false` 不算离场,它是另一条 bug(见 DEACTIVATE_ROOT) */
const TOUCH_ON = /\.on\(\s*[^,)]*?\bTOUCH_[A-Z]+\b/g;
const TOUCH_OFF = /\.off\(\s*[^,)]*?\bTOUCH_[A-Z]+\b/g;
const TOUCH_NAME = /(TOUCH_[A-Z]+)/;

/**
 * 画过一帧之后再 deactivate = 原生侧判死。引擎 `UIRenderer.onDisable → destroyRenderData()`,
 * 而 `Graphics._flushAssembler()` 只换 assembler、不重建渲染数据(对照 Label:它的
 * onEnable 会 `_applyFontTexture → markDirtyRenderer`,所以文字活着) —— 于是重显时
 * 底块/卡片/按钮底全透明只剩字。web/preview 完全不复现,只能靠这条静态检查兜。
 */
const DEACTIVATE_ROOT = /fadeOutHide\(\s*this\.root\s*,[\s\S]{0,160}?this\.root\.active\s*=\s*false/;

/** 去掉注释再扫:文档里引用规则时写的 `node.on(TOUCH_*)` 不该算违例 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 一个文件里 on / off 各出现过哪些 TOUCH_* */
function touchNames(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(re)) {
    const n = m[0].match(TOUCH_NAME);
    if (n) out.add(n[1]);
  }
  return out;
}

/** 返回这个问题面板的报错列表(空数组 = 干净) */
function audit(name: string, raw: string): string[] {
  const issues: string[] = [];
  if (!FADES_ROOT.test(raw)) return issues;            // 不用 fadeOutHide 收 root:免检
  const src = stripComments(raw);
  const parked = LEAVES_SCENE.test(raw);               // 退场即 destroy / active=false
  const ons = touchNames(src, TOUCH_ON);
  const offs = touchNames(src, TOUCH_OFF);

  if (parked) {
    if (verbose) console.log(`  · ${name}: 退场后节点离场(destroy/active=false),裸监听免检`);
  } else if (ons.size === 0) {
    if (verbose) console.log(`  · ${name}: 无裸 TOUCH 监听,靠 Button/BlockInputEvents 放行`);
  } else {
    const leaky = [...ons].filter((n) => !offs.has(n));
    if (leaky.length) {
      issues.push(`${name}: fadeOutHide(this.root) 后节点仍留在触摸路径上,`
        + `裸 TOUCH 监听 [${leaky.join(", ")}] 却没配套 .off —— 面板一关就成了隐形挡板,`
        + `底下的虚拟按键/暂停键全部点不动(改为 show 时 on、hide 时 off,或退场回调里 destroy)`);
    }
  }
  if (!/cancelFade\(\s*this\.root\s*\)/.test(src) && !/\.destroy\(\)/.test(src)) {
    issues.push(`${name}: 缺 cancelFade(this.root) —— 退场时被禁掉的 Button 再也回不来`);
  }
  if (DEACTIVATE_ROOT.test(src)) {
    issues.push(`${name}: 退场回调里把 this.root.active = false —— 这棵树已经画过一帧,`
      + `原生(JSB)侧 Graphics 的渲染数据会在 onDisable 被清且重显不重传,`
      + `第二次打开就是「底块全透明只剩字」的空壳(真机才有,preview 全绿)`);
  }
  return issues;
}

/**
 * 第二道闸:浮在 MENU 之上的一屏,关完必须自己把主菜单请回来。
 *
 * 主菜单/生涯/训练/闯关这些入口都是 `menu.hide() → panel.show()`,而 Rules 状态
 * 全程停在 MENU —— onState 只在**变化沿**触发,所以菜单不会自己回来。少给一条归途
 * 的后果不是难看,是**卡死**:屏幕上只剩一座空球场,什么按钮都没有(闯关大厅曾中招)。
 * 判定:ui-manager 里任何调了 `this.menu.hide()` 的方法,自身必须出现 `this.menu.show()`。
 */
function auditMenuReturn(raw: string): string[] {
  const src = stripComments(raw);
  const issues: string[] = [];
  const heads = [...src.matchAll(/\n {2}private (\w+)/g)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const name = h[1];
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : src.length;
    const body = src.slice(start, end);
    if (!body.includes("this.menu.hide()")) continue;
    if (!body.includes("this.menu.show()")) {
      issues.push(`ui-manager.${name}(): 有 this.menu.hide() 却没有 this.menu.show() —— `
        + `状态全程是 MENU,onState 不会再把菜单请回来;面板的关闭回调必须显式 show()`);
    }
  }
  return issues;
}

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (cond || verbose) console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

// ---------- 反例自检:三条规则各配一个必须报警的样本(规则脚本最怕悄悄全绿) ----------
if (selftest) {
  const badSample = [
    `this.root = kit.root(parent, "endless-dialog");`,
    `const dim = kit.dim(this.root, 0.42, 0.76);`,
    `dim.on(Node.EventType.TOUCH_START, () => { this.hide(); });`,
    `show(): void { cancelFade(this.root); this.root.active = true; }`,
    `hide(): void { fadeOutHide(this.root); }`,
  ].join("\n");
  const goodSample = badSample
    .replace(`dim.on(Node.EventType.TOUCH_START, () => { this.hide(); });`,
      `this.dim.on(Node.EventType.TOUCH_START, this.onDimTap, this);`)
    .replace(`hide(): void { fadeOutHide(this.root); }`,
      `hide(): void { this.dim.off(Node.EventType.TOUCH_START, this.onDimTap, this); fadeOutHide(this.root, () => { this.root.destroy(); }); }`);
  // 闯关大厅当年的写法:触摸上确实「离场」了,原生侧却把整棵已绘制的子树判死
  const deactivateSample = [
    `this.root = kit.root(parent, "campaign-panel");`,
    `show(): void { cancelFade(this.root); this.root.active = true; }`,
    `hide(): void { fadeOutHide(this.root, () => { this.root.active = false; }); }`,
  ].join("\n");
  ok(audit("sample-bad.ts", badSample).length === 1, `反例(遮罩裸监听常驻)被报警`);
  ok(audit("sample-good.ts", goodSample).length === 0, `正例(挂卸成对 + 退场 destroy)全绿`);
  ok(audit("sample-deactivate.ts", deactivateSample).length === 1, `反例(退场回调里 active=false)被报警`);

  const returnBad = `\n  private openFoo(): void {\n    this.menu.hide();\n    this.fooPanel.show();\n  }\n`;
  const returnGood = `\n  private openFoo(): void {\n    this.menu.hide();\n    this.fooPanel.show(() => { this.fooPanel.hide(); this.menu.show(); });\n  }\n`;
  ok(auditMenuReturn(returnBad).length === 1, `反例(关完没人请回主菜单)被报警`);
  ok(auditMenuReturn(returnGood).length === 0, `正例(关闭回调里请回主菜单)全绿`);
}

const files = readdirSync(UI_DIR).filter((f) => f.endsWith(".ts")).sort();
let judged = 0;
for (const f of files) {
  const raw = readFileSync(join(UI_DIR, f), "utf8");
  if (!FADES_ROOT.test(raw)) continue;
  judged++;
  const issues = audit(f, raw);
  ok(issues.length === 0, issues.length ? issues.join("\n  ") : `${f}: 面板退场不残留触摸、不 deactivate`);
}

const mgr = join(UI_DIR, "ui-manager.ts");
const mgrIssues = existsSync(mgr) ? auditMenuReturn(readFileSync(mgr, "utf8")) : ["ui-manager.ts 找不到"];
ok(mgrIssues.length === 0, mgrIssues.length ? mgrIssues.join("\n  ") : "ui-manager.ts: 每个收起主菜单的入口都留了归途");

console.log(judged === 0
  ? "✗ 一个面板都没扫到 —— UI 目录路径不对?"
  : `${bad === 0 ? "✓" : "✗"} 面板退场卫生:${judged} 个 fadeOutHide 收 root 的面板 + 主菜单归途 1 项,${bad} 处问题`);
process.exit(judged === 0 || bad > 0 ? 1 : 0);
