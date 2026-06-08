#!/usr/bin/env node
/**
 * E2E: send every help prompt to Seven via Discord DM and collect tagged logs.
 *
 * Prerequisites:
 *   - Seven running (docker compose up)
 *   - SMOKE_TRACE=1 on the seven container (see docker-compose or .env)
 *   - SMOKE_DISCORD_TOKEN = your test Discord user token
 *   - SMOKE_BOT_USER_ID = Seven bot snowflake ID
 *
 * Run:
 *   SMOKE_TRACE=1 docker compose up -d
 *   node scripts/e2e-help-audit.js
 *
 * Then analyze:
 *   docker compose logs seven --since 15m > /tmp/seven-e2e.log
 *   node scripts/analyze-seven-logs.js /tmp/seven-e2e.log
 */

const Discord = require("discord.js")
const { buildHelpPromptCatalog, smokeTaggedPrompt } = require("../helpers/test-catalog.js")

const TOKEN = process.env.SMOKE_DISCORD_TOKEN
const BOT_ID = process.env.SMOKE_BOT_USER_ID
const DELAY_MS = Number(process.env.SMOKE_DELAY_MS || 2500)
const ROLE = process.env.SMOKE_ROLE || "member"
const LIMIT = Number(process.env.SMOKE_LIMIT || 0)

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
	if (!TOKEN || !BOT_ID) {
		console.error("Set SMOKE_DISCORD_TOKEN and SMOKE_BOT_USER_ID")
		process.exit(1)
	}

	const client = new Discord.Client()
	await client.login(TOKEN)

	const bot = await client.users.fetch(BOT_ID)
	const dm = await bot.createDM()
	const catalog = buildHelpPromptCatalog(ROLE)
	const prompts = LIMIT > 0 ? catalog.slice(0, LIMIT) : catalog

	console.log(`Sending ${prompts.length} help prompts to Seven (role=${ROLE})…`)
	console.log("Ensure SMOKE_TRACE=1 is set on the bot container.\n")

	for (const entry of prompts) {
		const text = smokeTaggedPrompt(entry.id, entry.prompt)
		console.log(`→ [${entry.id}] ${entry.prompt}`)
		await dm.send(text)
		await sleep(DELAY_MS)
	}

	console.log("\nDone. Capture logs and analyze:")
	console.log("  docker compose logs seven --since 15m > /tmp/seven-e2e.log")
	console.log("  node scripts/analyze-seven-logs.js /tmp/seven-e2e.log")

	client.destroy()
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
