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
