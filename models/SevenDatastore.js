/**
 * @typedef {import('../models/api-classes').Challenge} Challenge
 * @typedef {import('../models/api-classes').Endgame} Endgame
 * @typedef {import('../models/api-classes').EndgameEntry} EndgameEntry
 * @typedef {import('../models/api-classes').EndgameProfile} EndgameProfile
 * @typedef {import('../models/api-classes').Fortress} Fortress
 * @typedef {import('../models/api-classes').FortressEntry} FortressEntry
 * @typedef {import('../models/api-classes').FortressProfile} FortressProfile
 * @typedef {import('../models/api-classes').Machine} Machine
 * @typedef {import('../models/api-classes').ProLab} ProLab
 * @typedef {import('../models/api-classes').ProLabEntry} ProLabEntry
 * @typedef {import('../models/api-classes').ProLabInfo} ProLabInfo
 * @typedef {import('../models/api-classes').ProLabOverview} ProLabOverview
 * @typedef {import('../models/api-classes').Team} Team
 * @typedef {import('../models/api-classes').Track} Track
 * @typedef {import('../models/api-classes').University} University
 * @typedef {import('../models/api-classes').User} User
 *
 */

const { Format: F } = require("../helpers/format.js")
const { checkSelfName } = require("../helpers/nlp.js")
const {
	HtbMachine,
	HtbChallenge,
	TeamMember,
} = require("../helpers/classes.js")

const { HtbSpecialFlag } = require("../helpers/classes.js")
const fs = require("fs")
const { HtbApiConnector: V4 } = require("../modules/htb-api.js")
const dFlowEnt = require("../helpers/dflow")
const { Helpers: H } = require("../helpers/helpers.js")
const { createLogger } = require("../helpers/logger.js")
const { HtbSyncEngine, UPDATE_SECTION_ORDER } = require("../helpers/htb-sync-engine.js")

const log = createLogger("datastore")

const UPDATE_SECTION_ORDER_LEGACY = UPDATE_SECTION_ORDER

class SevenDatastore {
	constructor() {
		this.UPDATE_LOCK = false
		this.LAST_UPDATE = new Date()
		this.FIRST_RUN = false
		this.V4API = new V4()
		this.TEAM_STATS = {}
		this.TEAM_MEMBERS = {}
		this.TEAM_MEMBERS_IGNORED = {}
		this.MACHINES = {}
		this.MISC = {}
		this.CHALLENGES = {}
		this.DISCORD_LINKS = {}
		this.syncEngine = new HtbSyncEngine(this, this.V4API)
	}

	/**
	 * Useful Aliases
	 */

	get TM() {
		return this.TEAM_MEMBERS
	}
	get TMI() {
		return this.TEAM_MEMBERS_IGNORED
	}
	get M() {
		return this.MACHINES
	}
	get MT() {
		return this.MISC.MACHINE_TAGS
	}
	get C() {
		return this.CHALLENGES
	}
	get D() {
		return this.DISCORD_LINKS
	}

	get D_STATIC() {
		var buffer = Object.assign({}, this.DISCORD_LINKS)
		Object.keys(buffer).forEach((linKey) => {
			let link = buffer[linKey]
			buffer[linKey] = Object.assign(
				{},
				{
					id: link.id,
					username: link.username || link.user.username,
					nickname: link.nickname,
				}
			)
		})
		return buffer
	}

	get TS() {
		return this.TEAM_STATS
	}

	/**
	 * Get value object arrays from target and member structures
	 */

	get vTM() {
		return Object.values(this.TEAM_MEMBERS)
	}
	get vTMI() {
		return Object.values(this.TEAM_MEMBERS_IGNORED)
	}
	get vM() {
		return Object.values(this.MACHINES)
	}
	get vC() {
		return Object.values(this.CHALLENGES)
	}
	get vF() {
		return Object.values(this.MISC?.FORTRESSES || {})
	}
	get vE() {
		return Object.values(this.MISC?.ENDGAMES || {})
	}
	get vP() {
		return Object.values(this.MISC?.PROLABS || {})
	}
	get vD() {
		return Object.values(this.DISCORD_LINKS)
	}

	/**
	 * Get key object arrays from target and member structures (generally a list of IDs)
	 */

	get kTM() {
		return Object.keys(this.TEAM_MEMBERS)
	}
	get kTMI() {
		return Object.keys(this.TEAM_MEMBERS_IGNORED)
	}
	get kM() {
		return Object.keys(this.MACHINES)
	}
	get kC() {
		return Object.keys(this.CHALLENGES)
	}
	get kD() {
		return Object.keys(this.DISCORD_LINKS)
	}

	init() {
		return this.V4API.init()
	}

	hasCachedObject(data) {
		return Boolean(data && typeof data === "object" && Object.keys(data).length > 0)
	}

	hydrateFromDbBackup() {
		if (!this.MISC || typeof this.MISC !== "object") {
			this.MISC = {}
		}

		if (this.FORTRESSES !== undefined && this.MISC.FORTRESSES === undefined) {
			this.MISC.FORTRESSES = this.FORTRESSES
		}
		if (this.ENDGAMES !== undefined && this.MISC.ENDGAMES === undefined) {
			this.MISC.ENDGAMES = this.ENDGAMES
		}
		if (this.PROLABS !== undefined && this.MISC.PROLABS === undefined) {
			this.MISC.PROLABS = this.PROLABS
		}

		if (this.MISC.lastUpdate) {
			this.LAST_UPDATE = new Date(this.MISC.lastUpdate)
		}
	}

	syncDbExportFields() {
		if (this.hasCachedObject(this.MISC.FORTRESSES)) {
			this.FORTRESSES = this.MISC.FORTRESSES
		}
		if (this.hasCachedObject(this.MISC.ENDGAMES)) {
			this.ENDGAMES = this.MISC.ENDGAMES
		}
		if (this.hasCachedObject(this.MISC.PROLABS)) {
			this.PROLABS = this.MISC.PROLABS
		}
	}

	hasCachedTeamData() {
		return this.hasCachedObject(this.TEAM_MEMBERS)
			&& Boolean(this.TEAM_STATS?.name)
	}

	hasCachedTeamStats() {
		return Boolean(this.TEAM_STATS?.name && this.TEAM_STATS?.type)
	}

	getMemberSyncDependencies() {
		const deps = []
		if (!this.hasCachedObject(this.MACHINES)) deps.push("machines")
		if (!this.hasCachedObject(this.CHALLENGES)) deps.push("challenges")
		if (!this.hasCachedObject(this.MISC?.FORTRESSES)) deps.push("fortresses")
		if (!this.hasCachedObject(this.MISC?.ENDGAMES)) deps.push("endgames")
		if (!this.hasCachedObject(this.MISC?.PROLABS)) deps.push("prolabs")
		return deps
	}

