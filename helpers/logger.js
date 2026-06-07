const winston = require("winston")
const path = require("path")
const fs = require("fs")

const LOG_DIR = process.env.LOG_DIR || "/var/log/sevenbot"
const LOG_LEVEL = process.env.LOG_LEVEL || "info"

try {
	fs.mkdirSync(LOG_DIR, { recursive: true })
} catch (error) {
	// Fall back to console-only if log dir is not writable (e.g. local dev).
}

const format = winston.format.combine(
	winston.format.timestamp(),
	winston.format.errors({ stack: true }),
	winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
		const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ""
		const mod = module ? `[${module}] ` : ""
		return `${timestamp} | ${level.toUpperCase().padEnd(5)} | ${mod}${message}${metaStr}`
	})
)

const transports = [
	new winston.transports.Console({ format }),
]

if (fs.existsSync(LOG_DIR)) {
	transports.push(
		new winston.transports.File({
			filename: path.join(LOG_DIR, "sevenbot.log"),
			level: LOG_LEVEL,
			format,
			maxsize: 10 * 1024 * 1024,
			maxFiles: 5,
		}),
		new winston.transports.File({
			filename: path.join(LOG_DIR, "sevenbot-error.log"),
			level: "error",
			format,
			maxsize: 10 * 1024 * 1024,
			maxFiles: 5,
		})
	)
}

const rootLogger = winston.createLogger({
	level: LOG_LEVEL,
	transports,
})

function createLogger(module) {
	return {
		debug: (message, meta = {}) => rootLogger.debug(message, { module, ...meta }),
		info: (message, meta = {}) => rootLogger.info(message, { module, ...meta }),
		warn: (message, meta = {}) => rootLogger.warn(message, { module, ...meta }),
		error: (message, meta = {}) => rootLogger.error(message, { module, ...meta }),
	}
}

module.exports = { createLogger, rootLogger }
