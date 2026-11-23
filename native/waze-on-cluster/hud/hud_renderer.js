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
    function sampleGradient(grad, y) {
        var t = Math.max(0, Math.min(1, (y - grad.y0) / (grad.h || 1)));
        var a, b, u, alpha;
        if (t <= 0.42) {
            a = grad.top; b = grad.mid; u = t / 0.42; alpha = 1;
        } else {
            a = grad.mid; b = grad.bottom; u = (t - 0.42) / 0.58;
            alpha = 1 - (1 - grad.tailAlpha) * u;
        }
        return {
            rgb: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
            alpha: alpha
        };
    }
    Surface.prototype.shape = function(contours, color) {
        var ys = [].concat.apply([], contours).map(function(p) { return p[1]; });
        var minY = Math.max(0, Math.floor(Math.min.apply(null, ys)));
        var maxY = Math.min(H, Math.ceil(Math.max.apply(null, ys)));
        var isGrad = color && !Array.isArray(color);
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
            var rowRgb = color, rowAlpha = 1;
            if (isGrad) {
                var g = sampleGradient(color, y);
                rowRgb = g.rgb; rowAlpha = g.alpha;
            }
            for (var cx = 0; cx < W; cx++) if (coverage[cx]) this.pixel(cx, y, rowRgb, coverage[cx] * rowAlpha);
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
    function mainArrow(s, state, x, y, w, h, color) {
        s.arrow(state.direction, x, y, w, h, color);
        if (state.roundaboutExit === null) return;
        var number = String(state.roundaboutExit);
        // 圈号放在环岛箭头右下方的空白，保留箭头轮廓和指向。
        var cx = x + w * 0.70, cy = y + h * 0.72, diameter = Math.min(w, h) * 0.34;
        drawSafeRing(s, cx, cy, diameter, diameter, WHITE);
        var size = diameter * (number.length > 2 ? 0.44 : 0.57);
        var width = s.measure(number, size);
        s.text(number, cx - width / 2, cy - size * 0.61, size, WHITE);
    }
    function trip(state) {
        var distance = '', time = '';
        if (state.remainingDistanceM !== null) {
            var d = nav.distance(state.remainingDistanceM);
            distance = d.value + (d.unit === 'km' ? ' 公里' : ' 米');
        }
        if (state.arrivalClock) time = state.arrivalClock + ' 到达';
        else if (state.remainingTimeS !== null) time = Math.ceil(state.remainingTimeS / 60) + ' 分钟';
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
    function etaBounds(s, value) {
        return Array.from(value + '…').reduce(function(bounds, ch) {
            var glyph = s.font.glyph(ch);
            if (!glyph) return bounds;
            return [Math.min(bounds[0], glyph.y / 64),
                Math.max(bounds[1], glyph.y / 64 + glyph.h / (glyph.s || 64))];
        }, [Infinity, 0]);
    }
    function etaSecondLine(s, value, y, size, maxWidth, first, firstY, firstSize) {
        var safeBottom = Math.floor(safeY(200));
        var bounds = etaBounds(s, value);
        if (first) {
            // 先测第一行的实际字形底部。行距不足时压缩第二行字号，避免两行重叠。
            var firstBottom = safeY(firstY) + etaBounds(s, first)[1] * firstSize + safeH(2);
            var height = bounds[1] - bounds[0];
            if (height > 0) size = Math.min(size, (safeBottom - firstBottom) / height);
        }
        if (size > 0) s.text(value, safeX(0), Math.min(safeY(y), safeBottom - bounds[1] * size), size, GRAY, safeW(maxWidth));
    }
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
    function drawTrafficLamp(s, cx, cy, w, h, ringColor, fillAlpha) {
        var rx = w / 2, ry = h / 2, inner = 0.76;
        for (var y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
            for (var x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
                var r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
                if (r >= 1.08) continue;
                var outerCov = Math.max(0, Math.min(1, (1 - r) * 8));
                var ringMix = Math.max(0, Math.min(1, (r - inner) * 10));
                var alpha = outerCov * (fillAlpha + (1 - fillAlpha) * ringMix);
                if (alpha > 0) s.pixel(x, y, ringColor, alpha);
            }
        }
    }
    function roadAlerts(s, state) {
        var light = state.trafficLight;
        if (light) {
            var colors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
            var color = colors[light.color];
            // 外圈饱和深色圆环 + 内部柔和浅色通透填充。
            drawTrafficLamp(s, safeX(14), safeY(34), safeW(28), safeH(28), color, 0.30);
            if (light.seconds !== null) {
                s.text(String(light.seconds), safeX(35), safeY(20), safeFont(28), color);
            } else {
                s.text(light.text || '注意', safeX(35), safeY(23), safeFont(19), color, safeW(48));
            }
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
    function renderCockpit(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color) { s.rect(x, y, w, h, r, color, 1); }
        function text(str, x, y, size, color, maxWidth) { return s.text(str, x, y, size, color, maxWidth); }
        function arrow(dir, x, y, w, h, color) { s.arrow(dir, x, y, w, h, color); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
        // 1. 顶栏：红绿灯（左）+ 当前道路（中左）+ 限速（右）+ 贯穿细分隔线
        var light = state.trafficLight;
        var roadX = 0;
        if (light) {
            var colors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
            var color = colors[light.color];
            drawTrafficLamp(s, safeX(14), safeY(20), safeW(28), safeH(28), color, 0.30);
            if (light.seconds !== null) {
                text(String(light.seconds), safeX(35), safeY(6), safeFont(26), color);
                roadX = 94;
            } else {
                text(light.text || '注意', safeX(35), safeY(9), safeFont(19), color, safeW(48));
                roadX = 94;
            }
        }
        if (state.currentRoad) {
            var topMaxW = state.speedLimitKmh !== null ? (402 - roadX) : (452 - roadX);
            text(state.currentRoad, safeX(roadX), safeY(7), safeFont(22 * fs), WHITE, safeW(Math.max(120, topMaxW)));
        }
        if (state.speedLimitKmh !== null) {
            var limit = String(state.speedLimitKmh);
            var lSize = limit.length === 3 ? 21 : 24;
            var cx = safeX(434), cy = safeY(20);
            drawSafeRing(s, cx, cy, safeW(36), safeH(36), [255, 81, 76]);
            text(limit, cx - s.measure(limit, safeFont(lSize)) / 2, cy - safeFont(lSize) * 0.61, safeFont(lSize), WHITE);
        }
        rect(safeX(0), safeY(44), safeW(453), safeH(1), 0, [48, 48, 48]);

        // 2. 中栏：左侧渐变光导主箭头 + 右侧大号距离/前方路口 + 路名下方进度条
        if (state.direction) {
            var ay = safeY(56), ah = safeH(80);
            var mainGrad = { top: WHITE, mid: [235, 246, 255], bottom: [142, 174, 202], tailAlpha: 0.78, y0: ay, h: ah };
            mainArrow(s, state, safeX(2), ay, safeW(81), ah, mainGrad);
        }
        var dist = nav.distance(state.distanceM);
        var digitSize = safeFont(36 * dfs), unitSize = safeFont(18 * dfs);
        var distanceWidth = s.measure(dist.value, digitSize) + safeW(5) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(96) / distanceWidth);
        digitSize *= fit; unitSize *= fit;
        var dw = text(dist.value, safeX(128), safeY(64) + safeFont(36) - digitSize, digitSize, WHITE);
        text(dist.unit, safeX(128) + dw + safeW(5), safeY(64) + safeFont(34) - unitSize, unitSize, GRAY);
        var title = state.exitLabel;
        var road = state.nextRoad || state.instruction;
        var roadSize = safeFont(22 * fs);
        if (title) {
            var badgeH = safeH(Math.round(28 * fs));
            var badgeWidth = Math.min(safeW(222), s.measure(title, roadSize) + safeW(12));
            rect(safeX(230), safeY(70), badgeWidth, badgeH, safeH(3), TRACK);
            text(title, safeX(230) + safeW(6), safeY(70), roadSize, WHITE, badgeWidth - safeW(12));
        } else if (road) {
            text(road, safeX(230), safeY(71), roadSize, WHITE, safeW(222));
        }
        if (state.initialDistanceM > 0 && state.distanceM !== null) {
            rect(safeX(230), safeY(114), safeW(222), safeH(3.5), safeH(1.75), TRACK);
            var progress = 1 - Math.min(1, state.distanceM / state.initialDistanceM);
            if (progress > 0) rect(safeX(230), safeY(114), safeW(222 * progress), safeH(3.5), safeH(1.75), WHITE);
        }

        // 3. 底栏：左侧时间优先 ETA + 右侧透明底青绿推荐车道与虚实线
        var eta = trip(state);
        if (eta[1]) {
            text(eta[1], safeX(0), safeY(148), safeFont(19 * fs), WHITE, safeW(140));
            if (eta[0]) etaSecondLine(s, eta[0], 148 + Math.round(26 * fs), safeFont(15 * fs), 140, eta[1], 148, safeFont(19 * fs));
        } else if (eta[0]) {
            text(eta[0], safeX(0), safeY(152), safeFont(18 * fs), WHITE, safeW(140));
        }
        if (state.lanes.length) {
            var laneY = 142, laneH = 56, laneW = 256 / state.lanes.length;
            state.lanes.forEach(function(lane, i) {
                var sx = 196 + i * laneW;
                var x = safeX(sx);
                if (i && lane.leftBoundary === 'solid') rect(x, safeY(laneY + 4), safeW(0.9), safeH(44), 0, LANE_LINE);
                if (i && lane.leftBoundary === 'dashed') {
                    for (var dash = 0; dash < 4; dash++) rect(x, safeY(laneY + 4 + dash * 12), safeW(0.9), safeH(7), 0, LANE_LINE);
                }
                var combined = nav.laneIcon(lane.directions);
                var icons = combined ? [combined] : lane.directions;
                var cell = laneW / icons.length;
                icons.forEach(function(dir, j) {
                    var width = Math.min(38, laneW * 0.68);
                    var height = width * 219 / 222;
                    arrow(dir, safeX(sx + j * cell + (cell - width) / 2),
                        safeY(laneY + (laneH - 6 - height) / 2), safeW(width), safeH(height),
                        lane.recommended ? RECOMMENDED : DIM);
                });
                if (lane.recommended) rect(safeX(sx + laneW * 0.14), safeY(laneY + 51), safeW(laneW * 0.72), safeH(2.8), safeH(0.6), RECOMMENDED);
            });
        }
        return s.pixels;
    }
    function directionLabel(dir) {
        var map = {
            left: '左转进入', right: '右转进入', straight: '直行进入',
            slight_left: '向左前方行驶', slight_right: '向右前方行驶',
            sharp_left: '向左后方转弯', sharp_right: '向右后方转弯',
            uturn: '前方掉头', roundabout: '进入环岛', arrive: '到达目的地',
            merge_left: '向左汇入', merge_right: '向右汇入'
        };
        return map[dir] || '';
    }
    function drawLaneBoundary(s, x, y, type) {
        if (type === 'solid') s.rect(safeX(x), safeY(y), safeW(0.9), safeH(44), 0, LANE_LINE, 1);
        if (type === 'dashed') {
            for (var i = 0; i < 4; i++) s.rect(safeX(x), safeY(y + i * 12), safeW(0.9), safeH(7), 0, LANE_LINE, 1);
        }
    }
    function formatEtaCompact(state) {
        var parts = [];
        if (state.arrivalClock) parts.push(state.arrivalClock + ' 到达');
        else if (state.remainingTimeS !== null) parts.push(Math.ceil(state.remainingTimeS / 60) + ' 分钟');
        else if (state.arrivalUnix !== null) {
            var dt = new Date((state.arrivalUnix + 8 * 3600) * 1000);
            parts.push(('0' + dt.getUTCHours()).slice(-2) + ':' + ('0' + dt.getUTCMinutes()).slice(-2) + ' 到达');
        }
        if (state.remainingDistanceM !== null) {
            var d = nav.distance(state.remainingDistanceM);
            parts.push(d.value + ' ' + d.unit);
        }
        return parts.join(' · ');
    }
    function drawSpeedSignWhite(s, cx, cy, w, h, limitStr) {
        var rx = w / 2, ry = h / 2, inner = 0.77;
        var red = [225, 42, 46];
        for (var y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
            for (var x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
                var r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
                if (r >= 1.06) continue;
                var outerCov = Math.max(0, Math.min(1, (1 - r) * 8));
                if (r <= inner) {
                    s.pixel(x, y, WHITE, outerCov);
                } else {
                    var mix = Math.max(0, Math.min(1, (r - inner) * 10));
                    var c = [
                        WHITE[0] + (red[0] - WHITE[0]) * mix,
                        WHITE[1] + (red[1] - WHITE[1]) * mix,
                        WHITE[2] + (red[2] - WHITE[2]) * mix
                    ];
                    s.pixel(x, y, c, outerCov);
                }
            }
        }
        var sz = limitStr.length === 3 ? 17 : 21;
        var fsz = safeFont(sz);
        s.text(limitStr, cx - s.measure(limitStr, fsz) / 2, cy - fsz * 0.61, fsz, [18, 20, 24]);
    }
    function drawGlowDot(s, cx, cy, w, h, color) {
        var rx = w / 2, ry = h / 2;
        var grx = rx * 1.6, gry = ry * 1.6;
        for (var y = Math.floor(cy - gry); y < Math.ceil(cy + gry); y++) {
            for (var x = Math.floor(cx - grx); x < Math.ceil(cx + grx); x++) {
                var r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
                if (r <= 1.05) {
                    s.pixel(x, y, color, Math.max(0, Math.min(1, (1 - r) * 8)));
                } else if (r < 1.6) {
                    var glow = Math.pow(1 - (r - 1) / 0.6, 2) * 0.32;
                    s.pixel(x, y, color, glow);
                }
            }
        }
    }
    function renderStyle3(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color, a) { s.rect(x, y, w, h, r, color, a === undefined ? 1 : a); }
        function text(str, x, y, size, color, maxWidth) { return s.text(str, x, y, size, color, maxWidth); }
        function arrow(dir, x, y, w, h, color) { s.arrow(dir, x, y, w, h, color); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));

        // 1. 左侧悬浮大箭头 + 下方大号距离
        if (state.direction) {
            var ay = safeY(10), ah = safeH(88);
            var mainGrad = { top: WHITE, mid: [238, 247, 255], bottom: [176, 198, 218], tailAlpha: 0.86, y0: ay, h: ah };
            mainArrow(s, state, safeX(16), ay, safeW(89), ah, mainGrad);
        }
        var dist = nav.distance(state.distanceM);
        var digitSize = safeFont(38 * dfs), unitSize = safeFont(18 * dfs);
        var dwTotal = s.measure(dist.value, digitSize) + safeW(4) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(118) / dwTotal);
        digitSize *= fit; unitSize *= fit;
        var dw = text(dist.value, safeX(8), safeY(106) + safeFont(38) - digitSize, digitSize, WHITE);
        text(dist.unit, safeX(8) + dw + safeW(4), safeY(106) + safeFont(36) - unitSize, unitSize, [184, 192, 200]);

        // 2. 顶部中间动作副标题 + 大号目标路名 + 右上角白底红圈限速
        var sub = state.exitLabel || directionLabel(state.direction);
        if (sub) text(sub, safeX(142), safeY(5), safeFont(17 * fs), [158, 166, 176], safeW(240));
        var road = state.nextRoad || state.instruction;
        if (road) text(road, safeX(142), safeY(28), safeFont(27 * fs), WHITE, safeW(242));
        if (state.speedLimitKmh !== null) {
            drawSpeedSignWhite(s, safeX(422), safeY(32), safeW(44), safeH(44), String(state.speedLimitKmh));
        }

        // 3. 中右部：实心亮绿推荐车道胶囊 + 右侧红绿灯药丸
        var light = state.trafficLight;
        var laneAreaW = light ? 214 : 302;
        if (state.lanes.length) {
            var n = state.lanes.length;
            var gap = 6;
            var pillW = Math.min(48, (laneAreaW - gap * (n - 1)) / n);
            var pillH = 44;
            state.lanes.forEach(function(lane, i) {
                var px = 142 + i * (pillW + gap);
                if (i) drawLaneBoundary(s, px - gap / 2, 78, lane.leftBoundary);
                var fill = lane.recommended ? [74, 232, 156] : [29, 33, 39];
                rect(safeX(px), safeY(78), safeW(pillW), safeH(pillH), safeH(10), fill, 1);
                var combined = nav.laneIcon(lane.directions);
                var icons = combined ? [combined] : lane.directions;
                var cell = (pillW - 8) / icons.length;
                icons.forEach(function(dir, j) {
                    var aw = Math.min(26, cell);
                    var ah = aw * 219 / 222;
                    arrow(dir, safeX(px + 4 + j * cell + (cell - aw) / 2),
                        safeY(78 + (pillH - ah) / 2), safeW(aw), safeH(ah),
                        lane.recommended ? [11, 18, 14] : [138, 145, 154]);
                });
            });
        }
        if (light) {
            var lColors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
            var lc = lColors[light.color];
            rect(safeX(366), safeY(78), safeW(80), safeH(44), safeH(22), [27, 30, 35], 1);
            drawGlowDot(s, safeX(386), safeY(100), safeW(14), safeH(14), lc);
            if (light.seconds !== null) {
                text(String(light.seconds), safeX(402), safeY(87), safeFont(22), WHITE, safeW(38));
            } else {
                text(light.text || '注意', safeX(400), safeY(91), safeFont(14), lc, safeW(40));
            }
        }

        // 4. 底部全宽节点进度条 + 底部当前路名与整合 ETA
        if (state.initialDistanceM > 0 && state.distanceM !== null) {
            var p = 1 - Math.min(1, state.distanceM / state.initialDistanceM);
            rect(safeX(8), safeY(156), safeW(438), safeH(5), safeH(2.5), [46, 50, 56], 1);
            if (p > 0) rect(safeX(8), safeY(156), safeW(438 * p), safeH(5), safeH(2.5), WHITE, 1);
            var kx = 8 + 438 * p;
            rect(safeX(kx - 5.5), safeY(153), safeW(11), safeH(11), safeH(5.5), WHITE, 1);
        } else {
            rect(safeX(8), safeY(158), safeW(438), safeH(1), 0, [42, 46, 52], 1);
        }
        if (state.currentRoad) text(state.currentRoad, safeX(8), safeY(170), safeFont(19 * fs), [152, 160, 170], safeW(215));
        var etaLine = formatEtaCompact(state);
        if (etaLine) {
            var esz = safeFont(15.5 * fs);
            var ew = Math.min(safeW(215), s.measure(etaLine, esz));
            text(etaLine, safeX(446) - ew, safeY(173), esz, WHITE, safeW(215));
        }
        return s.pixels;
    }
    function renderStyle4(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color, a) { s.rect(x, y, w, h, r, color, a === undefined ? 1 : a); }
        function text(str, x, y, size, color, maxWidth) { return s.text(str, x, y, size, color, maxWidth); }
        function arrow(dir, x, y, w, h, color) { s.arrow(dir, x, y, w, h, color); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));

        // 1. 左侧深色圆角卡片（内含主箭头 + 大号距离）
        rect(safeX(4), safeY(6), safeW(146), safeH(144), safeH(18), [20, 24, 30], 1);
        if (state.direction) {
            var ay = safeY(16), ah = safeH(76);
            var mainGrad = { top: WHITE, mid: [238, 247, 255], bottom: [176, 198, 218], tailAlpha: 0.86, y0: ay, h: ah };
            mainArrow(s, state, safeX(38), ay, safeW(77), ah, mainGrad);
        }
        var dist = nav.distance(state.distanceM);
        var digitSize = safeFont(36 * dfs), unitSize = safeFont(17 * dfs);
        var dwTotal = s.measure(dist.value, digitSize) + safeW(4) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(126) / dwTotal);
        digitSize *= fit; unitSize *= fit;
        var dxStart = safeX(77) - (s.measure(dist.value, digitSize) + safeW(4) + s.measure(dist.unit, unitSize)) / 2;
        var dw = text(dist.value, dxStart, safeY(98) + safeFont(36) - digitSize, digitSize, WHITE);
        text(dist.unit, dxStart + dw + safeW(4), safeY(98) + safeFont(34) - unitSize, unitSize, [184, 192, 200]);

        // 2. 右上动作副标题 + 目标路名 + 白底红圈限速
        var sub = state.exitLabel || directionLabel(state.direction);
        if (sub) text(sub, safeX(168), safeY(5), safeFont(17 * fs), [158, 166, 176], safeW(214));
        var road = state.nextRoad || state.instruction;
        if (road) text(road, safeX(168), safeY(26), safeFont(26 * fs), WHITE, safeW(216));
        if (state.speedLimitKmh !== null) {
            drawSpeedSignWhite(s, safeX(424), safeY(32), safeW(44), safeH(44), String(state.speedLimitKmh));
        }

        // 3. 中右部：暗绿底+底部亮绿条推荐车道卡片 + 圆角矩形红绿灯卡片
        var light = state.trafficLight;
        var laneAreaW = light ? 196 : 276;
        if (state.lanes.length) {
            var n = state.lanes.length;
            var gap = 6;
            var cardW = Math.min(44, (laneAreaW - gap * (n - 1)) / n);
            var cardH = 44;
            state.lanes.forEach(function(lane, i) {
                var px = 168 + i * (cardW + gap);
                if (i) drawLaneBoundary(s, px - gap / 2, 74, lane.leftBoundary);
                var fill = lane.recommended ? [16, 43, 32] : [23, 27, 33];
                rect(safeX(px), safeY(74), safeW(cardW), safeH(cardH), safeH(9), fill, 1);
                if (lane.recommended) {
                    rect(safeX(px + 2), safeY(74 + cardH - 4), safeW(cardW - 4), safeH(4), safeH(2), [74, 232, 156], 1);
                }
                var combined = nav.laneIcon(lane.directions);
                var icons = combined ? [combined] : lane.directions;
                var cell = (cardW - 8) / icons.length;
                icons.forEach(function(dir, j) {
                    var aw = Math.min(25, cell);
                    var ah = aw * 219 / 222;
                    arrow(dir, safeX(px + 4 + j * cell + (cell - aw) / 2),
                        safeY(74 + (cardH - 4 - ah) / 2), safeW(aw), safeH(ah),
                        lane.recommended ? WHITE : [126, 134, 144]);
                });
            });
        }
        if (light) {
            var lColors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
            var lc = lColors[light.color];
            rect(safeX(374), safeY(74), safeW(74), safeH(44), safeH(10), [24, 28, 34], 1);
            drawGlowDot(s, safeX(392), safeY(96), safeW(14), safeH(14), lc);
            if (light.seconds !== null) {
                text(String(light.seconds), safeX(407), safeY(83), safeFont(21), WHITE, safeW(36));
            } else {
                text(light.text || '注意', safeX(405), safeY(87), safeFont(14), lc, safeW(38));
            }
        }

        // 4. 底部当前路名 + 整合 ETA + 最底全宽渐变进度条
        if (state.currentRoad) text(state.currentRoad, safeX(6), safeY(159), safeFont(19 * fs), [152, 160, 170], safeW(215));
        var etaLine = formatEtaCompact(state);
        if (etaLine) {
            var esz = safeFont(15.5 * fs);
            var ew = Math.min(safeW(215), s.measure(etaLine, esz));
            text(etaLine, safeX(448) - ew, safeY(162), esz, WHITE, safeW(215));
        }
        if (state.initialDistanceM > 0 && state.distanceM !== null) {
            var p = 1 - Math.min(1, state.distanceM / state.initialDistanceM);
            rect(safeX(6), safeY(188), safeW(442), safeH(5), safeH(2.5), [38, 42, 48], 1);
            if (p > 0) {
                var fillW = 442 * p;
                var segs = 12;
                var sw = fillW / segs;
                for (var k = 0; k < segs; k++) {
                    var u = (k + 0.5) / segs;
                    var v = Math.round(115 + 140 * u);
                    rect(safeX(6 + k * sw), safeY(188), safeW(sw + 0.6), safeH(5), k === 0 || k === segs - 1 ? safeH(2.5) : 0, [v, v + 3 > 255 ? 255 : v + 3, v + 6 > 255 ? 255 : v + 6], 1);
                }
            }
        }
        return s.pixels;
    }
    function render(raw, font, validationLabel, fontPct, style) {
        var state = nav.snapshot(raw), s = new Surface(font);
        var fs = typeof fontPct === 'number' && fontPct >= 80 && fontPct <= 150 ? fontPct / 100 : 1;
        if (style === 3 || style === 4) fs = Math.min(fs, 1);
        var dfs = 1 + (fs - 1) * 0.5;
        function rect(x, y, w, h, r, color) { s.rect(x, y, w, h, r, color, 1); }
        function text(str, x, y, size, color, maxWidth) {
            return s.text(str, x, y, size, color, maxWidth);
        }
        function arrow(dir, x, y, w, h, color) {
            s.arrow(dir, x, y, w, h, color);
        }
        if (state.state === 'inactive') return s.pixels;
        if (state.state === 'rerouting' || state.state === 'arrived') {
            if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
            text(state.state === 'rerouting' ? '正在重新规划路线' : '已到达目的地', safeX(0), safeY(86), safeFont(20 * fs), WHITE, safeW(453));
            return s.pixels;
        }
        if (style === 2) return renderCockpit(s, state, validationLabel, fs, dfs);
        if (style === 3) return renderStyle3(s, state, validationLabel, fs, dfs);
        if (style === 4) return renderStyle4(s, state, validationLabel, fs, dfs);
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
        roadAlerts(s, state);
        if (state.currentRoad) {
            var curSize = safeFont(19.4 * fs);
            var cw = Math.min(safeW(260), s.measure(state.currentRoad, curSize));
            text(state.currentRoad, safeX(452) - cw, safeY(5), curSize, WHITE, safeW(260));
        }
        var dist = nav.distance(state.distanceM);
        if (state.direction) {
            var ay = safeY(0), ah = safeH(98.25405405405404);
            // 方案 A 渐变光导：箭尖高光纯白平滑过渡到箭尾柔灰蓝。
            var mainGrad = { top: WHITE, mid: [235, 246, 255], bottom: [142, 174, 202], tailAlpha: 0.78, y0: ay, h: ah };
            mainArrow(s, state, safeX(76), ay, safeW(99.6), ah, mainGrad);
        }
        var digitSize = safeFont(25.2 * dfs), unitSize = safeFont(19.2 * dfs);
        var distanceWidth = s.measure(dist.value, digitSize) + safeW(6) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(88) / distanceWidth);
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
        if (eta[1]) etaSecondLine(s, eta[1], eta[0] ? 152 + Math.round(23 * fs) : 152, safeFont(14.8 * fs), 100, eta[0], 152, safeFont(16 * fs));
        return s.pixels;
    }
    function strings(state) {
        // 字体在浏览器中按需准备。数字和固定状态文案也包含在内。
        return [state.currentRoad || '', state.nextRoad || '', state.instruction || '', state.exitLabel || '',
            trip(nav.snapshot(state)).join(' '), '0123456789.—mk正在重新规划路线已到达目的地'];
    }
    return { render: render, strings: strings, width: W, height: H };
}));