	getMissingSections() {
		const sections = []
		if (!this.hasCachedObject(this.MACHINES)) sections.push("machines")
		if (!this.hasCachedObject(this.MISC?.FORTRESSES)) sections.push("fortresses")
		if (!this.hasCachedObject(this.MISC?.ENDGAMES)) sections.push("endgames")
		if (!this.hasCachedObject(this.MISC?.PROLABS)) sections.push("prolabs")
		if (!this.hasCachedObject(this.MISC?.MACHINE_TAGS)) sections.push("tags")
		if ((process.env.HTB_TEAM_ID || process.env.HTB_UNIVERSITY_ID) && !this.hasCachedTeamData()) {
			sections.push("team")
		}
		if (!this.hasCachedObject(this.CHALLENGES)) sections.push("challenges")
		return sections
	}

	sortUpdateSections(sections) {
		return UPDATE_SECTION_ORDER_LEGACY.filter(section => sections.includes(section))
	}

	expandUpdateSections(requested) {
		const set = new Set(requested)
		if (set.has("specials")) {
			set.add("fortresses")
			set.add("endgames")
			set.add("prolabs")
		}
		if (set.has("team")) {
			this.getMemberSyncDependencies().forEach(dep => set.add(dep))
		}
		return this.sortUpdateSections([...set])
	}

	getSectionsNeedingUpdate(options = {}) {
		const force = Boolean(options.force)
		const full = Boolean(options.full)
		const delta = Boolean(options.delta)
		const bootstrap = Boolean(options.bootstrap)
		const sections = options.sections

		if (full || bootstrap) {
			return [...UPDATE_SECTION_ORDER_LEGACY]
		}

		if (delta || force) {
			return [...UPDATE_SECTION_ORDER_LEGACY]
		}

		if (Array.isArray(sections) && sections.length) {
			return this.expandUpdateSections(sections)
		}

		return this.getMissingSections()
	}

	describeUpdatePlan(sectionsToUpdate, options = {}) {
		return this.syncEngine.describeUpdatePlan(sectionsToUpdate, options)
	}

	extractSpecialTargetFlagNames(flags) {
		if (!flags) return []
		if (Array.isArray(flags)) {
			return flags
				.map(flag => flag?.title || flag?.name || flag?.flag_title)
				.filter(name => typeof name === "string" && name.length)
		}
		if (typeof flags === "object") {
			if (Array.isArray(flags.flags)) {
				return this.extractSpecialTargetFlagNames(flags.flags)
			}
			return Object.values(flags)
				.filter(flag => flag && typeof flag === "object" && (flag.title || flag.name || flag.flag_title))
				.map(flag => flag.title || flag.name || flag.flag_title)
				.filter(name => typeof name === "string" && name.length)
		}
		return []
	}

	getDialogflowSpecialTargetFlagNames() {
		const specials = [
			...Object.values(this.MISC.PROLABS || {}),
			...Object.values(this.MISC.FORTRESSES || {}),
			...Object.values(this.MISC.ENDGAMES || {}),
		]
		return [...new Set(specials.flatMap(entry => this.extractSpecialTargetFlagNames(entry.flags)))]
	}

	syncAgent() {
        const IS_DEV_INSTANCE = process.env.IS_DEV_INSTANCE === "true";
		if (IS_DEV_INSTANCE)
			return setTimeout(() => dFlowEnt.syncAgentUpstream(), 60 * 1000)
		else return dFlowEnt.syncAgentDownstream()
	}

	// async getMachinesComplete() { ... removed — v4-only data path via update() }

	async informAdminViaDm(title, description) {
		// console.warn("This is a placeholder function. Override it from bot.js with the method from 'Send' module")
	}

	logUpdateProgress(msg, meta = {}) {
		log.info(msg, meta)
		this.informAdminViaDm("[Data Update]", msg)
	}

	logUpdatePhase(phase, message, meta = {}) {
		log.info(`[${phase}] ${message}`, meta)
	}

	async ensureCachedTarget(type, nameOrId, ctx = {}) {
		return this.syncEngine.ensureTarget(type, nameOrId, ctx)
	}

	async resolveEntWithEnsure(
		kwd,
		targetType = null,
		isIdLookup = false,
		discordMessage = null,
		lookup = false
	) {
		const resolved = this.resolveEnt(kwd, targetType, isIdLookup, discordMessage, false)
		if (resolved || !lookup || !kwd) return resolved

		const ensureType = (type) => (type === "starting_point" ? "machine" : type)

		if (targetType) {
			const type = ensureType(targetType)
			if (type === "member") {
				return this.resolveEnt(kwd, targetType, isIdLookup, discordMessage, true)
			}
			return this.ensureCachedTarget(type, kwd, { trigger: "resolveEnt" })
		}

		for (const type of ["machine", "challenge", "fortress", "endgame", "prolab"]) {
			const entity = await this.ensureCachedTarget(type, kwd, { trigger: "resolveEnt" })
			if (entity) return entity
		}
		return false
	}

	async update(options = {}) {
		return this.syncEngine.runPlan(options)
	}

	getLastSyncDbFields() {
		return this.syncEngine.getMergedDbFields()
	}

