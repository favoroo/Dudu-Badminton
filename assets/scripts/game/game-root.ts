// ============================================================
// 主循环组件(挂到 Canvas 上,阶段 2 唯一需要在编辑器里手动操作的节点)
// 固定步长 60Hz 模拟 + 渲染插值 + 事件分发,与老 game.js 同构:
//   acc += dt;while (acc >= step) { 模拟一步;清输入边沿 }
// 事件只从 Rules.R.events 取,分发给音效/飘字/震屏 —— 表现层依旧不进逻辑。
// 菜单/结算完整 UI 是阶段 3;本组件先直进一局「单人 · 普通」。
// ============================================================
import { _decorator, Component, ResolutionPolicy, profiler, view } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { installStorageBackend } from "./host";
import { Rules } from "../core/rules";
import { AI } from "../core/ai";
import { Drill } from "../core/drill";
import { Career } from "../core/career";
import { flightFramesTo } from "../core/physics";
import { Pace } from "../core/pace";
import { Gait } from "../core/gait";
import { Player, PRESS_LEAD_FRAMES } from "../core/player";
import { Skills } from "../core/skills";
import { clamp } from "../core/utils";
import { Ball, FaceKind, GameEvent, PlayerInput } from "../core/types";
import { WorldView } from "../render/world";
import { TIER_FIRE, TIER_NORMAL, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "../render/shuttle-motion";
import { newPad, clearEdges, buildIntent, emptyIntent, tickHolds, Pad } from "../input/pad";
import { bindKeyboard } from "../input/keyboard";
import { touchPad } from "../input/touchpad";
import { Sfx } from "./sfx";
import { BgmManager } from "./bgm";
import { haptic } from "./haptics";

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
          }
          this.world.stepFx(step, false, R.ball);
        }
      }
      if (!keepEdges) clearEdges(this.pad);
    }
    if (n === C.sim.maxSteps) this.acc = 0;

    this.drain();
    this.updateSwingCue();
    // 同步玩家技能按键状态至触屏
    const human = R.players[0];
    if (human && human.skill) {
      const s = human.skill;
      const cdRatio = s.maxCd > 0 ? clamp(s.cd / s.maxCd, 0, 1) : 0;
      const def = Skills.defOf(s.id);
      touchPad.setSkillState(cdRatio, s.ready, s.id, def.shortName);
    }
    const animT = (R.state === "RALLY" || R.state === "POINT" || R.state === "SERVE") ? this.worldT : this.frameT;
    // 氛围暗角输入(长回合金晕/赛点红晕在渲染层只读消费)
    this.world.setAtmo(R.state, R.rally, Rules.isMatchPoint());
    this.world.render(R.players, R.ball, Math.min(1, this.acc / step), animT, Career.skinOf("shuttle"), R.rally);
    // 画布内世界提示(落点圈/训练时机条/拍数徽标/赛点旗标,老 hud.js)
    this.world.hudOverlay.draw(R, this.world.frameT);
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
  // 最佳按拍时刻 = 球到判定区心「前」PRESS_LEAD_FRAMES 帧(按下后第 9 帧才是质量峰),
  // 所以亮度峰必须对着「球还没到」的那个时刻,提示的才是「现在按」而不是「球到了」。
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
      return;
    }
    const z = Player.strikeZone(human, Math.hypot(ball.vx, ball.vy));
    // horizonFrames **故意不随球速档位折算**:它是「距球进入判定区还剩几帧」的剩余帧预算,
    // 不是总滞空帧数。不折 = 预告在真实时间里同样提前 0.66s 亮起(按拍时机是玩家侧的量,
    // 与档无关);折了反而让慢档的提前量变长,与 swingCue 的设计意图相反。详见 pace.ts 头注释。
    const fc = flightFramesTo(ball, z.x, z.y, z.r * cue.arriveRadius, cue.horizonFrames);
    if (fc === null) {
      this.swingCueArmed = true;
      touchPad.setSwingGlow(0);
      this.world.setSwingCue(0);
      return;
    }
    const lead = PRESS_LEAD_FRAMES;
    const cueLevel = clamp(1 - Math.abs(fc - lead) / cue.rampFrames, 0, 1);
    touchPad.setSwingGlow(cueLevel);
    // 同一级辉光镜像到羽毛球本体:注意力跟球的玩家看不见按钮,球自己发光当预告
    this.world.setSwingCue(cueLevel);
    // 到点闪环带迟滞:过了最佳帧后再退出预告线 8 帧才重新武装,一记来球只闪一次
    if (fc <= lead) {
      if (this.swingCueArmed) { this.swingCueArmed = false; touchPad.pulseSwing("sweet"); }
    } else if (fc > lead + 8) {
      this.swingCueArmed = true;
    }
  }

  /** 慢放总闸(见 config.fx.slowmoEnabled):关掉时两处 world.slowmo() 与赛点常驻微慢放全不发,世界恒速 */
  private get slowmoOn(): boolean { return C.fx.slowmoEnabled === true; }

  // ---------- 输入 → 意图(与老 buildInputs 同构) ----------
  private buildInputs(): PlayerInput[] {
    const R = Rules.R;
    const hooks: Partial<PlayerInput> = {
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
    };
    return R.players.map((p) => {
      // 训练场的右半边不是对手,是喂球机:走同一条 inputs 通道(一拍一落是结构必然)
      if (R.mode === "drill" && p.side === "right") {
        return { ...emptyIntent(), ...hooks, ...Drill.feederInput(p, R) };
      }
      if (p.isAI) return { ...AI.think(p, R.ball as Ball, R.state), ...hooks };
      return buildIntent(this.pad, hooks);   // 阶段 2:左队 0 号真人用 P1 键位/虚拟按键
    });
  }

  // ---------- 事件 → 反馈(老 game.js drain 的阶段 2 子集) ----------
  /** hit 事件的出球方向:火花扇/划线/速度线都按它朝向,不再各算各的或硬编码 0 */
  private hitAngOf(e: GameEvent): number {
    const vx = e.vx as number, vy = e.vy as number;
    return Number.isFinite(vx) && Number.isFinite(vy) ? Math.atan2(vy, vx) : 0;
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
          // 六档打击阶梯(hitstop + 震屏 + 镜头 punch + 白闪;赛点重锤另有慢动作)
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
          // 白闪阶梯(老 fx.js hit 的 flash 档;普通档分两阈值:高质量闪 / 踩得还行微闪)
          this.world.whiteFlash((perfect && smash) || perfect ? (C.fx.flashPerfect || 0.8)
            : (smash && sweet) ? (C.fx.flashSweetSmash || 0.65)
            : smash ? (C.fx.flashSmash || 0.55)
            : sweet ? (C.fx.flashSweet || 0.42)
            : (e.q as number) >= (C.fx.flashNormalAt || 0.86) ? (C.fx.flashNormal || 0.35)
            : (e.q as number) >= (C.fx.flashNormalLowAt || 0.6) ? (C.fx.flashNormalLow || 0.18) : 0);
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
          // 触觉:真人击球短震,完美重扣用重档(喂球侧不震,与飘字同一判据)
          if (praise) haptic(perfect && smash ? "score" : "hit");
          // 甜蜜/完美 → 击球两键档位辉光:飘字在球边上,拇指边的按键也直接亮一拍。
          // 只认真人自己打出来的 —— 对手/AI 的好球不是你的操作反馈,亮了反而误导
          if (praise && !R.players[hitterIdx]?.isAI && (sweet || perfect)) {
            touchPad.pulseSwing(perfect ? "perfect" : "sweet");
          }
          // 深浅瞄准的命中确认:右滑深球(重)/左滑短球(轻)飘小字,键盘 J/K 同链路;
          // mid(没滑直接点)不飘 —— 默认档不打扰。位置在球下方,与上方档位飘字错开
          if (praise && !R.players[hitterIdx]?.isAI) {
            const K = C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number; dy: number }>;
            const aimLab = e.aim === "deep" ? K.floatAimDeep : e.aim === "near" ? K.floatAimNear : null;
            if (aimLab) this.world.float(e.x as number, (e.y as number) + aimLab.dy, aimLab.text, aimLab.color, aimLab.size, aimLab.life);
          }
          if (praise) {
            // 档位文案/字号/寿命全部来自 config.fx.floatTier*(分级炫技的"文字"那一格)
            const K = C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number; dy: number }>;
            const lab = (perfect && smash) ? K.floatTierPerfectSmash
              : perfect ? K.floatTierPerfect
                : (smash && sweet) ? K.floatTierSweetSmash
                  : smash ? K.floatTierSmash
                    : sweet ? K.floatTierSweet
                      : (e.q as number) > 0.86 ? K.floatTierGood : null;
            if (lab) this.world.float(e.x as number, (e.y as number) + lab.dy, lab.text, lab.color, lab.size, lab.life);
          }
          // 技能专属击球飘字与强化特效
          const skillKind = e.skillKind as string | null;
          if (praise && skillKind) {
            const K = C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number; dy: number }>;
            const sLab = skillKind === "lunge" ? K.floatSkillLunge
              : skillKind === "smash" ? K.floatSkillSmash
              : skillKind === "flash" ? K.floatSkillFlash
              : skillKind === "magnet" ? K.floatSkillMagnet
              : skillKind === "focus" ? K.floatSkillFocus
              : null;
            if (sLab) {
              this.world.float(e.x as number, (e.y as number) + sLab.dy - 16, sLab.text, sLab.color, sLab.size, sLab.life);
            }
            if (skillKind === "lunge") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET_SMASH);
              this.world.whiteFlash(0.48);
              this.world.shake(9);
            } else if (skillKind === "smash" || skillKind === "flash") {
              const ang = hitAng ?? this.hitAngOf(e);
              this.world.fx.smash(e.x as number, e.y as number, ang, TIER_FIRE);
              this.world.whiteFlash(0.75);
              this.world.shake(16);
            } else if (skillKind === "magnet") {
              this.world.fx.sweet(e.x as number, e.y as number, hitAng);
              this.world.whiteFlash(0.5);
              this.world.shake(8);
            }
          } else if (praise && e.lungeShot) {
            this.world.float(e.x as number, (e.y as number) - 44, "跨步重击!", "#38bdf8", 24, 48);
            const ang = hitAng ?? this.hitAngOf(e);
            this.world.fx.smash(e.x as number, e.y as number, ang, TIER_SWEET);
          }
          // 连击热手提示:热度首次烧到 fireAt 时飘一次(连打好球的人才看得到)
          if (praise && (e.heat as number) === (C.heat.fireAt || 3)) {
            this.world.float(e.x as number, (e.y as number) - 38, "手感火热!", "#ff6a1f", 21, 46);
          }
          // 放网提示 + 球种标签:非扣杀类技术球一闪即逝的类型提示(老 game.js#L308-313)
          if (e.kind === "netshot") this.world.float(e.x as number, (e.y as number) - 22, "放网", "#cfe0ff", 13, 28);
          if (praise && e.kind !== "smash") {
            const lblMap: Record<string, string> = { drive: "shotLabelDrive", lob: "shotLabelLob", slash: "shotLabelSlash", clear: "shotLabelClear" };
            const lbl = (C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number }>)[lblMap[e.kind as string] ?? ""];
            if (lbl) this.world.float(e.x as number, (e.y as number) - 22, lbl.text, lbl.color, lbl.size, lbl.life);
          }
          // 多拍相持里程碑爽点反馈(老 game.js#L314-322;emoji 换 BMP 安全符号)。
          // 本次追加:里程碑瞬间欢呼 + 白闪 + 震屏,数字大字之外再给一记「阶段性胜利」的体感
          if (e.rally === 6) {
            this.world.float(C.world.w / 2, 72, "★ 6 拍激烈相持! ★", "#ffe14d", 18, 38);
            this.sfx.cheer(0.4); this.world.whiteFlash(0.18); this.world.shake(3);
          } else if (e.rally === 10) {
            this.world.float(C.world.w / 2, 72, "★ 10 拍巅峰对攻!! ★", "#ff6a1f", 22, 46);
            this.sfx.cheer(0.7); this.world.whiteFlash(0.24); this.world.shake(4);
          } else if (e.rally === 15) {
            this.world.float(C.world.w / 2, 72, "★ 15 拍神仙之战!!! ★", "#00f0ff", 24, 52);
            this.sfx.cheer(1); this.world.whiteFlash(0.3); this.world.shake(5);
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
            this.world.whiteFlash(C.fx.flashServeFlick || 0.2);
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
          // 触觉:自己得分给一记重震;丢分不震(安慰性 buzz 只会添堵)
          if (e.side === "left") haptic("score");
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
        case "match-over": {
          const youWon = (R.mode === "1p" || R.mode === "endless") ? e.winner === "left" : true;
          this.sfx.play(youWon ? "win" : "lose");
          this.sfx.cheer(1);
          this.bgm.onMatchOver(youWon);
          // 表情:胜负定格(OVER 冻结 faceT 不衰减,一直挂到结算面板盖上来)
          this.faceSide(e.winner as string, "cheer", 9999);
          this.faceSide(e.winner === "left" ? "right" : "left", "ko", 9999);
          if (youWon) {
            this.world.fx.confetti(C.world.w / 2, C.court.groundY - 120);
          }
          // 生涯结算(2p 友谊赛返回 null,不发奖)
          const res = Career.settle({
            mode: R.mode, diff: R.diff, won: e.winner === "left",
            stats: Rules.statsOf("left"), longestRally: R.longestRally,
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
