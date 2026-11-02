# Qualification lifecycle

## 适用场景

用户要提交某项资质增量审核、撤回审核，或需要判断撤回影响范围时使用本 reference。

## 提交资质增量审核

1. 先读 `get-qualification-status` 确认指定资质状态为 `uploaded`（材料已存草稿）。`pending_upload` 说明材料缺失，先转 [qualification draft](qualification-draft.md) 补材料。
2. 向用户展示资质类型和提交影响。`submit-qualification` 内联 readiness 判定：不满足提交条件时命令返回错误（如材料缺失），此时不强行提交，先补材料。
3. 用户明确确认后执行：

   ```bash
   taptap-cli qualification submit-qualification \
     --app-id <appId> --dev-id <developerId> \
     --data '{"qualification_type":"<type>"}' \
     --idempotency-key <submit-key> --yes
   ```

   成功后返回 `qualification_type`、`submit_fields`、`audit_id`。
4. 完成后重新调用 `get-qualification-status` 验证状态变为 `reviewing`。

## 撤回资质审核

1. 先读 `get-qualification-status` 确认指定资质状态为 `reviewing`。
2. 向用户展示撤回影响。`withdraw-qualification` 内联 withdrawal 决策：整单提审（无字段粒度）无法按类型撤回时返回 `FAILED_PRECONDITION`，此时引导用户前往开发者后台处理。
3. 用户确认后执行：

   ```bash
   taptap-cli qualification withdraw-qualification \
     --app-id <appId> --dev-id <developerId> \
     --data '{"qualification_type":"<type>"}' \
     --idempotency-key <withdraw-key> --yes
   ```

   成功后返回非空的 `withdraw_fields`。
4. 完成后重新调用 `get-qualification-status` 验证状态。

## 门禁与输出

- 提交和撤回都是 write，需要 `--yes` 与稳定幂等键，且先展示类型和影响、用户确认后执行。
- 资质增量审核不等同于资料版本的整版提审、撤审或发布；后者转 `taptap-app-edit`。
