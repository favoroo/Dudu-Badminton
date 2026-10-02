// ============================================================
// 触觉反馈(手机震动)回归 —— 防的是用户报的那个现场:
// 「设置里打开了震动反馈,手机上根本没有用」。
//
// 排查结论:链路本来就是通的(APK 里有 AppActivity.vibrate、清单里有 VIBRATE 权限、
// 反射写法与引擎自身一致),坏在两件看不见的事上:
//   1) 旧实现只有时长没有振幅,而且 light=12ms —— 线性马达手机上 12~24ms 的
//      one-shot 基本无感,六档打击在触觉通道上被压成"全都一样";
//   2) 旧实现拿裸 catch{} 吞掉一切失败,所以"没震"永远无从判断是哪一环断了。
// 所以这份回归的牙齿是**时长地板**与**同帧第二下必须播出**,不是随便断言几个数。
//
// 断言分五组:
//   ① CFG.haptic 档位表自洽(地板/上限/振幅域/强弱单调/强度档表序单调)
//   ② shotKey 判据:普通对拉必须返回 null(用户定的"只在特殊击打时震")
//   ③ plan:无马达不发、无振幅控制时强度差折进时长且仍然单调、多段展开正确
//   ④ HapticGate:击球+得分同帧都要播出、同键连打要吞、队列有上限
//   ⑤ 设置页取值函数(hapticIndexOf/LevelId/Label)对垃圾档位的兜底
// 另带 --selftest:拿旧版那套 MS={light:12} 和"同帧直接 return"当反例,断言它们
// **会**被报警 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/haptic-check.js
//   node .tools-build/tools/haptic-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import {
  HapticCaps, HapticGate, HapticKey, HapticSeg, hasPulse, hapticIndexOf, hapticLabel,
  hapticLevelId, plan, segPower, shotKey,
} from "../assets/scripts/core/haptic";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const H = CFG.haptic;
/** 击球五档(与 fx 的 hitstop / shake / punch 三套阶梯同序);普通档故意不在表里 —— 不震 */
const SHOT: HapticKey[] = ["sweet", "perfect", "smash", "sweetSmash", "perfectSmash"];
/** 全部会震的时机,表必须齐 */
const ALL: HapticKey[] = [...SHOT, "skill", "skillLight", "landSmash", "score", "win", "lose"];
const AMP: HapticCaps = { hasVibrator: true, hasAmplitude: true };

// ---------- 可复用的表格体检(selftest 拿旧表当反例喂它) ----------
interface RawSpec { floorMs: number; capMs: number; keys: Array<{ key: string; ms: number; amp: number }> }
/** 取值域:时长落在地板与上限之间、振幅落在 1..255 */
function rangeViolations(s: RawSpec): string[] {
  const out: string[] = [];
  if (s.floorMs < 18) out.push(`floorMs ${s.floorMs} < 18(无感地板)`);
  for (const k of s.keys) {
    if (k.ms < s.floorMs) out.push(`${k.key}.ms=${k.ms} 低于地板 ${s.floorMs}`);
    if (k.ms > s.capMs) out.push(`${k.key}.ms=${k.ms} 超上限 ${s.capMs}`);
    if (k.amp < 1 || k.amp > 255) out.push(`${k.key}.amp=${k.amp} 越界 1..255`);
  }
  return out;
}
/** 强弱阶梯:只有"同一串递进关系"才要求 power 严格上升(技能/得分/胜负各自不是这条阶梯) */
function ladderViolations(s: RawSpec): string[] {
  const out: string[] = [];
  for (let i = 1; i < s.keys.length; i++) {
    const a = s.keys[i - 1], b = s.keys[i];
    if (a.ms * a.amp >= b.ms * b.amp) out.push(`${a.key}(${a.ms}×${a.amp}) 不弱于 ${b.key}(${b.ms}×${b.amp})`);
  }
  return out;
}

console.log("① 档位表自洽\n");
{
  const spec: RawSpec = {
    floorMs: H.floorMs, capMs: H.capMs,
    keys: ALL.map((k) => ({ key: k, ms: (H as unknown as Record<string, { ms: number; amp: number }>)[k].ms,
      amp: (H as unknown as Record<string, { ms: number; amp: number }>)[k].amp })),
  };
  ok(ALL.every((k) => hasPulse(k)), `${ALL.length} 个时机的档位全在表里(拼错键会在这是红)`);
  const v = rangeViolations(spec);
  ok(v.length === 0, `全部时机 ms ∈ [${H.floorMs}, ${H.capMs}] / amp ∈ [1,255]${v.length ? ` → ${v.join(" / ")}` : ""}`);
  const shotSpec: RawSpec = { floorMs: H.floorMs, capMs: H.capMs, keys: spec.keys.filter((k) => SHOT.includes(k.key as HapticKey)) };
  const sv = ladderViolations(shotSpec);
  ok(sv.length === 0, `击球五档由弱到强严格单调${sv.length ? ` → ${sv.join(" / ")}` : ""}`);
  ok(H.floorMs >= 18, `无感地板 floorMs=${H.floorMs} ≥ 18ms(旧 light=12 就是栽在这儿)`);
  ok(SHOT.every((k) => (H as unknown as Record<string, { segs?: number }>)[k].segs === undefined || k === "perfectSmash"),
    "击球档里只有 perfectSmash 用多段(日常不放大礼花)");
  // 强度档表:从弱到强单调,且 default 在表里
  const strength = H.levels.map((l) => l.msMul * l.ampMul);
  const ladderOk = strength.every((s, i) => i === 0 || s > strength[i - 1]);
  ok(ladderOk, `强度档乘子由弱到强严格单调:${strength.map((s) => s.toFixed(2)).join(" < ")} —— 滑杆往右一定更狠`);
  ok(new Set(H.levels.map((l) => l.id)).size === H.levels.length, "强度档 id 不重复(存档按 id 存)");
  ok(H.levels.some((l) => l.id === H.default), `default「${H.default}」在表里`);
  ok(H.throttleMs > 0 && H.gapMs > 0 && H.maxQueued >= 1, `节流 ${H.throttleMs} / 段距 ${H.gapMs} / 队列 ${H.maxQueued} 都是正数`);
}

