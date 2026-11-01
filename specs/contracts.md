# 工具与运行状态契约

- 阶段：Plan
- 上游规格：`specs/spec.md`
- 技术方案：`specs/plan.md`
- 本文定义外部行为、字段语义和状态不变量，不给出实现或测试代码。

## 1. 通用约定

- CTR-001：所有时间戳均为含时区的合法 ISO-8601 字符串；业务耗时使用非负整数秒。
- CTR-002：费用为十进制模拟单位的 JSON number，不使用货币符号；输入预算必须有限且大于等于 0。
- CTR-003：ID 均为非空字符串。`request_id` 由调用方提供，其他 ID 不得包含路径语义。
- CTR-004：所有持久化记录包含 `schema_version`，当前为 1；后续不兼容变化必须升级版本并提供明确处理。
- CTR-005：`null` 表示尚无值，不得用 0、空字符串或成功空对象掩盖缺失。
- CTR-006：工具失败通过工具错误通道反馈，不以成功结果中的错误文本代替。
- CTR-007：所有返回给模型的参数和结果不得包含 Provider 凭据、环境变量值或内部思维过程。
- CTR-008：运行状态中的应用字段是事实来源，模型返回文本无权直接改变这些字段。

## 2. CLI 合同

### 2.1 参数

| 参数 | 必填 | 语义 |
|---|---|---|
| `--input <path>` | 是 | 读取一个 JSON 请求；格式错误按输入错误处理 |
| `--offline` | 否 | 使用 Pi 官方 Faux Provider，结果和 Trace 标记 `mode=mock` |
| `--faults <path>` | 否 | 读取工具故障注入配置，用于可复现验证；不改变公开请求字段 |
| `--runtime-dir <path>` | 否 | 指定本地运行目录，默认 `.runtime/`；测试使用隔离临时目录 |
| `--resume` | 否 | P1 续跑入口；P1 未实现时必须明确报告不支持，不得隐式开启新请求 |

关联：DEL-002、DEL-006、AC-013、FR-011。

### 2.2 输出与退出码

- stdout 只输出一个符合第 4 节的 JSON 结果；诊断信息写 stderr。
- stdout、stderr 和 Trace 均不得输出密钥或完整环境配置。
- 退出码：
  - `0`：`status=completed`，包括重复返回的原完成结果；
  - `1`：请求已处理但 `status=incomplete`；
  - `2`：CLI 用法、JSON 输入、请求冲突或运行配置错误。
- 退出码不替代 JSON 中的实际状态和原因。

### 2.3 环境配置

- `CONTENT_PLANNER_PROVIDER`：真实模式的 Provider ID。
- `CONTENT_PLANNER_MODEL`：真实模式的模型 ID。
- `CONTENT_PLANNER_MAX_TOOL_CALLS`：可选正整数，默认 12。
- Provider 凭据使用对应 Pi Provider 的官方环境变量；`.env.example` 只列变量名和占位说明。
- 离线模式不得要求真实 Provider 凭据。

关联：DEL-003、DEL-005、FR-010、DAC-001。

## 3. 输入合同

### 3.1 请求字段

| 字段 | 类型 | 必填 | 校验与语义 |
|---|---|---|---|
| `request_id` | string | 是 | 去除首尾空白后不能为空；原值保留，用于请求识别 |
| `theme` | string | 是 | 去除首尾空白后不能为空；不得由系统代填 |
| `budget` | number | 是 | 有限、非负的十进制模拟单位 |
| `deadline` | string | 是 | 合法 ISO-8601，且显式包含 `Z` 或数值时区偏移 |

- 未知字段不参与业务决策，但属于原始输入并参与输入指纹。
- 缺失字段返回 `INPUT_MISSING`；非法字段返回 `INPUT_INVALID`，并指出具体字段。
- 除 `request_id` 外，其他字段非法时仍可按新请求记录未完成原结果；缺少或非法 `request_id` 时不建立请求记录。
- 原始输入不得被自动修正；保存方案中的原始输入必须与请求指纹对应。

