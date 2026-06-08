/**
 * Offline handler runner for smoke tests — no Discord, DialogFlow, or live HTB API.
 */

const fs = require("fs")
const path = require("path")
const { SevenDatastore } = require("../models/SevenDatastore.js")
const { HtbEmbeds } = require("../views/embeds.js")
const { extractTargetNameFromMessage } = require("./nlp.js")
const { resolveSmokeIntent } = require("./smoke-intents.js")
const strings = require("../static/strings.js")
const { Helpers: H } = require("./helpers.js")
const { generateBinaryClockImage } = require("./binclock")
const { buildMemberProgressChart, buildMemberActivityChart } = require("./chart-messages.js")
const { renderChart } = require("../modules/charts/index_new.js")

function loadSmokeFixtures() {
	const fixturePath = path.join(__dirname, "../fixtures/smoke-cache.json")
	return JSON.parse(fs.readFileSync(fixturePath, "utf8"))
}

function createMockMessage(content, author = { id: "smoke-user", username: "smoke", bot: false }) {
	const channel = {
		type: "dm",
		startTyping: () => {},
		stopTyping: () => {},
		send: async () => ({}),
	}
	return {
		content,
		cleanContent: content,
		author,
		channel,
		reply: async () => ({}),
	}
}

function createMockSend() {
	const out = {
		responses: [],
		async human(message, text) {
			out.responses.push({ type: "human", text: String(text || "") })
		},
		async embed(message, content) {
			const items = Array.isArray(content) ? content : [content]
			for (const item of items) {
				out.responses.push({
					type: "embed",
					title: item?.title,
					description: item?.description,
					fields: item?.fields?.length || 0,
				})
			}
		},
	}
	return out
}

function enrichMemberProfile(member) {
	if (!member) return member
	return Object.assign({}, member, {
		type: "member",
		endgames: member.endgames || [],
		fortresses: member.fortresses || [],
		prolabs: member.prolabs || [],
		challenge_owns: member.challenge_owns || { solved: 0 },
		bloods: member.bloods || { machines: [], challenges: [] },
	})
}

/**
 * @returns {Promise<{ dat: SevenDatastore, egi: HtbEmbeds, send: ReturnType<typeof createMockSend> }>}
 */
function createSmokeContext() {
	const fixtures = loadSmokeFixtures()
	const dat = new SevenDatastore()
	dat.MACHINES = fixtures.MACHINES
	dat.CHALLENGES = fixtures.CHALLENGES
	dat.TEAM_MEMBERS = fixtures.TEAM_MEMBERS
	dat.TEAM_MEMBERS_IGNORED = fixtures.TEAM_MEMBERS_IGNORED || {}
	dat.TEAM_STATS = fixtures.TEAM_STATS
	dat.DISCORD_LINKS = fixtures.DISCORD_LINKS || {}
	dat.MISC = fixtures.MISC
	dat.hydrateFromDbBackup()

	dat.V4API.getCompleteMemberProfileByMemberPartial = async (member) => enrichMemberProfile(member)
	dat.V4API.getMemberAchievementChart = async () => ({
		profile: {
			graphData: {
				0: [[Date.now(), 1]],
				1: [[Date.now(), 2]],
				2: [[Date.now(), 0]],
				3: [],
				4: [],
			},
		},
	})

	const egi = new HtbEmbeds(dat, { of: () => "" })
	const send = createMockSend()
	const renderChartFn = async () => Buffer.from("smoke-chart", "utf8")
	return { dat, egi, send, renderChartFn }
}

function responseIsValid(responses) {
	if (!responses.length) return false
	return responses.every(r => {
		if (r.type === "human") return r.text.trim().length > 0
		if (r.type === "embed") return Boolean(r.description && r.description.trim().length > 0)
		return false
	})
}

async function sendHelpMsg(send, message) {
	const helpChunks = strings.buildHelpMessages("member", { isUniversity: false })
	for (const chunk of helpChunks) {
		await send.embed(message, egiHelpEmbed(chunk))
	}
}

function egiHelpEmbed(chunk) {
	const { MessageEmbed } = require("discord.js")
	return new MessageEmbed().setColor("#9FEF00").setDescription(chunk)
}

async function sendMemberChartMsg(dat, egi, send, message, username, term, renderChartFn = renderChart) {
	const member = dat.resolveEnt(username, "member", false, message)
	if (!member) {
		await send.embed(message, egi.ENTITY_UNFOUND.setDescription(`No member '${username}'.`))
		return
	}
	const { term: chartTerm, chartImage } = await buildMemberProgressChart(
		member,
		term,
		(id, normalizedTerm) => dat.V4API.getMemberAchievementChart(id, normalizedTerm),
		renderChartFn
	)
	await send.embed(message, egi.memberAchievementTimelineChart(member, chartTerm, chartImage))
}

async function sendActivityMsg(dat, egi, send, message, member, targetType, limit = 24, renderChartFn = renderChart) {
	if (!member?.activity?.length) {
		await send.embed(message, egi.ENTITY_UNFOUND.setDescription("No activity data in fixture."))
		return
	}
	const owns = dat.filterMemberOwns(member.id, targetType, "date", "asc", limit)
	const orderedDates = owns.map(e => e.date).sort((a, b) => Date.parse(a) - Date.parse(b))
	const dateRange = {
		oldest: new Date(orderedDates[0] || Date.now() - 604800000),
		latest: new Date(),
		interval: new Date(orderedDates[orderedDates.length - 1] || Date.now()),
	}
	const types = ["user", "root", "challenge", "endgame", "fortress"]
	const series = types.map(thisType => {
		const filtered = owns.filter(e => e.object_type == thisType || e.type == thisType)
		return filtered.map((i, idx) => ([Date.parse(i.date), filtered.length - idx]))
	})
	const chartImage = await buildMemberActivityChart(member, series, dateRange, renderChartFn)
	await send.embed(message, egi.memberActivity(member, limit, targetType, "desc", "date", chartImage))
}