	/**
	 * @param {*} message - Optional: the Discord message (to resolve self username if 'i' is used)
	 * @param {*} targetType - One of ["member", "memberActivity", "machine", "challenge"]. Specifies the target DS to filter.
	 * @param {*} sortOrder - One of "asc" or "desc". Does what it sounds like. 🙂
	 * @param {*} sortBy  - The object property name to sort by.
	 * @param {*} limit - The maximum number of entity results to return as an array. (A sliced result is returned)
	 * @param {*} memberId - If filtering a user's achievements, specify the user's HTB ID here.
	 * @param {*} ownType - If filtering user own activity, specify the type (optional). ["machine", "challenge", "fortress", "prolab", "endgame"]
	 * @param {*} memberNames  - Optional - array of member usernames to filter ownage for.
	 * @param {*} targetFilterBases  - Optional - an array of names of the other fields / abstract properties to filter by.
	 */
	filterEnt(
		message,
		targetType = "member",
		sortBy = null,
		sortOrder = null,
		limit = 20,
		memberId = null,
		ownType = null,
		memberNames = [],
		targetFilterBases = []
	) {
		var sorter = undefined
		var targets = []
		const sortKeys = Array.isArray(sortBy) ? sortBy : (sortBy ? [sortBy] : [])
		if (
			!targetFilterBases.some((e) => e.cust == "incomplete") &&
			!targetFilterBases.some((e) => e.cust == "complete")
		)
			targetFilterBases.push({
				cust: "complete",
			})

		/** GET ALL CACHED TARGETS OF THE SPECIFIED TYPE */
		switch (targetType) {
			case "memberActivity":
				return this.filterMemberOwns(
					memberId,
					ownType,
					sortBy || "date",
					sortOrder || "desc",
					limit
				)
			case "member":
				targets = this.vTM
				break
			case "machine":
				targets = this.vM
				break
			case "challenge":
				targets = this.vC
				break
			case "endgame":
				targets = this.vE.map((entry) => this.normalizeLabTarget(entry, "endgame"))
				break
			case "fortress":
				targets = this.vF.map((entry) => this.normalizeLabTarget(entry, "fortress"))
				break
			case "prolab":
				targets = this.vP.map((entry) => this.normalizeLabTarget(entry, "prolab"))
				break
			default:
				break
		}

		/** SET HOW THE ARRAY WILL BE PRE-SORTED */
		switch (sortKeys[0]) {
			case "best rated":
				console.warn("SORTED BY BEST rATED")
				if (targetType == "machine") {
					sorter = (a, b) => b.stars - a.stars
				} else if (targetType == "challenge") {
					sorter = (a, b) => F.targetPercentRating(b) - F.targetPercentRating(a)
				}
				break
			case "worst rated":
				if (targetType == "machine") {
					sorter = (a, b) => a.stars - b.stars
				} else if (targetType == "challenge") {
					sorter = (a, b) => F.targetPercentRating(a) - F.targetPercentRating(b)
				}
				break
			case "hardest":
				if (targetType == "machine") {
					sorter = (a, b) => b.difficulty - a.difficulty
				} else if (targetType == "challenge") {
					sorter = (a, b) => b.avg_difficulty - a.avg_difficulty
				}
				break
			case "easiest":
				if (targetType == "machine") {
					sorter = (a, b) => a.difficulty - b.difficulty
				} else if (targetType == "challenge") {
					sorter = (a, b) => a.avg_difficulty - b.avg_difficulty
				}
				break
			case "newest":
				if (targetType == "machine") {
					sorter = (a, b) =>
						new Date(b.release).getTime() - new Date(a.release).getTime()
				} else if (targetType == "challenge") {
					sorter = (a, b) =>
						new Date(b.release_date).getTime() -
						new Date(a.release_date).getTime()
				}
				break
			case "oldest":
				if (targetType == "machine") {
					sorter = (a, b) =>
						new Date(a.release).getTime() - new Date(b.release).getTime()
				} else if (targetType == "challenge") {
					sorter = (a, b) =>
						new Date(a.release_date).getTime() -
						new Date(b.release_date).getTime()
				}
				break
			default:
				break
		}

		/** PRE-FILTER THE TARGET ARRAY BY EXCLUSION / INCLUSION RULES */
		targetFilterBases
			.filter((e) => e.cust)
			.forEach((filterBasis) => {
				switch (filterBasis.cust) {
					case "nolimit":
						console.warn("[APIv4]::: USER DON'T WANT NO LIMITS")
						limit = 0
						break
					case "incomplete":
						if (memberNames) {
							memberNames.forEach((memberName) => {
								var member = this.resolveEnt(
									memberName,
									"member",
									false,
									message,
									false
								)
								targets = targets.filter(
									(target) => !this.getMemberOwnsForTarget(member, target)
								)
							})
						}
						break
					case "complete":
						if (memberNames) {
							memberNames.forEach((memberName) => {
								var member = this.resolveEnt(
									memberName,
									"member",
									false,
									message,
									false
								)
								targets = targets.filter((target) =>
									this.getMemberOwnsForTarget(member, target)
								)
								console.log("Checked " + memberName)
							})
						}
						break
					case "active":
						targets = targets.filter((target) => !target.retired || H.isPastDate(target?.release))
						break
					case "inactive":
						targets = targets.filter((target) => target.retired)
						break
					case "well rated":
						if (targetType == "machine") {
							targets = targets.filter((target) => target.rating >= 3)
						} else if (targetType == "challenge") {
							targets = targets.filter(
								(target) => target.likes - target.dislikes > 0
							)
						}
						break
					case "poorly rated":
						if (targetType == "machine") {
							targets = targets.filter((target) => target.rating < 3)
						} else if (targetType == "challenge") {
							targets = targets.filter(
								(target) => target.likes - target.dislikes < 0
							)
						}
						break
					default:
						break
				}
			})

		targetFilterBases
			.filter((e) => e.lvl)
			.forEach((filterBasis) => {
				switch (targetType) {
					case "machine":
						targets = targets.filter((t) => t.difficultyText == filterBasis.lvl)
						break
					case "challenge":
						targets = targets.filter((t) => t.difficulty == filterBasis.lvl)
						break
					default:
						break
				}
			})

		var ccats = targetFilterBases.filter((e) => e.ccat).map((e) => e.ccat)
		if (ccats.length && targetType == "challenge") {
			targets = targets.filter((t) => ccats.includes(t.category_name))
		}

		var bbos = targetFilterBases.filter((e) => e.bos).map((e) => e.bos)
		if (bbos.length && targetType == "machine") {
			targets = targets.filter((t) => bbos.includes(t.os))
		}

		var bInf = targetFilterBases
			.filter((e) => e.ccat || e.bpath || e.bsub || e.blang)
			.map((e) => e.ccat || e.bpath || e.bsub || e.blang)
		bInf.forEach((tag) => {
			if (targetType == "machine") {
				console.log("BEFORE", targets.length)
				var tagSeq = this.getMachineTagSeqByName(tag)
				console.log(tagSeq)
				if (tagSeq) {
					targets = targets.filter((t) => this.checkMachineHasTagSeq(t, tagSeq))
				}

				console.log("AFTER", targets.length)
			}
		})

		const sortKey = sortKeys[0] || "id"
		const catalogTypes = ["fortress", "endgame", "prolab"]
		const effectiveSortOrder = sortOrder || (catalogTypes.includes(targetType) ? "asc" : "desc")

		const process = (arr, resolvedSortOrder, key, resultLimit) => {
			return [...arr]
				.sort(
					sorter
						? sorter
						: (a, b) => (a[key] - b[key]) * (resolvedSortOrder == "asc" ? 1 : -1)
				)
				.slice(0, resultLimit ? resultLimit : 999999)
		}
		// console.log(targets)
		try {
			return process(targets, effectiveSortOrder, sortKey, limit)
		} catch (error) {
			console.warn(
				`No entities returned by these filter settings (EntType: ${targetType} | SortOrder: ${sortOrder} | SortBy: ${sortKey} | Limit: ${limit})`,
				error.message
			)
			return []
		}
	}

