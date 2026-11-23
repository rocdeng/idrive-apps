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
var ROAD_INTERVAL_MS = 1000;
var ROAD_TIMEOUT_MS = 900;
var ROAD_FRESH_MS = 2000;
var GUIDANCE_GETTERS = {
    state: { method: '0002', decode: decodeGuidanceState },
    destination: { method: '0005', decode: decodeDestinationInfo },
    lanes: { method: '0019', decode: decodeCurrentLanes }
};
function uptimeMs() { return process.uptime() * 1000; }
var DEFAULT_BIN = process.env.WOC_GUIDANCE_BIN || path.join(__dirname, 'woc-guidance');

var DISTANCE_UNITS = { 0: 'NONE', 1: 'KM', 2: 'MILE_UK', 3: 'MILE_US', 4: 'METER', 5: 'YARD', 6: 'FEET' };
var SPEED_UNITS = { 1: 'KM_P_H', 2: 'MI_P_H_UK', 3: 'MI_P_H_US' };
var DIRECTIONS = {
    0: 'NONE', 1: 'STRAIGHT_ON', 2: 'LEFT', 3: 'SLIGHT_LEFT', 4: 'HARD_LEFT',
    5: 'RIGHT', 6: 'SLIGHT_RIGHT', 7: 'HARD_RIGHT', 8: 'UTURN_RIGHT', 9: 'UTURN_LEFT'
};
var LANE_MARKERS = { 1: 'SOLID', 2: 'DASHED' };
var BRANCH_TYPES = ['', 'BRANCH_LEFT', 'BRANCH_RIGHT', 'HIGHWAY_IN_LEFT', 'HIGHWAY_IN_RIGHT',
    'HIGHWAY_IN_STRAIGHT', 'HIGHWAY_OUT_LEFT', 'HIGHWAY_OUT_RIGHT', 'HIGHWAY_OUT_STRAIGHT',
    'FORK_LEFT', 'FORK_RIGHT', 'TRIPLE_FORK_LEFT', 'TRIPLE_FORK_RIGHT', 'TRIPLE_FORK_STRAIGHT', 'OVERPASS', 'UNDERPASS'];
