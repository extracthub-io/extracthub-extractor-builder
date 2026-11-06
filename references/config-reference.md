# extractorConfig reference

The `extractorConfig` object turns the fetched content into JSON. Everything here is what the
ExtractHub engine runs; nothing else is accepted.

## Contents
- Top level
- HTML fields: the five shapes
- Required fields and list positions
- Extract types
- Selector arrays and combineStrategy (fallbacks)
- Text options
- Embedded JSON inside HTML (jsonContent, jsonPaths, window state, lists with jsonPath)
- JSON source (sourceType "json")
- Captured XHR responses
- Transforms (complete list)
- Output types and versions

## Top level

```json
{ "version": "v1.0", "sourceType": "html", "fields": [ ... ] }
```

- `version`: always `"v1.0"`.
- `sourceType`: `"html"` (default, omit it) or `"json"` (the response body is JSON: an API, or captured XHR).
- `fields`: at least one. Each field becomes one key in the output, in order. Missing values are `null`.

## HTML fields: the five shapes

### 1. Single value
```json
{ "name": "title", "selector": "h1.product-title", "extract": "textContent", "transforms": ["trim"] }
```
A non-array field returns the FIRST match in document order. No match → `null`.

### 2. Array of values
```json
{ "name": "tags", "selector": ".tag-list li", "isArray": true, "extract": "textContent", "transforms": ["trim"] }
```
One entry per matched element. An element with empty text gives `null` in the array (add `compact` to drop them).

### 3. List of objects (repeated items) — the most important shape
```json
{
  "name": "products",
  "selector": "#results > li.product-card",
  "isArray": true,
  "extract": "innerHTML",
  "subExtractor": {
    "fields": [
      { "name": "name", "selector": "h3", "extract": "textContent", "transforms": ["trim"] },
      { "name": "url", "selector": "a[href]", "extract": "attributeValue", "attributeName": "href", "transforms": ["toAbsoluteUrl"] },
      { "name": "price", "selector": ".price", "extract": "textContent", "transforms": ["extractPrice"] }
    ]
  }
}
```
Rules:
- The list selector matches EACH item (the card / `li` / row), not the wrapper.
- `extract` must be `innerHTML`; `subExtractor.fields` run on each item's INNER html. They cannot select
  the item element itself or read its attributes (put an attribute you need on an inner element, or pick
  a selector one level higher so the attribute holder is inside the item).
- Sub-fields can be any shape again (arrays, nested lists with their own `subExtractor`).
- Without `isArray: true` only the first item is returned (as one object).

### 4. One object from page-level selectors (subFields)
```json
{ "name": "seller", "isArray": false, "subFields": [
  { "name": "name", "selector": ".seller-name" },
  { "name": "rating", "selector": ".seller-rating", "transforms": ["extractNumber"] }
] }
```
- A field has EITHER `selector` OR `subFields`, never both. `subFields` requires `isArray`.
- Sub-field selectors run against the whole page (not scoped). With `isArray: true` the i-th match of every
  sub-field is zipped into the i-th object; counts that differ give misaligned objects. Prefer shape 3 for lists.

### 5. Grouping top-level fields
```json
{ "name": "city", "selector": ".addr .city", "group": { "into": "address", "strategy": "nest" } },
{ "name": "zip",  "selector": ".addr .zip",  "group": { "into": "address", "strategy": "nest" } }
```
Output: `"address": { "city": "...", "zip": "..." }`; the original keys disappear. `"merge"` concatenates
array fields into one array instead.

## Required fields and list positions

`required: true` (any field, any extract type, HTML and JSON) means two different things by level:

- **Top-level field: the request fails without it.** When the value is empty after extraction (`null`, `""`,
  `[]`; `0` and `false` are values), the request fails with `required_fields_missing` (HTTP 422, the error lists
  the missing fields and a hint). The page was fetched, so it is **still charged** like any failure after a
  fetch (a failed direct call, `useProxy: false`, stays free). Batch items and pipeline steps retry it once.
  Use it to catch bot checks, consent walls and partial pages that answer HTTP 200. A grouped field (`group`)
  is checked inside its group (`nest`) or as the merged list (`merge`).
