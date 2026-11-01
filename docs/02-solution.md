# 技术方案

## T001：运行环境与锁定依赖

| 组件 | 版本 | 当前职责 |
|---|---|---|
| Node.js | `>=22.19.0` | CLI 与本地运行环境，满足 Pi 引擎要求 |
| TypeScript | `7.0.2` | 严格类型检查与 Node.js ESM 构建 |
| `@earendil-works/pi-agent-core` | `1.4.0` | 后续 Agent 工具调用循环、工具钩子和事件流 |
| `@earendil-works/pi-ai` | `1.4.0` | 后续 Provider、模型接入和离线 Faux Provider |
| `decimal.js` | `10.6.0` | 后续十进制模拟单位费用计算 |
| `@types/node` | `26.6.6` | Node.js TypeScript 类型声明 |

直接依赖使用精确版本，传递依赖由 `package-lock.json` 锁定。当前任务只验证运行环境、依赖导入和 TypeScript 配置，尚未实现业务功能。
