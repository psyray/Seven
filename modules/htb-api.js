const request = require("superagent")
const Throttle = require("superagent-throttle")
require("superagent-retry-delay")(request)
const { Helpers: H } = require("../helpers/helpers.js")
const { HTB_API_BASE } = require("../config/htb.js")
const { createLogger } = require("../helpers/logger.js")

const log = createLogger("htb-api")
const VERBOSE_API_REQUESTS = process.env.HTB_API_LOG_REQUESTS === "true"
const PROGRESS_EVERY = Number(process.env.HTB_LOG_PROGRESS_EVERY) || 25

function logBatchProgress(label, current, total) {
	if (current === 1 || current === total || current % PROGRESS_EVERY === 0) {
		const pct = total ? Math.round((current / total) * 100) : 0
		log.info(`${label}: ${current}/${total} (${pct}%)`)
	}
}

const setTypeForValues = (type, objectMap) => {
	Object.keys(objectMap).map(key => (objectMap[key].type = type))
	return objectMap
}

function extractPaginatedItems(response) {
	return response?.data ?? response?.message ?? response?.info ?? []
}

function isHtmlResponse(text) {
	if (!text || typeof text !== "string") return false
	const trimmed = text.trim().toLowerCase()
	return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")
}

const HTB_NO_RETRY_STATUSES = [400, 401, 403, 404, 405, 410, 422]

function extractListData(response) {
	const data = response?.data ?? response?.message ?? response?.info
	if (Array.isArray(data)) return data
	if (data && typeof data === "object") return Object.values(data)
	return []
}

async function fetchOptionalList(api, endpointPath, label) {
	try {
		const response = await api.htbApiGet(endpointPath)
		return extractListData(response)
	} catch (error) {
		if (error.status === 404) {
			log.warn(`${label} API unavailable (404) — skipping`, { endpoint: endpointPath })
			return []
		}
		throw error
	}
}

class HtbApiConnector {

	constructor() {
		this.API_TOKEN = ""
		this.throttles = {}
		this.tokenExpiryWarned = false
		this.throttle = new Throttle({
			active: true,
			rate: 25,
			ratePer: 60000,
			concurrent: 1,
		})
	}

	async init({ api_token }) {
		if (!api_token) {
			throw new Error("HTB_V4_TOKEN must be configured")
		}
		this.API_TOKEN = api_token
		if (this.checkTokenExpiring(api_token)) {
			log.warn("HTB_V4_TOKEN is expired or expiring soon. Regenerate it on app.hackthebox.com.")
		}
	}

	getThrottle(endpoint) {
		if (!this.throttles[endpoint]) {
			this.throttles[endpoint] = new Throttle({
				active: true,
				rate: 10,
				ratePer: 60000,
				concurrent: 1,
			})
			log.debug(`Added throttling for endpoint ${endpoint}`)
		}
		return this.throttles[endpoint]
	}

	updateThrottle(endpoint, rLimit, rLeft) {
		this.getThrottle(endpoint).rate = Math.floor((Number(rLimit) || 15) * 0.90)
	}

	async refreshTokenIfNeeded() {
		if (!this.checkTokenExpiring(this.API_TOKEN)) return

		if (!this.tokenExpiryWarned) {
			this.tokenExpiryWarned = true
			log.warn("HTB_V4_TOKEN is expiring — regenerate it on app.hackthebox.com and restart the bot.")
		}

		throw new Error("HTB_V4_TOKEN expired. Regenerate it on app.hackthebox.com and restart the bot.")
	}