关联：IN-001、IN-003、EXC-001、AC-002～003、AC-014。

### 3.2 输入指纹

- 指纹输入为解析后的完整 JSON，递归排序对象键，保持数组顺序和字符串原值。
- 使用 SHA-256；指纹用于相同 ID 的输入一致性判断，不用于替代原始输入。
- 仅对象键顺序不同视为相同输入；任何业务值、未知字段或字符串表示不同均视为不同输入。
- 文件名 ID 为原始 `request_id` 的独立 SHA-256 摘要，不使用输入指纹代替。

关联：FR-009、BR-009、BR-012、AC-009、AC-018。

## 4. 最终输出合同

| 字段 | 类型 | 语义 |
|---|---|---|
| `schema_version` | number | 输出合同版本，当前为 1 |
| `request_id` | string | 原始请求 ID |
| `duplicate` | boolean | 新原结果固定为 `false`；重复响应固定为 `true` |
| `status` | `completed` 或 `incomplete` | 整体完成状态 |
| `mode` | `real` 或 `mock` | 实际模型运行模式；输入失败且未调用模型时沿用请求选定模式 |
| `task_plan` | object 或 null | 当前任务计划及业务依赖；无可选方案时为 null |
| `steps` | array | 实际运行步骤，含成功、失败、阻断和失效历史 |
| `tool_results` | array | 已执行工具的结果摘要，包含错误和空结果 |
| `current_cost` | object 或 null | 当前方案最新估算及历史估算引用 |
| `duration` | object 或 null | 当前串行总耗时、开始时间和预计完成时间 |
| `saved_plan` | object 或 null | 保存引用和保存时间；未完成且未保存时为 null |
| `reasons` | array | 全部未完成原因；完成时为空数组 |
| `trace` | object | 本次 Trace 引用及模型模式，不含内部思维过程 |

### 4.1 完成不变量

只有同时满足以下条件才允许 `status=completed`：

1. 当前方案有明确 `plan_id` 和 `plan_fingerprint`；
2. 当前方案最新成功估算满足预算和截止时间；
3. 当前脚本与当前方案指纹一致，引用素材均来自成功检索；
4. 所有必需运行步骤成功，没有未解决的必需失败或依赖阻断；
5. 保存工具成功，保存文件可独立读取且内容满足第 10 节；
6. `saved_plan` 非空，`reasons` 为空。

关联：FR-005、BR-005～008、OUT-005、AC-001。

### 4.2 原因对象

每个原因包含：

- `code`：稳定机器可读错误码；
- `message`：面向用户的简要说明；
- `step_id`：可选，关联实际运行步骤；
- `budget_gap`：可选，预算缺口；
- `current_cost`：可选，相关候选方案费用；
- `estimated_completion_at`：可选，相关预计完成时间。

标准原因码至少包括：

- `INPUT_MISSING`、`INPUT_INVALID`、`REQUEST_CONFLICT`；
- `NO_MATERIALS`；
- `BUDGET_EXCEEDED`、`DEADLINE_EXCEEDED`；
- `TOOL_FAILED`、`SAVE_FAILED`、`MODEL_UNAVAILABLE`；
- `EXECUTION_LIMIT_REACHED`、`AGENT_STOPPED`、`RUN_INTERRUPTED`；
- `RESUME_UNSUPPORTED`。

预算和时间同时不满足时，`BUDGET_EXCEEDED` 与 `DEADLINE_EXCEEDED` 必须同时存在，不规定只显示一个的优先级。

关联：OUT-006、FR-008、BR-013、AC-007～008、AC-017。

## 5. 候选方案合同

### 5.1 `CampaignPlan`

