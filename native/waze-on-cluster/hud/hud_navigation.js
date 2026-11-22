/* 结构化数据适配。图像识别在独立模块完成。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HudNavigation = factory();
}(this, function() {
    'use strict';
    var DIRECTIONS = ['left', 'right', 'straight', 'slight_left', 'slight_right',
        'sharp_left', 'sharp_right', 'uturn', 'arrive', 'roundabout',
        'straight_left', 'straight_right', 'left_right', 'straight_uturn', 'left_uturn', 'merge_left', 'merge_right'];
    var COMBINATIONS = { straight_left: ['straight', 'left'], straight_right: ['straight', 'right'],
        left_right: ['left', 'right'], straight_uturn: ['straight', 'uturn'], left_uturn: ['left', 'uturn'] };
    function laneDirections(dir) { return (COMBINATIONS[dir] || [dir]).slice(); }
    function laneIcon(directions) {
        if (directions.length === 1) return directions[0];
        return Object.keys(COMBINATIONS).filter(function(key) {
            var parts = COMBINATIONS[key];
            return parts.length === directions.length && parts.every(function(part) { return directions.indexOf(part) >= 0; });
        })[0] || null;
    }
    var BMW_DIRECTIONS = { LEFT: 'left', RIGHT: 'right', STRAIGHT: 'straight', STRAIGHT_ON: 'straight',
        SLIGHT_LEFT: 'slight_left', SLIGHT_RIGHT: 'slight_right', SHARP_LEFT: 'sharp_left',
        SHARP_RIGHT: 'sharp_right', HARD_LEFT: 'sharp_left', HARD_RIGHT: 'sharp_right',
        U_TURN: 'uturn', UTURN: 'uturn', UTURN_LEFT: 'uturn', UTURN_RIGHT: 'uturn' };
    var CP_DIRECTIONS = { 1: 'left', 2: 'right', 3: 'straight', 4: 'uturn', 5: 'straight',
        10: 'arrive', 12: 'arrive', 13: 'slight_left', 14: 'slight_right', 18: 'uturn',
        20: 'left', 21: 'right', 22: 'left', 23: 'right', 24: 'arrive', 25: 'arrive',
        26: 'uturn', 27: 'arrive', 47: 'sharp_left', 48: 'sharp_right',
        49: 'slight_left', 50: 'slight_right', 52: 'left', 53: 'right' };

    function text(v) { return typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 160) : ''; }
    function number(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; }
    function direction(v) { return DIRECTIONS.indexOf(v) >= 0 ? v : null; }
    function snapshot(raw) {
        raw = raw || {};
        var state = ['navigating', 'rerouting', 'arrived', 'inactive'].indexOf(raw.state) >= 0 ? raw.state : 'inactive';
        var light = raw.trafficLight;
        var trafficLight = state === 'navigating' && light && ['red', 'green', 'yellow'].indexOf(light.color) >= 0 &&
            Number.isInteger(light.seconds) && light.seconds >= 0 && light.seconds <= 99 ? {
                color: light.color, seconds: light.seconds,
                direction: ['left', 'right', 'straight'].indexOf(light.direction) >= 0 ? light.direction : null
            } : null;
        var speedLimitKmh = state === 'navigating' && Number.isInteger(raw.speedLimitKmh) &&
            raw.speedLimitKmh > 0 && raw.speedLimitKmh <= 199 ? raw.speedLimitKmh : null;
        return { state: state, source: text(raw.source), currentRoad: text(raw.currentRoad),
            trafficLight: trafficLight, speedLimitKmh: speedLimitKmh,
            nextRoad: text(raw.nextRoad), instruction: text(raw.instruction), exitLabel: text(raw.exitLabel),
            direction: direction(raw.direction), distanceM: number(raw.distanceM),
            initialDistanceM: number(raw.initialDistanceM), remainingDistanceM: number(raw.remainingDistanceM),
            remainingTimeS: number(raw.remainingTimeS), arrivalUnix: number(raw.arrivalUnix),
            lanes: (Array.isArray(raw.lanes) ? raw.lanes : []).slice(0, 8).map(function(lane) {
                return { directions: (Array.isArray(lane.directions) ? lane.directions : []).map(direction).filter(Boolean),
                    recommended: lane.recommended === true,
                    leftBoundary: ['solid', 'dashed'].indexOf(lane.leftBoundary) >= 0 ? lane.leftBoundary : null };
            }) };
    }

    function enumName(v) { return typeof v === 'string' ? v : v && typeof v.name === 'string' ? v.name : ''; }
    function words(v) {
        if (!v) return '';
        if (typeof v === 'string') return text(v);
        if (Array.isArray(v)) return v.map(words).filter(Boolean).join(' ');
        if (v.type === 'text') return words(v.value);
        if (typeof v.text === 'string') return text(v.text);
        if (v.elements) return words(v.elements);
        return '';
    }
    var BMW_DISTANCE_TO_METERS = { METER: 1, KM: 1000, KILOMETER: 1000,
        MILE_UK: 1609.344, MILE_US: 1609.344, MILE: 1609.344, YARD: 0.9144, FEET: 0.3048, FOOT: 0.3048 };
    function bmwSpeedLimit(event) {
        var assist = event.speedLimitAssistInfo;
        var info = assist && (assist.type === 'value' ? assist.value : !assist.type ? assist.value : null);
        var reason = info && info.reason;
        var limit = reason && (reason.type === 'speedLimitInfo' ? reason.value : !reason.type ? reason.speedLimitInfo : null);
        if (!limit || ['KMH', 'KM_P_H', 'KILOMETER_PER_HOUR', 'KILOMETERS_PER_HOUR'].indexOf(enumName(limit.speedUnit)) < 0) return null;
        return limit.speedLimit;
    }
    function fromBmw(reply) {
        var views = reply && reply.viewContent;
        var events = reply && reply.events;
        if (!events) {
            events = [];
            (Array.isArray(views) ? views : views ? [views] : []).forEach(function(view) {
                events = events.concat(view.eventsInView || []);
            });
        }
        var kinds = ['intersection', 'roundabout', 'branch', 'destinationManeuver', 'laneChange', 'passiveManeuver'];
        for (var i = 0; i < (events || []).length; i++) {
            var union = events[i], kind = union.type, event = union.value;
            if (!kind) {
                kind = kinds.filter(function(k) { return union[k] && typeof union[k] === 'object'; })[0];
                event = union[kind];
            }
            if (kinds.indexOf(kind) < 0 || !event) continue;
            var fd = event.formattedDistance || {}, unit = enumName(fd.unit), value = null;
            // 格式化数字与单位一起使用。样本 rawDistance=1 与显示 147 米不一致，不把它当米数。
            var metersPerUnit = BMW_DISTANCE_TO_METERS[unit];
            if (typeof metersPerUnit === 'number' && /^\d+(\.\d+)?$/.test(fd.distance || '')) {
                value = Number(fd.distance) * metersPerUnit;
            }
            return snapshot({ state: 'navigating', source: 'BMW 导航结构化事件',
                direction: BMW_DIRECTIONS[enumName(event.direction)] || null,
                instruction: words(event.description), distanceM: value,
                remainingDistanceM: number(event.distanceToDestination), speedLimitKmh: bmwSpeedLimit(event) });
        }
        return snapshot({ state: 'inactive' });
    }

    function bytes(hex) {
        if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw Error('iAP 十六进制格式错误');
        return new Uint8Array(hex.match(/../g).map(function(s) { return parseInt(s, 16); }));
    }
    function integer(data) {
        var n = 0;
        for (var i = 0; i < data.length; i++) { n = n * 256 + data[i]; if (n > Number.MAX_SAFE_INTEGER) throw Error('iAP 整数越界'); }
        return n;
    }
    function utf8(data) {
        if (!data.length || data[data.length - 1] !== 0) throw Error('iAP 文本缺少结束符');
        var str = '';
        for (var i = 0; i < data.length - 1; i++) {
            if (!data[i]) throw Error('iAP 文本包含中间结束符');
            str += '%' + ('0' + data[i].toString(16)).slice(-2);
        }
        return decodeURIComponent(str);
    }
    function decodeIap(hex) {
        var data = bytes(hex), fields = {}, end = data.length;
        if (end < 6 || data[0] !== 0x40 || data[1] !== 0x40 || integer(data.slice(2, 4)) !== end) throw Error('iAP 帧头或长度错误');
        var id = integer(data.slice(4, 6));
        if (id !== 0x5201 && id !== 0x5202) throw Error('仅支持 0x5201 和 0x5202');
        for (var p = 6; p < end;) {
            if (p + 4 > end) throw Error('iAP TLV 头不完整');
            var size = integer(data.slice(p, p + 2)), key = integer(data.slice(p + 2, p + 4));
            if (size < 4 || p + size > end || Object.prototype.hasOwnProperty.call(fields, key)) throw Error('iAP TLV 长度错误或字段重复');
            fields[key] = data.slice(p + 4, p + size); p += size;
        }
        function n(key, width) {
            if (!fields[key]) return null;
            if (fields[key].length !== width) throw Error('iAP 字段宽度错误：' + key);
            return integer(fields[key]);
        }
        function s(key) { return fields[key] ? utf8(fields[key]) : ''; }
        if (id === 0x5201) {
            var route = n(1, 1), indexes = fields[13], index = null;
            if (indexes) { if (indexes.length % 2) throw Error('iAP 转向索引长度错误'); if (indexes.length) index = integer(indexes.slice(0, 2)); }
            return { id: id, state: route === 1 ? 'navigating' : route === 2 ? 'arrived' : route === 5 ? 'rerouting' : 'inactive',
                source: s(19), currentRoad: s(3), destination: s(4), arrivalUnix: n(5, 8),
                remainingTimeS: n(6, 8), remainingDistanceM: n(7, 4), distanceM: n(10, 4), index: index };
        }
        var type = n(3, 1), junction = n(9, 1);
        return { id: id, index: n(1, 2), instruction: s(2), nextRoad: s(4),
            // 环岛缺少几何时不猜出口；百度的 28..32 也不能直接解释成出口编号。
            direction: CP_DIRECTIONS[type] || (junction === 1 ? 'roundabout' : null),
            initialDistanceM: n(5, 4) };
    }
    function fromIap(hexes) {
        var route = null, maneuvers = {};
        (Array.isArray(hexes) ? hexes : [hexes]).forEach(function(hex) {
            var msg = decodeIap(hex);
            if (msg.id === 0x5201) route = msg;
            else if (msg.index !== null) maneuvers[msg.index] = msg;
        });
        if (!route) return snapshot({ state: 'inactive' });
        var m = route.index === null ? {} : maneuvers[route.index] || {};
        return snapshot(Object.assign({}, route, m, { distanceM: route.distanceM }));
    }
    function fromInput(input) {
        if (input && input.type === 'iap') return fromIap(input.frames);
        if (input && input.type === 'bmw') return fromBmw(input.reply);
        return snapshot(input);
    }
    function distance(m) {
        if (m === null) return { value: '—', unit: '' };
        if (m < 1000) return { value: String(Math.round(m)), unit: 'm' };
        return { value: (m / 1000).toFixed(m < 100000 ? 1 : 0), unit: 'km' };
    }
    return { snapshot: snapshot, fromInput: fromInput, fromBmw: fromBmw, fromIap: fromIap,
        decodeIap: decodeIap, distance: distance, directions: DIRECTIONS,
        laneDirections: laneDirections, laneIcon: laneIcon };
}));
