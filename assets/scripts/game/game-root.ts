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
import { Career } from "../core/career";
import { flightFramesToClosest } from "../core/physics";
import { Pace } from "../core/pace";
import { Gait } from "../core/gait";
import { Player, PRESS_LEAD_FRAMES } from "../core/player";
import { Skills } from "../core/skills";
import { clamp } from "../core/utils";
import { Ball, FaceKind, GameEvent, PlayerInput, ShotKind, ShotResult, SkillId } from "../core/types";
import { WorldView } from "../render/world";
import { TIER_FIRE, TIER_NORMAL, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "../render/shuttle-motion";
import { newPad, clearEdges, buildIntent, emptyIntent, tickHolds, Pad } from "../input/pad";
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
  /** 时机环入参复用对象(setTimingRing 只存引用、draw 时读字段,复用安全) */
  private cueRing = { zx: 0, zy: 0, zr: 0, progress: 0, locked: false };

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
    Settings.onChange((s) => { Pace.request(s.paceTier); Gait.apply(s.gaitTier); });
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
  private startMatch(mode: string, diff: "easy" | "normal" | "hard"): void {
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
    this.frameT++;
    // 累加器速度。BGM 跑在音频时钟上,所以变速不会拖慢音乐节奏。
    // 定格段恒按真实速度走:定格步调 stepFx(frozen),慢动作计时 slowT 被一起冻住不递减,
    // 若这里照旧乘 timeScale,慢放的速度就会泄漏进定格段 —— 顶档定格曾被拉成半秒多的完全静止。
    // 慢放段与赛点常驻 0.9 微慢放统一由 config.fx.slowmoEnabled 总闸决定(当前 false:世界恒速)。
    const mp = R.state === "RALLY" && Rules.isMatchPoint();
    const speed = this.stopFrames > 0 ? 1
      : this.slowmoOn ? this.world.timeScale() * (mp ? 0.9 : 1)
        : 1;
    this.acc += Math.min(dt, 0.25) * speed;          // 切后台回来不追帧

    // BGM 自适应编排:每帧观察比赛状态(分层强度/场景/赛点/暂停)
    this.bgm.update(R, Rules.isMatchPoint());

    const step = C.sim.step;
    let n = 0;
    while (this.acc >= step && n < C.sim.maxSteps) {
      this.acc -= step; n++;
      // 定格步不消费输入:见下面 stopFrames 分支
      let keepEdges = false;
      if (!(C.frozen as string[]).includes(R.state)) {
        if (this.stopFrames > 0) {
          this.stopFrames--;                 // hitstop:反馈计时照走,世界时钟不递增
          this.world.stepFx(step, true);     // 定格:镜头/白闪/慢动作/粒子一起冻住
          // 定格期间 Rules.step 没跑,这一按的边沿若照常被清掉就凭空消失了
          keepEdges = true;
        } else {
          this.worldT++;                     // 只有世界真正推进的 step 累加世界时钟
          Rules.step(this.buildInputs());
          // 跳跃按住时长:只在世界真推进的步里数。放这里而不是跟着 clearEdges 走 ——
          // hitstop 定格段世界不升,按住时长也不该涨,否则 tapCommitFrames
          // 会把「顿帧里松手」误判成点跳并补一段现实里没发生的上升。
          tickHolds(this.pad);
          // 挥拍风声:swingT 恰好走到起拍帧(引拍结束/发力开始)送一次,每挥必中一次
          // (音效早已烘焙,此前一直没接;双方玩家与 AI 都播,音量压低不抢戏)
          for (const p of R.players) {
            if (p.swingT === C.swing.windup) this.sfx.play("swing", 0.35);
            // AI 够不到时的鱼跃俯冲:ai.ts 在置位那一帧给到满值,这里补一记扑空音效
            // (俯冲姿势由 sprites.ts 读 scrambleT 画;只表现,不改判定)
            if (p.ai && p.ai.scrambleT === C.aiReach.scrambleFrames) {
              this.sfx.play("whiff", 0.7);
              this.world.shake(C.fx.shakeWhiff || 1.5);
            }
          }
          this.world.stepFx(step, false, R.ball);
        }
      }
      if (!keepEdges) clearEdges(this.pad);
    }
    if (n === C.sim.maxSteps) this.acc = 0;

    this.drain();
    // 触觉待发放:挂在真实帧循环(不是上面的模拟循环)—— 定格/慢动作期间模拟帧会积压,
    // 若跟着模拟帧放,恢复的那一瞬间会一口气震一串
    hapticTick();
    this.updateSwingCue();
    // 同步玩家技能按键状态至触屏
    const human = R.players[0];
    if (human && human.skill) {
      const s = human.skill;
      const cdRatio = s.maxCd > 0 ? clamp(s.cd / s.maxCd, 0, 1) : 0;
      const def = Skills.defOf(s.id);
      // cd 是世界步帧数(60Hz 递减),换算成秒给键心当倒计时;
      // 冷却之外还差一道门槛时,把可读原因一并喂给键上方当提示
      const blockReason = cdRatio <= 0
        ? Skills.skillBlockReason(human, R.ball) : null;
      touchPad.setSkillState(cdRatio, s.ready, s.id, def.shortName, s.cd / 60, blockReason);
    }
    const animT = (R.state === "RALLY" || R.state === "POINT" || R.state === "SERVE") ? this.worldT : this.frameT;
    // 氛围暗角输入(长回合金晕/赛点红晕在渲染层只读消费)
    this.world.setAtmo(R.state, R.rally, Rules.isMatchPoint());
    // ---------- 面板态渲染降频 ----------
    // frozen 态(MENU/PAUSED/OVER/CAREER/DRILLS/DRILLDONE)下模拟已停、粒子/飘字/震屏
    // 全部冻住,面板底下没有会动的游戏对象 —— 每帧全量重绘(动态层+球员+HUD,
    // 一帧 500+ 次 fill/stroke)纯烧电发热。每 4 渲染帧画一次(60Hz 锁帧下 ≈15fps):
    // 呼吸/海浪这类纯装饰慢下来无感;UI 面板的弹出/淡出是引擎 tween 驱动,不受影响。
    // BGM 与触摸在上方已各自跑完,不跟着降频。回到对局态立即恢复满帧。
    if (!(C.frozen as string[]).includes(R.state) || this.frameT % 4 === 0) {
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
    const cap = C.fx.hitstopCap || 7;
    this.stopFrames = Math.max(1, Math.min(cap, Math.round(frames)));
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
    const fc = flightFramesToClosest(ball, z.x, z.y, z.r, cue.horizonFrames);
    if (fc === null) {
      this.swingCueArmed = true;
      touchPad.setSwingGlow(0);
      this.world.setSwingCue(0);
      this.world.hudOverlay.setTimingRing(null);
      touchPad.setShotPreview(null);
      this.previewShotRef = null;
      return;
    }
    const lead = PRESS_LEAD_FRAMES;
    const pressAt = lead + cue.reactFrames;     // 提示提前量:给人类反应留帧
    const cueLevel = clamp(1 - Math.abs(fc - pressAt) / cue.rampFrames, 0, 1);
    touchPad.setSwingGlow(cueLevel);
    // 同一级辉光镜像到羽毛球本体:注意力跟球的玩家看不见按钮,球自己发光当预告
    this.world.setSwingCue(cueLevel);
    // 到点闪环带迟滞:过了提示帧后再退出预告线 8 帧才重新武装,一记来球只闪一次
    if (fc <= pressAt) {
      if (this.swingCueArmed) { this.swingCueArmed = false; touchPad.pulseSwing("sweet"); }
    } else if (fc > pressAt + 8) {
      this.swingCueArmed = true;
    }
    // 时机环喂给渲染层:收缩环长在球上(按拍预告的球上版),甜区圈画在判定区心
    const TR = C.timingRing;
    this.cueRing.zx = z.x; this.cueRing.zy = z.y; this.cueRing.zr = z.r;
    this.cueRing.progress = clamp(1 - (fc - pressAt) / TR.spanFrames, 0, 1);
    this.cueRing.locked = fc <= pressAt;
    this.world.hudOverlay.setTimingRing(this.cueRing);
    // 球种预告:按真实求解器预演这一拍,徽标写在击球键上方(挥拍中瞄准还能改,不掐)。
    // 走 previewKindCache:同拍命中缓存,换拍(shot 引用变)或每 10 帧才真正求解一次。
    if (this.previewShotRef !== ball.shot || this.frameT - this.previewFrame >= 10) {
      this.previewShotRef = ball.shot;
      this.previewFrame = this.frameT;
      this.previewKindCache = Player.previewKind(human, ball);
    }
    touchPad.setShotPreview(this.previewKindCache);
  }

  /** 慢放总闸(见 config.fx.slowmoEnabled):关掉时两处 world.slowmo() 与赛点常驻微慢放全不发,世界恒速 */
  private get slowmoOn(): boolean { return C.fx.slowmoEnabled === true; }

  // ---------- 输入 → 意图(与老 buildInputs 同构) ----------
  /** 输入事件钩子:一次性构造、整个生命周期复用(旧版每模拟步新建 7 个闭包,纯 GC 粮) */
  private inputHooks: Partial<PlayerInput> | null = null;
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
          this.setStop(C.fx.hitstopWhiff || 1);
        },
        onFootstep: (p) => {
          this.world.fx.stepDust(p.x, C.court.groundY);
        },
        onLunge: () => this.sfx.play("lunge"),
        onSkill: (p, id) => this.onSkillCast(p, id),
      };
    }
    const hooks = this.inputHooks;
    return R.players.map((p) => {
      // 训练场的右半边不是对手,是喂球机:走同一条 inputs 通道(一拍一落是结构必然)
      if (R.mode === "drill" && p.side === "right") {
        return { ...emptyIntent(), ...hooks, ...Drill.feederInput(p, R) };
      }
      if (p.isAI) return { ...AI.think(p, R.ball as Ball, R.state), ...hooks };
      return buildIntent(this.pad, hooks);   // 阶段 2:左队 0 号真人用 P1 键位/虚拟按键
    });
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
      // 百分百重击起手:聚能爆气 + 镜头推近 + 强力震屏 + 炽热金红爆闪 + 飘字
      this.world.fx.flameBurst(p.x, p.y - 20);
      this.world.punch(p.x, p.y, C.skills.smash.castPunch || 1.05);
      this.world.shake(C.skills.smash.castShake || 6);
      if (showLab) this.floatSideLab({ text: "暴烈重扣!!", color: "#f43f5e", size: 28, life: 52, plate: "star" }, p.x);
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
      // 时空减速起手:时空领域展开! 激活子弹时间 + 时空微澜波纹 + 镜头微推 + 青碧闪光 + 飘字
      const dur = C.skills.focus.duration || 90;
      const slowFac = C.skills.focus.ballSlow || 0.35;
      this.world.slowmo(dur, slowFac);
      this.world.fx.timeRupture(p.x, p.y - 28);
      this.world.punch(p.x, p.y, C.skills.focus.castPunch || 1.035);
      this.world.shake(C.skills.focus.castShake || 4);
      if (showLab) this.floatSideLab({ text: "时空领域!!", color: "#06b6d4", size: 26, life: 50, plate: "slant" }, p.x);
      this.sfx.play("whiff", 0.8);
      if (!p.isAI) haptic("skillLight");
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
    }
  }

  // ---------- 事件 → 反馈(老 game.js drain 的阶段 2 子集) ----------
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
          // 六档打击阶梯(hitstop + 震屏 + 镜头 punch;赛点重锤另有慢动作)
          this.setStop((perfect && smash) ? (C.fx.hitstopPerfectSmash || 7)
            : perfect ? (C.fx.hitstopPerfect || 5)
            : (smash && sweet) ? (C.fx.hitstopSweetSmash || 6)
            : smash ? (C.fx.hitstopSmash || 5)
            : sweet ? (C.fx.hitstopSweet || 4)
            : (C.fx.hitstopNormal || 2));
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
          // 赛点重锤慢动作(老 game.js:训练场单独放行——它永不记分,赛点判定恒 false)
          // 受 fx.slowmoEnabled 总闸控制:关掉后这一拍只剩 hitstop 顿帧,世界不减速
          if (this.slowmoOn && (smash || perfect) && R.state === "RALLY"
            && (R.mode === "drill" || Rules.isMatchPoint())) {
            this.world.slowmo(C.fx.slowmoFrames || 10, C.scoring.matchPointSlowmo || 0.5);
          }
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
          const praise = !(R.mode === "drill" && e.side === "right");
          const hitterIdx = e.idx as number;
          // 触觉:只给真人打出来的特殊击球 —— 普通对拉不震、AI 击球不震(旧写法两条都没挡住,
          // 结果是"每拍都在嗡嗡"反而什么都读不出来)。档位判据在 core/haptic.ts 的 shotKey
          const hk = shotKey(smash, sweet, perfect);
          if (praise && hk && !R.players[hitterIdx]?.isAI) haptic(hk);
          // 甜蜜/完美 → 击球两键档位辉光:飘字在球边上,拇指边的按键也直接亮一拍。
          // 只认真人自己打出来的 —— 对手/AI 的好球不是你的操作反馈,亮了反而误导
          if (praise && !R.players[hitterIdx]?.isAI && (sweet || perfect)) {
            touchPad.pulseSwing(perfect ? "perfect" : "sweet");
          }
          // 深浅瞄准的命中确认:右滑深球(重)/左滑短球(轻)飘小字,键盘 J/K 同链路;
          // mid(没滑直接点)不飘 —— 默认档不打扰。贴着击球点做空间反馈,不随档位字去场边
          if (praise && !R.players[hitterIdx]?.isAI) {
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
          const hitterIsAI = !!R.players[hitterIdx]?.isAI;
          if (praise && skillKind) {
            const K = C.fx as unknown as Record<string, FloatLabel>;
            const sLab = skillKind === "lunge" ? K.floatSkillLunge
              : skillKind === "smash" ? K.floatSkillSmash
              : skillKind === "flash" ? K.floatSkillFlash
              : skillKind === "magnet" ? K.floatSkillMagnet
              : skillKind === "focus" ? K.floatSkillFocus
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
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_FIRE);
              this.world.fx.skyThunder(e.x as number, e.y as number);
              this.world.shake(20, 0, ang);
              this.world.punch(e.x as number, e.y as number, (C.fx.flashCastPunch || 1.05) + 0.05);
              if (this.slowmoOn) {
                this.world.slowmo(C.fx.flashSmashSlowmo || 14, C.fx.flashSmashSlowFac || 0.32);
              }
            } else if (skillKind === "magnet") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET);
              this.world.fx.singularityBurst(e.x as number, e.y as number);
              this.world.shake(10, 0, ang);
              this.world.punch(e.x as number, e.y as number, 1.045);
            } else if (skillKind === "focus") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.sweet(e.x as number, e.y as number, ang);
              this.world.fx.timeRupture(e.x as number, e.y as number);
              this.world.shake(8, 0, ang);
              this.world.punch(e.x as number, e.y as number, 1.035);
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
          if (praise && e.jumpSmash && !R.players[hitterIdx]?.isAI) {
            const K = C.fx as unknown as Record<string, FloatLabel>;
            this.floatSideLab(K.floatJumpSmash, e.x as number);
          }
          // 量化时机条:真人每拍命中都在击球点上方画一拍(grade 带符号,早=左 晚=右)
          if (praise && !R.players[hitterIdx]?.isAI && typeof e.timingGrade === "number") {
            this.world.hudOverlay.showTimingBar(e.x as number, (e.y as number) - 64, e.timingGrade);
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
          // 连击压力:回合拖长 → 对手开始下滑。给玩家一个"拖长回合有回报"的可见信号
          // (训练场右半边是喂球机不是对手,不报;分级飘字位置与上面 6 拍里程碑错开)
          if (R.mode !== "drill" && e.rally === C.aiPressure.cueRally && R.players.some((q) => q.isAI)) {
            this.world.float(C.world.w / 2, 96, "对手体力下降!", "#8ef2a3", 20, 44);
            this.faceSide("right", "sad", 45);
          }
          if (e.timingHint) {
            this.world.float(e.x as number, (e.y as number) - 44, e.timingHint === "early" ? "早了!" : "晚了!", "#ff9664", 14, 36);
          }
          // 表情:扣杀凶相 / 完美星眼 / 下网冒汗(训练场喂球机不做人,不给它表情)
          if (!(R.mode === "drill" && e.side === "right")) {
            if (e.intoNet) this.faceOf(hitterIdx, "oops", 50);
            else if (perfect) this.faceOf(hitterIdx, "star", 55);
            else if (smash) this.faceOf(hitterIdx, "fierce", 45);
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
        case "score": {
          this.sfx.score(true);
          this.bgm.onScore();
          // 触觉:自己得分给一记重震;丢分不震(安慰性 buzz 只会添堵)。
          // 扣杀得分那一记已由 land 分支的 landSmash 说过同一个时刻了,这里不再叠第二段
          // (rules 里 land 之后必发 score,两处都震会变成两串连打)。
          if (e.side === "left" && e.reason !== "扣杀得分") haptic("score");
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
            this.world.fx.confetti(C.world.w / 2, C.court.groundY - 120);
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
          }
          break;
        }
        case "point-start":
          this.world.clearFloats();
          this.world.clearTrail();
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
      this.world.fx.confetti(C.world.w / 2, C.court.groundY - 120);
    }
    if (reward && reward.levelUps.length) this.sfx.play("levelup");
    else if (reward && reward.coin > 0) this.sfx.play("coin");
    this.world.floatSys(C.world.w / 2, C.world.h / 2 - 8,
      `训练完成 ★${res.stars} · 金币 +${reward?.coin ?? 0}`, C.colors.accent, 22, 150);
  }
}
