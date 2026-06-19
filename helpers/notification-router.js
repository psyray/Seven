/**
 * Routes HTB Pusher events and fallback team activity to Discord announce channel.
 * @module Notification-Router
 */
const { createLogger } = require("./logger.js")
const { getPusherNotificationConfig } = require("./pusher-config.js")
const { wait } = require("./helpers.js")

const log = createLogger("notification-router")

const OWN_TYPES = new Set([
	"machine", "challenge", "endgame", "fortress", "prolab", "starting_point",
])

const OWN_TYPE_LIST = [...OWN_TYPES]
const SYNC_DEFAULT_PUBLISH_LIMIT = 5
const SYNC_DEFAULT_DAYS = 7
const SYNC_MAX_DAYS = 90
const SYNC_BOOTSTRAP_KEY_DAYS = 90
const SYNC_SEND_MAX_RETRIES = 3

/** Ignore brief Pusher websocket blips shorter than this. */
const PUSHER_CATCHUP_MIN_DOWN_MS = 15000
/** Alert admins only if Pusher stays unhealthy this long. */
const PUSHER_DISCONNECT_ALERT_MS = 60000

class NotificationRouter {
	/**
	 * @param {object} options
	 * @param {import("../models/SevenDatastore.js").SevenDatastore} options.dat
	 * @param {import("../views/embeds.js").HtbEmbeds} options.embeds
	 * @param {Function} options.getAnnounceChannel
	 * @param {Function} options.updateCache
	 * @param {Function} options.notifyAdmins
	 * @param {Function} [options.getTeamId]
	 * @param {import("./notification-store.js").NotificationStore} [options.notificationStore]
	 */
	constructor({ dat, embeds, getAnnounceChannel, updateCache, notifyAdmins, getTeamId, notificationStore }) {
		this.dat = dat
		this.embeds = embeds
		this.getAnnounceChannel = getAnnounceChannel
		this.updateCache = updateCache
		this.notifyAdmins = notifyAdmins
		this.getTeamId = getTeamId || (() => dat.TEAM_STATS?.id)
		this.notificationStore = notificationStore || null
		this.config = getPusherNotificationConfig()
		this.pendingQueue = []
		this.lastEvents = []
		this.pusherState = "unknown"
		this.fallbackWatermark = Date.now()
		this.cacheDebounceTimer = null
		this.fallbackPollTimer = null
		this.launchDebounce = new Set()
		this.pusherHealthy = true
		this.lastFallbackPollAt = null
		this.lastFallbackError = null
		this.pusherDisconnectedAt = null
		this.pusherDisconnectTimer = null
		this.pusherAdminAlertSent = false
		this.fallbackTeamActivityFailedLogged = false
		this.fallbackMemberActivityFailedLogged = false
		/** Owns already posted to Discord (independent of HTB cache / force-update). */
		this.announcedOwnKeys = new Set()
		this.lastFallbackPollStats = null
		this.lastThrottledSendAt = 0
		this.syncCacheDirty = false
	}

	ownAnnouncementKey(message) {
		return [
			message?.uid,
			message?.event_type ?? message?.type,
			message?.target,
			message?.flag,
			message?.blood ? "blood" : "",
		].join("|")
	}

	markOwnAnnounced(message) {
		this.announcedOwnKeys.add(this.ownAnnouncementKey(message))
	}

	isOwnAlreadyAnnounced(message) {
		return this.announcedOwnKeys.has(this.ownAnnouncementKey(message))
	}

	refreshConfig() {
		this.config = getPusherNotificationConfig()
	}

	setAnnounceChannelReady() {
		this.flushQueue()
		this.pollTeamActivityFallback().catch(error => {
			log.warn("Initial activity fallback poll failed", { message: error.message })
		})
	}

