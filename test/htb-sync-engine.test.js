/**
 * Unit tests for HtbSyncEngine (no network).
 * Run: node test/htb-sync-engine.test.js
 */
const assert = require("assert")
const { HtbSyncEngine } = require("../helpers/htb-sync-engine.js")

function createMockDatastore(overrides = {}) {
	return {
		UPDATE_LOCK: false,
		MACHINES: {},
		CHALLENGES: {},
		TEAM_MEMBERS: {},
		TEAM_MEMBERS_IGNORED: {},
		TEAM_STATS: {},
		MISC: {},
		vTM: [],
		LAST_UPDATE: new Date(),
		hasCachedObject(data) {
			return Boolean(data && typeof data === "object" && Object.keys(data).length > 0)
		},
		hasCachedTeamData() { return false },
		hasCachedTeamStats() { return false },
		getMemberSyncDependencies() { return [] },
		getMissingSections() { return ["fortresses"] },
		getDialogflowSpecialTargetFlagNames() { return [] },
		getDiscordUserSynonymsForUid() { return [] },
		syncDbExportFields() {},
		logUpdateProgress() {},
		logUpdatePhase() {},
		getMachineById(id) { return this.MACHINES[id] || null },
		getMachineByName(name) {
			return Object.values(this.MACHINES).find(m => m.name?.toLowerCase() === String(name).toLowerCase()) || null
		},
		getChallengeById(id) { return this.CHALLENGES[id] || null },
		getChallengeByName(name) {
			return Object.values(this.CHALLENGES).find(c => c.name?.toLowerCase() === String(name).toLowerCase()) || null
		},
		getSpecialByName(name, type) {
			const bucket = type === "fortress" ? this.MISC.FORTRESSES
				: type === "endgame" ? this.MISC.ENDGAMES
					: this.MISC.PROLABS
			return Object.values(bucket || {}).find(e => e.name?.toLowerCase() === String(name).toLowerCase()) || null
		},
		...overrides,
	}
}

function createMockApi() {
	return {
		getAllMachinesFast: async () => ({ 1: { id: 1, name: "Alpha", release: "2024-01-01", retired: false } }),
		getAllChallengesFast: async () => ({}),
		getAllFortressEntries: async () => [{ id: 10, name: "F1" }],
		getAllEndgameEntries: async () => [],
		getAllProLabEntries: async () => [],
		getCompleteMachineProfilesByIds: async (ids) => {
			const out = {}
			ids.forEach(id => { out[id] = { id: Number(id), name: "Alpha", type: "machine" } })
			return out
		},
		getCompleteChallengeProfilesByIds: async () => ({}),
		getCompleteFortressesByIds: async (ids) => {
			const out = {}
			ids.forEach(id => { out[id] = { id: Number(id), name: "F1", type: "fortress" } })
			return out
		},
		getCompleteEndgamesByIds: async () => ({}),
		getCompleteProlabsByIds: async () => ({}),
		getAllStartingPointMachines: async () => ({}),
		getMachineTags: async () => ({ 1: { name: "OS" } }),
		getChallengeCategories: async () => ({}),
		buildMachineFromProfileIdentifier: async () => null,
		searchChallengeByExactName: async () => [],
	}
}

async function testEmptyCacheTreatedAsMissing() {
	const ds = createMockDatastore({ MISC: { FORTRESSES: {} } })
	const engine = new HtbSyncEngine(ds, createMockApi())
	const diff = await engine.diffCatalog("fortress")
	assert.deepStrictEqual(diff.missingIds, ["10"])
	console.log("ok: empty {} cache treated as missing")
}

async function testStaleDetection() {
	const ds = createMockDatastore({
		MACHINES: { 1: { id: 1, name: "Alpha", release: "2023-01-01", retired: false } },
	})
	const engine = new HtbSyncEngine(ds, createMockApi())
	const catalog = await engine.fetchCatalog("machine")
	const stale = engine.getStaleIds("machine", catalog.byId, ds.MACHINES)
	assert.deepStrictEqual(stale, ["1"])
	console.log("ok: stale machine detected from catalog metadata")
}

async function testEnsureTargetMergesFortress() {
	const ds = createMockDatastore()
	const engine = new HtbSyncEngine(ds, createMockApi())
	const entity = await engine.ensureTarget("fortress", "F1", { trigger: "test" })
	assert.strictEqual(entity?.name, "F1")
	assert.strictEqual(Object.keys(ds.MISC.FORTRESSES).length, 1)
	console.log("ok: ensureTarget merges fortress")
}

async function testDeltaSkipsCachedIds() {
	const ds = createMockDatastore({
		MACHINES: { 1: { id: 1, name: "Alpha", release: "2024-01-01", retired: false } },
	})
	let fetchCalls = 0
	const api = createMockApi()
	const original = api.getCompleteMachineProfilesByIds
	api.getCompleteMachineProfilesByIds = async (...args) => {
		fetchCalls++
		return original(...args)
	}
	const engine = new HtbSyncEngine(ds, api)
	const result = await engine.syncCatalogDelta("machine", { includeStale: false })
	assert.strictEqual(result.fetched, 0)
	assert.strictEqual(fetchCalls, 0)
	console.log("ok: delta skips cached machine ids")
}

async function run() {
	await testEmptyCacheTreatedAsMissing()
	await testStaleDetection()
	await testEnsureTargetMergesFortress()
	await testDeltaSkipsCachedIds()
	console.log("\nAll htb-sync-engine tests passed.")
}

run().catch(err => {
	console.error(err)
	process.exit(1)
})
