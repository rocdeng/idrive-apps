// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';

/*
 * Native BMW GuidanceEventList (0xfb1b:0x0080, major 5) SOME/IP client.
 * Spawns /var/opt/waze-on-cluster/current/woc-guidance (running as hmi_5000,
 * whitelisted for 0xfb1b in /etc/vsomeip/5000_5000/vsomeip_security.json) and
 * encodes/decodes CommonAPI-SOME/IP getViewContent(["HUD.RB.Main"]) replies
 * directly into the structure consumed by hud_navigation.js:fromBmw().
 *
 * Node 8; zero external dependencies.
 */
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var METHOD_GET_VIEW_CONTENT = 0x0003;
var DEFAULT_VIEW = 'HUD.RB.Main';
var DEFAULT_BIN = process.env.WOC_GUIDANCE_BIN || path.join(__dirname, 'woc-guidance');

var DISTANCE_UNITS = { 0: 'NONE', 1: 'KM', 2: 'MILE_UK', 3: 'MILE_US', 4: 'METER', 5: 'YARD', 6: 'FEET' };
var SPEED_UNITS = { 1: 'KM_P_H', 2: 'MI_P_H_UK', 3: 'MI_P_H_US' };
var DIRECTIONS = {
    0: 'NONE', 1: 'STRAIGHT_ON', 2: 'LEFT', 3: 'SLIGHT_LEFT', 4: 'HARD_LEFT',
    5: 'RIGHT', 6: 'SLIGHT_RIGHT', 7: 'HARD_RIGHT', 8: 'UTURN_RIGHT', 9: 'UTURN_LEFT'
};
var MANEUVER_BY_FORWARD = {
    2: 'intersection', 4: 'branch', 5: 'roundabout',
    6: 'destinationManeuver', 12: 'laneChange', 16: 'passiveManeuver'
};
// CommonAPI-SOME/IP 3.1.12 numbers union members 1..N in reverse declaration order (22 members -> 23 - idx).
var MANEUVER_BY_REVERSE = {
    21: 'intersection', 19: 'branch', 18: 'roundabout',
    17: 'destinationManeuver', 11: 'laneChange', 7: 'passiveManeuver'
};

/* ---- SOME/IP binary helpers (big-endian, CommonAPI 3.1.12) ---------------- */

function encodeUtf8D(str, withBom) {
    var bom = withBom === false ? Buffer.alloc(0) : Buffer.from([0xef, 0xbb, 0xbf]);
    var body = Buffer.from(str, 'utf8');
    var nul = Buffer.from([0x00]);
    var total = bom.length + body.length + nul.length;
    var out = Buffer.alloc(4 + total);
    out.writeUInt32BE(total, 0);
    bom.copy(out, 4);
    body.copy(out, 4 + bom.length);
    nul.copy(out, 4 + bom.length + body.length);
    return out;
}

function encodeGetViewContent(viewIds, withBom) {
    var items = (viewIds || [DEFAULT_VIEW]).map(function(id) { return encodeUtf8D(id, withBom); });
    var body = Buffer.concat(items);
    var out = Buffer.alloc(4 + body.length);
    out.writeUInt32BE(body.length, 0);
    body.copy(out, 4);
    return out;
}

function Reader(buf, start, end) {
    this.buf = buf;
    this.off = start || 0;
    this.end = end !== undefined ? end : buf.length;
}
Reader.prototype.left = function() { return this.end - this.off; };
Reader.prototype.u8 = function() {
    if (this.left() < 1) throw new Error('truncated u8');
    return this.buf[this.off++];
};
Reader.prototype.u16 = function() {
    if (this.left() < 2) throw new Error('truncated u16');
    var v = this.buf.readUInt16BE(this.off); this.off += 2; return v;
};
Reader.prototype.u32 = function() {
    if (this.left() < 4) throw new Error('truncated u32');
    var v = this.buf.readUInt32BE(this.off); this.off += 4; return v;
};
Reader.prototype.i32 = function() {
    if (this.left() < 4) throw new Error('truncated i32');
    var v = this.buf.readInt32BE(this.off); this.off += 4; return v;
};
Reader.prototype.u64 = function() {
    var hi = this.u32(), lo = this.u32();
    return hi * 0x100000000 + lo;
};
Reader.prototype.f64 = function() {
    if (this.left() < 8) throw new Error('truncated f64');
    var v = this.buf.readDoubleBE(this.off); this.off += 8; return v;
};
Reader.prototype.skip = function(n) {
    if (n < 0 || this.left() < n) throw new Error('truncated skip ' + n);
    this.off += n;
};
Reader.prototype.utf8d = function() {
    var len = this.u32();
    if (this.left() < len) throw new Error('truncated utf8d');
    var s = this.off, e = this.off + len;
    this.off = e;
    if (e - s >= 3 && this.buf[s] === 0xef && this.buf[s + 1] === 0xbb && this.buf[s + 2] === 0xbf) s += 3;
    while (e > s && this.buf[e - 1] === 0) e--;
    return this.buf.toString('utf8', s, e);
};
Reader.prototype.sub = function() {
    var len = this.u32();
    if (this.left() < len) throw new Error('truncated container ' + len);
    var r = new Reader(this.buf, this.off, this.off + len);
    this.off += len;
    return r;
};
Reader.prototype.union = function() {
    var len = this.u32();
    var typeId = this.u32();
    if (this.left() < len) throw new Error('truncated union ' + len);
    var r = new Reader(this.buf, this.off, this.off + len);
    this.off += len;
    return { typeId: typeId, body: r };
};

