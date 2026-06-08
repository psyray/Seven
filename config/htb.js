const HTB_APP_BASE = (process.env.HTB_APP_BASE || "https://app.hackthebox.com").replace(/\/$/, "")
const HTB_API_BASE = (process.env.HTB_API_BASE || "https://labs.hackthebox.com/api/v4").replace(/\/$/, "")
const HTB_API_V5_BASE = (process.env.HTB_API_V5_BASE || "https://labs.hackthebox.com/api/v5").replace(/\/$/, "")

module.exports = {
	HTB_APP_BASE,
	HTB_API_BASE,
	HTB_API_V5_BASE,
}