	resolveExternalMember(id, name = null) {
		// console.log("Resolving external member...", arguments)
		if (id) {
			return this.V4API.getCompleteMemberProfileById(id)
		} else if (name) {
			return this.V4API.getMemberIdFromUsername(name)
				.then((resolvedId) =>
					resolvedId
						? this.V4API.getCompleteMemberProfileById(resolvedId)
						: null
				)
				.then((member) =>
					member && member.name
						? Object.assign({ type: "member" }, member)
						: null
				)
				.catch(() => null)
		}
	}

	resolveEnt(
		kwd,
		targetType = null,
		isIdLookup = false,
		discordMessage = null,
		lookup = false
	) {
		try {
			if (!kwd) {
				return false
			}
			var result = {}
			const isSelf = checkSelfName(kwd)
			if (isSelf) {
				try {
					console.log(`Got selfname '${kwd}' and 'discordMessage.author.id' val of '${discordMessage?.author?.id}'`)
					var idByDid = this.getIdFromDiscordId(discordMessage.author.id)
					var idByDname = this.getIdFromDiscordName(
						discordMessage?.author?.username
					)
					kwd =
						H.sAcc(this.getMemberById(idByDid), "name") ||
						H.sAcc(this.getMemberById(idByDname), "name") ||
						kwd
				} catch (error) {
					console.error(error)
				}
			}
			// console.log("Resolving '" + kwd + "'...")
			if (targetType) {
				switch (targetType) {
					case "member":
						return (
							(isIdLookup
								? this.getMemberById(kwd, isSelf)
								: this.getMemberByName(kwd, isSelf)) ||
							(lookup && !/\s/.test(kwd)
								? this.resolveExternalMember(
									isIdLookup ? kwd : null,
									!isIdLookup ? kwd : null
								)
								: null)
						)
					case "machine":
						return isIdLookup
							? this.getMachineById(kwd)
							: this.getMachineByName(kwd)
					case "challenge":
						return isIdLookup
							? this.getChallengeById(kwd)
							: this.getChallengeByName(kwd)
					case "endgame":
					case "fortress":
					case "prolab":
						return this.getSpecialByName(kwd, targetType)
					case "starting_point":
						return isIdLookup
							? this.getMachineById(kwd)
							: this.getMachineByName(kwd)
					default:
						console.warn(
							`Resolving datastore entity ${isIdLookup ? "by ID" : ""
							} from '${kwd}' failed. ${targetType ? "(Target type '" + targetType + " specified.)" : ""
							}`
						)
				}
			}
			if (isIdLookup && Number(kwd)) {
				result["member"] = this.getMemberById(kwd, isSelf)
				result["machine"] = this.getMachineById(kwd)
				result["challenge"] = this.getChallengeById(kwd)
				if (
					lookup &&
					!/\s/.test(kwd) &&
					!Object.values(result).some((e) => e)
				) {
					result["member"] = this.resolveExternalMember(
						isIdLookup ? kwd : null,
						!isIdLookup ? kwd : null
					)
				}
			} else {
				result["member"] = this.getMemberByName(kwd, isSelf)
				result["machine"] = this.getMachineByName(kwd)
				result["challenge"] = this.getChallengeByName(kwd)
				result["special"] = this.getSpecialByName(kwd)
				result["specialFlag"] = !/\s/.test(kwd) ? this.getSpecialFlagByName(kwd) : null
				if (
					lookup &&
					!/\s/.test(kwd) &&
					!Object.values(result).some((e) => e)
				) {
					result["member"] = this.resolveExternalMember(
						isIdLookup ? kwd : null,
						!isIdLookup ? kwd : null
					)
				}
			}
			return (
				result["member"] ||
				result["machine"] ||
				result["challenge"] ||
				result["special"] ||
				result["specialFlag"]
			)
		} catch (error) {
			console.error(error)
			console.warn(
				`Resolving datastore entity ${isIdLookup ? "[by ID] " : ""
				}from '${kwd}' failed. ${targetType ? "(Target type '" + targetType + "' specified.)" : ""
				}`
			)
			return false
		}
	}

	/**
	 * Get the member object whose name matches the parameter string.
	 * @param {string} name - The member name.
	 * @returns {(TeamMember|null)}
	 */
	getMemberByName(name, isSelf = false) {
		if (name) {
			var match = Object.values(this.TEAM_MEMBERS).find(
				(member) => member.name.toLowerCase() == name.toLowerCase()
			)
			if (match) {
				if (isSelf) {
					match = Object.assign({}, match)
					match.self = true
				}
				return match
			} else {
				match = this.getIdFromDiscordName(name)
				return this.TEAM_MEMBERS[match] || null
			}
		}
	}

	/**
	 * Get the machine object whose name matches the parameter string.
	 * @param {string} name - The machine name.
	 * @returns {(HtbMachine|null)}
	 */
	getMachineByName(name) {
		return Object.values(this.MACHINES).find(
			(machine) => machine.name.toLowerCase() == name.toLowerCase()
		)
	}


	/**
	 * Get the latest box, (or unreleased box, if one is found).
	 * @returns {HtbMachine} - The latest / unreleased machine
	 */
	getNewestOrUnreleasedBox() {
		return Object.values(this.MACHINES)
			.filter((e) => !e.submission)
			.reduce(function (prev, current) {
				return prev.id > current.id ? prev : current
			})
	}

	/**
	 * Get the ID of the latest box, (or unreleased box, if one is found).
	 * @returns {number} - The latest / unreleased machine id
	 */
	getNewBoxId() {
		return (
			Object.values(this.MACHINES)
				.filter((e) => !e.submission)
				.reduce(function (prev, current) {
					return prev.id > current.id ? prev : current
				}).id || null
		)
	}

	/**
	 * Get the challenge object whose name matches the parameter string.
	 * @param {string} name - The challenge name.
	 * @returns {(HtbChallenge|null)}
	 */
	getChallengeByName(name) {
		// Return machine object with name matching parameter string
		return Object.values(this.CHALLENGES).find(
			(challenge) => challenge.name.toLowerCase() == name.toLowerCase()
		)
	}

	/**
	 * Get the Fortress object whose name matches the parameter string.
	 * @param {string} name - The fortress name.
	 * @returns {(Fortress|null)}
	 */
	getFortressByName(name) {
		return Object.values(this.MISC.FORTRESSES || {}).find((item) =>
			[item.name.toLowerCase(), item.company?.name?.toLowerCase()].includes(
				name.toLowerCase()
			)
		)
	}

	/**
	 * Get the Endgame object whose name matches the parameter string.
	 * @param {string} name - The endgame name.
	 * @returns {(Endgame|null)}
	 */
	getEndgameByName(name) {
		return Object.values(this.MISC.ENDGAMES || {}).find(
			(item) => item.name.toLowerCase() == name.toLowerCase()
		)
	}

	/**
	 * Get the Pro Lab object whose name matches the parameter string.
	 * @param {string} name - The prolab name.
	 * @returns {(ProLab|null)}
	 */
	getProLabByName(name) {
		return Object.values(this.MISC.PROLABS || {}).find(
			(item) => item.name.toLowerCase() == name.toLowerCase()
		)
	}