| 字段 | 类型 | 语义 |
|---|---|---|
| `plan_id` | string | 模型为候选方案选择的非空 ID |
| `title` | string | 非空方案标题 |
| `steps` | array | 至少一个业务步骤 |

每个业务步骤包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `step_id` | string | 在当前方案内唯一的业务步骤 ID |
| `title` | string | 非空步骤说明 |
| `cost_item_id` | string | 必须存在于合成费用/耗时目录 |
| `depends_on` | string array | 当前方案内前置业务步骤 ID，可为空数组 |
| `quantity` | integer | 大于等于 1，缺省为 1 |

### 5.2 方案有效性

- 所有依赖必须存在，不得形成循环或自依赖。
- 同一方案的业务步骤 ID 必须唯一。
- `plan_fingerprint` 由 `CampaignPlan` 的规范形式计算，规则与输入指纹一致。
- 同 `plan_id` 同内容具有相同指纹；同 ID 内容变化会产生新指纹，并使旧脚本和旧估算对当前保存失效。
- 业务步骤的串行总耗时为所有步骤 `duration_seconds × quantity` 之和，包括无依赖步骤。
- 单步费用为十进制 `unit_cost × quantity`，总费用为所有步骤之和。

关联：OUT-001、FR-003～007、BR-001～003、BR-006～007。

## 6. 工具共同合同

### 6.1 工具上下文

四个工具均通过每次运行的闭包上下文获得 `request_id`、原始输入、任务开始时间、运行状态和数据目录；这些权威值不接受模型在工具参数中覆盖。

每次实际工具调用记录：

- `tool_call_id`、`tool_name`、公开参数；
- 接受执行顺序、开始和结束时间；
- 成功结果摘要或错误码；
- 对应运行步骤和后续模型动作。

### 6.2 工具错误

工具错误包含：

- `code`：稳定错误码；
- `message`：不包含秘密的简要说明；
- `retryable`：是否允许模型考虑重试，仅作建议，不触发隐式重试；
- `details`：可选公开上下文；
- `injected`：可选布尔值，标识验收故障注入。

通用错误码至少包括 `VALIDATION_ERROR`、`DEPENDENCY_NOT_MET`、`NOT_FOUND`、`TOOL_FAILURE`、`INJECTED_FAILURE`、`SAVE_CONFLICT` 和 `PERSISTENCE_ERROR`。

- 工具异常必须由 Pi 以错误工具结果反馈模型。
- 失败调用计入工具上限，并保留失败历史。
- 自动重试不是默认行为，是否重试由模型在上限内决定。

关联：IN-005、BR-010～011、DYN-001～003、EXC-002。

## 7. 四个业务工具

### 7.1 `search_materials`

用途：检索合成素材。关联 IN-006、FR-001、AC-015。

输入：

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `query` | string | 是 | 非空检索词，允许模型在空结果后改写 |
| `limit` | integer | 否 | 1～20，默认 5 |

成功结果：

| 字段 | 类型 | 语义 |
|---|---|---|
| `query` | string | 实际执行的查询 |
| `items` | array | 素材列表，可为空 |
| `count` | integer | 等于 `items.length` |

每个素材项包含 `material_id`、`title`、`summary`、`facts` 和 `tags`；`facts` 是后续脚本可引用的事实集合。

规则：

- 空列表是成功观察，不是工具异常。
- 每次查询均追加历史，模型可据此调整查询。
- 工具不得为匹配主题而编造素材。

### 7.2 `generate_script`

用途：依据已检索素材为候选方案生成可追踪脚本。关联 FR-002、BR-005～007。

输入：

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `plan` | CampaignPlan | 是 | 当前候选方案；注册或更新其指纹 |
| `material_ids` | string array | 是 | 非空、无重复的素材 ID |

成功结果包含：

- `script_id`、`plan_id`、`plan_fingerprint`；
- `title` 和脚本内容；
- `material_ids` 及每个素材引用对应的事实；
- `generated_at`。

规则：

