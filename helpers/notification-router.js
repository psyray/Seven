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
	}

	refreshConfig() {
		this.config = getPusherNotificationConfig()
	}

	setAnnounceChannelReady() {
		this.flushQueue()
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
			return
		}

		const member = await this.dat.resolveEnt(message.uid, "member", true, null, true)
		const { mentionText, mentionUserIds } = this.getMentionPayload(message.uid)
		const embed = this.embeds.pusherOwn(
			member,
			message.target,
			message.type,
			message.flag || message.type,
			message.blood,
			mentionText
		)

		await this.sendAnnouncement({ embed, mentionUserIds })
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
		const unhealthy = ["disconnected", "failed", "unavailable"].includes(states.current)
		if (unhealthy && this.pusherHealthy) {
			this.pusherHealthy = false
			log.warn("Pusher connection unhealthy", { previous: states.previous, current: states.current })
			this.notifyAdmins?.(client, `Seven Pusher connection is **${states.current}**. Live own announcements may be delayed; API fallback polling is active.`)
		}
		if (states.current === "connected" && !this.pusherHealthy) {
			this.pusherHealthy = true
			log.info("Pusher connection restored")
			this.catchUpRecentActivity().catch(error => {
				log.warn("Pusher reconnect catch-up failed", { message: error.message })
			})
		}
	}

	normalizeTeamActivityItem(item) {
		const uid = item.user_id || item.user?.id || item.id
		const objectType = item.object_type || item.type
		const targetName = item.name || item.machine_name || item.challenge_name
		if (!uid || !objectType || !targetName) return null
		return {
			uid: Number(uid),
			time: Date.parse(item.date || item.created_at || item.updated_at) || Date.now(),
			type: objectType === "machine" && item.type === "user" ? "machine" : objectType,
			target: targetName,
			flag: item.type === "user" || item.type === "root" ? item.type
				: item.type === "challenge" ? "challenge"
					: item.flag_title || item.type,
			blood: false,
			channel: "team-activity-fallback",
		}
	}

	async catchUpRecentActivity() {
		const teamId = this.getTeamId()
		if (!teamId || !this.dat.V4API?.getRecentTeamActivity) return
		const since = Date.now() - (15 * 60 * 1000)
		const items = await this.dat.V4API.getRecentTeamActivity(teamId, since)
		for (const item of items) {
			const normalized = this.normalizeTeamActivityItem(item)
			if (!normalized || !this.isTeamMember(normalized.uid)) continue
			if (normalized.time <= this.fallbackWatermark) continue
			await this.handleOwnEvent(normalized)
		}
		this.fallbackWatermark = Date.now()
	}

	async pollTeamActivityFallback() {
		if (this.pusherHealthy) return
		const teamId = this.getTeamId()
		if (!teamId || !this.dat.V4API?.getRecentTeamActivity) return

		this.lastFallbackPollAt = new Date().toISOString()
		try {
			const items = await this.dat.V4API.getRecentTeamActivity(teamId, this.fallbackWatermark)
			this.lastFallbackError = null
			for (const item of items) {
				const normalized = this.normalizeTeamActivityItem(item)
				if (!normalized || !this.isTeamMember(normalized.uid)) continue
				await this.handleOwnEvent(normalized)
				this.fallbackWatermark = Math.max(this.fallbackWatermark, normalized.time)
			}
		} catch (error) {
			this.lastFallbackError = error.message
			log.warn("Team activity fallback poll failed", { message: error.message })
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
			lastFallbackError: this.lastFallbackError,
			config: this.config,
		})
	}
}

module.exports = {
	NotificationRouter,
}
