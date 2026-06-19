"use strict"

const assert = require("assert")
const {
	parseHtbTokenSetCommand,
	trimMessageContentForHandler,
	resolveLocalIntentWithoutDialogFlow,
} = require("../helpers/nlp.js")

const LONG_REFRESH = "def50200" + "a".repeat(714)

function run() {
	const cmd = `htb token set ${LONG_REFRESH}`
	const parsed = parseHtbTokenSetCommand(cmd)
	assert.strictEqual(parsed?.mode, "refresh")
	assert.strictEqual(parsed?.htbRefreshToken.length, LONG_REFRESH.length)

	const trimmed = trimMessageContentForHandler(cmd)
	assert.strictEqual(trimmed, cmd, "htb token set must not be truncated to 255 chars")

	const normal = trimMessageContentForHandler("a".repeat(400))
	assert.strictEqual(normal.length, 255)

	const dfSkip = resolveLocalIntentWithoutDialogFlow(cmd)
	assert.strictEqual(dfSkip?.intent, "admin.htbTokenSet")
	assert.strictEqual(dfSkip?.parameters?.htbRefreshToken.length, LONG_REFRESH.length)

	console.log("htb-token-truncate.test.js: ok")
}

run()
