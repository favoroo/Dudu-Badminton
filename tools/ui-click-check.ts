// ============================================================
// 「点击链路卫生」静态自检 —— 防的是用户报的这条:
// 「对练屏点这个切换场地、还有切换技能都没有反应了」。
//
// 根因不在遮挡、不在隐形挡板,在**少挂了一个组件**:
// `click` 事件只由 `Button._onTouchEnded` 派发(engine/cocos/ui/button.ts),
// 而节点的 TOUCH_* 监听只由 `Button._registerNodeEvent()` 在 onEnable 时注册;
// `'click'` 不在 node-event-processor 的 _touchEvents 里 —— 所以一个只有
// UITransform + Graphics、却挂着 `node.on(Button.EventType.CLICK, …)` 的手搓节点,
// **连命中判定都进不去**:既不响,也不吞触摸。
// 于是症状长得很特别:同一屏上装了 Button 的块(返回、三档难度)全好,
// 唯独漏挂的那一排死。0.0.18 把球馆 tab 与技能胶囊从主菜单 card()(末行就是
// addComponent(Button))迁到手搓 new Node() 时,就是把那一行迁丢了。
//
// 为什么 ui-hide-check 抓不到它:那道闸只看裸 TOUCH_* 的 on/off 配对,而这里
// 一个 TOUCH 监听都没有 —— 是「根本没有触摸入口」,与「退场没卸监听」正好相反。
//
// 判定(扫 assets/scripts/ui/ 全部 .ts):
//   1) 接收者必须是**手搓节点**:`const X = new Node(` / `this.X = new Node(`;
//   2) 该 X 在文件里必须出现过 `X.addComponent(Button)`;
//   3) 或者被传进了一个「会往参数上装 Button」的助手(自动识别:函数声明后 12 行内
//      出现 `<首形参>.addComponent(Button)`,如本仓库 ModeScreen.pressable);
//   4) 工厂出来的接收者(`kit.button(...)` / `solidBlock(...)` / `mk("…").on(…)`)
//      不在 1) 的集合里,天然免检 —— 只在 -v 里作为「未证明」列出供人过一遍。
// 反例闸门:一条 CLICK 监听都没扫到 = 正则失效,直接 exit 1(规则脚本最怕悄悄全绿)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/ui-click-check.js          # exit 0 = 通过
//   node .tools-build/tools/ui-click-check.js -v       # 打印每个文件的判定明细
//   node .tools-build/tools/ui-click-check.js --selftest
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

