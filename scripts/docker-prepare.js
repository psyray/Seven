"use strict"

const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const dir = path.join(root, "config", "docker")
const target = path.join(dir, "seven.env")
const legacy = path.join(root, ".env")
const template = path.join(root, "static", "templates", ".env.docker.example")

if (!fs.existsSync(dir)) {
	fs.mkdirSync(dir, { recursive: true })
}

if (fs.existsSync(target)) {
	process.exit(0)
}

if (fs.existsSync(legacy)) {
	fs.copyFileSync(legacy, target)
	console.log("docker-prepare: created config/docker/seven.env from .env")
	process.exit(0)
}

if (fs.existsSync(template)) {
	fs.copyFileSync(template, target)
	console.log("docker-prepare: created config/docker/seven.env from template")
	process.exit(0)
}

console.warn("docker-prepare: create config/docker/seven.env (or copy static/templates/.env.docker.example) before docker compose up")
