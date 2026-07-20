# Local crawler and SCRAI memory

SCARPE stores crawler and SCRAI workflow memory in browser IndexedDB. Supabase remains reserved for validated Levelspace content.

## Storage boundary

- `crawl_urls`: canonical source URL, crawl status, cached PDF URLs, retry time, and last crawl time.
- `scrai_lessons`: Markdown evidence, trusted chunk IDs, generated draft fingerprint, and review status.
- `action_history`: local audit events for SCRAI actions.
- Local disk: the actual PDF, Markdown, extracted text, and generated files.
- Levelspace Supabase: only reviewed educational content explicitly sent to Levelspace.

The memory belongs to the same machine and browser profile used by SCRAI. Clearing browser storage removes this index but does not remove local disk files or Levelspace data.

## Crawler behavior

The global crawler memory interceptor canonicalizes `/api/crawl-pdfs` root URLs by removing `www`, fragments, tracking parameters, and trailing slashes. In the default `new_only` mode, a fresh completed URL is not crawled again; its cached PDF URL list is returned locally. Failed URLs can retry, and completed URLs expire after 30 days. Use `force_recrawl` to bypass memory deliberately.

## SCRAI action planning

The planner exposes only work still required for the current evidence version:

1. Missing Markdown: locate the source and create Markdown.
2. Markdown exists but chunks do not match its hash: create chunks.
3. Matching Markdown and trusted chunks exist: generate and save an admin draft.
4. A matching draft is saved: wait for admin review.
5. Approved or published: completed and hidden from the active queue.

Changing the Markdown hash invalidates chunks and drafts. Changing trusted chunk IDs invalidates only the generated draft and review state.

React screens can use `useScraiMemoryPlan(identity)` and hide buttons with `isActionVisible(action)`. The same functions are exposed through `window.SCRAI_MEMORY` for the local SCRAI workflow.