var MANEUVER_BY_FORWARD = {
    2: 'intersection', 4: 'branch', 5: 'roundabout', 6: 'destinationManeuver',
    8: 'laneGuiding', 12: 'laneChange', 16: 'passiveManeuver', 17: 'speedLimitAssist'
};
// CommonAPI-SOME/IP 3.1.12 numbers union members 1..N in reverse declaration order (22 members -> 23 - idx).
var MANEUVER_BY_REVERSE = {
    21: 'intersection', 19: 'branch', 18: 'roundabout',
    17: 'destinationManeuver', 15: 'laneGuiding', 11: 'laneChange', 7: 'passiveManeuver', 6: 'speedLimitAssist'
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

// Guidance.currentRoad returns the same Description structure as a maneuver.
function decodeCurrentRoad(buf) {
    var r = new Reader(buf);
    var description = decodeDescription(r);
    if (r.left()) throw new Error('unexpected currentRoad data');
    return description.elements.map(function(item) { return item.value; }).join(' ');
}

function decodeGuidanceState(buf) {
    if (buf.length !== 4) return null;
    return ['INACTIVE', 'CALCULATING_ROUTE', 'ACTIVE'][buf.readUInt32BE(0)] || null;
}

function decodeDestinationInfo(buf) {
    if (buf.length < 30) return null;
    var r = new Reader(buf);
    r.u32(); // delayTime
    r.u32(); // delayStatus
    var seconds = r.u32();
    r.skip(5); // includedTimeOffset; the supplied hour/minute are the destination clock
    var dateInvalid = r.u8();
    var year = r.u16(), month = r.u8(), day = r.u8();
    var clockInvalid = r.u8();
    var hour = r.u8(), minute = r.u8(), second = r.u8();
    var clock = dateInvalid === 0 && clockInvalid === 0 && year >= 1970 &&
        month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59
        ? ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2) : '';
    return { remainingTimeS: seconds > 0 && seconds < 0xffffffff ? seconds : null, arrivalClock: clock };
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
    var uidHi = r.u32(), uidLo = r.u32();
    var uid = uidHi || uidLo ? uidHi + ':' + uidLo : '';
    var distanceToDestination = r.f64();      // Double
    var unreliable = r.u8() === 1;
    r.union();                                // sourceId (Union)
    var fdDist = r.utf8d();                   // formattedDistance.distance
    var fdUnit = DISTANCE_UNITS[r.u32()] || 'NONE'; // formattedDistance.unit
    r.f64();                                  // formattedDistance.rawDistance
    var description = decodeDescription(r);   // description
    var travelTime = r.u32();                 // travelTime
    r.u32();                                  // travelTimeDelay
    r.sub();                                  // trafficSegmentsInfo.overview (ArrayD)
    r.sub();                                  // trafficSegmentsInfo.segments (ArrayD)
    r.u32();                                  // guidingStep (Enum)
    var speedLimitAssistInfo = decodeSpeedLimitAssist(r.union());
    r.u32();                                  // combinedManeuverType (Enum)
    r.u32();                                  // maneuverRestriction (Enum)

    var ev = {
        uid: uid,
        distanceToDestination: distanceToDestination,
        unreliable: unreliable,
        travelTime: travelTime,
        formattedDistance: { distance: fdDist, unit: fdUnit },
        description: description,
        speedLimitAssistInfo: speedLimitAssistInfo
    };
    if (kind === 'intersection' || kind === 'branch') {
        var code = r.u32();
        var label = kind === 'intersection' ? DIRECTIONS[code] : BRANCH_TYPES[code];
        if (label === undefined) throw new Error('invalid maneuver direction');
        if (kind === 'intersection') ev.direction = label;
        else ev.branchType = label;
        r.union(); // roadlinks
        if (r.u32() > 31) throw new Error('invalid maneuver geometry');
    } else if (kind === 'laneChange') {
        var side = r.u32();
        if (side > 2) throw new Error('invalid lane change side');
        ev.changeSide = [null, 'LEFT', 'RIGHT'][side];
    } else if (kind === 'roundabout') {
        r.u16(); // exitAngle
        ev.exitNumber = r.u8();
        if (r.u32() > 2) throw new Error('invalid roundabout direction');
        r.union(); // roadlinks
    } else if (kind === 'destinationManeuver') {
        if (r.u32() > 4) throw new Error('invalid destination side');
        var flag = r.u8();
        if (flag > 1) throw new Error('invalid destination flag');
        ev.isCheckeredFlag = flag === 1;
        r.u32(); // stopOverNumber
        r.union(); // roadlinks
        r.union(); // chargingInfo
        r.union(); // poi
    } else if (kind === 'passiveManeuver') {
        r.u32(); // passiveManeuverType
    }
    if (r.left()) throw new Error('unexpected maneuver fields');
    return { type: kind, value: ev };
}

function decodeDirectionArray(sub) {
    var out = [];
    while (sub.left() > 0) {
        var code = sub.u32();
        var name = DIRECTIONS[code];
        if (!name) throw new Error('invalid lane direction ' + code);
        if (name !== 'NONE') out.push(name);
    }
    return out;
}

function decodeLaneGuiding(r) {
    r.u64();                                  // uid
    var distanceToDestination = r.f64();      // Double
    var unreliable = r.u8();                  // unreliable (Bool)
    if (unreliable > 1) throw new Error('invalid bool');
    r.union();                                // sourceId (Union)
    var length = r.f64();                     // length (Double)
    var row = decodeLaneRow(r);
    if (r.left() !== 0 || row.lanes.length === 0) throw new Error('laneGuiding mismatch');
    row.distanceToDestination = distanceToDestination;
    row.length = length;
    row.unreliable = unreliable === 1;
    return { type: 'laneGuiding', value: row };
}

