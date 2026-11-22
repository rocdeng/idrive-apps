/* 800×480 RGBA HUD。浏览器和 Node 使用同一份像素绘制代码。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./hud_navigation.js'), require('./hud_turn_icons.js'));
    else root.HudRenderer = factory(root.HudNavigation, root.HudTurnIcons);
}(this, function(nav, turnIcons) {
    'use strict';
    var W = 800, H = 480;
    // Pencil「箭头优化版 · 800 × 480 显示验证」的原生坐标，保留透明背景。
    var WHITE = [255, 255, 255], DIM = [158, 158, 158], GRAY = [217, 217, 217], TRACK = [41, 41, 41];
    var LANE_LINE = [167, 174, 174], RECOMMENDED = [84, 245, 165];
    function Surface(font) { this.pixels = new Uint8Array(W * H * 4); this.font = font; }
    Surface.prototype.pixel = function(x, y, color, alpha) {
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
        var p = (y * W + x) * 4, a = Math.min(1, alpha), old = this.pixels[p + 3] / 255;
        var result = a + old * (1 - a);
        for (var c = 0; c < 3; c++) this.pixels[p + c] = (color[c] * a + this.pixels[p + c] * old * (1 - a)) / result;
        this.pixels[p + 3] = result * 255;
    };
    Surface.prototype.rect = function(x, y, w, h, radius, color, alpha) {
        for (var py = Math.max(0, Math.floor(y)); py < Math.min(H, Math.ceil(y + h)); py++) {
            for (var px = Math.max(0, Math.floor(x)); px < Math.min(W, Math.ceil(x + w)); px++) {
                var dx = Math.max(x + radius - px - 0.5, 0, px + 0.5 - (x + w - radius));
                var dy = Math.max(y + radius - py - 0.5, 0, py + 0.5 - (y + h - radius));
                var coverage = radius ? Math.min(1, Math.max(0, radius + 0.5 - Math.sqrt(dx * dx + dy * dy))) :
                    Math.max(0, Math.min(px + 1, x + w) - Math.max(px, x)) *
                    Math.max(0, Math.min(py + 1, y + h) - Math.max(py, y));
                this.pixel(px, py, color, alpha * coverage);
            }
        }
    };
    Surface.prototype.shape = function(contours, color) {
        var ys = [].concat.apply([], contours).map(function(p) { return p[1]; });
        var minY = Math.max(0, Math.floor(Math.min.apply(null, ys)));
        var maxY = Math.min(H, Math.ceil(Math.max.apply(null, ys)));
        for (var y = minY; y < maxY; y++) {
            // 每行四条子扫描线，使箭头斜边在原生 HUD 分辨率上平滑。
            var coverage = new Float32Array(W);
            for (var sy = 0; sy < 4; sy++) {
                var scan = y + (sy + 0.5) / 4, intersections = [];
                for (var c = 0; c < contours.length; c++) {
                    var points = contours[c];
                    for (var i = 0; i < points.length; i++) {
                        var a = points[i], b = points[(i + 1) % points.length];
                        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan))
                            intersections.push([a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
                    }
                }
                intersections.sort(function(a, b) { return a[0] - b[0]; });
                // SVG 默认 nonzero 填充，保留方格旗的镂空和重叠路径的正确关系。
                var winding = 0, start = 0;
                for (var j = 0; j < intersections.length; j++) {
                    if (!winding) start = intersections[j][0];
                    winding += intersections[j][1];
                    if (winding) continue;
                    var end = intersections[j][0];
                    for (var x = Math.max(0, Math.floor(start)); x < Math.min(W, Math.ceil(end)); x++)
                        coverage[x] += Math.max(0, Math.min(x + 1, end) - Math.max(x, start)) / 4;
                }
            }
            for (var cx = 0; cx < W; cx++) if (coverage[cx]) this.pixel(cx, y, color, coverage[cx]);
        }
    };
    Surface.prototype.measure = function(str, size) {
        var font = this.font;
        return Array.from(str).reduce(function(n, ch) { var g = font.glyph(ch); return n + (g ? g.advance : 64) * size / 64; }, 0);
    };
    Surface.prototype.text = function(str, x, y, size, color, maxWidth) {
        str = String(str || '');
        if (maxWidth) {
            var chars = Array.from(str);
            if (this.measure(str, size) > maxWidth) {
                while (chars.length && this.measure(chars.join('') + '…', size) > maxWidth) chars.pop();
                str = chars.join('') + '…';
            }
        }
        var start = x, self = this;
        Array.from(str).forEach(function(ch) {
            var g = self.font.glyph(ch);
            if (!g) { x += size; return; }
            var scale = size / 64, pxScale = size / (g.s || 64);
            var width = g.w * pxScale, height = g.h * pxScale;
            var left = x + g.x * scale, top = y + g.y * scale;
            for (var py = Math.floor(top); py < Math.ceil(top + height); py++) {
                for (var px = Math.floor(left); px < Math.ceil(left + width); px++) {
                    var sx = (px + 0.5 - left) / pxScale - 0.5, sy = (py + 0.5 - top) / pxScale - 0.5;
                    if (sx < -0.5 || sy < -0.5 || sx > g.w - 0.5 || sy > g.h - 0.5) continue;
                    var ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
                    function at(xx, yy) { return xx < 0 || yy < 0 || xx >= g.w || yy >= g.h ? 0 : g.pixels[yy * g.w + xx]; }
                    var a = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) +
                        at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
                    self.pixel(px, py, color, a / 255);
                }
            }
            x += g.advance * scale;
        });
        return x - start;
    };
    Surface.prototype.arrow = function(dir, x, y, w, h, color) {
        var key = dir === 'sharp_left' ? 'left' : dir === 'sharp_right' ? 'right' : dir;
        var icon = turnIcons[key], self = this;
        if (!icon) return;
        // 分支分别合成，避免相反绕向的重叠路径互相挖空；单个路径仍保留旗帜镂空。
        icon.forEach(function(shape) {
            self.shape(shape.map(function(contour) {
                return contour.map(function(p) { return [x + p[0] * w, y + p[1] * h]; });
            }), color);
        });
    };
    function trip(state) {
        var distance = '', time = '';
        if (state.remainingDistanceM !== null) {
            var d = nav.distance(state.remainingDistanceM);
            distance = d.value + (d.unit === 'km' ? ' 公里' : ' 米');
        }
        if (state.remainingTimeS !== null) time = Math.ceil(state.remainingTimeS / 60) + ' 分钟';
        // 固定 +08:00，用于当前中国道路演示；不依赖运行主机的时区。
        // 画布显示剩余时间；只有缺少剩余秒数时才用明确提供的到达时刻。
        if (!time && state.arrivalUnix !== null) {
            var dt = new Date((state.arrivalUnix + 8 * 3600) * 1000);
            time = ('0' + dt.getUTCHours()).slice(-2) + ':' + ('0' + dt.getUTCMinutes()).slice(-2) + ' 到达';
        }
        return [distance, time];
    }
    // Pencil「453×200 安全区」映射到默认 454×272（y=104）HUD 图层，1.76× 超采样并支持实时缩放与位移。
    var HUD_LAYER_X = 173, HUD_LAYER_Y = 104, HUD_LAYER_W = 454, HUD_LAYER_H = 272;
    var SAFE_FRAME_X = 173.5, SAFE_FRAME_Y = 140;
    var SAFE_SCALE_X = W / HUD_LAYER_W, SAFE_SCALE_Y = H / HUD_LAYER_H;
    function safeX(x) { return (SAFE_FRAME_X + x - HUD_LAYER_X) * SAFE_SCALE_X; }
    function safeY(y) { return (SAFE_FRAME_Y + y - HUD_LAYER_Y) * SAFE_SCALE_Y; }
    function safeW(w) { return w * SAFE_SCALE_X; }
    function safeH(h) { return h * SAFE_SCALE_Y; }
    function safeFont(size) { return size * SAFE_SCALE_Y; }
    function drawSafeRing(s, cx, cy, w, h, color) {
        var rx = w / 2, ry = h / 2, inner = 1 - 4 / Math.min(rx, ry);
        for (var y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
            for (var x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
                var r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
                var alpha = Math.min((r - inner) * 8, (1 - r) * 8, 1);
                s.pixel(x, y, color, Math.max(0, alpha));
            }
        }
    }
    function roadAlerts(s, state) {
        var light = state.trafficLight;
        if (light) {
            var colors = {red: [255, 90, 88], green: RECOMMENDED, yellow: [255, 201, 79]};
            var color = colors[light.color];
            // Pencil「453×200 安全区」左侧的实心灯和两位倒计时。
            s.rect(safeX(0), safeY(20), safeW(28), safeH(28), Math.min(safeW(28), safeH(28)) / 2, color, 1);
            s.text(String(light.seconds), safeX(35), safeY(20), safeFont(28), color);
        }
        if (state.speedLimitKmh !== null) {
            var limit = String(state.speedLimitKmh);
            var size = limit.length === 3 ? 22 : 25;
            var ring = [255, 81, 76], cx = safeX(3 + 18), cy = safeY(76 + 18);
            // 限速标志位于信号灯下方，保持透明圆心。
            drawSafeRing(s, cx, cy, safeW(36), safeH(36), ring);
            s.text(limit, cx - s.measure(limit, safeFont(size)) / 2, cy - safeFont(size) * 0.61, safeFont(size), WHITE);
        }
    }
    function render(raw, font, validationLabel, fontPct) {
        var state = nav.snapshot(raw), s = new Surface(font);
        var fs = typeof fontPct === 'number' && fontPct >= 80 && fontPct <= 140 ? fontPct / 100 : 1;
        function rect(x, y, w, h, r, color) { s.rect(x, y, w, h, r, color, 1); }
        function text(str, x, y, size, color, maxWidth) {
            return s.text(str, x, y, size, color, maxWidth);
        }
        function arrow(dir, x, y, w, h, color) {
            s.arrow(dir, x, y, w, h, color);
        }
        if (state.state === 'inactive') return s.pixels;
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
        if (state.state === 'rerouting' || state.state === 'arrived') {
            text(state.state === 'rerouting' ? '正在重新规划路线' : '已到达目的地', safeX(0), safeY(86), safeFont(20 * fs), WHITE, safeW(453));
            return s.pixels;
        }
        roadAlerts(s, state);
        if (state.currentRoad) {
            var curSize = safeFont(19.4 * fs);
            var cw = Math.min(safeW(260), s.measure(state.currentRoad, curSize));
            text(state.currentRoad, safeX(452) - cw, safeY(5), curSize, WHITE, safeW(260));
        }
        var dist = nav.distance(state.distanceM);
        if (state.direction) arrow(state.direction, safeX(76), safeY(0), safeW(99.6), safeH(98.25405405405404), WHITE);
        var digitSize = safeFont(25.2), unitSize = safeFont(19.2);
        var distanceWidth = s.measure(dist.value, digitSize) + safeW(6) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(84) / distanceWidth);
        digitSize *= fit; unitSize *= fit;
        var dw = text(dist.value, safeX(180), safeY(58) + safeFont(25.2) - digitSize, digitSize, WHITE);
        text(dist.unit, safeX(180) + dw + safeW(6), safeY(58) + safeFont(24.2) - unitSize, unitSize, GRAY);
        var title = state.exitLabel;
        var road = state.nextRoad || state.instruction;
        var roadSize = safeFont(18.2 * fs);
        if (title) {
            var badgeH = safeH(Math.round(25 * fs));
            var badgeWidth = Math.min(safeW(182), s.measure(title, roadSize) + safeW(12));
            rect(safeX(270), safeY(57), badgeWidth, badgeH, safeH(3), TRACK);
            text(title, safeX(270) + safeW(6), safeY(57), roadSize, WHITE, badgeWidth - safeW(12));
        } else if (road) {
            text(road, safeX(270), safeY(57), roadSize, WHITE, safeW(182));
        }
        // 仅有明确路段初始距离时显示进度；不伪造路况或拥堵色带。
        if (state.initialDistanceM > 0 && state.distanceM !== null) {
            rect(safeX(180), safeY(108), safeW(272), safeH(4.2), safeH(2.4), TRACK);
            var progress = 1 - Math.min(1, state.distanceM / state.initialDistanceM);
            if (progress > 0) rect(safeX(180), safeY(108), safeW(272 * progress), safeH(4.2), safeH(2.4), WHITE);
        }
        // 分隔线从右列开始，不延伸到左侧提示位。
        rect(safeX(180), safeY(125), safeW(273), safeH(0.6), 0, [32, 32, 32]);
        if (state.lanes.length) {
            var laneY = 136, laneH = 64, laneW = 272 / state.lanes.length;
            state.lanes.forEach(function(lane, i) {
                var sx = 180 + i * laneW;
                var x = safeX(sx);
                // 每条车道的左侧边界只读取来源数据；推荐状态不决定虚实线。
                if (i && lane.leftBoundary === 'solid') rect(x, safeY(laneY + 7.8), safeW(0.9), safeH(45.6), 0, LANE_LINE);
                if (i && lane.leftBoundary === 'dashed') {
                    for (var dash = 0; dash < 4; dash++) rect(x, safeY(laneY + 7.8 + dash * 12.6), safeW(0.9), safeH(7.2), 0, LANE_LINE);
                }
                // 画布已有的组合方向共用一根箭杆；其他组合仍分别排布。
                var combined = nav.laneIcon(lane.directions);
                var icons = combined ? [combined] : lane.directions;
                var cell = laneW / icons.length;
                icons.forEach(function(dir, j) {
                    var width = Math.min(40.8, laneW * 0.7);
                    var height = width * 219 / 222;
                    arrow(dir, safeX(sx + j * cell + (cell - width) / 2),
                        safeY(laneY + (laneH - height) / 2), safeW(width), safeH(height),
                        lane.recommended ? WHITE : DIM);
                });
                if (lane.recommended) rect(safeX(sx + laneW * 0.137), safeY(laneY + 55.2), safeW(laneW * 0.639), safeH(3), safeH(0.6), RECOMMENDED);
            });
        }
        var eta = trip(state);
        if (eta[0]) text(eta[0], safeX(0), safeY(152), safeFont(16 * fs), WHITE, safeW(110));
        if (eta[1]) text(eta[1], safeX(0), safeY(eta[0] ? 152 + Math.round(23 * fs) : 152), safeFont(14.8 * fs), GRAY, safeW(100));
        return s.pixels;
    }
    function strings(state) {
        // 字体在浏览器中按需准备。数字和固定状态文案也包含在内。
        return [state.currentRoad || '', state.nextRoad || '', state.instruction || '', state.exitLabel || '',
            trip(nav.snapshot(state)).join(' '), '0123456789.—mk正在重新规划路线已到达目的地'];
    }
    return { render: render, strings: strings, width: W, height: H };
}));
