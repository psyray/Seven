"use strict"

const assert = require("assert")

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
		blood: Boolean(entry.first_blood || entry.blood),
	}
}

function run() {
	const entry = {
		object_type: "machine",
		name: "Cap",
		type: "user",
		date: "2026-06-17T10:00:00.000000Z",
		first_blood: true,
		user: { id: 39889, name: "tester" },
		_activityTs: Date.parse("2026-06-17T10:00:00.000000Z"),
	}

	const normalized = normalizeMemberActivityItem(entry, null)
	assert.ok(normalized)
	assert.strictEqual(normalized.uid, 39889)
	assert.strictEqual(normalized.blood, true)
	assert.strictEqual(normalized.type, "machine")
	assert.strictEqual(normalized.flag, "user")

	console.log("team-activity-fallback.test.js: ok")
}

run()
