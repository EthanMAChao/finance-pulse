# Finance Pulse V12

V3 是高置信动态股票/基金决策模型版本。

核心变化：
- 参考量化回测工具常见做法，加入 walk-forward 回测。
- 参考风险引擎项目常见做法，加入 Profit Factor、最大连续亏损、交易成本和阻断原因。
- 参考现代金融 Dashboard 项目，重构移动端布局，加入迷你走势图、卡片分层和固定底部导航。
- 默认目标胜率为 90%，但它是历史回测筛选门槛，不是未来收益承诺。

部署：
把本包所有文件覆盖到 GitHub Pages 仓库根目录。

真实数据：
GitHub Pages 只能托管前端。真实行情和 AI 摘要需要后端 API。


## V4 新增

- 设置页新增 GitHub Pages 数据路径诊断。
- 支持清理本地缓存，解决旧 Service Worker 导致的页面不更新问题。
- 模型新增数据质量检查。
- 模型新增止损模拟。
- 模型新增趋势过滤强度选择。
- 回测输出保留 Wilson 下界、Profit Factor、最大连续亏损和平均净收益。
- 结果页新增数据质量提示。


## V5 新增

- 决策计算移到浏览器 Web Worker，减少点击“运行决策模型”时的卡顿。
- 新增行业/资产类型自动匹配模型。
- 新增新闻情绪接口字段，模型会读取 `asset.news` 并计算情绪分。
- 新增 Cloudflare Worker 后端模板：`api/finance-worker.js`。
- 前端不再假装静态 JSON 是实时行情。要实现真正动态，请部署 Worker 或自己的后端 API。
- Worker 路由：
  - `/health`
  - `/market`
  - `/asset?symbol=600845`

## 手机端部署建议

GitHub Pages 只放前端文件。  
动态行情、新闻、市场情绪放到 Cloudflare Worker、Vercel、Azure Function 或你自己的后端。

部署 Worker 后，在 App 设置页填写：

市场 API：
`https://你的worker.workers.dev/market`

资产 API：
`https://你的worker.workers.dev/asset?symbol={symbol}`


## V6 修复

- 修复 Web Worker 中 `window` 不存在导致模型无法加载的问题。
- 修复输入未知代码时直接失败的问题。
- 新增本地兜底演示行情：未配置实时 API 时，也能跑通模型流程，但会明确提示“不可用于真实交易”。
- 本地样例新增常见股票/基金代码：600845、688185、159915、510300、512480、588000、600519、300750、002230、000001 等。
- 扩展行业模型到 15 类以上：半导体、AI软件、生物医药、银行保险、券商、消费白酒、新能源、机器人、军工、资源、公用事业、地产、宽基ETF、行业ETF、债券/黄金/QDII、通用稳健。
- 静态 GitHub Pages 下点击刷新会更新本地演示热度，并明确显示“本地演示”；配置 Worker 后才是真动态。


## V7 改善点

- 增加更多本地股票/基金样例，避免输入常见代码后直接失败。
- 增加组合模型评分：趋势模型、回踩模型、防守模型、情绪模型、回测模型。
- 增加模型解释，让用户知道为什么是观察、回避或高置信。
- 增强行业模型覆盖面。
- 保留本地演示警告，避免把样例数据误认为实时行情。
- 交付前运行 Node 测试，并生成 TEST_REPORT.json。


## V12 改善点

- 新增全市场代码路由：A股沪市/深市/北交所、A股ETF/基金、美股/ETF、港股格式。
- 新增 `data/universe.json`，用于维护市场路由和行业关键词。
- 新增市场环境过滤：强势市场、中性市场、弱势市场、风险市场。
- 新增置信等级：A/B/C/D。
- 新增更多本地基金和股票样例。
- 保留历史回测门槛，但明确说明 90% 是历史筛选目标，不是未来保证。
- 增加多轮测试报告，测试覆盖 20+ 个股票/基金样例。


## V12 真实数据源接入

V12 新增 `api/finance-worker.js`，作为真实后端模板。

已接入的后端数据源：

- Tushare：A股股票、A股基金/ETF 历史行情与基础信息。
- EODHD：美股、ETF、港股及全球市场历史行情兜底。
- Finnhub：公司新闻与新闻情绪输入。
- Yahoo chart endpoint：仅作为无 Key 时的演示兜底，不建议生产使用。

### 部署后端

```bash
cd api
npm install -g wrangler
wrangler login
wrangler secret put TUSHARE_TOKEN
wrangler secret put EODHD_API_TOKEN
wrangler secret put FINNHUB_API_KEY
wrangler deploy
```

部署完成后，在 App 设置页填写：

```text
市场 API: https://你的worker.workers.dev/market
资产 API: https://你的worker.workers.dev/asset?symbol={symbol}
```

### 重要边界

V12 只是把真实数据源接入代码写好了。只有你配置真实 API Key 并部署 Worker 后，App 才会真正动态读取行情、新闻和情绪。


## V12 生产可用性改造

V12 的重点不是继续增加模型名，而是把“能否实际应用”做成可检查、可阻断、可部署。

新增内容：

- Worker 新增 `/diagnose?symbol=600845`
- Worker 增加数据质量报告
- Worker 增加 Cloudflare Cache API 缓存
- 前端设置页新增“生产可用性自检”
- 模型新增生产数据检查
- 演示源、本地样例、Yahoo demo 不允许输出“高置信实盘建议”
- 历史行情少于 500 个交易日时阻断高置信
- 缺少 provider / industry / sector 时降低可信度
- 测试报告继续打包

实际应用前，必须：

1. 部署 Worker。
2. 配置 TUSHARE_TOKEN、EODHD_API_TOKEN、FINNHUB_API_KEY。
3. 在设置页填写 Worker 的 `/market` 和 `/asset?symbol={symbol}`。
4. 运行生产自检。
5. A股和美股样例都通过后，再看模型输出。


## V12 前端输入 Key 测试模式

V12 支持在 App 设置页直接输入：

- Tushare Token
- EODHD API Token
- Finnhub API Key

这些 Key 会保存在当前浏览器的 localStorage，并通过请求 Header 发送给 Worker：

- `X-Tushare-Token`
- `X-EODHD-Token`
- `X-Finnhub-Key`

Worker 会优先使用 Worker Secrets；如果 Secrets 没有配置，则读取 Header 里的 Key。

### 安全提醒

这个模式只适合个人测试，不适合公开产品。正式发布仍建议使用：

```bash
npx wrangler secret put TUSHARE_TOKEN
npx wrangler secret put EODHD_API_TOKEN
npx wrangler secret put FINNHUB_API_KEY
```

### 前端 Key 模式下的缓存

V12 在 Header Key 模式下会跳过 Worker Cache，避免不同用户的 Key 请求结果被缓存混用。
