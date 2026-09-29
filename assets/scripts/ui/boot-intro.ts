// ============================================================
// 开机演出(冷启动一次):原生 splash 之后、主菜单之前的开场动画。
//
// 分镜(总长约 3.4s,任意时刻点屏幕跳过):
//   ① 夜幕蓄场 —— 墨蓝全屏 + 中央金色聚光渐亮 + 星点闪烁 + 地平线
//   ② 金球飞入 —— 程序化羽毛球拖速度线沿弧线飞抵标题上方,白闪环 + 金屑迸溅 + 镜头微推
//   ③ 标题砸落 —— 「嘟嘟羽毛球」大字 slam + 底线左右展开 + 菱形点题 + kicker 浮现
//   ④ 定格呼吸 —— 「轻触屏幕进入」脉动;到点整体淡出,交棒主菜单逐级 rise
//
// 实现约束:Graphics 一次性绘制 + tween 驱动(与 ui-arcade 同一套路);
// 不 import ui-manager(ui-manager 反向引用本文件,会成环),Label 构件本地自建。
// 音效复用 Sfx 烘焙音色,未就绪时静默丢弃(sfx.play 的既有语义),不阻塞演出。
// ============================================================
import {
  BlockInputEvents, Color, Graphics, Label, Layers, Node, Tween, tween,
  UIOpacity, UITransform, Vec2, Vec3, view, Widget,
} from "cc";
import { APP_VERSION_NAME } from "../core/version";
import type { Sfx } from "../game/sfx";
import { ARCADE, ac, drawScanlines, drawVeil } from "./ui-arcade";

/** 本地 Label 构件:与 ui-manager.uiLabel 同构,搬来这里只为断开 import 环 */
function mkLabel(parent: Node, text: string, size: number, colorHex: string): Label {
  const n = new Node("label");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.22);
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.color = ac(colorHex);
  return l;
}

/** 全屏拉满容器:Widget 四边对齐,超宽屏也铺满(与 uiRoot 同款) */
function fullNode(parent: Node, name: string): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(960, 540);
  const w = n.addComponent(Widget);
  w.isAlignTop = true; w.top = 0;
  w.isAlignBottom = true; w.bottom = 0;
  w.isAlignLeft = true; w.left = 0;
  w.isAlignRight = true; w.right = 0;
  n.setParent(parent);
  return n;
}

/** 递归停掉子树上全部 tween(tween 目标可能是节点也可能是 UIOpacity) */
function stopTree(n: Node): void {
  Tween.stopAllByTarget(n);
  const op = n.getComponent(UIOpacity);
  if (op) Tween.stopAllByTarget(op);
  for (const c of n.children) stopTree(c);
}

/** 程序化羽毛球(指向 +x,球头在前):金色系街机剪影,与 splash 源图同一视觉语言 */
function drawShuttle(g: Graphics): void {
  // 底光晕
  g.fillColor = ac(ARCADE.acid, 0.12);
  g.circle(0, 0, 24);
  g.fill();
  // 羽裙(锥形)+ 羽骨
  g.fillColor = ac(ARCADE.acid, 0.95);
  g.moveTo(8, 3);
  g.lineTo(-26, 11);
  g.lineTo(-26, -11);
  g.lineTo(8, -3);
  g.close();
  g.fill();
  g.strokeColor = ac(ARCADE.acidEdge, 0.9);
  g.lineWidth = 1.5;
  g.moveTo(6, 0); g.lineTo(-24, 0); g.stroke();
  g.moveTo(6, 1); g.lineTo(-24, 8); g.stroke();
  g.moveTo(6, -1); g.lineTo(-24, -8); g.stroke();
  // 尾口描边
  g.lineWidth = 2;
  g.moveTo(-26, 11); g.lineTo(-26, -11); g.stroke();
  // 收口带
  g.fillColor = ac(ARCADE.paper, 0.9);
  g.roundRect(5, -4, 5, 8, 1.5);
  g.fill();
  // 球头(软木)
  g.fillColor = ac("#f7f3e8");
  g.circle(16, 0, 7);
  g.fill();
  g.fillColor = ac("#d9d2c0", 0.5);
  g.circle(16, -2.5, 5.5);
  g.fill();
  g.strokeColor = ac("#b8ae97", 0.8);
  g.lineWidth = 1;
  g.circle(16, 0, 7);
  g.stroke();
}