	async initFromStore() {
		if (!this.notificationStore) return
		const recent = await this.notificationStore.loadRecentIntoMemory(25)
		if (recent.length) {
			this.lastEvents = recent
		}
		const sinceMs = Date.now() - (SYNC_BOOTSTRAP_KEY_DAYS * 86400000)
		try {
			const rows = await this.notificationStore.loadKnownOwnRows({
				sinceMs,
				ownTypes: OWN_TYPE_LIST,
			})
			for (const row of rows) {
				if (row.uid && row.event_type && row.target) {
					this.announcedOwnKeys.add(this.ownAnnouncementKey(row))
				}
			}
			if (rows.length) {
				log.info("Hydrated announcedOwnKeys from notification store", { count: rows.length })
			}
		} catch (error) {
			log.warn("Failed to hydrate announcedOwnKeys from store", { message: error.message })
		}
	}

	async recordEvent(message, note = null) {
		const member = message?.uid ? this.dat.getMemberById?.(message.uid) : null
		const entry = {
			at: new Date().toISOString(),
			uid: message?.uid,
			type: message?.type,
			target: message?.target,
			flag: message?.flag,
			blood: message?.blood,
			channel: message?.channel,
			note,
		}

		if (this.notificationStore) {
			try {
				const isAnnounced = typeof note === "string" && (
					note.startsWith("announced") || note.startsWith("reposted") ||
					(note.startsWith("synced") && !note.includes("silent"))
				)
				const id = await this.notificationStore.append({
					event_at: message?.time ? new Date(message.time) : new Date(),
					uid: message?.uid ?? null,
					member_name: member?.name || null,
					event_type: message?.type || null,
					target: message?.target || null,
					flag: message?.flag || null,
					blood: Boolean(message?.blood),
					channel: message?.channel || null,
					source: message?.channel || null,
					note,
					announced: isAnnounced,
					announced_at: isAnnounced ? new Date() : null,
				})
				entry.id = id
				if (message) message._dbId = id
			} catch (error) {
				log.warn("Failed to persist notification event", { message: error.message })
			}
		}

		this.lastEvents.unshift(entry)
		if (this.lastEvents.length > 25) {
			this.lastEvents.length = 25
		}
	}

	async sendAnnouncementThrottled(payload) {
		const delayMs = this.config.syncAnnounceDelayMs || 1500
		const elapsed = Date.now() - this.lastThrottledSendAt
		if (elapsed < delayMs) {
			await wait(delayMs - elapsed)
		}
		for (let attempt = 0; attempt < SYNC_SEND_MAX_RETRIES; attempt++) {
			const sent = await this.sendAnnouncement(payload)
			if (sent) {
				this.lastThrottledSendAt = Date.now()
				return true
			}
			const backoffMs = delayMs * (attempt + 2)
			log.warn("Throttled announce retry", { attempt: attempt + 1, backoffMs })
			await wait(backoffMs)
		}
		return false
	}

	async sendAnnouncement(payload) {
		const channel = this.getAnnounceChannel()
		const options = {}
		if (payload.mentionUserIds?.length) {
			options.allowedMentions = { users: payload.mentionUserIds.map(String) }
		}

		if (!channel) {
			this.pendingQueue.push(payload)
			log.debug("Queued announce payload — Discord channel not ready", { queueSize: this.pendingQueue.length })
			return false
		}

		try {
			let sent
			if (payload.embed) {
				const sendOptions = { embed: payload.embed }
				if (options.allowedMentions) {
					sendOptions.allowedMentions = options.allowedMentions
				}
				sent = await channel.send(sendOptions)
			} else if (payload.content) {
				sent = await channel.send(payload.content, options)
			}
			if (sent && payload.deleteAfterMs) {
				setTimeout(() => sent.delete().catch(() => {}), payload.deleteAfterMs)
			}
			return true
		} catch (error) {
			log.warn("Failed to send announce payload", { message: error.message })
			return false
		}
	}

