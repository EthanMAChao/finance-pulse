const APP_VERSION = "V12.1";
const DEFAULT_MARKET_API_URL = "./data/market.json";
const DEFAULT_ASSET_API_URL = "./data/assets.json";
const STORAGE_KEYS = {
  marketApiUrl: "fp_v12_market_api",
  assetApiUrl: "fp_v12_asset_api",
  riskFirst: "fp_v12_risk_first",
  autoRefresh: "fp_v12_auto_refresh",
  lastMarketData: "fp_v12_last_market",
  lastAssetData: "fp_v12_last_assets",
  tushareKey: "fp_v12_tushare_key",
  eodhdKey: "fp_v12_eodhd_key",
  finnhubKey: "fp_v12_finnhub_key",
  workerBaseUrl: "fp_v12_worker_base_url",
  legacy: {
    marketApiUrl: "fp_v3_market_api",
    assetApiUrl: "fp_v3_asset_api",
    tushareKey: "fp_v11_tushare_key",
    eodhdKey: "fp_v11_eodhd_key",
    finnhubKey: "fp_v11_finnhub_key",
    workerBaseUrl: "workerBaseUrl"
  }
};

let appState = { deferredPrompt: null, autoRefreshTimer: null, marketData: null, assetsData: null };
const $ = id => document.getElementById(id);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }
function getStorage(key) { return localStorage.getItem(key) || localStorage.getItem(STORAGE_KEYS.legacy?.[Object.keys(STORAGE_KEYS).find(k => STORAGE_KEYS[k] === key)] || "") || ""; }
function getMarketApiUrl() { return localStorage.getItem(STORAGE_KEYS.marketApiUrl) || localStorage.getItem(STORAGE_KEYS.legacy.marketApiUrl) || DEFAULT_MARKET_API_URL; }
function getAssetApiUrl() { return localStorage.getItem(STORAGE_KEYS.assetApiUrl) || localStorage.getItem(STORAGE_KEYS.legacy.assetApiUrl) || DEFAULT_ASSET_API_URL; }
function normalizeWorkerUrl(url) { return String(url || "").trim().replace(/\/+$/, ""); }
function getWorkerBaseUrl() {
  return normalizeWorkerUrl(
    localStorage.getItem(STORAGE_KEYS.workerBaseUrl) ||
    localStorage.getItem("financePulse.workerBaseUrl") ||
    localStorage.getItem(STORAGE_KEYS.legacy.workerBaseUrl) ||
    ""
  );
}
function getWorkerBaseUrlFromInputOrStorage() {
  const inputValue = $("workerBaseUrlInput")?.value;
  return normalizeWorkerUrl(inputValue || getWorkerBaseUrl());
}
function looksLikeWorkerRoot(url) {
  return /^https?:\/\/[^\s/]+(?:\/[^\s?#]+)*$/i.test(String(url || ""));
}
function getFrontendKey(key, legacyKey, compatKey = "") {
  return localStorage.getItem(key) ||
    (compatKey ? localStorage.getItem(compatKey) : "") ||
    localStorage.getItem(legacyKey) ||
    "";
}
function isDefaultStaticAssetSource() { const u = getAssetApiUrl(); return u === DEFAULT_ASSET_API_URL || u.endsWith("/data/assets.json") || u.endsWith("data/assets.json"); }
function buildUrl(url, symbol) { return symbol && url.includes("{symbol}") ? url.replaceAll("{symbol}", encodeURIComponent(symbol)) : url; }
function scoreClass(score) { return score >= 75 ? "up" : score >= 55 ? "flat" : "down"; }
function badgeClass(level) {
  const t = String(level || "").toLowerCase();
  if (t.includes("高") || t.includes("强") || t.includes("达标")) return "";
  if (t.includes("中") || t.includes("观察") || t.includes("跟踪") || t.includes("未达")) return "warn";
  if (t.includes("风险") || t.includes("弱") || t.includes("低") || t.includes("不达") || t.includes("预警")) return "hot";
  return "blue";
}
function trendClass(v) {
  const t = String(v || "");
  if (t.includes("+") || t.includes("强") || t.includes("修复") || t.includes("开启") || t.includes("升")) return "up";
  if (t.includes("-") || t.includes("弱") || t.includes("降") || t.includes("跌")) return "down";
  return "flat";
}
function showToast(msg) { const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }
function setLoading(btn, loading) { if (!btn) return; btn.disabled = loading; btn.style.opacity = loading ? ".65" : "1"; }

function frontendKeyHeaders() {
  const headers = {};
  const t = getFrontendKey(STORAGE_KEYS.tushareKey, STORAGE_KEYS.legacy.tushareKey, "financePulse.tushareToken");
  const e = getFrontendKey(STORAGE_KEYS.eodhdKey, STORAGE_KEYS.legacy.eodhdKey, "financePulse.eodhdApiKey");
  const f = getFrontendKey(STORAGE_KEYS.finnhubKey, STORAGE_KEYS.legacy.finnhubKey, "financePulse.finnhubApiKey");
  if (t) headers["X-Tushare-Token"] = t;
  if (e) {
    headers["X-EODHD-Token"] = e;
    headers["X-EODHD-API-Key"] = e;
  }
  if (f) {
    headers["X-Finnhub-Key"] = f;
    headers["X-Finnhub-API-Key"] = f;
  }
  return headers;
}
async function fetchJson(url) {
  const u = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  const r = await fetch(u, { cache: "no-store", headers: frontendKeyHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function setScoreRing(score) {
  const pct = clamp(score, 0, 100);
  if ($("decisionScore")) $("decisionScore").textContent = Math.round(pct);
  if ($("scoreRing")) $("scoreRing").style.background = `conic-gradient(var(--green) 0 ${pct}%, rgba(255,255,255,.1) ${pct}% 100%)`;
}

async function fetchMarketData() {
  const btn = $("refreshBtn");
  setLoading(btn, true);
  try {
    if ($("dataStatus")) $("dataStatus").textContent = "更新中";
    const data = await fetchJson(getMarketApiUrl());
    if (!data.market) throw new Error("缺少 market 字段");
    if (getMarketApiUrl() === DEFAULT_MARKET_API_URL || getMarketApiUrl().endsWith("data/market.json")) {
      data.updatedAt = new Date().toISOString();
      data._localDemo = true;
      data.modelMarket = {
        riskScore: 55 + Math.round(Math.random() * 20 - 10),
        breadthScore: 55 + Math.round(Math.random() * 20 - 10),
        trendScore: 55 + Math.round(Math.random() * 20 - 10),
        sentimentScore: 55 + Math.round(Math.random() * 20 - 10)
      };
      if (Array.isArray(data.hotThemes)) {
        data.hotThemes = data.hotThemes.map((x, i) => ({ ...x, score: Math.max(30, Math.min(98, Number(x.score || 60) + Math.round((Math.random() * 8 - 4) + (i % 2 ? 1 : -1)))) }));
      }
      data.decision = { ...(data.decision || {}), conclusion: "当前为本地演示刷新。要获取真实主题热度、新闻和市场情绪，请在设置页配置 Worker / 后端 API。" };
    }
    localStorage.setItem(STORAGE_KEYS.lastMarketData, JSON.stringify(data));
    appState.marketData = data;
    renderMarket(data, false);
    showToast("市场数据已更新");
  } catch (e) {
    const cached = localStorage.getItem(STORAGE_KEYS.lastMarketData);
    if (cached) {
      const data = JSON.parse(cached);
      appState.marketData = data;
      renderMarket(data, true);
      showToast("市场数据失败，已使用缓存");
    } else {
      renderMarketError(e);
      showToast("市场数据加载失败");
    }
  } finally { setLoading(btn, false); }
}

function renderMarket(data, fromCache = false) {
  const market = data.market || {}, decision = data.decision || {}, indices = data.indices || [];
  const homeSignals = data.homeSignals || [], tracks = data.tracks || [], hotThemes = data.hotThemes || [], hotNews = data.hotNews || [];
  const radar = data.radar || {}, risks = data.risks || [];
  if ($("marketMode")) $("marketMode").textContent = market.mode || "暂无结论";
  if ($("marketSummary")) $("marketSummary").textContent = market.summary || "暂无市场摘要";
  if ($("aiConclusion")) $("aiConclusion").textContent = decision.conclusion || "暂无作战结论";
  if ($("radarScore")) $("radarScore").textContent = radar.score ?? decision.score ?? "--";
  if ($("disciplineText")) $("disciplineText").textContent = radar.discipline || "暂无纪律提示";
  if ($("dataStatus")) $("dataStatus").textContent = fromCache ? "缓存" : (data._localDemo ? "本地演示" : "动态");
  if ($("hotUpdateTime")) $("hotUpdateTime").textContent = formatTime(data.updatedAt);
  if ($("lastUpdatedText")) $("lastUpdatedText").textContent = formatTime(data.updatedAt);
  if ($("subTitle")) $("subTitle").textContent = data.subtitle || "V12 代码审查修复版";
  setScoreRing(decision.score ?? radar.score ?? 0);
  if ($("indexRow")) $("indexRow").innerHTML = indices.slice(0, 3).map(x => `<div class="index-card"><span>${escapeHtml(x.name)}</span><b class="${trendClass(x.value)}">${escapeHtml(x.value)}</b></div>`).join("");
  if ($("homeSignals")) $("homeSignals").innerHTML = homeSignals.map(x => `<div class="mini-card"><div class="emoji">${escapeHtml(x.icon || "📌")}</div><h4>${escapeHtml(x.title)}</h4><p>${escapeHtml(x.text)}</p></div>`).join("");
  if ($("trackList")) $("trackList").innerHTML = tracks.map(renderTrack).join("");
  if ($("heatBars")) $("heatBars").innerHTML = hotThemes.map(renderHeatBar).join("");
  if ($("hotNews")) $("hotNews").innerHTML = hotNews.map(renderNewsCard).join("");
  if ($("radarCards")) $("radarCards").innerHTML = (radar.cards || []).map(c => `<div class="panel-card"><div class="emoji">${escapeHtml(c.icon || "📌")}</div><h4>${escapeHtml(c.title)}</h4><p>${escapeHtml(c.text)}</p></div>`).join("");
  if ($("riskList")) $("riskList").innerHTML = risks.map(r => `<article class="risk-item"><h4>${escapeHtml(r.title)} <span class="badge ${badgeClass(r.level)}">${escapeHtml(r.level || "提示")}</span></h4><p>${escapeHtml(r.text)}</p></article>`).join("");
}
function renderTrack(t) { const rules = t.rules || []; return `<article class="decision-card"><div class="decision-head"><div><h4>${escapeHtml(t.icon || "🧭")} ${escapeHtml(t.name)}</h4><p>${escapeHtml(t.logic || "")}</p></div><span class="badge ${badgeClass(t.tag)}">${escapeHtml(t.tag || "观察")}</span></div><div class="metric-grid"><div class="metric"><span>赛道分</span><b class="${Number(t.score) >= 75 ? "up" : "flat"}">${escapeHtml(t.score ?? "--")}</b></div><div class="metric"><span>入场</span><b>${escapeHtml(t.entry || "--")}</b></div><div class="metric"><span>风险</span><b class="${String(t.risk).includes("高") ? "down" : "flat"}">${escapeHtml(t.risk || "--")}</b></div></div><ul class="rule-list">${rules.map(r => `<li class="${escapeHtml(r.type || "")}">${escapeHtml(r.text || r)}</li>`).join("")}</ul></article>`; }
function renderHeatBar(t) { const s = clamp(t.score, 0, 100); return `<div class="bar-row"><div class="bar-top"><span>${escapeHtml(t.name)}</span><span>${s}</span></div><div class="bar-track"><div class="bar-fill" style="width:${s}%"></div></div></div>`; }
function renderNewsCard(x) { return `<article class="sector"><div class="icon">${escapeHtml(x.icon || "📰")}</div><div><h4>${escapeHtml(x.title)}</h4><p>${escapeHtml(x.text)}</p></div><div class="badge ${badgeClass(x.tag)}">${escapeHtml(x.tag || "跟踪")}</div></article>`; }
function renderMarketError(e) { if ($("marketMode")) $("marketMode").textContent = "数据加载失败"; if ($("marketSummary")) $("marketSummary").textContent = "请检查市场 API 或 data/market.json"; if ($("aiConclusion")) $("aiConclusion").textContent = e.message || "未知错误"; if ($("dataStatus")) $("dataStatus").textContent = "错误"; }

async function loadAssetUniverse() {
  const data = await fetchJson(buildUrl(getAssetApiUrl()));
  appState.assetsData = data;
  localStorage.setItem(STORAGE_KEYS.lastAssetData, JSON.stringify(data));
  populateAssetSelect(data);
  return data;
}
function populateAssetSelect(data) {
  const select = $("symbolSelect"); if (!select) return;
  const assets = data.assets || {}; const keys = Object.keys(assets);
  select.innerHTML = keys.map(sym => { const item = assets[sym]; return `<option value="${escapeHtml(sym)}">${escapeHtml(sym)} - ${escapeHtml(item.name || sym)}</option>`; }).join("");
  if (!keys.length) select.innerHTML = `<option value="">未发现资产数据</option>`;
}

function normalizeInputSymbol(symbol) { return String(symbol || "").trim().toUpperCase().replace(/\s+/g, ""); }
function routeSymbol(symbol) {
  const s = normalizeInputSymbol(symbol);
  if (/^\d{6}$/.test(s)) {
    if (/^(600|601|603|605|688)/.test(s)) return { market: "CN_A", exchange: "SH", providerSymbol: s + ".SS" };
    if (/^(000|001|002|003|300|301|159|16)/.test(s)) return { market: "CN_A", exchange: "SZ", providerSymbol: s + ".SZ" };
    if (/^(50|51|52|56|58)/.test(s)) return { market: "CN_A", exchange: "SH", providerSymbol: s + ".SS" };
  }
  if (/^\d{4,5}\.HK$/.test(s)) return { market: "HK", exchange: "HK", providerSymbol: s };
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return { market: "US", exchange: "US", providerSymbol: s };
  return { market: "UNKNOWN", exchange: "UNKNOWN", providerSymbol: s };
}
function seededRandom(seed) { let h = 2166136261; for (let i = 0; i < String(seed).length; i++) { h ^= String(seed).charCodeAt(i); h = Math.imul(h, 16777619); } return function() { h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5; return ((h >>> 0) % 100000) / 100000; }; }
function inferLocalMeta(symbol) {
  const map = { "600845": ["宝信软件", "信息技术", "AI/软件"], "688185": ["康希诺", "医药生物", "生物医药"], "159915": ["创业板ETF", "基金", "宽基ETF"], "510300": ["沪深300ETF", "基金", "宽基ETF"], "512480": ["半导体ETF", "基金", "半导体ETF"], "600519": ["贵州茅台", "消费", "白酒消费"], "300750": ["宁德时代", "新能源", "电池/新能源车"], "002230": ["科大讯飞", "信息技术", "AI/软件"] };
  if (map[symbol]) return { name: map[symbol][0], sector: map[symbol][1], industry: map[symbol][2] };
  if (/^512|^515|^159|^510|^588/.test(symbol)) return { name: `${symbol} 本地演示基金`, sector: "基金", industry: "行业/宽基ETF", assetType: "fund" };
  return { name: `${symbol} 本地演示标的`, sector: "未知", industry: "通用" };
}
function buildSyntheticAsset(symbol) {
  const meta = inferLocalMeta(symbol); const rnd = seededRandom(symbol); const prices = []; let price = 20 + rnd() * 80; let d = new Date(Date.now() - 1500 * 24 * 3600 * 1000); let count = 0;
  const isFund = meta.assetType === "fund" || /ETF|基金/.test(meta.name + meta.industry); const vol = isFund ? 0.012 : 0.022; const drift = /AI|科技|半导体|新能源/.test(meta.industry) ? 0.00028 : /银行|高股息|宽基/.test(meta.industry) ? 0.00012 : 0.00018;
  while (count < 900) { d.setDate(d.getDate() + 1); if (d.getDay() === 0 || d.getDay() === 6) continue; const cyc = 0.0007 * Math.sin(count / 45) + 0.00035 * Math.sin(count / 110); const shock = (rnd() - 0.5) * 2 * vol; price = Math.max(0.5, price * (1 + drift + cyc + shock)); const open = price * (1 + (rnd() - 0.5) * vol * .4); const high = Math.max(open, price) * (1 + rnd() * 0.012); const low = Math.min(open, price) * (1 - rnd() * 0.012); prices.push({ date: d.toISOString().slice(0,10), open:+open.toFixed(2), high:+high.toFixed(2), low:+low.toFixed(2), close:+price.toFixed(2), volume:Math.floor(1000000+rnd()*9000000) }); count++; }
  return { symbol, name:meta.name, assetType:isFund?"fund":"stock", sector:meta.sector, industry:meta.industry, currency:"CNY", dataSource:"synthetic-local-fallback", localWarning:"当前未连接实时资产API，系统使用本地演示/样例行情跑通模型；该结果只能用于功能测试，不能用于真实交易。", news:[{title:`${meta.name}：本地演示新闻，未连接实时新闻源`, source:"Local Fallback", publishedAt:new Date().toISOString().slice(0,10)}], prices };
}

function analyzeAssetAsync(asset, options) {
  return new Promise((resolve, reject) => {
    if (!("Worker" in window)) { try { resolve(window.FPDecisionModel.analyzeAsset(asset, options)); } catch(e) { reject(e); } return; }
    const worker = new Worker("./decision-worker.js");
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("模型计算超时，请检查行情数据量。")); }, 20000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); const data = event.data || {}; data.ok ? resolve(data.result) : reject(new Error(data.error || "模型计算失败")); };
    worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message || "Worker 运行失败")); };
    worker.postMessage({ asset, options });
  });
}
async function runAssetDecision() {
  const btn = $("runDecisionBtn"); setLoading(btn, true);
  const input = normalizeInputSymbol($("symbolInput")?.value); const selected = $("symbolSelect")?.value; const symbol = input || selected; const route = routeSymbol(symbol);
  try {
    if (!symbol) throw new Error("请先输入或选择一个标的。");
    let data = appState.assetsData || await loadAssetUniverse();
    let asset = data.assets?.[symbol];
    let usedFallback = false;
    if (!asset && !isDefaultStaticAssetSource()) {
      const single = await fetchJson(buildUrl(getAssetApiUrl(), symbol));
      asset = single.asset || single;
    }
    if (!asset && isDefaultStaticAssetSource()) { asset = buildSyntheticAsset(symbol); asset.route = route; usedFallback = true; }
    if (!asset || !asset.prices) throw new Error("没有找到该标的或缺少历史行情。请配置资产 API，或确认 data/assets.json 内有该代码。");
    if (usedFallback && !asset.localWarning) asset.localWarning = "当前未连接实时资产API，系统使用本地演示行情。";
    const result = await analyzeAssetAsync(asset, {
      targetWinRate: Number($("targetWinRate")?.value || 0.9), forwardDays: Number($("forwardDays")?.value || 20), costBps: Number($("costBps")?.value || 15), minSignals: Number($("minSignals")?.value || 8), stopLossPct: Number($("stopLossPct")?.value || 8), regimeFilter: $("regimeFilter")?.value || "strict", market: appState.marketData?.modelMarket || { riskScore:55, breadthScore:55, trendScore:55, sentimentScore:55 }
    });
    renderAssetDecision(result); showToast("模型计算完成");
  } catch(e) { if ($("decisionOutput")) $("decisionOutput").innerHTML = `<section class="ai-card"><h3>无法生成决策</h3><p>${escapeHtml(e.message)}</p></section>`; showToast("标的分析失败"); }
  finally { setLoading(btn, false); }
}