- **Sub-field (`subExtractor.fields[]` or `subFields[]`): incomplete items are dropped.** A list item (object)
  without the value is removed from the list; a single object becomes `null`. Never a request failure by itself:
  mark the parent field `required` too if an empty list should fail.

```json
{ "name": "products", "selector": "li.product-card", "isArray": true, "extract": "innerHTML", "includePosition": true,
  "subExtractor": { "fields": [
    { "name": "name", "selector": "h3", "required": true },
    { "name": "price", "selector": ".price", "transforms": ["extractPrice"] }
  ] } }
```
Output: `"products": [{ "position": 1, "name": "...", "price": 9.5 }, ...]`.

`includePosition: true` on a list of objects (HTML `isArray` with `subExtractor` or `subFields`; JSON a `[*]` path
with `subFields` / `subExtractor`) adds `position` (1-based) as the first key of each item. Positions are numbered
AFTER incomplete items were dropped, so they are always 1..n of the returned items (the item's rank on the page
when nothing was dropped). A sub-field already named `position` is rejected; a list of plain values (no objects)
cannot take a position.

## Extract types

| extract | Returns | Extra keys |
|---|---|---|
| `textContent` (default) | Text of the element and its descendants, whitespace collapsed, every HTML entity decoded as a browser does (named ones such as `&middot;` `&bull;` `&ndash;` `&hellip;`, and numeric `&#183;` / `&#xB7;`; `&nbsp;` gives a plain space; unknown names such as `&foo;` stay). `<script>`/`<style>` text is skipped. | `textSeparator`, `excludeTags` |
| `attributeValue` | One attribute's value, entities decoded as `getAttribute` does (`&amp;` → `&`; `&copy=2` in a URL stays) | `attributeName` (required) |
| `attributeValues` | `"name:value;name:value"` string of the listed attributes | `attributeNames` (required), `keyValueSeparator` (`:`), `attributeSeparator` (`;`) |
| `innerHTML` | Inner HTML string (for lists with `subExtractor`, or with `toMarkdown`) | `allowedAttributes` (keep only these attributes) |
| `exists` | `true` / `false`: did anything match | |
| `count` | Number of matched elements | |
| `jsonContent` | Parses the matched `<script>` text as JSON, then `jsonPaths` (or one `jsonPath` with JSON sub-fields) | `jsonPaths`, or `jsonPath` + `subFields` / `subExtractor` |

Notes:
- `attributeValue` on an element WITHOUT that attribute returns `null` (in an `isArray` field: a `null` entry
  at that element's position). To skip such elements instead, put the attribute in the selector (`a[href]`,
  `img[data-src]`, `meta[property="og:image"][content]`); for a single value this also makes the first match
  one that has it.
- Attribute values are returned as written: relative URLs stay relative until `toAbsoluteUrl`.
- `innerHTML` returns the element's full inner markup: text-only content, text around child elements and
  several `innerHTML` fields on the same elements (or one on a container and one on its descendants) all
  work. Markup is rebuilt from the parsed
  tags: attribute values keep their source escaping but are re-quoted with `"` (`allowedAttributes` keeps
  only the listed ones), whitespace runs collapse to one space, comments are dropped and `excludeTags` drop
  the element with its content.
- A missing value (no match, no text, missing attribute) is `null`; it reaches the field's transforms as
  `null` (so `toAbsoluteUrl` keeps it `null` instead of returning the page URL). In an `isArray` field every
  matched element gives one entry at its own position, an element without a value gives `null` (a list
  whose only match is empty gives `[]`).
- `exists` / `count` ignore transforms' type needs: they already return boolean / number.

## Selector arrays and combineStrategy (fallbacks)

`selector` can be an array, which REQUIRES `combineStrategy` (otherwise the field is `null`):

