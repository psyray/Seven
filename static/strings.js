/** Discord message body limit (leave room for code fence). */
const DISCORD_BODY_LIMIT = 1980

const HELP_HEADER = "**  user@clk:-$ man seven_ **"

/**
 * @typedef {"member"|"captain"|"admin"} HelpRole
 */

/**
 * @param {HelpRole} role
 * @param {{ isUniversity?: boolean }} [options]
 * @returns {string[]}
 */
function buildHelpMessages(role = "member", options = {}) {
	const teamLabel = options.isUniversity ? "university" : "team"
	const sections = [
		sectionIntro(teamLabel),
		sectionTargets(),
		sectionOwnership(),
		sectionMembers(),
		sectionTeam(teamLabel),
		sectionFilters(),
		sectionPrivacy(),
		sectionFun(),
	]

	if (role === "captain" || role === "admin") {
		sections.push(sectionCaptain())
	}
	if (role === "admin") {
		sections.push(sectionAdmin())
	}

	sections.push(sectionTips(role))
	sections.push(sectionFeedback())

	return packHelpSections(sections, role)
}

/**
 * @param {string[]} sections
 * @param {HelpRole} role
 * @returns {string[]}
 */
function packHelpSections(sections, role) {
	const roleBadge = role === "admin"
		? "# [ADMIN] Extended manual — all commands below are available to you.\n"
		: role === "captain"
			? "# [CAPTAIN] Extended manual — includes maintenance commands.\n"
			: ""

	const messages = []
	let current = roleBadge

	for (const section of sections) {
		const candidate = current ? `${current}\n${section}` : section
		if (wrapMarkdown(candidate).length > DISCORD_BODY_LIMIT && current.trim()) {
			messages.push(wrapMarkdown(current.trimEnd()))
			current = section
		} else {
			current = candidate
		}
	}

	if (current.trim()) {
		const body = messages.length === 0
			? `${HELP_HEADER}\n\n${current.trimEnd()}`
			: current.trimEnd()
		messages.push(wrapMarkdown(body))
	}

	if (messages.length && !messages[0].includes(HELP_HEADER)) {
		messages[0] = wrapMarkdown(
			`${HELP_HEADER}\n\n${unwrapMarkdown(messages[0])}`
		)
	}

	return messages
}

/** @param {string} body */
function wrapMarkdown(body) {
	return `\`\`\`markdown\n${body}\n\`\`\``
}

/** @param {string} message */
function unwrapMarkdown(message) {
	return message.replace(/^```markdown\n/, "").replace(/\n```$/, "")
}

function sectionIntro(teamLabel) {
	return `_______  GETTING STARTED  _______

# How to talk to Seven
- In server channels, prefix with "seven" (e.g. "seven help", "seven team info").
- In DMs, no prefix needed — just "help", "team info", etc.
- Type an HTB name directly for a quick info card (machine, challenge, member…).

# Natural language
Seven uses AI (DialogFlow) and understands many phrasings.
If a query fails, reword it or try the examples below.

# Quick triggers
- "help" / "man seven" / "what can you do"
- "what's new" — latest unreleased machine
- Just type a box or member name`
}

function sectionTargets() {
	return `_______  HTB TARGETS  _______

══╗
# ║ Machines (active & retired)
- ║   "_boxname_" or "_boxname_ info"
- ║   "When did _boxname_ go live / retire?"
- ║   "How hard is _boxname_?"
# ║ Challenges
- ║   "_challengename_" / "_challengename_ info"
# ║ Special content
- ║   Fortress, Endgame, Pro Lab names work the same way.
- ║   Ask for info on any cached special target by name.
# ║ Newest content
- ║   "What's new?" / "What's fresh?" — latest machine
- ║   "First box" — classic Lame easter egg
══╝`
}

function sectionOwnership() {
	return `_______  OWNERSHIP  _______

══╗
# ║ Who owned a target (team)
- ║   "Who did _boxname_?"
- ║   "Who rooted _boxname_?"
- ║   "Who rooted _boxname_ last / first?"
- ║   "Who solved _challengename_?"
# ║ Did a member own something?
- ║   "Has _username_ rooted _boxname_?"
- ║   "Did _username_ solve _challengename_?"
- ║   Works for user/root flags and challenge solves.
# ║ Member activity timeline
- ║   "What boxes has _username_ owned?"
- ║   "What challenges did _username_ do?"
- ║   "Show _username_ activity" — chart + recent owns
══╝`
}

function sectionMembers() {
	return `_______  MEMBERS  _______

══╗
# ║ Profile & stats
- ║   "_username_ info" / "who is _username_"
- ║   "What rank am I?" / "_username_ rank"
- ║   "How many boxes has _username_ owned?"
- ║   "When did _username_ join HTB?"
# ║ Charts
- ║   "_username_ chart" — achievement timeline (default 1Y)
- ║   "_username_ progress over 6 months" (interval varies)
# ║ Self references
- ║   "me", "my rank", "my stats" — link Discord first (see Privacy).
══╝`
}

/** @param {string} teamLabel */
function sectionTeam(teamLabel) {
	const entity = teamLabel === "university" ? "University" : "Team"
	const founder = teamLabel === "university" ? "admin" : "founder"
	return `_______  ${entity.toUpperCase()}  _______

══╗
# ║ ${entity} overview
- ║   "${teamLabel} info" / "CLK" / "who are we"
- ║   "${teamLabel} rank" / "how are we doing" — global ranking
# ║ Leaderboard
- ║   "team leaders" / "leaderboard" — top members
- ║   "who's on top" / "team leader" — #1 spotlight
# ║ Extras
- ║   "flagboard" — member country flags
- ║   "team badge" — badge image URL
- ║   "Who started the ${teamLabel}?" / "clk ${founder}"
══╝`
}

