---
name: dudu-release
description: Dudu Badminton 应用的 Git 提交存档、双平台推送与版本发布流程。当用户要求提交/commit/存档/git提交、推送/push/推送到平台/推送到云端/双端推送、发布/release/发版/打tag/创建release、版本号加一/apk版本号加一/版本号+1/升级版本/版本递增、构建APK/打apk包时使用。涵盖 Android APK 构建、一键发布脚本 release.py、双端 Tag 与 Release API 创建、令牌配置与发布后检查清单。位于 .agents/skills/dudu-release/SKILL.md。
---

# Dudu Badminton Git 提交与版本发布

## Git 提交与双平台同步

- **提交与存档原则（绝对禁止自动操作）**：
  - **严禁自动执行 `git commit`（存档）**！日常代码修改和验证完成后，**一律留在工作区**（未提交状态），方便用户自行查看 Diff、测试与确认。
  - **严禁自动执行 `git push`（推送到云端）**！
  - 只有当用户**明确指示「提交/存档/commit」**时，才执行本地 `git commit`；
  - 只有当用户**明确指示「推送/push/推送到云端」**时，才执行向远端推送。
- **提交格式**：`<type>(<scope>): <description>`，Type：`feat` / `fix` / `refactor` / `style` / `docs` / `test` / `chore`
- **双平台同步要求**：当用户明确要求推送时，代码、Git Tag 及 Release 产物必须**同时同步至 GitHub 与 Gitee 两端**：
  - **GitHub 远端**：`origin` (`https://github.com/favoroo/Dudu-Badminton.git`)
  - **Gitee 远端**：`gitee` (`https://gitee.com/favo9/dudu-badminton.git`)
  - 代码与标签一次连接同时推（每端一次协商）：
    ```bash
    git push origin main vX.Y.Z &
    git push gitee main vX.Y.Z &
    wait
    ```

---

## 版本发布流程

当用户明确要求「发布版本 / release / 发版 / 版本号+1」时执行。

### 0. 前置约定

| 项 | 规范 |
|----|------|
| 构建命令 | 调用 `release.py build --version X.Y.Z`，内部通过 Cocos CLI 导出 + Gradle 编译 Release APK |
| APK 命名 | `dudu-badminton-v<version>-arm64-v8a.apk`（如 `dudu-badminton-v0.0.1-arm64-v8a.apk`），**两端文件名完全一致** |
| 产物目录 | `build/` |
| Tag 命名 | `v<version>`（如 `v0.0.1`），使用 annotated tag |
| 版本号递增 | **每次发布/打包 APK，版本号必须递增 +1**（如 `v0.0.2` -> `v0.0.3`），禁止同版本覆盖发布 |
| 版本来源 | `package.json` 的 `version`、`assets/scripts/core/version.ts` 的 `APP_VERSION` 以及 Android 原生层 `native/engine/android/app/build.gradle`（`versionName` 与 `versionCode`）保持严格一致 |
| Android版本同步 | Gradle 自动动态读取 `package.json` 解析 `versionName` 并按 `Major*10000 + Minor*100 + Patch` 换算递增 `versionCode`；`release.py` 构建时注入环境变量双重兜底 |
| 两端一致性 | GitHub 与 Gitee 必须使用相同 Tag、相同 APK 文件名、同为正式 Release（非 draft / prerelease） |
| 更新服务 | `assets/scripts/core/update-service.ts` 优先读 Gitee `/releases/latest`，备选 GitHub，并配合国内加速代理 |

### 1. 一键脚本编排

脚本：`.agents/skills/dudu-release/release.py`（仅标准库）。核心思路：**两阶段解耦**。

```text
① 升级 package.json 与 assets/scripts/core/version.ts 版本号（Android 原生层自动联动）
② 后台启动构建:  python3 .agents/skills/dudu-release/release.py build --version X.Y.Z   ← run_in_background
③ 前台跑测试:    npx tsc -p tools/tsconfig.check.json                   ← 与构建重叠
④ 提交:          git add -A && git commit -m "feat(...): ... 版本升至 X.Y.Z"
⑤ 撰写 Release 说明存为临时文件，执行:
   python3 .agents/skills/dudu-release/release.py publish --version X.Y.Z --notes-file /tmp/dudu-notes.md
⑥ 按脚本输出的「发布验证清单」向用户汇报（含两端 URL 与 SHA-256）
```

- `build` 阶段：校验版本一致性 → 构建 Release APK → 重命名规范文件名 → SHA-256 计算 → 原子写 `build/release-meta.json`。
- `publish` 阶段：等待构建元数据就绪 → 预检（工作树干净、tag 不存在）→ 创建 annotated tag → **并行**推送双端（单连接推 `分支+tag`）→ **并行**创建双端 Release → **并行**上传 APK → 幂等可重试 → 双端验证（tag/附件 state/draft/prerelease/两端 `/releases/latest`）。
- `publish --dry-run` 可只跑预检与令牌链自测，不做任何变更。
- `publish` 验证通过后会自动清理老版本 APK 附件：**双端各保留最近 20 个版本**（`--keep N` 可调），只删附件，Release 说明和源码归档不动。清理失败仅告警，不影响发布结果。
- 单独清理：`python3 .agents/skills/dudu-release/release.py prune [--keep 20] [--dry-run]`。

### 2. 令牌获取（严禁写入任何仓库文件）

脚本按以下顺序取令牌，手动操作时同样遵守：

1. 环境变量：`GITHUB_TOKEN`（或 `GH_TOKEN`）、`GITEE_TOKEN`；
2. git 凭据库：`printf 'protocol=https\nhost=github.com\n\n' | git credential fill`（Gitee 同理，取 `password` 字段）；
3. 都取不到 → 中止并提示用户配置，**不要把令牌写进 SKILL.md / 脚本 / 代码**。

### 3. Release 说明模板

**应用内更新弹窗只显示前 6 行**（超过会截断加省略号，`##` 标题行与 SHA-256 行自动隐藏），说明务必精简：**总条目 ≤5 条，每条 ≤25 字**，优先合并成一条「优化与调整」。

```markdown
## Dudu Badminton vX.Y.Z

### 新增功能
- ...(≤5 条,每条 ≤25 字)

### 修复问题
- ...

**SHA-256**: `<shasum -a 256 输出>`
```

### 4. 发布后检查清单（脚本 publish 阶段自动完成）

- [ ] GitHub Release 页面可见，APK 附件可下载（state=uploaded）
- [ ] Gitee Release 页面可见，APK 附件可下载
- [ ] 两端 Tag 一致（`v<version>`）、两端 APK 文件名一致
- [ ] 两端 `/releases/latest` 均指向新 Tag（应用内更新服务依赖）
- [ ] 老版本 APK 附件已清理，双端各只剩最近 20 个版本可下载
