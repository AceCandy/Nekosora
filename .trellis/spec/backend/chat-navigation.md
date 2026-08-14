# Chat Navigation

## 1. Scope / Trigger

Apply this contract when changing the Chat/Image conversation sidebar query, cursor, active-run status, RSC payload, or client-side page merge.

## 2. Signatures

```ts
interface ConversationNavigationItem {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  generating: boolean;
  rank: number;
  updatedAt: number;
  sortUpdatedAt: string;
}

interface ConversationNavigationPage {
  items: ConversationNavigationItem[];
  nextCursor: string | null;
}

interface ConversationGroupBoundaries {
  todayStart: string;
  yesterdayStart: string;
  dayBeforeYesterdayStart: string;
  sevenDaysAgoStart: string;
  thirtyDaysAgoStart: string;
}

type ConversationGroupKey = "pinned" | "today" | "yesterday"
  | "dayBeforeYesterday" | "withinWeek" | "withinMonth"
  | "earlier" | "archived";

function listConversations(cursor?: string | null): Promise<ConversationNavigationPage>;
function getConversationNavigationItem(id: string): Promise<ConversationNavigationItem | null>;
function getGeneratingStatuses(): Promise<Array<{ id: string; generating: true }>>;
function getConversationGroupSummary(boundaries: ConversationGroupBoundaries): Promise<Array<{ key: ConversationGroupKey; total: number }>>;
function listConversationGroup(key: ConversationGroupKey, boundaries: ConversationGroupBoundaries, cursor?: string | null): Promise<{ key: ConversationGroupKey; items: ConversationNavigationItem[]; nextCursor: string | null }>;
```

The PostgreSQL navigation index is ordered by `user_id`, rank ascending, `updated_at DESC`, and `id DESC`.

## 3. Contracts

- The first and subsequent windows contain at most 30 rows; query 31 rows to derive `nextCursor` without `COUNT(*)`.
- The RSC first window remains globally bounded at 30. After hydration, the client sends its local-midnight 0/1/2/7/30-day ISO boundaries: summary returns all non-empty group totals, while each group page contains at most 20 rows and queries 21 to derive its own cursor.
- Group boundaries must be valid ISO timestamps in strict descending order. Pinned and archived are separate predicates; ordinary time groups exclude both. The server consumes client boundaries and never recomputes them in the server timezone.
- Group cursors use `updated_at DESC, id DESC`. The client may continue after the last item already present in the RSC window; group pages merge by ID and late/timed-out responses are ignored by per-group request generation.
- Rank is `0` for active pinned, `1` for active unpinned, and `2` for archived conversations. SQL ordering, cursor predicates, migration index, and client merge must use the same keys and directions.
- The cursor contains rank, the six-digit UTC PostgreSQL timestamp projection, and immutable ID. Client DTOs keep `sortUpdatedAt`; millisecond `Date` values cannot decide equal-millisecond ordering.
- The next-page predicate is strictly after the last row: greater rank, or equal rank with an earlier timestamp, or equal rank/timestamp with a lower ID.
- Every list, deep-link projection, and active-run query is isolated by the authenticated user. A missing or foreign deep-link item returns `null`.
- A deep-linked current item outside the loaded window is fetched by ID and merged by the full sort key. Message search remains an independent server query.
- Sidebar polling starts from the union of server-reported active runs and client streaming runtimes. Polling uses a single recursive timeout and stops scheduling after both sources are empty.
- RSC refresh replaces the local window and advances its generation; late page responses from an older generation are ignored.

## 4. Validation & Error Matrix

| Input/state | Required behavior |
|---|---|
| Missing cursor | Return the first bounded page |
| Malformed, invalid-date, or over-2048-byte cursor | Reject before querying |
| Valid end cursor | Return an empty/partial page with `nextCursor: null` |
| Foreign deep-link ID | Return `null` without exposing metadata |
| Page request fails | Preserve loaded rows and expose retry |
| Browser reports offline or group request exceeds 10 seconds | Preserve loaded rows, mark only that group retryable, and ignore a late result |
| Invalid/unsorted group boundaries or malformed group cursor | Reject before querying |
| RSC refresh races with page request | Discard the stale page response |
| Active-run poll returns no rows | Clear generating state, refresh once, and stop the timer |

## 5. Good / Base / Bad Cases

- Good: equal timestamps are ordered by ID and the same tuple drives SQL, cursor, index, and client merge.
- Base: fewer than 30 conversations produce one page and no load-more action.
- Good: group titles show server totals; “earlier” and “archived” remain visible while collapsed and load only their own next 20 rows when opened.
- Bad: offset pagination, a cursor containing only `updatedAt`, loading all conversations into the layout, or starting polling only from the first page's rows.

## 6. Tests Required

- Action tests assert page size 31, three cursor predicate branches, user filtering, invalid cursor rejection, and six-digit timestamp encoding.
- Group action tests assert strict boundary validation, owner filtering, mutually exclusive predicates, page size 21, group cursor ordering, totals, offline retry, and stale-response rejection.
- Model tests assert rank/timestamp/ID merge order, duplicate replacement, and server/client active-ID union.
- Schema tests assert the expression index, migration, journal, and snapshot remain synchronized.
- Browser regression covers authenticated desktop and 390px load-more, retry, deep-link visibility, keyboard focus, and mobile drawer behavior.
- Run `pnpm check`, `pnpm test`, and the Web production build after cross-layer changes.

## 7. Wrong vs Correct

```ts
// Wrong: milliseconds lose PostgreSQL ordering precision and ID is omitted.
items.sort((a, b) => b.updatedAt - a.updatedAt);

// Correct: use the complete server ordering tuple.
items.sort(compareConversations);

// Wrong: server-local midnight changes a remote user's group membership.
const todayStart = startOfDay(new Date());

// Correct: validate and consume the browser's explicit local-day boundaries.
const boundaries = conversationGroupBoundariesSchema.parse(input);
```
