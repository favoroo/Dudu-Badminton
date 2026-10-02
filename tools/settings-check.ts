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
import { makeChecker } from "./harness";
import { setStorageBackend, type KVStorage } from "../assets/scripts/core/utils";
import { Settings, SettingsStore, sanitize, PAD_BASE, PAD_LIMIT, JOYSTICK_LIMIT, JOYSTICK_BASE, SLIDER_BASE, SLIDER_LIMIT, PAD_ACTIONS, railGeo } from "../assets/scripts/core/settings";
import { CFG } from "../assets/scripts/core/config";

// ---------- 假后端 ----------

class MemKV implements KVStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);
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
  // 「顶部移不动」的回归哨兵:旧上限 ±240/±180 会把这种合法拖动悄悄吞掉。
  // 现在能放到哪儿由视口决定(在 touchpad 里夹),Settings 只管坏档。
  st.setPad("left", { dx: 500, dy: 400 });
  ok(st.v.pad.left.dx === 500 && st.v.pad.left.dy === 400,
    `dy=400 / dx=500 原样保留(旧上限会夹到 ±180/±240,实得 ${st.v.pad.left.dy}/${st.v.pad.left.dx})`);

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
    v: 3,
    pad: {
      left: { dx: 10, dy: 0, r: 44 }, right: { dx: 0, dy: 0, r: 44 },
      jump: { dx: 0, dy: 0, r: 48 }, swingFar: { dx: 0, dy: 0, r: 38 }, swingNear: { dx: 0, dy: 0, r: 38 },
    },
  });
  ok(old5.pad.left.dx === 10, "老档里已调过的键位照旧生效");
  ok(old5.pad.lunge.dx === 0 && near(old5.pad.lunge.r, PAD_BASE.lunge.r), "老档没有跨步键 → 该键回默认布局");
  ok(old5.pad.swing.dx === 0 && near(old5.pad.swing.r, PAD_BASE.swing.r), "老档没有击球键(合并后新增) → 该键回默认布局");

  const partial = sanitize({ v: 3, bgmOn: false, pad: { jump: { dx: 20, dy: -5, r: 60 } } });
  ok(partial.bgmOn === false, "认得出的标量保留");
  ok(partial.pad.jump.dx === 20 && partial.pad.jump.dy === -5 && near(partial.pad.jump.r, 60), "认得出的布局项保留");

  // ---------- 布局重排的老档迁移(v<3;v<2 跳跃换簇一并被它覆盖) ----------
  // 存档里的 dx/dy 是相对**旧基准**的位移:跳键居中、右簇击球/跨步上下对调之后,
  // 照原值套到新基准上会把布局弄歪(甚至压到别的键上)。位移上限只是坏档护栏
  // (PLACE_GUARD,手指拖不到那么远),老值全都合法 —— 只有「基准变了」这件事
  // 在数值上检测不出来,必须靠版本号。半径与基准无关,保留用户调过的大小。
  const legacyJump = sanitize({
    pad: { jump: { dx: -60, dy: 142, r: 55 }, left: { dx: 8, dy: 0, r: 44 } },
  });
  ok(legacyJump.pad.jump.dx === 0 && legacyJump.pad.jump.dy === 0, "v<3 老档:跳跃偏移重置到新的居中默认位");
  ok(near(legacyJump.pad.jump.r, 55), "v<3 老档:跳跃半径仍保留(半径与基准无关)");
  ok(legacyJump.pad.left.dx === 0, "v<3 老档:左右键偏移一并重置(基准整体变了)");
  // v=3 及以后的档不能再被重置,否则用户每次冷启动摆的位置都没了
  const v3Jump = sanitize({ v: 3, pad: { jump: { dx: -30, dy: 40, r: 55 } } });
  ok(v3Jump.pad.jump.dx === -30 && v3Jump.pad.jump.dy === 40, "v=3 档:偏移原样读回,迁移只认一次");
  ok(partial.pad.left.dx === 0 && near(partial.pad.left.r, PAD_BASE.left.r), "档里缺的键补默认(以后加键不用写迁移)");

  const over = sanitize({ v: 3, pad: { swingFar: { dx: 1e9, dy: 1e9, r: 1e9 } } });
  ok(over.pad.swingFar.dx === PAD_LIMIT.maxDx && near(over.pad.swingFar.r, PAD_LIMIT.rMax), "读档这一路也夹一次越界值");
  const overSwing = sanitize({ v: 3, pad: { swing: { dx: 1e9, dy: 1e9, r: 1e9 } } });
  ok(overSwing.pad.swing.dx === PAD_LIMIT.maxDx && near(overSwing.pad.swing.r, PAD_LIMIT.rMax), "击球键(合并版)越界也夹");
  const nan = sanitize({ v: 3, pad: { swingNear: { dx: NaN, r: Infinity } }, sfxVol: NaN });
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
  // 输入必须大过护栏(PLACE_GUARD=2000)才谈得上「越界」—— 以前这里是 999,
  // 因为上限只有 200;位移上限退化成坏档护栏后,999 已经是个合法位置了。
  st.setJoystick({ dx: 99999, dy: 0, r: 200 });
  ok(st.v.joystick.dx === JOYSTICK_LIMIT.maxDx && st.v.joystick.r === JOYSTICK_LIMIT.rMax,
    "setJoystick 也夹越界值");
  st.setSlider({ dx: 99999, dy: 0, r: 200 });
  ok(st.v.slider.dx === SLIDER_LIMIT.maxDx && st.v.slider.r === SLIDER_LIMIT.rMax,
    "setSlider 也夹越界值");

  // 自由摆放:位移上限只是坏档护栏,不再充当「能拖到哪儿」的手感上限。
  // 护栏必须大过任何机型的可视区(FIXED_HEIGHT 高恒 540,半高 270;宽最宽按 1.25 倍
  // padScale 封顶算 600)—— 否则玩家往上拖会被静默吃掉,又变成「顶部移不动」那个 bug。
  ok(PAD_LIMIT.maxDy >= 540 && PAD_LIMIT.maxDx >= 1200,
    `按钮位移护栏(±${PAD_LIMIT.maxDx}/±${PAD_LIMIT.maxDy})覆盖得住最宽的可视区`);
  ok(JOYSTICK_LIMIT.maxDy >= 540, `摇杆位移护栏 ±${JOYSTICK_LIMIT.maxDy} 覆盖得住`);
  ok(SLIDER_LIMIT.maxDy >= 540, `滑轨纵向护栏 ±${SLIDER_LIMIT.maxDy} 覆盖得住`);
  ok(JOYSTICK_LIMIT.maxDx === PAD_LIMIT.maxDx, "摇杆与按钮同一套护栏,不再各夹各的");

  st.setPart({ moveMode: "slider" });
  ok(st.v.moveMode === "slider", "setPart 能设为 slider 模式");
  st.setPart({ moveMode: "buttons" });
  ok(st.v.moveMode === "buttons", "setPart 能翻 moveMode");
  st.setPart({ moveMode: "nonsense" as never });
  ok(st.v.moveMode === "buttons", "moveMode 收到垃圾值 → 保持原值不动");
}

