const assert = require("assert")
const { HtbApiConnector } = require("../modules/htb-api.js")
const { resolveLocalIntent } = require("../helpers/nlp.js")
const { HtbEmbeds } = require("../views/embeds.js")

function b64url(value) {
	return Buffer.from(JSON.stringify(value)).toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")
}

function makeJwt(payload) {
	return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`
}

function testLocalIntent() {
	const intent = resolveLocalIntent("htb token status", null, null)
	assert.strictEqual(intent?.intent, "admin.htbTokenStatus")
	assert.strictEqual(intent?.allRequiredParamsPresent, true)

	const alias = resolveLocalIntent("token status", null, null)
	assert.strictEqual(alias?.intent, "admin.htbTokenStatus")

	const refreshCmd = resolveLocalIntent("htb token refresh", null, null)
	assert.strictEqual(refreshCmd?.intent, "admin.htbTokenRefresh")

	const refreshSet = resolveLocalIntent("htb token set def50200refresh", null, null)
	assert.strictEqual(refreshSet?.intent, "admin.htbTokenSet")
	assert.strictEqual(refreshSet?.parameters?.mode, "refresh")
}

function testOAuthTokenStatus() {
	const api = new HtbApiConnector()
	const exp = Math.floor(Date.now() / 1000) + 7200
	api.API_TOKEN = makeJwt({ exp, sub: "1" })
	api.REFRESH_TOKEN = "refresh-token-value"

	const status = api.getOAuthTokenStatus()
	assert.strictEqual(status.hasAccessToken, true)
	assert.strictEqual(status.hasRefreshToken, true)
	assert.strictEqual(status.expired, false)
	assert.strictEqual(status.expiringSoon, false)
	assert.ok(status.accessExpiresAtUtc)
	assert.ok(status.msUntilExpiry > 0)
}

function testEmbed() {
	const embeds = new HtbEmbeds({ TEAM_STATS: {} }, { of: () => "" })
	const embed = embeds.htbTokenStatus({
		authMode: "oauth_refresh",
		hasAccessToken: true,
		hasRefreshToken: true,
		accessExpiresAtUtc: "Fri, 20 Jun 2026 12:00:00 GMT",
		msUntilExpiry: 3600000,
		expired: false,
		expiringSoon: false,
		expiryBufferSec: 120,
		persistenceSource: "environment",
	})
	assert.ok(embed.description?.includes("Access expires:"))
	assert.ok(embed.description?.includes("Time remaining:"))
}

testLocalIntent()
testOAuthTokenStatus()
testEmbed()
console.log("htb-token-status.test.js OK")
