/**
 * Shared static phrase → intent mappings for local NLP and smoke tests.
 * @module IntentPhrases
 */

/** Words that must never be treated as HTB usernames in "X info" patterns. */
const TEAM_RESERVED_WORDS = new Set([
	"team", "clk", "university", "leaderboard", "flagboard",
])

/**
 * DialogFlow intents that local "X info" → getMemberInfo must not override.
 */
const DF_PROTECTED_INTENTS = new Set([
	"getTeamInfo",
	"getTeamRanking",
	"getTeamLeaders",
	"getTeamLeader",
	"getTeamBadge",
	"getFlagboard",
	"getTeamActivity",
	"getTargetInfo",
	"getTargetOwners",
	"getMemberRank",
	"getMemberChart",
	"filterMemberOwns",
	"filterTargets",
	"filterMembers",
	"getNewBox",
	"getFirstBox",
	"getTime",
	"admin.forceUpdateData",
	"admin.clearCached",
	"admin.pusherStatus",
	"admin.syncSection",
])

const FILTER_TARGETS = (targettype, sortby, extra = {}) => ({
	intent: "filterTargets",
	parameters: {
		targettype,
		sortby: [sortby],
		sortorder: sortby === "oldest" ? "asc" : "desc",
		limit: 15,
		memberName: [],
		targetFilterBasis: [],
		...extra,
	},
})

const FILTER_MEMBERS = (sortby, sortorder = "desc") => ({
	intent: "filterMembers",
	parameters: {
		targettype: "member",
		sortby: [sortby],
		sortorder,
		limit: 15,
		memberName: [],
		targetFilterBasis: [],
	},
})

/** @type {Record<string, string|{ intent: string, parameters: object }>} */
const STATIC_PHRASE_MAP = {
	"help": "help",
	"man seven": "help",
	"what can you do": "help",
	"team info": "getTeamInfo",
	"clk": "getTeamInfo",
	"who are we": "getTeamInfo",
	"university info": "getTeamInfo",
	"team rank": "getTeamRanking",
	"how are we doing": "getTeamRanking",
	"team leaders": "getTeamLeaders",
	"leaderboard": "getTeamLeaders",
	"who's on top": "getTeamLeader",
	"team leader": "getTeamLeader",
	"flagboard": "getFlagboard",
	"team badge": "getTeamBadge",
	"team activity": "getTeamActivity",
	"university activity": "getTeamActivity",
	"what's new": "getNewBox",
	"what's new?": "getNewBox",
	"what's fresh": "getNewBox",
	"what's fresh?": "getNewBox",
	"first box": "getFirstBox",
	"what time is it": "getTime",
	"what time is it?": "getTime",
	"reboot": "agent.doReboot",
	"clear cache": "admin.clearCached",
	"force update": "admin.forceUpdateData",
	"refresh team data": "admin.forceUpdateData",
	"my stats": { intent: "getMemberInfo", parameters: { username: "i" } },
	"my rank": { intent: "getMemberRank", parameters: { username: "i" } },
	"hardest machines": FILTER_TARGETS("machine", "hardest"),
	"easiest challenges": FILTER_TARGETS("challenge", "easiest"),
	"best rated": FILTER_TARGETS("machine", "best rated"),
	"worst rated": FILTER_TARGETS("machine", "worst rated"),
	"worst rated machines": FILTER_TARGETS("machine", "worst rated"),
	"newest / oldest boxes": FILTER_TARGETS("machine", "newest"),
	"oldest boxes": FILTER_TARGETS("machine", "oldest"),
	"active boxes": FILTER_TARGETS("machine", "newest", { targetFilterBasis: [{ cust: "active" }] }),
	"retired boxes": FILTER_TARGETS("machine", "newest", { targetFilterBasis: [{ cust: "inactive" }] }),
	"linux boxes": FILTER_TARGETS("machine", "newest", { targetFilterBasis: [{ bos: "Linux" }] }),
	"windows boxes": FILTER_TARGETS("machine", "newest", { targetFilterBasis: [{ bos: "Windows" }] }),
	"who has the most roots?": FILTER_MEMBERS("system_owns"),
	"member rankings": FILTER_MEMBERS("points"),
}

/**
 * @param {string} lower - Trimmed lowercase message.
 * @returns {{ intent: string, parameters: object, allRequiredParamsPresent: true }|null}
 */
function resolveStaticPhrase(lower) {
	const entry = STATIC_PHRASE_MAP[lower]
	if (!entry) return null
	if (typeof entry === "string") {
		return { intent: entry, parameters: {}, allRequiredParamsPresent: true }
	}
	return {
		intent: entry.intent,
		parameters: entry.parameters || {},
		allRequiredParamsPresent: true,
	}
}

/**
 * Whether local member-info pattern may override DialogFlow for this intent.
 * @param {string|null|undefined} dfIntent
 * @returns {boolean}
 */
function mayApplyMemberInfoOverride(dfIntent) {
	if (!dfIntent || dfIntent === "Default Fallback Intent") return true
	if (DF_PROTECTED_INTENTS.has(dfIntent)) return false
	if (dfIntent === "getMemberInfo") return true
	return false
}

module.exports = {
	TEAM_RESERVED_WORDS,
	DF_PROTECTED_INTENTS,
	STATIC_PHRASE_MAP,
	FILTER_TARGETS,
	FILTER_MEMBERS,
	resolveStaticPhrase,
	mayApplyMemberInfoOverride,
}