- 所有素材 ID 必须来自本请求成功检索结果，否则返回 `DEPENDENCY_NOT_MET` 或 `NOT_FOUND`。
- 脚本只能使用主题和所引用素材事实，不得添加无来源效果数据。
- 同 `plan_id` 内容变化时，旧脚本保留但标记失效。
- 工具失败不得产生可用脚本或成功步骤。

### 7.3 `estimate_cost`

用途：计算候选方案费用、串行耗时和可行性。关联 FR-003、FR-007～008、BR-001～003、BR-013。

输入：

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `plan` | CampaignPlan | 是 | 当前候选方案；注册或更新其指纹 |

成功结果包含：

- `estimate_id`、`plan_id`、`plan_fingerprint`、`estimated_at`；
- `items`：各业务步骤的费用项、数量、单价、单步耗时、费用小计和耗时小计；
- `total_cost`、`total_duration_seconds`；
- `started_at`、`estimated_completion_at`；
- `budget`、`deadline`、`budget_feasible`、`time_feasible`、`feasible`；
- `budget_gap = max(total_cost - budget, 0)`。

规则：

- 预算或时间不可行仍是成功估算观察，`feasible=false` 不等于工具失败。
- `budget_feasible` 等价于 `total_cost <= budget`。
- `time_feasible` 等价于 `estimated_completion_at <= deadline`，等值可行。
- 每次估算追加历史；最终合计只使用当前指纹的最新成功估算。
- 最终无可行方案时，总结果中的预算缺口使用所有成功候选估算的最低 `total_cost` 重新计算，而不是直接复制某次高费用估算。

### 7.4 `save_plan`

用途：保存当前可行方案为本地 JSON。关联 FR-005、OUT-005、OUT-010、EXC-003。

输入：

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `plan_id` | string | 是 | 只允许引用状态中已有当前候选方案 |

成功结果包含：

- `request_id`、`plan_id`、`plan_fingerprint`；
- `saved_at`、`path`；
- `already_saved`，表示是否返回既有等价保存。

前置条件：

1. 当前方案最新成功估算 `feasible=true`；
2. 当前脚本与方案指纹一致且素材引用有效；
3. 必需依赖步骤成功；
4. 原请求没有冲突，当前运行未达到上限。

规则：

- 前置条件不满足时返回工具错误，不写保存文件。
- 同请求同方案已保存时返回既有引用，不创建第二份文件。
- 同请求已有不同方案保存时返回 `SAVE_CONFLICT`，不得覆盖。
- 写入失败必须抛错，`saved_plan` 保持 null，整体不得完成。
- 保存内容必须通过独立读取校验后才能将保存步骤记为成功。

## 8. 运行状态合同

### 8.1 `RunState` 字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `schema_version` | number | 当前为 1 |
| `request_id` | string | 原始请求 ID |
| `input_fingerprint` | string | 完整原始输入指纹 |
| `original_input` | object | 未修改的输入 JSON |
| `mode` | `real` 或 `mock` | 本次运行模式 |
| `status` | `running`、`completed` 或 `incomplete` | 持久化运行状态 |
| `started_at` | string | 任务起算时间，创建后不可更改 |
| `finished_at` | string 或 null | 最终结束时间 |
| `current_plan_id` | string 或 null | 当前候选方案 ID |
| `current_plan_fingerprint` | string 或 null | 当前方案内容指纹 |
| `plans` | object | 各候选方案及其指纹、当前/替换状态 |
| `material_searches` | array | 全部检索历史和结果 |
| `scripts` | array | 全部脚本历史及有效/失效状态 |
| `estimates` | array | 全部成功估算历史及有效/失效状态 |
| `steps` | array | 全部运行步骤与尝试历史 |
| `tool_call_count` | integer | 实际接受执行的工具调用数 |
| `max_tool_calls` | integer | 本次上限 |
| `limit_reached` | boolean | 是否因上限停止 |
| `saved_plan` | object 或 null | 保存引用 |
| `reasons` | array | 全部最终或当前原因 |
| `original_result` | object 或 null | 首次最终输出，`duplicate=false` |
| `trace_path` | string | 本地 Trace 引用 |

