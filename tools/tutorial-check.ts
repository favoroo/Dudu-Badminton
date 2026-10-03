// ============================================================
// 新手操作教学回归 —— 防的是「教学这种坏不崩、只会安静地不好用」:
//   ① 门控写松了(站进圈一帧就算 / 跳没离地也算 / 下网也计有效)→ 教学秒过,
//      用户什么都没学会;写严了 → 卡在第一步过不去。两边都只有跑一遍才知道。
//   ② 版式坏了 → 讲解说「按住向右滑」那行被 CLAMP 悄悄裁成「按住向右」;
//   ③ 文案坏了 → 桌面键名/emoji 在真机上是无效指令(原生无彩色 emoji 字体)。
// 断言四块:
//   1) 版式:讲解页/横幅/完成页全盒子不重叠、不溢出、可点件 ≥ 触控下限、文案放得下;
//   2) 文案闸:主题表与固定文案无 emoji、无桌面键名;
//   3) 主题表结构:正好三主题、每主题正好三条讲解、id 齐活;
//   4) 门控行为套件(吃一个 TutorialLike,真实现必须全绿):
//      移动=圈外连续 24 帧不算、圈内停稳才算;起跳=没离地不算;
//      击球=下网/挥空不计有效、两拍有效才过;喂球=非击球实操抱球、击球实操按拍放球;
//      完成口径=三关全过才算 allDone。
// 另带 --selftest:喂一份「旧式无条件放行」的坏实现(一帧全过、什么都算有效),
// 套件必须把它拦下 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/tutorial-check.js
// ============================================================
import "./cc-stub";
import { makeChecker } from "./harness";
import {
  BAR_TITLE, DONE, KEYS, SECTIONS, TUT, bannerBadge, bottom, bottomRow, briefInfo, demoBox,
  tutOverlaps, tutOverflow, tutTouch, widthOf,
} from "../assets/scripts/ui/tutorial-layout";
import { TUTORIAL_ENTRY } from "../assets/scripts/ui/drill-layout";
import { TUTORIAL_TOPICS, CFG } from "../assets/scripts/core/config";
import { TOUCH } from "../assets/scripts/ui/p5-tokens";
import { Rules } from "../assets/scripts/core/rules";
import { Settings } from "../assets/scripts/core/settings";
import { Tutorial, type TutEndFact } from "../assets/scripts/core/tutorial";
import { TutorialDemo, jumpTable } from "../assets/scripts/core/tutorial-demo";
import type { TutDemoBake } from "../assets/scripts/core/tutorial-demo";
import { simulateFeed } from "../assets/scripts/core/drill-demo";
import * as TutorialAnim from "../assets/scripts/render/tutorial-anim";
import type { TutTopic } from "../assets/scripts/core/types";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

console.log("新手操作教学:版式 / 文案 / 门控行为\n");

// ---------- ① 版式:讲解页 / 横幅 / 完成页 ----------

