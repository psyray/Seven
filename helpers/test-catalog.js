/**
 * Test prompt catalog derived from help text and known intent handlers.
 * Single source of truth for smoke / E2E / log analysis scripts.
 */

const strings = require("../static/strings.js")

/** @typedef {"member"|"captain"|"admin"} HelpRole */

/** @type {Record<string, string>} */
const DEFAULT_SAMPLES = {
	boxname: "Lame",
	challengename: "Baby",
	username: "testuser",
	uid: "12345",
	uname: "testuser",
}

/**
 * @param {Record<string, string>} [samples]
 */
function substitutePlaceholders(text, samples = DEFAULT_SAMPLES) {
	return text
		.replace(/_boxname_/g, samples.boxname)
		.replace(/_challengename_/g, samples.challengename)
		.replace(/_username_/g, samples.username)
		.replace(/_uid_/g, samples.uid)
		.replace(/_uname_/g, samples.uname)
		.replace(/_boxname/g, samples.boxname)
		.replace(/_challengename/g, samples.challengename)
		.replace(/_username/g, samples.username)
}

/**
 * @param {HelpRole} [role]
 * @param {Record<string, string>} [samples]
 * @returns {{ id: string, prompt: string, role: HelpRole, source: string }[]}
 */
function buildHelpPromptCatalog(role = "member", samples = DEFAULT_SAMPLES) {
	const help = strings.buildHelpMessages(role, { isUniversity: false }).join("\n")
	const catalog = []
	const lineRx = /^-\s+(?:║\s+)?(?:"([^"]+)"|(.+))/
	let index = 0

	for (const line of help.split("\n")) {
		const match = line.match(lineRx)
		if (!match) continue
		const raw = (match[1] || match[2] || "").trim()
		if (!raw || raw.startsWith("#") || raw.includes("prefix with")) continue
		if (/^(In DMs|Type an HTB|Just type|Works for|Names are|Link your|Achievements|Re-ask|Captains)/i.test(raw)) continue

		const parts = raw.split(/\s*\/\s*/).map(p => p.replace(/^`|`$/g, "").trim()).filter(Boolean)
		for (const part of parts) {
			const prompt = substitutePlaceholders(part, samples)
			if (prompt.length < 3) continue
			catalog.push({
				id: `help-${role}-${++index}`,
				prompt,
				role,
				source: "help",
			})
		}
	}

	const seen = new Set()
	return catalog.filter(entry => {
		const key = entry.prompt.toLowerCase()
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

/**
 * Prompts that must not end on DialogFlow fallback (local intent or DF required).
 * @param {HelpRole} [role]
 */
function buildRunnablePrompts(role = "member") {
	return buildHelpPromptCatalog(role).map(e => e.prompt)
}

/**
 * Prefix added by E2E runner so logs can be sliced per prompt.
 * @param {string} id
 * @param {string} prompt
 */
function smokeTaggedPrompt(id, prompt) {
	return `[SMOKE:${id}] ${prompt}`
}

/** Regex to extract smoke correlation id from log lines or message content. */
const SMOKE_TAG_RX = /\[SMOKE:([^\]]+)\]/

module.exports = {
	DEFAULT_SAMPLES,
	substitutePlaceholders,
	buildHelpPromptCatalog,
	buildRunnablePrompts,
	smokeTaggedPrompt,
	SMOKE_TAG_RX,
}