	async flushQueue() {
		if (!this.getAnnounceChannel() || !this.pendingQueue.length) return
		const queued = [...this.pendingQueue]
		this.pendingQueue = []
		for (const payload of queued) {
			await this.sendAnnouncement(payload)
		}
	}

	scheduleCachePersist() {
		if (this.cacheDebounceTimer) {
			clearTimeout(this.cacheDebounceTimer)
		}
		this.cacheDebounceTimer = setTimeout(async () => {
			this.cacheDebounceTimer = null
			try {
				this.dat.syncDbExportFields?.()
				const ok = await this.updateCache(["team_members", "team_stats", "machines", "challenges", "misc"])
				if (ok) {
					log.info("Persisted cache after Pusher activity")
				}
			} catch (error) {
				log.warn("Debounced cache persist failed", { message: error.message })
			}
		}, this.config.dbPersistDebounceMs)
	}

	isTeamMember(uid) {
		return uid && this.dat.TEAM_MEMBERS?.[uid]
	}

	shouldAnnounceOwn(message) {
		return this.isTeamMember(message.uid) || message.blood || this.dat.DISCORD_LINKS?.[message.uid]
	}

	getMentionPayload(uid) {
		const discordId = this.dat.getDiscordUserId?.(uid)
		if (discordId && this.config.mentionOnOwn) {
			return { mentionText: `<@${discordId}>`, mentionUserIds: [discordId] }
		}
		return { mentionText: this.dat.tryDiscordifyUid(uid) || "Unknown", mentionUserIds: [] }
	}

	matchesOwnConfig(message) {
		if (message.type === "machine" || message.type === "starting_point") {
			if (message.flag === "user" && !this.config.announceUserFlags) return false
			if (message.flag === "root" && !this.config.announceRootFlags) return false
			return true
		}
		if (message.type === "challenge") {
			return this.config.announceChallenges
		}
		if (["endgame", "fortress", "prolab"].includes(message.type)) {
			return this.config.announceLabs
		}
		return true
	}

	matchesNotificationConfig(message) {
		if (message.type === "launch") return this.config.announceLaunches
		if (message.type === "respect") return this.config.announceRespects
		if (message.type === "badge" || message.type === "rank_up") return this.config.announceBadges
		if (message.type === "join") return this.config.announceJoins
		if (message.channel === "shoutbox-channel") return this.config.announceShoutbox
		return true
	}

	async handleOwnSilentSync(message) {
		if (!this.isTeamMember(message.uid)) {
			return { ok: false, reason: "not_team_member" }
		}

		const member = await this.dat.resolveEnt(message.uid, "member", true, null, true)
		const resolveType = message.type === "starting_point" ? "machine" : message.type
		let targetEntity = this.dat.resolveEnt(message.target, resolveType)
		if (!member) {
			await this.recordEvent(message, "skipped: member not resolved")
			return { ok: false, reason: "member_not_resolved" }
		}
		if (!targetEntity) {
			targetEntity = await this.dat.ensureCachedTarget(resolveType, message.target, { trigger: "activity-sync" })
		}
		if (!targetEntity) {
			await this.recordEvent(message, "skipped: target not in cache")
			return { ok: false, reason: "target_not_in_cache" }
		}

		if (message.blood) {
			this.dat.integratePusherBlood(
				member,
				message.uid,
				message.time,
				message.type,
				message.target,
				message.flag,
				true
			)
			this.dat.incrementTeamStatsFromOwn?.(message.flag, message.type, true)
		}

		const changed = this.dat.integratePusherOwn(
			message.uid,
			message.time,
			message.type,
			message.target,
			message.flag,
			true
		)
		if (changed) {
			this.dat.incrementTeamStatsFromOwn?.(message.flag, message.type, message.blood)
			this.syncCacheDirty = true
		}

		await this.recordEvent(message, "synced silent from team activity")
		log.info("Own synced silently from team activity", {
			uid: message.uid,
			target: message.target,
			type: message.type,
		})
		return { ok: true }
	}

