const fs = require('fs');
globalThis.self = globalThis;
globalThis.window = globalThis;
require('./model.js');

const assets = JSON.parse(fs.readFileSync('./data/assets.json', 'utf8')).assets;
const symbols = [
  '600845','688185','159915','512480','600519','300750','002230',
  '601398','600036','601318','600030','512000','512010','515790',
  '518880','513100','601012','002594','603259','600276','601088',
  '600900','600050','002415','300124','DEMO_CYCLE'
];
const market = {riskScore:58,breadthScore:56,trendScore:57,sentimentScore:55};
const results = {};
for (const sym of symbols) {
  const asset = assets[sym];
  if (!asset) { results[sym] = {ok:false,error:'missing sample asset'}; continue; }
  try {
    const r = globalThis.FPDecisionModel.analyzeAsset(asset, {
      targetWinRate:0.9, forwardDays:20, costBps:15, minSignals:8, stopLossPct:8, regimeFilter:'strict', market
    });
    results[sym] = {
      ok:true,
      profile:r.modelProfile.name,
      tier:r.confidenceTier,
      productionReady:r.productionDataQuality.productionReady,
      highConfidenceBlockedForDemo:r.action !== '高置信：可小仓分批关注',
      hasSubModels: !!r.subModels && Object.keys(r.subModels).length === 5,
      hasReasons: Array.isArray(r.decisionReasons) && r.decisionReasons.length > 0,
      action:r.action
    };
  } catch(e) { results[sym] = {ok:false,error:e.message}; }
}

const prodAsset = JSON.parse(JSON.stringify(assets['600845']));
prodAsset.provider = 'tushare';
delete prodAsset.dataSource;
const prodResult = globalThis.FPDecisionModel.analyzeAsset(prodAsset, {market});

const app = fs.readFileSync('./app.js','utf8');
const index = fs.readFileSync('./index.html','utf8');
const sw = fs.readFileSync('./sw.js','utf8');
const worker = fs.readFileSync('./api/finance-worker.js','utf8');
const staticChecks = {
  appUsesWebWorker: app.includes('new Worker("./decision-worker.js")'),
  appRendersProductionBanner: app.includes('renderProductionBanner'),
  appRendersModelProfile: app.includes('model-profile-card'),
  appForwardsFrontendKeys: ['X-Tushare-Token','X-EODHD-Token','X-Finnhub-Key'].every(x=>app.includes(x)),
  indexVersion: index.includes('Finance Pulse V12') && index.includes('V12 代码审查修复版'),
  swUniqueDecisionWorker: (sw.match(/decision-worker\.js/g)||[]).length === 1,
  workerHeaderKeySupport: ['X-Tushare-Token','X-EODHD-Token','X-Finnhub-Key','envWithHeaderKeys'].every(x=>worker.includes(x)),
  workerDiagnoseRoute: worker.includes('/diagnose') && worker.includes('handleDiagnose'),
};

const output = {results, prodAssetProductionReady: prodResult.productionDataQuality.productionReady, staticChecks};
console.log(JSON.stringify(output, null, 2));
const failed = Object.values(results).some(x => !x.ok || !x.hasSubModels || !x.hasReasons)
  || !Object.values(staticChecks).every(Boolean)
  || prodResult.productionDataQuality.productionReady !== true;
if (failed) process.exit(1);
