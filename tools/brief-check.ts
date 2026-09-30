// ============================================================
// 战前简报弹窗排版回归 —— 防的是用户拍的那张现场图:
// 「全部都显示到外面去了」。三个病根:
//   1) 左对齐 Label 留着中心锚点 —— 文本框朝 x 左边再伸半个框宽,整段推出边框;
//   2) Label 默认不换行 + 文案最长 47 字 —— 情境说明一行糊到弹窗外;
//   3) 三星目标按 i*155 定宽排 —— 最长一条(14 字)压到第二条上,互相重叠。
//
// 排版已经搬进 assets/scripts/ui/brief-layout.ts(纯函数),这里对 **20 关全表**
// 断言四条:
//   1) 每一块都不出弹窗内边距(逐物理行实测宽 <= 可用宽);
//   2) 任何两块(含两颗按钮)互不重叠;
//   3) 弹窗高度 <= 红线(再高就顶穿大厅面板 PH=480);
//   4) 结构不跑偏:三块小标题 + 三条三星目标 + 两颗按钮,一条不多一条不少。
// 另带 --selftest:拿人造的畸形排版当反例,断言它**会**被报警 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/brief-check.js [--preview] [--selftest]
// ============================================================
import { CAMPAIGN_STAGES } from "../assets/scripts/core/campaign";
import { textW, wrapText } from "../assets/scripts/ui/text-metrics";
import {
  BRIEF, BRIEF_BTN, BRIEF_HEADS, briefOverlaps, briefOverflow, layoutBrief,
  type BriefItem, type BriefLayout, type BriefStage,
} from "../assets/scripts/ui/brief-layout";

let fails = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${msg}`); } else { console.log(`  ✓ ${msg}`); }
}

/** campaign-panel.PW / PH —— 面板尺寸改了要同步这里(同 strip-check 的口径) */
const PANEL_W = 880, PANEL_H = 480;

console.log("战前简报:不出框、不压字、不顶穿面板\n");

// ---------- ① 弹窗塞得进大厅面板 ----------
ok(BRIEF.dialogW <= PANEL_W - 60, `弹窗宽 ${BRIEF.dialogW} 比面板 ${PANEL_W} 窄,两侧留得下面板边框`);
ok(BRIEF.maxDialogH <= PANEL_H - 18, `高度红线 ${BRIEF.maxDialogH} <= 面板 ${PANEL_H} - 18`);

// ---------- ② 20 关全表逐关排版 ----------
const KEY_ORDER = ["title", "badge", "descHead", "desc", "hintHead", "hint", "target", "reward", "starHead"];
const worst: { stage: string; h: number } = { stage: "", h: 0 };
let longestDesc = 0, longestChip = 0;

for (const st of CAMPAIGN_STAGES) {
  const L = layoutBrief(st);
  const tag = `ST${st.stageNo < 10 ? "0" + st.stageNo : st.stageNo} ${st.title}`;

  const of = briefOverflow(L);
  ok(of.length === 0, `${tag}:不溢出内边距${of.length ? ` → ${of.join(" / ")}` : ""}`);
  const ov = briefOverlaps(L);
  ok(ov.length === 0, `${tag}:不压字${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  ok(L.dialogH <= BRIEF.maxDialogH, `${tag}:框高 ${L.dialogH} <= 红线 ${BRIEF.maxDialogH}`);
  ok(L.dialogH >= BRIEF.minDialogH, `${tag}:框高 ${L.dialogH} >= 下限 ${BRIEF.minDialogH}`);

  // 结构:骨架块顺序不变,三星目标恒为三条胶囊
  const skeleton = L.items.filter((i) => !i.key.startsWith("chip")).map((i) => i.key).join(">");
  ok(skeleton === KEY_ORDER.join(">"), `${tag}:块顺序 = 标题>徽章>三段小标题及其正文(实得 ${skeleton})`);
  const chips = L.items.filter((i) => i.role === "chip");
  ok(chips.length === st.starsGoal.length && chips.length === 3, `${tag}:三星目标 ${chips.length} 条胶囊`);
  ok(L.buttons.length === 2, `${tag}:底部两颗按钮`);

  // 小标题文案钉住:改的人只可能改 campaign.ts,不会顺手把标签也改了
  const head = (k: string): string => (L.items.find((i) => i.key === k)?.lines[0] ?? "");
  ok(head("descHead") === BRIEF_HEADS.desc && head("hintHead") === BRIEF_HEADS.hint && head("starHead") === BRIEF_HEADS.star,
    `${tag}:三块小标题用词不变`);

  // 正文真的被折开了(而不是整行硬塞):>可用宽就必须是多行
  const desc = L.items.find((i) => i.key === "desc")!;
  if (textW(st.desc, BRIEF.bodySize) > L.availW) ok(desc.lines.length > 1, `${tag}:情境说明超长 → 已折成 ${desc.lines.length} 行`);
  longestDesc = Math.max(longestDesc, desc.lines.length);
  longestChip = Math.max(longestChip, chips.reduce((m, c) => Math.max(m, c.lines[0].length - 2), 0));

  if (L.dialogH > worst.h) { worst.stage = tag; worst.h = L.dialogH; }
}

