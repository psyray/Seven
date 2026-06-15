/**
 * Central HTB catalog sync: delta diff, on-demand ensure, and scheduled plans.
 * @module HtbSyncEngine
 */
const { Helpers: H } = require("./helpers.js")
const dFlowEnt = require("./dflow")
const { createLogger } = require("./logger.js")

const log = createLogger("htb-sync")

const CATALOG_KINDS = new Set(["machine", "challenge", "fortress", "endgame", "prolab"])

const UPDATE_SECTION_ORDER = [
	"machines", "fortresses", "endgames", "prolabs", "tags", "team", "challenges",
]

const SECTION_TO_KIND = {
	machines: "machine",
	challenges: "challenge",
	fortresses: "fortress",
	endgames: "endgame",
	prolabs: "prolab",
}

const KIND_DB_FIELDS = {
	machine: ["machines", "misc"],
	challenge: ["challenges", "misc"],
	fortress: ["fortresses", "misc"],
	endgame: ["endgames", "misc"],
	prolab: ["prolabs", "misc"],
}

const TEAM_STATS_REFRESH_MS = Number(process.env.HTB_TEAM_STATS_REFRESH_MS) || 60 * 60 * 1000

class HtbSyncEngine {
	constructor(datastore, api) {
		this.ds = datastore
		this.api = api
		this.targetLocks = new Map()
		this.mergedDbFields = new Set()
		this.catalogFetched = new Map()
	}

	hasCachedObject(data) {
		return Boolean(data && typeof data === "object" && Object.keys(data).length > 0)
	}

	ensureMisc() {
		if (!this.ds.MISC || typeof this.ds.MISC !== "object") {
			this.ds.MISC = {}
		}
	}

	getCatalogCache(kind) {
		this.ensureMisc()
		switch (kind) {
		case "machine":
			return this.ds.MACHINES
		case "challenge":
			return this.ds.CHALLENGES
		case "fortress":
			return this.ds.MISC.FORTRESSES
		case "endgame":
			return this.ds.MISC.ENDGAMES
		case "prolab":
			return this.ds.MISC.PROLABS
		default:
			return null
		}
	}

	trackDbFields(kind) {
		const fields = KIND_DB_FIELDS[kind]
		if (fields) fields.forEach(field => this.mergedDbFields.add(field))
	}

	trackSectionFields(section) {
		switch (section) {
		case "tags":
			this.mergedDbFields.add("misc")
			break
		case "team":
			this.mergedDbFields.add("team_members")
			this.mergedDbFields.add("team_stats")
			break
		default:
			if (SECTION_TO_KIND[section]) {
				this.trackDbFields(SECTION_TO_KIND[section])
			}
			break
		}
	}

	getMergedDbFields() {
		return [...this.mergedDbFields]
	}

	resetMergedDbFields() {
		this.mergedDbFields = new Set()
	}

	normalizeTargetType(type) {
		if (type === "starting_point") return "machine"
		return type
	}

	normalizeRequestedSections(sections) {
		const expanded = new Set()
		for (const section of sections) {
			if (section === "specials") {
				expanded.add("fortresses")
				expanded.add("endgames")
				expanded.add("prolabs")
			} else {
				expanded.add(section)
			}
		}
		if (expanded.has("team")) {
			this.ds.getMemberSyncDependencies().forEach(dep => {
				if (dep === "specials") {
					expanded.add("fortresses")
					expanded.add("endgames")
					expanded.add("prolabs")
				} else {
					expanded.add(dep)
				}
			})
		}
		return UPDATE_SECTION_ORDER.filter(section => expanded.has(section))
	}

	resolveSectionsToRun(options = {}) {
		const { full, force, delta, bootstrap, sections } = options
		if (Array.isArray(sections) && sections.length) {
			return this.normalizeRequestedSections(sections)
		}
		if (full || bootstrap || delta || force) {
			return [...UPDATE_SECTION_ORDER]
		}
		return this.ds.getMissingSections()
	}

	describeUpdatePlan(sectionsToUpdate, options = {}) {
		if (options.full) return "full refresh (delta bootstrap from empty cache)"
		if (options.bootstrap) return "bootstrap (delta from empty cache)"
		if (options.delta) return `scheduled delta (${sectionsToUpdate.join(", ")})`
		if (options.force) return `force sync: delta catalogs + full team profiles (${sectionsToUpdate.join(", ")})`
		if (Array.isArray(options.targets) && options.targets.length) {
			return `on-demand targets (${options.targets.length})`
		}
		if (!sectionsToUpdate.length) return "skipped (cache complete)"
		return `partial bootstrap (${sectionsToUpdate.join(", ")})`
	}

