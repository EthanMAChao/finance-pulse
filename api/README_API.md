# Finance Pulse V9 API

## Required secrets

```bash
wrangler secret put TUSHARE_TOKEN
wrangler secret put EODHD_API_TOKEN
wrangler secret put FINNHUB_API_KEY
```

You can configure one, two, or all three.

## Routes

- `/health`
- `/market`
- `/asset?symbol=600845`
- `/asset?symbol=AAPL`
- `/news?symbol=AAPL`

## Frontend settings

Market API:

```text
https://你的worker.workers.dev/market
```

Asset API:

```text
https://你的worker.workers.dev/asset?symbol={symbol}
```


## V10 新增

- `/diagnose?symbol=600845`
- Cloudflare Cache API 缓存：
  - `/market` 默认 300 秒
  - `/asset` 默认 1800 秒
- 数据质量检查：
  - 历史行数
  - 异常价格
  - 成交量为0比例
  - 日期缺口
  - 是否为 demo provider
