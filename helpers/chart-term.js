/**
 * Normalize DialogFlow / natural-language chart intervals to HTB API terms (1W, 1M, 3M, 6M, 1Y).
 */

const TERM_ALIASES = {
	"1w": "1W",
	"1 week": "1W",
	"1week": "1W",
	"1m": "1M",
	"1 month": "1M",
	"1month": "1M",
	"3m": "3M",
	"3 months": "3M",
	"3months": "3M",
	"6m": "6M",
	"6 months": "6M",
	"6months": "6M",
	"1y": "1Y",
	"1 year": "1Y",
	"1year": "1Y",
}

/**
 * @param {string|null|undefined} term
 * @returns {string}
 */
function normalizeChartTerm(term) {
	if (term == null || !String(term).trim()) return "1Y"
	const key = String(term).trim().toLowerCase()
	if (TERM_ALIASES[key]) return TERM_ALIASES[key]
	if (/^[136]m$/i.test(key)) return key.toUpperCase()
	if (/^1y$/i.test(key)) return "1Y"
	if (/^1w$/i.test(key)) return "1W"
	const months = key.match(/^(\d+)\s*m(?:onths?)?$/)
	if (months) {
		const n = Number(months[1])
		if (n === 12) return "1Y"
		if ([1, 3, 6].includes(n)) return `${n}M`
	}
	return "1Y"
}

module.exports = {
	normalizeChartTerm,
}
