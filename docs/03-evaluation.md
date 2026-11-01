# 评估结果

## 测试预期与实际结果

预期按 RED → GREEN → REFACTOR → VERIFY 验证输入、领域规则、工具、状态、Pi Agent、CLI、跨进程、续跑、证据和文档。当前实际结果：

- `npm ci`：通过，npm 审计 0 个漏洞。
- `npm run build`：通过。
- `npm test`：64 项测试通过，0 项失败。
- 离线 CLI：正常、输入不足、保存失败、无素材、执行上限和双重不可行均生成实际结果。
- 真实 CLI：两条不同工具观察路径均通过证据校验。
- P1 续跑：复用成功结果、保留失败历史、开始时间不变且重试不额外计费。

测试证据包括 `tests/input-contract.test.mjs`、`tests/domain-rules.test.mjs`、`tests/pi-agent.test.mjs`、`tests/orchestrator.test.mjs`、`tests/cli-idempotency.test.mjs`、`tests/resume.test.mjs`、`tests/offline-acceptance.test.mjs` 和 `tests/real-evidence-contract.test.mjs`。

## 实际运行材料

`examples/manifest.json` 由 `scripts/capture-offline-examples.mjs` 通过实际 CLI 生成，包含 6 个场景和 1 个重复结果。

| 场景 | 输入 | 实际输出 | Trace / 方案 | 结果 |
|---|---|---|---|---|
| 正常与超预算重规划 | `examples/inputs/normal.json` | `examples/outputs/normal.json` | `examples/traces/normal.jsonl`、`examples/plans/normal.json` | Mock 完成，当前选择轻量方案 |
| 重复执行 | `examples/inputs/normal.json` | `examples/outputs/normal-duplicate.json` | 复用原保存文件 | 原结果标记 `duplicate=true` |
| 缺预算 | `examples/inputs/missing-budget.json` | `examples/outputs/missing-budget.json` | 无 Agent 调用 | 明确缺失，未完成 |
| 保存失败 | `examples/inputs/save-failure.json` | `examples/outputs/save-failure.json` | `examples/traces/save-failure.jsonl` | 保留成功步骤，保存失败 |
| 无素材 | `examples/inputs/no-material.json` | `examples/outputs/no-material.json` | `examples/traces/no-material.jsonl` | 调整查询后仍未完成 |
| 执行上限 | `examples/inputs/execution-limit.json` | `examples/outputs/execution-limit.json` | `examples/traces/execution-limit.jsonl` | 达到上限后未完成 |
| 预算与时间双重不可行 | `examples/inputs/dual-infeasible.json` | `examples/outputs/dual-infeasible.json` | `examples/traces/dual-infeasible.jsonl` | 同时返回两项原因 |

正常 Trace 可核对初始方案和替代方案、工具参数、结果摘要、后续动作及公开决策说明；不包含模型内部思维过程。

## 真实模型验证状态

已使用 DeepSeek Provider 和 `deepseek-flash` 采集两条真实路径，索引为 `examples/real/manifest.json`。`node scripts/verify-real-evidence.mjs` 校验通过。

| 真实路径 | 实际输出与 Trace | 实际结果 |
|---|---|---|
| 正常规划 | `examples/real/outputs/replan.json`、`examples/real/traces/replan.jsonl`、`examples/real/plans/replan.json` | 模型依次检索、估算、生成脚本并保存，费用 7 不超过预算 10，最终完成 |
| 保存失败 | `examples/real/outputs/tool-failure.json`、`examples/real/traces/tool-failure.jsonl` | 模型观察保存失败后重试，第二次仍失败后停止；保留成功检索、估算和脚本，最终未完成 |

两条 Trace 均为 `mode=real`，包含实际工具参数、结果摘要、不同后续动作和公开决策说明，不包含模型内部思维过程。它们证明不同工具观察会导致不同模型动作，满足 AC-010 和 DAC-004。

离线 `examples/` 仍全部标记 `mode=mock`，只作为流程与实际状态证据；真实材料单独存放在 `examples/real/`，没有相互替代。

## 失败与已知限制

- npm 安装出现传递依赖弃用和 install-scripts 提示，但安装、构建、导入与测试均通过，审计 0 个漏洞。
- 不提供同 ID 多进程并发锁；只保证顺序跨进程防重复。
- 离线脚本由合成模板生成，不评价真实模型脚本质量。
- 真实模型不可用时不自动切换到 Mock，真实模式会明确返回配置错误。
- 本次仅验证 DeepSeek `deepseek-flash`，其他 Provider 和模型未逐一验证。

## T018 最终验收记录

- 已执行 `npm ci`、`npm run build` 和 `npm test`，64 项测试全部通过。
- 按 README 运行正常与重复场景：首次完成，重复返回 `duplicate=true` 且保存路径不变。
- 运行保存失败场景：返回未完成和 `SAVE_FAILED`。
- 检查 Git 跟踪文件，原始笔试 HTML、`.env` 和密钥文件均未纳入。
- 离线最终验收与两条真实模型证据校验均已通过，T015 已完成；T018 最终复核待执行。