	async fetchCatalog(kind) {
		if (this.catalogFetched.has(kind)) {
			return this.catalogFetched.get(kind)
		}
		let catalog
		switch (kind) {
		case "machine": {
			const byId = await this.api.getAllMachinesFast()
			catalog = { byId, list: Object.values(byId) }
			break
		}
		case "challenge": {
			const byId = await this.api.getAllChallengesFast()
			catalog = { byId, list: Object.values(byId) }
			break
		}
		case "fortress": {
			const list = await this.api.getAllFortressEntries()
			catalog = { byId: H.arrToObj(list, "id"), list }
			break
		}
		case "endgame": {
			const list = await this.api.getAllEndgameEntries()
			catalog = { byId: H.arrToObj(list, "id"), list }
			break
		}
		case "prolab": {
			const list = await this.api.getAllProLabEntries()
			catalog = { byId: H.arrToObj(list, "id"), list }
			break
		}
		default:
			catalog = { byId: {}, list: [] }
		}
		this.catalogFetched.set(kind, catalog)
		return catalog
	}

	clearCatalogCache() {
		this.catalogFetched.clear()
	}

	getStaleIds(kind, catalogById, cache) {
		const stale = []
		if (!this.hasCachedObject(cache)) return stale
		for (const [id, listEntry] of Object.entries(catalogById || {})) {
			const cached = cache[id]
			if (!cached) continue
			if (kind === "machine") {
				if (listEntry.release !== cached.release || Boolean(listEntry.retired) !== Boolean(cached.retired)) {
					stale.push(String(id))
				}
			} else if (kind === "challenge") {
				if (listEntry.release !== cached.release || Boolean(listEntry.retired) !== Boolean(cached.retired)) {
					stale.push(String(id))
				}
			} else if (["fortress", "endgame", "prolab"].includes(kind)) {
				if (listEntry.name && cached.name && listEntry.name !== cached.name) {
					stale.push(String(id))
				}
			}
		}
		return stale
	}

	async diffCatalog(kind, { includeStale = false } = {}) {
		const { byId: catalogById } = await this.fetchCatalog(kind)
		const cache = this.getCatalogCache(kind) || {}
		const missingIds = Object.keys(catalogById).filter(id => !cache[id])
		const staleIds = includeStale ? this.getStaleIds(kind, catalogById, cache) : []
		const idsToFetch = [...new Set([...missingIds, ...staleIds])]
		return { missingIds, staleIds, idsToFetch, catalogById }
	}

	mergeSpecialEntries(kind, entries) {
		this.ensureMisc()
		if (kind === "fortress") {
			this.ds.MISC.FORTRESSES = Object.assign({}, this.ds.MISC.FORTRESSES || {}, entries)
		} else if (kind === "endgame") {
			this.ds.MISC.ENDGAMES = Object.assign({}, this.ds.MISC.ENDGAMES || {}, entries)
		} else if (kind === "prolab") {
			this.ds.MISC.PROLABS = Object.assign({}, this.ds.MISC.PROLABS || {}, entries)
		}
		this.trackDbFields(kind)
	}

	async ensureStartingPointMachines() {
		if (this.hasCachedObject(this.ds.MISC?.STARTING_POINT_MACHINES)) return
		this.ds.MISC.STARTING_POINT_MACHINES = await this.api.getAllStartingPointMachines()
		this.mergedDbFields.add("misc")
	}

	async fetchAndMerge(kind, ids, catalogById = null) {
		if (!ids.length) return 0
		let entries = {}
		switch (kind) {
		case "machine": {
			entries = await this.api.getCompleteMachineProfilesByIds(ids)
			await this.ensureStartingPointMachines()
			this.ds.MACHINES = Object.assign({}, this.ds.MACHINES || {}, entries, this.ds.MISC.STARTING_POINT_MACHINES || {})
			break
		}
		case "challenge": {
			entries = await this.api.getCompleteChallengeProfilesByIds(ids)
			if (catalogById) {
				Object.keys(entries).forEach(id => {
					entries[id] = H.combine([catalogById[id], entries[id]])
				})
			}
			this.ds.CHALLENGES = Object.assign({}, this.ds.CHALLENGES || {}, entries)
			break
		}
		case "fortress":
			entries = await this.api.getCompleteFortressesByIds(ids, catalogById ? Object.values(catalogById) : null)
			this.mergeSpecialEntries(kind, entries)
			break
		case "endgame":
			entries = await this.api.getCompleteEndgamesByIds(ids, catalogById ? Object.values(catalogById) : null)
			this.mergeSpecialEntries(kind, entries)
			break
		case "prolab":
			entries = await this.api.getCompleteProlabsByIds(ids, catalogById ? Object.values(catalogById) : null)
			this.mergeSpecialEntries(kind, entries)
			break
		default:
			return 0
		}
		this.trackDbFields(kind)
		return Object.keys(entries).length
	}

