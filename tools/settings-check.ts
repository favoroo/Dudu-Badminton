// 设置层自检(core/settings.ts)。
//
// 为什么单独测它:这层是「一个坏档能把游戏开崩吗」的唯一关口。存档是
// JSON 字符串直接进 localStorage 的,用户可能从旧版本 APK 升级、可能手改、
// 也可能被半截写入截断 —— 所以消毒(sanitize)与夹取(clamp)必须有常驻断言,
// 光靠进游戏点一遍是点不出「坏 JSON 会不会崩」的。
//
// 另外三条只有代码能验:
//   ① 默认值必须等于改造前 touchpad.ts 里写死的那套坐标,否则一进游戏按键就移位;
//   ② persist=false 真的不落盘(拖动 60Hz 写同步 IO 是性能事故);
//   ③ 老的全局 muted 档要能映射到拆分之音效/音乐两条总线。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/settings-check.js
import { setStorageBackend, type KVStorage } from "../assets/scripts/core/utils";
import { Settings, SettingsStore, sanitize, PAD_BASE, PAD_LIMIT, PAD_ACTIONS } from "../assets/scripts/core/settings";

// ---------- 假后端 ----------

class MemKV implements KVStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/** 每个用例一套干净盘,免得写盘顺序互相污染 */
function freshKV(): MemKV {
  const kv = new MemKV();
  setStorageBackend(kv);
  return kv;
}

console.log("设置层:默认值 / 消毒 / 夹取 / 落盘时机 / 老档兼容\n");

// ---------- ① 默认值 = 改造前的写死布局 ----------

{
  freshKV();
  const s = new SettingsStore().init();
  ok(s.sfxOn && s.bgmOn, "默认音效与音乐都开");
  ok(s.hintLanding && s.hintShake && s.hintFloat, "默认三个画面提示都开");
  ok(s.hapticOn, "默认触觉反馈开");
  ok(near(s.sfxVol, 0.8) && near(s.bgmVol, 0.6), `默认音量 sfx=${s.sfxVol} bgm=${s.bgmVol}`);
  for (const a of PAD_ACTIONS) {
    const p = s.pad[a];
    ok(p.dx === 0 && p.dy === 0 && near(p.r, PAD_BASE[a].r), `默认布局 ${a} = 位移 0 + 半径 ${PAD_BASE[a].r}`);
  }
  ok(PAD_ACTIONS.every((a) => PAD_BASE[a].r >= PAD_LIMIT.rMin && PAD_BASE[a].r <= PAD_LIMIT.rMax),
    "每个键的默认半径都落在可调区间内");
  const leftN = PAD_ACTIONS.filter((a) => PAD_BASE[a].cluster === "left").length;
  ok(leftN === 2 && PAD_ACTIONS.length - leftN === 3, "左簇 2 键 / 右簇 3 键");
}

// ---------- ② 夹取:越界写回被夹住 ----------

{
  freshKV();
  const st = new SettingsStore();
  st.init();
  st.setPad("left", { dx: 99999, dy: -99999, r: 9999 });
  ok(st.v.pad.left.dx === PAD_LIMIT.maxDx, `dx 越上限夹到 ${PAD_LIMIT.maxDx}(实得 ${st.v.pad.left.dx})`);
  ok(st.v.pad.left.dy === -PAD_LIMIT.maxDy, `dy 越下限夹到 ${-PAD_LIMIT.maxDy}(实得 ${st.v.pad.left.dy})`);
  ok(near(st.v.pad.left.r, PAD_LIMIT.rMax), `r 越上限夹到 ${PAD_LIMIT.rMax}`);
  st.setPad("jump", { r: 1 });
  ok(near(st.v.pad.jump.r, PAD_LIMIT.rMin), `r 越下限夹到 ${PAD_LIMIT.rMin}`);

  st.setPart({ sfxVol: 5, bgmVol: -3, hintShake: "nonsense" as unknown as boolean });
  ok(near(st.v.sfxVol, 1), "音量 >1 夹到 1");
  ok(near(st.v.bgmVol, 0), "音量 <0 夹到 0");
  ok(st.v.hintShake === true, "布尔字段收到垃圾值时保持原默认,而不是被 falsy 悄悄关掉");
}

// ---------- ③ 消毒:坏 JSON 不许崩,认得出的一部分要留住 ----------