	/**
	 * Get the challenge object whose name matches the parameter string.
	 * @param {string} name - The special item name.
	 * @returns {Object}
	 */
	getSpecialByName(name = null, type = null) {
		// Return endgame, fortress or pro lab with name matching parameter string
		switch (type) {
			case "fortress":
				return this.getFortressByName(name)
			case "endgame":
				return this.getEndgameByName(name)
			case "prolab":
				return this.getProLabByName(name)
			default:
				return (
					this.getFortressByName(name) ||
					this.getEndgameByName(name) ||
					this.getProLabByName(name)
				)
		}
	}

	/**
	 * Get the special challenge flag pseudo-object whose name matches the parameter string.
	 * @param {string} name - The special challenge flag name.
	 * @returns {Object}
	 */
	getSpecialFlagByName(name) {
		if (!name || /\s/.test(String(name))) return null

		const normalizeFlagName = (flag, index) => {
			if (typeof flag === "string") {
				return { name: flag, idx: index + 1 }
			}
			const flagName = flag?.title || flag?.name || ""
			if (!flagName) return null
			return { name: flagName, idx: flag?.id ?? index + 1 }
		}

		const allSpecials = [
			...this.vF,
			...this.vE,
			...this.vP,
		]
		if (!allSpecials.length && this.MISC.SPECIALS) {
			allSpecials.push(...Object.values(this.MISC.SPECIALS).flat())
		}

		const needle = String(name).replace(/\W/g, "").toLowerCase()
		var specialTargetResolved = allSpecials
			.map((parent) => {
				const flagList = Array.isArray(parent.flags)
					? parent.flags
					: Object.values(parent.flags || {})
				const flag = flagList
					.map(normalizeFlagName)
					.filter(Boolean)
					.find((entry) =>
						entry.name.replace(/\W/g, "").toLowerCase() === needle
					)
				return flag ? { parent, flag } : null
			})
			.filter(Boolean)
			.shift()

		if (!specialTargetResolved) return null
		return new HtbSpecialFlag(
			specialTargetResolved.flag.idx,
			specialTargetResolved.flag.name,
			specialTargetResolved.parent
		)
	}

	/**
	 * Get the member object whose id matches the parameter string.
	 * @param {number} id - The member id.
	 * @returns {TeamMember}
	 */
	getMemberById(id, isSelf = false) {
		if (this.TEAM_MEMBERS[id]) {
			var match = this.TEAM_MEMBERS[id]
			if (isSelf) {
				match = Object.assign({}, match)
				match.self = true
			}
			return match
		}
		return null
	}

	/**
	 * Get the machine object whose id matches the parameter string.
	 * @param {number} id - The machine id.
	 * @returns {(HtbMachine|null)}
	 */
	getMachineById(id) {
		return (
			Object.values(this.MACHINES).find((machine) => machine.id == id) || null
		)
	}

	/**
	 * Get the challenge object whose id matches the parameter string.
	 * @param {number} id - The challenge id.
	 * @returns {(HtbChallenge|null)}
	 */
	getChallengeById(id) {
		return (
			Object.values(this.CHALLENGES).find((challenge) => challenge.id == id) ||
			null
		)
	}

	normalizeLabTarget(target, labType) {
		if (!target || typeof target !== "object") return target
		return target.type ? target : { ...target, type: labType }
	}

	getMemberLabProgressList(member, labType) {
		const key = { fortress: "fortresses", endgame: "endgames", prolab: "prolabs" }[labType]
		return key && Array.isArray(member?.[key]) ? member[key] : []
	}

	getMemberLabProgressEntry(member, target) {
		if (!member || !target) return null
		const labType = target.type
		if (!["fortress", "endgame", "prolab"].includes(labType)) return null

		const list = this.getMemberLabProgressList(member, labType)
		const aliases = [target.name, target.identifier, target.company?.name].filter(Boolean)

		return list.find((entry) => {
			if (target.id != null) {
				if (entry.id != null && String(entry.id) === String(target.id)) return true
				if (entry.lab_id != null && String(entry.lab_id) === String(target.id)) return true
			}
			return aliases.some((alias) => H.ciEquals(entry.name, alias))
		}) || null
	}

	memberHasLabProgress(member, target) {
		const progress = this.getMemberLabProgressEntry(member, target)
		return Boolean(progress && Number(progress.completion_percentage) > 0)
	}

	buildLabProgressOwns(member, target, progressEntry) {
		return [{
			object_type: target.type,
			type: target.type,
			name: target.name,
			completion_percentage: progressEntry.completion_percentage,
			date: progressEntry.last_owned_at || progressEntry.updated_at || progressEntry.date || null,
			target_id: target.id,
		}].map((own) => ({ ...own, id: member.id }))
	}

	getMemberOwnsForTarget(member, target) {
		if (member && target) {
			// console.log(member)
			var validOwns = []
			switch (target.type) {
				case "machine":
				case "challenge":
					validOwns = member.activity
						.filter(
							(own) =>
								own.object_type == target.type &&
								(own.name == target.name || own.name == target.company)
						)
						.map((own) => ({ ...own, id: member.id }))
					break
				case "endgame":
				case "fortress":
				case "prolab": {
					const progressEntry = this.getMemberLabProgressEntry(member, target)
					if (progressEntry && Number(progressEntry.completion_percentage) > 0) {
						validOwns = this.buildLabProgressOwns(member, target, progressEntry)
						break
					}
					validOwns = member.activity
						.filter(
							(own) =>
								own.object_type == target.type &&
								(H.ciEquals(own.name, target.name) ||
									H.ciEquals(own.name, target.company?.name) ||
									(target.id != null && own.id == target.id))
						)
						.map((own) => ({ ...own, id: member.id }))
					break
				}
				case "flag":
					validOwns = member.activity
						.filter(
							(own) =>
								own.object_type == target.parent.type &&
								(own.name == target.parent.name ||
									own.name == target.parent.company)
						)
						.filter(
							(own) => target.name.toLowerCase() == own.flag_title.toLowerCase()
						)
						.map((own) => ({ ...own, id: member.id }))
					break
				default:
					break
			}

			// console.info(`Got ${validOwns.length} valid owns...`)
			return !validOwns.length ? null : validOwns
		} else {
			return undefined
		}
	}