| combineStrategy | Result |
|---|---|
| `first` | The first selector (in array order) that has a value, its first non-empty value. A fallback chain. |
| `last` | The last non-empty value of the first selector that has a value. |
| `concat` | The non-empty values of the first selector that has a value, joined with `concatSeparator` (default space). |
| `array` | The non-empty values of the first selector that has a value, as an array. |

"Has a value" is judged on the extracted value, not on the element: a selector whose element exists but gives
nothing (empty text, a missing attribute, `jsonContent` paths that resolve to null) falls through to the next
selector. Empty = `null`, `""` or `[]`; `0` and `false` are values. For `jsonContent` with several `jsonPaths`
the object is empty when every path is empty. A comma string (`"h1, h2"`) is ONE selector (document order),
not a fallback list.

```json
{ "name": "price", "selector": [".price--sale", ".price"], "combineStrategy": "first", "transforms": ["extractPrice"] }
```

## Text options
- `textSeparator`: string put between text nodes (default a space). `"\n"` keeps lines apart (then `splitByNewline`).
- `excludeTags`: tag names (`["sup", "small"]`) or `{ "tag": "span", "hasAttributeValue": [["class", "unit"]] }`
  whose text is skipped. Exclusion applies to descendants of the matched element.

## Embedded JSON inside HTML (jsonContent)

Many pages ship their data as JSON inside `<script>` tags. Reading it is often more complete and more
stable than the DOM.

```json
{ "name": "price", "selector": "script[type=\"application/ld+json\"]", "extract": "jsonContent", "jsonPaths": ["offers.price"], "transforms": ["toNumber"] }
```

- `jsonPaths` with ONE path → the value with its JSON type (number, string, object, array, boolean, null).
- SEVERAL paths → an object keyed by the full path text: `{"agent.name": "...", "agent.phone": "..."}`.
- No `jsonPaths` → the whole parsed JSON.
- Path syntax: dot notation, `[n]` indexes, quoted keys for odd names: `props.pageProps["product-detail"].name`,
  `["@graph"][0].name`. A leading `$.` is accepted. No wildcard in `jsonPaths`: a path ending at an array returns
  the whole array (each element as-is). To map an array into a list of chosen properties (`[*]` + sub-fields),
  use the `jsonPath` form: see "Lists from embedded JSON" below.
- Unparsable JSON or a missing path → `null`.
- A non-array field reads the FIRST matching script. Pages often have several `ld+json` blocks; target the
  right one with a more specific selector when possible, or check which one comes first.
- Common sources: `script#__NEXT_DATA__` (Next.js), `script[type="application/ld+json"]` (schema.org),
  `script#__NUXT_DATA__`, `script[type="application/json"][id="..."]`.

### Window state (`script#__window__NAME`)
Assignments in plain scripts such as `window.__INITIAL_STATE__ = {...}`, `window["__APOLLO_STATE__"] = {...}`,
`window.__DATA__ = JSON.parse('...')` or `var data = {...}` are exposed as virtual scripts:
`script#__window__INITIAL_STATE`, `script#__window__APOLLO_STATE`, `script#__window__data`
(name without leading/trailing underscores). Only valid JSON literals are recovered (not JS object literals
with unquoted keys or functions). Next.js App Router payloads (`self.__next_f.push`) appear as
`script#__window__next_f` (best effort, product/listing-like rows only).

```json
{ "name": "productId", "selector": "script#__window__INITIAL_STATE", "extract": "jsonContent", "jsonPaths": ["product.id"] }
```

A `var NAME = {...};` (or `window.NAME = {...};`) followed by more JavaScript in the same script works too: only
the JSON literal after `=` is read. YouTube-style pages ship `var ytInitialData = {...};` and
`var ytInitialPlayerResponse = {...};`, exposed as `script#__window__ytInitialData` and
`script#__window__ytInitialPlayerResponse`.

### Positions that move
Data often sits at different paths (page variants, A/B tests) or in different scripts. Two official patterns:

1. Several `jsonPaths` + `coalesce`: the first path that has a value wins (same script).
```json
{ "name": "title", "selector": "script#__window__ytInitialPlayerResponse", "extract": "jsonContent",
  "jsonPaths": ["videoDetails.title", "microformat.playerMicroformatRenderer.title.simpleText"], "transforms": ["coalesce"] }
```
2. A selector array with `combineStrategy: "first"` across two JSON sources: when the first script exists but its
   paths give null, the next script is tried (see "Selector arrays and combineStrategy").
```json
{ "name": "viewCount", "selector": ["script#__window__ytInitialPlayerResponse", "script#__window__ytInitialData"],
  "combineStrategy": "first", "extract": "jsonContent", "jsonPaths": ["videoDetails.viewCount"], "transforms": ["toNumber"] }
```
Both can be combined (several paths + coalesce inside each source, then the selector fallback).

### Lists from embedded JSON (jsonContent + jsonPath)
For a list kept in a script's JSON (YouTube `ytInitialData`, `__NEXT_DATA__` product grids, `ld+json` `ItemList`,
`window.__INITIAL_STATE__` search results), give the field ONE `jsonPath` (singular) instead of `jsonPaths`. The
rules of JSON source fields (next section) then apply to the parsed script JSON, unchanged:

- `jsonPath`: dot notation, `[n]`, `["key"]`, a leading `$.`, and `[*]` (each element of an array).
- `subFields` (each with its own `jsonPath`, relative to the value / each list item), or `subExtractor.fields`
  (JSON fields). No `selector` / `extract` / other HTML keys inside them.
- `required` (field and sub-fields), `includePosition` (with `[*]` and sub-fields) and `transforms` work as in
  JSON fields.
- No `isArray` (the `[*]` makes the list), no `combineStrategy`, never together with `jsonPaths`.
- Several matched scripts (e.g. two `ld+json` blocks): the field uses the FIRST one whose JSON parses and whose
  `jsonPath` gives a non-empty value; a `[*]` list comes from that one script only. Unparsable JSON everywhere → `null`.

This keeps such pages on the plain-fetch price instead of the JavaScript tier (and is more stable than DOM
selectors with generated classes).

YouTube-like channel page (`var ytInitialData = {...}` → `script#__window__ytInitialData`):
```json
{
  "version": "v1.0",
  "sourceType": "html",
  "fields": [
    {
      "name": "videos",
      "selector": "script#__window__ytInitialData",
      "extract": "jsonContent",
      "jsonPath": "contents.twoColumnBrowseResultsRenderer.tabs[1].tabRenderer.content.richGridRenderer.contents[*].richItemRenderer.content.lockupViewModel",
      "includePosition": true,
      "subFields": [
        { "name": "videoId", "jsonPath": "contentId", "required": true },
        { "name": "title", "jsonPath": "metadata.lockupMetadataViewModel.title.content" }
      ]
    }
  ]
}
```
Grid entries without a `contentId` (e.g. a "continuation" item) are dropped, then `position` is numbered 1..n.

`ld+json` `ItemList` (the page may have other `ld+json` blocks before it, e.g. `Organization` or `WebSite`: a block
without `itemListElement` is skipped; a `BreadcrumbList` also has `itemListElement`, so if it comes first, select the
list block more precisely or check the order):
```json
{
  "version": "v1.0",
  "sourceType": "html",
  "fields": [
    {
      "name": "items",
      "selector": "script[type=\"application/ld+json\"]",
      "extract": "jsonContent",
      "jsonPath": "itemListElement[*]",
      "subFields": [
        { "name": "position", "jsonPath": "position", "transforms": ["toNumber"] },
        { "name": "name", "jsonPath": "name", "required": true },
        { "name": "url", "jsonPath": "url" }
      ]
    }
  ]
}
```
With `subExtractor.fields` instead of `subFields`, each item is read by JSON fields (nested lists with their own
`[*]`, sub-fields of their own): `"subExtractor": { "fields": [{ "name": "offers", "jsonPath": "offers[*].price" }] }`.

