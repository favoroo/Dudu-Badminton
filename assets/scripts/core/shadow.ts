// ============
// 影分身驱动器 —— 「影分身」技能召唤物的逐帧驱动、接球计数与消散。
//
// 设计动机(2026-10-04 上线):用户要求「召唤一个影分身,可以跟 AI 一样帮我接球,接完三个球
// 之后就消失;玩家自己仍可以击球,如果是玩家自己接球,就不消耗次数;一分之内只能释放一次」。
// 2026-10-05 按用户新口径改成**会累积的一条影子防线**:
//   · 同场最多 slots.length(=3)个,身份看 slot(颜色 / 防区 / AI 档全由它索引配置)
//   · 跨回合(一分)保留,不再被 resetPoint 散去;未耗尽额度的到下一分**补满回 3**
//   · 不跨对局、不落盘(重开新局仍由 rules 的 R.players = [] 整批丢弃)
//
// 分身是挂在宿主身上的独立 Player 实体(p.shadowClones[i].entity),**刻意不进 RulesState.players**
// —— 发球轮转、计分名单、game-root 的 R.players[0]=真人假设都不许被凭空多出的球员污染。
// 本模块只做四件事:
//   1. updateClones: AI.think 出输入 → 走 player.ts 的 update 全套机器(移动/挥拍);
//   2. 防区分工(dutyByZone):每来球只让**防区离落点最近的那枚可动分身**去追,其余守位 ——
//      不分工就是三坨黑剪影叠在同一个点上:颜色分辨不出来、9 份额度全砸在同一块地面、
//      另外两块照样丢。空出来的防区由最近邻补位(不该出现"网前那枚散了就没人管网前");
//   3. tryCloneHit: rules 的实名球员 tryHit 循环全落空时,分身补位起拍(玩家永远优先);
//   4. noteHit(host, slot): **分身命中才计数**,而且必须按 slot 定位 —— 多实例之后不带 slot
//      就是恒记 0 号账(静默错账:紫的接球、青的掉额度)。
//
// 幻影特性:与宿主/队友自由穿透、零体积碰撞(不进 R.players ⇒ separate() 天然推不到)。
//
// 分层:本模块 import config/ai/player/types/shadow-gate,无任何模块反向 import 这里
// (rules → shadow → ai → rules 的环与既有 ai ↔ rules 同形,全部调用时解引用,安全)。
// ============

import { CFG } from "./config";
import { AI } from "./ai";
import { Player as Pl } from "./player";
import { ShadowGate } from "./shadow-gate";
import { Ball, Player, ShotResult, ShadowCloneState, TeamSide } from "./types";

const C = CFG;
const SH = () => C.skills.shadow;

/** 这一号分身的防守锚点(右队镜像取反)。边界不另写一份:归属判据就是"离谁最近" */
function slotHomeX(side: TeamSide, slot: number): number {
  const off = SH().slots[slot].homeOffset;
  return C.court.netX + (side === "left" ? off : -off);
}

/**
 * 落点读数:对手刚出手那一拍 `ball.shot.landX` 就是预测落点(rules.applyShot 每记击球换新对象),
 * 没有就退回球的当前 x(贴地球/被吸住的球之类)。
 */
function dutyTargetX(ball: Ball): number {
  const land = ball.shot ? ball.shot.landX : undefined;
  return land === undefined || !isFinite(land) ? ball.x : land;
}

/**
 * 当值分身:在**可动**(成影与消散演出都走完)的那几枚里,挑防区离落点最近的**一个**。
 * 返回数组下标,-1 = 没有可动的分身。
 *
 * "最近"而不是"落在哪一段":相邻 homeX 的中点自动就是分段边界,所以"离谁最近"与"切三段"
 * 是同一件事,却少抄一份阈值数字 —— 那份数字将来必与 slots[].homeOffset 分叉。
 * 等距离时按下标先后(数组恒按 slot 升序 ⇒ 低槽位优先,确定可重复)。
 */
