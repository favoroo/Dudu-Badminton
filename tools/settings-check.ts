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
import { Settings, SettingsStore, sanitize, PAD_BASE, PAD_LIMIT, JOYSTICK_LIMIT, JOYSTICK_BASE, SLIDER_BASE, SLIDER_LIMIT, PAD_ACTIONS } from "../assets/scripts/core/settings";

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
  ok(s.replayMode === "matchpoint", "默认回放模式为 matchpoint(赛点回放)");
  ok(near(s.padAlpha, 0.8), `默认透明度 ${s.padAlpha}`);
  ok(near(s.sfxVol, 0.8) && near(s.bgmVol, 0.6), `默认音量 sfx=${s.sfxVol} bgm=${s.bgmVol}`);
  for (const a of PAD_ACTIONS) {
    const p = s.pad[a];
    ok(p.dx === 0 && p.dy === 0 && near(p.r, PAD_BASE[a].r), `默认布局 ${a} = 位移 0 + 半径 ${PAD_BASE[a].r}`);
  }
  ok(PAD_ACTIONS.every((a) => PAD_BASE[a].r >= PAD_LIMIT.rMin && PAD_BASE[a].r <= PAD_LIMIT.rMax),
    "每个键的默认半径都落在可调区间内");
  // 这里断言的是「跳跃不再和击球键挤同一只手」这个**性质**,不是全局键数 ——
  // 右簇后续还会加键(击球 swipe 正在改),写死 3/3 这种数字会把别人正常的
  // 迭代炸成红灯,而且红的是不相干的那条。
  ok(PAD_BASE.jump.cluster === "left", "跳跃键归属左簇(不再和击球键挤右手)");
  ok(PAD_BASE.left.cluster === "left" && PAD_BASE.right.cluster === "left", "左右移动键在左簇");
  for (const a of ["swingFar", "swingNear", "lunge"] as const) {
    ok(PAD_BASE[a].cluster === "right", `${a} 留在右簇(击球/跨步本来就该右手管)`);
  }
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

  st.setPart({ padAlpha: 5 });
  ok(near(st.v.padAlpha, PAD_LIMIT.alphaMax), `padAlpha >1 夹到 ${PAD_LIMIT.alphaMax}`);
  st.setPart({ padAlpha: -1 });
  ok(near(st.v.padAlpha, PAD_LIMIT.alphaMin), `padAlpha <0.2 夹到 ${PAD_LIMIT.alphaMin}`);
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

  // 跨步键是后来加的:老档只有 5 个键,消毒后必须给新键补默认(缺了 = Settings.padOf("lunge")
  // 读到 undefined,建键那一帧直接崩)。
  const old5 = sanitize({
    pad: {
      left: { dx: 10, dy: 0, r: 44 }, right: { dx: 0, dy: 0, r: 44 },
      jump: { dx: 0, dy: 0, r: 48 }, swingFar: { dx: 0, dy: 0, r: 38 }, swingNear: { dx: 0, dy: 0, r: 38 },
    },
  });
  ok(old5.pad.left.dx === 10, "老档里已调过的键位照旧生效");
  ok(old5.pad.lunge.dx === 0 && near(old5.pad.lunge.r, PAD_BASE.lunge.r), "老档没有跨步键 → 该键回默认布局");
  ok(old5.pad.swing.dx === 0 && near(old5.pad.swing.r, PAD_BASE.swing.r), "老档没有击球键(合并后新增) → 该键回默认布局");

  const partial = sanitize({ v: 2, bgmOn: false, pad: { jump: { dx: 20, dy: -5, r: 60 } } });
  ok(partial.bgmOn === false, "认得出的标量保留");
  ok(partial.pad.jump.dx === 20 && partial.pad.jump.dy === -5 && near(partial.pad.jump.r, 60), "认得出的布局项保留");

  // ---------- 跳跃键换簇的老档迁移(v<2) ----------
  // 老档里 jump 的 dx/dy 是相对**右下角**的位移,新基准在**左下角**,照原值套过去
  // 会飞到屏幕正中甚至屏外。位移上限本来夹在 ±240/±180,老值全都合法 —— 只有"簇变了"
  // 这件事在数值上检测不出来,必须靠版本号。半径与簇无关,要保留用户调过的大小。
  const legacyJump = sanitize({
    pad: { jump: { dx: -60, dy: 142, r: 55 }, left: { dx: 8, dy: 0, r: 44 } },
  });
  ok(legacyJump.pad.jump.dx === 0 && legacyJump.pad.jump.dy === 0, "v<2 老档:跳跃偏移重置到新的左簇默认位");
  ok(near(legacyJump.pad.jump.r, 55), "v<2 老档:跳跃半径仍保留(半径与簇无关)");
  ok(legacyJump.pad.left.dx === 8, "v<2 老档:没换簇的键位不受迁移牵连");
  // v=2 及以后的档不能再被重置,否则用户每次冷启动摆的位置都没了
  const v2Jump = sanitize({ v: 2, pad: { jump: { dx: -30, dy: 40, r: 55 } } });
  ok(v2Jump.pad.jump.dx === -30 && v2Jump.pad.jump.dy === 40, "v=2 档:跳跃偏移原样读回,迁移只认一次");
  ok(partial.pad.left.dx === 0 && near(partial.pad.left.r, PAD_BASE.left.r), "档里缺的键补默认(以后加键不用写迁移)");

  const over = sanitize({ pad: { swingFar: { dx: 1e9, dy: 1e9, r: 1e9 } } });
  ok(over.pad.swingFar.dx === PAD_LIMIT.maxDx && near(over.pad.swingFar.r, PAD_LIMIT.rMax), "读档这一路也夹一次越界值");
  const overSwing = sanitize({ pad: { swing: { dx: 1e9, dy: 1e9, r: 1e9 } } });
  ok(overSwing.pad.swing.dx === PAD_LIMIT.maxDx && near(overSwing.pad.swing.r, PAD_LIMIT.rMax), "击球键(合并版)越界也夹");
  const nan = sanitize({ pad: { swingNear: { dx: NaN, r: Infinity } }, sfxVol: NaN });
  ok(nan.pad.swingNear.dx === 0 && near(nan.pad.swingNear.r, PAD_BASE.swingNear.r), "NaN/Infinity → 默认");
  ok(near(nan.sfxVol, 0.8), "sfxVol=NaN → 默认");

  ok(near(sanitize({ padAlpha: "x" }).padAlpha, 0.8), "padAlpha 收到字符串 → 回默认 0.8");
  ok(near(sanitize({ padAlpha: 0.5 }).padAlpha, 0.5), "padAlpha 合法值保留");
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