	async htbApiGet(endpointPath, parseText = false) {
		const endpoint = endpointPath.replace(/\d[^$]*/gm, "").replace(/\/$/, "")
		await this.refreshTokenIfNeeded()

		const url = `${HTB_API_BASE}/${endpointPath}`
		const started = Date.now()

		return new Promise((resolve, reject) => {
			request.agent()
				.get(url)
				.set({ Accept: "application/json, */*" })
				.set({ Authorization: "Bearer " + this.API_TOKEN })
				.retry(10, [1000, 3000, 60000], HTB_NO_RETRY_STATUSES)
				.timeout({ response: 120000, deadline: 2400000 })
				.use(this.getThrottle(endpoint).plugin())
				.then((response) => {
					const durationMs = Date.now() - started
					const rLimit = H.sAcc(response, "headers", "x-ratelimit-limit") || 60
					const rLeft = H.sAcc(response, "headers", "x-ratelimit-remaining") || 60
					this.updateThrottle(endpoint, rLimit, rLeft)

					const requestMeta = {
						status: response.status,
						durationMs,
						rateLimitRemaining: rLeft,
						rateLimitMax: rLimit,
					}
					if (VERBOSE_API_REQUESTS) {
						log.info(`GET ${endpointPath}`, requestMeta)
					} else {
						log.debug(`GET ${endpointPath}`, requestMeta)
					}

					if (response.status >= 400) {
						const err = new Error(`HTTP ${response.status} for ${endpointPath}`)
						err.status = response.status
						err.response = response
						return reject(err)
					}

					if (isHtmlResponse(response.text)) {
						const err = new Error(`Non-JSON HTML response for ${endpointPath} (check HTB_V4_TOKEN and HTB_API_BASE — use https://labs.hackthebox.com/api/v4)`)
						log.error(err.message, { status: response.status, url })
						return reject(err)
					}

					if (parseText) {
						try {
							return resolve(JSON.parse(response.text))
						} catch (error) {
							log.error(`JSON parse failed for ${endpointPath}`, { body: (response.text || "").slice(0, 200) })
							return reject(error)
						}
					}

					if (typeof response.body === "string" && isHtmlResponse(response.body)) {
						const err = new Error(`Non-JSON HTML response for ${endpointPath} (check HTB_V4_TOKEN and HTB_API_BASE — use https://labs.hackthebox.com/api/v4)`)
						log.error(err.message, { status: response.status, url })
						return reject(err)
					}

					resolve(response.body)
				})
				.catch((err) => {
					const durationMs = Date.now() - started
					log.error(`GET ${endpointPath} failed`, {
						status: err.status,
						durationMs,
						message: err.message,
						body: (err.response?.text || "").slice(0, 200),
					})
					reject(err)
				})
		})
	}

	async getMachineTags() {
		var tagsArray = (await this.htbApiGet("machine/tags/list")).info
		return (H.arrToObj(tagsArray, "id"))
	}

	async getCompleteMachineProfileById(id) {
		return this.htbApiGet(`machine/profile/${id}`)
	}

	async getCurrentMachines() {
		return setTypeForValues("machine", H.arrToObj(await this.getMachines("machine/paginated"), "id"))
	}

	async getRetiredMachines() {
		return setTypeForValues("machine", H.arrToObj(await this.getMachines("machine/list/retired/paginated"), "id"))
	}

	async getMachines(endpoint) {
		let allMachines = []
		const perPage = 100
		let currentPage = 1
		let lastPage = 1

		log.info(`Fetching machine pages from ${endpoint}`)
		do {
			const response = await this.htbApiGet(`${endpoint}?per_page=${perPage}&page=${currentPage}`)
			const pageItems = extractPaginatedItems(response)
			allMachines = allMachines.concat(pageItems)
			lastPage = response?.meta?.last_page ?? 1
			log.info(`Machine page ${currentPage}/${lastPage}`, { endpoint, pageCount: pageItems.length, totalSoFar: allMachines.length })
			currentPage++
		} while (currentPage <= lastPage)

		log.info(`Machine list complete`, { endpoint, total: allMachines.length })
		return allMachines
	}

	async getStartingPointMachinesForTier(tierNumber) {
		const response = await this.htbApiGet(`sp/tier/${tierNumber}`)
		return response?.data ?? response ?? null
	}

