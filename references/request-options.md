# Request options reference

How ExtractHub fetches the page before extraction. These are the top-level keys of an extractor definition
(the same names as the Studio save form and the MCP `create_extractor` / `update_extractor` inputs).

## Contents
- Definition keys
- Catalog category (allowed values)
- Sample pages (raw vs rendered, samples through ExtractHub)
- Choosing a fetch mode (decision table)
- Proxy, country, JS escalation
- JavaScript rendering
- Page waits (waitForSelector, waitTime)
- Browser actions
- XHR capture
- POST requests and headers
- Price tiers (and the X-Credit-Balance header)
- Legacy keys
- Studio import file

## Definition keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | required | Display name |
| `description` | string | | What it extracts, from which page type |
| `slug` | string | from name | Create only. `@username/<slug>`: lowercase letters, digits, single hyphens, 3-100 chars |
| `visibility` | `private` \| `unlisted` \| `public` | `private` | Create / update; `public` needs a released version (`release_required`) |
| `url` | string | required | Example target URL; callers pass their own URL of the same page type |
| `method` | `GET` \| `POST` | `GET` | |
| `body` | string | | POST body, sent as-is |
| `headers` | object of strings | | Custom request headers. Only sent with `useProxy: false`; see "POST requests and headers" |
| `useProxy` | boolean | `false` | Fetch through ExtractHub's proxy network. Needed by every option below: JavaScript rendering, XHR capture and browser actions always use the proxy (the save sets `useProxy: true` and warns `proxy_enabled_for_js`) |
| `renderJavascript` | boolean | `false` | Render in a headless browser |
| `captureXhr` | boolean | `false` | Return captured background (XHR/fetch) responses as JSON. Needs `renderJavascript` |
| `xhrUrlFilter` | string | | Comma-separated URL substrings to keep from the captured responses |
| `browserActions` | array | | Steps run in the browser before the HTML is taken. Needs `renderJavascript` |
| `proxyCountry` | ISO alpha-2 | default pool | Exit country, e.g. `US`, `GB`, `DE`, `ID` |
| `allowJsEscalation` | boolean | `false` | If a plain fetch comes back empty or unusable, retry once with JS rendering |
| `waitForSelector` | string (CSS) | | With `renderJavascript`: wait (max 15 s) until this element exists |
| `waitTime` | number (ms) | | With `renderJavascript`: extra wait after `waitForSelector`, capped at 15000 |
| `category` | enum | | Catalog category (a value, see "Catalog category" below): `ecommerce`, `news`, `social-media`, `job-listings`, `real-estate`, `events`, `research`, `travel`, `healthcare`, `finance`, `education`, `entertainment`, `sports`, `other` |
| `tags` | string[] | | Free tags |
| `extractorConfig` | object | required | See config-reference.md |

Callers of the extract API can override the URL (always) and the POST headers/body (their own request);
everything else comes from the released version.

## Catalog category

`category` takes one **value** from this list, exactly as written (lowercase, with hyphens). The label is only
what the catalog shows. Labels (`Travel & Hospitality`), title case (`Travel`) and other words (`media`,
`shopping`) are refused with `invalid_category`. Leave `category` out when nothing fits, or use `other`.

| Value | Catalog label | For pages such as |
|---|---|---|
| `ecommerce` | E-commerce | product lists and details, prices, marketplaces, shopping results |
| `news` | News & Articles | news, blogs, articles, press releases |
| `social-media` | Social Media | profiles, posts, comments, video platforms |
| `job-listings` | Job Listings | job boards, job details, company career pages |
| `real-estate` | Real Estate | property listings, rentals, agents |
| `events` | Events & Tickets | event listings, tickets, venues |
| `research` | Research & Data | search engine results, directories, datasets, papers, public records |
| `travel` | Travel & Hospitality | hotels, flights, places and maps, restaurants, reviews of places |
| `healthcare` | Healthcare | doctors, clinics, drugs, health information |
| `finance` | Finance & Investing | stocks, crypto, exchange rates, company financials |
| `education` | Education | courses, schools, universities |
| `entertainment` | Entertainment | movies, TV, music, games, books |
| `sports` | Sports | scores, fixtures, players, teams |
| `other` | Other | anything else |

