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
const marketScenarios = [
  {name:"neutral", market:{riskScore:55,breadthScore:55,trendScore:55,sentimentScore:55}},
  {name:"weak", market:{riskScore:38,breadthScore:42,trendScore:40,sentimentScore:45}},
  {name:"strong", market:{riskScore:78,breadthScore:76,trendScore:80,sentimentScore:72}}
];
const results = {};
for (const scenario of marketScenarios) {
  results[scenario.name] = {};
  for (const sym of symbols) {
    const asset = assets[sym];
    if (!asset) {
      results[scenario.name][sym] = { ok: false, error: "missing sample asset" };
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
        market: scenario.market
      });
      results[scenario.name][sym] = {
        ok: true,
        profile: r.modelProfile.name,
        tier: r.confidenceTier,
        regime: r.marketRegime.name,
        score: r.scores.decisionScore,
        action: r.action,
        backtestSignals: r.backtest.total,
        winRate: Math.round(r.backtest.winRate * 1000) / 10,
        subModels: r.subModels ? Object.keys(r.subModels).length : 0,
        reasons: r.decisionReasons ? r.decisionReasons.length : 0
      };
    } catch (e) {
      results[scenario.name][sym] = { ok: false, error: e.message };
    }
  }
}
console.log(JSON.stringify(results, null, 2));
const failed = Object.values(results).flatMap(x=>Object.values(x)).some(x => !x.ok);
if (failed) process.exit(1);
