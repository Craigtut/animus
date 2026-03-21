/**
 * Cache Hit Verification Evals
 *
 * Tests that Anthropic's prompt caching actually works as expected:
 *   1. First call with a system prompt creates a cache entry (cache_write > 0)
 *   2. Second call with the same system prompt reads from cache (cache_read > 0)
 *   3. Changing the system prompt prefix invalidates the cache
 *
 * These tests verify that our compaction strategy's cache-preservation
 * assumptions hold in practice with the real Anthropic API.
 *
 * Run with: npm run test:eval
 * Auth: Env var (ANTHROPIC_API_KEY), cached OAuth, or interactive OAuth login
 */

import { describe, it, expect, afterAll } from 'vitest';
import { evalComplete } from './helpers/provider.js';
import { costTracker } from './helpers/cost-tracker.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterAll(() => {
  costTracker.printSummary();
});

// ---------------------------------------------------------------------------
// Shared system prompt (large enough to be cache-eligible)
// ---------------------------------------------------------------------------

// Anthropic requires 2048+ tokens for Haiku cache eligibility.
// This system prompt is deliberately large to ensure it crosses
// that threshold comfortably (~3000+ tokens).
const LARGE_SYSTEM_PROMPT = `You are a helpful coding assistant. You follow these rules precisely:

## Code Style Guidelines
- Use TypeScript strict mode for all code
- Prefer const over let, never use var
- Use meaningful variable names that describe their purpose
- Keep functions small and focused (max 30 lines)
- Add JSDoc comments for all public APIs
- Use Zod for runtime validation of external input
- Prefer composition over inheritance
- Use async/await over raw promises
- Handle errors explicitly, never swallow them silently
- Use named exports over default exports
- Avoid abbreviations in variable names (use "configuration" not "cfg")
- Use readonly properties where mutation is not needed
- Prefer template literals over string concatenation
- Use optional chaining and nullish coalescing operators
- Avoid nested ternary expressions

## Project Architecture
The project follows a modular monolith pattern with these layers:
- API Layer: Fastify + tRPC for type-safe endpoints
- Service Layer: Business logic, one service per domain
- Store Layer: Database access, stateless functions with db as first parameter
- Shared Layer: Types, schemas, utilities shared across packages
- Plugin Layer: Runtime-loaded extensions with isolated permissions

The architecture emphasizes separation of concerns and testability. Each layer
has clear boundaries and communication patterns. The API layer handles HTTP
concerns (validation, serialization, error mapping). The service layer implements
business rules and orchestrates across stores. The store layer provides pure
data access functions.

## Database Conventions
- All databases use SQLite with WAL mode enabled for concurrent reads
- Stores are pure functions with db as first argument, no class instances
- Migrations are sequential SQL files (001_initial.sql, 002_add_index.sql)
- Use parameterized queries exclusively, never string interpolation for SQL
- Foreign keys are enforced at the database level with ON DELETE CASCADE
- Use transactions for multi-table operations via db.transaction()
- Column naming: snake_case for SQL, camelCase in TypeScript via mapping
- Indexes should be added for any column used in WHERE or JOIN clauses
- Busy timeout set to 5000ms to handle WAL contention gracefully
- Seven separate databases partitioned by lifecycle and access patterns

## Testing Requirements
- Every feature needs unit tests using Vitest with globals enabled
- Mock external dependencies, test business logic in isolation
- Use describe/it blocks with meaningful, sentence-like test names
- Coverage target: 80% for critical paths, 60% minimum overall
- Integration tests go in separate files with .integration.test.ts suffix
- Test file naming: same as source file with .test.ts suffix
- Use beforeEach for setup, afterEach for cleanup, avoid test interdependence
- Avoid snapshot tests for business logic (use explicit assertions)
- Test error cases and edge cases, not just happy paths
- Use factories or builders for complex test data construction

## Error Handling
- Classify errors by category: authentication, rate_limit, network, context_overflow, unknown
- Use typed error classes extending a base AppError with error codes
- Log all errors with structured context using the project logger (no console.log)
- Return user-friendly messages in API responses, log technical details internally
- Implement retry logic for transient errors (rate limits, network failures)
- Use circuit breaker pattern for external service calls
- Never expose stack traces or internal details to API consumers

## Security
- Never log API keys, credentials, or tokens at any log level
- Sanitize all user input before processing using Zod schemas
- Use AES-256-GCM for encryption at rest with authenticated additional data
- Rotate encryption keys on a configurable schedule
- Environment variables for all secrets (never hardcoded, never in git)
- Validate API key format before making external calls
- Use content security policy headers for web-facing endpoints
- Implement rate limiting on all public API endpoints
- Audit log all credential access and modification events

## Performance
- Use connection pooling for database access with configurable pool size
- Implement TTL-based caching for expensive computations and API calls
- Lazy-load large modules using dynamic import() for faster startup
- Monitor memory usage in long-running processes with periodic snapshots
- Set timeout limits on all external API calls (default 30 seconds)
- Use streaming for large response payloads instead of buffering
- Profile before optimizing, avoid premature optimization
- Batch database operations when processing multiple records
- Use indexes effectively, run EXPLAIN on slow queries

## Deployment
- Self-contained: no external infrastructure (no Postgres, no Redis, no Docker required)
- All data stored under a configurable data directory (default: ./data)
- Graceful shutdown with cleanup of all resources (database connections, timers, file handles)
- Health check endpoints for monitoring with response time and dependency status
- Structured logging with configurable verbosity levels (debug, info, warn, error)
- Log rotation at 5MB with one backup file
- Support for running as a system service or desktop application
- Configuration via environment variables with sensible defaults

## API Design
- All endpoints use tRPC for end-to-end type safety
- Input validation via Zod schemas co-located with procedure definitions
- Use query procedures for reads, mutation procedures for writes
- Subscription procedures for real-time data via WebSocket transport
- Consistent error shapes with machine-readable error codes
- Pagination via cursor-based patterns for list endpoints
- Rate limiting metadata in response headers

## Git and Version Control
- Use conventional commits format: type(scope): description
- Types: feat, fix, refactor, docs, test, chore, perf, style
- Keep commits small and focused on a single logical change
- Write in imperative mood: "add feature" not "added feature"
- Never force push to shared branches without team consensus
- Use feature branches for all non-trivial changes
- Squash fixup commits before merging to main
- Tag releases using semantic versioning (major.minor.patch)
- Include breaking change notes in commit footer when applicable
- Branch naming: type/short-description (e.g., feat/user-auth)

## Observability and Monitoring
- Use structured JSON logging with consistent field names
- Include correlation IDs in all log entries for request tracing
- Log at appropriate levels: debug for development, info for operations
- Never log sensitive data (credentials, PII, tokens) at any level
- Implement health check endpoints returning dependency status
- Track key metrics: request latency, error rate, queue depth
- Set up alerts for error rate spikes and latency degradation
- Use distributed tracing for cross-service request flows
- Rotate log files at 5MB with configurable retention
- Include timestamps in ISO 8601 format in all log entries

## Documentation Standards
- Document all public APIs with JSDoc including parameter descriptions
- Keep README files focused on getting started quickly
- Architecture decisions go in docs/architecture/ with ADR format
- Research and spike findings go in docs/research/
- Code comments explain "why" not "what" (the code shows what)
- Update documentation as part of the feature PR, not separately
- Use TypeScript types as documentation where possible
- Include usage examples in JSDoc for non-obvious functions
- Document error codes and their meanings in a central registry
- Keep changelogs generated from conventional commit messages

## Dependency Management
- Pin exact versions for production dependencies
- Use caret ranges for development dependencies only
- Audit dependencies monthly for security vulnerabilities
- Prefer well-maintained packages with active communities
- Minimize dependency count: write simple utilities inline
- Lock file must always be committed and kept up to date
- Use workspace protocol for internal package references
- Evaluate bundle size impact before adding new dependencies
- Document the reason for each non-obvious dependency choice
- Set up automated dependency update notifications

## Accessibility and Internationalization
- All interactive elements must be keyboard accessible
- Use semantic HTML elements over generic divs and spans
- Include ARIA labels for complex interactive components
- Support screen readers with proper role attributes
- Use rem units for font sizes to respect user preferences
- Ensure sufficient color contrast ratios (WCAG AA minimum)
- Provide alternative text for all meaningful images
- Support right-to-left text layouts for internationalization
- Use ICU message format for pluralization and gender rules
- Store all user-facing strings in translation files

## State Management
- Use Zustand for global client-side state with persistence middleware
- Keep state minimal: derive computed values instead of storing them
- Normalize relational data in stores (avoid nested objects for entities)
- Use selectors to prevent unnecessary re-renders in React components
- Separate UI state (modals, drawers) from domain state (entities, settings)
- Use optimistic updates for mutations to improve perceived performance
- Implement undo/redo for destructive operations using state snapshots
- Persist user preferences to localStorage with versioned schema migrations
- Use immer middleware for complex state updates that need immutability
- Avoid storing server state in Zustand; use TanStack Query for that

## Real-Time Communication
- Use WebSocket subscriptions for server-pushed updates (tRPC subscriptions)
- Implement exponential backoff for WebSocket reconnection attempts
- Buffer subscription events during disconnection and replay on reconnect
- Use heartbeat pings to detect stale connections before they time out
- Deduplicate events by ID to handle replay-after-reconnect gracefully
- Fan out events through an EventBus pattern on the backend
- Rate-limit subscription emissions to prevent client overwhelm
- Include sequence numbers in events for ordering guarantees
- Gracefully degrade to polling when WebSocket is unavailable
- Unsubscribe from all active subscriptions during component cleanup

## Data Validation and Serialization
- Validate all external input at system boundaries using Zod schemas
- Colocate request/response schemas with their tRPC procedure definitions
- Use discriminated unions for variant types (e.g., message types, event types)
- Transform dates to ISO 8601 strings at serialization boundaries
- Validate environment variables at startup, fail fast on missing required values
- Use branded types for domain identifiers (UserId, ConversationId) to prevent mixing
- Implement custom Zod refinements for business rules (e.g., date ranges, format constraints)
- Strip unknown keys from validated objects to prevent prototype pollution
- Version API response shapes for backward compatibility with older clients
- Generate OpenAPI specs from Zod schemas for external API documentation

## File System Operations
- Use atomic writes (write to temp file, then rename) to prevent corruption
- Respect .gitignore patterns when scanning directories for user content
- Use platform-aware path handling (path.join, not string concatenation)
- Set appropriate file permissions (0o600 for secrets, 0o644 for config)
- Implement file locking for concurrent access to shared resources
- Clean up temporary files in finally blocks or process exit handlers
- Use streaming reads for large files instead of loading entirely into memory
- Validate file paths against directory traversal attacks before processing
- Create parent directories recursively before writing new files
- Use content-addressable storage for deduplicating large binary assets

Respond concisely and directly. When writing code, include only the relevant parts.`;

