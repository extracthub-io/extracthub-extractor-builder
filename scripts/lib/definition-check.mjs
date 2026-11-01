// Zero-dependency structure checks for an ExtractHub extractor definition.
// Pure functions only (no Node APIs), so the same code runs from the CLI and from other tools.
// Structure only: the ExtractHub validator (MCP validate_extractor_config) is the authority.

/** Minimal JSON Schema (2020-12 subset) validator for the bundled schema. Returns [{ path, message }]. */
export function validateSchema(schema, data, root = schema, path = '$') {
	const errors = [];
	const check = (s, value, p) => errors.push(...validateSchema(s, value, root, p));

	if (schema === true || schema === undefined) return errors;
	if (schema === false) return [{ path, message: 'is not allowed here' }];

	if (schema.$ref) {
		const target = resolveRef(root, schema.$ref);
		check(target, data, path);
	}

	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some((t) => matchesType(t, data))) {
			errors.push({ path, message: `must be ${types.join(' or ')} (got ${typeName(data)})` });
			return errors;
		}
	}
	if (schema.const !== undefined && !deepEqual(schema.const, data)) {
		errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
	}
	if (schema.enum && !schema.enum.some((v) => deepEqual(v, data))) {
		errors.push({ path, message: `must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(data)})` });
	}
	if (typeof data === 'string') {
		if (schema.minLength !== undefined && data.length < schema.minLength) errors.push({ path, message: `must have at least ${schema.minLength} characters` });
		if (schema.maxLength !== undefined && data.length > schema.maxLength) errors.push({ path, message: `must have at most ${schema.maxLength} characters` });
		if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push({ path, message: `does not match ${schema.pattern}` });
	}
	if (typeof data === 'number') {
		if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
	}
	if (Array.isArray(data)) {
		if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path, message: `must have at least ${schema.minItems} item(s)` });
		if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path, message: `must have at most ${schema.maxItems} item(s)` });
		if (schema.items) data.forEach((item, i) => check(schema.items, item, `${path}[${i}]`));
	}
	if (isObject(data)) {
		for (const key of schema.required ?? []) {
			if (!(key in data)) errors.push({ path, message: `is missing required property "${key}"` });
		}
		const props = schema.properties ?? {};
		for (const [key, value] of Object.entries(data)) {
			if (key in props) check(props[key], value, `${path}.${key}`);
			else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: `unknown property "${key}"${suggest(key, Object.keys(props))}` });
			else if (isObject(schema.additionalProperties)) check(schema.additionalProperties, value, `${path}.${key}`);
		}
	}
	if (schema.allOf) schema.allOf.forEach((s) => check(s, data, path));
	if (schema.anyOf) {
		const results = schema.anyOf.map((s) => validateSchema(s, data, root, path));
		if (!results.some((r) => r.length === 0)) {
			const requiredAlternatives = schema.anyOf.every((s) => s.required && Object.keys(s).length === 1);
			errors.push({
				path,
				message: requiredAlternatives
					? `needs one of: ${schema.anyOf.map((s) => s.required.join(' + ')).join(' | ')}`
					: `does not match any allowed shape (${results.map((r) => r[0]?.message).filter(Boolean).join('; ')})`,
			});
		}
	}
	if (schema.not && validateSchema(schema.not, data, root, path).length === 0) {
		const req = schema.not.required;
		errors.push({ path, message: req ? `must not have "${req.join('", "')}" here` : 'matches a forbidden shape' });
	}
	if (schema.if) {
		const ok = validateSchema(schema.if, data, root, path).length === 0;
		if (ok && schema.then) check(schema.then, data, path);
		if (!ok && schema.else) check(schema.else, data, path);
	}
	return errors;
}

