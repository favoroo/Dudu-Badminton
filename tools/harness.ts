// ============================================================
// 回归工具共用断言器:✓/✗ 打印 + 失败/总数计数 + exit 口径。
// 从前 ok()/fails 计数在 12 份工具里各抄一份,打印行为与统计口径
// 各自漂移 —— 收敛到这里,一份实现,各工具只声明自己的打印偏好。
// (豁免表是 env-check 特有的机制,留在那边,不进通用 harness。)
// ============================================================

export interface Checker {
  ok(cond: boolean, msg: string): void;
  /** 失败条数(汇总行与 exit 码用) */
  readonly fails: number;
  /** fails 的别名:箭头版工具里的老名叫 bad */
  readonly bad: number;
  /** 已跑断言总数 */
  readonly checks: number;
}

export interface CheckerOpts {
  /** ✓ 也打印(默认 true;false = 只打印 ✗) */
  printPass?: boolean;
  /** -v 语义:✓ 的显隐交给命令行标志的工具传进来 */
  verbose?: boolean;
}

export function makeChecker(opts: CheckerOpts = {}): Checker {
  const printPass = opts.printPass ?? true;
  let fails = 0;
  let checks = 0;
  return {
    ok(cond: boolean, msg: string): void {
      checks++;
      if (!cond) fails++;
      if (!cond || printPass || opts.verbose) console.log(`${cond ? "✓" : "✗"} ${msg}`);
    },
    get fails() { return fails; },
    get bad() { return fails; },
    get checks() { return checks; },
  };
}
