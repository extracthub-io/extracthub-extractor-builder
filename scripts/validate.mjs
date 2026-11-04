#!/usr/bin/env node
// Dry-run an ExtractHub extractor definition on a saved sample page with the real engine, by calling the
// ExtractHub MCP server. The sample is read from a file, so the agent never pastes HTML into a tool call.
// Zero dependencies, Node 18+.
//
//   node scripts/validate.mjs my-extractor.json --html page.html [--url https://site/page] [--out result.json]
//   node scripts/validate.mjs my-extractor.json --sample-json response.json
//   node scripts/validate.mjs my-extractor.json --html page.html --json            (full result on stdout)
//   node scripts/validate.mjs my-extractor.json --html page.html --strict          (sample warnings fail too)
//   node scripts/validate.mjs --release @user/slug --html page.html               (release check, dry run)
//   node scripts/validate.mjs --release @user/slug --html page.html --no-dry-run [--bump minor] [--changelog "..."]
//
// The API key comes from the EXTRACTHUB_API_KEY environment variable (never a command-line argument, so it
// does not end up in shell history or logs). EXTRACTHUB_MCP_URL overrides the endpoint.
//
// Validation is free and works with test keys (exth_test_...). --release needs a live key and, without
// --no-dry-run, releases nothing. Releasing for real is the user's decision: only pass --no-dry-run after
// they agreed.
//
// Exit code: 0 = valid and the dry run extracted data, 1 = errors (or release blocked; with --strict also any
// warning, e.g. a field that matched nothing on the sample),
// 2 = usage, unreadable file, network or auth problem.

import { readFileSync, writeFileSync } from 'node:fs';

const ENDPOINT = process.env.EXTRACTHUB_MCP_URL || 'https://api.extracthub.io/mcp';
const MAX_SAMPLE_BYTES = 2_000_000;

// Keys validate_extractor_config accepts from a definition (slug and visibility are create-only).
const DEFINITION_KEYS = [
	'name', 'description', 'url', 'method', 'body', 'headers', 'useProxy', 'renderJavascript', 'captureXhr',
	'xhrUrlFilter', 'browserActions', 'proxyCountry', 'allowJsEscalation', 'waitForSelector', 'waitTime',
	'extractorConfig', 'category', 'tags',
];

function usage(message) {
	if (message) console.error(message);
	console.error(
		'Usage: node validate.mjs <definition.json> (--html <file> | --sample-json <file>) [--url <sample url>] [--strict] [--json] [--out <file>]\n' +
		'       node validate.mjs --release <@user/slug> (--html <file> | --sample-json <file>) [--no-dry-run] [--bump patch|minor|major] [--changelog <text>]',
	);
	process.exit(2);
}

function fail(message) {
	console.error(message);
	process.exit(2);
}

// ---------- arguments ----------
const argv = process.argv.slice(2);
const opts = { dryRun: true };
const positional = [];
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	const next = () => argv[++i] ?? usage(`${a} needs a value`);
	if (a === '--html') opts.html = next();
	else if (a === '--sample-json') opts.sampleJson = next();
	else if (a === '--url') opts.url = next();
	else if (a === '--out') opts.out = next();
	else if (a === '--json') opts.json = true;
	else if (a === '--strict') opts.strict = true;
	else if (a === '--release') opts.release = next();
	else if (a === '--no-dry-run') opts.dryRun = false;
	else if (a === '--bump') opts.bump = next();
	else if (a === '--changelog') opts.changelog = next();
	else if (a === '-h' || a === '--help') usage();
	else if (a.startsWith('--')) usage(`Unknown option ${a}`);
	else positional.push(a);
}
if (!opts.html === !opts.sampleJson) usage('Give exactly one sample: --html <file> or --sample-json <file>.');
if (opts.release ? positional.length > 0 : positional.length !== 1) {
	usage(opts.release ? '--release takes no definition file (it checks the saved draft).' : 'Give one definition file.');
}
if (opts.bump && !['patch', 'minor', 'major'].includes(opts.bump)) usage('--bump must be patch, minor or major.');
if (!opts.release && (opts.bump || opts.changelog || !opts.dryRun)) usage('--bump, --changelog and --no-dry-run only apply with --release.');

const apiKey = process.env.EXTRACTHUB_API_KEY;
if (!apiKey) {
	fail('EXTRACTHUB_API_KEY is not set. Set it in the environment (Claude Code: "env" in .claude/settings.local.json).');
}

