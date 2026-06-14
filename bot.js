#!/usr/bin/env node

/**
 * @module Seven
 */

const { Format: F } = require("./helpers/format")

/*** STARTUP | DECIDE ENV VAR SOURCE ***/
console.log("%c╔════════════════════╗\n║ seven-server 1.01a ║\n╚════════════════════╝", "color:#9FEF00; font-weight:bold; font-size: 50")
F.logRainbow()
if (process.env.NODE_ENV != "development") {
	console.log("Started at " + new Date().toLocaleTimeString() + " in production. Using prod env vars")
    require("dotenv").config({ path: ".env" })
} else {
	console.log("Started at " + new Date().toLocaleTimeString() + " on dev machine. Scanning ./config/env for vars")
	require("dotenv").config({ path: "./config/.env" })
}

/*** IMPORT STUFF ***/

const Discord = require("discord.js")
const client = new Discord.Client()
const fs = require("fs")
const { struct } = require("pb-util")
const dialogflow = require("@google-cloud/dialogflow").v2beta1
const dflow = new dialogflow.SessionsClient({ credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || "{}") })
const strings = require("./static/strings")
const { Helpers: H } = require("./helpers/helpers.js")
const { HtbPusherSubscription } = require("./helpers/pusher-htb")
const pgp = require("pg-promise")({ capSQL: true })
const htbCharts = require("./modules/charts/index_new.js")
const { HtbEmbeds } = require("./views/embeds.js")
const { SevenDatastore } = require("./models/SevenDatastore.js")
const { Send } = require("./modules/send.js")
const { HTBEmoji } = require("./helpers/emoji.js")
const { generateBinaryClockImage } = require("./helpers/binclock")
const { normalizeChartTerm } = require("./helpers/chart-term.js")
const { buildMemberProgressChart, buildMemberActivityChart } = require("./helpers/chart-messages.js")
const { createLogger } = require("./helpers/logger.js")
const { HtbTokenExpiredError, HtbAuthError } = require("./modules/htb-api.js")
const { extractTargetNameFromMessage, resolveLocalIntent } = require("./helpers/nlp.js")

const log = createLogger("bot")

let htbAuthFailureNotified = false
let pendingHtbAuthFailure = null

	process.on("unhandledRejection", (reason) => {
		if (reason instanceof HtbTokenExpiredError || reason instanceof HtbAuthError) {
			log.error("Unhandled HTB auth error (crash suppressed)", { message: reason.message })
			notifyCaptainsOfHtbAuthFailure(reason)
			return
		}
		if (reason?.message?.includes("HTTP 401 for POST login") || reason?.message?.includes("HTB Account")) {
			log.error("Unhandled HTB login error (crash suppressed)", { message: reason.message })
			return
		}
	log.error("Unhandled promise rejection", {
		message: reason?.message || String(reason),
		stack: reason?.stack,
	})
})

/*** HANDLE DEVELOPMENT INSTANCE CASE ***/

var DEV_MODE_ON = false
const IS_DEV_INSTANCE = process.env.IS_DEV_INSTANCE === "true";

if (IS_DEV_INSTANCE) {
	DEV_MODE_ON = true
	console.error("DEVELOPMENT MODE ON.\n  Only queries by the developer will be responded to by this instance.\n  (Avoids conflicts/ duplicate responses in production use)")
}


/*** INIT GLOBAL STUFF ***/

var DISCORD_ANNOUNCE_CHAN = false         // The Discord Channel object intended to recieve Pusher achievements.
var HTB_PUSHER_OWNS_SUBSCRIPTION = false  // The Pusher Client own channel subscription.
const SEVEN_DB_TABLE_NAME = "seven_data"
var PUSHER_MSG_LOG = DEV_MODE_ON ? require("./cache/PUSHER_MSG_LOG.json") : null
const LAUNCH_TARGETS_DEBOUNCE_CACHE = []

const CHART_RENDERER = htbCharts
const DAT = new SevenDatastore()    // Open an abstract storage container for HTB / bot data
const API = process.env?.API_SERVER_ENABLED ? new (require("./modules/seven-api-server.js").SevenApiServer)(DAT, process.env.API_SERVER_PORT) : null
const E = new HTBEmoji(client)
const EGI = new HtbEmbeds(DAT, E) 			// Give Embed Constructor access to the datastore
const SEND = new Send(client, EGI)

/* SETUP DB IMPORT TO RESTORE LAST GOOD STATE */
function getDbConfig() {
	if (process.env.PGHOST) {
		const sslDisabled = ["localhost", "captain", "postgres"].includes(process.env.PGHOST)
		return {
			host: process.env.PGHOST,
			port: Number(process.env.PGPORT) || 5432,
			database: process.env.PGDATABASE,
			user: process.env.PGUSER,
			password: process.env.PGPASSWORD,
			ssl: sslDisabled ? false : { rejectUnauthorized: false }
		}
	}
	const dbUrl = process.env.DATABASE_URL || ""
	const dbSslDisabled = ["localhost", "captain", "@postgres:"].some((host) => dbUrl.includes(host))
	return {
		connectionString: process.env.DATABASE_URL,
		ssl: dbSslDisabled ? false : { rejectUnauthorized: false }
	}
}
const cn = getDbConfig()

const DB_FIELDNAMES_AUTO = ["MACHINES", "CHALLENGES", "FORTRESSES", "ENDGAMES", "PROLABS", "TEAM_MEMBERS", "TEAM_MEMBERS_IGNORED", "TEAM_STATS", "DISCORD_LINKS", "MISC"]
const db = pgp(cn)

