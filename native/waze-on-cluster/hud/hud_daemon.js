// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';

/*
 * Native simple HUD daemon (waze-on-cluster-hud.service).
 * Runs as hmi_5000 (SupplementaryGroups=tm_oap_app), owns font unpacking,
 * 800x480 RGBA rendering, parked validation, Baidu traffic light recognition,
 * and direct output to /dev/shm/cluster-render/render.sock.
 *
 * The OAP app (robertn_waze_cluster) connects over /dev/shm/waze-on-cluster/hud.sock
 * as a thin bridge: sends validation start/stop commands, forwards BMW
 * GuidanceEventList navigation snapshots, and displays status pushed from here.
 */
var fs = require('fs');
var net = require('net');
var path = require('path');
var EventEmitter = require('events');

var nav = require('./hud_navigation.js');
var renderer = require('./hud_renderer.js');
var Font = require('./hud_font.js');
var Output = require('./hud_output.js');
var scenarios = require('./hud_validation_scenarios.js');
var HudTrafficReader = require('./hud_traffic_reader.js').HudTrafficReader;
var NativeGuidanceReader = require('./hud_someip_guidance.js').NativeGuidanceReader;

var HUD_SOCK = process.env.WOC_HUD_SOCK || '/dev/shm/waze-on-cluster/hud.sock';
var PATCH_SOCK = process.env.WOC_PATCH_SOCK || '/dev/shm/waze-on-cluster/patch.sock';
var RENDER_SOCK = process.env.WOC_RENDER_SOCK || '/dev/shm/cluster-render/render.sock';
var LOG_FILE = process.env.WOC_HUD_LOG === '' ? null : (process.env.WOC_HUD_LOG || '/var/opt/waze-on-cluster/log/hud-simple.log');
var LOG_MAX_BYTES = 512 * 1024;
var MAX_LINE = 64 * 1024;
var PARKING_TIMEOUT_MS = 1500;
var LANE_LOG_INTERVAL_MS = 30000;
// 开始导航时车机会有一两次查询返回空事件表。空表持续这么久才算导航结束，避免 HUD 闪一下。
var NAV_END_GRACE_MS = 1500;
function monotonicMs() {
    var time = process.hrtime();
    return time[0] * 1000 + time[1] / 1000000;
}

function createLogger(filePath) {
    function write(level, msg) {
        var line = new Date().toISOString() + ' [' + level + '] ' + msg;
        if (level === 'WARN' || level === 'ERROR') console.error(line);
        else console.log(line);
        if (!filePath) return;
        try {
            var st = null;
            try { st = fs.statSync(filePath); } catch (_) { st = null; }
            if (st && st.size > LOG_MAX_BYTES) {
                try { fs.renameSync(filePath, filePath + '.1'); } catch (_) {}
            }
            fs.appendFileSync(filePath, line + '\n');
        } catch (_) {
            /* journald still receives stdout/stderr */
        }
    }
    return {
        info: function(msg) { write('INFO', msg); },
        warn: function(msg) { write('WARN', msg); },
        error: function(msg) { write('ERROR', msg); }
    };
}