function decodeLaneRow(r) {
    var lanesBuf = r.sub();                   // lanes: ArrayD<Struct>
    var lanes = [];
    while (lanesBuf.left() > 0) {
        var dirCode = lanesBuf.u32();
        var directionToFollow = DIRECTIONS[dirCode];
        if (!directionToFollow) throw new Error('invalid lane directionToFollow ' + dirCode);
        var otherDirections = decodeDirectionArray(lanesBuf.sub());
        var hi = lanesBuf.u8();
        if (hi > 1) throw new Error('invalid isHighlighted');
        var addInfo = lanesBuf.u32();         // additionalLaneInfo (Enum 0..9)
        if (addInfo > 9) throw new Error('invalid additionalLaneInfo ' + addInfo);
        var directionsToFollow = decodeDirectionArray(lanesBuf.sub());
        lanes.push({
            directionToFollow: directionToFollow,
            otherDirections: otherDirections,
            isHighlighted: hi === 1,
            directionsToFollow: directionsToFollow
        });
    }
    var markersBuf = r.sub();                 // laneMarkers: ArrayD<Enum>
    var laneMarkers = [];
    while (markersBuf.left() > 0) {
        var mCode = markersBuf.u32();
        laneMarkers.push(LANE_MARKERS[mCode] || 'NONE');
    }
    var recommendedCarPositionLaneIndex = r.u8();
    var bargraphProgress = r.u8();
    return { lanes: lanes, laneMarkers: laneMarkers,
        recommendedCarPositionLaneIndex: recommendedCarPositionLaneIndex, bargraphProgress: bargraphProgress };
}

function decodeCurrentLanes(buf) {
    var r = new Reader(buf), rows = r.sub(), row = null;
    if (rows.left() > 0) row = decodeLaneRow(rows);
    r.u8(); // carPositionLaneIndex is not a recommendation
    // A single explicitly current row can be used. With multiple rows there is no maneuver association.
    return !r.left() && !rows.left() && row && row.lanes.length ? row : null;
}