/** Imports globals from the cloud backup (Objects stored as raw, singular JSON columns in DB)
 * @returns {Promise}
*/
async function importDbBackup() {
	return db.any(`SELECT EXISTS (
		SELECT 1 
		FROM   pg_catalog.pg_class c
		JOIN   pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE    c.relname = '${SEVEN_DB_TABLE_NAME}'
		);`)
		.then(res => res[0].exists || false)
		.then(exists => {
			if (!exists) {
				console.warn("[SEVEN_DB]::: Table doesn't exist.")
				DAT.FIRST_RUN = true
				return db.any(`CREATE TABLE ${SEVEN_DB_TABLE_NAME}(
													id SERIAL PRIMARY KEY,
													name text DEFAULT 'Unknown'::text,
													json json DEFAULT '{}'::json
											);

											INSERT INTO ${SEVEN_DB_TABLE_NAME}(id,name,json) 
											VALUES
												(DEFAULT, 'machines', '{}'),
												(DEFAULT, 'challenges', '{}'),
												(DEFAULT, 'fortresses', '{}'),
												(DEFAULT, 'endgames', '{}'),
												(DEFAULT, 'prolabs', '{}'),
												(DEFAULT, 'team_members', '{}'),
												(DEFAULT, 'team_members_ignored', '{}'),
												(DEFAULT, 'team_stats', '{}'),
												(DEFAULT, 'discord_links', '{}'),
												(DEFAULT, 'misc', '{}');
												`).then(console.log("Inserted!"))
			}
			else {
				// console.log("[SEVEN_DB]::: Data table found.")
				return true
			}
		}).then(() => {
			return db.any(`SELECT json FROM ${SEVEN_DB_TABLE_NAME} ORDER BY id ASC;`, [true]).then(
				rows => {
					DAT.MACHINES = rows[0].json
					DAT.CHALLENGES = rows[1].json
					DAT.FORTRESSES = rows[2].json
					DAT.ENDGAMES = rows[3].json
					DAT.PROLABS = rows[4].json
					DAT.TEAM_MEMBERS = rows[5].json
					DAT.TEAM_MEMBERS_IGNORED = rows[6].json
					DAT.TEAM_STATS = rows[7].json
					DAT.DISCORD_LINKS = rows[8].json
					DAT.MISC = rows[9].json
					DAT.hydrateFromDbBackup()
					console.log("[DB IMPORT]::: Restored from DB backup.")
					console.info(`Machines   : ${Object.values(DAT.MACHINES).length}\n` +
						`Challenges : ${Object.values(DAT.CHALLENGES).length}\n` +
						`Fortresses : ${Object.values(DAT.FORTRESSES).length}\n` +
						`Endgames : ${Object.values(DAT.ENDGAMES).length}\n` +
						`Pro Labs : ${Object.values(DAT.PROLABS).length}\n` +
						`Members    : ${Object.values(DAT.TEAM_MEMBERS).length}${(DAT.kTMI.length ? " tracked, " + DAT.kTMI.length + " untracked" : "")}\n` +
						`Linked DC  : ${Object.values(DAT.DISCORD_LINKS).length}`)
				}
			).catch(
				err => console.error(err)
			)

		})
}
// console.log()

// }


/** Updates the cloud backup, with options for selective update. 
 * @param {string[]} fields - The specific data types / buffers specified for the update operation, e.g. ["MACHINES","TEAM_MEMBERS"]
*/
async function updateCache(fields = DB_FIELDNAMES_AUTO) {
	DAT.syncDbExportFields()
	var fieldData = []
	for (let i = 0; i < fields.length; i++) {
		var fieldName = fields[i]
		switch (fieldName.toLowerCase()) {
		case "machines": fieldData.push({ id: 1, json: JSON.stringify(DAT.MACHINES) }); break
		case "challenges": fieldData.push({ id: 2, json: JSON.stringify(DAT.CHALLENGES) }); break
		case "fortresses": fieldData.push({ id: 3, json: JSON.stringify(DAT.FORTRESSES) }); break
		case "endgames": fieldData.push({ id: 4, json: JSON.stringify(DAT.ENDGAMES) }); break
		case "prolabs": fieldData.push({ id: 5, json: JSON.stringify(DAT.PROLABS) }); break
		case "team_members": fieldData.push({ id: 6, json: JSON.stringify(DAT.TEAM_MEMBERS) }); break
		case "team_members_ignored": fieldData.push({ id: 7, json: JSON.stringify(DAT.TEAM_MEMBERS_IGNORED) }); break // These should only update manually
		case "team_stats": fieldData.push({ id: 8, json: JSON.stringify(DAT.TEAM_STATS) }); break
		case "discord_links": fieldData.push({ id: 9, json: JSON.stringify(DAT.D_STATIC) }); break               // These should only update manually
		case "misc": fieldData.push({ id: 10, json: JSON.stringify(DAT.MISC) }); break
		default:
			break
		}
	}
	const cs = new pgp.helpers.ColumnSet(["?id", { name: "json", cast: "json" }], { table: SEVEN_DB_TABLE_NAME })
	const update = pgp.helpers.update(fieldData, cs) + " WHERE v.id = t.id"
	return await db.result(update)
		.then(() => {
			console.log(`[DB BACKUP]::: Backed up ${F.andifyList(fields.map(e => `'${e}'`))} to DB for a rainy day.`)
			return true
		})
		.catch(e => {
			console.error(e)
			return false
		})
}

/**
 * Returns whether the provided Discord user has admin privileges.
 * @param {Discord.User} discordUser 
 * @returns {boolean}
 */
function isAdmin(discordUser) {
	return JSON.parse(process.env.ADMIN_DISCORD_IDS).includes(String(discordUser.id))
}

/**
 * Returns whether the provided Discord user has captain privileges.
 * @param {Discord.User} discordUser 
 * @returns {boolean}
 */
function isCaptain(discordUser) {
	return JSON.parse(process.env.CAPTAIN_DISCORD_IDS).includes(String(discordUser.id))
}

/**
 * Moves a member to the 'ignored' set, meaning that their data will not be updated
 * or shared by the bot until the user undoes this (see unignoreMember()).
 * @param {number} uid 
 */
function ignoreMember(uid) {
	if (uid in DAT.TEAM_MEMBERS) {
		console.log(`Before ignoring member #${uid}: ${DAT.kTMI.length} already ignored --`)
		console.log(DAT.kTMI.join("\n"))
		DAT.TEAM_MEMBERS_IGNORED[uid] = DAT.TEAM_MEMBERS[uid]
		delete DAT.TEAM_MEMBERS[uid]
		updateCache(["team_members", "team_members_ignored"])
		// exportData(TEAM_MEMBERS, "team_members.json");
		// exportData(TEAM_MEMBERS_IGNORED, "team_members_ignored.json")
		console.log(`After ignoring: ${DAT.kTMI.length} ignored.`)
		return DAT.TEAM_MEMBERS_IGNORED[uid].name
	} else {
		return false
	}
}

/**
 * Moves a member out of the 'ignored' set, meaning that their data will now be
 * updated and shared by the bot unless the user requests otherwise again (see ignoreMember()).
 * @param {number} uid
 * @returns {(string|false)} 
 */
function unignoreMember(uid) {
	console.log("Unignoring member " + uid)
	if (uid in DAT.TEAM_MEMBERS_IGNORED) {
		DAT.TEAM_MEMBERS[uid] = DAT.TEAM_MEMBERS_IGNORED[uid]
		delete DAT.TEAM_MEMBERS_IGNORED[uid]
		updateCache(["team_members", "team_members_ignored"])
		console.warn("DONE.")
		return DAT.TEAM_MEMBERS[uid].name
	} else {
		return false
	}
}

