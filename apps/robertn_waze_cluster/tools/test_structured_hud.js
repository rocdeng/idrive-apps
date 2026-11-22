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
    assert.deepStrictEqual(at(543, 345), [167, 174, 174, 255], '实线保持连续');
    assert.deepStrictEqual(at(440, 332), [167, 174, 174, 255], '推荐车道也按数据画虚线');
    assert.strictEqual(at(440, 345)[3], 0, '虚线分段间留空');
    assert.strictEqual(at(647, 345)[3], 0, '未知边界不画线');
    assert.deepStrictEqual(at(380, 412), [84, 245, 165, 255], '推荐车道显示绿色底线');
    assert.strictEqual(at(338, 320)[3], 0, '推荐车道保持透明底');
    assert.strictEqual(nav.snapshot({ lanes: [{ directions: [] }, lanes[2]] }).lanes.length, 2, '无箭头车道保留边界位置');
    console.log('通过：最新画布推荐绿线、透明底、实际虚实边界与未知边界隐藏');
    const calls = [];
    let down = 0, query = () => Promise.resolve(reply);
    const proxy = { init: () => Promise.resolve(), waitUntilAvailable: () => Promise.resolve(),
        shutdown: () => down++, _someIpProxy: { callMethod: (name, args) => {
            calls.push({ name, args });
            return name === 'getViewConfig' ? Promise.resolve({ viewConfig: { minimumUpdateIntervalMs: 500 } }) : query();
        } } };
    const reader = new GuidanceReader({ buildTypedProxy: (iface, instance) => {
        assert.strictEqual(iface, IFACE); assert.strictEqual(instance, INSTANCE);
        return Promise.resolve(proxy);
    } }, { timeoutMs: 30 });
    assert.deepStrictEqual(await reader.read(), reply);
    await reader.read();
    assert.deepStrictEqual(calls.map((c) => c.name), ['getViewConfig', 'queryContent', 'queryContent']);
    assert.strictEqual(calls[0].args.viewId, VIEW);
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
    const barPx = Array.from(publications[1].frame.slice((272 * 800 + 450) * 4, (272 * 800 + 450) * 4 + 4));
    assert.deepStrictEqual(barPx, [255, 255, 255, 255], '同路口距离递减时进度条应推进显示白色填充');
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
    assert.deepStrictEqual(availChanges, [true]);
    nativeReader._onLine('avail 0');
    assert.deepStrictEqual(availEvents, [true, false]);
    assert.deepStrictEqual(availChanges, [true, false]);
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
    const daemon = startDaemon({
        hudSocket: hSock, patchSocket: pSock, renderSocket: rSock, logFile: null,
        log: { info() {}, warn() {}, error() {} }, retryMs: 50,
        traffic: { reset() {}, read: () => Promise.resolve(null) }
    });
    const bridge = new StructuredHud({
        control, hudPath: hSock, retryMs: 50, intervalMs: 50,
        reader: { read: () => { reads++; return Promise.resolve(reply); }, stop: () => stops++ }
    });
    try {
        bridge.start();
        await until(() => bridge.supported && bridge.enabled && bridge.state === 'showing' && renderSessions[0] && renderSessions[0].frames > 0);
        assert(renderSessions[0].cmds.some((c) => c.op === 'hello' && c.app === 'robertn_waze_cluster_simple'));
        assert(renderSessions[0].cmds.some((c) => c.op === 'layer' && c.target === 'hud' && c.kind === 'image'));
        renderPeers[0].destroy();
        await until(() => renderSessions.length >= 2 && renderSessions[1].frames > 0 && bridge.state === 'showing');
        bridge.settings({ hud_simple: 0, hud: 1 });
        await until(() => !bridge.enabled && bridge.state === 'off');
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
