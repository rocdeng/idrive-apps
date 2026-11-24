'use strict';

const EventEmitter = require('events');
const { LineSocket } = require('./waze_cluster_control.js');
const nav = require('./hud_navigation.js');

const HUD_PATH = '/dev/shm/waze-on-cluster/hud.sock';

/* OAP 侧薄桥接：连接原生 waze-on-cluster-hud.service，转发验证指令和 BMW 引导数据。 */
class StructuredHud extends EventEmitter {
    constructor(options) {
        super();
        const o = options;
        this.reader = o.reader;
        this.parkingReader = o.parkingReader;
        this.parkingRead = null;
        this.nativeNeedsLanes = false;
        this.log = o.log || { info() {}, warn() {} };
        this.interval = o.intervalMs || 500;
        this.enabled = false;
        this.supported = false;
        this.state = 'off';
        this.reason = '';
        this.keepShown = null;
        this.hudWidthPct = null;
        this.hudOffset = null;
        this.hudFontPct = null;
        this.hudStyle = null;
        this.nativeGuidance = false;
        this.suspended = true;
        this.validation = null;
        this.busy = false;
        this.generation = 0;
        this.retryAt = 0;
        this.timer = null;
        o.control.simpleHud = this;
        this.hud = new LineSocket({
            path: o.hudPath || HUD_PATH,
            retryMs: o.retryMs,
            log: this.log,
            onMessage: (msg) => {
                if (msg && msg.ev === 'status') this._applyStatus(msg);
            }
        });
        this.hud.on('connect', () => this.hud.send({ cmd: 'status' }));
        this.hud.on('close', () => this._disconnected());
    }

    start() {
        if (this.timer) return;
        this.hud.open();
        this.timer = setInterval(() => this.tick(), this.interval);
    }

    _disconnected() {
        const changed = this.supported || this.enabled || !this.suspended || this.state !== 'off' ||
            this.keepShown !== null || this.hudWidthPct !== null || this.hudOffset !== null || this.hudFontPct !== null || this.hudStyle !== null || this.validation !== null;
        this.generation++;
        this.reader.stop();
        this.supported = false;
        this.enabled = false;
        this.suspended = true;
        this.state = 'off';
        this.reason = '';
        this.keepShown = null;
        this.hudWidthPct = null;
        this.hudOffset = null;
        this.hudFontPct = null;
        this.hudStyle = null;
        this.nativeGuidance = false;
        this.nativeNeedsLanes = false;
        this.validation = null;
        this._stopParkingReader();
        this.retryAt = 0;
        if (changed) this.emit('change');
    }

    _applyStatus(msg) {
        const prevKey = JSON.stringify([this.supported, this.enabled, this.suspended, this.state, this.keepShown, this.hudWidthPct, this.hudOffset, this.hudFontPct, this.hudStyle, this.nativeGuidance, this.validation]);
        const prevReason = this.reason;
        const wasValidating = this.validation !== null;
        this.supported = msg.supported === true;
        this.enabled = msg.enabled === true;
        this.suspended = msg.suspended !== false;
        this.state = typeof msg.state === 'string' ? msg.state : 'off';
        this.reason = typeof msg.reason === 'string' ? msg.reason : '';
        this.keepShown = typeof msg.keep_shown === 'boolean' ? msg.keep_shown : null;
        this.hudWidthPct = typeof msg.hud_width_pct === 'number' ? msg.hud_width_pct : null;
        this.hudOffset = typeof msg.hud_offset_x === 'number' && typeof msg.hud_offset_y === 'number' ? [msg.hud_offset_x, msg.hud_offset_y] : null;
        this.hudFontPct = typeof msg.hud_simple_font_pct === 'number' ? msg.hud_simple_font_pct : null;
        const style = msg.hud_simple_style;
        // 风格只有 1–3，后端已把其他编号换成 1；这里只接受合法值。
        this.hudStyle = Number.isInteger(style) && style >= 1 && style <= 3 ? style : null;
        this.nativeGuidance = msg.native_guidance === true;
        this.nativeNeedsLanes = msg.native_needs_lanes === true;
        this.validation = Array.isArray(msg.validation) && msg.validation.length === 2 ? msg.validation : null;
        if (wasValidating && !this.validation) this._stopParkingReader();
        if (!this.enabled || this.suspended || this.validation || (this.nativeGuidance && !this.nativeNeedsLanes)) {
            this.reader.stop();
            this.retryAt = 0;
        }
        if (this.state === 'unavailable' && this.reason && this.reason !== prevReason) {
            this.log.warn(`HUD simple unavailable: ${this.reason}`);
        }
        const nextKey = JSON.stringify([this.supported, this.enabled, this.suspended, this.state, this.keepShown, this.hudWidthPct, this.hudOffset, this.hudFontPct, this.hudStyle, this.nativeGuidance, this.validation]);
        if (nextKey !== prevKey) this.emit('change');
    }

