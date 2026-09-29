// ============================================================
// 宿主能力注入:Cocos 运行时把平台存储后端交给 core/utils。
//
// core/utils 不许 import cc(tools 编 core/** 要在 node 下跑),所以注入点
// 放在 game/。node 回归工具不调用本函数 → 天然留在 utils 的内存兜底后端。
//
// 为什么要显式注入:core/utils.setStorageBackend 一直没被任何地方调用过,
// 于是 load/save 全落在内存 Map 上,静音、球馆、等级金币重启即丢。
// 顺序要求:必须早于任何 load() —— render/court 的模块级单例在构造函数里
// 就读档(模块求值早于生命周期钩子),那一处已改成懒确保。
// ============================================================
import { sys } from "cc";
import { setStorageBackend } from "../core/utils";

let installed = false;

/** 幂等:GameRoot.onLoad 与 UIManager.start 都会调,后一次是 no-op */
export function installStorageBackend(): void {
  if (installed) return;
  installed = true;
  try {
    setStorageBackend(sys.localStorage);
  } catch {
    // 平台没有 localStorage(极老的 WebView / 隐私模式抛异常)时留在内存兜底,
    // 存档退回「本次启动内有效」,但游戏必须照常跑得起来。
  }
}