Pick by what the extracted data is about, not by the site's brand: Google Maps places -> `travel`, Google web
results -> `research`, an Amazon product -> `ecommerce`.

## Sample pages (raw vs rendered)

The validator dry-runs your definition on a sample you provide; the sample must be what ExtractHub itself
will see for the chosen fetch mode. Always save samples to files and pass them with `scripts/validate.mjs`.

| Fetch mode | Sample | How to save it |
|---|---|---|
| Plain fetch (`renderJavascript: false`), direct or proxy | Raw server HTML | `curl -sL -A "Mozilla/5.0" "<url>" -o samples/page.html` |
| JSON API (`sourceType: "json"`) | The response body | `curl -sL "<api url>" -o samples/response.json` (POST: add `-X POST -H ... --data ...` as in the definition) |
| `renderJavascript: true` | Rendered DOM after the content appeared | Playwright script below, or a browser tool's `document.documentElement.outerHTML` written to a file |
| `captureXhr: true` | The captured-responses array | Build `[{"url": ..., "status_code": 200, "response_body": "<the JSON as a string>"}]` from the browser's network tab |

Rules:
- A plain-fetch extractor is validated on the RAW file only. A browser DOM contains elements added by
  JavaScript: selectors on them pass the dry run and return empty in production.
- Compare raw and rendered when unsure: data present only in the rendered file means `renderJavascript`;
  data in both means a plain fetch is enough (check `<script>` JSON blocks in the raw file first).
- curl from your machine is an approximation: your own network may get the page where ExtractHub's direct
  fetcher does not, and the reverse. If curl gets an error or challenge page while a browser loads fine, plan
  for `useProxy: true`; the live test on `@draft` is the final word.
- Never sample from a logged-in or personal browser profile (cookies, account data, personalised prices):
  ExtractHub fetches anonymously, and the sample may contain private data.
- Keep samples under 2 MB (the validator limit): save the page only, no assets.
- Big sites vary per request: results can differ per call (ExtractHub may use different fetch routes, and
  the site may serve another A/B layout each time). Validate on several samples.

Rendered sample with Playwright (Node; `npm i -D playwright && npx playwright install chromium` once). Wait for
the same element your `wait_for_element` action waits for:

```js
// save-rendered.mjs <url> <wait-selector> <out.html>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const [url, waitFor, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(waitFor, { timeout: 15000 });
writeFileSync(out, await page.content());
await browser.close();
```

Run the same clicks / scrolls as your `browserActions` before `page.content()` when the extractor uses them.

### Samples through ExtractHub

When your own fetch cannot get the page (an error, challenge or JavaScript-only page), or when a live run differs from the dry
run, let ExtractHub fetch the sample with the exact request options of the extractor (proxy, country, JS,
browser actions). This is the only sample that matches production exactly. Each fetch is one billed extract
call at the extractor's tier: tell the user first.

The MCP `extract` tool shortens `return_raw_html` to ~64 KB in total (a 614 KB Google results page came back
as 5 KB of HTML). Use `raw_html: "link"` instead: the result then has `raw_html_url`, a signed link (valid
1 hour, no API key needed) to the full page exactly as the engine received it, and `raw_html_bytes`:

1. Save the extractor as a draft first (`create_extractor` / `update_extractor`) with the request options you
   want to test; the fields can be work in progress.
2. Call `extract` with `extractor_id: "@user/slug@draft"`, the URL and `raw_html: "link"`, then download the
   page to a file (no extra charge for the link):
   ```bash
   curl -s "<raw_html_url>" -o samples/live-1.html
   ```
   No MCP connection? The REST API returns the full page too:
   ```bash
   curl -s -G -H "X-API-Key: $EXTRACTHUB_API_KEY" "https://api.extracthub.io/api/extractor/extract"      --data-urlencode "extractor_id=@user/slug@draft" --data-urlencode "target_url=<url>"      --data-urlencode "return_raw_html=true" --data-urlencode "async_fallback=false" -o samples/live-1.json
   node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!r.success){console.error(JSON.stringify(r.errors??r.error));process.exit(1)}require("fs").writeFileSync(process.argv[2],r.result.rawHtml??"");console.log("saved",(r.result.rawHtml??"").length,"chars")' samples/live-1.json samples/live-1.html
   ```
   The REST API takes the key as `X-API-Key` or `Authorization: Bearer <key>` (both with different keys:
   400 `ambiguous_credentials`). The answer is `{ success, result: { extracted, metadata, rawHtml } }`. With
   `async_fallback=false` a busy queue answers 503 `queue_timeout` (retry after `Retry-After`) instead of
   turning the call into an async job.
