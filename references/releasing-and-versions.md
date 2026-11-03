# Uploading, testing and releasing

## Contents
- Lifecycle: draft → versions
- Extractor ids and pins
- Testing the draft
- Releasing
- Semver: what counts as breaking
- Visibility
- Deprecate and yank (owner, in Studio)

## Lifecycle: draft → versions
- `create_extractor` saves a new extractor as a DRAFT (private by default). Its id is `@username/slug`; the
  slug can only be chosen at creation. Create / update / release need a live API key (test keys can only
  validate).
- `update_extractor` changes the draft. The draft is mutable and only its owner can run it.
- `release_extractor` snapshots the draft (request options + extractorConfig + output schema) into an
  immutable version such as `1.0.0`. Callers use released versions; later edits to the draft do not affect
  them until the next release.

## Extractor ids and pins
The extract API always needs a pinned id:

| Pin | Resolves to | Use |
|---|---|---|
| `@user/slug@1` | Latest released `1.x.y` (skips yanked versions) | Recommended for consumers: gets fixes, never breaking changes |
| `@user/slug@1.2.3` | Exactly that version | Reproducible pipelines; fails with 410 if that version is yanked |
| `@user/slug@draft` | The current draft | Owner only: testing before releasing |

An unpinned `@user/slug` is rejected (400) with the available majors. Responses carry the resolved version in
the `X-Extractor-Version` header (and `Deprecation` / `Sunset` for a deprecated major).

## Testing the draft
1. Dry run first (free): MCP `validate_extractor_config` with the HTML / JSON you fetched. It runs the real
   engine and the field checks without fetching anything.
2. Live run: MCP `extract` with `extractor_id: "@user/slug@draft"` and the example URL (and 1-2 other URLs of
   the same page type). This fetches the page for real and is billed like any extract call (standard or JS
   tier, see request-options.md). Tell the user before running it.
3. A TEST API key (`exth_test_...`) never fetches: it returns simulated results. It is fine for checking the
   call shape, but use a LIVE key to test what the extractor really returns.
4. Compare the live output with the dry run. Differences mean the live fetch sees different HTML (JS,
   country, bot protection, A/B variant): see troubleshooting.md.

## Releasing
- Release only when the user agrees and the live test of the draft is right.
- MCP: `release_extractor` with `extractor_id`, a sample page (`sample_html` / `sample_json`, or
  `fetch_sample: true` = one billed extract of the example URL) and `dry_run: true` first: it returns the
  release check, the planned next versions and the schema diff without releasing. Then call it without
  `dry_run` (optional `bump`, `changelog`, `base_major`). Live API key only.
- ExtractHub runs a release check on the sample page: selectors that do not parse, or an extraction that
  returns nothing at all, block releasing; other findings are warnings.
- The version number is computed from the output-schema change since the previous version; the maintainer may
  choose a HIGHER bump (e.g. 2.0.0 to signal a behavior change), never a lower one. The first release is `1.0.0`.
- After releasing, give the user the pins to use: `@user/slug@1` for most consumers, exact `@1.0.0` for
  reproducibility.

## Semver: what counts as breaking
- patch: output schema identical (selector fixes, request option changes, transforms that keep the type).
- minor: additive only: a new field, a field whose type was unknown becomes known.
- major: a field removed or renamed, a type change (string ↔ number), scalar ↔ array, nested structure
  changed.

So: keep names and types stable once released. Fix selectors freely (patch); add fields (minor); rename
or retype only with a new major, and tell existing users.

## Visibility
- `private` (default): only the owner (and users it is shared with) can see and run it.
- `unlisted`: anyone with the id / link can view and run it; not listed in the catalog or search engines.
- `public`: listed in the ExtractHub catalog and search; anyone can run it. The extractor page shows its
  configuration (selectors, request options, headers, body), so never put secrets in a definition.
  Public needs a released version: `create_extractor` with `visibility: "public"`, or `update_extractor` to public
  before the first `release_extractor`, fails with `release_required`. Release first, then switch to public.
Ask the user before making anything public or unlisted.

## Deprecate and yank (owner, in Studio)
- Deprecate a MAJOR (with a sunset date at least 30 days out and an optional message): callers get
  `Deprecation` / `Sunset` headers and notifications; the major keeps working until the sunset.
- Yank an exact version (reason required, irreversible): `@N` skips it, an exact pin to it gets 410
  `version_yanked`. Use it for versions that return wrong data.
