const fs = require("fs")
const path = require("path")
const { createLogger } = require("./logger.js")

const log = createLogger("env-tokens")

function setEnvLine(content, key, value) {
	const line = `${key}=${value}`
	const pattern = new RegExp(`^${key}=.*$`, "m")
	if (pattern.test(content)) {
		return content.replace(pattern, line)
	}
	const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n"
	return `${content}${suffix}${line}\n`
}

/**
 * Update HTB_V4_TOKEN and HTB_REFRESH_TOKEN in a .env file (atomic write).
 * @returns {boolean} true when the file was updated
 */
function updateEnvFileOAuthTokens(envFilePath, accessToken, refreshToken) {
	const resolved = (envFilePath || "").trim()
	if (!resolved) return false

	const absPath = path.resolve(resolved)
	if (!fs.existsSync(absPath)) {
		log.warn("HTB_ENV_FILE not found — skipping .env token sync", { path: absPath })
		return false
	}

	try {
		let content = fs.readFileSync(absPath, "utf8")
		content = setEnvLine(content, "HTB_V4_TOKEN", accessToken)
		content = setEnvLine(content, "HTB_REFRESH_TOKEN", refreshToken)

		const tmpPath = `${absPath}.tmp.${process.pid}`
		fs.writeFileSync(tmpPath, content, { mode: 0o600 })
		fs.renameSync(tmpPath, absPath)
		log.info("OAuth tokens synced to .env", { path: absPath })
		return true
	} catch (error) {
		log.warn("Failed to sync OAuth tokens to HTB_ENV_FILE", { path: absPath, message: error.message })
		return false
	}
}

module.exports = {
	updateEnvFileOAuthTokens,
}
