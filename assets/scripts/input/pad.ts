// ============================================================
// 输入意图合成:多个输入源(键盘 / 触屏虚拟按键 / 触屏虚拟摇杆)写同一张 Pad,
// 每个模拟步把它翻成 PlayerInput 后清边沿 —— 与老仓库 DD.Input 的
// isDown / justPressed / clearEdges 三件套同一套语义,只是平面化成对象。
//
// 跨步的方向不住在「跨步键」身上,而是从方向意图里现解:摇杆推多少就往哪走;
// 摇杆归零时沿用左右键;两者都没动才回落到「最近一次方向」。原先挂在方向键上的
// 双击判定已删除 —— 触屏上快速左右换向(对拉、追身球)会稳定凑成双击,
// 误触的代价还是一次带恢复期的爆发位移,比漏触更难受。
// ============================================================
import { CFG } from "../core/config";
import type { PlayerInput } from "../core/types";

/** 摇杆写入的最小步长:低于这个的抖动视作归零,避免手指微颤带来 vx 抖动 */
export const JOYSTICK_DEADZONE = 0.15;

export interface Pad {
  left: boolean;
  right: boolean;
  /**
   * 摇杆模拟量:-1..1。非零即生效(带死区),优先级高于 left/right;
   * 摇杆模式下 left/right 保持 false,让键盘与老按钮路径完全不受影响。
   */
  moveAxis: number;
  /**
   * 滑轨精准定位目标点(场地世界坐标 x,仅 slider 移动模式生效)。
   * 若有值,player.ts 将采用平滑定点刹停算法,精准落位于该点且无过冲。
   */
  targetX?: number;
  /** 按住 = 可变跳高的 held 语义(真实按住态,不含补的尾巴) */
  jump: boolean;
  /** 边沿:本步内刚按下(每步用后即清) */
  jumpPressed: boolean;
  /**
   * 本次按住已经过的**模拟步数**,由 tickHolds 维护。
   * 用它而不是挂钟来分「点一下」和「推住」:jumpApex / jumpCut 全是帧单位,
   * 挂钟在掉帧时会和手感对不上。
   */
  jumpSteps: number;
  /**
   * 「点跳」补的 held 尾巴:>0 时即便手指已离开也算按住。
   * 存在理由见 release() —— 不满一拍的松手会被 jumpCut 掐成几 px 的抽搐跳。
   */
  jumpTail: number;
  /** 跨步/击球键都是纯边沿语义:一次触发就是一个动作,没有「按住」状态 */
  lungePressed: boolean;
  /** 跨步方向:-1=向左, 1=向右(按下跨步键那一刻从方向意图解出) */
  lungeDir?: number;
  /** 最近一次方向键意图:-1=左, 1=右, 0=这局还没碰过方向键 */
  lastDir: number;
  /**
   * 击球键(合并版):触屏单击球按钮通过滑动手势区分深浅,键盘仍用 J/K 两键。
   * - swingPressed: 边沿,本步内刚按下 → 触发挥拍(每步用后即清)
   * - swingHeld:    真实按住态,松手时由 release 清除(手势跟踪需要)
   * - swingSwipe:  已提交方向:0=未提交(mid,物理自动决定),1=右滑(deep),-1=左滑(near)
   *   触屏在 TOUCH_MOVE 里提交;键盘路径(swingFar/swingNear)在 press 时即定 ±1。
   *   松手时不清零 —— 命中前一直保留,给 player.ts 在 tryHit 前读取。
   *   下一次按下/自动击打真打出去时,两轴会被**恢复成锁定值**(见 swingLockX):
   *   没锁 = 恢复成 0,与旧的「清零」逐位一致;有锁 = 沿用记忆。
   * - swingSwipeY: 纵轴,与 swingSwipe 独立可组合:0=未提交(弧线物理自动决定),
   *   1=上滑(挑高),-1=下滑(平抽)。提交/保留/恢复时机与 swingSwipe 完全同构。
   * - swingLockX / swingLockY: **长滑锁定**(参考和平精英长滑锁定端口):触屏长滑
   *   (touchAim.lockPx / lockPxY)把该轴方向锁成默认 —— 之后每一拍(手动按下、自动
   *   击打代拍)都自动按锁向打,直到取消:沿当前锁向再长滑一次 = 取消(toggle),
   *   反向长滑 = 换向,换局 resetPadHolds 清锁。短滑在锁定期间 = 临时覆盖本拍,
   *   下一拍自动回锁。锁只住在 pad 上,键盘键(swingFar 等)是完整意图、不读写锁。
   */
  swingPressed: boolean;
  swingHeld: boolean;
  swingSwipe: number;
  swingSwipeY: number;
  /** 横轴锁向:0=未锁,1=锁定 deep,-1=锁定 near(touchpad 长滑写,pad 内纯存储) */
  swingLockX: number;
  /** 纵轴锁向:0=未锁,1=锁定挑高,-1=锁定平抽(与 swingLockX 同构) */
  swingLockY: number;
}