function readText(file, what) {
	try {
		return readFileSync(file, 'utf8');
	} catch (error) {
		return fail(`Cannot read ${what} ${file}: ${error.message}`);
	}
}

// ---------- build the tool call ----------
const sampleFile = opts.html ?? opts.sampleJson;
const sample = readText(sampleFile, 'sample');
if (Buffer.byteLength(sample, 'utf8') > MAX_SAMPLE_BYTES) {
	fail(`${sampleFile} is larger than 2 MB, the validator limit. Save only the page (no assets) or cut unrelated parts.`);
}
if (opts.sampleJson) {
	try {
		JSON.parse(sample);
	} catch (error) {
		fail(`${sampleFile} is not valid JSON: ${error.message}`);
	}
}
if (opts.html && /^\s*[[{]/.test(sample)) {
	console.error(`note: ${sampleFile} looks like JSON; use --sample-json for sourceType "json" extractors.`);
}

let tool;
const args = {};
if (opts.release) {
	tool = 'release_extractor';
	args.extractor_id = opts.release;
	args.dry_run = opts.dryRun;
	if (opts.bump) args.bump = opts.bump;
	if (opts.changelog) args.changelog = opts.changelog;
} else {
	tool = 'validate_extractor_config';
	let def;
	try {
		def = JSON.parse(readText(positional[0], 'definition'));
	} catch (error) {
		fail(`${positional[0]} is not valid JSON: ${error.message}`);
	}
	if (!def || typeof def !== 'object' || Array.isArray(def)) fail(`${positional[0]} must contain a JSON object.`);
	for (const key of DEFINITION_KEYS) if (def[key] !== undefined) args[key] = def[key];
	if (!args.extractorConfig) fail(`${positional[0]} has no extractorConfig.`);
}
if (opts.html) args.sample_html = sample;
else args.sample_json = sample;
if (opts.url) args.sample_url = opts.url;

// ---------- MCP over Streamable HTTP ----------
let sessionId = null;
let nextId = 1;

async function post(message) {
	let response;
	try {
		response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
			},
			body: JSON.stringify(message),
		});
	} catch (error) {
		return fail(`Cannot reach ${ENDPOINT}: ${error.message}`);
	}
	sessionId = response.headers.get('mcp-session-id') ?? sessionId;
	const text = await response.text();
	if (response.status === 401 || response.status === 403) {
		fail(`ExtractHub rejected the API key (HTTP ${response.status}). Check EXTRACTHUB_API_KEY.`);
	}
	if (!response.ok && response.status !== 202) fail(`ExtractHub MCP answered HTTP ${response.status}: ${text.slice(0, 500)}`);
	if (message.id === undefined) return null; // notification
	return parseRpc(text, message.id);
}

