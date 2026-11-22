'use strict';

const fs = require('fs');
const { promisify } = require('util');
const { recognizeBaiduTrafficLight } = require('./hud_baidu_traffic_light.js');

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
        this.pending = null;
        this.shown = null;
        this.generation = (this.generation || 0) + 1;
        this.lastDiagnostic = '';
    }

    async read() {
        const now = this.clock();
        if (now - this.stamp >= FRESH) this.pending = this.shown = null;
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
            if (stamp < this.firstAllowed || stamp > this.clock() || this.clock() - stamp >= FRESH) throw Error('frame age');
            if (stamp === this.stamp) return this.shown;
            const bytes = await readFile(fd);
            if (generation !== this.generation) return null;
            if (this.clock() - stamp >= FRESH) throw Error('frame age');
            this.nextParse = now + INTERVAL;
            const observed = recognizeBaiduTrafficLight(bytes, WIDTH, HEIGHT, 0, false);
            this.diagnostic('info', observed ? ('recognized ' + observed.color + ' ' + observed.seconds + 's at stamp ' + stamp) : 'recognizer found no traffic-light card');
            const previous = this.pending;
            // 过期或有歧义即留白，不从旧值自行递减。
            this.shown = observed && previous && stamp > this.stamp && stamp - this.stamp < FRESH &&
                observed.color === previous.color && observed.seconds <= previous.seconds &&
                previous.seconds - observed.seconds <= Math.ceil((stamp - this.stamp) / 1000) ? observed : null;
            this.pending = observed;
            this.stamp = stamp;
            return this.shown;
        } catch (err) {
            if (generation === this.generation) this.pending = this.shown = null;
            this.diagnostic('warn', err && err.message ? err.message : String(err));
            return null;
        } finally {
            if (fd !== undefined) await close(fd).catch(() => {});
            this.reading = false;
        }
    }
}

module.exports = { HudTrafficReader };