### 8.2 状态不变量

- `started_at`、原始输入和输入指纹创建后不可变。
- `tool_call_count` 只增不减，且不得超过 `max_tool_calls`。
- 历史检索、脚本、估算和步骤只可追加或标记失效，不得把失败记录改成成功。
- 当前方案变化不会删除历史成功结果，但会使指纹不匹配的结果不能用于保存。
- `original_result` 只在首次最终化时写入；重复执行不得覆盖。
- `status=completed` 必须满足第 4.1 节全部条件。
- `status=incomplete` 时 `reasons` 至少有一项；保存失败时不得存在有效 `saved_plan`。

关联：SCP-004、OUT-002～009、BR-005～012。

## 9. 运行步骤与状态迁移

### 9.1 `RunStep` 字段

每个运行步骤包含：

- `step_id`、`tool_call_id`、`tool_name`；
- `attempt`，从 1 开始；
- `status`；
- `depends_on`，为运行步骤 ID 数组；
- `args` 和 `result_summary`；
- `error`，成功时为 null；
- `plan_id`、`plan_fingerprint`，不适用时为 null；
- `started_at`、`finished_at`。

### 9.2 状态集合与迁移

状态集合：`pending`、`running`、`succeeded`、`failed`、`blocked`、`skipped`、`invalidated`。

允许迁移：

- `pending → running`、`pending → blocked`、`pending → skipped`；
- `running → succeeded`、`running → failed`、`running → blocked`；
- `succeeded → invalidated`；
- `failed → skipped`，仅表示后续计划不再需要，不得改成成功；
- 终态历史不被覆盖，重试创建新的 `attempt` 和运行步骤。

规则：

- 依赖未满足时只能为 `blocked` 或 `pending`，不能为 `succeeded`。
- 工具抛错对应 `failed`；保存工具抛错还必须产生 `SAVE_FAILED` 适用原因。
- 方案指纹变化可使旧 `succeeded` 变为 `invalidated`，但历史结果仍保留。
- 部分成功时，成功、失败和阻断状态同时存在；最终状态另按完成不变量判断。

关联：FR-004、FR-011、BR-005～008、BR-011、AC-004、AC-012。

## 10. 保存文件合同

本地保存文件至少包含：

| 字段 | 语义 |
|---|---|
| `schema_version` | 保存合同版本 |
| `request_id` | 原始请求 ID |
| `original_input` | 完整原始输入 |
| `current_plan` | 当前方案及指纹 |
| `material_references` | 素材 ID 和实际引用事实 |
| `script` | 与当前方案指纹一致的脚本 |
| `cost` | 当前明细、总费用和历史估算引用；历史不叠加 |
| `duration` | 当前明细、串行总耗时、开始时间和预计完成时间 |
| `saved_at` | 保存时间 |

- 文件必须能够脱离 Agent 和模型独立读取。
- 文件内容必须与当前成功运行状态一致。
- 相同请求及相同方案只存在一份等价保存记录。
- 文件不得包含环境变量、Provider 密钥或内部思维过程。

关联：OUT-005、OUT-010、AC-019。

## 11. 请求记录与重复合同

### 11.1 新请求

- 创建运行记录，初始 `original_result=null`。
- 最终化后保存 `original_result`，其 `duplicate=false`。
- 保存方案与请求记录分文件原子写入；最终化前核对保存引用。

### 11.2 相同 ID、相同输入

- 若 `original_result` 已存在，返回其深拷贝并仅把本次响应的 `duplicate` 改为 `true`。
- 不调用模型或工具，不新增方案、步骤或业务副作用。
- 跨进程重启后行为相同。
- 若没有原结果但存在中断状态，P0 先形成 `RUN_INTERRUPTED` 原结果；P1 可按续跑合同处理。