function parseRpc(text, id) {
	const candidates = [];
	if (/^\s*[{[]/.test(text)) candidates.push(text);
	else {
		// text/event-stream: one JSON-RPC message per "data:" block
		for (const block of text.split(/\r?\n\r?\n/)) {
			const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
			if (data) candidates.push(data);
		}
	}
	for (const c of candidates) {
		let msg;
		try {
			msg = JSON.parse(c);
		} catch {
			continue;
		}
		for (const m of Array.isArray(msg) ? msg : [msg]) if (m.id === id) return m;
	}
	return fail(`Unexpected MCP response: ${text.slice(0, 500)}`);
}

async function rpc(method, params) {
	const msg = await post({ jsonrpc: '2.0', id: nextId++, method, params });
	if (msg.error) fail(`MCP ${method} failed: ${msg.error.message ?? JSON.stringify(msg.error)}`);
	return msg.result;
}

await rpc('initialize', {
	protocolVersion: '2025-06-18',
	capabilities: {},
	clientInfo: { name: 'extracthub-extractor-builder/validate.mjs', version: '1.0.0' },
});
await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
const callResult = await rpc('tools/call', { name: tool, arguments: args });

const text = (callResult?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
let result;
try {
	result = JSON.parse(text);
} catch {
	result = { message: text };
}

if (opts.out) writeFileSync(opts.out, `${JSON.stringify(result, null, 2)}\n`);
if (opts.json) {
	console.log(JSON.stringify(result, null, 2));
	process.exit(exitCode());
}

// ---------- human summary ----------
function exitCode() {
	if (callResult?.isError) return 1;
	if (tool === 'release_extractor') return result.check?.ok === false || result.error ? 1 : 0;
	if (result.valid === false || (result.errors?.length ?? 0) > 0 || result.dry_run?.ok === false) return 1;
	return opts.strict && (result.warnings?.length ?? 0) > 0 ? 1 : 0;
}

function preview(value) {
	const s = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'undefined';
	return s.length > 100 ? `${s.slice(0, 97)}...` : s;
}

// One line per output field: arrays show their length and, for lists of objects, which keys are
// null / empty in how many items (the usual sign of a wrong sub-selector).
function describe(data, indent = '  ') {
	const lines = [];
	for (const [key, value] of Object.entries(data ?? {})) {
		if (Array.isArray(value)) {
			const objects = value.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
			let line = `${indent}${key}: array of ${value.length}`;
			if (objects.length > 0) {
				const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
				const empty = keys
					.map((k) => [k, objects.filter((o) => o[k] == null || o[k] === '' || (Array.isArray(o[k]) && o[k].length === 0)).length])
					.filter(([, n]) => n > 0)
					.map(([k, n]) => `${k} ${n}/${objects.length}`);
				line += empty.length ? ` (empty: ${empty.join(', ')})` : ' (no empty fields)';
				lines.push(line, `${indent}  first: ${preview(objects[0])}`);
			} else {
				const nulls = value.filter((v) => v == null || v === '').length;
				lines.push(`${line}${nulls ? ` (${nulls} empty)` : ''}${value.length ? `: ${preview(value.slice(0, 5))}` : ''}`);
			}
		} else if (value && typeof value === 'object') {
			lines.push(`${indent}${key}: object`, ...describe(value, `${indent}  `));
		} else {
			lines.push(`${indent}${key}: ${value == null ? 'null  <- empty' : preview(value)}`);
		}
	}
	return lines;
}

const print = (s = '') => console.log(s);
if (callResult?.isError) print(`ERROR ${tool}: ${result.error?.code ?? ''} ${result.error?.message ?? result.message ?? text}`.trim());

if (tool === 'validate_extractor_config') {
	print(`${exitCode() === 0 ? 'OK' : 'FAIL'} ${positional[0]} on ${sampleFile}: ${result.errors?.length ?? 0} error(s), ${result.warnings?.length ?? 0} warning(s)`);
	for (const e of result.errors ?? []) print(`  error   ${e.path ?? ''}: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
	for (const w of result.warnings ?? []) print(`  warning ${w.path ?? ''}: ${w.message}${w.code ? ` [${w.code}]` : ''}`);
	if (result.dry_run) {
		print(`Dry run ${result.dry_run.ok ? 'ok' : 'FAILED'}:`);
		if (result.dry_run.error) print(`  ${preview(result.dry_run.error)}`);
		for (const line of describe(result.dry_run.data)) print(line);
	}
} else {
	const check = result.check ?? {};
	print(`${exitCode() === 0 ? 'OK' : 'BLOCKED'} release ${opts.dryRun ? 'dry run' : ''} ${args.extractor_id}`.replace(/\s+/g, ' '));
	for (const b of check.blocking ?? []) print(`  blocking ${typeof b === 'string' ? b : `${b.path ?? ''}: ${b.message ?? JSON.stringify(b)}`}`);
	for (const w of check.warnings ?? []) print(`  warning  ${typeof w === 'string' ? w : `${w.path ?? ''}: ${w.message ?? JSON.stringify(w)}`}`);
	if (result.version) print(`  released ${result.version}${result.pins ? `, pins ${JSON.stringify(result.pins)}` : ''}`);
	if (result.next_versions) print(`  next versions ${JSON.stringify(result.next_versions)} (minimum bump: ${result.minimum_bump})`);
	if (result.schema_diff) print(`  schema diff ${preview(result.schema_diff)}`);
	if (result.nothing_to_release) print('  nothing to release: the draft equals the latest version');
	if (result.sample?.data) {
		print('Sample extraction:');
		for (const line of describe(result.sample.data)) print(line);
	}
}
// Fields that matched nothing on the sample: say plainly what to do (next_steps names them too).
const emptyFields = (result.warnings ?? []).filter((w) => w.code === 'sample_empty');
if (emptyFields.length > 0) {
	print(`note: ${emptyFields.length} field(s) matched nothing on this sample. Fix them, unless the value is really absent on this`);
	print('      page (e.g. nextPageUrl on the last page, originalPrice when nothing is on sale); then check another page.');
}
const steps = [].concat(result.next_steps ?? []);
for (const s of steps) print(`next: ${s}`);
if (opts.out) print(`Full result written to ${opts.out}`);
process.exit(exitCode());