	async handleOwnEvent(message, { forceRepost = false, syncBackfill = false } = {}) {
		if (!forceRepost && !syncBackfill) {
			if (!this.shouldAnnounceOwn(message) || !this.matchesOwnConfig(message)) {
				const reason = !this.shouldAnnounceOwn(message)
					? "not team member, discord link, or blood"
					: "filtered by PUSHER_ANNOUNCE_* config"
				log.info("Pusher own skipped", {
					uid: message.uid,
					type: message.type,
					target: message.target,
					flag: message.flag,
					reason,
				})
				await this.recordEvent(message, `skipped: ${reason}`)
				return { ok: false, reason }
			}
		} else if (!syncBackfill && !this.isTeamMember(message.uid) && !message.blood && !this.dat.DISCORD_LINKS?.[message.uid]) {
			return { ok: false, reason: "not_team_member" }
		} else if (syncBackfill && !this.isTeamMember(message.uid)) {
			return { ok: false, reason: "not_team_member" }
		}

		const member = await this.dat.resolveEnt(message.uid, "member", true, null, true)
		const resolveType = message.type === "starting_point" ? "machine" : message.type
		let targetEntity = this.dat.resolveEnt(message.target, resolveType)
		if (!member) {
			log.warn("Own announce skipped — member not resolved", { uid: message.uid, target: message.target })
			await this.recordEvent(message, "skipped: member not resolved")
			return { ok: false, reason: "member_not_resolved" }
		}
		if (!targetEntity) {
			targetEntity = await this.dat.ensureCachedTarget(resolveType, message.target, { trigger: syncBackfill ? "activity-sync" : "pusher" })
		}
		if (!targetEntity) {
			log.warn("Own announce skipped — target not in cache", {
				uid: message.uid,
				target: message.target,
				type: message.type,
			})
			await this.recordEvent(message, "skipped: target not in cache")
			return { ok: false, reason: "target_not_in_cache" }
		}

		const { mentionText, mentionUserIds } = this.getMentionPayload(message.uid)
		const embed = this.embeds.pusherOwn(
			member,
			targetEntity,
			message.type,
			message.flag || message.type,
			message.blood,
			mentionText
		)

		const sendFn = syncBackfill ? this.sendAnnouncementThrottled.bind(this) : this.sendAnnouncement.bind(this)
		const sent = await sendFn({ embed, mentionUserIds })
		if (!sent) {
			log.warn("Own announce failed — Discord send returned false", {
				uid: message.uid,
				target: message.target,
				type: message.type,
			})
			await this.recordEvent(message, "skipped: discord send failed")
			return { ok: false, reason: "discord_send_failed" }
		}

		if (!forceRepost) {
			this.markOwnAnnounced(message)
		}
		const note = forceRepost ? "reposted own" : (syncBackfill ? "synced from team activity" : "announced own")
		log.info("Own announced to Discord", {
			uid: message.uid,
			target: message.target,
			type: message.type,
			flag: message.flag,
			source: message.channel,
			forceRepost,
			syncBackfill,
		})
		await this.recordEvent(message, note)

		if (!forceRepost) {
			if (message.blood && !syncBackfill) {
				this.dat.integratePusherBlood(
					member,
					message.uid,
					message.time,
					message.type,
					message.target,
					message.flag,
					true
				)
				this.dat.incrementTeamStatsFromOwn?.(message.flag, message.type, true)
				for (let i = 0; i < 3; i++) {
					await this.sendAnnouncement({ content: "‼", deleteAfterMs: 1500 })
				}
			} else if (message.blood && syncBackfill) {
				this.dat.integratePusherBlood(
					member,
					message.uid,
					message.time,
					message.type,
					message.target,
					message.flag,
					true
				)
				this.dat.incrementTeamStatsFromOwn?.(message.flag, message.type, true)
			}

			if (this.isTeamMember(message.uid)) {
				const changed = this.dat.integratePusherOwn(
					message.uid,
					message.time,
					message.type,
					message.target,
					message.flag,
					true
				)
				if (changed) {
					this.dat.incrementTeamStatsFromOwn?.(message.flag, message.type, message.blood)
					if (syncBackfill) {
						this.syncCacheDirty = true
					} else {
						this.scheduleCachePersist()
					}
				}
			}
		}

		return { ok: true }
	}

