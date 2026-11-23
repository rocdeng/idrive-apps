# Changelog

## Unreleased

简洁 HUD 分别显示转向距离和全程剩余里程。环岛箭头加出口圈号，补齐分岔和变道箭头，并读取车机提供的到达时刻和当前车道。放大风格 3、4 的动作提示和当前路名，并将这两种风格的整体字号限制在 100% 以内。风格 4 通过车道卡片高亮指示推荐车道。

简洁 HUD 通过宝马导航的独立路名接口显示当前道路。车机未提供路名时继续显示转向和距离。

## 0.14.3

The patch checks the places it edits, not the whole file: a carplay or
aapd of a known version whose file differs only elsewhere, as on another
firmware image, gets the cluster map like any other. Save logs shows which
part of such a file differs.
A patch you removed with Remove patch stays removed after a car software
update too, until you press Patch. A version whose patch fails its own
check is not tried again at each head-unit start.

## 0.14.2

Installing or updating turns the CarPlay and Android Auto map patches on
by itself for every car software version it can check, with no Patch press
and no more `Untested version`; a version new to your car is removed again
by itself if the head unit then fails to start. A patch you removed stays
removed.

## 0.14.1

The Wi-Fi band test waits for each sample to finish, so it passes on a
busy machine too.

## 0.14.0

Android Auto: the cluster map starts at every connection, also after you
leave the car and get back in, without a route planned.
记录简洁 HUD 车道接收、解码和路口匹配结果，便于通过车机日志定位车道缺失。

## 0.13.9

避免旧画面在结束导航后回显。缺少原生车道时允许应用补充同一路口的车道，修复最大字号下的 ETA 裁切以及环岛和目的地箭头。停车验证在车辆移动、驻车制动松开、状态超时或应用断开时退出。

## 0.13.8

新增简洁 HUD 风格 3、4。原生后台解析宝马导航的车道引导，确认与当前转向的位置匹配后显示推荐车道和虚实分隔线。

## 0.13.7

新增第二套驾驶舱 HUD 布局，支持风格切换、独立配置持久化和实时重绘。

## 0.13.6

补充结构化导航剩余时间，支持黄灯注意提示，优化红绿灯识别、车道箭头渐变和 HUD 字号范围。

## 0.13.5

简洁 HUD 改用苹方字库，按 453×200 安全区重新布局导航元素，并支持实时字号配置。

## 0.13.4

新增原生 `vsomeip3` 导航桥接工具 `woc-guidance` 与 `hud_someip_guidance.js`，简洁 HUD 后台服务可直接以 `hmi_5000` 查询 `GuidanceEventList`（`0xfb1b:0x0080`），熄火再点火后无需打开 OAP 应用即可自动恢复显示；补齐 `KM_P_H` 限速单位映射与实车路口距离进度条跟踪；支持在简洁模式下实时调节 HUD 大小与位置。

修复 0.13.3 实际打包仍使用 `453×320` 导致的 18% 纵向拉伸，改为严格 5:3 等比 `454×272`（`x=173, y=60`，保留 `bilinear` 采样），同时使左下角剩余里程/时间避开原厂 `0 km/h` 车速条。

## 0.13.3

简洁 HUD 图层覆盖 iDrive 7 的 453×320 可用区域（居中 `173,80`），逻辑画布按物理区域缩放；启用 `waze-on-cluster-hud.service` 开机自启；为红绿灯取帧与识别补充不刷屏的诊断日志。

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
