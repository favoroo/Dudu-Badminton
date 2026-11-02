---
name: taptap-asset-library
version: 1.1.0
description: "TapTap 游戏图片素材库检索与收录、视频收录与转码/审核状态查询、模型生成本地图片、真实游戏截图整理和本地规则校验。用户要按图标、宣传图、截图或 Windows 素材场景寻找参考图、生成或整理图片、批量检查场景、替换参考图、收录本地/HTTPS 图片或收录视频时使用；不负责图片与视频的规格判断和资料字段写入。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli asset-library --help;taptap-cli schema asset-library search-assets;taptap-cli asset-library +upload-video --help;taptap-cli schema asset-library get-video-detail;taptap-cli asset-library +ai-image-rules --help;taptap-cli asset-library +ai-image-plan --help;taptap-cli asset-library +ai-image-validate --help"
---

# asset-library

开始前先读共享执行规范：[`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)。

本 skill 处理当前 App 的图片素材库检索、模型生成本地图片、真实游戏截图整理、图片规则校验和收录交接。素材库结果不等于图片已经写入图标、宣传图或截图字段。

**图片收录路径 — 本地图片的上传执行归 `taptap-materials`（顶层 `taptap-cli upload`，成功即自动收录进素材库）；服务端不再提供 URL 下载收录，HTTPS 图片先由客户端下载到本地再走 `upload`。**

**视频收录路径 — `taptap-cli asset-library +upload-video <video>` 完成「取上传 token → 直传 → 登记视频资源 → 登记应用素材」；上传后视频仍在转码/审核，用 `taptap-cli asset-library get-video-detail --app-id <appId> --dev-id <developerId> --data '{"video_id":<id>}'` 轮询状态。**

**CRITICAL — 只有当前 `get-video-detail` 返回非空 `play_url` 才能证明视频可播；上传成功、转码中或审核中都不能表述为可播放。**

**批量检索 — 多个场景一次调用 `search-assets` 传 `target_scenes` 数组，不要按场景循环调用。**

**CRITICAL — 不得用模型凭空生成游戏截图。截图必须来自真实运行中的游戏或用户提供的真实游戏画面；模型只允许裁剪、缩放、转格式和压缩。**

**CRITICAL — 本地模型图片校验通过后仍未上传。必须先向用户展示候选和上传影响，得到明确确认后，转 `taptap-materials` 执行上传。**

**素材候选交接 — 按场景逐项输出，每个候选文件单独输出实际绝对路径；宿主支持图片返回时逐张展示并同时保留路径，宿主不支持时明确说明并逐行给出路径。不得使用路径 glob、占位路径或把多个候选路径塞在同一段。**

## 素材来源优先级

开始补充素材前，先询问用户是否有可用的本地素材或真实游戏截图；在用户回答前，不要调用生图计划或扫描未指定的本地目录。

- 用户有本地素材时，优先使用用户提供的文件。按目标场景执行本地校验，需要整理时只做该场景允许的裁剪、缩放、格式转换或压缩，不调用 `+ai-image-plan` 替换原始素材。校验通过后仍须询问用户是否上传。
- 用户没有本地素材时，图标、宣传图和 Windows 素材才进入模型生图流程：先调用 `taptap-cli asset-library +ai-image-rules`，再根据规则调用 `+ai-image-plan`，由模型生成实际本地图片文件并执行 `+ai-image-validate`。
- 用户没有本地截图时，不得调用模型生成截图；应要求用户提供真实运行中的游戏画面或真实截图。

可向用户询问：

> 请先提供可用的本地素材或真实游戏截图。若没有本地素材，我可以按照当前素材规则为图标、宣传图或 Windows 素材生成本地候选图；截图必须来自真实游戏画面。

## 快速决策

| 用户意图 | 首选命令 / 流程 | 必读 reference |
| --- | --- | --- |
| 缺 `developerId` / `appId` | 转 `taptap-identity` 查候选，不猜 ID | [`taptap-identity`](../taptap-identity/SKILL.md) |
| 为一个或多个场景找参考图 | `search-assets`（`target_scenes` 数组） | [asset library search](references/asset-library-search.md) |
| “换一张参考图” | `search-assets` 传 `exclude_asset_ids` | [asset library search](references/asset-library-search.md) |
| 使用模型生成新图 | `asset-library +ai-image-rules/+ai-image-plan/+ai-image-validate`（不含截图） | [asset library ingest](references/asset-library-ingest.md) |
| 整理真实游戏截图 | 模型处理用户/游戏提供的原图，再用 `+ai-image-validate --rule screenshot` | [asset library ingest](references/asset-library-ingest.md) |
| 收录本地图片 | 转 `taptap-materials` 执行 `upload`（成功即自动收录） | [asset library ingest](references/asset-library-ingest.md) |
| 收录已有 HTTPS 图片 | 客户端下载到本地后转 `taptap-materials` `upload` | [asset library ingest](references/asset-library-ingest.md) |
| 收录本地视频 | `asset-library +upload-video <video>`（上传+登记一步完成） | [asset library ingest](references/asset-library-ingest.md) |
| 查视频转码/审核状态 | `asset-library get-video-detail --data '{"video_id":<videoId>}'` | [asset library ingest](references/asset-library-ingest.md) |
| 把图片写入资料字段 | 先收录，再转 `taptap-app-edit` | [`taptap-app-edit`](../taptap-app-edit/SKILL.md) |

## 常用命令

```bash
taptap-cli asset-library --help
taptap-cli schema asset-library search-assets
taptap-cli asset-library search-assets \
  --app-id <appId> --dev-id <developerId> \
  --data '{"target_scenes":["icon"]}'
taptap-cli asset-library +upload-video ./trailer.mp4 --app-id <appId> --dev-id <developerId> --yes
taptap-cli asset-library get-video-detail --app-id <appId> --dev-id <developerId> --data '{"video_id":<videoId>}'
```

## 视频收录

视频进素材库分两步（建「视频资源」+ 建「应用素材」），`upload-video` 一次跑完：

```bash
taptap-cli asset-library +upload-video ./trailer.mp4 --app-id <appId> --dev-id <developerId> --yes
```

返回 `data.videoId` 与 `data.assetId`。同一 `videoId` 重复执行返回既有 `assetId`，不会重复登记；不传 `--idempotency-key` 时 CLI 按文件 SHA256 派生，重跑不会重复上传。

上传后视频仍在转码/审核，轮询状态（`status` 取值：`transcoding` → `regulating` → `normal`；`transcode_failed` / `regulate_rejected` 为失败）：

```bash
taptap-cli asset-library get-video-detail --app-id <appId> --dev-id <developerId> --data '{"video_id":<videoId>}'
```

`play_url` 有值即已可播。刚上传后状态查询可能短暂返回 404（服务端读延迟不重试），间隔数秒重试即可。轮询为只读，不需要幂等键。

## 模型生图与本地校验

只对图标、宣传图和 Windows 素材生图；截图不得由模型生成。规则读取、`+ai-image-plan` 输出目录约定、`+ai-image-validate` 和 `manifest.json` 语义见 [asset library ingest](references/asset-library-ingest.md)，本文件不重复。开始生成前第一步是读当前内置规则：

```bash
# 再按规则执行 +ai-image-plan 生成计划、+ai-image-validate 校验产物；命令与输出目录约定见上述 reference
taptap-cli asset-library +ai-image-rules
```

校验通过只代表本地文件合格，仍须用户确认后才转 `taptap-materials` 上传。

## 执行规则

- 缺 `developerId` 或 `appId` 时转 `taptap-identity`；不要猜 ID。
- 不确定目标 scene 或返回字段时先读对应 `schema <service> <method>`；文档中的枚举只是常见值，不是实时 schema。
- 检索优先使用每场景的 `recommended_asset_id`，不要无条件取 `list[0]`。
- 业务结果按 `results[]` / `missing[]` 解释；某场景无候选出现在 `missing[]` 不是工具失败。顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理。`searchAssets` 没有通用的 `data.result.ok`；缺少预期结果字段按异常处理。
- 上游返回 `recoverable=true` 时，使用 `reason` 解释原因，并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 面向用户说明可用性、匹配结果和下一步，不默认输出 raw JSON、候选评分、内部 ID 或状态数字。
- `+ai-image-validate` 成功只代表本地文件通过机器校验，不代表已上传、已写入资料字段或已通过审核。用户未明确确认上传时，必须保留“待确认上传”提示。
- 图片上传由 `taptap-materials` 执行后，出现未知结果或请求已发出但结果未知时，先用相同幂等键回读素材库状态，再决定是否重试；不得直接换新幂等键重放。
- 素材收录完成后，若用户意图是更新资料字段，转 `taptap-app-edit`，按目标字段规格 read-before-write。

## References

| Reference | 什么时候读 |
| --- | --- |
| [asset library search](references/asset-library-search.md) | 处理单场景、批量检索、替换参考图、scene 枚举和候选状态时。 |
| [asset library ingest](references/asset-library-ingest.md) | 处理本地上传、HTTPS 收录、模型生图、本地校验结果或资料字段交接时。 |

## 不在本 skill 范围

- 图片/视频规格判断（时长、分辨率、编码、宽高比）和资料字段写入：转 `taptap-app-edit`。
- 包体上传：转 `taptap-package-management`。
