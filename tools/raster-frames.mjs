#!/usr/bin/env node
// ============================================================
// 批量 SVG → PNG 光栅化(常驻 headless Chrome + CDP)
//
// 为什么不用仓库其它预览工具的写法:那些是「一个 SVG 起一个 Chrome --screenshot」,
// 每次冷启动 ~2.5s。宣传片要几千帧,那个路子是几十分钟。
// 这里起一个 Chrome,用 CDP 逐帧换文档 + 截图,实测 ~46ms/帧(Node 22 自带 WebSocket,
// 零依赖)。
//
// 用法:
//   node tools/raster-frames.mjs --dir .tools-build/seq/arena --out .tools-build/png/arena
//   node tools/raster-frames.mjs --dir IN --out OUT --w 960 --h 540 --workers 1
//
// 约定:输入目录里的 *.svg 按文件名排序后依次光栅化,输出同名 .png。
// 已经存在同名 png 的默认跳过(--force 覆盖),断点续跑不必重来。
//
// 注意:本进程会起一个常驻 headless Chrome,必须保证退出时杀掉 —— 见文件末尾的
// cleanup 与 process.on 兜底。仓库 AGENTS.md 对常驻 headless 进程有明确要求。
// ============================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const DIR = arg("dir");
const OUT = arg("out", DIR);
const W = Number(arg("w", "960"));
const H = Number(arg("h", "540"));
const FORCE = flag("force");
const PORT = Number(arg("port", "9333"));

if (!DIR) {
  console.error("用法: node tools/raster-frames.mjs --dir <svg目录> [--out <png目录>] [--w 960] [--h 540] [--force]");
  process.exit(2);
}
if (!fs.existsSync(DIR)) {
  console.error(`✗ 目录不存在: ${DIR}`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const svgs = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".svg"))
  .sort();

if (!svgs.length) {
  console.error(`✗ ${DIR} 里没有 .svg`);
  process.exit(2);
}

const todo = FORCE ? svgs : svgs.filter((f) => !fs.existsSync(path.join(OUT, f.replace(/\.svg$/, ".png"))));
if (!todo.length) {
  console.log(`全部已存在,跳过(${svgs.length} 帧)。要重来加 --force`);
  process.exit(0);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dudu-raster-"));
let chrome = null;
let ws = null;
let cleaned = false;

function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  try { if (ws) ws.close(); } catch {}
  try { if (chrome && !chrome.killed) chrome.kill("SIGKILL"); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(code ?? 0);
}
process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));
process.on("uncaughtException", (e) => { console.error(e); cleanup(1); });

/** 等 CDP 的 /json/version 起来 */
async function waitForChrome(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Chrome CDP 没起来");
}

/** 极简 CDP 客户端:一条命令一条响应,足够截图用 */
class CDP {
  constructor(sock) {
    this.sock = sock;
    this.id = 0;
    this.pending = new Map();
    sock.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }
}

async function main() {
  chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--force-device-scale-factor=1",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${W},${H}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  // Chrome 的 stderr 会刷 CVDisplayLink 之类的噪音,吞掉
  chrome.stderr.on("data", () => {});

  const ver = await waitForChrome(PORT);
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    sock.addEventListener("open", res, { once: true });
    sock.addEventListener("error", rej, { once: true });
  });
  ws = new CDP(sock);

  await ws.send("Page.enable");
  await ws.send("Runtime.enable");
  await ws.send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  // 透明背景:与仓库其它预览工具的 --default-background-color=00000000 对齐
  await ws.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });

  // 首帧走一次完整导航,建立渲染进程
  await ws.send("Page.navigate", { url: "about:blank" });
  await ws.send("Page.loadEventFired").catch(() => {});

  const t0 = Date.now();
  let done = 0;
  for (const file of todo) {
    const svg = fs.readFileSync(path.join(DIR, file), "utf8");
    // 直接把 SVG 文本塞进文档:比每帧导航到 file:// 快一个数量级
    const expr = `document.open();document.write(${JSON.stringify(svg)});document.close();true`;
    await ws.send("Runtime.evaluate", { expression: expr, awaitPromise: false });
    // 让浏览器完成一次排版/绘制
    await ws.send("Runtime.evaluate", {
      expression: "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      awaitPromise: true,
    });
    const shot = await ws.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
      clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, file.replace(/\.svg$/, ".png")), Buffer.from(shot.data, "base64"));
    done++;
    if (done % 50 === 0 || done === todo.length) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  ${done}/${todo.length} 帧 (${(el / done * 1000).toFixed(0)}ms/帧, 已 ${el.toFixed(0)}s)`);
    }
  }

  const total = (Date.now() - t0) / 1000;
  console.log(`✓ ${todo.length} 帧 → ${OUT} (${(total / todo.length * 1000).toFixed(0)}ms/帧, 共 ${total.toFixed(1)}s)`);
  cleanup(0);
}

main().catch((e) => {
  console.error("✗", e.message || e);
  cleanup(1);
});
