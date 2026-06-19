"use strict"

const assert = require("assert")
const {
	__test__: {
		optionalMemberProfileFallback,
		isOptionalMemberProfilePath,
		isOptionalGetEndpoint,
		optionalGetEndpointFallback,
		optionalEndpointLogKey,
	},
} = require("../modules/htb-api.js")

function run() {
	assert.ok(isOptionalMemberProfilePath("user/profile/progress/endgame/376729"))
	assert.ok(isOptionalMemberProfilePath("user/profile/progress/machines/os/376729"))
	assert.ok(!isOptionalMemberProfilePath("user/profile/basic/376729"))
	assert.ok(!isOptionalMemberProfilePath("user/profile/activity/376729"))
	assert.ok(!isOptionalMemberProfilePath("user/profile/bloods/376729"))

	assert.deepStrictEqual(optionalMemberProfileFallback(), { profile: {} })

	assert.ok(isOptionalGetEndpoint("team/activity/4184?n_past_days=1"))
	assert.ok(!isOptionalGetEndpoint("team/graph/4184?duration=1W"))
	assert.deepStrictEqual(optionalGetEndpointFallback("team/activity/4184"), [])
	assert.strictEqual(optionalEndpointLogKey("team/activity/4184?n_past_days=1"), "team/activity")

	console.log("htb-optional-endpoints.test.js: ok")
}

run()
