/* 硬朗实心转向箭头。几何数据原样取自设计稿 arrow-data.json（64×64 网格，箭杆线宽 10）。
 * 每个方向是一条分支：箭杆路径（平切端点、尖角拐角）加三角形箭头头部。
 * 这里把路径展开成可填充的多边形轮廓，绘制和亮灭由 hud_renderer.js 负责。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HudArrows = factory();
}(this, function() {
    'use strict';
    var DATA = {"grid":64,"stroke":10,"headSpec":{"halfWidth":14,"length":18,"branchScale":0.8},"maneuvers":["left","right","straight","slight_left","slight_right","uturn","merge_left","merge_right"],"arrows":{"left-turn":{"zh":"左转","translate":[-0.5,-3.5],"static":false,"branches":[{"name":"left","d":"M49 60V34A14 14 0 0 0 35 20H29L27.5 20","head":[[11.0,20.0],[29.0,6.0],[29.0,34.0]]}],"extra":null},"right-turn":{"zh":"右转","translate":[0.5,-3.5],"static":false,"branches":[{"name":"right","d":"M15 60V34A14 14 0 0 1 29 20H35L36.5 20","head":[[53.0,20.0],[35.0,34.0],[35.0,6.0]]}],"extra":null},"slight-left":{"zh":"稍向左","translate":[1.0,-7.66],"static":false,"branches":[{"name":"slight_left","d":"M38 60V42L31 29.9L30.25 28.6","head":[[22.0,14.31],[43.12,22.9],[18.88,36.9]]}],"extra":null},"slight-right":{"zh":"稍向右","translate":[-1.0,-7.66],"static":false,"branches":[{"name":"slight_right","d":"M26 60V42L33 29.9L33.75 28.6","head":[[42.0,14.31],[45.12,36.9],[20.88,22.9]]}],"extra":null},"u-turn":{"zh":"掉头","translate":[2.5,-3.0],"static":false,"branches":[{"name":"uturn","d":"M46 58V24A12 12 0 0 0 22 24V40L22 41.5","head":[[22.0,58.0],[8.0,40.0],[36.0,40.0]]}],"extra":null},"roundabout":{"zh":"环岛","translate":[-3.5,-7.0],"static":true,"branches":[{"name":"stem","d":"M26 60V42","head":[]},{"name":"exit","d":"M38 30H44L45.5 30","head":[[62.0,30.0],[44.0,44.0],[44.0,16.0]]}],"extra":"<circle cx=\"26\" cy=\"30\" r=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"10\"/>"},"arrive":{"zh":"到达（方格旗）","translate":[-1.5,-1.0],"static":true,"branches":[],"extra":"<rect x=\"12\" y=\"6\" width=\"7\" height=\"54\" fill=\"currentColor\"/><rect x=\"20.5\" y=\"7.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"37\" y=\"7.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"28.75\" y=\"16.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"45.25\" y=\"16.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"20.5\" y=\"25.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"37\" y=\"25.5\" width=\"8.25\" height=\"9\" fill=\"currentColor\"/><rect x=\"20.5\" y=\"7.5\" width=\"33\" height=\"27\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/>"},"straight":{"zh":"直行","translate":[0.0,-2.5],"static":false,"branches":[{"name":"straight","d":"M32 60V22L32 20.5","head":[[32.0,4.0],[46.0,22.0],[18.0,22.0]]}],"extra":null},"straight-or-left":{"zh":"直行或左转","translate":[-4.3,-2.5],"static":false,"branches":[{"name":"straight","d":"M44 60V22L44 20.5","head":[[44.0,4.0],[58.0,22.0],[30.0,22.0]]},{"name":"left","d":"M44 58V52A10 10 0 0 0 34 42H29L27.5 42","head":[[14.6,42.0],[29.0,30.8],[29.0,53.2]]}],"extra":null},"straight-or-right":{"zh":"直行或右转","translate":[4.3,-2.5],"static":false,"branches":[{"name":"straight","d":"M20 60V22L20 20.5","head":[[20.0,4.0],[34.0,22.0],[6.0,22.0]]},{"name":"right","d":"M20 58V52A10 10 0 0 1 30 42H35L36.5 42","head":[[49.4,42.0],[35.0,53.2],[35.0,30.8]]}],"extra":null},"left-or-right":{"zh":"左转或右转","translate":[0.0,-14.34],"static":false,"branches":[{"name":"left","d":"M32 62V50L17.86 35.86L16.8 34.8","head":[[7.68,25.68],[25.78,27.94],[9.94,43.78]]},{"name":"right","d":"M32 62V50L46.14 35.86L47.2 34.8","head":[[56.32,25.68],[54.06,43.78],[38.22,27.94]]}],"extra":null},"straight-or-uturn":{"zh":"直行或掉头","translate":[-3.4,-2.5],"static":false,"branches":[{"name":"straight","d":"M46 60V22L46 20.5","head":[[46.0,4.0],[60.0,22.0],[32.0,22.0]]},{"name":"uturn","d":"M46 56V44A12 12 0 0 0 22 44V48L22 49.5","head":[[22.0,62.4],[10.8,48.0],[33.2,48.0]]}],"extra":null},"left-or-uturn":{"zh":"左转或掉头","translate":[-0.5,-1.5],"static":false,"branches":[{"name":"left","d":"M48 60V28A12 12 0 0 0 36 16H30L28.5 16","head":[[12.0,16.0],[30.0,2.0],[30.0,30.0]]},{"name":"uturn","d":"M48 56V48A10 10 0 0 0 28 48V50L28 51.5","head":[[28.0,64.4],[16.8,50.0],[39.2,50.0]]}],"extra":null},"curve-left":{"zh":"左弯／向左合流","translate":[-4.0,-4.89],"static":false,"branches":[{"name":"merge_left","d":"M42 60V44Q42 32 36 23.5L35.14 22.27","head":[[25.62,8.79],[47.44,15.43],[24.56,31.57]]}],"extra":null},"curve-right":{"zh":"右弯／向右合流","translate":[4.0,-4.89],"static":false,"branches":[{"name":"merge_right","d":"M22 60V44Q22 32 28 23.5L28.86 22.27","head":[[38.38,8.79],[39.44,31.57],[16.56,15.43]]}],"extra":null}},"laneIcons":{"bus":{"zh":"公交车道","neverLit":true,"svg":"<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\" stroke-linejoin=\"round\"><rect x=\"17\" y=\"6\" width=\"30\" height=\"46\" rx=\"7\"/><rect x=\"23\" y=\"12\" width=\"18\" height=\"20\" rx=\"3\"/><path d=\"M12 19H17M52 19H47\"/></g><g fill=\"currentColor\"><rect x=\"10\" y=\"13\" width=\"4\" height=\"14\" rx=\"2\"/><rect x=\"50\" y=\"13\" width=\"4\" height=\"14\" rx=\"2\"/><circle cx=\"24\" cy=\"42\" r=\"3\"/><circle cx=\"40\" cy=\"42\" r=\"3\"/><rect x=\"21\" y=\"52\" width=\"6\" height=\"7\" rx=\"1.5\"/><rect x=\"37\" y=\"52\" width=\"6\" height=\"7\" rx=\"1.5\"/></g>"}}};
    var MITER_LIMIT = 4; // SVG 默认值
    // 导航方向名 → 箭头数据键。数据里没有急转，用普通左右转代替。
    var KEY_BY_DIRECTION = { left: 'left-turn', right: 'right-turn', straight: 'straight',
        slight_left: 'slight-left', slight_right: 'slight-right', sharp_left: 'left-turn', sharp_right: 'right-turn',
        uturn: 'u-turn', roundabout: 'roundabout', arrive: 'arrive',
        straight_left: 'straight-or-left', straight_right: 'straight-or-right', left_right: 'left-or-right',
        straight_uturn: 'straight-or-uturn', left_uturn: 'left-or-uturn',
        merge_left: 'curve-left', merge_right: 'curve-right' };
    // 导航方向名 → 分支名（用来决定点亮哪一支）。
    var BRANCH_BY_DIRECTION = { sharp_left: 'left', sharp_right: 'right' };

    function signedArea(pts) {
        var a = 0;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i], q = pts[(i + 1) % pts.length];
            a += p[0] * q[1] - q[0] * p[1];
        }
        return a / 2;
    }
    // 统一成正面积方向，nonzero 填充时多块重叠也只算一次并集。
    function positive(pts) { return signedArea(pts) < 0 ? pts.slice().reverse() : pts; }
    function negative(pts) { return signedArea(pts) > 0 ? pts.slice().reverse() : pts; }

    function arcPoints(x1, y1, r, large, sweep, x2, y2) {
        // SVG 端点参数化转圆心参数化（rx = ry，不旋转）。
        var hx = (x1 - x2) / 2, hy = (y1 - y2) / 2;
        var lambda = (hx * hx + hy * hy) / (r * r);
        if (lambda > 1) r *= Math.sqrt(lambda);
        var num = r * r * r * r - r * r * hy * hy - r * r * hx * hx;
        var den = r * r * hy * hy + r * r * hx * hx;
        var coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, den ? num / den : 0));
        var cxp = coef * hy, cyp = -coef * hx;
        var cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
        var a0 = Math.atan2((hy - cyp) / r, (hx - cxp) / r);
        var a1 = Math.atan2((-hy - cyp) / r, (-hx - cxp) / r);
        var da = a1 - a0;
        if (!sweep && da > 0) da -= 2 * Math.PI;
        if (sweep && da < 0) da += 2 * Math.PI;
        var steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 24))), out = [];
        for (var i = 1; i <= steps; i++) {
            var a = a0 + da * i / steps;
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        out[out.length - 1] = [x2, y2];
        return out;
    }
    // 只支持数据里出现的绝对坐标命令：M L H V A Q Z。
    function parsePath(d) {
        var tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [], i = 0, cmd = '';
        var lines = [], cur = null, x = 0, y = 0;
        function num() { return parseFloat(tokens[i++]); }
        while (i < tokens.length) {
            if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
            if (cmd === 'M') { x = num(); y = num(); cur = [[x, y]]; lines.push(cur); cmd = 'L'; }
            else if (cmd === 'L') { x = num(); y = num(); cur.push([x, y]); }
            else if (cmd === 'H') { x = num(); cur.push([x, y]); }
            else if (cmd === 'V') { y = num(); cur.push([x, y]); }
            else if (cmd === 'A') {
                var r = num(); num(); num();
                var large = num() ? 1 : 0, sweep = num() ? 1 : 0, ex = num(), ey = num();
                Array.prototype.push.apply(cur, arcPoints(x, y, r, large, sweep, ex, ey));
                x = ex; y = ey;
            } else if (cmd === 'Q') {
                var qx = num(), qy = num(), ex2 = num(), ey2 = num();
                for (var s = 1; s <= 16; s++) {
                    var t = s / 16, u = 1 - t;
                    cur.push([u * u * x + 2 * u * t * qx + t * t * ex2, u * u * y + 2 * u * t * qy + t * t * ey2]);
                }
                x = ex2; y = ey2;
            } else if (cmd === 'Z' || cmd === 'z') { if (cur) cur.push(cur[0].slice()); cmd = ''; }
            else throw new Error('不支持的路径命令 ' + cmd);
        }
        return lines;
    }
    // 折线描边成多边形：每段一个矩形（平切端点），拐角补外侧尖角。
    function strokePolyline(pts, width) {
        var clean = [];
        pts.forEach(function(p) {
            var last = clean[clean.length - 1];
            if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push(p);
        });
        var hw = width / 2, out = [], dirs = [];
        for (var i = 1; i < clean.length; i++) {
            var a = clean[i - 1], b = clean[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            var d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-d[1] * hw, d[0] * hw];
            dirs.push(d);
            out.push(positive([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]],
                [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]));
        }
        for (var j = 1; j < dirs.length; j++) {
            var d0 = dirs[j - 1], d1 = dirs[j], v = clean[j];
            var cross = d0[0] * d1[1] - d0[1] * d1[0];
            if (Math.abs(cross) < 1e-9) continue;
            var side = cross > 0 ? -1 : 1;
            var n0 = [-d0[1] * side, d0[0] * side], n1 = [-d1[1] * side, d1[0] * side];
            var pa = [v[0] + n0[0] * hw, v[1] + n0[1] * hw], pb = [v[0] + n1[0] * hw, v[1] + n1[1] * hw];
            var m = [n0[0] + n1[0], n0[1] + n1[1]], ml = Math.hypot(m[0], m[1]);
            var cosHalf = ml / 2;
            if (ml < 1e-9 || 1 / cosHalf > MITER_LIMIT) { out.push(positive([v, pa, pb])); continue; }
            var k = hw / cosHalf / ml;
            out.push(positive([v, pa, [v[0] + m[0] * k, v[1] + m[1] * k], pb]));
        }
        return out;
    }
    function circle(cx, cy, r) {
        var pts = [];
        for (var i = 0; i < 64; i++) pts.push([cx + r * Math.cos(i * Math.PI / 32), cy + r * Math.sin(i * Math.PI / 32)]);
        return pts;
    }
    // 圆角矩形轮廓，r 为 0 时就是普通矩形。
    function rectPts(x, y, w, h, r) {
        r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
        if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        var pts = [], corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0],
            [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
        corners.forEach(function(c) {
            for (var i = 0; i <= 8; i++) {
                var a = c[2] + i * Math.PI / 16;
                pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
            }
        });
        return pts;
    }
    // 设计数据里的 SVG 片段（extra、laneIcons）。只支持其中出现的 g、rect（含 rx）、circle 和
    // 只有直线的 path；fill、stroke、stroke-width 可以写在外层 g 上继承。颜色一律当 currentColor。
    // 描边矩形和圆按外轮廓减内轮廓画，圆角处的 round 拐角由圆角本身体现；path 端点平切。
    function parseSvg(svg) {
        var contours = [], stack = [{ fill: true, stroke: false, sw: 0 }];
        function attrsOf(text) {
            var a = {};
            text.replace(/([\w-]+)="([^"]*)"/g, function(_, k, v) { a[k] = v; });
            return a;
        }
        function style(a) {
            var top = stack[stack.length - 1];
            return { fill: a.fill !== undefined ? a.fill !== 'none' : top.fill,
                stroke: a.stroke !== undefined ? a.stroke !== 'none' : top.stroke,
                sw: a['stroke-width'] !== undefined ? parseFloat(a['stroke-width']) : top.sw };
        }
        (svg || '').replace(/<(\/?)(g|rect|circle|path)\b([^>]*?)(\/?)>/g, function(_, close, tag, attrText, selfClose) {
            if (tag === 'g') {
                if (close) stack.pop(); else if (!selfClose) stack.push(style(attrsOf(attrText)));
                return '';
            }
            var a = attrsOf(attrText), st = style(a), hw = st.sw / 2;
            if (tag === 'rect') {
                var x = +a.x, y = +a.y, w = +a.width, h = +a.height, r = +(a.rx || 0);
                if (st.fill) contours.push(positive(rectPts(x, y, w, h, r)));
                if (st.stroke && st.sw > 0) {
                    contours.push(positive(rectPts(x - hw, y - hw, w + st.sw, h + st.sw, r ? r + hw : 0)),
                        negative(rectPts(x + hw, y + hw, w - st.sw, h - st.sw, Math.max(0, r - hw))));
                }
            } else if (tag === 'circle') {
                var cx = +a.cx, cy = +a.cy, cr = +a.r;
                if (st.fill) contours.push(positive(circle(cx, cy, cr)));
                if (st.stroke && st.sw > 0) {
                    contours.push(positive(circle(cx, cy, cr + hw)), negative(circle(cx, cy, Math.max(0, cr - hw))));
                }
            } else if (st.stroke && st.sw > 0) {
                parsePath(a.d).forEach(function(line) {
                    Array.prototype.push.apply(contours, strokePolyline(line, st.sw));
                });
            }
            return '';
        });
        return contours;
    }
    var cache = Object.create(null);
    function geometry(key) {
        if (cache[key]) return cache[key];
        var a = DATA.arrows[key];
        if (!a) return null;
        cache[key] = {
            key: key, isStatic: a.static === true, tx: a.translate[0], ty: a.translate[1],
            branches: a.branches.map(function(b) {
                var contours = [];
                parsePath(b.d).forEach(function(line) {
                    Array.prototype.push.apply(contours, strokePolyline(line, DATA.stroke));
                });
                if (b.head.length === 3) contours.push(positive(b.head.map(function(p) { return p.slice(); })));
                // 设计数据里有些分支比同一公共杆上的另一支起点高 2–4 个单位（例如直行或右转的右转支）。
                // 点亮这一支时把公共杆补到最低的起点，否则杆底会留一截暗色。
                var start = parsePath(b.d)[0], x0 = start[0][0], y0 = start[0][1];
                var vertical = start.length > 1 && Math.abs(start[1][0] - x0) < 1e-6 && start[1][1] < y0;
                var lowest = a.branches.reduce(function(y, other) {
                    var p = parsePath(other.d)[0][0];
                    return Math.abs(p[0] - x0) < 1e-6 ? Math.max(y, p[1]) : y;
                }, y0);
                if (vertical && lowest > y0) contours.push(positive(rectPts(x0 - DATA.stroke / 2, y0, DATA.stroke, lowest - y0)));
                return { name: b.name, contours: contours };
            }),
            extra: parseSvg(a.extra)
        };
        return cache[key];
    }
    // 车道图标（公交车道等）：不是转向箭头，永远不点亮，坐标同样是 64×64。
    var iconCache = Object.create(null);
    function laneIcon(name) {
        var icon = DATA.laneIcons && DATA.laneIcons[name];
        if (!icon) return null;
        if (!iconCache[name]) iconCache[name] = { name: name, neverLit: icon.neverLit === true, contours: parseSvg(icon.svg) };
        return iconCache[name];
    }
    function keyFor(direction) { return KEY_BY_DIRECTION[direction] || null; }
    function branchFor(direction) { return BRANCH_BY_DIRECTION[direction] || direction || null; }
    function hasBranch(key, branch) {
        var g = geometry(key);
        return !!(g && branch && g.branches.some(function(b) { return b.name === branch; }));
    }
    // 暗色是背景色与亮色按比例混合的不透明色。
    function mix(bg, fg, t) { return [0, 1, 2].map(function(i) { return Math.round(bg[i] + (fg[i] - bg[i]) * t); }); }
    return { data: DATA, geometry: geometry, laneIcon: laneIcon, keyFor: keyFor, branchFor: branchFor, hasBranch: hasBranch, mix: mix,
        DIM_RATIO: 0.35, VIEW: [0, 0, 64, 64], LANE_VIEW: [10, 1, 44, 62] };
}));
