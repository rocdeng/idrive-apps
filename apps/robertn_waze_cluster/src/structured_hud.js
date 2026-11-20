'use strict';

const EventEmitter = require('events');
const { LineSocket } = require('./waze_cluster_control.js');
const nav = require('./hud_navigation.js');
const renderer = require('./hud_renderer.js');
const Font = require('./hud_font.js');
const Output = require('./hud_output.js');
const scenarios = require('./hud_validation_scenarios.js');
const { HudTrafficReader } = require('./hud_traffic_reader.js');

/* 跟随 app 的后台生命周期，独立于设置页面；只把新查询的完整状态交给绘制器。 */
class StructuredHud extends EventEmitter {
    constructor(options) {
        super();
        const o = options;
        this.reader = o.reader;
        this.traffic = o.traffic || new HudTrafficReader();
        this.outputFactory = o.outputFactory || ((keepShown, onState) => new Output(undefined, keepShown, onState));
        this.log = o.log || { info() {}, warn() {} };
        this.font = null;
        this.interval = o.intervalMs || 500;
        this.staleMs = o.staleMs || 5000;
        this.enabled = false;
        this.supported = false;
        this.state = 'off';
        this.keepShown = null;
        this.output = null;
        this.suspended = true;
        this.frame = null;
        this.drawKey = null;
        this.lastRead = 0;
        this.busy = false;
        this.generation = 0;
        this.retryAt = 0;
        this.timer = null;
        this.validation = null;
        o.control.simpleHud = this;
        this.patch = new LineSocket({ path: o.patchPath || o.control.patch.path, retryMs: o.retryMs,
            log: this.log, onMessage: (msg) => {
                if (msg.ev === 'map-settings') this.settings(msg.settings);
            } });
        this.patch.on('connect', () => this.patch.send({ cmd: 'hud-simple-status' }));
        this.patch.on('close', () => this.settings(null));
    }

    start() {
        if (this.timer) return;
        this.patch.open();
        this.timer = setInterval(() => this.tick(), this.interval);
    }

    settings(settings) {
        const previousSupport = this.supported;
        const previousKeepShown = this.keepShown;
        this.supported = !!settings && (settings.hud_simple === 0 || settings.hud_simple === 1);
        const keepShown = settings && settings.hud_keep_shown;
        this.keepShown = keepShown === 0 || keepShown === 1 ? keepShown === 1 : null;
        const enabled = this.supported && settings.hud_simple === 1 && settings.hud === 0;
        if (this.enabled !== enabled) {
            this.enabled = enabled;
            this.generation++;
            this.reader.stop();
            this.lastRead = 0;
            this.retryAt = 0;
            this.suspend();
            this.suspended = !enabled;
            this.state = enabled ? 'waiting' : 'off';
            this.emit('change');
        } else if (previousSupport !== this.supported || previousKeepShown !== this.keepShown) {
            if (this.output && previousKeepShown !== this.keepShown) this.output.setKeepShown(this.keepShown === true);
            this.emit('change');
        }
    }

    /* 切回地图时先销毁连接，不能让 renderer 重连后重放旧导航。 */
    suspend() {
        this.suspended = true;
        this.traffic.reset();
        this.generation++;
        this.validation = null;
        this.frame = null;
        this.drawKey = null;
        if (this.output) this.output.close();
        this.output = null;
    }

    hide(state) {
        this.traffic.reset();
        this.drawKey = null;
        if (this.frame) {
            this.frame = null;
            if (this.output) this.output.update(null, false);
        }
        if (this.state !== state) { this.state = state; this.emit('change'); }
    }

    startValidation() {
        if (!this.enabled || this.suspended || this.validation) return;
        this.reader.stop();
        this.suspend();
        this.suspended = false;
        this.lastRead = 0;
        this.retryAt = 0;
        this.validation = { index: 0, since: null };
        this.state = 'unavailable';
        this.emit('change');
        this.tick();
    }

    stopValidation() {
        if (!this.validation) return;
        this.reader.stop();
        this.suspend();
        this.suspended = !this.enabled;
        this.lastRead = 0;
        this.retryAt = 0;
        this.state = this.enabled ? 'waiting' : 'off';
        this.emit('change');
    }

    validationProgress() {
        return this.validation ? [this.validation.index + 1, scenarios.length] : null;
    }

    draw(state, label) {
        const key = JSON.stringify([state, label]);
        if (this.drawKey === key) return;
        if (!this.font) this.font = new Font(require('./hud_font_data.js'));
        const frame = Buffer.from(renderer.render(state, this.font, label));
        const changed = !this.frame || !this.frame.equals(frame);
        this.drawKey = key;
        this.frame = frame;
        if (!this.output) {
            const generation = this.generation;
            if (this.state !== 'unavailable') { this.state = 'unavailable'; this.emit('change'); }
            this.output = this.outputFactory(this.keepShown === true, (status) => {
                if (!this.enabled || this.suspended || !this.frame || generation !== this.generation) return;
                if (this.state !== status) { this.state = status; this.emit('change'); }
            });
        }
        if (changed) this.output.update(frame, true);
    }

    tickValidation() {
        const v = this.validation;
        let state = nav.fromInput(scenarios[v.index].input);
        // 图层被拒绝、断连或向弹窗让位时，不跳过尚未观察的场景。
        if (this.state === 'showing' || state.state === 'inactive') {
            if (v.since === null) v.since = Date.now();
            if (Date.now() - v.since >= 5000) {
                if (++v.index === scenarios.length) { this.stopValidation(); return; }
                v.since = null;
                this.emit('change');
                state = nav.fromInput(scenarios[v.index].input);
            }
        } else v.since = null;
        if (state.state === 'inactive') this.hide('waiting');
        else this.draw(state, 'TEST ' + (v.index + 1) + '/' + scenarios.length);
    }

    tick() {
        if (!this.enabled || this.suspended) return;
        if (this.validation) { this.tickValidation(); return; }
        if (this.lastRead && Date.now() - this.lastRead > this.staleMs) this.hide('unavailable');
        if (this.busy || Date.now() < this.retryAt) return;
        this.busy = true;
        const generation = this.generation;
        Promise.resolve().then(() => this.reader.read()).then(async (reply) => {
            if (!this.enabled || this.suspended || generation !== this.generation) return;
            const state = nav.fromBmw(reply);
            this.lastRead = Date.now();
            this.retryAt = 0;
            if (state.state === 'inactive') { this.hide('waiting'); return; }
            state.trafficLight = await this.traffic.read();
            if (this.enabled && !this.suspended && generation === this.generation) this.draw(state);
        }).catch((error) => {
            if (!this.enabled || generation !== this.generation) return;
            this.hide('unavailable');
            this.reader.stop();
            this.retryAt = Date.now() + 5000;
            this.log.warn(`HUD simple: ${error && error.message}`);
        }).then(() => { this.busy = false; });
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.enabled = false;
        this.reader.stop();
        this.patch.close();
        this.suspend();
    }
}

module.exports = { StructuredHud };
