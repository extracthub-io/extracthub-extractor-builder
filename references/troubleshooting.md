# Troubleshooting

Work from the symptom. Always compare three things: the raw HTML you fetched, the validator / dry-run
output, and the live `extract` result.

## Contents
- A field is null or empty
- A field has the wrong value
- A list has the wrong number of items
- Everything is empty on the live run but the dry run worked
- Blocked, captcha or error pages
- JavaScript-only content
- JSON sources
- API errors from extract

## A field is null or empty
1. Does the selector exist in the RAW HTML (not the browser's DevTools DOM)? Search the fetched HTML for the
   class / id. If it exists only in DevTools, the content is rendered by JavaScript: see below.
2. Is the selector supported? (`+`, `~`, `:has()`, `:last-child` ... are not; see selectors-and-pitfalls.md.)
3. Inside a list `subExtractor`: is the selector relative to the item? Item-level attributes are unreachable.
4. `attributeValue`: is the attribute name right (`data-src` vs `src`)? A missing attribute gives `null`.
5. `jsonContent`: does the first matching `<script>` contain the path? Several `ld+json` blocks: the first
   one wins. Check the path against the actual JSON (paths are case-sensitive; arrays need `[0]`).
6. Selector array without `combineStrategy` → always null.
7. `isArray` field with a number transform after an array transform (`["first", "toNumber"]` is fine,
   `["unique", "toNumber"]` is not: `toNumber` then gets the whole array) → put value transforms first.

## A field has the wrong value
- First match is the wrong element (header, sidebar, carousel, hidden mobile copy): scope it (`main`, an id).
- Wrapper includes a label or an old price: select the inner element holding only the value.
- Number parsing: `"1.234"` meaning 1234 → `extractPrice` (locale aware) or `extractNumberDotThousands`;
  `"10rb"` / `"2.5k"` → `parseCompactNumber`.
- Relative URL → add `toAbsoluteUrl`.
- Placeholder image (`data:image...`) → read `data-src` / `data-original`.
- Text glued together or split oddly → set `textSeparator` (`" "` or `"\n"`) or select a smaller element.
- `isArray` field: a transform meant for each element placed after an array transform (`compact`, `first`,
  `joinWithComma` ...) runs on the whole array instead → move it before the array transform.

## A list has the wrong number of items
- Too many: ads / sponsored / template / recommendation cards match too. Scope to the results container and
  add `:not(...)` for the ad marker.
- Too few: the page lazy-loads (JS + `scroll_to_bottom`), paginates (extract `nextPageUrl` and let the caller
  loop), or the selector misses a variant class (use the shared class or an attribute both variants have).
- Objects misaligned: you used `subFields` with `isArray: true` over page-level selectors; switch to an item
  selector with `subExtractor`.

## Everything is empty on the live run but the dry run worked
- The dry run used HTML you saved from a browser (rendered, logged in, your country). The live fetch gets
  the server HTML. Validate against HTML fetched the same way the extractor fetches (no JS unless
  `renderJavascript`).
- Country-specific content or consent walls: set `proxyCountry`; dismiss banners with a `click` action
  (`on_error: "skip"`).
- Bot protection: see the next section.
- Ask for `return_raw_html` / look at the raw result if your tool offers it, and search it for your selectors.

## Blocked, captcha or error pages
Signs: "Access denied", "Just a moment...", captcha markup, a tiny HTML, a 403/429/503 target status
(API error `target_error`).
- Make sure `useProxy: true`. Custom headers are not sent through the proxy, so a page that only works with
  a header (auth, Cookie) needs `useProxy: false` (headers are sent there as they are).
- Add `allowJsEscalation: true` (retries blocked plain fetches with a browser; billed at the JS tier).
- Or switch to `renderJavascript: true` (+ `wait_for_element`).
- Try a `proxyCountry` matching the site's market.
- Prefer the site's JSON endpoints or embedded JSON: often less protected than the HTML.

## JavaScript-only content
Signs: raw HTML has an empty root (`<div id="root"></div>`, `<div id="__next"></div>` without content),
skeleton placeholders, "Loading...".
1. First search the raw HTML for embedded JSON: `__NEXT_DATA__`, `application/ld+json`, `window.__`,
   `__NUXT__`, `__APOLLO_STATE__`, large `<script type="application/json">` blocks. If the data is there, use
   `jsonContent` without JS rendering.
2. Look for the page's own API call (browser network tab, or `captureXhr`). If the URL works standalone,
   call it with `sourceType: "json"`.
3. Otherwise `renderJavascript: true` with a `wait_for_element` for the first result element, and selectors
   written against the RENDERED DOM (a browser snapshot), still limited to the supported selector syntax.

## JSON sources
- "Failed to parse response as JSON": the response is HTML (error page, login wall, wrong URL) or
  `captureXhr` captured nothing. Fetch the URL yourself and check.
- Captured XHR order changes: tighten `xhrUrlFilter` so the wanted response is the only (or first) one.
- Values missing: JSON field paths are case-sensitive, have no `$` root and no quoted keys; arrays need `[*]`
  or `[n]`.
- Missing keys disappear from the output (undefined); add `emptyIfNull` / `nullIfEmpty` if consumers need them.

## API errors from extract
| Code | Meaning | Fix |
|---|---|---|
| `validation_error` (400) | Bad request: unpinned extractor id, bad URL, bad option | Pin the id: `@user/slug@1`, `@user/slug@1.2.3` or `@user/slug@draft` |
| `invalid_target` (400) | A direct fetch (`useProxy: false`) URL or redirect points to a private / internal / ExtractHub host | Use the public URL |
| `version_yanked` (410) | That exact version was withdrawn | Use `@N` or another version |
| `upstream_error` (502) / `upstream_timeout` (504) | Fetching failed / timed out | Retry; reduce browser action waits; try without JS |
| `target_error` (502) | The target page answered non-200 (blocked, 404) | Check the URL; see "Blocked" above |
| `queue_timeout` (503) / 202 job | Busy; the request became an async job | Poll the job (`get_job`) |
| 402 | Not enough credit | Top up |
| 403 on `@draft` | Only the owner can run the draft | Use your own extractor / a released pin |
