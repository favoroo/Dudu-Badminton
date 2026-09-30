// ============================================================
// 技能系统 (Skills): 球员可装备的主动技能状态机与物理驱动
// 纯逻辑层 (core/): 零 Cocos 依赖, 可在 Node 下跑完整回归测试
// 遵循分层铁律: types ← config ← skills ← player/rules ← render/ui
// ============================================================
import { CFG } from "./config";
import { clamp } from "./utils";
import { Ball, HitOpt, Player, PlayerSkillState, SkillDef, SkillId } from "./types";

const C = CFG;
const CO = C.court;

/** 获取全部技能元数据定义 */
export function allSkills(): SkillDef[] {
  return C.skills.list as SkillDef[];
}

/** 根据 id 查询技能定义, 不存在兜底至 "lunge" */
export function defOf(id: SkillId): SkillDef {
  const list = allSkills();
  return list.find((s) => s.id === id) || list[0];
}

/** 初始化球员技能运行时状态 */
export function initSkillState(id: SkillId = "lunge"): PlayerSkillState {
  const def = defOf(id);
  return {
    id: def.id,
    cd: 0,
    maxCd: def.cooldownFrames,
    activeT: -1,
    buffT: 0,
    ready: true,
    magnetPulling: false,
  };
}

/** 每回合开球前复位技能临时状态 (保留冷却或就绪) */
export function resetPoint(p: Player): void {
  if (!p.skill) p.skill = initSkillState("lunge");
  p.skill.activeT = -1;
  p.skill.buffT = 0;
  p.skill.magnetPulling = false;
  p.flashT = 0;
  p.focusT = 0;
  // 每分开始时重置冷却至就绪, 让每回合开局都可施展策略
  p.skill.cd = 0;
  p.lungeCd = 0;
  p.lungeT = -1;
  p.lungeShotT = 0;
}

/** 当前局势下是否满足激活门槛 (供 UI 按钮点亮/置灰与 AI 决策使用) */
export function canActivate(p: Player, ball: Ball): boolean {
  if (!p || !p.skill) return false;
  const s = p.skill;
  if (s.cd > 0) return false;

  switch (s.id) {
    case "lunge":
      // 强力跨步: 在地面、未挥拍、未在跨步中
      return p.onGround && p.swingT < 0 && p.lungeT < 0;

    case "smash":
      // 百分百重击: 随时可预开启附魔 (只要未在附魔期)
      return s.buffT <= 0;

    case "flash": {
      // 闪现扣杀:
      // 1. 球必须在 play 飞行中
      // 2. 球必须进入自己这半场
      // 3. 球离地高度达到扣杀高度 (>= 115px)
      // 4. 未在挥拍中
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      const inCourt = p.side === "left" ? ball.x < CO.netX - 8 : ball.x > CO.netX + 8;
      const highEnough = (CO.groundY - ball.y) >= C.skills.flash.minHeight;
      return inCourt && highEnough && p.swingT < 0;
    }

    case "magnet": {
      // 引力吸球:
      // 对方发球后、回合进行中、且球未在吸取中、未被抓手
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      if (ball.magnetPull) return false;
      return p.swingT < 0;
    }

    case "focus":
      // 时空减速: 回合进行中未在领域中
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      return s.buffT <= 0;

    default:
      return true;
  }
}

