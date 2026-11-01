# ExtractHub extractor builder (Agent Skill)

An [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) that teaches an
AI agent to build [ExtractHub](https://extracthub.io) extractors: it inspects the page you name, picks the
cheapest fetch mode that works (plain HTML, embedded JSON, JSON API, JavaScript rendering, XHR capture,
browser actions), writes the extractor definition, validates it, uploads it as a private draft, tests it and
publishes it when you say so.

Ask your agent things like:
- "Create an ExtractHub extractor for this shop's search result pages: title, price, rating, link."
- "Scrape this job board with ExtractHub: https://... (title, company, location, salary)."
- "My ExtractHub extractor returns empty prices on this page, fix it."

## What is inside

```
extracthub-extractor-builder/
├── SKILL.md                         workflow the agent follows
├── references/
│   ├── config-reference.md          field shapes, extract types, JSON paths, all transforms
│   ├── request-options.md           proxy, JS rendering, browser actions, XHR, POST, price tiers, Studio import
│   ├── selectors-and-pitfalls.md    supported selectors, stable selector strategy, engine pitfalls
│   ├── troubleshooting.md           empty fields, blocked pages, JS-only content, API errors
│   └── publishing-and-versions.md   draft, pins (@1, @1.2.3, @draft), semver, visibility
├── examples/                        6 complete definitions + notes
├── schema/extractor-definition.schema.json
├── scripts/check-config.mjs         zero-dependency structure checker (Node 18+)
└── LICENSE                          MIT
```

## Install

### Claude Code
Clone the repository into your personal skills directory (all projects) or a project's `.claude/skills/`:

```bash
git clone https://github.com/extracthub-io/extracthub-extractor-builder.git ~/.claude/skills/extracthub-extractor-builder
```

Claude Code picks it up automatically; ask for an ExtractHub extractor and it loads the skill. Update later
with `git -C ~/.claude/skills/extracthub-extractor-builder pull`.

### Claude Desktop and claude.ai
Download the repository as a ZIP (Code → Download ZIP) or zip a clone so that the zip contains one folder
with `SKILL.md` inside:

```bash
git clone https://github.com/extracthub-io/extracthub-extractor-builder.git
zip -r extracthub-extractor-builder.zip extracthub-extractor-builder -x "*.git*"
```

Upload it under Settings → Capabilities → Skills (code execution must be enabled). The local checker needs
Node.js; where Node is unavailable the agent validates with the MCP server or by reading the HTML.

### Other agents
Agents that support the Agent Skills format load the folder from their skills directory. For any other
agent, point it at `SKILL.md` as instructions and keep the folder next to it so it can open the references.

## Connect the ExtractHub MCP server (recommended)

With the MCP server the agent can validate against the real engine, upload, test and publish by itself.
Without it, the agent gives you the definition and a Studio import file instead.

1. Create an API key in the ExtractHub dashboard (API keys page). The "Use with MCP" card shows ready-made
   snippets.
2. Add the server (Streamable HTTP, `https://api.extracthub.io/mcp`, key as a Bearer token):

Claude Code:
```bash
claude mcp add --transport http extracthub https://api.extracthub.io/mcp --header "Authorization: Bearer YOUR_EXTRACTHUB_API_KEY"
```

Claude Desktop (`claude_desktop_config.json`, through the `mcp-remote` bridge):
```json
{
  "mcpServers": {
    "extracthub": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.extracthub.io/mcp", "--header", "Authorization:${EXTRACTHUB_AUTH}"],
      "env": { "EXTRACTHUB_AUTH": "Bearer YOUR_EXTRACTHUB_API_KEY" }
    }
  }
}
```

Other clients: URL `https://api.extracthub.io/mcp`, transport Streamable HTTP, header
`Authorization: Bearer YOUR_EXTRACTHUB_API_KEY` (or `X-API-Key: YOUR_EXTRACTHUB_API_KEY`). The server does
not offer OAuth yet, so clients that only support OAuth connectors cannot connect; use the skill without MCP
there.

More: https://extracthub.io/mcp

### Test key vs live key
- Test keys (`exth_test_...`) are free and never fetch pages: extract calls return simulated results. Good
  for wiring up a pipeline; useless for checking whether selectors work.
- Live keys fetch the real page and are billed per successful URL (standard tier, or the JS tier when the
  extractor renders JavaScript, captures XHR or runs browser actions). The agent tells you before it runs a
  live test. Validation (dry runs on HTML the agent already fetched) costs nothing.
- Creating, updating and publishing extractors need a live key (no credit is used for these themselves);
  a test key can only validate.

### Custom headers: only on direct requests
Custom headers (the `Cookie` header included) are not sent when the request goes through the scraping proxy
(`useProxy: true`); they are only sent on direct requests (`useProxy: false`). Scraping providers manage headers
for ban avoidance. So a JSON API that needs auth headers must use `useProxy: false`. On direct requests the
headers are sent as they are: the agent only adds what the target needs and does not override User-Agent or
Accept* (that may get the request blocked). Details: references/request-options.md.

## Without MCP: Studio import

The agent writes `my-extractor.json` and converts it for the Studio:

```bash
node scripts/check-config.mjs my-extractor.json --studio-out my-extractor.studio.json
```

In ExtractHub open Extractor Studio → ⋮ menu → Import, pick the `.studio.json` file, check the preview, then
Save (and Publish). Browser actions are not part of the import file; add them in the "Browser actions" panel
(use a `wait_for_element` action there instead of `waitForSelector`, which the Studio does not edit).

## The local checker

```bash
node scripts/check-config.mjs examples/*.json
node scripts/check-config.mjs --json my-extractor.json
```

Checks the definition against `schema/extractor-definition.schema.json` plus rules the schema cannot express
(option combinations, selectors the engine cannot run, missing `attributeName`, duplicate names ...). It
checks structure only; the ExtractHub validator (MCP `validate_extractor_config`, or the Studio preview) is
the authority.

## License

MIT, see [LICENSE](LICENSE).
