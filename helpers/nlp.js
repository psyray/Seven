/**
 * Contains Natural Language Processing functionality to make Seven a little smarter! 😸
 @module Nlp
*/

const {
	TEAM_RESERVED_WORDS,
	resolveStaticPhrase,
	mayApplyMemberInfoOverride,
} = require("./intent-phrases.js")

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

function normalizeFilterBasis(raw) {
	if (!raw) return []
	if (Array.isArray(raw)) return raw.filter(Boolean)
	if (typeof raw === "object") return Object.values(raw).filter(Boolean)
	return []
}

const HTB_ACCESS_JWT_PAIR_RE = /^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s+(\S+)$/
const HTB_TOKEN_SET_CMD_RE = /^(?:seven[\s\t]+)?(?:htb\s+token\s+set|set\s+htb\s+tokens)\s+/i

/** HTB OAuth refresh tokens are ~700+ chars — do not apply the 255-char DialogFlow trim. */
function shouldPreserveFullMessageContent(content) {
	if (!content) return false
	return HTB_TOKEN_SET_CMD_RE.test(content.trim())
}

function trimMessageContentForHandler(content) {
	if (!content) return content
	if (shouldPreserveFullMessageContent(content)) {
		return content.length > 2000 ? content.substring(0, 2000) : content
	}
	return content.substring(0, 255)
}

/** Long OAuth paste commands must not go through DialogFlow (256-char input limit). */
function resolveLocalIntentWithoutDialogFlow(content) {
	if (!shouldPreserveFullMessageContent(content)) return null
	const local = resolveLocalIntent(content, null, null)
	if (!local?.allRequiredParamsPresent) return null
	return local
}

/**
 * Parse `htb token set …` (access+refresh pair or refresh-only) including multiline paste and markdown wrappers.
 * Legacy alias: `set htb tokens …` (pair only).
 * @param {string} content
 * @returns {{ mode: "pair"|"refresh", htbAccessToken?: string, htbRefreshToken: string }|null}
 */
