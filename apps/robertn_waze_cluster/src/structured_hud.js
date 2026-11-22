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
        this.log = o.log || { info() {}, warn() {} };
        this.interval = o.intervalMs || 500;
        this.enabled = false;
        this.supported = false;
        this.state = 'off';
        this.reason = '';
        this.keepShown = null;
        this.hudWidthPct = null;
        this.hudOffset = null;
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
            this.keepShown !== null || this.hudWidthPct !== null || this.hudOffset !== null || this.validation !== null;
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
        this.nativeGuidance = false;
        this.validation = null;
        this.retryAt = 0;
        if (changed) this.emit('change');
    }

    _applyStatus(msg) {
        const prevKey = JSON.stringify([this.supported, this.enabled, this.suspended, this.state, this.keepShown, this.hudWidthPct, this.hudOffset, this.nativeGuidance, this.validation]);
        const prevReason = this.reason;
        this.supported = msg.supported === true;
        this.enabled = msg.enabled === true;
        this.suspended = msg.suspended !== false;
        this.state = typeof msg.state === 'string' ? msg.state : 'off';
        this.reason = typeof msg.reason === 'string' ? msg.reason : '';
        this.keepShown = typeof msg.keep_shown === 'boolean' ? msg.keep_shown : null;
        this.hudWidthPct = typeof msg.hud_width_pct === 'number' ? msg.hud_width_pct : null;
        this.hudOffset = typeof msg.hud_offset_x === 'number' && typeof msg.hud_offset_y === 'number' ? [msg.hud_offset_x, msg.hud_offset_y] : null;
        this.nativeGuidance = msg.native_guidance === true;
        this.validation = Array.isArray(msg.validation) && msg.validation.length === 2 ? msg.validation : null;
        if (!this.enabled || this.suspended || this.validation || this.nativeGuidance) {
            this.reader.stop();
            this.retryAt = 0;
        }
        if (this.state === 'unavailable' && this.reason && this.reason !== prevReason) {
            this.log.warn(`HUD simple unavailable: ${this.reason}`);
        }
        const nextKey = JSON.stringify([this.supported, this.enabled, this.suspended, this.state, this.keepShown, this.hudWidthPct, this.hudOffset, this.nativeGuidance, this.validation]);
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
        this.reader.stop();
        this.retryAt = 0;
        this.hud.send({ cmd: 'validation-start' });
    }

    stopValidation() {
        if (!this.validation) return;
        this.reader.stop();
        this.retryAt = 0;
        this.hud.send({ cmd: 'validation-stop' });
    }

    validationProgress() {
        return this.validation;
    }

    tick() {
        if (!this.enabled || this.suspended || this.validation || this.nativeGuidance || this.hud.link !== 'up') return;
        if (this.busy || Date.now() < this.retryAt) return;
        this.busy = true;
        const generation = this.generation;
        Promise.resolve().then(() => this.reader.read()).then((reply) => {
            if (!this.enabled || this.suspended || this.validation || generation !== this.generation) return;
            const state = nav.fromBmw(reply);
            this.retryAt = 0;
            this.hud.send({ cmd: 'nav', state });
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
        this.hud.close();
    }
}

module.exports = { StructuredHud, HUD_PATH };
