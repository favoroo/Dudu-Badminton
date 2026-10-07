// ============================================================
// 主循环组件(挂到 Canvas 上,阶段 2 唯一需要在编辑器里手动操作的节点)
// 固定步长 60Hz 模拟 + 渲染插值 + 事件分发,与老 game.js 同构:
//   acc += dt;while (acc >= step) { 模拟一步;清输入边沿 }
// 事件只从 Rules.R.events 取,分发给音效/飘字/震屏 —— 表现层依旧不进逻辑。
// 菜单/结算完整 UI 是阶段 3;本组件先直进一局「单人 · 普通」。
// ============================================================
import { _decorator, Component, ResolutionPolicy, game, profiler, view } from "cc";
import { CFG, FloatLabel } from "../core/config";
import { Settings } from "../core/settings";
import { installStorageBackend } from "./host";
import { Rules } from "../core/rules";
import { AI } from "../core/ai";
import { Drill } from "../core/drill";
import { Tutorial } from "../core/tutorial";
import { Career } from "../core/career";
import { questTitle } from "../core/activity";
import { flightFramesToClosest } from "../core/physics";
import { Pace } from "../core/pace";
import { Gait } from "../core/gait";
import { AutoHit } from "../core/auto-hit";
import { Player, playerFramesToWorld, swingCuePressFrames, swingClockScale } from "../core/player";
import { Skills } from "../core/skills";
import { ShadowGate } from "../core/shadow-gate";
import { clockOf, renderDue, type ClockMode } from "../core/celebration";
import { clamp } from "../core/utils";
import { Ball, FaceKind, GameEvent, PlayerInput, ShotKind, ShotResult, SkillId } from "../core/types";
import type { DiffKey } from "../core/types";
import { WorldView } from "../render/world";
import { TIER_FIRE, TIER_NORMAL, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "../render/shuttle-motion";
import { newPad, clearEdges, buildIntent, restoreSwingAim, emptyIntent, tickHolds, Pad } from "../input/pad";
import { bindKeyboard } from "../input/keyboard";
import { touchPad } from "../input/touchpad";
import { Sfx } from "./sfx";
import { BgmManager } from "./bgm";
import { haptic, hapticTick } from "./haptics";
import { shotKey } from "../core/haptic";

const { ccclass } = _decorator;
const C = CFG;

@ccclass("GameRoot")
export class GameRoot extends Component {
  private world!: WorldView;
  private sfx = new Sfx();
  private bgm = new BgmManager();
  private pad = newPad();

  private acc = 0;
  private worldT = 0;
  private frameT = 0;
  private stopFrames = 0;      // hitstop:世界定格的剩余步数(老 FX.stop 的精简版)

  private swingCueArmed = true; // 按拍预告「到点了」一次性闪环的闩:来球退回前瞻线外再重新武装
  /** 闯关 campaign-clear 事件暂存:rules 里 recordStageClear 先于 settle 执行,
   *  「是不是首通」与关卡奖励只能从事件侧带过来,match-over 结算时消费掉 */
  private campClear: { firstClear: boolean; coins: number; exp: number } | null = null;
  /** 球种预告缓存:一次 previewKind ≈ 28 条弹道 trace(数千次积分),旧版每渲染帧全跑一遍。
   *  同一拍飞行中球种几乎不变,这里按「球的 shot 引用」命中缓存、每 10 帧兜底刷新一次,
   *  一拍从 ~60 次求解降到 1-6 次;徽标更新节奏肉眼无感。 */
  private previewShotRef: ShotResult | null = null;
  private previewFrame = -99;
  private previewKindCache: ShotKind | null = null;
  /** 上一次预告用的「粘住的滑动」读数:变了就立即重算(否则滑了要等 10 帧才看见) */
  private previewAim = 0;
  private previewAimY = 0;
  /** 最近逼近帧(fc)缓存:flightFramesToClosest 每次做 56 步弹道积分,是最重的固定
   *  每帧 CPU 热点。fc 本来就是「还剩几帧」的整数帧预算,改每 2 帧重算一次,
   *  一帧粒度的滞后在 60Hz 下不可感知;换球(引用变)立即重算,不吃旧轨迹。 */
  private swingCueBall: Ball | null = null;
  private swingCueFcFrame = -99;
  private swingCueFc: number | null = null;
  /** 时机环入参复用对象(setTimingRing 只存引用、draw 时读字段,复用安全) */
  private cueRing = { progress: 0, locked: false };

  onLoad(): void {
    // 存储后端与设置读盘:必须排在任何 load() 之前。
    // (render/court 的模块级单例原本在构造函数里就读档,那处已改成懒确保,
    //  所以「谁先 import」不再决定存档能不能落盘。)
    installStorageBackend();
    Settings.init();
    // 球速档位:读盘后立刻按存档里的档位生效(此刻场上还没有球,可以 apply),
    // 之后面板改档只挂 pending,由 rules.beginPoint() 在下一球落地。
    // 移速档位:即时 apply —— 它不改任何已在飞的东西,拖完这拍马上能感觉到。
    // 订阅放在这里而不是 settings.ts:core/settings 刻意不 import pace/gait/physics,
    // 好让 tools/settings-check.ts 能在 node 下独立造实例跑断言。
    Pace.apply(Settings.v.paceTier);
    Gait.apply(Settings.v.gaitTier);
    // 自动击打:即时生效(它不改任何已在飞的弹道,只是"下一拍由谁起手"),与移速同一条口径。
    // 模式门控由 rules 在开场时报,这里只喂用户开关。
    AutoHit.request(Settings.v.autoHit);
    Settings.onChange((s) => { Pace.request(s.paceTier); Gait.apply(s.gaitTier); AutoHit.request(s.autoHit); });
    // 强制固定高度 540，宽度自适应扩展，保证上下视野和按钮在任何长宽比屏幕上都不被裁剪
    view.setDesignResolutionSize(C.world.w, C.world.h, ResolutionPolicy.FIXED_HEIGHT);
    // 隐藏 Cocos 左下角性能监控/FPS面板
    profiler.hideStats();
    // 锁渲染帧率(config.perf.frameRate):逻辑本就固定 60Hz 步进,高刷屏裸跑只会把
    // 每帧重绘成本 ×2、发热触发温控降频 —— 见 config.perf 注释
    game.frameRate = C.perf.frameRate;
  }

  start(): void {
    // ---------- 场景搭建 ----------
    this.world = new WorldView(this.node);
    this.sfx.load(this.node);
    this.bgm.load(this.node, () => this.bgm.update(Rules.R, Rules.isMatchPoint()));

    // ---------- 输入 ----------
    bindKeyboard(this.pad, (code) => this.onSystemKey(code));
    // 决策①:虚拟按键(编辑器里鼠标点按同样生效)。句柄交给 touchPad 单例存住
    // —— 老写法把返回的 Node 丢了,于是没有任何地方能隐藏它。
    if (C.mobileOnly) touchPad.mount(this.node, this.pad);

    // ---------- 世界开局 ----------
    Rules.setTrailHook((b) => this.world.pushTrail(b));
    this.startMatch("1p", "normal");
  }

  /** 老菜单的占位:startMode 的直连版(阶段 3 接菜单 UI) */
  private startMatch(mode: string, diff: DiffKey): void {
    Rules.newMatch(mode, diff);
    Career.applyToMatch();      // 换上的皮肤跟人走
    this.world.clearFloats();
    this.world.clearTrail();
    this.sfx.play("whistle");
  }

  // ---------- 系统键(与老 onSystem 同名同义,先接最常用的三颗) ----------
  private onSystemKey(code: string): void {
    const R = Rules.R;
    if (code === "KeyM") {
      // 一个键管两条总线(音效+音乐),落盘与老 muted 镜像都在 Settings 里做
      Settings.toggleAllMute();
      return;
    }
    if (R.state === "OVER" && code === "KeyR") { this.sfx.play("ui"); this.startMatch(R.mode, R.diff); return; }
    if (code === "KeyR") { this.sfx.play("ui"); this.startMatch(R.mode, R.diff); return; }
    if (code === "Escape" || code === "KeyP") {
      if (R.state === "PAUSED") { Rules.resume(); this.sfx.play("ui"); }
      else if (!(C.frozen as string[]).includes(R.state)) { Rules.pause(); this.sfx.play("back"); }
    }
  }

  // ---------- 固定步长主循环 ----------
  update(dt: number): void {
    const R = Rules.R;
    // 虚拟按键只在真正对局(SERVE/RALLY/POINT)时出现:菜单、暂停、结算、
    // 生涯/训练面板都不露;隐藏时顺带清按下状态,见 input/touchpad 控制器注释。
    touchPad.setPlaying(Rules.isPlaying());
    // 键面两条读数每**真实帧**同步一次(位置在 setPlaying 之后、模拟循环之前,三条都有理由):
    //  · 不放 updateSwingCue:那函数有两条 early return,没来球时压根不进来 ⇒ 发球/死球时
    //    「自动」这两个字不会出现 —— 而玩家恰恰在这几拍最想知道键归谁按;
    //  · 不放 buildInputs:那是每模拟步,hitstop/庆祝/省电档整段跳过 ⇒ 键名会冻在半路;
    //  · setAimEcho 排在 setAutoMark 之后:自动关着且没锁时恒传 0,击球键的表现与今天
    //    逐位相同;辅助开着(欠着一拍的瞄准)或触屏长滑锁定(pad.swingLockX/Y 非 0,
    //    键缘弧常亮 = 「之后每一拍都往这个方向打」的读数)才喂 pad 真值。
    const autoOn = AutoHit.on;
    const locked = this.pad.swingLockX !== 0 || this.pad.swingLockY !== 0;
    touchPad.setAutoMark(autoOn);
    touchPad.setAimEcho(autoOn || locked ? this.pad.swingSwipe : 0, autoOn || locked ? this.pad.swingSwipeY : 0);
    this.frameT++;
    // 累加器速度。BGM 跑在音频时钟上,所以变速不会拖慢音乐节奏。
    // 定格段恒按真实速度走:定格步调 stepFx(frozen),慢动作计时 slowT 被一起冻住不递减。
    // 移除赛点常驻微慢放(保证肌肉记忆与真实手感一致),慢放受 config.fx.slowmoEnabled 约束。
    const speed = this.stopFrames > 0 ? 1
      : this.slowmoOn ? this.world.timeScale()
        : 1;
    this.acc += Math.min(dt, 0.25) * speed;          // 切后台回来不追帧

    // BGM 自适应编排:每帧观察比赛状态(分层强度/场景/赛点/暂停)
    this.bgm.update(R, Rules.isMatchPoint());

    const step = C.sim.step;
    let n = 0;
    // 时钟档位判据在 core/celebration.ts(零 cc、有闸门钉),这里只照它执行:
    //   sim = 世界真在打;celebrate = 世界停但表现层不停;still = 面板态全冻。
    // 循环内每步重算:Rules.step 可能在本帧把状态推进到 OVER,下一跳就得换档。
    let clock: ClockMode = clockOf(R.state, this.world.presentationBusy());
    while (this.acc >= step && n < C.sim.maxSteps) {
      this.acc -= step; n++;
      // 定格步不消费输入:见下面 stopFrames 分支
      let keepEdges = false;
      clock = clockOf(R.state, this.world.presentationBusy());
      if (clock === "sim") {
        if (this.stopFrames > 0) {
          this.stopFrames--;                 // hitstop:反馈计时照走,世界时钟不递增
          this.world.stepFx(step, true);     // 定格:镜头/白闪/慢动作/粒子一起冻住
          // 定格期间 Rules.step 没跑,这一按的边沿若照常被清掉就凭空消失了
          keepEdges = true;
        } else {
          this.worldT++;                     // 只有世界真正推进的 step 累加世界时钟
          Rules.step(this.buildInputs());
          Tutorial.frame();                  // 教学实操门控逐帧轮询(移动进圈/起跳离地)
          // 跳跃按住时长:只在世界真推进的步里数。放这里而不是跟着 clearEdges 走 ——
          // hitstop 定格段世界不升,按住时长也不该涨,否则 tapCommitFrames
          // 会把「顿帧里松手」误判成点跳并补一段现实里没发生的上升。
          tickHolds(this.pad);
          // 挥拍风声:swingT 恰好走到起拍帧(引拍结束/发力开始)送一次,每挥必中一次
          // (音效早已烘焙,此前一直没接;双方玩家与 AI 都播,音量压低不抢戏)
          for (const p of R.players) {
            // 挥拍风声的判据要容得下**非整数步进**:时空领域里 swingT 每世界步跳 2.86,
            // 旧写法 `swingT === windup` 在领域里一次都不成立 ⇒ 开了领域打球全程没挥拍声。
            // [windup, windup+step) 这个区间对 step=1 与旧式逐字等价,对 step>1 恰好命中越过
            // 起拍帧的那一步(一次挥拍必中一次,不会重复)。
            const step = swingClockScale(p);
            if (p.swingT >= C.swing.windup && p.swingT < C.swing.windup + step) this.sfx.play("swing", 0.35);
            // AI 够不到时的鱼跃俯冲:ai.ts 在置位那一帧给到满值,这里补一记扑空音效
            // (俯冲姿势由 sprites.ts 读 scrambleT 画;只表现,不改判定)
            if (p.ai && p.ai.scrambleT === C.aiReach.scrambleFrames) {
              this.sfx.play("whiff", 0.7);
              this.world.shake(C.fx.shakeWhiff || 1.5);
            }
          }
          this.world.stepFx(step, false, R.ball);
        }
      } else if (clock === "celebrate") {
        // 终局庆祝段:Rules.step 一行不走(球不飞、比分不动、AI 不出意),只把表现层
        // 时钟放完 —— 礼花必须落回地面,最后一拍的火花/丝带/飘字必须散尽,不能留一张
        // 定格照片在结算卡背后(用户现场:「胜利时的这个礼花效果会有点卡顿」)。
        // hitstop 那几帧仍按定格语义;从前 frozen 态根本不递减 stopFrames,终局正好
        // 赶上顿帧会把定格永久留着(下一局才被动清掉),这里一并收掉。
        if (this.stopFrames > 0) this.stopFrames--;
        else this.world.stepFx(step, false, R.ball);
      }
      if (!keepEdges) clearEdges(this.pad);
    }
    if (n === C.sim.maxSteps) this.acc = 0;

    this.drain();
    this.syncPressureCue();
    // 触觉待发放:挂在真实帧循环(不是上面的模拟循环)—— 定格/慢动作期间模拟帧会积压,
    // 若跟着模拟帧放,恢复的那一瞬间会一口气震一串
    hapticTick();
    this.updateSwingCue();
    // 同步玩家技能按键状态至触屏(双槽 2026-10-06:技能1 键 + 技能2 键各喂各的)
    const human = R.players[0];
    const feedSkillKey = (target: "lunge" | "skill2", s: typeof human.skill): void => {
      if (!s) {
        // 空槽只报"这一槽没技能"(skillId 传空串)⇒ touchpad 整颗键不显示,也不收手指
        touchPad.setSkillState(target, 0, false, "");
        return;
      }
      const cdRatio = s.maxCd > 0 ? clamp(s.cd / s.maxCd, 0, 1) : 0;
      const def = Skills.defOf(s.id);
      // 充能款(怒气重击):键面画的是"攒了多少",所以 cdRatio 对它没有任何意义 ——
      // 它按下去就有 20 帧的防连点 cd,若照旧"冷却中就不报原因",玩家按下满怒那一键
      // 会看见一个不动的环 + 一个字都没有。判据在 skills.skillBlockReason(它自己按 kind 分流)。
      const charge = Skills.isChargeSkill(s.id);
      // cd 是世界步帧数(60Hz 递减),换算成秒给键心当倒计时;
      // 冷却之外还差一道门槛时,把可读原因一并喂给键上方当提示
      const blockReason = (cdRatio <= 0 || charge)
        ? Skills.skillBlockReason(human, R.ball, target === "lunge" ? 1 : 2) : null;
      // chargeRatio 只在充能款下有值(其余技能恒 0 ⇒ 键上不会多画一圈莫名其妙的环)。
      // 多管蓄力后这里喂的是"管"量纲:chargeRatio = 进行中那管的填充、chargePipes =
      // 已攒满的整管数(键面画 N 段点亮 + 当前段弧),强度/档位仍走 rageRatioOf 那条线。
      // 倒数第二参 cdSec 对充能款恒传 0:它读的是 s.cd 那 20 帧防连点,画出来是个骗人的"0.3"
      touchPad.setSkillState(target, cdRatio, s.ready, s.id, def.shortName,
        charge ? 0 : s.cd / 60, blockReason,
        charge ? Skills.ragePipeFillOf(human) : 0,
        charge ? Skills.ragePipesOf(human) : 0);
    };
    feedSkillKey("lunge", human?.skill);
    feedSkillKey("skill2", human?.skill2);
    const animT = (R.state === "RALLY" || R.state === "POINT" || R.state === "SERVE") ? this.worldT : this.frameT;
    // 氛围暗角输入(长回合金晕/赛点红晕在渲染层只读消费)
    this.world.setAtmo(R.state, R.rally, Rules.isMatchPoint());
    // ---------- 渲染节奏(判据与理由全在 core/celebration.ts 的 renderDue) ----------
    // still(MENU/PAUSED/CAREER/DRILLS 以及庆祝放完之后的终局):模拟已停、画面与上一帧
    //   逐像素相同 —— 每 4 真实帧画一次(60Hz 锁帧下 ≈15fps),每帧全量重绘那 500+ 笔纯烧电。
    // celebrate(结算卡还只占中间一块、球场仍在人眼前):满帧,礼花才落得顺。
    // sim:定格帧每 2 帧(画面本来就冻着),其余满帧 —— 定格恰逢击球特效笔数峰值,
    //   砍掉这几帧全量重绘正是「重扣那一下掉帧」的主战场。
    // BGM 与触摸在上方已各自跑完,不跟着降频。
    if (renderDue(clock, this.stopFrames, this.frameT)) {
      this.world.render(R.players, R.ball, Math.min(1, this.acc / step), animT, Career.skinOf("shuttle"), R.rally);
      // 画布内世界提示(落点圈/训练时机条/拍数徽标/赛点旗标,老 hud.js)
      this.world.hudOverlay.draw(R, this.world.frameT);
    }
  }

  // ---------- 定格帧数统一入口 ----------
  /**
   * hitstop 帧数走这里,理由是档位是六档三元式叠出来的,没有一个总闸就没法保证
   * 「最长的那记也不会冻住多久」。定格帧现在是真实帧(见主循环的 speed),
   * cap 直接等于最坏静止毫秒数 × 60,任何档都不许把画面按停超过它。
   */
  private setStop(frames: number): void {
    if (frames <= 0) {
      this.stopFrames = 0;
      return;
    }
    const cap = C.fx.hitstopCap || 7;
    this.stopFrames = Math.min(cap, Math.round(frames));
  }

  // ---------- 按拍预告:来球逼近判定区心 → 击球两键渐亮,到最佳按拍帧闪一下 ----------
  // 最佳按拍时刻 = 球到判定区心「前」PRESS_LEAD_FRAMES 帧(按下后第 9 帧才是质量峰)。
  // 但「看到→按下」人要花 reactFrames 帧(≈150ms),所以一切提示(辉光峰/闪环/时机环收满)
  // 都提前 reactFrames 发出:看到的那一刻按下去,峰刚好落在球过心。提示说「现在按」,
  // 意思是「这一帧按」,不是「再等等」—— 曾经锚在 lead 上发提示,等于教玩家迟到 10 帧。
  // 预测用 Physics.flightFramesTo 按真实积分推算,只读不写游戏状态,纯表现层。
  private updateSwingCue(): void {
    const R = Rules.R;
    const ball = R.ball;
    const human = R.players[0];                 // 真人在左队 0 号;AI/喂球机没有按键,不给预告
    const incoming = Rules.isPlaying() && R.state === "RALLY"
      && !!ball && ball.live && !ball.held && !!human && ball.lastHitter !== human.side;
    const cue = C.swingCue;
    if (!incoming || !ball || !human) {
      this.swingCueArmed = true;
      touchPad.setSwingGlow(0);
      this.world.setSwingCue(0);
      this.world.hudOverlay.setTimingRing(null);
      touchPad.setShotPreview(null);
      this.previewShotRef = null;
      return;
    }
    const z = Player.strikeZone(human, Math.hypot(ball.vx, ball.vy));
    // horizonFrames **故意不随球速档位折算**:它是「距球到判定区心还剩几帧」的剩余帧预算,
    // 不是总滞空帧数。不折 = 预告在真实时间里同样提前 0.66s 亮起(按拍时机是玩家侧的量,
    // 与档无关);折了反而让慢档的提前量变长,与 swingCue 的设计意图相反。详见 pace.ts 头注释。
    // fc = 最近逼近帧(对走位误差鲁棒):玩家有走位误差,坠落轨迹不穿区心是常态,
    // 「进入小圆」式锚环要么系统性早按、要么要求精确穿心直接失联 —— 见 config.swingCue 注。
    // 56 步积分每 2 帧才算一次(见字段注释),换球立即重算。
    if (this.swingCueBall !== ball || this.frameT - this.swingCueFcFrame >= 2) {
      this.swingCueBall = ball;
      this.swingCueFcFrame = this.frameT;
      this.swingCueFc = flightFramesToClosest(ball, z.x, z.y, z.r, cue.horizonFrames);
    }
    const fc = this.swingCueFc;
    if (fc === null) {
      this.swingCueArmed = true;
      touchPad.setSwingGlow(0);
      this.world.setSwingCue(0);
      this.world.hudOverlay.setTimingRing(null);
      touchPad.setShotPreview(null);
      this.previewShotRef = null;
      return;
    }
    // 提示提前量与质量峰提前量(含"看到→按下"的反应余量、自动击打不吃反应)全在
    // Player.swingCuePressFrames 一处算,focus-window-check ① 用的就是同一个函数 ——
    // 环喊的那一帧与判据下注的那一帧必须同源,否则测的是我以为的时机。
    //
    // ⚠ 时空领域里这些是**玩家侧真实帧**,而 fc 数的是**世界步**:领域把世界拖到 0.35 步/真实帧、
    //   挥拍却按真实时间走 ⇒ 不折算就是"环在区心前 9 世界步喊按,而那一拍 3.1 世界步就走完了峰"。
    //   2026-10-05 用户「时空技能我现在挥拍很难击中球了」的根因就是这里,折算口径统一走
    //   core/player.ts 的 worldRate(唯一尺子)。
    const toWorld = (frames: number): number => playerFramesToWorld(human, frames);
    const pressAt = swingCuePressFrames(human);
    const cueLevel = clamp(1 - Math.abs(fc - pressAt) / toWorld(cue.rampFrames), 0, 1);
    touchPad.setSwingGlow(cueLevel);
    // 同一级辉光镜像到羽毛球本体:注意力跟球的玩家看不见按钮,球自己发光当预告
    this.world.setSwingCue(cueLevel);
    // 到点闪环带迟滞:过了提示帧后再退出预告线 8 帧才重新武装,一记来球只闪一次
    if (fc <= pressAt) {
      // 「该按了」的闪环在自动模式下不发:那一拍不用人按,闪了反而像催命。
      // 辉光与收缩环留着 —— 它们现在读作「机器会在这一帧出手」,正好解释人物为什么自己动了。
      if (this.swingCueArmed) {
        this.swingCueArmed = false;
        if (!AutoHit.on) touchPad.pulseSwing("sweet");
      }
    } else if (fc > pressAt + toWorld(8)) {
      this.swingCueArmed = true;
    }
    // 时机环喂给渲染层:收缩环长在球上(按拍预告的球上版);判定区随人走、
    // 甜区圈不出新信息,用户拍板去掉,不再画
    const TR = C.timingRing;
    // spanFrames 也是玩家侧的量(环收拢一格多少真实帧):领域内不折算就会出现
    // "球慢慢飘、环转得格外磨蹭",与平时那 0.4s 的收拢节奏对不上
    this.cueRing.progress = clamp(1 - (fc - pressAt) / toWorld(TR.spanFrames), 0, 1);
    this.cueRing.locked = fc <= pressAt;
    this.world.hudOverlay.setTimingRing(this.cueRing);
    // 球种预告:按真实求解器预演这一拍,徽标写在击球键上方(挥拍中瞄准还能改,不掐)。
    // 走 previewKindCache:同拍命中缓存,换拍(shot 引用变)或每 10 帧才真正求解一次。
    // **玩家一滑动就立即重算**:自动击打开起来后玩家不再起拍,p.swingAim 停在上一拍,
    // 徽标要靠 pending 那对粘住的滑动才说真话 —— 等 10 帧兜底会读成「滑了没反应」。
    const swipe = this.pad.swingSwipe;
    const swipeY = this.pad.swingSwipeY;
    if (this.previewShotRef !== ball.shot || this.previewAim !== swipe || this.previewAimY !== swipeY
      || this.frameT - this.previewFrame >= 10) {
      this.previewShotRef = ball.shot;
      this.previewAim = swipe;
      this.previewAimY = swipeY;
      this.previewFrame = this.frameT;
      this.previewKindCache = Player.previewKind(human, ball, { swipe, swipeY });
    }
    // 徽标只报球种。「自动」这个模式读数已经搬到键名上(config.autoHit.padLabel,常亮、
    // 发球/死球时也看得见),同一信息不在一个键上说两遍
    touchPad.setShotPreview(this.previewKindCache);
  }

  /** 慢放总闸(见 config.fx.slowmoEnabled):关掉时两处 world.slowmo() 与赛点常驻微慢放全不发,世界恒速 */
  private get slowmoOn(): boolean { return C.fx.slowmoEnabled === true; }

  // ---------- 输入 → 意图(与老 buildInputs 同构) ----------
  /** 输入事件钩子:一次性构造、整个生命周期复用(旧版每模拟步新建 7 个闭包,纯 GC 粮) */
  private inputHooks: Partial<PlayerInput> | null = null;
  /** buildInputs 的返回数组,跨模拟步复用(intents 对象本身每步新建,见函数内注释) */
  private inputBuf: PlayerInput[] = [];
  private buildInputs(): PlayerInput[] {
    const R = Rules.R;
    if (!this.inputHooks) {
      this.inputHooks = {
        onJump: () => this.sfx.play("jump"),
        onLand: (_p, vy) => {
          if (vy > 4) {
            this.sfx.floor(Math.max(0.4, Math.min(1.2, vy / 12)));
            this.world.shake(Math.min(2.4, vy * 0.12));
          }
        },
        onWhiff: () => {
          this.sfx.play("whiff");
          this.world.shake(C.fx.shakeWhiff || 1.5);
          if (C.fx.hitstopWhiff) this.setStop(C.fx.hitstopWhiff);
        },
        onFootstep: (p) => {
          this.world.fx.stepDust(p.x, C.court.groundY);
        },
        onLunge: () => this.sfx.play("lunge"),
        onSkill: (p, id) => this.onSkillCast(p, id),
        // 自动击打真替玩家起手的那一帧才飘(不是每帧轮询):看得见的状态才不是 bug ——
        // 人物凭空自己挥拍,没有一句解释就会被读成"按键坏了"或"人物疯了"。
        // 只在第 1 次尝试飘(限次的第 2 下不重复贴同一句话,飘字道也省下来)。
        onAutoSwing: (p) => {
          if ((p.autoTries ?? 0) > 1) return;
          const f = C.autoHit.castFloat;
          this.world.float(p.x, C.court.groundY - 118, f.text, f.color, f.size, f.life);
        },
        // 「这一次滑动用掉了」:core 在那一拍真打出去的收招帧调过来(player.ts 的 consumeAutoAim),
        // 把击球键欠着的瞄准**恢复成锁值** ⇒ 没锁时辅助模式横滑/纵滑只管一拍,而不是滑一次
        // 锁到底(用户 2026-10-05:「不要滑动之后就进入那个锁定状态了」);触屏长滑锁定的
        // 方向(pad.swingLockX/Y)经同一条路回锁 —— 短滑打完回锁向,直到玩家再长滑取消。
        // 恢复的是 pad 的存储,判定/弹道一概不动 —— 那一拍已经按这个方向打出去了。
        // setAimEcho 的读数跟着走:没锁回 0(键缘方向弧当场熄灭 = 「已经不欠一拍了」),
        // 有锁停在锁向(弧常亮 = 「之后每一拍都往这个方向打」)。
        onAimConsume: () => restoreSwingAim(this.pad),
      };
    }
    const hooks = this.inputHooks;
    // 外层数组跨步复用(60 次/秒的 map 新数组是纯 GC 粮);intent 对象本身仍每步
    // 新建 —— rules.step 会把对象存进 p.lastInp 留给下一步读,复用对象会串步。
    const buf = this.inputBuf;
    buf.length = 0;
    for (const p of R.players) {
      // 训练场/新手教学的右半边不是对手,是喂球机:走同一条 inputs 通道(一拍一落是结构必然)
      if (R.mode === "drill" && p.side === "right") {
        buf.push({ ...emptyIntent(), ...hooks, ...Drill.feederInput(p, R) });
        continue;
      }
      if (R.mode === "tutorial" && p.side === "right") {
        buf.push({ ...emptyIntent(), ...hooks, ...Tutorial.feederInput(p, R) });
        continue;
      }
      if (p.isAI) buf.push({ ...AI.think(p, R.ball as Ball, R.state), ...hooks });
      else buf.push(buildIntent(this.pad, hooks));   // 阶段 2:左队 0 号真人用 P1 键位/虚拟按键
    }
    return buf;
  }

  // ---------- 技能起手演出 ----------
  /**
   * onSkill 钩子(player.update 触发成功那一帧调用):
   * 各主动技能定制化起手视听反馈:
   * - 强力跨步:贴地破风气流爆发 + 镜头微推 + 青色破风闪 + 飘字
   * - 百分百重击:狂暴爆气 + 镜头聚推 + 烈火震屏 + 金红烈焰闪 + 飘字
   * - 引力吸球:引力奇点展开 + 空间紫闪 + 镜头推向羽毛球 + 空间震颤 + 飘字
   * - 时空减速:子弹时间展开 + 时空涟漪波纹 + 青碧时空闪 + 飘字
   * - 闪现扣杀:折跃定格 + 雷光劈裂 + 镜头推球 + 劈扣慢放
   */
  private onSkillCast(p: Player, id: SkillId): void {
    const ball = Rules.R.ball;
    const F = C.fx;
    if (!ball) return;
    // 起手飘字只给真人:AI 放技能照常有特效/音效(对手高光),但不再飘教学字
    const showLab = !p.isAI;

    if (id === "lunge") {
      // 强力跨步起手:贴地破风气浪爆发 + 镜头微推 + 突进轻微破风闪 + 飘字
      const dir = p.lungeDir || p.facing;
      this.world.fx.lungeDash(p.x, C.court.groundY, dir);
      this.world.punch(p.x, p.y, C.lunge.castPunch || 1.025);
      this.world.shake(C.lunge.castShake || 3);
      if (showLab) this.floatSideLab({ text: "疾风突进!", color: "#38bdf8", size: 24, life: 46, plate: "slant" }, p.x);
      this.sfx.play("lunge");
      if (!p.isAI) haptic("skillLight");
    } else if (id === "smash") {
      // 百分百重击起手:聚能爆气 + 镜头推近 + 强力震屏 + 炽热金红爆闪 + 头顶「上弦」字
      this.world.fx.flameBurst(p.x, p.y - 20);
      this.world.punch(p.x, p.y, C.skills.smash.castPunch || 1.05);
      this.world.shake(C.skills.smash.castShake || 6);
      // 起手字挂人物头顶,不占场边锚点:附魔是欠「下一拍」的债,钉在左边缘写完成时的
      // 「暴烈重扣!!」会被读成"已经扣过了"(而它确实马上就被预告吃掉了,见 previewKind)。
      // 命中那记「必杀重扣!!」仍按接触点挂场边,两者一个说"上弦"一个说"兑现",不打架。
      // 夹左边界:真人可退到 wallL=44(config.court),不夹就贴出屏外。
      if (showLab) {
        const cf = F.smashCastFloat as FloatLabel;
        this.world.floatSys(Math.max(90, p.x), p.y - 96, cf.text, cf.color, cf.size, cf.life, -1, cf.plate);
      }
      this.sfx.play("smash");
      if (!p.isAI) haptic("skill");
    } else if (id === "magnet") {
      // 引力吸球起手:引力奇点光环爆发 + 空间震颤 + 紫色微闪 + 镜头推向球 + 飘字
      this.world.fx.singularityBurst(ball.x, ball.y);
      this.world.punch(ball.x, ball.y, C.skills.magnet.castPunch || 1.045);
      this.world.shake(C.skills.magnet.castShake || 5);
      if (showLab) this.floatSideLab({ text: "引力掌控!!", color: "#a855f7", size: 26, life: 48, plate: "slant" }, p.x);
      this.sfx.play("swing", 0.7);
      if (!p.isAI) haptic("skillLight");
    } else if (id === "focus") {
      // 时空减速起手:时空领域展开! 激活子弹时间 + 时空微澜波纹 + 镜头推近 + 青碧闪光 + 飘字
      const dur = C.skills.focus.duration || 180;
      const slowFac = C.skills.focus.ballSlow || 0.35;
      this.world.slowmo(dur, slowFac);
      this.world.fx.timeRupture(p.x, p.y - 28);
      this.world.punch(p.x, p.y, C.skills.focus.castPunch || 1.045);
      this.world.shake(C.skills.focus.castShake || 6);
      const cf = ((C.fx as unknown) as Record<string, FloatLabel>).floatSkillFocusCast || { text: "时空领域!!", color: "#06b6d4", size: 26, life: 50, plate: "slant" };
      if (showLab) this.floatSideLab(cf, p.x);
      this.sfx.play("whiff", 0.8);
      if (!p.isAI) haptic("skill");
    } else if (id === "flash") {
      // 雷光折跃:保持现有的雷光折跃三段演出
      if (p.flashFrom) this.world.fx.blink(p.flashFrom.x, p.flashFrom.y, p.x, p.y);
      this.world.fx.sweet(ball.x, ball.y, Math.atan2(ball.vy, ball.vx));
      this.setStop(F.hitstopFlashCast || 7);
      this.world.shake(F.flashCastShake || 7, 0, Math.atan2(ball.y - p.y, ball.x - p.x));
      this.world.punch(ball.x, ball.y, F.flashCastPunch || 1.05);
      if (showLab) this.floatSideLab(F.flashCastFloat as FloatLabel, p.x, true);
      this.sfx.play("flash");
      // 折跃那一下是全游戏最"空间感"的起手,给满档:与命中时的 perfectSmash 一唱一和
      if (!p.isAI) haptic("skill");
    } else if (id === "shadow") {
      // 影分身召唤(2026-10-05 多分身):脚下**身份色**尖刺星芒 + 锯齿烟环 + 撕纸碎片;
      // 分身本体从宿主影子位置拔起(渲染层的隔帧闪烁成影由 world 画,这里只管爆发一刻)。
      // 槽位从"刚出生的那一枚"读 —— player.update 已经把召唤排在 onSkill **之前**,
      // 调换顺序就会出现"爆的还是上一号的色、字少报一个"。
      // 第二行报「已在场 N 个」而不是「替你接三球」:跨回合补满之后那句在撒谎,
      // 而这句正好把"最多三个"的数量契约当场讲出来,玩家不用去翻说明。
      const SHC = C.skills.shadow;
      const born = ShadowGate.bornClone(p);
      const slot = born ? born.slot : 0;
      const alive = ShadowGate.clonesOf(p).length;
      this.world.fx.shadowSummon(p.x, C.court.groundY, slot);
      this.world.punch(p.x, p.y, SHC.castPunch || 1.035);
      this.world.shake(SHC.castShake || 4);
      if (showLab) {
        const FXC = (C.fx as unknown) as Record<string, FloatLabel>;
        const cast = FXC.floatSkillShadowCast || { text: "影分身·参上!", color: "#8b5cf6", size: 24, life: 46, plate: "slant" };
        const note = FXC.floatSkillShadowNote || { text: "已在场 {n} 个", color: "#c4b5fd", size: 15, life: 52, plate: "slant" };
        this.floatSideLab(cast, p.x);
        // {n} 占位符留在 config 那一行里,句子不许在两个文件各写一半
        this.floatSideLab({ ...note, text: note.text.replace("{n}", String(alive)) }, p.x);
      }
      this.sfx.play("whiff", 0.75);
      if (!p.isAI) haptic("skillLight");
    } else if (id === "rage") {
      // 怒气重击起手 = "把这一管怒气记成下一拍的债"。**分档炫技**:微怒只给聚推 + 小震,
      // 满怒才炸(特效基调:普通克制、按档位加码,不加特效档次开关)。
      // 起手字挂人物头顶(plate none)—— 与 smashCastFloat 同一条定式:它说的是"上弦",
      // 兑现字(「怒极·必杀!!」)才挂场边,两者一个说欠债一个说还清,不许互相冒充。
      const RG = C.skills.rage;
      const tier = Skills.rageTierOf(Skills.rageRatioOf(p));
      const t = RG.tiers[tier];
      this.world.fx.flameBurst(p.x, p.y - 20);
      if (tier >= 3) {
        // 满怒(≥一整管):角色脚下地面冲击波 + 羽片飞散(简单清爽的局部爆发,不遮挡全屏视野与来球)
        this.world.fx.shockwave(p.x, C.court.groundY);
        this.world.fx.feather(p.x, p.y - 24, 6);
      } else if (tier >= 2) {
        this.world.fx.shockwave(p.x, C.court.groundY);
      }
      this.world.punch(p.x, p.y, t.castPunch);
      this.world.shake(t.castShake);
      if (showLab) {
        // 起手字与兑现字同住档位表那一行(tiers[].castLab / .lab)—— 见 config 里那条注释。
        // as FloatLabel:config 是纯数据字面量,plate 被推成 string,而这里要的是
        // "none"|"slant"|"star" 那个联合 —— 与上面 F.smashCastFloat as FloatLabel 同一条写法。
        const cf = t.castLab as FloatLabel;
        this.world.floatSys(Math.max(90, p.x), p.y - 96, cf.text, cf.color, cf.size, cf.life, -1, cf.plate);
      }
      // 不加新音效:bake-audio 链路不在本次改动里,复用重击那记破空(音量随档位微升)
      this.sfx.play("smash", 0.85 + 0.05 * tier);
      // 触觉复用 haptic 表里现成的四档键 ⇒ haptic-check 那张单调表一个字都不用改
      if (!p.isAI) haptic(t.haptic as Parameters<typeof haptic>[0]);
    }
  }

  // ---------- 事件 → 反馈(老 game.js drain 的阶段 2 子集) ----------
  /** AI 压力阶段缓存(**分内闩锁**,只升不降,point-start 归零):0 充沛 / 1 消耗 / 2 力竭 */
  private pStage = 0;

  /**
   * AI 压力阶段上升沿 → 玩家反馈。血条只回答「现在还剩多少」,这里只回答
   * 「刚跨过哪条线」—— 与阵风横幅同一套设计哲学:缺的不是读数,是变化发生时的通知。
   * 阈值与血条分档色对齐(同一套归一化口径):消耗线 0.6,力竭线 0.04。
   * 两个新模型带来的规矩(体力账本见 ai.ts noteHit):
   * ①账本**可回落**(轻松接一拍软球会回气),血条能跌下去再涨回来再跌下去 ——
   *   旧曲线是 rally 的单调函数,数学上不存在"同一分演两遍力竭";现在必须闩锁,
   *   分内每个阶段只放一次,不然一回气一泄气就是连环大演出。
   * ②大演出吃 cueFloor(行为侧 pressure):血条见底不等于这一档真的废了 ——
   *   easy 的 crush 只有 0.5,血条掉空时行为侧才 0.5,不加闸就是满屏
   *   「对手力竭!」还在稳稳接球。
   */
  private syncPressureCue(): void {
    const R = Rules.R;
    if (R.mode === "drill" || R.mode === "tutorial") { this.pStage = 0; return; }   // 喂球机没有体力这回事
    const ai = R.players.find((p) => p.side === "right" && p.isAI);
    if (!ai || !ai.ai) { this.pStage = 0; return; }
    const tier = ai.aiTier ?? C.diffs[ai.aiDiff ?? "normal"];
    const pressure = ai.ai.pressure;
    const stamina = clamp(1 - (tier.crush > 0 ? pressure / tier.crush : 0), 0, 1);
    const stage = stamina <= 0.04 && pressure >= C.aiPressure.cueFloor ? 2 : stamina <= 0.6 ? 1 : 0;
    if (stage > this.pStage) {
      if (stage === 1) {
        // 消耗:轻提示,只飘字不配音 —— 这是「该压着打了」的信号,不是高潮
        this.world.float(C.world.w / 2, 96, "对手开始喘了", "#ff8a3d", 18, 44);
      } else if (stage === 2) {
        // 力竭:全套路演出 —— 中央大字 + 震屏 + 欢呼 + 沮丧脸 + 触觉 + 斩劈横扫
        this.world.float(C.world.w / 2, 96, "对手力竭!", "#ff5a5a", 24, 60);
        this.world.shake(5);
        this.sfx.cheer(1);
        this.faceSide("right", "sad", 90);
        haptic("skillLight");
        this.world.hudOverlay.playExhaust();
      }
    }
    this.pStage = Math.max(this.pStage, stage);   // 闩锁:血条回落也不撤销已放的演出
  }

  /** hit 事件的出球方向:火花扇/划线/速度线都按它朝向,不再各算各的或硬编码 0 */
  private hitAngOf(e: GameEvent): number {
    const vx = e.vx as number, vy = e.vy as number;
    return Number.isFinite(vx) && Number.isFinite(vy) ? Math.atan2(vy, vx) : 0;
  }

  /** 场边字锚点(config.fx.floatSide):评价/技能类飘字不贴球,按击球方挂到两侧场边,
   *  底板再实也不盖住飞行中的球;同侧多条由 world 自动向下错行 */
  private floatSideLab(lab: FloatLabel, refX: number, sys = false): void {
    const A = C.fx.floatSide;
    const x = refX < C.court.netX ? A.padX : C.world.w - A.padX;
    const pl = lab.plate ?? "none";
    if (sys) this.world.floatSys(x, A.y, lab.text, lab.color, lab.size, lab.life, -1, pl);
    else this.world.float(x, A.y, lab.text, lab.color, lab.size, lab.life, -1, pl);
  }

  private drain(): void {
    const R = Rules.R;
    for (const e of R.events) {
      switch (e.t) {
        case "hit": {
          const smash = e.kind === "smash";
          const sweet = !!e.sweet, perfect = !!e.perfect;
          // 分级炫技的档位来源(与下面的六档阶梯同源):丝带、球体辉光、白闪取色都读它
          const heat = (e.heat as number) ?? 0;
          const tier = heat >= (C.heat.fireAt || 3) ? TIER_FIRE
            : (smash && (sweet || perfect)) ? TIER_SWEET_SMASH
              : smash ? TIER_SMASH
                : (sweet || perfect) ? TIER_SWEET
                  : TIER_NORMAL;
          const vx = (e.vx as number) ?? 0, vy = (e.vy as number) ?? 0;
          const hitAng = (vx || vy) ? Math.atan2(vy, vx) : undefined;
          // 六档打击阶梯(hitstop + 震屏 + 镜头 punch)
          // 普通击球(normal)不顿帧(0 帧),把定格对比度完全留给 sweet / smash / perfect
          this.setStop((perfect && smash) ? (C.fx.hitstopPerfectSmash || 7)
            : perfect ? (C.fx.hitstopPerfect || 5)
            : (smash && sweet) ? (C.fx.hitstopSweetSmash || 6)
            : smash ? (C.fx.hitstopSmash || 5)
            : sweet ? (C.fx.hitstopSweet || 4)
            : (C.fx.hitstopNormal ?? 0));
          this.world.shake((perfect && smash) ? (C.fx.shakePerfectSmash || 18)
            : perfect ? (C.fx.shakePerfect || 9)
            : (smash && sweet) ? (C.fx.shakeSweetSmash || 15)
            : smash ? (C.fx.shakeSmash || 12)
            : sweet ? (C.fx.shakeSweet || 6)
            : (C.fx.shakeNormal || 2) + (e.q as number) * 1.5, 0, hitAng);
          // 镜头 punch 五档:整块世界向击球点推近一瞬(只放大不缩小;普通档微推,对拉不干瘪)
          if (perfect && smash) this.world.punch(e.x as number, e.y as number, C.fx.punchPerfectSmash || 1.09);
          else if (perfect) this.world.punch(e.x as number, e.y as number, C.fx.punchPerfect || 1.04);
          else if (smash) this.world.punch(e.x as number, e.y as number, C.fx.punchSmash || 1.055);
          else if (sweet) this.world.punch(e.x as number, e.y as number, C.fx.punchSweet || 1.025);
          else if ((e.q as number) >= 0.5) this.world.punch(e.x as number, e.y as number, C.fx.punchNormal || 1.012);
          // 球体运动学档位:命中这一下给 pop/裙摆炸开/档位辉光定幅度(与丝带同源的一档)
          this.world.shuttleHit(tier, clamp((e.q as number) + (perfect ? 0.2 : 0), 0, 1), heat);
          // 去除击球过程中的重锤慢动作(赛点与训练场均不触发击球慢放,彻底保护接发与扣杀肌肉记忆)
          this.sfx.hit(e.q as number, e.kind as string, sweet, perfect);
          this.bgm.onHit({ rally: R.rally, kind: e.kind as string, q: e.q as number, sweet, perfect, intoNet: !!e.intoNet });
          if (smash) this.sfx.play("smash");

          // 打击粒子特效:扣杀火花沿真实出球弹道喷(hit 事件自带 vx/vy,不再硬编码角度)
          if (smash) {
            const ang = hitAng ?? this.hitAngOf(e);
            this.world.fx.smash(e.x as number, e.y as number, ang, tier);
            this.world.fx.feather(e.x as number, e.y as number, 4);
          }
          if (sweet || perfect) {
            this.world.fx.sweet(e.x as number, e.y as number, hitAng);
          }
          // 普通命中接触小火花:扣杀/甜区已有全套特效,只补平中间档的对拉手感
          if (!smash && !sweet && !perfect && (e.q as number) >= 0.5) {
            this.world.fx.miniSpark(e.x as number, e.y as number, hitAng);
          }

          // 夸奖只给真人:喂球那拍不飘字(判据可信度)
          const praise = !((R.mode === "drill" || R.mode === "tutorial") && e.side === "right");
          // 击球者是不是 AI 直接读事件申报(applyShot 写入):不许再用 R.players[hitterIdx]
          // 按位反查 —— 影分身(idx=-1)不在名单里,反查 undefined 会被误判成真人,
          // 触发不该有的赞美飘字/时机条/触觉反馈(2026-10-04 影分身)。
          const hitterIsAI = e.isAI === true;
          // 触觉:只给真人打出来的特殊击球 —— 普通对拉不震、AI 击球不震(旧写法两条都没挡住,
          // 结果是"每拍都在嗡嗡"反而什么都读不出来)。档位判据在 core/haptic.ts 的 shotKey
          const hk = shotKey(smash, sweet, perfect);
          if (praise && hk && !hitterIsAI) haptic(hk);
          // 甜蜜/完美 → 击球两键档位辉光:飘字在球边上,拇指边的按键也直接亮一拍。
          // 只认真人自己打出来的 —— 对手/AI 的好球不是你的操作反馈,亮了反而误导
          if (praise && !hitterIsAI && (sweet || perfect)) {
            touchPad.pulseSwing(perfect ? "perfect" : "sweet");
          }
          // 深浅瞄准的命中确认:右滑深球(重)/左滑短球(轻)飘小字,键盘 J/K 同链路;
          // mid(没滑直接点)不飘 —— 默认档不打扰。贴着击球点做空间反馈,不随档位字去场边
          if (praise && !hitterIsAI) {
            const K = C.fx as unknown as Record<string, FloatLabel>;
            const aimLab = e.aim === "deep" ? K.floatAimDeep : e.aim === "near" ? K.floatAimNear : null;
            if (aimLab) this.world.float(e.x as number, (e.y as number) + (aimLab.dy ?? 0), aimLab.text, aimLab.color, aimLab.size, aimLab.life, -1, aimLab.plate);
          }
          if (praise) {
            // 档位文案/字号/寿命来自 config.fx.floatTier*;位置挂击球方场边锚点 ——
            // 评价字贴球会盖住飞行路径,挪开后底板再实也不挡视线
            const K = C.fx as unknown as Record<string, FloatLabel>;
            const lab = (perfect && smash) ? K.floatTierPerfectSmash
              : perfect ? K.floatTierPerfect
                : (smash && sweet) ? K.floatTierSweetSmash
                  : smash ? K.floatTierSmash
                    : sweet ? K.floatTierSweet
                      : (e.q as number) > 0.86 ? K.floatTierGood : null;
            if (lab) this.floatSideLab(lab, e.x as number);
          }
          // 技能专属击球飘字与强化特效
          const skillKind = e.skillKind as string | null;
          if (praise && skillKind) {
            const K = C.fx as unknown as Record<string, FloatLabel>;
            const sLab = skillKind === "lunge" ? K.floatSkillLunge
              : skillKind === "smash" ? K.floatSkillSmash
              : skillKind === "flash" ? (e.flashApex === true ? K.floatSkillFlashHigh : K.floatSkillFlash)
              : skillKind === "magnet" ? ((e.kind as string) === "smash" ? K.floatSkillMagnetAir : K.floatSkillMagnet)
              : skillKind === "focus" ? K.floatSkillFocus
              // 怒气的场边字跟着档位走(tiers[].lab,与起手字同一行、同一张表),
              // 档位读的是兑现那一刻的快照 e.rageRatio —— p.rage 在同一帧已被清零。
              : skillKind === "rage" ? (C.skills.rage.tiers[Skills.rageTierOf((e.rageRatio as number) ?? 0)].lab as FloatLabel)
              : null;
            // 技能命中字只给真人:AI 的命中特效/震屏保留,不再飘同款标签
            if (sLab && !hitterIsAI) {
              this.floatSideLab(sLab, e.x as number);
            }
            if (skillKind === "lunge") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET_SMASH);
              this.world.shake(11, 0, ang);
              this.world.punch(e.x as number, e.y as number, 1.04);
            } else if (skillKind === "smash") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_FIRE);
              this.world.fx.flameBurst(e.x as number, e.y as number);
              this.world.shake(18, 0, ang);
              this.world.punch(e.x as number, e.y as number, 1.08);
            } else if (skillKind === "flash") {
              // 闪现扣杀命中那一下:定格刚刚收,接着给一记短慢放,让"时停 → 出刀 → 慢放"
              // 三段读得出先后(慢放仍受 fx.slowmoEnabled 总闸约束,关了只剩顿帧)
              // 顶点天雷(e.flashApex,接触点 ≥ skills.flash.apexHeight)整体再升一档:
              // 连环落雷 + 更重震屏/推镜/慢放 + 专属震动 —— 高球喂到这份上就该被制裁,
              // 数值全在 config.fx.flashApex*,别在这里另抄一份
              const ang = hitAng ?? this.hitAngOf(e);
              const apex = e.flashApex === true;
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_FIRE);
              this.world.fx.skyThunder(e.x as number, e.y as number, apex);
              this.world.shake(apex ? (C.fx.flashApexShake || 26) : 20, 0, ang);
              this.world.punch(e.x as number, e.y as number,
                apex ? (C.fx.flashApexPunch || 1.12) : (C.fx.flashCastPunch || 1.05) + 0.05);
              if (this.slowmoOn) {
                this.world.slowmo(
                  apex ? (C.fx.flashApexSlowmo || 16) : (C.fx.flashSmashSlowmo || 14),
                  apex ? (C.fx.flashApexSlowFac || 0.4) : (C.fx.flashSmashSlowFac || 0.32));
              }
              if (apex && !hitterIsAI) haptic("perfectSmash");
            } else if (skillKind === "magnet") {
              const ang = hitAng ?? this.hitAngOf(e);
              // 空中收拍的引力跳杀(modifyShot 里 forceSmash 兑现):特效/震屏/推镜升一档;
              // 地面回击维持原有手感
              const air = (e.kind as string) === "smash";
              this.world.fx.smash(e.x as number, e.y as number, ang, air ? TIER_SWEET_SMASH : TIER_SWEET);
              this.world.fx.singularityBurst(e.x as number, e.y as number);
              this.world.shake(air ? 14 : 10, 0, ang);
              this.world.punch(e.x as number, e.y as number, air ? 1.06 : 1.045);
            } else if (skillKind === "focus") {
              const ang = hitAng ?? this.hitAngOf(e);
              // 接球后缓释收尾:将世界慢动作同步缩短至 postHitFrames,出球破空特写后自然恢复原速
              const postHit = C.skills.focus.postHitFrames || 22;
              this.world.clampSlowmo(postHit);
              // 强化时空打击:专属时空爆裂激波 + 冲击波 + 震屏与镜头推进特写
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET_SMASH);
              this.world.fx.chronoBurst(e.x as number, e.y as number, ang);
              this.world.shake(C.skills.focus.hitShake || 16, 0, ang);
              this.world.punch(e.x as number, e.y as number, C.skills.focus.hitPunch || 1.065);
              this.sfx.play("smash", 1.0);
              if (!hitterIsAI) haptic("perfectSmash");
            } else if (skillKind === "rage") {
              // 怒气重击命中那一下:档位由**兑现那一刻的快照**决定(e.rageRatio),
              // 不能读 hitter.rage —— 它在同一帧已经被清零了,读到的永远是 0 档。
              // 基线那套 hitstop/shake/punch 六档阶梯(上面 drain 里按 smash/sweet/perfect 走的
              // 那条)照吃,这里只"再加一档":world.shake 取 MAX、punch 是覆盖,所以档位表填绝对值。
              const ang = hitAng ?? this.hitAngOf(e);
              const RT = Skills.rageTierOf((e.rageRatio as number) ?? 0);
              const t = C.skills.rage.tiers[RT];
              this.world.fx.smash(e.x as number, e.y as number, ang,
                RT >= 3 ? TIER_FIRE : RT >= 2 ? TIER_SWEET_SMASH : TIER_SWEET);
              if (RT >= 2) this.world.fx.flameBurst(e.x as number, e.y as number);
              if (RT >= 3) {
                // 满怒:怒极一记激波 + 落点震屏顶到表里的最高档 —— 攒一整局换的就是这一下
                this.world.fx.chronoBurst(e.x as number, e.y as number, ang);
              }
              this.world.shake(t.hitShake, 0, ang);
              this.world.punch(e.x as number, e.y as number, t.hitPunch);
              this.sfx.play("smash", 0.9 + 0.05 * RT);
              if (!hitterIsAI) haptic(t.haptic as Parameters<typeof haptic>[0]);
            }
          } else if (praise && e.lungeShot) {
            if (!hitterIsAI) this.floatSideLab({ text: "跨步重击!", color: "#38bdf8", size: 24, life: 48, plate: "slant" }, e.x as number);
            const ang = hitAng ?? this.hitAngOf(e);
            this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET);
          }
          // 连击热手提示:热度首次烧到 fireAt 时飘一次(连打好球的人才看得到)
          if (praise && !hitterIsAI && (e.heat as number) === (C.heat.fireAt || 3)) {
            this.floatSideLab({ text: "手感火热!", color: "#ff6a1f", size: 21, life: 46, plate: "slant" }, e.x as number);
          }
          // 跳杀:空中高球必然扣杀的专属飘字(挂场边,与档位字同侧自动错行)
          // 真人看「跳杀!!」学成因,AI 打出来只当对手的高光,不飘教学字
          if (praise && e.jumpSmash && !hitterIsAI) {
            const K = C.fx as unknown as Record<string, FloatLabel>;
            this.floatSideLab(K.floatJumpSmash, e.x as number);
          }
          // 放网提示 + 球种标签:非扣杀类技术球一闪即逝的类型提示(老 game.js#L308-313)
          if (e.kind === "netshot") this.world.float(e.x as number, (e.y as number) - 22, "放网", "#cfe0ff", 13, 28);
          if (praise && e.kind !== "smash") {
            const lblMap: Record<string, string> = { drive: "shotLabelDrive", lob: "shotLabelLob", slash: "shotLabelSlash", clear: "shotLabelClear" };
            const lbl = (C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number }>)[lblMap[e.kind as string] ?? ""];
            if (lbl) this.world.float(e.x as number, (e.y as number) - 22, lbl.text, lbl.color, lbl.size, lbl.life);
          }
          // 多拍相持里程碑爽点反馈(老 game.js#L314-322;emoji 换 BMP 安全符号)。
          // 里程碑瞬间欢呼 + 震屏,数字大字之外再给一记「阶段性胜利」的体感
          if (e.rally === 6) {
            this.world.float(C.world.w / 2, 72, "★ 6 拍激烈相持! ★", "#ffe14d", 18, 38);
            this.sfx.cheer(0.4); this.world.shake(3);
          } else if (e.rally === 10) {
            this.world.float(C.world.w / 2, 72, "★ 10 拍巅峰对攻!! ★", "#ff6a1f", 22, 46);
            this.sfx.cheer(0.7); this.world.shake(4);
          } else if (e.rally === 15) {
            this.world.float(C.world.w / 2, 72, "★ 15 拍神仙之战!!! ★", "#00f0ff", 24, 52);
            this.sfx.cheer(1); this.world.shake(5);
          }
          // (连击压力的玩家反馈已整体迁往 syncPressureCue:血条阶段上升沿统一播,
          //  「对手体力下降!」这句旧飘字与血条信号打架,已删 —— 同一件事不在两处念)
          if (e.timingHint && !e.autoHit) {
            this.world.float(e.x as number, (e.y as number) - 44, e.timingHint === "early" ? "早了!" : "晚了!", "#ff9664", 14, 36);
          }
          // 表情:扣杀凶相 / 完美星眼 / 下网冒汗(训练场喂球机不做人,不给它表情)。
          // faceOf 按名单 idx 定位(双打也不挂错人);影分身 idx=-1 查不到人 → 自然跳过,
          // 无面之影不做表情,正确。
          if (!((R.mode === "drill" || R.mode === "tutorial") && e.side === "right")) {
            if (e.intoNet) this.faceOf(e.idx as number, "oops", 50);
            else if (perfect) this.faceOf(e.idx as number, "star", 55);
            else if (smash) this.faceOf(e.idx as number, "fierce", 45);
          }
          // 被扣的一方吓一跳
          if (smash) this.faceSide(e.side === "left" ? "right" : "left", "wow", 36);
          break;
        }
        case "serve": {
          this.sfx.hit(0.6, "clear", false, false);
          this.setStop(2);
          this.world.shake(1.6);
          this.world.punch(C.court.netX, C.court.groundY - 110, C.fx.punchServe || 1.02);
          if (e.type === "flick") {
            this.world.floatSys(C.world.w / 2, 60, "偷后场!", "#ffd48a", 16, 36);
          } else if (e.type === "clear") {
            this.world.floatSys(C.world.w / 2, 60, "高远发球", "#c0d8ff", 16, 36);
          }
          // 发球的深浅确认不用在这做:applyShot 的 hit 事件带 aim,发球也会走一次 hit 分支;
          // 这里再飘就叠两层。forced 发球(偷后场/高远)已在 rules 里清掉 aim,不会谎报。
          break;
        }
        case "net":
          this.sfx.play("net");
          this.world.shake(3);
          this.setStop(4);
          this.world.hitNet(e.y as number, 1.2);
          this.world.fx.feather(C.court.netX, e.y as number, 3);
          this.world.floatSys(C.court.netX, (e.y as number) - 30, "下网", "#ff8a8a", 20, 46);
          this.faceSide(e.side as string, "oops", 50);
          break;
        case "let":
          this.sfx.cheer(0.5);
          this.world.hitNet(C.court.netTopY, 0.8);
          this.world.floatSys(C.court.netX, C.court.netTopY - 40, "擦网!", C.colors.accent, 22, 52);
          this.faceSide(e.side as string, "wow", 40);
          break;
        case "land": {
          this.sfx.floor(e.isSmash ? 1.5 : 0.9);
          // 扣杀砸穿对手那一记才震(球落地即这一分结束,所以 score 分支会避开重复);
          // AI 的扣杀不震 —— 对手的高光不是你的操作反馈,与 pulseSwing 同一判据
          if (e.isSmash && e.scorer === "left") haptic("landSmash");
          // 扣杀落地:纵向震动为主 + 地面冲击波 + 羽毛碎屑(老 fx.js shockwave 的落地波纹,本次接线)
          this.world.shake(e.isSmash ? (C.fx.shakeLandSmash || 7) : e.out ? 2 : 3,
            e.isSmash ? (C.fx.shakeLandSmashVert || 5) : 0);
          if (e.isSmash) {
            this.world.fx.shockwave(e.x as number, e.y as number);
            this.world.fx.feather(e.x as number, e.y as number, 3);
          }
          this.world.fx.land(e.x as number, e.y as number, !e.out);
          this.world.floatSys(e.x as number, (e.y as number) - 46, e.out ? "出界" : "落地", e.out ? "#ff6b6b" : "#d8ffb0", 16, 38);
          break;
        }
        // ---------- 训练场:每一球结束 ----------
        case "drill-end": {
          const before = Drill.prog().valid;
          Drill.onEnd(e as never);
          const p = Drill.prog();
          if (p.valid > before) {
            const g = Drill.cur()?.goal || C.drill.defaultGoal;
            this.world.floatSys(e.landX as number, C.court.groundY - 74, `有效 +1 · ${Math.min(p.valid, g)}/${g}`, C.colors.accent, 22, 52);
            this.sfx.score(true);
          } else if (p.attempts > 0 && e.lastHitter === "left") {
            const failReason = Drill.diagnoseFail(Drill.cur(), e as never);
            const landX = (e.landX as number) || (C.world.w / 2);
            this.world.floatSys(landX, C.court.groundY - 64, failReason, "#ffaaa0", 16, 52);
          }
          // 表情:这一球练成了开心,练砸了沮丧(只给左侧练习者,喂球机不变脸)
          this.faceSide("left", p.valid > before ? "happy" : "sad", 70);
          if (p.done) this.finishDrill();
          break;
        }
        // ---------- 新手教学:每一球结束(反馈飘字与训练场同款,判分归 Tutorial) ----------
        case "tut-end": {
          const hadGate = Tutorial.gateDone(1);
          Tutorial.onEnd(e as never);
          if (Tutorial.gateDone(1) && !hadGate) {
            this.world.floatSys(C.world.w / 2, C.court.groundY - 96, "就是这样!", "#ffe14d", 26, 70);
            this.sfx.score(true);
          } else {
            const msg = Tutorial.curFail();
            if (msg) {
              const landX = (e.landX as number) || (C.world.w / 2);
              this.world.floatSys(landX, C.court.groundY - 64, msg, "#ffaaa0", 16, 52);
            }
          }
          break;
        }
        case "score": {
          this.sfx.score(true);
          this.bgm.onScore();
          // 触觉:自己得分给一记重震;丢分不震(安慰性 buzz 只会添堵)。
          // 扣杀得分那一记已由 land 分支的 landSmash 说过同一个时刻了,这里不再叠第二段
          // (rules 里 land 之后必发 score,两处都震会变成两串连打)。
          if (e.side === "left" && e.reason !== "扣杀得分") haptic("score");
          // 体力归因:玩家得分且 AI 血条 ≤2 格(高压力)→ 把这一分记在消耗战术上。
          // boss 战爽感的闭环就在这一句:玩家亲眼看到「这分是我拖出来的」。
          // 扣杀得分有自己的中央大字(同区 y=96),不再叠一层;训练场没有对手体力。
          // 同样吃 cueFloor:easy 血条掉空时行为侧才一半,别替它喊「体力透支」。
          if (e.side === "left" && e.reason !== "扣杀得分" && R.mode !== "drill" && R.mode !== "tutorial") {
            const ai = R.players.find((p) => p.side === "right" && p.isAI);
            if (ai && ai.ai) {
              const tier = ai.aiTier ?? C.diffs[ai.aiDiff ?? "normal"];
              const stamina = clamp(1 - (tier.crush > 0 ? ai.ai.pressure / tier.crush : 0), 0, 1);
              if (stamina <= 0.4 && ai.ai.pressure >= C.aiPressure.cueFloor) this.world.float(C.world.w / 2, 130, "体力透支!", "#ffb37a", 15, 40);
            }
          }
          // 扣杀得分专属:观众大欢呼 + 庆祝短慢放 + 中央大字,与普通得分拉开层次
          if (e.reason === "扣杀得分") {
            this.sfx.cheer(0.7);
            if (this.slowmoOn) this.world.slowmo(C.fx.scoreSlowmoFrames || 10, C.fx.scoreSlowmo || 0.45);
            this.world.float(C.world.w / 2, 96, "扣杀得分!", "#ffe14d", 24, 52);
          } else if ((e.score as number[])[0] + (e.score as number[])[1] > 4) {
            this.sfx.cheer(0.4);
          }
          // CPU 人格化:得分/失分触发情绪动作
          for (const p of R.players) if (p.isAI) AI.onScore(p, p.side === e.side);
          // 表情:得分方开心、丢分方沮丧(整队同变,90 帧覆盖得分停顿)
          this.faceSide(e.side as string, "happy", 90);
          this.faceSide(e.side === "left" ? "right" : "left", "sad", 90);
          break;
        }
        case "deuce":
          this.world.floatSys(C.world.w / 2, C.world.h / 2 - 40, "平分! DEUCE", "#ff6b9d", 32, 90);
          this.sfx.cheer(0.8);
          this.bgm.onDeuce();
          break;
        case "campaign-clear": {
          // 闯关通关事件:第一消费者是这里(结算奖励),文案展示在大厅/简报各有各的出处
          this.campClear = {
            firstClear: !!e.firstClear,
            coins: (e.rewards as { coins: number })?.coins ?? 0,
            exp: (e.rewards as { exp: number })?.exp ?? 0,
          };
          break;
        }
        case "match-over": {
          const youWon = R.mode === "2p" ? true : e.winner === "left";
          this.sfx.play(youWon ? "win" : "lose");
          // 终局是整局唯一给到三段脉冲的时机(胜利)/一记长而软的落锤(失利)
          haptic(youWon ? "win" : "lose");
          this.sfx.cheer(1);
          this.bgm.onMatchOver(youWon);
          // 表情:胜负定格(OVER 冻结 faceT 不衰减,一直挂到结算面板盖上来)
          this.faceSide(e.winner as string, "cheer", 9999);
          this.faceSide(e.winner === "left" ? "right" : "left", "ko", 9999);
          if (youWon) {
            // 两口贴地斜喷(喷口与弹道全在 CFG.fx.confetti)。旧写法是一口居中
            // (480, groundY-120) —— 纸屑全打在结算卡背后,玩家看得见的那两条侧边一片都没有
            this.world.fx.confettiVolley();
          }
          // 生涯结算(2p 友谊赛返回 null,不发奖);闯关首通带关卡奖励,无限练习带终局比分
          const camp = R.mode === "campaign" ? this.campClear : null;
          this.campClear = null;
          const res = Career.settle({
            mode: R.mode, diff: R.diff, won: e.winner === "left",
            stats: Rules.statsOf("left"), longestRally: R.longestRally,
            scores: [R.scores[0], R.scores[1]],
            campaign: camp ?? undefined,
          });
          if (res) {
            if (res.levelUps.length) this.sfx.play("levelup");
            else if (res.coin > 0) this.sfx.play("coin");
            this.world.floatSys(C.world.w / 2, C.world.h / 2 - 8,
              youWon ? `胜利! 金币 +${res.coin} · 经验 +${res.exp}` : `惜败 · 金币 +${res.coin}`,
              youWon ? "#ffe14d" : "#d8e2ff", 20, 120);
            // 活动任务现场播报(2026-10-07 活动板块):这条只报「新完成且未领」的任务,
            // 完成的下一拍不发钱 —— 领取在首页活动面板,把人拉回菜单形成闭环
            if (res.questsDone?.length) {
              this.world.floatSys(C.world.w / 2, C.world.h / 2 - 72,
                `活动完成 · ${res.questsDone.map(questTitle).join(" · ")}`,
                "#ffe14d", 14, 130);
            }
          }
          break;
        }
        case "point-start":
          this.world.clearFloats();
          this.world.clearTrail();
          this.pStage = 0;   // 体力阶段的分内闩锁:新一分重新记账(AI 状态也在这一拍 reset)
          if (Rules.isMatchPoint()) this.sfx.play("whistle");
          break;
      }
    }
    R.events.length = 0;
  }

  // ---------- 表情系统:事件 → 球员脸部状态(渲染层 drawHead 消费;真人/CPU 共用) ----------
  /** 单人设置(hit 事件按 idx 定位击球者,双打也不会挂错人) */
  private faceOf(idx: number, face: FaceKind, frames: number): void {
    const p = Rules.R.players[idx];
    if (!p) return;
    p.face = face; p.faceT = frames; p.faceD = frames;
  }

  /** 整队同变(得分/丢分/胜负):双打时队友一起挂表情 */
  private faceSide(side: string, face: FaceKind, frames: number): void {
    for (const p of Rules.R.players) {
      if (p.side !== side) continue;
      p.face = face; p.faceT = frames; p.faceD = frames;
    }
  }

  // ---------- 训练场通关(老 finishDrill 的精简版) ----------
  private finishDrill(): void {
    const res = Drill.result();
    const reward = Career.settleDrill(res);
    Rules.R.state = "DRILLDONE";
    this.sfx.play(res.stars >= 2 ? "win" : "score");
    this.sfx.cheer(0.7);
    if (res.stars >= 1) {
      this.world.fx.confettiVolley();
    }
    if (reward && reward.levelUps.length) this.sfx.play("levelup");
    else if (reward && reward.coin > 0) this.sfx.play("coin");
    this.world.floatSys(C.world.w / 2, C.world.h / 2 - 8,
      `训练完成 ★${res.stars} · 金币 +${reward?.coin ?? 0}`, C.colors.accent, 22, 150);
  }
}
