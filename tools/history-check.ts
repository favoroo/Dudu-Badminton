// ============================================================
// 「更新记录」数据链回归:Releases 列表 JSON → 版本条目 → 说明排版。
//
// 这个弹窗坏的方式全是「静默」的:字段名对不上(Gitee/GitHub 同名不同形)、
// 草稿/预发布没滤掉、日期解析不出插队到最上面、空正文开一个空块、tagName 被
// 剥了 v 前缀导致「当前版本」标永远不亮 —— 不崩不报错,只有打开看才知道。
// 两端 API 的响应没有真机也能喂:判据全部吃纯函数(core/release-history),
// 正题喂两端各自的真实响应形状,--selftest 喂垃圾输入确认不炸不出脏数据。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/history-check.js
//   node .tools-build/tools/history-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { formatHistoryDate, parseReleaseList, parseReleaseItem } from "../assets/scripts/core/release-history";
import { releasesListUrl, APP_VERSION_NAME } from "../assets/scripts/core/version";
import { buildNotes } from "../assets/scripts/ui/release-notes";
import { textW } from "../assets/scripts/core/text-metrics";

const h = makeChecker({ printPass: false });
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

// ---------- 1) 列表端点:与「检查更新」同一候选顺序的源头 ----------

const giteeUrl = releasesListUrl("gitee");
const githubUrl = releasesListUrl("github");
ok(/gitee\.com\/api\/v5\/repos\/favo9\/dudu-badminton\/releases\?/.test(giteeUrl), `Gitee 列表端点不对:${giteeUrl}`);
ok(/api\.github\.com\/repos\/favoroo\/Dudu-Badminton\/releases\?/.test(githubUrl), `GitHub 列表端点不对:${githubUrl}`);
ok(/[?&]per_page=\d+/.test(giteeUrl) && /[?&]per_page=\d+/.test(githubUrl), "列表端点必须带 per_page(版本数已过 30,默认 20 页会静默截尾)");
ok(/page=1/.test(giteeUrl), "Gitee 列表端点必须带 page=1(它的分页参数必填语义与 GitHub 不同)");

// ---------- 2) 真实响应形状:两端字段同名、脏法不同 ----------

/** 按 GitHub API 的真实字段形状构造(本地时间 → ISO,跨时区稳定) */
function rel(tag: string, daysAgo: number, body: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const d = new Date(2026, 8, 30, 12);   // 本地正午:任何时区落到同一天
  d.setDate(d.getDate() - daysAgo);
  return { tag_name: tag, name: `嘟嘟羽毛球 v${tag.replace(/^v/, "")}`, body, created_at: d.toISOString(), published_at: d.toISOString(), draft: false, prerelease: false, ...extra };
}

const list = [
  rel("v0.0.30", -1, "未发布先挂上来的草稿", { draft: true }),              // 草稿 → 滤
  rel("v0.0.29", 0, "### 新增功能\n- 更新记录弹窗"),
  rel("v0.0.28b", 1, "改版重发,同 tag 只留一条"),
  rel("v0.0.28", 2, "", { prerelease: true }),                             // 预发布 → 滤
  rel("v0.0.27", 3, ""),                                                   // 空正文 → 兜底
  rel("v0.0.26", 4, "### 修复问题\n- 网前击球", { published_at: null }),    // 只有 created_at
  { tag_name: "", body: "没有 tag 的脏数据" },                              // 无 tag → 滤
  { tag_name: 42, body: "tag 不是字符串" },                                 // 非法 tag → 滤
  null, 42, "垃圾",                                                        // 非对象 → 滤
  rel("v0.0.25", 5, "老版本"),
];

const entries = parseReleaseList(list);
ok(entries.length === 5, `草稿/预发布/脏数据/重复 tag 都要滤掉,应剩 5 条,实得 ${entries.length}`);
ok(entries.map((e) => e.tagName).join(",") === "v0.0.29,v0.0.28b,v0.0.27,v0.0.26,v0.0.25",
  `顺序应为发布时间新→旧,实得 ${entries.map((e) => e.tagName).join(",")}`);
