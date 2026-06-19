"use strict"

const assert = require("assert")
const {
	mergeActivityEntry,
	teamActivityItemToMemberEntry,
	activityEntryExists,
} = require("../modules/htb-api.js")

function run() {
	const member = { id: 42, name: "Seimu", activity: [] }
	const entry = teamActivityItemToMemberEntry({
		object_type: "machine",
		name: "Cap",
		type: "user",
		date: "2026-06-17T10:00:00.000000Z",
		first_blood: true,
		id: 9,
	})

	assert.ok(entry)
	assert.strictEqual(entry.object_type, "machine")
	assert.strictEqual(entry.type, "user")
	assert.strictEqual(entry.first_blood, true)

	assert.ok(mergeActivityEntry(member, entry))
	assert.strictEqual(member.activity.length, 1)
	assert.ok(activityEntryExists(member, entry))
	assert.ok(!mergeActivityEntry(member, entry))

	const rootEntry = teamActivityItemToMemberEntry({
		object_type: "machine",
		name: "Cap",
		type: "root",
		date: "2026-06-18T10:00:00.000000Z",
		id: 9,
	})
	assert.ok(mergeActivityEntry(member, rootEntry))
	assert.strictEqual(member.activity.length, 2)

	console.log("member-activity-hydrate.test.js: ok")
}

run()