{
  const d = sanitize(null);
  ok(d.sfxOn && near(d.pad.right.r, PAD_BASE.right.r), "sanitize(null) 给全套默认");
  ok(near(sanitize(undefined).bgmVol, 0.6), "sanitize(undefined) 不抛异常");
  ok(near(sanitize("垃圾字符串" as unknown).sfxVol, 0.8), "sanitize(字符串) 不抛异常");

  const junk = sanitize({ sfxOn: "yes", sfxVol: "x", hapticOn: 42, pad: { left: { dx: "10", r: null }, right: 7 } });
  ok(junk.sfxOn === true, "sfxOn 收到字符串 → 回默认 true");
  ok(near(junk.sfxVol, 0.8), "sfxVol 收到字符串 → 回默认");
  ok(junk.hapticOn === true, "hapticOn 收到数字 → 回默认 true");
  ok(junk.pad.left.dx === 0 && near(junk.pad.left.r, PAD_BASE.left.r), "pad 项里字段类型不对 → 该键回默认");
  ok(junk.pad.right.dx === 0, "pad 项整个不是对象 → 该键回默认,不抛");

  const partial = sanitize({ bgmOn: false, pad: { jump: { dx: 20, dy: -5, r: 60 } } });
  ok(partial.bgmOn === false, "认得出的标量保留");
  ok(partial.pad.jump.dx === 20 && partial.pad.jump.dy === -5 && near(partial.pad.jump.r, 60), "认得出的布局项保留");
  ok(partial.pad.left.dx === 0 && near(partial.pad.left.r, PAD_BASE.left.r), "档里缺的键补默认(以后加键不用写迁移)");

  const over = sanitize({ pad: { swingFar: { dx: 1e9, dy: 1e9, r: 1e9 } } });
  ok(over.pad.swingFar.dx === PAD_LIMIT.maxDx && near(over.pad.swingFar.r, PAD_LIMIT.rMax), "读档这一路也夹一次越界值");
  const nan = sanitize({ pad: { swingNear: { dx: NaN, r: Infinity } }, sfxVol: NaN });
  ok(nan.pad.swingNear.dx === 0 && near(nan.pad.swingNear.r, PAD_BASE.swingNear.r), "NaN/Infinity → 默认");
  ok(near(nan.sfxVol, 0.8), "sfxVol=NaN → 默认");
}

// ---------- ④ 落盘时机:拖动中不写,松手才写 ----------

{
  const kv = freshKV();
  const st = new SettingsStore();
  st.init();
  st.setPad("left", { dx: 40 }, false);        // 模拟 TOUCH_MOVE 每帧
  st.setPad("left", { dx: 80 }, false);
  ok(!kv.m.has("dd02.settings"), "persist=false 期间一次盘都没落(60Hz 同步 IO 会卡手)");
  ok(st.hasPending, "内存里标着「有待提交」");
  st.flush();
  ok(kv.m.has("dd02.settings"), "flush() 才写盘");
  const raw = JSON.parse(kv.m.get("dd02.settings")!);
  ok(raw.pad.left.dx === 80, "落盘的是最后一次拖动结果,不是中途值");
  ok(!st.hasPending, "flush 后待提交标记清掉");
  ok(kv.m.has("dd02.muted"), "老 muted 键有镜像(回滚旧版本不至于变响)");
}

// ---------- ⑤ 老全局静音档 → 拆分成两条总线 ----------

{
  const kv = freshKV();
  kv.setItem("dd02.muted", "true");
  const st = new SettingsStore();
  st.init();
  ok(st.v.sfxOn === false && st.v.bgmOn === false, "老档 muted=true → 音效与音乐都关");
  ok(st.allMuted, "两条都关 = allMuted");
  ok(kv.m.has("dd02.settings"), "兼容迁移时顺手把新档写下去");

  const off = st.toggleAllMute();
  ok(off === false && st.v.sfxOn && st.v.bgmOn, "全静音态下再切 → 两条总线一起恢复,返回新的 allMuted=false");
  const on = st.toggleAllMute();
  ok(on === true && !st.v.sfxOn && !st.v.bgmOn, "再切 → 两条总线一起静音");
  ok(st.v.sfxVol === 0.8 && st.v.bgmVol === 0.6, "静音只翻开关,不抹掉音量数值(取消静音不必重调)");
}

// ---------- ⑥ 只关一条总线时 allMuted 不成立 ----------

{
  freshKV();
  const st = new SettingsStore();
  st.init();
  st.setPart({ bgmOn: false });
  ok(!st.allMuted, "只关音乐 ≠ 全局静音 —— 菜单徽章不该跟着显示「静音」");
  st.setPart({ sfxOn: false });
  ok(st.allMuted, "两条都关才算全局静音");
}

// ---------- ⑦ 订阅/退订(按键实例与面板靠这条链同步) ----------

{
  freshKV();
  const st = new SettingsStore();
  st.init();
  let hits = 0;
  const off = st.onChange(() => { hits++; });
  st.setPart({ sfxOn: false });
  ok(hits === 1, "改动通知订阅者一次");
  st.setPad("left", { dx: 10 });
  ok(hits === 2, "布局改动也通知");
  off();
  st.setPart({ sfxOn: true });
  ok(hits === 2, "退订后不再收到");
}

// ---------- ⑧ 单例与实例互不干扰(运行期用单例,工具用实例) ----------

{
  const kv = freshKV();
  Settings.init();
  ok(typeof Settings.v.sfxVol === "number", "全局单例可读");
  ok(!kv.m.has("dd02.settings"), "只读盘不写盘:启动不该凭空造档");
}

console.log(`\n${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
