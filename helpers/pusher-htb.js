/**
 * Implements functionality for parsing and responding to Pusher events from the public HTB Shoutbox.
 @module Pusher-Htb
*/
const { JSDOM } = require("jsdom")
const EventEmitter = require("events")
const Pusher = require("pusher-client")
const { Helpers: H } = require("../helpers/helpers.js")
const { HTB_APP_BASE } = require("../config/htb.js")
const { createLogger } = require("../helpers/logger.js")
const TD = require("turndown")

const log = createLogger("pusher-htb")

const TARGET_LINK_TYPES = [
	{ match: "starting-point", type: "starting_point" },
	{ match: "prolabs", type: "prolab" },
	{ match: "endgame", type: "endgame" },
	{ match: "fortress", type: "fortress" },
	{ match: "challenge", type: "challenge" },
	{ match: "machine", type: "machine" },
]

const pusherWarn = Pusher.warn.bind(Pusher)
Pusher.warn = function (...args) {
	const err = args[1]
	const message = String(err?.error || err?.message || "")
	if (err?.type === "WebSocketError" && (message.includes("close code 1000") || message.includes("CLOSE_NORMAL"))) {
		log.debug("Pusher websocket closed normally, reconnecting")
		return
	}
	pusherWarn(...args)
}

function cleanAttribute (attribute) {
	return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : ""
}

const td = new TD().addRule("boldlink", {
	filter: function (node, options) {
		return (
			options.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      node.getAttribute("href")
		)
	},

	replacement: function (content, node) {
		var href = node.getAttribute("href")
		var title = cleanAttribute(node.getAttribute("title"))
		if (title) title = " \"" + title + "\""
		return "**[" + content + "](" + href + title + ")**"
	}
})

function encodeLinks(msg) {
	Array.from(msg.getElementsByTagName("a")).forEach(element => {
		element.href = encodeURI(element.href)
	})
	return Array.from(msg.getElementsByTagName("a"))
}

function extractUid(links) {
	if (!links.length) return null
	const match = links[0].href.match(/(?:profile|users)\/(\d+)/)
	return match ? ~~match[1] : null
}

function extractTargetFromLinks(links) {
	for (const { match, type } of TARGET_LINK_TYPES) {
		const link = links.find(e => e.href.includes(match))
		if (link) {
			return {
				type,
				target: (link.textContent || "").trim(),
			}
		}
	}
	return { type: null, target: null }
}

function extractFlagTitle(msg, plainText) {
	const strong = msg.querySelector("strong")
	if (strong?.textContent?.trim()) {
		return strong.textContent.trim()
	}
	const quoted = plainText.match(/flag[s]?\s+["']([^"']+)["']/i)
	if (quoted?.[1]) return quoted[1].trim()
	const bare = plainText.match(/flag[s]?\s+([A-Za-z0-9][A-Za-z0-9 ._-]{0,48})/i)
	if (bare?.[1]) return bare[1].trim()
	return null
}

function extractMachineFlag(msg, lemmas, isBlood, plainText = "") {
	if (isBlood) {
		const afterBlood = plainText.split(/1st blood/i)[1] || ""
		const bloodParts = afterBlood.trim().split(/\s+/).filter(Boolean)
		const bloodFlag = bloodParts[0] || msg.childNodes[3]?.textContent?.trim().split(" ")?.[1]
		return ["root", "system"].includes(bloodFlag) ? "root" : "user"
	}
	if (lemmas.length > 1) {
		let flag = lemmas[1]
		return flag == "system" ? "root" : flag
	}
	return undefined
}

function buildMarkdown(msg) {
	const nodes = Array.from((msg.lastChild?.textContent == "[Tweet]" ? Array.from(msg.childNodes).slice(0, -1) : msg.childNodes))
	const texts = nodes.map(node => node.outerHTML || node.textContent)
	return td.turndown(texts.join(""))
}

function parseOwnsChannelEvent(data, source, msg, links) {
	const md = buildMarkdown(msg)
	const uid = extractUid(links)
	const plainText = msg.textContent || ""
	const isBlood = Array.from(msg.querySelectorAll("span.text-danger")).some(e => e.textContent.includes("1st blood"))
	const isLaunch = plainText.includes("mass-powering")
	let launchName
	if (isLaunch) {
		const launchNode = msg.querySelector("[data]") || msg.querySelector("span")
		launchName = launchNode?.getAttribute?.("data")
			|| H.sAcc(Array.from(msg.childNodes), 0, "firstChild", "data")
	}

	const { type: linkType, target: linkTarget } = extractTargetFromLinks(links)
	const lemmas = (msg.childNodes[1]?.textContent || plainText).trim().split(/\s+/).filter(Boolean)
	const verb = lemmas[0] || ""

	let type = linkType
	let target = linkTarget
	let flag

	if (isLaunch) {
		type = "launch"
		target = launchName
	} else if (verb === "solved" && linkType === "challenge") {
		flag = "challenge"
	} else if (linkType === "machine" || linkType === "starting_point") {
		flag = extractMachineFlag(msg, lemmas, isBlood, plainText)
	} else if (["endgame", "fortress", "prolab"].includes(linkType)) {
		flag = extractFlagTitle(msg, plainText)
	}

	return new HtbPusherEvent(source.channel || data.channel, source.event, data, uid, type, target, flag, md, isBlood, data.text)
}