## JSON source (sourceType "json")

Use when the response itself is JSON (an API endpoint) or with captured XHR (below).

```json
{
  "version": "v1.0",
  "sourceType": "json",
  "fields": [
    { "name": "total", "jsonPath": "meta.total" },
    { "name": "names", "jsonPath": "data.items[*].name" },
    { "name": "items", "jsonPath": "data.items[*]", "subFields": [
      { "name": "id", "jsonPath": "id" },
      { "name": "price", "jsonPath": "pricing.amount", "transforms": ["toNumber"] }
    ] }
  ]
}
```

- `jsonPath`: dot notation, `[n]`, and `[*]` (map over every array element; the rest of the path applies to
  each). No `$` root, no quoted keys, no filters, no slices.
- Arrays come from `[*]` (there is no `isArray` in JSON fields).
- `subFields`: pick properties of the value at `jsonPath` (of each element if it is an array). Without
  `jsonPath`, `subFields` read from the document root and build one object.
- `subExtractor.fields`: nested JSON fields applied to the value at `jsonPath` (each element if an array). A
  string value is parsed as JSON first, which is how stringified JSON inside JSON is read. Field-level
  `transforms` run BEFORE `subExtractor`; put transforms on the sub-fields.
- A missing path gives `undefined`, which is omitted when the result is serialized (the key disappears).
- `required` (fields and sub-fields) and `includePosition` (a `[*]` list of objects) work as in HTML: see
  "Required fields and list positions".

## Captured XHR responses

With `useProxy`, `renderJavascript` and `captureXhr` the content is NOT the page: it is a JSON array of the
background requests the page made:

```json
[ { "url": "https://site.example/api/search?q=..", "method": "GET", "status_code": 200,
    "response_body": "{\"results\":[...]}", "request_headers": {}, "response_headers": {} } ]
```

Set `sourceType: "json"`, narrow the array with `xhrUrlFilter` (comma-separated URL substrings), and read
the body through a `subExtractor` (the string body is parsed as JSON automatically):

```json
{ "name": "search", "jsonPath": "[0].response_body", "subExtractor": { "fields": [
  { "name": "titles", "jsonPath": "results[*].title" }
] } }
```

Order of captured responses can vary; keep the filter specific enough that index `[0]` is the one you want.

## Transforms (complete list)

`transforms` is an array applied left to right; every transform runs exactly once. An entry is an exact name
(`"trim"`) or, for the transforms with options, an object with exactly one key, the transform name
(`{ "split": "·" }`, see "Transforms with options" below).
How they run on HTML fields:
- On a field with `selector` (and on each sub-field), the chain runs once on the value.
- On an `isArray` field with `selector`, value transforms (`trim`, `extractPrice`, `reverse`, `toJson` ...)
  run on each element; from the first array transform on (`first`, `last`, `nth`, `unique`, `compact`,
  `joinWithComma`, `joinWithSpace`, `coalesce`) the rest of the chain runs once on the whole array. Example:
  `["extractPrice", "compact", "first"]` → the first price as a number.
- On a field with `subFields`, the field's own `transforms` run once on the resulting object (or array of
  objects).
- On JSON fields every transform runs once (on the value at the path; a `[*]` path gives an array).

Text:
- `trim`: strip leading/trailing whitespace.
- `normalizeWhitespace`: trim + collapse runs of whitespace to one space.
- `removeExtraSpaces`: collapse whitespace runs (no trim).
- `stripWhitespace`: remove all whitespace.
- `toLowerCase`, `toUpperCase`, `capitalize` (first letter), `capitalizeWords` (each word).
- `slugify`: `"Hello World!"` → `"hello-world"`.
- `truncate` (100 chars + `...`), `truncate50`, `truncate200`.
- `removeHtmlTags`: strip tags from an HTML string.
- `decodeHtml`: decode every named and numeric HTML entity, as textContent does (text is already decoded by textContent; use it on `innerHTML` / JSON strings).
- `removeCommonJunk`: remove `[removed]`, `[deleted]`, `advertisement`.
- `reverse`: reverse a string.
- `toMarkdown`: HTML → Markdown (use with `extract: "innerHTML"`).

