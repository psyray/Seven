#!/usr/bin/env node
/**
 * Regression: "boxname info" routes to target, not member.
 */

const { resolveLocalIntent } = require("../helpers/nlp.js")
const { SevenDatastore } = require("../models/SevenDatastore.js")
const fs = require("fs")
const path = require("path")

let passed = 0
let failed = 0

function assert(condition, label) {
	if (condition) {
		passed++
		console.log(`  ✓ ${label}`)
	} else {
		failed++
		console.error(`  ✗ ${label}`)
	}
}

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/smoke-cache.json"), "utf8"))
const dat = new SevenDatastore()
dat.MACHINES = fixtures.MACHINES
dat.CHALLENGES = fixtures.CHALLENGES
dat.TEAM_MEMBERS = fixtures.TEAM_MEMBERS
dat.MISC = fixtures.MISC || {}
dat.TEAM_STATS = fixtures.TEAM_STATS || {}

const message = { author: { id: "test", username: "test" } }
const ctx = { dat, message }

const lame = resolveLocalIntent("Lame info", { intent: { displayName: "Default Fallback Intent" } }, {}, ctx)
assert(lame?.intent === "getTargetInfo", "Lame info → getTargetInfo")
assert(lame?.parameters?.targetName === "Lame", "Lame info targetName")

const baby = resolveLocalIntent("Baby info", { intent: { displayName: "Default Fallback Intent" } }, {}, ctx)
assert(baby?.intent === "getTargetInfo", "Baby info → getTargetInfo")
assert(baby?.parameters?.targetType === "challenge", "Baby info is challenge")

const cap = resolveLocalIntent("Cap info", { intent: { displayName: "Default Fallback Intent" } }, {}, ctx)
assert(cap?.intent === "getTargetInfo", "Cap info (uncached) → getTargetInfo on-demand")
assert(cap?.parameters?.targetName === "Cap", "Cap info targetName")

const member = resolveLocalIntent("testuser info", { intent: { displayName: "Default Fallback Intent" } }, {}, ctx)
assert(member?.intent === "getMemberInfo", "testuser info → getMemberInfo")
assert(member?.parameters?.username === "testuser", "testuser info username")

console.log(`\nTarget info routing: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
