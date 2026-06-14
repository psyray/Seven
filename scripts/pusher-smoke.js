#!/usr/bin/env node
/**
 * Smoke tests for HTB Pusher HTML parsing.
 * Usage: npm run test:pusher
 */
const path = require("path")
const { parsePusherEvent } = require("../helpers/pusher-htb")

const samples = require(path.join(__dirname, "../cache/PUSHER_SAMPLE_EVENTS.json"))

let passed = 0
let failed = 0

function assertEqual(actual, expected, label) {
	const keys = Object.keys(expected)
	for (const key of keys) {
		if (actual[key] !== expected[key]) {
			console.error(`FAIL: ${label} — expected ${key}=${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`)
			failed++
			return
		}
	}
	console.log(`OK: ${label}`)
	passed++
}

for (const sample of samples) {
	const event = parsePusherEvent(sample.data, {
		channel: sample.channel,
		event: sample.event,
	})
	assertEqual(event, sample.expect, sample.label)
}

console.log(`\nPusher parser smoke: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
