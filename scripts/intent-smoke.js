#!/usr/bin/env node
/**
 * Smoke tests for Seven intent resolution and embed safety.
 * Run: npm run test:intents
 *
 * Layer 1 (this script): local NLP + embed builders with fixture data — no Discord/DialogFlow.
 * Layer 2 (optional): SMOKE_LIVE_DF=1 calls DialogFlow for help-derived prompts.
 * Layer 3 (optional): docker logs grep after scripted Discord DMs via a test bot token.
 */

const { extractTargetNameFromMessage, resolveLocalIntent } = require("../helpers/nlp.js")
const { buildHelpPromptCatalog } = require("../helpers/test-catalog.js")
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

function extractHelpExamples() {
	return buildHelpPromptCatalog("member").map(e => e.prompt)
}

function testLocalIntentRegressions() {
	console.log("\n[1] Local intent regressions")
	const cases = [
		{
			prompt: "box cap info",
			df: { intent: { displayName: "getTargetInfo" } },
			params: { targetType: "machine", targetName: "" },
			expect: { intent: "getTargetInfo", targetName: "cap" },
		},
		{
			prompt: "give me the 5 latest boxes",
			df: { intent: { displayName: "Default Fallback Intent" } },
			params: {},
			expect: { intent: "filterTargets", limit: 5, sortby: "newest" },
		},
		{
			prompt: "psyray info",
			expect: { intent: "getMemberInfo", username: "psyray" },
		},
		{
			prompt: "hardest machines",
			expect: { intent: "filterTargets", sortby: "hardest" },
		},
	]

	for (const c of cases) {
		const result = resolveLocalIntent(c.prompt, c.df || null, c.params || null)
		assert(result?.intent === c.expect.intent, `${c.prompt} → ${c.expect.intent}`)
		if (c.expect.targetName) {
			assert(result?.parameters?.targetName === c.expect.targetName, `${c.prompt} targetName`)
		}
		if (c.expect.username) {
			assert(result?.parameters?.username === c.expect.username, `${c.prompt} username`)
		}
		if (c.expect.limit) {
			assert(result?.parameters?.limit === c.expect.limit, `${c.prompt} limit`)
		}
		if (c.expect.sortby) {
			assert(result?.parameters?.sortby?.[0] === c.expect.sortby, `${c.prompt} sortby`)
		}
	}
}

function testHelpExampleCoverage() {
	console.log("\n[2] Help examples — local intent or extractable target")
	const examples = extractHelpExamples()
	let covered = 0
	for (const prompt of examples) {
		const local = resolveLocalIntent(prompt)
		const extracted = extractTargetNameFromMessage(prompt)
		const ok = Boolean(local || extracted || /^(help|team info|what's new)/i.test(prompt))
		if (ok) covered++
		assert(ok, `help example: "${prompt}"`, "no local intent — may need DialogFlow training")
	}
	console.log(`  (${covered}/${examples.length} examples have local coverage or direct trigger)`)
}

async function testMemberEmbedPartialProfile() {
	console.log("\n[3] Member embed — partial team cache profile must not throw")
	const mockDs = {
		LAST_UPDATE: new Date(),
		TEAM_STATS: { id: 1, name: "Test" },
		tryDiscordifyUid: (id) => null,
		getMemberTeamRankById: () => 1,
	}
	const embeds = new HtbEmbeds(mockDs, { of: () => "" })
	const partialMember = {
		type: "member",
		id: 1,
		name: "psyray",
		rank: "Hacker",
		points: 100,
		ranking: 5000,
		rank_id: 3,
		respects: 10,
		avatar: "/avatar.png",
		country_code: "FR",
		country_name: "France",
		user_owns: 5,
		system_owns: 3,
	}
	let embed
	try {
		embed = await embeds.infoFor("member", "psyray", false, null, partialMember)
	} catch (err) {
		assert(false, "infoFor partial member", err.message)
		return
	}
	assert(Boolean(embed?.description), "member embed has description")
}

async function testLiveDialogFlow() {
	if (process.env.SMOKE_LIVE_DF !== "1") {
		console.log("\n[4] Live DialogFlow — skipped (set SMOKE_LIVE_DF=1 to enable)")
		return
	}
	console.log("\n[4] Live DialogFlow — help examples")
	const dialogflow = require("@google-cloud/dialogflow").v2beta1
	const { struct } = require("pb-util")
	require("dotenv").config({ path: process.env.NODE_ENV === "development" ? "./config/.env" : ".env" })
	const dflow = new dialogflow.SessionsClient({
		credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || "{}"),
	})
	const sessionPath = dflow.projectAgentSessionPath(process.env.GOOGLE_CLOUD_PROJECT, "smoke-test")

	for (const prompt of extractHelpExamples().slice(0, 20)) {
		const [res] = await dflow.detectIntent({
			session: sessionPath,
			queryInput: { text: { text: prompt, languageCode: "en" } },
		})
		const intent = res.queryResult.intent?.displayName
		const local = resolveLocalIntent(prompt, res.queryResult, struct.decode(res.queryResult.parameters))
		const ok = intent !== "Default Fallback Intent" || local
		assert(ok, `DF+local: "${prompt}"`, `intent=${intent}`)
	}
}

async function main() {
	console.log("Seven intent smoke tests")
	testLocalIntentRegressions()
	testHelpExampleCoverage()
	await testMemberEmbedPartialProfile()
	await testLiveDialogFlow()
	console.log(`\n${passed} passed, ${failed} failed`)
	process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