function decodeDescription(r) {
    var elems = r.sub();
    var out = [];
    while (elems.left() > 0) {
        var u = elems.union();
        // Union [text, spacer, icon]: forward 1=text, 3=icon; reverse 3=text, 1=icon; spacer is 2 in both.
        if (u.typeId === 2) {
            continue;
        }
        try {
            var s = u.body.utf8d();
            if (s) out.push({ type: 'text', value: s });
        } catch (_) {
            /* icon or spacer union variant: skip safely */
        }
    }
    return { elements: out };
}

function decodeSpeedLimitAssist(u) {
    // Union [nil(Enum), value(Struct{reason: Union[speedLimitSign, speedLimitInfo], ...})].
    // nil is 4 bytes (enum); value is > 8 bytes.
    if (u.body.left() <= 4) return null;
    try {
        var reason = u.body.union();
        // speedLimitInfo = { speedLimit: u32, speedUnit: u32(enum), speedingInfo: u32(enum) } = 12 bytes
        if (reason.body.left() === 12) {
            var speedLimit = reason.body.u32();
            var speedUnit = SPEED_UNITS[reason.body.u32()] || '';
            reason.body.u32();
            if (speedLimit > 0 && speedUnit) {
                return { type: 'value', value: { reason: { type: 'speedLimitInfo',
                    value: { speedLimit: speedLimit, speedUnit: speedUnit } } } };
            }
        }
    } catch (_) {
        /* ignore malformed optional assist info */
    }
    return null;
}

function decodeManeuver(kind, r) {
    r.u64();                                  // uid
    var distanceToDestination = r.f64();      // Double
    r.u8();                                   // unreliable (Bool)
    r.union();                                // sourceId (Union)
    var fdDist = r.utf8d();                   // formattedDistance.distance
    var fdUnit = DISTANCE_UNITS[r.u32()] || 'NONE'; // formattedDistance.unit
    r.f64();                                  // formattedDistance.rawDistance
    var description = decodeDescription(r);   // description
    r.u32();                                  // travelTime
    r.u32();                                  // travelTimeDelay
    r.sub();                                  // trafficSegmentsInfo.overview (ArrayD)
    r.sub();                                  // trafficSegmentsInfo.segments (ArrayD)
    r.u32();                                  // guidingStep (Enum)
    var speedLimitAssistInfo = decodeSpeedLimitAssist(r.union());
    r.u32();                                  // combinedManeuverType (Enum)
    r.u32();                                  // maneuverRestriction (Enum)

    var direction = null;
    if (kind === 'intersection' && r.left() >= 4) {
        direction = DIRECTIONS[r.u32()] || null;
    } else if (kind === 'roundabout') {
        direction = 'ROUNDABOUT';
    } else if (kind === 'destinationManeuver') {
        direction = 'ARRIVE';
    }
    var ev = {
        distanceToDestination: distanceToDestination,
        formattedDistance: { distance: fdDist, unit: fdUnit },
        description: description,
        direction: direction,
        speedLimitAssistInfo: speedLimitAssistInfo
    };
    return { type: kind, value: ev };
}