	async handleLaunchEvent(message) {
		if (!this.matchesNotificationConfig(message)) return
		if (message.target && this.launchDebounce.has(message.target)) {
			log.debug("Debounced duplicate launch notification", { target: message.target })
			return
		}
		if (message.target && !this.dat.getMachineByName(message.target)) {
			await this.dat.ensureCachedTarget("machine", message.target, { trigger: "pusher-launch" })
		}
		if (message.target) this.launchDebounce.add(message.target)
		await this.sendAnnouncement({ embed: this.embeds.pusherNotif(message) })
		await this.recordEvent(message, "announced launch")
	}

	async handleTeamNotification(message) {
		if (!this.isTeamMember(message.uid) || !this.matchesNotificationConfig(message)) {
			return
		}
		const { mentionText, mentionUserIds } = this.getMentionPayload(message.uid)
		await this.sendAnnouncement({
			embed: this.embeds.pusherTeamNotification(message, mentionText),
			mentionUserIds,
		})
		await this.recordEvent(message, "announced notification")
	}

	async handleDefaultEvent(message) {
		if (!message.uid) return
		if (!this.isTeamMember(message.uid) && !this.dat.DISCORD_LINKS?.[message.uid]) return
		if (!this.matchesNotificationConfig(message)) return
		const { mentionText, mentionUserIds } = this.getMentionPayload(message.uid)
		await this.sendAnnouncement({
			embed: this.embeds.pusherNotif(message, mentionText),
			mentionUserIds,
		})
		await this.recordEvent(message, "announced default")
	}

	async handlePusherEvent(message) {
		try {
			if (!message?.type) {
				if (message?.uid) {
					await this.handleDefaultEvent(message)
				}
				return
			}

			if (OWN_TYPES.has(message.type)) {
				await this.handleOwnEvent(message)
				return
			}

			if (message.type === "launch") {
				await this.handleLaunchEvent(message)
				return
			}

			if (["badge", "respect", "rank_up", "join"].includes(message.type)) {
				await this.handleTeamNotification(message)
				return
			}

			await this.handleDefaultEvent(message)
		} catch (error) {
			log.error("Pusher event handler failed", { message: error.message, stack: error.stack })
		}
	}

	onPusherStateChange(states, client) {
		this.pusherState = states.current

		if (states.current === "connected") {
			this._clearPusherDisconnectTimer()
			const downMs = this.pusherDisconnectedAt ? Date.now() - this.pusherDisconnectedAt : 0
			this.pusherDisconnectedAt = null
			const wasUnhealthy = !this.pusherHealthy
			this.pusherHealthy = true
			this.pusherAdminAlertSent = false

			if (wasUnhealthy || downMs >= 5000) {
				log.info("Pusher connection restored", { downMs, wasUnhealthy })
			}

			if (downMs >= PUSHER_CATCHUP_MIN_DOWN_MS) {
				this.catchUpRecentActivity().catch(error => {
					log.warn("Pusher reconnect catch-up failed", { message: error.message })
				})
			} else if (downMs > 0) {
				log.debug("Pusher reconnect was brief — skipping API catch-up", { downMs })
			}
			return
		}

		if (states.current === "failed" || states.current === "unavailable") {
			this.pusherHealthy = false
			log.warn("Pusher connection unhealthy", { previous: states.previous, current: states.current })
			this._notifyPusherAdminOnce(client, states.current)
			return
		}

		if (states.current === "disconnected" || states.current === "connecting") {
			if (!this.pusherDisconnectedAt) {
				this.pusherDisconnectedAt = Date.now()
			}
			this._schedulePusherDisconnectAlert(client)
		}
	}

