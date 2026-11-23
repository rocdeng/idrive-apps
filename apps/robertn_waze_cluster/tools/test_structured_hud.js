'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs'), net = require('net'), path = require('path'), vm = require('vm');
const { StructuredHud } = require('../src/structured_hud.js');
const { GuidanceReader, IFACE, INSTANCE, VIEW } = require('../src/guidance_reader.js');
const nav = require('../src/hud_navigation.js');
const { HudEngine, startDaemon } = require('../../../native/waze-on-cluster/hud/hud_daemon.js');
const renderer = require('../../../native/waze-on-cluster/hud/hud_renderer.js');
const Font = require('../../../native/waze-on-cluster/hud/hud_font.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 100; i++) { if (check()) return; await sleep(10); }
    throw new Error('等待状态超时');
}
const reply = { viewContent: [{ eventsInView: [{ intersection: { direction: 'LEFT',
    formattedDistance: { distance: '147', unit: { name: 'METER' } },
    description: { text: '前方左转' }, distanceToDestination: 3153 } }] }] };

async function main() {
    const laneFont = new Font(require('../../../native/waze-on-cluster/hud/hud_font_data.js'));
    const lanes = [{ directions: ['left'], recommended: true },
        { directions: ['left'], recommended: true, leftBoundary: 'dashed' },
        { directions: ['straight'], leftBoundary: 'solid' }, { directions: ['right'] }];
    const pixels = renderer.render({ state: 'navigating', lanes }, laneFont);
    const at = (x, y) => Array.from(pixels.slice((y * 800 + x) * 4, (y * 800 + x) * 4 + 4));
    assert(at(558, 335)[3] > 0, '实线保持连续');
    assert(at(438, 323)[3] > 0, '推荐车道也按数据画虚线');
    assert.strictEqual(at(438, 335)[3], 0, '虚线分段间留空');
    assert.strictEqual(at(678, 335)[3], 0, '未知边界不画线');
    assert.deepStrictEqual(at(371, 403), [84, 245, 165, 255], '推荐车道显示绿色底线');
    assert.strictEqual(at(322, 311)[3], 0, '推荐车道保持透明底');
    assert.strictEqual(nav.snapshot({ lanes: [{ directions: [] }, lanes[2]] }).lanes.length, 2, '无箭头车道保留边界位置');
    console.log('通过：最新画布推荐绿线、透明底、实际虚实边界与未知边界隐藏');
    for (const [style, x, y] of [[3, 192, 78], [4, 215, 74]]) {
        const view = { state: 'navigating', lanes: lanes.map(lane => ({ ...lane, recommended: false })) };
        const alpha = (frame, px, py) => frame[(Math.floor((py + 36) * 480 / 272) * 800 +
            Math.ceil((px + 0.5) * 800 / 454)) * 4 + 3];
        for (const boundary of ['solid', 'dashed', null]) {
            view.lanes[1].leftBoundary = boundary;
            const frame = renderer.render(view, laneFont, null, 100, style);
            assert.strictEqual(alpha(frame, x, y + 2) > 0, boundary !== null, '已知车道边界可见');
            assert.strictEqual(alpha(frame, x, y + 9) > 0, boundary === 'solid', '仅实线连续');
        }
    }
    const fourCards = renderer.render({ state: 'navigating', lanes: [0, 1, 2, 3].map((i) => ({
        directions: ['straight'], recommended: i >= 2
    })) }, laneFont, null, 100, 4);
    const fourthHighlight = (Math.floor((116 + 36) * 480 / 272) * 800 + Math.floor((339 + 0.5) * 800 / 454)) * 4;
    assert.deepStrictEqual(Array.from(fourCards.slice(fourthHighlight, fourthHighlight + 4)), [74, 232, 156, 255],
        '风格 4 仍保留推荐车道绿线');
    for (let y = 295; y < 328; y++) {
        const textArea = fourCards.slice((y * 800 + 296) * 4, (y + 1) * 800 * 4);
        assert(!textArea.some(Boolean), '风格 4 不再绘制推荐车道文字');
    }
    const stockConfig = { minimumUpdateIntervalMs: 500, viewport: { maxElementCount: 1,
        includedTypes: ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS'] } };
    const calls = [];
    let down = 0, query = () => Promise.resolve(reply);
    const proxy = { init: () => Promise.resolve(), waitUntilAvailable: () => Promise.resolve(),
        shutdown: () => down++, _someIpProxy: { callMethod: (name, args) => {
            calls.push({ name, args });
            return name === 'getViewConfig' ? Promise.resolve({ viewConfig: stockConfig }) : query(args);
        } } };
    const reader = new GuidanceReader({ buildTypedProxy: (iface, instance) => {
        assert.strictEqual(iface, IFACE); assert.strictEqual(instance, INSTANCE);
        return Promise.resolve(proxy);
    } }, { timeoutMs: 30 });
    assert.deepStrictEqual(await reader.read(), reply);
    await reader.read();
    assert.deepStrictEqual(calls.map((c) => c.name), ['getViewConfig', 'queryContent', 'queryContent']);
    assert.strictEqual(calls[0].args.viewId, VIEW);
    const queryConfig = calls[1].args.viewConfigs[0];
    assert.deepStrictEqual(queryConfig.viewport.includedTypes,
        ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS', 'INCLUDE_LANE_GUIDINGS', 'INCLUDE_SPEED_LIMIT_ASSIST']);
    assert.strictEqual(queryConfig.viewport.maxElementCount, 6, '原厂只有一条事件时也要给转向和车道预留位置');
    assert.strictEqual(stockConfig.viewport.maxElementCount, 1);
    assert.strictEqual(calls[2].args.viewConfigs[0], queryConfig, '复用补齐车道事件的查询配置');
    assert(!stockConfig.viewport.includedTypes.includes('INCLUDE_LANE_GUIDINGS'), '不修改原厂视图配置');
    assert.strictEqual(nav.fromBmw(reply).distanceM, 147);
    ['UTURN_LEFT', 'UTURN_RIGHT'].forEach((name) => {
        const state = nav.fromBmw({ events: [{ intersection: { direction: { name } } }] });
        assert.strictEqual(state.direction, 'uturn', `${name} 应归一化为掉头`);
        const frame = renderer.render(state, laneFont);
        let alpha = 0;
        for (let i = 0; i < frame.length; i += 4) alpha += frame[i + 3];
        assert(alpha > 0, `${name} 应绘制掉头箭头`);
    });
    ['STRAIGHT_ON', 'HARD_LEFT', 'HARD_RIGHT'].forEach((name) => {
        const state = nav.fromBmw({ events: [{ intersection: { direction: { name } } }] });
        assert(state.direction, `${name} 应识别为可绘制方向`);
    });
    const distanceIn = (unit, distance) => nav.fromBmw({ events: [{ intersection: {
        formattedDistance: { unit: { name: unit }, distance }
    } }] }).distanceM;
    const units = { METER: 1, KM: 1000, KILOMETER: 1000, MILE_US: 1609.344, MILE_UK: 1609.344,
        YARD: 0.9144, FEET: 0.3048 };
    Object.keys(units).forEach(unit => assert.strictEqual(distanceIn(unit, '1'), units[unit], unit));
    assert.strictEqual(distanceIn('KM', '1.2'), 1200);
    assert.strictEqual(distanceIn('NONE', '1'), null);
    assert.strictEqual(distanceIn('KM', '—'), null);
    const laneReply = { viewContent: [{ eventsInView: [
        { intersection: { direction: { name: 'RIGHT' }, formattedDistance: { distance: '250', unit: { name: 'METER' } },
            description: { text: '科技园路' }, distanceToDestination: 7400 } },
        { destinationManeuver: { travelTime: 1080 } },
        { laneGuiding: {
            distanceToDestination: 7400,
            lanes: [
                { directionToFollow: { name: 'NONE' }, otherDirections: [{ name: 'LEFT' }], isHighlighted: false },
                { directionToFollow: { name: 'NONE' }, otherDirections: [{ name: 'STRAIGHT_ON' }], isHighlighted: false },
                { directionToFollow: { name: 'RIGHT' }, otherDirections: [{ name: 'STRAIGHT_ON' }], isHighlighted: true },
                { directionsToFollow: [{ name: 'RIGHT' }], otherDirections: [], isHighlighted: true }
            ],
            laneMarkers: [{ name: 'SOLID' }, { name: 'DASHED' }, { name: 'SOLID' }, { name: 'DASHED' }, { name: 'SOLID' }],
            recommendedCarPositionLaneIndex: 2
        } }
    ] }] };
    const laneState = nav.fromBmw(laneReply);
    assert.strictEqual(laneState.remainingTimeS, 1080, '同时含 destinationManeuver 与 laneGuiding 时应保留剩余时间');
    assert.deepStrictEqual(laneState.lanes, [
        { directions: ['left'], recommended: false, leftBoundary: null },
        { directions: ['straight'], recommended: false, leftBoundary: 'dashed' },
        { directions: ['right', 'straight'], recommended: true, leftBoundary: 'solid' },
        { directions: ['right'], recommended: true, leftBoundary: 'dashed' }
    ], 'fromBmw 应解析 laneGuiding 车道方向、推荐高亮与虚实分隔线');
    const [turn, destination, currentLanes] = laneReply.viewContent[0].eventsInView;
    const laterLanes = { laneGuiding: { ...currentLanes.laneGuiding, distanceToDestination: 7150 } };
    const uncertain = { laneGuiding: { ...currentLanes.laneGuiding, unreliable: true } };
    for (const adapter of [nav, require('../../../native/waze-on-cluster/hud/hud_navigation.js')]) {
        const laneInfo = {};
        assert.deepStrictEqual(adapter.fromBmw({ events: [turn, laterLanes, destination, currentLanes] }, laneInfo).lanes,
            laneState.lanes, '选当前路口车道，忽略后一路口');
        assert.deepStrictEqual(laneInfo, { received: 2, eligible: 2, matched: 1, closestGapM: 0 });
        const mismatch = {};
        assert.deepStrictEqual(adapter.fromBmw({ events: [turn, laterLanes] }, mismatch).lanes, []);
        assert.deepStrictEqual(mismatch, { received: 1, eligible: 1, matched: 0, closestGapM: 250 });
        for (const entries of [[laterLanes], [uncertain], [currentLanes, currentLanes],
            [{ laneGuiding: { ...currentLanes.laneGuiding, distanceToDestination: undefined } }]]) {
            assert.deepStrictEqual(adapter.fromBmw({ events: [turn, ...entries] }).lanes, [],
                '错配、不可信、重复或缺少位置时隐藏车道');
        }
    }
    query = ({ viewConfigs }) => {
        const slots = viewConfigs[0].viewport.maxElementCount;
        return Promise.resolve({ viewContent: [{ eventsInView: [turn, currentLanes, destination].slice(0, slots) }] });
    };
    assert.deepStrictEqual(nav.fromBmw(await reader.read()).lanes, laneState.lanes,
        '原厂单事件视图仍能查到与转向关联的车道');
    query = () => Promise.resolve({ GuidanceEventListError: { name: 'INVALID_VIEW_PARAMS' }, viewContent: [] });
    let queryError;
    try { await reader.read(); } catch (error) { queryError = error; }
    assert(queryError && /INVALID_VIEW_PARAMS/.test(queryError.message), '查询失败不能当成空的导航数据');
    query = () => new Promise(() => {});
    let failed = false;
    try { await reader.read(); } catch (error) { failed = /timed out/.test(error.message); }
    assert(failed, '超时读取必须失败');
    reader.stop();
    assert.strictEqual(down, 1);
    console.log('通过：导航代理只读查询、视图配置复用、超时和释放');

    const control = new EventEmitter();
    control.renderStatus = { hud: 0, cluster: 1 };
    let connected = true;
    control.render = { connected: () => connected, send: () => { throw new Error('简洁绘制器不持有视频控制连接'); } };
    control.patch = { path: '/tmp/unused-woc-simple.sock' };
    let reads = 0, stops = 0, input = () => Promise.resolve(reply);
    const outputs = [], publications = [];
    const engine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        outputFactory: (keepShown, onState) => {
            const output = { closed: false, setKeepShown: (keep) => { output.keepShown = keep; },
                report: onState,
                update: (frame, visible) => publications.push({ frame: visible ? Buffer.from(frame) : frame, visible }),
                close: () => { output.closed = true; } };
            outputs.push(output); return output;
        }
    });
    engine.tick();
    assert.strictEqual(engine.font, null, '未启用时不加载字体');
    engine.settings({ hud_simple: 1, hud: 0 });
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    await until(() => !engine.navBusy);
    assert.strictEqual(engine.font, null, '等待导航时仍未加载字体');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && publications.length === 1);
    assert(engine.font, '首个有效引导绘制时加载字体');
    assert.strictEqual(engine.state, 'unavailable', '提交图像后，仍须等待实际图层状态');
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'showing');
    assert(publications[0].visible);
    engine.settings({ hud_simple: 1, hud: 0, hud_keep_shown: 1 });
    assert.strictEqual(outputs[0].keepShown, true, '沿用普通 HUD 的弹窗让位设置');
    const expectedFirst = Object.assign({}, nav.fromBmw(reply), { initialDistanceM: 147 });
    assert.deepStrictEqual(publications[0].frame, Buffer.from(renderer.render(expectedFirst, new Font(require('../../../native/waze-on-cluster/hud/hud_font_data.js')))));
    const firstFrame = engine.frame;
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy);
    assert.strictEqual(publications.length, 1, '重复完整状态不重复发送像素');
    assert.strictEqual(engine.frame, firstFrame, '重复完整状态不重新分配帧');
    const halfReply = { viewContent: [{ eventsInView: [{ intersection: { direction: 'LEFT',
        formattedDistance: { distance: '73', unit: { name: 'METER' } },
        description: { text: '前方左转' }, distanceToDestination: 3079 } }] }] };
    engine.handleNav(nav.fromBmw(halfReply));
    await until(() => !engine.navBusy && publications.length === 2);
    const barPx = Array.from(publications[1].frame.slice((257 * 800 + 424) * 4, (257 * 800 + 424) * 4 + 4));
    assert(barPx[0] >= 250 && barPx[1] >= 250 && barPx[2] >= 250 && barPx[3] === 255, '同路口距离递减时进度条应推进显示白色填充');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && publications.length === 3);
    outputs[0].report('unavailable');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy);
    assert.strictEqual(engine.state, 'unavailable', '相同导航数据不能掩盖输出断连');
    outputs[0].report('showing');
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    assert.strictEqual(engine.state, 'waiting');
    assert.deepStrictEqual(publications[publications.length - 1], { frame: null, visible: false }, '导航结束只更新可见性');
    const hiddenPublications = publications.length;
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    assert.strictEqual(publications.length, hiddenPublications, '重复等待不再提交隐藏帧');
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'waiting', '结束导航后的迟到回调不能恢复显示状态');
    engine.handleNavError('navigation unavailable');
    assert.strictEqual(engine.state, 'unavailable');
    engine.settings({ hud_simple: 0, hud: 0 });
    assert(outputs[0].closed);
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'off', '旧输出不能在关闭后改写状态');
    engine.settings({ hud_simple: 1, hud: 1 });
    assert.strictEqual(engine.enabled, false, '视频模式配置开启时不输出简洁导航');
    engine.settings({ hud_simple: 1, hud: 0 });
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && outputs.length === 2);
    outputs[1].report('showing');
    assert.strictEqual(engine.state, 'showing');
    engine.lastNav = Date.now() - 6000;
    engine.tick();
    assert.strictEqual(engine.state, 'unavailable', '断流超过 5 秒清除旧引导');
    engine.settings(null);
    assert.strictEqual(engine.state, 'off', '后台模式配置连接断开后释放旧图层');
    engine.stop();
    console.log('通过：原生 HudEngine 实际像素、去重、进度条、结束清屏、读取失败、模式切换和断流清屏');

    /* 原生 SOME/IP Utf8D BOM/无BOM 编码与可用状态回调通知 */
    const someip = require('../../../native/waze-on-cluster/hud/hud_someip_guidance.js');
    const bomBuf = someip.encodeUtf8D('HUD.RB.Main', true);
    const rawBuf = someip.encodeUtf8D('HUD.RB.Main', false);
    assert.strictEqual(bomBuf.readUInt32BE(0), 3 + 11 + 1, '带 BOM Utf8D 长度应包含 3 字节 BOM 和结尾 NUL');
    assert.deepStrictEqual(Array.from(bomBuf.slice(4, 7)), [0xef, 0xbb, 0xbf]);
    assert.strictEqual(rawBuf.readUInt32BE(0), 11 + 1, '无 BOM Utf8D 长度应为字符串 + NUL');
    assert.strictEqual(rawBuf.slice(4, 15).toString('utf8'), 'HUD.RB.Main');
    const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v, 0); return b; };
    const f64be = (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v, 0); return b; };
    const subWrap = (parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32be(body.length), body]); };
    const lane0 = Buffer.concat([u32be(0), subWrap([u32be(1)]), Buffer.from([0]), u32be(0), subWrap([])]);
    const lane1 = Buffer.concat([u32be(5), subWrap([u32be(1)]), Buffer.from([1]), u32be(0), subWrap([u32be(5)])]);
    const lgBody = Buffer.concat([
        Buffer.alloc(8), f64be(7400), Buffer.from([0]),
        u32be(8), u32be(3), Buffer.alloc(8),
        f64be(200),
        subWrap([lane0, lane1]),
        subWrap([u32be(2)]),
        Buffer.from([1, 50])
    ]);
    const viewStruct = Buffer.concat([
        u32be(1), Buffer.from([1]), u32be(0), u32be(1),
        subWrap([u32be(lgBody.length), u32be(15), lgBody])
    ]);
    const lgDecoded = someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf, viewStruct])]));
    assert.strictEqual(lgDecoded.error, 0);
    assert.strictEqual(lgDecoded.events.length, 1);
    assert.strictEqual(lgDecoded.events[0].type, 'laneGuiding');
    assert.strictEqual(lgDecoded.events[0].value.unreliable, false);
    const badBody = lgBody.slice(0, lgBody.length - 1);
    const mixedView = Buffer.concat([viewStruct.slice(0, 13), subWrap([
        u32be(badBody.length), u32be(15), badBody,
        u32be(lgBody.length), u32be(15), lgBody
    ])]);
    const mixed = someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf, mixedView])]));
    const maneuverBody = (position, meters, seconds, tail) => Buffer.concat([
        Buffer.alloc(8), f64be(position), Buffer.from([0]), u32be(8), u32be(3), Buffer.alloc(8),
        someip.encodeUtf8D(String(meters)), u32be(4), f64be(1), subWrap([]), u32be(seconds), u32be(0),
        subWrap([]), subWrap([]), u32be(0), u32be(4), u32be(1), u32be(0), u32be(0), u32be(0), tail
    ]);
    const event = (type, body) => Buffer.concat([u32be(body.length), u32be(type), body]);
    const nil = Buffer.concat([u32be(4), u32be(1), u32be(0)]);
    const ringBody = maneuverBody(3370, 147, 20, Buffer.concat([Buffer.from([0, 180, 3]), u32be(2), nil]));
    const upcoming = (type, body) => someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf,
        viewStruct.slice(0, 13), subWrap([event(17, maneuverBody(0, 3517, 465,
            Buffer.concat([u32be(2), Buffer.from([1]), u32be(0), nil, nil, nil]))), event(type, body)])]),
        f64be(3517), f64be(3517), f64be(183), f64be(183)]));
    const roundabout = nav.fromBmw(upcoming(18, ringBody));
    assert.strictEqual(roundabout.distanceM, 147, '目的地在列表最前也不能占用转向距离');
    assert.strictEqual(roundabout.remainingDistanceM, 3517, '全程距离读取独立字段');
    assert.strictEqual(roundabout.maneuverPositionM, 3370, '保留事件位置供车道匹配');
    assert.strictEqual(roundabout.remainingTimeS, 465, '全程剩余时间取终点事件');
    assert.strictEqual(roundabout.roundaboutExit, 3);
    assert.strictEqual(nav.fromBmw(upcoming(5, ringBody)).roundaboutExit, 3, '兼容正序环岛编号');
    assert.strictEqual(nav.fromBmw(upcoming(19, maneuverBody(3370, 147, 20, Buffer.concat([u32be(7), nil, u32be(0)])))).direction, 'slight_right');
    assert.strictEqual(nav.fromBmw(upcoming(11, maneuverBody(3370, 147, 20, u32be(1)))).direction, 'merge_left');
    assert.strictEqual(nav.fromBmw({ events: [{ intersection: { travelTime: 20 } }] }).remainingTimeS, null,
        '下一路口的用时不能冒充全程剩余时间');
    assert.strictEqual(nav.fromBmw({ guidanceState: 'CALCULATING_ROUTE' }).state, 'rerouting');
    assert.strictEqual(nav.fromBmw({ guidanceState: 'INACTIVE', currentDistances: { carDistanceToFinalDestination: 0 },
        events: [{ destinationManeuver: { isCheckeredFlag: true, formattedDistance: { distance: '0', unit: 'METER' } } }] }).state, 'arrived');
    const limit = { type: 'speedLimitAssist', value: { distanceToDestination: 3517,
        formattedDistance: { distance: '0', unit: 'METER' }, speedLimitAssistInfo: { value: {
            reason: { speedLimitInfo: { speedLimit: 40, speedUnit: 'MI_P_H_US' } }
        } } } };
    assert.strictEqual(nav.fromBmw({ currentDistances: { carDistanceToFinalDestination: 3517 },
        events: [{ intersection: { direction: 'LEFT' } }, limit] }).speedLimitKmh, 64);
    assert.strictEqual(nav.fromBmw({ currentDistances: { carDistanceToFinalDestination: 3617 },
        events: [{ intersection: { direction: 'LEFT' } }, limit] }).speedLimitKmh, null, '前方限速不能冒充当前位置限速');
    const noExit = { ...roundabout, roundaboutExit: null };
    const alternateExit = { ...roundabout, roundaboutExit: 2 };
    for (let style = 1; style <= 4; style++) {
        const frame = Buffer.from(renderer.render(roundabout, laneFont, null, 0, style));
        assert(!frame.equals(Buffer.from(renderer.render(noExit, laneFont, null, 0, style))), '环岛有有效出口时显示圈号');
        assert(!frame.equals(Buffer.from(renderer.render(alternateExit, laneFont, null, 0, style))), '圈号数字随出口变化');
        assert(Buffer.from(renderer.render({ ...roundabout, direction: 'left' }, laneFont, null, 0, style))
            .equals(Buffer.from(renderer.render({ ...noExit, direction: 'left' }, laneFont, null, 0, style))), '普通转向不显示环岛圈号');
    }

    assert.strictEqual(mixed.laneRejected, 1, '计数损坏的候选事件，且仍解码后续事件');
    assert.deepStrictEqual(mixed.events, lgDecoded.events);
    assert.deepStrictEqual(nav.fromBmw({ events: [{ type: 'intersection', value: { direction: 'RIGHT', distanceToDestination: 7400 } }, lgDecoded.events[0]] }).lanes, [
        { directions: ['straight'], recommended: false, leftBoundary: null },
        { directions: ['right', 'straight'], recommended: true, leftBoundary: 'dashed' }
    ], '原生 SOME/IP laneGuiding 二进制解码应与 fromBmw 无缝衔接');
    const quiet = { info() {}, warn() {}, error() {} };
    const roadReader = new someip.NativeGuidanceReader({ log: quiet });
    const roadRequests = [];
    roadReader.child = { stdin: { write: (line) => roadRequests.push(line) } };
    const roadText = someip.encodeUtf8D('情侣北路');
    const roadWire = subWrap([u32be(roadText.length), u32be(3), roadText]).toString('hex');
    assert.strictEqual(roadReader.currentRoad(), '', '路名服务不可用时不查询');
    assert.deepStrictEqual(roadRequests, []);
    roadReader._onLine('road-avail 1');
    assert.strictEqual(roadReader.currentRoad(), '', '等待路名时转向可继续显示');
    roadReader.currentRoad();
    assert.deepStrictEqual(roadRequests, ['1 road -\n'], '同一时刻只请求一次当前路名');
    roadReader._onLine('reply 1 0001 00 ' + roadWire);
    assert.strictEqual(roadReader.currentRoad(), '情侣北路');
    let finishTraffic;
    const staleFrames = [];
    const staleEngine = new HudEngine({ nativeGuidance: null, log: quiet,
        traffic: { reset() {}, read: () => new Promise(resolve => { finishTraffic = resolve; }) },
        outputFactory: () => ({ update: (_, visible) => staleFrames.push(visible), close() {} }) });
    staleEngine.settings({ hud_simple: 1, hud: 0 });
    staleEngine.handleNav(laneState);
    await until(() => !!finishTraffic);
    staleEngine.handleNav({ state: 'inactive' });
    finishTraffic(null);
    await until(() => !staleEngine.navBusy);
    assert.deepStrictEqual(staleFrames, [], '导航结束后旧画面不能重新出现');
    staleEngine.stop();

    let nativeWithoutLanes = { events: [laneReply.viewContent[0].eventsInView[0]] };
    const laneEngine = new HudEngine({ log: quiet,
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { available: true, supported: () => true, read: () => Promise.resolve(nativeWithoutLanes),
            currentRoad: () => roadReader.currentRoad(), stop() {} },
        outputFactory: () => ({ update() {}, close() {} }) });
    laneEngine.settings({ hud_simple: 1, hud: 0 });
    laneEngine.handleOapNav(laneState);
    await until(() => !laneEngine.navBusy);
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert(laneEngine.status().native_needs_lanes, '原生缺少车道时继续请求 OAP');
    assert.deepStrictEqual(laneEngine.lastState.lanes, laneState.lanes, '保留同一路口的车道和虚实线');
    assert.strictEqual(laneEngine.lastState.currentRoad, '情侣北路', '独立路名要进入实际 HUD 渲染状态');
    assert.strictEqual(laneEngine.lastState.instruction, '科技园路', '当前路名和下个转向描述各自显示');
    roadReader.roadNext = 0;
    roadReader.currentRoad();
    roadReader._onLine('reply 2 0001 00 00000000');
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert.strictEqual(laneEngine.lastState.currentRoad, '', '车机返回空路名后清除旧值');
    assert.strictEqual(laneEngine.lastState.instruction, '科技园路', '路名缺失不影响转向描述');
    roadReader.roadNext = 0;
    roadReader.currentRoad();
    roadReader._onLine('road-avail 0');
    roadReader._onLine('reply 3 0001 00 ' + roadWire);
    assert.strictEqual(roadReader.currentRoad(), '', '断开后忽略迟到的旧路名');
    roadReader._onLine('road-avail 1');
    assert.strictEqual(roadReader.guidanceField('destination'), null);
    assert(roadRequests[roadRequests.length - 1].endsWith(' destination -\n'));
    const destWire = Buffer.concat([u32be(0), u32be(0), u32be(465), Buffer.alloc(5),
        Buffer.from([0, 0x07, 0xea, 11, 23, 0, 19, 57, 43]), Buffer.alloc(8)]);
    const replyToField = (method, payload) => {
        const id = roadRequests[roadRequests.length - 1].split(' ')[0];
        roadReader._onLine('reply ' + id + ' ' + method + ' 00 ' + payload.toString('hex'));
    };
    replyToField('0005', destWire);
    assert.deepStrictEqual(roadReader.guidanceField('destination'), { remainingTimeS: 465, arrivalClock: '19:57' });
    roadReader.guidanceField('lanes', 'junction');
    const row = Buffer.concat([subWrap([lane0, lane1]), subWrap([u32be(2)]), Buffer.from([1, 50])]);
    replyToField('0019', Buffer.concat([subWrap([row]), Buffer.from([1])]));
    assert.strictEqual(nav.bmwLanes(roadReader.guidanceField('lanes', 'junction')).length, 2);
    assert.strictEqual(roadReader.guidanceField('lanes', 'next-junction'), null, '不能复用前一路口的车道');
    replyToField('0019', Buffer.concat([subWrap([row, row]), Buffer.from([1])]));
    assert.strictEqual(roadReader.guidanceField('lanes', 'next-junction'), null, '多行当前车道不猜对应路口');
    roadReader._onLine('road-avail 0');
    assert.strictEqual(roadReader.guidanceField('destination'), null, '断连清除旧 ETA');
    nativeWithoutLanes = { events: [{ intersection: { direction: 'RIGHT', distanceToDestination: 7000 } }] };
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert.deepStrictEqual(laneEngine.lastState.lanes, [], '切换路口立即清除旧车道');
    laneEngine.stop();
    for (const [type, direction] of [['roundabout', 'roundabout'], ['destinationManeuver', 'arrive']]) {
        const state = nav.fromBmw({ events: [{ type, value: { direction: direction.toUpperCase() } }] });
        assert.strictEqual(state.state, 'navigating');
        assert.strictEqual(state.direction, direction);
    }
    for (const style of [1, 2]) {
        const frame = renderer.render(laneState, laneFont, null, 150, style);
        for (let i = 417 * 800 * 4 + 3; i < frame.length; i += 4) {
            assert.strictEqual(frame[i], 0, '最大字号 ETA 留在 453×200 安全区内');
        }
    }
    const availEvents = [];
    const nativeReader = new someip.NativeGuidanceReader({
        bin: '/nonexistent/woc-guidance',
        onAvailability: (up) => availEvents.push(up)
    });
    const availChanges = [];
    const availEngine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: nativeReader
    });
    nativeReader.onAvailability = (up) => { availEvents.push(up); availEngine._onNativeAvailability(up); };
    availEngine.on('change', (st) => availChanges.push(st.native_guidance));
    availEngine.nativeRetryAt = Date.now() + 3000;
    nativeReader._onLine('avail 1');
    assert.strictEqual(availEngine.nativeRetryAt, 0, 'SOME/IP 恢复可用时应立即清除退避重试时间');
    assert.deepStrictEqual(availEvents, [true]);
    assert.deepStrictEqual(availChanges, [false], '未解出有效导航事件前不抢占 OAP 轮询');
    /* 回归：原生有效 -> 变空 -> 重置 nativeVerified 并广播 native_guidance=false 以恢复 OAP 兜底 */
    let nativeReply = reply;
    const toggleEngine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { available: true, supported: () => true, read: () => Promise.resolve(nativeReply), stop() {} },
        outputFactory: (_keep, _onState) => ({ setKeepShown() {}, setLayout() {}, update() {}, close() {} })
    });
    const toggleNativeFlags = [];
    toggleEngine.on('change', (st) => toggleNativeFlags.push(st.native_guidance));
    toggleEngine.settings({ hud_simple: 1, hud: 0 });
    toggleEngine.tick();
    await until(() => !toggleEngine.nativeBusy && !toggleEngine.navBusy && toggleEngine.nativeVerified);
    assert.strictEqual(toggleEngine.status().native_guidance, true, '原生解出有效事件后应接管');
    nativeReply = { viewContent: [] };
    toggleEngine.tick();
    await until(() => !toggleEngine.nativeBusy && !toggleEngine.nativeVerified);
    assert.strictEqual(toggleEngine.status().native_guidance, false, '原生后续返回空事件时应释放接管并恢复 OAP');
    assert.strictEqual(toggleNativeFlags[toggleNativeFlags.length - 1], false, '空事件分支必须广播 native_guidance=false');
    toggleEngine.stop();
    availEngine.nativeVerified = true;
    nativeReader._onLine('avail 0');
    assert.strictEqual(availEngine.nativeVerified, false, 'SOME/IP 断开时应重置已验证标记');
    assert.deepStrictEqual(availEvents, [true, false]);
    assert.deepStrictEqual(availChanges, [false, false]);
    availEngine.stop();
    console.log('通过：原生 SOME/IP Utf8D 编码与可用状态同步回调');

    /* 端到端集成测试：patch.sock -> hud_daemon (hud.sock) -> OAP StructuredHud -> render.sock（含断线重连） */
    const pid = process.pid;
    const pSock = `/tmp/woc-e2e-patch-${pid}.sock`;
    const hSock = `/tmp/woc-e2e-hud-${pid}.sock`;
    const rSock = `/tmp/woc-e2e-render-${pid}.sock`;
    [pSock, hSock, rSock].forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
    const patchPeers = new Set();
    const patchSrv = net.createServer((s) => {
        patchPeers.add(s); s.setEncoding('utf8');
        s.on('data', (d) => {
            if (d.indexOf('hud-simple-status') >= 0) {
                s.write(JSON.stringify({ ev: 'map-settings', settings: { hud_simple: 1, hud: 0, hud_keep_shown: 0 } }) + '\n');
            }
        });
        s.on('close', () => patchPeers.delete(s));
    });
    const renderSessions = [], renderPeers = [];
    const crMsg = (obj) => {
        const b = Buffer.from(JSON.stringify(obj)), m = Buffer.alloc(b.length + 5);
        m.writeUInt32LE(b.length + 1, 0); m[4] = 74; b.copy(m, 5); return m;
    };
    const renderSrv = net.createServer((peer) => {
        const sess = { cmds: [], frames: 0 };
        renderSessions.push(sess); renderPeers.push(peer);
        let buf = Buffer.alloc(0);
        peer.on('error', () => {});
        peer.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 5 && buf.length >= buf.readUInt32LE(0) + 4) {
                const sz = buf.readUInt32LE(0), t = buf[4], body = buf.slice(5, sz + 4);
                buf = buf.slice(sz + 4);
                if (t === 70) { sess.frames++; continue; }
                const cmd = JSON.parse(body.toString());
                sess.cmds.push(cmd);
                if (cmd.op === 'hello') peer.write(crMsg({ ev: 'hello', backend: 'id7', proto: 1, targets: 'hud:800x480' }));
                if (cmd.op === 'set' && cmd.visible !== undefined) {
                    peer.write(crMsg({ ev: 'layer', ref: cmd.ref, state: cmd.visible === 1 ? 'shown' : 'hidden' }));
                }
            }
        });
    });
    await new Promise((r) => patchSrv.listen(pSock, r));
    await new Promise((r) => renderSrv.listen(rSock, r));
    const hudLogs = [];
    const daemon = startDaemon({
        hudSocket: hSock, patchSocket: pSock, renderSocket: rSock, logFile: null,
        log: { info(line) { hudLogs.push(line); }, warn() {}, error() {} }, retryMs: 50,
        traffic: { reset() {}, read: () => Promise.resolve(null) }
    });
    const bridge = new StructuredHud({
        control, hudPath: hSock, retryMs: 50, intervalMs: 50,
        reader: { read: () => { reads++; return Promise.resolve(laneReply); }, stop: () => stops++ },
        parkingReader: { read: () => Promise.resolve(true), stop() {} }
    });
    try {
        bridge.start();
        await until(() => bridge.supported && bridge.enabled && bridge.state === 'showing' && renderSessions[0] && renderSessions[0].frames > 0);
        assert(renderSessions[0].cmds.some((c) => c.op === 'hello' && c.app === 'robertn_waze_cluster_simple'));
        assert(renderSessions[0].cmds.some((c) => c.op === 'layer' && c.target === 'hud' && c.kind === 'image'));
        assert.deepStrictEqual(daemon.engine.lastState.lanes, laneState.lanes, '实际 OAP 桥接和 HUD 推帧保留车道及虚实线');
        assert(hudLogs.some((line) => line.includes('HUD lanes OAP: matched received=1 eligible=1 matched=1 selectedLanes=4')),
            '车道诊断穿过 OAP socket 并写入后台日志');
        renderPeers[0].destroy();
        await until(() => renderSessions.length >= 2 && renderSessions[1].frames > 0 && bridge.state === 'showing');
        bridge.settings({ hud_simple: 0, hud: 1 });
        await until(() => !bridge.enabled && bridge.state === 'off');
        bridge.settings({ hud_simple: 1, hud: 0 });
        await until(() => bridge.enabled && !bridge.suspended);
        bridge.startValidation();
        await until(() => !!daemon.engine.validation);
        bridge.stop();
        await until(() => !daemon.engine.validation && !daemon.engine.output);
        console.log('通过：端到端集成（patch.sock -> hud_daemon -> hud.sock -> OAP 桥接 -> render.sock 建层/推帧/断连重连/配置切换）');
    } finally {
        bridge.stop();
        daemon.close();
        renderPeers.forEach((p) => p.destroy());
        patchPeers.forEach((p) => p.destroy());
        await new Promise((r) => renderSrv.close(r));
        await new Promise((r) => patchSrv.close(r));
        [pSock, hSock, rSock].forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
    }

    /* 按正式链接器的扁平模块名和静态 require 规则校验整份清单，防止包内漏文件、相对引用失效或注释误触发链接失败。 */
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mgu-app.json'), 'utf8'));
    const builtins = require('module').builtinModules || [];
    const modules = {};
    manifest.modules.forEach((name) => {
        const key = './' + path.basename(name);
        assert(!modules[key], '模块重名：' + key);
        modules[key] = fs.readFileSync(path.join(root, name), 'utf8');
    });
    manifest.modules.forEach((name) => {
        const source = modules['./' + path.basename(name)];
        const re = /require\('([^']+)'\)/g;
        let m;
        while ((m = re.exec(source)) !== null) {
            const dep = m[1];
            assert(modules[dep] || manifest.sdk.includes(dep) || builtins.includes(dep),
                `${name} 包含未登记的 require('${dep}')（与 oap_link.js 静态扫描冲突）`);
        }
    });
    const cache = {};
    const load = (key) => {
        if (!modules[key]) return require(key);
        if (!cache[key]) {
            const module = cache[key] = { exports: {} };
            const factory = vm.runInThisContext('(function(require,module,exports){\n' + modules[key] + '\n})', { filename: key });
            factory(load, module, module.exports);
        }
        return cache[key].exports;
    };
    assert.strictEqual(typeof load('./structured_hud.js').StructuredHud, 'function');
    assert.strictEqual(typeof load('./guidance_reader.js').GuidanceReader, 'function');
    console.log('通过：正式源包中的 HUD 模块、字体和原版输出客户端依赖完整');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