// ---------- ⑨ resetPad 同时重置透明度与摇杆 ----------

{
  freshKV();
  const st = new SettingsStore();
  st.init();
  st.setPad("left", { dx: 50, dy: 30, r: 60 });
  st.setJoystick({ dx: 40, dy: -20, r: 90 });
  st.setSlider({ dx: 30, dy: -10, r: 35 });
  st.setPart({ padAlpha: 0.4 });
  st.resetPad();
  ok(near(st.v.pad.left.dx, 0) && near(st.v.pad.left.r, PAD_BASE.left.r), "resetPad 位移与半径回默认");
  ok(near(st.v.padAlpha, 0.8), "resetPad 透明度也回默认 0.8");
  ok(near(st.v.joystick.dx, 0) && near(st.v.joystick.r, JOYSTICK_BASE.r), "resetPad 摇杆本体也回默认");
  ok(near(st.v.slider.dx, 0) && near(st.v.slider.r, SLIDER_BASE.r), "resetPad 滑轨本体也回默认");
}

// ---------- ⑩ moveMode 老档默认 buttons / 新档默认 joystick / 支持 slider ----------

{
  // 老档:raw 里带 pad 但没有 moveMode → 判定为摇杆功能上线前装机,保持左右键
  const old = sanitize({ pad: { left: { dx: 10, dy: 0, r: 44 } } });
  ok(old.moveMode === "buttons", "老档(有 pad 无 moveMode)默认 buttons,不打断既成习惯");
  // 新装机:raw = null → sanitize 走 fresh 的 joystick
  const newInstall = sanitize(null);
  ok(newInstall.moveMode === "joystick", "新装机默认 joystick,直接体验新玩法");
  // 显式存过 moveMode 的档,照实读回
  const explicit = sanitize({ moveMode: "joystick", pad: { left: { dx: 10, dy: 0, r: 44 } } });
  ok(explicit.moveMode === "joystick", "显式存的 moveMode 优先于「老档 → buttons」的兜底");
  const explicitBtn = sanitize({ moveMode: "buttons" });
  ok(explicitBtn.moveMode === "buttons", "显式存 buttons 也照读");
  const explicitSld = sanitize({ moveMode: "slider" });
  ok(explicitSld.moveMode === "slider", "显式存 slider 也照读");
  // 垃圾值 → 回默认(注意此时 raw 里没 pad → 视作新档,默认 joystick)
  const junk = sanitize({ moveMode: "nonsense" });
  ok(junk.moveMode === "joystick", "moveMode 收到垃圾值 → 走默认");
}