function LineClient(opts) {
    EventEmitter.call(this);
    this.path = opts.path;
    this.retryMs = opts.retryMs || 2000;
    this.log = opts.log;
    this.onMessage = opts.onMessage || function() {};
    this._open = false;
    this._socket = null;
    this._timer = null;
    this._buf = '';
    this._lastErr = null;
}
LineClient.prototype = Object.create(EventEmitter.prototype);
LineClient.prototype.open = function() {
    if (this._open) return;
    this._open = true;
    this._connect();
};
LineClient.prototype.close = function() {
    this._open = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._socket) {
        this._socket.removeAllListeners();
        this._socket.destroy();
        this._socket = null;
    }
};
LineClient.prototype.send = function(obj) {
    if (this._socket && !this._socket.destroyed) {
        try { this._socket.write(JSON.stringify(obj) + '\n'); } catch (_) {}
    }
};
LineClient.prototype._connect = function() {
    if (!this._open || this._socket) return;
    var self = this;
    var sock = net.connect(this.path);
    this._socket = sock;
    this._buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', function() {
        if (self._socket !== sock) return;
        self._lastErr = null;
        self.log.info('connected to ' + self.path);
        self.emit('connect');
    });
    sock.on('data', function(chunk) {
        if (self._socket !== sock) return;
        self._buf += chunk;
        if (self._buf.length > MAX_LINE) { self._buf = ''; return; }
        var nl;
        while ((nl = self._buf.indexOf('\n')) >= 0) {
            var line = self._buf.slice(0, nl).trim();
            self._buf = self._buf.slice(nl + 1);
            if (!line) continue;
            try { self.onMessage(JSON.parse(line)); } catch (_) {}
        }
    });
    sock.on('error', function(err) {
        if (self._socket !== sock) return;
        var code = err ? (err.code || err.message) : 'error';
        if (code !== self._lastErr) {
            self._lastErr = code;
            self.log.warn(self.path + ': ' + code);
        }
    });
    sock.on('close', function() {
        if (self._socket !== sock) return;
        self._socket = null;
        self.emit('close');
        if (self._open && !self._timer) {
            self._timer = setTimeout(function() { self._timer = null; self._connect(); }, self.retryMs);
        }
    });
};

function HudEngine(options) {
    EventEmitter.call(this);
    var o = options || {};
    var self = this;
    this.log = o.log || createLogger(null);
    this.traffic = o.traffic || new HudTrafficReader(undefined, undefined, this.log);
    this.nativeGuidance = o.nativeGuidance !== undefined ? o.nativeGuidance : new NativeGuidanceReader({
        log: this.log,
        onAvailability: function(up) { self._onNativeAvailability(up); }
    });
    this.renderSocket = o.renderSocket || RENDER_SOCK;
    this.outputFactory = o.outputFactory || ((keepShown, onState, layout) => new Output(this.renderSocket, keepShown, onState, this.log, layout));
    this.fontLoader = o.fontLoader || (() => new Font(require('./hud_font_data.js')));
    this.intervalMs = o.intervalMs || 500;
    this.staleMs = o.staleMs || 5000;
    this.navEndGraceMs = o.navEndGraceMs !== undefined ? o.navEndGraceMs : NAV_END_GRACE_MS;
    this.validationStepMs = o.validationStepMs || 5000;

    this.font = null;
    this.supported = false;
    this.enabled = false;
    this.suspended = true;
    this.keepShown = null;
    this.hudWidthPct = null;
    this.hudOffsetX = null;
    this.hudOffsetY = null;
    this.hudFontPct = null;
    this.hudStyle = null;
    this.state = 'off';
    this.reason = '';
    this.output = null;
    this.frame = null;
    this.drawKey = null;
    this.lastState = null;
    this.lastLabel = undefined;
    this.lastNav = 0;
    this.idleReason = '';
    this.lastOapNav = 0;
    this.oapState = null;
    this.nativeState = null;
    this.nativeAt = 0;
    this.navRevision = 0;
    this.nextNav = null;
    this.clock = o.clock || monotonicMs;
    this.laneLogTimes = Object.create(null);
    this.nativeBusy = false;
    this.nativeRetryAt = 0;
    this.nativeVerified = false;
    this.nativeInactiveSince = null;
    this.maneuverKey = '';
    this.maneuverInitialM = null;
    this.generation = 0;
    this.validation = null;
    this.timer = null;
    this.navBusy = false;
}
HudEngine.prototype = Object.create(EventEmitter.prototype);

HudEngine.prototype._onNativeAvailability = function(up) {
    if (up) this.nativeRetryAt = 0;
    else {
        this.nativeVerified = false;
        this.nativeState = null;
    }
    this._changed();
    if (up && this.enabled && !this.suspended && !this.validation) this.tick();
};

HudEngine.prototype.layout = function() {
    return { widthPct: this.hudWidthPct, offsetX: this.hudOffsetX, offsetY: this.hudOffsetY };
};