console.log(`\n  参照:最长框高 ${worst.h}(${worst.stage})、情境说明最多 ${longestDesc} 行、三星目标最长一条 ${longestChip} 字`);

// ---------- ③ 折行本身:任何输入都不横向溢出 ----------
{
  const avail = 400;
  const cases = [
    ["纯中文长句", "热带海岛刮起强劲多变的侧风球体在空中会被横向气流猛烈推移落点飘忽不定"],
    ["中英混排", "球网顶端配备磁轨 50px 近网球化作 1.75 倍速电浆激光重炮 立刻生效"],
    ["裸长词", "CHAMPIONSHIPPOINTOVERCLOCKEDCHAOSWITHOUTANYSINGLESPACEBREAKPOINTATALL"],
    ["硬换行", "第一行\n第二行"],
    ["空串", ""],
  ] as const;
  for (const [name, s] of cases) {
    const rows = wrapText(s, 13, avail);
    const bad = rows.filter((r) => textW(r, 13) > avail);
    ok(bad.length === 0, `wrapText(${name}):${rows.length} 行,每行实测宽都 <= ${avail}`);
  }
  ok(wrapText("行首不吃空格   ", 13, 400).every((r) => !r.startsWith(" ")), "wrapText:换行后行首不留空白、行尾不留空格");
}

// ---------- ④ selftest:反例必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿人造反例验判据有没有牙齿");
  const base = layoutBrief(CAMPAIGN_STAGES[0]);

  // (a) 文案长到顶穿红线
  const bloated: BriefStage = {
    ...CAMPAIGN_STAGES[0],
    desc: "侧风".repeat(120),
    hint: "落点".repeat(90),
  };
  const LB = layoutBrief(bloated);
  ok(LB.dialogH > BRIEF.maxDialogH, `超长文案会把框高顶到 ${LB.dialogH},红线 ${BRIEF.maxDialogH} 拦得住`);

  // (b) 手调坐标式的重叠(还原旧版:三条胶囊定宽 155 排、左对齐却留中心锚点
  //     → 框宽 200 各朝左伸 100,相邻两条互相压 45)
  const mkItem = (key: string, left: number, cy: number, w: number, h = 18): BriefItem =>
    ({ key, role: "chip", lines: ["x"], size: 11, lineH: h, h, w, left, cy });
  const crashed: BriefLayout = {
    ...base,
    items: [mkItem("chip0", -280, 0, 200), mkItem("chip1", -125, 0, 200)],
  };
  const ov = briefOverlaps(crashed);
  ok(ov.some((s) => s.includes("chip0 × chip1")), `旧版定宽 155 的胶囊排法被报重叠(${ov[0] ?? "无"})`);
  ok(briefOverlaps(base).length === 0, "同一个判据下现排版干净");

  // (c) 中心锚点式的溢出(还原旧版:左对齐却留中心锚点 → 整段伸到框外)
  const drifted: BriefLayout = {
    ...base,
    items: base.items.map((i) => (i.key === "desc" ? { ...i, left: i.left - BRIEF.dialogW / 2 + 100 } : i)),
  };
  ok(briefOverflow(drifted).some((s) => s.startsWith("desc:")), "正文被推到弹窗外时会被报溢出");
  ok(briefOverflow(base).length === 0, "同一个判据下现排版干净");
}

// ---------- ⑤ --preview:把排版打成行表,不开编辑器也能 eyeball ----------
if (process.argv.includes("--preview")) {
  for (const no of [1, 17, 20]) {
    const st = CAMPAIGN_STAGES.find((s) => s.stageNo === no)!;
    const L = layoutBrief(st);
    console.log(`\n预览 ST${no} ${st.title}:弹窗 ${L.dialogW}×${L.dialogH},内边距 ${BRIEF.padX},可用宽 ${L.availW}`);
    const rows: { cy: number; tag: string; text: string }[] = [];
    for (const it of L.items) {
      const mark = it.role === "title" || it.role === "badge" ? "居中" : `x=${it.left.toFixed(0)}`;
      it.lines.forEach((l, i) => rows.push({
        // cc 的 y 朝上:第 0 行在最上面
        cy: it.cy + it.h / 2 - (i + 0.5) * it.lineH,
        tag: `${it.key.padEnd(9)}${String(it.size).padStart(2)}号 ${mark.padStart(6)}`,
        text: l,
      }));
    }
    for (const b of L.buttons) rows.push({ cy: b.cy, tag: `btn:${b.key}`.padEnd(9) + " ".repeat(9), text: `${b.text}(${b.w}×${b.h} @x=${b.cx.toFixed(0)})` });
    rows.sort((a, b) => b.cy - a.cy);
    for (const r of rows) console.log(`  cy=${r.cy.toFixed(1).padStart(6)}  ${r.tag}  ${r.text}`);
  }
}

console.log(`\n${fails === 0 ? "✓" : "✗"} ${checks} 项断言,失败 ${fails}`);
process.exit(fails === 0 ? 0 : 1);
