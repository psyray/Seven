const fs = require("fs")
const path = require("path")
const request = require("superagent")
const Throttle = require("superagent-throttle")
require("superagent-retry-delay")(request)
const { Helpers: H } = require("../helpers/helpers.js")
const { HTB_API_BASE, HTB_API_V5_BASE } = require("../config/htb.js")
const { createLogger } = require("../helpers/logger.js")
const { updateEnvFileOAuthTokens } = require("../helpers/env-tokens.js")

const log = createLogger("htb-api")
const VERBOSE_API_REQUESTS = process.env.HTB_API_LOG_REQUESTS === "true"
const PROGRESS_EVERY = Number(process.env.HTB_LOG_PROGRESS_EVERY) || 25
const MACHINE_PROFILE_CONCURRENCY = Math.max(1, Number(process.env.HTB_MACHINE_PROFILE_CONCURRENCY) || 3)
const MACHINE_LIST_PAGE_SIZE = 100
const RATE_LIMIT_WAIT_LOG_EVERY_MS = Number(process.env.HTB_RATE_LIMIT_LOG_EVERY_MS) || 15000
const RATE_LIMIT_WAIT_THRESHOLD_MS = Number(process.env.HTB_RATE_LIMIT_WAIT_THRESHOLD_MS) || 3000
/** Log each HTB 400 endpoint key once per process to avoid spam. */
const loggedHtb400EndpointKeys = new Set()

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

function getThrottleEndpointKey(endpointPath) {
	if (/^machine\/profile\/[^/]+$/.test(endpointPath)) {
		return "machine/profile/"
	}
	return endpointPath.replace(/\d[^$]*/gm, "").replace(/\/$/, "")
}

function extractPaginatedItems(response) {
	return response?.data ?? response?.message ?? response?.info ?? []
}

