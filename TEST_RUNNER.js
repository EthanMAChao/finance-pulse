const fs = require("fs");
globalThis.self = globalThis;
globalThis.window = globalThis;
require("./model.js");

const assets = JSON.parse(fs.readFileSync("./data/assets.json", "utf8")).assets;
const symbols = [
  "600845","688185","159915","512480","600519","300750","002230",
  "601398","600036","601318","600030","512000","512010","515790",
  "518880","513100","601012","002594","603259","600276","601088",
  "600900","600050","002415","300124","DEMO_CYCLE"
];
const market = {riskScore:58,breadthScore:56,trendScore:57,sentimentScore:55};
const results = {};
for (const sym of symbols) {
  const asset = assets[sym];
  if (!asset) {
    results[sym] = { ok: false, error: "missing sample asset" };
    continue;
  }
  try {
    const r = globalThis.FPDecisionModel.analyzeAsset(asset, {
      targetWinRate: 0.9,
      forwardDays: 20,
      costBps: 15,
      minSignals: 8,
      stopLossPct: 8,
      regimeFilter: "strict",
      market
    });
    results[sym] = {
      ok: true,
      profile: r.modelProfile.name,
      tier: r.confidenceTier,
      regime: r.marketRegime.name,
      provider: r.productionDataQuality.provider,
      productionReady: r.productionDataQuality.productionReady,
      score: r.scores.decisionScore,
      action: r.action,
      highConfidenceBlockedForDemo: r.action !== "高置信：可小仓分批关注"
    };
  } catch (e) {
    results[sym] = { ok: false, error: e.message };
  }
}
console.log(JSON.stringify(results, null, 2));
const failed = Object.values(results).some(x => !x.ok);
if (failed) process.exit(1);
