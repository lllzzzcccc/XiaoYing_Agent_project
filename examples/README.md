# 运行证据索引

`manifest.json` 是当前离线证据清单，所有场景的 `mode` 均为 `mock`。

- `inputs/`：实际 CLI 输入。
- `outputs/`：实际 JSON 输出，包含 `normal-duplicate.json` 的重复结果。
- `traces/`：实际工具参数、结果摘要、后续动作和公开决策说明。
- `plans/`：可独立读取的保存方案。
- `faults/`：可复现的工具故障注入配置。

这些材料由真实 CLI 离线执行生成，不是预期输出或手写 Trace。它们只证明流程、工具契约和状态处理，不证明真实模型决策效果。真实 Provider 路径因未提供凭据和模型配置而尚未采集。

重新生成：

```bash
npm run build
node scripts/capture-offline-examples.mjs
node --test tests/example-evidence.test.mjs
```

评估说明见 `docs/03-evaluation.md`，逐项验收状态见 `specs/acceptance.md`。
