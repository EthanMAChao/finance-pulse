# 资产 API 结构

前端默认读取 data/assets.json。

也可以在设置页填写：

https://your-api.com/asset/{symbol}

返回结构：

{
  "asset": {
    "symbol": "600519",
    "name": "贵州茅台",
    "prices": [
      {
        "date": "2026-05-08",
        "open": 100,
        "high": 105,
        "low": 98,
        "close": 103,
        "volume": 1000000
      }
    ]
  }
}

注意：
- 建议使用复权数据。
- 至少需要约300个交易日。
- 更稳定的3年判断需要约756个交易日。


## V4 数据诊断

设置页会检查：

- ./data/market.json
- ./data/assets.json
- Service Worker 支持情况
- 当前缓存版本

如果 GitHub 仓库中 data 被错误上传成普通文件，而不是文件夹，诊断会显示 market.json 或 assets.json 读取失败。


## V5 动态资产字段

资产 API 推荐返回：

```json
{
  "asset": {
    "symbol": "600845",
    "name": "宝信软件",
    "sector": "AI/软件",
    "industry": "软件服务",
    "assetType": "stock",
    "sentimentScore": 58,
    "news": [
      {
        "title": "相关新闻标题",
        "source": "Google News",
        "publishedAt": "2026-05-09"
      }
    ],
    "prices": []
  }
}
```

前端会自动根据 `sector`、`industry`、`name`、`assetType` 匹配模型。


## V6 行业模型匹配字段

前端会按以下字段自动匹配模型：

- symbol
- name
- sector
- industry
- assetType

如果后端不能返回 `sector` 或 `industry`，模型会退回到代码和名称关键词判断。


## V7 推荐后端返回

为了获得更好的行业模型匹配和情绪判断，建议资产 API 返回：

- symbol
- name
- assetType
- sector
- industry
- news
- sentimentScore
- prices

如果缺少 sector / industry，前端会退回到 symbol 和 name 的关键词匹配。


## V12 全市场路由

前端识别规则：

- 600/601/603/605/688 开头：沪市 A 股
- 000/001/002/003/300/301 开头：深市 A 股
- 50/51/52/56/58 开头：沪市 ETF/基金
- 15/16 开头：深市 ETF/基金
- 1-5位大写字母：美股/ETF
- 0000.HK / 00000.HK：港股

真实生产版本仍应以后端证券主数据为准。


## V12 Worker 返回结构

`GET /asset?symbol=600845` 返回：

```json
{
  "asset": {
    "symbol": "600845",
    "provider": "tushare",
    "market": "CN",
    "exchange": "SH",
    "name": "宝信软件",
    "assetType": "stock",
    "sector": "软件开发",
    "industry": "软件开发",
    "news": [],
    "sentimentScore": 50,
    "prices": [
      {
        "date": "2026-05-08",
        "open": 1,
        "high": 1,
        "low": 1,
        "close": 1,
        "volume": 100
      }
    ]
  }
}
```


## V12 生产自检接口

`GET /diagnose?symbol=600845`

返回：

```json
{
  "ok": true,
  "symbol": "600845",
  "provider": "tushare",
  "rows": 720,
  "productionReady": true,
  "issues": []
}
```

如果 `productionReady` 为 false，前端模型会阻断高置信实盘建议。


## V12 Header Key 模式

前端请求 Worker 时可以携带：

```text
X-Tushare-Token: your-token
X-EODHD-Token: your-token
X-Finnhub-Key: your-key
```

Worker 使用优先级：

1. Worker Secrets
2. Header Key
3. 无 Key 时降级 / 报错 / 使用 demo provider
```