export function newPad(): Pad {
  return {
    left: false, right: false, moveAxis: 0, targetX: undefined, jump: false,
    jumpPressed: false, jumpSteps: 0, jumpTail: 0,
    lungePressed: false, lungeDir: 0, lastDir: 0,
    swingPressed: false, swingHeld: false, swingSwipe: 0, swingSwipeY: 0,
    swingLockX: 0, swingLockY: 0,
  };
}

export function clearEdges(pad: Pad): void {
  // 若本步内发生了跨步触发,消费掉前序 targetX,避免跨步爆发后角色又被自动拉回旧目标
  if (pad.lungePressed && pad.targetX !== undefined) {
    pad.targetX = undefined;
  }
  pad.jumpPressed = false;
  pad.lungePressed = false;
  pad.lungeDir = 0;
  pad.swingPressed = false;
}

/** 按下(边沿 + 状态),由各输入源调用 */
export function press(pad: Pad, action: "left" | "right" | "jump" | "lunge" | "swing" | "swingFar" | "swingNear" | "swingUp" | "swingDown"): void {
  switch (action) {
    case "left": pad.left = true; pad.lastDir = -1; break;
    case "right": pad.right = true; pad.lastDir = 1; break;
    case "jump": pad.jump = true; pad.jumpPressed = true; pad.jumpSteps = 0; pad.jumpTail = 0; break;
    case "lunge": {
      // 方向在按下这一刻现解,优先级:摇杆推的方向 → 当前按着的左右键 → 最近一次方向(含滑轨滑动/目标方向)。
      // 都为零时留 0,由 player.ts 兜底结合 targetX 几何位置或面向方向(= 朝网)。
      pad.lungePressed = true;
      if (Math.abs(pad.moveAxis) > JOYSTICK_DEADZONE) {
        pad.lungeDir = pad.moveAxis < 0 ? -1 : 1;
      } else if (pad.left !== pad.right) {
        pad.lungeDir = pad.left ? -1 : 1;
      } else {
        pad.lungeDir = pad.lastDir;
      }
      break;
    }
    // 触屏击球键:按下即挥拍,两轴恢复为锁定值 —— 没锁 = 0(与旧「清零」一致,点按即 mid),
    // 有锁 = 记忆(「按一下不滑也按锁定方向打」就是在这兑现);按住后的滑动照常覆盖本拍。
    case "swing":
      pad.swingPressed = true; pad.swingHeld = true;
      pad.swingSwipe = pad.swingLockX; pad.swingSwipeY = pad.swingLockY; break;
    // 键盘专用:J = 深球(swingSwipe=1),K = 短球(swingSwipe=-1),即按即定
    case "swingFar":
      pad.swingPressed = true; pad.swingHeld = true; pad.swingSwipe = 1; pad.swingSwipeY = 0; break;
    case "swingNear":
      pad.swingPressed = true; pad.swingHeld = true; pad.swingSwipe = -1; pad.swingSwipeY = 0; break;
    // 键盘专用:U = 上滑挑高,I = 下滑平抽(swingSwipeY=±1)。与 J/K 同构:每个键都是
    // 一个完整意图,按下即重置另一轴 —— 键盘没有「按住中改向」的手势过程,不清就会把
    // 上一拍的纵轴意图泄漏进这一拍;触屏的组合瞄准(上+右等)是手势专属,键盘不提供。
    case "swingUp":
      pad.swingPressed = true; pad.swingHeld = true; pad.swingSwipe = 0; pad.swingSwipeY = 1; break;
    case "swingDown":
      pad.swingPressed = true; pad.swingHeld = true; pad.swingSwipe = 0; pad.swingSwipeY = -1; break;
  }
}