3. Validate on the saved file with `scripts/validate.mjs`. For big sites repeat step 2 a few times (results can
   differ per call: fetch routes and site A/B layouts vary) and validate on each sample.

## Choosing a fetch mode

| What you see when you fetch the URL yourself | Use |
|---|---|
| The data is in the raw HTML (view-source / curl shows it) | No JS. `useProxy: false` (direct, cheapest) for open sites, else `useProxy: true` |
| The data is in a `<script>` JSON block (`__NEXT_DATA__`, `ld+json`, `window.__X__ = {...}`) | `useProxy: true`, no JS, `jsonContent` fields |
| The URL itself returns JSON (an API) | `sourceType: "json"`; `useProxy: true` if it needs no headers, `useProxy: false` if it needs auth headers (headers are not sent through the proxy) |
| Raw HTML is an empty shell / skeleton, data appears only in a browser | `renderJavascript: true` (+ `waitForSelector` or `wait_for_element`) |
| Data comes from a background API call you can see in the browser's network tab | Prefer calling that API URL directly with `sourceType: "json"`; otherwise `renderJavascript` + `captureXhr` + `xhrUrlFilter` |
| Content appears after a click / scroll / typing | `renderJavascript: true` + `browserActions` |
| Site serves different content per country, or only to local visitors | `proxyCountry` |
| Plain fetch sometimes comes back empty or as a placeholder page | `allowJsEscalation: true` |

Default to `useProxy: true` (managed fetching): many sites do not serve their full content to plain server requests. Use `useProxy: false`
for open APIs and pages that work without it (demo sites, documentation, government and open-data pages,
public APIs). When unsure, one live test on `@draft` with `useProxy: false` settles it cheaply: a failed
direct call is not charged. Direct requests only reach public http(s) hosts (no
private, internal or ExtractHub addresses, also after a redirect), follow at most 5 redirects and read at most 5 MB.

If the site refuses the direct request (HTTP 403, 429 or 503), the error is `target_error` with a `hint`:
"The site refused the direct request (HTTP 429). Retry with useProxy: true (premium tier)." Switch to
`useProxy: true`; curl from your own machine succeeding does not mean ExtractHub's direct fetcher gets through.
A direct `200` that looks like a block, challenge or consent page still succeeds, with
`metadata.warnings: [{ "code": "direct_fetch_looks_blocked", ... }]`: empty fields are likely, use the proxy.

## Proxy, country, JS escalation
- `proxyCountry` must be a two-letter ISO 3166-1 code; empty or null means the default pool. Use it for
  geo-specific prices, languages or availability, and for sites that only answer local visitors.
- `allowJsEscalation` only applies to fetches without `renderJavascript`. When the response is empty or
  unusable, ExtractHub retries once with JS rendering; that call is billed at the JS tier. Useful for pages
  that sometimes need JavaScript to show their content.

## JavaScript rendering
`renderJavascript: true` loads the page in a headless browser and extracts from the rendered DOM. It is
slower and costs more (JS tier). Only use it when the raw HTML really lacks the data. Most "dynamic" sites
still embed their data as JSON in the HTML: check that first.

## Page waits (waitForSelector, waitTime)
Only with `renderJavascript: true` (a plain fetch cannot wait; the validator warns). They run right after the
page loads, before `browserActions`: first `waitForSelector` (CSS, waits at most 15 s), then `waitTime`
(milliseconds, capped at 15000). They never fail the request: if the element never appears, the extraction runs
on the page as it is (check your fields for empty values). They do not change the price (JS tier anyway).
Equivalent to a leading `wait_for_element` (`timeout_s: 15`, `on_error: "skip"`) / `wait` browser action;
use browser actions when you need a wait between clicks or a shorter timeout. The Studio does not show these two
keys (set them through MCP; the Studio keeps them when you save).

## Browser actions

Run in order in the browser, before the HTML is taken. All require `useProxy` + `renderJavascript`.