HudEngine.prototype.status = function() {
    return {
        ev: 'status',
        supported: this.supported,
        enabled: this.enabled,
        suspended: this.suspended,
        state: this.state,
        reason: this.reason,
        keep_shown: this.keepShown,
        hud_width_pct: this.hudWidthPct,
        hud_offset_x: this.hudOffsetX,
        hud_offset_y: this.hudOffsetY,
        hud_simple_font_pct: this.hudFontPct,
        hud_simple_style: this.hudStyle,
        native_guidance: !!(this.nativeGuidance && this.nativeGuidance.available && this.nativeVerified),
        native_needs_lanes: !!(this.nativeState && !this.nativeState.lanes.length),
        validation: this.validation ? [this.validation.index + 1, scenarios.length] : null
    };
};

HudEngine.prototype._changed = function() {
    this.emit('change', this.status());
};

HudEngine.prototype.start = function() {
    if (this.timer) return;
    var self = this;
    this.timer = setInterval(function() { self.tick(); }, this.intervalMs);
};

HudEngine.prototype.stop = function() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.enabled = false;
    this.suspend();
};

HudEngine.prototype.settings = function(settings) {
    var prevSupport = this.supported;
    var prevKeepShown = this.keepShown;
    var prevLayout = [this.hudWidthPct, this.hudOffsetX, this.hudOffsetY].join(',');
    var prevFont = this.hudFontPct;
    var prevStyle = this.hudStyle;
    this.supported = !!settings && (settings.hud_simple === 0 || settings.hud_simple === 1);
    var keepShown = settings && settings.hud_keep_shown;
    this.keepShown = keepShown === 0 || keepShown === 1 ? keepShown === 1 : null;
    this.hudWidthPct = settings && typeof settings.hud_simple_width_pct === 'number' ? settings.hud_simple_width_pct
        : settings && typeof settings.hud_width_pct === 'number' ? settings.hud_width_pct : null;
    this.hudOffsetX = settings && typeof settings.hud_simple_offset_x === 'number' ? settings.hud_simple_offset_x
        : settings && typeof settings.hud_offset_x === 'number' ? settings.hud_offset_x : null;
    this.hudOffsetY = settings && typeof settings.hud_simple_offset_y === 'number' ? settings.hud_simple_offset_y
        : settings && typeof settings.hud_offset_y === 'number' ? settings.hud_offset_y : null;
    this.hudFontPct = settings && typeof settings.hud_simple_font_pct === 'number' ? settings.hud_simple_font_pct : (this.supported ? 0 : null);
    var style = settings && settings.hud_simple_style;
    this.hudStyle = Number.isInteger(style) && style >= 2 && style <= 6 ? style : (this.supported ? 2 : null);
    var nextLayout = [this.hudWidthPct, this.hudOffsetX, this.hudOffsetY].join(',');
    var enabled = this.supported && settings.hud_simple === 1 && settings.hud === 0;
    if (this.enabled !== enabled) {
        this.log.info('settings: enabled=' + enabled + ' keep_shown=' + this.keepShown + ' layout=' + nextLayout + ' font=' + this.hudFontPct + ' style=' + this.hudStyle);
        this.enabled = enabled;
        this.generation++;
        this.lastNav = 0;
        this.suspend();
        this.suspended = !enabled;
        this.state = enabled ? 'waiting' : 'off';
        this.reason = '';
        this._changed();
    } else if (prevSupport !== this.supported || prevKeepShown !== this.keepShown || prevLayout !== nextLayout || prevFont !== this.hudFontPct || prevStyle !== this.hudStyle) {
        if (this.output && prevKeepShown !== this.keepShown) this.output.setKeepShown(this.keepShown === true);
        if (this.output && prevLayout !== nextLayout && typeof this.output.setLayout === 'function') this.output.setLayout(this.layout());
        if ((prevFont !== this.hudFontPct || prevStyle !== this.hudStyle) && this.lastState && this.frame) this.draw(this.lastState, this.lastLabel);
        this._changed();
    }
};

