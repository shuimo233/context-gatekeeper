# Context Gatekeeper

MCP-based context management service for AI agents - keeps agents in the **100k smart zone**.

Universal installation - works with **all MCP-compatible agents**: Cursor, Claude Desktop, Cline, Continue, Claude Code, and more.

> **Note**: 中文用户请参考 [README.zh.md](README.zh.md)

## Quick Start

### Installation

```bash
# Global installation (recommended)
npm install -g context-gatekeeper

# Build
npm run build
```

### First Use

1. **Configure your MCP agent** (see [Installation](#installation) below)

2. **Set up environment variables** (optional but recommended):

```bash
# Required for token-based permission control (recommended)
export CG_READ_TOKEN="your-read-only-token"
export CG_WRITE_TOKEN="your-write-token"
export CG_WATCHDOG_TOKEN="your-watchdog-token" # Full access token

# For semantic search (optional - defaults to TF-IDF)
export OPENAI_API_KEY="your-openai-key"
# or
export COHERE_API_KEY="your-cohere-key"

# Database location (optional)
export DATA_DIR="/path/to/data"
```

3. **Restart your agent** to load the MCP server

4. **Store your first memory**:

```typescript
// Store a project constraint
memory_store({
  content: "Use TypeScript strict mode for all new files",
  priority: "constraint",
  project_tags: ["typescript", "code-style"]
});

// Recall relevant memories
memory_recall({
  query: "TypeScript configuration",
  limit: 5,
  search_mode: "hybrid"
});
```

## Features

- **Universal MCP**: Works with all MCP-compatible agents
- **14+ Tools**: Store, recall, search, anchor, compress, batch operations, intelligent recall, dual-mode execution
- **Smart Search**: Keyword + semantic (TF-IDF/OpenAI/Cohere) + hybrid search
- **Priority System**: anchored > constraint > decision > preference > fact
- **Auto Deduplication**: SHA256 hash-based duplicate detection
- **Context Compression**: Automatic cleanup of low-priority memories
- **Watchdog Security**: Token-based permission control for tools
- **After-Chain Automation**: Auto-trigger tools after other tools complete
- **Pure JavaScript**: No native compilation required (sql.js)

### Phase 1: AutoSkill-Style Constraint Extraction

- Analyzes conversation turns to extract durable constraints
- Only processes user messages (ignores one-shot requests)
- Identifies preferences, workflows, and rules
- Confidence scoring for extracted constraints

### Phase 2: MemGate-Style Intelligent Recall

- Semantic similarity + learned relevance patterns
- MLP-inspired interaction scoring
- Configurable relevance threshold (default 0.07)
- Soft guidance context generation

### Phase 3: MPR-Style Dual-Mode Execution

- Soft guidance: Memory injection for better decisions
- Hard admissibility: Constraint validation before actions
- Dual mode: Combines both approaches
- Violation detection with suggestions

## Installation

### 1. Install Package

```bash
# Global installation (recommended)
npm install -g context-gatekeeper

# Or local installation
npm install context-gatekeeper
npm run build
```

### 2. Configure Your MCP Agent

#### Cursor

Add to `.cursor/mcp.json`:

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

For global installation, find the path with:
```bash
npm root -g
```

#### Claude Desktop (macOS/Windows)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Add to your MCP settings:

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
# Add to ~/.claude/settings.json or project .mcp.json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": ["<path-to>/node_modules/context-gatekeeper/dist/mcp/server.js"]
    }
  }
}
```

### 3. Restart Your Agent

After configuration, restart your MCP agent to load the server.

## Configuration

### Environment Variables

#### Authentication (Watchdog Security)

| Variable | Description | Required |
|----------|-------------|----------|
| `CG_READ_TOKEN` | Token for read-only operations | No |
| `CG_WRITE_TOKEN` | Token for read/write operations | No |
| `CG_WATCHDOG_TOKEN` | Token with full access (bypasses restrictions) | No |

If no tokens are set, the server operates in permissive mode (all tools accessible).

#### Embedding Providers

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | - |
| `COHERE_API_KEY` | Cohere API key for embeddings | - |
| `OPENAI_EMBEDDING_BASE_URL` | Custom OpenAI-compatible endpoint | https://api.openai.com/v1 |
| `CG_EMBEDDING_PROVIDER` | Embedding provider: `tfidf`, `openai`, `cohere` | `tfidf` |

#### LLM Summarization

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for summarization | - |
| `ANTHROPIC_API_KEY` | Anthropic API key for summarization | - |

Note: LLM provider is configured via the `configure_llm` tool at runtime, not environment variables.

#### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_DIR` | Database file location | Platform-specific |
| `CG_DB_FLUSH_INTERVAL_MS` | How often to flush to disk (ms) | 30000 |