	_clearPusherDisconnectTimer() {
		if (this.pusherDisconnectTimer) {
			clearTimeout(this.pusherDisconnectTimer)
			this.pusherDisconnectTimer = null
		}
	}

	_schedulePusherDisconnectAlert(client) {
		if (this.pusherDisconnectTimer) return
		this.pusherDisconnectTimer = setTimeout(() => {
			this.pusherDisconnectTimer = null
			if (this.pusherState === "connected") return
			this.pusherHealthy = false
			log.warn("Pusher connection unhealthy (sustained)", { state: this.pusherState })
			this._notifyPusherAdminOnce(client, this.pusherState)
		}, PUSHER_DISCONNECT_ALERT_MS)
	}

	_notifyPusherAdminOnce(client, state) {
		if (this.pusherAdminAlertSent) return
		this.pusherAdminAlertSent = true
		this.notifyAdmins?.(
			client,
			`Seven Pusher connection is **${state}**. Live own announcements may be delayed; member-activity API fallback is active.`
		)
	}

	normalizeMemberActivityItem(entry, uid) {
		const resolvedUid = uid || entry.user?.id || entry.user_id
		const objectType = String(entry.object_type || "").toLowerCase()
		const targetName = entry.name
		if (!resolvedUid || !objectType || !targetName) return null

		let type = objectType
		let flag = entry.type

		if (objectType === "machine") {
			type = "machine"
			flag = String(entry.type || "").toLowerCase() === "root" ? "root" : "user"
		} else if (objectType === "challenge") {
			type = "challenge"
			flag = "challenge"
		} else if (["endgame", "fortress", "prolab"].includes(objectType)) {
			type = objectType
			flag = entry.flag_title || objectType
		}

		const time = entry._activityTs || Date.parse(entry.date || entry.created_at) || Date.now()
		return {
			uid: Number(resolvedUid),
			time,
			type,
			target: targetName,
			flag,
			blood: Boolean(entry.first_blood || entry.blood),
			channel: "member-activity-fallback",
		}
	}

	shouldProcessFallbackActivity(normalized) {
		if (this.isOwnAlreadyAnnounced(normalized)) return false
		if (normalized.time <= this.fallbackWatermark) return false
		return true
	}

	async fetchRecentMemberActivity(sinceMs) {
		const teamId = this.getTeamId?.()
		if (!teamId || !this.dat.V4API?.getRecentTeamActivityForFallback) {
			return []
		}
		try {
			return await this.dat.V4API.getRecentTeamActivityForFallback(teamId, sinceMs)
		} catch (error) {
			if ([400, 401, 403].includes(error.status)) {
				if (!this.fallbackTeamActivityFailedLogged) {
					this.fallbackTeamActivityFailedLogged = true
					log.warn("Team activity fallback unavailable", {
						teamId,
						status: error.status,
						message: error.message,
					})
				}
				return []
			}
			throw error
		}
	}

	async processFallbackActivityItems(items) {
		let announced = 0
		let skipped = 0
		for (const item of items) {
			const uid = item.user_id
			const normalized = this.normalizeMemberActivityItem(item, uid)
			if (!normalized || !this.isTeamMember(normalized.uid)) {
				skipped++
				continue
			}
			if (!this.shouldProcessFallbackActivity(normalized)) {
				skipped++
				continue
			}
			await this.handleOwnEvent(normalized)
			this.fallbackWatermark = Math.max(this.fallbackWatermark, normalized.time)
			announced++
		}
		return { announced, skipped, total: items.length }
	}

	async catchUpRecentActivity() {
		const since = Date.now() - (15 * 60 * 1000)
		try {
			const items = await this.fetchRecentMemberActivity(since)
			await this.processFallbackActivityItems(items)
			this.lastFallbackError = null
		} catch (error) {
			this.lastFallbackError = error.message
			throw error
		}
	}

