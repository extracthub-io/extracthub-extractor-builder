# Example extractor definitions

Complete definitions in the format the skill writes (same keys as the ExtractHub Studio save form and the MCP
`create_extractor` tool). Each one passes `node scripts/check-config.mjs` and is tested against a sample page
with the real ExtractHub engine. URLs on `example.com` domains are placeholders for the page type: replace
them and re-check every selector against the real page before using one.

| File | Page type | Technique |
|---|---|---|
| [books-list-static-html.json](books-list-static-html.json) | Static list page | List of objects (`isArray` + `innerHTML` + `subExtractor`), `exists`, next page |
| [product-detail-jsonld.json](product-detail-jsonld.json) | Product detail | JSON-LD via `jsonContent`, DOM fields scoped to `main`, lazy images, specs table, JS escalation, country |
| [json-api-products.json](json-api-products.json) | JSON API | `sourceType: "json"`, `[*]` paths, `subFields` |
| [nextjs-embedded-state.json](nextjs-embedded-state.json) | Next.js / SPA with embedded state | `script#__NEXT_DATA__` and `script#__window__INITIAL_STATE` via `jsonContent`, no JS rendering |
| [js-rendered-search.json](js-rendered-search.json) | JS-rendered results | `renderJavascript`, `wait_for_element`, optional click, `scroll_to_bottom`, ad exclusion, fallback selector |
| [post-json-api.json](post-json-api.json) | POST JSON endpoint | `method: "POST"`, JSON `body`, headers (direct request), `subExtractor`, container `subFields` |

## books-list-static-html
books.toscrape.com is a public scraping sandbox. The item selector `ol.row article.product_pod` matches each
book card; sub-fields are relative to the card. The title comes from the link's `title` attribute because
the visible text is truncated ("A Light in the ..."). `inStock` uses `exists` on the green tick icon instead
of parsing text. Output (shortened):

```json
{
  "books": [
    { "title": "A Light in the Attic", "url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      "price": 51.77, "availability": "In stock", "inStock": true, "imageUrl": "https://books.toscrape.com/media/cache/....jpg" }
  ],
  "resultCount": 1000,
  "nextPageUrl": "https://books.toscrape.com/catalogue/page-2.html"
}
```

## product-detail-jsonld
Price, currency and SKU come from the schema.org JSON-LD block (stable, machine-readable); the rest from the
DOM, always scoped to `main` so the header's logo `h1`, a header price box or the recommendations gallery are
never the first match. Images read `data-src` because `src` is a placeholder. `allowJsEscalation` retries a
plain fetch that comes back empty or unusable with JavaScript rendering; `proxyCountry: "US"` pins the market. If a shop has several `ld+json` blocks,
check that the Product block is the first one.

```json
{ "name": "Oak Desk Lamp", "price": 89, "currency": "USD", "sku": "LAMP-OAK-01", "brand": "Woodlight",
  "originalPrice": 119, "inStock": true, "images": ["https://shop.example.com/img/lamp-1.jpg", "..."],
  "description": "A warm oak desk lamp with a linen shade.", "breadcrumbs": ["Home", "Lighting", "Oak Desk Lamp"],
  "specs": [{ "label": "Height", "value": "45 cm" }], "reviewCount": 128 }
```

## json-api-products
The URL returns JSON, so `sourceType: "json"` with plain dot paths. `products[*]` + `subFields` maps each
element; `products[*].images[0]` returns one value per product. A missing key (a product without `brand`)
is left out of that object.

## nextjs-embedded-state
The HTML is a skeleton, but the full data is in `script#__NEXT_DATA__`, so no JS rendering is needed (standard
tier). A path ending at an array (`listings`) returns the array as-is (`jsonPaths` have no `[*]`). Several
`jsonPaths` on one field return an object keyed by path (`agent`). `window.__INITIAL_STATE__ = {...}` is
read through the virtual `script#__window__INITIAL_STATE`.

```json
{ "city": "Austin, TX", "totalResults": 2, "listings": [{ "id": "h1", "address": "12 Elm St", "price": 525000, "beds": 3 }, "..."],
  "firstListingPrice": 525000, "agent": { "agent.name": "Dana Reyes", "agent.phone": "+1 512 555 0100" },
  "pageTitle": "Homes for sale in Austin, TX" }
```

## js-rendered-search
Only for pages whose raw HTML has no results (check embedded JSON first). `wait_for_element` waits for the
first card; the cookie click and the scroll use `on_error: "skip"` because they are optional. The item
selector is scoped to `#results` and excludes `.is-sponsored` cards, so the sponsored card and the
"recommended" rail are not counted. `salary` uses a fallback chain (`combineStrategy: "first"`). JS tier.

## post-json-api
POST with a JSON string body. Custom headers are not sent when the request goes through the scraping proxy
(`useProxy: true`); they are only sent on direct requests, so this definition uses `useProxy: false` to send
its `Content-Type`. `data.hits` + `subExtractor` maps each hit
(nested `[*]` inside works); `pagination` uses `subFields` without `jsonPath` to build one object from the root.