| type | Keys | Use |
|---|---|---|
| `wait_for_element` | `selector`, `timeout_s` (int >= 1) | Wait until the content you extract exists. Add this to almost every JS extractor |
| `wait` | `wait_time_s` (int >= 1) | Fixed pause (last resort) |
| `click` | `selector`, optional `wait_after_s` (int >= 0) | Cookie banners, "load more", tabs. Recommended: follow it with a separate `wait` |
| `input` | `selector`, `value` | Type into a field |
| `scroll` | `x`, `y` (pixels, int), optional `selector` | Scroll by an amount (relative: from where the page or element is now) |
| `scroll_to_bottom` | `timeout_s` (int >= 1), optional `selector` (+ `max_scrolls`, `pause_s`, `stop_when`) | Infinite scroll / lazy loading |

- `selector` must be an object: `{ "type": "css", "value": "#results .card" }`. A plain string
  (`"selector": "#results .card"`) is a validation error. Types: `css` (preferred), `xpath`, `text`
  (visible text). Browser-action CSS runs in a real browser, so any CSS is fine here (unlike extractor fields).
- Recommended pattern: `click` followed by a separate `{ "type": "wait", "wait_time_s": n }`. A `click` with
  `wait_after_s` still works: it is normalised automatically into the click plus a `wait` of that many seconds.
  Seconds and pixels are whole numbers (fractions are rounded up for waits); a `wait` of 0 is dropped.
- `on_error`: `"error"` (default, the request fails) or `"skip"` (continue). Use `"skip"` for optional steps
  such as a cookie banner that is not always shown.
- Keep the total of waits and timeouts short (a few seconds to ~15 s); long sequences risk timeouts.

### Scrolling inside an element (results panels)
Without `selector`, `scroll` / `scroll_to_bottom` move the page window. Many sites keep the window still and load
more items when an inner panel reaches its end (Google Maps results, chat / comment panels, side lists). Give the
panel as `selector` (css or xpath; no `text` selector here):

- `scroll` + `selector`: scrolls that element by `x` / `y` pixels.
- `scroll_to_bottom` + `selector`: scrolls the element to its end, waits `pause_s` (0.5-5, default 1.5), and repeats
  until it stops growing, after `max_scrolls` (1-50, default 10), once `stop_when` (a css / xpath selector, e.g. an
  end-of-list message) exists, or at `timeout_s` (at most **30** with a selector). `max_scrolls`, `pause_s` and
  `stop_when` are only valid with a `selector`.
- A missing element follows `on_error`: `"skip"` does nothing, `"error"` (default) fails the action.
- Same JavaScript-rendering price per call; a longer scroll does not cost more.
- Element scrolling cannot run on every site. When it cannot run for a request, the call fails before any page is
  fetched with `browser_action_unavailable` (HTTP 422, **not charged**): remove the `selector` (window scroll) or
  retry later.
- `validate_extractor_config` (and `create_extractor` / `update_extractor` / the `release_extractor` plan) warn with
  `element_scroll_unavailable` (path of the first element scroll, e.g. `browserActions[1].selector`) when the site
  cannot run it right now. It is a warning: saving and releasing still work. The offline checker cannot know this.

Google Maps search results (`div[role="feed"]` loads 20 places per batch):

```json
"browserActions": [
  { "type": "wait_for_element", "selector": { "type": "css", "value": "div[role=\"feed\"]" }, "timeout_s": 10 },
  { "type": "scroll_to_bottom", "selector": { "type": "css", "value": "div[role=\"feed\"]" },
    "timeout_s": 25, "max_scrolls": 8, "pause_s": 2,
    "stop_when": { "type": "xpath", "value": "//span[contains(text(), \"reached the end of the list\")]" } }
]
```

```json
"browserActions": [
  { "type": "wait_for_element", "selector": { "type": "css", "value": "[data-testid=\"product-grid\"] article" }, "timeout_s": 10 },
  { "type": "click", "selector": { "type": "css", "value": "#onetrust-accept-btn-handler" }, "on_error": "skip" },
  { "type": "wait", "wait_time_s": 1, "on_error": "skip" },
  { "type": "scroll_to_bottom", "timeout_s": 5, "on_error": "skip" }
]
```

