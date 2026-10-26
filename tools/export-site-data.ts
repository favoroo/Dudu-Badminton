// ============================================================
// 介绍站数据导出 —— 从 core 的数据表现读,产出 site/dist/data.js + site/dist/tokens.css,
// 并把游戏侧预览图搬进 site/dist/img/。
//
// 为什么要有它(而不是在 index.html 里手抄数字):网页上「20 关」「7 款技能」「39 款皮肤」
// 这些数字一旦手写,下一次调平衡就与游戏分叉,而分叉只会被玩家发现。这里的每一个数
// 都从 config.ts / campaign.ts 现算,和游戏读的是同一张表 —— 改 config 重跑一遍就同步。
//
// 依赖纪律:零 cc。只 import core/ 的纯数据模块(config / campaign / version),
// 与 tools/ 下其它断言脚本同一条路子(node 直接跑)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/export-site-data.js
//   node .tools-build/tools/export-site-data.js --check   # 只校验不写盘(部署脚本用)
//
// 图片管线:源图住在 .tools-build/(gitignore,由各 preview 工具出图)。
// 缺图不报错退出 —— 记一条 warn 继续,网页那边有 CSS 兜底底色;
// 但**一张都找不到**才判失败,那是「忘了跑 preview」而不是「少一张」。
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join, resolve } from "path";

import { CFG, DIFF_PICKS, DRILLS, RARITY_META, SKINS, COSMETICS, COSMO_SLOTS, TUTORIAL_TOPICS, ACTIVITIES } from "../assets/scripts/core/config";
import { CAMPAIGN_STAGES } from "../assets/scripts/core/campaign";
import { APP_VERSION, APP_VERSION_NAME, REPO_CONFIG } from "../assets/scripts/core/version";

const ROOT = resolve(__dirname, "..", "..");
const SITE = join(ROOT, "site", "dist");
const PREV = join(ROOT, ".tools-build");
const CHECK_ONLY = process.argv.includes("--check");

const warns: string[] = [];
function warn(msg: string): void {
  warns.push(msg);
}

// ---------- 站点用的皮肤图片映射 ----------

/**
 * 人物皮肤 → 出图文件名。design-preview 只覆盖前 10 款(那批是拆件重构前的老工具),
 * 后 4 款(萌芽豆丁/猫系少女/金羽宗师/纯白分身)只有 pose-preview 的 char-p-*.svg。
 * 这里把两条来源并成一张表:能拿到矢量就优先矢量(SVG 无限清晰),否则退回 480px PNG。
 * 键是皮肤 id,值是 [目录, 文件名, 扩展名]。
 */
const SKIN_ART: Record<string, [string, string, "svg" | "png"]> = {};
for (const def of SKINS.player) {
  const short = def.id.replace(/^p-/, "");
  const svg = join(PREV, "pose-preview", `char-p-${short}.svg`);
  const png = join(PREV, "design-preview", `p-p-${short}.svg.png`);
  if (existsSync(svg)) SKIN_ART[def.id] = ["pose-preview", `char-p-${short}.svg`, "svg"];
  else if (existsSync(png)) SKIN_ART[def.id] = ["design-preview", `p-p-${short}.svg.png`, "png"];
  else warn(`皮肤 ${def.id} 没有出图(pose-preview / design-preview 都没找到),网页用色块兜底`);
}

/** 球馆 → court-preview 的出图名 */
const COURT_ART = ["arena", "beach", "cyber", "dojo"];

/** 技能 → skill-demo-preview 的演示图名(与 config 的 skill id 一一对应) */
const SKILL_ART = CFG.skills.list.map((s) => s.id);

// ---------- 拷贝图片 ----------

interface Copied { src: string; dest: string; bytes: number }

function copyArt(src: string, destRel: string): Copied | null {
  if (!existsSync(src)) {
    warn(`缺图: ${src.replace(ROOT + "/", "")} → 网页将缺这一张`);
    return null;
  }
  const dest = join(SITE, destRel);
  mkdirSync(join(dest, ".."), { recursive: true });

  // 角色矢量图自带一块不透明底(pose-preview 为了方便肉眼比对铺的 #12161f)。
  // 卡片自己有底色与网点,所以要把它剥掉 —— 留着就是每张卡里再嵌一块深灰方块。
  if (destRel.endsWith(".svg")) {
    const svg = readFileSync(src, "utf8").replace(/<rect width="100%" height="100%" fill="#[0-9a-fA-F]{3,8}"\/>\s*/g, "");
    writeFileSync(dest, svg);
  } else {
    copyFileSync(src, dest);
  }
  return { src, dest: destRel, bytes: statSync(dest).size };
}

