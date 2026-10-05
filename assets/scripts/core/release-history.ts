// ============================================================
// 「更新记录」的数据模型:两端 Releases 列表 JSON → 规整的版本条目。
//
// 为什么单独一个文件、而且零 cc 依赖:发布脚本(dudu-release publish)把每一版的
// 更新说明写进 GitHub 与 Gitee 的 Release 正文,老版本只清 APK 附件、说明永久保留
// —— 所以「历史版本记录」的真话源就是 Releases **列表** API,不需要在包里再维护
// 一份会忘更新的 changelog 表。这里的职责是把两端(字段同名、脏法不同)的原始
// JSON 洗成弹窗能直接用的条目:过滤草稿/预发布、去重、按发布时间新→旧排。
// 洗数据是纯算术,tools/history-check.ts 在 node 下回归。
//
// tagName 刻意保留「v」前缀:弹窗要拿它跟 APP_VERSION_NAME(v0.0.29)比对打
// 「当前版本」标 —— 与 checkForUpdate 那边剥前缀的 UpdateInfo.version 是两个口径。
// ============================================================

/** 一条历史版本记录(时间新→旧排序后交给弹窗) */
export interface ReleaseEntry {
  /** 完整 tag,带 v 前缀(v0.0.29)—— 与 APP_VERSION_NAME 同口径,可直接比对 */
  tagName: string;
  /** Release 正文 markdown(可能为空:弹窗走 NOTE_FALLBACK 兜底) */
  notes: string;
  /** 发布时间(毫秒);两端都没给的脏条目记 0,排序沉底、日期位不摆 */
  dateMs: number;
}

/**
 * 单条 Release JSON(Gitee v5 与 GitHub 同名字段)→ 规整条目。
 * 返回 null 表示这条不进列表:非对象 / 草稿 / 预发布(与 checkForUpdate 同一口径)/
 * tag 缺失或不是数字开头的版本号(发布约定恒为 vX.Y.Z,别的都是脏数据)。
 */
export function parseReleaseItem(item: unknown): ReleaseEntry | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (o.draft === true || o.prerelease === true) return null;
  if (typeof o.tag_name !== "string") return null;   // 数字 tag 之类是脏数据,别 String() 成 "42" 混进来
  const tagName = o.tag_name.trim();
  if (!/^v?\d/.test(tagName)) return null;
  const notes = typeof o.body === "string" ? o.body : "";
  // 两端时间字段同名但可能各缺一个(Gitee 实测没有 published_at):逐个 typeof 收窄,
  // 不用 String() 兜 —— 非字符串进来就是 "[object Object]",Date.parse 出 NaN 还不如直接空
  const iso = typeof o.published_at === "string" ? o.published_at
    : typeof o.created_at === "string" ? o.created_at : "";
  const t = Date.parse(iso);
  return { tagName, notes, dateMs: Number.isFinite(t) ? t : 0 };
}

/**
 * Releases 列表 JSON → 规整条目数组(新→旧)。
 * 两端 API 本就按时间倒序返回,这里再排一次是防某条日期缺失(记 0)时沉底而不是插队;
 * 同 tag 重复出现(重发)只留第一条。
 */
export function parseReleaseList(data: unknown): ReleaseEntry[] {
  if (!Array.isArray(data)) return [];
  const out: ReleaseEntry[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    const e = parseReleaseItem(raw);
    if (!e || seen.has(e.tagName)) continue;
    seen.add(e.tagName);
    out.push(e);
  }
  return out.sort((a, b) => b.dateMs - a.dateMs);
}

/** 发布时间 → 「2026-09-30」;解析不出返回空串(表头就不摆日期) */
export function formatHistoryDate(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
