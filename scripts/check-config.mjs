#!/usr/bin/env node
// Structure check for ExtractHub extractor definitions. Zero dependencies, Node 18+.
//
//   node scripts/check-config.mjs my-extractor.json [more.json ...]
//   node scripts/check-config.mjs my-extractor.json --studio-out my-extractor.studio.json
//   node scripts/check-config.mjs --json my-extractor.json        (machine-readable result)
//
// Exit code: 0 = no errors (warnings allowed), 1 = errors found, 2 = usage / unreadable file.
// This only checks STRUCTURE (field names, types, option combinations, selector syntax the engine
// cannot run). It does not fetch the page or run selectors: the ExtractHub validator
// (MCP tool validate_extractor_config) is the authority.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDefinition, toStudioImport } from './lib/definition-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'schema', 'extractor-definition.schema.json');

function usage(message) {
	if (message) console.error(message);
	console.error('Usage: node check-config.mjs [--json] <definition.json> [...] [--studio-out <file>]');
	process.exit(2);
}

const args = process.argv.slice(2);
let asJson = false;
let studioOut = null;
const files = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--json') asJson = true;
	else if (args[i] === '--studio-out') studioOut = args[++i] ?? usage('--studio-out needs a file name');
	else if (args[i] === '-h' || args[i] === '--help') usage();
	else files.push(args[i]);
}
if (files.length === 0) usage('No definition file given.');
if (studioOut && files.length !== 1) usage('--studio-out works with exactly one definition file.');

let schema;
try {
	schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
} catch (error) {
	console.error(`Cannot read the bundled schema at ${schemaPath}: ${error.message}`);
	process.exit(2);
}

let failed = false;
const results = [];
for (const file of files) {
	let def;
	try {
		def = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		console.error(`${file}: cannot read or parse JSON: ${error.message}`);
		process.exit(2);
	}
	const result = checkDefinition(def, schema);
	results.push({ file, ...result });
	if (result.errors.length > 0) failed = true;

	if (!asJson) {
		const status = result.errors.length ? 'FAIL' : 'OK';
		console.log(`${status} ${file}: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
		for (const e of result.errors) console.log(`  error   ${e.path}: ${e.message}`);
		for (const w of result.warnings) console.log(`  warning ${w.path}: ${w.message}`);
		for (const n of result.notes) console.log(`  note    ${n.path}: ${n.message}`);
	}

	if (studioOut && result.errors.length === 0) {
		writeFileSync(studioOut, `${JSON.stringify(toStudioImport(def), null, 2)}\n`);
		if (!asJson) {
			console.log(`Wrote ${studioOut} (Extractor Studio > menu > Import).`);
			if (Array.isArray(def.browserActions) && def.browserActions.length > 0) {
				console.log('  note    browser actions are not part of the Studio import file: add them in the Studio "Browser actions" panel.');
			}
		}
	}
}

if (asJson) console.log(JSON.stringify(results, null, 2));
if (!asJson && !failed) console.log('Structure OK. Validate against a real page with the ExtractHub validator before uploading.');
process.exit(failed ? 1 : 0);