/** 速度线组(球身后侧,飞行中脉动,落点后隐藏) */
function drawStreaks(g: Graphics): void {
  g.fillColor = ac(ARCADE.acid, 0.55);
  g.roundRect(-58, 5, 24, 2.2, 1.1);
  g.roundRect(-66, -1, 34, 2.6, 1.3);
  g.roundRect(-54, -7, 20, 2, 1);
  g.fill();
}

export class BootIntro {
  /**
   * 播放一次开机演出;结束(自动到点 / 点击跳过)时回调 onDone 再销毁自身。
   * onDone 在淡出开始时触发:主菜单的 rise 入场压在残影淡出背后,交接无缝。
   */
  static play(parent: Node, sfx: Sfx, onDone: () => void): void {
    const root = fullNode(parent, "boot-intro");
    const rootOp = root.addComponent(UIOpacity);
    root.addComponent(BlockInputEvents);          // 演出期吞掉一切触摸(兼做跳过热区)

    // ---------- ① 背景:墨蓝夜幕 + 暗角 + 扫描线 + 地平线 ----------
    const bg = new Node("bg");
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(960, 540);
    const bgg = bg.addComponent(Graphics);
    bgg.fillColor = ac(ARCADE.ink);
    bgg.rect(-2000, -1200, 4000, 2400);           // 超宽屏也铺满
    bgg.fill();
    // 地板带 + 地平线(黄昏体育馆的场地暗示)
    bgg.fillColor = ac(ARCADE.navy2, 0.42);
    bgg.rect(-2000, -1000, 4000, 850);
    bgg.fill();
    bgg.fillColor = ac(ARCADE.paper, 0.09);
    bgg.rect(-2000, -151, 4000, 2);
    bgg.fill();
    // 中央地板反光
    bgg.fillColor = ac(ARCADE.acid, 0.05);
    bgg.circle(0, -150, 150);
    bgg.fill();
    const vs = view.getVisibleSize();
    drawVeil(bgg, Math.max(960, vs.width) * 1.3, Math.max(540, vs.height) * 1.3, 0, 0.38);
    drawScanlines(bgg, 960, 540, 0.045);
    bg.setParent(root);

    // ---------- 中央聚光(独立节点:入场要单独淡入) ----------
    const glow = new Node("glow");
    glow.layer = Layers.Enum.UI_2D;
    glow.addComponent(UITransform);
    const gg = glow.addComponent(Graphics);
    for (let i = 0; i < 12; i++) {
      gg.fillColor = ac(ARCADE.acid, 0.032 * (1 - i / 12));
      gg.circle(0, 40, 34 + i * 24);
      gg.fill();
    }
    const glowOp = glow.addComponent(UIOpacity);
    glowOp.opacity = 0;
    glow.setParent(root);

    // ---------- 星点:上半屏 8 颗,各自呼吸(周末夜球馆的高窗灯) ----------
    const starSpecs: Array<{ x: number; y: number; r: number; a: number; dur: number; delay: number }> = [];
    let seed = 20260929;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 8; i++) {
      starSpecs.push({
        x: -400 + rnd() * 800, y: 60 + rnd() * 170, r: 1 + rnd() * 0.9,
        a: 60 + rnd() * 90, dur: 1.2 + rnd() * 1.1, delay: rnd() * 1.4,
      });
    }
    for (const s of starSpecs) {
      const st = new Node("star");
      st.layer = Layers.Enum.UI_2D;
      st.addComponent(UITransform);
      const sg = st.addComponent(Graphics);
      sg.fillColor = ac(ARCADE.paper, 0.9);
      sg.circle(0, 0, s.r);
      sg.fill();
      st.setPosition(s.x, s.y, 0);
      const so = st.addComponent(UIOpacity);
      so.opacity = 0;
      tween(so).delay(0.3 + s.delay)
        .to(0.5, { opacity: s.a })
        .call(() => {
          tween(so).to(s.dur * 0.5, { opacity: Math.round(s.a * 0.35) }, { easing: "sineInOut" })
            .to(s.dur * 0.5, { opacity: s.a }, { easing: "sineInOut" })
            .union().repeatForever().start();
        })
        .start();
      st.setParent(root);
    }

    // ---------- 内容层(镜头 punch 作用于此) ----------
    const content = new Node("content");
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(960, 540);
    content.setParent(root);