	async syncCatalogDelta(kind, { includeStale = false } = {}) {
		const diff = await this.diffCatalog(kind, { includeStale })
		if (!diff.idsToFetch.length) {
			log.info("Catalog delta up to date", {
				kind,
				cached: Object.keys(this.getCatalogCache(kind) || {}).length,
			})
			return { fetched: 0, ...diff }
		}
		log.info("Catalog delta fetching", {
			kind,
			missing: diff.missingIds.length,
			stale: diff.staleIds.length,
			total: diff.idsToFetch.length,
		})
		const fetched = await this.fetchAndMerge(kind, diff.idsToFetch, diff.catalogById)
		return { fetched, ...diff }
	}

	resolveFromCache(type, nameOrId) {
		const kind = this.normalizeTargetType(type)
		const needle = String(nameOrId)
		if (kind === "machine") {
			return /^\d+$/.test(needle)
				? this.ds.getMachineById(needle)
				: this.ds.getMachineByName(needle)
		}
		if (kind === "challenge") {
			return /^\d+$/.test(needle)
				? this.ds.getChallengeById(needle)
				: this.ds.getChallengeByName(needle)
		}
		if (["fortress", "endgame", "prolab"].includes(kind)) {
			return this.ds.getSpecialByName(needle, kind)
		}
		return null
	}

	async withTargetLock(key, fn) {
		while (this.targetLocks.has(key)) {
			await this.targetLocks.get(key)
		}
		let release
		const gate = new Promise(resolve => { release = resolve })
		this.targetLocks.set(key, gate)
		try {
			return await fn()
		} finally {
			this.targetLocks.delete(key)
			release()
		}
	}

	findCatalogEntry(kind, nameOrId, catalog) {
		const needle = String(nameOrId).toLowerCase()
		return catalog.list.find(entry =>
			String(entry.id) === needle || entry.name?.toLowerCase() === needle
		) || null
	}

	async ensureTarget(type, nameOrId, ctx = {}) {
		const kind = this.normalizeTargetType(type)
		if (!CATALOG_KINDS.has(kind) || !nameOrId) return null

		const cached = this.resolveFromCache(type, nameOrId)
		if (cached) return cached

		const lockKey = `${kind}:${String(nameOrId).toLowerCase()}`
		return this.withTargetLock(lockKey, async () => {
			const again = this.resolveFromCache(type, nameOrId)
			if (again) return again

			log.info("ensureTarget fetching", { kind, nameOrId, trigger: ctx.trigger || "on-demand" })
			try {
				let entity = null

				if (kind === "machine") {
					entity = await this.api.buildMachineFromProfileIdentifier(nameOrId)
					if (!entity) {
						const catalog = await this.fetchCatalog(kind)
						const entry = this.findCatalogEntry(kind, nameOrId, catalog)
						if (entry?.id) {
							await this.fetchAndMerge(kind, [String(entry.id)], catalog.byId)
							entity = this.resolveFromCache(type, nameOrId)
						}
					} else {
						this.ds.MACHINES = Object.assign({}, this.ds.MACHINES || {}, { [entity.id]: entity })
						this.trackDbFields(kind)
					}
				} else if (kind === "challenge") {
					let match = null
					if (/^\d+$/.test(String(nameOrId))) {
						match = { id: Number(nameOrId) }
					} else {
						const found = await this.api.searchChallengeByExactName(nameOrId)
						match = found.find(item => item.name?.toLowerCase() === String(nameOrId).toLowerCase()) || found[0]
					}
					if (match?.id) {
						await this.fetchAndMerge(kind, [String(match.id)])
						entity = this.resolveFromCache(type, nameOrId)
					}
				} else {
					const catalog = await this.fetchCatalog(kind)
					const entry = this.findCatalogEntry(kind, nameOrId, catalog)
					if (entry?.id) {
						await this.fetchAndMerge(kind, [String(entry.id)], catalog.byId)
						entity = this.resolveFromCache(type, nameOrId)
					}
				}

				if (entity) {
					this.ds.syncDbExportFields()
					log.info("ensureTarget merged", { kind, id: entity.id, name: entity.name })
				}
				return entity
			} catch (error) {
				log.warn("ensureTarget failed", { kind, nameOrId, message: error.message })
				return null
			}
		})
	}