HudEngine.prototype.suspend = function() {
    var hadChange = !this.suspended || this.validation !== null || this.output !== null;
    this.suspended = true;
    this.traffic.reset();
    if (this.nativeGuidance) this.nativeGuidance.stop();
    this.nativeRetryAt = 0;
    this.nativeVerified = false;
    this.nativeInactiveSince = null;
    this.laneLogTimes = Object.create(null);
    this.nativeState = null;
    this.oapState = null;
    this.idleReason = '';
    this.lastOapNav = 0;
    this.navRevision++;
    this.nextNav = null;
    this.maneuverKey = '';
    this.maneuverInitialM = null;
    this.generation++;
    this.validation = null;
    this.frame = null;
    this.drawKey = null;
    if (this.output) {
        this.log.info('closing cluster-render output');
        this.output.close();
    }
    this.output = null;
    if (hadChange) this._changed();
};

HudEngine.prototype.hide = function(state, reason) {
    this.drawKey = null;
    if (this.frame) {
        this.frame = null;
        if (this.output) this.output.update(null, false);
    }
    var nextReason = reason || '';
    if (this.state !== state || this.reason !== nextReason) {
        this.state = state;
        this.reason = nextReason;
        this._changed();
    }
};

HudEngine.prototype.endNavigation = function(reason) {
    this.idleReason = reason || '';
    if (this.lastNav) {
        this.lastNav = 0;
        this.navRevision++;
        this.nextNav = null;
        this.maneuverKey = '';
        this.maneuverInitialM = null;
    }
    if (!this.frame || this.lastState.state !== 'cruising') {
        this.hide(this.idleReason ? 'unavailable' : 'waiting', this.idleReason);
    }
};

HudEngine.prototype.startValidation = function(owner, parked) {
    if (!owner || parked !== true || !this.enabled || this.suspended || this.validation) {
        this.log.warn('startValidation ignored: enabled=' + this.enabled + ' suspended=' + this.suspended + ' validation=' + !!this.validation);
        return;
    }
    this.log.info('starting parked HUD validation (' + scenarios.length + ' scenarios)');
    this.suspend();
    this.suspended = false;
    this.lastNav = 0;
    this.validation = { index: 0, since: null, owner: owner, parkedUntil: this.clock() + PARKING_TIMEOUT_MS };
    this.state = 'unavailable';
    this.reason = 'starting validation';
    this._changed();
    this.tick();
};

HudEngine.prototype.updateParking = function(owner, parked) {
    if (!this.validation || this.validation.owner !== owner) return;
    if (parked !== true || this.clock() >= this.validation.parkedUntil) this.stopValidation();
    else this.validation.parkedUntil = this.clock() + PARKING_TIMEOUT_MS;
};

HudEngine.prototype.stopValidation = function() {
    if (!this.validation) return;
    this.log.info('stopping parked HUD validation');
    this.suspend();
    this.suspended = !this.enabled;
    this.lastNav = 0;
    this.state = this.enabled ? 'waiting' : 'off';
    this.reason = '';
    this._changed();
};

HudEngine.prototype.draw = function(state, label) {
    var key = JSON.stringify([state, label, this.hudFontPct, this.hudStyle]);
    if (this.drawKey === key) return;
    try {
        if (!this.font) {
            this.log.info('loading HUD font data');
            this.font = this.fontLoader();
        }
        var frame = Buffer.from(renderer.render(state, this.font, label, this.hudFontPct, this.hudStyle));
        var changed = !this.frame || !this.frame.equals(frame);
        this.drawKey = key;
        this.lastState = state;
        this.lastLabel = label;
        this.frame = frame;
        if (!this.output) {
            var self = this;
            var generation = this.generation;
            if (this.state !== 'unavailable') {
                this.state = 'unavailable';
                this.reason = 'connecting to cluster-render';
                this._changed();
            }
            this.output = this.outputFactory(this.keepShown === true, function(status, reason) {
                if (!self.enabled || self.suspended || !self.frame || generation !== self.generation) return;
                var nextReason = reason || '';
                if (self.state !== status || self.reason !== nextReason) {
                    self.state = status;
                    self.reason = nextReason;
                    self._changed();
                }
            }, this.layout());
        }
        if (changed) this.output.update(frame, true);
    } catch (err) {
        var msg = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
        this.log.error('draw failed: ' + msg);
        this.state = 'unavailable';
        this.reason = 'render error: ' + (err && err.message ? err.message : String(err));
        this._changed();
    }
};

