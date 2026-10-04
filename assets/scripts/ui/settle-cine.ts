// ============================================================
// 结算谢幕演出时间轴(零 cc 纯函数;settle-panel 照它演,check 工具钉它)
//
// 为什么单拎一个模块:入场演出是「按了没反应」的反面 —— 坏了不崩、不报错,
// 只会安静地不好看;而胜负两条路径一旦写岔(比如随手把失败也接上斜带),没有任何
// 编译器或运行时报错会拦。所以时间轴从 CFG.fx.settleCine 烘成一份类型化计划,
// settle-panel 只照计划摆 tween,tools/settle-cine-check.ts 断言:
//   · 胜负真的分化(斜带/星芒仅胜利,冷 veil 仅失败,标语 slam≠descend,卡片 pop≠sink);
//   · 时间不打架(暗幕升起不晚于卡片、标语沉完卡片才到、总时长不超防拖沓红线);
//   · 训练模式不出仪式(重开频繁,走旧的快速入场)。
// 数值只进 config.ts 的 fx.settleCine 段 —— 这里只做组合与派生(如 DEFEAT 的
// 起沉点 = beatLose − verdictDescend),不藏任何魔法数。
// ============================================================
import { CFG } from "../core/config";

/** 暗幕升起:delay 后用 dur 匀速压上来(训练模式 delay=dur=0,一步到位) */
export interface CineDim { delay: number; dur: number }

/** 胜利限定:金红斜带从左扫到右(三带错相位) */
export interface CineBands {
  at: number;            // 第一带起扫时刻(s)
  dur: number;           // 单带扫完全程用时(s)
  colors: string[];      // 带色(与 slashCutin 同源的 P5 红黑金)
  alpha: number;         // 带峰值 alpha(衬底不糊场)
  thick: number;         // 带厚 px
  skewK: number;         // 端帽斜率(与 slashWipe 同款)
  stagger: number;       // 相邻带错相位(s)
}

/** 胜利限定:标语落定瞬间的星芒爆(画在 cine 层底,光刺从标语衬纸四周探出来) */
export interface CineBurst { at: number; r: number; points: number }

/** 失败限定:冷色 veil 叠在暗幕上缓缓压下(比胜利更深更冷) */
export interface CineVeil { at: number; dur: number; hex: string; centerA: number; edgeA: number }

/** 标语演出:胜利砸落(backOut 弹性),失败缓沉(quadIn 加速下坠,无弹跳) */
export interface CineVerdict { at: number; mode: "slam" | "descend"; dur: number }

/** 卡片入场:胜利弹入(scale backOut + 轻震),失败沉重浮现(淡入 + 缓沉,无弹性) */
export interface CineCard {
  at: number;            // 卡片开始入场的时刻(s)
  mode: "pop" | "sink";
  dur: number;
  shakeAmp: number;      // 砸落轻震幅度 px(失败恒 0)
  shakeDur: number;
}

export interface CinePlan {
  won: boolean;
  /** false = 训练模式:不出仪式,dim 一步到位、卡片按旧 0.28s 弹入 */
  cinematic: boolean;
  dim: CineDim;
  bands: CineBands | null;
  burst: CineBurst | null;
  veil: CineVeil | null;
  verdict: CineVerdict;
  card: CineCard;
  /** 内容逐行浮现阶梯(s;0 = 全部随卡片一起出现,即旧行为) */
  rows: number;
}

/**
 * 烘一份入场计划。
 * @param won 本局胜负(2p 友谊赛恒 true)
 * @param match 比赛模式才出仪式;训练场结算(kind "drill")重开频繁,保持旧快速入场
 */
export function buildCine(won: boolean, match: boolean): CinePlan {
  const S = CFG.fx.settleCine;
  if (!match) {
    return {
      won, cinematic: false,
      dim: { delay: 0, dur: 0 },
      bands: null, burst: null, veil: null,
      verdict: { at: 0.16, mode: "slam", dur: 0.32 },
      card: { at: 0, mode: "pop", dur: 0.28, shakeAmp: 0, shakeDur: 0 },
      rows: 0,
    };
  }
  if (won) {
    return {
      won, cinematic: true,
      dim: { delay: S.dimDelayWin, dur: S.dimDurWin },
      // 斜带在暗幕升到一半时起扫:球场还看得见时带子先进场,卡片落地前扫完主段
      bands: {
        at: S.dimDelayWin + S.dimDurWin * 0.5,
        dur: S.bandsDur, colors: S.bandsColors.slice(), alpha: S.bandsAlpha,
        thick: S.bandsThick, skewK: S.bandsSkewK, stagger: S.bandsStagger,
      },
      burst: { at: S.beatWin, r: S.burstR, points: S.burstPoints },
      veil: null,
      verdict: { at: S.beatWin, mode: "slam", dur: 0.32 },
      card: { at: S.beatWin, mode: "pop", dur: 0.3, shakeAmp: S.cardShakeAmp, shakeDur: S.cardShakeDur },
      rows: S.rowStagger,
    };
  }
  return {
    won, cinematic: true,
    dim: { delay: S.dimDelayLose, dur: S.dimDurLose },
    bands: null, burst: null,
    veil: {
      at: S.dimDelayLose, dur: S.dimDurLose,
      hex: S.loseVeilHex, centerA: S.loseVeilCenter, edgeA: S.loseVeilEdge,
    },
    // DEFEAT 从 beatLose − verdictDescend 起沉,标语沉完的那一帧卡片正好浮上来
    verdict: { at: S.beatLose - S.verdictDescend, mode: "descend", dur: S.verdictDescend },
    card: { at: S.beatLose, mode: "sink", dur: S.cardSinkDur, shakeAmp: 0, shakeDur: 0 },
    rows: S.rowStagger,
  };
}
