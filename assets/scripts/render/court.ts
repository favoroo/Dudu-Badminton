// ============================================================
// 球场静态绘制(阶段 2 精简版):只画判定/氛围必需的元素 ——
// 天空、场地、界线、球网。老 court.js 的看台人群、灯光升温、
// 主题皮肤等纯装饰留到表现层打磨阶段再移植(1272 行,零判定作用)。
// 画进独立的静态 Graphics,一次绘制每帧复用,不参与重绘。
// ============================================================
import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { Viewport } from "./world";

const C = CFG;
const CO = C.court;

export function drawCourt(g: Graphics, vp: Viewport): void {
  const W = C.world.w, H = C.world.h;
  // 天空:上深下浅两段(挂灯前的球馆暗部)
  g.fillColor = new Color().fromHEX(C.colors.sky);
  g.rect(vp.x(-80), vp.y(H * 0.62), W + 160, H * 0.62 + 80);
  g.fill();
  g.fillColor = new Color(22, 28, 48, 255);
  g.rect(vp.x(-80), vp.y(H * 0.62), W + 160, 40);
  g.fill();

  // 场地地板:从地平线到画面底(两侧外延,宽屏适配不露边)
  g.fillColor = new Color().fromHEX(C.colors.floor);
  g.rect(vp.x(-80), vp.y(H), W + 160, H - CO.groundY + 80);
  g.fill();
  // 地板近深远浅的简单分层
  g.fillColor = new Color().fromHEX(C.colors.floorDark);
  g.rect(vp.x(-80), vp.y(H), W + 160, 26);
  g.fill();
  g.fillColor = new Color(226, 148, 88, 255);
  g.rect(vp.x(-80), vp.y(CO.groundY + 8), W + 160, 8);
  g.fill();

  // 界线:底线 + 前发球线(真羽场地线的简化投影)
  const line = new Color().fromHEX(C.colors.line);
  g.strokeColor = line;
  g.lineWidth = 4;
  g.moveTo(vp.x(CO.left), vp.y(CO.groundY));
  g.lineTo(vp.x(CO.left), vp.y(CO.groundY - 96));
  g.moveTo(vp.x(CO.right), vp.y(CO.groundY));
  g.lineTo(vp.x(CO.right), vp.y(CO.groundY - 96));
  g.moveTo(vp.x(CO.shortServeL), vp.y(CO.groundY - 6));
  g.lineTo(vp.x(CO.shortServeL), vp.y(CO.groundY - 60));
  g.moveTo(vp.x(CO.shortServeR), vp.y(CO.groundY - 6));
  g.lineTo(vp.x(CO.shortServeR), vp.y(CO.groundY - 60));
  // 场地横带(近网略亮,给纵深)
  g.strokeColor = new Color(255, 243, 224, 90);
  g.lineWidth = 2;
  g.moveTo(vp.x(-80), vp.y(CO.groundY - 44));
  g.lineTo(vp.x(W + 80), vp.y(CO.groundY - 44));
  g.moveTo(vp.x(-80), vp.y(CO.groundY - 96));
  g.lineTo(vp.x(W + 80), vp.y(CO.groundY - 96));
  g.stroke();

  // 球网:两根立柱 + 网带 + 白色网顶
  const post = new Color(40, 46, 66, 255);
  g.strokeColor = post;
  g.lineWidth = 6;
  g.moveTo(vp.x(CO.netX - 3), vp.y(CO.netTopY));
  g.lineTo(vp.x(CO.netX - 3), vp.y(CO.groundY));
  g.moveTo(vp.x(CO.netX + 3), vp.y(CO.netTopY));
  g.lineTo(vp.x(CO.netX + 3), vp.y(CO.groundY));
  g.stroke();
  // 网面:半透明暗色块
  g.fillColor = new Color(20, 26, 46, 150);
  g.rect(vp.x(CO.netX - 3), vp.y(CO.netTopY), 6, CO.groundY - CO.netTopY);
  g.fill();
  // 白色网顶带(判定参照物,画醒目)
  g.fillColor = new Color(245, 247, 252, 255);
  g.rect(vp.x(CO.netX - 6), vp.y(CO.netTopY), 12, 10);
  g.fill();
  // 网眼纹理:三条横线
  g.strokeColor = new Color(255, 255, 255, 40);
  g.lineWidth = 1;
  for (const yy of [CO.netTopY + 30, CO.netTopY + 52, CO.netTopY + 72]) {
    g.moveTo(vp.x(CO.netX - 3), vp.y(yy));
    g.lineTo(vp.x(CO.netX + 3), vp.y(yy));
  }
  g.stroke();
}