HudEngine.prototype.tickValidation = function() {
    var v = this.validation;
    var state = nav.fromInput(scenarios[v.index].input);
    if (this.state === 'showing' || state.state === 'inactive') {
        if (v.since === null) v.since = Date.now();
        if (Date.now() - v.since >= this.validationStepMs) {
            if (++v.index === scenarios.length) { this.stopValidation(); return; }
            v.since = null;
            this._changed();
            state = nav.fromInput(scenarios[v.index].input);
        }
    } else {
        v.since = null;
    }
    if (state.state === 'inactive') this.hide('waiting', '');
    else this.draw(state, 'TEST ' + (v.index + 1) + '/' + scenarios.length);
};

HudEngine.prototype.handleNav = function(rawState) {
    if (!this.enabled || this.suspended || this.validation) return;
    if (rawState && rawState.state === 'navigating' && this.nativeGuidance) {
        var info = this.nativeGuidance;
        var road = !rawState.currentRoad && info.currentRoad && info.currentRoad();
        if (road) rawState = Object.assign({}, rawState, { currentRoad: road });
        if (info.guidanceField && info.guidanceField('state') === 'CALCULATING_ROUTE') {
            rawState = { state: 'rerouting' };
        } else if (info.guidanceField) {
            var destination = info.guidanceField('destination');
            if (destination) rawState = Object.assign({}, rawState, {
                arrivalClock: destination.arrivalClock,
                remainingTimeS: destination.remainingTimeS === null ? rawState.remainingTimeS : destination.remainingTimeS
            });
            if (rawState.direction && rawState.direction !== 'arrive' && (!rawState.lanes || !rawState.lanes.length)) {
                var laneContext = [rawState.maneuverId || rawState.maneuverPositionM, rawState.direction].join('/');
                var currentLane = info.guidanceField('lanes', laneContext);
                if (currentLane) {
                    var lanes = nav.bmwLanes(currentLane);
                    var lanePosition = lanes.length ? nav.currentLanePosition(currentLane, rawState.maneuverPositionM) : '';
                    if (!lanes.length) {
                        this.logLaneStatus('current', 'no-directions');
                    } else if (lanePosition === 'mismatch') {
                        // 当前车道可能还是刚过的路口或下一个路口，不能挂到这个转向上。
                        this.logLaneStatus('current', 'position-mismatch', 'lanePositionM=' + currentLane.distanceToDestination +
                            ' lengthM=' + currentLane.length + ' maneuverPositionM=' + rawState.maneuverPositionM);
                    } else {
                        this.logLaneStatus('current', lanePosition === 'matched' ? 'used-single-row' : 'used-without-position',
                            'selectedLanes=' + lanes.length);
                        rawState = Object.assign({}, rawState, { lanes: lanes });
                    }
                }
            }
        }
    }
    var state = nav.snapshot(rawState);
    if (state.state === 'inactive') {
        this.endNavigation('');
        return;
    }
    this.lastNav = Date.now();
    /* 当上游未提供初始路段距离时，按当前路口跟踪初始距离以驱动进度条。 */
    if (state.state === 'navigating' && state.initialDistanceM === null && state.distanceM !== null) {
        var mKey = [state.maneuverId, state.direction, state.roundaboutExit, state.nextRoad, state.instruction].join('|');
        if (mKey !== this.maneuverKey || this.maneuverInitialM === null || state.distanceM > this.maneuverInitialM) {
            this.maneuverKey = mKey;
            this.maneuverInitialM = state.distanceM;
        }
        if (this.maneuverInitialM > 0) state.initialDistanceM = this.maneuverInitialM;
    }
    if (this.navBusy) {
        this.nextNav = state;
        return;
    }
    this.readTraffic(state);
};

