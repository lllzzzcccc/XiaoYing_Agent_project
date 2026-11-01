# 运行证据索引

`manifest.json` 是当前离线证据清单，所有场景的 `mode` 均为 `mock`。

- `inputs/`：实际 CLI 输入。
- `outputs/`：实际 JSON 输出，包含 `normal-duplicate.json` 的重复结果。
- `traces/`：实际工具参数、结果摘要、后续动作和公开决策说明。
- `plans/`：可独立读取的保存方案。
- `faults/`：可复现的工具故障注入配置。

这些材料由真实 CLI 离线执行生成，不是预期输出或手写 Trace。它们只证明流程、工具契约和状态处理，不证明真实模型决策效果。

`real/manifest.json` 是 DeepSeek `deepseek-flash` 的真实证据索引，包含正常保存与保存失败重试两条路径。`real/inputs/`、`real/outputs/`、`real/traces/` 和 `real/plans/` 与离线材料分开存放，均标记 `mode=real`。可运行 `node scripts/verify-real-evidence.mjs` 复核。

所有证据中的运行路径均规范化为仓库相对的 `.runtime/...`，不保留本机绝对路径；工具动作、状态和业务结果保持原始采集内容。`tests/evidence-paths.test.mjs` 用于防回归。

重新生成：

```bash
npm run build
node scripts/capture-offline-examples.mjs
node --test tests/example-evidence.test.mjs
```

评估说明见 `docs/03-evaluation.md`，逐项验收状态见 `specs/acceptance.md`。
