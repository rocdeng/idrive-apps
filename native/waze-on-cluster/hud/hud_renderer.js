/* 800×480 RGBA HUD。浏览器和 Node 使用同一份像素绘制代码。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./hud_navigation.js'), require('./hud_arrows.js'));
    else root.HudRenderer = factory(root.HudNavigation, root.HudArrows);
}(this, function(nav, arrows) {
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
    function sampleGradient(grad, t) {
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
    // clip 可选，[x0, y0, x1, y1] 像素；只画这个矩形里的部分。
    Surface.prototype.shape = function(contours, color, clip) {
        var c0 = clip || [0, 0, W, H];
        var clipX0 = Math.max(0, Math.round(c0[0])), clipX1 = Math.min(W, Math.round(c0[2]));
        var ys = [].concat.apply([], contours).map(function(p) { return p[1]; });
        var minY = Math.max(0, Math.round(c0[1]), Math.floor(Math.min.apply(null, ys)));
        var maxY = Math.min(H, Math.round(c0[3]), Math.ceil(Math.max.apply(null, ys)));
        var isGrad = color && !Array.isArray(color);
        var gradientHeight = Math.max(1, maxY - minY - 1);
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
                    for (var x = Math.max(clipX0, Math.floor(start)); x < Math.min(clipX1, Math.ceil(end)); x++)
                        coverage[x] += Math.max(0, Math.min(x + 1, end) - Math.max(x, start)) / 4;
                }
            }
            var rowRgb = color, rowAlpha = 1;
            if (isGrad) {
                var g = sampleGradient(color, (y - minY) / gradientHeight);
                rowRgb = g.rgb; rowAlpha = g.alpha;
            }
            for (var cx = 0; cx < W; cx++) if (coverage[cx]) this.pixel(cx, y, rowRgb, coverage[cx] * rowAlpha);
        }
    };
    Surface.prototype.measure = function(str, size) {
        var font = this.font;
        return Array.from(str).reduce(function(n, ch) { var g = font.glyph(ch); return n + (g ? g.advance : 64) * size / 64; }, 0);
    };
    Surface.prototype.fitText = function(str, size, maxWidth) {
        if (this.measure(str, size) <= maxWidth) return str;
        var chars = Array.from(str);
        while (chars.length && this.measure(chars.join('') + '…', size) > maxWidth) chars.pop();
        return chars.join('') + '…';
    };
    Surface.prototype.text = function(str, x, y, size, color, maxWidth, bold) {
        str = String(str || '');
        if (maxWidth) str = this.fitText(str, size, maxWidth);
        var start = x, self = this;
        Array.from(str).forEach(function(ch) {
            var g = self.font.glyph(ch);
            if (!g) { x += size; return; }
            var scale = size / 64, pxScale = size / (g.s || 64);
            var width = g.w * pxScale, height = g.h * pxScale;
            var left = x + g.x * scale, top = y + g.y * scale;
            // 将字形轮廓向四周扩一格，再缩放到显示尺寸，保留字号和字距。
            var spread = bold ? 1 : 0, pad = spread * pxScale;
            function coverage(xx, yy) {
                return xx < 0 || yy < 0 || xx >= g.w || yy >= g.h ? 0 : g.pixels[yy * g.w + xx];
            }
            var at = bold ? function(xx, yy) {
                return Math.max(coverage(xx, yy), coverage(xx - 1, yy), coverage(xx + 1, yy),
                    coverage(xx, yy - 1), coverage(xx, yy + 1));
            } : coverage;
            for (var py = Math.floor(top - pad); py < Math.ceil(top + height + pad); py++) {
                for (var px = Math.floor(left - pad); px < Math.ceil(left + width + pad); px++) {
                    var sx = (px + 0.5 - left) / pxScale - 0.5, sy = (py + 0.5 - top) / pxScale - 0.5;
                    if (sx < -0.5 - spread || sy < -0.5 - spread || sx > g.w - 0.5 + spread || sy > g.h - 0.5 + spread) continue;
                    var ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
                    var a = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) +
                        at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
                    self.pixel(px, py, color, a / 255);
                }
            }
            x += g.advance * scale;
        });
        return x - start;
    };
    // 按 spec.md 绘制一个箭头：lit 是要走的分支名。先画暗的分支，再画亮的分支，让亮色盖住公共杆。
    // on 可以是颜色或渐变；暗色是 bg 与亮色按 35% 混合的不透明色，不用半透明。
    Surface.prototype.turnArrow = function(key, lit, x, y, w, h, on, opts) {
        var g = key && arrows.geometry(key);
        if (!g) return;
        var o = opts || {}, view = o.view || arrows.VIEW;
        var scale = Math.min(w / view[2], h / view[3]);
        var vx = x + (w - view[2] * scale) / 2, vy = y + (h - view[3] * scale) / 2;
        var ox = vx - view[0] * scale + g.tx * scale, oy = vy - view[1] * scale + g.ty * scale;
        // 和 SVG 一样裁掉视图外的部分，车道格子里的箭头不会画到相邻格子或分隔线上。
        var clip = [vx, vy, vx + view[2] * scale, vy + view[3] * scale];
        function place(contours) {
            return contours.map(function(c) { return c.map(function(p) { return [ox + p[0] * scale, oy + p[1] * scale]; }); });
        }
        if (!Array.isArray(on)) {
            // 主箭头共用一个渐变。分支和附加图形一起填充，公共杆的透明度只计算一次。
            var contours = g.branches.reduce(function(all, b) { return all.concat(b.contours); }, g.extra);
            this.shape(place(contours), on, clip);
            return;
        }
        var off = arrows.mix(o.bg || [0, 0, 0], on, arrows.DIM_RATIO);
        var known = !!lit && g.branches.some(function(b) { return b.name === lit; });
        function colorOf(b) { return g.isStatic || !lit ? on : known && b.name === lit ? on : off; }
        var self = this;
        g.branches.filter(function(b) { return colorOf(b) === off; })
            .concat(g.branches.filter(function(b) { return colorOf(b) !== off; }))
            .forEach(function(b) { self.shape(place(b.contours), colorOf(b), clip); });
        if (g.extra.length) this.shape(place(g.extra), on, clip);
    };
    // 所有 HUD 风格共用风格 1 的主箭头配色，渐变覆盖箭头的实际高度。
    var MAIN_ARROW_GRADIENT = { top: WHITE, mid: [235, 246, 255], bottom: [142, 174, 202], tailAlpha: 0.78 };
    function mainArrow(s, state, x, y, w, h) {
        s.turnArrow(arrows.keyFor(state.direction), null, x, y, w, h, MAIN_ARROW_GRADIENT);
        if (state.roundaboutExit === null) return;
        var number = String(state.roundaboutExit);
        // 圈号放在环岛箭头右下方的空白，保留箭头轮廓和指向。
        var cx = x + w * 0.70, cy = y + h * 0.72, diameter = Math.min(w, h) * 0.34;
        drawSafeRing(s, cx, cy, diameter, diameter, WHITE);
        var size = diameter * (number.length > 2 ? 0.44 : 0.57);
        var width = s.measure(number, size);
        s.text(number, cx - width / 2, cy - size * 0.61, size, WHITE);
    }
    // 旧风格的主箭头盒子按图形本身铺满设计。新箭头在 64×64 视图里约占 y 2.5–56.5，
    // 这里放大视图，让图形高度仍等于盒子高度、水平居中。
    function mainArrowFilled(s, state, x, y, w, h) {
        var size = h * 64 / 54;
        mainArrow(s, state, x + (w - size) / 2, y - 2.5 * size / 64, size, size);
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
    function textBounds(s, value) {
        return Array.from(value + '…').reduce(function(bounds, ch) {
            var glyph = s.font.glyph(ch);
            if (!glyph) return bounds;
            return [Math.min(bounds[0], glyph.y / 64),
                Math.max(bounds[1], glyph.y / 64 + glyph.h / (glyph.s || 64))];
        }, [Infinity, 0]);
    }
    // 按实际字形墨迹把一行字的垂直中心放到 cy（安全区坐标）。
    function centeredTextY(s, value, cy, size) {
        var bounds = Array.from(value).reduce(function(b, ch) {
            var glyph = s.font.glyph(ch);
            if (!glyph) return b;
            return [Math.min(b[0], glyph.y / 64), Math.max(b[1], glyph.y / 64 + glyph.h / (glyph.s || 64))];
        }, [Infinity, -Infinity]);
        return safeY(cy) - (isFinite(bounds[0]) ? (bounds[0] + bounds[1]) / 2 : 0.5) * size;
    }
    function etaSecondLine(s, value, y, size, maxWidth, first, firstY, firstSize) {
        var safeBottom = Math.floor(safeY(200));
        var bounds = textBounds(s, value);
        if (first) {
            // 先测第一行的实际字形底部。行距不足时压缩第二行字号，避免两行重叠。
            var firstBottom = safeY(firstY) + textBounds(s, first)[1] * firstSize + safeH(2);
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
    function drawStyleAlerts(s, state, style) {
        var light = state.trafficLight;
        var text = s.text.bind(s), rect = s.rect.bind(s);
        if (style === 1) {
            if (light) {
                var colors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
                var color = colors[light.color];
                drawTrafficLamp(s, safeX(14), safeY(20), safeW(28), safeH(28), color, 0.30);
                if (light.seconds !== null) {
                    text(String(light.seconds), safeX(35), safeY(6), safeFont(26), color);
                } else {
                    text(light.text || '注意', safeX(35), safeY(9), safeFont(19), color, safeW(48));
                }
            }
            if (state.speedLimitKmh !== null) {
                var limit = String(state.speedLimitKmh);
                var lSize = limit.length === 3 ? 21 : 24;
                var cx = safeX(434), cy = safeY(20);
                drawSafeRing(s, cx, cy, safeW(36), safeH(36), [255, 81, 76]);
                text(limit, cx - s.measure(limit, safeFont(lSize)) / 2, cy - safeFont(lSize) * 0.61, safeFont(lSize), WHITE);
            }
        } else if (style === 2) {
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
            if (state.speedLimitKmh !== null) {
                drawSpeedSignWhite(s, safeX(422), safeY(32), safeW(44), safeH(44), String(state.speedLimitKmh));
            }
        }
    }
    function drawCruiseStatusRow(s, state, fs, style) {
        var light = state.trafficLight;
        var hasSpeed = state.speedLimitKmh !== null;
        var colors = {red: [255, 76, 72], green: [64, 240, 152], yellow: [255, 198, 45]};
        var trafficW = 72, trafficX = 453 - trafficW - 4;
        // 453×200 安全区内，巡航三项共用一条水平中线；最高的限速牌底边留出 12 px 底距。
        var rowMid = 200 - 12 - 24;
        var thinSign = style === 1;
        var speedSize = thinSign ? 44 : 48;
        var roadOffset = hasSpeed ? speedSize + (state.currentRoad ? 12 : 0) : 0;
        var left = 4, right = light ? trafficX - 8 : 453 - 4;
        var roadSize = safeFont(28 * fs);
        var road = s.fitText(state.currentRoad, roadSize, safeW(right - left - roadOffset));
        var groupWidth = roadOffset + s.measure(road, roadSize) / SAFE_SCALE_X;
        // 限速和路名成组居中。长路名可以向左延伸，右侧给倒计时留空。
        var groupX = Math.max(left, Math.min((453 - groupWidth) / 2, right - groupWidth));
        if (hasSpeed) {
            if (thinSign) {
                var ringCx = groupX + 22, ringCy = rowMid;
                drawSafeRing(s, safeX(ringCx), safeY(ringCy), safeW(44), safeH(44), [255, 81, 76]);
                var limitSize = String(state.speedLimitKmh).length === 3 ? 22 : 25;
                s.text(String(state.speedLimitKmh),
                    safeX(ringCx) - s.measure(String(state.speedLimitKmh), safeFont(limitSize)) / 2,
                    safeY(ringCy) - safeFont(limitSize) * 0.61, safeFont(limitSize), WHITE);
            } else {
                drawSpeedSignWhite(s, safeX(groupX + 24), safeY(rowMid), safeW(48), safeH(48), String(state.speedLimitKmh));
            }
        }
        if (light) {
            var color = colors[light.color] || colors.yellow;
            var radius = style === 3 ? 10 : 22;
            s.rect(safeX(trafficX), safeY(rowMid - 22), safeW(trafficW), safeH(44), safeH(radius), [24, 28, 34], 1);
            drawGlowDot(s, safeX(trafficX + 16), safeY(rowMid), safeW(12), safeH(12), color);
            var lightText = light.seconds !== null ? String(light.seconds) : light.text || '注意';
            var lightSize = safeFont(light.seconds !== null ? 22 : 14);
            lightText = s.fitText(lightText, lightSize, safeW(38));
            s.text(lightText, safeX(trafficX + (light.seconds !== null ? 29 : 27)),
                centeredTextY(s, lightText, rowMid, lightSize), lightSize, light.seconds !== null ? WHITE : color);
        }
        if (!road) return;
        s.text(road, safeX(groupX + roadOffset), centeredTextY(s, road, rowMid, roadSize), roadSize, WHITE);
    }
    function renderCruise(s, state, fs, style) {
        drawCruiseStatusRow(s, state, fs, style);
        return s.pixels;
    }
    function renderStyle1(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color) { s.rect(x, y, w, h, r, color, 1); }
        function text(str, x, y, size, color, maxWidth) { return s.text(str, x, y, size, color, maxWidth); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
        // 1. 顶栏：红绿灯（左）+ 当前道路（中左）+ 限速（右）+ 贯穿分隔线
        var roadX = state.trafficLight ? 94 : 0;
        drawStyleAlerts(s, state, 1);
        if (state.currentRoad) {
            var topMaxW = state.speedLimitKmh !== null ? (402 - roadX) : (452 - roadX);
            s.text(state.currentRoad, safeX(roadX), safeY(7), safeFont(22 * fs), WHITE, safeW(topMaxW - 2), true);
        }
        rect(safeX(0), safeY(44), safeW(453), safeH(2), 0, [90, 98, 108]);

        // 2. 中栏：左侧渐变光导主箭头 + 右侧大号距离/前方路口 + 路名下方进度条
        if (state.direction) {
            mainArrowFilled(s, state, safeX(2), safeY(56), safeW(81), safeH(80));
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
                var height = Math.min(38, laneW * 0.68);
                laneArrows(s, lane, state, sx + laneW * 0.08, laneY + (laneH - 6 - height) / 2, laneW * 0.84, height,
                    RECOMMENDED, DIM, [0, 0, 0]);
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
    // 当前动作和车道箭头分支能对上的方向。急转、稍向按普通左右转对照，其余动作（环岛、到达、
    // 合流）不和车道箭头比较。
    var LANE_MANEUVERS = { left: ['left'], right: ['right'], straight: ['straight'], uturn: ['uturn'],
        slight_left: ['slight_left', 'left'], slight_right: ['slight_right', 'right'],
        sharp_left: ['left'], sharp_right: ['right'] };
    function laneKeys(lane) {
        var combined = nav.laneIcon(lane.directions);
        return (combined ? [combined] : lane.directions).map(arrows.keyFor).filter(Boolean);
    }
    // spec.md 第 6 节：推荐车道只点亮要走的那一支；车道箭头里没有当前动作时整条车道按非推荐处理。
    // 车机给了可跟随方向时，从中优先挑当前动作；没给时用当前动作本身去匹配箭头。
    function laneLighting(lane, direction) {
        var keys = laneKeys(lane);
        var inArrow = function(name) { return keys.some(function(key) { return arrows.hasBranch(key, name); }); };
        if (!lane.recommended || !keys.length) return { recommended: lane.recommended, lit: null };
        var wanted = LANE_MANEUVERS[direction] || null;
        var follow = (lane.follow || []).map(arrows.branchFor).filter(inArrow);
        if (follow.length) {
            var matched = wanted && wanted.filter(function(name) { return follow.indexOf(name) >= 0; })[0];
            return { recommended: true, lit: matched || follow[0] };
        }
        if (!wanted) return { recommended: true, lit: null };
        var hit = wanted.filter(inArrow)[0];
        return hit ? { recommended: true, lit: hit } : { recommended: false, lit: null };
    }
    // 车道箭头：推荐车道用 on 色，只点亮 lane.lit；非推荐车道整个画成 gray。
    // bg 是箭头所在底块的颜色，用来混合出暗色。box 是安全区坐标。
    function laneArrows(s, lane, state, x, y, w, h, on, gray, bg) {
        var keys = laneKeys(lane);
        var cell = w / Math.max(1, keys.length);
        keys.forEach(function(key, i) {
            s.turnArrow(key, lane.recommended ? lane.lit : null, safeX(x + i * cell), safeY(y), safeW(cell), safeH(h),
                lane.recommended ? on : gray, { view: arrows.LANE_VIEW, bg: bg });
        });
    }
    // 实心车道色块每侧的缩进（安全区单位）。车道多、色块窄时按比例减小。
    function laneInset(width) { return Math.min(5, width * 0.12); }
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
    function renderStyle2(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color, a) { s.rect(x, y, w, h, r, color, a === undefined ? 1 : a); }
        function text(str, x, y, size, color, maxWidth) { return s.text(str, x, y, size, color, maxWidth); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));

        // 1. 左侧悬浮大箭头 + 下方大号距离
        if (state.direction) {
            mainArrowFilled(s, state, safeX(16), safeY(10), safeW(89), safeH(88));
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
        drawStyleAlerts(s, state, 2);

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
                // 色块两侧各缩进几像素，不贴到虚实线上，绿块看起来不会太宽。
                var inset = laneInset(pillW);
                rect(safeX(px + inset), safeY(78), safeW(pillW - inset * 2), safeH(pillH), safeH(10), fill, 1);
                var ah = Math.min(30, pillH - 10);
                laneArrows(s, lane, state, px + inset + 3, 78 + (pillH - ah) / 2, pillW - inset * 2 - 6, ah,
                    [11, 18, 14], [138, 145, 154], fill);
            });
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
    // 方案 D（合并优化版）。设计稿 906×400 @2x 正好是 453×200 安全区，坐标按设计稿除以 2。
    var D_GREEN = [61, 220, 151], D_GRAY = [125, 131, 140], D_SUB = [154, 160, 168];
    // 按实际字形墨迹把一行字的底边放到 bottom（安全区坐标）。
    function inkBottomY(s, value, bottom, size) {
        var maxY = Array.from(value).reduce(function(b, ch) {
            var glyph = s.font.glyph(ch);
            return glyph ? Math.max(b, glyph.y / 64 + glyph.h / (glyph.s || 64)) : b;
        }, 0);
        return safeY(bottom) - maxY * size;
    }
    // 方案 D 的限速牌：硬边红圈，没有渐变。尺寸为安全区单位。
    function drawSpeedSignD(s, cx, cy, d, limitStr) {
        var r = safeH(d / 2), ring = safeH(3), red = [229, 40, 45];
        var x0 = safeX(cx), y0 = safeY(cy);
        for (var y = Math.floor(y0 - r - 1); y < Math.ceil(y0 + r + 1); y++) {
            for (var x = Math.floor(x0 - r - 1); x < Math.ceil(x0 + r + 1); x++) {
                var dist = Math.hypot(x + 0.5 - x0, y + 0.5 - y0);
                var outer = Math.max(0, Math.min(1, r - dist + 0.5));
                if (!outer) continue;
                var inRing = Math.max(0, Math.min(1, dist - (r - ring) + 0.5));
                s.pixel(x, y, WHITE, outer * (1 - inRing));
                if (inRing) s.pixel(x, y, red, outer * inRing);
            }
        }
        var fsz = safeFont(limitStr.length === 3 ? 17 : 21);
        s.text(limitStr, x0 - s.measure(limitStr, fsz) / 2, centeredTextY(s, limitStr, cy, fsz), fsz, [17, 17, 17], 0, true);
    }
    // 方案 D 的车道线：2 单位宽，虚线暗灰 4 实 2.5 空，实线浅灰，y 84–131。
    function drawLaneBoundaryD(s, x, type) {
        if (type === 'solid') s.rect(safeX(x - 1), safeY(84), safeW(2), safeH(47), 0, [179, 179, 179], 1);
        if (type === 'dashed') {
            for (var y = 84; y < 131; y += 6.5) s.rect(safeX(x - 1), safeY(y), safeW(2), safeH(Math.min(4, 131 - y)), 0, [77, 77, 77], 1);
        }
    }
    function renderStyle3(s, state, validationLabel, fs, dfs) {
        function rect(x, y, w, h, r, color, a) { s.rect(x, y, w, h, r, color, a === undefined ? 1 : a); }
        function text(str, x, y, size, color, maxWidth, bold) { return s.text(str, x, y, size, color, maxWidth, bold); }
        if (validationLabel) text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));

        // 1. 左上：大号渐变主箭头（64×64 视图，实际图形约占 x 15–86、y 9–95）
        if (state.direction) mainArrow(s, state, safeX(-1), safeY(5), safeW(102), safeH(102));
        // 距离数字和单位底边对齐在 y 143，整体不超过车道区左边。
        var dist = nav.distance(state.distanceM);
        var digitSize = safeFont(40 * dfs), unitSize = safeFont(18 * dfs);
        var distW = s.measure(dist.value, digitSize) + safeW(6) + s.measure(dist.unit, unitSize);
        var fit = Math.min(1, safeW(128) / distW);
        digitSize *= fit; unitSize *= fit;
        var dw = text(dist.value, safeX(15), inkBottomY(s, dist.value, 143, digitSize), digitSize, WHITE, 0, true);
        if (dist.unit) text(dist.unit, safeX(15) + dw + safeW(6), inkBottomY(s, dist.unit, 143, unitSize), unitSize, [214, 218, 224]);

        // 2. 右上：动作副标题 + 大号目标路名 + 红绿灯倒计时 + 限速牌
        var light = state.trafficLight, hasSpeed = state.speedLimitKmh !== null;
        var titleRight = hasSpeed ? 390 : 440;
        if (light) {
            var lightColors = { red: [255, 82, 72], green: [61, 220, 151], yellow: [255, 198, 45] };
            var lc = lightColors[light.color] || lightColors.yellow;
            var lt = light.seconds !== null ? String(light.seconds) : light.text || '注意';
            var lsz = safeFont(light.seconds !== null ? 26 : 16);
            var textRight = hasSpeed ? 377 : 440;
            var tx = safeX(textRight) - s.measure(lt, lsz);
            drawGlowDot(s, tx - safeW(15), safeY(34), safeW(14), safeH(14), lc);
            text(lt, tx, centeredTextY(s, lt, 34, lsz), lsz, lc, 0, true);
            titleRight = Math.min(titleRight, (tx - safeX(0)) / SAFE_SCALE_X - 34);
        }
        if (hasSpeed) drawSpeedSignD(s, 418, 34, 44, String(state.speedLimitKmh));
        var sub = state.exitLabel || directionLabel(state.direction);
        var subSize = safeFont(16 * fs);
        if (sub) {
            sub = s.fitText(sub, subSize, safeW(titleRight - 150));
            text(sub, safeX(150), centeredTextY(s, sub, 20, subSize), subSize, D_SUB);
        }
        var road = state.nextRoad || state.instruction;
        var roadSize = safeFont(29 * fs);
        if (road) {
            road = s.fitText(road, roadSize, safeW(titleRight - 150));
            text(road, safeX(150), centeredTextY(s, road, 52, roadSize), roadSize, WHITE, 0, true);
        }

        // 3. 车道行：透明底，箭头 24×34，车道之间画虚实线，推荐车道下方画绿线
        if (state.lanes.length) {
            var n = state.lanes.length;
            var cellW = Math.min(41.5, 292 / n), laneX = 149;
            state.lanes.forEach(function(lane, i) {
                var cx = laneX + i * cellW;
                if (i) drawLaneBoundaryD(s, cx, lane.leftBoundary);
                var aw = Math.min(24, cellW - 8), ah = aw * 62 / 44;
                laneArrows(s, lane, state, cx + (cellW - aw) / 2, 106 - ah / 2, aw, ah, D_GREEN, D_GRAY, [0, 0, 0]);
                if (lane.recommended) {
                    var bw = Math.min(30, cellW - 10);
                    rect(safeX(cx + (cellW - bw) / 2), safeY(128), safeW(bw), safeH(3), safeH(1.5), D_GREEN);
                }
            });
        }

        // 4. 底部：全宽进度条 + 当前路名 + 剩余时间和里程
        rect(safeX(14), safeY(157.5), safeW(425), safeH(5), safeH(2.5), [51, 53, 58]);
        if (state.initialDistanceM > 0 && state.distanceM !== null) {
            var p = 1 - Math.min(1, state.distanceM / state.initialDistanceM);
            if (p > 0) rect(safeX(14), safeY(157.5), safeW(425 * p), safeH(5), safeH(2.5), WHITE);
        }
        var etaLine = formatEtaCompact(state), esz = safeFont(15.5 * fs), etaW = 0;
        if (etaLine) {
            etaLine = s.fitText(etaLine, esz, safeW(215));
            etaW = s.measure(etaLine, esz) / SAFE_SCALE_X;
            text(etaLine, safeX(439 - etaW), centeredTextY(s, etaLine, 178, esz), esz, D_SUB);
        }
        if (state.currentRoad) {
            var crSize = safeFont(19 * fs);
            var cr = s.fitText(state.currentRoad, crSize, safeW(439 - 14 - etaW - 16));
            text(cr, safeX(14), centeredTextY(s, cr, 178, crSize), crSize, WHITE, 0, true);
        }
        return s.pixels;
    }
    // 风格编号只有 1、2、3。其他值（包括旧版本存下的编号）一律按风格 1。
    var STYLE_COUNT = 3;
    function normalizeStyle(style) {
        return Number.isInteger(style) && style >= 1 && style <= STYLE_COUNT ? style : 1;
    }
    function render(raw, font, validationLabel, fontPct, style) {
        var state = nav.snapshot(raw), s = new Surface(font);
        // 每帧先统一决定车道亮灭，各风格的底块、底线和箭头都按这个结果画。
        state.lanes = state.lanes.map(function(lane) {
            var l = laneLighting(lane, state.direction);
            return Object.assign({}, lane, { recommended: l.recommended, lit: l.lit });
        });
        style = normalizeStyle(style);
        var fs = typeof fontPct === 'number' && fontPct >= 80 && fontPct <= 150 ? fontPct / 100 : 1;
        if (style >= 2) fs = Math.min(fs, 1);
        var dfs = 1 + (fs - 1) * 0.5;
        if (state.state === 'inactive') return s.pixels;
        if (state.state === 'cruising') return renderCruise(s, state, fs, style);
        if (state.state === 'rerouting' || state.state === 'arrived') {
            if (validationLabel) s.text(validationLabel, safeX(0), safeY(-18), safeFont(12), [255, 196, 64], safeW(453));
            s.text(state.state === 'rerouting' ? '正在重新规划路线' : '已到达目的地', safeX(0), safeY(86), safeFont(20 * fs), WHITE, safeW(453));
            return s.pixels;
        }
        if (style === 2) return renderStyle2(s, state, validationLabel, fs, dfs);
        if (style === 3) return renderStyle3(s, state, validationLabel, fs, dfs);
        return renderStyle1(s, state, validationLabel, fs, dfs);
    }
    function strings(state) {
        // 字体在浏览器中按需准备。数字和固定状态文案也包含在内。
        return [state.currentRoad || '', state.nextRoad || '', state.instruction || '', state.exitLabel || '',
            trip(nav.snapshot(state)).join(' '), '0123456789.—mk正在重新规划路线已到达目的地'];
    }
    // 单独画一个箭头，供验收测试和预览使用：size×size 的 64×64 视图放在左上角。
    function renderArrow(key, lit, size, on, bg) {
        var s = new Surface(null);
        s.turnArrow(key, lit, 0, 0, size, size, on, { bg: bg });
        return s.pixels;
    }
    return { render: render, normalizeStyle: normalizeStyle, styleCount: STYLE_COUNT, renderArrow: renderArrow, strings: strings, width: W, height: H };
}));
