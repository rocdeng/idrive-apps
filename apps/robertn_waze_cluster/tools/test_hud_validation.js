'use strict';

const assert = require('assert');
const { HudEngine } = require('../../../native/waze-on-cluster/hud/hud_daemon.js');
const nav = require('../../../native/waze-on-cluster/hud/hud_navigation.js');
const scenarios = require('../../../native/waze-on-cluster/hud/hud_validation_scenarios.js');

async function main() {
    let acknowledge = false;
    const owner = {};
    let monotonic = 0;
    const outputs = [], frames = [];
    const hud = new HudEngine({
        clock: () => monotonic,
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        outputFactory: (keepShown, onState) => {
            const output = { onState, closed: false, setKeepShown() {}, close() { this.closed = true; },
                update(pixels, visible) { frames.push({ pixels, visible }); if (acknowledge) onState(visible ? 'showing' : 'unavailable'); } };
            outputs.push(output); return output;
        } });
    const realNow = Date.now;
    let clock = 100000;
    Date.now = () => clock;
    try {
        hud.startValidation(owner, true);
        assert.strictEqual(hud.validation, null, '模式关闭时不能开始验证');
        hud.settings({ hud_simple: 1, hud: 0 });
        hud.startValidation(owner, false);
        assert.strictEqual(hud.validation, null, '未确认停车不能启动验证');
        hud.startValidation(owner, true);
        hud.updateParking({}, false);
        assert(hud.validation, '其他连接不能停止已启动的验证');
        monotonic += 1600;
        hud.tick();
        assert.strictEqual(hud.validation, null, '车辆状态超时停止验证');
        monotonic = 0;
        outputs.length = frames.length = 0;
        hud.startValidation(owner, true);
        assert.strictEqual(hud.validation.index, 0);
        const firstFrameCount = frames.length;
        hud.handleNav(nav.fromBmw({ events: [{ intersection: { direction: 'LEFT', formattedDistance: { distance: '147', unit: 'METER' } } }] }));
        for (let i = 0; i < 10; i++) await Promise.resolve();
        assert.strictEqual(frames.length, firstFrameCount, '验证期间真实导航数据不能覆盖验证画面');
        clock += 20000; hud.tick();
        assert.strictEqual(hud.validation.index, 0, '服务未确认显示时不跳过场景');
        outputs[0].onState('showing'); hud.tick();
        clock += 3000; hud.tick();
        outputs[0].onState('unavailable'); hud.tick();
        clock += 20000; hud.tick();
        assert.strictEqual(hud.validation.index, 0, '弹窗让位或断连期间暂停场景计时');
        outputs[0].onState('showing'); hud.tick();
        clock += 5001; hud.tick();
        assert.strictEqual(hud.validation.index, 1);
        hud.stopValidation();
        assert(outputs[0].closed, '手动停止释放图层连接');
        outputs[0].onState('showing');
        assert.strictEqual(hud.state, 'waiting', '停止后的迟到事件无效');
        acknowledge = true;
        hud.startValidation(owner, true);
        const seen = [];
        for (let i = 0; i < scenarios.length; i++) {
            assert.strictEqual(hud.validation.index, i);
            seen.push(scenarios[i].id);
            hud.tick();
            if (scenarios[i].input.state !== 'inactive') {
                const last = frames[frames.length - 1];
                assert(last.visible && last.pixels.length === 800 * 480 * 4);
                let marked = false;
                for (let y = 26; y < 63; y++) for (let x = 0; x < 160; x++) {
                    const p = (y * 800 + x) * 4;
                    if (last.pixels[p + 3] && last.pixels[p] > 245 && last.pixels[p + 1] > 185 &&
                        last.pixels[p + 1] < 205 && last.pixels[p + 2] < 70) marked = true;
                }
                assert(marked, scenarios[i].id + ' 带 TEST 标记');
            } else assert.strictEqual(frames[frames.length - 1].visible, false, '结束导航场景清屏');
            clock += 5001; hud.tick();
        }
        assert.strictEqual(new Set(seen).size, scenarios.length, '所有场景各播放一次');
        assert.strictEqual(hud.validation, null, '完整序列自动结束，不循环');
        assert(hud.enabled && !hud.output, '结束后保留简洁模式，释放测试图层');

        hud.startValidation(owner, true);
        hud.settings({ hud_simple: 0, hud: 1 });
        assert.strictEqual(hud.validation, null, '切回视频模式取消验证');
        assert(outputs[outputs.length - 1].closed);
        hud.settings({ hud_simple: 1, hud: 0 });
        assert.strictEqual(hud.validation, null, '重新开启不恢复验证');
        hud.startValidation(owner, true);
        hud.settings(null);
        assert.strictEqual(hud.validation, null, '配置连接丢失取消验证');
        hud.settings({ hud_simple: 1, hud: 0 });
        hud.startValidation(owner, true); hud.stop();
        assert.strictEqual(hud.validation, null, '应用关闭取消验证');

        const states = scenarios.map(s => nav.fromInput(s.input));
        nav.directions.forEach(d => assert(states.some(s => s.direction === d), '覆盖转向 ' + d));
        for (let n = 0; n <= 8; n++) assert(states.some(s => s.lanes.length === n), '覆盖 ' + n + ' 车道');
        ['reference', 'bmw', 'iap', 'lanes-2-left-straight', 'lanes-3-right-straight', 'lanes-4-double-left',
            'lanes-4-shared', 'lanes-4-uturn', 'lanes-5-uturn', 'lanes-6-shared', 'lanes-6-merge',
            'lanes-3-left-right', 'lanes-4-three-way', 'lanes-5-bus-right', 'lanes-4-bus-right-turn', 'lanes-8-wide', 'rerouting', 'arrived', 'inactive']
            .forEach(id => assert(seen.includes(id), '保留展示页场景 ' + id));
        ['bmw', 'iap'].forEach(id => assert.strictEqual(nav.fromInput(scenarios.find(s => s.id === id).input).state,
            'navigating', '原始数据通过正式适配器解析：' + id));
        console.log('通过：' + scenarios.length + ' 个场景、17 种转向、0～8 车道、TEST 标记、逐个播放、让位暂停、自动结束、停止恢复及旧响应隔离');
    } finally { Date.now = realNow; hud.stop(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
