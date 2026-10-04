// ============================================================
// 「文案里的对象被字符串化」静态闸门 —— 防的是用户报的这条现场:
// 胜利结算页那一行写着「新品上架:[object Object] · [object Object] · [object Object]」。
//
// 根因: `SettleResult.unlocked` 是 `SkinDef[]`,而旧代码直接
// `res.unlocked.join(" · ")` —— Array.prototype.join 对每个元素做隐式字符串化,
// 于是对象变成 "[object Object]"。**不崩、不报错、tsc 也不报**,只会安静地把
// 一屏用户可见的字糊成占位符。
//
// 为什么 tsc 拦不住:把对象塞进字符串槽位有两个合法出口 ——
//   1) 模板串插值 `${x}`:TS 对插值表达式不做「必须可文本化」检查;
//   2) `.join()` / `+` 拼接 / `String(x)`:签名接受任意元素类型。
// 而 `label.string = 对象` 这种直接赋值 tsc 是会报错的 —— 所以本工具只盯 1) 与 2)。
// 也就是说:**这道闸吃的正是类型系统剩下的那两个洞**,不是 tsc 的重复品。
//
// 判定(吃 tools/tsconfig.check.json 的真实类型,扫 ../assets/scripts/**):
//   A 模板插值表达式类型不安全
//   B `.join()` 的接收者元素类型不安全
//   C 字符串 `+` 的另一侧不安全(含反向:对象 + 字符串)
//   D `String(x)` 的实参不安全
// 「安全」= string/number/boolean/enum/null/undefined/any,或元素安全的数组,
// 或**自己声明了 toString** 的类/接口(lib.d.ts 里 Object.prototype 那条不算)。
// console.* 的实参整条放行:那是调试写法,不是玩家看得见的文案。
//
// 反例闸门(规则脚本最怕悄悄全绿):
//   · --selftest 喂 4 份坏样本(四种出口各一份)+ 4 份好样本 —— 坏的必须被点名、
//     好的必须不报警;样本自身有类型错误时直接判失败(否则判据是空的);
//   · 正题跑完还断言「扫到的字符串化站点数 > 门槛」—— 解析失效时会红,
//     而不是安静地报 0 问题。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/text-object-check.js          # exit 0 = 通过
//   node .tools-build/tools/text-object-check.js -v       # 站点统计 + 逐条明细
//   node .tools-build/tools/text-object-check.js --selftest
// ============================================================
import * as ts from "typescript";
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { makeChecker } from "./harness";

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const selftest = process.argv.includes("--selftest");

/** 从 __dirname 向上找工程根(认这块招牌文件,避免选中 .tools-build 镜像) */
function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/ui/settle-panel.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/ui/settle-panel.ts)");
}