console.log("\n② 判据:只在特殊击打震\n");
{
  const cases: Array<[boolean, boolean, boolean, HapticKey | null]> = [
    [false, false, false, null],        // 普通对拉 —— 用户明令不许震
    [false, false, true, "perfect"],
    [false, true, false, "sweet"],
    [false, true, true, "perfect"],      // perfect 盖过 sweet(与 fx 的 hitstopPerfect 优先于 Sweet 同序)
    [true, false, false, "smash"],
    [true, false, true, "perfectSmash"],
    [true, true, false, "sweetSmash"],
    [true, true, true, "perfectSmash"],
  ];
  let bad = 0;
  for (const [sm, sw, pf, want] of cases) {
    const got = shotKey(sm, sw, pf);
    if (got !== want) { bad++; console.log(`     smash=${sm} sweet=${sw} perfect=${pf} → ${got},期望 ${want}`); }
  }
  ok(bad === 0, `smash/sweet/perfect 八种组合全部命中(实际错 ${bad} 项)`);
  ok(shotKey(false, false, false) === null, "普通击球返回 null —— 这条是「不震」的判据本体");
  ok(cases.map((c) => c[3]).filter((k): k is HapticKey => k !== null).every(hasPulse), "返回的键都能在表里查到脉冲");
}

console.log("\n③ plan:设备能力不同的三种落点\n");
{
  ok(plan("smash", "standard", { hasVibrator: false, hasAmplitude: true }).length === 0,
    "无马达 → 空数组(一次反射都不发)");
  const segs = plan("perfectSmash", "standard", AMP);
  ok(segs.length === 2, `perfectSmash 展开 ${segs.length} 段(表里 segs=2)`);
  ok(segs.every((s) => s.key === "perfectSmash"), "同一次事件的各段都带同一个 key(同键防连打靠它)");
  const byLevel = (["low", "standard", "high"] as const).map((id) => segPower(plan("smash", id, AMP)[0]));
  ok(byLevel[0] < byLevel[1] && byLevel[1] < byLevel[2],
    `同一记扣杀在轻/标准/强下 power=${byLevel.map((n) => Math.round(n)).join(" < ")}`);
  // 无振幅控制:强度差折进时长,五档仍单调且不越上限
  const noAmp: HapticCaps = { hasVibrator: true, hasAmplitude: false };
  const fold = SHOT.map((k) => plan(k, "high", noAmp)[0]);
  ok(fold.every((s) => s.ms >= H.floorMs && s.ms <= H.capMs), `折算后时长仍落在 [${H.floorMs}, ${H.capMs}]`);
  ok(fold.every((s, i) => i === 0 || s.ms > fold[i - 1].ms),
    `无振幅控制时五档靠时长拉开:${fold.map((s) => s.ms).join(" < ")}`);
  const foldLevel = (["low", "standard", "high"] as const).map((id) => plan("smash", id, noAmp)[0].ms);
  ok(foldLevel[0] < foldLevel[2], `老机型上「轻→强」仍有差别:${foldLevel.join(" / ")} ms`);
  ok(plan("win", "standard", AMP).length === 3, "胜利是三段的唯一日常时机");
}