	async pollTeamActivityFallback() {
		if (this.dat.V4API?.isAuthBlocked?.()) {
			this.lastFallbackError = "HTB OAuth auth blocked — run `seven htb token set <refresh>`"
			return
		}
		this.lastFallbackPollAt = new Date().toISOString()
		try {
			const lookbackMs = Math.max(this.config.fallbackPollMs, 15 * 60 * 1000)
			const sinceMs = Date.now() - lookbackMs
			const items = await this.fetchRecentMemberActivity(sinceMs)
			this.lastFallbackError = null
			const stats = await this.processFallbackActivityItems(items)
			this.lastFallbackPollStats = stats
			log.info("Activity fallback poll completed", {
				...stats,
				pusherHealthy: this.pusherHealthy,
				sinceMs: new Date(sinceMs).toISOString(),
			})
		} catch (error) {
			this.lastFallbackError = error.message
			log.warn("Member activity fallback poll failed", { message: error.message })
		}
	}

	startFallbackPolling() {
		if (this.fallbackPollTimer) return
		this.fallbackPollTimer = setInterval(() => {
			this.pollTeamActivityFallback().catch(error => {
				log.warn("Fallback poll interval failed", { message: error.message })
			})
		}, this.config.fallbackPollMs)
	}

	getStatusEmbed() {
		return this.embeds.pusherStatus({
			pusherState: this.pusherState,
			pusherHealthy: this.pusherHealthy,
			queueSize: this.pendingQueue.length,
			lastEvents: this.lastEvents.slice(0, 8),
			lastFallbackPollAt: this.lastFallbackPollAt,
			lastFallbackPollStats: this.lastFallbackPollStats,
			lastFallbackError: this.lastFallbackError,
			config: this.config,
		})
	}

	async getHistoryEmbed({ limit = 20, memberFilter = null } = {}) {
		if (!this.notificationStore) {
			return this.embeds.pusherHistory([], { memberFilter, persisted: false })
		}

		let uid = null
		let memberName = null
		if (memberFilter) {
			const member = this.dat.resolveEnt(memberFilter, "member", false, null, false)
			if (member?.id) {
				uid = member.id
			} else {
				memberName = memberFilter
			}
		}

		const rows = await this.notificationStore.list({ limit, uid, memberName })
		return this.embeds.pusherHistory(rows, { memberFilter, persisted: true })
	}

	async repostToChannel({ eventId = null, useLast = false } = {}) {
		if (!this.notificationStore) {
			return { ok: false, reason: "no_store" }
		}

		const row = useLast
			? await this.notificationStore.getLatest({})
			: await this.notificationStore.getById(eventId)

		if (!row) {
			return { ok: false, reason: "not_found" }
		}

		const message = this.notificationStore.toRouterMessage(row)
		if (!OWN_TYPES.has(message.type)) {
			return { ok: false, reason: "not_own_type", row }
		}

		const result = await this.handleOwnEvent(message, { forceRepost: true })
		if (result?.ok === false) {
			return { ok: false, reason: result.reason, row }
		}

		return { ok: true, row }
	}

	_clampSyncDays(days) {
		const parsed = Number(days)
		if (!Number.isFinite(parsed) || parsed < 1) return SYNC_DEFAULT_DAYS
		return Math.min(Math.floor(parsed), SYNC_MAX_DAYS)
	}

	async _loadKnownOwnKeySet(sinceMs, { announcedOnly = false } = {}) {
		const knownKeys = announcedOnly ? new Set() : new Set(this.announcedOwnKeys)
		if (!this.notificationStore) return knownKeys
		const rows = await this.notificationStore.loadKnownOwnRows({
			sinceMs,
			ownTypes: OWN_TYPE_LIST,
			announcedOnly,
		})
		for (const row of rows) {
			if (row.uid && row.event_type && row.target) {
				knownKeys.add(this.ownAnnouncementKey(row))
			}
		}
		if (announcedOnly) {
			for (const key of this.announcedOwnKeys) {
				knownKeys.add(key)
			}
		}
		return knownKeys
	}

