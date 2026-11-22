# Changelog

## Unreleased

## 0.13.2

新增原生后台服务 `waze-on-cluster-hud`（`/dev/shm/waze-on-cluster/hud.sock`），将简洁 HUD 的字库、渲染、停车验证、红绿灯识别和 `cluster-render` 直连迁入原生后端，并补齐 `hud-simple.log` 与 `journalctl` 日志采集。

商店使用「R·地图仪表盘后端」，便于区分配套应用和上游包。

## 0.13.1

同步上游 0.13.0。CarPlay 和 Android Auto 改用内存补丁，旧版本升级时恢复原厂文件。保留简洁 HUD 的红绿灯取帧和普通 HUD 的边缘羽化。

## 0.13.0

Android Auto's cluster map patch is applied in aapd's memory each time it
starts, as CarPlay's is: `/usr/bin/aapd` and `/etc/aapd.conf` stay as they
ship. Updating from an earlier version puts the original files back and
keeps the map, your zoom and turn-card settings included.

## 0.12.1

The rollback tests treat 0.11.0 and later as releases that patch CarPlay in
memory.
A map shown inside another app's scene on the cluster appears as soon as
its picture is ready, including when that app shows it again while the map
is still.

## 0.12.0

While another app's content on the cluster asks for upload bandwidth
(cluster-render's `others_fps`), the map runs at the lower frame rate it
asks for and makes no more pictures than that, and goes back to its own
rate when that app hides its content or exits.

## 0.11.0

CarPlay's cluster map patch is applied in CarPlay's memory each time it
starts, and `/usr/bin/carplay` stays as it ships: no write of the system
partition to patch, remove or recover it. Updating from an earlier version
puts the original file back and keeps the map, with at most one head-unit
restart; where CarPlay already runs the earlier patch, none.

## 0.10.14

普通 HUD 地图支持边缘羽化，默认关闭，可选轻度、中度和强度，并随驾驶员设置保存。

HUD 简洁模式最多每秒提供一帧已解码的 CarPlay 仪表地图给红绿灯识别，沿用已有解码负载。

## 0.10.13

将上游的内存日志和导出改进合入 HUD 简洁版后端。

## 0.10.12

The diagnostic journal is kept in memory and written to storage only around
failures and at shutdown, which greatly reduces writes to the head unit's
storage.