function sendFileMsg() {
	try {
		var contents = JSON.parse(fs.readFileSync("config/sendable.json", "utf8"))
		client.channels.cache.get(contents.channel.toString()).send(contents.message)
	} catch (error) {
		console.error(error)
	}
}

async function setStatus(client, statusType, activityVerb, activityName) {
	await client.user.setPresence({ activity: { name: activityName, type: activityVerb }, status: statusType })
		.then(console.log)
		.catch(console.error)
	await client.user.setStatus(statusType)
		.then(console.log)
		.catch(console.error)
}

async function updateDiscordIds(client, guildIdString) {
	var keys = Object.keys(DAT.DISCORD_LINKS)
	var guild = await client.guilds.resolve(guildIdString)

	for (let i = 0; i < keys.length; i++) {
		var link = DAT.DISCORD_LINKS[keys[i]]
		try {
			var guildMember = await guild.members.fetch(link.id) || false
			if (guildMember) {
				var member = guildMember
				DAT.DISCORD_LINKS[keys[i]] = member || DAT.DISCORD_LINKS[i]
			}
		} catch (error) {
			console.error(error)
		}
	}
	updateCache(["DISCORD_LINKS"])
}

async function refresh(options = {}) {
	try {
		const updated = await DAT.update(options)
		syncPusherAuth()
		if (htbAuthFailureNotified) clearHtbAuthFailureAlert()
		return updated
	} catch (error) {
		if (error instanceof HtbTokenExpiredError || error instanceof HtbAuthError) {
			await notifyCaptainsOfHtbAuthFailure(error)
		}
		throw error
	}
}

function syncPusherAuth() {
	if (HTB_PUSHER_OWNS_SUBSCRIPTION) {
		HTB_PUSHER_OWNS_SUBSCRIPTION.auth = DAT.V4API.getApiToken()
	}
}

function formatHtbAuthError(error) {
	if (error instanceof HtbTokenExpiredError) {
		return "HTB access token expired. Update HTB_V4_TOKEN + HTB_REFRESH_TOKEN (or use `seven set htb tokens <access> <refresh>`), then retry."
	}
	if (error instanceof HtbAuthError) {
		return `HTB authentication failed: ${error.message}`
	}
	return `HTB refresh failed: ${error.message}. Check sevenbot-error.log.`
}

function buildHtbAuthFailureAlert(error) {
	return [
		"**HTB OAuth refresh failed**",
		"",
		formatHtbAuthError(error),
		"",
		"Re-login on labs.hackthebox.com, capture a new token pair (DevTools → login/refresh), then update `.env` or run `seven set htb tokens <access> <refresh>`.",
		"The bot stays online with cached data until tokens are fixed.",
	].join("\n")
}

function clearHtbAuthFailureAlert() {
	htbAuthFailureNotified = false
	pendingHtbAuthFailure = null
}

async function notifyCaptains(client, text) {
	let captainIds = []
	try {
		captainIds = JSON.parse(process.env.CAPTAIN_DISCORD_IDS || "[]")
	} catch (error) {
		log.warn("Failed to parse CAPTAIN_DISCORD_IDS for HTB auth alert", { message: error.message })
		return false
	}

	if (!captainIds.length) {
		log.warn("CAPTAIN_DISCORD_IDS is empty — HTB auth alert not sent")
		return false
	}

	let sent = false
	for (const captainId of captainIds) {
		try {
			const user = await client.users.fetch(captainId)
			await user.send(text)
			sent = true
		} catch (error) {
			log.warn("Failed to DM captain HTB auth alert", { captainId, message: error.message })
		}
	}
	return sent
}

function isDiscordClientReady(discordClient) {
	return Boolean(discordClient?.user)
}

async function notifyCaptainsOfHtbAuthFailure(error) {
	if (!(error instanceof HtbTokenExpiredError || error instanceof HtbAuthError)) return
	if (htbAuthFailureNotified) return

	const text = buildHtbAuthFailureAlert(error)
	log.error("HTB auth failure — notifying captains", { message: error.message })

	if (!isDiscordClientReady(client)) {
		pendingHtbAuthFailure = error
		return
	}

	try {
		if (await notifyCaptains(client, text)) {
			htbAuthFailureNotified = true
		}
	} catch (notifyError) {
		log.warn("Captain HTB auth alert failed", { message: notifyError.message })
	}
}

async function notifyAdmins(client, text) {
	if (DISCORD_ANNOUNCE_CHAN) {
		try {
			await DISCORD_ANNOUNCE_CHAN.send(text)
			return
		} catch (error) {
			log.warn("Failed to post admin alert to announce channel", { message: error.message })
		}
	}

	let adminIds = []
	try {
		adminIds = JSON.parse(process.env.ADMIN_DISCORD_IDS || "[]")
	} catch (error) {
		log.warn("Failed to parse ADMIN_DISCORD_IDS for token alert", { message: error.message })
		return
	}

	for (const adminId of adminIds) {
		try {
			const user = await client.users.fetch(adminId)
			await user.send(text)
		} catch (error) {
			log.warn("Failed to DM admin alert", { adminId, message: error.message })
		}
	}
}

function setupHtbTokenFileWatcher() {
	const tokenFile = process.env.HTB_TOKEN_FILE
	if (!tokenFile) return

	const loadTokensFromFile = async () => {
		try {
			if (!fs.existsSync(tokenFile)) return
			const data = JSON.parse(fs.readFileSync(tokenFile, "utf8"))
			const accessToken = (data.access_token || data.HTB_V4_TOKEN || "").trim()
			const refreshToken = (data.refresh_token || data.HTB_REFRESH_TOKEN || "").trim()
			if (!accessToken || !refreshToken) return
			DAT.V4API.API_TOKEN = accessToken
			DAT.V4API.REFRESH_TOKEN = refreshToken
			DAT.V4API.tokenExpiryWarned = false
			if (DAT.V4API.checkTokenExpiring(accessToken)) {
				await DAT.V4API.refreshSessionToken()
			}
			clearHtbAuthFailureAlert()
			syncPusherAuth()
			log.info("HTB OAuth tokens reloaded from file", { path: tokenFile })
		} catch (error) {
			log.warn("Failed to reload HTB_TOKEN_FILE", { path: tokenFile, message: error.message })
		}
	}

	loadTokensFromFile()
	fs.watchFile(tokenFile, { interval: 60000 }, loadTokensFromFile)
	log.info("Watching HTB_TOKEN_FILE for changes", { path: tokenFile })
}

