# Changelog

## Unreleased

普通 HUD 地图支持边缘羽化，默认关闭，可选轻度、中度和强度，并随驾驶员设置保存。

HUD 简洁模式最多每秒提供一帧已解码的 CarPlay 仪表地图给红绿灯识别，沿用已有解码负载。

## 0.10.13

将上游的内存日志和导出改进合入 HUD 简洁版后端。

## 0.10.12

The diagnostic journal is kept in memory and written to storage only around
failures and at shutdown, which greatly reduces writes to the head unit's
storage.