### 11.3 相同 ID、不同输入

- 返回 `status=incomplete`、`duplicate=false` 和 `REQUEST_CONFLICT`。
- 不修改原输入、原结果、保存文件或 Trace。
- 不调用模型或业务工具，不产生新保存。

关联：FR-009、BR-009、BR-012、AC-009、AC-018。

## 12. Trace 合同

每个审计事件包含：

- `event_id`、`request_id`、`timestamp`、`mode`；
- `sequence`，单调递增；
- `type`，如模型回合、工具开始、工具结束、状态结束；
- `step_id`，不适用时为 null；
- `tool_name`、`args`，不适用时为 null；
- `result_summary` 或 `error`；
- `next_action`，在观察到后续模型动作后补齐；
- `decision_note`，仅记录模型公开简短说明，缺失时为 null；
- `plan_id`、`plan_fingerprint`，适用时记录。

规则：

- 工具参数和结果摘要来自实际 Agent 事件，不从预设流程生成。
- 不记录 assistant thinking、隐藏推理、Provider 密钥或完整环境配置。
- 工具失败、空结果、方案替换和达到上限必须可追踪。
- 至少两条真实运行 Trace 能呈现不同观察导致不同后续动作。
- `decision_note` 缺失不得伪造；该真实运行不能作为完整决策依据证据。

关联：OUT-008、DYN-004、DYN-007、DEL-018～019、AC-010。

## 13. 持久化与原子性合同

- 请求记录：`.runtime/requests/<request-id-hash>.json`。
- 保存方案：`.runtime/plans/<request-id-hash>.json`。
- Trace：`.runtime/traces/<request-id-hash>.jsonl`。
- 写入先落在同目录临时文件，再原子重命名；失败时保留最后一份完整记录。
- 不承诺同 ID 多进程并发写入或跨主机一致性，不引入锁服务。
- 评审证据从实际运行复制到 `examples/`，复制前后不得修改实际状态和决策内容。

关联：SCP-007、DEC-010、OUTS-006。

## 14. P1 续跑合同

- 仅当原请求输入和指纹一致且存在可续跑状态时允许 `--resume`。
- 复用仍有效的成功检索、脚本和估算；指纹失效结果不得复用。
- 失败、未执行或已失效步骤可按模型新计划处理；旧失败历史保持可查。
- 续跑追加尝试和 Trace，不重置 `started_at`，不额外计算重试费用。
- 若续跑改变候选方案，必须重新估算并满足保存前置条件。
- 同 ID 不同输入仍返回冲突，续跑不得成为覆盖原请求的入口。

关联：FR-011、AC-012。

## 15. 契约验收映射

| 契约 | 需求 | 验收场景 |
|---|---|---|
| 输入与输出 | IN-001、IN-003、OUT-001～010 | AC-001～003、AC-014、AC-017 |
| 素材工具 | IN-006、FR-001、EXC-011 | AC-015 |
| 脚本工具 | FR-002、FR-004、BR-005～007 | AC-001、AC-004 |
| 成本工具 | FR-003、FR-007～008、BR-001～003、BR-013 | AC-006～008、AC-016～017 |
| 保存工具与保存文件 | FR-005、OUT-005、OUT-010、EXC-003 | AC-005、AC-019 |
| 请求记录与重复 | FR-009、BR-009、BR-012 | AC-009、AC-018 |
| 运行步骤与历史 | OUT-002～007、BR-005～008 | AC-004、AC-007 |
| 工具上限 | FR-010、DYN-005 | AC-011 |
| Trace | OUT-008、DYN-004、DYN-007 | AC-010、DAC-004 |
| 离线模式 | DYN-006、DEL-006 | AC-013、DAC-007 |
| 续跑 | FR-011 | AC-012 |
