// ============================================================
// 主循环组件(挂到 Canvas 上,阶段 2 唯一需要在编辑器里手动操作的节点)
// 固定步长 60Hz 模拟 + 渲染插值 + 事件分发,与老 game.js 同构:
//   acc += dt;while (acc >= step) { 模拟一步;清输入边沿 }
// 事件只从 Rules.R.events 取,分发给音效/飘字/震屏 —— 表现层依旧不进逻辑。
// 菜单/结算完整 UI 是阶段 3;本组件先直进一局「单人 · 普通」。
// ============================================================
import { _decorator, Color, Component, Label, Layers, Node, ResolutionPolicy, UITransform, profiler, view } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { installStorageBackend } from "./host";
import { Rules } from "../core/rules";
import { AI } from "../core/ai";
import { Drill } from "../core/drill";
import { Career } from "../core/career";
import { Ball, FaceKind, PlayerInput } from "../core/types";
import { WorldView } from "../render/world";
import { newPad, clearEdges, buildIntent, emptyIntent, Pad } from "../input/pad";
import { bindKeyboard } from "../input/keyboard";
import { touchPad } from "../input/touchpad";
import { Sfx } from "./sfx";
import { BgmManager } from "./bgm";

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

  onLoad(): void {
    // 存储后端与设置读盘:必须排在任何 load() 之前。
    // (render/court 的模块级单例原本在构造函数里就读档,那处已改成懒确保,
    //  所以「谁先 import」不再决定存档能不能落盘。)
    installStorageBackend();
    Settings.init();
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
    if (R.state === "OVER" && code === "KeyR") { this.sfx.play("ui"); this.startMatch(R.mode as "1p", R.diff); return; }
    if (code === "KeyR") { this.sfx.play("ui"); this.startMatch(R.mode as "1p", R.diff); return; }
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
    this.acc += Math.min(dt, 0.25);          // 切后台回来不追帧

    // BGM 自适应编排:每帧观察比赛状态(分层强度/场景/赛点/暂停)
    this.bgm.update(R, Rules.isMatchPoint());

    const step = C.sim.step;
    let n = 0;
    while (this.acc >= step && n < C.sim.maxSteps) {
      this.acc -= step; n++;
      if (!(C.frozen as string[]).includes(R.state)) {
        if (this.stopFrames > 0) {
          this.stopFrames--;                 // hitstop:反馈计时照走,世界时钟不递增
          this.world.stepFx(step);
        } else {
          this.worldT++;                     // 只有世界真正推进的 step 累加世界时钟
          Rules.step(this.buildInputs());
          this.world.stepFx(step);
        }
      }
      clearEdges(this.pad);
    }
    if (n === C.sim.maxSteps) this.acc = 0;

    this.drain();
    const animT = (R.state === "RALLY" || R.state === "POINT" || R.state === "SERVE") ? this.worldT : this.frameT;
    this.world.render(R.players, R.ball, Math.min(1, this.acc / step), animT, Career.skinOf("shuttle"), R.rally);
    // 画布内世界提示(落点圈/训练时机条/拍数徽标/赛点旗标,老 hud.js)
    this.world.hudOverlay.draw(R, this.world.frameT);
  }

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
        this.stopFrames = C.fx.hitstopWhiff || 1;
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
  private drain(): void {
    const R = Rules.R;
    for (const e of R.events) {
      switch (e.t) {
        case "hit": {
          const smash = e.kind === "smash";
          const sweet = !!e.sweet, perfect = !!e.perfect;
          // 六档打击阶梯(hitstop + 震屏;镜头 punch/慢动作留给表现层打磨)
          this.stopFrames = (perfect && smash) ? (C.fx.hitstopPerfectSmash || 11)
            : perfect ? (C.fx.hitstopPerfect || 7)
            : (smash && sweet) ? (C.fx.hitstopSweetSmash || 9)
            : smash ? (C.fx.hitstopSmash || 7)
            : sweet ? (C.fx.hitstopSweet || 5)
            : (C.fx.hitstopNormal || 2);
          this.world.shake((perfect && smash) ? (C.fx.shakePerfectSmash || 18)
            : perfect ? (C.fx.shakePerfect || 9)
            : (smash && sweet) ? (C.fx.shakeSweetSmash || 15)
            : smash ? (C.fx.shakeSmash || 12)
            : sweet ? (C.fx.shakeSweet || 6)
            : (C.fx.shakeNormal || 2) + (e.q as number) * 1.5);
          this.sfx.hit(e.q as number, e.kind as string, sweet, perfect);
          this.bgm.onHit({ rally: R.rally, kind: e.kind as string, q: e.q as number, sweet, perfect, intoNet: !!e.intoNet });
          if (smash) this.sfx.play("smash");

          // 打击粒子特效
          if (smash) {
            const ang = (e.side === "left") ? 0.6 : 2.5;
            this.world.fx.smash(e.x as number, e.y as number, ang);
            this.world.fx.feather(e.x as number, e.y as number, 4);
          }
          if (sweet || perfect) {
            this.world.fx.sweet(e.x as number, e.y as number);
          }

          // 夸奖只给真人:喂球那拍不飘字(判据可信度)
          const praise = !(R.mode === "drill" && e.side === "right");
          if (praise) {
            if (perfect && smash) this.world.float(e.x as number, (e.y as number) - 32, "完美重扣!!", "#ffe14d", 30, 56);
            else if (perfect) this.world.float(e.x as number, (e.y as number) - 30, "✦ PERFECT ✦", "#00f0ff", 24, 50);
            else if (smash && sweet) this.world.float(e.x as number, (e.y as number) - 30, "黄金重扣!!", "#ffe14d", 28, 52);
            else if (smash) this.world.float(e.x as number, (e.y as number) - 28, "扣杀!!", "#ffe14d", 26, 48);
            else if (sweet) this.world.float(e.x as number, (e.y as number) - 26, "✦ SWEET! ✦", "#ffe14d", 20, 42);
            else if ((e.q as number) > 0.86) this.world.float(e.x as number, (e.y as number) - 24, "好球", "#ffffff", 16, 34);
          }
          // 放网提示 + 球种标签:非扣杀类技术球一闪即逝的类型提示(老 game.js#L308-313)
          if (e.kind === "netshot") this.world.float(e.x as number, (e.y as number) - 22, "放网", "#cfe0ff", 13, 28);
          if (praise && e.kind !== "smash") {
            const lblMap: Record<string, string> = { drive: "shotLabelDrive", lob: "shotLabelLob", slash: "shotLabelSlash", clear: "shotLabelClear" };
            const lbl = (C.fx as unknown as Record<string, { text: string; color: string; size: number; life: number }>)[lblMap[e.kind as string] ?? ""];
            if (lbl) this.world.float(e.x as number, (e.y as number) - 22, lbl.text, lbl.color, lbl.size, lbl.life);
          }
          // 多拍相持里程碑爽点反馈(老 game.js#L314-322;emoji 换 BMP 安全符号)
          if (e.rally === 6) this.world.float(C.world.w / 2, 72, "★ 6 拍激烈相持! ★", "#ffe14d", 18, 38);
          else if (e.rally === 10) this.world.float(C.world.w / 2, 72, "★ 10 拍巅峰对攻!! ★", "#ff6a1f", 22, 46);
          else if (e.rally === 15) this.world.float(C.world.w / 2, 72, "★ 15 拍神仙之战!!! ★", "#00f0ff", 24, 52);
          if (e.timingHint) {
            this.world.float(e.x as number, (e.y as number) - 44, e.timingHint === "early" ? "早了!" : "晚了!", "#ff9664", 14, 36);
          }
          // 表情:扣杀凶相 / 完美星眼 / 下网冒汗(训练场喂球机不做人,不给它表情)
          const hitterIdx = e.idx as number;
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
          this.stopFrames = 2;
          this.world.shake(1.6);
          if (e.type === "flick") this.world.float(C.world.w / 2, 60, "偷后场!", "#ffd48a", 16, 36);
          else if (e.type === "clear") this.world.float(C.world.w / 2, 60, "高远发球", "#c0d8ff", 16, 36);
          break;
        }
        case "net":
          this.sfx.play("net");
          this.world.shake(3);
          this.stopFrames = 4;
          this.world.hitNet(e.y as number, 1.2);
          this.world.fx.feather(C.court.netX, e.y as number, 3);
          this.world.float(C.court.netX, (e.y as number) - 30, "下网", "#ff8a8a", 20, 46);
          this.faceSide(e.side as string, "oops", 50);
          break;
        case "let":
          this.sfx.cheer(0.5);
          this.world.hitNet(C.court.netTopY, 0.8);
          this.world.float(C.court.netX, C.court.netTopY - 40, "擦网!", C.colors.accent, 22, 52);
          this.faceSide(e.side as string, "wow", 40);
          break;
        case "land": {
          this.sfx.floor(e.isSmash ? 1.5 : 0.9);
          this.world.shake(e.isSmash ? (C.fx.shakeLandSmash || 7) : e.out ? 2 : 3);
          this.world.fx.land(e.x as number, e.y as number, !e.out);
          this.world.float(e.x as number, (e.y as number) - 46, e.out ? "出界" : "落地", e.out ? "#ff6b6b" : "#d8ffb0", 16, 38);
          break;
        }
        // ---------- 训练场:每一球结束 ----------
        case "drill-end": {
          const before = Drill.prog().valid;
          Drill.onEnd(e as never);
          const p = Drill.prog();
          if (p.valid > before) {
            const g = Drill.cur()?.goal || C.drill.defaultGoal;
            this.world.float(e.landX as number, C.court.groundY - 74, `有效 +1 · ${Math.min(p.valid, g)}/${g}`, C.colors.accent, 22, 52);
            this.sfx.score(true);
          } else if (p.attempts > 0 && e.lastHitter === "left") {
            this.world.float(e.landX as number, C.court.groundY - 60, e.netted ? "下网了" : e.reason === "出界" ? "出界了" : "不是这一关的球", "#ffaaa0", 15, 38);
          }
          // 表情:这一球练成了开心,练砸了沮丧(只给左侧练习者,喂球机不变脸)
          this.faceSide("left", p.valid > before ? "happy" : "sad", 70);
          if (p.done) this.finishDrill();
          break;
        }
        case "score":
          this.sfx.score(true);
          this.bgm.onScore();
          if ((e.score as number[])[0] + (e.score as number[])[1] > 4) this.sfx.cheer(0.4);
          // CPU 人格化:得分/失分触发情绪动作
          for (const p of R.players) if (p.isAI) AI.onScore(p, p.side === e.side);
          // 表情:得分方开心、丢分方沮丧(整队同变,90 帧覆盖得分停顿)
          this.faceSide(e.side as string, "happy", 90);
          this.faceSide(e.side === "left" ? "right" : "left", "sad", 90);
          break;
        case "deuce":
          this.world.float(C.world.w / 2, C.world.h / 2 - 40, "平分! DEUCE", "#ff6b9d", 32, 90);
          this.sfx.cheer(0.8);
          this.bgm.onDeuce();
          break;
        case "match-over": {
          const youWon = R.mode === "1p" ? e.winner === "left" : true;
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
            this.world.float(C.world.w / 2, C.world.h / 2 - 8,
              youWon ? `胜利! 金币 +${res.coin} · 经验 +${res.exp}` : `惜败 · 金币 +${res.coin}`,
              youWon ? "#ffe14d" : "#d8e2ff", 20, 120);
          }
          break;
        }
        case "point-start":
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
    this.world.float(C.world.w / 2, C.world.h / 2 - 8,
      `训练完成 ★${res.stars} · 金币 +${reward?.coin ?? 0}`, C.colors.accent, 22, 150);
  }
}