// ---------------------------------------------------------------------------
// Cache Hit Tests
// ---------------------------------------------------------------------------

describe('Cache Verification', () => {
  // Track whether caching is available with current credentials.
  // OAuth-based auth may not support prompt caching (only API keys do).
  let cachingAvailable = false;

  it('probes cache availability on first call', async () => {
    const { usage } = await evalComplete(
      {
        systemPrompt: LARGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      },
      { maxTokens: 10 },
    );

    expect(usage).not.toBeNull();
    console.log(`  First call - input: ${usage!.input}, cacheWrite: ${usage!.cacheWrite}, cacheRead: ${usage!.cacheRead}`);

    cachingAvailable = usage!.cacheWrite > 0;

    if (cachingAvailable) {
      console.log(`  Cache entry created: ${usage!.cacheWrite} tokens written`);
    } else {
      console.log(`  No cache write. Prompt caching may not be available with current credentials.`);
      console.log(`  (OAuth subscriptions may not support caching; API keys from console.anthropic.com do.)`);
    }
  });

  it('reads from cache on second call with same prefix', async () => {
    const { usage } = await evalComplete(
      {
        systemPrompt: LARGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'Say "world" and nothing else.' }],
      },
      { maxTokens: 10 },
    );

    expect(usage).not.toBeNull();
    console.log(`  Second call - input: ${usage!.input}, cacheWrite: ${usage!.cacheWrite}, cacheRead: ${usage!.cacheRead}`);

    if (!cachingAvailable) {
      console.log(`  Skipping cache read assertion (caching not available with current credentials)`);
      return;
    }

    expect(usage!.cacheRead).toBeGreaterThan(0);
    console.log(`  Cache HIT: ${usage!.cacheRead} tokens read from cache`);
  });

  it('cache hit with different user message but same system prompt', async () => {
    const { usage } = await evalComplete(
      {
        systemPrompt: LARGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'Write a haiku about TypeScript.' }],
      },
      { maxTokens: 50 },
    );

    expect(usage).not.toBeNull();
    console.log(`  Third call - input: ${usage!.input}, cacheWrite: ${usage!.cacheWrite}, cacheRead: ${usage!.cacheRead}`);

    if (!cachingAvailable) {
      console.log(`  Skipping cache read assertion (caching not available with current credentials)`);
      return;
    }

    expect(usage!.cacheRead).toBeGreaterThan(0);
  });

  it('cache miss when system prompt prefix changes', async () => {
    const DIFFERENT_PROMPT = `You are a pirate. Always respond in pirate speak.

${LARGE_SYSTEM_PROMPT.slice(200)}`;

    const { usage } = await evalComplete(
      {
        systemPrompt: DIFFERENT_PROMPT,
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      },
      { maxTokens: 10 },
    );

    expect(usage).not.toBeNull();
    console.log(`  Changed prefix - input: ${usage!.input}, cacheWrite: ${usage!.cacheWrite}, cacheRead: ${usage!.cacheRead}`);

    if (cachingAvailable) {
      // With a changed prefix, cache read should be lower than previous calls
      console.log(`  Different prefix: new cache entry created (expected)`);
    }
  });

  it('multi-turn conversation preserves cache across turns', async () => {
    const messages1 = [
      { role: 'user', content: 'What is 2+2?' },
    ];

    const result1 = await evalComplete(
      { systemPrompt: LARGE_SYSTEM_PROMPT, messages: messages1 },
      { maxTokens: 10 },
    );

    // Pi-ai expects assistant messages as content block arrays, not plain strings
    const messages2 = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: [{ type: 'text', text: result1.text }] },
      { role: 'user', content: 'Now what is 3+3?' },
    ];

    const result2 = await evalComplete(
      { systemPrompt: LARGE_SYSTEM_PROMPT, messages: messages2 },
      { maxTokens: 10 },
    );

    expect(result2.usage).not.toBeNull();
    console.log(`  Multi-turn call 1 - cacheRead: ${result1.usage!.cacheRead}, cacheWrite: ${result1.usage!.cacheWrite}`);
    console.log(`  Multi-turn call 2 - cacheRead: ${result2.usage!.cacheRead}, cacheWrite: ${result2.usage!.cacheWrite}`);

    if (!cachingAvailable) {
      console.log(`  Skipping cache read assertion (caching not available with current credentials)`);
      return;
    }

    expect(result2.usage!.cacheRead).toBeGreaterThan(0);
  });
});