// ---------- ⑫ 滑轨 ↔ 球场 1:1 对位(滑轨模式的全部卖点都压在这几条上) ----------

{
  const CO = CFG.court;
  const G = railGeo();

  // 轨长必须等于「人能站的那段地」,不多不少:比 player.ts 的夹取同源(wallL ~ netX-netPad)
  ok(G.minX === CO.wallL && G.maxX === CO.netX - CO.netPad,
    `可达区间取的是 [${CO.wallL}, ${CO.netX - CO.netPad}],与 player.ts 同源`);
  ok(G.span === G.maxX - G.minX, `轨心行程 span=${G.span} == 可达区间长度`);

  // readSlider 的映射式:targetX = centerUiX + thumbX + world.w/2(夹进可达区间)。
  // 斜率必须是 1 —— 手指挪 1px 人就挪 1px,这是"精准"两个字的定义。
  const target = (thumbX: number): number =>
    Math.min(G.maxX, Math.max(G.minX, G.centerUiX + thumbX + CFG.world.w / 2));
  ok(target(0) === (G.minX + G.maxX) / 2, `轨心正下方 = 区间中点 x=${target(0)}`);
  ok(target(-G.span / 2) === G.minX, "滑块推到最左端 → 人贴可达左界(wallL)");
  ok(target(G.span / 2) === G.maxX, "滑块推到最右端 → 人贴网前(netX-netPad)");
  ok(target(37) - target(12) === 25, "映射斜率恒为 1:手指挪 25px = 人挪 25px");
  // 轨心相对屏幕中心:左半场在屏幕中线左边,所以必为负
  ok(G.centerUiX < 0 && Math.abs(G.centerUiX) < CFG.world.w / 2,
    `轨心 x=${G.centerUiX.toFixed(1)} 落在屏幕左半内,不会被推出屏`);

  // 水平锁死:dx 不是自由轴,老档里的 dx 一律夹回 0(升级后不会带着偏移量的轨进场)
  ok(SLIDER_LIMIT.maxDx === 0, "SLIDER_LIMIT.maxDx == 0:滑轨水平锁死,只能上下拖");
  const legacy = sanitize({ slider: { dx: -180, dy: 30, r: 30 } });
  ok(legacy.slider.dx === 0, "老档存的 slider.dx 会被夹回 0,不污染对位");
  ok(legacy.slider.dy === 30 && legacy.slider.r === 30, "dy/r 照原样读,只锁水平");
}

