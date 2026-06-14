/**
 * Environment-driven configuration for HTB Pusher notifications.
 * @module Pusher-Config
 */

function envBool(name, defaultValue = true) {
	const raw = process.env[name]
	if (raw === undefined || raw === "") return defaultValue
	return !["0", "false", "no", "off"].includes(String(raw).toLowerCase())
}

function envInt(name, defaultValue) {
	const parsed = Number(process.env[name])
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function getPusherNotificationConfig() {
	return {
		announceUserFlags: envBool("PUSHER_ANNOUNCE_USER_FLAGS", true),
		announceRootFlags: envBool("PUSHER_ANNOUNCE_ROOT_FLAGS", true),
		announceChallenges: envBool("PUSHER_ANNOUNCE_CHALLENGES", true),
		announceLabs: envBool("PUSHER_ANNOUNCE_LABS", true),
		announceLaunches: envBool("PUSHER_ANNOUNCE_LAUNCHES", true),
		announceRespects: envBool("PUSHER_ANNOUNCE_RESPECTS", false),
		announceBadges: envBool("PUSHER_ANNOUNCE_BADGES", true),
		announceJoins: envBool("PUSHER_ANNOUNCE_JOINS", false),
		announceShoutbox: envBool("PUSHER_ANNOUNCE_SHOUTBOX", false),
		mentionOnOwn: envBool("PUSHER_MENTION_ON_OWN", true),
		dbPersistDebounceMs: envInt("PUSHER_DB_PERSIST_DEBOUNCE_MS", 30000),
		fallbackPollMs: envInt("PUSHER_FALLBACK_POLL_MS", 300000),
	}
}

module.exports = {
	getPusherNotificationConfig,
	envBool,
	envInt,
}