function normalizeAvatarPath(avatar) {
	if (!avatar || typeof avatar !== "string") return avatar
	if (avatar.startsWith("http")) {
		const match = avatar.match(/\/avatars\/[^/?#]+/)
		return match ? match[0] : avatar
	}
	return avatar
}

function normalizeV5Creator(creator) {
	if (!creator) return null
	return {
		id: creator.id,
		name: creator.name,
		avatar: creator.avatar,
		isRespected: creator.isRespected,
	}
}

function normalizeV5Machine(raw) {
	const cocreator = raw.cocreators?.[0] || null
	const retired = Boolean(raw.retiredDate) || (typeof raw.state === "string" && raw.state.startsWith("retired"))
	return {
		id: raw.id,
		name: raw.name,
		os: raw.os,
		active: raw.active,
		retired,
		retiredate: raw.retiredDate || null,
		release: raw.releaseDate,
		points: raw.points,
		static_points: retired ? raw.points : (raw.staticPoints ?? raw.points),
		user_owns_count: raw.userOwnsCount,
		root_owns_count: raw.rootOwnsCount,
		free: raw.free,
		authUserInUserOwns: raw.authUserInUserOwns,
		authUserInRootOwns: raw.authUserInRootOwns,
		authUserHasReviewed: raw.authUserHasReviewed,
		stars: raw.rating,
		star: raw.rating,
		difficulty: raw.difficulty,
		difficultyText: raw.difficultyText,
		avatar: normalizeAvatarPath(raw.avatar),
		feedbackForChart: raw.feedbackForChart,
		playInfo: raw.playInfo,
		maker: normalizeV5Creator(raw.firstCreator),
		maker2: normalizeV5Creator(cocreator),
		recommended: raw.recommended,
		sp_flag: raw.spFlag,
		isTodo: raw.todo,
		is_competitive: raw.competitive,
		labels: raw.labels,
		ip: raw.ip,
		state: raw.state,
	}
}

function machineNeedsProfileEnrichment(machine) {
	return Boolean(
		machine.retired
		|| machine.user_owns_count > 0
		|| machine.root_owns_count > 0
	)
}

function extractMachineProfileEnrichment(profile) {
	const info = profile?.info || {}
	return {
		static_points: info.static_points,
		userBlood: info.userBlood,
		rootBlood: info.rootBlood,
		firstUserBloodTime: info.firstUserBloodTime,
		firstRootBloodTime: info.firstRootBloodTime,
		maker: info.maker,
		maker2: info.maker2,
		tester: info.tester,
	}
}

async function mapWithConcurrency(items, mapper, concurrency) {
	const results = new Array(items.length)
	let nextIndex = 0

	async function worker() {
		while (nextIndex < items.length) {
			const current = nextIndex++
			results[current] = await mapper(items[current], current)
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker))
	return results
}

function isHtmlResponse(text) {
	if (!text || typeof text !== "string") return false
	const trimmed = text.trim().toLowerCase()
	return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")
}

const HTB_NO_RETRY_STATUSES = [400, 401, 403, 404, 405, 410, 422]
const TOKEN_EXPIRY_BUFFER_SEC = 120
const HTB_OAUTH_USER_AGENT = process.env.HTB_OAUTH_USER_AGENT || "SevenBot/1.0 (HTB OAuth)"

class HtbTokenExpiredError extends Error {
	constructor(message = "HTB token expired") {
		super(message)
		this.name = "HtbTokenExpiredError"
	}
}

class HtbAuthError extends Error {
	constructor(message = "HTB authentication failed") {
		super(message)
		this.name = "HtbAuthError"
	}
}

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

const OPTIONAL_MEMBER_PROFILE_PATH_PREFIXES = [
	"user/profile/progress/endgame/",
	"user/profile/progress/machines/os/",
]

/** GET endpoints removed or unreliable — return empty data instead of failing sync. */
const OPTIONAL_GET_ENDPOINT_PREFIXES = [
	"team/activity/",
]

const TEAM_ACTIVITY_HYDRATE_DAYS = 90

const loggedOptionalEndpointKeys = new Set()

function extractHtbErrorBody(response) {
	const body = response?.body || {}
	if (typeof body?.message === "string") return body.message.slice(0, 200)
	if (body?.message) return JSON.stringify(body.message).slice(0, 200)
	return (response?.text || "").slice(0, 200)
}

function logHtb400Once(endpointPath, response) {
	if (isOptionalMemberProfilePath(endpointPath) || isOptionalGetEndpoint(endpointPath)) {
		return
	}
	const key = getThrottleEndpointKey(endpointPath)
	if (loggedHtb400EndpointKeys.has(key)) return
	loggedHtb400EndpointKeys.add(key)
	log.warn(`HTB API HTTP 400 for ${endpointPath}`, {
		body: extractHtbErrorBody(response),
	})
}

function optionalEndpointLogKey(endpointPath) {
	if (endpointPath.startsWith("team/activity/")) return "team/activity"
	return getThrottleEndpointKey(endpointPath)
}

function logOptionalEndpointRemovedOnce(endpointPath, status, response) {
	const key = optionalEndpointLogKey(endpointPath)
	if (loggedOptionalEndpointKeys.has(key)) return
	loggedOptionalEndpointKeys.add(key)
	log.warn(`HTB endpoint removed or unavailable (${status}) — continuing without ${key}`, {
		endpoint: key,
		body: extractHtbErrorBody(response),
	})
}

function extractTargetActivityItems(res) {
	return extractTeamActivityItems(res)
}

function parseActivityTimestamp(entry) {
	const raw = entry?.date || entry?.created_at || entry?.updated_at
	if (!raw) return NaN
	return Date.parse(raw)
}

function extractTeamActivityItems(res) {
	if (Array.isArray(res)) return res
	return res?.data || res?.activity || res?.info?.activity || []
}

function nPastDaysFromSinceMs(sinceMs) {
	const msBack = sinceMs ? Math.max(Date.now() - sinceMs, 86400000) : 86400000
	return Math.min(90, Math.max(1, Math.ceil(msBack / 86400000)))
}

function isOptionalMemberProfilePath(endpointPath) {
	return OPTIONAL_MEMBER_PROFILE_PATH_PREFIXES.some(prefix => endpointPath.startsWith(prefix))
}

function isOptionalGetEndpoint(endpointPath) {
	return OPTIONAL_GET_ENDPOINT_PREFIXES.some(prefix => endpointPath.startsWith(prefix))
}

function optionalMemberProfileFallback() {
	return { profile: {} }
}

function optionalGetEndpointFallback(endpointPath) {
	if (endpointPath.startsWith("team/activity/")) {
		return []
	}
	return null
}

function teamActivityItemToMemberEntry(entry) {
	const objectType = String(entry.object_type || "").toLowerCase()
	if (!objectType || !entry.name) return null
	let ownType = entry.type || objectType
	if (objectType === "machine") {
		ownType = String(entry.type || "").toLowerCase() === "root" ? "root" : "user"
	}
	return {
		date: entry.date,
		date_diff: entry.date_diff || null,
		object_type: objectType,
		type: ownType,
		name: entry.name,
		id: entry.id ?? null,
		flag_title: entry.flag_title || null,
		points: entry.points || 0,
		first_blood: Boolean(entry.first_blood),
		machine_avatar: entry.machine_avatar || null,
	}
}

function activityEntryExists(member, entry) {
	if (!Array.isArray(member?.activity) || !entry) return false
	const objectType = entry.object_type
	if (objectType === "machine") {
		return member.activity.some((own) =>
			own.object_type === "machine"
			&& own.type === entry.type
			&& (own.name === entry.name || (entry.id != null && own.id == entry.id))
		)
	}
	if (objectType === "challenge") {
		return member.activity.some((own) =>
			own.object_type === "challenge"
			&& (own.name === entry.name || (entry.id != null && own.id == entry.id))
			&& (!entry.flag_title || own.flag_title === entry.flag_title)
		)
	}
	return member.activity.some((own) =>
		own.object_type === objectType
		&& (own.name === entry.name || (entry.id != null && own.id == entry.id))
		&& (!entry.flag_title || !own.flag_title || own.flag_title === entry.flag_title)
	)
}

function mergeActivityEntry(member, entry) {
	if (!entry) return false
	if (!Array.isArray(member.activity)) member.activity = []
	if (activityEntryExists(member, entry)) return false
	member.activity.push(entry)
	return true
}

function finalizeMemberProfile(results, partial = null) {
	const profiles = results.map((e) => e?.profile || {})
	const merged = partial ? H.combine([partial, ...profiles]) : H.combine(profiles)
	if (!Array.isArray(merged.activity)) merged.activity = []
	return merged
}

function loadOAuthTokensFromFile(filePath) {
	if (!filePath) return null
	try {
		if (!fs.existsSync(filePath)) return null
		const data = JSON.parse(fs.readFileSync(filePath, "utf8"))
		const accessToken = (data.access_token || data.HTB_V4_TOKEN || "").trim()
		const refreshToken = (data.refresh_token || data.HTB_REFRESH_TOKEN || "").trim()
		if (!accessToken || !refreshToken) {
			log.warn("HTB_TOKEN_FILE missing access or refresh token", { path: filePath })
			return null
		}
		return { access_token: accessToken, refresh_token: refreshToken }
	} catch (error) {
		log.warn("Failed to read HTB_TOKEN_FILE", { path: filePath, message: error.message })
		return null
	}
}

function writeJsonAtomic(filePath, payload) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	const tmpPath = `${filePath}.tmp.${process.pid}`
	fs.writeFileSync(tmpPath, payload, { mode: 0o600 })
	fs.renameSync(tmpPath, filePath)
}

class HtbApiConnector {

	constructor() {
		this.API_TOKEN = ""
		this.REFRESH_TOKEN = ""
		this.tokenFilePath = (process.env.HTB_TOKEN_FILE || "").trim()
		this.envFilePath = (process.env.HTB_ENV_FILE || "").trim()
		this._tokenRefreshPromise = null
		this.authFailureLocked = false
		this._oauthMaintenance = false
		this.throttles = {}
		this.rateLimitBuckets = {}
		this.tokenExpiryWarned = false
		this._optionalGetEndpointLogged = new Set()
		this.throttle = new Throttle({
			active: true,
			rate: 25,
			ratePer: 60000,
			concurrent: 1,
		})
	}

	resolveOAuthTokens({ api_token, refresh_token } = {}) {
		const fileTokens = this.tokenFilePath ? loadOAuthTokensFromFile(this.tokenFilePath) : null
		if (fileTokens) {
			return fileTokens
		}

		if (this.tokenFilePath && fs.existsSync(this.tokenFilePath)) {
			log.error("HTB_TOKEN_FILE exists but could not be loaded — fix the file or remove it before falling back to .env", {
				path: this.tokenFilePath,
			})
		}

		const accessToken = (api_token || process.env.HTB_V4_TOKEN || "").trim()
		const refreshToken = (refresh_token || process.env.HTB_REFRESH_TOKEN || "").trim()
		return { access_token: accessToken, refresh_token: refreshToken }
	}

	async init({ api_token, refresh_token } = {}) {
		const tokens = this.resolveOAuthTokens({ api_token, refresh_token })
		const accessToken = tokens.access_token
		const refreshToken = tokens.refresh_token

		if (!accessToken || !refreshToken) {
			throw new Error("Configure HTB_V4_TOKEN and HTB_REFRESH_TOKEN")
		}

		this.API_TOKEN = accessToken
		this.REFRESH_TOKEN = refreshToken
		this.tokenExpiryWarned = false

		const tokenSource = this.tokenFilePath && fs.existsSync(this.tokenFilePath) && loadOAuthTokensFromFile(this.tokenFilePath)
			? "HTB_TOKEN_FILE"
			: "environment"

		if (this.checkTokenExpiring(this.API_TOKEN)) {
			log.info("Access token expiring at startup — refreshing")
			try {
				await this.refreshSessionToken()
			} catch (error) {
				this.authFailureLocked = true
				throw error
			}
		} else if (this.tokenFilePath && !fs.existsSync(this.tokenFilePath)) {
			this.persistOAuthTokens()
		}

		if (!this.tokenFilePath && !this.envFilePath) {
			log.warn("Neither HTB_TOKEN_FILE nor HTB_ENV_FILE is set — OAuth tokens are not persisted across restarts; configure one or update .env manually after each refresh")
		} else if (!this.envFilePath) {
			log.warn("HTB_ENV_FILE is not set — refreshed tokens are saved to HTB_TOKEN_FILE only; set HTB_ENV_FILE to keep .env in sync across restarts")
		}

		log.info("OAuth session loaded", {
			expiresAt: this.getTokenExpiry()?.toISOString() || "unknown",
			source: tokenSource,
		})
	}

	getAuthMode() {
		return "oauth_refresh"
	}

	getTokenExpiry(token = this.API_TOKEN) {
		const payload = parseJwt(token)
		if (!payload?.exp) return null
		return new Date(payload.exp * 1000)
	}

	setOAuthTokens(accessToken, refreshToken, { persist = true } = {}) {
		const access = (accessToken || "").trim()
		const refresh = (refreshToken || "").trim()

		if (!access) {
			throw new HtbAuthError("HTB access token cannot be empty")
		}
		if (!refresh) {
			throw new HtbAuthError("HTB refresh token cannot be empty")
		}
		if (this.checkTokenExpiring(access)) {
			throw new HtbTokenExpiredError("Provided HTB access token is already expired")
		}

		this.API_TOKEN = access
		this.REFRESH_TOKEN = refresh
		this.tokenExpiryWarned = false
		log.info("HTB OAuth tokens updated in memory", { expiresAt: this.getTokenExpiry()?.toISOString() || "unknown" })

		if (persist) {
			this.persistOAuthTokens()
		}
		if (typeof this.onTokensRefreshed === "function") {
			try {
				this.onTokensRefreshed()
			} catch (callbackError) {
				log.warn("onTokensRefreshed callback failed", { message: callbackError.message })
			}
		}
	}

	persistOAuthTokens() {
		if (this.tokenFilePath) {
			try {
				const payload = JSON.stringify({
					access_token: this.API_TOKEN,
					refresh_token: this.REFRESH_TOKEN,
				}, null, 2)
				writeJsonAtomic(this.tokenFilePath, payload)
				log.info("OAuth tokens persisted", { path: this.tokenFilePath })
			} catch (error) {
				log.warn("Failed to persist HTB_TOKEN_FILE", { path: this.tokenFilePath, message: error.message })
			}
		}

		if (this.envFilePath) {
			updateEnvFileOAuthTokens(this.envFilePath, this.API_TOKEN, this.REFRESH_TOKEN)
		}
	}

	async reloadTokensFromFile({ refreshIfExpiring = true } = {}) {
		if (this._oauthMaintenance) return false
		if (!this.tokenFilePath) return false

		const fromFile = loadOAuthTokensFromFile(this.tokenFilePath)
		if (!fromFile) return false

		if (fromFile.access_token === this.API_TOKEN && fromFile.refresh_token === this.REFRESH_TOKEN) {
			return false
		}

		this.API_TOKEN = fromFile.access_token
		this.REFRESH_TOKEN = fromFile.refresh_token
		this.tokenExpiryWarned = false

		if (refreshIfExpiring && this.checkTokenExpiring(this.API_TOKEN)) {
			await this.refreshSessionToken()
		}

		return true
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
		const throttle = this.getThrottle(endpoint)
		throttle.rate = Math.floor((Number(rLimit) || 15) * 0.90)
		if (endpoint === "machine/profile/") {
			throttle.concurrent = MACHINE_PROFILE_CONCURRENCY
		}
		this.rateLimitBuckets[endpoint] = {
			remaining: Number(rLeft),
			max: Number(rLimit) || 60,
			updatedAt: Date.now(),
		}
	}

	logRateLimitWait(endpointPath, endpoint, phase, meta = {}) {
		log.info(`HTB rate limit: ${phase} — ${endpointPath}`, { endpoint, ...meta })
	}

	getApiToken() {
		return this.API_TOKEN
	}

	isAuthBlocked() {
		return this.authFailureLocked
	}

	beginOAuthMaintenance() {
		this._oauthMaintenance = true
	}

	endOAuthMaintenance() {
		this._oauthMaintenance = false
	}

	clearAuthFailureLock() {
		this.authFailureLocked = false
	}

	async awaitRefreshSettled() {
		if (!this._tokenRefreshPromise) return
		try {
			await this._tokenRefreshPromise
		} catch (_) {
			// ignore — caller will start a fresh refresh if needed
		}
	}

	async ensureValidToken() {
		if (this.authFailureLocked) {
			throw new HtbAuthError("HTB OAuth refresh paused after auth failure — run `seven htb token set <refresh>`")
		}
		if (!this.checkTokenExpiring(this.API_TOKEN)) return

		try {
			await this.refreshSessionToken()
		} catch (error) {
			if (!this.tokenExpiryWarned) {
				this.tokenExpiryWarned = true
				log.warn("HTB OAuth refresh failed — re-login on HTB and update HTB_V4_TOKEN + HTB_REFRESH_TOKEN", {
					message: error.message,
				})
			}
			throw error instanceof HtbAuthError ? error : new HtbAuthError(error.message)
		}
	}

	async refreshSessionToken() {
		if (!this._tokenRefreshPromise) {
			const promise = this._refreshSessionTokenOnce()
			this._tokenRefreshPromise = promise
			promise.finally(() => {
				if (this._tokenRefreshPromise === promise) {
					this._tokenRefreshPromise = null
				}
			})
		}
		return this._tokenRefreshPromise
	}

	async forceRefreshSession() {
		await this.awaitRefreshSettled()
		this._tokenRefreshPromise = null
		this.authFailureLocked = false
		return this.refreshSessionToken()
	}

	async refreshWithRefreshToken(refreshToken) {
		const refresh = (refreshToken || "").trim()
		if (!refresh) {
			throw new HtbAuthError("HTB refresh token cannot be empty")
		}
		await this.awaitRefreshSettled()
		this._tokenRefreshPromise = null
		this.authFailureLocked = false
		const backup = {
			access: this.API_TOKEN,
			refresh: this.REFRESH_TOKEN,
		}
		this.REFRESH_TOKEN = refresh
		try {
			await this.refreshSessionToken()
		} catch (error) {
			this.API_TOKEN = backup.access
			this.REFRESH_TOKEN = backup.refresh
			throw error
		}
	}

	async _refreshSessionTokenOnce() {
		const refreshSnapshot = (this.REFRESH_TOKEN || "").trim()
		if (!refreshSnapshot) {
			throw new HtbAuthError("HTB_REFRESH_TOKEN is missing")
		}

		log.info("HTB OAuth refresh request", {
			refreshPrefix: refreshSnapshot.slice(0, 8),
			refreshLen: refreshSnapshot.length,
		})

		const data = await this.htbApiPost("login/refresh", {
			refresh_token: refreshSnapshot,
		}, { authorized: false, oauth: true })

		const payload = data?.message || data
		if (typeof payload === "string") {
			throw new HtbAuthError(`HTB refresh rejected: ${payload.slice(0, 120)}`)
		}
		if (!payload?.access_token) {
			throw new HtbAuthError("HTB refresh failed: no access_token in response")
		}
		if (!payload?.refresh_token) {
			throw new HtbAuthError("HTB refresh failed: no refresh_token in response")
		}

		if (this.REFRESH_TOKEN !== refreshSnapshot) {
			log.warn("HTB OAuth refresh ignored — refresh token superseded during request")
			throw new HtbAuthError("HTB OAuth refresh superseded — retry `seven htb token refresh`")
		}

		this.API_TOKEN = payload.access_token
		this.REFRESH_TOKEN = payload.refresh_token
		this.tokenExpiryWarned = false
		this.authFailureLocked = false
		this.persistOAuthTokens()
		log.info("OAuth session refreshed", { expiresAt: this.getTokenExpiry()?.toISOString() || "unknown" })
		if (typeof this.onTokensRefreshed === "function") {
			try {
				this.onTokensRefreshed()
			} catch (callbackError) {
				log.warn("onTokensRefreshed callback failed", { message: callbackError.message })
			}
		}
	}

	buildAuthHttpError(response, label) {
		const status = response?.status
		const body = response?.body || {}
		const messageText = typeof body?.message === "string"
			? body.message
			: body?.message
				? JSON.stringify(body.message)
				: (response?.text || "").slice(0, 200)

		if (status === 401) {
			if (label.includes("login/refresh")) {
				log.warn("HTB OAuth refresh rejected", { body: messageText || "Unauthenticated." })
			}
			return new HtbAuthError(
				"HTB refresh token rejected — capture a fresh `refresh_token` from DevTools (login/refresh) right after browser login; each successful refresh invalidates the previous one"
			)
		}

		return new HtbAuthError(`HTTP ${status} for ${label}${messageText ? `: ${messageText}` : ""}`)
	}

	async htbApiPost(endpointPath, body, options = {}) {
		const base = options.base || HTB_API_BASE
		const url = `${base}/${endpointPath}`
		const authorized = options.authorized !== false
		const oauth = options.oauth === true

		return new Promise((resolve, reject) => {
			const headers = {
				Accept: "application/json, */*",
				"Content-Type": "application/json",
			}
			if (oauth) {
				headers["User-Agent"] = HTB_OAUTH_USER_AGENT
				headers.Origin = "https://labs.hackthebox.com"
				headers.Referer = "https://labs.hackthebox.com/"
			}

			let req = request.agent()
				.post(url)
				.set(headers)
				.send(body)
				.timeout({ response: 120000, deadline: 240000 })

			if (authorized && this.API_TOKEN) {
				req = req.set({ Authorization: "Bearer " + this.API_TOKEN })
			}

			req.then((response) => {
				if (response.status >= 400) {
					const err = this.buildAuthHttpError(response, `POST ${endpointPath}`)
					err.status = response.status
					err.response = response
					if (oauth && response.status === 401) {
						this.authFailureLocked = true
					}
					return reject(err)
				}

				if (isHtmlResponse(response.text)) {
					const err = new Error(`Non-JSON HTML response for POST ${endpointPath}`)
					err.status = response.status
					return reject(err)
				}

				if (typeof response.body === "string" && isHtmlResponse(response.body)) {
					const err = new Error(`Non-JSON HTML response for POST ${endpointPath}`)
					err.status = response.status
					return reject(err)
				}

				resolve(response.body)
			}).catch((err) => {
				log.error(`POST ${endpointPath} failed`, {
					status: err.status,
					message: err.message,
					body: (err.response?.text || "").slice(0, 200),
				})
				reject(err)
			})
		})
	}

	async htbApiGet(endpointPath, parseText = false, options = {}) {
		try {
			return await this._htbApiGetOnce(endpointPath, parseText, options)
		} catch (error) {
			if ([400, 401, 403].includes(error.status) && isOptionalGetEndpoint(endpointPath)) {
				this.logOptionalGetEndpointOnce(endpointPath, error.status)
				const fallback = optionalGetEndpointFallback(endpointPath)
				if (fallback != null) return fallback
			}
			if (error.status !== 401) {
				throw error
			}
			if (this.authFailureLocked) {
				throw error instanceof HtbAuthError ? error : new HtbAuthError(error.message)
			}
			log.warn("HTB API returned 401 — attempting OAuth refresh", { endpoint: endpointPath })
			try {
				await this.refreshSessionToken()
				return await this._htbApiGetOnce(endpointPath, parseText, options)
			} catch (retryError) {
				if (retryError instanceof HtbAuthError) {
					throw retryError
				}
				if (retryError.status === 401) {
					throw new HtbAuthError(
						`HTB API unauthorized for ${endpointPath} after token refresh — re-login on HTB and update HTB_V4_TOKEN + HTB_REFRESH_TOKEN`
					)
				}
				throw new HtbAuthError(retryError.message || `HTB authentication failed for ${endpointPath}`)
			}
		}
	}

	async _htbApiGetOnce(endpointPath, parseText = false, options = {}) {
		const base = options.base || HTB_API_BASE
		const endpoint = getThrottleEndpointKey(endpointPath)
		await this.ensureValidToken()

		const url = `${base}/${endpointPath}`
		const started = Date.now()
		const bucket = this.rateLimitBuckets[endpoint]
		if (bucket && bucket.remaining <= 0) {
			this.logRateLimitWait(endpointPath, endpoint, "queue slot empty, waiting for HTB bucket refill", {
				rateLimitMax: bucket.max,
				rateLimitRemaining: bucket.remaining,
			})
		}

		let waitHeartbeat = null
		const startWaitHeartbeat = () => {
			waitHeartbeat = setInterval(() => {
				const waitedSec = Math.round((Date.now() - started) / 1000)
				if (waitedSec * 1000 >= RATE_LIMIT_WAIT_THRESHOLD_MS) {
					this.logRateLimitWait(endpointPath, endpoint, `still waiting (${waitedSec}s)`, {
						waitedSec,
					})
				}
			}, RATE_LIMIT_WAIT_LOG_EVERY_MS)
		}
		startWaitHeartbeat()

		const clearWaitHeartbeat = () => {
			if (waitHeartbeat) {
				clearInterval(waitHeartbeat)
				waitHeartbeat = null
			}
		}

		return new Promise((resolve, reject) => {
			request.agent()
				.get(url)
				.set({ Accept: "application/json, */*" })
				.set({ Authorization: "Bearer " + this.API_TOKEN })
				.retry(10, [1000, 3000, 60000], HTB_NO_RETRY_STATUSES)
				.timeout({ response: 120000, deadline: 2400000 })
				.use(this.getThrottle(endpoint).plugin())
				.then((response) => {
					clearWaitHeartbeat()
					const durationMs = Date.now() - started
					const rLimit = H.sAcc(response, "headers", "x-ratelimit-limit") || 60
					const rLeft = H.sAcc(response, "headers", "x-ratelimit-remaining") || 60
					this.updateThrottle(endpoint, rLimit, rLeft)

					if (durationMs >= RATE_LIMIT_WAIT_THRESHOLD_MS) {
						this.logRateLimitWait(endpointPath, endpoint, `request completed after ${Math.round(durationMs / 1000)}s wait`, {
							durationMs,
							rateLimitRemaining: rLeft,
							rateLimitMax: rLimit,
						})
					}

					const requestMeta = {
						status: response.status,
						durationMs,
						rateLimitRemaining: rLeft,
						rateLimitMax: rLimit,
					}
					const optionalError = response.status >= 400
						&& (
							((response.status === 404 || response.status === 400) && isOptionalMemberProfilePath(endpointPath))
							|| ((response.status === 404 || response.status === 400) && isOptionalGetEndpoint(endpointPath))
						)

					if (!optionalError) {
						if (VERBOSE_API_REQUESTS) {
							log.info(`GET ${endpointPath}`, requestMeta)
						} else {
							log.debug(`GET ${endpointPath}`, requestMeta)
						}
					}

					if (response.status >= 400) {
						if (optionalError) {
							logOptionalEndpointRemovedOnce(endpointPath, response.status, response)
							if (isOptionalMemberProfilePath(endpointPath)) {
								return resolve(optionalMemberProfileFallback(endpointPath))
							}
							const fallback = optionalGetEndpointFallback(endpointPath)
							if (fallback != null) return resolve(fallback)
						}
						if (response.status === 400) {
							logHtb400Once(endpointPath, response)
						}
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
					clearWaitHeartbeat()
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
		var tagsArray = (await this.htbApiGet("tags/list")).info
		return (H.arrToObj(tagsArray, "id"))
	}

	getMachineProfile(identifier) {
		return this.htbApiGet(`machine/profile/${encodeURIComponent(identifier)}`)
	}

	async getCompleteMachineProfileById(id) {
		return this.getMachineProfile(id)
	}

	async getMachinesV5(states = ["active", "retired", "unreleased"]) {
		let allMachines = []

		for (const state of states) {
			let currentPage = 1
			let lastPage = 1

			log.info(`Fetching machine pages from v5 /machines`, { state })
			do {
				const query = new URLSearchParams({
					per_page: String(MACHINE_LIST_PAGE_SIZE),
					page: String(currentPage),
					state,
				})
				const response = await this.htbApiGet(`machines?${query}`, false, { base: HTB_API_V5_BASE })
				const pageItems = extractPaginatedItems(response)
				allMachines = allMachines.concat(pageItems)
				lastPage = response?.meta?.last_page ?? 1
				log.info(`Machine page ${currentPage}/${lastPage}`, {
					state,
					pageCount: pageItems.length,
					totalSoFar: allMachines.length,
				})
				currentPage++
			} while (currentPage <= lastPage)
		}

		log.info("Machine list complete", { endpoint: "v5/machines", total: allMachines.length })
		return allMachines.map(normalizeV5Machine)
	}

	async getCurrentMachines() {
		return setTypeForValues("machine", H.arrToObj(
			(await this.getMachinesV5(["active"])),
			"id"
		))
	}

	async getRetiredMachines() {
		return setTypeForValues("machine", H.arrToObj(
			(await this.getMachinesV5(["retired"])),
			"id"
		))
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
		return this.getMachinesV5(["unreleased"]).then(machines => H.arrToObj(machines, "id"))
	}

	async getAllMachinesFast() {
		const machines = await this.getMachinesV5()
		return setTypeForValues("machine", H.arrToObj(machines, "id"))
	}

	async enrichMachineProfile(machine) {
		if (!machineNeedsProfileEnrichment(machine)) {
			return {}
		}

		const profile = await this.getMachineProfile(machine.name || machine.id)
		return extractMachineProfileEnrichment(profile)
	}

	async getAllCompleteMachineProfiles() {
		log.info("Building complete machine profiles (v5 list + targeted v4 profile enrichment)")
		const machines = await this.getAllMachinesFast()
		const entries = Object.values(machines)
		const enrichable = entries.filter(machineNeedsProfileEnrichment)
		log.info("Machine IDs collected", {
			total: entries.length,
			profileFetches: enrichable.length,
			skipped: entries.length - enrichable.length,
		})

		const profileEndpoint = "machine/profile/"
		const profileThrottle = this.getThrottle(profileEndpoint)
		profileThrottle.concurrent = MACHINE_PROFILE_CONCURRENCY
		profileThrottle.rate = Math.max(profileThrottle.rate, 45)

		let done = 0
		const enrichmentsById = {}
		await mapWithConcurrency(enrichable, async (machine) => {
			enrichmentsById[machine.id] = await this.enrichMachineProfile(machine)
			done++
			logBatchProgress("Machine profiles", done, enrichable.length)
		}, MACHINE_PROFILE_CONCURRENCY)

		const profiles = {}
		for (const machine of entries) {
			profiles[machine.id] = H.combine([machine, enrichmentsById[machine.id] || {}])
		}

		log.info("Complete machine profiles ready", {
			count: Object.keys(profiles).length,
			profileFetches: enrichable.length,
		})
		return profiles
	}

	async getCompleteMachineProfilesByIds(machineIds) {
		const ids = machineIds.map(entry => (typeof entry === "object" ? entry.id : entry))
		const machines = await this.getAllMachinesFast()
		const entries = ids.map(id => machines[id]).filter(Boolean)
		const enrichable = entries.filter(machineNeedsProfileEnrichment)

		const profileEndpoint = "machine/profile/"
		const profileThrottle = this.getThrottle(profileEndpoint)
		profileThrottle.concurrent = MACHINE_PROFILE_CONCURRENCY
		profileThrottle.rate = Math.max(profileThrottle.rate, 45)

		let done = 0
		const enrichmentsById = {}
		await mapWithConcurrency(enrichable, async (machine) => {
			enrichmentsById[machine.id] = await this.enrichMachineProfile(machine)
			done++
			logBatchProgress("Machine profiles", done, enrichable.length)
		}, MACHINE_PROFILE_CONCURRENCY)

		const profiles = {}
		for (const machine of entries) {
			profiles[machine.id] = H.combine([machine, enrichmentsById[machine.id] || {}])
		}
		return profiles
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

	async getCompleteFortressById(id, entry = null) {
		let base = entry
		if (!base) {
			const entries = await this.getAllFortressEntries()
			base = entries.find(item => String(item.id) === String(id))
		}
		if (!base) return null
		const profile = await this.getFortressProfile(id)
		return H.combine([base, profile])
	}

	async getCompleteFortressesByIds(ids, entryList = null) {
		const entries = entryList || await this.getAllFortressEntries()
		const byId = H.arrToObj(entries, "id")
		const targets = ids.map(id => byId[id]).filter(Boolean)
		if (!targets.length) return {}
		log.info("Fetching fortress profiles", { count: targets.length })
		let done = 0
		const profiles = {}
		await mapWithConcurrency(targets, async (entry) => {
			profiles[entry.id] = await this.getCompleteFortressById(entry.id, entry)
			done++
			logBatchProgress("Fortress profiles", done, targets.length)
		}, MACHINE_PROFILE_CONCURRENCY)
		log.info("Fortress profiles ready", { count: Object.keys(profiles).length })
		return profiles
	}

	async getAllFortresses() {
		const entries = await this.getAllFortressEntries()
		if (!entries.length) return {}
		return this.getCompleteFortressesByIds(entries.map(entry => entry.id), entries)
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

	async getCompleteEndgameById(id, entry = null) {
		let base = entry
		if (!base) {
			const entries = await this.getAllEndgameEntries()
			base = entries.find(item => String(item.id) === String(id))
		}
		if (!base) return null
		const profile = await this.getEndgameProfile(id)
		const flags = await this.getEndgameFlags(id).then(data => ({ flags: data }))
		return H.combine([base, flags, profile])
	}

	async getCompleteEndgamesByIds(ids, entryList = null) {
		const entries = entryList || await this.getAllEndgameEntries()
		const byId = H.arrToObj(entries, "id")
		const targets = ids.map(id => byId[id]).filter(Boolean)
		if (!targets.length) return {}
		log.info("Fetching endgame profiles and flags", { count: targets.length })
		let done = 0
		const profiles = {}
		await mapWithConcurrency(targets, async (entry) => {
			profiles[entry.id] = await this.getCompleteEndgameById(entry.id, entry)
			done++
			logBatchProgress("Endgame profiles", done, targets.length)
		}, MACHINE_PROFILE_CONCURRENCY)
		log.info("Endgame data ready", { count: Object.keys(profiles).length })
		return profiles
	}

	async getAllEndgames() {
		const entries = await this.getAllEndgameEntries()
		if (!entries.length) {
			log.info("No endgame entries to fetch")
			return {}
		}
		return this.getCompleteEndgamesByIds(entries.map(entry => entry.id), entries)
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

	async getCompleteProlabById(id, entry = null) {
		let base = entry
		if (!base) {
			const entries = await this.getAllProLabEntries()
			base = entries.find(item => String(item.id) === String(id))
		}
		if (!base) return null
		const flags = await this.getProLabFlags(id).then(data => ({ flags: data }))
		const info = await this.getProLabInfo(id)
		const overview = await this.getProLabOverview(id)
		return H.combine([base, flags, info, overview])
	}

	async getCompleteProlabsByIds(ids, entryList = null) {
		const entries = entryList || await this.getAllProLabEntries()
		const byId = H.arrToObj(entries, "id")
		const targets = ids.map(id => byId[id]).filter(Boolean)
		if (!targets.length) return {}
		log.info("Fetching pro lab data", { count: targets.length })
		let done = 0
		const profiles = {}
		await mapWithConcurrency(targets, async (entry) => {
			profiles[entry.id] = await this.getCompleteProlabById(entry.id, entry)
			done++
			logBatchProgress("Pro lab profiles", done, targets.length)
		}, MACHINE_PROFILE_CONCURRENCY)
		log.info("Pro lab data ready", { count: Object.keys(profiles).length })
		return profiles
	}

	async getAllProlabs() {
		const entries = await this.getAllProLabEntries()
		if (!entries.length) {
			log.info("No pro lab entries to fetch")
			return {}
		}
		return this.getCompleteProlabsByIds(entries.map(entry => entry.id), entries)
	}

	async buildMachineFromProfileIdentifier(identifier) {
		try {
			const res = await this.getMachineProfile(identifier)
			const info = res?.info
			if (!info?.id) {
				log.debug("Machine profile not found", { identifier })
				return null
			}
			return H.combine([
				{
					type: "machine",
					id: info.id,
					name: info.name,
					os: info.os,
					active: info.active,
					retired: info.retired,
					retiredate: info.retire_date || info.retiredate || null,
					release: info.release,
					points: info.points,
					static_points: info.static_points,
					difficulty: info.difficulty,
					difficultyText: info.difficultyText,
					avatar: normalizeAvatarPath(info.avatar),
					user_owns_count: info.user_owns_count,
					root_owns_count: info.root_owns_count,
					free: info.free,
					star: info.rating,
					stars: info.rating,
				},
				extractMachineProfileEnrichment(res),
			])
		} catch (error) {
			if (error.status === 404) {
				log.debug("Machine profile not found", { identifier })
				return null
			}
			throw error
		}
	}

	getTeamProfile(teamId) {
		return this.htbApiGet(`team/info/${teamId}`)
	}

	getCompleteTeamProfile(teamId) {
		return Promise.all([
			this.getTeamProfile(teamId),
			this.getTeamOwnStats(teamId),
		]).then(res => H.combine([...res, { type: "team" }]))
	}

	getTeamMembers(teamId, excludedIds = []) {
		return this.htbApiGet(`team/members/${teamId}`)
			.then(res => res?.filter(member => !excludedIds.includes(member.id) && member.role != "pending"))
	}

	getTeamInvitations(teamId) {
		return this.htbApiGet(`team/invitations/${teamId}`)
	}

	getTeamActivity(teamId, { nPastDays = null } = {}) {
		const query = nPastDays ? `?n_past_days=${nPastDays}` : ""
		return this.htbApiGet(`team/activity/${teamId}${query}`)
	}

	getRecentTeamActivity(teamId, sinceMs = null) {
		const nPastDays = sinceMs ? nPastDaysFromSinceMs(sinceMs) : null
		return this.getTeamActivity(teamId, { nPastDays }).then(res => {
			const items = extractTeamActivityItems(res)
			if (!sinceMs) return items
			return items.filter(item => {
				const ts = parseActivityTimestamp(item)
				return Number.isFinite(ts) && ts > sinceMs
			})
		})
	}

	/**
	 * Preferred Pusher fallback: single team/activity call (HTB removed per-user profile/activity in June 2026).
	 * @param {number} teamId
	 * @param {number|null} sinceMs
	 */
	async getRecentTeamActivityForFallback(teamId, sinceMs = null) {
		const items = await this.getRecentTeamActivity(teamId, sinceMs)
		const mapped = []
		for (const entry of items) {
			const uid = entry.user?.id ?? entry.user_id
			if (!uid) continue
			const ts = parseActivityTimestamp(entry)
			mapped.push({
				...entry,
				user_id: Number(uid),
				first_blood: Boolean(entry.first_blood),
				_activityTs: Number.isFinite(ts) ? ts : Date.now(),
			})
		}
		return mapped.sort((a, b) => b._activityTs - a._activityTs)
	}

	/**
	 * Seed member.activity from team/activity (replaces removed user/profile/activity bulk sync).
	 * @param {number} teamId
	 * @param {Object<number, object>} membersMap
	 * @param {{ nPastDays?: number }} [options]
	 * @returns {Promise<{ merged: number, skipped: number }>}
	 */
	async hydrateMemberActivityFromTeamActivity(teamId, membersMap, { nPastDays = TEAM_ACTIVITY_HYDRATE_DAYS } = {}) {
		if (!teamId || !membersMap || !Object.keys(membersMap).length) {
			return { merged: 0, skipped: 0 }
		}
		const sinceMs = Date.now() - (nPastDays * 86400000)
		let items = []
		try {
			items = await this.getRecentTeamActivityForFallback(teamId, sinceMs)
		} catch (error) {
			if ([400, 401, 403].includes(error.status)) {
				log.warn("Team activity hydrate skipped — endpoint unavailable", {
					teamId,
					status: error.status,
					message: error.message,
				})
				return { merged: 0, skipped: 0 }
			}
			throw error
		}

		let merged = 0
		let skipped = 0
		for (const item of items) {
			const uid = Number(item.user_id ?? item.user?.id)
			const member = membersMap[uid]
			if (!member) {
				skipped++
				continue
			}
			const entry = teamActivityItemToMemberEntry(item)
			if (!entry) {
				skipped++
				continue
			}
			if (mergeActivityEntry(member, entry)) merged++
			else skipped++
		}
		if (merged) {
			log.info("Hydrated member activity from team/activity", { merged, skipped, teamId })
		}
		return { merged, skipped }
	}

	getTeamOwnStats(teamId) {
		return this.htbApiGet(`team/stats/owns/${teamId}`)
	}

	getTeamOwnStatsByAttackPath(teamId) {
		return this.htbApiGet(`team/chart/machines/attack/${teamId}`)
	}

	getMachineActivity(machineId) {
		return this.htbApiGet(`machine/activity/${machineId}`)
	}

	getChallengeActivity(challengeId) {
		return this.htbApiGet(`challenge/activity/${challengeId}`)
	}

	async getTargetActivityForTeam(target, teamMemberIds) {
		if (!target?.id || !["machine", "challenge"].includes(target.type)) return []
		const memberSet = new Set((teamMemberIds || []).map(Number))
		if (!memberSet.size) return []

		const fetcher = target.type === "machine"
			? () => this.getMachineActivity(target.id)
			: () => this.getChallengeActivity(target.id)

		try {
			const res = await fetcher()
			const items = extractTargetActivityItems(res)
			const mapped = []
			for (const item of items) {
				const uid = Number(item.user?.id ?? item.user_id)
				if (!memberSet.has(uid)) continue
				const entry = teamActivityItemToMemberEntry(item)
				if (entry) mapped.push({ uid, entry })
			}
			return mapped
		} catch (error) {
			if ([400, 401, 403, 404].includes(error.status)) {
				log.warn("Target activity fetch unavailable", {
					type: target.type,
					id: target.id,
					status: error.status,
				})
				return []
			}
			throw error
		}
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

	getMemberIdFromUsername(username = "ThisUserCouldNotPossiblyExist") {
		const name = (username || "").trim()
		if (!/^[a-zA-Z0-9_]{2,30}$/.test(name)) {
			return Promise.resolve(null)
		}
		const query = encodeURIComponent(name)
		return this.htbApiGet(`search/fetch?query=${query}&tags=[%22users%22]`, true)
			.then(res => (res.users ? res.users[0].id : null))
			.catch(err => {
				if (err.status === 400 || err.status === 404) return null
				throw err
			})
	}

	getMemberProfile(memberId) {
		return this.htbApiGet("user/profile/basic/" + memberId)
	}

	getCompleteMemberProfileById(memberId) {
		if (!memberId) return null
		return Promise.all([
			this.getMemberProfile(memberId),
			this.getMemberMachineOsProgress(memberId),
			this.getMemberChallengeProgress(memberId),
			this.getMemberEndgameProgress(memberId),
			this.getMemberFortressProgress(memberId),
			this.getMemberProlabProgress(memberId),
		]).then((results) => finalizeMemberProfile(results))
	}

	getCompleteMemberProfileByMemberPartial(member) {
		return Promise.all([
			this.getMemberProfile(member.id),
			this.getMemberMachineOsProgress(member.id),
			this.getMemberChallengeProgress(member.id),
			this.getMemberEndgameProgress(member.id),
			this.getMemberFortressProgress(member.id),
			this.getMemberProlabProgress(member.id),
		]).then((results) => finalizeMemberProfile(results, member))
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

	getOAuthTokenStatus() {
		const accessToken = (this.API_TOKEN || "").trim()
		const refreshToken = (this.REFRESH_TOKEN || "").trim()
		const hasAccessToken = Boolean(accessToken)
		const hasRefreshToken = Boolean(refreshToken)
		const expiry = hasAccessToken ? this.getTokenExpiry(accessToken) : null
		const nowMs = Date.now()
		const msUntilExpiry = expiry ? expiry.getTime() - nowMs : null
		const expired = !hasAccessToken || !expiry || msUntilExpiry <= 0
		const expiringSoon = !expired && this.checkTokenExpiring(accessToken)

		let persistenceSource = "environment"
		if (this.tokenFilePath && fs.existsSync(this.tokenFilePath)) {
			persistenceSource = this.envFilePath ? "HTB_TOKEN_FILE + HTB_ENV_FILE" : "HTB_TOKEN_FILE"
		} else if (this.envFilePath) {
			persistenceSource = "HTB_ENV_FILE"
		}

		return {
			authMode: this.getAuthMode(),
			hasAccessToken,
			hasRefreshToken,
			accessExpiresAt: expiry?.toISOString() || null,
			accessExpiresAtUtc: expiry?.toUTCString() || null,
			msUntilExpiry: expired ? 0 : msUntilExpiry,
			expired,
			expiringSoon,
			expiryBufferSec: TOKEN_EXPIRY_BUFFER_SEC,
			persistenceSource,
			tokenFilePath: this.tokenFilePath || null,
			envFilePath: this.envFilePath || null,
		}
	}

	checkTokenExpiring(token) {
		const payload = parseJwt(token)
		if (!payload?.exp) return true
		return payload.exp < Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_BUFFER_SEC
	}

	logOptionalGetEndpointOnce(endpointPath, status) {
		const key = getThrottleEndpointKey(endpointPath)
		if (this._optionalGetEndpointLogged.has(key)) return
		this._optionalGetEndpointLogged.add(key)
		log.warn(`Optional HTB endpoint unavailable (${status}) — returning empty`, { endpoint: endpointPath })
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
	HtbApiConnector,
	HtbTokenExpiredError,
	HtbAuthError,
	parseJwt,
	loadOAuthTokensFromFile,
	mergeActivityEntry,
	activityEntryExists,
	teamActivityItemToMemberEntry,
	__test__: {
		optionalMemberProfileFallback,
		isOptionalMemberProfilePath,
		isOptionalGetEndpoint,
		optionalGetEndpointFallback,
		optionalEndpointLogKey,
		teamActivityItemToMemberEntry,
		activityEntryExists,
		mergeActivityEntry,
	},
}
