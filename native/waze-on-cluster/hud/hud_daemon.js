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

var HUD_SOCK = process.env.WOC_HUD_SOCK || '/dev/shm/waze-on-cluster/hud.sock';
var PATCH_SOCK = process.env.WOC_PATCH_SOCK || '/dev/shm/waze-on-cluster/patch.sock';
var RENDER_SOCK = process.env.WOC_RENDER_SOCK || '/dev/shm/cluster-render/render.sock';
var LOG_FILE = process.env.WOC_HUD_LOG === '' ? null : (process.env.WOC_HUD_LOG || '/var/opt/waze-on-cluster/log/hud-simple.log');
var LOG_MAX_BYTES = 512 * 1024;
var MAX_LINE = 64 * 1024;

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
    this.log = o.log || createLogger(null);
    this.traffic = o.traffic || new HudTrafficReader(undefined, undefined, this.log);
    this.renderSocket = o.renderSocket || RENDER_SOCK;
    this.outputFactory = o.outputFactory || ((keepShown, onState) => new Output(this.renderSocket, keepShown, onState, this.log));
    this.fontLoader = o.fontLoader || (() => new Font(require('./hud_font_data.js')));
    this.intervalMs = o.intervalMs || 500;
    this.staleMs = o.staleMs || 5000;
    this.validationStepMs = o.validationStepMs || 5000;

    this.font = null;
    this.supported = false;
    this.enabled = false;
    this.suspended = true;
    this.keepShown = null;
    this.state = 'off';
    this.reason = '';
    this.output = null;
    this.frame = null;
    this.drawKey = null;
    this.lastNav = 0;
    this.generation = 0;
    this.validation = null;
    this.timer = null;
    this.navBusy = false;
}
HudEngine.prototype = Object.create(EventEmitter.prototype);

HudEngine.prototype.status = function() {
    return {
        ev: 'status',
        supported: this.supported,
        enabled: this.enabled,
        suspended: this.suspended,
        state: this.state,
        reason: this.reason,
        keep_shown: this.keepShown,
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
    this.supported = !!settings && (settings.hud_simple === 0 || settings.hud_simple === 1);
    var keepShown = settings && settings.hud_keep_shown;
    this.keepShown = keepShown === 0 || keepShown === 1 ? keepShown === 1 : null;
    var enabled = this.supported && settings.hud_simple === 1 && settings.hud === 0;
    if (this.enabled !== enabled) {
        this.log.info('settings: enabled=' + enabled + ' keep_shown=' + this.keepShown);
        this.enabled = enabled;
        this.generation++;
        this.lastNav = 0;
        this.suspend();
        this.suspended = !enabled;
        this.state = enabled ? 'waiting' : 'off';
        this.reason = '';
        this._changed();
    } else if (prevSupport !== this.supported || prevKeepShown !== this.keepShown) {
        if (this.output && prevKeepShown !== this.keepShown) this.output.setKeepShown(this.keepShown === true);
        this._changed();
    }
};

HudEngine.prototype.suspend = function() {
    var hadChange = !this.suspended || this.validation !== null || this.output !== null;
    this.suspended = true;
    this.traffic.reset();
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
    this.traffic.reset();
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

HudEngine.prototype.startValidation = function() {
    if (!this.enabled || this.suspended || this.validation) {
        this.log.warn('startValidation ignored: enabled=' + this.enabled + ' suspended=' + this.suspended + ' validation=' + !!this.validation);
        return;
    }
    this.log.info('starting parked HUD validation (' + scenarios.length + ' scenarios)');
    this.suspend();
    this.suspended = false;
    this.lastNav = 0;
    this.validation = { index: 0, since: null };
    this.state = 'unavailable';
    this.reason = 'starting validation';
    this._changed();
    this.tick();
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
    var key = JSON.stringify([state, label]);
    if (this.drawKey === key) return;
    try {
        if (!this.font) {
            this.log.info('loading HUD font data');
            this.font = this.fontLoader();
        }
        var frame = Buffer.from(renderer.render(state, this.font, label));
        var changed = !this.frame || !this.frame.equals(frame);
        this.drawKey = key;
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
            });
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
    var state = nav.snapshot(rawState);
    this.lastNav = Date.now();
    if (state.state === 'inactive') {
        this.hide('waiting', '');
        return;
    }
    if (this.navBusy) return;
    this.navBusy = true;
    var self = this;
    var generation = this.generation;
    Promise.resolve().then(function() {
        return self.traffic.read();
    }).then(function(light) {
        if (!self.enabled || self.suspended || self.validation || generation !== self.generation) return;
        state.trafficLight = light;
        self.draw(state);
    }, function(err) {
        self.log.warn('traffic read error: ' + (err && err.message ? err.message : String(err)));
        if (self.enabled && !self.suspended && !self.validation && generation === self.generation) {
            self.draw(state);
        }
    }).then(function() {
        self.navBusy = false;
    });
};

HudEngine.prototype.handleNavError = function(reason) {
    if (!this.enabled || this.suspended || this.validation) return;
    this.log.warn('navigation error from OAP: ' + (reason || 'unknown'));
    this.hide('unavailable', reason || 'navigation unavailable');
};

HudEngine.prototype.tick = function() {
    if (!this.enabled || this.suspended) return;
    if (this.validation) { this.tickValidation(); return; }
    if (this.lastNav && Date.now() - this.lastNav > this.staleMs) {
        this.hide('unavailable', 'navigation stale');
    }
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
                else if (msg.cmd === 'validation-start') engine.startValidation();
                else if (msg.cmd === 'validation-stop') engine.stopValidation();
                else if (msg.cmd === 'suspend') engine.suspend();
                else if (msg.cmd === 'nav') engine.handleNav(msg.state);
                else if (msg.cmd === 'nav-error') engine.handleNavError(msg.reason);
            }
        });
        sock.on('error', function() {});
        sock.on('close', function() { clients.delete(sock); });
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