const ROOT = findRoot();
const CHECK_JSON = join(ROOT, "tools/tsconfig.check.json");
const PARSED_OPTS = ts.getParsedCommandLineOfConfigFile(CHECK_JSON, {}, {
  ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(`tsconfig.check.json 读不了: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  },
})?.options;
if (!PARSED_OPTS) throw new Error("tsconfig.check.json 解析结果为空");
const CHECK_OPTS: ts.CompilerOptions = PARSED_OPTS;

/** tsconfig 里的 include 展开成文件列表(只认本仓库用到的三种形态,认不了就报错而不是漏文件) */
function expandInclude(base: string, patterns: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string, ext: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p, ext);
      else if (ent.name.endsWith(ext)) out.push(p);
    }
  };
  for (const pat of patterns) {
    const abs = join(base, pat);
    if (!pat.includes("*")) { if (existsSync(abs)) out.push(abs); continue; }
    const m = /^([^*]*)\/(?:\*\*\/)?\*\.(\w+)$/.exec(pat.replace(/^\.\//, ""));
    if (!m) throw new Error(`expandInclude 不认的 glob 形态: "${pat}"(只支持 目录/**/*.ext 与 目录/*.ext)`);
    const dir = join(base, m[1]!.replace(/\/$/, "") || ".");
    walk(dir, `.${m[2]}`);
  }
  return out;
}

function baseProgram(): ts.Program {
  const cfg = readFileSync(CHECK_JSON, "utf8");
  const parsed = ts.parseConfigFileTextToJson(CHECK_JSON, cfg).config as { include?: string[] };
  const files = expandInclude(dirname(CHECK_JSON), parsed.include ?? []);
  return ts.createProgram(files, CHECK_OPTS);
}

// ---------- 类型层面的「能不能安全塞进字符串」 ----------

/** 是数组/元组吗?返回元素类型(字符串数组 join 是这条链上最常见的合法写法) */
function arrayElement(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  const arr = type.getSymbol()?.getName();
  const isArr = arr === "Array" || arr === "ReadonlyArray" || checker.isTupleType(type) ||
    checker.typeToString(type).endsWith("[]");
  if (!isArr) return null;
  const args = (type.flags & ts.TypeFlags.Object) ? checker.getTypeArguments(type as ts.TypeReference) : [];
  if (args.length === 1) return args[0] ?? null;
  // 元组 / 多参引用:数字索引类型就是「元素们的联合」
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? null;
}

/** 该类型自己(或其基类)在非 .d.ts 源码里声明了 toString ⇒ 它要印什么由它负责 */
function hasOwnToString(type: ts.Type): boolean {
  const prop = type.getProperty("toString");
  const decls = prop?.declarations ?? (prop?.valueDeclaration ? [prop.valueDeclaration] : undefined);
  if (!decls?.length) return false;
  return decls.some((d) => !d.getSourceFile().isDeclarationFile);
}

/** 这个类型插进字符串会不会变成 [object Object] */
function unsafe(type: ts.Type, checker: ts.TypeChecker): boolean {
  // 联合:拆开逐个看(null/undefined 插成 "null"/"undefined",是文案常态,放行)
  if (type.isUnion()) return type.types.some((t) => unsafe(t, checker));
  if (type.isIntersection()) return type.types.some((t) => unsafe(t, checker));
  const f = type.flags;
  if (
    f & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.EnumLike |
      ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Never |
      ts.TypeFlags.BigIntLike | ts.TypeFlags.Void | ts.TypeFlags.Unknown)
  ) return false;
  if (f & ts.TypeFlags.Object) {
    const elem = arrayElement(type, checker);
    if (elem) return unsafe(elem, checker);
    return !hasOwnToString(type);
  }
  // 类型参数/泛型索引等一律放行:宁可漏报也不误伤(真出占位符由 selftest 那侧兜)
  return false;
}

// ---------- AST 扫描 ----------

interface Finding { file: string; line: number; col: number; rule: string; expr: string; type: string }
interface Stats { spans: number; joins: number; concats: number; strings: number }

const SCAN_STATS: Stats[] = [];

function scanFile(sf: ts.SourceFile, checker: ts.TypeChecker, rel: (p: string) => string): Finding[] {
  const out: Finding[] = [];
  const stats: Stats = { spans: 0, joins: 0, concats: 0, strings: 0 };
  const text = sf.getFullText();
  const where = (n: ts.Node): { line: number; col: number } => {
    const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return { line: lc.line + 1, col: lc.character + 1 };
  };
  const snip = (n: ts.Node): string => text.slice(n.getStart(sf), n.getEnd()).replace(/\s+/g, " ").slice(0, 60);
  const push = (n: ts.Node, rule: string): void => {
    const { line, col } = where(n);
    out.push({
      file: rel(sf.fileName), line, col, rule, expr: snip(n),
      type: checker.typeToString(checker.getTypeAtLocation(n)),
    });
  };

  /** console.* 的实参整条放行:那是调试输出,不是玩家看得见的文案 */
  const consoleArgs = new Set<ts.Node>();
  const mark = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.kind === ts.SyntaxKind.Identifier &&
      (n.expression.expression as ts.Identifier).text === "console") {
      for (const a of n.arguments) consoleArgs.add(a);
    }
    ts.forEachChild(n, mark);
  };
  mark(sf);

  const visit = (n: ts.Node): void => {
    // A 模板插值
    if (ts.isTemplateExpression(n)) {
      for (const span of n.templateSpans) {
        if (consoleArgs.has(span.expression)) continue;
        stats.spans++;
        if (unsafe(checker.getTypeAtLocation(span.expression), checker)) push(span.expression, "模板插值");
      }
    }
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      // B `.join()` 的元素类型
      if (ts.isPropertyAccessExpression(e) && e.name.text === "join") {
        stats.joins++;
        const recv = checker.getTypeAtLocation(e.expression);
        const elem = arrayElement(recv, checker);
        if (elem && unsafe(elem, checker)) push(e.expression, `join 元素类型 ${checker.typeToString(recv)}`);
      }
      // D String(对象)
      if (e.kind === ts.SyntaxKind.Identifier && (e as ts.Identifier).text === "String" && n.arguments.length === 1) {
        stats.strings++;
        const a = n.arguments[0]!;
        if (a.kind !== ts.SyntaxKind.StringLiteral && unsafe(checker.getTypeAtLocation(a), checker)) push(a, "String(对象)");
      }
    }
    // C 字符串拼接:一侧是字符串,另一侧不安全
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const str = (t: ts.Type): boolean => !!(t.flags & ts.TypeFlags.StringLike);
      const ls = str(checker.getTypeAtLocation(n.left));
      const rs = str(checker.getTypeAtLocation(n.right));
      if (ls || rs) {
        stats.concats++;
        const other = ls ? n.right : n.left;
        if (other.kind !== ts.SyntaxKind.StringLiteral && other.kind !== ts.SyntaxKind.NoSubstitutionTemplateLiteral &&
          !ts.isTemplateExpression(other) && unsafe(checker.getTypeAtLocation(other), checker)) push(other, "字符串 + 对象");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  SCAN_STATS.push(stats);
  return out;
}

// ---------- 输出 ----------

const h = makeChecker({ verbose });
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);
const fmt = (f: Finding): string => `${f.file}:${f.line}:${f.col}  ${f.rule} → ${f.type}  「${f.expr}」`;

// ---------- 反例自检 ----------
if (selftest) {
  const dir = mkdtempSync(join(tmpdir(), "text-object-selftest-"));
  const cases: Array<[string, string, 0 | 1]> = [
    ["join 对象数组(结算屏原 bug)", `interface SkinDef { name: string }
const skins: SkinDef[] = [{ name: "樱花少女" }];
export const line = "新品上架:" + skins.join(" · ");`, 1],
    ["模板插值对象", `interface P { x: number }
const p: P = { x: 1 };
export const s = \`pos \${p}\`;`, 1],
    ["字符串 + 对象", `interface Q { a: number }
const q: Q = { a: 1 };
export const s = "v=" + q;`, 1],
    ["String(对象)", `interface R { a: number }
const r: R = { a: 1 };
export const s = String(r);`, 1],
    ["join 前先 map 取名(修法)", `interface SkinDef { name: string }
const skins: SkinDef[] = [{ name: "樱花少女" }];
export const line = "新品上架:" + skins.map((x) => x.name).join(" · ");`, 0],
    ["join 字符串数组", `const names: string[] = ["a", "b"];
export const line = names.join(" · ");`, 0],
    ["插数字与数字数组", `const n = 3; const lv: number[] = [1, 2];
export const s = \`Lv.\${n} → \${lv.join(",")}\`;`, 0],
    ["自带 toString 的类", `class Money { toString(): string { return "$1"; } }
const m = new Money();
export const s = \`pay \${m}\`;`, 0],
  ];
  const files = cases.map((_, i) => join(dir, `case${i}.ts`));
  cases.forEach(([, src], i) => writeFileSync(files[i]!, src, "utf8"));
  const program = ts.createProgram(files, { ...CHECK_OPTS, types: [] });
  const checker = program.getTypeChecker();
  const sem = program.getSemanticDiagnostics();
  if (sem.length) {
    console.log("✗ selftest 样本自身有类型错误 ⇒ 判据是空的:");
    for (const d of sem) console.log("   ", ts.flattenDiagnosticMessageText(d.messageText, " "));
    process.exit(1);
  }
  cases.forEach(([name, , want], i) => {
    const sf = program.getSourceFile(files[i]!);
    const got = sf ? scanFile(sf, checker, () => name).length : -1;
    ok((got > 0 ? 1 : 0) === want,
      `反例 ${name}: 期望 ${want ? "报警" : "放行"},实得 ${got > 0 ? `报警(${got})` : got === 0 ? "放行" : "未扫描"}`);
  });
  rmSync(dir, { recursive: true, force: true });
  process.exit(h.bad ? 1 : 0);
}

// ---------- 正题 ----------
const program = baseProgram();
const checker = program.getTypeChecker();
const rel = (p: string): string => relative(ROOT, p).replace(/\\/g, "/");

const findings: Finding[] = [];
let scanned = 0;
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile || !sf.fileName.includes("/assets/scripts/")) continue;
  scanned++;
  const ds = program.getSemanticDiagnostics(sf);
  if (ds.length) {
    // 类型不可信的文件上这道闸没有意义 —— 先让 tsc 的红传过来,而不是假装扫过
    ok(false, `${rel(sf.fileName)} 有 ${ds.length} 个类型错误`);
    for (const d of ds.slice(0, 3)) {
      console.log(`    ${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
    continue;
  }
  const found = scanFile(sf, checker, rel);
  for (const f of found) if (verbose) console.log(`  · ${fmt(f)}`);
  findings.push(...found);
}

const total = SCAN_STATS.reduce((s, x) => ({
  spans: s.spans + x.spans, joins: s.joins + x.joins, concats: s.concats + x.concats, strings: s.strings + x.strings,
}), { spans: 0, joins: 0, concats: 0, strings: 0 });
const sites = total.spans + total.joins + total.concats + total.strings;

if (verbose) console.log(`  站点统计: 插值 ${total.spans} / join ${total.joins} / 拼接 ${total.concats} / String() ${total.strings}(共 ${sites}),扫了 ${scanned} 个文件`);
// 解析失效时这里会红,而不是安静地报「0 问题」
ok(scanned > 60, `扫到 ${scanned} 个 assets/scripts 源文件(过少说明 include 展开失效)`);
ok(sites > 500, `扫到 ${sites} 处字符串化站点(门槛 500;过低说明 AST 遍历失效)`);
ok(total.joins > 10, `其中 .join() 调用 ${total.joins} 处(全树现共 18 处;为 0 说明 join 分支没跑通)`);

for (const f of findings) ok(false, fmt(f));
console.log(h.bad
  ? `\n${findings.length} 处「对象被字符串化」:玩家看到的会是 [object Object]。修法 = 插值前 map 出字段名,或给该类型写 toString。`
  : `\n${sites} 处字符串化站点全部类型安全,0 处会印成 [object Object]。`);
process.exit(h.bad ? 1 : 0);
