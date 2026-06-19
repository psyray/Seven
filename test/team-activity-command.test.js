#!/usr/bin/env node
/**
 * Team activity command — local routing and embed shape.
 */

const { resolveLocalIntent } = require("../helpers/nlp.js")
const { HtbEmbeds } = require("../views/embeds.js")

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

function testRouting() {
	console.log("\n[1] team activity local intent")
	const result = resolveLocalIntent("team activity")
	assert(result?.intent === "getTeamActivity", "team activity → getTeamActivity")

	console.log("\n[2] team info must not become getMemberInfo when DF says getTeamInfo")
	const teamInfo = resolveLocalIntent("team info", { intent: { displayName: "getTeamInfo" } }, {})
	assert(teamInfo?.intent === "getTeamInfo", "team info + DF getTeamInfo → getTeamInfo")
}

function testEmbed() {
	console.log("\n[3] teamActivity embed")
	const mockDs = {
		TEAM_STATS: { id: 1, name: "Test", avatar_url: "https://example.com/a.png" },
	}
	const egi = new HtbEmbeds(mockDs, { of: () => "" })

	const empty = egi.teamActivity([], { days: 7 })
	assert(Boolean(empty.description), "empty feed has description")
	assert(empty.description.includes("No team activity"), "empty feed message")

	const rows = [{
		memberName: "psyray",
		targetName: "Lame",
		objectType: "machine",
		ownType: "user",
		date: "2026-06-19T00:00:00.000Z",
		firstBlood: true,
	}]
	const filled = egi.teamActivity(rows, { days: 7 })
	assert(filled.description.includes("psyray"), "feed lists member")
	assert(filled.description.includes("Lame"), "feed lists target")

	const noTeam = egi.teamActivity([], { days: 7, error: "no_team" })
	assert(noTeam.description.includes("not loaded"), "no_team error embed")
}

testRouting()
testEmbed()

console.log(`\nTeam activity command tests: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
