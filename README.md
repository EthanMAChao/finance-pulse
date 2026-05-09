# Finance Pulse V5

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