// tagName 保留 v 前缀:弹窗拿它跟 APP_VERSION_NAME 比对打「当前版本」标
ok(APP_VERSION_NAME.startsWith("v") && /^v/.test(entries[0].tagName),
  "tagName 必须保留 v 前缀(弹窗要与 APP_VERSION_NAME 直接比对)");
ok(entries[0].notes.includes("更新记录弹窗"), "正文应原样保留(markdown 清洗交给 release-notes)");
ok(entries.find((e) => e.tagName === "v0.0.27")?.notes === "", "空正文应归一为空串,不许留 undefined");
ok(entries.every((e) => e.dateMs > 0), "有 published_at/created_at 的条目必须解析出时间");

// 日期全缺的条目:记 0 沉底、日期位不摆,但条目本身保留(说明是玩家要看的)
const noDate = parseReleaseList([{ tag_name: "v0.1.0", body: "无日期" }]);
ok(noDate.length === 1 && noDate[0].dateMs === 0, "缺日期的条目应保留且 dateMs=0");
ok(formatHistoryDate(0) === "", "dateMs=0 的日期位必须返回空串(表头不摆日期)");

// Gitee 的列表 API 实测是**最旧在前**(GitHub 相反)—— 解析必须自己重排,不能信入参顺序
const asc = parseReleaseList([rel("v0.0.2", 2, "b"), rel("v0.0.3", 1, "c"), rel("v0.0.1", 3, "a")]);
ok(asc.map((e) => e.tagName).join(",") === "v0.0.3,v0.0.2,v0.0.1",
  `输入最旧在前时必须重排成新→旧,实得 ${asc.map((e) => e.tagName).join(",")}`);

// ---------- 3) 每一条记录都排得出:空正文走兜底,绝不空块 ----------

for (const e of entries.concat(noDate)) {
  const layout = buildNotes(e.notes, textW);
  ok(layout.lines.length >= 1, `${e.tagName}: 排版后一行都没有(兜底文案失效)`);
  ok(layout.height >= 2 * 12 + 17, `${e.tagName}: 内容高 ${layout.height} 连一行都装不下`);
}

// ---------- 4) 时间格式:本地时区的「YYYY-MM-DD」,跨时区稳定 ----------

const noon = new Date(2026, 8, 30, 12).getTime();
ok(formatHistoryDate(noon) === "2026-09-30", `日期格式应为 2026-09-30,实得 ${formatHistoryDate(noon)}`);
ok(formatHistoryDate(Number.NaN) === "", "NaN 日期必须返回空串");

// ---------- 反例自检:垃圾输入不炸、不出脏数据 ----------

if (process.argv.includes("--selftest")) {
  const junk: unknown[] = [null, undefined, 42, "str", {}, { tag_name: 42 }, [], [null, 1, "x", {}]];
  for (const [i, j] of junk.entries()) {
    let out: unknown[] | null = null;
    let threw = "";
    try {
      out = parseReleaseList(j) as unknown[];
    } catch (e: any) {
      threw = e?.message || String(e);
    }
    ok(!threw, `垃圾输入 #${i}(${JSON.stringify(j)})不该抛异常:${threw}`);
    ok(Array.isArray(out) && out.length === 0, `垃圾输入 #${i} 必须归零,实得 ${JSON.stringify(out)}`);
  }
  // 单条口径:draft/prerelease 恒拦,数字开头的 tag 才放行
  ok(parseReleaseItem(rel("v9.9.9", 0, "x", { draft: true })) === null, "单条:草稿必须拦");
  ok(parseReleaseItem(rel("v9.9.9", 0, "x", { prerelease: true })) === null, "单条:预发布必须拦");
  ok(parseReleaseItem({ tag_name: "release-candidate" }) === null, "单条:非数字开头的 tag 必须拦");
  ok(parseReleaseItem({ tag_name: "0.42" }) !== null, "单条:不带 v 的纯数字 tag 放行(口径是 /^v?\\d/)");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} history-check: ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