    /* 驾驶员配置切换时由 profile_sync 调用，同步给原生后台以免与视频 HUD 竞态。 */
    settings(settings) {
        const enabled = !!settings && settings.hud_simple === 1 && settings.hud === 0;
        if (!enabled) {
            this.generation++;
            this.reader.stop();
            this.retryAt = 0;
        }
        this.hud.send({ cmd: 'settings', settings: settings || null });
    }

    /* 切回地图时先通知原生守护进程销毁图层，避免重连后重放旧画面。 */
    suspend() {
        this.suspended = true;
        this.generation++;
        this.validation = null;
        this.reader.stop();
        this.hud.send({ cmd: 'suspend' });
    }

    startValidation() {
        if (!this.enabled || this.suspended || this.validation) return;
        this._checkParking(true);
    }

    stopValidation() {
        if (!this.validation) return;
        this.reader.stop();
        this.retryAt = 0;
        this.hud.send({ cmd: 'validation-stop' });
    }

    _stopParkingReader() {
        this.parkingRead = null;
        if (this.parkingReader) this.parkingReader.stop();
    }

    _checkParking(starting) {
        if (this.parkingRead || !this.parkingReader) return;
        const read = this.parkingRead = this.parkingReader.read();
        read.catch(() => false).then((parked) => {
            if (this.parkingRead !== read) return;
            this.parkingRead = null;
            if (!this.enabled || this.suspended || this.hud.link !== 'up') {
                this._stopParkingReader();
                return;
            }
            if (starting && !parked) {
                this.log.warn('HUD 停车验证需要零车速并拉紧驻车制动');
                this._stopParkingReader();
                return;
            }
            if (starting || this.validation) this.hud.send({
                cmd: starting ? 'validation-start' : 'validation-parking', parked: parked === true
            });
            if (!parked) this._stopParkingReader();
        });
    }

    validationProgress() {
        return this.validation;
    }

    tick() {
        if (!this.enabled || this.suspended || this.hud.link !== 'up') return;
        if (this.validation) { this._checkParking(false); return; }
        if (this.nativeGuidance && !this.nativeNeedsLanes) return;
        if (this.busy || Date.now() < this.retryAt) return;
        this.busy = true;
        const generation = this.generation;
        Promise.resolve().then(() => this.reader.read()).then((reply) => {
            if (!this.enabled || this.suspended || this.validation || generation !== this.generation) return;
            const laneInfo = {};
            const state = nav.fromBmw(reply, laneInfo);
            this.retryAt = 0;
            this.hud.send({ cmd: 'nav', state, laneInfo });
        }).catch((error) => {
            if (!this.enabled || this.validation || generation !== this.generation) return;
            const reason = error && error.message ? error.message : String(error);
            this.reader.stop();
            this.retryAt = Date.now() + 5000;
            this.log.warn(`HUD simple: ${reason}`);
            this.hud.send({ cmd: 'nav-error', reason });
        }).then(() => { this.busy = false; });
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.enabled = false;
        this.reader.stop();
        this._stopParkingReader();
        this.hud.close();
    }
}

module.exports = { StructuredHud, HUD_PATH };