function startHtbTokenExpiryMonitor(client) {
	const warnDays = Number(process.env.HTB_TOKEN_EXPIRY_WARN_DAYS) || 1
	const warnMs = warnDays * 24 * 60 * 60 * 1000
	let warned = false

	const check = async () => {
		const expiry = DAT.V4API.getTokenExpiry()
		if (!expiry) return
		const msLeft = expiry.getTime() - Date.now()
		if (msLeft > 0 && msLeft <= warnMs && !warned) {
			warned = true
			const text = `HTB access token expires on ${expiry.toUTCString()}. OAuth refresh should renew it automatically; if sync fails, re-login on HTB and update tokens via \`seven set htb tokens <access> <refresh>\`.`
			log.warn(text)
			await notifyAdmins(client, text)
		}
	}

	check()
	setInterval(check, 6 * 60 * 60 * 1000)
}

async function main() {
	await importDbBackup()
	
	DAT.TEAM_STATS.teamFounder = process.env.FOUNDER_HTB_ID
	try {
		await DAT.init()
		log.info("HTB OAuth session loaded", { expiresAt: DAT.V4API.getTokenExpiry()?.toISOString() || "unknown" })
	} catch (error) {
		if (error instanceof HtbTokenExpiredError || error instanceof HtbAuthError) {
			pendingHtbAuthFailure = error
			log.error("HTB OAuth init failed — bot continues with cached data", { message: error.message })
		} else {
			throw error
		}
	}
	setupHtbTokenFileWatcher()
	HTB_PUSHER_OWNS_SUBSCRIPTION = new HtbPusherSubscription("97608bf7532e6f0fe898",
		[
			{ channel: "owns-channel", event: "display-info" },
			{ channel: "notifications-channel", event: "display-notifications" },
			{ channel: "infobox-channel", event: "display-info" },
			{ channel: "shoutbox-channel", event: "display-shout" },
			{ channel: "joins-channel", event: "display-info" }
		], DAT.V4API.getApiToken())

	if (!DEV_MODE_ON) {
		await DAT.syncAgent()
		try {
			const missingSections = DAT.getSectionsNeedingUpdate({})
			if (missingSections.length) {
				log.info("Starting HTB data refresh on boot", {
					mode: DAT.FIRST_RUN ? "first-run" : "partial-bootstrap",
					sections: missingSections,
					plan: DAT.describeUpdatePlan(missingSections, {}),
				})
			} else {
				log.info("Skipping HTB API refresh on boot — using cached DB data", {
					machines: Object.keys(DAT.MACHINES).length,
					challenges: Object.keys(DAT.CHALLENGES).length,
					members: Object.keys(DAT.TEAM_MEMBERS).length,
					lastUpdate: DAT.LAST_UPDATE,
				})
			}
			const refreshStarted = Date.now()
			const updated = await refresh({ force: false })
			if (updated) {
				DAT.syncDbExportFields()
				await updateCache()
			}
			log.info("Initial data refresh completed", {
				updated,
				machines: Object.keys(DAT.MACHINES).length,
				challenges: Object.keys(DAT.CHALLENGES).length,
				members: Object.keys(DAT.TEAM_MEMBERS).length,
				lastUpdate: DAT.LAST_UPDATE,
				durationMs: Date.now() - refreshStarted,
			})
		} catch (error) {
			log.error("Initial data refresh failed", { message: error.message, stack: error.stack })
		}
		setInterval(async () => {
			try {
				const updated = await refresh({ force: true })
				log.info("Scheduled data refresh completed", { updated })
				if (updated) {
					DAT.syncDbExportFields()
					var cacheUpdated = await updateCache()
					if (cacheUpdated) { log.info("DB backup updated after scheduled refresh") }
				}
			} catch (error) {
				log.error("Scheduled data refresh failed", { message: error.message })
			}
		}, 1 * 60 * 60 * 1000)
	}

	HTB_PUSHER_OWNS_SUBSCRIPTION.on("pusherevent", async message => {
		try {
			if (DEV_MODE_ON) {
				PUSHER_MSG_LOG.push(message)
				let data = JSON.stringify(PUSHER_MSG_LOG, null, 2)
				fs.writeFileSync("./cache/PUSHER_MSG_LOG.json", data)
			}
			switch (message.type) {
			case "machine": case "challenge": case "endgame": case "fortress": case "prolab":
				if (DAT.DISCORD_LINKS[message.uid] || message.blood || DAT.TEAM_MEMBERS[message.uid]) {
					console.warn("PUSHER OWN::: ", message)
					DISCORD_ANNOUNCE_CHAN.send(EGI.pusherOwn(await DAT.resolveEnt(message.uid, "member", true, null, true), message.target, message.type, message.flag || message.type, message.blood))
					if (message.blood) {
						console.log("This was detected to be a first blood celebration message!")
						DAT.integratePusherBlood(await DAT.resolveEnt(message.uid, "member", true, null, true), message.uid, message.time, message.type, message.target, message.flag, true)
						for (let i = 0; i < 3; i++) {
							DISCORD_ANNOUNCE_CHAN.send("‼").then(message => message.delete())
						}
					}
				}
				if (DAT.TEAM_MEMBERS[message.uid]) {
					console.warn("RELEVANT PUSHER OWN INCOMING::: ")
					DAT.integratePusherOwn(message.uid, message.time, message.type, message.target, message.flag, true)
				}
				break
			case "launch":
				console.log("PUSHER: Got machine launch notification.")
				console.log(message)
				if (message.target && LAUNCH_TARGETS_DEBOUNCE_CACHE.some(e => e == message.target)) {
					console.info("Debounced a launch message -- take that, entropy!")
				} else {
					LAUNCH_TARGETS_DEBOUNCE_CACHE.push(message.target)
					DISCORD_ANNOUNCE_CHAN.send(EGI.pusherNotif(message))
				}
				break
			default:
				if (message.uid && DAT.DISCORD_LINKS[message.uid]) {
					DISCORD_ANNOUNCE_CHAN.send(EGI.pusherNotif(message))
				}
				break
			}
		} catch (error) {
			console.error(error)
		}

	})


	client.login(process.env.BOT_TOKEN)               // BOT_TOKEN is the Discord client secret
	client.on("disconnect", function (erMsg, code) {
		console.warn("----- Bot disconnected from Discord with code", code, "for reason:", erMsg, "-----")
		client.connect()
	})

	client.on("ready", async () => {
		console.log("[DISCORD]::: CLIENT READY")

		DISCORD_ANNOUNCE_CHAN = await client.channels.fetch(process.env.DISCORD_ANNOUNCE_CHAN_ID.toString())
		startHtbTokenExpiryMonitor(client)

		if (pendingHtbAuthFailure) {
			const pendingError = pendingHtbAuthFailure
			pendingHtbAuthFailure = null
			await notifyCaptainsOfHtbAuthFailure(pendingError)
		}
	
		/** Test the Pusher owns functionality */
		if (DEV_MODE_ON) {
			// var PUSHER_DUMMY_DATA = require("./cache/PUSHER_DUMMY_DATA.json")
			// PUSHER_DUMMY_DATA.forEach(e => {
			// 	HTB_PUSHER_OWNS_SUBSCRIPTION.channels.find(chan => chan.name == e[0].channel).emit(e[0].event, { text: e[1], channel: e[0].channel })
			// })
			
		}
		

		console.log(`[DISCORD]::: ${Object.values(DAT.DISCORD_LINKS).length} guild members have linked their HTB accounts.`)
		await updateDiscordIds(client, process.env.DISCORD_GUILD_ID.toString())
		if (!DAT.FIRST_RUN) {
			SEND.messagePrimaryDiscordAdmin("Hey there! 👋", "The name's Seven, nice to be of service. 🍉\n" +
			"Try using 'man seven' to see what I can help you and the team with!\n" +
			"\nNeed help with something? Feel free to reach out on my [Discord channel](https://discord.gg/f3v4YuU3rr) " + 
			"or [GitHub repo](https://github.com/psyray/Seven) via an issue!" 
			)
		}
		setInterval(() => updateDiscordIds(client, process.env.DISCORD_GUILD_ID.toString()), 30 * 60 * 1000)   // UPDATE DISCORD LINKS EVERY 30 MINUTES
	})
	client.on("message", message => {
		message.content = message.content.substring(0, 255)
		if (!DEV_MODE_ON) {
			try {
				if (SEND.PASSTHRU && message.channel.type != "dm" && !message.author.bot) {
					SEND.passthru_register(message)
				} else if (isAdmin(message.author)
					&& SEND.PASSTHRU
					&& message.referencedMessage
					&& message.channel.type == "dm"
					&& isAdmin(message.channel.recipient)) {
					SEND.passthru(message)
				} else {
					handleMessage(message)
				}
			} catch (error) {
				console.log(error)
				message.channel.stopTyping()
			}
		} else if (isAdmin(message.author)) {
			console.warn("Message content:", message.content)
			console.log("Message is from dev admin, responding...")
			if (message.content.includes("📤")) {
				console.log("Sending file msg...")
				sendFileMsg()
			} else {
				try {
					if (SEND.PASSTHRU && message.channel.type != "dm" && !message.author.bot) {
						SEND.passthru_register(message)
					} else if (isAdmin(message.author)
						&& SEND.PASSTHRU
						&& message.reference
						&& message.channel.type == "dm"
						&& isAdmin(message.channel.recipient)) {
						SEND.passthru(message)
					} else {
						handleMessage(message)
					}
				} catch (error) {
					console.log(error)
					message.channel.stopTyping()
				}
			}
		} else if (!message.author.bot) {
			console.log("Dev mode enabled but received message not from admin. Not responding from this instance...")
		}
	})
}

