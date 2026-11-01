# 内容任务规划 Agent

小影科技 2027 校招 AI Agent 笔试第 2 题。项目使用 Node.js、TypeScript 和 Pi Agent Runtime，帮助运营人员在预算与截止时间内检索合成素材、生成脚本、评估候选方案并保存本地 JSON 方案。

## 功能

- Pi Agent 的真实“模型选择动作 → 工具执行 → 观察 → 调整或结束”循环。
- 素材检索、脚本生成、成本估算和方案保存四类工具。
- 预算/时间重规划、失败与部分成功保留、执行上限、跨进程防重复和同 ID 冲突检测。
- 本地 JSON 持久化、可独立读取的保存文件、公开 Trace 和失败步骤续跑。
- 明确标识的离线 Mock 入口；不依赖真实密钥验证流程。

不接入真实发布、支付、数据库或外部业务服务。

## 环境与安装

要求 Node.js `>=22.19.0` 和 npm。

```bash
npm ci
npm run build
npm test
```

当前锁定版本：

- `@earendil-works/pi-agent-core` `1.4.0`：Agent 工具循环、钩子和事件。
- `@earendil-works/pi-ai` `1.4.0`：Provider、模型接入和 Faux Provider。
- `decimal.js` `10.6.0`：十进制模拟单位计算。

## 离线运行

```bash
node dist/src/cli.js \
  --input examples/inputs/normal.json \
  --offline \
  --runtime-dir .runtime/quickstart
```

stdout 为单个 JSON 结果。退出码：`0` 完成，`1` 未完成，`2` 输入、冲突或配置错误。

其他可复现场景位于 `examples/inputs/`。例如保存失败：

```bash
node dist/src/cli.js \
  --input examples/inputs/save-failure.json \
  --offline \
  --faults examples/faults/save-failure.json \
  --runtime-dir .runtime/save-failure
```

离线输出与 Trace 均标记 `mode=mock`。Mock 只证明流程、工具契约和状态处理，**不证明真实模型决策效果**。

## 真实模型配置

真实模式需要 Provider、模型 ID 和该 Provider 的官方凭据环境变量。支持 `openai`、`anthropic`、`google`、`openrouter`、`deepseek`。

```bash
cp .env.example .env
# 在 .env 中填写 CONTENT_PLANNER_PROVIDER、CONTENT_PLANNER_MODEL 和对应凭据
node --env-file=.env dist/src/cli.js \
  --input examples/inputs/normal.json \
  --runtime-dir .runtime/real-run
```

`.env` 不得提交。真实配置缺失时程序明确失败，不会静默回退到 Mock。当前仓库材料采集环境未提供真实凭据，因此真实模型路径仍属未解决验证项，详见 `docs/03-evaluation.md`。

配置完成后，可采集并校验两条不同工具观察的真实路径：

```bash
node --env-file=.env scripts/capture-real-examples.mjs
node scripts/verify-real-evidence.mjs
```

采集器只保存实际运行结果；若模型未给出所需公开决策说明或两条路径不可区分，校验会失败，不会生成替代性 Mock 证据。

## 重复与续跑

相同 `request_id` 和输入会返回原结果并标记 `duplicate=true`；同 ID 不同输入返回冲突。运行记录和方案默认保存在 `.runtime/`，该目录被 Git 忽略。

从失败状态续跑：

```bash
node dist/src/cli.js \
  --input examples/inputs/save-failure.json \
  --offline \
  --resume \
  --runtime-dir .runtime/save-failure
```

续跑复用仍有效的成功结果，保留失败历史，不额外计算重试费用。仅保证顺序跨进程防重复，不提供同 ID 多进程并发锁。

## 验证与评审入口

- `docs/01-requirements.md`：用户、目标、范围与成功标准。
- `docs/02-solution.md`：架构、动态决策、技术取舍和依赖版本。
- `docs/03-evaluation.md`：测试预期、实际结果、证据链接、失败与限制。
- `docs/04-ai-usage.md`：AI 辅助范围、个人贡献与验证。
- `docs/05-retrospective.md`：难点、学习和后续事项。
- `examples/README.md`：实际输入、输出、Trace、保存方案和采集方式。
- `specs/acceptance.md`：逐项验收追踪。

重新采集离线材料：

```bash
npm run build
node scripts/capture-offline-examples.mjs
```

## 目录

```text
src/        TypeScript 领域、Agent、工具、CLI 与本地存储
tests/      可执行契约、集成、CLI 与文档检查
data/       合成素材和费用/耗时目录
examples/   实际输入、输出、Trace、保存方案与 manifest
specs/      规格、方案、契约、任务和验收追踪
docs/       评审文档
```