	teamStatsNeedRefresh(full) {
		if (full || !this.ds.hasCachedTeamStats()) return true
		const updatedAt = this.ds.MISC?.teamStatsUpdatedAt
		if (!updatedAt) return true
		return Date.now() - new Date(updatedAt).getTime() > TEAM_STATS_REFRESH_MS
	}

	async syncTeam({ full = false, force = false, delta = false } = {}) {
		const shouldRefreshTeamStats = this.teamStatsNeedRefresh(full)
		const shouldRefreshAllMembers = full || force
		const ignored = Object.keys(this.ds.TEAM_MEMBERS_IGNORED || {})

		if (process.env.HTB_TEAM_ID) {
			if (shouldRefreshTeamStats) {
				this.ds.TEAM_STATS = await this.api.getCompleteTeamProfile(process.env.HTB_TEAM_ID)
				delete this.ds.TEAM_STATS.weekly
				this.ds.MISC.teamStatsUpdatedAt = new Date().toISOString()
			}
			const membersBase = await this.api.getTeamMembers(process.env.HTB_TEAM_ID, ignored)
			if (shouldRefreshAllMembers) {
				this.ds.TEAM_MEMBERS = await this.api.getCompleteMemberProfilesByMemberPartials(membersBase)
			} else {
				const newMembers = membersBase.filter(member => !this.ds.TEAM_MEMBERS?.[member.id])
				if (newMembers.length) {
					log.info("Fetching new team member profiles", { count: newMembers.length })
					const profiles = await this.api.getCompleteMemberProfilesByMemberPartials(newMembers)
					this.ds.TEAM_MEMBERS = Object.assign({}, this.ds.TEAM_MEMBERS || {}, profiles)
				} else if (delta || !this.hasCachedObject(this.ds.TEAM_MEMBERS)) {
					log.info("No new team members to fetch")
				}
			}
		} else if (process.env.HTB_UNIVERSITY_ID) {
			const membersBase = await this.api.getUniversityMembers(process.env.HTB_UNIVERSITY_ID, ignored)
			if (shouldRefreshAllMembers || !this.hasCachedObject(this.ds.TEAM_MEMBERS)) {
				this.ds.TEAM_MEMBERS = await this.api.getCompleteMemberProfilesByMemberPartials(membersBase)
			} else {
				const newMembers = membersBase.filter(member => !this.ds.TEAM_MEMBERS?.[member.id])
				if (newMembers.length) {
					const profiles = await this.api.getCompleteMemberProfilesByMemberPartials(newMembers)
					this.ds.TEAM_MEMBERS = Object.assign({}, this.ds.TEAM_MEMBERS || {}, profiles)
				}
			}
			if (shouldRefreshTeamStats) {
				const uniProfile = await this.api.getUniversityProfile(process.env.HTB_UNIVERSITY_ID)
				const captain = membersBase.find(member => member.role === "admin") || membersBase[0]
				this.ds.TEAM_STATS = Object.assign({}, uniProfile || {}, {
					avatar_url: `https://www.hackthebox.com/storage/universities/${Number(process.env.HTB_UNIVERSITY_ID)}.png`,
					type: "university",
					captain: captain ? { id: captain.id, name: captain.name } : null,
				})
				this.ds.MISC.teamStatsUpdatedAt = new Date().toISOString()
			}
		} else {
			log.warn("No HTB_TEAM_ID or HTB_UNIVERSITY_ID configured — skipping team data")
		}
		this.trackSectionFields("team")
	}

	syncDialogflowEntities() {
		const names = this.ds.vTM.map(member => member.name.toLowerCase())
		try {
			dFlowEnt.updateEntity(this.ds.getDialogflowSpecialTargetFlagNames(), "specialTargetFlagName")
			dFlowEnt.updateEntity(
				[...new Set([
					this.ds.MISC.FORTRESSES,
					this.ds.MISC.ENDGAMES,
					this.ds.MISC.PROLABS,
				].map(bucket => Object.values(bucket || {})).flat().map(entry => entry?.name).filter(Boolean))],
				"specialTargetName"
			)
			dFlowEnt.updateEntity(
				Object.values(this.ds.MISC.CHALLENGE_CATEGORIES || {}).map(category => category.name),
				"challengeCategoryName"
			)
			dFlowEnt.updateEntity(Object.values(this.ds.MACHINES).map(machine => machine.name), "Machines")
			dFlowEnt.updateEntity(
				Object.values(this.ds.TEAM_MEMBERS).map(member => ({
					value: member.name,
					synonyms: [member.name, ...this.ds.getDiscordUserSynonymsForUid(member.id, names)],
				})),
				"memberName"
			)
			dFlowEnt.updateEntity(Object.values(this.ds.CHALLENGES).map(challenge => challenge.name), "challenge")
		} catch (error) {
			log.warn("Dialogflow entity sync failed", { message: error.message })
		}
	}

