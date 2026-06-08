/**
 * Contains Natural Language Processing functionality to make Seven a little smarter! 😸
 @module Nlp
*/

const FILLER_WORDS = new Set([
	"box", "boxes", "machine", "machines", "challenge", "challenges",
	"info", "information", "details", "about", "the", "a", "an",
	"fortress", "endgame", "prolab", "pro", "lab", "htb", "hackthebox",
	"tell", "me", "show", "give", "what", "is", "who", "whats", "what's",
	"on", "for", "of", "please", "can", "you", "i", "want", "need",
])

const TARGET_TYPE_ALIASES = {
	box: "machine",
	boxes: "machine",
	machine: "machine",
	machines: "machine",
	challenge: "challenge",
	challenges: "challenge",
}

const SORT_ALIASES = {
	newest: "newest",
	latest: "newest",
	fresh: "newest",
	oldest: "oldest",
	hardest: "hardest",
	hard: "hardest",
	easiest: "easiest",
	easy: "easiest",
	"best rated": "best rated",
	"worst rated": "worst rated",
}

/**
 * Check whether the NLP-recognized 'name' is actually a self descriptor.
 * @param {string} name - The recognized 'name'.
 * @returns {boolean}
 */
function checkSelfName(name) {
	return ((["i", "me", "my", "mine", "i'm", "i've", "myself"].includes(name.toString().toLowerCase())) ? true : false)
}

/**
 * Strip conversational filler words and return a likely HTB entity name.
 * @param {string} content
 * @param {string|null} [targetType]
 * @returns {string}
 */
function extractTargetNameFromMessage(content, targetType = null) {
	if (!content) return ""
	const typeHints = targetType === "machine"
		? ["box", "boxes", "machine", "machines"]
		: targetType === "challenge"
			? ["challenge", "challenges"]
			: []

	const tokens = content.toLowerCase()
		.replace(/[^\w\s'-]/g, " ")
		.split(/\s+/)
		.filter(t => t && !FILLER_WORDS.has(t) && !typeHints.includes(t))

	return tokens.join(" ").trim()
}

/**
 * Resolve a local intent when DialogFlow misses or returns incomplete parameters.
 * @param {string} content - Raw user message (after "seven" prefix removal).
 * @param {{ intent?: { displayName?: string } }|null} [dfResult]
 * @param {object} [decodedParams] - DialogFlow parameters after struct.decode()
 * @returns {{ intent: string, parameters: object, allRequiredParamsPresent: true }|null}
 */
function resolveLocalIntent(content, dfResult = null, decodedParams = null) {
	if (!content) return null
	const text = content.trim()
	const lower = text.toLowerCase()

	const dfIntent = dfResult?.intent?.displayName
	const dfParams = decodedParams || {}

	if (dfIntent === "getTargetInfo" && dfParams.targetType && !dfParams.targetName) {
		const targetName = extractTargetNameFromMessage(text, dfParams.targetType)
		if (targetName) {
			return {
				intent: "getTargetInfo",
				parameters: { targetType: dfParams.targetType, targetName },
				allRequiredParamsPresent: true,
			}
		}
	}

	const targetInfoMatch = lower.match(
		/^(?:box|machine|challenge)\s+(.+?)\s+(?:info|details|information)\s*$/
	)
	if (targetInfoMatch) {
		const typeWord = lower.split(/\s+/)[0]
		return {
			intent: "getTargetInfo",
			parameters: {
				targetType: TARGET_TYPE_ALIASES[typeWord] || "machine",
				targetName: targetInfoMatch[1].trim(),
			},
			allRequiredParamsPresent: true,
		}
	}

	const memberInfoMatch = lower.match(/^(.+?)\s+(?:info|details|information|profile)\s*$/)
	if (memberInfoMatch && !memberInfoMatch[1].includes(" ")) {
		const username = memberInfoMatch[1].trim()
		if (!checkSelfName(username) && !FILLER_WORDS.has(username)) {
			return {
				intent: "getMemberInfo",
				parameters: { username },
				allRequiredParamsPresent: true,
			}
		}
	}

	const filterMatch = lower.match(
		/^(?:give me |show me |list |get )?(?:the )?(?:(\d+)\s+)?(newest|latest|fresh|oldest|hardest|hard|easiest|easy|best rated|worst rated)\s+(?:(\d+)\s+)?(boxes|box|machines|machine|challenges|challenge)\s*$/
	)
	if (filterMatch) {
		const limit = Number(filterMatch[1] || filterMatch[3] || 15)
		const sortKey = SORT_ALIASES[filterMatch[2]] || "newest"
		const targetType = TARGET_TYPE_ALIASES[filterMatch[4].replace(/s$/, "")] || "machine"
		return {
			intent: "filterTargets",
			parameters: {
				targettype: targetType,
				sortby: [sortKey],
				sortorder: sortKey === "oldest" ? "asc" : "desc",
				limit,
				memberName: [],
				targetFilterBasis: [],
			},
			allRequiredParamsPresent: true,
		}
	}

	const compactFilterMatch = lower.match(
		/^(?:(\d+)\s+)?(newest|latest|oldest|hardest|easiest)\s+(boxes|machines|challenges)\s*$/
	)
	if (compactFilterMatch) {
		const limit = Number(compactFilterMatch[1] || 15)
		const sortKey = SORT_ALIASES[compactFilterMatch[2]] || "newest"
		const targetType = TARGET_TYPE_ALIASES[compactFilterMatch[3].replace(/s$/, "")] || "machine"
		return {
			intent: "filterTargets",
			parameters: {
				targettype: targetType,
				sortby: [sortKey],
				sortorder: sortKey === "oldest" ? "asc" : "desc",
				limit,
				memberName: [],
				targetFilterBasis: [],
			},
			allRequiredParamsPresent: true,
		}
	}

	const teamLeaderPhrases = [
		/who(?:'s| is)\s+(?:the\s+)?(?:number\s*|#\s*|no\.?\s*)?1(?:\s+(?:on|of|in)\s+(?:the\s+)?team)?/,
		/who(?:'s| is)\s+on\s+top/,
		/qui\s+est\s+(?:le\s+)?(?:num[eé]ro|n°|#)\s*1/,
		/(?:num[eé]ro|n°|#)\s*1\s+(?:de\s+la\s+)?(?:team|équipe)/,
	]
	if (teamLeaderPhrases.some(rx => rx.test(lower))) {
		return {
			intent: "getTeamLeader",
			parameters: {},
			allRequiredParamsPresent: true,
		}
	}

	if (dfIntent === "Default Fallback Intent" || !dfIntent) {
		const newestBoxPhrases = [
			/^what(?:'s| is)\s+new\??$/,
			/^what(?:'s| is)\s+fresh\??$/,
			/^newest\s+box\??$/,
		]
		if (newestBoxPhrases.some(rx => rx.test(lower))) {
			return {
				intent: "getNewBox",
				parameters: {},
				allRequiredParamsPresent: true,
			}
		}
	}

	return null
}

module.exports = {
	checkSelfName,
	extractTargetNameFromMessage,
	resolveLocalIntent,
}
