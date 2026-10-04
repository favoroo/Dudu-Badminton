// ============
// 影分身驱动器 —— 「影分身」技能召唤物的逐帧驱动、接球计数与消散。
//
// 设计动机(2026-10-04):用户要求「召唤一个影分身,可以跟 AI 一样帮我接球,接完三个球
// 之后就消失;玩家自己仍可以击球,如果是玩家自己接球,就不消耗次数;一分之内只能释放一次」。
//
// 分身是挂在宿主身上的独立 Player 实体(p.shadowClone.entity),**刻意不进 RulesState.players**
// —— 发球轮转、计分名单、game-root 的 R.players[0]=真人假设都不许被第三名球员污染。
// 本模块只做三件事:
//   1. updateClones: AI.think 出输入 → 走 player.ts 的 update 全套机器(移动/挥拍),
//      幻影特性:与宿主自由穿透、零体积碰撞,互不影响移动;
//   2. tryCloneHit: rules 的实名球员 tryHit 循环全落空时,分身补位起拍(玩家永远优先);
//   3. noteHit: 分身命中才计数 —— 玩家自己接球不经过这里,天然不消耗次数。
//
// 分层:本模块 import config/ai/player/types,无任何模块反向 import 这里
// (rules → shadow → ai → rules 的环与既有 ai ↔ rules 同形,全部调用时解引用,安全)。
// ============

import { CFG } from "./config";
import { AI } from "./ai";
import { Player as Pl } from "./player";
import { Ball, Player, ShotResult } from "./types";

const C = CFG;
const SH = () => C.skills.shadow;

/**
 * 每帧驱动所有在场的影分身。rules.step 在实名球员 Pl.update 循环 + separate() 之后调用。
 * 演出期语义:成影期(spawnT)与消散期(despawnT)都不跑位不接球 —— 召唤不是无敌帧,
 * 演出期的来球归玩家;消散走完整个 shadowClone 清空(下次 resetPoint 兜底再清一次)。
 *
 * 穿透机制(2026-10-04 优化):影分身为无实体碰撞的纯黑剪影,与宿主/队友零体积碰撞、
 * 自由穿透,彼此移动互不影响(不调用 separate 物理推开)。
 */
export function updateClones(players: Player[], ball: Ball, state: string): void {
  for (const host of players) {
    const sc = host.shadowClone;
    if (!sc) continue;
    if (sc.despawnT > 0) {
      sc.despawnT--;
      if (sc.despawnT <= 0) host.shadowClone = undefined;
      continue;
    }
    if (sc.spawnT > 0) {
      sc.spawnT--;
      continue;
    }
    const clone = sc.entity;
    if (!clone.ai) AI.reset(clone); // 懒初始化 AI 状态:spawn 在 player.ts,那边 import ai 会成环
    const inp = AI.think(clone, ball, state);
    // 双保险剥键:分身 skill=undefined 已封死 activate,这里再把按键意图剥掉,
    // 防 AI 决策链未来加分支时把技能键漏进分身输入
    inp.skillPressed = false;
    inp.lungePressed = false;
    // 玩家优先(防分身抢拍):宿主正在挥拍期间(host.swingT >= 0),分身不主动起拍,
    // 这一拍优先交给真人兑现;分身只兜宿主未起拍或已挥空后的补位
    if (host.swingT >= 0) {
      inp.swingAim = null;
    }
    Pl.update(clone, inp, ball);
  }
}

/**
 * 分身补位起拍:rules.step 的实名球员 tryHit 循环本帧没打出去时调用(玩家永远优先)。
 * 成影期/消散期不接球;命中返回 {宿主, 出球},由 rules 走 applyShot 正常通道。
 */
export function tryCloneHit(players: Player[], ball: Ball): { host: Player; shot: ShotResult } | null {
  for (const host of players) {
    const sc = host.shadowClone;
    if (!sc || sc.spawnT > 0 || sc.despawnT > 0) continue;
    const shot = Pl.tryHit(sc.entity, ball);
    if (shot) return { host, shot };
  }
  return null;
}

/**
 * 分身命中记账(rules 在 applyShot 分身后调用):hits++ 到满额开消散演出。
 * 只有分身的命中走这里 —— 玩家自己接球不计数,这正是用户口径「如果是玩家自己接球,就不消耗次数」。
 */
export function noteHit(host: Player): void {
  const sc = host.shadowClone;
  if (!sc) return;
  sc.hits++;
  if (sc.hits >= SH().maxHits) {
    sc.despawnT = SH().despawnFrames; // 满额:原地消散,消散期 tryCloneHit 自动跳过
  }
}

export const Shadow = { updateClones, tryCloneHit, noteHit };
