'use strict';

const fs = require('fs');
const { promisify } = require('util');
const { recognizeBaiduTrafficLight } = require('./hud_baidu_traffic_light.js');
const { recognizeBaiduSpeedLimit, recognizeBaiduWhiteSigns } = require('./hud_baidu_speed_limit.js');

const open = promisify(fs.open), fstat = promisify(fs.fstat);
const read = promisify(fs.read), readFile = promisify(fs.readFile), close = promisify(fs.close);
const WIDTH = 1088, HEIGHT = 480, BYTES = WIDTH * HEIGHT * 1.5;
const POLL = 500, INTERVAL = 1000, FRESH = 2800;

// 与 Linux 后端的 CLOCK_MONOTONIC 同源，车辆校时不会影响帧龄。
function monotonicMs() {
    const t = process.hrtime();
    return t[0] * 1000 + Math.floor(t[1] / 1000000);
}

class HudTrafficReader {
    constructor(path = '/run/waze-on-cluster/hud-frame.yuv', clock = monotonicMs, log) {
        this.path = path;
        this.clock = clock;
        this.log = log || { info: function() {}, warn: function() {} };
        this.header = Buffer.alloc(12);
        this.lastDiagnostic = '';
        this.reset();
    }

    diagnostic(level, message) {
        if (message === this.lastDiagnostic) return;
        this.lastDiagnostic = message;
        (this.log[level] || this.log.warn).call(this.log, 'traffic frame: ' + message);
    }

    reset() {
        this.nextPoll = 0;
        this.nextParse = 0;
        this.stamp = 0;
        this.firstAllowed = this.clock();
        this.pendingLight = null;
        this.pendingLimit = null;
        this.pendingCamera = null;
        this.shown = null;
        this.generation = (this.generation || 0) + 1;
        this.lastDiagnostic = '';
    }

    // 限速牌两种都读：整帧找红圈白底黑字的牌，画面中下部找红圈深色底白字的牌，导航和巡航一样。
    // 白底的牌优先。白底牌旁边带电子眼文字的是电子眼，不算当前限速。
    async read() {
        const now = this.clock();
        if (now - this.stamp >= FRESH) this.pendingLight = this.pendingLimit = this.pendingCamera = this.shown = null;
        if (now < this.nextPoll || now < this.nextParse || this.reading) return this.shown;
        this.nextPoll = now + POLL;
        const generation = this.generation;
        this.reading = true;
        let fd;
        try {
            fd = await open(this.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
            const stat = await fstat(fd);
            if (!stat.isFile() || stat.size !== BYTES + this.header.length) throw Error('frame size');
            const { bytesRead } = await read(fd, this.header, 0, this.header.length, null);
            if (generation !== this.generation) return null;
            if (bytesRead !== this.header.length || this.header.toString('ascii', 0, 4) !== 'WOC1') throw Error('frame header');
            const stamp = this.header.readUInt32LE(4) + this.header.readUInt32LE(8) * 0x100000000;
            if (stamp <= this.firstAllowed || stamp > this.clock() || this.clock() - stamp >= FRESH) throw Error('frame age');
            if (stamp === this.stamp) return this.shown;
            const bytes = await readFile(fd);
            if (generation !== this.generation) return null;
            if (this.clock() - stamp >= FRESH) throw Error('frame age');
            this.nextParse = now + INTERVAL;
            const observed = recognizeBaiduTrafficLight(bytes, WIDTH, HEIGHT, 0, false);
            this.diagnostic('info', observed ? ('recognized ' + observed.color + ' ' + (observed.seconds === null ? (observed.text || 'caution') : (observed.seconds + 's')) + ' at stamp ' + stamp) : 'recognizer found no traffic-light card');
            const signs = recognizeBaiduWhiteSigns(bytes, WIDTH, HEIGHT, 0);
            const limit = signs.signKmh !== null ? signs.signKmh : recognizeBaiduSpeedLimit(bytes, WIDTH, HEIGHT, 0);
            const cameraLimit = signs.cameraKmh;
            const previous = this.pendingLight;
            // 过期或有歧义即留白，不从旧值自行递减；黄灯“注意”无倒计时需连续两帧确认。
            const sameWindow = observed && previous && stamp > this.stamp && stamp - this.stamp < FRESH && observed.color === previous.color;
            const validStep = sameWindow && (
                (observed.seconds === null && previous.seconds === null) ||
                (observed.seconds !== null && previous.seconds !== null && observed.seconds <= previous.seconds &&
                    previous.seconds - observed.seconds <= Math.ceil((stamp - this.stamp) / 1000))
            );
            const freshPair = stamp > this.stamp && stamp - this.stamp < FRESH;
            this.shown = {
                trafficLight: validStep ? observed : null,
                speedLimitKmh: freshPair && limit === this.pendingLimit ? limit : null,
                // 电子眼同样要连续两帧读到同一个限速才显示。
                // 距离每帧都在变，用这一帧读到的；读不出时为 null。
                speedCamera: freshPair && cameraLimit !== null && cameraLimit === this.pendingCamera ?
                    { limitKmh: cameraLimit, distanceM: signs.cameraDistanceM } : null
            };
            if (cameraLimit !== this.pendingCamera) this.log.info('traffic frame: ' + (cameraLimit === null ? 'speed camera card gone' : 'speed camera card ' + cameraLimit + ' km/h at stamp ' + stamp));
            this.pendingLight = observed;
            this.pendingLimit = limit;
            this.pendingCamera = cameraLimit;
            this.stamp = stamp;
            return this.shown;
        } catch (err) {
            if (generation === this.generation) {
                this.pendingLight = this.pendingLimit = this.pendingCamera = this.shown = null;
                this.diagnostic('warn', err && err.message ? err.message : String(err));
            }
            return null;
        } finally {
            if (fd !== undefined) await close(fd).catch(() => {});
            this.reading = false;
        }
    }
}

module.exports = { HudTrafficReader };
