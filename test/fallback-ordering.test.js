"use strict"
/**
 * Regression: HTB returns team/activity newest-first. The fallback watermark advances
 * with each processed own, so consuming that order dropped every older own of the same
 * batch (a user flag five seconds before its root was never announced).
 * Run: npm run test:fallback-ordering
 */
const assert = require("assert")
const { NotificationRouter } = require("../helpers/notification-router.js")

function buildRouter() {
	const router = new NotificationRouter({
		dat: { TEAM_STATS: {}, TEAM_MEMBERS: {}, DISCORD_LINKS: {}, MACHINES: {}, CHALLENGES: {} },
		embeds: {},
		getAnnounceChannel: () => null,
		updateCache: async () => {},
		notifyAdmins: async () => {},
	})
	router.fallbackWatermark = 0
	router.isTeamMember = () => true
	router.seen = []
	router.handleOwnEvent = async message => {
		router.seen.push(`${message.target}:${message.flag}`)
		return { ok: true }
	}
	return router
}

async function run() {
	const base = Date.parse("2026-11-10T04:53:55.000000Z")
	const item = (type, offsetSeconds) => ({
		user: { id: 376729, name: "psyray" },
		object_type: "machine",
		name: "Baby",
		type,
		date: new Date(base + offsetSeconds * 1000).toISOString(),
		_activityTs: base + offsetSeconds * 1000,
		first_blood: false,
	})

	// The API sorts newest first: root, then the user flag six seconds earlier.
	const router = buildRouter()
	const stats = await router.processFallbackActivityItems([item("root", 6), item("user", 0)])

	assert.deepStrictEqual(router.seen, ["Baby:user", "Baby:root"], "both flags must be processed oldest first")
	assert.strictEqual(stats.announced, 2)
	assert.strictEqual(stats.failed, 0)
	assert.strictEqual(router.fallbackWatermark, base + 6000)

	const second = buildRouter()
	second.fallbackWatermark = base + 6000
	const replay = await second.processFallbackActivityItems([item("root", 6), item("user", 0)])
	assert.deepStrictEqual(second.seen, [], "events older than the watermark must not replay")
	assert.strictEqual(replay.announced, 0)
	assert.strictEqual(replay.skipped, 2)

	console.log("fallback-ordering.test.js: ok")
}

run().catch(error => {
	console.error(error)
	process.exit(1)
})
