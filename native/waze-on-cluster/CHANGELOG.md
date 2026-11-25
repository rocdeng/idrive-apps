# Changelog

## Unreleased

## 0.14.15

风格 1 的限速牌改成和风格 2、3 一样的红圈白底黑字。

限速牌两种都读：整个仪表投屏里红圈白底黑字的牌，以及画面中下部红圈深色底的牌，白底优先，导航和巡航一样。白底牌旁边带“即将抓拍”或距离的按电子眼处理，不算当前限速。

简洁 HUD 从百度地图仪表投屏识别电子眼卡片（“即将抓拍”），读出电子眼限速和距离。限速位置照常显示当前路段限速，电子眼限速画成叠在右上角的小限速牌并闪烁，距离写在旁边；当前限速未知或和电子眼相同时，限速牌本身闪烁。“即将抓拍”或距离行被遮住一行时仍按电子眼处理，不会当成当前路段限速。电子眼限速牌按 HUD 定时器亮灭，不受导航数据更新频率影响。连续两帧读到同一个限速才显示。导航数据暂时停更时，HUD 仍会读取投屏帧，在卡片消失或图像过期后清除电子眼。日志记录电子眼出现和消失。

简洁 HUD 巡航时显示车机给出的当前车道，小号画在路名和红绿灯之间；车机没有车道时不显示。日志记录巡航车道的查询结果。

简洁 HUD 从百度地图仪表投屏识别竖排红绿灯卡片（灯在上、倒计时在下），之前只识别横排。画面里同时有几张红绿灯卡片时，取离画面中心最近的那张，之前这种情况不显示。

## 0.14.14

车机标为公交车道的车道显示灰色公交图标。车机推荐从公交车道走当前转向时，点亮箭头并加公交角标。停车验证新增两个公交车道场景。

## 0.14.13

简洁 HUD 只接受风格 1、2、3。已保存的有效编号直接使用新版同编号的版式，无效值回到风格 1，其他驾驶员设置继续保留。三个风格的主转向箭头统一使用白色箭尖到银蓝灰箭尾的渐变。

## 0.14.12

简洁 HUD 改用硬朗实心转向箭头，按设计稿几何数据绘制。组合车道箭头只点亮要走的那一支，其余方向变暗；非推荐车道，以及箭头里没有当前转向的车道，整个显示为灰色。风格 4 按方案 D 重新排版。

简洁 HUD 默认使用风格 2。加粗风格 2 顶部的当前道路名，加粗并提亮其下方的分隔线。

## 0.14.11

巡航时限速牌、当前路名和红绿灯倒计时按同一条水平中线垂直居中。风格 3 和风格 5 的推荐车道色块两侧各留出几个像素，不再贴住车道虚实线。

## 0.14.10

CarPlay 导航时，如果车机导航接口未提供当前路名，简洁 HUD 使用原厂定位提供的街道名。

修复开始导航时 HUD 闪一下。车机导航接口偶尔返回一次空事件表，现在空表持续 1.5 秒才结束导航。

## 0.14.9

合并原生和应用车道数据时允许同方向转向的位置相差最多 5 米。原生车道缺少所有箭头时继续查询应用端，并记录车机当前车道接口的查询结果。

修复车机当前车道接口的解码，按转向位置筛选车道，并单独记录车机标记为不可信的车道。现在只有车道区段和当前转向位置对得上时才使用，避免显示别的路口的车道；标为不可信的车道单独记录日志。

修复拥堵红线导致的限速漏检。巡航模式在 HUD 安全区底部将限速和放大的当前路名居中排列，红绿灯倒计时放在右侧。

## 0.14.8

新增简洁 HUD 风格 5 和风格 6，采用新的转向箭头，车道宽度随数量调整。

简洁 HUD 在百度地图巡航时从仪表投屏识别红绿灯和限速，沿用所选风格的位置。宝马接口提供当前路名时也会显示。

## 0.14.7

简洁 HUD 的辅助导航查询超时后立即重试。原生桥接清理过期会话时保留仍在等待回复的导航查询。

## 0.14.6

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
