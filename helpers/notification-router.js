/**
 * Routes HTB Pusher events and fallback team activity to Discord announce channel.
 * @module Notification-Router
 */
const { createLogger } = require("./logger.js")
const { getPusherNotificationConfig } = require("./pusher-config.js")

const log = createLogger("notification-router")

const OWN_TYPES = new Set([
	"machine", "challenge", "endgame", "fortress", "prolab", "starting_point",
])

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
	 */
	constructor({ dat, embeds, getAnnounceChannel, updateCache, notifyAdmins, getTeamId }) {
		this.dat = dat
		this.embeds = embeds
		this.getAnnounceChannel = getAnnounceChannel
		this.updateCache = updateCache
		this.notifyAdmins = notifyAdmins
		this.getTeamId = getTeamId || (() => dat.TEAM_STATS?.id)
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
		/** Owns already posted to Discord (independent of HTB cache / force-update). */
		this.announcedOwnKeys = new Set()
		this.lastFallbackPollStats = null
	}

	ownAnnouncementKey(message) {
		return [
			message?.uid,
			message?.type,
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

	recordEvent(message, note = null) {
		this.lastEvents.unshift({
			at: new Date().toISOString(),
			uid: message?.uid,
			type: message?.type,
			target: message?.target,
			flag: message?.flag,
			blood: message?.blood,
			channel: message?.channel,
			note,
		})
		if (this.lastEvents.length > 25) {
			this.lastEvents.length = 25
		}
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
				sent = await channel.send(payload.embed, options)
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

	async handleOwnEvent(message) {
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
			this.recordEvent(message, `skipped: ${reason}`)
			return
		}

		const member = await this.dat.resolveEnt(message.uid, "member", true, null, true)
		const resolveType = message.type === "starting_point" ? "machine" : message.type
		const targetEntity = this.dat.resolveEnt(message.target, resolveType)
		if (!member) {
			log.warn("Own announce skipped — member not resolved", { uid: message.uid, target: message.target })
			this.recordEvent(message, "skipped: member not resolved")
			return
		}
		if (!targetEntity) {
			log.warn("Own announce skipped — target not in cache", {
				uid: message.uid,
				target: message.target,
				type: message.type,
			})
			this.recordEvent(message, "skipped: target not in cache")
			return
		}

		const { mentionText, mentionUserIds } = this.getMentionPayload(message.uid)
		const embed = this.embeds.pusherOwn(
			member,
			message.target,
			message.type,
			message.flag || message.type,
			message.blood,
			mentionText
		)

		const sent = await this.sendAnnouncement({ embed, mentionUserIds })
		if (!sent) {
			log.warn("Own announce failed — Discord send returned false", {
				uid: message.uid,
				target: message.target,
				type: message.type,
			})
			this.recordEvent(message, "skipped: discord send failed")
			return
		}

		this.markOwnAnnounced(message)
		log.info("Own announced to Discord", {
			uid: message.uid,
			target: message.target,
			type: message.type,
			flag: message.flag,
			source: message.channel,
		})
		this.recordEvent(message, "announced own")

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
			for (let i = 0; i < 3; i++) {
				await this.sendAnnouncement({ content: "‼", deleteAfterMs: 1500 })
			}
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
				this.scheduleCachePersist()
			}
		}
	}

	async handleLaunchEvent(message) {
		if (!this.matchesNotificationConfig(message)) return
		if (message.target && this.launchDebounce.has(message.target)) {
			log.debug("Debounced duplicate launch notification", { target: message.target })
			return
		}
		if (message.target) this.launchDebounce.add(message.target)
		await this.sendAnnouncement({ embed: this.embeds.pusherNotif(message) })
		this.recordEvent(message, "announced launch")
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
		this.recordEvent(message, "announced notification")
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
		this.recordEvent(message, "announced default")
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
		const objectType = String(entry.object_type || "").toLowerCase()
		const targetName = entry.name
		if (!uid || !objectType || !targetName) return null

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
			uid: Number(uid),
			time,
			type,
			target: targetName,
			flag,
			blood: false,
			channel: "member-activity-fallback",
		}
	}

	shouldProcessFallbackActivity(normalized) {
		if (this.isOwnAlreadyAnnounced(normalized)) return false
		if (normalized.time <= this.fallbackWatermark) return false
		return true
	}

	async fetchRecentMemberActivity(sinceMs) {
		const memberIds = Object.keys(this.dat.TEAM_MEMBERS || {}).map(Number)
		if (!memberIds.length || !this.dat.V4API?.getRecentMemberActivities) {
			return []
		}
		return this.dat.V4API.getRecentMemberActivities(memberIds, sinceMs)
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
}

module.exports = {
	NotificationRouter,
}
