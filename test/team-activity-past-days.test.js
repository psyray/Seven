"use strict"
/**
 * HTB serves team/activity?n_past_days=1 stale (it omitted owns that n_past_days=2 already
 * returned), so the fallback must request at least 2 days even for a short local window.
 * Run: npm run test:team-activity-past-days
 */
const assert = require("assert")
const { HtbApiConnector } = require("../modules/htb-api.js")

async function run() {
	const api = new HtbApiConnector()
	const requested = []
	const now = Date.now()

	api.getTeamActivity = async (teamId, { nPastDays } = {}) => {
		requested.push(nPastDays)
		return [{
			user: { id: 376729, name: "psyray" },
			object_type: "machine",
			name: "Facts",
			type: "root",
			date: new Date(now - 60 * 1000).toISOString(),
			first_blood: false,
		}]
	}

	const items = await api.getRecentTeamActivityForFallback(4184, now - 15 * 60 * 1000)
	assert.ok(requested[0] >= 2, `expected n_past_days >= 2 for a 15 min window, got ${requested[0]}`)
	assert.strictEqual(items.length, 1)
	assert.strictEqual(items[0].user_id, 376729)
	assert.strictEqual(items[0].name, "Facts")
	assert.ok(items[0]._activityTs > 0, "expected _activityTs to be computed")

	await api.getRecentTeamActivityForFallback(4184, now - 15 * 60 * 1000, { minPastDays: 7 })
	assert.strictEqual(requested[1], 7, "explicit minPastDays must win")

	await api.getRecentTeamActivityForFallback(4184, now - (30 * 86400000) + 3600000)
	assert.strictEqual(requested[2], 30, "wide windows keep their own day count")

	console.log("team-activity-past-days.test.js: ok")
}

run().catch(error => {
	console.error(error)
	process.exit(1)
})