function parseNotificationsChannelEvent(data, source, msg, links) {
	const md = buildMarkdown(msg)
	const uid = extractUid(links)
	const plainText = (msg.textContent || "").toLowerCase()
	let type = "notification"
	let target

	if (plainText.includes("badge")) {
		type = "badge"
		target = extractFlagTitle(msg, msg.textContent || "") || undefined
	} else if (plainText.includes("respect")) {
		type = "respect"
	} else if (plainText.includes("rank")) {
		type = "rank_up"
		target = extractFlagTitle(msg, msg.textContent || "") || undefined
	}

	return new HtbPusherEvent(source.channel || data.channel, source.event, data, uid, type, target, undefined, md, false, data.text)
}

function parseJoinsChannelEvent(data, source, msg, links) {
	const md = buildMarkdown(msg)
	const uid = extractUid(links)
	return new HtbPusherEvent(source.channel || data.channel, source.event, data, uid, "join", undefined, undefined, md, false, data.text)
}

function parsePusherEvent(data, source={}) {
	var md = null
	try {
		const channel = source.channel || data.channel
		let dom = (new JSDOM(data.text))
		let msg = dom.window.document.body
		let links = encodeLinks(msg)

		switch (channel) {
		case "owns-channel": case "infobox-channel": case null:
			return parseOwnsChannelEvent(data, source, msg, links)
		case "notifications-channel":
			return parseNotificationsChannelEvent(data, source, msg, links)
		case "joins-channel":
			return parseJoinsChannelEvent(data, source, msg, links)
		default:
		{
			md = buildMarkdown(msg)
			return new HtbPusherEvent(channel, source.event, data, undefined, undefined, undefined, undefined, md, false, data.text)
		}
		}
	} catch (error) {
		log.warn("Failed to parse Pusher message", { channel: source.channel, event: source.event, message: error.message })
		log.debug("Pusher raw payload", { data: JSON.stringify(data) })
		return new HtbPusherEvent(source.channel || data.channel, source.event, data, undefined, undefined, undefined, undefined, md, null, data.text)
	}

}

class HtbPusherEvent {
	/**
 	* 	An object containing data parsed from a HTB Pusher event. Contains structured information about the specific achievement, target and users involved, as well as the original text for debugging.
	* @param {string} channel - The channel name associated with the Pusher event.
	* @param {boolean} event - The event name associated with the Pusher event.
	* @param {Object} data  - The original JSON data from Pusher.
	* @param {number} uid  - The Htb UID of the user involved.
	* @param {string} type - The type of message this was, e.g. a challenge own, fortress milestone, machine rating etc.
	* @param {string} target - The string name of the target (thing that was owned), if relevant.
	* @param {string} flag - The string name of the flag / milestone, if a pro lab or other necessitating challenge.
	* @param {string} markdown - The bare markdown representation of the original HTML announcement string.
	* @param {boolean} blood - Whether this is a blood or not.
	* @param {string} debug - The raw HTML string passed in the Pusher event.
   */
	constructor(channel, event, data, uid, type, target, flag, markdown, blood=false, debug) {
		this.data = data
		this.uid = uid
		this.time = new Date().getTime()
		this.type = type
		this.target = target
		this.flag = flag
		this.markdown = markdown
		this.debug = debug
		this.channel = channel
		this.blood = blood
		this.event = event
	}
}



/** Class representing a HTB Pusher Subscription.
 * 
 * @typedef HtbPusherSubscription
 * @property {number} client - The Pusher Client instance.
 * @property {string} channel - The channel being listened on.
 */
class HtbPusherSubscription extends EventEmitter {
	/**
   * Creates a new HtbPusherSubscription object.
   * @param {string} apiToken - The Pusher Client instance.
   * @param {Object} bindings - An array of channel:event pair objects to subscribe to.
   * @param {string} bearerToken - HTB v4 app token used for Pusher channel auth.
   * @returns {HtbPusherSubscription}
   */

	constructor(apiToken, bindings, bearerToken) {
		super()
		this.bearerToken = bearerToken
		this.client = new Pusher(apiToken, {
			authEndpoint: `${HTB_APP_BASE}/pusher/auth`,
			auth: { Authorization: "Bearer " + bearerToken },
			authTransport: "ajax",
			cluster: "eu",
			encrypted: true
		})
		this.channels = []
		for (let i = 0; i < bindings.length; i++) {
			const binding = bindings[i]
			var channel = this.client.subscribe(binding.channel)
			channel.bind(binding.event,
				(data) => {
					try {
						this.alertSeven(parsePusherEvent(data, {channel:binding.channel, event: binding.event}))
					} catch (error) {
						log.error("Pusher bind handler failed", { message: error.message })
					}
				}
			)
			this.channels.push(channel)
		}
		
		log.info("Pusher client initialized", { authEndpoint: `${HTB_APP_BASE}/pusher/auth` })
		this.client.connection.bind("state_change", (states) => {
			log.info(`Client state changed from ${states.previous} to ${states.current}`)
			this.emit("state_change", states)
		})
	}

	/**
   * 
   * @param {HtbPusherEvent} message 
   */
	alertSeven(message) {
		if (message) {
			log.debug("Pusher event received", { uid: message.uid, type: message.type, target: message.target, channel: message.channel })
			this.emit("pusherevent", message)
		}
	}

	getConnectionState() {
		return this.client?.connection?.state || "unknown"
	}

	/**
   * Updates the Bearer-token based authentication for the Pusher Client.
   * @param {string} bearerToken - HTB v4 app token.
   */
	set auth(bearerToken) {
		try {
			this.bearerToken = bearerToken
			this.client.config.auth.Authorization = "Bearer " + bearerToken
		} catch (error) {
			log.error("Failed to update Pusher auth token", { message: error.message })
		}
	}
}

module.exports = {
	HtbPusherEvent: HtbPusherEvent,
	HtbPusherSubscription: HtbPusherSubscription,
	parsePusherEvent: parsePusherEvent
}
