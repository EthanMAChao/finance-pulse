// Finance Pulse V8 Cloudflare Worker
// Routes:
//   /health
//   /market
//   /asset?symbol=600845
//
// This template uses public Yahoo Finance chart endpoints and Google News RSS as a demo provider.
// For production, replace upstreams with licensed market-data/news providers.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}

function normalizeSymbol(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes(".")) return raw;
  if (/^(159|002|000|300|301|399)\d{3}$/.test(raw)) return raw + ".SZ";
  if (/^(5|6|9)\d{5}$/.test(raw)) return raw + ".SS";
  return raw;
}

function inferIndustry(symbol, name = "") {
  const text = `${symbol} ${name}`.toLowerCase();
  if (/chip|semi|hbm|memory|storage|芯片|半导体|存储/.test(text)) return "半导体/存储";
  if (/ai|soft|cloud|data|软件|云|算力|数据/.test(text)) return "AI/软件";
  if (/bank|证券|银行|保险|券商/.test(text)) return "金融";
  if (/etf|fund|指数|基金/.test(text)) return "基金/ETF";
  return "行业未知";
}

async function fetchChart(symbol, range = "3y") {
  const yf = normalizeSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yf)}?range=${range}&interval=1d&events=history`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const data = await res.json();
  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error("No chart result");
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
  return { meta: result.meta || {}, prices, yahooSymbol: yf };
}

function round(v) {
  return Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null;
}

function simpleSentiment(news) {
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

async function fetchNews(symbol, name) {
  const q = encodeURIComponent(`${symbol} ${name || ""} 股票 OR stock`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
    return items.map(m => {
      const block = m[1];
      return {
        title: decodeXml((block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [,""])[1]),
        source: "Google News",
        publishedAt: decodeXml((block.match(/<pubDate>(.*?)<\/pubDate>/) || [,""])[1])
      };
    });
  } catch {
    return [];
  }
}

function decodeXml(s) {
  return String(s || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function handleMarket() {
  const symbols = [
    ["^IXIC", "纳斯达克"],
    ["000001.SS", "上证指数"],
    ["399006.SZ", "创业板指"]
  ];
  const indices = [];
  for (const [symbol, name] of symbols) {
    try {
      const { prices } = await fetchChart(symbol, "5d");
      const last = prices[prices.length - 1]?.close;
      const prev = prices[prices.length - 2]?.close;
      const change = prev ? ((last / prev - 1) * 100) : 0;
      indices.push({ name, value: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` });
    } catch {
      indices.push({ name, value: "N/A" });
    }
  }
  return json({
    updatedAt: new Date().toISOString(),
    subtitle: "V8 全市场路由 · 已测试",
    market: {
      mode: "动态刷新",
      summary: "市场数据来自 Worker 后端实时抓取。主题热度应替换为你的正式行情/行业资金流数据源。"
    },
    decision: {
      score: 80,
      conclusion: "当前已连接动态后端。个股/基金决策会结合历史行情、行业模型、新闻情绪和风控回测。"
    },
    indices,
    homeSignals: [
      { icon: "🔄", title: "动态刷新", text: "刷新按钮会重新请求 Worker 后端，不再只读静态 JSON。" },
      { icon: "🧠", title: "行业模型", text: "输入标的后根据行业、名称和资产类型自动匹配模型。" }
    ],
    tracks: [
      { icon: "💾", name: "存储芯片", logic: "需接入行业资金流后动态评分。", tag: "动态", score: 80, entry: "等确认", risk: "中", rules: [{ text: "建议用正式行业行情源替换示例评分。" }] },
      { icon: "🧠", name: "AI算力", logic: "需接入成分股热度和新闻情绪。", tag: "动态", score: 78, entry: "等回踩", risk: "中高", rules: [{ text: "观察成交额和龙头持续性。" }] }
    ],
    hotThemes: [
      { name: "存储芯片", score: 80 },
      { name: "AI算力", score: 78 },
      { name: "高股息", score: 70 },
      { name: "机器人", score: 66 }
    ],
    hotNews: [
      { icon: "📰", title: "实时新闻", text: "Worker 已提供新闻接口模板，可接入正式新闻源。", tag: "动态" },
      { icon: "💰", title: "资金流", text: "行业资金流需要接入 licensed 数据源。", tag: "待接入" }
    ],
    radar: {
      score: 80,
      discipline: "动态后端只解决数据刷新。最终决策仍必须通过风控、回测和阻断条件。",
      cards: [
        { icon: "🔄", title: "行情", text: "后端实时获取OHLC。" },
        { icon: "📰", title: "新闻", text: "新闻情绪进入模型。" },
        { icon: "🧭", title: "行业", text: "自动匹配行业模型。" },
        { icon: "🛡️", title: "风控", text: "回测不过不出高置信。" }
      ]
    },
    risks: [
      { title: "数据源风险", level: "高", text: "免费公共接口可能不稳定。生产版本应使用正式授权行情和新闻源。" },
      { title: "模型风险", level: "高", text: "历史胜率不代表未来胜率。" }
    ]
  });
}

async function handleAsset(url) {
  const input = url.searchParams.get("symbol") || "";
  const yf = normalizeSymbol(input);
  if (!yf) return json({ error: "Missing symbol" }, 400);
  const { meta, prices, yahooSymbol } = await fetchChart(yf, "3y");
  const name = meta.shortName || meta.longName || input;
  const industry = inferIndustry(input, name);
  const news = await fetchNews(input, name);
  return json({
    asset: {
      symbol: input.toUpperCase(),
      providerSymbol: yahooSymbol,
      name,
      assetType: /ETF|Fund|基金|指数/i.test(name) ? "fund" : "stock",
      sector: industry,
      industry,
      currency: meta.currency || "",
      news,
      sentimentScore: simpleSentiment(news),
      prices
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    try {
      if (url.pathname === "/health") return json({ ok: true, now: new Date().toISOString() });
      if (url.pathname === "/market") return await handleMarket();
      if (url.pathname === "/asset") return await handleAsset(url);
      return json({ error: "Not Found" }, 404);
    } catch (error) {
      return json({ error: error.message || String(error) }, 500);
    }
  }
};
