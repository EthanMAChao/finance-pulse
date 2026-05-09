// Finance Pulse V12 Cloudflare Worker
//
// Routes:
//   GET /health
//   GET /market
//   GET /asset?symbol=600845
//   GET /news?symbol=AAPL
//
// Required secrets / env vars:
//   TUSHARE_TOKEN      optional, for A股/基金历史行情 and basic metadata
//   EODHD_API_TOKEN    optional, for US/HK/global EOD historical data
//   FINNHUB_API_KEY    optional, for news/company news
//
// Recommended deployment:
//   wrangler secret put TUSHARE_TOKEN
//   wrangler secret put EODHD_API_TOKEN
//   wrangler secret put FINNHUB_API_KEY

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tushare-Token, X-EODHD-Token, X-Finnhub-Key"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function iso(d) {
  if (!d) return "";
  const s = String(d);
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return new Date(s).toISOString().slice(0, 10);
}

function round(v) {
  return Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null;
}

function classifySymbol(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return { raw: s, market: "UNKNOWN", type: "unknown", providerSymbol: "" };

  if (/^\d{6}$/.test(s)) {
    if (/^(15|16)\d{4}$/.test(s)) return { raw: s, market: "CN", type: "fund", exchange: "SZ", tsCode: `${s}.SZ`, yahoo: `${s}.SZ` };
    if (/^(50|51|52|56|58)\d{4}$/.test(s)) return { raw: s, market: "CN", type: "fund", exchange: "SH", tsCode: `${s}.SH`, yahoo: `${s}.SS` };
    if (/^(600|601|603|605|688)\d{3}$/.test(s)) return { raw: s, market: "CN", type: "stock", exchange: "SH", tsCode: `${s}.SH`, yahoo: `${s}.SS` };
    if (/^(000|001|002|003|300|301)\d{3}$/.test(s)) return { raw: s, market: "CN", type: "stock", exchange: "SZ", tsCode: `${s}.SZ`, yahoo: `${s}.SZ` };
    if (/^(430|830|831|832|833|834|835|836|837|838|839|870|871|872|873|920)\d{3}$/.test(s)) return { raw: s, market: "CN", type: "stock", exchange: "BJ", tsCode: `${s}.BJ`, yahoo: `${s}.BJ` };
  }

  if (/^\d{4,5}\.HK$/.test(s)) return { raw: s, market: "HK", type: "stock", exchange: "HK", yahoo: s.padStart(7, "0") };
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) {
    const commonEtfs = new Set(["SPY","QQQ","DIA","IWM","VTI","VOO","IVV","XLK","XLF","XLE","SMH","SOXX","ARKK","TLT","GLD","SLV","HYG","LQD"]);
    return { raw: s, market: "US", type: commonEtfs.has(s) ? "fund" : "stock", exchange: "US", yahoo: s };
  }
  return { raw: s, market: "UNKNOWN", type: "unknown", yahoo: s };
}

function inferIndustry(symbol, name = "", type = "") {
  const text = `${symbol} ${name} ${type}`.toLowerCase();
  const cn = `${name} ${type}`;
  if (/etf|fund|lof|指数|基金/i.test(text + cn)) return "基金/ETF";
  if (/semiconductor|chip|memory|hbm|storage|半导体|芯片|存储|集成电路/i.test(text + cn)) return "半导体/存储";
  if (/software|cloud|ai|data|internet|人工智能|软件|云|算力|数据|信息技术|计算机/i.test(text + cn)) return "AI/软件";
  if (/pharma|biotech|medical|health|医药|医疗|生物|疫苗|创新药/i.test(text + cn)) return "医药/生物";
  if (/bank|insurance|broker|银行|保险|券商|证券/i.test(text + cn)) return "金融";
  if (/consumer|liquor|food|白酒|食品|饮料|消费/i.test(text + cn)) return "消费";
  if (/battery|ev|solar|新能源|电池|锂电|光伏|储能|汽车/i.test(text + cn)) return "新能源";
  if (/energy|coal|oil|gas|material|煤炭|石油|有色|钢铁|化工|资源/i.test(text + cn)) return "资源/能源/材料";
  return "行业未知";
}

