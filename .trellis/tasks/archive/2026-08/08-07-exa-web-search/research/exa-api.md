# Exa Search API Research

## Sources

- Official Search API: <https://docs.exa.ai/reference/search.md>
- Official Contents API: <https://docs.exa.ai/reference/get-contents.md>
- Reference implementation: `Episkey-G/GrokSearch-rs` commit `c081d0eb68c1eb196b9d938457ba7a83dc534a13`
  - `src/providers/exa.rs`
  - `tests/exa_parse.rs`

## Verified Search Contract

- Endpoint: `POST https://api.exa.ai/search`
- Authentication: `x-api-key: <key>`; official examples consistently use this form.
- Required request field: non-empty `query`.
- Relevant optional request fields:
  - `numResults`: integer `1..100`.
  - `startPublishedDate`: ISO-8601 lower publication boundary.
  - `endPublishedDate`: ISO-8601 upper publication boundary.
  - `contents.highlights`: `true` or an object with optional `query` and `maxCharacters` (`1..10000`).
  - `type`: defaults to `auto`; omit it for the MVP.
- Deprecated fields `startCrawlDate`, `endCrawlDate`, `context`, and response `resolvedSearchType` must not be used.
- Relevant response fields are `results[].title`, `url`, `publishedDate`, `highlights[]`, and `summary`.

The project time-range contract is an inclusive UTC date pair. Follow the existing Google Hosted Search mapping:

```text
startPublishedDate = YYYY-MM-DDT00:00:00.000Z
endPublishedDate   = YYYY-MM-DDT23:59:59.999Z
```

## Reference Repository Findings

GrokSearch-rs implements Exa as a semantic-search source with `x-api-key`, clamps `numResults`, maps publication dates, and drops results without a URL. Its `/search` request deliberately omits content options because a separate enrichment pipeline later calls `/contents` for page text.

Nekosora currently has no equivalent search enrichment stage. Copying the metadata-only request would leave `SearchResult.snippet` empty for most Exa results, giving the outer model little factual material beyond titles and URLs.

## Recommended MVP Mapping

- Reuse the existing `SearchProvider` interface, retry/cache/normalization service, encrypted config storage, and ordered backend chain.
- Add one API-key-only `exa` provider with no custom base URL and no dependency.
- Map `week`, `month`, and `custom` directly from `SearchTimeRange` to Exa publication boundaries.
- Request `contents.highlights.maxCharacters = 600` and join `highlights[]` into the existing `snippet`; this supplies bounded source text without a separate `/contents` stage or LLM summary.
- Do not add `/contents`, domain filters, search mode controls, categories, query expansion, or result fusion.

## Local Impact

- Backend types/registry: `packages/core/src/lib/web-search/types.ts`, `registry.ts`.
- New provider and focused tests: `packages/core/src/lib/web-search/exa.ts` plus provider/config tests.
- Settings input/UI: `apps/web/src/app/(dash)/panel/web-search/page.tsx`, `apps/web/src/features/web-search/WebSearchManager.tsx`.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/zh-CN.json`.
- No database migration.

The working tree already contains unrelated Markdown/link-preview changes, including edits to both message files and `packages/core/src/lib/web-search/public-http.ts`. Implementation must edit current file contents incrementally and must not touch or revert those changes.
