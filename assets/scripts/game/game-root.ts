// ============================================================
// 主循环组件(挂到 Canvas 上,阶段 2 唯一需要在编辑器里手动操作的节点)
// 固定步长 60Hz 模拟 + 渲染插值 + 事件分发,与老 game.js 同构:
//   acc += dt;while (acc >= step) { 模拟一步;清输入边沿 }
// 事件只从 Rules.R.events 取,分发给音效/飘字/震屏 —— 表现层依旧不进逻辑。
// 菜单/结算完整 UI 是阶段 3;本组件先直进一局「单人 · 普通」。
// ============================================================
import { _decorator, Color, Component, Label, Layers, Node, UITransform } from "cc";
import { CFG } from "../core/config";
import { load, save } from "../core/utils";
import { Rules } from "../core/rules";
import { AI } from "../core/ai";
import { Drill } from "../core/drill";
import { Career } from "../core/career";
import { Ball, PlayerInput } from "../core/types";
import { WorldView } from "../render/world";
import { newPad, clearEdges, buildIntent, emptyIntent, Pad } from "../input/pad";
import { bindKeyboard } from "../input/keyboard";
import { buildTouchPad } from "../input/touchpad";
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
  private scoreLabel!: Label;
  private stateLabel!: Label;

  private acc = 0;
  private worldT = 0;
  private frameT = 0;
  private stopFrames = 0;      // hitstop:世界定格的剩余步数(老 FX.stop 的精简版)
  private prevBgmState = "";

  start(): void {
    // ---------- 场景搭建 ----------
    this.world = new WorldView(this.node);
    this.buildHud();
    this.sfx.load(this.node);
    this.bgm.load(this.node, () => {
      if (Rules.R.state === "MENU") this.bgm.playMenu();
      else this.bgm.playGame();
    });

    // ---------- 输入 ----------
    bindKeyboard(this.pad, (code) => this.onSystemKey(code));
    if (C.mobileOnly) buildTouchPad(this.node, this.pad);   // 决策①:虚拟按键(编辑器里鼠标点按同样生效)

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

  // ---------- HUD ----------
  private buildHud(): void {
    const mk = (y: number, size: number): Label => {
      const n = new Node(`hud-${y}`);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform);
      n.setPosition(0, y, 0);
      const l = n.addComponent(Label);
      l.fontSize = size;
      l.lineHeight = Math.round(size * 1.2);
      l.horizontalAlign = 1;
      l.verticalAlign = 1;
      l.color = new Color(240, 244, 255, 255);
      n.setParent(this.node);
      return l;
    };
    this.scoreLabel = mk(236, 32);
    this.stateLabel = mk(196, 16);
    this.stateLabel.color = new Color(200, 212, 240, 200);
  }

  private syncHud(): void {
    const R = Rules.R;
    this.scoreLabel.string = `${R.scores[0]} : ${R.scores[1]}`;
    const mp = Rules.isMatchPoint();
    const info = Rules.matchPointInfo();
    this.stateLabel.string = R.mode === "drill"
      ? Drill.goalText()
      : R.state === "OVER"
      ? `${Rules.labelOf(R.winner ?? "left")} 获胜 · R 再来一局`
      : info.active
      ? info.label
      : R.state === "PAUSED" ? "已暂停 · Esc 继续" : "";
    this.scoreLabel.color = mp ? new Color(255, 225, 77, 255) : new Color(240, 244, 255, 255);
  }

  // ---------- 系统键(与老 onSystem 同名同义,先接最常用的三颗) ----------
  private onSystemKey(code: string): void {
    const R = Rules.R;
    if (code === "KeyM") {
      const m = !this.sfx.isMuted;
      this.sfx.setMuted(m);
      this.bgm.setMute(m);
      save("muted", m);
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
    this.frameT++;
    this.acc += Math.min(dt, 0.25);          // 切后台回来不追帧

    // BGM 状态跟踪
    if (R.state !== this.prevBgmState) {
      this.prevBgmState = R.state;
      if (R.state === "MENU") {
        this.bgm.setDuck(false);
        this.bgm.playMenu();
      } else if (R.state === "PAUSED") {
        this.bgm.setDuck(true);
      } else {
        this.bgm.setDuck(false);
        this.bgm.playGame();
      }
    }

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
    this.syncHud();
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
        this.world.fx.land(p.x, C.court.groundY, true);
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
            if (perfect && smash) this.world.float(e.x as number, (e.y as number) - 32, "⚡ 完美重扣!! ⚡", "#ffe14d", 30, 56);
            else if (perfect) this.world.float(e.x as number, (e.y as number) - 30, "✦ PERFECT ✦", "#00f0ff", 24, 50);
            else if (smash && sweet) this.world.float(e.x as number, (e.y as number) - 30, "⚡ 黄金重扣!! ⚡", "#ffe14d", 28, 52);
            else if (smash) this.world.float(e.x as number, (e.y as number) - 28, "⚡ 扣杀!! ⚡", "#ffe14d", 26, 48);
            else if (sweet) this.world.float(e.x as number, (e.y as number) - 26, "✦ SWEET! ✦", "#ffe14d", 20, 42);
            else if ((e.q as number) > 0.86) this.world.float(e.x as number, (e.y as number) - 24, "好球", "#ffffff", 16, 34);
          }
          if (e.timingHint) {
            this.world.float(e.x as number, (e.y as number) - 44, e.timingHint === "early" ? "早了!" : "晚了!", "#ff9664", 14, 36);
          }
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
          break;
        case "let":
          this.sfx.cheer(0.5);
          this.world.hitNet(C.court.netTopY, 0.8);
          this.world.float(C.court.netX, C.court.netTopY - 40, "擦网!", C.colors.accent, 22, 52);
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
          if (p.done) this.finishDrill();
          break;
        }
        case "score":
          this.sfx.score(true);
          if ((e.score as number[])[0] + (e.score as number[])[1] > 4) this.sfx.cheer(0.4);
          // CPU 人格化:得分/失分触发情绪动作
          for (const p of R.players) if (p.isAI) AI.onScore(p, p.side === e.side);
          break;
        case "deuce":
          this.world.float(C.world.w / 2, C.world.h / 2 - 40, "平分! DEUCE", "#ff6b9d", 32, 90);
          this.sfx.cheer(0.8);
          break;
        case "match-over": {
          const youWon = R.mode === "1p" ? e.winner === "left" : true;
          this.sfx.play(youWon ? "win" : "lose");
          this.sfx.cheer(1);
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