// ---------- ⑬ 球速档位(paceTier):唯一能改写物理的玩家偏好,坏值一律不许进物理 ----------

{
  freshKV();
  const P = CFG.pace;

  // 表自洽:默认档必须真的在表里,且每档系数落在夹取区间内。
  // 这条最值钱 —— 「加了一档忘了夹」「把 default 的 id 打错字」都是静默灾难
  // (打错字时 paceTierById 会悄悄退到表头那一档,玩家改档却看着生效了)。
  ok(P.tiers.some((t) => t.id === P.default), `默认档 "${P.default}" 在档位表里`);
  ok(P.tiers.every((t) => t.s >= P.min && t.s <= P.max),
    `每档系数都落在夹取区间 [${P.min}, ${P.max}] 内`);
  ok(P.tiers.every((t) => Number.isFinite(t.s) && t.s > 0), "每档系数都是正有限数(0 会让物理除零)");
  ok(new Set(P.tiers.map((t) => t.id)).size === P.tiers.length, "档位 id 不重复");
  // 面板用 step=1 的滑杆按下标定位,所以「慢 → 快」必须按表序单调,否则拖反方向
  ok(P.tiers.every((t, i) => i === 0 || t.s > P.tiers[i - 1].s), "档位按表序从慢到快单调(滑杆方向才不会反)");

  // 缺字段 → 默认档:老存档升级就靠这一条自动吃到新出货档,不需要版本号
  ok(sanitize(null).paceTier === P.default, "空档 → 默认档(老存档自动吃新默认,不写迁移)");
  ok(sanitize({ pad: {} }).paceTier === P.default, "带 pad 的老档也没有 paceTier → 同样补默认");
  ok(sanitize({ paceTier: "nonsense" }).paceTier === P.default, "paceTier 垃圾值 → 退回默认档");
  const pick = P.tiers[P.tiers.length - 1].id;
  ok(sanitize({ paceTier: pick }).paceTier === pick, `显式存的 "${pick}" 照读`);

  // ---------- 移速档位(gaitTier):同一套纪律,另一摊账 ----------
  const G = CFG.gait;
  ok(G.tiers.some((t) => t.id === G.default), `移速默认档 "${G.default}" 在档位表里`);
  ok(G.tiers.every((t) => t.s >= G.min && t.s <= G.max),
    `移速每档系数都落在夹取区间 [${G.min}, ${G.max}] 内`);
  ok(new Set(G.tiers.map((t) => t.id)).size === G.tiers.length, "移速档位 id 不重复");
  ok(G.tiers.every((t, i) => i === 0 || t.s > G.tiers[i - 1].s), "移速档位按表序从慢到快单调");
  // 标准档必须是恒等:这一档存在的意义就是"什么都不改"的参照,漂了整张表就读不出动了什么
  const std = G.tiers.find((t) => t.id === G.default);
  ok(!!std && std.s === 1, `移速默认档系数 = 1(实得 ${std ? std.s : "无此档"}):它是参照,不是隐性加码`);
  ok(sanitize(null).gaitTier === G.default, "空档 → 移速默认档(与 paceTier 同一套缺字段语义)");
  ok(sanitize({ gaitTier: "nonsense" }).gaitTier === G.default, "gaitTier 垃圾值 → 退回默认档");
  ok(sanitize({ paceTier: "xslow", gaitTier: "vfast" }).gaitTier === "vfast", "显式存的 gaitTier 照读");

  // 写盘回读 + setPart 的消毒(面板那根滑杆每次拖动都走这条)
  const st = new SettingsStore();
  st.init();
  st.setPart({ paceTier: "fast" });
  st.flush();
  const again = new SettingsStore();
  ok(again.init().paceTier === "fast", "setPart 改档后 flush → 重开读回同值");
  st.setPart({ paceTier: "垃圾" as never });
  ok(st.v.paceTier === "fast", "setPart 收到垃圾值 → 保持原档不动(不会突然变慢/变快)");
  st.setPart({ gaitTier: "vfast" });
  st.flush();
  ok(new SettingsStore().init().gaitTier === "vfast", "setPart 改移速档后 flush → 重开读回同值");
  st.setPart({ gaitTier: "垃圾" as never });
  ok(st.v.gaitTier === "vfast", "gaitTier 垃圾值 → 保持原档不动");
}