	filterMemberOwns(
		memberId,
		targetType = null,
		sortBy = "date",
		sortOrder = "desc",
		limit = 12
	) {
		const process = (arr, sortOrder, key, limit) => {
			if (key == "date") {
				return [...arr]
					.sort(
						(a, b) =>
							(Date.parse(b.date) - Date.parse(a.date)) *
							(sortOrder == "asc" ? 1 : -1)
					)
					.slice(0, limit ? limit : 999999)
			} else {
				return [...arr]
					.sort((a, b) => (b[key] - a[key]) * (sortOrder == "asc" ? 1 : -1))
					.slice(0, limit ? limit : 999999)
			}
		}
		const member = this.getMemberById(memberId)
		if (!member) return []
		// console.log(member)
		var owns = targetType
			? [...member.activity].filter((e) => e.object_type == targetType)
			: [...member.activity]
		const filteredOwns = process(owns, sortOrder, sortBy, limit)
		return filteredOwns || []
	}

	getTeamOwnsForTarget(target) {
		if (!target) {
			return undefined
		}
		// console.warn(target)
		var teamOwns = []
		// if (target.type == "flag") {
		// 	teamOwns = this.vTM.map(e => ({
		// 		id: e.id,
		// 		act: e.activity
		// 	})).map(member => member.act.filter(own => own.object_type == target.parent.type && own.flag_title == target.name).map(k => ({
		// 		...k,
		// 		uid: member.id
		// 	}))).filter(own => target.name == own.flag_title).flat(1).sort((a, b) => H.sortByZuluDatestring(a, b, "date", false))
		// } else {
		// 	teamOwns = this.vTM.map(e => ({
		// 		id: e.id,
		// 		act: e.activity
		// 	})).map(member => member.act.filter(own => own.object_type == target.type && own.name == target.name).map(k => ({
		// 		...k,
		// 		uid: member.id
		// 	}))).flat(1).sort((a, b) => H.sortByZuluDatestring(a, b, "date", false))
		// }
		teamOwns = this.vTM
			.map((m) => this.getMemberOwnsForTarget(m, target))
			.flat()
			.filter((e) => e)
			.map((k) => ({
				...k,
				uid: k.id,
			}))
			.flat(1)
			.sort((a, b) => H.sortByZuluDatestring(a, b, "date", false))

		console.info(`Got ${teamOwns.length} valid team owns...`)
		return !teamOwns.length ? null : teamOwns
	}

	filterTeamOwns(
		memberId,
		targetType = null,
		sortBy = "date",
		sortOrder = "desc",
		limit = 12
	) {
		const process = (arr, sortOrder, key, limit) => {
			if (key == "date") {
				return [...arr]
					.sort(
						(a, b) =>
							(Date.parse(b.date) - Date.parse(a.date)) *
							(sortOrder == "asc" ? 1 : -1)
					)
					.slice(0, limit ? limit : 999999)
			} else {
				return [...arr]
					.sort((a, b) => (b[key] - a[key]) * (sortOrder == "asc" ? 1 : -1))
					.slice(0, limit ? limit : 999999)
			}
		}
		const member = this.getMemberById(memberId)
		var owns = targetType
			? [...member.activity].filter((e) => e.object_type == targetType)
			: [...member.activity]
		const filteredOwns = process(owns, sortOrder, sortBy, limit)
		return filteredOwns || null
	}

	getAllMachineTagNames(
		machine = {
			tags: [],
		},
		separate = false
	) {
		if (!machine.tags) {
			machine.tags = []
		}
		var tagDict = {}
		machine.tags.map((tag) => {
			console.info(tag)
			const category = Object.values(this.MISC.MACHINE_TAGS).find(
				(e) => e.id == tag.tag_category_id
			)
			console.info(category)
			const subtype = category
				? category.tags.find((e) => e.id == tag.id) || null
				: null
			if (subtype && category) {
				if (!Array.isArray(tagDict[category.name])) {
					tagDict[category.name] = []
				}
				tagDict[category.name].push([subtype.name])
			}
		})
		if (separate) {
			return tagDict
		} else {
			return [...Object.values(tagDict)]
		}
	}

	getMachineTagSeqByName(tagName) {
		var match = undefined
		Object.keys(this.MISC.MACHINE_TAGS).some((key) => {
			var res = this.MISC.MACHINE_TAGS[key]["tags"].find(
				(e) => e.name == tagName
			)
			console.log(this.MISC.MACHINE_TAGS[key])
			console.log(res)
			if (res) {
				match = [key, res.id]
				return true
			}
		})
	}

	checkMachineHasTag(machine, tagName) {
		if (this.getAllMachineTagNames(machine, false).includes(tagName)) {
			return true
		} else {
			return false
		}
	}

	checkMachineHasTagSeq(machine, tagSeq = [0, 0]) {
		if (!machine.tags) {
			machine.tags = []
		}
		return machine.tags.some(
			(tag) => tag.id == tagSeq[1] && tag.tag_category_id == tagSeq[0]
		)
	}
	/**
	 * Get the member object whose name matches the parameter string.
	 * @param {string} name - The member name.
	 * @returns {(TeamMember|null)}
	 */
	getTopMembers(count = 25) {
		var teamMembersAll = {
			...this.TEAM_MEMBERS,
			...this.TEAM_MEMBERS_IGNORED,
		}
		var sortedByTPoints = [...Object.values(teamMembersAll)]
			.sort((a, b) => b.points - a.points)
			.map((e) => e.id)
		var out = sortedByTPoints.slice(0, count)
		return out.length == 1 ? out[0] : out
	}

	getDiscordUserSynonymsForUid(id, names) {
		var dcMem = this.D_STATIC[id]
		var buffer = [
			...new Set(
				[H.sAcc(dcMem, "username") || "", H.sAcc(dcMem, "nickname") || ""]
					.filter((e) => e)
					.filter((e) => !names.includes(e.toLowerCase()))
			),
		]
		return buffer
	}

	getDiscordUserSynonymsForUidNoVerify(id) {
		var dcMem = this.D_STATIC[id]
		var buffer = [
			...new Set(
				[
					H.sAcc(dcMem, "username") || "",
					H.sAcc(dcMem, "nickname") || "",
				].filter((e) => e)
			),
		]
		return buffer
	}
	/**
	 * Returns a pretty-printable version of the Discord username and / or HTB username for a given HTB UID, in hyperlinked Discord markdown.
	 * @param {number} uid
	 * @returns {(string|"[Invalid ID]")}
	 */
	getDiscordUserId(uid) {
		if (!(uid in this.D_STATIC)) return null
		const dcMem = this.D_STATIC[uid]
		return H.sAcc(dcMem, "id") || H.sAcc(dcMem, "userID") || null
	}

	getDiscordMention(uid, isSelf = false, showBothNames = true) {
		const discordId = this.getDiscordUserId(uid)
		if (discordId && process.env.PUSHER_MENTION_ON_OWN !== "false") {
			return `<@${discordId}>${isSelf ? " [You]" : ""}`
		}
		return this.tryDiscordifyUid(uid, isSelf, showBothNames)
	}

