// ============================================================
// 自适应背景音乐编排层(对照 嘟嘟02/src/bgm.js)
// 原版是 WebAudio 现场分层合成 + 事件音乐化,Cocos 三端无可靠实时
// 合成,改为离线烘焙的循环 stem(bgm_groove/drums/arp/lead/tamb/menu)
// + 事件 one-shot(pluck/stab/deuce_sting/win_jingle/...)由多 AudioSource
// 编排:分层强度随 rally 生长(层 gain 平滑淡入,回合内音乐永不重启),
// 击球在五声音阶爬一颗拨弦(量化到 16 分网格),得分落和弦重音,平分/
// 终局有专属音型。网格量化用 performance.now() 近似(无音频时钟,差几十 ms)。
// ============================================================
import { AudioClip, AudioSource, Node, resources } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";

const BPM = CFG.bgm.bpm;
const STEP = 15 / BPM;                 // 16 分音符时长(秒)
const STEP_MS = STEP * 1000;
const SCALE_LEN = 11;                  // A 小调五声两八度(与 bake-audio.ts SCALE 同长)
const pad2 = (i: number): string => String(i).padStart(2, "0");

type StemKey = "menu" | "groove" | "drums" | "arp" | "lead" | "tamb";
const STEMS: StemKey[] = ["menu", "groove", "drums", "arp", "lead", "tamb"];
const GAME_STEMS: StemKey[] = ["groove", "drums", "arp", "lead", "tamb"];

/** 击球事件载荷(对照 bgm.js onHit 的 e) */
export interface HitInfo {
  rally: number;
  kind: string;
  q: number;
  sweet: boolean;
  perfect: boolean;
  intoNet: boolean;
}

export class BgmManager {
  private src: Record<StemKey, AudioSource> = {} as Record<StemKey, AudioSource>;
  private sfxBus: AudioSource | null = null;
  private clips = new Map<string, AudioClip>();
  private on: Record<StemKey, boolean> = { menu: false, groove: false, drums: false, arp: false, lead: false, tamb: false };
  private cur: Record<StemKey, number> = { menu: 0, groove: 0, drums: 0, arp: 0, lead: 0, tamb: 0 };
  private target: Record<StemKey, number> = { menu: 0, groove: 0, drums: 0, arp: 0, lead: 0, tamb: 0 };

  // 音乐总线开关/音量读 Settings(见 applyTargets 与 shot),本类不再有私有状态
  private ducked = false;
  private scene: "menu" | "game" | "over" = "menu";
  private prevScene = "";
  private lvl = 1;
  private mp = false;
  private deuce = false;

  private t0 = 0;          // 网格量化锚点(performance.now(),game 进入时重置对齐 stem 相位)
  private prevNow = 0;

  get ready(): boolean { return this.clips.size > 0; }

  /** 异步加载:建子节点树(AudioSource 一节点一个),装载 bgm 目录全部 clip */
  load(node: Node, done?: () => void): void {
    for (const k of STEMS) {
      const child = new Node(`bgm_${k}`);
      node.addChild(child);
      this.src[k] = child.addComponent(AudioSource);
    }
    const sfxNode = new Node("bgm_sfx");
    node.addChild(sfxNode);
    this.sfxBus = sfxNode.addComponent(AudioSource);
    resources.loadDir("audio/bgm", AudioClip, (err, clips) => {
      if (!err) for (const c of clips) this.clips.set(c.name, c);
      done && done();
    });
  }

  // ---------- 每帧观察比赛状态(对照 bgm.js update) ----------
  update(R: { state: string; rally: number; deuce: boolean }, matchPoint: boolean): void {
    if (!this.ready) return;
    const now = performance.now();
    const dt = this.prevNow ? Math.min(0.25, (now - this.prevNow) / 1000) : 0.016;
    this.prevNow = now;

    const scene = R.state === "OVER" ? "over"
      : (CFG.screens as string[]).includes(R.state) ? "menu" : "game";
    this.lvl = scene === "game"
      ? 2 + (R.rally >= CFG.bgm.rallyArp ? 1 : 0) + (R.rally >= CFG.bgm.rallyLead ? 1 : 0)
      : 1;
    this.mp = !!matchPoint && scene === "game";
    this.deuce = !!R.deuce && scene === "game";
    this.ducked = R.state === "PAUSED";

    if (scene !== this.prevScene) {
      this.onSceneChange(scene);
      this.prevScene = scene;
    }
    this.scene = scene as "menu" | "game" | "over";
    this.applyTargets();
    this.lerpVolumes(dt);
  }