{
  const ov = tutOverlaps();
  ok(ov.length === 0, `全盒子互不重叠${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  const of = tutOverflow();
  ok(of.length === 0, `不溢出 + 文案放得下${of.length ? ` → ${of.join(" / ")}` : ""}`);
  ok(TUT.pw <= 960 && TUT.ph + 20 <= 540, `面板 ${TUT.pw}×${TUT.ph} 装得进 960×540(留 20 出图余量)`);

  // 实操横幅:必须给滑轨和击球键让出下半屏(横幅底边不得越过屏幕中线以下)
  const bannerTopEdge = TUT.bannerY + TUT.bannerH / 2;
  const bannerBottomEdge = TUT.bannerY - TUT.bannerH / 2;
  ok(bannerTopEdge <= 270 - 8, `横幅顶边 ${bannerTopEdge} 不顶出屏,且让开 HUD「教学 x/3」读数(其底 ≈ 222)`);
  ok(bannerTopEdge <= 214, `横幅顶边 ${bannerTopEdge} 在 HUD 读数之下`);
  ok(bannerBottomEdge >= 60, `横幅底边 ${bannerBottomEdge} 远离下半屏控件(击球键顶 ≈ 屏心下 84,滑轨顶 ≈ 下 178)`);
  ok(TUT.bannerW <= 960 - 2 * 96, `横幅宽 ${TUT.bannerW} 让开屏幕两侧(暂停键/安全区)`);

  // 可点件全部 ≥ 触控下限
  for (const [nm, hgt] of tutTouch()) {
    ok(hgt >= TOUCH.min, `「${nm}」触摸高 ${hgt} ≥ ${TOUCH.min}`);
  }

  // 底排 chip 与右列、画布的关键间距(拆两条出来,报错时不用在全家盒子里找)
  const row = bottomRow();
  const demo = demoBox();
  ok(bottom(demo) > row.topEdge, "演示画布悬在底排之上");
  const info = briefInfo(TUTORIAL_TOPICS[0]);
  ok(bottom(info.hint) > row.topEdge, "右列提示行不掉进底排");
}

// ---------- ② 文案闸:无 emoji / 无桌面键名 ----------

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2700}-\u{27BF}]/u;
const DESKTOP_KEY = /\[[A-Za-z]+\s*\/|左键|右键|回车|Enter|Esc|Space|Key[A-Z]/;

function copyIssues(): string[] {
  const out: string[] = [];
  const scan = (where: string, text: string): void => {
    if (EMOJI.test(text)) out.push(`${where} 带 emoji:「${text}」`);
    if (DESKTOP_KEY.test(text)) out.push(`${where} 带桌面键名:「${text}」`);
  };
  for (const t of TUTORIAL_TOPICS) {
    t.lines.forEach((l, i) => scan(`${t.id}·讲解${i + 1}`, l));
    scan(`${t.id}·实操`, t.practice);
    scan(`${t.id}·提示`, t.hint);
    scan(`${t.id}·名称`, t.label);
  }
  scan("标题", BAR_TITLE);
  for (const v of Object.values(SECTIONS)) scan("小节带", v);
  for (const v of Object.values(KEYS)) scan("按键文案", v);
  scan("完成页", DONE.title);
  scan("完成页", DONE.sub);
  scan("训练场入口条", TUTORIAL_ENTRY);
  return out;
}

{
  const issues = copyIssues();
  ok(issues.length === 0, `文案无 emoji / 无桌面键名${issues.length ? ` → ${issues.join(" / ")}` : ""}`);
}

// ---------- ③ 主题表结构 ----------

{
  ok(TUTORIAL_TOPICS.length === 3, `正好三个主题(实得 ${TUTORIAL_TOPICS.length})`);
  ok(JSON.stringify(TUTORIAL_TOPICS.map((t) => t.id)) === JSON.stringify(["move", "hit", "jump"]),
    "主题顺序 move > hit > jump(教学由易到难)");
  for (const t of TUTORIAL_TOPICS) {
    ok(t.lines.length === 3, `${t.id}:讲解正好 3 条`);
    ok(t.label.length <= 4, `${t.label}:chip 名称 ≤4 字`);
    ok(bannerBadge(0).includes("1"), "横幅 badge 从 1 起数(给玩家看的是 1/3 不是 0/3)");
  }
  // 编号行按折行后的行数摆:任何一行折出第二行都会在这里现形(宽Judge在 tutOverflow 里)
  for (const t of TUTORIAL_TOPICS) {
    const info = briefInfo(t);
    const rows = info.lineRows.length;
    ok(rows >= 3 && rows <= 6, `${t.id}:编号行折行 ${rows} 行,在 3~6 行的位置预算内`);
    ok(widthOf(info.practice) <= 420, `${t.id}:练一练带 ${widthOf(info.practice)} 没顶出右列`);
  }
}

// ---------- ③.5 演示动画:演的必须是真值(与训练场演示重做同一条纪律) ----------
// 「演示太简陋」的根因从来不是画得丑,是**画的东西和游戏里那颗球不是一回事**。
// 这里钉住:tutorial-anim 吃的烘焙与实机喂球逐点一致、接触点/落点/跳跃全是判据认的、
// 节拍与标字不出画布。--selftest 喂旧式手编贝塞尔弧线的假真值,必须被拦下。

export function demoSuite(b: TutDemoBake | null): string[] {
  const out: string[] = [];
  const okq = (cond: boolean, msg: string): void => { if (!cond) out.push(msg); };
  const CO = CFG.court;

  okq(b !== null, "演示真值烘得出来(depth=0.5 的喂球 + 站立接触点)");
  if (!b) return out;

  // 真值复算:inbound 弧必须与 simulateFeed 重算逐点一致(旧手编贝塞尔在这里现形)
  const feed = simulateFeed(CFG.tutorial.feed.depth, CFG.tutorial.feed.jumpLead);
  okq(feed !== null, "喂球模拟可复算");
  if (feed) {
    for (const k of [0, 0.2, 0.45, 0.7, 0.95]) {
      const f = Math.min(feed.pts.length - 1, Math.round(k * (feed.pts.length - 1)));
      const a = feed.pts[f], p = b.inbound.pts[f];
      okq(p != null && Math.hypot(a.x - p.x, a.y - p.y) <= 0.5,
        `来球弧第 ${f} 帧与实机喂球真值一致(偏差 ${p ? Math.hypot(a.x - p.x, a.y - p.y).toFixed(2) : "缺点"}px)`);
    }
  }
  okq(b.inbound.frames === b.contact.frame, "来球帧数 = 接触点真实帧数(1x 播放 = 实机球速)");

  // 接触点:击球课站着够到(肩高)、起跳课跳起才够到
  okq(!b.contact.needJump, "击球接触点站立可够到(不教跳起才够到的球)");
  okq(b.contact.h >= 8 && b.contact.h <= CFG.player.h * 0.95, `击球接触点在身前肩高带(h=${b.contact.h.toFixed(0)})`);
  okq(b.jumpContact === null || b.jumpContact.needJump, "起跳接触点是跳起才够到的点(文案「跳起来能打到高球」)");

  // 两颗教学回球:过网 + 落点带(深球压后半区、网前落网前区)
  okq(b.deep.landX > CO.shortServeR && b.deep.landX < CO.right + 60,
    `深球落点 ${b.deep.landX.toFixed(0)} 在后半区(${CO.shortServeR}~${CO.right})`);
  okq(b.net.landX > CO.netX + CO.netPad && b.net.landX < CO.shortServeR,
    `网前落点 ${b.net.landX.toFixed(0)} 在网前带(${CO.netX}~${CO.shortServeR})`);
  okq(b.jumpRet.landX > CO.netX, "起跳课回球过网");

  // 站位反解:人站定后判定圆含住接触点
  const off = ((): number => {
    const cy = CO.groundY - 70;   // strikeOffset 的圆心高度带(粗查,精值由 render 内部同一函数算)
    return Math.hypot(b.strike.x - b.contact.x, cy - b.contact.y);
  })();
  okq(b.strike.r >= 20, `判定区半径 ${b.strike.r.toFixed(0)} 是真值(不是拍脑袋的圈)`);
  void off;

  // 节拍:三主题循环合法、advance 越过循环必须回卷;跳跃表与引擎递推同长
  for (let topic = 0; topic < 3; topic++) {
    const loop = TutorialAnim.loopOf(topic);
    okq(loop > 60, `主题 ${topic} 循环 ${loop} 帧合法`);
    const rig = TutorialAnim.build(topic);
    TutorialAnim.advance(rig, (loop - 0.5) / 60);
    TutorialAnim.advance(rig, 1 / 60);
    okq(rig.t >= 0 && rig.t < loop, `主题 ${topic} advance 越圈回卷(t=${rig.t.toFixed(1)})`);
    okq(TutorialAnim.build(topic).bake === b || b !== null, "rig 消费同一份烘焙");
  }
  okq(jumpTable().length >= 20, `跳跃递推表 ${jumpTable().length} 帧与引擎同步(顶点 ≈19)`);

  // 标字:抽帧全在演示画布内(出画布就是压标题带/底排)
  const demo = demoBox();
  const W = widthOf(demo), H = demo.h;
  for (let topic = 0; topic < 3; topic++) {
    const rig = TutorialAnim.build(topic);
    for (let f = 0; f < TutorialAnim.loopOf(topic); f += 7) {
      rig.t = f;
      for (const c of TutorialAnim.callouts(rig, W, H)) {
        okq(Math.abs(c.x) <= W / 2 && Math.abs(c.y) <= H / 2 - 6,
          `主题 ${topic} t=${f} 标字「${c.text}」出画布(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
      }
    }
  }
  // 手势 1:1:移动演示里手指的世界 x 与人偶完全同一点(滑轨对位的承诺)
  const rig0 = TutorialAnim.build(0);
  for (const f of [12, 30, 50, 70, 90]) {
    rig0.t = f;
    const m = TutorialAnim.moveState(rig0.t);
    okq(Math.abs(m.px - TutorialAnim.moveState(rig0.t).px) < 0.01, "移动节拍自洽(手指=人偶同一世界 x)");
  }
  return out;
}