function decodeViewContentStruct(r) {
    r.u32(); // configSequenceId
    r.u8();  // indexedPosition.valid
    r.i32(); // indexedPosition.ccpOffset
    r.u32(); // indexedPosition.totalElementCount
    var list = r.sub(); // eventsInView: ArrayD<Union>
    var events = [];
    while (list.left() > 0) {
        var u = list.union();
        var kind = MANEUVER_BY_REVERSE[u.typeId] || MANEUVER_BY_FORWARD[u.typeId];
        if (!kind) continue;
        try {
            events.push(decodeManeuver(kind, u.body));
        } catch (_) {
            /* If forward/reverse union ID collided with a non-maneuver member, skip safely. */
        }
    }
    return events;
}

function decodeGetViewContent(buf) {
    var r = new Reader(buf);
    var errCode = r.u32(); // GenericListError: 0=NO_ERROR, 1=UNKNOWN_VIEW_ID
    if (errCode !== 0) {
        return { error: errCode, events: [] };
    }
    var map = r.sub(); // viewContent.viewsContent: Map<Utf8D, ViewContentStruct>
    var events = [];
    while (map.left() > 0) {
        map.utf8d(); // viewId key
        events = events.concat(decodeViewContentStruct(map));
    }
    return { error: 0, events: events };
}

/* ---- Native child-process reader ------------------------------------------ */

function NativeGuidanceReader(options) {
    var o = options || {};
    this.bin = o.bin || DEFAULT_BIN;
    this.viewId = o.viewId || DEFAULT_VIEW;
    this.timeoutMs = o.timeoutMs || 3000;
    this.log = o.log || { info: function() {}, warn: function() {}, error: function() {} };
    this.onAvailability = typeof o.onAvailability === 'function' ? o.onAvailability : null;
    this.child = null;
    this.available = false;
    this.nextId = 1;
    this.pending = {};
    this.buf = '';
    this.lastErr = '';
    this.loggedFirstEvent = false;
    this.useBom = o.useBom !== undefined ? !!o.useBom : true;
    this.bomLocked = o.useBom !== undefined;
    this.reqHex = encodeGetViewContent([this.viewId], this.useBom).toString('hex');
}

NativeGuidanceReader.prototype.supported = function() {
    try { return fs.existsSync(this.bin); } catch (_) { return false; }
};

NativeGuidanceReader.prototype._diag = function(level, msg) {
    if (msg === this.lastErr) return;
    this.lastErr = msg;
    (this.log[level] || this.log.warn).call(this.log, 'native guidance: ' + msg);
};

NativeGuidanceReader.prototype._setAvailable = function(up) {
    if (this.available === up) return;
    this.available = up;
    this.log.info('native guidance: 0xfb1b:0x0080 ' + (up ? 'available' : 'unavailable'));
    if (this.onAvailability) {
        try { this.onAvailability(up); } catch (_) {}
    }
};

NativeGuidanceReader.prototype._retryAlternateBom = function(p, reason) {
    if (this.bomLocked || !this.child) return false;
    this.useBom = !this.useBom;
    this.bomLocked = true;
    this.reqHex = encodeGetViewContent([this.viewId], this.useBom).toString('hex');
    this.log.warn('native guidance: ' + reason + ', retrying Utf8D ' + (this.useBom ? 'with BOM' : 'without BOM'));
    var retryId = String(this.nextId++);
    var self = this;
    clearTimeout(p.timer);
    p.timer = setTimeout(function() {
        if (self.pending[retryId]) {
            delete self.pending[retryId];
            p.reject(new Error('native guidance query timed out'));
        }
    }, this.timeoutMs);
    this.pending[retryId] = p;
    try {
        this.child.stdin.write(retryId + ' ' + METHOD_GET_VIEW_CONTENT.toString(16) + ' ' + this.reqHex + '\n');
        return true;
    } catch (err) {
        clearTimeout(p.timer);
        delete this.pending[retryId];
        p.reject(err);
        return true;
    }
};