main().catch((error) => {
	log.error("Seven startup failed", { message: error.message, stack: error.stack })
	process.exitCode = 1
})


async function sendFlagboardMsg(message) {
	await SEND.embed(message, EGI.teamFlagboard(), true)
	if (H.maybe(0.20)) await SEND.human(message, H.any("Globalization is a form of artificial intelligence. 🍉", "Teamwork makes the dream work 👑"), true)
}

async function sendTeamLeaderMsg(message) {
	var member = DAT.resolveEnt(DAT.getTopMembers(1), "member", true, message)
	await SEND.embed(message, EGI.teamLeader(member))
	if (H.maybe(0.6)) await SEND.human(message, "Let's give a round of applause!", true)
	if (H.maybe(0.4)) await SEND.human(message, "Pain is the heart of success. No one knows that like " + member.name + "! 🎉", true)
}

async function sendMemberChartMsg(message, username, term) {
	message.channel.startTyping()
	var member = DAT.resolveEnt(username, "member", false, message)
	if (!member) {
		SEND.embed(message, EGI.ENTITY_UNFOUND.setDescription(`Could not find member '${username}'.`))
		return
	}
	const { term: chartTerm, chartImage } = await buildMemberProgressChart(
		member,
		term,
		(id, normalizedTerm) => DAT.V4API.getMemberAchievementChart(id, normalizedTerm),
		CHART_RENDERER.renderChart.bind(CHART_RENDERER)
	)
	SEND.embed(message, EGI.memberAchievementTimelineChart(member, chartTerm, chartImage))
}

async function sendActivityMsg(message, member, targetType = undefined, sortBy = undefined, sortOrder = undefined, limit = 40) {
	var series = []
	message.channel.startTyping()
	var owns = await DAT.filterMemberOwns(member.id, targetType, "date", "asc", limit)
	owns.sort((a, b) => Date.parse(b) - Date.parse(a))
	var orderedDates = owns.map(e => e.date).sort((a, b) => Date.parse(a) - Date.parse(b))
	if (orderedDates.length < 2) {
		orderedDates.unshift((new Date(Date.now() - 604800000).toISOString()))
		orderedDates.push((new Date()).toISOString())
	}
	var dateRange = { oldest: new Date(orderedDates[0]), latest: new Date(), interval: new Date(orderedDates[orderedDates.length - 1]) }
	var types = ["user", "root", "challenge", "endgame", "fortress"]
	types.forEach(thisType => {
		var filtered = owns.filter(e => e.object_type == thisType || e.type == thisType)
		series.push(filtered.map((i, idx) => ([Date.parse(i.date), filtered.length - idx])))
	})
	series.forEach(e => {
		e.unshift([Date.parse(orderedDates[orderedDates.length - 1]) || (new Date()).getTime(), e.length || 0])
		e.push([Date.parse(orderedDates[0]) || (new Date()).getTime(), 0])
	})
	const chartImage = await buildMemberActivityChart(
		member,
		series,
		dateRange,
		CHART_RENDERER.renderChart.bind(CHART_RENDERER)
	)
	SEND.embed(message, EGI.memberActivity(member, limit, targetType, sortOrder, sortBy, chartImage))
}


/**
 * Send a query to the dialogflow agent, and return the query result.
 * @param {Object} message A Discord Message object.
 */
function understand(message) {
	// var sessionPath = dflow.sessionPath(process.env.GOOGLE_CLOUD_PROJECT, "Production", "seven-server", message.author.id)
	var sessionPath = dflow.projectAgentSessionPath(process.env.GOOGLE_CLOUD_PROJECT, message.author.id)
	console.log(`[DF]::: Sending message from ${message.author.username} to DialogFlow for comprehension`)
	const request = {
		session: sessionPath,
		queryInput: {
			text: {
				// The query to send to the dialogflow agent
				text: message.cleanContent,
				// The language used by the client (en-US)
				languageCode: "en",
			},
		},
	}

	return dflow.detectIntent(request).then(
		responses => {
			return responses[0].queryResult
		}
	)
}