    // ---------- ② 金球飞入 ----------
    const shuttle = new Node("shuttle");
    shuttle.layer = Layers.Enum.UI_2D;
    shuttle.addComponent(UITransform);
    const shg = shuttle.addComponent(Graphics);
    drawShuttle(shg);
    const streaks = new Node("streaks");
    streaks.layer = Layers.Enum.UI_2D;
    streaks.addComponent(UITransform);
    drawStreaks(streaks.addComponent(Graphics));
    const streaksOp = streaks.addComponent(UIOpacity);
    streaksOp.opacity = 0;
    streaks.setParent(shuttle);
    const shOp = shuttle.addComponent(UIOpacity);
    shOp.opacity = 0;
    shuttle.setPosition(-620, 168, 0);
    shuttle.setParent(content);

    // 落点白闪环
    const ring = new Node("ring");
    ring.layer = Layers.Enum.UI_2D;
    ring.addComponent(UITransform);
    const rig = ring.addComponent(Graphics);
    rig.lineWidth = 3;
    rig.strokeColor = ac("#ffffff", 0.9);
    rig.circle(0, 0, 16);
    rig.stroke();
    rig.lineWidth = 1.5;
    rig.strokeColor = ac(ARCADE.acid, 0.7);
    rig.circle(0, 0, 24);
    rig.stroke();
    const ringOp = ring.addComponent(UIOpacity);
    ringOp.opacity = 0;
    ring.setPosition(0, 132, 0);
    ring.setParent(content);

    const LAND = new Vec3(0, 132, 0);
    const MID = new Vec3(-210, 92, 0);

    // ---------- ③ 标题组 ----------
    const title = new Node("title");
    title.layer = Layers.Enum.UI_2D;
    title.addComponent(UITransform).setContentSize(360, 90);
    title.setPosition(0, 48, 0);
    const t1 = mkLabel(title, "嘟嘟", 64, ARCADE.acid);
    t1.node.setPosition(-101, 0, 0);
    const t2 = mkLabel(title, "羽毛球", 64, ARCADE.paper);
    t2.node.setPosition(69, 0, 0);
    for (const t of [t1, t2]) {
      t.enableShadow = true;
      t.shadowColor = new Color(0, 0, 0, 150);
      t.shadowOffset = new Vec2(0, -6);
    }
    title.setScale(1.8, 1.8, 1);
    const titleOp = title.addComponent(UIOpacity);
    titleOp.opacity = 0;
    title.setParent(content);

    // 底线:左右两条从中缝向外展开 + 中央菱形点题
    const barL = new Node("barL");
    barL.layer = Layers.Enum.UI_2D;
    barL.addComponent(UITransform).setContentSize(170, 3);
    const blg = barL.addComponent(Graphics);
    blg.fillColor = ac(ARCADE.acid, 0.9);
    blg.roundRect(-85, -1.5, 170, 3, 1.5);
    blg.fill();
    barL.setPosition(-95, 4, 0);
    barL.setScale(0, 1, 1);
    barL.setParent(content);
    const barR = new Node("barR");
    barR.layer = Layers.Enum.UI_2D;
    barR.addComponent(UITransform).setContentSize(170, 3);
    const brg = barR.addComponent(Graphics);
    brg.fillColor = ac(ARCADE.acid, 0.9);
    brg.roundRect(-85, -1.5, 170, 3, 1.5);
    brg.fill();
    barR.setPosition(95, 4, 0);
    barR.setScale(0, 1, 1);
    barR.setParent(content);
    const diamond = new Node("diamond");
    diamond.layer = Layers.Enum.UI_2D;
    diamond.addComponent(UITransform).setContentSize(10, 10);
    const dg = diamond.addComponent(Graphics);
    dg.fillColor = ac(ARCADE.cyan, 0.95);
    dg.moveTo(0, 6); dg.lineTo(6, 0); dg.lineTo(0, -6); dg.lineTo(-6, 0); dg.close();
    dg.fill();
    diamond.setScale(0, 0, 1);
    diamond.setParent(content);

    const kicker = mkLabel(content, "D U D U   B A D M I N T O N", 12, ARCADE.dimDeep);
    kicker.node.setPosition(0, -28, 0);
    const kickerOp = kicker.node.addComponent(UIOpacity);
    kickerOp.opacity = 0;

    // ---------- ④ 定格件:提示 + 版本 ----------
    const hint = mkLabel(content, "轻触屏幕进入", 13, ARCADE.dim);
    hint.node.setPosition(0, -176, 0);
    const hintOp = hint.node.addComponent(UIOpacity);
    hintOp.opacity = 0;
    const ver = mkLabel(content, APP_VERSION_NAME, 11, ARCADE.dimDeep);
    ver.node.setPosition(430, -244, 0);
    const verOp = ver.node.addComponent(UIOpacity);
    verOp.opacity = 0;