/**
 * @param {string} intent
 * @param {object} P
 * @param {{ dat, egi, send, message }} ctx
 */
async function dispatchSmokeIntent(intent, P, ctx) {
	const { dat, egi, send, message, renderChartFn } = ctx

	switch (intent) {
	case "help":
		await sendHelpMsg(send, message)
		break
	case "resolveEnt": {
		const target = P.target || dat.resolveEnt(P.name, P.type, false, message)
		await send.embed(message, await egi.infoFor(target.type, target.name, false, message, target))
		break
	}
	case "getTeamInfo":
		await send.embed(message, egi.teamInfo())
		break
	case "getTeamRanking":
		await send.embed(message, egi.teamRank())
		break
	case "getTeamLeaders":
		await send.embed(message, egi.teamLeaderboard())
		break
	case "getTeamLeader": {
		const member = dat.resolveEnt(dat.getTopMembers(1), "member", true, message)
		await send.embed(message, egi.teamLeader(member))
		break
	}
	case "getFlagboard":
		await send.embed(message, egi.teamFlagboard())
		break
	case "getTeamBadge":
		await send.human(message, `https://app.hackthebox.com/badge/team/image/${dat.TEAM_STATS.id}`)
		break
	case "getTime":
		await send.embed(message, egi.binClock(await generateBinaryClockImage()))
		break
	case "getNewBox":
		await send.embed(message, await egi.infoFor("machine", dat.getNewBoxId(), true))
		break
	case "getFirstBox":
		await send.embed(message, await egi.infoFor("machine", "Lame"))
		break
	case "getTargetInfo": {
		const targetName = P.targetName || extractTargetNameFromMessage(message.content, P.targetType)
		await send.embed(message, await egi.infoFor(P.targetType, targetName))
		break
	}
	case "getMemberInfo": {
		let member = dat.resolveEnt(P.username, "member", false, message)
		if (member?.id && !Array.isArray(member.endgames)) {
			member = await dat.V4API.getCompleteMemberProfileByMemberPartial(member)
		}
		await send.embed(message, await egi.infoFor("member", P.username, false, message, member || { type: null }))
		break
	}
	case "getMemberRank":
		await send.embed(message, egi.memberRank(dat.resolveEnt(P.username, "member", false, message)))
		break
	case "getMemberChart":
		await sendMemberChartMsg(dat, egi, send, message, P.username, P.interval, ctx.renderChartFn)
		break
	case "getTargetOwners":
		await send.embed(message, egi.teamOwnsForTarget(
			dat.resolveEnt(P.target, P.htbTargetType),
			undefined,
			P.ownType,
			P.ownFilter
		))
		break
	case "checkMemberOwnedTarget":
		await send.embed(message, egi.checkMemberOwnedTarget(
			dat.resolveEnt(P.username, "member", false, message),
			dat.resolveEnt(P.targetname, P.targettype),
			P.flagNames
		))
		break
	case "filterMemberOwns": {
		const member = dat.resolveEnt(P.username, "member", false, message)
		await sendActivityMsg(dat, egi, send, message, member, P.targettype, P.limit || 24, ctx.renderChartFn)
		break
	}
	case "filterTargets":
		await send.embed(message, egi.filteredTargets(
			dat.filterEnt(message, P.targettype, P.sortby, P.sortorder, P.limit || 15, null, null, P.memberName || [], P.targetFilterBasis || []),
			P.sortby,
			P,
			message
		), true)
		break
	case "filterMembers":
		await send.embed(message, egi.filteredTargets(
			dat.filterEnt(message, P.targettype, P.sortby, P.sortorder, P.limit || 15, null, null, P.memberName || [], P.targetFilterBasis || []),
			P.sortby,
			P,
			message
		), true)
		break
	case "linkDiscord":
		await send.human(message, `Smoke test: link Discord ↔ HTB (${P.uid ? "uid " + P.uid : "user " + P.username}) acknowledged.`)
		break
	default:
		throw new Error(`Unhandled smoke intent: ${intent}`)
	}
}

/**
 * @param {string} prompt
 * @param {{ dat, egi, send }} [ctx]
 */
async function runSmokePrompt(prompt, ctx = null) {
	const context = ctx || createSmokeContext()
	context.send.responses.length = 0
	const message = createMockMessage(prompt)
	const resolved = resolveSmokeIntent(prompt, context.dat, message)

	if (!resolved) {
		return {
			prompt,
			status: "df-only",
			intent: null,
			route: null,
			ok: false,
			responses: context.send.responses,
			error: "No offline intent resolver",
		}
	}

	try {
		await dispatchSmokeIntent(resolved.intent, resolved.parameters, { ...context, message, renderChartFn: context.renderChartFn })
		const ok = responseIsValid(context.send.responses)
		return {
			prompt,
			status: "run",
			intent: resolved.intent,
			route: resolved.route,
			ok,
			responses: context.send.responses,
			error: ok ? null : "Empty or invalid response",
		}
	} catch (error) {
		return {
			prompt,
			status: "run",
			intent: resolved.intent,
			route: resolved.route,
			ok: false,
			responses: context.send.responses,
			error: error.stack || String(error),
		}
	}
}

module.exports = {
	createSmokeContext,
	createMockMessage,
	dispatchSmokeIntent,
	runSmokePrompt,
	resolveSmokeIntent,
	responseIsValid,
	loadSmokeFixtures,
}
