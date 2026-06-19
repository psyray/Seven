"use strict"

const assert = require("assert")
const { parseHtbTokenSetCommand, parseSetHtbTokensCommand, resolveLocalIntent } = require("../helpers/nlp.js")

const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.AbCdEfGh"
const REFRESH = "def50200deadbeef"

function run() {
	const pair = parseHtbTokenSetCommand(`htb token set ${ACCESS} ${REFRESH}`)
	assert.ok(pair, "pair command")
	assert.strictEqual(pair.mode, "pair")
	assert.strictEqual(pair.htbAccessToken, ACCESS)
	assert.strictEqual(pair.htbRefreshToken, REFRESH)

	const multiline = parseHtbTokenSetCommand(`htb token set ${ACCESS}\n${REFRESH}`)
	assert.ok(multiline, "multiline pair")
	assert.strictEqual(multiline.mode, "pair")

	const refreshOnly = parseHtbTokenSetCommand(`htb token set ${REFRESH}`)
	assert.ok(refreshOnly, "refresh-only command")
	assert.strictEqual(refreshOnly.mode, "refresh")
	assert.strictEqual(refreshOnly.htbRefreshToken, REFRESH)

	const legacy = parseSetHtbTokensCommand(`set htb tokens ${ACCESS} ${REFRESH}`)
	assert.ok(legacy, "legacy pair alias")
	assert.strictEqual(legacy.htbAccessToken, ACCESS)

	const pairIntent = resolveLocalIntent(`htb token set ${ACCESS} ${REFRESH}`, null, null)
	assert.strictEqual(pairIntent?.intent, "admin.htbTokenSet")
	assert.strictEqual(pairIntent?.parameters?.mode, "pair")

	const refreshIntent = resolveLocalIntent(`htb token set ${REFRESH}`, null, null)
	assert.strictEqual(refreshIntent?.intent, "admin.htbTokenSet")
	assert.strictEqual(refreshIntent?.parameters?.mode, "refresh")

	console.log("set-htb-tokens.test.js: ok")
}

run()