function resolveRef(root, ref) {
	if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
	return ref
		.slice(2)
		.split('/')
		.reduce((node, key) => node[key], root);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function matchesType(type, v) {
	if (type === 'integer') return Number.isInteger(v);
	if (type === 'object') return isObject(v);
	return typeName(v) === type;
}
function deepEqual(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
function suggest(key, known) {
	const lower = key.toLowerCase();
	const hit = known.find((k) => k.toLowerCase() === lower) ?? known.find((k) => k.toLowerCase().startsWith(lower.slice(0, 5)));
	const aliases = { renderJs: 'renderJavascript', country: 'proxyCountry', type: 'extract', attribute: 'attributeName', attr: 'attributeName', jsonpath: 'jsonPath', path: 'jsonPath', fields: 'subExtractor.fields' };
	const alias = aliases[key] ?? aliases[lower];
	if (alias && (known.includes(alias) || alias.includes('.'))) return ` (did you mean "${alias}"?)`;
	return hit ? ` (did you mean "${hit}"?)` : '';
}

// ---------------------------------------------------------------------------
// Semantic checks the JSON Schema cannot express
// ---------------------------------------------------------------------------

/** Selector syntax the extraction engine (a streaming HTML parser, not a browser) does not support */
const UNSUPPORTED_SELECTOR = [
	{ re: /[+~]/, what: 'sibling combinators "+" / "~"' },
	{ re: /:has\(/, what: ':has()' },
	{ re: /:is\(|:where\(/, what: ':is() / :where()' },
	{ re: /:last-child|:last-of-type|:nth-last-|:only-child|:only-of-type/, what: ':last-child / :last-of-type / :nth-last-*() / :only-*' },
	{ re: /:contains\(/, what: ':contains()' },
	{ re: /::/, what: 'pseudo-elements (::before, ::text ...)' },
	{ re: /:(?:hover|focus|checked|visited|empty|root|enabled|disabled)\b/, what: 'state pseudo-classes' },
];

/** Selector text with [attr="..."] blocks and quoted strings removed, so "~=" or "+" inside them do not count */
function selectorSkeleton(selector) {
	return selector.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\[[^\]]*\]/g, '[]');
}

export function unsupportedSelectorReason(selector) {
	const skeleton = selectorSkeleton(selector);
	if (/^\s*\/\//.test(selector) || /^\s*\(?\/\//.test(selector)) return 'XPath is not supported in extractor fields (CSS only)';
	for (const rule of UNSUPPORTED_SELECTOR) if (rule.re.test(skeleton)) return `${rule.what} not supported by the extraction engine`;
	return null;
}

const CAMEL = /^[a-z][A-Za-z0-9]*$/;

/**
 * Full check: JSON Schema + semantic rules.
 * Returns { errors, warnings, notes }, each [{ path, message }]. Notes are informational (price tier).
 */
export function checkDefinition(def, schema) {
	const errors = validateSchema(schema, def);
	const warnings = [];
	const notes = [];
	if (!isObject(def)) return { errors, warnings, notes };
	const err = (path, message) => errors.push({ path, message });
	const warn = (path, message) => warnings.push({ path, message });

	// ---- Request options ----
	const jsFeatures = [];
	if (def.renderJavascript === true) jsFeatures.push('renderJavascript');
	if (def.captureXhr === true) jsFeatures.push('captureXhr');
	if (Array.isArray(def.browserActions) && def.browserActions.length > 0) jsFeatures.push('browserActions');

	if (def.useProxy !== true) {
		for (const key of ['renderJavascript', 'captureXhr', 'allowJsEscalation']) {
			if (def[key] === true) err(`$.${key}`, `requires "useProxy": true (direct requests cannot ${key === 'allowJsEscalation' ? 'escalate to JS' : 'render JavaScript'})`);
		}
		if (Array.isArray(def.browserActions) && def.browserActions.length > 0) err('$.browserActions', 'requires "useProxy": true and "renderJavascript": true');
		if (def.proxyCountry) err('$.proxyCountry', 'requires "useProxy": true');
		if (def.headers && Object.keys(def.headers).length > 0) {
			notes.push({ path: '$.headers', message: 'on direct requests ("useProxy": false) custom headers are sent as they are, Cookie included: only add headers the target needs; overriding User-Agent or Accept* may get the request blocked' });
		}
		if (def.xhrUrlFilter) err('$.xhrUrlFilter', 'requires "useProxy", "renderJavascript" and "captureXhr"');
	} else {
		if (def.headers && Object.keys(def.headers).length > 0) {
			warn('$.headers', 'headers_not_sent_with_proxy: custom headers are not sent when the request goes through the scraping proxy ("useProxy": true); they are only sent on direct requests ("useProxy": false). Scraping providers manage headers for ban avoidance');
		}
		if (def.captureXhr === true && def.renderJavascript !== true) err('$.captureXhr', 'requires "renderJavascript": true');
		if (Array.isArray(def.browserActions) && def.browserActions.length > 0 && def.renderJavascript !== true) {
			err('$.browserActions', 'browser actions only run with "renderJavascript": true');
		}
		if (def.xhrUrlFilter && def.captureXhr !== true) warn('$.xhrUrlFilter', 'has no effect without "captureXhr": true');
		if (def.allowJsEscalation === true && def.renderJavascript === true) warn('$.allowJsEscalation', 'has no effect when the page is already rendered with JavaScript');
	}
	if (def.method === 'GET' && def.body) warn('$.body', 'is ignored for GET requests; set "method": "POST"');
	if (def.method === 'POST' && !def.body) warn('$.body', 'POST without a body; is that intended?');
	if ((def.waitForSelector || def.waitTime) && def.renderJavascript !== true) {
		warn('$.waitForSelector', 'waitForSelector / waitTime only apply with "renderJavascript": true');
	} else if (typeof def.waitTime === 'number' && def.waitTime > 15000) {
		warn('$.waitTime', 'waitTime is capped at 15000 ms');
	}
	if (jsFeatures.length > 0) {
		notes.push({ path: '$', message: `uses the JavaScript-rendering price tier (${jsFeatures.join(', ')}); a plain fetch is cheaper if the data is in the HTML` });
	}

	const config = def.extractorConfig;
	if (!isObject(config) || !Array.isArray(config.fields)) return { errors, warnings, notes };
	const isJson = config.sourceType === 'json';
	if (def.captureXhr === true && !isJson) {
		err('$.extractorConfig.sourceType', 'with "captureXhr" the content is a JSON array of captured responses: set "sourceType": "json"');
	}

	if (isJson) checkJsonFields(config.fields, '$.extractorConfig.fields', err, warn);
	else checkHtmlFields(config.fields, '$.extractorConfig.fields', err, warn, false);

	return { errors, warnings, notes };
}

function checkNames(fields, path, err, warn) {
	const seen = new Map();
	fields.forEach((f, i) => {
		if (!isObject(f) || typeof f.name !== 'string') return;
		const outName = f.group?.into ? null : f.name;
		if (outName !== null) {
			if (seen.has(outName)) err(`${path}[${i}].name`, `duplicate field name "${outName}" (also at index ${seen.get(outName)})`);
			else seen.set(outName, i);
		}
		if (!CAMEL.test(f.name)) warn(`${path}[${i}].name`, `"${f.name}" is not camelCase (e.g. "productName")`);
	});
}

function checkHtmlFields(fields, path, err, warn, insideItem) {
	checkNames(fields, path, err, warn);
	fields.forEach((f, i) => {
		if (!isObject(f)) return;
		const p = `${path}[${i}]`;
		checkHtmlLeaf(f, p, err, warn);
		if (Array.isArray(f.subFields)) {
			f.subFields.forEach((sf, j) => isObject(sf) && checkHtmlLeaf(sf, `${p}.subFields[${j}]`, err, warn));
			checkNames(f.subFields, `${p}.subFields`, err, warn);
		}
		if (f.group && insideItem) warn(`${p}.group`, 'group inside a subExtractor is unusual; check the output shape');
	});
}

function checkHtmlLeaf(f, p, err, warn) {
	const selectors = typeof f.selector === 'string' ? [f.selector] : Array.isArray(f.selector) ? f.selector : [];
	selectors.forEach((s, k) => {
		if (typeof s !== 'string') return;
		const reason = unsupportedSelectorReason(s);
		if (reason) err(`${p}.selector${Array.isArray(f.selector) ? `[${k}]` : ''}`, `"${s}": ${reason}`);
	});
	if (Array.isArray(f.selector) && f.selector.length > 1 && !f.combineStrategy) {
		err(`${p}.combineStrategy`, 'a selector array needs a combineStrategy ("first" = first selector that matches, a fallback chain); without it the field is null');
	}
	const extract = f.extract ?? 'textContent';
	if (extract === 'attributeValue' && !f.attributeName) err(`${p}.attributeName`, 'is required for extract "attributeValue"');
	if (extract === 'attributeValues' && !(Array.isArray(f.attributeNames) && f.attributeNames.length > 0)) err(`${p}.attributeNames`, 'is required for extract "attributeValues"');
	if (extract === 'jsonContent' && !(Array.isArray(f.jsonPaths) && f.jsonPaths.length > 0)) {
		warn(`${p}.jsonPaths`, 'jsonContent without jsonPaths returns the whole parsed JSON; add jsonPaths for specific values');
	}
	if (extract === 'jsonContent' && typeof f.selector === 'string' && !/script/i.test(f.selector)) {
		warn(`${p}.selector`, 'jsonContent is meant for <script> blocks (application/ld+json, __NEXT_DATA__, script#__window__NAME)');
	}
	if (f.subExtractor) {
		if (extract !== 'innerHTML') err(`${p}.extract`, 'a field with subExtractor must use "extract": "innerHTML" (the sub-fields run on the matched element\'s inner HTML)');
		if (Array.isArray(f.subExtractor.fields)) checkHtmlFields(f.subExtractor.fields, `${p}.subExtractor.fields`, err, warn, true);
	}
	if (f.isArray === true && extract === 'innerHTML' && !f.subExtractor && !(f.transforms ?? []).length) {
		warn(`${p}`, 'isArray + innerHTML without subExtractor returns raw HTML strings; add subExtractor.fields for a list of objects');
	}
	if (extract === 'innerHTML' && !f.subExtractor && !(f.transforms ?? []).some((t) => t === 'toMarkdown' || t === 'removeHtmlTags')) {
		warn(`${p}`, 'innerHTML returns raw HTML; consider "toMarkdown" or textContent');
	}
}

function checkJsonFields(fields, path, err, warn) {
	checkNames(fields, path, err, warn);
	fields.forEach((f, i) => {
		if (!isObject(f)) return;
		const p = `${path}[${i}]`;
		if (f.selector !== undefined || f.extract !== undefined) err(p, 'JSON fields use jsonPath, not selector/extract (sourceType is "json")');
		if (typeof f.jsonPath === 'string' && /^\$/.test(f.jsonPath)) {
			err(`${p}.jsonPath`, 'JSON fields use plain dot paths without a "$" root, e.g. "data.items[*].name"');
		}
		if (typeof f.jsonPath === 'string' && /\[\?|\.\.|\[\d+:\d*\]|\['/.test(f.jsonPath)) {
			err(`${p}.jsonPath`, 'only dot notation, [n] and [*] are supported in JSON fields (no filters, recursive descent, slices or quoted keys)');
		}
		if (f.subExtractor && Array.isArray(f.transforms) && f.transforms.length > 0) {
			warn(`${p}.transforms`, 'transforms run BEFORE subExtractor (and the Studio drops them on save); move them to the sub-fields');
		}
		if (Array.isArray(f.subFields)) checkNames(f.subFields, `${p}.subFields`, err, warn);
		if (f.subExtractor && Array.isArray(f.subExtractor.fields)) checkJsonFields(f.subExtractor.fields, `${p}.subExtractor.fields`, err, warn);
	});
}

// ---------------------------------------------------------------------------
// Studio import file (Extractor Studio > ⋮ > Import)
// ---------------------------------------------------------------------------

/** The JSON file the ExtractHub Studio "Import" menu accepts. Browser actions are not part of that format. */
export function toStudioImport(def) {
	const target = {
		url: def.url,
		method: def.method ?? 'GET',
		...(def.body ? { body: def.body } : {}),
		useCustomHeaders: !!(def.headers && Object.keys(def.headers).length > 0),
		headers: def.headers ?? {},
		useProxy: def.useProxy === true,
		renderJs: def.renderJavascript === true,
		captureXhr: def.captureXhr === true,
		...(def.xhrUrlFilter ? { xhrUrlFilter: def.xhrUrlFilter } : {}),
		...(def.proxyCountry ? { country: def.proxyCountry } : {}),
		...(def.allowJsEscalation ? { allowJsEscalation: true } : {}),
		// The Studio import restores browser actions (same format as the definition)
		...(Array.isArray(def.browserActions) && def.browserActions.length > 0 ? { browserActions: def.browserActions } : {}),
	};
	return { target, extractor: def.extractorConfig };
}