	async computeActivitySyncDiff({ days = SYNC_DEFAULT_DAYS, scope = "recorded" } = {}) {
		const clampedDays = this._clampSyncDays(days)
		const teamId = this.getTeamId?.()
		if (!teamId) {
			return { items: [], stats: { total: 0, known: 0, missing: 0, days: clampedDays }, error: "no_team" }
		}
		if (this.dat.V4API?.isAuthBlocked?.()) {
			return { items: [], stats: { total: 0, known: 0, missing: 0, days: clampedDays }, error: "auth_blocked" }
		}

		const sinceMs = Date.now() - (clampedDays * 86400000)
		let rawItems
		try {
			rawItems = await this.fetchRecentMemberActivity(sinceMs)
		} catch (error) {
			if ([400, 401, 403].includes(error.status)) {
				return { items: [], stats: { total: 0, known: 0, missing: 0, days: clampedDays }, error: "api_unavailable" }
			}
			throw error
		}

		const announcedOnly = scope === "announced"
		const knownKeys = await this._loadKnownOwnKeySet(sinceMs, { announcedOnly })
		const normalized = []
		let known = 0
		for (const item of rawItems) {
			const entry = this.normalizeMemberActivityItem(item, item.user_id)
			if (!entry || !OWN_TYPES.has(entry.type) || !this.isTeamMember(entry.uid)) continue
			entry.channel = "team-activity-sync"
			const key = this.ownAnnouncementKey(entry)
			if (knownKeys.has(key)) {
				known++
				continue
			}
			knownKeys.add(key)
			normalized.push(entry)
		}

		normalized.sort((a, b) => a.time - b.time)
		return {
			items: normalized,
			stats: {
				total: rawItems.length,
				known,
				missing: normalized.length,
				days: clampedDays,
			},
		}
	}

	async executeActivitySilentSync(items) {
		let synced = 0
		let failed = 0
		let skipped = 0
		this.syncCacheDirty = false
		for (const item of items) {
			const result = await this.handleOwnSilentSync(item)
			if (result?.ok) {
				synced++
			} else if (result?.reason === "not_team_member") {
				skipped++
			} else {
				failed++
			}
		}
		if (this.syncCacheDirty) {
			this.scheduleCachePersist()
			this.syncCacheDirty = false
		}
		return { synced, failed, skipped, total: items.length }
	}

	async executeActivityPublish(items) {
		let announced = 0
		let failed = 0
		let skipped = 0
		this.syncCacheDirty = false
		for (const item of items) {
			const result = await this.handleOwnEvent(item, { syncBackfill: true })
			if (result?.ok) {
				announced++
			} else if (result?.reason === "not_team_member") {
				skipped++
			} else {
				failed++
			}
		}
		if (this.syncCacheDirty) {
			this.scheduleCachePersist()
			this.syncCacheDirty = false
		}
		return { announced, failed, skipped, total: items.length }
	}

	getActivitySyncPreviewEmbed(diff, { mode = "silent" } = {}) {
		const { items, stats, error } = diff
		const sample = items.slice(0, 10).map(item => {
			const member = this.dat.getMemberById?.(item.uid)
			const blood = item.blood ? " 🩸" : ""
			const flag = item.flag && item.flag !== item.type ? ` (${item.flag})` : ""
			return `**${member?.name || item.uid}** ${item.type} **${item.target}**${flag}${blood}`
		})
		return this.embeds.teamActivitySyncPreview({
			stats,
			sample,
			days: stats.days,
			mode,
			error,
		})
	}
}

module.exports = {
	NotificationRouter,
	SYNC_DEFAULT_PUBLISH_LIMIT,
	SYNC_DEFAULT_DAYS,
	SYNC_MAX_DAYS,
}