/** 手搓节点:`const X = new Node(` / `let X = new Node(` / `this.X = new Node(` */
const HAND = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+Node\(|this\.(\w+)\s*=\s*new\s+Node\(/g;
/** 装了 Button 的标识符(含 `const b = X.addComponent(Button)` 这种换个名字接住的写法) */
const BUTTONED = /(\w+)\s*\.\s*addComponent\(\s*Button\s*\)/g;
/** CLICK 监听:接收者必须是个裸标识符(工厂链式调用收不到,按免检处理) */
const CLICK = /(\w+)\s*\.\s*on\(\s*(?:Button\.EventType\.CLICK|['"]click['"])/g;
/** 函数/方法声明一行:抓名字与形参表 */
const DECL = /(?:^|[\s{])(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+|function\s+)*(\w+)\s*\(([^)]*)\)\s*(?::[^{]*)?\{\s*$/;

/** 去注释但**保留行号**(要报 file:line,块注释按等量换行替掉) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

/** 某标识符在原文件里的行号(取第一次出现处) */
function lineOf(lines: string[], id: string): number {
  const re = new RegExp(`\\b${id}\\b`);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

/**
 * 「会往参数上装 Button」的助手名 → 它的首形参。
 * 只向后看 12 行,不做花括号配对 —— 上一版想从定义处自动推工厂,结果
 * uiIconButton 的 `opts: { hit?: number … }` 让第一个 `{` 变成类型字面量,
 * 配对一歪就静默漏掉那个工厂(误判成「没装按钮」),窗口扫不会中这个招。
 *
 * 两条识别路:
 *   a) 体内直接 `<首形参>.addComponent(Button)`;
 *   b) 体内把**首形参原样**交给一个已证明的工厂(本地助手,或 trusted 里的导出工厂)。
 *      有了 b),把 pressable/solidBlock 从各面板提到 ui-shell 这种共用文件才不会让
 *      本工具瞎掉 —— 它瞎的方向是漏报,而漏报正是这道闸存在的理由所不允许的。
 *      注意 b) 要求实参**就是那个形参本身**:转手一个别的标识符不算证明。
 */
function buttonHelpers(src: string, trusted: ReadonlySet<string> = new Set()): Map<string, string> {
  const out = new Map<string, string>();
  const lines = src.split("\n");
  // 到不动点(最多 4 轮):助手可以套助手,pressable → shellPressable → addComponent。
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (let i = 0; i < lines.length; i++) {
      const m = DECL.exec(lines[i]);
      if (!m) continue;
      const name = m[1]!;
      if (out.has(name)) continue;
      const first = (m[2] || "").split(",")[0]?.trim().split(/[:\s]/)[0];
      if (!first || !/^\w+$/.test(first)) continue;
      const win = lines.slice(i + 1, i + 13).join("\n");
      let proven = new RegExp(`\\b${first}\\s*\\.\\s*addComponent\\(\\s*Button\\s*\\)`).test(win);
      if (!proven) {
        for (const [known, knownParam] of out) {
          if (known === name) continue;
          // 只认「把本函数首形参交出去」;knownParam 不参与匹配 —— 交的是我们的形参
          if (new RegExp(`[\\s(,]${known}\\s*\\(\\s*${first}\\s*[,)]`).test(win)) { proven = true; break; }
        }
        if (!proven) {
          for (const t of trusted) {
            if (new RegExp(`[\\s(,]${t}\\s*\\(\\s*${first}\\s*[,)]`).test(win)) { proven = true; break; }
          }
        }
      }
      if (proven) { out.set(name, first); grew = true; }
    }
    if (!grew) break;
  }
  return out;
}

/** 一个文件里 `export function NAME(` 的名字:别名解析与 trusted 名单都要用 */
function exportedNames(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) out.push(m[1]!);
  // `export const X = (...) => …` 形式的工厂也算(本仓库 ui-shell 里有)
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=/g)) out.push(m[1]!);
  return out;
}

/** `import { pressable as shellPressable }` → 本地名 shellPressable 指向导出名 pressable */
function importAliases(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const am = /^(\w+)\s+as\s+(\w+)$/.exec(seg);
      if (am) out.set(am[2]!, am[1]!);
    }
  }
  return out;
}

interface Verdict { fail: string[]; proven: number; unbound: number; chained: number; sites: number }

/** 一个文件的判定 */
function audit(raw: string, trusted: ReadonlySet<string> = new Set()): Verdict {
  const src = stripComments(raw);
  const lines = raw.split("\n");
  // 本地名 → 导出名:把 `pressable as shellPressable` 这种别名接上 trusted 名单
  const alias = importAliases(src);
  const local = new Set<string>();
  for (const [k, v] of alias) if (trusted.has(v)) local.add(k);
  const helpers = buttonHelpers(src, new Set([...trusted, ...local]));

  const hand = new Set<string>();
  for (const m of src.matchAll(HAND)) hand.add(m[1] ?? m[2]!);

  const buttoned = new Set<string>();
  for (const m of src.matchAll(BUTTONED)) buttoned.add(m[1]!);
  for (const [fn] of helpers) {
    for (const m of src.matchAll(new RegExp(`(?:\\.|\\s|^)${fn}\\s*\\(\\s*(\\w+)\\s*[,)]`, "g"))) {
      buttoned.add(m[1]!);
    }
  }

  const fail: string[] = [];
  let proven = 0, unbound = 0;
  const bare = src.match(CLICK_ALL);
  const sites = bare ? bare.length : 0;
  for (const m of src.matchAll(CLICK)) {
    const id = m[1]!;
    if (!hand.has(id)) { unbound++; continue; }   // 工厂/链式来的:免检
    if (buttoned.has(id)) { proven++; continue; }
    fail.push(`${id}(行 ${lineOf(lines, id)}):挂了 CLICK 监听却没有 Button 组件`);
  }
  // sites 用宽正则数,CLICK 只认「标识符.on(」—— 差出来的是 mk("…").on(…) 那种链式接收者,
  // 本工具不追它的返回值装没装 Button(工厂负责),只在这里显式报个数,免得 -v 看着像漏了。
  return { fail, proven, unbound, chained: sites - proven - unbound - fail.length, sites };
}

/** 数站点用的宽正则(与 CLICK 同一条,只是要个 length) */
const CLICK_ALL = /(?:\w+|\))\s*\.\s*on\(\s*(?:Button\.EventType\.CLICK|['"]click['"])/g;

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (cond || verbose) console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

// ---------- 反例自检:每条判定各配样本(规则脚本最怕悄悄全绿) ----------
if (selftest) {
  /** 0.0.18 漏挂 Button 的真实写法(用户报的现场) */
  const dead = [
    `  protected buildSkillBadge(y: number): void {`,
    `    const skill = new Node("badge:skill");`,
    `    skill.addComponent(UITransform).setContentSize(640, 46);`,
    `    const sg = skill.addComponent(Graphics);`,
    `    skill.on(Button.EventType.CLICK, () => { this.kit.openSkillDialog(); });`,
    `    skill.setPosition(0, y, 0);`,
    `  }`,
  ].join("\n");
  /** 修法 A:走 pressable 助手 */
  const viaHelper = [
    `  protected pressable(n: Node, zoom: number): void {`,
    `    const b = n.addComponent(Button);`,
    `    b.zoomScale = zoom;`,
    `  }`,
    `  protected buildSkillBadge(y: number): void {`,
    `    const skill = new Node("badge:skill");`,
    `    this.pressable(skill, 0.96);`,
    `    skill.on(Button.EventType.CLICK, () => {});`,
    `  }`,
  ].join("\n");
  /** 修法 B:就地 addComponent(Button) */
  const inline = [
    `    const tab = new Node("court:a");`,
    `    tab.addComponent(Button);`,
    `    tab.on(Button.EventType.CLICK, () => {});`,
  ].join("\n");
  /** 工厂出来的接收者:必须**不**报警(证明这套正则不咬人) */
  const factory = [
    `    const back = kit.button(card.node, "设置", 300, 46);`,
    `    back.on(Button.EventType.CLICK, () => {});`,
    `    mk("继续比赛", true).on(Button.EventType.CLICK, () => {});`,
  ].join("\n");
  /** 助手委托给「已证明的导出工厂」:共用层收口后的真实写法,不该报警 */
  const viaImport = [
    `import { pressable as shellPressable } from "./ui-shell";`,
    `  protected pressable(n: Node, zoom: number): void {`,
    `    shellPressable(n, zoom);`,
    `  }`,
    `  protected build(): void {`,
    `    const tab = new Node("court:a");`,
    `    this.pressable(tab, 0.94);`,
    `    tab.on(Button.EventType.CLICK, () => {});`,
    `  }`,
  ].join("\n");
  /** 反例:委托给一个**没装 Button** 的函数 —— 名单不能宽到没牙齿 */
  const bogusDelegate = [
    `  protected mark(n: Node, zoom: number): void {`,
    `    n.setScale(zoom, zoom, 1);`,
    `  }`,
    `  protected build(): void {`,
    `    const tab = new Node("court:a");`,
    `    this.mark(tab, 0.94);`,
    `    tab.on(Button.EventType.CLICK, () => {});`,
    `  }`,
  ].join("\n");
  /** 反例:转手的是**别的标识符**,不是本函数首形参 —— 不算证明 */
  const wrongArg = [
    `  protected wrap(n: Node, other: Node): void {`,
    `    shellPressable(other, 0.9);`,
    `  }`,
    `  protected build(): void {`,
    `    const tab = new Node("court:a");`,
    `    this.wrap(tab, somethingElse);`,
    `    tab.on(Button.EventType.CLICK, () => {});`,
    `  }`,
  ].join("\n");

  const trusted = new Set(["pressable", "solidBlock"]);
  const cases: Array<[string, string, number, ReadonlySet<string>?]> = [
    ["漏挂 Button 的手搓节点", dead, 1],
    ["手搓节点 + pressable 助手", viaHelper, 0],
    ["手搓节点 + 就地 addComponent(Button)", inline, 0],
    ["工厂/链式接收者(不误报)", factory, 0],
    ["助手委托给可信的导出工厂", viaImport, 0, trusted],
    ["助手委托给没装 Button 的函数(仍有牙)", bogusDelegate, 1, trusted],
    ["转手别的标识符,不认作证明(仍有牙)", wrongArg, 1, trusted],
  ];
  for (const [name, src, want, tr] of cases) {
    const got = audit(src, tr).fail.length;
    ok(got === want, `反例 ${name}: 期望 ${want} 处报警,实得 ${got}`);
  }
  process.exit(bad ? 1 : 0);
}

// ---------- 正题 ----------
const files = readdirSync(UI_DIR).filter((f) => f.endsWith(".ts"));
const sources = new Map<string, string>();
for (const f of files.sort()) sources.set(f, stripComments(readFileSync(join(UI_DIR, f), "utf8")));

/**
 * 第一遍:哪些**导出**函数自己会装 Button → 可信工厂名单。
 * 只收导出的:不导出的同名函数不该跨文件给别的名字作保(名单一宽就等于没闸)。
 */
const TRUSTED = new Set<string>();
for (const src of sources.values()) {
  const exp = new Set(exportedNames(src));
  for (const name of buttonHelpers(src).keys()) if (exp.has(name)) TRUSTED.add(name);
}

let totalSites = 0;
for (const [f, src] of sources) {
  const v = audit(src, TRUSTED);
  totalSites += v.sites;
  if (verbose) {
    console.log(`  · ${f}: CLICK ${v.sites} 处 —— 手搓已装按钮 ${v.proven},工厂标识符免检 ${v.unbound},链式接收者不追 ${v.chained},报警 ${v.fail.length}`);
  }
  for (const msg of v.fail) ok(false, `${f} ${msg}`);
}
if (verbose) console.log(`  可信工厂(导出且自装 Button):${[...TRUSTED].sort().join(", ") || "无"}`);

ok(totalSites > 0, `全树扫到 ${totalSites} 处 CLICK 监听(为 0 说明正则失效)`);
console.log(bad
  ? `\n${bad} 处「点了没反应」隐患:挂 CLICK 监听的手搓节点没装 Button —— click 不会被派发,节点也进不了命中判定。`
  : `\n${totalSites} 处 CLICK 监听全部有 Button 兜着(手搓的已装 / 工厂的自带),0 处问题。`);
process.exit(bad ? 1 : 0);
