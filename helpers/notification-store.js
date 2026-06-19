/**
 * Persistent storage for HTB notification / Pusher events (Postgres).
 * @module Notification-Store
 */
const { createLogger } = require("./logger.js")

const log = createLogger("notification-store")
const TABLE_NAME = "seven_notification_events"
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

class NotificationStore {
	constructor(db) {
		this.db = db
	}

	async ensureSchema() {
		await this.db.none(`
			CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
				id SERIAL PRIMARY KEY,
				event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				uid INTEGER,
				member_name TEXT,
				event_type TEXT,
				target TEXT,
				flag TEXT,
				blood BOOLEAN NOT NULL DEFAULT FALSE,
				channel TEXT,
				source TEXT,
				note TEXT,
				announced BOOLEAN NOT NULL DEFAULT FALSE,
				announced_at TIMESTAMPTZ
			);
			CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_event_at ON ${TABLE_NAME} (event_at DESC);
			CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_uid ON ${TABLE_NAME} (uid);
		`)
	}

	async append(record) {
		const row = await this.db.one(
			`INSERT INTO ${TABLE_NAME}
				(event_at, uid, member_name, event_type, target, flag, blood, channel, source, note, announced, announced_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			 RETURNING id`,
			[
				record.event_at || new Date(),
				record.uid ?? null,
				record.member_name ?? null,
				record.event_type ?? null,
				record.target ?? null,
				record.flag ?? null,
				Boolean(record.blood),
				record.channel ?? null,
				record.source ?? null,
				record.note ?? null,
				Boolean(record.announced),
				record.announced_at || null,
			]
		)
		return row.id
	}

	async markAnnounced(id, note = "announced own") {
		if (!id) return
		await this.db.none(
			`UPDATE ${TABLE_NAME}
			 SET announced = TRUE, announced_at = NOW(), note = $2
			 WHERE id = $1`,
			[Number(id), note]
		)
	}

	async getById(id) {
		return this.db.oneOrNone(`SELECT * FROM ${TABLE_NAME} WHERE id = $1`, [Number(id)])
	}

	async getLatest(options = {}) {
		const { announcedOnly = false, uid = null } = options
		const clauses = []
		const params = []
		if (announcedOnly) clauses.push("announced = TRUE")
		if (uid) {
			params.push(uid)
			clauses.push(`uid = $${params.length}`)
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
		return this.db.oneOrNone(
			`SELECT * FROM ${TABLE_NAME} ${where} ORDER BY event_at DESC LIMIT 1`,
			params
		)
	}

	async list(options = {}) {
		const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
		const clauses = []
		const params = []

		if (options.uid) {
			params.push(Number(options.uid))
			clauses.push(`uid = $${params.length}`)
		}
		if (options.memberName) {
			params.push(`%${options.memberName}%`)
			clauses.push(`(member_name ILIKE $${params.length} OR target ILIKE $${params.length})`)
		}
		if (options.sinceMs) {
			params.push(new Date(options.sinceMs))
			clauses.push(`event_at >= $${params.length}`)
		}

		params.push(limit)
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
		return this.db.any(
			`SELECT * FROM ${TABLE_NAME} ${where} ORDER BY event_at DESC LIMIT $${params.length}`,
			params
		)
	}

	toRouterMessage(row) {
		if (!row) return null
		return {
			_dbId: row.id,
			uid: row.uid,
			type: row.event_type,
			target: row.target,
			flag: row.flag,
			blood: row.blood,
			channel: row.channel || row.source || "db-repost",
			time: new Date(row.event_at).getTime(),
		}
	}

	/**
	 * @param {{ sinceMs?: number, ownTypes?: string[], announcedOnly?: boolean }} options
	 * @returns {Promise<Array<{ uid: number, event_type: string, target: string, flag: string, blood: boolean }>>}
	 */
	async loadKnownOwnRows({ sinceMs = null, ownTypes = [], announcedOnly = false } = {}) {
		const clauses = []
		const params = []
		if (sinceMs) {
			params.push(new Date(sinceMs))
			clauses.push(`event_at >= $${params.length}`)
		}
		if (ownTypes?.length) {
			params.push(ownTypes)
			clauses.push(`event_type = ANY($${params.length})`)
		}
		if (announcedOnly) {
			clauses.push(`announced = TRUE`)
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
		return this.db.any(
			`SELECT uid, event_type, target, flag, blood
			 FROM ${TABLE_NAME}
			 ${where}
			 ORDER BY event_at ASC`,
			params
		)
	}

	async loadRecentIntoMemory(limit = 25) {
		try {
			const rows = await this.list({ limit })
			return rows.map(row => ({
				id: row.id,
				at: new Date(row.event_at).toISOString(),
				uid: row.uid,
				type: row.event_type,
				target: row.target,
				flag: row.flag,
				blood: row.blood,
				channel: row.channel,
				note: row.note,
			}))
		} catch (error) {
			log.warn("Failed to load notification history from DB", { message: error.message })
			return []
		}
	}
}

module.exports = {
	NotificationStore,
	DEFAULT_LIMIT,
	MAX_LIMIT,
}