function decodeViewContentStruct(r, laneInfo) {
    r.u32(); // configSequenceId
    r.u8();  // indexedPosition.valid
    r.i32(); // indexedPosition.ccpOffset
    r.u32(); // indexedPosition.totalElementCount
    var list = r.sub(); // eventsInView: ArrayD<Union>
    var events = [];
    while (list.left() > 0) {
        var u = list.union();
        // Both orders occur in BMW data. Require the body's exact shape before accepting a tag.
        var kinds = [MANEUVER_BY_REVERSE[u.typeId], MANEUVER_BY_FORWARD[u.typeId]];
        for (var i = 0; i < kinds.length; i++) {
            var kind = kinds[i];
            if (!kind) continue;
            var body = new Reader(u.body.buf, u.body.off, u.body.end);
            try {
                events.push(kind === 'laneGuiding' ? decodeLaneGuiding(body) : decodeManeuver(kind, body));
                break;
            } catch (_) {
                if (kind === 'laneGuiding') laneInfo.rejected++;
            }
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
    var events = [], laneInfo = { rejected: 0 };
    while (map.left() > 0) {
        map.utf8d(); // viewId key
        events = events.concat(decodeViewContentStruct(map, laneInfo));
    }
    var currentDistances = r.left() >= 32 ? { carDistanceToFinalDestination: r.f64() } : null;
    return { error: 0, events: events, currentDistances: currentDistances, laneRejected: laneInfo.rejected };
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
    this.roadAvailable = false;
    this.roadName = '';
    this.roadAt = 0;
    this.roadNext = 0;
    this.roadId = null;
    this.roadTimer = null;
    this.roadStatus = '';
    this.fields = Object.create(null);
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

NativeGuidanceReader.prototype._finishRoad = function(name, status) {
    clearTimeout(this.roadTimer);
    this.roadTimer = null;
    this.roadId = null;
    this.roadName = name;
    this.roadAt = name ? uptimeMs() : 0;
    if (status && status !== this.roadStatus) this.log.info('native current road: ' + status);
    this.roadStatus = status;
};

// Return the last fresh value and refresh in the background. A road query never delays maneuver guidance.
NativeGuidanceReader.prototype.currentRoad = function() {
    if (!this.child || !this.roadAvailable) return '';
    var now = uptimeMs();
    if (this.roadId === null && now >= this.roadNext) {
        this.roadNext = now + ROAD_INTERVAL_MS;
        this.roadId = String(this.nextId++);
        var self = this;
        this.roadTimer = setTimeout(function() { self._finishRoad('', 'timeout'); }, ROAD_TIMEOUT_MS);
        try {
            this.child.stdin.write(this.roadId + ' road -\n');
        } catch (_) {
            this._finishRoad('', 'write failed');
        }
    }
    return this.roadName && now - this.roadAt < ROAD_FRESH_MS ? this.roadName : '';
};

NativeGuidanceReader.prototype.guidanceField = function(key, context) {
    if (!this.child || !this.roadAvailable) return null;
    var field = this.fields[key];
    if (!field || field.context !== context) {
        field = this.fields[key] = { id: null, next: 0, at: 0, value: null, context: context };
    }
    var now = uptimeMs();
    if (now >= field.next) {
        // 替换超时的请求编号，上一条有效值仍受新鲜度和路口约束。
        field.next = now + ROAD_INTERVAL_MS;
        field.id = String(this.nextId++);
        try { this.child.stdin.write(field.id + ' ' + key + ' -\n'); }
        catch (_) { field.id = null; field.value = null; }
    }
    return now - field.at < ROAD_FRESH_MS ? field.value : null;
};

NativeGuidanceReader.prototype._cleanupChild = function(reason) {
    this.child = null;
    this.roadAvailable = false;
    this.fields = Object.create(null);
    this.roadNext = 0;
    this._finishRoad('', '');
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
    if (parts[0] === 'road-avail') {
        this.roadAvailable = parts[1] === '1';
        if (!this.roadAvailable) {
            this._finishRoad('', 'unavailable');
            this.fields = Object.create(null);
        }
        return;
    }
    var id = parts[1];
    if (id === this.roadId) {
        if (parts[0] !== 'reply' || parts[2] !== '0001' || parts[3] !== '00') {
            this._finishRoad('', 'query failed');
            return;
        }
        try {
            var name = decodeCurrentRoad(Buffer.from(parts[4] || '', 'hex'));
            this._finishRoad(name, name ? 'received' : 'empty');
        } catch (_) {
            this._finishRoad('', 'decode failed');
        }
        return;
    }
    var p = this.pending[id];
    if (!p) {
        var keys = Object.keys(this.fields);
        for (var i = 0; i < keys.length; i++) {
            var name = keys[i], field = this.fields[name];
            if (field.id !== id) continue;
            field.id = null;
            field.value = null;
            var getter = GUIDANCE_GETTERS[name];
            if (parts[0] === 'reply' && parts[2] === getter.method && parts[3] === '00') {
                try { field.value = getter.decode(Buffer.from(parts[4] || '', 'hex')); } catch (_) {}
            }
            field.at = uptimeMs();
            break;
        }
        return;
    }
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
                this._diag('warn', 'getViewContent returned UNKNOWN_VIEW_ID (useBom=' + this.useBom + ')');
                clearTimeout(p.timer);
                p.reject(new Error('GuidanceEventList UNKNOWN_VIEW_ID'));
                return;
            }
            if (decoded.error !== 0) {
                this._diag('warn', 'getViewContent returned error=' + decoded.error + ' head=' + hex.slice(0, 64));
                clearTimeout(p.timer);
                p.reject(new Error('GuidanceEventList error=' + decoded.error));
                return;
            }
            this.bomLocked = true;
            if (!this.loggedFirstEvent && decoded.events.length > 0) {
                this.loggedFirstEvent = true;
                this.log.info('native guidance: decoded first event (' + decoded.events[0].type + ', total=' + decoded.events.length + ')');
            } else if (decoded.events.length === 0) {
                this._diag('info', 'getViewContent ok but 0 events (bytes=' + buf.length + ' head=' + hex.slice(0, 64) + ')');
            }
            if (decoded.events.length > 0) this.lastErr = '';
            clearTimeout(p.timer);
            var state = this.fields.state;
            decoded.guidanceState = state && uptimeMs() - state.at < ROAD_FRESH_MS ? state.value : null;
            p.resolve(decoded);
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
    this.guidanceField('state');
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