	async getAllStartingPointMachines() {
		log.info("Fetching starting point machines (tiers 1-3)")
		const tiers = await Promise.all([1, 2, 3].map(tier => this.getStartingPointMachinesForTier(tier)))
		const machines = tiers
			.filter(tier => tier?.machines?.length)
			.flatMap(tier => tier.machines.map(machine => Object.assign({
				tier: { id: tier.id, name: tier.name, description: tier.description },
			}, machine)))
		return setTypeForValues("sp_machine", H.arrToObj(machines, "id"))
	}

	getRecommendedMachineCards() {
		return this.htbApiGet("machine/recommended").then(
			cards => {
				var processed = [cards.card1, cards.card2 || null]
				cards.state.forEach((e, idx) => processed[idx]["state"] = e)
				return processed
			}
		)
	}

	getComingMachine() {
		return this.getRecommendedMachineCards().then(
			cards => {
				var newMachineCard = cards.find(card => card.state == "coming")
				if (newMachineCard) {
					delete newMachineCard.state
					return setTypeForValues("machine", H.arrToObj([newMachineCard], "id"))
				} else {
					return {}
				}
			}
		)
	}

	getUnreleasedMachines() {
		return this.htbApiGet(`machine/unreleased/`).then(e => H.arrToObj(e?.data || [], "id"))
	}

	async getAllMachinesFast() {
		var retired = await this.getRetiredMachines()
		var current = await this.getCurrentMachines()
		var coming = await this.getUnreleasedMachines()
		return { ...retired, ...current, ...coming }
	}

	async getAllCompleteMachineProfiles() {
		log.info("Building complete machine profiles (list + per-machine detail)")
		var machines = await this.getAllMachinesFast()
		const ids = Object.values(machines).map(machine => machine.id)
		log.info("Machine IDs collected", { count: ids.length })
		return this.getCompleteMachineProfilesByIds(ids).then(profiles => {
			Object.keys(profiles).map(mId => profiles[mId] = H.combine([machines[mId], profiles[mId]]))
			log.info("Complete machine profiles ready", { count: Object.keys(profiles).length })
			return profiles
		})
	}

	async getCompleteMachineProfilesByIds(machineIds) {
		const total = machineIds.length
		let done = 0
		log.info(`Fetching machine profiles`, { total })
		const machines = await Promise.all(machineIds.map(async (id) => {
			const profile = await this.getCompleteMachineProfileById(id)
			done++
			logBatchProgress("Machine profiles", done, total)
			return profile
		}))
		return setTypeForValues("machine", H.arrToObj(machines.map(e => e.info), "id"))
	}

	searchChallengeByExactName(name) {
		return this.htbApiGet(`search/fetch?query=${name}&tags=%5B%22challenges%22%5D`, true).then(res => {
			log.debug(res.challenges ? `Challenge found: ${name}` : `Challenge not found: ${name}`)
			return (res.challenges ? res.challenges : [])
		})
	}

	async getCurrentChallenges() {
		return setTypeForValues("challenge", H.arrToObj((await this.htbApiGet("challenge/list")).challenges, "id"))
	}

	async getRetiredChallenges() {
		return setTypeForValues("challenge", H.arrToObj((await this.htbApiGet("challenge/list/retired")).challenges, "id"))
	}

	async getAllChallengesFast() {
		var retired = await this.getRetiredChallenges()
		var current = await this.getCurrentChallenges()
		return { ...retired, ...current }
	}

	async getCompleteChallengeProfileById(id) {
		return this.htbApiGet(`challenge/info/${id}`)
	}

	async getCompleteChallengeProfilesByIds(challengeIds) {
		const total = challengeIds.length
		let done = 0
		log.info(`Fetching challenge profiles`, { total })
		const challenges = await Promise.all(challengeIds.map(async (id) => {
			const profile = await this.getCompleteChallengeProfileById(id)
			done++
			logBatchProgress("Challenge profiles", done, total)
			return profile
		}))
		return setTypeForValues("challenge", H.arrToObj(challenges.map(e => e.challenge), "id"))
	}

