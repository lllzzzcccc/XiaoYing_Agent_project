# 验收追踪

本文件随实施任务更新。状态“单元通过”或“部分覆盖”不代表最终交付验收已通过；最终状态以 T018 为准。

## 业务验收场景

| 场景 | 当前状态 | 当前证据 | 后续缺口 |
|---|---|---|---|
| AC-001 正常完成 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T015 实际材料 |
| AC-002 缺少预算 | CLI 通过 | `tests/cli.test.mjs` | T014 回归确认 |
| AC-003 缺少截止时间 | 输入与 CLI 契约通过 | `tests/input-contract.test.mjs` | T014 回归确认 |
| AC-004 工具失败与部分成功 | 离线端到端通过 | `tests/pi-agent.test.mjs`、`tests/orchestrator.test.mjs` | T015 实际材料 |
| AC-005 保存失败 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T014 回归确认 |
| AC-006 超预算替代方案 | 离线端到端通过 | `tests/pi-agent.test.mjs`、`tests/orchestrator.test.mjs` | T015 真实路径 |
| AC-007 无可行方案与预算缺口 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T014 回归确认 |
| AC-008 截止时间不可行 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T014 回归确认 |
| AC-009 跨进程重复执行 | 独立进程通过 | `tests/cli-idempotency.test.mjs` | T014 回归确认 |
| AC-010 两条真实动态路径 | 两条 Faux 路径通过 | `tests/pi-agent.test.mjs` | T015 真实 Provider 路径 |
| AC-011 执行上限 | CLI 通过 | `tests/cli.test.mjs` | T014 回归确认 |
| AC-012 失败步骤续跑（P1） | 未覆盖 | — | T016 |
| AC-013 离线 Mock 边界 | CLI 通过 | `tests/cli.test.mjs` | T015 实际材料、T017 边界文档 |
| AC-014 缺失或非法输入 | 输入与 CLI 契约通过 | `tests/input-contract.test.mjs`、`tests/cli.test.mjs` | T014 回归确认 |
| AC-015 无素材 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T014 回归确认 |
| AC-016 完成时间等于截止时间 | 工具契约通过 | `tests/domain-rules.test.mjs`、`tests/estimate-tool.test.mjs` | T014 回归确认 |
| AC-017 预算和时间同时不可行 | 离线端到端通过 | `tests/orchestrator.test.mjs` | T014 回归确认 |
| AC-018 相同 ID 不同输入 | 独立进程通过 | `tests/cli-idempotency.test.mjs` | T014 回归确认 |
| AC-019 保存内容独立核对 | 独立进程通过 | `tests/cli-idempotency.test.mjs` | T014 回归确认 |

## 通用交付验收

| 条件 | 当前状态 | 当前证据或缺口 |
|---|---|---|
| DAC-001 可安装、配置并通过 CLI 运行 | CLI 验证通过 | `tests/cli.test.mjs`；README 待 T017 |
| DAC-002 可执行测试与评估引用 | 进行中 | 当前 53 项测试通过；评估文档待 T017 |
| DAC-003 三组以上实际材料及全部 P0 覆盖 | 未覆盖 | T015、T018 |
| DAC-004 两条真实动态路径 | 未覆盖 | T010、T015 |
| DAC-005 仓库与文档完整 | 进行中 | 基础配置已提交；其余文档待 T017 |
| DAC-006 提交信息与无敏感数据 | 进行中 | 本地提交正常；URL、权限和最终 SHA 属提交阶段 |
| DAC-007 离线 Mock 边界 | CLI 验证通过 | `tests/cli.test.mjs`；文档与实际材料待 T015、T017 |
| DAC-008 技术栈、官方 Pi 包与版本锁定 | 通过 | `tests/dependency-contract.test.mjs`、`docs/02-solution.md` |
