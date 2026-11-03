# Selector strategy and pitfalls

## Contents
- Supported selector syntax (extractor fields)
- Choosing stable selectors
- Choosing the right value
- Lists: exact item counts
- Labels and siblings without wrappers
- Field naming
- Engine pitfalls (checklist)

## Supported selector syntax (extractor fields)

Extraction runs on a streaming HTML parser, not a browser. Only these selectors work in `selector`:

- `tag`, `.class`, `#id`
- `[attr]`, `[attr="v"]`, `[attr^="v"]`, `[attr$="v"]`, `[attr*="v"]`, `[attr~="v"]`
- compound: `a.link[href]`, `.a.b` (one element with both classes)
- descendant `A B`, child `A > B`
- `:nth-child(n)`, `:first-child`, `:nth-of-type(n)`, `:first-of-type`, `:not(simple)`
- comma lists `A, B` (any match, document order)

NOT supported (the extractor fails or matches nothing): `+`, `~`, `:has()`, `:is()`, `:where()`,
`:last-child`, `:last-of-type`, `:nth-last-child()`, `:only-child`, `:contains()`, pseudo-elements, XPath.
(Browser actions run in a real browser and may use any CSS.)

## Choosing stable selectors

Most stable first:
1. `#id`, `[data-testid="..."]`, `[itemprop="..."]`, `[data-*]` hooks, `name` / `role` / `aria-*` / `rel`.
2. Semantic tags inside a scope: `main h1`, `article time[datetime]`, `table.specs td`, `dl dd`.
3. Descriptive class names: `.product-title`, `.price--current`.
4. Last resort: utility or generated classes (`css-1x9k2ab`, `sc-a1b2`, `f6 b mr2`). They change on every
   deploy. If unavoidable, combine with a stable scope and expect maintenance.

Rules:
- Scope to the main content (`main`, `#content`, `[data-testid="pdp"]`) so headers, footers, sidebars,
  carousels and "you may also like" blocks that reuse the same classes are not picked first.
- Avoid long positional chains (`div > div:nth-child(3) > span`); they break with any layout change.
- Avoid text that depends on language or A/B tests.
- Prefer embedded JSON (`ld+json`, `__NEXT_DATA__`, window state) for prices, ids and availability when the
  page has it: it is usually more stable than markup. Cross-check it against the visible page once; some
  sites leave stale JSON-LD.

## Choosing the right value
- Select the smallest element that holds ONLY the value, not a wrapper with a label ("Price:", "SKU:").
- Prices: the CURRENT price, not the struck-through (`<del>`, `<s>`, `.was`) or per-unit / installment price.
  Read the original price in a separate field (`originalPrice`). Use `extractPrice` (locale aware).
- Machine-readable attributes beat display text: `time[datetime]`, `meta[itemprop][content]`,
  `data value`, `aria-label`, `title`, `alt`, `data-price`.
- Images: `src` may be a placeholder (`data:image/...`, `spacer.gif`); lazy images keep the real URL in
  `data-src`, `data-original`, `data-lazy-src` or `srcset`. Pick the attribute that holds the real URL.
- Links and images: always `toAbsoluteUrl`.
- Next page: `a[rel="next"]` when present.
- Booleans: `extract: "exists"` on a marker element (`.in-stock`, `button[disabled]`) instead of parsing text.

## Lists: exact item counts
- The list selector must match each item and ONLY real items: exclude ads/sponsored/promoted cards,
  `<template>` copies, skeleton placeholders and recommendation rails, by scoping (`#results > li`) and/or
  `:not(.sponsored)` / `:not([data-ad])`.
- Count the items on the page and compare with the extracted array length.
- Sub-field selectors are relative to the item's inner HTML: write `h3 a`, not `#results li h3 a`.
- An item attribute (e.g. `data-id` on the `<li>` itself) is not reachable from sub-fields. Select one
  level higher only if the structure allows, otherwise read the id from an inner link or element.

## Labels and siblings without wrappers
Values that only FOLLOW a label (`<dt>Color</dt><dd>Red</dd>`, `<h2>Specs</h2><ul>`) cannot use `+` or `~`.
Options:
- Position among same-tag siblings: `#specs dl > dd:nth-of-type(2)`. `:nth-of-type` counts direct children
  of the same parent with the same tag; count carefully, and remember positions shift when a row is missing.
- Read all rows as a list of `{label, value}` objects (a `subExtractor` over `tr` / `li`, or an `isArray`
  `subFields` pair over `dt` / `dd`) and let the consumer map labels. More robust when rows vary per page.

## Field naming
- camelCase, English, descriptive: `price`, `originalPrice`, `currency`, `inStock`, `rating`, `reviewCount`,
  `imageUrls`, `productUrl`, `postedAt`.
- One field per requested value; no duplicates reading the same element.
- Units in the name when the value is a bare number: `weightKg`, `durationMinutes`.
- Names are the API contract: renaming or removing a field after releasing is a breaking (major) version.

## Engine pitfalls (checklist)
- A non-array field returns the FIRST match in document order: make sure the first match is the right one.
- A selector that matches an element AND its descendants (`main *`) can garble text collection or come
  back null; target one specific level of elements.
- `attributeValue` on an element missing the attribute returns `null`; require the attribute in the selector
  (`img[data-src]`) to skip such elements (and to make the first match one that has it).
- A `selector` array without `combineStrategy` returns `null`.
- `subExtractor` needs `extract: "innerHTML"` (and `isArray: true` for a list).
- An `innerHTML` field whose selector also matches a descendant of a matched element (`div` on nested
  divs) starts a new item at that descendant: target one level of elements.
- On an `isArray` field with `selector`, value transforms run per element and the chain from the first array
  transform (`first`, `compact`, `joinWithComma` ...) on runs on the whole array; put value transforms first.
- `jsonPaths` have no `[*]`; a path to an array returns the whole array. Use `sourceType: "json"` when you need
  per-item mapping of an API response.
- JSON field paths (sourceType json) take no `$` root and no quoted keys; jsonContent paths accept both.
- `textContent` skips `<script>` / `<style>` text automatically; read scripts with `jsonContent`.
- Custom headers (and `Cookie`) are not sent when `useProxy` is true; they are only sent on direct requests
  (`useProxy: false`). A JSON API that needs auth headers must use `useProxy: false`.
- `waitForSelector` / `waitTime` only apply with `renderJavascript` (at most 15 s each); a `wait_for_element`
  browser action gives more control.
