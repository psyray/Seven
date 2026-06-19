"use strict"

const assert = require("assert")
const { SevenDatastore } = require("../models/SevenDatastore.js")

function makeDatastore() {
	const ds = Object.create(SevenDatastore.prototype)
	ds.TEAM_MEMBERS = {
		42: { id: 42, name: "Seimu", activity: [] },
		99: { id: 99, name: "Other", activity: [] },
	}
	ds._targetActivityCacheAt = {}
	ds.V4API = {
		getTargetActivityForTeam: async (target, memberIds) => {
			assert.strictEqual(target.type, "machine")
			assert.strictEqual(target.id, 7)
			assert.deepStrictEqual(memberIds, [42, 99])
			return [{
				uid: 42,
				entry: {
					object_type: "machine",
					type: "user",
					name: "Cap",
					date: "2026-06-17T10:00:00.000000Z",
					id: 7,
				},
			}]
		},
	}
	ds.getMemberById = (id) => ds.TEAM_MEMBERS[id]
	return ds
}

async function run() {
	const ds = makeDatastore()
	const target = { id: 7, name: "Cap", type: "machine" }

	assert.strictEqual(ds.getTeamOwnsForTarget(target), null)

	await ds.ensureTargetActivityCached(target)

	const owns = ds.getTeamOwnsForTarget(target)
	assert.ok(owns)
	assert.strictEqual(owns.length, 1)
	assert.strictEqual(owns[0].uid, 42)
	assert.strictEqual(owns[0].type, "user")

	console.log("target-activity-on-demand.test.js: ok")
}

run().catch((error) => {
	console.error(error)
	process.exit(1)
})
