// ============================================================
// 背景音乐播放适配层:烘焙产物(assets/resources/audio/bgm/*.wav)的
// 加载与场景切换。老运行时是 WebAudio 现场自适应合成(分层强度随 rally
// 生长、击球爬音阶),Cocos 版把和弦进程 + 鼓点律动离线烘焙成两条
// 无缝循环 WAV(menu/game),由 AudioSource 循环播放;分层强度档位
// 数值保留在 config.bgm 供后续事件化扩展。
// 对外:playMenu / playGame / stop / setMute / setDuck(暂停下潜)。
// ============================================================
import { AudioClip, AudioSource, Node, resources } from "cc";
import { CFG } from "../core/config";

type Track = "menu" | "game";

export class BgmManager {
  private src: AudioSource | null = null;
  private clips = new Map<string, AudioClip>();
  private current: Track | null = null;
  private muted = false;
  private ducked = false;
  // BGM 相对总线音量(对照 config.bgm.volume);下潜时降到 25%
  private readonly baseVolume = CFG.bgm.volume;
  private readonly duckVolume = CFG.bgm.volume * 0.25;

  /** 异步加载;未就绪时播放调用静默丢弃(BGM 不该弄挂游戏) */
  load(node: Node, done?: () => void): void {
    this.src = node.addComponent(AudioSource);
    resources.loadDir("audio/bgm", AudioClip, (err, clips) => {
      if (!err) for (const c of clips) this.clips.set(c.name, c);
      done && done();
    });
  }

  get ready(): boolean { return this.clips.size > 0; }

  playMenu(): void { this.switch("menu"); }
  playGame(): void { this.switch("game"); }

  stop(): void {
    if (this.src) this.src.stop();
    this.current = null;
  }

  setMute(m: boolean): void {
    this.muted = m;
    if (!this.src) return;
    if (m) {
      this.src.stop();           // 静音:停播但记着当前曲目,取消静音时恢复
    } else if (this.current) {
      // 取消静音:current 仍是上次曲目,直接重启(不经过 switch 的同曲短路)
      const clip = this.clips.get(`bgm_${this.current}`);
      if (clip) {
        this.src.clip = clip;
        this.src.loop = true;
        this.src.volume = this.targetVolume();
        this.src.play();
      }
    }
  }

  /** 暂停时下潜:不停止,音量降到 duckVolume,恢复时回 baseVolume */
  setDuck(d: boolean): void {
    this.ducked = d;
    if (this.src) this.src.volume = this.targetVolume();
  }

  get isMuted(): boolean { return this.muted; }

  // ---------- 内部 ----------
  private switch(track: Track): void {
    if (this.muted) { this.current = track; return; }   // 静音时只记意图,恢复即放这首
    if (this.current === track) return;                 // 同曲不重启,避免断流
    const clip = this.clips.get(`bgm_${track}`);
    if (!clip || !this.src) return;
    // 切歌:停旧的再起,避免叠音
    this.src.stop();
    this.src.clip = clip;
    this.src.loop = true;
    this.src.volume = this.targetVolume();
    this.current = track;
    this.src.play();
  }

  private targetVolume(): number {
    return this.ducked ? this.duckVolume : this.baseVolume;
  }
}