function sparkline(values) { if (!values || values.length < 2) return ""; const w=320,h=74,pad=8,min=Math.min(...values),max=Math.max(...values),range=max-min||1; const pts=values.map((v,i)=>`${(pad+i*(w-pad*2)/(values.length-1)).toFixed(1)},${(h-pad-(v-min)*(h-pad*2)/range).toFixed(1)}`).join(" "); return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".9"/><line x1="0" y1="${h-pad}" x2="${w}" y2="${h-pad}" stroke="rgba(255,255,255,.15)" stroke-width="1"/></svg>`; }
function renderProductionBanner(r) { const q = r.productionDataQuality; if (!q) return ""; if (q.productionReady) return `<section class="prod-banner good">生产数据检查通过：provider=${escapeHtml(q.provider || "unknown")}。</section>`; return `<section class="prod-banner bad">生产数据检查未通过：${escapeHtml((q.warnings || []).join("；"))}</section>`; }
function renderResultPills(r) { const tier = r.confidenceTier || "D"; const cls = tier === "A" ? "good" : tier === "B" ? "warn" : "bad"; return `<div class="model-pill-row"><span class="model-pill ${cls}">置信等级 ${tier}</span><span class="model-pill">市场环境：${escapeHtml(r.marketRegime?.name || "未知")}</span><span class="model-pill">资产类型：${escapeHtml(r.assetType || "--")}</span></div>`; }
function renderSubModels(subModels) { if (!subModels) return ""; const items = [["趋势模型",subModels.trend],["回踩模型",subModels.pullback],["防守模型",subModels.defense],["情绪模型",subModels.sentiment],["回测模型",subModels.backtest]]; return `<h4 class="subhead">组合模型评分</h4><div class="metric-grid">${items.map(([n,v])=>`<div class="metric"><span>${escapeHtml(n)}</span><b class="${scoreClass(v)}">${Math.round(v)}</b></div>`).join("")}</div>`; }
function renderDecisionReasons(reasons) { if (!Array.isArray(reasons) || !reasons.length) return ""; return `<h4 class="subhead">模型解释</h4><ul class="rule-list">${reasons.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>`; }
function renderNewsList(news) { if (!Array.isArray(news) || !news.length) return `<section class="api-warning">当前资产数据没有返回新闻。要启用新闻情绪，请部署 Worker，并让资产 API 返回 news 数组。</section>`; return `<h4 class="subhead">相关新闻/情绪</h4><div class="news-list">${news.slice(0,5).map(n=>`<div class="news-item"><b>${escapeHtml(n.title || "未命名新闻")}</b><span>${escapeHtml(n.source || "news")} ｜ ${escapeHtml(n.publishedAt || "")}</span></div>`).join("")}</div>`; }
function renderAssetDecision(r) {
  const periods = r.periodResults.map(p => `<div class="period-card"><span>${escapeHtml(p.label)}</span><b class="${scoreClass(p.score)}">${p.score}</b><p>收益 ${p.returnPct.toFixed(2)}%</p><p>回撤 ${p.maxDrawdownPct.toFixed(2)}%</p><p>波动 ${p.volatilityPct.toFixed(2)}%</p></div>`).join(""); const bt = r.backtest;
  if ($("decisionOutput")) $("decisionOutput").innerHTML = `<section class="decision-card result-card"><div class="decision-head"><div><h4>${escapeHtml(r.symbol)} - ${escapeHtml(r.name)}</h4><p>最新交易日：${escapeHtml(r.latestDate)} ｜ 最新价：${Number(r.latestClose).toFixed(2)} ｜ ${escapeHtml(r.industry || r.sector || "行业未知")}</p></div><span class="badge ${badgeClass(r.level)}">${escapeHtml(r.level)}</span></div>${r.localWarning ? `<section class="api-warning">${escapeHtml(r.localWarning)}</section>` : ""}${renderProductionBanner(r)}${renderResultPills(r)}<section class="model-profile-card"><h4>${escapeHtml(r.modelProfile?.name || "通用模型")} ｜ 情绪分 ${Math.round(r.sentimentScore || 50)}</h4><p>${escapeHtml(r.modelProfile?.desc || "根据行业和资产类型自动选择模型。")}</p></section>${sparkline(r.sparkline)}<div class="big-score"><div><span>综合分</span><b class="${scoreClass(r.scores.decisionScore)}">${r.scores.decisionScore}</b></div><div><span>建议</span><b>${escapeHtml(r.action)}</b></div><div><span>仓位</span><b>${escapeHtml(r.position)}</b></div></div><div class="metric-grid"><div class="metric"><span>趋势</span><b class="${scoreClass(r.scores.trendScore)}">${r.scores.trendScore}</b></div><div class="metric"><span>动量</span><b class="${scoreClass(r.scores.momentumScore)}">${r.scores.momentumScore}</b></div><div class="metric"><span>风险</span><b class="${scoreClass(r.scores.riskScore)}">${r.scores.riskScore}</b></div></div><section class="ai-card"><h3>walk-forward 回测</h3><p>信号 ${bt.total} 次｜命中 ${bt.wins} 次｜胜率 ${(bt.winRate*100).toFixed(1)}%｜Wilson下界 ${(bt.wilsonLowerBound*100).toFixed(1)}%｜PF ${bt.profitFactor.toFixed(2)}｜最大连亏 ${bt.maxConsecutiveLosses}｜平均净收益 ${bt.avgNetReturn.toFixed(2)}%｜止损 ${bt.stopLossPct}%</p></section><section class="quality-box"><h4>数据质量</h4><p>${r.dataQuality?.ok ? "数据质量检查通过。" : "数据质量存在问题：" + escapeHtml((r.dataQuality?.issues || []).join("；"))}</p></section><div class="period-grid">${periods}</div>${renderSubModels(r.subModels)}${renderDecisionReasons(r.decisionReasons)}<h4 class="subhead">入场条件</h4><ul class="rule-list">${r.entryRules.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul><h4 class="subhead">阻断/风险原因</h4><ul class="rule-list">${r.warnings.map(x=>`<li class="risk">${escapeHtml(x)}</li>`).join("")}</ul>${renderNewsList(r.news)}<p class="disclaimer">这是量化辅助模型输出，不构成证券投资建议。90% 是历史回测筛选门槛，不是未来保证。</p></section>`;
}

function formatTime(v) { if (!v) return "--"; try { const d = new Date(v); if (Number.isNaN(d.getTime())) return v; return d.toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }); } catch { return v; } }
function initNavigation() { document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => { const p = btn.dataset.page; document.querySelectorAll(".page").forEach(x => x.classList.toggle("active", x.id === p)); document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === p)); window.scrollTo({ top:0, behavior:"smooth" }); history.replaceState(null, "", "#" + p); })); const h = location.hash.replace("#", ""); if (h && document.getElementById(h)) document.querySelector(`.nav-item[data-page="${h}"]`)?.click(); }

async function runDiagnostics() { const set=(id,text,cls)=>{const el=$(id); if(el){el.textContent=text; el.className=cls||"";}}; async function test(url){try{const r=await fetch(url+(url.includes("?")?"&":"?")+"diag="+Date.now(),{cache:"no-store"}); if(!r.ok)return "HTTP "+r.status; await r.json(); return "正常";}catch{return "失败";}} const m=await test("./data/market.json"), a=await test("./data/assets.json"); set("diagMarket",m,m==="正常"?"up":"down"); set("diagAssets",a,a==="正常"?"up":"down"); set("diagSW","serviceWorker" in navigator ? "支持" : "不支持","serviceWorker" in navigator ? "up":"down"); set("diagCache",APP_VERSION,"up"); showToast(m==="正常"&&a==="正常"?"数据路径正常":"数据路径存在问题"); }
async function clearLocalCache() { Object.values(STORAGE_KEYS).forEach(v => { if (typeof v === "string") localStorage.removeItem(v); }); if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } showToast("本地缓存已清理，请刷新页面"); }
function setStatus(id, text, cls = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = cls || "";
}

function workerBaseFromApi() {
  const configured = getWorkerBaseUrlFromInputOrStorage();
  if (configured) return configured;
  const candidate = getMarketApiUrl().startsWith("http") ? getMarketApiUrl() : (getAssetApiUrl().startsWith("http") ? getAssetApiUrl() : "");
  if (!candidate) return "";
  try {
    const u = new URL(candidate);
    const path = u.pathname.replace(/\/(market|asset|quote|diagnose|health|provider\/test)\/?$/i, "");
    return normalizeWorkerUrl(u.origin + path);
  } catch { return ""; }
}

function saveWorkerDerivedApiUrls(base, force = false) {
  const workerBaseUrl = normalizeWorkerUrl(base);
  if (!workerBaseUrl) return;
  const currentMarket = getMarketApiUrl();
  const currentAsset = getAssetApiUrl();
  if (force || currentMarket === DEFAULT_MARKET_API_URL || currentMarket.endsWith("/data/market.json") || currentMarket.endsWith("data/market.json")) {
    localStorage.setItem(STORAGE_KEYS.marketApiUrl, `${workerBaseUrl}/market`);
    if ($("marketApiUrlInput")) $("marketApiUrlInput").value = `${workerBaseUrl}/market`;
  }
  if (force || currentAsset === DEFAULT_ASSET_API_URL || currentAsset.endsWith("/data/assets.json") || currentAsset.endsWith("data/assets.json")) {
    localStorage.setItem(STORAGE_KEYS.assetApiUrl, `${workerBaseUrl}/asset?symbol={symbol}`);
    if ($("assetApiUrlInput")) $("assetApiUrlInput").value = `${workerBaseUrl}/asset?symbol={symbol}`;
  }
}

async function checkEndpoint(id, url, okText = "通过", failText = "失败") {
  try {
    setStatus(id, "检查中...", "warn");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {
      cache: "no-store",
      headers: frontendKeyHeaders(),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false || data.error) {
      const msg = data.error || data.message || `HTTP ${r.status}`;
      setStatus(id, `${failText}：${msg}`, "down");
      return { ok: false, data, error: msg };
    }
    setStatus(id, okText, "up");
    return { ok: true, data };
  } catch (e) {
    const msg = e?.name === "AbortError" ? "超时" : (e?.message || "请求失败");
    setStatus(id, `${failText}：${msg}`, "down");
    return { ok: false, error: msg };
  }
}

function refreshProviderStatusWithoutRequest() {
  const base = getWorkerBaseUrlFromInputOrStorage();
  const h = frontendKeyHeaders();
  if (!base) {
    setStatus("providerMode", "未配置 Worker", "warn");
    setStatus("prodHealth", "未配置", "down");
    setStatus("prodCN", "未配置", "down");
    setStatus("prodUS", "未配置", "down");
    setStatus("prodMode", "未通过", "down");
  } else {
    setStatus("providerMode", "Worker 已配置", "up");
  }
  setStatus("providerTushare", h["X-Tushare-Token"] ? (base ? "已填 Key，待检查" : "已填 Key，但未配置 Worker") : "未填 Key", h["X-Tushare-Token"] && base ? "warn" : "down");
  setStatus("providerEodhd", h["X-EODHD-Token"] ? (base ? "已填 Key，待检查" : "已填 Key，但未配置 Worker") : "未填 Key", h["X-EODHD-Token"] && base ? "warn" : "down");
  setStatus("providerFinnhub", h["X-Finnhub-Key"] ? (base ? "已填 Key，待检查" : "已填 Key，但未配置 Worker") : "未填 Key", h["X-Finnhub-Key"] && base ? "warn" : "down");
}

async function checkProviderStatus() {
  const base = workerBaseFromApi();
  if (!base) {
    refreshProviderStatusWithoutRequest();
    showToast("请先填写 Worker Base URL");
    return;
  }
  if (!looksLikeWorkerRoot(base)) {
    setStatus("providerMode", "Worker URL 格式异常", "down");
    showToast("Worker Base URL 需要以 http:// 或 https:// 开头");
    return;
  }
  localStorage.setItem(STORAGE_KEYS.workerBaseUrl, base);
  localStorage.setItem("financePulse.workerBaseUrl", base);
  if ($("workerBaseUrlInput")) $("workerBaseUrlInput").value = base;
  saveWorkerDerivedApiUrls(base, true);
  setStatus("providerMode", "Worker 已配置", "up");
  const health = await checkEndpoint("providerMode", `${base}/health`, "Worker 已连接", "连接失败");
  const providers = health.data?.providers || {};
  const keyMode = health.data?.keyMode || health.data?.mode || "Worker";
  if (health.ok) setStatus("providerMode", keyMode, "up");
  await checkEndpoint("providerTushare", `${base}/provider/test?provider=tushare`, providers.tushare ? "通过" : "未配置", providers.tushare ? "失败" : "未配置");
  await checkEndpoint("providerEodhd", `${base}/provider/test?provider=eodhd`, providers.eodhd ? "通过" : "未配置", providers.eodhd ? "失败" : "未配置");
  await checkEndpoint("providerFinnhub", `${base}/provider/test?provider=finnhub`, providers.finnhub ? "通过" : "未配置", providers.finnhub ? "失败" : "未配置");
  showToast("数据源状态已更新");
}

async function runProductionCheck() {
  const base = workerBaseFromApi();
  if (!base) {
    setStatus("prodHealth", "未配置", "down");
    setStatus("prodCN", "未配置", "down");
    setStatus("prodUS", "未配置", "down");
    setStatus("prodMode", "未通过", "down");
    showToast("请先填写 Worker Base URL");
    return;
  }
  if (!looksLikeWorkerRoot(base)) {
    setStatus("prodHealth", "Worker URL 格式异常", "down");
    setStatus("prodCN", "未检查", "down");
    setStatus("prodUS", "未检查", "down");
    setStatus("prodMode", "未通过", "down");
    showToast("Worker Base URL 需要以 http:// 或 https:// 开头");
    return;
  }
  localStorage.setItem(STORAGE_KEYS.workerBaseUrl, base);
  if ($("workerBaseUrlInput")) $("workerBaseUrlInput").value = base;
  saveWorkerDerivedApiUrls(base, true);
  const h = await checkEndpoint("prodHealth", `${base}/health`, "通过", "失败");
  const cn = await checkEndpoint("prodCN", `${base}/diagnose?symbol=600845`, "通过", "失败");
  const us = await checkEndpoint("prodUS", `${base}/diagnose?symbol=AAPL`, "通过", "失败");
  const cnReady = cn.ok && cn.data?.productionReady;
  const usReady = us.ok && us.data?.productionReady;
  if (cn.ok && !cnReady) setStatus("prodCN", "未达标", "warn");
  if (us.ok && !usReady) setStatus("prodUS", "未达标", "warn");
  const all = h.ok && cnReady && usReady;
  setStatus("prodMode", all ? "可实际应用" : "未通过", all ? "up" : "down");
  showToast(all ? "生产自检通过" : "生产自检未通过");
}

function fillWorkerUrls() {
  const example = "https://你的worker.workers.dev";
  if ($("workerBaseUrlInput")) $("workerBaseUrlInput").value = example;
  if ($("marketApiUrlInput")) $("marketApiUrlInput").value = example + "/market";
  if ($("assetApiUrlInput")) $("assetApiUrlInput").value = example + "/asset?symbol={symbol}";
  showToast("已填入 Worker 接口格式，请替换域名");
}

function initFrontendKeySettings() {
  const w = $("workerBaseUrlInput"), t = $("tushareKeyInput"), e = $("eodhdKeyInput"), f = $("finnhubKeyInput");
  if (!t || !e || !f) return;
  if (w) w.value = getWorkerBaseUrl();
  const savedT = getFrontendKey(STORAGE_KEYS.tushareKey, STORAGE_KEYS.legacy.tushareKey, "financePulse.tushareToken");
  const savedE = getFrontendKey(STORAGE_KEYS.eodhdKey, STORAGE_KEYS.legacy.eodhdKey, "financePulse.eodhdApiKey");
  const savedF = getFrontendKey(STORAGE_KEYS.finnhubKey, STORAGE_KEYS.legacy.finnhubKey, "financePulse.finnhubApiKey");
  t.placeholder = savedT ? `已保存：${maskKey(savedT)}` : "输入 Tushare Token，仅保存在本机浏览器";
  e.placeholder = savedE ? `已保存：${maskKey(savedE)}` : "输入 EODHD API Token，仅保存在本机浏览器";
  f.placeholder = savedF ? `已保存：${maskKey(savedF)}` : "输入 Finnhub API Key，仅保存在本机浏览器";
  if ($("saveFrontendKeysBtn")) $("saveFrontendKeysBtn").onclick = () => {
    const base = normalizeWorkerUrl(w?.value || getWorkerBaseUrl());
    if (base) {
      if (!looksLikeWorkerRoot(base)) {
        showToast("Worker Base URL 格式不正确");
        return;
      }
      localStorage.setItem(STORAGE_KEYS.workerBaseUrl, base);
      localStorage.setItem("financePulse.workerBaseUrl", base);
      localStorage.setItem("workerBaseUrl", base);
      if (w) w.value = base;
      saveWorkerDerivedApiUrls(base, true);
    }
    if (t.value.trim()) { localStorage.setItem(STORAGE_KEYS.tushareKey, t.value.trim()); localStorage.setItem("financePulse.tushareToken", t.value.trim()); }
    if (e.value.trim()) { localStorage.setItem(STORAGE_KEYS.eodhdKey, e.value.trim()); localStorage.setItem("financePulse.eodhdApiKey", e.value.trim()); }
    if (f.value.trim()) { localStorage.setItem(STORAGE_KEYS.finnhubKey, f.value.trim()); localStorage.setItem("financePulse.finnhubApiKey", f.value.trim()); }
    t.value = ""; e.value = ""; f.value = "";
    initFrontendKeySettings();
    refreshProviderStatusWithoutRequest();
    showToast("Worker URL / API Key 已保存到本机");
  };
  if ($("clearFrontendKeysBtn")) $("clearFrontendKeysBtn").onclick = () => {
    [
      STORAGE_KEYS.tushareKey, STORAGE_KEYS.eodhdKey, STORAGE_KEYS.finnhubKey, STORAGE_KEYS.workerBaseUrl,
      STORAGE_KEYS.legacy.tushareKey, STORAGE_KEYS.legacy.eodhdKey, STORAGE_KEYS.legacy.finnhubKey, STORAGE_KEYS.legacy.workerBaseUrl,
      "financePulse.tushareToken", "financePulse.eodhdApiKey", "financePulse.finnhubApiKey", "financePulse.workerBaseUrl", "workerBaseUrl"
    ].forEach(k => localStorage.removeItem(k));
    if (w) w.value = "";
    t.value = ""; e.value = ""; f.value = "";
    initFrontendKeySettings();
    refreshProviderStatusWithoutRequest();
    showToast("本机 Worker URL / API Key 已清除");
  };
  refreshProviderStatusWithoutRequest();
}

function initSettings() { initFrontendKeySettings(); if($("marketApiUrlInput")) $("marketApiUrlInput").value=getMarketApiUrl(); if($("assetApiUrlInput")) $("assetApiUrlInput").value=getAssetApiUrl(); if($("saveMarketApiBtn")) $("saveMarketApiBtn").onclick=()=>{localStorage.setItem(STORAGE_KEYS.marketApiUrl,$("marketApiUrlInput").value.trim()||DEFAULT_MARKET_API_URL);fetchMarketData();}; if($("resetMarketApiBtn")) $("resetMarketApiBtn").onclick=()=>{localStorage.removeItem(STORAGE_KEYS.marketApiUrl);$("marketApiUrlInput").value=DEFAULT_MARKET_API_URL;fetchMarketData();}; if($("saveAssetApiBtn")) $("saveAssetApiBtn").onclick=async()=>{localStorage.setItem(STORAGE_KEYS.assetApiUrl,$("assetApiUrlInput").value.trim()||DEFAULT_ASSET_API_URL);appState.assetsData=null;await loadAssetUniverse();showToast("资产数据源已保存");}; if($("resetAssetApiBtn")) $("resetAssetApiBtn").onclick=async()=>{localStorage.removeItem(STORAGE_KEYS.assetApiUrl);$("assetApiUrlInput").value=DEFAULT_ASSET_API_URL;appState.assetsData=null;await loadAssetUniverse();showToast("资产数据源已恢复");}; document.querySelectorAll(".switch").forEach(sw=>{const key=sw.dataset.setting;const sk=key==="riskFirst"?STORAGE_KEYS.riskFirst:STORAGE_KEYS.autoRefresh;if(localStorage.getItem(sk)==="false")sw.classList.remove("on");sw.onclick=()=>{sw.classList.toggle("on");localStorage.setItem(sk,sw.classList.contains("on")?"true":"false");setupAutoRefresh();};}); if($("runDiagBtn")) $("runDiagBtn").onclick=runDiagnostics; if($("clearCacheBtn")) $("clearCacheBtn").onclick=clearLocalCache; if($("checkProviderBtn")) $("checkProviderBtn").onclick=checkProviderStatus; if($("runProdCheckBtn")) $("runProdCheckBtn").onclick=runProductionCheck; if($("useWorkerMarketBtn")) $("useWorkerMarketBtn").onclick=fillWorkerUrls; if($("useWorkerAssetBtn")) $("useWorkerAssetBtn").onclick=fillWorkerUrls; }
function setupInstallButton(){ window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();appState.deferredPrompt=e;}); if($("installBtn")) $("installBtn").onclick=async()=>{ if(appState.deferredPrompt){appState.deferredPrompt.prompt(); await appState.deferredPrompt.userChoice; appState.deferredPrompt=null;} else showToast("请用浏览器菜单添加到主屏幕"); }; }
function setupAutoRefresh(){ if(appState.autoRefreshTimer)clearInterval(appState.autoRefreshTimer); if(localStorage.getItem(STORAGE_KEYS.autoRefresh)!=="false") appState.autoRefreshTimer=setInterval(()=>fetchMarketData(),5*60*1000); }
function registerServiceWorker(){ if("serviceWorker" in navigator) window.addEventListener("load",async()=>{try{const reg=await navigator.serviceWorker.register("./sw.js"); if(reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});}catch(e){console.warn(e);}}); }
async function initApp(){ initNavigation(); initSettings(); setupInstallButton(); setupAutoRefresh(); if($("refreshBtn")) $("refreshBtn").onclick=()=>fetchMarketData(); if($("runDecisionBtn")) $("runDecisionBtn").onclick=runAssetDecision; if($("symbolInput")) $("symbolInput").addEventListener("keydown",e=>{if(e.key==="Enter")runAssetDecision();}); await fetchMarketData(); try{await loadAssetUniverse();}catch(e){showToast("资产数据源加载失败");} registerServiceWorker(); }
document.addEventListener("DOMContentLoaded",initApp);
