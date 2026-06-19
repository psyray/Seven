"use strict"

const assert = require("assert")
const { resolveLocalIntent } = require("../helpers/nlp.js")
const { SYNC_DEFAULT_PUBLISH_LIMIT } = require("../helpers/notification-router.js")

function ownKey(message) {
	return [
		message.uid,
		message.type,
		message.target,
		message.flag,
		message.blood ? "blood" : "",
	].join("|")
}

function computeMissing(rawItems, knownKeys, normalize, isTeamMember, ownTypes) {
	const normalized = []
	let known = 0
	for (const item of rawItems) {
		const entry = normalize(item, item.user_id)
		if (!entry || !ownTypes.has(entry.type) || !isTeamMember(entry.uid)) continue
		const key = ownKey(entry)
		if (knownKeys.has(key)) {
			known++
			continue
		}
		knownKeys.add(key)
		normalized.push(entry)
	}
	normalized.sort((a, b) => a.time - b.time)
	return { items: normalized, known, missing: normalized.length }
}

function normalizeMemberActivityItem(entry, uid) {
	const resolvedUid = uid || entry.user?.id || entry.user_id
	const objectType = String(entry.object_type || "").toLowerCase()
	const targetName = entry.name
	if (!resolvedUid || !objectType || !targetName) return null
	let type = objectType
	let flag = entry.type
	if (objectType === "machine") {
		type = "machine"
		flag = String(entry.type || "").toLowerCase() === "root" ? "root" : "user"
	}
	return {
		uid: Number(resolvedUid),
		time: entry._activityTs || Date.parse(entry.date) || Date.now(),
		type,
		target: targetName,
		flag,
		blood: Boolean(entry.first_blood),
	}
}

function run() {
	console.log("\n[1] NLP routing — silent")
	const sync = resolveLocalIntent("team activity sync")
	assert.strictEqual(sync?.intent, "captain.teamActivitySync")
	assert.strictEqual(sync?.parameters.mode, "silent")

	const syncDays = resolveLocalIntent("team activity sync 30")
	assert.strictEqual(syncDays?.parameters.days, 30)
	assert.strictEqual(syncDays?.parameters.mode, "silent")

	console.log("\n[2] NLP routing — publish")
	const publish = resolveLocalIntent("team activity sync publish")
	assert.strictEqual(publish?.parameters.mode, "publish")
	assert.strictEqual(publish?.parameters.publishLimit, null)

	const publishN = resolveLocalIntent("team activity sync publish 10")
	assert.strictEqual(publishN?.parameters.publishLimit, 10)

	const publishAll = resolveLocalIntent("team activity sync publish-all")
	assert.strictEqual(publishAll?.parameters.mode, "publishAll")

	const publishAllDays = resolveLocalIntent("team activity sync publish-all 30")
	assert.strictEqual(publishAllDays?.parameters.days, 30)

	const activity = resolveLocalIntent("team activity")
	assert.strictEqual(activity?.intent, "getTeamActivity")

	console.log("\n[3] Diff — recorded row counts as known for silent scope")
	const ownTypes = new Set(["machine", "challenge"])
	const teamMembers = { 1: { id: 1, name: "alice" } }
	const isTeamMember = uid => Boolean(teamMembers[uid])
	const raw = [
		{ object_type: "machine", name: "Cap", type: "user", user_id: 1, date: "2026-06-17T10:00:00.000Z", _activityTs: Date.parse("2026-06-17T10:00:00.000Z") },
		{ object_type: "machine", name: "Lame", type: "root", user_id: 1, date: "2026-06-18T10:00:00.000Z", _activityTs: Date.parse("2026-06-18T10:00:00.000Z") },
		{ object_type: "machine", name: "Newest", type: "user", user_id: 1, date: "2026-06-19T10:00:00.000Z", _activityTs: Date.parse("2026-06-19T10:00:00.000Z") },
	]
	const knownKeys = new Set([ownKey({ uid: 1, type: "machine", target: "Cap", flag: "user", blood: false })])
	const diff = computeMissing(raw, knownKeys, normalizeMemberActivityItem, isTeamMember, ownTypes)
	assert.strictEqual(diff.known, 1)
	assert.strictEqual(diff.missing, 2)
	assert.strictEqual(diff.items[0].target, "Lame")
	assert.strictEqual(diff.items[1].target, "Newest")

	console.log("\n[4] Publish takes most recent N")
	const recent = diff.items.slice(-SYNC_DEFAULT_PUBLISH_LIMIT)
	assert.strictEqual(recent.length, 2)
	assert.strictEqual(recent[1].target, "Newest")

	console.log("\n[5] Default publish limit")
	assert.strictEqual(SYNC_DEFAULT_PUBLISH_LIMIT, 5)

	console.log("\nteam-activity-sync.test.js: ok")
}

run()