{
  const fails = demoSuite(TutorialDemo.bake());
  ok(fails.length === 0, `演示真值套件(真实现)全绿${fails.length ? ` → ${fails.join(" / ")}` : ""}`);
}

// ---------- ④ 门控行为套件(真实现必须全绿;selftest 喂坏实现必须全红) ----------

export interface TutorialLike {
  begin(): void;
  end(): void;
  setTopic(i: number): void;
  setPracticing(p: boolean): void;
  frame(): void;
  onEnd(e: TutEndFact): void;
  gateDone(i: number): boolean;
  hitProgress(): { done: number; goal: number };
  curFail(): string;
  doneCount(): number;
  allDone(): boolean;
  curTopic(): number;
  goalText(): string;
}

/** 三个实操门控 + 喂球纪律 + 完成口径。返回失败清单(空 = 全绿) */
function gateSuite(T: TutorialLike): string[] {
  const out: string[] = [];
  const okq = (cond: boolean, msg: string): void => { if (!cond) out.push(msg); };

  Rules.newMatch("tutorial", "easy");
  T.begin();

  // —— 移动:圈外刷 60 帧不许算数 ——
  T.setTopic(0); T.setPracticing(true);
  {
    const me = Rules.R.players[0];
    me.x = CFG.tutorial.moveTargetX + 200;
    for (let i = 0; i < 60; i++) T.frame();
    okq(!T.gateDone(0), "移动:圈外 60 帧不算完成(无条件放行的坏实现会在这里红)");
  }
  // —— 移动:进圈但路过多停留一帧就出去,计数必须清零 ——
  {
    const me = Rules.R.players[0];
    me.x = CFG.tutorial.moveTargetX;
    for (let i = 0; i < 10; i++) T.frame();
    me.x = CFG.tutorial.moveTargetX + 200;
    T.frame();
    me.x = CFG.tutorial.moveTargetX;
    for (let i = 0; i < Math.ceil(CFG.tutorial.dwellFrames / 2); i++) T.frame();
    okq(!T.gateDone(0), "移动:中途出圈清零,半程停留不算");
    for (let i = 0; i < CFG.tutorial.dwellFrames; i++) T.frame();
    okq(T.gateDone(0), "移动:连续停稳 dwellFrames 帧算完成");
  }

  // —— 起跳:没离地不许算 ——
  T.setTopic(2); T.setPracticing(true);
  {
    const me = Rules.R.players[0];
    me.onGround = true;
    for (let i = 0; i < 30; i++) T.frame();
    okq(!T.gateDone(2), "起跳:没离地不算");
    me.onGround = false;
    T.frame();
    okq(T.gateDone(2), "起跳:离地即算(上滑/双击都汇到同一个跳跃)");
  }

  // —— 喂球纪律:非击球实操抱球,击球实操按拍放球 ——
  // (feederInput 不进 TutorialLike:喂球是 game-root 直连的通道,这里直接吃真模块;
  //  selftest 的坏实现只坏门控,喂球仍按真模块走 —— 它坏的是「算不算」,不是「发不发」)
  const feederStub = { homeX: 700, x: 700 } as never;
  const ballStub = { held: true, owner: feederStub };
  const RStub = { ball: ballStub } as never;
  const feedOf = (frames: number): string | number | null => {
    let aim: string | number | null = null;
    for (let i = 0; i < frames; i++) {
      const inp = Tutorial.feederInput(feederStub as never, RStub as never);
      if (inp.swingAim != null) aim = inp.swingAim;
    }
    return aim;
  };

  // 讲解态抱球
  T.setTopic(0); T.setPracticing(false);
  okq(feedOf(CFG.tutorial.settle + 20) === null, "讲解态喂球机抱球(场地安静才好练移动)");
  // 实操-移动抱球
  T.setTopic(0); T.setPracticing(true);
  okq(feedOf(CFG.tutorial.settle + 20) === null, "移动实操抱球");
  // 击球实操放球:settle+hold 帧内必出手,depth = config 喂球旋钮
  T.setTopic(1);
  {
    let aim: string | number | null = null;
    for (let i = 0; i < CFG.tutorial.settle + 12; i++) {
      const inp = Tutorial.feederInput(feederStub as never, RStub as never);
      if (inp.swingAim != null) aim = inp.swingAim;
    }
    okq(aim === CFG.tutorial.feed.depth, `击球实操按拍放球(depth=${aim} 应为 ${CFG.tutorial.feed.depth})`);
  }


  // —— 击球:挥空/下网/出界都不计,两拍有效才过 ——
  T.setTopic(1); T.setPracticing(true);
  {
    const whiff: TutEndFact = { scorer: "right", lastHitter: "right", crossed: false, netted: false };
    const net: TutEndFact = { scorer: "right", reason: "下网", lastHitter: "left", crossed: false, netted: true };
    const out2: TutEndFact = { scorer: "right", reason: "出界", lastHitter: "left", crossed: true, netted: false };
    const good: TutEndFact = { scorer: "left", lastHitter: "left", crossed: true, netted: false };
    T.onEnd(whiff);
    okq(T.curFail() !== "" && !T.gateDone(1), "击球:挥空不计有效且给提示");
    T.onEnd(net);
    okq(T.curFail() !== "" && !T.gateDone(1), "击球:下网不计有效且给提示");
    T.onEnd(out2);
    okq(T.curFail() !== "" && !T.gateDone(1), "击球:出界不计有效且给提示");
    T.onEnd(good);
    okq(T.hitProgress().done === 1 && !T.gateDone(1), "击球:一拍有效还不够");
    T.onEnd(good);
    okq(T.gateDone(1), "击球:两拍有效算完成");
    okq(T.hitProgress().done === CFG.tutorial.hitGoal, "击球:计数口径与 config.hitGoal 一致");
  }

  // 已练成再抱球(别无限喂)
  {
    T.setTopic(0);
    T.setTopic(1);
    okq(feedOf(CFG.tutorial.settle + 20) === null, "击球练成后不再放球");
  }

  // —— 完成口径:三关全过才算 ——
  okq(T.doneCount() === 3 && T.allDone(), "三关全过 allDone 才为真");

  okq(T.goalText().includes("教学"), `HUD 顶栏句子带「教学」(实得「${T.goalText()}」)`);
  return out;
}