// ---------- ⑪ 摇杆与滑轨本体字段:消毒与夹取 ----------

{
  const over = sanitize({ joystick: { dx: 9999, dy: -9999, r: 999 }, slider: { dx: 9999, dy: -9999, r: 999 } });
  ok(over.joystick.dx === JOYSTICK_LIMIT.maxDx, `摇杆 dx 越上限夹到 ${JOYSTICK_LIMIT.maxDx}`);
  ok(over.joystick.dy === -JOYSTICK_LIMIT.maxDy, `摇杆 dy 越下限夹到 ${-JOYSTICK_LIMIT.maxDy}`);
  ok(over.joystick.r === JOYSTICK_LIMIT.rMax, `摇杆 r 越上限夹到 ${JOYSTICK_LIMIT.rMax}`);
  ok(over.slider.dx === SLIDER_LIMIT.maxDx, `滑轨 dx 越上限夹到 ${SLIDER_LIMIT.maxDx}`);
  ok(over.slider.dy === -SLIDER_LIMIT.maxDy, `滑轨 dy 越下限夹到 ${-SLIDER_LIMIT.maxDy}`);
  ok(over.slider.r === SLIDER_LIMIT.rMax, `滑轨 r 越上限夹到 ${SLIDER_LIMIT.rMax}`);

  const small = sanitize({ joystick: { r: 1 }, slider: { r: 1 } });
  ok(small.joystick.r === JOYSTICK_LIMIT.rMin, `摇杆 r 越下限夹到 ${JOYSTICK_LIMIT.rMin}`);
  ok(small.slider.r === SLIDER_LIMIT.rMin, `滑轨 r 越下限夹到 ${SLIDER_LIMIT.rMin}`);
  const junk = sanitize({ joystick: "nonsense", slider: "nonsense" });
  ok(junk.joystick.r === JOYSTICK_BASE.r, "joystick 字段整体是垃圾 → 回默认,不抛");
  ok(junk.slider.r === SLIDER_BASE.r, "slider 字段整体是垃圾 → 回默认,不抛");

  freshKV();
  const st = new SettingsStore();
  st.init();
  st.setJoystick({ dx: 999, dy: 0, r: 200 });
  ok(st.v.joystick.dx === JOYSTICK_LIMIT.maxDx && st.v.joystick.r === JOYSTICK_LIMIT.rMax,
    "setJoystick 也夹越界值");
  st.setSlider({ dx: 999, dy: 0, r: 200 });
  ok(st.v.slider.dx === SLIDER_LIMIT.maxDx && st.v.slider.r === SLIDER_LIMIT.rMax,
    "setSlider 也夹越界值");

  st.setPart({ moveMode: "slider" });
  ok(st.v.moveMode === "slider", "setPart 能设为 slider 模式");
  st.setPart({ moveMode: "buttons" });
  ok(st.v.moveMode === "buttons", "setPart 能翻 moveMode");
  st.setPart({ moveMode: "nonsense" as never });
  ok(st.v.moveMode === "buttons", "moveMode 收到垃圾值 → 保持原值不动");

  st.setPart({ replayMode: "all" });
  ok(st.v.replayMode === "all", "setPart 能翻 replayMode 到 all");
  st.setPart({ replayMode: "off" });
  ok(st.v.replayMode === "off", "setPart 能翻 replayMode 到 off");
  st.setPart({ replayMode: "nonsense" as never });
  ok(st.v.replayMode === "off", "replayMode 收到垃圾值 → 保持原值不动");
}

console.log(`\n${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