async function tushare(env, apiName, params = {}, fields = "") {
  if (!env.TUSHARE_TOKEN) throw new Error("TUSHARE_TOKEN not configured");
  const res = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_name: apiName,
      token: env.TUSHARE_TOKEN,
      params,
      fields
    })
  });
  if (!res.ok) throw new Error(`Tushare HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Tushare ${data.code}: ${data.msg || "error"}`);
  const fieldsArr = data.data.fields || [];
  const rows = data.data.items || [];
  return rows.map(row => Object.fromEntries(fieldsArr.map((f, i) => [f, row[i]])));
}

async function getTushareAsset(info, env) {
  const end = ymd(new Date());
  const startDate = new Date(Date.now() - 365 * 4 * 24 * 3600 * 1000);
  const start = ymd(startDate);

  let name = info.raw;
  let industry = "行业未知";
  let prices = [];

  if (info.type === "stock") {
    try {
      const basic = await tushare(env, "stock_basic", { ts_code: info.tsCode }, "ts_code,symbol,name,area,industry,market,list_date");
      if (basic[0]) {
        name = basic[0].name || name;
        industry = basic[0].industry || industry;
      }
    } catch {}

    const rows = await tushare(
      env,
      "daily",
      { ts_code: info.tsCode, start_date: start, end_date: end },
      "ts_code,trade_date,open,high,low,close,vol"
    );
    prices = rows.reverse().map(r => ({
      date: iso(r.trade_date),
      open: round(r.open),
      high: round(r.high),
      low: round(r.low),
      close: round(r.close),
      volume: Math.round(Number(r.vol || 0) * 100)
    }));
  } else {
    try {
      const basic = await tushare(env, "fund_basic", { ts_code: info.tsCode }, "ts_code,name,management,custodian,fund_type,found_date,due_date,list_date");
      if (basic[0]) {
        name = basic[0].name || name;
        industry = basic[0].fund_type || "基金/ETF";
      }
    } catch {}

    let rows = [];
    try {
      rows = await tushare(
        env,
        "fund_daily",
        { ts_code: info.tsCode, start_date: start, end_date: end },
        "ts_code,trade_date,open,high,low,close,vol"
      );
    } catch {
      rows = await tushare(
        env,
        "fund_nav",
        { ts_code: info.tsCode, start_date: start, end_date: end },
        "ts_code,end_date,unit_nav,accum_nav"
      );
    }

    prices = rows.reverse().map(r => {
      const close = r.close ?? r.unit_nav ?? r.accum_nav;
      return {
        date: iso(r.trade_date || r.end_date),
        open: round(r.open ?? close),
        high: round(r.high ?? close),
        low: round(r.low ?? close),
        close: round(close),
        volume: Math.round(Number(r.vol || 0) * 100)
      };
    });
  }

  return { name, industry, prices, provider: "tushare" };
}

async function getEodhdAsset(info, env) {
  if (!env.EODHD_API_TOKEN) throw new Error("EODHD_API_TOKEN not configured");
  let symbol = info.yahoo || info.raw;
  if (info.market === "CN" && info.exchange === "SH") symbol = `${info.raw}.SHG`;
  if (info.market === "CN" && info.exchange === "SZ") symbol = `${info.raw}.SHE`;
  const from = new Date(Date.now() - 365 * 4 * 24 * 3600 * 1000).toISOString().slice(0,10);
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${env.EODHD_API_TOKEN}&fmt=json&period=d&from=${from}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EODHD HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("EODHD empty result");
  const prices = rows.map(r => ({
    date: r.date,
    open: round(r.open),
    high: round(r.high),
    low: round(r.low),
    close: round(r.adjusted_close ?? r.close),
    volume: Math.round(Number(r.volume || 0))
  })).filter(p => p.close);
  return { name: info.raw, industry: inferIndustry(info.raw, info.raw, info.type), prices, provider: "eodhd" };
}