	tryDiscordifyUid(uid, isSelf = false, showBothNames = true) {
		if (uid in this.TEAM_MEMBERS) {
			if (uid in this.D_STATIC) {
				var dcMem = this.D_STATIC[uid]
				var discordName =
					H.sAcc(dcMem, "username") || "" || H.sAcc(dcMem, "nickname") || ""
				if (
					discordName.toLowerCase() != this.TEAM_MEMBERS[uid].name.toLowerCase()
				) {
					return `🌀${F.STL(discordName, "bs")}${showBothNames ? " (" + this.TEAM_MEMBERS[uid].name + ")" : ""
						}${isSelf ? " [You]" : ""}`
				} else {
					return `🌀 ${F.STL(discordName, "bs")}${isSelf ? " [You]" : ""}`
				}
			} else {
				return this.TEAM_MEMBERS[uid].name
			}
		} else {
			return null
		}
	}

	incrementTeamStatsFromOwn(flag, type, isBlood = false) {
		if (!this.TEAM_STATS) return
		if (flag === "user") {
			this.TEAM_STATS.user_owns = (this.TEAM_STATS.user_owns || 0) + 1
		}
		if (flag === "root") {
			this.TEAM_STATS.system_owns = (this.TEAM_STATS.system_owns || 0) + 1
		}
		if (isBlood) {
			this.TEAM_STATS.first_bloods = (this.TEAM_STATS.first_bloods || 0) + 1
		}
		if (type === "challenge" && flag === "challenge") {
			this.TEAM_STATS.challenge_owns = (this.TEAM_STATS.challenge_owns || 0) + 1
		}
	}

	/**
	 * Gets the HTB user ID for a given Discord username, if such an association exists.
	 * @param {string} username - The Discord username to lookup linked account for.
	 * @returns {(number|false)}
	 */
	getIdFromDiscordName(username) {
		var id = Object.keys(this.D_STATIC).find(
			(link) =>
				((H.sAcc(this.D_STATIC[link], "username") || "").toLowerCase() ||
					H.sAcc(this.D_STATIC[link], "nickname") ||
					"") == username.toLowerCase()
		)
		return id || false
	}

	/**
	 * Gets the HTB user ID for a given Discord username, if such an association exists.
	 * @param {string} dId - The Discord username to lookup linked account for.
	 * @returns {(number|false)}
	 */
	getIdFromDiscordId(dId) {
		var id = Object.keys(this.D_STATIC).find(
			(link) =>
				H.sAcc(this.D_STATIC[link], "id") == dId ||
				H.sAcc(this.D_STATIC[link], "userID") == dId
		)
		return id || false
	}

	/**
	 * Get the  current rank of a team member by ID.
	 * @param {number} id - The member ID.
	 * @returns {(number|"Unknown")}
	 */
	getMemberTeamRankById(id) {
		return (
			[...Object.values(this.TEAM_MEMBERS)]
				.sort((a, b) => b.points - a.points)
				.map((e) => e.id)
				.indexOf(id) + 1
		)
	}

	/**
	 * Returns a set of markdown-formatted username links for a given list of HTB ids.
	 * @param {number[]} memberIds - An array of HTB UIDs
	 * @returns {(string[]|"[Invalid ID]")}
	 */
	getMdLinksForUids(
		memberIds,
		showBothNames = true,
		customTextFieldBasis = null,
		discordMessage = null
	) {
		// Get markdown link to a HTB user's profile, based on UID.
		//console.log(memberIds)
		if (memberIds) {
			var screenNames = []
			memberIds.forEach((uid) => {
				// console.log("UID: " + uid)
				var discordName =
					this.getDiscordUserSynonymsForUidNoVerify(uid)[0] || ""
				var isSameName =
					discordName.toLowerCase() == this.TEAM_MEMBERS[uid].name.toLowerCase()
				if (uid in this.TEAM_MEMBERS) {
					screenNames.push(
						`[\`${this.tryDiscordifyUid(
							uid,
							false,
							showBothNames
						)}\`](${F.memberProfileUrl({ id: uid })} '${!isSameName && discordName && !showBothNames
							? "(" + this.TEAM_MEMBERS[uid].name + ") ⟶ "
							: ""
						}${customTextFieldBasis
							? this.TEAM_MEMBERS[uid][customTextFieldBasis]
							: "View on HTB"
						}')`
					)
				} else {
					console.log("UID opted out of data collection.")
					screenNames.push("[٩(͡๏̯͡๏)۶](http://? '👀')")
				}
			})

			if (screenNames.length == 0) {
				return null
			} else {
				// console.log(screenNames)
				return screenNames
			}
		} else {
			return null
		}
	}

	/**
	 * Returns a set of markdown-formatted username links for a given list of HTB ids.
	 * @param {number[]} memberIds - An array of HTB UIDs
	 * @returns {(string[]|"[Invalid ID]")}
	 */
	modernGetMdLinksForUids(
		memberIds,
		showBothNames = true,
		customTextFieldBasis = null,
		discordMessage = null
	) {
		// Get markdown link to a HTB user's profile, based on UID.
		//console.log(memberIds)
		if (memberIds.length) {
			var screenNames = []
			return memberIds.map((e) => this.tryDiscordifyUid())
		} else {
			return null
		}
	}

