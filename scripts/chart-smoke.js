#!/usr/bin/env node
/**
 * Chart smoke tests — term normalization, graceful render failure, handler paths.
 * Run: npm run test:charts
 */

const { normalizeChartTerm } = require("../helpers/chart-term.js")
const { buildMemberProgressChart, buildMemberActivityChart } = require("../helpers/chart-messages.js")
const { getPuppeteerLaunchOptions } = require("../helpers/puppeteer-launch.js")
const { renderChart } = require("../modules/charts/index_new.js")
const { createSmokeContext, runSmokePrompt } = require("../helpers/smoke-handler.js")

let passed = 0
let failed = 0

function assert(condition, label, detail = "") {
	if (condition) {
		passed++
		console.log(`  ✓ ${label}`)
	} else {
		failed++
		console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
	}
}

function testNormalizeChartTerm() {
	console.log("\n[1] Chart term normalization")
	const cases = [
		["", "1Y"],
		["   ", "1Y"],
		["6 months", "6M"],
		["1y", "1Y"],
		["3M", "3M"],
		["psyray", "1Y"],
	]
	for (const [input, expected] of cases) {
		assert(normalizeChartTerm(input) === expected, `normalizeChartTerm("${input}") → ${expected}`)
	}
}

async function testGracefulRenderFailure() {
	console.log("\n[2] Graceful render failure (no process crash)")
	const member = { id: 1, name: "psyray" }
	const throwingRender = async () => { throw new Error("Puppeteer launch failed") }
	const result = await buildMemberProgressChart(
		member,
		"",
		async () => ({ profile: { graphData: { 0: [[Date.now(), 1]] } } }),
		throwingRender
	)
	assert(result.term === "1Y", "empty interval defaults to 1Y")
	assert(result.chartImage === null, "render failure yields null image")
}

async function testMissingGraphData() {
	console.log("\n[3] renderChart with missing graphData")
	const prev = process.env.CHART_RENDER_DISABLED
	process.env.CHART_RENDER_DISABLED = "0"
	const out = await renderChart({ id: 1, name: "test" }, { profile: {} }, "1Y", "userProgress")
	assert(out === null, "missing graphData returns null without throw")
	if (prev === undefined) delete process.env.CHART_RENDER_DISABLED
	else process.env.CHART_RENDER_DISABLED = prev
}

function testPuppeteerLaunchConfig() {
	console.log("\n[4] Puppeteer launch config")
	const prev = process.env.PUPPETEER_EXECUTABLE_PATH
	process.env.PUPPETEER_EXECUTABLE_PATH = "/usr/lib/chromium/chromium"
	const opts = getPuppeteerLaunchOptions()
	assert(opts.executablePath === "/usr/lib/chromium/chromium", "uses real chromium binary path")
	assert(opts.args.some(a => a.startsWith("--user-data-dir=")), "sets chrome user data dir")
	assert(opts.args.includes("--no-sandbox"), "includes docker sandbox flags")
	if (prev === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH
	else process.env.PUPPETEER_EXECUTABLE_PATH = prev
}

async function testHandlerChartPaths() {
	console.log("\n[5] Handler chart commands (mock render)")
	const ctx = createSmokeContext()
	const chartPrompts = [
		"psyray chart",
		"testuser progress over 6 months",
		"show testuser activity",
	]
	for (const prompt of chartPrompts) {
		const result = await runSmokePrompt(prompt, ctx)
		assert(result.ok, `handler: "${prompt}"`, result.error)
	}
}

async function testActivityChartGraceful() {
	console.log("\n[6] Activity chart render failure")
	const member = { id: 1, name: "testuser" }
	const image = await buildMemberActivityChart(member, [[]], { oldest: new Date(), latest: new Date() }, async () => {
		throw new Error("browser failed")
	})
	assert(image === null, "activity chart failure returns null")
}

async function main() {
	console.log("Seven chart smoke tests")
	testNormalizeChartTerm()
	await testGracefulRenderFailure()
	await testMissingGraphData()
	testPuppeteerLaunchConfig()
	await testHandlerChartPaths()
	await testActivityChartGraceful()
	console.log(`\n${passed} passed, ${failed} failed`)
	process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
