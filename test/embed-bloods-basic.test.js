"use strict"

const assert = require("assert")

function hasBloodsFromBasic({ user_bloods = 0, system_bloods = 0, challenge_bloods = 0 } = {}) {
	return (user_bloods || 0) + (system_bloods || 0) + (challenge_bloods || 0) > 0
}

function run() {
	assert.strictEqual(hasBloodsFromBasic({ user_bloods: 1 }), true)
	assert.strictEqual(hasBloodsFromBasic({ system_bloods: 2 }), true)
	assert.strictEqual(hasBloodsFromBasic({ challenge_bloods: 1 }), true)
	assert.strictEqual(hasBloodsFromBasic({}), false)
	assert.strictEqual(hasBloodsFromBasic({ bloods: { machines: [{ id: 1 }], challenges: [] } }), false)

	console.log("embed-bloods-basic.test.js: ok")
}

run()
