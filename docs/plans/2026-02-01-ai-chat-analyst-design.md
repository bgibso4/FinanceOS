# AI Chat Analyst — Full Redesign

**Date:** 2026-02-01
**Status:** Design approved, ready for implementation
**Impact:** Huge | **Effort:** High

## Overview

Replace the existing heuristic-based chat agent with a streaming LLM-powered financial analyst. The agent uses Claude via tool use to answer natural language questions about the user's financial data, render charts, and pin insights to the dashboard.

### What exists today (being replaced)

- Drawer UI with text input (`src/components/chat-analyst.tsx`)
- Heuristic keyword matching — 3-4 canned query patterns (`src/lib/agent.ts`)
- Chart rendering + pin to dashboard via localStorage
- API endpoint at `POST /api/agent/query`

### Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM provider | Claude via Vercel AI SDK | Provider-swappable, AI SDK is MIT-licensed, keys stay server-side |
| Data access | Tool use (11 tools) | Structured, auditable, secure — LLM never generates raw queries |
| Response style | Streaming | Responsive UX, Vercel AI SDK handles natively |
| UI placement | Drawer from sidebar nav | Always available, doesn't overlay content |
| Chart display | Compact cards, click to expand | Keeps conversation clean, full-screen for inspection |
| Conversation persistence | Session-persistent (React state) | Survives navigation, resets on tab close — no stale data |
| Data safety | Sanitized tool output | No internal IDs, hashes, tokens, or connection data sent to LLM |

---

## Architecture

```
User input (drawer)
    |
    v
POST /api/agent/chat (streaming)
    |
    v
Vercel AI SDK streamText() with Claude
    | (tool calls)
    v
Tool functions (server-side, call Prisma directly)
    | (results back to LLM)
    v
Claude composes response with text + chart specs
    | (streamed back)
    v
Drawer UI renders text tokens + chart cards
```

The LLM never sees raw database access. It calls predefined tool functions that query Prisma and return structured, sanitized data. The system prompt includes the category tree (small, ~20-40 categories) to avoid a tool call on every question.

### New dependencies

- `ai` — Vercel AI SDK (MIT, free)
- `@ai-sdk/anthropic` — Anthropic provider for AI SDK

### New environment variable

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Tool Definitions (11 tools)

### Data query tools

All server-side, sanitized output — no internal IDs, hashes, tokens, or connection metadata.

| Tool | Purpose | Key parameters | Returns |
|------|---------|---------------|---------|
| `getCategories` | Category tree with parent groups | none | `{ id, name, type, parentName }[]` |
| `queryTransactions` | Search/filter with aggregation | dateRange, categories, merchants, accounts, tags, limit | Itemized or summed transactions |
| `getAccountBalances` | Account names, types, balances | none | `{ name, type, institution, balance, currency }[]` |
| `getCategoryBreakdown` | Spending by category for date range | startDate, endDate, accountIds? | `{ category, group, amount }[]` |
| `getMerchantBreakdown` | Spending by merchant for date range | startDate, endDate, limit? | `{ merchant, amount, count }[]` |
| `getBudgetStatus` | Budget vs actual | month? | `{ category, budgeted, actual, remaining }[]` |
| `getMonthlyTrend` | Month-over-month totals | months (count) | `{ month, income, spending, net }[]` |
| `getCashFlow` | Income vs expenses summary | startDate, endDate | `{ income, expenses, net, byCategory }` |
| `getRecurringTransactions` | Subscriptions and recurring charges | status? (active/lapsed/all) | `{ merchant, amount, frequency, status }[]` |

### Action tools

| Tool | Purpose | Key parameters |
|------|---------|---------------|
| `generateChart` | Produce a ChartSpec for inline rendering | type, title, series, xLabel?, yLabel? |
| `pinChart` | Pin a chart to the dashboard | chartSpec |

### Data safety rules

- Account data: only `name`, `type`, `institution`, `currency`, `balance` — no connection details
- Transactions: only `date`, `amount`, `merchant`, `category`, `tags`, `note` — no `importHash`, `externalId`, connection metadata
- No Plaid/Teller tokens, enrollment IDs, or encrypted credentials ever reach a tool response
- Enforced via explicit Prisma `select` in each tool function

---

## System Prompt