	async getAllCompleteChallengeProfiles() {
		log.info("Building complete challenge profiles (list + per-challenge detail)")
		var challenges = await this.getAllChallengesFast()
		const ids = Object.values(challenges).map(challenge => challenge.id)
		log.info("Challenge IDs collected", { count: ids.length })
		return this.getCompleteChallengeProfilesByIds(ids).then(profiles => {
			Object.keys(profiles).map(cId => profiles[cId] = H.combine([challenges[cId], profiles[cId]]))
			log.info("Complete challenge profiles ready", { count: Object.keys(profiles).length })
			return profiles
		})
	}

	getChallengeCategories() {
		return this.htbApiGet("challenge/categories/list").then(res => H.arrToObj(res.info, "id"))
	}

	async getAllFortressEntries() {
		return fetchOptionalList(this, "fortresses", "Fortresses")
	}

	async getFortressProfile(id) {
		return this.htbApiGet(`fortress/${id}`).then(e => Object.assign(e.data, { type: "fortress" }))
	}

	async getAllFortresses() {
		let entries = await this.getAllFortressEntries()
		log.info("Fetching fortress profiles", { count: entries.length })
		let profiles = await Promise.all(entries.map(entry => this.getFortressProfile(entry.id)))
		log.info("Fortress profiles ready", { count: profiles.length })
		return H.arrToObj(entries.map((e, i) => H.combine([e, profiles[i]])), "id")
	}

	async getAllEndgameEntries() {
		return fetchOptionalList(this, "endgames", "Endgames")
	}

	async getEndgameProfile(id) {
		return this.htbApiGet(`endgame/${id}`).then(e => Object.assign(e.data, { type: "endgame" }))
	}

	async getEndgameFlags(id) {
		return this.htbApiGet(`endgame/${id}/flags`).then(e => e.data)
	}

	async getAllEndgames() {
		let entries = await this.getAllEndgameEntries()
		if (!entries.length) {
			log.info("No endgame entries to fetch")
			return {}
		}
		log.info("Fetching endgame profiles and flags", { count: entries.length })
		let profiles = await Promise.all(entries.map(entry => this.getEndgameProfile(entry.id)))
		let flags = await Promise.all(entries.map(entry => this.getEndgameFlags(entry.id)
			.then(flags => ({ flags: flags }))
		))
		log.info("Endgame data ready", { count: entries.length })
		return H.arrToObj(entries.map((e, i) => H.combine([e, flags[i], profiles[i]])), "id")
	}

	async getAllProLabEntries() {
		try {
			const response = await this.htbApiGet("prolabs")
			const labs = response?.data?.labs
			return Array.isArray(labs) ? labs : []
		} catch (error) {
			if (error.status === 404) {
				log.warn("Pro labs API unavailable (404) — skipping")
				return []
			}
			throw error
		}
	}

	async getProLabFlags(id) {
		return this.htbApiGet(`prolab/${id}/flags`).then(e => Object.assign(e.data, { type: "prolab" }))
	}

	async getProLabInfo(id) {
		return this.htbApiGet(`prolab/${id}/info`).then(e => Object.assign(e.data, { type: "prolab" }))
	}

	async getProLabOverview(id) {
		return this.htbApiGet(`prolab/${id}/overview`).then(e => Object.assign(e.data, { type: "prolab" }))
	}

	async getAllProlabs() {
		let entries = await this.getAllProLabEntries()
		if (!entries.length) {
			log.info("No pro lab entries to fetch")
			return {}
		}
		log.info("Fetching pro lab data", { count: entries.length })
		let flags = await Promise.all(entries.map(entry => this.getProLabFlags(entry.id)
			.then(flags => ({ flags: flags }))
		))
		let infos = await Promise.all(entries.map(entry => this.getProLabInfo(entry.id)))
		let overviews = await Promise.all(entries.map(entry => this.getProLabOverview(entry.id)))
		log.info("Pro lab data ready", { count: entries.length })
		return H.arrToObj(entries.map((e, i) => H.combine([e, flags[i], infos[i], overviews[i]])), "id")
	}