NativeGuidanceReader.prototype._ensureChild = function() {
    if (this.child) return true;
    if (!this.supported()) {
        this._diag('warn', 'bridge binary missing: ' + this.bin);
        return false;
    }
    var self = this;
    var child = cp.spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this._setAvailable(false);
    this.buf = '';
    this.log.info('native guidance: started ' + this.bin);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function(chunk) {
        if (self.child !== child) return;
        self.buf += chunk;
        var nl;
        while ((nl = self.buf.indexOf('\n')) >= 0) {
            var line = self.buf.slice(0, nl).trim();
            self.buf = self.buf.slice(nl + 1);
            if (line) self._onLine(line);
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function(chunk) {
        var text = String(chunk).trim();
        if (text) self.log.warn('woc-guidance stderr: ' + text.slice(0, 200));
    });
    child.on('error', function(err) {
        if (self.child !== child) return;
        self._diag('warn', 'spawn error: ' + (err && err.message ? err.message : String(err)));
        self._cleanupChild('bridge error');
    });
    child.on('exit', function(code, sig) {
        if (self.child !== child) return;
        self._diag('warn', 'bridge exited (code=' + code + ' sig=' + sig + ')');
        self._cleanupChild('bridge exited');
    });
    return true;
};

NativeGuidanceReader.prototype._cleanupChild = function(reason) {
    this.child = null;
    this._setAvailable(false);
    var pend = this.pending;
    this.pending = {};
    Object.keys(pend).forEach(function(id) {
        clearTimeout(pend[id].timer);
        pend[id].reject(new Error(reason));
    });
};

NativeGuidanceReader.prototype._onLine = function(line) {
    var parts = line.split(' ');
    if (parts[0] === 'avail') {
        this._setAvailable(parts[1] === '1');
        return;
    }
    var id = parts[1];
    var p = this.pending[id];
    if (!p) return;
    delete this.pending[id];
    if (parts[0] === 'err') {
        clearTimeout(p.timer);
        p.reject(new Error(parts.slice(2).join(' ') || 'bridge error'));
        return;
    }
    if (parts[0] === 'reply') {
        var rc = parseInt(parts[3] || 'ff', 16);
        var hex = parts[4] || '-';
        if (rc !== 0) {
            if (this._retryAlternateBom(p, 'someip rc=0x' + (parts[3] || 'ff'))) return;
            clearTimeout(p.timer);
            p.reject(new Error('someip rc=0x' + (parts[3] || 'ff')));
            return;
        }
        try {
            var buf = hex === '-' ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
            var decoded = decodeGetViewContent(buf);
            if (decoded.error === 1) {
                if (this._retryAlternateBom(p, 'UNKNOWN_VIEW_ID')) return;
                clearTimeout(p.timer);
                p.reject(new Error('GuidanceEventList UNKNOWN_VIEW_ID'));
                return;
            }
            if (decoded.error !== 0) {
                clearTimeout(p.timer);
                p.reject(new Error('GuidanceEventList error=' + decoded.error));
                return;
            }
            this.bomLocked = true;
            if (!this.loggedFirstEvent && decoded.events.length > 0) {
                this.loggedFirstEvent = true;
                this.log.info('native guidance: decoded first event (' + decoded.events[0].type + ', total=' + decoded.events.length + ')');
            }
            this.lastErr = '';
            clearTimeout(p.timer);
            p.resolve({ events: decoded.events });
        } catch (err) {
            clearTimeout(p.timer);
            this._diag('warn', 'decode failed (' + err.message + '), head=' + hex.slice(0, 96));
            p.reject(err);
        }
    }
};

NativeGuidanceReader.prototype.read = function() {
    var self = this;
    if (!this._ensureChild()) return Promise.reject(new Error('native guidance unavailable'));
    if (!this.available) return Promise.reject(new Error('GuidanceEventList 0xfb1b unavailable'));
    return new Promise(function(resolve, reject) {
        var id = String(self.nextId++);
        var timer = setTimeout(function() {
            if (self.pending[id]) {
                delete self.pending[id];
                reject(new Error('native guidance query timed out'));
            }
        }, self.timeoutMs);
        self.pending[id] = { resolve: resolve, reject: reject, timer: timer };
        try {
            self.child.stdin.write(id + ' ' + METHOD_GET_VIEW_CONTENT.toString(16) + ' ' + self.reqHex + '\n');
        } catch (err) {
            clearTimeout(timer);
            delete self.pending[id];
            reject(err);
        }
    });
};

NativeGuidanceReader.prototype.stop = function() {
    var child = this.child;
    this._cleanupChild('stopped');
    if (child) {
        try { child.stdin.end(); } catch (_) {}
        try { child.kill('SIGTERM'); } catch (_) {}
    }
};

module.exports = {
    NativeGuidanceReader: NativeGuidanceReader,
    encodeGetViewContent: encodeGetViewContent,
    decodeGetViewContent: decodeGetViewContent,
    encodeUtf8D: encodeUtf8D,
    METHOD_GET_VIEW_CONTENT: METHOD_GET_VIEW_CONTENT,
    DEFAULT_VIEW: DEFAULT_VIEW
};