HudEngine.prototype.readTraffic = function(state) {
    this.navBusy = true;
    var self = this;
    var revision = this.navRevision;
    Promise.resolve().then(function() {
        return self.traffic.read();
    }).catch(function(err) {
        self.log.warn('traffic read error: ' + (err && err.message ? err.message : String(err)));
        return null;
    }).then(function(alerts) {
        if (revision !== self.navRevision || self.nextNav) return;
        if (state.state === 'cruising') {
            var guidance = self.nativeGuidance;
            var road = alerts && guidance && guidance.currentRoad ? guidance.currentRoad() : '';
            if (!alerts || (!road && !alerts.trafficLight && alerts.speedLimitKmh == null)) {
                self.hide(self.idleReason ? 'unavailable' : 'waiting', self.idleReason);
                return;
            }
            state.currentRoad = road;
        }
        if (alerts) {
            state.trafficLight = alerts.trafficLight;
            if (state.speedLimitKmh == null) state.speedLimitKmh = alerts.speedLimitKmh;
        }
        self.draw(state);
    }).then(function() {
        self.navBusy = false;
        var next = self.nextNav;
        self.nextNav = null;
        if (next) self.readTraffic(next);
    });
};

HudEngine.prototype.logLaneStatus = function(source, status, counts) {
    var key = source + '/' + status;
    var now = this.clock(), last = this.laneLogTimes[key];
    if (last !== undefined && now - last < LANE_LOG_INTERVAL_MS) return;
    this.laneLogTimes[key] = now;
    this.log.info('HUD lanes ' + source + ': ' + status + (counts ? ' ' + counts : ''));
};

HudEngine.prototype.logLaneInput = function(source, state, info, rejected) {
    // 只记录计数。编号有重叠的原生事件可能是其他类型，所以单独记录解码失败的候选数。
    if (!info || !['received', 'eligible', 'matched'].every(function(key) {
        var n = info[key];
        return Number.isInteger(n) && n >= 0 && n <= 65535;
    })) return;
    if (state.state === 'inactive' && !info.received && !rejected) {
        if (source === 'OAP' && this.nativeVerified) this.logLaneStatus(source, 'no-maneuver');
        return;
    }
    var status = 'position-mismatch';
    if (state.lanes.length) status = 'matched';
    else if (!info.received) status = rejected ? 'decode-rejected' : 'no-event';
    else if (!info.eligible) status = 'empty-or-unreliable';
    else if (state.state === 'inactive') status = 'no-maneuver';
    else if (info.matched > 1) status = 'ambiguous-position';
    else if (info.matched === 1) status = 'no-directions';
    var gap = info.closestGapM;
    var gapText = status === 'position-mismatch' && typeof gap === 'number' && isFinite(gap) && gap >= 0
        ? ' closestGapM=' + (gap < 0.001 ? '<0.001' : gap.toFixed(3)) : '';
    this.logLaneStatus(source, status, 'received=' + info.received + ' eligible=' + info.eligible +
        ' matched=' + info.matched + ' selectedLanes=' + state.lanes.length + ' rejectedCandidates=' + (rejected || 0) + gapText);
};

HudEngine.prototype.withOapLanes = function(state) {
    var oap = this.oapState;
    if (state.lanes.length || !oap || !oap.lanes.length || Date.now() - this.lastOapNav >= this.staleMs) return state;
    if (!nav.lanePositionMatches(state.maneuverPositionM, oap.maneuverPositionM) ||
        !state.direction || state.direction !== oap.direction) {
        this.logLaneStatus('merge', 'maneuver-mismatch');
        return state;
    }
    this.logLaneStatus('merge', 'used-OAP');
    return Object.assign({}, state, { lanes: oap.lanes });
};

HudEngine.prototype.withinNativeEndGrace = function() {
    return !!this.lastNav && this.nativeInactiveSince !== null &&
        this.clock() - this.nativeInactiveSince < this.navEndGraceMs;
};