/**
 * @param {import("discord.js").Message} message
 * @param {string} [note]
 */
async function sendHelpMsg(message, note) {
	if (note) {
		console.log("NOTE: " + note)
		await SEND.human(message, note, true)
	}
	await H.wait(300)

	const role = isAdmin(message.author)
		? "admin"
		: isCaptain(message.author)
			? "captain"
			: "member"
	const helpChunks = strings.buildHelpMessages(role, {
		isUniversity: Boolean(process.env.HTB_UNIVERSITY_ID),
	})

	for (const chunk of helpChunks) {
		await message.channel.send(chunk)
		if (helpChunks.length > 1) await H.wait(250)
	}
}

async function linkDiscord(message, idType, id) {
	Object.entries(DAT.DISCORD_LINKS).filter(e => e[1].id == message.author.id).forEach(e => delete DAT.DISCORD_LINKS[e[0]])
	switch (idType) {
	case "uid":
		try {
			DAT.DISCORD_LINKS[id] = (message.channel.type == "dm" ? message.author : await message.guild.members.fetch(`${message.author.id}`))
			await SEND.human(message, H.any("Associated HTB user " + DAT.getMemberById(id).name + " (" + id + ")", "HTB user " + DAT.getMemberById(id).name + " (" + DAT.getMemberById(id).id + ") has been linked") + " to your Discord account (" + message.author.tag + "). Thanks! 🙂", true)
			updateCache(["DISCORD_LINKS"])
			//exportData(DISCORD_LINKS, "discord_links.json")
		} catch (error) { console.log(error) }
		break

	case "uname": try {
		DAT.DISCORD_LINKS[DAT.getMemberByName(id).id] = (message.channel.type == "dm" ? message.author : await message.guild.members.fetch(`${message.author.id}`))
		await SEND.human(message, "HTB user " + F.STL(F.toTitleCase(id), "bs") + " (" + DAT.getMemberByName(id).id + ") has been linked to your Discord account (" + F.STL("🌀 " + message.author.tag, "bs") + "). Thanks! 🙂", true)
		updateCache(["discord_links"])
		// exportData(DISCORD_LINKS, "discord_links.json")
	} catch (error) { console.log(error) }
		break
	default:
		break
	}

}

async function unlinkDiscord(message, id) {
	if (id in DAT.DISCORD_LINKS) {
		try {
			delete DAT.DISCORD_LINKS[id]
			await SEND.human(message, "[Discord Unlink] Dissociated HTB user " + DAT.getMemberById(id).name + " (" + id + ") from Discord account (" + message.author.tag + ")", true)
			updateCache(["discord_links"])
			// exportData(DISCORD_LINKS, "discord_links.json")
			return true
		} catch (error) {
			await SEND.human(message, "[Discord Unlink] There was an issue dissociating '" + DAT.getMemberById(id).name + "' (" + id + ") from Discord account (" + message.author.tag + "). \nMaybe the id is wrong, or perhaps I wasn't tracking that in the first place.", true)
			console.log(error)
			return true
		}
	} else {
		await SEND.human(message, "[Discord Unlink] It looks like no Discord association exists for this user (make sure the ID is correct).\nNo changes were made.", true)
		return false
	}

}


async function forgetHtbDataFlow(message, identifier, uid) {
	switch (identifier) {
	case "htb":
		try {
			var deletedUname = ignoreMember(uid)
			if (deletedUname) {
				await SEND.human(message, "Blacklisted user " + uid + " (" + deletedUname + ") from future scans.", true)
			} else {
				await SEND.human(message, "It looks like no HTB user data is actually being collected for this user (make sure the ID is correct).", true)
			}
		} catch (error) { console.log(error) }
		break
	case "discord":
		unlinkDiscord(message, uid)
		break
	case "all":
		try {
			ignoreMember(uid)
		} catch (error) {
			console.error(error)
		}
		unlinkDiscord(message, uid)
		await SEND.human(message, "Forgetting any HTB data and Discord association for this user and ignoring future achievements.", true); break
	default:
		break
	}

}

async function doFakeReboot(message, note) {
	await SEND.human(message, note, true)
	await client.user.setStatus("idle")
		.then(console.log)
		.catch(console.error)
	await H.wait(3500)
	await client.user.setStatus("online")
		.then(console.log)
		.catch(console.error)
}

async function admin_setStatus(message, params) {
	if (isAdmin(message.author)) {
		var status = params.discordStatusType.stringValue
		var activity = params.discordStatusActivity.stringValue
		var actverb = params.discordStatusVerb.stringValue
		SEND.human(message, H.any("You're the boss!\nsetting the status 😊",
			"Ok " + message.author.username + ", you got it!",
			"you got it, " + message.author.username + " 😁",
			"no prob, i'm on it 🍉",
			"ok, on it! 🍉"), false)
		await setStatus(message.client, (status ? status : "online"), (actverb ? actverb : ""), (activity ? activity : ""))
	} else {
		SEND.human(message, `You're not my boss! 🤔\nno can do.\nTry asking <@!${JSON.parse(process.env.ADMIN_DISCORD_IDS)[0]}>!`)
	}
}

async function forceUpdate(message) {
	if (isCaptain(message.author) || isAdmin(message.author)) {
		const plan = DAT.describeUpdatePlan(DAT.getSectionsNeedingUpdate({ force: true }), { force: true })
		SEND.human(message, H.any("You're the boss!\nSmart sync in progress 😊",
			"Ok " + message.author.username + ", refreshing team data!",
			"you got it, boss! 😁",
			"no prob, i'm on it 🍉",
			"ok, on it! 🍉") + `\n(${plan})`, false)
		log.info("Force update requested", { plan })
		try {
			await refresh({ force: true })
			console.log("Data refresh completed!")
			DAT.syncDbExportFields()
			await updateCache().then(SEND.human(message, H.any("hey I finished updating the DB! 😊",
				"Heyo, the DB update is finished!",
				"The data has been updated!",
				"DB update complete!",
				"Achivement data has been updated. 😊"), false))
		} catch (error) {
			log.error("Force update failed", { message: error.message, stack: error.stack })
			await SEND.human(message, formatHtbAuthError(error), false)
		}
	} else {
		SEND.human(message, `You're not my boss! 🤔\nno can do.\nTry asking <@!${JSON.parse(process.env.ADMIN_DISCORD_IDS)[0]}>!`)
	}
}

