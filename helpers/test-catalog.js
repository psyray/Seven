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
 * Split "a / b" help alternatives; avoid orphan fragments like "retire?" or "newest".
 * @param {string} text
 * @returns {string[]}
 */
function splitHelpAlternatives(text) {
	const trimmed = text.trim()
	if (!trimmed.includes("/")) return [trimmed]
	const parts = trimmed.split(/\s*\/\s*/).map(p => p.trim()).filter(Boolean)
	const isFragment = (part) => part.replace(/[?.,!]/g, "").trim().split(/\s+/).length < 2
	if (parts.some(isFragment)) {
		return [trimmed.replace(/\s*\/\s*/g, " / ")]
	}
	return parts
}

/**
 * @param {string} raw
 * @param {Record<string, string>} samples
 * @returns {string[]}
 */
function extractPromptsFromHelpLine(raw, samples = DEFAULT_SAMPLES) {
	const prompts = []
	const quotedRx = /"([^"]+)"/g
	let match
	while ((match = quotedRx.exec(raw)) !== null) {
		for (const part of splitHelpAlternatives(match[1])) {
			const prompt = substitutePlaceholders(part.replace(/^`|`$/g, "").trim(), samples)
			if (prompt.length >= 3) prompts.push(prompt)
		}
	}
	return prompts
}

/**
 * @param {HelpRole} [role]
 * @param {Record<string, string>} [samples]
 * @returns {{ id: string, prompt: string, role: HelpRole, source: string }[]}
 */
function buildHelpPromptCatalog(role = "member", samples = DEFAULT_SAMPLES) {
	const help = strings.buildHelpMessages(role, { isUniversity: false }).join("\n")
	const catalog = []
	const lineRx = /^-\s+(?:║\s+)?(.+)/
	let index = 0

	for (const line of help.split("\n")) {
		const match = line.match(lineRx)
		const headerMatch = !match && line.match(/^#\s+.+"([^"]+)"/)
		const raw = match
			? (match[1] || "").trim()
			: headerMatch
				? headerMatch[1].trim()
				: null
		if (!raw) continue
		if (raw.startsWith("#") || raw.includes("prefix with")) continue
		if (/^(In DMs|Type an HTB|Just type|Works for|Names are|Link your|Achievements|Re-ask|Captains)/i.test(raw)) continue
		if (!/"[^"]+"/.test(raw) && !headerMatch) continue

		const linesToExtract = headerMatch ? [raw] : [raw]
		for (const extractRaw of linesToExtract) {
			const prompts = headerMatch
				? [substitutePlaceholders(extractRaw, samples)].filter(p => p.length >= 3)
				: extractPromptsFromHelpLine(extractRaw, samples)
			for (const prompt of prompts) {
				catalog.push({
					id: `help-${role}-${++index}`,
					prompt,
					role,
					source: "help",
				})
			}
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
	splitHelpAlternatives,
	extractPromptsFromHelpLine,
	buildHelpPromptCatalog,
	buildRunnablePrompts,
	smokeTaggedPrompt,
	SMOKE_TAG_RX,
}