/** 松开(状态),边沿不动 —— 边沿键(lunge)没有可松的状态。
 *  击球键(swing)松手清 held,但保留 swingSwipe —— 命中前仍需读取已提交方向。 */
export function release(pad: Pad, action: "left" | "right" | "jump" | "swing"): void {
  switch (action) {
    case "left": pad.left = false; break;
    case "right": pad.right = false; break;
    case "swing": pad.swingHeld = false; break;
    case "jump": {
      pad.jump = false;
      // 点跳补偿:按住不足 tapCommitFrames 就松手,视作「点一下」而非「推住」。
      // 不补的话会被 player.ts 的
      //   if (!jumpHeld && vy < 0) vy *= jumpCut
      // 每帧对上升段砍半 —— 实测一帧就松只能升 ~6px(满跳 92.3px),等于「按了没反应」。
      // 摇杆 flick 和按钮快点的输入时长天然就在这一档,所以补一段尾巴撑到顶点。
      // tapCommitFrames 目前取 jumpApex(推上去一律跳满):把短按平台与截断段之间的
      // 台阶抹平,理由与实测数字见 config 那条注释。真要恢复可变跳高,先看
      // tools/input-check.ts 第⑦节的升程单调锁。
      const quick = CFG.player.tapCommitFrames;
      if (pad.jumpSteps < quick) {
        pad.jumpTail = Math.max(0, CFG.player.jumpApex - pad.jumpSteps);
      }
      break;
    }
  }
}

/**
 * 把**已提交、还没用掉**的击球键瞄准(横轴深浅 + 纵轴高低)恢复成锁定值。
 * 只碰这两个字段:按下状态、移动意图、lastDir、锁本身一概不动 —— 它是"瞄准的存储",不做判断。
 *
 * 为什么是「恢复」而不是「清零」:手动模式下"下一次按下击球键"天然就是瞄准的边界
 * (press 把两轴恢复成锁值),自动击打没有那一次按下 ⇒ 那一拍真打出去时由 core 经
 * PlayerInput.onAimConsume 调到这里(player.ts 的 consumeAutoAim)。没锁时恢复 = 0,
 * 与旧的「一次滑动只管一拍,不打成锁定态」逐位一致;有锁时恢复 = 锁向,长滑锁定的
 * 「管到取消」就是在这里兑现(短滑覆盖的本拍打完,下一拍自动回锁)。
 * 挥空不吃瞄准(不许白罚),AI 与喂球机永远走不到这里(它们没有"玩家的瞄准"可吃)。
 */
export function restoreSwingAim(pad: Pad): void {
  pad.swingSwipe = pad.swingLockX;
  pad.swingSwipeY = pad.swingLockY;
}

/**
 * 长滑锁定的写入/取消(纯函数,touchpad 的 trackSwingSwipe 在长滑越过阈值时调):
 * 同轴同向已锁 → 取消(toggle,与和平精英「再点一下取消」同一心智);否则设锁。
 * 键值(pad.swingSwipe/swingSwipeY)由调用方按短滑语义照常写 —— 取消的那一拍仍按
 * 该方向打,下一拍起 press/restoreSwingAim 才回到未锁的 mid。
 */
export function lockSwingAxis(pad: Pad, axis: "x" | "y", dir: number): boolean {
  if (axis === "x") {
    const cancel = pad.swingLockX === dir;
    pad.swingLockX = cancel ? 0 : dir;
    return !cancel;
  }
  const cancel = pad.swingLockY === dir;
  pad.swingLockY = cancel ? 0 : dir;
  return !cancel;
}

/**
 * 「不算用户松手」的跳跃清除:虚拟按键层被隐藏 / 离开对局态时用。
 * 必须和 release("jump") 分开 —— release 会按按住时长补一段点跳尾巴,而离场这一路
 * 根本不算玩家主动松手。踩过的坑:resetPadHolds 先把 jumpSteps 清成 0,随后
 * clearPressed 又走一次 release(),0 < tapCommitFrames 于是凭空补出 19 帧 held,
 * 回到对局后的第一次跳跃就再也收不住高度了。
 */
export function cancelJump(pad: Pad): void {
  pad.jump = false;
  pad.jumpTail = 0;
  pad.jumpSteps = 0;
}

/**
 * 每个**模拟步**调用一次(和 clearEdges 同一处):维护跳跃的按住时长、消化点跳尾巴。
 * 必须在世界步进里走,不能放 clearEdges —— 边沿清理在 hitstop/定格步也会被跳过,
 * 时长计数会漏帧。
 */