  /** 场景切换:停所有 stem,起对应层(game 进入时重置网格锚点对齐 stem 相位) */
  private onSceneChange(scene: string): void {
    for (const k of STEMS) {
      if (this.on[k]) { this.src[k].stop(); this.on[k] = false; this.cur[k] = 0; }
    }
    if (scene === "menu") {
      this.startStem("menu");
    } else if (scene === "game") {
      this.t0 = performance.now();
      for (const k of GAME_STEMS) this.startStem(k);
    }
    // over: 不起 stem,让终局 jingle 独响后静默
  }

  private startStem(k: StemKey): void {
    const clip = this.clips.get(`bgm_${k}`);
    const src = this.src[k];
    if (!clip || !src) return;
    src.clip = clip;
    src.loop = true;
    src.volume = 0;
    src.play();
    this.on[k] = true;
    this.cur[k] = 0;
  }

  /** 目标层音量 = 想要的强度 × 总线(总线 = 设置里的音乐开关与音量) */
  private applyTargets(): void {
    // 静音仍走 lerpVolumes 的平滑淡出(保留 stem 相位),不要改成 stop()
    const vol = Settings.bgmOn ? CFG.bgm.volume * Settings.bgmVol : 0;
    const bus = this.ducked ? vol * 0.25 : vol;
    const g = this.scene === "game";
    const w: Record<StemKey, number> = {
      menu: this.scene === "menu" ? 1 : 0,
      groove: g ? 1 : 0,
      drums: g && this.lvl >= 2 ? 1 : 0,
      arp: g && this.lvl >= 3 ? 0.9 : 0,
      lead: g && this.lvl >= 4 ? 1 : 0,
      tamb: g && (this.mp || this.deuce) ? 1 : 0,
    };
    for (const k of STEMS) this.target[k] = w[k] * bus;
  }

  /** 平滑淡入淡出(时间常数 0.1s,对照 setTargetAtTime) */
  private lerpVolumes(dt: number): void {
    const a = 1 - Math.exp(-dt / 0.1);
    for (const k of STEMS) {
      this.cur[k] += (this.target[k] - this.cur[k]) * a;
      if (this.on[k]) this.src[k].volume = this.cur[k];
    }
  }

  // ---------- 事件音乐化(对照 bgm.js onHit/onScore/onDeuce/onMatchOver) ----------

  /** 击球 → 五声音阶爬升的拨弦(rally 越长音越高),量化到最近网格 */
  onHit(e: HitInfo): void {
    if (!this.ready || !Settings.bgmOn || this.scene !== "game") return;
    const now = performance.now();
    let n = Math.round((now - this.t0) / STEP_MS);
    if (this.t0 + n * STEP_MS < now + 20) n++;        // 离得太近顺延一拍,保证可调度
    const delay = Math.max(0, this.t0 + n * STEP_MS - now);
    const idx = Math.max(0, e.rally - 1) % SCALE_LEN;
    const smash = e.kind === "smash" || e.kind === "slash";
    const name = smash ? `smash_pluck_${pad2(idx)}` : `pluck_${pad2(idx)}`;
    const v = (e.q >= 0.86 ? 1.15 : 0.9) * CFG.bgm.accentVol;
    setTimeout(() => { if (this.scene === "game") this.shot(name, v); }, delay);
    // 完美/甜蜜:顶上加一颗泛光"闪光音符"
    if (e.perfect && !e.intoNet) setTimeout(() => { if (this.scene === "game") this.shot("perfect_shine", CFG.bgm.accentVol); }, delay);
    else if (e.sweet && !e.intoNet) setTimeout(() => { if (this.scene === "game") this.shot("sweet_shine", CFG.bgm.accentVol * 0.8); }, delay);
  }

  /** 得分 → 和弦重音落回网格 */
  onScore(): void {
    if (!this.ready || !Settings.bgmOn || this.scene !== "game") return;
    const now = performance.now();
    const n = Math.ceil((now + 20 - this.t0) / STEP_MS);
    const delay = Math.max(0, this.t0 + n * STEP_MS - now);
    setTimeout(() => { if (this.scene === "game") this.shot("stab", CFG.bgm.accentVol); }, delay);
  }

  /** 平分 → 上行紧张三连音(不量化,立即触发) */
  onDeuce(): void {
    if (!this.ready || !Settings.bgmOn) return;
    this.shot("deuce_sting", CFG.bgm.accentVol);
  }

  /** 终局 → 胜利 A 大调上行 / 失败下行叹息 */
  onMatchOver(won: boolean): void {
    if (!this.ready || !Settings.bgmOn) return;
    this.shot(won ? "win_jingle" : "lose_jingle", CFG.bgm.accentVol * 1.2);
  }

  private shot(name: string, vol: number): void {
    if (!Settings.bgmOn) return;
    const clip = this.clips.get(name);
    // 事件音型也挂在音乐总线的音量上,不然关了音量还能听见拨弦
    if (clip && this.sfxBus) this.sfxBus.playOneShot(clip, vol * Settings.bgmVol);
  }
}