function dutyIndexOf(host: Player, ball: Ball, arr: ShadowCloneState[]): number {
  const x = dutyTargetX(ball);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const sc = arr[i];
    if (sc.spawnT > 0 || sc.despawnT > 0) continue;
    const d = Math.abs(slotHomeX(host.side, sc.slot) - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 每帧驱动所有在场的影分身。rules.step 在实名球员 Pl.update 循环 + separate() 之后调用。
 * 演出期语义:成影期(spawnT)与消散期(despawnT)都不跑位不接球 —— 召唤不是无敌帧,
 * 演出期的来球归玩家;消散走完**从数组里摘掉**(跨回合保留之后不能只清那一个字段)。
 *
 * 遍历**倒序**:摘元素用 splice,正序遍历会跳过后一个(症状是"某个分身慢一帧",不崩不报错)。
 */
export function updateClones(players: Player[], ball: Ball, state: string): void {
  // 第二道保险:模式不合格就不驱动(实体本来也进不来,防将来出现"绕过 canActivate 直接 spawn"的路径)
  if (!ShadowGate.on) return;
  const S = SH();
  for (const host of players) {
    const arr = host.shadowClones;
    if (!arr || !arr.length) continue;
    // 当值判定**只对着来球做**:球不是朝我方来的(我方刚打出去/被握着/死球)时不选岗,
    // 三枚一律走 AI.think —— 它在非来球分支里就是把 targetX 设回 homeX(回位),与守位同一条路。
    // 少了这道闸会出现:"我方把球打回对方半场之后,网前那枚按 landX 被点去当值,于是追着
    // 一颗已经属于对手的球跑向网口"(实测位移 22px,判据 ⑬ 的对照组因此量歪)。
    const incoming = ball.live && !ball.held && ball.lastHitter !== host.side;
    // 走 Shadow.dutyIndex 而不是本地闭包:反例要把这一格换掉(stackingClones),
    // 本地调用 patch 不到 —— 与 player.ts 把 autoSwingDue 挂上导出面同一条理由。
    const duty = S.dutyByZone && incoming ? Shadow.dutyIndex(host, ball, arr) : -2;  // -2 = 不分岗,全都自己跑
    for (let i = arr.length - 1; i >= 0; i--) {
      const sc = arr[i];
      if (sc.refillT > 0) sc.refillT--;   // 补满亮片只是读数,倒计时归它自己走完
      if (sc.despawnT > 0) {
        sc.despawnT--;
        if (sc.despawnT <= 0) arr.splice(i, 1);
        continue;
      }
      if (sc.spawnT > 0) {
        sc.spawnT--;
        continue;
      }
      const clone = sc.entity;
      if (!clone.ai) AI.reset(clone); // 懒初始化 AI 状态:spawn 在 player.ts,那边 import ai 会成环
      if (duty >= 0 && i !== duty) {
        // 不当值:守自己的防区。走同一套 Pl.update(有重力、有步频、有收拍),只把意图换成"回位"。
        // 到位判据取 12px(照 ai.ts POINT 分支那三行的粗度,那处是 24;收紧是因为分身要"站桩给人
        // 看颜色",散得开才分得出三色)。**必须带刹车**:地面摩擦 0.78 不会立刻停,到位后还在往
        // 界外飘就得反按一把 —— 否则它会围着 homeX 左右互搏(实测摆幅 ±22px,读成"影子自己乱晃")。
        const dx = clone.homeX - clone.x;
        const near = Math.abs(dx) < 12;
        const braking = near && dx * clone.vx < 0 && Math.abs(clone.vx) > 0.8;
        const toward = dx < 0 ? "left" : dx > 0 ? "right" : "";
        const go = near ? (braking ? (clone.vx > 0 ? "left" : "right") : "") : toward;
        Pl.update(clone, {
          left: go === "left", right: go === "right",
          jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
        }, ball);
        continue;
      }
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
}

/**
 * 分身补位起拍:rules.step 的实名球员 tryHit 循环本帧没打出去时调用(玩家永远优先)。
 * 成影期/消散期不接球;命中返回 {宿主, 槽位, 出球},由 rules 走 applyShot 正常通道。
 * 数组恒按 slot 升序 ⇒ 两枚同时够得着时低槽位那枚拿到这一拍(确定,回归量得出)。
 */
export function tryCloneHit(
  players: Player[], ball: Ball,
): { host: Player; slot: number; shot: ShotResult } | null {
  for (const host of players) {
    for (const sc of ShadowGate.clonesOf(host)) {
      if (sc.spawnT > 0 || sc.despawnT > 0) continue;
      const shot = Pl.tryHit(sc.entity, ball);
      if (shot) return { host, slot: sc.slot, shot };
    }
  }
  return null;
}

/**
 * 分身命中记账(rules 在 applyShot 分身后调用):hits++ 到满额开消散演出。
 * 只有分身的命中走这里 —— 玩家自己接球不计数,这正是用户口径「如果是玩家自己接球,就不消耗次数」。
 *
 * **slot 必传**:旧签名靠单实例不用定位,多实例之后不带 slot 就是恒记 0 号账 ——
 * 不崩、不报错、tsc 也不报,只是"紫的接球、青的掉额度",三组亮片全对不上。
 */
export function noteHit(host: Player, slot: number): void {
  const S = SH();
  for (const sc of ShadowGate.clonesOf(host)) {
    if (sc.slot !== slot) continue;
    sc.hits++;
    if (sc.hits >= S.maxHits) {
      sc.despawnT = S.despawnFrames; // 满额:原地消散,消散期 tryCloneHit 自动跳过,且下一分不补满
    }
    return;
  }
}

export const Shadow = { updateClones, tryCloneHit, noteHit, dutyIndex: dutyIndexOf };