```
You are a personal finance analyst for FinanceOS. You help the user
understand their spending, income, budgets, and financial trends by
querying their transaction data.

Rules:
- Use the provided tools to look up data. Never guess or fabricate numbers.
- If a question is ambiguous, ask for clarification before querying.
- When presenting monetary amounts, use the appropriate currency.
- Keep responses concise — lead with the key insight, then supporting detail.
- When data would be clearer as a chart, use generateChart to visualize it.
- Never expose internal IDs, hashes, or technical database details.

Available categories:
<injected at request time — full category tree with parent groups>
```

The category tree is fetched server-side on each request and injected into the system prompt. This avoids a `getCategories` tool call on nearly every question while keeping the context current.

---

## Conversation Design

### Message flow

1. User sends message -> appended to message history (React state in app shell)
2. Full message history sent to `POST /api/agent/chat`
3. API streams response — text tokens render immediately, tool calls show as activity indicators
4. Final response (text + any chart specs) appended to message history
5. Chart specs render as compact cards; clicking opens full-screen modal

### Message state

```typescript
type Message = {
  role: 'user' | 'assistant';
  content: string;
  charts?: ChartSpec[];
}
```

### Persistence

- **Session-persistent**: conversation state lives in React state in the app shell
- Navigating between pages preserves the conversation
- Closing the tab or refreshing resets the conversation
- No localStorage or database storage for chat history

---

## UI Design

### Sidebar trigger

The analyst is accessed via a button at the bottom of the sidebar, separated from page navigation:

```
[Logo/Brand]
--------------
Dashboard
Transactions
Reports
Settings
--------------
[spacer]
--------------
Finance Analyst    <- opens drawer
```

Keyboard shortcut: `Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux) toggles the drawer from any page.

### Drawer

- Slides in from the right, ~400px wide
- Header: "Finance Analyst" title + close button
- Body: scrollable message list
- Footer: text input + send button, disabled while streaming

### Message rendering

- **User messages**: right-aligned bubble
- **Assistant messages**: left-aligned, markdown-rendered text
- **Tool activity**: subtle inline indicator below streaming text ("Analyzing transactions..." with spinner), collapses once response continues. User never sees raw tool calls or results.
- **Chart cards**: compact card (~200px tall) embedded in the message with chart title and small preview. Click to open full-screen modal.

### Full-screen chart modal

- Reuses existing `<Modal>` component
- Renders `<ChartRenderer>` at full available size
- "Pin to dashboard" button in modal footer
- Close returns to drawer

### Empty state

When no conversation exists, show suggested prompts as clickable chips:
- "How much did I spend this month?"
- "What are my top merchants?"
- "Am I on track with my budgets?"
- "Show my income vs spending trend"

---

## API Design

### Endpoint

`POST /api/agent/chat` — replaces `POST /api/agent/query`

### Request

```typescript
{
  messages: { role: 'user' | 'assistant'; content: string }[]
}
```

### Response

Streaming — uses the Vercel AI SDK's `toDataStreamResponse()` which handles text tokens, tool calls, and tool results in a single stream. The client consumes it via the AI SDK's `useChat` hook.

### Details

- No new database tables
- No authentication (local-first app)
- Category tree fetched server-side at request time, injected into system prompt
- Max tool round-trips capped (e.g., 10) to prevent runaway loops

---

## File Structure

### New files

```
src/lib/agent/
  tools.ts          # Tool definitions (Zod schemas + execute functions)
  system-prompt.ts  # System prompt builder (injects category tree)
  index.ts          # streamChat() orchestration via AI SDK

src/components/
  chat-analyst.tsx  # Rewrite — streaming messages, chart cards, suggested prompts
  chart-modal.tsx   # Full-screen chart modal (click to expand)

src/app/api/agent/chat/route.ts  # New streaming endpoint
```

### Modified files

```
src/components/side-nav.tsx   # Add Analyst button at bottom
src/components/app-shell.tsx  # Keyboard shortcut (Cmd+K), drawer state management
src/lib/types.ts              # Add chat-related types
```

### Deleted files

```
src/lib/agent.ts                 # Old heuristic matcher
src/app/api/agent/query/route.ts # Old endpoint
```

### Kept as-is

```
src/components/chart-renderer.tsx  # Reused for chart cards + modal
src/components/ui/drawer.tsx       # Reused for chat drawer
src/lib/pinned.ts                  # Reused for pin-to-dashboard
```
