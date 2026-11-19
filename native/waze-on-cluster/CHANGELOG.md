# Changelog

## Unreleased

## 0.10.13

将上游的内存日志和导出改进合入 HUD 简洁版后端。

## 0.10.12

The diagnostic journal is kept in memory and written to storage only around
failures and at shutdown, which greatly reduces writes to the head unit's
storage.