async function getYahooAsset(info) {
  const symbol = info.yahoo || info.raw;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3y&interval=1d&events=history`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error("Yahoo empty result");
  const q = result.indicators.quote[0];
  const timestamps = result.timestamp || [];
  const prices = timestamps.map((ts, i) => {
    const close = q.close && q.close[i];
    if (!close) return null;
    return {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: round(q.open && q.open[i]),
      high: round(q.high && q.high[i]),
      low: round(q.low && q.low[i]),
      close: round(close),
      volume: Math.round((q.volume && q.volume[i]) || 0)
    };
  }).filter(Boolean);
  const meta = result.meta || {};
  return {
    name: meta.shortName || meta.longName || info.raw,
    industry: inferIndustry(info.raw, meta.shortName || meta.longName || "", info.type),
    prices,
    provider: "yahoo-demo"
  };
}

async function getFinnhubNews(symbol, name, env) {
  if (!env.FINNHUB_API_KEY) return [];
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const s = encodeURIComponent(symbol);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${s}&from=${from.toISOString().slice(0,10)}&to=${to.toISOString().slice(0,10)}&token=${env.FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 8).map(n => ({
      title: n.headline || "",
      summary: n.summary || "",
      source: n.source || "Finnhub",
      publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0,10) : ""
    }));
  } catch {
    return [];
  }
}

function sentimentScore(news) {
  if (!Array.isArray(news) || !news.length) return 50;
  const pos = /增长|突破|上调|买入|强劲|创新高|盈利|超预期|合作|订单|利好|beat|upgrade|growth|record|profit|strong|rally/i;
  const neg = /下滑|风险|调查|处罚|亏损|低于预期|减持|暴跌|违约|裁员|利空|miss|downgrade|loss|risk|probe|weak|drop/i;
  let score = 50;
  for (const n of news) {
    const t = `${n.title || ""} ${n.summary || ""}`;
    if (pos.test(t)) score += 8;
    if (neg.test(t)) score -= 8;
  }
  return Math.max(0, Math.min(100, score));
}

function marketModelFromIndices(indices) {
  let vals = [];
  for (const x of indices || []) {
    const m = String(x.value || "").match(/[-+]?\d+(\.\d+)?/);
    if (m) vals.push(Number(m[0]));
  }
  const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  return {
    riskScore: Math.max(20, Math.min(90, 55 + avg * 5)),
    breadthScore: Math.max(20, Math.min(90, 55 + avg * 4)),
    trendScore: Math.max(20, Math.min(90, 55 + avg * 4)),
    sentimentScore: Math.max(20, Math.min(90, 55 + avg * 3))
  };
}


function dataQualityReport(asset) {
  const prices = asset.prices || [];
  const issues = [];
  if (prices.length < 500) issues.push("history_less_than_500_days");
  let bad = 0, zeroVolume = 0, gaps = 0;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (!(Number(p.close) > 0) || !(Number(p.high) >= Number(p.low))) bad++;
    if (Number(p.volume || 0) === 0) zeroVolume++;
    if (i > 0) {
      const d1 = new Date(prices[i - 1].date);
      const d2 = new Date(p.date);
      const gap = (d2 - d1) / (24 * 3600 * 1000);
      if (gap > 10) gaps++;
    }
  }
  if (bad > 0) issues.push("bad_price_rows:" + bad);
  if (zeroVolume > prices.length * 0.2) issues.push("too_many_zero_volume_rows");
  if (gaps > 5) issues.push("too_many_date_gaps:" + gaps);
  const provider = String(asset.provider || "").toLowerCase();
  if (/yahoo-demo|demo|local|sample|synthetic/.test(provider)) issues.push("demo_provider_not_for_production");
  return {
    ok: issues.length === 0,
    productionReady: issues.length === 0,
    issues,
    rows: prices.length,
    provider: asset.provider || "unknown"
  };
}

async function withCache(request, ttlSeconds, producer) {
  if (request.headers.get("X-Tushare-Token") || request.headers.get("X-EODHD-Token") || request.headers.get("X-Finnhub-Key")) {
    return await producer();
  }
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    data.cache = { hit: true, ttlSeconds };
    return json(data);
  }
  const response = await producer();
  try {
    const clone = response.clone();
    const headers = new Headers(clone.headers);
    headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    const cachedResponse = new Response(await clone.text(), { status: clone.status, headers });
    await cache.put(cacheKey, cachedResponse);
  } catch {}
  return response;
}


function envWithHeaderKeys(request, env = {}) {
  const headers = request.headers;
  return {
    ...env,
    TUSHARE_TOKEN: env.TUSHARE_TOKEN || headers.get("X-Tushare-Token") || "",
    EODHD_API_TOKEN: env.EODHD_API_TOKEN || headers.get("X-EODHD-Token") || "",
    FINNHUB_API_KEY: env.FINNHUB_API_KEY || headers.get("X-Finnhub-Key") || "",
    FRONTEND_KEY_MODE: Boolean(headers.get("X-Tushare-Token") || headers.get("X-EODHD-Token") || headers.get("X-Finnhub-Key"))
  };
}

async function handleAsset(request, env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || "";
  const info = classifySymbol(symbol);
  if (!info.raw) return json({ error: "Missing symbol" }, 400);

  let assetData;
  let providerErrors = [];

  if (info.market === "CN" && env.TUSHARE_TOKEN) {
    try { assetData = await getTushareAsset(info, env); }
    catch (e) { providerErrors.push(`tushare: ${e.message}`); }
  }

  if (!assetData && env.EODHD_API_TOKEN) {
    try { assetData = await getEodhdAsset(info, env); }
    catch (e) { providerErrors.push(`eodhd: ${e.message}`); }
  }

  if (!assetData) {
    try { assetData = await getYahooAsset(info); }
    catch (e) { providerErrors.push(`yahoo-demo: ${e.message}`); }
  }

  if (!assetData || !assetData.prices || assetData.prices.length < 60) {
    return json({ error: "No usable price data", providerErrors }, 502);
  }

  const news = await getFinnhubNews(info.raw, assetData.name, env);
  const industry = assetData.industry || inferIndustry(info.raw, assetData.name, info.type);
  const payload = {
    asset: {
      symbol: info.raw,
      providerSymbol: info.tsCode || info.yahoo || info.raw,
      provider: assetData.provider,
      providerErrors,
      market: info.market,
      exchange: info.exchange,
      name: assetData.name || info.raw,
      assetType: info.type === "fund" ? "fund" : "stock",
      sector: industry,
      industry,
      currency: "",
      news,
      sentimentScore: sentimentScore(news),
      prices: assetData.prices
    }
  };
  payload.asset.quality = dataQualityReport(payload.asset);
  return json(payload);
}

async function handleMarket(env) {
  const symbols = [
    ["^IXIC", "纳斯达克"],
    ["000001.SS", "上证指数"],
    ["399006.SZ", "创业板指"]
  ];
  const indices = [];
  for (const [symbol, name] of symbols) {
    try {
      const result = await getYahooAsset({ raw: symbol, yahoo: symbol, type: "index" });
      const prices = result.prices;
      const last = prices[prices.length - 1]?.close;
      const prev = prices[prices.length - 2]?.close;
      const change = prev ? ((last / prev - 1) * 100) : 0;
      indices.push({ name, value: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` });
    } catch {
      indices.push({ name, value: "N/A" });
    }
  }
  const modelMarket = marketModelFromIndices(indices);
  return json({
    updatedAt: new Date().toISOString(),
    subtitle: "V12 代码审查修复版",
    market: {
      mode: "动态后端",
      summary: "后端会优先使用 Tushare/EODHD/Finnhub。未配置对应 Key 时，会降级到演示行情源或返回明确错误。"
    },
    decision: {
      score: Math.round((modelMarket.riskScore + modelMarket.trendScore + modelMarket.sentimentScore) / 3),
      conclusion: "市场数据来自 Worker 后端。真实可用性取决于你配置的数据源 Key 和订阅权限。"
    },
    indices,
    modelMarket,
    homeSignals: [
      { icon: "🔌", title: "真实数据源", text: "Tushare/EODHD/Finnhub 已接入 Worker 模板。" },
      { icon: "🛡️", title: "后端保护", text: "API Key 保存在 Worker Secrets，不暴露到 GitHub Pages 前端。" }
    ],
    tracks: [
      { icon: "💾", name: "半导体/存储", logic: "动态版本建议接入行业成分股涨跌和成交额后计算。", tag: "动态", score: 78, entry: "看模型", risk: "中", rules: [{ text: "以输入具体股票/ETF后的模型结果为准。" }] },
      { icon: "🧠", name: "AI/软件", logic: "结合个股趋势、新闻情绪和市场环境过滤。", tag: "动态", score: 76, entry: "看模型", risk: "中", rules: [{ text: "避免只根据热点追高。" }] }
    ],
    hotThemes: [
      { name: "AI/软件", score: 76 },
      { name: "半导体", score: 74 },
      { name: "高股息", score: 70 },
      { name: "新能源", score: 64 }
    ],
    hotNews: [
      { icon: "📰", title: "新闻源", text: env.FINNHUB_API_KEY ? "Finnhub 新闻已配置。" : "Finnhub 未配置，新闻情绪会降级。", tag: env.FINNHUB_API_KEY ? "已配置" : "待配置" }
    ],
    radar: {
      score: 78,
      discipline: "动态数据只解决输入质量，真实交易仍需要回测门槛、风险阻断和仓位控制。",
      cards: [
        { icon: "📈", title: "行情", text: "Tushare/EODHD/Yahoo demo。" },
        { icon: "📰", title: "新闻", text: "Finnhub company news。" },
        { icon: "🧭", title: "行业", text: "前端模型自动匹配。" },
        { icon: "🛡️", title: "风控", text: "回测不过不出高置信。" }
      ]
    },
    risks: [
      { title: "订阅权限风险", level: "高", text: "不同 API 套餐可用市场和历史深度不同。" },
      { title: "免费源不稳定", level: "高", text: "Yahoo demo 仅作兜底演示，不建议用于生产。" }
    ]
  });
}


