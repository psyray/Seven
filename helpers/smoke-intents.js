/**
 * Offline intent resolution for handler smoke tests (no DialogFlow).
 */

const { resolveLocalIntent, extractTargetNameFromMessage } = require("./nlp.js")
const { STATIC_PHRASE_MAP } = require("./intent-phrases.js")

const SKIP_RX = [
	/parrot on|parrot off|setup emoji|clear emoji|set status/i,
	/forget|unlink|blacklist|remember me|unforget|purge data|stop tracking/i,
	/^(In DMs|Type an HTB|Just type|Works for|Names are|Link your|Achievements|Re-ask|Captains)/i,
	/Fortress, Endgame|Ask for info on any cached special/i,
	/Bugs or ideas/i,
]

/** @returns {"skip"|"run"|"df-only"} */
function classifySmokePrompt(prompt) {
	if (SKIP_RX.some(rx => rx.test(prompt))) return "skip"
	return "run"
}

function resolveTargetInfo(dat, message, targetName, targetType = null) {
	const resolved = dat.resolveEnt(targetName, targetType, false, message, false)
	const type = targetType || resolved?.type || "machine"
	return {
		intent: "getTargetInfo",
		parameters: { targetType: type, targetName: resolved?.name || targetName },
		route: "pattern",
	}
}

/**
 * @param {string} prompt
 * @param {import("../models/SevenDatastore.js").SevenDatastore} dat
 * @param {object} message
 * @returns {{ intent: string, parameters: object, route: string }|null}
 */
