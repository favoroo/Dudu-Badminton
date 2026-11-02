---
name: taptap-qualification
version: 1.0.0
description: "TapTap 游戏上架资质识别、非敏感材料草稿、资质增量提审和撤回。用户问还缺哪些资质、能否上架、补充版号/备案/隐私/AI/IP 材料或处理敏感资质时使用；不负责普通资料字段、整版提审、测试玩家资格。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli qualification --help;taptap-cli schema qualification get-qualification-status;taptap-cli schema qualification save-qualification-draft"
---

# qualification

开始前先读共享执行规范：[`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)。

本 skill 面向当前 App 的上架资质：先读各资质类型的客观状态并自判缺口，再保存非敏感材料或处理资质增量审核。它不替代资料页版本发布流程。

**CRITICAL — 资质状态必须来自当前 `get-qualification-status` 结果；不能凭游戏类型、旧对话或经验补全资质项。**

**CRITICAL — 敏感资质只转开发者后台页面填写。命中敏感资质类型或敏感字段时，不通过 CLI 直写，也不声称已保存。**

**资质审核路径 — 增量提审/撤回使用本 skill 的 `submit-qualification` / `withdraw-qualification` 命令（readiness / withdrawal 决策已内联，无需单独 precheck / preview），不改走 `taptap-app-edit` 的整版审核流程。**

**CRITICAL — `get-qualification-status` 是客观状态登记表，8 项 `pending_upload` 只表示“8 个槽位暂无材料”，不等于“8 项都必须交”。“哪些资质必须”由 `taptap-app-edit` 的 `analyze-app-status`（`QUALIFICATION_INCOMPLETE` warning）按游戏事实计算；离线无内购无 AI 无 IP 的游戏必须资质可能为空，不要拿客观登记表去否定它。**

**CRITICAL — 报告 8 项前先确认「资质判断事实」：用 `app_features`（`is_internet_required`/`has_in_app_purchase`/`has_ai_content`/`has_ip_authorization`/`has_text_story_simulation`）逐项问用户，不确定时必须询问；再由 `analyze-app-status` 推导必须资质，只把必须项当缺口，不得跳过事实直接列 8 项。**

## 快速决策

| 用户意图 | 首选命令 / 流程 | 必读 reference |
| --- | --- | --- |
| 缺 `developerId` / `appId` | 转 `taptap-identity` 查候选，不猜 ID | [`taptap-identity`](../taptap-identity/SKILL.md) |
| 查询还缺哪些资质、能否满足预约/测试/上线目标 | 先 `taptap-app-edit` → `app analyze-app-status`（算必须资质缺口），再 `get-qualification-status`（看客观状态） | [qualification analysis](references/qualification-analysis.md) |
| 用户纠正联网、内购、AI、IP 等事实 | 重新读取状态后自判；无写入口时报告契约缺口 | [qualification analysis](references/qualification-analysis.md) |
| 保存版号、备案、隐私、AI、软著等非敏感材料 | `save-qualification-draft`，先 `--dry-run` | [qualification draft](references/qualification-draft.md)、[material fields](references/qualification-materials.md) |
| 工具要求人工填写或涉及主体/证件/联系人 | 停止 CLI 写入并交接开发者后台资质页 | [qualification draft](references/qualification-draft.md) |
| 提交资质增量审核 | `submit-qualification --yes`（readiness 已内联） | [qualification lifecycle](references/qualification-lifecycle.md) |
| 撤回资质审核 | `withdraw-qualification --yes`（withdrawal 决策已内联） | [qualification lifecycle](references/qualification-lifecycle.md) |
| 修改简介、图标、截图、主包体或整版发布 | 转 `taptap-app-edit` | [`taptap-app-edit`](../taptap-app-edit/SKILL.md) |

## 常用命令

```bash
taptap-cli qualification --help
taptap-cli schema qualification get-qualification-status
taptap-cli schema qualification save-qualification-draft
taptap-cli app list-packages \
  --app-id <appId> --dev-id <developerId>
taptap-cli qualification get-qualification-status \
  --app-id <appId> --dev-id <developerId>
taptap-cli qualification save-qualification-draft \
  --app-id <appId> --dev-id <developerId> \
  --data @qualification-draft.json --idempotency-key <draft-key> --dry-run
```

## 执行规则

- **提审前资质确认（taptap-app-edit 提审三步前必做）**：先调 `taptap-app-edit` 的 `app analyze-app-status` 查 `QUALIFICATION_INCOMPLETE`（按游戏事实算出的必须资质缺口，不是把 8 类资质客观状态全列一遍）：有缺口时逐项向用户展示「继续提审可能被驳回」并询问是否继续；无缺口时也明确向用户说明「按当前游戏事实无必须资质缺口」。再读 `get-qualification-status` 看客观状态；开发者认证/豁免结论以本 skill 分析为准，无法确认时向用户说明并询问是否继续。资质缺口是 warning、服务端 submit 不卡控，只做提示与确认、不由本地强行阻断提交；最终是否可提交由 submit 服务端校验（blockers 拒绝 / warnings 不拒）裁决。
- 缺 `developerId` 或 `appId` 时转 `taptap-identity`；不要猜 ID。
- 不确定输入字段、资质类型、枚举或副作用时，先读对应 `schema <service> <method>`；reference 中的字段示例不是服务端实时 schema。
- 分析前先调用 `app list-packages`，使用 `data.result.current_bindings` 确认当前已绑定槽位；`slot=windows` 表示已绑定 Windows 包体。该字段只用于资质分析的只读事实核对，不能作为包体写入快照。
- 读取 `get-qualification-status`，遍历 `qualifications[]` 的 8 类资质状态（`qualification_type` + `status`）：`pending_upload`=该槽位暂无材料、`rejected`=已驳回（读 `reason` 与 `field_reject_reasons`）、`uploaded`=已存草稿待提交、`reviewing`=审核中、`approved`=已通过。
- `pending_upload` 只表示“该槽位暂无材料”，**不表示“该资质必须交”**。哪些资质必须由 `taptap-app-edit` 的 `analyze-app-status`（`QUALIFICATION_INCOMPLETE` warning）按游戏事实计算；离线无内购无 AI 无 IP 的游戏必须资质可能为空，不要把全部非 `approved` 项断定为必须。
- 只报告服务端返回的客观状态，不自行追加、删除或臆断“某场景必须某资质”。存在 `pending_upload` 或 `rejected` 时表述“当前不能确认满足上架条件”，并列出待补 / 待重提的资质；Windows 联网场景是否要求 ICP、隐私合规或其它材料以服务端当前返回为准，需要规则确认时标注“需产品/服务端确认”。
- 写入前执行 read-before-write；材料写入先 `--dry-run`，增量审核/撤回确认后才执行 `--yes`。
- 读取 JSON envelope 的顶层 `ok` 和 `error.type` / `error.subtype`；资质业务结论读取 `data.result.qualifications[].status` 与 `version`，不能只依据单个状态字段。不把不存在的 `data.result.ok` 当作业务成功位。面向用户输出业务结论、状态、风险和下一步，不默认倾倒 raw JSON 或内部 ID。

## References

| Reference | 什么时候读 |
| --- | --- |
| [qualification analysis](references/qualification-analysis.md) | 分析资质缺口、解释各资质状态、处理用户修正事实或状态输出时。 |
| [qualification draft](references/qualification-draft.md) | 保存材料、核对仍缺材料或页面填写交接时。 |
| [qualification materials](references/qualification-materials.md) | 构造具体 `qualification_type` 和 `qualification` 时。 |
| [qualification lifecycle](references/qualification-lifecycle.md) | 提交或撤回资质增量审核、判断审核范围和确认门禁时。 |

## 不在本 skill 范围

- 普通资料字段、主包体、整版提审和发布：转 `taptap-app-edit`。
- 厂商实名流程本身：敏感主体信息到开发者后台页面填写。
- CBT/OBT 玩家资格、资格批次和激活码：转 `taptap-test-plan`。
