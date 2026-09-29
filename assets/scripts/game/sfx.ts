// ============================================================
// 音效播放适配层:烘焙产物(assets/resources/audio/sfx/*.wav)的
// 加载与事件参数 → 音色文件的映射。老运行时是连续参数实时合成,
// 烘焙版把连续参数离散成有限变体(见 tools/bake-audio.ts 的规格):
//   hit  → hot(扣杀/劈吊音头) × (普通/好球/甜蜜/完美) 8 变体
//   floor → 力度 0.5/1.0/1.5 三档取最近
//   cheer → 大小 0.4/0.7/1.0 三档取最近
// ============================================================
import { AudioClip, AudioSource, Node, resources } from "cc";
import { Settings } from "../core/settings";

const NAMES = [
  "swing", "whiff",
  "hit_n", "hit_n86", "hit_nsweet", "hit_nperfect",
  "hit_hot", "hit_hot86", "hit_hotsweet", "hit_hotperfect",
  "smash", "net",
  "floor_05", "floor_10", "floor_15",
  "jump", "lunge", "whistle",
  "score_good", "cheer_04", "cheer_07", "cheer_10",
  "win", "lose", "ui", "back", "coin", "buy", "levelup",
];

const nearest = (v: number, opts: number[]): number =>
  opts.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), opts[0]);

export class Sfx {
  private src: AudioSource | null = null;
  private clips = new Map<string, AudioClip>();

  /** 异步加载;未就绪时 play 静默丢弃(音效不该弄挂游戏) */
  load(node: Node, done?: () => void): void {
    this.src = node.addComponent(AudioSource);
    resources.loadDir("audio/sfx", AudioClip, (err, clips) => {
      if (!err) for (const c of clips) this.clips.set(c.name, c);
      done && done();
    });
  }

  get ready(): boolean { return this.clips.size > 0; }

  /**
   * 开关与音量都读 Settings:GameRoot 和 UIManager 各持一份 Sfx 实例,
   * 谁也不该有自己的静音状态(以前各自一个 muted 字段,菜单切了比赛照响)。
   */
  play(name: string, volume = 1): void {
    if (!Settings.sfxOn) return;
    const clip = this.clips.get(name);
    if (clip && this.src) this.src.playOneShot(clip, volume * Settings.sfxVol);
  }

  // ---------- 语义化入口(与老 game.js 的 Audio.play 调用点一一对应) ----------

  hit(q: number, kind: string, sweet: boolean, perfect: boolean): void {
    const hot = kind === "smash" || kind === "slash";
    const grade = perfect ? "perfect" : sweet ? "sweet" : q >= 0.86 ? "86" : "";
    this.play(`hit_${hot ? "hot" : "n"}${grade}`, 1);
  }

  floor(hard: number): void {
    const step = nearest(hard, [0.5, 1.0, 1.5]);
    this.play(`floor_${String(step).replace(".", "").padEnd(2, "0").slice(0, 2)}`, 1);
  }

  cheer(big: number): void {
    const b = nearest(big, [0.4, 0.7, 1.0]);
    this.play(`cheer_${String(b).replace(".", "")}`, 1);
  }

  score(_good = true): void { this.play("score_good"); }
}