async function handleDiagnose(request, env) {
  const assetResp = await handleAsset(request, env);
  const data = await assetResp.clone().json();
  if (!assetResp.ok || data.error) {
    return json({
      ok: false,
      productionReady: false,
      error: data.error || "asset_fetch_failed",
      providerErrors: data.providerErrors || []
    }, assetResp.status);
  }
  const report = dataQualityReport(data.asset);
  return json({
    ok: true,
    symbol: data.asset.symbol,
    name: data.asset.name,
    provider: data.asset.provider,
    market: data.asset.market,
    industry: data.asset.industry,
    rows: report.rows,
    productionReady: report.productionReady,
    issues: report.issues,
    providerErrors: data.asset.providerErrors || [],
    sample: data.asset.prices.slice(-3)
  });
}

async function handleHealth(env) {
  return json({
    ok: true,
    mode: "Finance Pulse V12 Worker",
    now: new Date().toISOString(),
    providers: {
      tushare: Boolean(env.TUSHARE_TOKEN),
      eodhd: Boolean(env.EODHD_API_TOKEN),
      finnhub: Boolean(env.FINNHUB_API_KEY)
    },
    keyMode: env.FRONTEND_KEY_MODE ? "frontend-header-test" : "worker-secrets",
    routes: ["/health", "/market", "/asset?symbol=600845", "/diagnose?symbol=600845", "/news?symbol=AAPL"]
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const runtimeEnv = envWithHeaderKeys(request, env || {});
    try {
      if (url.pathname === "/health") return await handleHealth(runtimeEnv);
      if (url.pathname === "/market") return await withCache(request, 300, () => handleMarket(runtimeEnv));
      if (url.pathname === "/asset") return await withCache(request, 1800, () => handleAsset(request, runtimeEnv));
      if (url.pathname === "/diagnose") return await handleDiagnose(request, runtimeEnv);
      if (url.pathname === "/news") {
        const symbol = url.searchParams.get("symbol") || "";
        const news = await getFinnhubNews(symbol, symbol, runtimeEnv);
        return json({ symbol, news, sentimentScore: sentimentScore(news) });
      }
      return json({ error: "Not Found" }, 404);
    } catch (error) {
      return json({ error: error.message || String(error) }, 500);
    }
  }
};