async function admin_setHtbTokens(message, accessToken, refreshToken) {
	if (!isAdmin(message.author)) {
		SEND.human(message, `You're not my boss! 🤔\nno can do.\nTry asking <@!${JSON.parse(process.env.ADMIN_DISCORD_IDS)[0]}>!`)
		return
	}
	try {
		DAT.V4API.setOAuthTokens(accessToken, refreshToken)
		clearHtbAuthFailureAlert()
		syncPusherAuth()
		await SEND.human(message, `HTB OAuth tokens updated. Access expires: ${DAT.V4API.getTokenExpiry()?.toUTCString() || "unknown"}`, false)
	} catch (error) {
		await SEND.human(message, formatHtbAuthError(error), false)
	}
}

async function admin_clearCached(message) {
	if (isAdmin(message.author)) {
		SEND.human(message, "Clearing in-memory HTB data and running a full refresh (DB backup is not wiped).", false)
		log.warn("Admin cache clear requested", { user: message.author.id })
		DAT.MISC = {}
		DAT.TEAM_MEMBERS = {}
		DAT.TEAM_STATS = {}
		DAT.MACHINES = {}
		DAT.CHALLENGES = {}
		DAT.FORTRESSES = {}
		DAT.ENDGAMES = {}
		DAT.PROLABS = {}
		try {
			await refresh({ full: true })
			DAT.syncDbExportFields()
			await updateCache()
			await SEND.human(message, H.any("Done! Cache cleared and data refreshed from HTB."), false)
			log.info("Admin cache clear completed with refresh", {
				machines: Object.keys(DAT.MACHINES).length,
				members: Object.keys(DAT.TEAM_MEMBERS).length,
			})
		} catch (error) {
			log.error("Admin cache clear refresh failed", { message: error.message })
			await SEND.human(message, formatHtbAuthError(error), false)
		}
	} else {
		SEND.human(message, `You're not my boss! 🤔\nno can do.\nTry asking <@!${JSON.parse(process.env.ADMIN_DISCORD_IDS)[0]}>!`)
	}
}

const checkIsSevenMsg = /[\t ]?seven\W?/g

function logSmokeResult(smokeId, meta) {
	if (!smokeId || process.env.SMOKE_TRACE !== "1") return
	console.log(`[SMOKE] result ${JSON.stringify({ smokeId, ...meta })}`)
}

