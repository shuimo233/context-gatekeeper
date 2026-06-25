# Context Gatekeeper

MCP 上下文管理服务 - 让 AI Agent 始终保持在 **100k 聪明区** 高效运行。

通用安装 - 兼容 **所有 MCP 智能体**: Cursor, Claude Desktop, Cline, Continue, Claude Code 等。

## 快速开始

```bash
# 安装
npm install -g context-gatekeeper

# 构建
npm run build

# 完成！配置到你的 MCP 智能体（见下文）
```

## 功能特性

- **通用 MCP**: 兼容所有 MCP 智能体
- **11 个工具**: 存储、检索、搜索、锚定、压缩、批量操作
- **智能搜索**: 关键词 + 语义（TF-IDF）+ 混合搜索
- **优先级系统**: anchored > constraint > decision > preference > fact
- **自动去重**: 基于 SHA256 哈希去重
- **上下文压缩**: 自动清理低优先级记忆
- **纯 JavaScript**: 无需原生编译 (sql.js)

## MCP 工具

| 工具 | 描述 |
|------|------|
| `memory_store` | 存储新记忆（带优先级） |
| `memory_recall` | 检索记忆（4 种搜索模式） |
| `memory_search` | 搜索记忆 |
| `memory_anchor` | 永久锚定记忆 |
| `memory_report_usage` | 报告 token 使用量 |
| `context_compress` | 触发压缩 |
| `memory_store_batch` | 批量存储记忆 |
| `memory_delete_batch` | 批量删除记忆 |
| `configure_llm` | 配置 LLM 提供者 |
| `memory_stats` | 获取统计信息 |
| `project_create` | 创建项目 |

## 安装步骤

### 1. 安装包

```bash
# 全局安装（推荐）
npm install -g context-gatekeeper

# 或本地安装
npm install context-gatekeeper
npm run build
```

### 2. 配置你的 MCP 智能体

#### Cursor

添加到 `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": ["<path-to>/node_modules/context-gatekeeper/dist/mcp/server.js"]
    }
  }
}
```

全局安装路径查询:
```bash
npm root -g
```

#### Claude Desktop (macOS/Windows)

添加到 `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": ["<path-to>/node_modules/context-gatekeeper/dist/mcp/server.js"]
    }
  }
}
```

#### Cline / Continue

添加到 MCP 设置:

```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": ["<path-to>/node_modules/context-gatekeeper/dist/mcp/server.js"]
    }
  }
}
```

#### Claude Code

```bash
# 添加到 ~/.claude/settings.json 或项目 .mcp.json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": ["<path-to>/node_modules/context-gatekeeper/dist/mcp/server.js"]
    }
  }
}
```

### 3. 重启你的智能体

配置完成后，重启 MCP 智能体以加载服务器。

## 使用示例

```typescript
// 存储约束
memory_store({
  content: "API 认证使用 Bearer Token",
  priority: "constraint",
  project_tags: ["auth", "security"]
});

// 检索相关记忆
memory_recall({
  query: "认证 token",
  limit: 5,
  search_mode: "hybrid"
});

// 报告 token 使用量
memory_report_usage({
  used_tokens: 60000,
  max_tokens: 100000
});

// 压缩上下文
context_compress({
  target_ratio: 0.6
});
```

## 优先级系统

| 优先级 | 描述 | 保留系数 |
|--------|------|----------|
| anchored | 锚定（永久保留） | 1.0 |
| constraint | 约束（如：使用 Bearer Token） | 0.8 |
| decision | 决策（如：选择 PostgreSQL） | 0.6 |
| preference | 偏好（如：喜欢暗色主题） | 0.4 |
| fact | 事实（如：项目路径） | 0.2 |

## 开发

```bash
# 克隆并构建
npm install
npm run build

# 测试
npm test

# 监视模式
npm run dev
```

## 架构

```
src/
├── mcp/              # MCP 服务器和工具
├── schema/           # 数据库操作
├── services/         # 业务逻辑
├── models/          # 类型定义
└── utils/           # 工具函数
```

## License

MIT
