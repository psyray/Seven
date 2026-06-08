#!/usr/bin/env node
/**
 * Analyze Seven bot logs after an E2E help-command run.
 *
 * Usage:
 *   docker compose logs seven --since 10m > /tmp/seven-run.log
 *   node scripts/analyze-seven-logs.js /tmp/seven-run.log
 *
 * Or pipe:
 *   docker compose logs seven --since 10m | node scripts/analyze-seven-logs.js
 *
 * Expects [SMOKE:id] tags in prompts (see scripts/e2e-help-audit.js) and
 * [SMOKE] result lines emitted by the bot when SMOKE_TRACE=1.
 */

const fs = require("fs")
const { buildHelpPromptCatalog, SMOKE_TAG_RX } = require("../helpers/test-catalog.js")

const FAILURE_PATTERNS = [
	{ id: "exception", rx: /TypeError:|ReferenceError:|SyntaxError:|UnhandledPromiseRejection/i, severity: "error" },
	{ id: "stack", rx: /^\s+at /m, severity: "error" },
	{ id: "parse_fail", rx: /couldn't parse any identifier/i, severity: "warn" },
	{ id: "df_fallback", rx: /Detected intent: Default Fallback Intent/i, severity: "warn" },
	{ id: "entity_unfound", rx: /Couldn't find anything|418 I'm a teapot/i, severity: "info" },
	{ id: "can_you_repeat", rx: /can you say that again/i, severity: "warn" },
]

/**
 * @param {string} logText
 * @returns {Map<string, { lines: string[], results: object[], failures: object[] }>}
 */
function sliceLogBySmokeId(logText) {
	const sections = new Map()
	const lines = logText.split("\n")

	for (const line of lines) {
		const tag = line.match(SMOKE_TAG_RX)
		if (!tag) continue
		const id = tag[1]
		if (!sections.has(id)) {
			sections.set(id, { lines: [], results: [], failures: [] })
		}
		const section = sections.get(id)
		section.lines.push(line)

		if (line.includes("[SMOKE] result")) {
			try {
				const json = line.slice(line.indexOf("{"))
				section.results.push(JSON.parse(json))
			} catch (_) { /* ignore malformed */ }
		}

		for (const pat of FAILURE_PATTERNS) {
			if (pat.rx.test(line)) {
				section.failures.push({ pattern: pat.id, severity: pat.severity, line: line.trim() })
			}
		}
	}
	return sections
}

function analyze(logText, catalog) {
	const sections = sliceLogBySmokeId(logText)
	const report = []
	let errors = 0
	let warnings = 0

	for (const entry of catalog) {
		const section = sections.get(entry.id)
		const row = {
			id: entry.id,
			prompt: entry.prompt,
			found: Boolean(section),
			intent: section?.results?.at(-1)?.intent ?? null,
			ok: section?.results?.at(-1)?.ok ?? null,
			failures: section?.failures ?? [],
		}

		if (!section) {
			row.failures.push({ pattern: "missing_log", severity: "error", line: "No log section for this prompt" })
		}
		if (row.failures.some(f => f.severity === "error")) errors++
		if (row.failures.some(f => f.severity === "warn")) warnings++

		report.push(row)
	}

	return { report, errors, warnings, covered: sections.size, total: catalog.length }
}

function printReport({ report, errors, warnings, covered, total }) {
	console.log(`\nSeven log analysis — ${covered}/${total} prompts found in logs\n`)
	for (const row of report) {
		const status = row.failures.some(f => f.severity === "error")
			? "FAIL"
			: row.failures.some(f => f.severity === "warn")
				? "WARN"
				: row.found ? "OK" : "MISSING"
		const intent = row.intent ? ` intent=${row.intent}` : ""
		console.log(`${status.padEnd(7)} [${row.id}] "${row.prompt}"${intent}`)
		for (const f of row.failures) {
			console.log(`         ↳ [${f.pattern}] ${f.line.slice(0, 120)}`)
		}
	}
	console.log(`\nSummary: ${errors} errors, ${warnings} warnings, ${total - covered} missing sections`)
}

function main() {
	const logPath = process.argv[2]
	const logText = logPath && logPath !== "-"
		? fs.readFileSync(logPath, "utf8")
		: fs.readFileSync(0, "utf8")

	const catalog = buildHelpPromptCatalog("member")
	const result = analyze(logText, catalog)
	printReport(result)
	process.exit(result.errors > 0 ? 1 : 0)
}

if (require.main === module) {
	main()
}

module.exports = { sliceLogBySmokeId, analyze, FAILURE_PATTERNS }
