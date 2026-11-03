# Request options reference

How ExtractHub fetches the page before extraction. These are the top-level keys of an extractor definition
(the same names as the Studio save form and the MCP `create_extractor` / `update_extractor` inputs).

## Contents
- Definition keys
- Choosing a fetch mode (decision table)
- Proxy, country, JS escalation
- JavaScript rendering
- Page waits (waitForSelector, waitTime)
- Browser actions
- XHR capture
- POST requests and headers
- Price tiers
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
| `useProxy` | boolean | `false` | Fetch through ExtractHub's proxy network. Needed by every option below |
| `renderJavascript` | boolean | `false` | Render in a headless browser |
| `captureXhr` | boolean | `false` | Return captured background (XHR/fetch) responses as JSON. Needs `renderJavascript` |
| `xhrUrlFilter` | string | | Comma-separated URL substrings to keep from the captured responses |
| `browserActions` | array | | Steps run in the browser before the HTML is taken. Needs `renderJavascript` |
| `proxyCountry` | ISO alpha-2 | default pool | Exit country, e.g. `US`, `GB`, `DE`, `ID` |
| `allowJsEscalation` | boolean | `false` | If a plain fetch looks blocked/empty, retry once with JS rendering |
| `waitForSelector` | string (CSS) | | With `renderJavascript`: wait (max 15 s) until this element exists |
| `waitTime` | number (ms) | | With `renderJavascript`: extra wait after `waitForSelector`, capped at 15000 |
| `category` | enum | | Catalog category: `ecommerce`, `news`, `social-media`, `job-listings`, `real-estate`, `events`, `research`, `travel`, `healthcare`, `finance`, `education`, `entertainment`, `sports`, `other` |
| `tags` | string[] | | Free tags |
| `extractorConfig` | object | required | See config-reference.md |

Callers of the extract API can override the URL (always) and the POST headers/body (their own request);
everything else comes from the released version.

## Choosing a fetch mode

| What you see when you fetch the URL yourself | Use |
|---|---|
| The data is in the raw HTML (view-source / curl shows it) | `useProxy: true`, no JS. Cheapest |
| The data is in a `<script>` JSON block (`__NEXT_DATA__`, `ld+json`, `window.__X__ = {...}`) | `useProxy: true`, no JS, `jsonContent` fields |
| The URL itself returns JSON (an API) | `sourceType: "json"`; `useProxy: true` if it needs no headers, `useProxy: false` if it needs auth headers (headers are not sent through the proxy) |
| Raw HTML is an empty shell / skeleton, data appears only in a browser | `renderJavascript: true` (+ `waitForSelector` or `wait_for_element`) |
| Data comes from a background API call you can see in the browser's network tab | Prefer calling that API URL directly with `sourceType: "json"`; otherwise `renderJavascript` + `captureXhr` + `xhrUrlFilter` |
| Content appears after a click / scroll / typing | `renderJavascript: true` + `browserActions` |
| Site serves different content or blocks by country | `proxyCountry` |
| Plain fetch sometimes gets a block / captcha page | `allowJsEscalation: true` |

Default to `useProxy: true`: most sites block or degrade plain datacenter requests. Use `useProxy: false`
only for open APIs and pages that work without it. Direct requests only reach public http(s) hosts (no
private, internal or ExtractHub addresses, also after a redirect), follow at most 5 redirects and read at most 5 MB.

## Proxy, country, JS escalation
- `proxyCountry` must be a two-letter ISO 3166-1 code; empty or null means the default pool. Use it for
  geo-specific prices, languages or availability, and for sites that only answer local visitors.
- `allowJsEscalation` only applies to fetches without `renderJavascript`. When the response looks blocked or
  empty, ExtractHub retries once with JS rendering; that call is billed at the JS tier. Good safety net for
  product pages on protected shops.

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
| `click` | `selector`, optional `wait_after_s` (int >= 0) | Cookie banners, "load more", tabs |
| `input` | `selector`, `value` | Type into a field |
| `scroll` | `x`, `y` (pixels, int) | Scroll by an amount |
| `scroll_to_bottom` | `timeout_s` (int >= 1) | Infinite scroll / lazy loading |

- `selector`: `{ "type": "css", "value": "#results .card" }`. Types: `css` (preferred), `xpath`, `text`
  (visible text). Browser-action CSS runs in a real browser, so any CSS is fine here (unlike extractor fields).
- `on_error`: `"error"` (default, the request fails) or `"skip"` (continue). Use `"skip"` for optional steps
  such as a cookie banner that is not always shown.
- Keep the total of waits and timeouts short (a few seconds to ~15 s); long sequences risk timeouts.

```json
"browserActions": [
  { "type": "wait_for_element", "selector": { "type": "css", "value": "[data-testid=\"product-grid\"] article" }, "timeout_s": 10 },
  { "type": "click", "selector": { "type": "css", "value": "#onetrust-accept-btn-handler" }, "wait_after_s": 1, "on_error": "skip" },
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
Every extract call is billed per URL at one of two tiers: on success, and also on a failure after the scraping
provider fetched the page (target error status, block page, extraction / JSON error, provider timeout; the error
body says `charged: true`). Failures before any provider work are not charged.
- standard: plain fetch (no JavaScript).
- JS: `renderJavascript`, `captureXhr` or any `browserActions` (and an escalated `allowJsEscalation` call).

Exact prices are on the ExtractHub pricing page and in the MCP `get_account` / `get_extractor` tools; do not
quote numbers from memory. Owners may add a per-use price to public extractors. Test API keys are free and
return simulated results (they never fetch the page).

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
  "extractor": { "version": "v1.0", "fields": [ ... ] }
}
```

Note the different names (`renderJs`, `country`). Browser actions are not part of this file: add them in
the Studio "Browser actions" panel after importing. `node scripts/check-config.mjs def.json --studio-out
def.studio.json` writes this file from a definition.
