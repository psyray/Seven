/**
 * Shared chart fetch + render for member progress and activity embeds.
 */

const { normalizeChartTerm } = require("./chart-term.js")
const { renderChart } = require("../modules/charts/index_new.js")
const { createLogger } = require("./logger.js")

const log = createLogger("charts")

/**
 * @param {object|null} chartImageB64
 * @returns {Buffer|null}
 */
function chartB64ToBuffer(chartImageB64) {
	if (!chartImageB64) return null
	const raw = chartImageB64.data || chartImageB64
	return raw ? Buffer.from(raw, "base64") : null
}

/**
 * @param {object} member
 * @param {string} term
 * @param {(memberId: number|string, term: string) => Promise<object>} fetchChartData
 * @param {(member: object, chart: object, term: string, type: string, series?: unknown, dateRange?: object) => Promise<unknown>} [renderFn]
 */
async function buildMemberProgressChart(member, term, fetchChartData, renderFn = renderChart) {
	const normalizedTerm = normalizeChartTerm(term)
	if (!member?.id) {
		return { term: normalizedTerm, chartImage: null, chartData: null }
	}
	const chartData = await fetchChartData(member.id, normalizedTerm)
	let chartImage = null
	try {
		const chartImageB64 = await renderFn(member, chartData, normalizedTerm, "userProgress")
		chartImage = chartB64ToBuffer(chartImageB64)
	} catch (error) {
		log.error("Member progress chart render failed", {
			memberId: member.id,
			term: normalizedTerm,
			error: error.message,
		})
	}
	return { term: normalizedTerm, chartImage, chartData }
}

/**
 * @param {object} member
 * @param {unknown} series
 * @param {object} dateRange
 * @param {(member: object, chart: object, term: string, type: string, series?: unknown, dateRange?: object) => Promise<unknown>} [renderFn]
 */
async function buildMemberActivityChart(member, series, dateRange, renderFn = renderChart) {
	let chartImage = null
	try {
		const chartImageB64 = await renderFn(member, null, null, "userActivity", series, dateRange)
		chartImage = chartB64ToBuffer(chartImageB64)
	} catch (error) {
		log.error("Member activity chart render failed", {
			memberId: member?.id,
			error: error.message,
		})
	}
	return chartImage
}

module.exports = {
	buildMemberProgressChart,
	buildMemberActivityChart,
	chartB64ToBuffer,
}
