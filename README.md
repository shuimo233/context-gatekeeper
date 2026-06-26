# Context Gatekeeper

MCP-based context management service for AI agents - keeps agents in the **100k token smart zone**.

Universal installation - works with **all MCP-compatible agents**: Cursor, Claude Desktop, Cline, Continue, Claude Code, and more.

> **Note**: 中文用户请参考 [README.zh.md](README.zh.md)

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Tools Reference](#tools-reference)
- [Cross-Agent Compatibility Tests](#cross-agent-compatibility-tests)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)
- [Development](#development)

## Quick Start

### 1. Install via the CLI

The CLI auto-detects every supported agent on your machine and writes the
right config block to each agent's expected config file. No manual JSON.

```bash
# Install to all detected agents (recommended)
npx -y context-gatekeeper-cli install --all

# Or pick specific agents
npx -y context-gatekeeper-cli install cursor claude-desktop claude-code

# See what the CLI would touch
npx -y context-gatekeeper-cli status

# Remove the entries later
npx -y context-gatekeeper-cli uninstall --all
```

Supported agents: `cursor`, `claude-desktop`, `cline`, `continue`, `claude-code`.
Pass `--local` to write project-level configs (e.g. `./.cursor/mcp.json`) instead
of the global ones. `claude-desktop` is always global-only.

### 2. Manual Configuration (advanced)

If you prefer to write the JSON yourself, every supported agent accepts
the same launch command (`npx -y context-gatekeeper`).

**Cursor** (`.cursor/mcp.json`):
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

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Claude Code** (`.mcp.json`):
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

On Windows, GUI apps (Cursor, Claude Desktop) may not inherit shell PATH.
If `npx` cannot be found, either wrap with `cmd /c` or use the absolute
path returned by `where npx`.

### 3. Set Environment Variables (Optional)

```bash
# Authentication (Watchdog Security)
export CG_READ_TOKEN="your-read-only-token"
export CG_WRITE_TOKEN="your-write-token"
export CG_WATCHDOG_TOKEN="your-watchdog-token"

# For semantic search (optional - defaults to TF-IDF)
export OPENAI_API_KEY="your-openai-key"
# or
export COHERE_API_KEY="your-cohere-key"
```

### 4. Use It

```typescript
// Store a constraint
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
- **Smart Search**: Keyword + semantic (TF-IDF/OpenAI/Cohere) + hybrid + BM25 search
- **Priority System**: anchored > constraint > decision > preference > fact
- **Auto Deduplication**: SHA256 hash-based duplicate detection
- **Context Compression**: Automatic cleanup of low-priority memories
- **Watchdog Security**: Token-based permission control for tools
- **After-Chain Automation**: Auto-trigger tools after other tools complete
- **Pure JavaScript**: No native compilation required (sql.js)
- **Structured Logging**: JSON output for log aggregation

### Phase 1: AutoSkill-Style Constraint Extraction

Analyzes conversation turns to extract durable constraints:

```typescript
memory_extract({
  conversation_turns: [
    { role: "user", content: "I always prefer using TypeScript strict mode." },
    { role: "assistant", content: "I'll enable strict mode." }
  ],
  extract_mode: "all",
  min_confidence: 0.5
});
```

### Phase 2: MemGate-Style Intelligent Recall

Semantic similarity + learned relevance patterns:

```typescript
intelligent_recall({
  query: "API implementation guidelines",
  conversation_context: "Building a new REST service",
  relevance_threshold: 0.07,
  enable_soft_guidance: true
});
```

### Phase 3: MPR-Style Dual-Mode Execution

Soft guidance + hard admissibility checks:

```typescript
dual_mode_execute({
  action: "Use var keyword for this variable",
  context: "Writing JavaScript code",
  mode: "dual",
  soft_guidance_style: "concise"
});
```

## Installation

### One-command install via the CLI

The package ships with a `context-gatekeeper-cli` binary that detects
every supported MCP agent on your machine and writes the right entry
into each agent's config file. See [Quick Start](#quick-start) above
for the commands. To uninstall, run `context-gatekeeper-cli uninstall`.

### Global Installation

```bash
npm install -g context-gatekeeper
npm run build
```

To find the global installation path:
```bash
npm root -g
```

### Local Installation

```bash
npm install context-gatekeeper
npm run build
```

### Verify Installation

```bash
node dist/mcp/server.js --help
```

### CLI Reference

The `context-gatekeeper-cli` command supports:

```
context-gatekeeper-cli install [agent ...] [--all] [--local] [--cwd <dir>]
context-gatekeeper-cli uninstall [agent ...] [--all] [--local] [--cwd <dir>]
context-gatekeeper-cli status [--local] [--cwd <dir>]
context-gatekeeper-cli help
```

Supported agents: `cursor`, `claude-desktop`, `cline`, `continue`, `claude-code`.

- `--all` targets every agent. With no positional args and no `--all`,
  the CLI prints an error.
- `--local` writes the project-level config (e.g. `./.cursor/mcp.json`)
  instead of the global one. `claude-desktop` is always global and is
  skipped under `--local`.
- `--cwd <dir>` overrides the project root used for `--local`. Useful
  for scripted setup in CI or pre-commit hooks.

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

#### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `CG_LOG_LEVEL` | Minimum log level: `trace`, `debug`, `info`, `warn`, `error` | `info` |
| `CG_LOG_PRETTY` | Pretty-print JSON output (`true` or `1`) | - |
| `CG_LOG_TO_FILE` | Enable file-based logging (`true` or `1`) | - |
| `CG_LOG_FILE_PATH` | Custom log file path | `context-gatekeeper.log` |

#### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_DIR` | Database file location | Platform-specific |
| `CG_DB_FLUSH_INTERVAL_MS` | How often to flush to disk (ms) | 30000 |

Default `DATA_DIR` locations:
- **Windows**: `%APPDATA%/context-gatekeeper`
- **macOS**: `~/Library/Application Support/context-gatekeeper`
- **Linux**: `~/.context-gatekeeper`

### Runtime Configuration

Use the `configure_llm` tool to set LLM settings at runtime:

```typescript
// Configure OpenAI
configure_llm({
  provider: "openai",
  apiKey: "sk-...",
  model: "gpt-4"
});

// Configure Ollama (local)
configure_llm({
  provider: "ollama",
  model: "llama3.2",
  baseUrl: "http://localhost:11434"
});
```

## Tools Reference

### Memory Operations

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with priority |
| `memory_recall` | Recall memories (4 search modes) |
| `memory_search` | Full-text search memories |
| `memory_anchor` | Anchor memory permanently |
| `memory_stats` | Get memory statistics |

### Batch Operations

| Tool | Description |
|------|-------------|
| `memory_store_batch` | Batch store memories |
| `memory_delete_batch` | Batch delete memories |

### Context Management

| Tool | Description |
|------|-------------|
| `memory_report_usage` | Report token usage |
| `context_compress` | Trigger context compression |

### Intelligent Recall (Phase 2)

| Tool | Description |
|------|-------------|
| `intelligent_recall` | MemGate-style relevance recall |

### Constraint Extraction (Phase 1)

| Tool | Description |
|------|-------------|
| `memory_extract` | Extract constraints from conversations |

### Dual-Mode Execution (Phase 3)

| Tool | Description |
|------|-------------|
| `dual_mode_execute` | Validate actions with dual mode |

### Session Management

| Tool | Description |
|------|-------------|
| `session_store` | Store session data |
| `session_get` | Get session data |
| `session_list` | List session keys |
| `session_delete` | Delete session data |

### Configuration & Infrastructure

| Tool | Description |
|------|-------------|
| `configure_llm` | Configure LLM provider |
| `after_chain_configure` | Configure after-chain orchestration |
| `project_create` | Create a project |
| `db_flush` | Flush in-memory DB to disk |
| `watchdog_manage` | Manage watchdog tokens |

### GDPR Compliance

| Tool | Description |
|------|-------------|
| `gdpr_export` | Export all memories as JSON |
| `gdpr_delete` | Delete memories |
| `data_summary` | Get data summary |

### Search Modes

The `memory_recall` tool supports four search modes:

| Mode | Description | Best For |
|------|-------------|----------|
| `keyword` | Simple substring matching | Fast, exact matches |
| `semantic` | TF-IDF/OpenAI/Cohere embeddings | Meaning-based recall |
| `hybrid` | Combines keyword + semantic | Balanced accuracy |
| `bm25` | Okapi BM25 ranking | Text retrieval |

### After-Chain Configuration

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

## Cross-Agent Compatibility Tests

Beyond unit tests, Context Gatekeeper ships with an end-to-end compatibility harness that verifies the MCP server behaves correctly under the **exact same JSON-RPC contract** that each supported agent runtime uses.

### What It Tests

For every supported agent, the harness exercises four scenario classes against a freshly spawned MCP server process:

| Class | Coverage | Why It Matters |
|-------|----------|----------------|
| **Handshake** | `initialize` + `tools/list` + a sample read tool call | Confirms the MCP server boots, advertises 24 tools, and answers JSON-RPC correctly |
| **CRUD** | `memory_store` -> `memory_recall` round-trip, all 4 search modes (`keyword`, `semantic`, `hybrid`, `auto`), `memory_delete_batch`, `memory_anchor` | Validates the core storage path works under the agent's stdio transport |
| **After-Chain** | `after_chain_configure` list/toggle + `memory_store` triggering `memory_extract` followup | Confirms the in-process chain executor wires correctly across agent boundaries |
| **Watchdog** | 4x4 permission matrix: `no-token-strict`, `read-token`, `write-token`, `watchdog-token` against read and write probes | Ensures token enforcement matches the security model |

### Supported Agents

- **Cursor** - uses `.cursor/mcp.json` shape
- **Claude Desktop** - uses `claude_desktop_config.json` shape
- **Cline** - VSCode workspace MCP server config
- **Continue.dev** - uses `experimental.modelContextProtocolServers` shape
- **Claude Code** - uses `.mcp.json` shape

### Running the Tests

```bash
# Run against all 5 agents
npm run test:agents

# Run against a single agent
npm run test:agents -- cursor

# Run against a subset
npm run test:agents -- cursor cline claude-code
```

### How It Works

Each adapter writes the agent's exact MCP config JSON to a temp directory, then spawns the MCP server using the same `command` + `args` that the agent runtime would use. The harness sends real MCP JSON-RPC messages over stdio - the same wire protocol Cursor, Claude Desktop, etc. use internally.

Key design choices:

- **One process per scenario**: every test case spawns a fresh MCP server, so failures point to a specific scenario, not shared state
- **Isolated `DATA_DIR`**: each agent gets its own database directory, eliminating cross-test contamination
- **Token injection via env vars**: `CG_READ_TOKEN`, `CG_WRITE_TOKEN`, `CG_WATCHDOG_TOKEN` are passed as environment variables, matching production deployment
- **Two report formats**: JSON for CI integration, Markdown for human review

### Report Output

After a run, two files appear under `scripts/reports/`:

```
scripts/reports/report-<timestamp>.json   # Machine-readable
scripts/reports/report-<timestamp>.md     # Human-readable
```

The Markdown report groups results by agent:

```
## cursor
Status: 14/14 passed

| Tool | Success | Latency (ms) | Error |
|------|---------|--------------|-------|
| initialize+memory_stats | OK | 528 |  |
| memory_store | OK | 9 |  |
...
```

### Sample Run

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

### Adding a New Agent

1. Create `scripts/agents/my-agent.ts` extending `BaseAgentAdapter`
2. Implement `name` and `buildSpawnCommand()` (or override `spawnAgent()`)
3. Add a static `buildMcpConfig(mcpBin)` that returns the agent's exact config shape
4. Register the adapter in `scripts/cross-agent-test.ts`

The harness automatically picks up any new adapter via `buildAdapters()`.

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP Agent (Cursor / Claude / Cline / Continue / Claude Code) │
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

### Directory Structure

```
src/
├── mcp/              # MCP server implementation
│   ├── server.ts     # Main MCP server entry
│   └── tools/        # Tool implementations
│       ├── memory-store.ts
│       ├── memory-recall.ts
│       ├── memory-extract.ts     # Phase 1: AutoSkill
│       ├── intelligent-recall.ts  # Phase 2: MemGate
│       ├── dual-mode-execute.ts   # Phase 3: MPR
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

### Priority Assignment

| Priority | When to Use |
|----------|-------------|
| `anchored` | Critical rules that must never be violated |
| `constraint` | API conventions, coding standards |
| `decision` | Architecture choices, selected approaches |
| `preference` | Coding style, workflow preferences |
| `fact` | Project details, historical context |

```typescript
// Good: Critical project-wide constraints
memory_store({
  content: "NEVER commit directly to main branch",
  priority: "anchored",
  project_tags: ["git-workflow"]
});

// Avoid: Common knowledge
memory_store({
  content: "JavaScript uses camelCase",
  priority: "fact"
});
```

### Project Tagging Strategy

Use consistent, hierarchical tags:

```typescript
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

```bash
# Main agent: read-only token
CG_READ_TOKEN="agent-read-token"

# Admin agent: write token
CG_WRITE_TOKEN="admin-write-token"

# Emergency: watchdog token (only for trusted processes)
CG_WATCHDOG_TOKEN="emergency-token"
```

### When to Use Which Search Mode

| Scenario | Recommended Mode |
|----------|----------------|
| Exact code snippet | `keyword` |
| Known constraint text | `keyword` |
| General concept recall | `semantic` or `hybrid` |
| Diverse knowledge retrieval | `bm25` |
| Intent-based recall | `hybrid` |

### After-Chain Usage

Enable automatic tool chaining to reduce manual tool calls:

```typescript
// After storing a memory, automatically extract constraints
after_chain_configure({
  action: "toggle_chain",
  chain_name: "store-then-extract",
  enabled: true
});
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run unit tests
npm test

# Cross-agent compatibility tests (spawns MCP servers across all supported agents)
npm run test:agents

# Cross-agent tests for a single agent
npm run test:agents -- cursor

# Watch mode (auto-rebuild on changes)
npm run dev

# Type checking
npm run lint
```

See [Cross-Agent Compatibility Tests](#cross-agent-compatibility-tests) for details on the harness under `scripts/agents/` and `scripts/tests/`.

## Inspired By

- **AutoSkill**: Experience-driven skill extraction from conversations
- **MemGate**: Inference-time memory filtering with learned relevance
- **Meta-Policy Reflexion (MPR)**: Soft guidance + hard admissibility checks

## License

MIT