console.log("\n④ 闸门:同帧两件事都要响得出\n");
{
  /** 假时钟:0→limit 每 5ms 一格,把该下发的段全记下来 */
  function drive(submits: Array<{ t: number; key: HapticKey }>, limit = 1200): HapticSeg[] {
    const g = new HapticGate();
    const out: HapticSeg[] = [];
    let i = 0;
    for (let t = 0; t <= limit; t += 5) {
      while (i < submits.length && submits[i].t === t) {
        const r = g.submit(t, plan(submits[i].key, "standard", AMP));
        if (r === "fire") out.push(plan(submits[i].key, "standard", AMP)[0]);
        i++;
      }
      const s = g.tick(t);
      if (s) out.push(s);
    }
    return out;
  }
  // 完美重扣 + 同帧得分:两件事都得响(旧写法 60ms 一刀切,第二下直接消失)
  const both = drive([{ t: 100, key: "perfectSmash" }, { t: 100, key: "score" }]);
  const keys = both.map((s) => s.key);
  ok(keys[0] === "perfectSmash", `完美重扣第一段立即下发(${keys.join(">")})`);
  ok(keys.filter((k) => k === "score").length === 2, "同帧的得分排到队尾后两段都播出(旧写法这里少 2 段)");
  ok(keys.length === 4, `共 4 段:重扣 2 + 得分 2(实得 ${keys.length})`);
  // 段与段之间必须留出 gapMs,不许糊成一坨
  const g2 = new HapticGate();
  const burst = plan("win", "standard", AMP);
  g2.submit(0, burst);
  const times: number[] = [0];
  for (let t = 1; t <= 400; t++) { const s = g2.tick(t); if (s) times.push(t); }
  ok(times.length === 3, `胜利三段全部放出(实得 ${times.length})`);
  ok(times[1] - times[0] >= burst[0].ms + H.gapMs && times[2] - times[1] >= burst[0].ms + H.gapMs,
    `相邻两段的间隔 ≥ 段长 + gap(${times.join(" → ")})`);
  // 同键连打要吞:10ms 内连点三次同一事件,只响第一次
  const spam = drive([{ t: 100, key: "smash" }, { t: 105, key: "smash" }, { t: 110, key: "smash" }]);
  ok(spam.length === 1, `连打三记扣杀只震一次(实得 ${spam.length})`);
  // 队列有上限:八件事同时涌进来,不许排成一串礼花
  const many = drive(Array.from({ length: 8 }, (_, i) => ({ t: 300, key: ALL[i % ALL.length] })));
  ok(many.length <= 1 + H.maxQueued, `单帧最多放 1 + maxQueued(${H.maxQueued}) 段(实发 ${many.length})`);
  // disable 之后彻底静默(反射桥确认坏了就该停手)
  const g3 = new HapticGate();
  g3.disable();
  ok(g3.submit(0, plan("smash", "standard", AMP)) === "swallow" && g3.tick(999) === null,
    "闸门 disable 后 submit/tick 全部静默");
}

console.log("\n⑤ 设置页取值兜底\n");
{
  ok(hapticIndexOf("standard") === H.levels.findIndex((l) => l.id === "standard"), "认得的档 id 定位到正确下标");
  ok(hapticIndexOf("不存在的档") === hapticIndexOf(H.default), "认不出的档退到默认档(与 paceTier 同语义)");
  ok(hapticIndexOf("") === hapticIndexOf(H.default) && hapticLevelId(-3) === H.levels[0].id,
    "空串/越界下标都不越表");
  ok(hapticLabel("垃圾值") === hapticLabel(H.default), "读数文案永远取得到人话档名");
  const seg: HapticSeg = { ms: 30, amp: 200, key: "smash" };
  ok(segPower(seg) === 6000, "power = 时长 × 振幅(排队取舍的唯一量纲)");
}

// ---------- --selftest:反例必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\n反例自检(每一条都必须被报警)\n");
  const old: RawSpec = {
    floorMs: 12, capMs: 40,
    keys: [{ key: "light", ms: 12, amp: 255 }, { key: "hit", ms: 24, amp: 255 }, { key: "score", ms: 40, amp: 255 }],
  };
  const v = [...rangeViolations(old), ...ladderViolations(old)];
  ok(v.length > 0, `旧表 MS={light:12} 被报警(${v.length} 条)`);
  ok(v.some((s) => s.includes("12")), "报的正是那个无感的 12ms");
  // 旧节流:同帧两件事只响一次 —— 必须被这套判据抓出来
  const legacyThrottle = (lastAt: number, now: number): boolean => now - lastAt < 60;
  ok(legacyThrottle(100, 100) === true, "旧写法在 t=100 的两件事上直接 return(第二下永远不发)");
  const g = new HapticGate();
  const first = g.submit(100, plan("perfectSmash", "standard", AMP));
  const second = g.submit(100, plan("score", "standard", AMP));
  ok(first === "fire" && second === "queue", "新闸门把同帧的较弱事件排进队列而不是丢弃");
  // 表被砍平也要能报:把所有击球档做成同一个强度
  const flat: RawSpec = { floorMs: H.floorMs, capMs: H.capMs, keys: SHOT.map((k) => ({ key: k, ms: 30, amp: 200 })) };
  ok(ladderViolations(flat).length === SHOT.length - 1, `五档压成同一 power 被逐对报警(${ladderViolations(flat).length} 条)`);
  const cur: RawSpec = {
    floorMs: H.floorMs, capMs: H.capMs,
    keys: SHOT.map((k) => ({ key: k, ms: (H as unknown as Record<string, { ms: number; amp: number }>)[k].ms,
      amp: (H as unknown as Record<string, { ms: number; amp: number }>)[k].amp })),
  };
  ok(ladderViolations(cur).length === 0, "同一判据下现行五档阶梯是干净的");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
console.log("真机才能验的:实际摸不摸得到(马达类型/系统触感总闸)、三档强度是否拉得开、双段脉冲的节奏感。");
process.exit(h.fails === 0 ? 0 : 1);
