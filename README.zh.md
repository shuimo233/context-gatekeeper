# Context Gatekeeper

MCP 上下文管理服务 - 让 AI Agent 始终保持在 **100k token 聪明区** 高效运行。

通用安装 - 兼容**所有 MCP 智能体**：Cursor、Claude Desktop、Cline、Continue、Claude Code 等。

## 目录

- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [安装配置](#安装配置)
- [环境变量](#环境变量)
- [工具参考](#工具参考)
- [跨智能体兼容性测试](#跨智能体兼容性测试)
- [架构设计](#架构设计)
- [故障排查](#故障排查)
- [最佳实践](#最佳实践)
- [开发指南](#开发指南)

## 快速开始

### 1. 通过 CLI 一键安装

CLI 自动检测本机所有支持的智能体，并把配置写入每个智能体期望的位置。无需手写 JSON。

```bash
# 安装到所有检测到的智能体（推荐）
npx -y context-gatekeeper-cli install --all

# 也可以指定单个或多个智能体
npx -y context-gatekeeper-cli install cursor claude-desktop claude-code

# 查看 CLI 会写入哪些位置
npx -y context-gatekeeper-cli status

# 稍后卸载
npx -y context-gatekeeper-cli uninstall --all
```

支持的智能体：`cursor`、`claude-desktop`、`cline`、`continue`、`claude-code`。
加 `--local` 改为写入项目级配置（如 `./.cursor/mcp.json`）；`claude-desktop` 始终只能全局。

### 2. 手动配置（进阶）

如果想自己写 JSON，所有智能体都接受同一启动命令（`npx -y context-gatekeeper`）。

**Cursor**（`.cursor/mcp.json`）：
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "npx",
      "args": ["-y", "context-gatekeeper"]
    }
  }
}
```

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）：
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "npx",
      "args": ["-y", "context-gatekeeper"]
    }
  }
}
```

**Claude Code**（`.mcp.json`）：
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "npx",
      "args": ["-y", "context-gatekeeper"]
    }
  }
}
```

Windows 上 GUI 程序（Cursor、Claude Desktop）可能不继承 shell PATH。
若 `npx` 找不到，可用 `cmd /c` 包裹，或使用 `where npx` 返回的绝对路径。

### 3. 设置环境变量（可选）

```bash
# 认证（Watchdog 安全）
export CG_READ_TOKEN="your-read-only-token"
export CG_WRITE_TOKEN="your-write-token"
export CG_WATCHDOG_TOKEN="your-watchdog-token"

# 语义搜索（可选，默认为 TF-IDF）
export OPENAI_API_KEY="your-openai-key"
# 或使用 Cohere
export COHERE_API_KEY="your-cohere-key"
```

### 4. 开始使用

```typescript
// 存储一条约束
memory_store({
  content: "所有新文件必须使用 TypeScript 严格模式",
  priority: "constraint",
  project_tags: ["typescript", "code-style"]
});

// 检索相关记忆
memory_recall({
  query: "TypeScript 配置",
  limit: 5,
  search_mode: "hybrid"
});
```

## 功能特性

- **通用 MCP**：兼容所有 MCP 智能体
- **14+ 工具**：存储、检索、搜索、锚定、压缩、批量操作、智能检索、双模式执行
- **智能搜索**：关键词 + 语义（TF-IDF/OpenAI/Cohere）+ 混合 + BM25 搜索
- **优先级系统**：anchored > constraint > decision > preference > fact
- **自动去重**：基于 SHA256 哈希的重复检测
- **上下文压缩**：自动清理低优先级记忆
- **Watchdog 安全**：基于 Token 的工具权限控制
- **After-Chain 自动化**：工具执行后自动触发后续工具
- **纯 JavaScript**：无需原生编译（sql.js）
- **结构化日志**：JSON 格式输出，便于日志聚合

### Phase 1：AutoSkill 风格约束提取

从对话轮次中分析提取持久化约束：

```typescript
memory_extract({
  conversation_turns: [
    { role: "user", content: "我始终偏好使用 TypeScript 严格模式。" },
    { role: "assistant", content: "我将启用严格模式。" }
  ],
  extract_mode: "all",
  min_confidence: 0.5
});
```

### Phase 2：MemGate 风格智能检索

语义相似度 + 学习到的相关性模式：

```typescript
intelligent_recall({
  query: "API 实现指南",
  conversation_context: "构建新的 REST 服务",
  relevance_threshold: 0.07,
  enable_soft_guidance: true
});
```

### Phase 3：MPR 风格双模式执行

软引导 + 硬可接受性检查：

```typescript
dual_mode_execute({
  action: "使用 var 关键字定义这个变量",
  context: "编写 JavaScript 代码",
  mode: "dual",
  soft_guidance_style: "concise"
});
```

## 安装配置

### 一行命令通过 CLI 安装

包自带 `context-gatekeeper-cli` 二进制，会自动检测本机所有支持的 MCP 智能体并把配置写入对应的配置文件。具体命令见 [快速开始](#快速开始)。卸载时运行 `context-gatekeeper-cli uninstall`。

### 全局安装

```bash
npm install -g context-gatekeeper
npm run build
```

### 本地安装

```bash
npm install context-gatekeeper
npm run build
```

### 验证安装

```bash
node dist/mcp/server.js --help
```

### CLI 参考

`context-gatekeeper-cli` 支持的子命令：

```
context-gatekeeper-cli install [agent ...] [--all] [--local] [--cwd <dir>]
context-gatekeeper-cli uninstall [agent ...] [--all] [--local] [--cwd <dir>]
context-gatekeeper-cli status [--local] [--cwd <dir>]
context-gatekeeper-cli help
```

支持的智能体：`cursor`、`claude-desktop`、`cline`、`continue`、`claude-code`。

- `--all` 作用于所有智能体；没有传位置参数且没有 `--all` 时会报错。
- `--local` 写入项目级配置（如 `./.cursor/mcp.json`）；`claude-desktop` 仅全局，会被跳过。
- `--cwd <dir>` 覆盖 `--local` 使用的项目根目录，便于在 CI 或 pre-commit hook 中脚本化安装。

## 环境变量

### 认证（Watchdog 安全）

| 变量 | 描述 | 必填 |
|------|------|------|
| `CG_READ_TOKEN` | 只读操作的 Token | 否 |
| `CG_WRITE_TOKEN` | 读写操作的 Token | 否 |
| `CG_WATCHDOG_TOKEN` | 完全访问 Token（绕过所有限制） | 否 |

如果不设置 Token，服务器以宽容模式运行（所有工具可访问）。

### 向量嵌入提供商

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `COHERE_API_KEY` | Cohere API Key | - |
| `OPENAI_EMBEDDING_BASE_URL` | 自定义 OpenAI 兼容端点 | https://api.openai.com/v1 |
| `CG_EMBEDDING_PROVIDER` | 嵌入提供商：`tfidf`、`openai`、`cohere` | `tfidf` |

### 日志配置

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `CG_LOG_LEVEL` | 最小日志级别：`trace`、`debug`、`info`、`warn`、`error` | `info` |
| `CG_LOG_PRETTY` | 格式化 JSON 输出（`true` 或 `1`） | - |
| `CG_LOG_TO_FILE` | 启用文件日志（`true` 或 `1`） | - |
| `CG_LOG_FILE_PATH` | 自定义日志文件路径 | `context-gatekeeper.log` |

日志示例输出：
```json
{"level":"info","timestamp":"2026-06-25T14:00:00.000Z","message":"Tool completed","data":{"tool":"memory_store","latencyMs":42,"success":true}}
```

### 数据库配置

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `DATA_DIR` | 数据库文件位置 | 平台相关 |
| `CG_DB_FLUSH_INTERVAL_MS` | 定期刷新到磁盘的间隔（毫秒） | 30000 |

默认 `DATA_DIR` 位置：
- **Windows**：`%APPDATA%/context-gatekeeper`
- **macOS**：`~/Library/Application Support/context-gatekeeper`
- **Linux**：`~/.context-gatekeeper`

### 运行时配置

使用 `configure_llm` 工具在运行时设置 LLM：

```typescript
// 配置 OpenAI
configure_llm({
  provider: "openai",
  apiKey: "sk-...",
  model: "gpt-4"
});

// 配置 Ollama（本地）
configure_llm({
  provider: "ollama",
  model: "llama3.2",
  baseUrl: "http://localhost:11434"
});

// 配置 Anthropic
configure_llm({
  provider: "anthropic",
  apiKey: "sk-ant-...",
  model: "claude-3-haiku"
});
```

## 工具参考

### 记忆操作

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `memory_store` | 存储新记忆（带优先级） | write |
| `memory_recall` | 检索记忆（4 种搜索模式） | read |
| `memory_search` | 全文搜索记忆 | read |
| `memory_anchor` | 永久锚定记忆 | write |
| `memory_stats` | 获取记忆统计 | read |

### 批量操作

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `memory_store_batch` | 批量存储记忆 | write |
| `memory_delete_batch` | 批量删除记忆 | write |

### 上下文管理

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `memory_report_usage` | 报告 Token 使用量 | read |
| `context_compress` | 触发上下文压缩 | write |

### Phase 2 智能检索

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `intelligent_recall` | MemGate 风格相关性检索 | read |

### Phase 1 约束提取

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `memory_extract` | 从对话中提取约束 | read |

### Phase 3 双模式执行

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `dual_mode_execute` | 双模式验证操作 | read（软）/ write（硬） |

### 会话管理

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `session_store` | 存储会话数据 | write |
| `session_get` | 获取会话数据 | read |
| `session_list` | 列出会话键 | read |
| `session_delete` | 删除会话数据 | write |

### 配置与基础设施

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `configure_llm` | 配置 LLM 提供商 | write |
| `after_chain_configure` | 配置 After-Chain 编排 | write |
| `project_create` | 创建项目 | write |
| `db_flush` | 刷新内存数据库到磁盘 | write |
| `watchdog_manage` | 管理 Watchdog Token | write |

### GDPR 合规

| 工具 | 描述 | 所需权限 |
|------|------|----------|
| `gdpr_export` | 导出所有记忆为 JSON | write |
| `gdpr_delete` | 删除记忆 | write |
| `data_summary` | 获取数据摘要 | read |

### 搜索模式

`memory_recall` 工具支持 4 种搜索模式：

| 模式 | 描述 | 适用场景 |
|------|------|----------|
| `keyword` | 简单子字符串匹配 | 快速、精确匹配 |
| `semantic` | TF-IDF/OpenAI/Cohere 嵌入向量 | 基于语义的检索 |
| `hybrid` | 关键词 + 语义组合 | 平衡准确性 |
| `bm25` | Okapi BM25 排序 | 文本检索 |

### After-Chain 配置

```typescript
// 列出所有链
after_chain_configure({ action: "list_chains" });

// 禁用某个链
after_chain_configure({
  action: "toggle_chain",
  chain_name: "store-then-extract",
  enabled: false
});

// 注册自定义链
after_chain_configure({
  action: "register_chain",
  chain_config: {
    name: "store-then-recall",
    triggerTool: "memory_store",
    followupTool: "memory_recall",
    async: true
  }
});
```

## 跨智能体兼容性测试

除了单元测试，Context Gatekeeper 还附带一个端到端兼容性测试框架，在**与每个受支持的智能体运行时完全一致的 JSON-RPC 契约**下验证 MCP 服务器的行为。

### 测试范围

针对每个受支持的智能体，框架对全新 spawn 的 MCP 服务器进程执行四类场景：

| 类别 | 覆盖内容 | 重要性 |
|------|---------|--------|
| **协议握手** | `initialize` + `tools/list` + 读工具调用 | 确认 MCP 服务器能启动、暴露 24 个工具、正确响应 JSON-RPC |
| **CRUD** | `memory_store` -> `memory_recall` 往返、4 种搜索模式（`keyword`、`semantic`、`hybrid`、`auto`）、`memory_delete_batch`、`memory_anchor` | 验证智能体 stdio 传输下的核心存储路径 |
| **After-Chain** | `after_chain_configure` list/toggle + `memory_store` 触发 `memory_extract` 后续 | 确认进程内链式执行器在跨智能体场景下正确连接 |
| **Watchdog** | 4x4 权限矩阵：`no-token-strict`、`read-token`、`write-token`、`watchdog-token` 对读写探针 | 确保 Token 强制符合安全模型 |

### 受支持的智能体

- **Cursor** - 使用 `.cursor/mcp.json` 配置格式
- **Claude Desktop** - 使用 `claude_desktop_config.json` 配置格式
- **Cline** - VSCode workspace MCP 服务器配置
- **Continue.dev** - 使用 `experimental.modelContextProtocolServers` 配置格式
- **Claude Code** - 使用 `.mcp.json` 配置格式

### 运行测试

```bash
# 对全部 5 个智能体运行
npm run test:agents

# 对单个智能体运行
npm run test:agents -- cursor

# 对子集运行
npm run test:agents -- cursor cline claude-code
```

### 工作原理

每个适配器将智能体的精确 MCP 配置 JSON 写入临时目录，然后使用智能体运行时使用的相同 `command` + `args` spawn MCP 服务器。框架通过 stdio 发送真实的 MCP JSON-RPC 消息 - 与 Cursor、Claude Desktop 等内部使用的线协议完全相同。

关键设计选择：

- **每个场景一个进程**：每个测试用例 spawn 新的 MCP 服务器，因此失败指向具体场景，而非共享状态
- **隔离的 `DATA_DIR`**：每个智能体拥有独立的数据库目录，消除跨测试污染
- **通过环境变量注入 Token**：`CG_READ_TOKEN`、`CG_WRITE_TOKEN`、`CG_WATCHDOG_TOKEN` 作为环境变量传递，与生产部署一致
- **两种报告格式**：JSON 用于 CI 集成，Markdown 用于人工审查

### 报告输出

运行结束后，`scripts/reports/` 下生成两个文件：

```
scripts/reports/report-<timestamp>.json   # 机器可读
scripts/reports/report-<timestamp>.md     # 人类可读
```

Markdown 报告按智能体分组：

```
## cursor
Status: 14/14 passed

| Tool | Success | Latency (ms) | Error |
|------|---------|--------------|-------|
| initialize+memory_stats | OK | 528 |  |
| memory_store | OK | 9 |  |
...
```

### 运行示例

```
[cursor] handshake ... handshakeOk=true tools=24 sampleOk=true 528ms
[cursor] CRUD ... 8/8 scenarios passed (2508ms)
[cursor] after-chain ... allOk=true 479ms
[cursor] watchdog ... 4/4 cells ok (9985ms)

[cross-agent-test] Summary:
  Total:  70
  Passed: 70
  Failed: 0
```

### 添加新智能体

1. 创建 `scripts/agents/my-agent.ts`，继承 `BaseAgentAdapter`
2. 实现 `name` 和 `buildSpawnCommand()`（或重写 `spawnAgent()`）
3. 添加静态 `buildMcpConfig(mcpBin)` 返回智能体的精确配置格式
4. 在 `scripts/cross-agent-test.ts` 注册适配器

框架通过 `buildAdapters()` 自动接入任何新适配器。

## 架构设计

### 系统概览

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP 智能体（Cursor / Claude / Cline / Continue / Claude Code） │
└─────────────────────────┬───────────────────────────────────────┘
  │ MCP 协议
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Context Gatekeeper MCP 服务器 │
│ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Watchdog 安全 │ │
│ │ Token 验证 → 权限检查 → 工具执行 │ │
│ └──────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│ │ After-Chain │ │ LLM │ │ 嵌入向量提供商 │ │
│ │ 执行器 │ │ 服务 │ │ (TF-IDF/OpenAI/Cohere) │ │
│ └─────────────┘ └─────────────┘ └─────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 记忆服务 / 约束提取器 / 智能检索 / 双模式执行 │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ SQLite 数据库（sql.js） │
│ WAL 模式 + 定期刷新 │
└─────────────────────────────────────────────────────────────────┘
```

### Watchdog 架构

Watchdog 安全模型提供基于 Token 的访问控制：

```
┌──────────────────────────────────────────────────────────────────┐
│ Token 类型： │
├──────────────────────────────────────────────────────────────────┤
│ ┌────────────┬────────────┬──────────────────────┐ │
│ │ read │ write │ watchdog │ │
│ ├────────────┼────────────┼──────────────────────┤ │
│ │ recall │ store │ 所有操作 │ │
│ │ search │ anchor │ （绕过所有 │ │
│ │ stats │ compress │ 限制） │ │
│ │ intelligent│ batch │ │ │
│ │ recall │ delete │ │ │
│ │ （软模式）│ create │ │ │
│ └────────────┴────────────┴──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── mcp/              # MCP 服务器实现
│   ├── server.ts     # 主入口
│   └── tools/        # 工具实现
│       ├── memory-store.ts
│       ├── memory-recall.ts
│       ├── memory-extract.ts     # Phase 1: AutoSkill
│       ├── intelligent-recall.ts  # Phase 2: MemGate
│       ├── dual-mode-execute.ts   # Phase 3: MPR
│       └── ...
├── schema/           # 数据库 Schema 和操作
├── services/         # 业务逻辑
│   ├── embedding-provider.ts # 多提供商支持
│   ├── llm.ts       # LLM 总结
│   └── compressor/  # 上下文压缩
├── utils/
│   ├── db.ts         # 数据库包装（sql.js）
│   ├── watchdog.ts   # 基于 Token 的安全
│   ├── after-chain.ts # 工具链编排
│   └── logger.ts     # 结构化 JSON 日志
└── models/          # 类型定义
```

## 故障排查

### "Permission denied" 错误

**原因**：使用只读 Token 调用写操作工具。

**解决方案**：
1. 检查智能体使用的 Token 类型
2. 升级到写操作 Token
3. 或使用 watchdog Token 获取完全访问权限

### "Database not initialized" 错误

**原因**：数据库在使用前未正确初始化。

**解决方案**：
```bash
export DATA_DIR="/path/to/writable/directory"
```

### 记忆去重不生效

**原因**：语义相同的记忆内容产生了不同的哈希值。

**解决方案**：
1. 使用完全相同的措辞存储重复记忆
2. 哈希基于标准化后的内容计算——细微差异会产生不同哈希

### 搜索返回意外结果

**原因**：搜索模式或嵌入提供商选择不当。

**解决方案**：
```typescript
// 精确匹配，使用 keyword 模式
memory_recall({
  query: "精确短语",
  search_mode: "keyword"
});

// 语义检索，使用 hybrid 或 semantic
memory_recall({
  query: "认证相关",
  search_mode: "hybrid"
});
```

### LLM 提取失败

**原因**：LLM 提供商未配置或 API 错误。

**解决方案**：
```typescript
// 先配置 LLM
configure_llm({
  provider: "openai",
  apiKey: "your-key",
  model: "gpt-3.5-turbo"
});

// LLM 不可用时，回退到规则提取
memory_extract({
  conversation_turns: [...],
  min_confidence: 0.3 // 降低阈值
});
```

## 最佳实践

### 优先级分配

| 优先级 | 使用场景 |
|--------|----------|
| `anchored` | 绝对不能违反的关键规则 |
| `constraint` | API 约定、编码规范 |
| `decision` | 架构选择、已确定的方案 |
| `preference` | 代码风格、工作流偏好 |
| `fact` | 项目详情、历史上下文 |

```typescript
// 好：关键的全项目约束
memory_store({
  content: "永远不要直接提交到 main 分支",
  priority: "anchored",
  project_tags: ["git-workflow"]
});

// 避免：常识性知识
memory_store({
  content: "JavaScript 使用 camelCase",
  priority: "fact"
});
```

### 项目标签策略

使用一致的、分层的标签：

```typescript
memory_store({
  content: "新功能使用 React 18",
  project_tags: ["frontend:react", "version:18"]
});
```

### Token 预算管理

定期监控和压缩上下文：

```typescript
// 接近上限时报告 Token 使用量
memory_report_usage({
  used_tokens: 85000,
  max_tokens: 100000
});

// 需要时触发压缩
context_compress({
  target_ratio: 0.6 // 目标占用上限的 60%
});
```

### Watchdog Token 安全

遵循最小权限原则：

```bash
# 主智能体：只读 Token
CG_READ_TOKEN="agent-read-token"

# 管理员智能体：写 Token
CG_WRITE_TOKEN="admin-write-token"

# 紧急情况：watchdog Token（仅限可信进程）
CG_WATCHDOG_TOKEN="emergency-token"
```

### 搜索模式选择

| 场景 | 推荐模式 |
|------|----------|
| 精确代码片段 | `keyword` |
| 已知约束文本 | `keyword` |
| 通用概念检索 | `semantic` 或 `hybrid` |
| 多样化知识检索 | `bm25` |
| 意图驱动的检索 | `hybrid` |

### After-Chain 使用

启用自动工具链以减少手动工具调用：

```typescript
// 存储记忆后自动提取约束
after_chain_configure({
  action: "toggle_chain",
  chain_name: "store-then-extract",
  enabled: true
});
```

## 开发指南

```bash
# 安装依赖
npm install

# 构建 TypeScript
npm run build

# 运行单元测试
npm test

# 跨智能体兼容性测试（在所有受支持的智能体中 spawn MCP 服务器）
npm run test:agents

# 针对单个智能体的跨智能体测试
npm run test:agents -- cursor

# 监视模式（自动重构建）
npm run dev

# 类型检查
npm run lint
```

详情参见[跨智能体兼容性测试](#跨智能体兼容性测试)，了解 `scripts/agents/` 和 `scripts/tests/` 下的测试框架。

## 技术灵感

- **AutoSkill**：从对话中提取经验的技能
- **MemGate**：推理时通过学习到的相关性过滤记忆
- **Meta-Policy Reflexion (MPR)**：软引导 + 硬可接受性检查

## 许可证

MIT