URLs:
- `toAbsoluteUrl`: resolve a relative URL against the target URL (works on arrays too). Use it on every link and image.
- `extractDomain`: `"https://a.example/x"` → `"a.example"`.
- `extractUrl`: first `http(s)://...` inside a string, up to the first whitespace
  (`"https://en.wikipedia.org › wiki › Tesla"` → `"https://en.wikipedia.org"`). A string WITHOUT a URL is
  returned unchanged, not `null`: it cannot be used to drop non-URL values.
- `decodeUri`, `encodeUri`: URI component decode / encode.

Numbers:
- `extractPrice`: smart price parser for any locale: `"$1,234.50"` → 1234.5, `"Rp 1.845.500"` → 1845500,
  `"EUR 1.234,56"` → 1234.56, negative `"-$5"` → -5. First choice for prices.
- `extractNumber`: first number, US style (`,` thousands): `"Price: $868,800"` → 868800.
- `extractNumberDotThousands`: explicit `1.234,56` style (Indonesia, most of Europe).
- `extractNumberCommaThousands`: explicit `1,234.56` style.
- `parseCompactNumber`: `"10rb+"` → 10000, `"2.5k"` → 2500, `"3 jt"` → 3000000, `"1.2M"` → 1200000.
- `toNumber`: parseFloat after removing commas (`"19.99"` → 19.99); null when not a number.
- `toInteger`: parseInt after removing commas.
- `extractDigits`: keep digits only, as a string (`"(555) 010-0100"` → `"5550100100"`).
- `extractPhone`: the first phone-like number in a text, as written (optional `+`, digits with space `.` `-` `( )`,
  7-15 digits): `"Open 24 hours · (303) 758-6237"` → `"(303) 758-6237"`; null when there is none. A string.
- `removeLeadingZeros`: `"0042"` → `"42"`.

Other types:
- `toBoolean`: `"true" | "1" | "yes" | "on"` → true, other strings → false.
- `parseJson`: parse a JSON string (null if invalid). `toJson`: value → JSON string.
- `extractLetters`, `extractAlphanumeric`: keep only letters / letters and digits.

Arrays:
- `splitByComma`, `splitByPipe`, `splitByNewline`: string → trimmed array.
- `joinWithComma` (`", "`), `joinWithSpace`: array → string.
- `first`, `last`: one element of an array; an empty array gives `null` (as `coalesce`), e.g. `["compact", "first"]` when no element has a value.
- `unique`: remove duplicates. `compact`: remove `null` / `""`.
- `coalesce`: first non-empty value of an array or object (e.g. after several `jsonPaths`).

Empty values:
- `nullIfEmpty`: `""` → null. `emptyIfNull`: null → `""`.

### Transforms with options

Written as an object with one key, the transform name, holding its options: the shorthand (main option only) or
the full form. Matching is plain text and case-sensitive. Regex transforms are not available (yet): use these.
Text input only: `null` stays `null`, numbers and other non-strings pass through unchanged (`nth` takes an array).

