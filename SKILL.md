---
name: extracthub-extractor-builder
description: Builds, tests and uploads ExtractHub extractors (web scraping definitions of request options + CSS/JSON field config that turn a page type into structured JSON). Use when the user wants to create, build, write, fix or improve an ExtractHub extractor, scrape a site or page type "with ExtractHub", turn product / listing / article / job / search pages or a JSON API into JSON through ExtractHub, or upload / release an extractor to ExtractHub (with or without the ExtractHub MCP server).
---

# ExtractHub extractor builder

An ExtractHub extractor is a JSON definition: how to fetch a page (request options) and how to turn it
into JSON (`extractorConfig`). Callers run it on any URL of the same page type through the ExtractHub API or
MCP `extract` tool. Your job: write a definition that is correct on the real page, validate it, upload it,
test it, and release it only when the user agrees.

Reference files (read when needed):
- [references/config-reference.md](references/config-reference.md): every field shape, extract type, JSON path rule and transform.
- [references/request-options.md](references/request-options.md): proxy, JS rendering, browser actions, XHR, POST, country, price tiers, Studio import file.
- [references/selectors-and-pitfalls.md](references/selectors-and-pitfalls.md): supported selector syntax, stable selectors, engine pitfalls.
- [references/troubleshooting.md](references/troubleshooting.md): empty fields, wrong values, blocked pages, JS-only content, API errors.
- [references/releasing-and-versions.md](references/releasing-and-versions.md): draft, pins, semver, visibility.
- [examples/](examples/README.md): six complete definitions (static list, product detail, JSON API, embedded JSON, JS-rendered, POST API).

## Workflow

Copy this checklist and keep it updated:

```
Extractor progress:
- [ ] 1. Page type, example URL(s) and fields agreed
- [ ] 2. Page inspected; fetch mode chosen (HTML / embedded JSON / JSON API / JS / XHR)
- [ ] 3. Definition written
- [ ] 4. Validated (MCP validator dry run, or local checker) and fixed
- [ ] 5. Uploaded as private draft; live-tested on @draft; output matches the dry run
- [ ] 6. Released (only with the user's OK); pins explained
```

### 1. Clarify (ask only what is missing)
- Page type and one or two example URLs (a real URL is required; a second URL of the same type catches
  page-specific selectors).
- The fields the user wants. If they only name the page type, propose a short default set (e.g. product:
  name, price, currency, originalPrice, inStock, images, url) and confirm it.
- List page or detail page? For lists: one object per item, plus `nextPageUrl` if it paginates.
Do not ask about request options; you decide them in step 2.

### 2. Inspect the target page
Fetch the URL the way ExtractHub would (no browser first): web fetch / `curl -sL -A "Mozilla/5.0" <url>`.
Save the HTML; you will validate against it. Then decide (details: references/request-options.md):

1. Is the data in the raw HTML? → plain fetch (`useProxy: true`, no JS). Cheapest.
2. Is it in a `<script>` JSON block (`application/ld+json`, `script#__NEXT_DATA__`, `window.__STATE__ = {...}`,
   `self.__next_f.push`)? → still a plain fetch, read it with `jsonContent`. Often the most stable source.
3. Does the URL return JSON, or does the page load its data from a JSON API you can call directly? →
   `sourceType: "json"` on that URL.
4. Only an empty shell / skeleton in the raw HTML? → `renderJavascript: true` + a `wait_for_element`
   browser action; write selectors against the rendered DOM (browser snapshot / DevTools), still limited to
   the supported selector syntax.
5. Data only in background responses → `renderJavascript` + `captureXhr` + `xhrUrlFilter`, `sourceType: "json"`.
6. Clicks / scrolling / typing needed → `browserActions` (needs `renderJavascript`).
7. Blocked or captcha HTML → keep `useProxy: true`, add `allowJsEscalation: true` or `proxyCountry`.

JS rendering, XHR capture and browser actions use the more expensive JS price tier: use them only when 1-3
fail. If your fetch is blocked but a browser shows data, assume the extractor needs the proxy (and maybe JS).

### 3. Write the definition
Start from the closest file in [examples/](examples/README.md). Shape:

```json
{
  "name": "Example shop - product page",
  "description": "Name, price and stock of an example.com product page.",
  "slug": "example-shop-product",
  "url": "https://example.com/p/123",
  "method": "GET",
  "useProxy": true,
  "renderJavascript": false,
  "extractorConfig": {
    "version": "v1.0",
    "fields": [
      { "name": "name", "selector": "main h1", "extract": "textContent", "transforms": ["normalizeWhitespace"] },
      { "name": "price", "selector": "main [itemprop=\"price\"][content]", "extract": "attributeValue", "attributeName": "content", "transforms": ["toNumber"] },
      { "name": "inStock", "selector": "main link[itemprop=\"availability\"][href$=\"InStock\"]", "extract": "exists" }
    ]
  }
}
```

Rules that matter most:
- Lists: ONE field with `isArray: true`, `extract: "innerHTML"`, a selector matching each item (not the
  wrapper, no ads), and `subExtractor.fields` with selectors relative to the item.
