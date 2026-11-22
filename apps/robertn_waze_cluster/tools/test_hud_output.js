'use strict';

const assert = require('assert');
const net = require('net');
const Output = require('../../../native/waze-on-cluster/hud/hud_output.js');
const { HudEngine } = require('../../../native/waze-on-cluster/hud/hud_daemon.js');
const scenarios = require('../../../native/waze-on-cluster/hud/hud_validation_scenarios.js');
const socketPath = '/tmp/woc-simple-output-' + process.pid + '.sock';
const peers = [], sessions = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 150; i++) { if (check()) return; await sleep(20); }
    throw new Error('等待渲染协议超时');
}
function message(obj) {
    const body = Buffer.from(JSON.stringify(obj)), frame = Buffer.alloc(body.length + 5);
    frame.writeUInt32LE(body.length + 1, 0); frame[4] = 74; body.copy(frame, 5);
    return frame;
}
let backend = 'id7';
let acknowledgeLayers = false;
const server = net.createServer((peer) => {
    const session = { commands: [], frames: [] };
    peers.push(peer); sessions.push(session);
    let bytes = Buffer.alloc(0);
    peer.on('error', () => {});
    peer.on('data', (data) => {
        bytes = Buffer.concat([bytes, data]);
        while (bytes.length >= 5 && bytes.length >= bytes.readUInt32LE(0) + 4) {
            const size = bytes.readUInt32LE(0), type = bytes[4], body = bytes.slice(5, size + 4);
            bytes = bytes.slice(size + 4);
            if (type === 70) { session.frames.push(body); continue; }
            const cmd = JSON.parse(body.toString());
            session.commands.push(cmd);
            if (cmd.op === 'hello') peer.write(message({ ev: 'hello', backend, proto: 1, targets: 'hud:800x480' }));
            if (acknowledgeLayers && cmd.op === 'set' && cmd.visible !== undefined) {
                peer.write(message({ ev: 'layer', ref: cmd.ref, state: cmd.visible === 1 ? 'shown' : 'hidden' }));
            }
        }
    });
});

async function main() {
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const states = [];
    const output = new Output(socketPath, false, state => states.push(state));
    let validation;
    try {
        const pixels = Buffer.alloc(800 * 480 * 4, 123);
        output.update(pixels, true);
        await until(() => sessions[0] && sessions[0].frames.length > 0);
        const layer = sessions[0].commands.find((c) => c.op === 'layer');
        assert(!states.includes('showing'), '提交像素不代表实际显示');
        peers[0].write(message({ ev: 'layer', ref: layer.ref + 1, state: 'shown' }));
        await sleep(30);
        assert(!states.includes('showing'), '忽略不属于本输出的图层状态');
        peers[0].write(message({ ev: 'layer', ref: layer.ref, state: 'shown' }));
        await until(() => states[states.length - 1] === 'showing');
        peers[0].write(message({ ev: 'layer', ref: layer.ref, state: 'waiting' }));
        await until(() => states[states.length - 1] === 'unavailable');
        peers[0].write(message({ ev: 'layer', ref: layer.ref, state: 'shown' }));
        await until(() => states[states.length - 1] === 'showing');
        peers[0].write(message({ ev: 'error', op: 'set', ref: layer.ref, reason: 'test-refused' }));
        await until(() => states[states.length - 1] === 'unavailable');
        assert.strictEqual(layer.target, 'hud');
        assert.deepStrictEqual([layer.x, layer.y, layer.w, layer.h, layer.iw, layer.ih, layer.sampling],
            [173, 60, 454, 272, 800, 480, 'bilinear'], '逻辑画布按 5:3 等比缩放并避开底部车速区');
        assert.strictEqual(layer.contend, 1, '沿用普通 HUD 的占用与重试策略');
        assert.strictEqual(layer.yield, 1, '默认向原厂弹窗让位');
        assert(sessions[0].frames[0].slice(-pixels.length).equals(pixels), '实际传输完整 RGBA 像素');
        output.setKeepShown(true);
        await until(() => sessions[0].commands.some((c) => c.op === 'set' && c.yield === 0));

        peers[0].destroy();
        await until(() => sessions[1] && sessions[1].frames.length > 0);
        assert.strictEqual(states[states.length - 1], 'unavailable', '重连后重新等待图层确认');
        assert.strictEqual(sessions[1].commands.find((c) => c.op === 'layer').yield, 0);
        assert(sessions[1].frames[0].slice(-pixels.length).equals(pixels), '断连由原客户端恢复图层和像素');
        peers[1].destroy();
        await until(() => !output.client.ready);
        output.update(null, false);
        output.update(null, false);
        assert.strictEqual(output.frame, null, '隐藏时不缓存透明帧');
        await until(() => sessions[2] && sessions[2].commands.some(c => c.op === 'set'));
        assert.strictEqual(sessions[2].commands.find(c => c.op === 'layer').visible, 0, '断连期间隐藏，重建时也必须隐藏');
        assert(!sessions[2].commands.some(c => c.op === 'set' && c.visible === 1), '隐藏后重连不能重新显示旧引导');
        output.close();
        const count = sessions.length;
        await sleep(600);
        assert.strictEqual(sessions.length, count, '退出模式后不再重连');

        backend = 'id8';
        const unsupported = new Output(socketPath);
        await until(() => unsupported.client.closed);
        assert.strictEqual(sessions[sessions.length - 1].frames.length, 0, '不向 ID8 写入 ID7 图像');
        console.log('通过：普通 HUD 连接策略、实际像素、弹窗设置、断连恢复、隐藏与退出后的重连行为、ID7 限制');

        backend = 'id7'; acknowledgeLayers = true;
        validation = new HudEngine({
            traffic: { reset() {}, read: () => Promise.resolve(null) },
            outputFactory: (keepShown, onState) => new Output(socketPath, keepShown, onState) });
        validation.settings({ hud_simple: 1, hud: 0 });
        validation.startValidation();
        await until(() => validation.state === 'showing' && sessions[sessions.length - 1].frames.length > 0);
        const session = sessions[sessions.length - 1];
        for (let i = 0; i < scenarios.length; i++) {
            assert.strictEqual(validation.validation.index, i);
            if (scenarios[i].input.state !== 'inactive') {
                await until(() => session.frames.length === i + 1 && validation.state === 'showing');
                assert(session.frames[i].slice(-800 * 480 * 4).equals(validation.frame), scenarios[i].id + ' 的完整像素通过正式二进制协议传输');
            } else await until(() => session.commands.some(c => c.op === 'set' && c.visible === 0));
            validation.validation.since = Date.now() - 5001;
            validation.tick();
        }
        assert.strictEqual(validation.validation, null);
        assert.strictEqual(validation.output, null);
        console.log(`通过：全部 ${scenarios.length} 个场景经正式解析、绘制、输出客户端和 Unix socket 传输，最后清屏并释放连接`);
    } finally {
        if (validation) validation.stop();
        output.close();
        peers.forEach((peer) => peer.destroy());
        await new Promise((resolve) => server.close(resolve));
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