	async runSection(section, options = {}) {
		const includeStale = Boolean(options.delta || options.force || options.full || options.bootstrap)
		switch (section) {
		case "machines":
			return this.syncCatalogDelta("machine", { includeStale })
		case "challenges": {
			const result = await this.syncCatalogDelta("challenge", { includeStale })
			if (!this.hasCachedObject(this.ds.MISC?.CHALLENGE_CATEGORIES)) {
				this.ds.MISC.CHALLENGE_CATEGORIES = await this.api.getChallengeCategories()
				this.mergedDbFields.add("misc")
			}
			return result
		}
		case "fortresses":
			return this.syncCatalogDelta("fortress", { includeStale })
		case "endgames":
			return this.syncCatalogDelta("endgame", { includeStale })
		case "prolabs":
			return this.syncCatalogDelta("prolab", { includeStale })
		case "tags":
			if (!this.hasCachedObject(this.ds.MISC?.MACHINE_TAGS)) {
				this.ds.MISC.MACHINE_TAGS = await this.api.getMachineTags()
				this.trackSectionFields("tags")
			}
			return { fetched: 0 }
		case "team":
			await this.syncTeam(options)
			return { fetched: 0 }
		default:
			return { fetched: 0 }
		}
	}

	async runPlan(options = {}) {
		if (Array.isArray(options.targets) && options.targets.length) {
			this.resetMergedDbFields()
			for (const target of options.targets) {
				await this.ensureTarget(target.type, target.name || target.id, {
					trigger: options.trigger || "explicit",
				})
			}
			if (this.mergedDbFields.size) {
				this.ds.syncDbExportFields()
			}
			return { updated: this.mergedDbFields.size > 0, dbFields: this.getMergedDbFields() }
		}

		const sectionsToUpdate = this.resolveSectionsToRun(options)
		const updatePlan = this.describeUpdatePlan(sectionsToUpdate, options)
		if (!sectionsToUpdate.length) {
			log.info("HTB data update skipped — using cached DB data", {
				machines: Object.keys(this.ds.MACHINES || {}).length,
				challenges: Object.keys(this.ds.CHALLENGES || {}).length,
				members: Object.keys(this.ds.TEAM_MEMBERS || {}).length,
				lastUpdate: this.ds.LAST_UPDATE,
			})
			return { updated: false, dbFields: [] }
		}

		if (this.ds.UPDATE_LOCK) {
			log.warn("HTB data update skipped — another update is already in progress")
			return { updated: false, dbFields: [], locked: true }
		}

		this.ds.UPDATE_LOCK = true
		this.resetMergedDbFields()
		this.clearCatalogCache()
		const updateStarted = Date.now()
		this.ds.logUpdateProgress(`HTB data update started (${updatePlan})`)

		try {
			let anyFetched = false
			for (let i = 0; i < sectionsToUpdate.length; i++) {
				const section = sectionsToUpdate[i]
				this.ds.logUpdatePhase(`${i + 1}/${sectionsToUpdate.length}`, `Sync section: ${section}`)
				const result = await this.runSection(section, options)
				if (result?.fetched > 0) anyFetched = true
				this.trackSectionFields(section)
			}

			if (anyFetched || sectionsToUpdate.includes("team") || sectionsToUpdate.includes("tags")) {
				this.syncDialogflowEntities()
			}

			this.ds.LAST_UPDATE = new Date()
			this.ds.MISC.lastUpdate = this.ds.LAST_UPDATE.toISOString()
			this.ds.syncDbExportFields()
			this.ds.logUpdateProgress("HTB data update completed", {
				machines: Object.keys(this.ds.MACHINES || {}).length,
				challenges: Object.keys(this.ds.CHALLENGES || {}).length,
				members: Object.keys(this.ds.TEAM_MEMBERS || {}).length,
				teamName: this.ds.TEAM_STATS?.name || null,
				plan: updatePlan,
				sections: sectionsToUpdate,
				durationMs: Date.now() - updateStarted,
			})
			return { updated: true, dbFields: this.getMergedDbFields() }
		} catch (error) {
			log.error("HTB data update failed", {
				message: error.message,
				stack: error.stack,
				durationMs: Date.now() - updateStarted,
			})
			throw error
		} finally {
			this.ds.UPDATE_LOCK = false
			this.clearCatalogCache()
		}
	}
}

module.exports = {
	HtbSyncEngine,
	UPDATE_SECTION_ORDER,
}