- Only supported selectors: no `+`, `~`, `:has()`, `:last-child`, `:contains()`, XPath. A non-array field
  takes the FIRST match: scope to the main content.
- Prefer stable hooks: `#id`, `[data-testid]`, `[itemprop]`, semantic tags; avoid generated classes.
- Machine-readable values: attributes (`content`, `datetime`, `data-src`), current price not the struck one,
  `toAbsoluteUrl` on links/images, `extractPrice` on prices, `exists` for booleans.
- `attributeValue`: require the attribute in the selector (`a[href]`), else a missing attribute yields `"null"`.
- Names: camelCase, one per value, stable (renaming later is a breaking version).
- Never put secrets (cookies, tokens) in headers or body; public and unlisted definitions are visible.
- Custom `headers` (the `Cookie` header included) are not sent when the request goes through the scraping
  proxy (`useProxy: true`); they are only sent on direct requests (`useProxy: false`). Scraping providers manage
  headers for ban avoidance. A JSON API that needs auth headers must use `useProxy: false`. On direct requests
  add only what the target needs; overriding User-Agent or Accept* may get the request blocked
  (references/request-options.md).

### 4. Validate and iterate
**With the ExtractHub MCP server** (tools usually appear as `extracthub` server tools):
call `validate_extractor_config` with the definition (or its `extractorConfig` and request options) and
`sample_html` (the HTML you fetched in step 2) or `sample_json` (the JSON response). It runs the real engine
without fetching. Read every error and warning and the dry-run output; fix and repeat until:
- no errors; every requested field has the expected value on the sample;
- list lengths equal the number of real items on the page; no wrong first matches.
Validate against a second URL's HTML too when you have one.

**Without MCP**: run the bundled structure checker, then check selectors yourself against the saved HTML
(e.g. search the HTML for each class / attribute; count list items):
```bash
node scripts/check-config.mjs my-extractor.json
```
It checks keys, types, option combinations and unsupported selectors (exit 0 = OK). It does not run
selectors; tell the user the definition is unverified until it runs in ExtractHub.

### 5. Upload and live-test (MCP)
1. `create_extractor` with the definition fields (`name`, `description`, `url`, `method`, `body`, `headers`,
   `useProxy`, `renderJavascript`, `captureXhr`, `xhrUrlFilter`, `browserActions`, `proxyCountry`,
   `allowJsEscalation`, `waitForSelector`, `waitTime`, `extractorConfig`, `category`, `tags`, `slug`, `visibility`). Keep `visibility`
   private unless the user asked otherwise. The slug can only be set here (later it is fixed). Note the
   returned extractor id `@user/slug`. Creating, updating and releasing need a LIVE API key: with a test key
   (`exth_test_...`) these tools answer `live_key_required` and only `validate_extractor_config` works.
   A `validation_error` lists the failing paths in `details.errors`; `slug_taken` / `invalid_slug`: pick another.
2. Tell the user a live test is a billed extract call (standard tier, or JS tier with JS / XHR / browser
   actions; `get_account` shows prices and balance), then run `extract` with
   `extractor_id: "@user/slug@draft"` and the example URL. A test API key only returns simulated data: a live
   key is needed to see real output.
3. Compare with the dry run. If they differ or fields are empty, see references/troubleshooting.md, fix the
   definition, `update_extractor`, and test again. Stop after a few rounds and report what still fails.

### 6. Release (only when the user agrees)
`release_extractor` creates an immutable version (first one `1.0.0`; later bumps follow the output-schema
change). Like the Studio, it checks the draft on a sample page first: pass `sample_html` (or `sample_json`)
with the page you fetched, or `fetch_sample: true` to let ExtractHub fetch the example URL once (one billed
extract; tell the user). Call it with `dry_run: true` first and show the user the planned version and schema
diff, then call it again without `dry_run`. Optional: `bump` (may raise, never lower: `bump_too_low`),
`changelog` (`changelog_required` when a version needs one). `nothing_to_release` means the draft equals the
latest version; `release_check_failed` lists what blocks it (fix with `update_extractor`). Explain: consumers should call `@user/slug@1` (latest 1.x, gets fixes, never breaking changes) or an
exact `@user/slug@1.0.0`; `@draft` is owner-only. Ask before switching visibility to `unlisted` or `public` (public only after a release, else `release_required`).
Details: references/releasing-and-versions.md.

### Without the MCP server
Deliver:
1. The definition JSON (validated with `scripts/check-config.mjs`).
2. A Studio import file: `node scripts/check-config.mjs my-extractor.json --studio-out my-extractor.studio.json`.
   The user opens ExtractHub → Extractor Studio → ⋮ menu → **Import**, picks the file, checks the preview on
   the fetched page, then **Save** (and Release). Browser actions are not in the import file: tell the user
   to add them in the Studio "Browser actions" panel (list them).
3. How to connect the MCP server next time (see the skill README): it makes steps 4-6 automatic.

## Final answer to the user
Report: the extractor id and pins (if uploaded), fetch mode and why, the fields with a sample of the real
output, the price tier (standard or JS), anything unverified or fragile (generated classes, positional
selectors), and the next step (release, or fixes needed).
