'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { StructuredHud } = require('../src/structured_hud.js');
const { GuidanceReader, IFACE, INSTANCE, VIEW } = require('../src/guidance_reader.js');
const nav = require('../src/hud_navigation.js');
const renderer = require('../src/hud_renderer.js');
const Font = require('../src/hud_font.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 100; i++) { if (check()) return; await sleep(10); }
    throw new Error('等待状态超时');
}
const reply = { viewContent: [{ eventsInView: [{ intersection: { direction: 'LEFT',
    formattedDistance: { distance: '147', unit: { name: 'METER' } },
    description: { text: '前方左转' }, distanceToDestination: 3153 } }] }] };

async function main() {
    const laneFont = new Font(require('../src/hud_font_data.js'));
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
    const hud = new StructuredHud({ control, reader: { read: () => { reads++; return input(); }, stop: () => stops++ },
        outputFactory: (keepShown, onState) => {
            const output = { closed: false, setKeepShown: (keep) => { output.keepShown = keep; },
                report: onState,
                update: (frame, visible) => publications.push({ frame: visible ? Buffer.from(frame) : frame, visible }),
                close: () => { output.closed = true; } };
            outputs.push(output); return output;
        } });
    hud.tick();
    assert.strictEqual(reads, 0, '未启用时不查询导航');
    assert.strictEqual(hud.font, null, '未启用时不加载字体');
    hud.settings({ hud_simple: 1, hud: 0 });
    input = () => Promise.resolve({ viewContent: [] });
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(hud.font, null, '等待导航时仍未加载字体');
    input = () => Promise.resolve(reply);
    hud.tick(); await until(() => !hud.busy);
    assert(hud.font, '首个有效引导绘制时加载字体');
    assert.strictEqual(hud.state, 'unavailable', '提交图像后，仍须等待实际图层状态');
    outputs[0].report('showing');
    assert.strictEqual(hud.state, 'showing');
    assert(publications[0].visible);
    hud.settings({ hud_simple: 1, hud: 0, hud_keep_shown: 1 });
    assert.strictEqual(outputs[0].keepShown, true, '沿用普通 HUD 的弹窗让位设置');
    assert.deepStrictEqual(publications[0].frame, Buffer.from(renderer.render(nav.fromBmw(reply), new Font(require('../src/hud_font_data.js')))));
    const firstFrame = hud.frame;
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(publications.length, 1, '重复完整状态不重复发送像素');
    assert.strictEqual(hud.frame, firstFrame, '重复完整状态不重新分配帧');
    outputs[0].report('unavailable');
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(hud.state, 'unavailable', '相同导航数据不能掩盖输出断连');
    outputs[0].report('showing');
    input = () => Promise.resolve({ viewContent: [] });
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(hud.state, 'waiting');
    assert.deepStrictEqual(publications[publications.length - 1], { frame: null, visible: false }, '导航结束只更新可见性');
    const hiddenPublications = publications.length;
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(publications.length, hiddenPublications, '重复等待不再提交隐藏帧');
    outputs[0].report('showing');
    assert.strictEqual(hud.state, 'waiting', '结束导航后的迟到回调不能恢复显示状态');
    input = () => Promise.reject(new Error('navigation unavailable'));
    hud.tick(); await until(() => !hud.busy);
    assert.strictEqual(hud.state, 'unavailable');
    assert.strictEqual(publications[publications.length - 1].visible, false);

    let finish;
    input = () => new Promise((resolve) => { finish = resolve; });
    hud.retryAt = 0;
    hud.tick(); await until(() => !!finish);
    const published = publications.length;
    hud.settings({ hud_simple: 0, hud: 0 });
    finish(reply); await until(() => !hud.busy);
    assert.strictEqual(publications.length, published, '关闭后返回的旧请求不能恢复导航');
    assert(outputs[0].closed);
    outputs[0].report('showing');
    assert.strictEqual(hud.state, 'off', '旧输出不能在关闭后改写状态');

    hud.settings({ hud_simple: 1, hud: 1 });
    assert.strictEqual(hud.enabled, false, '视频模式配置开启时不输出简洁导航');
    hud.settings({ hud_simple: 1, hud: 0 });
    input = () => Promise.resolve(reply);
    connected = false;
    control.renderStatus = null;
    hud.tick();
    await until(() => !hud.busy);
    outputs[outputs.length - 1].report('showing');
    assert.strictEqual(hud.state, 'showing', '和普通 HUD 一样，设置页控制连接关闭不影响绘制');
    hud.suspend();
    const before = reads;
    hud.tick();
    assert.strictEqual(reads, before, '切回地图等待保存期间也不重新输出导航');
    hud.settings({ hud_simple: 0, hud: 0 });
    hud.settings({ hud_simple: 1, hud: 0 });
    input = () => new Promise(() => {});
    hud.lastRead = Date.now() - 6000;
    hud.tick();
    assert.strictEqual(hud.state, 'unavailable', '断流超过 5 秒清除旧引导');
    hud.settings(null);
    assert.strictEqual(hud.state, 'off', '后台模式配置连接断开后释放旧图层');
    hud.stop();
    assert(stops >= 4);
    console.log('通过：实际像素、去重、结束清屏、读取失败、模式切换竞态、独立输出连接和断流清屏');

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