function resolveSmokeIntent(prompt, dat, message) {
	const text = (prompt || "").trim()
	const lower = text.toLowerCase()

	if (lower === "help" || lower === "man seven" || lower === "what can you do") {
		return { intent: "help", parameters: {}, route: "static" }
	}

	if (lower === "my stats" || lower === "my rank") {
		const entry = STATIC_PHRASE_MAP[lower]
		if (entry && typeof entry !== "string") {
			return { intent: entry.intent, parameters: entry.parameters, route: "static" }
		}
	}

	const staticEntry = STATIC_PHRASE_MAP[lower]
	if (staticEntry) {
		if (typeof staticEntry === "string") {
			return { intent: staticEntry, parameters: {}, route: "static" }
		}
		return {
			intent: staticEntry.intent,
			parameters: staticEntry.parameters || {},
			route: "static",
		}
	}

	if (lower === "who is testuser") {
		return { intent: "getMemberInfo", parameters: { username: "testuser" }, route: "static" }
	}

	const local = resolveLocalIntent(text, null, null, { dat, message })
	if (local) return { intent: local.intent, parameters: local.parameters, route: "local" }

	const htbItem = dat.resolveEnt(text, null, null, message, false)
	if (htbItem) {
		return {
			intent: "resolveEnt",
			parameters: { type: htbItem.type, name: htbItem.name, target: htbItem },
			route: "entity",
		}
	}

	const memberInfo = lower.match(/^(?:who is\s+)?(.+?)\s+(?:info|profile)$/)
	if (memberInfo && !memberInfo[1].includes(" ") && !["team", "clk", "university"].includes(memberInfo[1])) {
		return { intent: "getMemberInfo", parameters: { username: memberInfo[1] }, route: "pattern" }
	}

	const memberRank = lower.match(/^(.+?)\s+rank$/) || (lower === "what rank am i?" ? ["", "i"] : null)
	if (memberRank) {
		const username = memberRank[1] === "i" || lower.includes("am i") ? "i" : memberRank[1]
		return { intent: "getMemberRank", parameters: { username }, route: "pattern" }
	}

	const memberChart = lower.match(/^(.+?)\s+chart$/)
	if (memberChart) {
		return { intent: "getMemberChart", parameters: { username: memberChart[1], interval: "1Y" }, route: "pattern" }
	}

	const memberChartInterval = lower.match(/^(.+?)\s+progress over (.+)$/)
	if (memberChartInterval) {
		const { normalizeChartTerm } = require("./chart-term.js")
		return {
			intent: "getMemberChart",
			parameters: {
				username: memberChartInterval[1],
				interval: normalizeChartTerm(memberChartInterval[2]),
			},
			route: "pattern",
		}
	}

	const whenLive = lower.match(/^when did\s+(.+?)\s+go live(?:\s*\/\s*retire)?\??$/)
	if (whenLive) return resolveTargetInfo(dat, message, whenLive[1].trim())

	const howHard = lower.match(/^how hard is\s+(.+?)\??$/)
	if (howHard) return resolveTargetInfo(dat, message, howHard[1].trim())

	const howManyBoxes = lower.match(/^how many boxes has\s+(.+?)\s+owned\??$/)
	if (howManyBoxes) {
		return {
			intent: "getMemberInfo",
			parameters: { username: howManyBoxes[1].trim() },
			route: "pattern",
		}
	}

	const whenJoin = lower.match(/^when did\s+(.+?)\s+join htb\??$/)
	if (whenJoin) {
		return {
			intent: "getMemberInfo",
			parameters: { username: whenJoin[1].trim() },
			route: "pattern",
		}
	}

	if (/^who started the (?:team|university)\??$/.test(lower) || lower === "clk founder" || lower === "clk admin") {
		const captainId = dat.TEAM_STATS?.captain?.id
		const captain = captainId ? dat.getMemberById(captainId) : null
		if (captain) {
			return {
				intent: "getMemberInfo",
				parameters: { username: captain.name },
				route: "pattern",
			}
		}
	}

	const incompleteChallenges = lower.match(/^incomplete challenges for\s+(.+)$/)
	if (incompleteChallenges) {
		return {
			intent: "filterTargets",
			parameters: {
				targettype: "challenge",
				sortby: ["newest"],
				sortorder: "desc",
				limit: 15,
				memberName: [incompleteChallenges[1].trim()],
				targetFilterBasis: [{ cust: "incomplete" }],
			},
			route: "pattern",
		}
	}

	const incompleteBoxes = lower.match(/^boxes\s+(.+?)\s+hasn't finished$/)
	if (incompleteBoxes) {
		return {
			intent: "filterTargets",
			parameters: {
				targettype: "machine",
				sortby: ["newest"],
				sortorder: "desc",
				limit: 15,
				memberName: [incompleteBoxes[1].trim()],
				targetFilterBasis: [{ cust: "incomplete" }],
			},
			route: "pattern",
		}
	}

	const linkUid = lower.match(/^i am (\d+) on htb$/)
	if (linkUid) {
		return { intent: "linkDiscord", parameters: { uid: linkUid[1] }, route: "pattern" }
	}

	const linkUname = lower.match(/^my htb username is\s+(.+)$/)
	if (linkUname) {
		return { intent: "linkDiscord", parameters: { username: linkUname[1].trim() }, route: "pattern" }
	}

	const whoOwned = lower.match(/^who (?:did|rooted|solved)\s+(.+?)(?:\s+(last|first))?\??$/)
	if (whoOwned) {
		const target = dat.resolveEnt(whoOwned[1].trim(), null, null, message, false)
		return {
			intent: "getTargetOwners",
			parameters: {
				target: whoOwned[1].trim(),
				htbTargetType: target?.type,
				ownFilter: whoOwned[2] || null,
			},
			route: "pattern",
		}
	}

	const hasOwned = lower.match(/^has\s+(.+?)\s+rooted\s+(.+?)\??$/)
	if (hasOwned) {
		return {
			intent: "checkMemberOwnedTarget",
			parameters: { username: hasOwned[1].trim(), targetname: hasOwned[2].trim(), targettype: "machine", flagNames: [] },
			route: "pattern",
		}
	}

	const didSolve = lower.match(/^did\s+(.+?)\s+solve\s+(.+?)\??$/)
	if (didSolve) {
		return {
			intent: "checkMemberOwnedTarget",
			parameters: { username: didSolve[1].trim(), targetname: didSolve[2].trim(), targettype: "challenge", flagNames: [] },
			route: "pattern",
		}
	}

	const activityMachine = lower.match(/^what boxes has\s+(.+?)\s+owned\??$/)
	if (activityMachine) {
		return {
			intent: "filterMemberOwns",
			parameters: { username: activityMachine[1].trim(), targettype: "machine", limit: 24 },
			route: "pattern",
		}
	}

	const activityChallenge = lower.match(/^what challenges did\s+(.+?)\s+do\??$/)
	if (activityChallenge) {
		return {
			intent: "filterMemberOwns",
			parameters: { username: activityChallenge[1].trim(), targettype: "challenge", limit: 24 },
			route: "pattern",
		}
	}

	const showActivity = lower.match(/^show\s+(.+?)\s+activity\??$/)
	if (showActivity) {
		return {
			intent: "filterMemberOwns",
			parameters: { username: showActivity[1].trim(), limit: 24 },
			route: "pattern",
		}
	}

	const boxInfo = lower.match(/^(?:box|machine)\s+(.+?)\s+info$/)
	if (boxInfo) {
		return {
			intent: "getTargetInfo",
			parameters: { targetType: "machine", targetName: boxInfo[1].trim() },
			route: "pattern",
		}
	}

	const challengeInfo = lower.match(/^(.+?)\s+info$/)
	if (challengeInfo && dat.resolveEnt(challengeInfo[1].trim(), "challenge", false, message)) {
		return {
			intent: "getTargetInfo",
			parameters: { targetType: "challenge", targetName: challengeInfo[1].trim() },
			route: "pattern",
		}
	}

	const targetInfoName = extractTargetNameFromMessage(text, "machine")
	if (lower.endsWith(" info") && targetInfoName) {
		return {
			intent: "getTargetInfo",
			parameters: { targetType: "machine", targetName: targetInfoName },
			route: "pattern",
		}
	}

	return null
}

module.exports = {
	classifySmokePrompt,
	resolveSmokeIntent,
}