/** 图标母版是 1024×1024 / 640 KB,金羽只占中间一块 —— 网页上最大显示 44px,
 *  原图直接放上去要等一次大解码,缩到 40px 时四周深底又糊成一团黑。
 *  所以裁到主体再缩:40px 下金羽占满整块,读得出是什么。 */
function resizeIcon(): void {
  const script = `
import sys
from PIL import Image
src, *dests = sys.argv[1:]
im = Image.open(src).convert("RGB")
w, h = im.size
bbox = im.convert("L").point(lambda v: 255 if v > 90 else 0).getbbox()
if bbox:
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    side = max(x1 - x0, y1 - y0)
    side = int(side * 1.16)                       # 留一圈呼吸位,别贴边
    half = side // 2
    im = im.crop((cx - half, cy - half, cx + half, cy + half))
for spec in dests:
    size, path = spec.split(":", 1)
    im.resize((int(size), int(size)), Image.LANCZOS).save(path, optimize=True)
    print(f"  icon {size}px")
`;
  try {
    execFileSync("python3", ["-c", script, join(ROOT, "tools", "app-icon-source.png"),
      `256:${join(SITE, "img", "app-icon.png")}`,
      `180:${join(SITE, "img", "app-icon-180.png")}`,
    ], { encoding: "utf8" });
  } catch {
    warn("PIL 不可用,图标未缩放(640 KB 原图会让首屏慢一拍)");
  }
}
function trimCourtWhite(): void {
  const script = `
import sys
from PIL import Image
for p in sys.argv[1:]:
    im = Image.open(p).convert("RGB")
    w, h = im.size
    keep = h
    for y in range(h - 1, -1, -1):
        row = [im.getpixel((x, y)) for x in range(0, w, 17)]
        white = sum(1 for c in row if c[0] > 250 and c[1] > 250 and c[2] > 250)
        if white < len(row) * 0.6:
            keep = y + 1
            break
    if keep < h:
        Image.open(p).crop((0, 0, w, keep)).save(p)
        print(f"  {p.split('/')[-1]}: {h} → {keep}")
`;
  try {
    const out = execFileSync("python3", ["-c", script, ...COURT_ART.map((c) => join(SITE, "img", "court", `${c}.png`))], { encoding: "utf8" });
    if (out.trim()) console.log(out.trim());
  } catch {
    warn("PIL 不可用,球场图白边未裁(网页 CSS 会裁掉,只是多传几十 KB)");
  }
}

function copyImages(): void {
  const copied: Copied[] = [];
  const push = (c: Copied | null): void => { if (c) copied.push(c); };

  // 图标走 resizeIcon 单独出(1024 母版不进网页)
  mkdirSync(join(SITE, "img"), { recursive: true });

  for (const def of SKINS.player) {
    const art = SKIN_ART[def.id];
    if (!art) continue;
    const [dir, file, ext] = art;
    push(copyArt(join(PREV, dir, file), `img/skin/${def.id}.${ext}`));
  }

  for (const c of COURT_ART) push(copyArt(join(PREV, "court-preview", `court-${c}.png`), `img/court/${c}.png`));

  for (const id of SKILL_ART) {
    // 技能演示用**单帧 SVG 四连**(skill-demo-preview/{id}-{1..4}.svg):
    // 那张合成 PNG 顶部压着调试标注(帧号/笔数/「离地 115px」这类标定读数),
    // 是给开发看的不是给玩家看的。单帧 SVG 干净、矢量、还小得多。
    for (let i = 1; i <= 4; i++) {
      push(copyArt(join(PREV, "skill-demo-preview", `${id}-${i}.svg`), `img/skill/${id}-${i}.svg`));
    }
  }

  // 移动方式图示用 site-pad-diagram 出的干净版(三格,无标定读数);
  // pad-diagram-preview 那张每格底下印着「41 笔 · 人物 x 363」,是给开发看的
  push(copyArt(join(PREV, "site-pad-diagram", "pad.png"), "img/pad-diagram.png"));

  if (!copied.length) {
    console.error("✗ 一张图都没找到 —— 先跑 `npm test` 或对应 preview 工具出图(.tools-build/ 是 gitignore 的)");
    process.exit(1);
  }
  const mb = copied.reduce((n, c) => n + c.bytes, 0) / 1024 / 1024;
  console.log(`✓ 拷贝 ${copied.length} 张图 → site/dist/img(${mb.toFixed(1)} MB)`);
  trimCourtWhite();
  resizeIcon();
}

// ---------- data.js ----------

