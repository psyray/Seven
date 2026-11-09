"use strict"
/**
 * Unit tests for the HTB socket `blood-created` target resolver.
 * Run: npm run test:blood-parser
 */
const assert = require("assert")
const { resolveBloodTarget, normalizeMessage } = require("../helpers/blood-parser.js")

const catalog = {
	machines: {
		829: { name: "Facts" },
		835: { name: "WingData" },
		1012: { name: "Unclaimed" },
	},
	challenges: {
		1944: { name: "Orrery Vault" },
		2077: { name: "Facts of Life" },
	},
}

const cases = [
	{
		message: "psyray got the first blood on Facts (root)",
		expect: { type: "machine", target: "Facts", flag: "root" },
	},
	{
		message: "First blood on machine Facts by psyray — user flag",
		expect: { type: "machine", target: "Facts", flag: "user" },
	},
	{
		message: "1st blood: psyray owned system on <b>Facts</b>",
		expect: { type: "machine", target: "Facts", flag: "root" },
	},
	{
		message: "psyray is the first to solve Orrery Vault",
		expect: { type: "challenge", target: "Orrery Vault", flag: "challenge" },
	},
	{
		message: "psyray took the first blood on Facts of Life",
		expect: { type: "challenge", target: "Facts of Life", flag: "challenge" },
	},
	{
		message: "psyray got the first blood on Facts",
		expect: null,
		label: "machine blood without a flag must not guess",
	},
	{
		message: "psyray got the first blood on NotARealBox root",
		expect: null,
		label: "unknown target must be left to the API fallback",
	},
	{
		message: "",
		expect: null,
	},
]

let failed = 0

for (const testCase of cases) {
	const label = testCase.label || testCase.message
	const actual = resolveBloodTarget(testCase.message, catalog)
	try {
		assert.deepStrictEqual(actual, testCase.expect)
		console.log(`  ok ${label}`)
	} catch (error) {
		failed++
		console.error(`  FAIL ${label} — expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(actual)}`)
	}
}

assert.strictEqual(normalizeMessage("<b>a</b>&nbsp;b"), "a b")
assert.strictEqual(normalizeMessage("  spaced   out  "), "spaced out")

if (failed) {
	console.error(`\nblood-parser.test.js: ${failed} failed`)
	process.exit(1)
}
console.log("\nblood-parser.test.js: ok")