/** 触发技能激活, 返回是否成功 */
export function activate(p: Player, ball: Ball, dir?: number): boolean {
  if (!p || !p.skill) return false;
  if (!canActivate(p, ball)) return false;

  const def = defOf(p.skill.id);
  p.skill.cd = def.cooldownFrames;
  p.skill.maxCd = def.cooldownFrames;

  switch (p.skill.id) {
    case "lunge": {
      // 强力跨步: 原有跨步冲量强化, 开启 1 秒流风动画与暴击窗口
      const LG = C.lunge;
      p.lungeT = 0;
      p.lungeDir = dir ? dir : (Math.abs(p.vx) > 1 ? (p.vx > 0 ? 1 : -1) : p.facing);
      p.lungeShotT = LG.shotWindow; // 60 帧 = 1 秒
      p.sq = 0.85;
      p.vx += p.lungeDir * LG.speed;
      p.skill.activeT = LG.duration;
      return true;
    }

    case "smash": {
      // 百分百重击: 开启烈焰聚能附魔, 球拍高亮
      p.skill.buffT = C.skills.smash.buffDuration;
      p.smashGlow = 36;
      p.face = "fierce";
      p.faceT = 30;
      return true;
    }

    case "flash": {
      // 闪现扣杀: 原地产生雷光残影, 瞬间折跃至球后上方进行空中暴扣
      p.flashT = 20;
      const facing = p.facing;
      const targetX = clamp(
        ball.x - facing * C.skills.flash.overheadDist,
        p.side === "left" ? CO.wallL : CO.netX + CO.netPad,
        p.side === "left" ? CO.netX - CO.netPad : CO.wallR
      );
      const targetY = clamp(ball.y - C.skills.flash.overheadY, 60, CO.groundY - 50);
      p.x = targetX;
      p.y = targetY;
      p.vx = 0;
      p.vy = 0;
      p.onGround = false;
      // 瞬间起拍: 过顶扣杀姿势, 瞄准深场
      p.swingT = C.swing.windup;
      p.swingStyle = "over";
      p.smashGlow = 30;
      p.swingAim = C.aimDepth.deep;
      return true;
    }

    case "magnet": {
      // 引力吸球: 展开引力力场, 羽毛球高速牵引至身前
      p.skill.magnetPulling = true;
      const tx = p.x + p.facing * 34;
      const ty = Math.min(p.y - 42, CO.groundY - 60);
      const total = C.skills.magnet.pullFrames;
      ball.magnetPull = {
        targetX: tx,
        targetY: ty,
        player: p,
        total,
        t: total,
        fromX: ball.x,
        fromY: ball.y,
      };
      // 玩家准备挥拍
      p.smashGlow = 20;
      p.swingT = 0;
      p.swingStyle = "under";
      return true;
    }

    case "focus": {
      // 时空减速: 开启 1.5 秒子弹时间
      p.skill.buffT = C.skills.focus.duration;
      p.focusT = C.skills.focus.duration;
      return true;
    }
  }

  return false;
}

/** 每帧驱动技能状态机 */
export function update(p: Player, ball: Ball): void {
  if (!p || !p.skill) return;
  const s = p.skill;

  // 冷却计时
  if (s.cd > 0) s.cd--;
  // 增益状态计时
  if (s.buffT > 0) s.buffT--;
  // 执行期计时
  if (s.activeT >= 0) {
    s.activeT--;
    if (s.activeT < 0) s.activeT = -1;
  }
  // 闪现特效衰减
  if (p.flashT && p.flashT > 0) p.flashT--;
  // 时空减速衰减
  if (p.focusT && p.focusT > 0) p.focusT--;

  // 保持同步 lungeCd 字段兼容现有逻辑
  if (s.id === "lunge") {
    p.lungeCd = s.cd;
  }

  // 动态评估就绪状态
  s.ready = canActivate(p, ball);
}

/**
 * 击球修正钩子: 在 player.tryHit / buildShot 中注入技能加成
 */
export function modifyShot(p: Player, opt: HitOpt): {
  speedBoost: number;
  powerDeg: number;
  forceSmash: boolean;
  skillKind?: SkillId;
} {
  let speedBoost = 0;
  let powerDeg = 0;
  let forceSmash = false;
  let skillKind: SkillId | undefined = undefined;

  if (!p || !p.skill) {
    return { speedBoost, powerDeg, forceSmash };
  }

  // 1. 强力跨步击球
  if (opt.lungeShot && p.lungeShotT > 0) {
    speedBoost += C.lunge.shotBoost;
    powerDeg += C.lunge.shotPowerDeg;
    skillKind = "lunge";
  }

  // 2. 百分百重击 (消耗附魔)
  if (p.skill.id === "smash" && p.skill.buffT > 0) {
    opt.sweet = true;
    opt.perfect = true;
    opt.q = 1.0;
    forceSmash = true;
    speedBoost += C.skills.smash.speedBoost;
    powerDeg += C.skills.smash.powerDeg;
    p.skill.buffT = 0; // 命中消耗附魔
    skillKind = "smash";
  }

  // 3. 闪现扣杀
  if (p.skill.id === "flash" && p.flashT && p.flashT > 0) {
    opt.sweet = true;
    opt.perfect = true;
    forceSmash = true;
    speedBoost += C.skills.flash.speedBoost;
    powerDeg += C.skills.flash.powerDeg;
    skillKind = "flash";
  }

  // 4. 引力吸球回击
  if (p.skill.id === "magnet" && p.skill.magnetPulling) {
    p.skill.magnetPulling = false;
    speedBoost += C.skills.magnet.speedBoost;
    powerDeg += 6;
    skillKind = "magnet";
  }

  return { speedBoost, powerDeg, forceSmash, skillKind };
}

export const Skills = {
  allSkills,
  defOf,
  initSkillState,
  resetPoint,
  canActivate,
  activate,
  update,
  modifyShot,
};