function parseHtbTokenSetCommand(content) {
	if (!content) return null
	const stripped = content.trim().replace(/[`'"]/g, "")
	let headerMatch = stripped.match(/^htb\s+token\s+set\s+([\s\S]+)$/i)
	if (!headerMatch) {
		headerMatch = stripped.match(/^set\s+htb\s+tokens\s+([\s\S]+)$/i)
	}
	if (!headerMatch) return null

	const rest = headerMatch[1].replace(/\s+/g, " ").trim()
	if (!rest) return null

	const jwtMatch = rest.match(HTB_ACCESS_JWT_PAIR_RE)
	if (jwtMatch) {
		return {
			mode: "pair",
			htbAccessToken: jwtMatch[1],
			htbRefreshToken: jwtMatch[2],
		}
	}

	return {
		mode: "refresh",
		htbRefreshToken: rest,
	}
}

/** @deprecated Use parseHtbTokenSetCommand */
function parseSetHtbTokensCommand(content) {
	const parsed = parseHtbTokenSetCommand(content)
	if (!parsed || parsed.mode !== "pair") return null
	return {
		htbAccessToken: parsed.htbAccessToken,
		htbRefreshToken: parsed.htbRefreshToken,
	}
}

const TARGET_INFO_TYPES = ["machine", "challenge", "fortress", "endgame", "prolab"]

/**
 * Resolve "name info" using HTB cache: target types before members.
 * @param {string} name
 * @param {import("../models/SevenDatastore.js").SevenDatastore|null} [dat]
 * @param {object|null} [message]
 * @returns {{ intent: string, parameters: object, allRequiredParamsPresent: true }|null}
 */
function resolveCachedNameInfoIntent(name, dat, message) {
	if (!dat || !name) return null
	for (const type of TARGET_INFO_TYPES) {
		const ent = dat.resolveEnt(name, type, false, message, false)
		if (ent) {
			return {
				intent: "getTargetInfo",
				parameters: { targetType: ent.type || type, targetName: ent.name || name },
				allRequiredParamsPresent: true,
			}
		}
	}
	const member = dat.resolveEnt(name, "member", false, message, false)
	if (member) {
		return {
			intent: "getMemberInfo",
			parameters: { username: member.name || name },
			allRequiredParamsPresent: true,
		}
	}
	return null
}

/**
 * @param {string} name
 * @param {import("../models/SevenDatastore.js").SevenDatastore|null} [dat]
 * @param {object|null} [message]
 * @returns {{ intent: string, parameters: object, allRequiredParamsPresent: true }}
 */
function resolveNameInfoIntent(name, dat, message) {
	const cached = resolveCachedNameInfoIntent(name, dat, message)
	if (cached) return cached
	return {
		intent: "getTargetInfo",
		parameters: { targetType: "machine", targetName: name },
		allRequiredParamsPresent: true,
	}
}

/**
 * @param {string} content - Raw user message (after "seven" prefix removal).
 * @param {{ intent?: { displayName?: string } }|null} [dfResult]
 * @param {object} [decodedParams] - DialogFlow parameters after struct.decode()
 * @param {{ dat?: import("../models/SevenDatastore.js").SevenDatastore, message?: object }} [context]
 * @returns {{ intent: string, parameters: object, allRequiredParamsPresent: true }|null}
 */
function resolveLocalIntent(content, dfResult = null, decodedParams = null, context = null) {
	if (!content) return null
	const text = content.trim()
	const lower = text.toLowerCase()
	const dat = context?.dat
	const message = context?.message

	const dfIntent = dfResult?.intent?.displayName
	const dfParams = decodedParams || {}

	const staticPhrase = resolveStaticPhrase(lower)
	if (staticPhrase) return staticPhrase

	if (dfIntent === "getMemberInfo") {
		const dfName = dfParams.username || dfParams.memberName
		if (dfName && !checkSelfName(dfName)) {
			const corrected = resolveCachedNameInfoIntent(String(dfName), dat, message)
			if (corrected?.intent === "getTargetInfo") return corrected
		}
	}

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

	const memberInfoMatch = text.match(/^(.+?)\s+(?:info|details|information|profile)\s*$/i)
	if (memberInfoMatch && !/\s/.test(memberInfoMatch[1]) && mayApplyMemberInfoOverride(dfIntent)) {
		const username = memberInfoMatch[1].trim()
		if (
			!checkSelfName(username)
			&& !FILLER_WORDS.has(username)
			&& !TEAM_RESERVED_WORDS.has(username)
		) {
			return resolveNameInfoIntent(username, dat, message)
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

	const htbTokenSet = parseHtbTokenSetCommand(text)
	if (htbTokenSet) {
		return {
			intent: "admin.htbTokenSet",
			parameters: htbTokenSet,
			allRequiredParamsPresent: true,
		}
	}

	if (/^htb\s+token\s+refresh\s*$/i.test(lower)) {
		return {
			intent: "admin.htbTokenRefresh",
			parameters: {},
			allRequiredParamsPresent: true,
		}
	}

	if (/^htb\s+token\s+status\s*$/i.test(lower) || /^htb\s+tokens\s+status\s*$/i.test(lower) || /^token\s+status\s*$/i.test(lower)) {
		return {
			intent: "admin.htbTokenStatus",
			parameters: {},
			allRequiredParamsPresent: true,
		}
	}

	if (/^pusher\s+status\s*$/i.test(lower)) {
		return {
			intent: "admin.pusherStatus",
			parameters: {},
			allRequiredParamsPresent: true,
		}
	}

	const pusherHistoryMatch = text.match(/^pusher\s+history(?:\s+(\S+))?\s*$/i)
	if (pusherHistoryMatch) {
		return {
			intent: "captain.pusherHistory",
			parameters: { memberFilter: pusherHistoryMatch[1] || null },
			allRequiredParamsPresent: true,
		}
	}

	const pusherRepostMatch = text.match(/^pusher\s+repost\s+(last|\d+)\s*$/i)
	if (pusherRepostMatch) {
		const target = pusherRepostMatch[1].toLowerCase()
		return {
			intent: "captain.pusherRepost",
			parameters: {
				eventId: target === "last" ? null : Number(target),
				useLast: target === "last",
			},
			allRequiredParamsPresent: true,
		}
	}

	const syncSectionMatch = lower.match(/^sync\s+(machines?|challenges?|fortresses?|endgames?|pro\s*labs?|prolabs?|specials?|all)\s*$/)
	if (syncSectionMatch) {
		return {
			intent: "admin.syncSection",
			parameters: { section: syncSectionMatch[1].replace(/\s+/g, " ").trim() },
			allRequiredParamsPresent: true,
		}
	}

	const listTargetsMatch = lower.match(
		/^list(?:\s+all)?\s+(fortresses?|endgames?|pro\s*labs?|prolabs?|machines?|boxes?|challenges?)\s*$/
	)
	if (listTargetsMatch) {
		const typeKey = listTargetsMatch[1].replace(/\s+/g, "")
		const listTypeAliases = {
			fortress: "fortress",
			fortresses: "fortress",
			endgame: "endgame",
			endgames: "endgame",
			prolab: "prolab",
			prolabs: "prolab",
			machine: "machine",
			machines: "machine",
			box: "machine",
			boxes: "machine",
			challenge: "challenge",
			challenges: "challenge",
		}
		const wantsAll = /\ball\b/.test(lower)
		const targettype = listTypeAliases[typeKey] || TARGET_TYPE_ALIASES[typeKey] || typeKey
		const isCatalogSpecial = ["fortress", "endgame", "prolab"].includes(targettype)
		const dfBasis = normalizeFilterBasis(dfParams.targetFilterBasis)
		let targetFilterBasis = []
		if (targettype === "prolab") {
			targetFilterBasis = [
				{ cust: "nolimit" },
				...(dfBasis.length ? dfBasis : [{ blang: "Active Directory" }]),
			]
		} else if (wantsAll) {
			targetFilterBasis = [{ cust: "nolimit" }]
		}
		return {
			intent: "filterTargets",
			parameters: {
				targettype,
				sortby: isCatalogSpecial ? ["id"] : [],
				sortorder: isCatalogSpecial ? "asc" : "",
				limit: (wantsAll || targettype === "prolab") ? 0 : 15,
				memberName: [],
				targetFilterBasis,
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
	parseHtbTokenSetCommand,
	parseSetHtbTokensCommand,
	shouldPreserveFullMessageContent,
	trimMessageContentForHandler,
	resolveLocalIntentWithoutDialogFlow,
	resolveCachedNameInfoIntent,
	resolveNameInfoIntent,
	resolveLocalIntent,
}