    // ---------- 分镜编排 ----------
    let done = false;
    const finish = (fast: boolean): void => {
      if (done) return;
      done = true;
      stopTree(root);
      sfx.play("ui", 0.5);
      onDone();                                    // 菜单 rise 压在残影背后启动
      rootOp.opacity = 255;
      tween(rootOp)
        .to(fast ? 0.28 : 0.55, { opacity: 0 }, { easing: "quadIn" })
        .call(() => { if (root.isValid) root.destroy(); })
        .start();
    };
    root.on(Node.EventType.TOUCH_START, () => finish(true));

    // ① 蓄场
    tween(glowOp).to(0.55, { opacity: 235 }, { easing: "quadOut" }).start();

    // ② 金球:出现 → 弧线两段 → 落点爆发
    tween(shOp).delay(0.28).to(0.12, { opacity: 255 }).start();
    tween(shuttle)
      .delay(0.28)
      .call(() => sfx.play("swing", 0.55))
      .to(0.42, { position: MID, angle: 7 }, { easing: "sineOut" })
      .to(0.33, { position: LAND, angle: -3 }, { easing: "sineIn" })
      .call(() => {
        if (done) return;
        sfx.play("hit_n86", 0.9);
        // 速度线收,白闪环扩,金屑迸溅,镜头微推
        Tween.stopAllByTarget(streaksOp);
        streaksOp.opacity = 0;
        tween(ringOp).to(0.05, { opacity: 255 }).to(0.38, { opacity: 0 }).start();
        ring.setScale(0.4, 0.4, 1);
        tween(ring).to(0.42, { scale: new Vec3(2.4, 2.4, 1) }, { easing: "quadOut" }).start();
        content.setScale(1.045, 1.045, 1);
        tween(content).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI * 2 * i) / 8 + 0.35;
          const dist = 46 + (i % 3) * 14;
          const p = new Node("spark");
          p.layer = Layers.Enum.UI_2D;
          p.addComponent(UITransform);
          const pg = p.addComponent(Graphics);
          pg.fillColor = ac(i % 2 === 0 ? ARCADE.acid : "#fff6cf", 0.95);
          pg.circle(0, 0, 2.2 + (i % 2) * 1.2);
          pg.fill();
          p.setPosition(LAND.x, LAND.y, 0);
          const po = p.addComponent(UIOpacity);
          p.setParent(content);
          tween(po).to(0.55, { opacity: 0 }).start();
          tween(p)
            .to(0.3, { position: new Vec3(LAND.x + Math.cos(ang) * dist, LAND.y + Math.sin(ang) * dist, 0) }, { easing: "quadOut" })
            .to(0.28, { position: new Vec3(LAND.x + Math.cos(ang) * dist * 1.25, LAND.y + Math.sin(ang) * dist * 1.25 - 26, 0) }, { easing: "quadIn" })
            .call(() => { if (p.isValid) p.destroy(); })
            .start();
        }
        // 金球落位后悬浮呼吸
        tween(shuttle)
          .to(1.4, { position: new Vec3(LAND.x, LAND.y - 5, 0) }, { easing: "sineInOut" })
          .to(1.4, { position: new Vec3(LAND.x, LAND.y + 5, 0) }, { easing: "sineInOut" })
          .union().repeatForever().start();
      })
      .start();
    // 速度线飞行中脉动
    tween(streaksOp)
      .delay(0.4)
      .to(0.14, { opacity: 200 })
      .to(0.14, { opacity: 70 })
      .union().repeatForever().start();

    // ③ 标题砸落 → 底线展开 → kicker
    tween(titleOp).delay(1.12).to(0.14, { opacity: 255 }).start();
    tween(title)
      .delay(1.12)
      .call(() => sfx.play("ui", 0.8))
      .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();
    tween(barL).delay(1.34).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
    tween(barR).delay(1.4).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
    tween(diamond).delay(1.46).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
    tween(kickerOp).delay(1.52).to(0.45, { opacity: 200 }).start();

    // ④ 定格:提示脉动 + 版本浮现,到点自动交棒
    tween(hintOp).delay(1.95).to(0.4, { opacity: 190 })
      .call(() => {
        tween(hintOp).to(0.75, { opacity: 70 }, { easing: "sineInOut" })
          .to(0.75, { opacity: 190 }, { easing: "sineInOut" })
          .union().repeatForever().start();
      })
      .start();
    tween(verOp).delay(2.1).to(0.4, { opacity: 150 }).start();
    tween(content).delay(3.15).call(() => finish(false)).start();
  }
}