// ---------- ⑭ 震动强度档(hapticLevel):只加字段不动 hapticOn 的类型 ----------
// 上一版「震动反馈」被用户报成"打开了根本没用",这次补了强度档与状态读数。
// hapticOn 仍是 boolean(①/③ 里那三条老断言就是钉住它别被顺手改成 string ——
// 改了就是给所有老存档换一套语义,而开关本身没有任何问题)。
{
  const HD = CFG.haptic.default;
  const other = CFG.haptic.levels.find((l) => l.id !== HD)?.id ?? HD;
  ok(sanitize(null).hapticLevel === HD, "空档 → 震动强度默认档(老存档自动吃新默认,不写迁移)");
  ok(sanitize({ hapticOn: true }).hapticLevel === HD, "只有 hapticOn 的老档 → 强度补默认(覆盖安装的实际形态)");
  ok(sanitize({ hapticLevel: "nonsense" }).hapticLevel === HD, "hapticLevel 垃圾值 → 退回默认档");
  ok(sanitize({ hapticLevel: other }).hapticLevel === other, `显式存的 "${other}" 照读`);
  ok(sanitize({ hapticLevel: 42 }).hapticLevel === HD, "强度档收到数字 → 回默认(与 paceTier 同一套消毒)");
  const hs = new SettingsStore();
  hs.init();
  hs.setPart({ hapticLevel: other });
  hs.flush();
  ok(new SettingsStore().init().hapticLevel === other, "setPart 改强度档后 flush → 重开读回同值");
  hs.setPart({ hapticLevel: "垃圾" as never });
  ok(hs.v.hapticLevel === other, "setPart 收到垃圾强度 → 保持原档不动(不会突然变弱)");
  hs.setPart({ hapticOn: false });
  ok(hs.v.hapticOn === false && hs.v.hapticLevel === other, "总闸与强度互不干扰:关掉不影响已设的档");
}

console.log(`\n${h.bad === 0 ? "全部通过" : `${h.bad} 项失败`}`);
process.exit(h.bad === 0 ? 0 : 1);
