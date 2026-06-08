/**
 * Class to generate a binary clock with current time
 */

const { readFileSync } = require("fs")
const puppeteer = require("puppeteer")
const { getPuppeteerLaunchOptions } = require("./puppeteer-launch.js")
const { createLogger } = require("./logger.js")

const log = createLogger("binclock")
var contentHtml = readFileSync("./helpers/binclock_src/clock.html", "utf8")

async function generateBinaryClockImage() {
	let browser
	try {
		browser = await puppeteer.launch(getPuppeteerLaunchOptions())
		const page = await browser.newPage()
		await page.setContent(contentHtml)
		await page.setViewport({
			width: 600,
			height: 300,
			deviceScaleFactor: 2,
		})

		const containerElem = await page.$("#screenshot")
		if (containerElem === null) {
			throw new Error("No screenshot element exists")
		}
		return await containerElem.screenshot({ encoding: "base64" })
	} catch (error) {
		log.error("Binary clock render failed", { error: error.message })
		return null
	} finally {
		if (browser) await browser.close().catch(() => {})
	}
}

module.exports = { generateBinaryClockImage }
