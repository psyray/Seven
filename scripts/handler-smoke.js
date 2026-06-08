#!/usr/bin/env node
/**
 * Layer 4 — handler smoke tests with fixture cache (no Discord / DialogFlow / HTB API).
 *
 * Usage:
 *   npm run test:handler
 *   npm run test:handler -- --verbose
 *   npm run test:handler -- --prompt "box cap info"
 *   npm run test:all
 */

const { buildHelpPromptCatalog } = require("../helpers/test-catalog.js")
const { classifySmokePrompt } = require("../helpers/smoke-intents.js")
const { createSmokeContext, runSmokePrompt } = require("../helpers/smoke-handler.js")

const args = process.argv.slice(2)
const verbose = args.includes("--verbose")
const singlePromptIdx = args.indexOf("--prompt")
const singlePrompt = singlePromptIdx >= 0 ? args[singlePromptIdx + 1] : null

let passed = 0
let failed = 0
let skipped = 0
let dfOnly = 0

function pass(label) {
	passed++
	if (verbose) console.log(`  ✓ ${label}`)
}

function fail(label, detail = "") {
	failed++
	console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
}

async function main() {
	console.log("Seven handler smoke tests (layer 4 — offline fixtures)\n")

	const ctx = createSmokeContext()
	const catalog = singlePrompt
		? [{ id: "single", prompt: singlePrompt }]
		: buildHelpPromptCatalog("member")

	const extraRegression = [
		"box cap info",
		"give me the 5 latest boxes",
		"psyray info",
	]

	const prompts = singlePrompt
		? catalog
		: [
			...catalog,
			...extraRegression
				.filter(p => !catalog.some(c => c.prompt.toLowerCase() === p.toLowerCase()))
				.map((p, i) => ({ id: `regression-${i}`, prompt: p })),
		]

	for (const entry of prompts) {
		const classification = classifySmokePrompt(entry.prompt)

		if (classification === "skip") {
			skipped++
			if (verbose) console.log(`  ○ skip [${entry.id}] "${entry.prompt}"`)
			continue
		}

		const result = await runSmokePrompt(entry.prompt, ctx)

		if (result.status === "df-only") {
			dfOnly++
			if (verbose) console.log(`  △ df-only [${entry.id}] "${entry.prompt}"`)
			continue
		}

		if (result.ok) {
			pass(`[${entry.id}] "${entry.prompt}" → ${result.intent} (${result.route})`)
		} else {
			fail(`[${entry.id}] "${entry.prompt}" → ${result.intent}`, result.error)
		}
	}

	console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped, ${dfOnly} dialogflow-only (not run offline)`)
	console.log("\nManual test commands:")
	console.log("  npm run test:intents     — NLP + embed unit checks")
	console.log("  npm run test:handler     — this script (full handler offline)")
	console.log("  npm run test:e2e         — Discord DM audit (needs tokens)")
	console.log("  npm run test:logs <file> — analyze E2E docker logs")

	process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
