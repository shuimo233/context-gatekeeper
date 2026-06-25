# Session and Transaction Management Integration Specification

Status: draft (impl implementation in progress)

## Scope

Create a focused integration layer for session and transaction management so MCP tools and future admin tools can operate on stable boundaries. This spec targets `src/schema/memory-session.ts` plus a new `src/api/session-manager.ts` module.

## Isolation Model

All session records are scoped by `userId + agentId + projectId + scope + key`. Queries must never return records from a different project or user unless an explicit cross-tenant admin token is supplied. Default admin access is disabled.

## Session Lifecycle

1. Create or refresh a session record with `value`, `meta`, and optional `updatedBy`.
2. Read by isolation tuple.
3. List by tenant-scoped filters with bounded pagination.
4. Update value or metadata under optimistic version semantics.
5. Soft delete and background expiration cleanup.

## Transaction Boundaries

- Write operations that touch multiple memory tables must be wrapped in the DB transaction helper.
- Session store and memory store operations should not leave partial state on failure.
- Retry logic must not retry unknown errors; only retry database lock errors.

## Managed API Surface

Target API surface for future tooling and controllers:

- `getOrCreateSession({ userId, agentId, projectId, scope, key, initialValue?, meta?, ttlHours? })`
- `readSession({ userId, agentId, projectId, scope, key })`
- `listSessions({ userId?, agentId?, projectId?, scope?, cursor?, limit? })`
- `updateSession({ id, value?, meta?, updatedBy? })`
- `touchSession({ id, updatedBy? })`
- `expireSession({ id, updatedBy? })`
- `runInSessionTransaction(fn)`

## Observability Requirements

Every managed call must emit:
- operation name
- target session key
- duration in ms
- success or failure status
- reason for retry if retried

Health and metrics support will use these events for health check and audit endpoint coverage.

## Security Notes

- Session keys must not contain raw secrets.
- Values must be treated as internal state; tool responses must not expose raw session values unless explicitly requested.
- Expired records must remain unreadable to normal queries.

## Acceptance Criteria

1. `memory_sessions` table and isolation indexes initialize successfully.
2. Session lifecycle functions create, read, update, expire, and list without leaking other tenants.
3. Transaction failures roll back both session and memory changes.
4. Unit-level contract exists for future MCP tool integration.
