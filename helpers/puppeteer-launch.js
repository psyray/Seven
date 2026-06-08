/**
 * Shared Puppeteer launch options (Docker Chromium via PUPPETEER_EXECUTABLE_PATH).
 */

const fs = require("fs")

function resolveChromiumExecutablePath() {
	const configured = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH
	if (configured && configured !== "/usr/bin/chromium") {
		return configured
	}
	if (fs.existsSync("/usr/lib/chromium/chromium")) {
		return "/usr/lib/chromium/chromium"
	}
	return configured || undefined
}

function ensureWritableHome() {
	const home = process.env.HOME
	if (!home || home === "/nonexistent" || !fs.existsSync(home)) {
		process.env.HOME = "/tmp"
	}
}

function getPuppeteerLaunchOptions(overrides = {}) {
	ensureWritableHome()
	const userDataDir = process.env.CHROME_USER_DATA_DIR || "/tmp/chrome-user-data"
	const options = {
		headless: process.env.NODE_ENV === "chartdev" ? false : true,
		devtools: process.env.NODE_ENV === "chartdev" ? true : false,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--headless=new",
			`--user-data-dir=${userDataDir}`,
		],
		executablePath: resolveChromiumExecutablePath(),
		...overrides,
	}
	if (overrides.args) {
		options.args = [...options.args, ...overrides.args]
	}
	return options
}

module.exports = {
	getPuppeteerLaunchOptions,
}