	/**
	 * Takes information about a new own achievement and adds it to our records.
	 * @param {number} uid - The ID of the user associated with the achievement.
	 * @param {string} type - A string value describing the thing / milestone owned, e.g. "root", "user", "challenge", "endgame", "akerva" etc.
	 * @param {(number|string)} targetName - If a machine user/system own, use the numeric machine ID (e.g. 238). If a challenge or fortress own, use the title.
	 * @param {string} flag - For pro labs and fortresses with multiple flags, use this field to specify the milestone title.
	 */
	integratePusherOwn(
		uid,
		time,
		type,
		targetName,
		flag = null,
		isPusher = false
	) {
		var member = this.getMemberById(uid)
		var target = this.resolveEnt(targetName, type)
		var entriesAffected = false
		if (member && target) {
			console.log(
				`[PUSHER INTEGRATION]::: Resolved member ${member.name} [${member.id}] and target ${target.name} [${target.type}]`
			)
			try {
				if (["endgame", "fortress", "prolab"].includes(type)) {
					const flagTitle = flag && !["endgame", "fortress", "prolab"].includes(flag) ? flag : null
					const labOwn = member.activity.find(
						(own) =>
							own.object_type == target.type &&
							(own.name == target.name || own.id == target.id) &&
							(!flagTitle || H.ciEquals(own.flag_title, flagTitle))
					)
					if (!labOwn) {
						member.activity.push({
							date: new Date(time).toISOString(),
							date_diff: F.timeSince(new Date(time)),
							object_type: target.type,
							type: target.type,
							id: target.id,
							name: target.name,
							flag_title: flagTitle,
							points: target.points,
						})
						entriesAffected = true
						console.log(isPusher ? `Added ${target.type} own for ${member.name}` : "")
					}
					return entriesAffected
				}

				if (type === "starting_point") {
					const spOwn = member.activity.find(
						(own) =>
							own.object_type == "machine" &&
							(own.name == target.name || own.id == target.id) &&
							own.type == (flag || "user")
					)
					if (!spOwn) {
						member.activity.push({
							date: new Date(time).toISOString(),
							date_diff: F.timeSince(new Date(time)),
							object_type: "machine",
							type: flag || "user",
							id: target.id,
							name: target.name,
							points: target.points,
							machine_avatar: target.avatar,
						})
						entriesAffected = true
					}
					return entriesAffected
				}

				switch (flag || type) {
					case "user":
						var userOwn = member.activity.find(
							(own) =>
								own.type == "user" &&
								(own.name == target.name || own.id == target.id)
						)
						if (!userOwn) {
							member.activity.push({
								date: new Date(time).toISOString(),
								date_diff: F.timeSince(new Date(time)),
								object_type: target.type,
								type: "user",
								id: target.id,
								name: target.name,
								points: target.points,
								machine_avatar: target.avatar,
							})
							entriesAffected = true
							console.log(isPusher ? "Added user own for " + member.name : "")
						} else {
							console.warn(
								`${member.name} already had a '${flag || type
								}' own registered for ${target.name}...`
							)
						}
						break

					case "root":
						var rootOwn = member.activity.find(
							(own) =>
								own.type == "root" &&
								(own.name == target.name || own.id == target.id)
						)
						if (!rootOwn) {
							member.activity.push({
								date: new Date(time).toISOString(),
								date_diff: F.timeSince(new Date(time)),
								object_type: target.type,
								type: "root",
								id: target.id,
								name: target.name,
								points: target.points,
								machine_avatar: target.avatar,
							})
							entriesAffected = true
							console.log(isPusher ? "Added root own for " + member.name : "")
						} else {
							console.warn(
								`${member.name} already had a '${flag || type
								}' own registered for ${target.name}...`
							)
						}
						break

					case "challenge":
						var challOwn = member.activity.find(
							(own) =>
								own.type == "challenge" &&
								(own.name == target.name || own.id == target.id)
						)
						if (!challOwn) {
							member.activity.push({
								date: new Date(time).toISOString(),
								date_diff: F.timeSince(new Date(time)),
								object_type: target.type,
								type: "challenge",
								id: target.id,
								name: target.name,
								points: target.points,
								challenge_category: target.category_name,
							})
							entriesAffected = true
							console.log(
								isPusher ? "Added challenge own for " + member.name : ""
							)
						} else {
							console.warn(
								`${member.name} already had a '${flag || type
								}' own registered for ${target.name}...`
							)
						}
						break
					default:
						break
				}
			} catch (error) {
				console.error(error)
			}
		}
		return entriesAffected
	}

	/**
	 * Takes information about a new own achievement and adds it to our records.
	 * @param {HtbUser} htbUser - The pre-resolved HTB user object associated with the achievement (useful if external / not from team).
	 * @param {number} uid - The ID of the user associated with the achievement.
	 * @param {string} type - A string value describing the thing / milestone owned, e.g. "root", "user", "challenge", "endgame", "akerva" etc.
	 * @param {(number|string)} targetName - If a machine user/system own, use the numeric machine ID (e.g. 238). If a challenge or fortress own, use the title.
	 * @param {string} flag - For pro labs and fortresses with multiple flags, use this field to specify the milestone title.
	 */
	integratePusherBlood(
		htbUser,
		uid,
		time,
		type,
		targetName,
		flag = null,
		isPusher = false
	) {
		var member = this.getMemberById(uid)
		var user = member || htbUser
		var target = this.resolveEnt(targetName, type)
		var entriesAffected = false
		if (user && target) {
			console.log(
				`[PUSHER INTEGRATION]::: Resolved user ${user.name} [${user.id}] and target ${target.name} [${target.type}] (${flag}}🩸)`
			)
			try {
				switch (flag || type) {
					case "user":
						target.userBlood = {
							user: {
								name: user.name,
								id: user.id,
								avatar: user.avatar,
							},
							created_at: new Date(time).toISOString(),
							blood_difference: "0̗͖̋ͯ̚1̪͍̘̘ͭ1͎͓̅̔̃0̫̮̲ͣ̎2͕̰̈͋̅2͚̹͕̋ͩ", // 👀
						}
						if (member) {
							member.user_bloods = member.user_bloods
								? member.user_bloods + 1
								: 1
						}
						entriesAffected = true
						console.log(isPusher ? "Added user blood for " + user.name : "")
						break

					case "root":
						target.rootBlood = {
							user: {
								name: user.name,
								id: user.id,
								avatar: user.avatar,
							},
							created_at: new Date(time).toISOString(),
							blood_difference: "2̬̖ͧ̊ͧ2̜̫̖̉̔0͔̰͖̍̽1̗̥ͩ̋́1̪͕̀̅̔2̮ͬͩ̇͒", // That'll confuse somebody at some point
						}
						if (member) {
							member.system_bloods = member.system_bloods
								? member.system_bloods + 1
								: 1
						}
						entriesAffected = true
						console.log(isPusher ? "Added root blood for " + user.name : "")
						break

					case "challenge":
						target.solves = target.solves ? target.solves + 1 : 1
						target.first_blood_user = user.name
						target.first_blood_user_id = user.id
						target.first_blood_time = "2̬̖ͧ̊ͧ2̜̫̉̔0͔̰͖̍̽2̜̫̖̉̔1̗̥ͩ̋́2̮ͬͩ̇͒"
						target.first_blood_user_avatar = user.avatar
						entriesAffected = true
						console.log(isPusher ? "Added challenge blood for " + user.name : "")
						break
					default:
						break
				}
			} catch (error) {
				console.error(error)
			}
		}
		return entriesAffected
	}

	mdLinksFromBoxIds(boxIds) {
		// Get markdown links to a HTB user's profile, based on UID.
		// console.log(boxIds)
		if (boxIds) {
			var boxLinks = []
			boxIds.forEach((boxId) => {
				if (boxId in this.MACHINES) {
					var box = this.MACHINES[boxId]
					boxLinks.push(
						"**[" +
						box.name +
						"](" +
						"https://app.hackthebox.com/machines/" +
						box.id +
						" 'Goto HTB page')**"
					)
				}
			})
			// console.log(boxLinks)
			if (boxLinks.length == 0) {
				return null
			} else {
				return boxLinks
			}
		} else {
			return null
		}
	}
}

module.exports = {
	SevenDatastore,
}
