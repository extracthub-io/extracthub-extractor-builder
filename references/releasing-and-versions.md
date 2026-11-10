# Uploading, testing and releasing

## Contents
- Lifecycle: draft → versions
- Extractor ids and pins
- Testing the draft
- Releasing
- Semver: what counts as breaking
- Visibility
- Deprecate and yank (owner, in Studio)
- Health checks

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
   country, an error or challenge page, A/B variant): see troubleshooting.md.

## Releasing
- Release only when the user agrees and the live test of the draft is right.
- MCP: `release_extractor` with `extractor_id`, a sample page (`sample_html` / `sample_json`, `sample_raw_html_url`, or
  `fetch_sample: true` = one billed extract of the example URL) and `dry_run: true` first: it returns the
  release check, the planned next versions and the schema diff without releasing. Then call it without
  `dry_run` (optional `bump`, `changelog`, `base_major`). Live API key only.
- ExtractHub runs a release check on the sample page: selectors that do not parse, or an extraction that
  returns nothing at all, block releasing; other findings are warnings.
- The version number is computed from the output-schema change since the previous version; the maintainer may
  choose a HIGHER bump (e.g. 2.0.0 to signal a behavior change), never a lower one. The first release is `1.0.0`.
- After releasing, give the user the pins to use: `@user/slug@1` for most consumers, exact `@1.0.0` for
  reproducibility.
- Sample from a run you already paid for: `sample_from_job_id` (an async job) or `sample_from_batch_item`
  (`{ batch_id, index }`) instead of a sample page. If that run stored the page (a job from `extract` with
  `return_raw_html` / `raw_html`), the full release check runs on it; otherwise only the stored extraction is
  checked and it must come from the current draft config (`sample_stale` otherwise; batches never store pages).
- Pages over 2,000,000 characters (`sample_html is over 2,000,000 characters`): `extract` the page with
  `raw_html: "link"` and pass its `raw_html_url` as `sample_raw_html_url` (release and `validate_extractor_config`).
  The link must be yours and fresh (1 h; `invalid_signature`, `link_expired`, `not_your_link`, `raw_html_expired`
  otherwise). The page is read on the server (no size limit), runs the full check and becomes the preview page.
  One sample source per call.
- `set_sample_output` (live key, owner) replaces the sample output of a released version (default: the latest)
  with the result of a job / batch item that ran exactly that version. It must fit the version's output schema
  (`schema_mismatch` lists the paths) and contain data; nothing else of the version changes.
- The extractor page (catalog) shows the latest version's sample: "Extracted Data" is its sample output (the release
  check's, or the one `set_sample_output` stored), the source panel is the sample page the release check ran on
  (`sample_html` / `sample_json` / `sample_raw_html_url` / `fetch_sample` / a job that stored the page). Use a
  representative page of the example url. Releases from a stored extraction only get the source panel after their
  first passing health check (or `set_preview_page`).
- Release `warnings` (never errors): `no_preview_page` (the sample has no page: batch item, or a job without the
  page) and `preview_url_differs` (the sample page is not the draft's example url). Both name `set_preview_page`.
- `set_preview_page` (live key, owner) replaces the preview page of one exact released version
  (`extractor_id: "@user/slug@1.0.0"`, not yanked) without a new version, like re-fetching it in the Studio:
  - `source`: `"fetch"` (one billed extract of `url`, default the version's example url, with this exact
    version), `"sample_html"` (+ `sample_html`, optional `url` = where the page came from), `"job_id"` (+ `job_id`,
    your succeeded job of this extractor that stored the page: `page_not_stored` otherwise) or `"raw_html_url"`
    (+ `raw_html_url` from your own `extract` with `raw_html: "link"`).
  - `also_set_sample_output` (default true): the version's extraction of the same page becomes its sample output
    (`fetch`: the extract's own output), so the preview and the sample always match. A result that does not fit
    the output schema (`schema_mismatch`) or is empty (`empty_result`) changes nothing.
  - `dry_run: true`: url, page size, `over_preview_cap` (the stored preview is cut at 1 MB), the price (`fetch`,
    nothing fetched) or the extracted fields, and `shown_on_public_page` (only the latest version of the newest
    major is shown on the extractor page). The answer also says `url_matches_example`.
- `get_extractor` lists per version `preview: { available, source_url, fetched_at, size }` (nulls for previews stored
  before 2026-11-06). `update_extractor` that changes `url` adds `preview_note`: the released preview still shows the
  old page until `set_preview_page`.

## Deleting drafts
- `delete_extractor` deletes one of your private extractors that was never released (yanked versions count as
  released): failed attempts and probe drafts. Without `confirm: true` it is a dry run. Refused: `has_releases`
  (deprecate / yank instead; only the owner can delete a released extractor, in the Studio), `not_private`,
  `in_use_by_pipeline` (lists the pipelines), `in_use_by_batch` (a batch / job still running with it).

## Semver: what counts as breaking
- patch: output schema identical (selector fixes, request option changes, transforms that keep the type).
- minor: additive only: a new field, a field whose type was unknown becomes known. (`jsonContent` / window state / JSON
  source kinds are inferred from the release sample, so a field that was null on the previous sample and has a
  value now is a minor change.)
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

## Health checks
Released versions are probed on a schedule (public: by the platform; private: opt-in, owner-paid). The default test
probes the version's sample page. A probe that served the right page is judged by the output schema:
- **broken_selector** (the version becomes `broken` after 2 such probes in a row): a field with `required: true`
  is empty in every item, a list marked `required` is empty `[]`, or nothing at all was
  extracted (every field and list empty). An optional list (e.g. `reviews`) may be empty.
- **degraded**: a required field is filled in fewer items than the test's fill rate (80% by default), a required
  list has fewer items than `minItems`, a type drifted on a required field, or an owner custom check failed.
- A required sub-field is judged only in the items that exist. Items missing it are dropped by the engine, so a
  broken sub-field selector shows up as an empty list: mark the main list of a list page `required` to catch it.
- **Optional fields never fail a probe**: null / empty is a normal value (their fill rate is recorded for the
  owner only). Block pages, tiny pages and a test URL that leads to another page are not counted as broken.

So mark as `required` the 1-3 fields that prove the page was parsed, and leave optional every field a valid page
may lack (ratings, discounts, zestimate, sale price, secondary images). To watch an optional field without failing
requests, add a custom check (`not_empty`) to the health test in Studio.