## XHR capture
With `captureXhr: true` (+ `renderJavascript`, `useProxy`) the content is a JSON array of captured responses
`{ url, method, status_code, response_body, ... }`, not HTML. Set `sourceType: "json"` and an `xhrUrlFilter`
such as `"/api/search,graphql"`. See "Captured XHR responses" in config-reference.md. If the API URL is
stable and needs no browser cookies, calling it directly (no JS) is cheaper and more reliable.

## POST requests and headers
- `method: "POST"` + `body` (a string: JSON text, or `a=1&b=2` form data). Works with and without proxy;
  do not combine POST with `renderJavascript` (not every rendering route can send a POST body).
- **Custom headers are not sent when the request goes through the scraping proxy (`useProxy: true`); they are
  only sent on direct requests (`useProxy: false`).** Scraping providers manage headers for ban avoidance, so
  with the proxy on no custom header and no `Cookie` header reaches the target (plain fetch and
  `renderJavascript` alike; the validator warns `headers_not_sent_with_proxy`). A JSON API that needs auth headers
  must use `useProxy: false` (the same for a POST that needs `Content-Type: application/json`).
- On direct requests the headers are sent as they are, `Cookie` included. Only add headers the target needs;
  overriding User-Agent or Accept* may get the request blocked.
- How headers are sent:

  | Fetch | Headers sent | `Cookie` header |
  |---|---|---|
  | `useProxy: false` (direct) | all, as they are | sent as is |
  | `useProxy: true` (plain fetch or `renderJavascript`) | none | not sent |

- Callers of the extract API (POST `target.headers`) replace the saved headers; the same rule applies: they are
  sent only when the extractor version fetches directly (`useProxy: false`).
- Never put secrets (session cookies, private tokens) into a definition: released versions are visible to
  everyone who can see the extractor.

## Price tiers
Every extract call is billed per URL at one of three tiers: on success, and also on a failure after the scraping
provider fetched the page (target error status, block page, extraction / JSON error, provider timeout; the error
body says `charged: true`). Failures before any provider work are not charged, and neither are failed direct calls.
- direct: `useProxy: false`, no JavaScript. Cheapest; ExtractHub fetches the page itself (no provider), so only
  for open pages and APIs that answer datacenter requests. Never escalates to JS.
- standard (premium): `useProxy: true`, no JavaScript.
- JS (premium_js): `renderJavascript`, `captureXhr` or any `browserActions` (and an escalated `allowJsEscalation`
  call). JavaScript rendering always goes through the proxy, whatever `useProxy` says.

Exact prices are on the ExtractHub pricing page and in the MCP `get_account` / `get_extractor` tools; do not
quote numbers from memory. Owners may add a per-use price to public extractors. Test API keys are free and
return simulated results (they never fetch the page).

Credit balance: with a live API key, every realtime extract answer (GET / POST, charged or not, `202` async job,
`402`) carries the response header `X-Credit-Balance`: your balance in USD with 4 decimals after this request
(e.g. `12.3456`; a `202` already has the job's credit hold deducted). Watch it to top up before it runs out. Test
keys never get it. When the balance is too low the API answers `402 insufficient_balance`, nothing is charged, and
the body has `top_up_url` (the dashboard billing page, it opens the Add Funds dialog); MCP `get_account` returns
the same link as `top_up_url`.

## Legacy keys
`useCustomHeaders` (Studio form switch) is derived from `headers` and not needed in a definition (saved headers
are only sent while it is on, and only on direct requests; MCP create / update set it from `headers`).

## Studio import file
ExtractHub Studio (Extractor Studio → ⋮ menu → Import) accepts a `.json` file of this shape:

```json
{
  "target": {
    "url": "https://...", "method": "GET", "body": "...",
    "useCustomHeaders": false, "headers": {},
    "useProxy": true, "renderJs": false, "captureXhr": false,
    "xhrUrlFilter": "...", "country": "US", "allowJsEscalation": true
  },
  "extractor": { "fields": [ ... ] }
}
```

Note the different names (`renderJs`, `country`). Browser actions are not part of this file: add them in
the Studio "Browser actions" panel after importing. `node scripts/check-config.mjs def.json --studio-out
def.studio.json` writes this file from a definition.
