"use strict"

const assert = require("assert")
const { SevenDatastore } = require("../models/SevenDatastore.js")

function makeDatastore() {
	const ds = Object.create(SevenDatastore.prototype)
	ds.MISC = {
		PROLABS: {
			1: { id: 1, name: "RastaLabs", type: "prolab" },
			2: { id: 2, name: "Offshore", type: "prolab" },
		},
	}
	ds.TEAM_MEMBERS = {
		42: {
			id: 42,
			name: "Seimu",
			activity: [],
			prolabs: [
				{ id: 1, name: "RastaLabs", completion_percentage: 35 },
				{ id: 2, name: "Offshore", completion_percentage: 0 },
			],
		},
	}
	return ds
}

function run() {
	const ds = makeDatastore()
	const member = ds.TEAM_MEMBERS[42]
	const owned = ds.filterEnt(
		null,
		"prolab",
		["id"],
		"asc",
		0,
		null,
		null,
		["Seimu"],
		[{ cust: "nolimit" }, { cust: "complete" }]
	)

	assert.strictEqual(owned.length, 1, "expected one owned pro lab from progress data")
	assert.strictEqual(owned[0].name, "RastaLabs")

	const owns = ds.getMemberOwnsForTarget(member, { id: 1, name: "RastaLabs", type: "prolab" })
	assert.ok(owns, "progress should count as own")
	assert.strictEqual(owns[0].completion_percentage, 35)

	console.log("member-lab-owns.test.js: ok")
}

run()