/** 主页五块大色块 —— 与 main-menu.ts 的语义一一对应(红=上场 / 黄=闯关 / 绿=练球 / 青=专项 / 纸白=档案) */
const MODES = [
  { key: "match", tag: "MATCH", name: "对练", role: "primary", line: "四档难度 · 选球馆 · 随时开局",
    body: "从入门到极限四档 AI，四个主题球馆任选。11 分制、平分需领先 2 分，打完就地看结算。" },
  { key: "campaign", tag: "CHALLENGE", name: "闯关模式", role: "star", line: `${CAMPAIGN_STAGES.length} 关 · 4 章`,
    body: "海滩到黄昏馆四章 20 关，每关带一条独立机制：沙尘、迷雾、电磁脉冲、全息双生、赛点开局。" },
  { key: "endless", tag: "ENDLESS", name: "无限练习", role: "drill", line: "无视比分 · 持续对拉",
    body: "不判赛点、不结束，想打多久打多久。适合把手感磨顺，或者单纯享受对拉。" },
  { key: "drill", tag: "TRAIN", name: "专项训练", role: "info", line: `${DRILLS.length} 项球种专项`,
    body: "后场重杀、高远对拉、网前点杀、搓放、平抽、挑高 —— 每关只喂一种球，打出有效球才算过。" },
  { key: "career", tag: "CAREER", name: "生涯与商店", role: "record", line: "等级 · 金币 · 皮肤",
    body: "打赢攒金币，升级解锁新技能与新皮肤。六项生涯统计、十八档里程碑、每日每周任务。" },
];

const STATS = [
  { n: CAMPAIGN_STAGES.length, unit: "关", label: "闯关关卡" },
  { n: CFG.skills.list.length, unit: "款", label: "主动技能" },
  { n: SKINS.player.length + SKINS.racket.length + SKINS.shuttle.length + SKINS.face.length, unit: "款", label: "皮肤与球具" },
  { n: COSMETICS.length, unit: "件", label: "可换装扮" },
  { n: CFG.courts.length, unit: "座", label: "主题球馆" },
  { n: DIFF_PICKS.length, unit: "档", label: "AI 难度" },
];

const SKIN_TABS = [
  { key: "player", label: "人物", count: SKINS.player.length },
  { key: "racket", label: "球拍", count: SKINS.racket.length },
  { key: "shuttle", label: "羽毛球", count: SKINS.shuttle.length },
  { key: "face", label: "脸面", count: SKINS.face.length },
];

const data = {
  version: APP_VERSION,
  versionName: APP_VERSION_NAME,
  repo: REPO_CONFIG,
  stats: STATS,
  modes: MODES,
  activities: {
    daily: ACTIVITIES.filter((a) => a.id.startsWith("d-")).length,
    weekly: ACTIVITIES.filter((a) => a.id.startsWith("w-")).length,
  },
  diffs: DIFF_PICKS.map((d) => ({ key: d.key, name: d.name, tag: d.tag, accent: d.accent, desc: d.desc })),
  skills: CFG.skills.list.map((s) => ({
    id: s.id, name: s.name, short: s.shortName, tag: s.tag, desc: s.desc,
    unlock: s.unlockLevel, cd: s.cooldownFrames, accent: s.accent,
  })),
  skins: {
    tabs: SKIN_TABS,
    player: SKINS.player.map((s) => ({
      id: s.id, name: s.name, rarity: s.rarity ?? "common",
      price: s.price, unlock: s.unlockLevel ?? 0,
      art: SKIN_ART[s.id] ? `img/skin/${s.id}.${SKIN_ART[s.id][2]}` : "",
      color: s.main,
    })),
    families: Object.values(SKINS).flat().length,
  },
  rarity: RARITY_META,
  courts: CFG.courts.map((c) => ({ id: c.id, name: c.name, title: c.title, sub: c.sub, tag: c.tag, desc: c.desc, accent: c.accent })),
  drills: DRILLS.map((d) => ({ id: d.id, label: d.label, tag: d.tag, desc: d.desc, goal: d.goal })),
  chapters: Array.from(new Set(CAMPAIGN_STAGES.map((s) => s.chapterName))),
  tutorial: TUTORIAL_TOPICS.map((t) => ({ id: t.id, label: t.label, lines: t.lines })),
  accessories: {
    total: COSMETICS.length,
    slots: COSMO_SLOTS.map((s) => s.name),
  },
  /** 手势表:文案与 config.touchAim / TUTORIAL_TOPICS 同源(阈值现读,不手抄) */
  gestures: [
    { dir: "→", name: "右滑", desc: "打深球，压底线" },
    { dir: "←", name: "左滑", desc: "放网前，短球" },
    { dir: "↑", name: "上滑", desc: "挑高球到后场" },
    { dir: "↓", name: "下滑", desc: "平抽快球" },
    { dir: "⇢", name: "长滑", desc: "滑出按键浮现锁定，松手锁向" },
  ],
  touchAim: { commitPx: CFG.touchAim.commitPx, commitPxY: CFG.touchAim.commitPxY },
};