| Transform | Shorthand / full form | Result | No match |
|---|---|---|---|
| `split` | `{ "split": "·" }` / `{ "split": { "separator": "·", "limit": 3 } }` | trimmed parts, empty parts dropped, at most `limit` (max 10000) | `[value]` (`[]` when empty) |
| `after` | `{ "after": "pv-" }` / `{ "after": { "text": "/", "last": true } }` | text after the first (or last) occurrence | `null` |
| `before` | `{ "before": "?" }` / `{ "before": { "text": "/", "last": true } }` | text before the first (or last) occurrence | `null` |
| `between` | `{ "between": ["!3d", "!"] }` / `{ "between": { "start": "!3d", "end": "!" } }` | after the first `start`, up to the next `end` | no `start`: `null`; no `end`: rest of the text |
| `nth` | `{ "nth": 2 }` / `{ "nth": { "index": -1 } }` | array element, 1-based, negative from the end (`-1` = last) | out of range: `null` |
| `removeQueryParams` | `{ "removeQueryParams": ["utm_*", "fbclid"] }` / `{ "removeQueryParams": { "names": [...] } }` | the URL without those query parameters (`*` at the end = prefix), relative URLs stay relative, `#fragment` kept, `?` dropped when empty | not a URL: unchanged |

Limits: option texts 1-200 characters, `limit` 1-10000, 1-50 `names`, `index` a non-zero integer, at most 20 object
entries per field. A bad entry is an error (`unknown_transform`, or `invalid_transform_options` with what is wrong),
with its path, e.g. `extractorConfig.fields[2].transforms[1]`. `nth` is an array transform: on an `isArray` field,
`["trim", { "nth": 2 }]` trims each element, then picks the second.

Examples (Google Maps place link `.../data=!3d39.7259254!4d-105.018292!...!19sChIJXQdb...?authuser=0`, Google local
results with `·`-separated text lines):

```json
{ "name": "latitude", "selector": "a.hfpxzc", "extract": "attributeValue", "attributeName": "href",
  "transforms": [{ "between": ["!3d", "!"] }, "toNumber"] },
{ "name": "longitude", "selector": "a.hfpxzc", "extract": "attributeValue", "attributeName": "href",
  "transforms": [{ "between": ["!4d", "!"] }, "toNumber"] },
{ "name": "placeId", "selector": "a.hfpxzc", "extract": "attributeValue", "attributeName": "href",
  "transforms": [{ "between": ["!19s", "?"] }] },
{ "name": "category", "selector": "div.rllt__details > div:nth-child(2)",
  "transforms": ["normalizeWhitespace", { "split": "·" }, "last"] },
{ "name": "rating", "selector": "div.rllt__details > div:nth-child(2)",
  "transforms": [{ "split": "·" }, { "nth": 1 }, "extractNumber"] },
{ "name": "phone", "selector": "div.rllt__details > div:nth-child(4)", "transforms": ["extractPhone"] },
{ "name": "localId", "selector": "[id^=\"pv-\"]", "extract": "attributeValue", "attributeName": "id",
  "transforms": [{ "after": "pv-" }] },
{ "name": "website", "selector": "a[data-value=\"Website\"]", "extract": "attributeValue", "attributeName": "href",
  "transforms": [{ "removeQueryParams": ["utm_*"] }] }
```

## Output types and versions

When an extractor is released, ExtractHub derives an output schema from the config: number transforms
(`toNumber`, `toInteger`, `extractNumber`, `extractPrice`, `extractNumberDotThousands`,
`extractNumberCommaThousands`, `parseCompactNumber`, `count`) make a number, `toBoolean` / `exists` a boolean,
`split*` / `split` an array (`first` / `last` / `nth` after it: one element), `isArray` / `[*]` an array, `subExtractor` / `subFields` an object. Values whose type the config
does not fix (`jsonContent`, window state, JSON sources) get their kind from the release sample (string, number,
boolean, nested objects / arrays); a value that is null on the sample stays `unknown`, and a later release whose
sample has no value keeps the previous version's kind while the field config is unchanged. Renaming or removing a
field, or changing its type or array-ness, is a breaking change (new major version). So pick names and types
deliberately the first time: see releasing-and-versions.md.

`required` is part of the schema and changing it either way is a breaking change (major): making a field required
turns pages where it was empty into failed (charged) requests or dropped items, making it optional lets empty
values back in. Decide it before the first release. Adding
`includePosition` adds a `position` number (minor); removing it is breaking. The release sample must have a value
for every required field, else releasing is refused.
