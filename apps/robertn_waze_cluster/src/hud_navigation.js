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
        U_TURN: 'uturn', UTURN: 'uturn', UTURN_LEFT: 'uturn', UTURN_RIGHT: 'uturn',
        ROUNDABOUT: 'roundabout', ARRIVE: 'arrive' };
    var CP_DIRECTIONS = { 1: 'left', 2: 'right', 3: 'straight', 4: 'uturn', 5: 'straight',
        10: 'arrive', 12: 'arrive', 13: 'slight_left', 14: 'slight_right', 18: 'uturn',
        20: 'left', 21: 'right', 22: 'left', 23: 'right', 24: 'arrive', 25: 'arrive',
        26: 'uturn', 27: 'arrive', 47: 'sharp_left', 48: 'sharp_right',
        49: 'slight_left', 50: 'slight_right', 52: 'left', 53: 'right' };

    function text(v) { return typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 160) : ''; }
    function number(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; }
    var BMW_BRANCH = { BRANCH_LEFT: 'slight_left', BRANCH_RIGHT: 'slight_right',
        HIGHWAY_IN_LEFT: 'merge_left', HIGHWAY_IN_RIGHT: 'merge_right', HIGHWAY_IN_STRAIGHT: 'straight',
        HIGHWAY_OUT_LEFT: 'slight_left', HIGHWAY_OUT_RIGHT: 'slight_right', HIGHWAY_OUT_STRAIGHT: 'straight',
        FORK_LEFT: 'slight_left', FORK_RIGHT: 'slight_right', TRIPLE_FORK_LEFT: 'slight_left',
        TRIPLE_FORK_RIGHT: 'slight_right', TRIPLE_FORK_STRAIGHT: 'straight' };
    function direction(v) { return DIRECTIONS.indexOf(v) >= 0 ? v : null; }
    function snapshot(raw) {
        raw = raw || {};
        var state = ['navigating', 'rerouting', 'arrived', 'inactive'].indexOf(raw.state) >= 0 ? raw.state : 'inactive';
        var light = raw.trafficLight;
        var hasSeconds = light && Number.isInteger(light.seconds) && light.seconds >= 0 && light.seconds <= 99;
        var yellowCaution = light && light.color === 'yellow' && light.seconds === null;
        var trafficLight = state === 'navigating' && light && ['red', 'green', 'yellow'].indexOf(light.color) >= 0 &&
            (hasSeconds || yellowCaution) ? {
                color: light.color,
                seconds: hasSeconds ? light.seconds : null,
                text: yellowCaution ? (text(light.text) || '注意') : '',
                direction: ['left', 'right', 'straight'].indexOf(light.direction) >= 0 ? light.direction : null
            } : null;
        var speedLimitKmh = state === 'navigating' && Number.isInteger(raw.speedLimitKmh) &&
            raw.speedLimitKmh > 0 && raw.speedLimitKmh <= 199 ? raw.speedLimitKmh : null;
        return { state: state, source: text(raw.source), currentRoad: text(raw.currentRoad),
            trafficLight: trafficLight, speedLimitKmh: speedLimitKmh,
            nextRoad: text(raw.nextRoad), instruction: text(raw.instruction), exitLabel: text(raw.exitLabel),
            direction: direction(raw.direction), distanceM: number(raw.distanceM),
            maneuverPositionM: number(raw.maneuverPositionM), maneuverId: text(raw.maneuverId),
            roundaboutExit: raw.direction === 'roundabout' && Number.isInteger(raw.roundaboutExit) &&
                raw.roundaboutExit > 0 && raw.roundaboutExit <= 255 ? raw.roundaboutExit : null,
            initialDistanceM: number(raw.initialDistanceM), remainingDistanceM: number(raw.remainingDistanceM),
            remainingTimeS: number(raw.remainingTimeS), arrivalUnix: number(raw.arrivalUnix),
            arrivalClock: typeof raw.arrivalClock === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.arrivalClock) ? raw.arrivalClock : '',
            lanes: (Array.isArray(raw.lanes) ? raw.lanes : []).slice(0, 8).map(function(lane) {
                var dirs = (Array.isArray(lane.directions) ? lane.directions : []).map(direction).filter(Boolean);
                // follow 是车机给出的这条车道可跟随的方向，HUD 从中挑当前动作来点亮。
                // 公交车道：车机推荐时（例如只能从公交车道右转）照常推荐，HUD 画亮的箭头加公交角标；
                // 车机不推荐时画灰色公交车图标。
                var kind = lane.kind === 'bus' ? 'bus' : null;
                var recommended = lane.recommended === true;
                var follow = recommended && Array.isArray(lane.follow) ?
                    lane.follow.filter(function(d) { return dirs.indexOf(d) >= 0; }) : [];
                return { directions: dirs, kind: kind, recommended: recommended, follow: follow,
                    leftBoundary: ['solid', 'dashed'].indexOf(lane.leftBoundary) >= 0 ? lane.leftBoundary : null };
            }) };
    }

    function enumName(v) { return typeof v === 'string' ? v : v && typeof v.name === 'string' ? v.name : ''; }
    function words(v) {
        if (!v) return '';
        if (typeof v === 'string') return text(v);
        if (Array.isArray(v)) return v.map(words).filter(Boolean).join(' ');
        if (v.type === 'text' || v.type === 'icon') return words(v.value);
        if (v.icon) return words(v.icon);
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
        if (!limit || number(limit.speedLimit) === null || limit.speedLimit === 0) return null;
        var unit = enumName(limit.speedUnit);
        if (['KMH', 'KM_P_H', 'KILOMETER_PER_HOUR', 'KILOMETERS_PER_HOUR'].indexOf(unit) >= 0) return limit.speedLimit;
        if (unit === 'MI_P_H_UK' || unit === 'MI_P_H_US') return Math.round(limit.speedLimit * 1.609344);
        return null;
    }
    function bmwLaneMarker(v) {
        var name = enumName(v);
        return name === 'SOLID' ? 'solid' : name === 'DASHED' ? 'dashed' : null;
    }
    function bmwLaneFollowDirs(lane) {
        var out = [];
        function add(raw) {
            var mapped = BMW_DIRECTIONS[enumName(raw)];
            if (mapped && out.indexOf(mapped) < 0) out.push(mapped);
        }
        if (Array.isArray(lane.directionsToFollow)) lane.directionsToFollow.forEach(add);
        if (lane.directionToFollow !== undefined) add(lane.directionToFollow);
        return out;
    }
    var LANE_POSITION_TOLERANCE_M = 5;
    function lanePositionMatches(a, b) {
        return number(a) !== null && number(b) !== null && Math.abs(a - b) <= LANE_POSITION_TOLERANCE_M;
    }
    // 车机当前车道是区段事件，接口没说明 distanceToDestination 记在区段哪一端。
    // 只接受车道位置或区段下游端点，避免把区段中间的其他路口误作车道终点。两个字段都为 0 视为没有位置信息。
    function currentLanePosition(row, maneuverPositionM) {
        var position = number(row && row.distanceToDestination), length = number(row && row.length) || 0;
        if (position === 0 && length === 0) return 'no-position';
        var maneuver = number(maneuverPositionM);
        if (position === null || maneuver === null) return 'mismatch';
        return lanePositionMatches(maneuver, position) || lanePositionMatches(maneuver, position - length)
            ? 'matched' : 'mismatch';
    }
    function bmwLanes(laneEvent) {
        var rawLanes = laneEvent && Array.isArray(laneEvent.lanes) ? laneEvent.lanes : [];
        if (!rawLanes.length) return [];
        var markers = Array.isArray(laneEvent.laneMarkers) ? laneEvent.laneMarkers : [];
        var markerOffset = markers.length === rawLanes.length - 1 ? -1 : 0;
        // 公交车道（additionalLaneInfo = BUS）和其他车道一样按车机的推荐标记，只多记一个 kind。
        function isBus(l) { return !!l && enumName(l.additionalLaneInfo) === 'BUS'; }
        var anyHighlighted = rawLanes.some(function(l) { return l && l.isHighlighted === true; });
        var anyFollow = !anyHighlighted && rawLanes.some(function(l) { return l && bmwLaneFollowDirs(l).length > 0; });
        var carIdx = typeof laneEvent.recommendedCarPositionLaneIndex === 'number' &&
            laneEvent.recommendedCarPositionLaneIndex >= 0 &&
            laneEvent.recommendedCarPositionLaneIndex < rawLanes.length ? laneEvent.recommendedCarPositionLaneIndex : -1;
        var lanes = rawLanes.slice(0, 8).map(function(lane, idx) {
            lane = lane || {};
            var follow = bmwLaneFollowDirs(lane);
            var dirs = follow.slice();
            if (Array.isArray(lane.otherDirections)) {
                lane.otherDirections.forEach(function(raw) {
                    var mapped = BMW_DIRECTIONS[enumName(raw)];
                    if (mapped && dirs.indexOf(mapped) < 0) dirs.push(mapped);
                });
            }
            var bus = isBus(lane);
            var recommended = anyHighlighted ? lane.isHighlighted === true
                : anyFollow ? follow.length > 0
                : idx === carIdx;
            return {
                directions: dirs,
                kind: bus ? 'bus' : null,
                recommended: recommended,
                follow: recommended ? follow.slice() : [],
                leftBoundary: idx > 0 ? bmwLaneMarker(markers[idx + markerOffset]) : null
            };
        });
        // 如果整行都没有方向，让另一路导航继续补齐。部分车道没有方向时仍保留它的占位。
        return lanes.some(function(lane) { return lane.directions.length > 0; }) ? lanes : [];
    }
    function fromBmw(reply, laneInfo) {
        var views = reply && reply.viewContent;
        var currentDistances = reply && (reply.currentDistances || (views && views.currentDistances));
        var routeDistance = number(currentDistances && currentDistances.carDistanceToFinalDestination);
        var guidanceState = reply && reply.guidanceState;
        if (guidanceState === 'CALCULATING_ROUTE') return snapshot({ state: 'rerouting' });
        var events = reply && reply.events;
        if (!events) {
            events = [];
            (Array.isArray(views) ? views : views ? [views] : []).forEach(function(view) {
                events = events.concat(view.eventsInView || []);
            });
        }
        var kinds = ['intersection', 'roundabout', 'branch', 'destinationManeuver', 'laneChange', 'passiveManeuver'];
        var destTimeS = null, destDistance = null, laneEvents = [], laneEventCount = 0, limits = [];
        var renderedDist = function(event) {
            var fd = event.formattedDistance || {}, multiplier = BMW_DISTANCE_TO_METERS[enumName(fd.unit)];
            return typeof multiplier === 'number' && /^\d+(\.\d+)?$/.test(fd.distance || '') ? Number(fd.distance) * multiplier : null;
        };
        for (var j = 0; j < (events || []).length; j++) {
            var du = events[j], dk = du.type, de = du.value;
            if (!dk && du.destinationManeuver && typeof du.destinationManeuver === 'object') {
                dk = 'destinationManeuver'; de = du.destinationManeuver;
            } else if (!dk && du.laneGuiding && typeof du.laneGuiding === 'object') {
                dk = 'laneGuiding'; de = du.laneGuiding;
            }
            if (dk === 'destinationManeuver' && de && de.unreliable !== true && de.isCheckeredFlag !== false) {
                if (destTimeS === null && number(de.travelTime) > 0) destTimeS = de.travelTime;
                if (destDistance === null) destDistance = renderedDist(de);
            }
            var limitEvent = dk === 'speedLimitAssist' ? de : du.speedLimitAssist;
            if (limitEvent && limitEvent.unreliable !== true && routeDistance !== null &&
                number(limitEvent.distanceToDestination) === routeDistance && renderedDist(limitEvent) === 0) {
                var limit = bmwSpeedLimit(limitEvent);
                if (limit !== null && limits.indexOf(limit) < 0) limits.push(limit);
            }
            if (dk === 'laneGuiding') {
                laneEventCount++;
                if (de && de.unreliable !== true && Array.isArray(de.lanes) && de.lanes.length) laneEvents.push(de);
            }
        }
        if (laneInfo) {
            laneInfo.received = laneEventCount;
            laneInfo.eligible = laneEvents.length;
            laneInfo.matched = 0;
        }
        var nextTurn = null, passive = null, destination = null, event, kind;
        for (var i = 0; i < (events || []).length; i++) {
            var union = events[i];
            kind = union.type;
            event = union.value;
            if (!kind) {
                kind = kinds.filter(function(k) { return union[k] && typeof union[k] === 'object'; })[0];
                event = union[kind];
            }
            if (kinds.indexOf(kind) < 0 || !event || event.unreliable === true) continue;
            if (kind === 'destinationManeuver') {
                if (!destination) destination = { kind: kind, event: event };
            } else if (kind === 'passiveManeuver') {
                if (!passive) passive = { kind: kind, event: event };
            } else if (!nextTurn) {
                nextTurn = { kind: kind, event: event };
            }
        }
        var selected = nextTurn || destination || passive;
        if (selected) {
            kind = selected.kind;
            event = selected.event;
            // CarPlay 的 rawDistance 样本是固定值，转向距离使用车机格式化值。
            var value = renderedDist(event);
            // 两种事件共用路线剩余里程。只有同一位置且唯一的一条车道引导可用于这个转向。
            var position = number(event.distanceToDestination);
            var closestGapM = Infinity;
            var matchingLanes = position === null ? [] : laneEvents.filter(function(lane) {
                var lanePosition = number(lane.distanceToDestination);
                if (laneInfo && lanePosition !== null) closestGapM = Math.min(closestGapM, Math.abs(lanePosition - position));
                return lanePositionMatches(position, lanePosition);
            });
            if (laneInfo) {
                laneInfo.matched = matchingLanes.length;
                if (isFinite(closestGapM)) laneInfo.closestGapM = closestGapM;
            }
            var turn = BMW_DIRECTIONS[enumName(event.direction)];
            if (kind === 'roundabout') turn = 'roundabout';
            else if (kind === 'destinationManeuver') turn = 'arrive';
            else if (kind === 'branch') turn = BMW_BRANCH[enumName(event.branchType)] || turn;
            else if (kind === 'laneChange') {
                var side = enumName(event.changeSide);
                if (side === 'LEFT' || side === 'RIGHT') turn = 'merge_' + side.toLowerCase();
            }
            var speedLimit = bmwSpeedLimit(event);
            var uid = typeof event.uid === 'string' ? event.uid :
                Number.isSafeInteger(event.uid) && event.uid > 0 ? String(event.uid) : '';
            var arrived = kind === 'destinationManeuver' && event.isCheckeredFlag === true &&
                guidanceState === 'INACTIVE' && routeDistance === 0 && value === 0;
            return snapshot({ state: arrived ? 'arrived' : 'navigating', source: 'BMW 导航结构化事件',
                direction: turn, roundaboutExit: kind === 'roundabout' ? event.exitNumber : null,
                nextRoad: words(event.nextRoad), exitLabel: words(event.exitLabel),
                instruction: words(event.description), distanceM: value, maneuverPositionM: position, maneuverId: uid,
                remainingDistanceM: routeDistance === null || (routeDistance === 0 && value > 0) ? destDistance : routeDistance,
                remainingTimeS: destTimeS,
                speedLimitKmh: speedLimit === null && limits.length === 1 ? limits[0] : speedLimit,
                lanes: matchingLanes.length === 1 ? bmwLanes(matchingLanes[0]) : [] });
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
        decodeIap: decodeIap, bmwLanes: bmwLanes, distance: distance, directions: DIRECTIONS,
        laneDirections: laneDirections, laneIcon: laneIcon, lanePositionMatches: lanePositionMatches,
        currentLanePosition: currentLanePosition };
}));