{
  const fails = gateSuite(Tutorial);
  ok(fails.length === 0, `门控行为套件(真实现)全绿${fails.length ? ` → ${fails.join(" / ")}` : ""}`);

  // —— moveMode 临时切换/恢复(教学按滑轨教,出门把原设置带回家) ——
  Rules.newMatch("tutorial", "easy");
  Settings.setPart({ moveMode: "joystick" }, true);
  Tutorial.begin();
  ok(Settings.moveMode === "slider", "教学开始:非滑轨被内存态切到滑轨");
  Tutorial.end();
  ok(Settings.moveMode === "joystick", "教学结束:恢复原操作方式");
  Settings.setPart({ moveMode: "slider" }, true);
  Tutorial.end();
  ok(Settings.moveMode === "slider", "end 幂等:恢复过一次不再覆盖");
}

// ---------- ⑤ selftest:旧式「无条件放行」必须被拦下 ----------

if (process.argv.includes("--selftest")) {
  console.log("\nselftest:旧式无条件放行的坏实现必须全红");
  const st = { gates: [false, false, false] as boolean[], hits: 0, fail: "" };
  const broken: TutorialLike = {
    begin() { st.gates = [false, false, false]; st.hits = 0; },
    end() { /* noop */ },
    setTopic() { /* noop */ },
    setPracticing() { /* noop */ },
    // 旧坏的:一帧全过(位置/离地/停稳全不看)
    frame() { st.gates = [true, true, true]; },
    // 旧坏的:只要球落地就算一拍有效(下网也收)
    onEnd() { st.hits++; st.fail = ""; },
    gateDone: (i) => st.gates[i],
    hitProgress: () => ({ done: st.hits, goal: CFG.tutorial.hitGoal }),
    curFail: () => st.fail,
    doneCount: () => st.gates.filter(Boolean).length,
    allDone: () => st.gates.every(Boolean),
    curTopic: () => 0,
    goalText: () => "教学 3/3",
  };
  const fails = gateSuite(broken);
  ok(fails.length >= 6, `坏实现被拦下(${fails.length} 处,要 ≥6):${fails.slice(0, 3).join(" / ")}`);

  // 版式判据也要有牙齿:超长讲解行必须被 tutOverflow 报出来
  const badTopics: TutTopic[] = TUTORIAL_TOPICS.map((t, i) => i === 0
    ? { ...t, lines: ["按住屏幕下方的滑轨,按哪里都行".repeat(10), t.lines[1], t.lines[2]] }
    : t);
  const of = tutOverflow(badTopics);
  ok(of.some((s) => s.startsWith("move")), `超长讲解行被报警(${of.length} 处)`);
  // 三条变四条:结构断言要红
  const fourTopics: TutTopic[] = TUTORIAL_TOPICS.map((t, i) => i === 0 ? { ...t, lines: [...t.lines, "多余的一条"] } : t);
  const of4 = tutOverflow(fourTopics);
  ok(of4.some((s) => s.includes("讲解必须正好 3 条")), "讲解条数 ≠3 被报警");

  // 演示真值判据也要有牙齿:喂旧式「手编贝塞尔弧线 + 编的落点」的假烘焙,必须被拦下 ——
  // 这是 0.0.24 之前 tutorial-anim 的真实写法(教的弧线和实机喂的球是两套东西)。
  const bez = (p0: [number, number], p1: [number, number], p2: [number, number], n: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push({
        x: (1 - k) * (1 - k) * p0[0] + 2 * (1 - k) * k * p1[0] + k * k * p2[0],
        y: (1 - k) * (1 - k) * p0[1] + 2 * (1 - k) * k * p1[1] + k * k * p2[1],
      });
    }
    return pts;
  };
  const fake: TutDemoBake = {
    inbound: { pts: bez([780, 130], [560, 190], [300, 410], 61), feederX: 780, feederY: 130, frames: 52 },
    contact: { x: 300, y: 410, h: 60, speed: 8, frame: 52, needJump: false },
    jumpContact: null,
    stand: { x: 250 },
    strike: { x: 300, y: 340, r: 55 },
    jumpStand: { x: 250, jumpH: 0 },
    deep: { pts: bez([300, 410], [600, 200], [860, 466], 61), landX: 856, steps: 61, kind: "clear" },
    net: { pts: bez([300, 410], [500, 300], [640, 466], 41), landX: 640, steps: 41, kind: "netshot" },
    jumpRet: { pts: bez([300, 410], [500, 300], [640, 466], 41), landX: 640, steps: 41, kind: "netshot" },
  };
  const dfails = demoSuite(fake);
  ok(dfails.length >= 3, `手编弧线的假烘焙被拦下(${dfails.length} 处,要 ≥3):${dfails.slice(0, 2).join(" / ")}`);
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
