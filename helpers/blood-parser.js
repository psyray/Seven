/**
 * Resolves the HTB target mentioned in a socket `blood-created` message.
 *
 * HTB publishes first bloods on the `general` channel as `{ message, userId }`,
 * where `message` is a human string mentioning the machine/challenge name.
 * The in-memory catalog is used to identify the entity, so no extra API call
 * is needed. Ambiguous messages (no catalog match, or a machine blood without
 * a user/root flag) return null: the caller then leaves the announcement to the
 * team activity fallback, which carries structured fields.
 * @module Blood-Parser
 */

const FLAG_RE = /\b(root|system|user)\b/i

function escapeRegExp (value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeMessage (raw) {
	return String(raw ?? "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/gi, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * @param {string} rawMessage - Raw `blood-created` message payload.
 * @param {{ machines?: Object<string, {name: string}>, challenges?: Object<string, {name: string}> }} catalog
 * @returns {{ type: "machine"|"challenge", target: string, flag: "user"|"root"|"challenge" }|null}
 */
function resolveBloodTarget (rawMessage, catalog = {}) {
	const text = normalizeMessage(rawMessage)
	if (!text) return null
	const haystack = text.toLowerCase()
	const candidates = []

	const collect = (entities, type) => {
		for (const entity of Object.values(entities || {})) {
			const name = String(entity?.name || "").trim()
			if (name.length < 3) continue
			const pattern = new RegExp(
				`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}([^a-z0-9]|$)`,
				"i"
			)
			if (!pattern.test(haystack)) continue
			candidates.push({ type, target: entity.name, length: name.length })
		}
	}

	collect(catalog.machines, "machine")
	collect(catalog.challenges, "challenge")
	if (!candidates.length) return null

	// Prefer the longest name so "Facts" wins over a shorter prefix match.
	candidates.sort((a, b) => b.length - a.length)
	const best = candidates[0]
	if (best.type === "challenge") {
		return { type: "challenge", target: best.target, flag: "challenge" }
	}

	const flagMatch = text.match(FLAG_RE)
	if (!flagMatch) return null
	const flag = flagMatch[1].toLowerCase()
	return { type: "machine", target: best.target, flag: flag === "system" ? "root" : flag }
}

module.exports = {
	resolveBloodTarget,
	normalizeMessage,
}