	getTeamProfile(teamId) {
		return this.htbApiGet(`team/info/${teamId}`)
	}

	getCompleteTeamProfile(teamId) {
		return Promise.all([this.getTeamProfile(teamId),
		this.getTeamOwnStats(teamId),
		this.getTeamStatsGraphForDuration(teamId, "1W").then(res => ({ respects: res.respect.pop() }))]
		).then(res => H.combine([...res, { type: "team" }]))
	}

	getTeamMembers(teamId, excludedIds = []) {
		return this.htbApiGet(`team/members/${teamId}`)
			.then(res => res?.filter(member => !excludedIds.includes(member.id) && member.role != "pending"))
	}

	getTeamInvitations(teamId) {
		return this.htbApiGet(`team/invitations/${teamId}`)
	}

	getTeamActivity(teamId) {
		return this.htbApiGet(`team/activity/${teamId}`)
	}

	getTeamOwnStats(teamId) {
		return this.htbApiGet(`team/stats/owns/${teamId}`)
	}

	getTeamOwnStatsByAttackPath(teamId) {
		return this.htbApiGet(`team/chart/machines/attack/${teamId}`)
	}

	getTeamStatsGraphForDuration(teamId, duration = "1Y") {
		return this.htbApiGet(`team/graph/${teamId}?duration=${duration}`).then(res => res.data)
	}

	getSelfTeamRankHistory(period = "1Y") {
		return this.htbApiGet(`rankings/team/best?period=${period}`).then(res => res.data)
	}

	getSelfTeamPointsHistory(period = "1Y") {
		return this.htbApiGet(`rankings/team/overview?period=${period}`).then(res => res.data)
	}

	getSelfTeamRankOverview() {
		return this.htbApiGet("rankings/team/ranking_bracket").then(res => res.data)
	}

	getTopHundredTeams() {
		return this.htbApiGet("rankings/teams").then(res => res.data)
	}

	getUniversityProfile(universityId) {
		return this.getUniversityProfileById(universityId)
			.catch(() => this.htbApiGet("rankings/universities")
				.then(e => Object.values(e.data).find(uni => uni.id == universityId) || null))
	}

	getUniversityProfileById(universityId) {
		return this.htbApiGet(`university/profile/${universityId}`)
			.then(res => res?.data ?? res?.profile ?? res)
	}

	getUniversityMembers(universityId, excludedIds = []) {
		return this.htbApiGet(`university/members/${universityId}`)
			.then(res => {
				const members = res?.data ?? res?.message ?? res ?? []
				if (!Array.isArray(members)) return []
				return members.filter(member => !excludedIds.includes(member.id) && member.role != "pending")
			})
	}

	getApiToken() {
		return this.API_TOKEN
	}

	getMemberIdFromUsername(username = "ThisUserCouldNotPossiblyExist") {
		return this.htbApiGet(`search/fetch?query=${username}&tags=[%22users%22]`, true).then(res => (res.users ? res.users[0].id : null))
	}

	getMemberProfile(memberId) {
		return this.htbApiGet("user/profile/basic/" + memberId)
	}

	getCompleteMemberProfileById(memberId) {
		if (!memberId) return null
		return Promise.all([
			this.getMemberProfile(memberId),
			this.getMemberActivity(memberId),
			this.getMemberMachineOsProgress(memberId),
			this.getMemberChallengeProgress(memberId),
			this.getMemberEndgameProgress(memberId),
			this.getMemberFortressProgress(memberId),
			this.getMemberProlabProgress(memberId),
			this.getMemberBloods(memberId)
		]).then((results) => H.combine(results.map(e => e.profile)))
	}

