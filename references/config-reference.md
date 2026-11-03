# extractorConfig reference

The `extractorConfig` object turns the fetched content into JSON. Everything here is what the
ExtractHub engine runs; nothing else is accepted.

## Contents
- Top level
- HTML fields: the five shapes
- Extract types
- Selector arrays and combineStrategy (fallbacks)
- Text options
- Embedded JSON inside HTML (jsonContent, jsonPaths, window state)
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

## Extract types

| extract | Returns | Extra keys |
|---|---|---|
| `textContent` (default) | Text of the element and its descendants, whitespace collapsed, HTML entities decoded. `<script>`/`<style>` text is skipped. | `textSeparator`, `excludeTags` |
| `attributeValue` | One attribute's value | `attributeName` (required) |
| `attributeValues` | `"name:value;name:value"` string of the listed attributes | `attributeNames` (required), `keyValueSeparator` (`:`), `attributeSeparator` (`;`) |
| `innerHTML` | Inner HTML string (for lists with `subExtractor`, or with `toMarkdown`) | `allowedAttributes` (keep only these attributes) |
| `exists` | `true` / `false`: did anything match | |
| `count` | Number of matched elements | |
| `jsonContent` | Parses the matched `<script>` text as JSON, then `jsonPaths` | `jsonPaths` |

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
| `first` | The first selector (in array order) that matches, its first match. A fallback chain. |
| `last` | The last match of the first selector that matches. |
| `concat` | All matches of the first selector that matches, joined with `concatSeparator` (default space). |
| `array` | All non-empty matches of the first selector that matches, as an array. |

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
  `["@graph"][0].name`. A leading `$.` is accepted. There is NO wildcard (`[*]`) or filter: a path ending at an
  array returns the whole array (each element as-is).
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

`transforms` is an array of exact names applied left to right; every transform runs exactly once.
How they run on HTML fields:
- On a field with `selector` (and on each sub-field), the chain runs once on the value.
- On an `isArray` field with `selector`, value transforms (`trim`, `extractPrice`, `reverse`, `toJson` ...)
  run on each element; from the first array transform on (`first`, `last`, `unique`, `compact`,
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
- `decodeHtml`: decode `&amp; &lt; &gt; &quot; &#39; &nbsp;` (text is already decoded by textContent).
- `removeCommonJunk`: remove `[removed]`, `[deleted]`, `advertisement`.
- `reverse`: reverse a string.
- `toMarkdown`: HTML → Markdown (use with `extract: "innerHTML"`).

URLs:
- `toAbsoluteUrl`: resolve a relative URL against the target URL (works on arrays too). Use it on every link and image.
- `extractDomain`: `"https://a.example/x"` → `"a.example"`.
- `extractUrl`: first `http(s)://...` inside a string.
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
- `removeLeadingZeros`: `"0042"` → `"42"`.

Other types:
- `toBoolean`: `"true" | "1" | "yes" | "on"` → true, other strings → false.
- `parseJson`: parse a JSON string (null if invalid). `toJson`: value → JSON string.
- `extractLetters`, `extractAlphanumeric`: keep only letters / letters and digits.

Arrays:
- `splitByComma`, `splitByPipe`, `splitByNewline`: string → trimmed array.
- `joinWithComma` (`", "`), `joinWithSpace`: array → string.
- `first`, `last`: one element of an array.
- `unique`: remove duplicates. `compact`: remove `null` / `""`.
- `coalesce`: first non-empty value of an array or object (e.g. after several `jsonPaths`).

Empty values:
- `nullIfEmpty`: `""` → null. `emptyIfNull`: null → `""`.

## Output types and versions

When an extractor is released, ExtractHub derives an output schema from the config: number transforms
(`toNumber`, `toInteger`, `extractNumber`, `extractPrice`, `extractNumberDotThousands`,
`extractNumberCommaThousands`, `parseCompactNumber`, `count`) make a number, `toBoolean` / `exists` a boolean,
`split*` an array, `isArray` / `[*]` an array, `subExtractor` / `subFields` an object. Renaming or removing a
field, or changing its type or array-ness, is a breaking change (new major version). So pick names and types
deliberately the first time: see releasing-and-versions.md.