function sectionFilters() {
	return `_______  FILTERS & LISTS  _______

══╗
# ║ Filter targets (machines, challenges…)
- ║   "hardest machines" / "easiest challenges"
- ║   "newest / oldest boxes"
- ║   "best rated" / "worst rated" machines
- ║   "active boxes" / "retired boxes"
- ║   "linux boxes" / "windows boxes"
- ║   "incomplete challenges for _username_"
- ║   "boxes _username_ hasn't finished"
# ║ Filter members
- ║   "who has the most roots?" / member rankings
# ║ Sort hints
- ║   hardest, easiest, newest, oldest, best/worst rated
- ║   active, inactive, complete, incomplete per member
══╝`
}

function sectionPrivacy() {
	return `_______  PRIVACY & LINKING  _______

══╗
# ║ Link Discord ↔ HTB (for @mentions & "me")
- ║   "I am _uid_ on HTB"  e.g. "I am 254747 on HTB"
- ║   "My HTB username is _uname_"
# ║ Forget / opt out ("forget me")
- ║   Unlink Discord only
- ║   Ignore my HTB account (blacklist from scans)
- ║   Both — purge data and stop tracking
# ║ Undo blacklist
- ║   "Remember me again" / "unforget me" (+ your HTB id)
══╝`
}

function sectionFun() {
	return `_______  SEVEN & FUN  _______

# Binary clock — "what time is it?"
# Small talk — ask about Seven, hobbies, life… (warranty voided)
# Fake reboot — "reboot" (cosmetic status change)
# Pickle mode — scrambled replies easter egg`
}

function sectionCaptain() {
	return `_______  CAPTAIN  _______

══╗
# ║ Data refresh (captain or admin)
- ║   "force update" / "refresh team data"
- ║   Smart sync: team members + missing deps only.
- ║   Use after roster changes or stale rankings.
# ║ HTB OAuth (when sync fails)
- ║   Seven uses OAuth access + refresh tokens (~72h cycle).
- ║   Access renews automatically; no manual App Token.
- ║   If refresh fails, captains get a DM with fix steps.
- ║   Re-login on labs.hackthebox.com → DevTools → Network
- ║   → capture login/refresh → update tokens (see Admin).
- ║   Bot stays online with cached data until tokens are fixed.
# ║ Notification history (captain only)
- ║   "pusher history" — last stored HTB events (all members)
- ║   "pusher history <member>" — filter by HTB username
- ║   "pusher repost last" / "pusher repost <id>" — force post to announce channel
- ║   Use when Pusher/fallback missed an announce; does not re-sync HTB stats.
══╝`
}

function sectionAdmin() {
	return `_______  ADMIN ONLY  _______

══╗
# ║ HTB OAuth tokens (hot-reload)
- ║   "set htb tokens <access_jwt> <refresh>"
- ║   Updates HTB_V4_TOKEN + HTB_REFRESH_TOKEN in memory.
- ║   No restart if you use this or HTB_TOKEN_FILE (JSON).
- ║   Pair from labs.hackthebox.com login/refresh response.
# ║ Cache & sync
- ║   "clear cache" — wipe memory + full HTB refresh
# ║ Bot presence
- ║   "set status …" — Discord status/activity
# ║ Custom emoji (HTB icons in embeds)
- ║   "setup emoji" / "clear emoji"
# ║ Parrot mode (debug / relay)
- ║   "parrot on" — mirror channel msgs to admin DM
- ║   "parrot off"
══╝`
}

/** @param {HelpRole} role */
function sectionTips(role) {
	const extra = role !== "member"
		? "\n- Captains/admins: scroll up for your extra sections."
		: ""
	return `_______  TIPS  _______

- Names are case-insensitive; typos often still work.
- Link your HTB account to use "me" / get Discord pings.
- Achievements in the announce channel need a linked account.
- Re-ask with simpler wording if DialogFlow mishears you.${extra}`
}

function sectionFeedback() {
	return `_______  FEEDBACK  _______

Bugs or ideas? Tell Propolis on GitHub or the Seven Discord!`
}

/** @deprecated Use buildHelpMessages() — kept for backwards compatibility */
const manual = buildHelpMessages("member")[0]

const confirmUnlinkedDiscord = "Alright, your Discord ID (if one has been linked) will be forgotten immediately! :watermelon:\nThanks for letting me know. You can state your HTB identity again in the future, if you'd like to have your username linked again."
const confirmBlacklistedHtbProfile = "Noted! Your HTB account has been blacklisted from future scans so you won't show up in ranking/info responses. Your profile details within my program has been purged as well. :watermelon:\nThanks for letting me know. You can ask me in the future to remember you again, if you'd like to be included again."
const confirmWillIgnoreUser = "Okay, I've removed all traces of your data and will no longer respond to queries with your rank / ownage / other data.\nYou can undo this at any time by asking me to remember you again."

exports.manual = manual
exports.buildHelpMessages = buildHelpMessages
exports.confirmBlacklistedHtbProfile = confirmBlacklistedHtbProfile
exports.confirmUnlinkedDiscord = confirmUnlinkedDiscord
exports.confirmWillIgnoreUser = confirmWillIgnoreUser