	getCompleteMemberProfileByMemberPartial(member) {
		return Promise.all([
			this.getMemberProfile(member.id),
			this.getMemberActivity(member.id),
			this.getMemberMachineOsProgress(member.id),
			this.getMemberChallengeProgress(member.id),
			this.getMemberEndgameProgress(member.id),
			this.getMemberFortressProgress(member.id),
			this.getMemberProlabProgress(member.id),
			this.getMemberBloods(member.id)
		]).then((results) => H.combine([member, ...results.map(e => e.profile)]))
	}

	getCompleteMemberProfilesByIds(memberIds) {
		return Promise.all(memberIds.map(id => this.getCompleteMemberProfileById(id)))
			.then(results => setTypeForValues("member", H.arrToObj(results, "id")))
	}

	async getCompleteMemberProfilesByMemberPartials(members) {
		const total = members.length
		let done = 0
		log.info("Fetching complete team member profiles", { total })
		const results = await Promise.all(members.map(async (member) => {
			const profile = await this.getCompleteMemberProfileByMemberPartial(member)
			done++
			logBatchProgress("Team member profiles", done, total)
			return profile
		}))
		log.info("Team member profiles ready", { count: results.length })
		return setTypeForValues("member", H.arrToObj(results, "id"))
	}

	getMemberAchievementChart(memberId, term) {
		return this.htbApiGet(`user/profile/graph/${term}/${memberId}`)
	}

	getMemberMachineOsProgress(memberId) {
		return this.htbApiGet(`user/profile/progress/machines/os/${memberId}`)
	}

	getMemberChallengeProgress(memberId) {
		return this.htbApiGet(`user/profile/progress/challenges/${memberId}`)
	}

	getMemberEndgameProgress(memberId) {
		return this.htbApiGet(`user/profile/progress/endgame/${memberId}`)
	}

	getMemberFortressProgress(memberId) {
		return this.htbApiGet(`user/profile/progress/fortress/${memberId}`)
	}

	getMemberProlabProgress(memberId) {
		return this.htbApiGet(`user/profile/progress/prolab/${memberId}`)
	}

	getMemberBloods(memberId) {
		return this.htbApiGet(`user/profile/bloods/${memberId}`)
	}

	getMachineAttackDataChart(memberId) {
		return this.htbApiGet(`user/profile/chart/machines/attack/${memberId}`)
	}

	async getMemberProfiles(memberIds) {
		const results = await Promise.all(memberIds.map(id => this.htbApiGet("user/profile/basic/" + id)))
		const TEAM_MEMBERS_TEMP = {}
		results.forEach((memberProfile) => {
			TEAM_MEMBERS_TEMP[Number(memberProfile.profile.id)] = memberProfile.profile
		})
		return setTypeForValues("user", TEAM_MEMBERS_TEMP)
	}

	async getMemberActivities(memberIds) {
		const results = await Promise.all(memberIds.map(id => this.htbApiGet("user/profile/activity/" + id)))
		const TEAM_MEMBERS_ACTIVITIES = {}
		results.forEach((memberProfile, idx) => {
			TEAM_MEMBERS_ACTIVITIES[Number(memberIds[idx])] = memberProfile.profile.activity
		})
		return TEAM_MEMBERS_ACTIVITIES
	}

	async getMemberActivity(memberId) {
		return this.htbApiGet("user/profile/activity/" + memberId)
	}

	checkTokenExpiring(token) {
		const payload = parseJwt(token)
		if (!payload?.exp) return true
		return payload.exp < Math.floor(Date.now() / 1000) + 120
	}
}

function parseJwt(token) {
	if (token) {
		try {
			const base64Url = token.split(".")[1]
			const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
			const buff = new Buffer.from(base64, "base64")
			const payloadinit = buff.toString("ascii")
			return JSON.parse(payloadinit)
		} catch (e) {
			log.error("Failed to parse JWT", { message: e.message })
			return null
		}
	}
	return null
}

module.exports = {
	HtbApiConnector: HtbApiConnector
}
