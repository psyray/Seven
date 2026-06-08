const {
	render,
	exporters
} = require("./patched_charts-renderer/dist/index.js")
const htbCharts = require("./htbCharts.js")
const { createLogger } = require("../../helpers/logger.js")

const log = createLogger("charts")

async function renderChart(member, chart, term, type, series, dateRange = null) {
	if (process.env.CHART_RENDER_DISABLED === "1") {
		return null
	}
	console.warn("Rendering chart with 'charts-rendering' module.")
	let config = {}
	switch (type) {
	case "userProgress": {
		const graphData = chart?.profile?.graphData
		if (!graphData) {
			log.warn("Chart render skipped: missing graphData", { memberId: member?.id, term })
			return null
		}
		config = {
			type: "png",
			options: htbCharts.genChart(member.name, "userProgress", term)
		}
		Object.values(graphData).forEach((e, idx) => {
			if (config.options.series[idx]) config.options.series[idx].data = e
		})
		break
	}
	case "userActivity":
		config = {
			type: "png",
			options: htbCharts.genChart(member.name, "userActivity", null, series, dateRange)
		}
		break
	default:
		return null
	}
	try {
		return await render(exporters.highcharts, {
			init: {
				width: 1000,
				height: 1000,
			},
			charts: [{
				file: {
					encoding: "base64"
				},
				config: config.options,
			}],
		})
	} catch (error) {
		log.error("Chart render failed", { type, term, error: error.message })
		return null
	}
}

module.exports = {
	renderChart
}