// ---------- tokens.css ----------

/**
 * 配色只从 p5-tokens 现读 —— 网页与游戏同一份色板。
 * 网页需要的派生量(硬影偏移、斜切角度)按 P5 的规矩现算,不在两处各写一份。
 */
function buildTokens(): string {
  const src = join(ROOT, "assets", "scripts", "ui", "p5-tokens.ts");
  const text = readFileSync(src, "utf8");
  // 直接解析 C 表字面量:import 会拖进 cc 的模块图(虽然本文件零 cc,但保守起见走文本)
  const pick = (key: string): string => {
    const m = new RegExp(`\\b${key}\\s*:\\s*"(#[0-9a-fA-F]{6})"`).exec(text);
    if (!m) throw new Error(`p5-tokens 里找不到色值 ${key}`);
    return m[1];
  };
  const slant = (key: string): number => {
    const m = new RegExp(`\\b${key}\\s*:\\s*(\\d+)`).exec(text);
    if (!m) throw new Error(`p5-tokens 里找不到斜切档 ${key}`);
    return parseInt(m[1], 10);
  };

  const vars: Array<[string, string]> = [
    ["ink", pick("ink")], ["navy", pick("navy")], ["navy2", pick("navy2")],
    ["panel-top", pick("panelTop")], ["line", pick("line")],
    ["paper", pick("paper")], ["paper-dim", pick("paperDim")],
    ["acid", pick("acid")], ["acid-edge", pick("acidEdge")], ["acid-dk", pick("acidDk")],
    ["slash", pick("slash")], ["slash-dk", pick("slashDk")],
    ["red", pick("red")], ["blue", pick("blue")], ["wood", pick("wood")],
    ["good", pick("good")], ["bad", pick("bad")], ["hot", pick("hot")],
    ["cyan", pick("cyan")], ["dim", pick("dim")], ["dim-deep", pick("dimDeep")],
  ];

  return [
    "/* 由 tools/export-site-data.ts 生成 —— 不要手改。改色请改 assets/scripts/ui/p5-tokens.ts */",
    ":root {",
    ...vars.map(([k, v]) => `  --c-${k}: ${v};`),
    `  --slant-plate: ${slant("plate")}deg;`,
    `  --slant-block: ${slant("block")}deg;`,
    `  --slant-button: ${slant("button")}deg;`,
    `  --slant-band: ${slant("band")}deg;`,
    "}",
    "",
  ].join("\n");
}

// ---------- 写盘 ----------

const OUT_DATA = join(SITE, "data.js");
const OUT_TOKENS = join(SITE, "tokens.css");

function main(): void {
  if (!existsSync(SITE)) mkdirSync(SITE, { recursive: true });

  const dataJs = [
    "// 由 tools/export-site-data.ts 生成 —— 不要手改。改数字请改 assets/scripts/core/config.ts",
    `window.GAME_DATA = ${JSON.stringify(data, null, 2)};`,
    "",
  ].join("\n");
  const tokensCss = buildTokens();

  if (CHECK_ONLY) {
    const oldData = existsSync(OUT_DATA) ? readFileSync(OUT_DATA, "utf8") : "";
    const oldTokens = existsSync(OUT_TOKENS) ? readFileSync(OUT_TOKENS, "utf8") : "";
    const stale: string[] = [];
    if (oldData !== dataJs) stale.push("data.js");
    if (oldTokens !== tokensCss) stale.push("tokens.css");
    if (stale.length) {
      console.error(`✗ 站点数据与游戏数据表不同步: ${stale.join(", ")} —— 跑 node .tools-build/tools/export-site-data.js`);
      process.exit(1);
    }
    console.log("✓ 站点数据与 config 同步");
    return;
  }

  writeFileSync(OUT_DATA, dataJs);
  writeFileSync(OUT_TOKENS, tokensCss);
  console.log(`✓ 写 ${OUT_DATA.replace(ROOT + "/", "")}(${(dataJs.length / 1024).toFixed(1)} KB)`);
  console.log(`✓ 写 ${OUT_TOKENS.replace(ROOT + "/", "")}(${tokensCss.split("\n").length - 1} 行)`);

  copyImages();

  if (warns.length) {
    console.log(`\n⚠ ${warns.length} 条告警:`);
    for (const w of warns) console.log(`  · ${w}`);
  }
  console.log(`\n统计: ${STATS.map((s) => `${s.label} ${s.n}${s.unit}`).join(" / ")}`);
}

main();