async function handleMessage(message) {
	let smokeId = null
	const smokePrefix = message.content.match(/^\[SMOKE:([^\]]+)\]\s*/)
	if (smokePrefix) {
		smokeId = smokePrefix[1]
		message.content = message.content.replace(/^\[SMOKE:[^\]]+\]\s*/, "")
		if (process.env.SMOKE_TRACE === "1") {
			console.log(`[SMOKE:${smokeId}] start prompt="${message.content}"`)
		}
	}
	message.content = message.content.split("\n").filter(e => !e.startsWith("> ")).join("\n")
	if (message.content.toLowerCase() != "seven" && (message.channel.type == "dm" || message.content.toLowerCase().includes("seven"))) {
		if (!message.author.bot) {
			if (message.content.toLowerCase().match(checkIsSevenMsg)) {
				message.content = message.content.toLowerCase().replace(checkIsSevenMsg, "")
			}
			var htbItem = DAT.resolveEnt(message.content, null, null, message, false)
			if (message.content.toLowerCase().trim() == "help") {
				try { sendHelpMsg(message); logSmokeResult(smokeId, { intent: "help", ok: true }) } catch (e) { console.log(e); logSmokeResult(smokeId, { intent: "help", ok: false, error: String(e) }) }
			} else if (htbItem) {
				console.log("[SEVEN]::: HTB Entity was resolved.")
				try { SEND.embed(message, await EGI.infoFor(htbItem.type, htbItem.name, null, message, htbItem)); logSmokeResult(smokeId, { intent: "resolveEnt", ok: true, type: htbItem.type }) } catch (e) { console.error(e); logSmokeResult(smokeId, { intent: "resolveEnt", ok: false, error: String(e) }) }
			} else {
				var result = await understand(message)
				var dfParams = struct.decode(result.parameters)
				var localIntent = resolveLocalIntent(message.content, result, dfParams)
				var isRipe = localIntent?.allRequiredParamsPresent ?? result.allRequiredParamsPresent
				var job = localIntent?.intent ?? result.intent.displayName
				console.log("[DF]::: Detected intent: " + result.intent.displayName + " | " + (isRipe ? (result.parameters.length ? "All required params present." : "No required parameters") : "Required parameters missing."))
				if (localIntent) console.log("[NLP]::: Local intent override:", job, localIntent.parameters)
				// console.dir(result)
				if (result.intent && isRipe) {
					var inf = result.parameters.fields
					/** (Dialogflow) The returned entity parameters, parsed from user query. */
					var P = localIntent?.parameters ?? dfParams
					if (Object.keys(P).length) console.log("Extracted:", P)
					var smokeOk = true
					try {
						switch (job) {
						case "help": sendHelpMsg(message); break
						case "admin.forceUpdateData": await forceUpdate(message); break
						case "admin.setHtbTokens": await admin_setHtbTokens(message, P.htbAccessToken || P.accessToken, P.htbRefreshToken || P.refreshToken); break
						case "admin.passthruOn": if (isAdmin(message.author)) { SEND.human(message, `Parrot mode ${F.STL("ON", "bs")}. 🦜`); SEND.passthruOn() } else { SEND.human(message, "Sorry, not for you. 🦜") } break
						case "admin.passthruOff": if (isAdmin(message.author)) { SEND.human(message, `Parrot mode ${F.STL("OFF", "bs")}. 🦜`); SEND.passthruOff() } else { SEND.human(message, "Sorry, not for you. 🦜") } break
						case "admin.clearCached": await admin_clearCached(message); break
						case "admin.setStatus": admin_setStatus(message, inf); break
						case "admin.clearEmoji": E.clearCustEmoji(client).then(SEND.human(message, "Successfully purged Seven-related emoji from supporting channel.", false)); break
						case "admin.setupEmoji": E.initCustEmoji(client).then(SEND.human(message, "Successfully initialized Seven-related emoji on supporting channel.", false)); break
						case "agent.getPickled": if (!SEND.GET_PICKLED) { await SEND.human(message, result.fulfillmentText, true); SEND.human(message, "```css\n[PICKLE MODE ACTIVATED]```", true); SEND.pickleOn() } else { SEND.human(message, "` ERROR: circuits already scrambled... `") } break
						case "agent.getUnpickled": if (SEND.GET_PICKLED) { SEND.pickleOff(); SEND.human(message, "Fine then...\nThat was kinda fun though. 😏") } else { SEND.human(message, "I'm already talking normally!!!") } break
						case "forgetMe.htbIgnore.getUserID": forgetHtbDataFlow(message, "htb", P.uid); break
						case "forgetMe.discordUnlink.getUserID": forgetHtbDataFlow(message, "discord", P.uid); break
						case "forgetMe.all.getUserID": forgetHtbDataFlow(message, "all", P.uid); break
						case "linkDiscord": linkDiscord(message, (P.uid ? "uid" : "uname"), (P.uid ? P.uid : P.username)); break
						case "unforgetMe": unignoreMember(P.uid); SEND.human(message, result.fulfillmentText, true); break
						case "getTime": SEND.embed(message, EGI.binClock(await generateBinaryClockImage())); break
						case "getTeamBadge": SEND.human(message, F.noncifyUrl(`https://app.hackthebox.com/badge/team/image/${DAT.TEAM_STATS.id}`), true).then(() => SEND.human(message, result.fulfillmentText, true)); break
						case "getTeamInfo": SEND.embed(message, EGI.teamInfo()); break
						case "getTeamLeaders": SEND.embed(message, EGI.teamLeaderboard()); break
						case "getTeamLeader": sendTeamLeaderMsg(message, result.fulfillmentText); break
						case "getTeamRanking": SEND.embed(message, EGI.teamRank()); break
						case "getFlagboard": sendFlagboardMsg(message); break
						case "getTargetInfo": {
							const targetName = P.targetName || extractTargetNameFromMessage(message.content, P.targetType)
							SEND.embed(message, await EGI.infoFor(P.targetType, targetName))
							break
						}
						case "getTargetOwners": SEND.embed(message, EGI.teamOwnsForTarget(DAT.resolveEnt(P.target, P.htbTargetType), undefined, P.ownType, P.ownFilter)); break
						case "checkMemberOwnedTarget": SEND.embed(message, EGI.checkMemberOwnedTarget(DAT.resolveEnt(P.username, "member", false, message), DAT.resolveEnt(P.targetname, P.targettype), P.flagNames)); break
						case "getFirstBox": SEND.embed(message, await EGI.infoFor("machine", "Lame")); await SEND.human(message, result.fulfillmentText); break
						case "agent.doReboot": doFakeReboot(message, result.fulfillmentText); break
						case "getNewBox": SEND.embed(message, await EGI.infoFor("machine", DAT.getNewBoxId(), true)); break
						case "getMemberInfo": {
							let member = DAT.resolveEnt(P.username, "member", false, message)
							if (member?.id && !Array.isArray(member.endgames)) {
								member = await DAT.V4API.getCompleteMemberProfileByMemberPartial(member)
								if (member) member = Object.assign({ type: "member" }, member)
							}
							SEND.embed(message, await EGI.infoFor("member", P.username, false, message, member || { type: null }))
							break
						}
						case "getMemberRank": SEND.embed(message, EGI.memberRank(DAT.resolveEnt(P.username, "member", false, message))); break
						case "getMemberChart": sendMemberChartMsg(message, H.sAcc(DAT.resolveEnt(P.username, "member", false, message), "name") || P.username, normalizeChartTerm(P.interval)); break
						case "filterMemberOwns": sendActivityMsg(message, DAT.resolveEnt(P.username, "member", false, message),
							P.targettype, P.sortby, P.sortorder, P.limit || 24); break
						case "filterTargets": SEND.embed(message, EGI.filteredTargets(DAT.filterEnt(message,
							P.targettype, P.sortby, P.sortorder, P.limit || 15, null, null, P.memberName, P.targetFilterBasis),
						P.sortby,
						P, message), true
						); break
						case "filterMembers": SEND.embed(message, EGI.filteredTargets(DAT.filterEnt(message,
							P.targettype, P.sortby, P.sortorder, P.limit || 15, null, null, P.memberName, P.targetFilterBasis),
						P.sortby,
						P, message), true
						); break
						case "Default Fallback Intent": {
							htbItem = await DAT.resolveEnt(message.content.replace(/\s/g, ""), null, null, message, true)
							if (htbItem) {
								SEND.embed(message, await EGI.infoFor(null, null, null, message, htbItem)); break
							} else { await SEND.human(message, result.fulfillmentText) }
						} break
						default:
							message.channel.stopTyping(true)
							if (result.fulfillmentText) {
								await SEND.human(message, result.fulfillmentText)
								message.channel.stopTyping(true)
							}
						}
					} catch (error) {
						console.error(error)
						smokeOk = false
						logSmokeResult(smokeId, { intent: job, ok: false, error: String(error) })
					}
					if (smokeOk) logSmokeResult(smokeId, { intent: job, ok: true, dfIntent: result.intent.displayName, local: Boolean(localIntent) })
					message.channel.stopTyping(true)
				} else if (localIntent) {
					var P = localIntent.parameters
					smokeOk = true
					try {
						switch (localIntent.intent) {
						case "filterTargets":
							SEND.embed(message, EGI.filteredTargets(DAT.filterEnt(message,
								P.targettype, P.sortby, P.sortorder, P.limit || 15, null, null, P.memberName, P.targetFilterBasis),
							P.sortby, P, message), true)
							break
						case "getMemberInfo": {
							let member = DAT.resolveEnt(P.username, "member", false, message)
							if (member?.id && !Array.isArray(member.endgames)) {
								member = await DAT.V4API.getCompleteMemberProfileByMemberPartial(member)
								if (member) member = Object.assign({ type: "member" }, member)
							}
							SEND.embed(message, await EGI.infoFor("member", P.username, false, message, member || { type: null }))
							break
						}
						case "getTargetInfo": {
							const targetName = P.targetName || extractTargetNameFromMessage(message.content, P.targetType)
							SEND.embed(message, await EGI.infoFor(P.targetType, targetName))
							break
						}
						case "getNewBox":
							SEND.embed(message, await EGI.infoFor("machine", DAT.getNewBoxId(), true))
							break
						default:
							await SEND.human(message, result.fulfillmentText)
						}
					} catch (error) {
						console.error(error)
						smokeOk = false
						logSmokeResult(smokeId, { intent: localIntent.intent, ok: false, error: String(error) })
					}
					if (smokeOk) logSmokeResult(smokeId, { intent: localIntent.intent, ok: true, local: true })
					message.channel.stopTyping(true)
				} else {
					htbItem = await DAT.resolveEnt(message.content.replace(/\s/g, ""), null, null, message, true)
					if (htbItem) {
						SEND.embed(message, await EGI.infoFor(null, null, null, message, htbItem))
						logSmokeResult(smokeId, { intent: "resolveEnt", ok: true, type: htbItem.type })
					} else {
						await SEND.human(message, result.fulfillmentText)
						logSmokeResult(smokeId, { intent: result.intent.displayName, ok: false, fallback: true })
					}
				}
			}
		}
	}
}