export function tickHolds(pad: Pad): void {
  if (pad.jump) pad.jumpSteps++;
  else if (pad.jumpTail > 0) pad.jumpTail--;
}

/**
 * 滑轨写入:只在触屏滑轨里调用。设置精准目标坐标 x(若 undefined 表示松手)。
 * 若直接传入 dir(-1 | 1),或传入 currentX 计算位移,则更新 lastDir;松手时保留。
 */
export function setTargetX(pad: Pad, targetX: number | undefined, dirOrCurrentX?: number): void {
  pad.targetX = targetX;
  if (dirOrCurrentX !== undefined) {
    if (dirOrCurrentX === -1 || dirOrCurrentX === 1) {
      pad.lastDir = dirOrCurrentX;
    } else if (targetX !== undefined) {
      const dx = targetX - dirOrCurrentX;
      if (Math.abs(dx) > 1) pad.lastDir = dx < 0 ? -1 : 1;
    }
  }
}

/**
 * 摇杆写入:只在触屏摇杆里调用,不与 left/right 键冲突。
 * axis 已经带死区处理:|axis| ≤ 阈值一律视作 0(回中)。
 * lastDir 跟着非零推送更新,松手回中时保留 —— 与左右键 release 语义一致。
 */
export function setMoveAxis(pad: Pad, axis: number): void {
  const a = Math.abs(axis) < JOYSTICK_DEADZONE ? 0 : Math.max(-1, Math.min(1, axis));
  pad.moveAxis = a;
  if (a < 0) pad.lastDir = -1;
  else if (a > 0) pad.lastDir = 1;
}

/**
 * 清空所有按下状态。虚拟按键层被隐藏(离开对局态)时必须调一次:
 * 节点 inactive 之后 TOUCH_END 不会再送到按钮,手指抬起这件事就"丢"了,
 * pad.left 会一直卡在 true / moveAxis 会停在最后一次推送值,下一局人自己往一边跑。
 * lastDir 是「方向意图」不是按下状态,不清 —— 恢复对局后的第一次跨步
 * 仍该沿用玩家上一个方向,而不是凭空退回朝网。
 */
export function resetPadHolds(pad: Pad): void {
  release(pad, "left");
  release(pad, "right");
  cancelJump(pad);
  pad.moveAxis = 0;
  pad.targetX = undefined;
  pad.lungePressed = false;
  pad.lungeDir = 0;
  pad.swingPressed = false;
  pad.swingHeld = false;
  pad.swingSwipe = 0;
  pad.swingSwipeY = 0;
  // 长滑锁也是「这一局的意图」,换局清掉 —— 新对局从 mid 打起,别把上一局锁的后场带过来。
  pad.swingLockX = 0;
  pad.swingLockY = 0;
}

/** 老仓库 humanIntent 的等价物:把 Pad 翻成 PlayerInput(含反馈钩子) */
export function buildIntent(pad: Pad, hooks: Partial<PlayerInput>): PlayerInput {
  return {
    left: pad.left,
    right: pad.right,
    moveAxis: pad.moveAxis,
    targetX: pad.targetX,
    jumpPressed: pad.jumpPressed,
    // 点跳的补偿尾巴也算「按住」(见 release())。真实按住用 pad.jump,
    // 这样可变跳高仍然成立 —— 推住够久再松,尾巴为 0,截断照常生效。
    jumpHeld: pad.jump || pad.jumpTail > 0,
    lungePressed: pad.lungePressed,
    lungeDir: pad.lungeDir,
    // 击球:按下边沿触发,初始 depth=mid;滑动方向在挥拍期间由 player.ts 读取 swingSwipe 覆盖。
    // swingSwipe 持续输出(不依赖边沿),保证挥拍中提交的方向能到达 buildShot。
    // swingSwipeY 同构:纵轴弧线意图(挑高/平抽),持续输出。
    swingAim: pad.swingPressed ? "mid" : null,
    swingSwipe: pad.swingSwipe,
    swingSwipeY: pad.swingSwipeY,
    ...hooks,
  };
}

export const emptyIntent = (): PlayerInput => ({
  left: false, right: false, moveAxis: 0, targetX: undefined, jumpPressed: false, jumpHeld: false,
  swingAim: null, swingSwipe: 0, swingSwipeY: 0, lungePressed: false, lungeDir: 0,
});