HudEngine.prototype.handleOapNav = function(rawState, laneInfo) {
    if (!this.enabled || this.suspended || this.validation) return;
    var state = nav.snapshot(rawState);
    this.logLaneInput('OAP', state, laneInfo);
    this.oapState = state.state === 'inactive' ? null : state;
    this.lastOapNav = this.oapState ? Date.now() : 0;
    if (this.nativeVerified && this.nativeState && Date.now() - this.nativeAt < this.staleMs) {
        if (!this.nativeState.lanes.length) this.handleNav(this.withOapLanes(this.nativeState));
        return;
    }
    if (state.state !== 'inactive' || !this.withinNativeEndGrace()) this.handleNav(state);
};

HudEngine.prototype.handleNavError = function(reason) {
    if (!this.enabled || this.suspended || this.validation) return;
    var hadOapLanes = this.oapState && this.oapState.lanes.length;
    this.oapState = null;
    this.lastOapNav = 0;
    if (this.nativeVerified && this.nativeState && Date.now() - this.nativeAt < this.staleMs) {
        var code = ['queryContent INVALID_VIEW_PARAMS', 'queryContent UNKNOWN_VIEW_ID', 'queryContent rejected'].indexOf(reason) >= 0 ? reason : 'query-failed';
        this.logLaneStatus('OAP', code);
        if (hadOapLanes && !this.nativeState.lanes.length) this.handleNav(this.nativeState);
        return;
    }
    if (this.withinNativeEndGrace()) return;
    this.log.warn('navigation error from OAP: ' + (reason || 'unknown'));
    this.endNavigation(reason || 'navigation unavailable');
};

HudEngine.prototype.tick = function() {
    if (!this.enabled || this.suspended) return;
    if (this.validation) {
        if (this.clock() >= this.validation.parkedUntil) this.stopValidation();
        else this.tickValidation();
        return;
    }
    var now = Date.now();
    if (this.lastNav && now - this.lastNav > this.staleMs) {
        this.endNavigation('navigation stale');
    }
    /* 原生 vsomeip 直连 GuidanceEventList：不依赖 OAP 是否打开，开机即可自动取数。 */
    if (this.nativeGuidance && this.nativeGuidance.supported() && !this.nativeBusy && now >= this.nativeRetryAt) {
        this.nativeBusy = true;
        var self = this;
        var generation = this.generation;
        Promise.resolve().then(function() {
            return self.nativeGuidance.read();
        }).then(function(reply) {
            if (!self.enabled || self.suspended || self.validation || generation !== self.generation) return;
            self.nativeRetryAt = 0;
            var laneInfo = {};
            var parsed = nav.fromBmw(reply, laneInfo);
            self.logLaneInput('native', parsed, laneInfo, reply && reply.laneRejected);
            if (parsed.state !== 'inactive') {
                var changed = !self.nativeVerified || !self.nativeState ||
                    !!self.nativeState.lanes.length !== !!parsed.lanes.length;
                self.nativeVerified = true;
                self.nativeInactiveSince = null;
                self.nativeState = parsed;
                self.nativeAt = Date.now();
                if (changed) self._changed();
                self.handleNav(self.withOapLanes(parsed));
            } else {
                self.nativeState = null;
                if (self.nativeVerified) {
                    self.nativeVerified = false;
                    self._changed();
                }
                if (self.nativeInactiveSince === null) self.nativeInactiveSince = self.clock();
                if (!self.withinNativeEndGrace() && (!self.lastOapNav || Date.now() - self.lastOapNav > self.staleMs)) {
                    /* 原生未解出有效事件时，不覆盖 OAP 正在推送的实时导航，也不抢占 OAP 轮询。 */
                    self.handleNav(parsed);
                }
            }
        }, function(err) {
            if (!self.enabled || self.suspended || self.validation || generation !== self.generation) return;
            self.nativeState = null;
            if (self.nativeVerified) {
                self.nativeVerified = false;
                self._changed();
            }
            self.nativeRetryAt = Date.now() + 3000;
            if (!self.lastOapNav || Date.now() - self.lastOapNav > self.staleMs) {
                self.endNavigation(err && err.message ? err.message : 'native guidance unavailable');
            }
        }).then(function() {
            self.nativeBusy = false;
        });
    }
    // 巡航可独立取投屏帧，即使车机导航服务尚未返回转向。
    if (!this.lastNav && !this.navBusy) this.readTraffic({ state: 'cruising' });
};