Default `DATA_DIR` locations:
- **Windows**: `%APPDATA%/context-gatekeeper`
- **macOS**: `~/Library/Application Support/context-gatekeeper`
- **Linux**: `~/.context-gatekeeper`

#### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `CG_LOG_LEVEL` | Minimum log level: `trace`, `debug`, `info`, `warn`, `error` | `info` |
| `CG_LOG_PRETTY` | Pretty-print JSON output (`true` or `1`) | - |
| `CG_LOG_TO_FILE` | Enable file-based logging (`true` or `1`) | - |
| `CG_LOG_FILE_PATH` | Custom log file path | `context-gatekeeper.log` |

### Runtime Configuration

Use the `configure_llm` tool to set LLM settings at runtime:

```typescript
// Configure OpenAI
configure_llm({
  provider: "openai",
  apiKey: "sk-...",
  model: "gpt-4",
  baseUrl: "https://api.openai.com/v1"
});

// Configure Ollama (local)
configure_llm({
  provider: "ollama",
  model: "llama3.2",
  baseUrl: "http://localhost:11434/api/generate"
});

// Configure Anthropic
configure_llm({
  provider: "anthropic",
  apiKey: "sk-ant-...",
  model: "claude-3-haiku"
});
```

## Tools Reference

### Memory Operations

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `memory_store` | `content`, `priority`, `project_tags?` | Store a new memory | write |
| `memory_recall` | `query`, `limit?`, `search_mode?` | Recall memories | read |
| `memory_search` | `query`, `limit?`, `project_tags?` | Full-text search | read |
| `memory_anchor` | `memory_id`, `permanent?` | Anchor memory permanently | write |
| `memory_stats` | - | Get memory statistics | read |

### Batch Operations

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `memory_store_batch` | `memories[]` | Batch store memories | write |
| `memory_delete_batch` | `memory_ids[]` | Batch delete memories | write |

### Context Management

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `memory_report_usage` | `used_tokens`, `max_tokens` | Report token usage | read |
| `context_compress` | `target_ratio?` | Trigger context compression | write |

### Intelligent Recall (Phase 2)

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `intelligent_recall` | `query`, `conversation_context?`, `relevance_threshold?`, `return_mode?`, `enable_soft_guidance?`, `enable_hard_check?` | MemGate-style relevance recall | read |

### Constraint Extraction (Phase 1)

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `memory_extract` | `conversation_turns[]`, `extract_mode?`, `min_confidence?` | Extract constraints from conversations | read |

### Dual-Mode Execution (Phase 3)

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `dual_mode_execute` | `action`, `context?`, `mode?`, `soft_guidance_style?`, `hard_threshold?` | Validate actions with dual mode | read (soft) / write (hard) |

### Session Management

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `session_store` | `key`, `value`, `scope?`, `ttl?` | Store session data | write |
| `session_get` | `key`, `scope?` | Get session data | read |
| `session_list` | `scope?` | List session keys | read |
| `session_delete` | `key`, `scope?` | Delete session data | write |

### Configuration

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `configure_llm` | `provider`, `apiKey?`, `model?`, `baseUrl?` | Configure LLM provider | write |
| `after_chain_configure` | `action`, `chain_name?`, `enabled?` | Configure after-chain orchestration | write |
| `project_create` | `name`, `description?` | Create a project | write |

### GDPR Compliance

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `gdpr_export` | `user_id?` | Export all memories as JSON | write |
| `gdpr_delete` | `memory_id?`, `user_id?` | Delete memories | write |
| `data_summary` | `user_id?` | Get data summary | read |

### Infrastructure

| Tool | Parameters | Description | Required Token |
|------|------------|-------------|----------------|
| `db_flush` | - | Flush in-memory DB to disk | write |
| `watchdog_manage` | `action`, `token_type?` | Manage watchdog tokens | write |

### Search Modes

The `memory_recall` tool supports four search modes:

| Mode | Description | Best For |
|------|-------------|----------|
| `keyword` | Simple substring matching | Fast, exact matches |
| `semantic` | TF-IDF/OpenAI/Cohere embeddings | Meaning-based recall |
| `hybrid` | Combines keyword + semantic | Balanced accuracy |
| `bm25` | Okapi BM25 ranking | Text retrieval |

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP Agent │
│ (Cursor / Claude / Cline / Continue / Claude Code) │
└─────────────────────────┬───────────────────────────────────────┘
  │ MCP Protocol
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Context Gatekeeper MCP Server │
│ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Watchdog Security │ │
│ │ Token Validation → Permission Check → Tool Execution │ │
│ └──────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│ │ After-Chain │ │ LLM │ │ Embedding Provider │ │
│ │ Executor │ │ Service │ │ (TF-IDF/OpenAI/Cohere) │ │
│ └─────────────┘ └─────────────┘ └─────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Memory Service / Constraint Extractor │ │
│ │ / Intelligent Recall / Dual-Mode │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ SQLite Database (sql.js) │
│ WAL mode + periodic flush │
└─────────────────────────────────────────────────────────────────┘
```

### Watchdog Architecture

The Watchdog security model provides token-based access control:

```
┌──────────────────────────────────────────────────────────────────┐
│ Token Types: │
├──────────────────────────────────────────────────────────────────┤
│ ┌────────────┬────────────┬──────────────────────┐ │
│ │ read │ write │ watchdog │ │
│ ├────────────┼────────────┼──────────────────────┤ │
│ │ recall │ store │ ALL operations │ │
│ │ search │ anchor │ (bypass all │ │
│ │ stats │ compress │ restrictions) │ │
│ │ intelligent│ batch │ │ │
│ │ recall │ delete │ │ │
│ │ (soft mode)│ create │ │ │
│ └────────────┴────────────┴──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### After-Chain Flow

After-Chain enables automatic tool chaining after tool execution:

```
┌──────────────────────────────────────────────────────────────────┐
│ After-Chain Predefined Chains: │
├──────────────────────────────────────────────────────────────────┤
│ │
│ store-then-extract: │
│   memory_store ──▶ memory_extract │
│ │
│ batch-store-then-extract: │
│   memory_store_batch ──▶ memory_extract │
│ │
│ session-store-then-extract: │
│   session_store ──▶ memory_extract │
│ │
│ Agents can configure chains at runtime via after_chain_configure │
└──────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── mcp/              # MCP server implementation
│   ├── server.ts     # Main MCP server entry
│   └── tools/        # Tool implementations
│       ├── memory-store.ts
│       ├── memory-recall.ts
│       ├── memory-extract.ts     # Phase 1: AutoSkill
│       ├── intelligent-recall.ts # Phase 2: MemGate
│       ├── dual-mode-execute.ts  # Phase 3: MPR
│       └── ...
├── schema/           # Database schema & operations
├── services/         # Business logic
│   ├── embedding-provider.ts # Multi-provider support
│   ├── llm.ts       # LLM summarization
│   └── compressor/  # Context compression
├── utils/
│   ├── db.ts         # Database wrapper (sql.js)
│   ├── watchdog.ts   # Token-based security
│   ├── after-chain.ts # Tool chaining
│   └── logger.ts     # Structured JSON logging
└── models/          # Type definitions
```

## Priority System

Memories are assigned priorities that determine retention during compression:

| Priority | Description | Retention Score | Use Cases |
|----------|-------------|----------------|-----------|
| `anchored` | Permanent (never compressed) | 1.0 | Critical rules, project constraints |
| `constraint` | Rules and requirements | 0.8 | API conventions, code standards |
| `decision` | Design decisions | 0.6 | Architecture choices, selected approaches |
| `preference` | User preferences | 0.4 | Coding style, workflow preferences |
| `fact` | Facts and context | 0.2 | Project details, historical context |

## Usage Examples

### Example 1: Project Onboarding

Onboarding a new project with constraints:

```typescript
// Store project-level constraints
memory_store({
  content: "Project uses Monorepo with pnpm workspaces",
  priority: "fact",
  project_tags: ["project-setup"]
});

memory_store({
  content: "Always run tests before committing (pre-commit hook enforces)",
  priority: "constraint",
  project_tags: ["workflow"]
});

// Extract from initial conversation
memory_extract({
  conversation_turns: [
    { role: "user", content: "We use pnpm workspaces for this monorepo" },
    { role: "assistant", content: "I'll configure the workspace setup" },
    { role: "user", content: "And we prefer using tRPC for API communication" }
  ],
  extract_mode: "all",
  min_confidence: 0.6
});
```

### Example 2: Intelligent Recall for Code Generation

Using intelligent recall when generating code:

```typescript
// Before writing code, recall relevant context
const relevant = intelligent_recall({
  query: "API authentication patterns",
  conversation_context: "Building a new REST endpoint for user profile",
  relevance_threshold: 0.05,
  return_mode: "all",
  enable_soft_guidance: true,
  enable_hard_check: true
});
```

### Example 3: Dual-Mode Action Validation

Validating an action against stored constraints:

```typescript
// Validate before executing an action
const validation = dual_mode_execute({
  action: "Use `var` keyword for this loop variable",
  context: "Writing a for loop",
  mode: "dual",
  soft_guidance_style: "concise",
  hard_threshold: 0.5
});

// Response includes:
// - soft_guidance: Suggestions for better approach
// - hard_admissibility: Whether action passes/fails constraints
// - violations: List of broken rules with suggestions
```

### Example 4: After-Chain Configuration

```typescript
// List all chains
after_chain_configure({ action: "list_chains" });

// Disable a chain
after_chain_configure({
  action: "toggle_chain",
  chain_name: "store-then-extract",
  enabled: false
});

// Register a custom chain
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

## Troubleshooting

### "Permission denied" Errors

**Cause**: You're using a read-only token to call a write tool.

**Solution**:
1. Check which token type your agent is using
2. Upgrade to a write token for write operations
3. Or use the watchdog token for full access

### "Database not initialized" Errors

**Cause**: The database wasn't properly initialized before use.

**Solution**:
```bash
# Ensure DATA_DIR exists and is writable
export DATA_DIR="/path/to/writable/directory"
```

### Memory Deduplication Not Working

**Cause**: Different content hashes for semantically identical memories.

**Solution**:
1. Use identical wording for duplicate memories
2. The hash is SHA256 of normalized content - slight variations create different hashes

### Search Returning Unexpected Results

**Cause**: Wrong search mode or embedding provider.

**Solution**:
```typescript
// For exact matches, use keyword mode
memory_recall({
  query: "exact phrase here",
  search_mode: "keyword"
});

// For semantic meaning, use hybrid or semantic
memory_recall({
  query: "authentication",
  search_mode: "hybrid"
});
```

### LLM Extraction Failures

**Cause**: LLM provider not configured or API errors.

**Solution**:
```typescript
// Configure LLM first
configure_llm({
  provider: "openai",
  apiKey: "your-key",
  model: "gpt-3.5-turbo"
});

// If LLM is unavailable, falls back to rule-based extraction
memory_extract({
  conversation_turns: [...],
  min_confidence: 0.3 // Lower threshold
});
```

## Best Practices

### Using Anchored Memories

Anchor memories sparingly - they persist forever:

```typescript
// Good: Critical project-wide constraints
memory_store({
  content: "NEVER commit directly to main branch",
  priority: "anchored",
  project_tags: ["git-workflow"]
});

// Avoid: Common knowledge doesn't need anchoring
memory_store({
  content: "JavaScript uses camelCase", // Don't anchor obvious facts
  priority: "fact"
});
```

### Project Tagging Strategy

Use consistent, hierarchical tags:

```typescript
// Pattern: category/subcategory
memory_store({
  content: "Use React 18 for new features",
  project_tags: ["frontend:react", "version:18"]
});
```

### Token Budget Management

Monitor and compress context regularly:

```typescript
// Report token usage when near limits
memory_report_usage({
  used_tokens: 85000,
  max_tokens: 100000
});

// Trigger compression when needed
context_compress({
  target_ratio: 0.6 // Target 60% of max tokens
});
```

### Watchdog Token Security

Use the principle of least privilege:

```typescript
// Main agent: read-only token
CG_READ_TOKEN="agent-read-token"

// Admin agent: write token
CG_WRITE_TOKEN="admin-write-token"

// Emergency: watchdog token (only for trusted processes)
CG_WATCHDOG_TOKEN="emergency-token"
```

### When to Use Which Search Mode

| Scenario | Recommended Mode |
|----------|------------------|
| Exact code snippet | `keyword` |
| Known constraint text | `keyword` |
| General concept recall | `semantic` or `hybrid` |
| Diverse knowledge retrieval | `bm25` |
| Precise term matching | `keyword` |
| Intent-based recall | `hybrid` |

## Development

```bash
# Clone and install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode (auto-rebuild on changes)
npm run dev

# Type checking
npm run lint
```

## Inspired By

- **AutoSkill**: Experience-driven skill extraction from conversations
- **MemGate**: Inference-time memory filtering with learned relevance
- **Meta-Policy Reflexion (MPR)**: Soft guidance + hard admissibility checks

## License

MIT