function startDaemon(opts) {
    var o = opts || {};
    var log = o.log || createLogger(o.logFile !== undefined ? o.logFile : LOG_FILE);
    var engine = new HudEngine({
        log: log,
        renderSocket: o.renderSocket || RENDER_SOCK,
        outputFactory: o.outputFactory,
        fontLoader: o.fontLoader,
        traffic: o.traffic,
        nativeGuidance: o.nativeGuidance,
        intervalMs: o.intervalMs,
        staleMs: o.staleMs,
        validationStepMs: o.validationStepMs
    });
    var clients = new Set();

    function send(sock, obj) {
        if (!sock.destroyed) {
            try { sock.write(JSON.stringify(obj) + '\n'); } catch (_) {}
        }
    }
    function broadcast(status) {
        clients.forEach(function(sock) { send(sock, status); });
    }
    engine.on('change', broadcast);

    var patch = new LineClient({
        path: o.patchSocket || PATCH_SOCK,
        retryMs: o.retryMs || 2000,
        log: log,
        onMessage: function(msg) {
            if (msg && msg.ev === 'map-settings') engine.settings(msg.settings);
        }
    });
    patch.on('connect', function() { patch.send({ cmd: 'hud-simple-status' }); });
    patch.on('close', function() { engine.settings(null); });

    var server = net.createServer(function(sock) {
        clients.add(sock);
        sock.setEncoding('utf8');
        var buf = '';
        send(sock, engine.status());
        sock.on('data', function(chunk) {
            buf += chunk;
            if (buf.length > MAX_LINE) { buf = ''; return; }
            var nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
                var line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                var msg;
                try { msg = JSON.parse(line); } catch (_) { continue; }
                if (!msg || typeof msg.cmd !== 'string') continue;
                if (msg.cmd === 'status') send(sock, engine.status());
                else if (msg.cmd === 'settings') engine.settings(msg.settings);
                else if (msg.cmd === 'validation-start') engine.startValidation(sock, msg.parked);
                else if (msg.cmd === 'validation-parking') engine.updateParking(sock, msg.parked);
                else if (msg.cmd === 'validation-stop') engine.updateParking(sock, false);
                else if (msg.cmd === 'suspend') engine.suspend();
                else if (msg.cmd === 'nav') engine.handleOapNav(msg.state, msg.laneInfo);
                else if (msg.cmd === 'nav-error') engine.handleNavError(msg.reason);
            }
        });
        sock.on('error', function() {});
        sock.on('close', function() {
            clients.delete(sock);
            engine.updateParking(sock, false);
        });
    });

    server.on('error', function(err) {
        log.error('hud control socket error: ' + (err && err.message ? err.message : String(err)));
    });

    var env = process.env;
    if (!o.hudSocket && env.LISTEN_FDS === '1' && Number(env.LISTEN_PID) === process.pid) {
        log.info('listening on systemd socket fd 3');
        server.listen({ fd: 3 });
    } else {
        var sockPath = o.hudSocket || HUD_SOCK;
        try { fs.mkdirSync(path.dirname(sockPath)); } catch (_) {}
        try { fs.unlinkSync(sockPath); } catch (_) {}
        server.listen(sockPath, function() {
            log.info('listening on ' + sockPath);
        });
    }

    patch.open();
    engine.start();
    log.info('waze-on-cluster-hud daemon started (uid=' + (process.getuid ? process.getuid() : '?') + ')');

    function close() {
        engine.stop();
        patch.close();
        clients.forEach(function(s) { s.destroy(); });
        clients.clear();
        server.close();
    }

    return { engine: engine, patch: patch, server: server, close: close };
}

if (require.main === module) {
    var daemon = startDaemon();
    process.on('SIGTERM', function() { daemon.close(); process.exit(0); });
    process.on('SIGINT', function() { daemon.close(); process.exit(0); });
}

module.exports = { HudEngine: HudEngine, startDaemon: startDaemon, HUD_SOCK: HUD_SOCK };
