'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs'), net = require('net'), path = require('path'), vm = require('vm');
const { StructuredHud } = require('../src/structured_hud.js');
const { GuidanceReader, IFACE, INSTANCE, VIEW } = require('../src/guidance_reader.js');
const nav = require('../src/hud_navigation.js');
const { HudEngine, startDaemon } = require('../../../native/waze-on-cluster/hud/hud_daemon.js');
const renderer = require('../../../native/waze-on-cluster/hud/hud_renderer.js');
const Font = require('../../../native/waze-on-cluster/hud/hud_font.js');
const { recognizeBaiduSpeedLimit } = require('../../../native/waze-on-cluster/hud/hud_baidu_speed_limit.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 100; i++) { if (check()) return; await sleep(10); }
    throw new Error('等待状态超时');
}
const reply = { viewContent: [{ eventsInView: [{ intersection: { direction: 'LEFT',
    formattedDistance: { distance: '147', unit: { name: 'METER' } },
    description: { text: '前方左转' }, distanceToDestination: 3153 } }] }] };

function testCongestedSpeedLimit() {
    const width = 1088, height = 480, lumaSize = width * height;
    const atlas = Buffer.alloc(lumaSize * 1.5, 128);
    atlas.fill(27, 0, lumaSize);
    function red(x, y) {
        atlas[y * width + x] = 85;
        const uv = lumaSize + (y >> 1) * width + (x >> 1);
        atlas[uv] = 112;
        atlas[uv + width / 2] = 208;
    }
    function sign(cx, cy) {
        for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) {
            const radius = Math.hypot(x, y);
            if (radius >= 16.5 && radius <= 20) red(cx + x, cy + y);
        }
        // 夜间限速 30 的小字形样本，写到 Y 平面。
        const glyphs = ['3c7ec3c0603878c0c0c37e3c', '3c7e66c3c3c3c3c3c3627e3c'];
        glyphs.forEach((glyph, i) => {
            const rows = Buffer.from(glyph, 'hex');
            for (let y = 0; y < rows.length; y++) for (let x = 0; x < 8; x++) {
                if (rows[y] & (1 << x)) atlas[(cy - 6 + y) * width + cx - 9 + i * 11 + x] = 240;
            }
        });
    }
    const detect = () => recognizeBaiduSpeedLimit(atlas, width, height, 0);
    function congestion(y, step) {
        for (let i = 0; i < 5; i++) {
            const top = y + i * step;
            for (let row = top; row < top + 6; row++) for (let x = 250; x < 820; x++) red(x, row);
        }
    }
    sign(498, 378);
    assert.strictEqual(detect(), 30, '合成 YUV 限速牌可识别');
    const clear = Buffer.from(atlas);
    congestion(238, 18);
    assert.strictEqual(detect(), 30, '限速牌上方的拥堵红线不能阻断识别');
    clear.copy(atlas);
    congestion(406, 13);
    assert.strictEqual(detect(), 30, '限速牌下方的拥堵红线不能丢弃已找到的牌');
    sign(700, 378);
    assert.strictEqual(detect(), null, '即使有拥堵红线，也要拒绝多个限速候选');
}

// spec.md 第 7 节验收：组合箭头只亮要走的一支，公共杆亮，暗色是不透明混合色。
function testArrowLighting() {
    const arrows = require('../../../native/waze-on-cluster/hud/hud_arrows.js');
    const size = 256, k = size / 64, white = [255, 255, 255], off = [89, 89, 89];
    const at = (px, key, gx, gy) => {
        const g = arrows.geometry(key), x = Math.floor((gx + g.tx) * k), y = Math.floor((gy + g.ty) * k);
        return Array.from(px.slice((y * 800 + x) * 4, (y * 800 + x) * 4 + 4));
    };
    // 每个组合：公共杆底部一点、各分支箭头头部重心。
    const centroid = (head) => [(head[0][0] + head[1][0] + head[2][0]) / 3, (head[0][1] + head[1][1] + head[2][1]) / 3];
    for (const key of ['straight-or-left', 'straight-or-right', 'left-or-right', 'straight-or-uturn', 'left-or-uturn']) {
        const branches = arrows.data.arrows[key].branches;
        // 公共杆取所有分支起点里最高的那个再往上 4，保证每条分支都经过这一点。
        const starts = branches.map((b) => b.d.match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number));
        const stem = [starts[0][0], Math.min(...starts.map((p) => p[1]))];
        for (const lit of branches) {
            const px = renderer.renderArrow(key, lit.name, size, white, [0, 0, 0]);
            assert.deepStrictEqual(at(px, key, stem[0], stem[1] - 4), [...white, 255], key + ' 点亮 ' + lit.name + ' 时公共杆是亮的');
            // 公共杆最底端（最低起点往上 0.5）也要亮，不能留一截暗色。
            const bottom = Math.max(...starts.filter((p) => p[0] === stem[0]).map((p) => p[1]));
            assert.deepStrictEqual(at(px, key, stem[0], bottom - 0.5), [...white, 255], key + ' 点亮 ' + lit.name + ' 时杆底是亮的');
            for (const b of branches) {
                const [hx, hy] = centroid(b.head);
                assert.deepStrictEqual(at(px, key, hx, hy), [...(b === lit ? white : off), 255],
                    key + ' 点亮 ' + lit.name + ' 时 ' + b.name + ' ' + (b === lit ? '亮' : '是不透明暗色'));
            }
        }
        // 箭头里没有要走的方向：整个暗掉，公共杆两条暗分支重叠处也不能叠出别的颜色。
        const none = renderer.renderArrow(key, 'merge_left', size, white, [0, 0, 0]);
        assert.deepStrictEqual(at(none, key, stem[0], stem[1] - 4), [...off, 255], key + ' 非推荐时公共杆是同一暗色');
        assert(!Array.from(none).some((v, i) => i % 4 === 0 && v > 89), key + ' 非推荐时没有亮的部分');
    }
    // 绿色底块上的暗色要和底块混合，不是和黑色混合。
    const tile = [74, 232, 156], dark = [11, 18, 14];
    const onTile = renderer.renderArrow('straight-or-right', 'right', size, dark, tile);
    const [sx, sy] = centroid(arrows.data.arrows['straight-or-right'].branches[0].head);
    assert.deepStrictEqual(at(onTile, 'straight-or-right', sx, sy).slice(0, 3), arrows.mix(tile, dark, 0.35), '底块上的暗色按底块混合');
    // 环岛和到达永远全亮，即使给了要走的方向。
    for (const key of ['roundabout', 'arrive']) {
        const px = renderer.renderArrow(key, 'left', size, white, [0, 0, 0]);
        assert(!Array.from(px).some((v, i) => i % 4 === 0 && v > 0 && v < 250 && px[i + 3] === 255), key + ' 不做减亮');
    }
    // 车道格子按 10 1 44 62 视图裁切，超出的部分不画（环岛出口、左转或右转、直行或掉头会超出）。
    for (const key of ['roundabout', 'left-or-right', 'straight-or-uturn']) {
        const g = arrows.geometry(key);
        const xs = [].concat(...g.branches.map((b) => b.contours), g.extra).flat().map((p) => p[0] + g.tx);
        assert(Math.min(...xs) < 10 || Math.max(...xs) > 54, key + ' 的图形确实超出车道视图');
    }
    console.log('通过：组合箭头只亮要走的一支、公共杆亮、暗色不透明、非推荐整体暗');
}

// 风格 3 车道亮灭：车机给的可跟随方向里优先挑当前动作；箭头里没有当前动作的车道整条置灰；
// 车道格子外不画箭头。
function testLaneLighting(laneFont) {
    const green = [61, 220, 151], dim = [21, 77, 53], gray = [125, 131, 140];
    const cellW = 41.5, laneX = 149;
    const colorsIn = (frame, i) => {
        const x0 = Math.ceil((laneX + i * cellW + 0.5) * 800 / 454), x1 = Math.floor((laneX + (i + 1) * cellW + 0.5) * 800 / 454);
        const y0 = Math.ceil((86 + 36) * 480 / 272), y1 = Math.floor((126 + 36) * 480 / 272);
        const seen = new Set();
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const p = (y * 800 + x) * 4;
            if (frame[p + 3] === 255) seen.add(frame.slice(p, p + 3).join(','));
        }
        return seen;
    };
    const has = (set, c) => set.has(c.join(','));
    const render = (lanes, direction) => renderer.render({ state: 'navigating', direction, lanes }, laneFont, null, 100, 3);
    // 亮色像素的水平重心：右转支在格子右侧，直行支在左侧。
    const greenCentroid = (frame) => {
        let sum = 0, n = 0;
        for (let y = 0; y < 480; y++) for (let x = 0; x < 800; x++) {
            const p = (y * 800 + x) * 4;
            if (frame[p + 3] === 255 && frame[p] === 61 && frame[p + 1] === 220 && y < Math.floor((126 + 36) * 480 / 272)) { sum += x; n++; }
        }
        return sum / n;
    };
    const center = safePx(laneX + cellW / 2);
    // 可跟随 [直行, 右转]，当前右转：右转亮、直行暗；当前直行则反过来。
    let frame = render([{ directions: ['straight', 'right'], kind: null, recommended: true, follow: ['straight', 'right'] }], 'right');
    let c = colorsIn(frame, 0);
    assert(has(c, green) && has(c, dim) && !has(c, gray), '组合车道一亮一暗');
    assert(greenCentroid(frame) > center, '多个可跟随方向时点亮当前动作（右转）');
    frame = render([{ directions: ['straight', 'right'], kind: null, recommended: true, follow: ['straight', 'right'] }], 'straight');
    assert(greenCentroid(frame) < center, '多个可跟随方向时点亮当前动作（直行）');
    // 车机没给可跟随方向，当前右转，车道只有直行和左转：整条置灰，也没有绿线。
    frame = render([{ directions: ['straight', 'left'], recommended: true }], 'right');
    c = colorsIn(frame, 0);
    assert(has(c, gray) && !has(c, green) && !has(c, dim), '不通向当前动作的推荐车道整条置灰');
    const underline = (Math.floor((129.5 + 36) * 480 / 272) * 800 + Math.floor((laneX + cellW / 2 + 0.5) * 800 / 454)) * 4;
    assert.strictEqual(frame[underline + 3], 0, '置灰的车道不画推荐绿线');
    // 稍向右按右转匹配，不被置灰。
    frame = render([{ directions: ['straight', 'right'], recommended: true }], 'slight_right');
    c = colorsIn(frame, 0);
    assert(has(c, green) && has(c, dim), '稍向右匹配右转支');
    // 环岛箭头的出口超出车道视图，格子右边缘外一列不能有箭头像素。
    frame = render([{ directions: ['roundabout'], recommended: true }], 'roundabout');
    const aw = 24, ah = aw * 62 / 44, ax = laneX + (cellW - aw) / 2;
    const right = Math.ceil(safePx(ax + aw)) + 1;
    for (let y = Math.floor((106 - ah / 2 + 36) * 480 / 272); y < Math.ceil((106 + ah / 2 + 36) * 480 / 272); y++) {
        assert.strictEqual(frame[(y * 800 + right) * 4 + 3], 0, '车道箭头裁到视图内');
    }
    // spec.md 第 9 节：车机不推荐的公交车道是灰色图标，不亮、没有绿色下划线。
    // 例外（规则 1）：车机推荐公交车道、而且它的箭头里有当前转向时（只能从公交车道右转），
    // 照常画亮的箭头和下划线，右下角叠公交角标。
    const busCell = 1;
    const busUnderline = (Math.floor((129.5 + 36) * 480 / 272) * 800 + Math.floor((laneX + cellW * 1.5 + 0.5) * 800 / 454)) * 4;
    const plain = { directions: ['straight'], recommended: false };
    const adapters = [nav, require('../../../native/waze-on-cluster/hud/hud_navigation.js')];
    for (const adapter of adapters) {
        const kept = adapter.snapshot({ state: 'navigating', lanes: [plain,
            { directions: ['right'], kind: 'bus', recommended: true, follow: ['right'] }] }).lanes[1];
        assert.deepStrictEqual(kept, { directions: ['right'], kind: 'bus', recommended: true, follow: ['right'], leftBoundary: null },
            '车机推荐的公交车道保留推荐和可跟随方向');
    }
    // 1. 车机不推荐：灰色图标。
    frame = render([plain, { directions: ['right'], kind: 'bus', recommended: false }], 'right');
    c = colorsIn(frame, busCell);
    assert(has(c, gray) && !has(c, green) && !has(c, dim), '不推荐的公交车道是灰色图标，没有亮的部分');
    assert.strictEqual(frame[busUnderline + 3], 0, '不推荐的公交车道没有绿色下划线');
    const grayArrow = render([plain, { directions: ['right'], recommended: false }], 'right');
    assert(!Buffer.from(frame).equals(Buffer.from(grayArrow)), '不推荐的公交车道画图标，不画箭头');
    // 2. 车机推荐、箭头里有当前转向：亮箭头 + 下划线 + 公交角标。
    const busTurn = { directions: ['straight', 'right'], kind: 'bus', recommended: true, follow: ['right'] };
    frame = render([plain, busTurn], 'right');
    c = colorsIn(frame, busCell);
    assert(has(c, green) && has(c, dim) && !has(c, gray), '只能从公交车道右转时点亮右转支');
    assert.deepStrictEqual(Array.from(frame.slice(busUnderline, busUnderline + 4)), [61, 220, 151, 255], '推荐的公交车道有绿色下划线');
    const litArrow = render([plain, { ...busTurn, kind: null }], 'right');
    assert(!Buffer.from(frame).equals(Buffer.from(litArrow)), '推荐的公交车道叠公交角标');
    // 角标在箭头格子右下角：格子里那一块要有绿色的角标像素，不只是底色。
    {
        const aw = 24, ah = aw * 62 / 44, ax = laneX + busCell * cellW + (cellW - aw) / 2, ay = 106 - ah / 2;
        const bw = Math.min(aw * 0.37, ah * 0.34), bh = bw * 62 / 44;
        let greenInBadge = 0;
        for (let y = Math.ceil((ay + ah - bh + 36) * 480 / 272); y < Math.floor((ay + ah + 36) * 480 / 272); y++) {
            for (let x = Math.ceil(safePx(ax + aw - bw)); x < Math.floor(safePx(ax + aw)); x++) {
                const p = (y * 800 + x) * 4;
                if (frame[p] === 61 && frame[p + 1] === 220 && frame[p + 2] === 151) greenInBadge++;
            }
        }
        assert(greenInBadge > 20, '右下角画出了绿色公交角标');
    }
    // 3. 车机推荐，但箭头里没有当前转向：仍按不推荐画灰色图标。
    frame = render([plain, { directions: ['straight'], kind: 'bus', recommended: true }], 'right');
    c = colorsIn(frame, busCell);
    assert(has(c, gray) && !has(c, green) && !has(c, dim), '公交车道不通向当前转向时是灰色图标');
    assert.strictEqual(frame[busUnderline + 3], 0, '公交车道不通向当前转向时没有下划线');
    frame = render([plain, { ...busTurn, follow: ['straight'] }], 'right');
    c = colorsIn(frame, busCell);
    assert(has(c, gray) && !has(c, green), '车机只推荐直行时，不能因另有右转箭头就点亮公交车道');
    assert.strictEqual(frame[busUnderline + 3], 0, '车机没有推荐当前转向时，公交车道没有下划线');
    // 车机的推荐标记同样作用于公交车道。
    for (const adapter of adapters) {
        const row = (busHighlighted) => adapter.bmwLanes({ lanes: [
            { directionToFollow: 'STRAIGHT_ON', otherDirections: [], isHighlighted: false, additionalLaneInfo: 'NONE' },
            { directionToFollow: 'RIGHT', otherDirections: [], isHighlighted: !busHighlighted, additionalLaneInfo: 'NONE' },
            { directionToFollow: 'RIGHT', otherDirections: [], isHighlighted: busHighlighted, additionalLaneInfo: { name: 'BUS' } }
        ], laneMarkers: ['DASHED', 'SOLID'], recommendedCarPositionLaneIndex: 2 }).map((l) => [l.kind, l.recommended]);
        assert.deepStrictEqual(row(false), [[null, false], [null, true], ['bus', false]], '车机没推荐的 BUS 车道不推荐');
        assert.deepStrictEqual(row(true), [[null, false], [null, false], ['bus', true]], '车机推荐的 BUS 车道照常推荐');
    }
    console.log('通过：车道按可跟随方向点亮、不通向当前动作整条置灰、箭头裁到格子内、公交车道按车机推荐画图标或亮箭头加角标');
}
function safePx(x) { return (x + 0.5) * 800 / 454; }

// 百度地图红绿灯卡片：横排（灯在左、数字在右）和竖排（灯在上、数字在下）。
function testTrafficLightCards() {
    const fixtures = {};
    const { recognizeBaiduTrafficLight } = require('../../../native/waze-on-cluster/hud/hud_baidu_traffic_light.js');
    const cards = require('./data/baidu_cluster_cards.js');
    const W = 1088, H = 480;
    // places：[卡片, 左上角 x, y]，不给位置时使用合成卡片的默认位置。
    const compose = (places) => {
        const f = Buffer.alloc(W * H * 3, 24);
        for (const [card, x0, y0, edit] of places) {
            const rgb = card.pixels();
            if (edit) edit(rgb, card.w);
            const x = x0 === undefined ? card.x : x0, y = y0 === undefined ? card.y : y0;
            for (let r = 0; r < card.h; r++) rgb.copy(f, ((y + r) * W + x) * 3, r * card.w * 3, (r + 1) * card.w * 3);
        }
        return new Uint8Array(f);
    };
    const frameOf = (card, edit) => compose([[card, undefined, undefined, edit]]);
    // 车机给的是全范围 BT.601 图集：Y 平面，之后每行色度是半宽 U 接半宽 V。
    const atlas = (rgb) => {
        const out = new Uint8Array(W * H * 1.5), half = W >> 1, clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
        for (let i = 0; i < W * H; i++) out[i] = clamp(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
        for (let cy = 0; cy < H / 2; cy++) for (let cx = 0; cx < half; cx++) {
            let u = 0, v = 0;
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const i = ((cy * 2 + dy) * W + cx * 2 + dx) * 3;
                u += -0.168736 * rgb[i] - 0.331264 * rgb[i + 1] + 0.5 * rgb[i + 2];
                v += 0.5 * rgb[i] - 0.418688 * rgb[i + 1] - 0.081312 * rgb[i + 2];
            }
            out[W * H + cy * W + cx] = clamp(u / 4 + 128);
            out[W * H + cy * W + half + cx] = clamp(v / 4 + 128);
        }
        return out;
    };
    const read = (f) => [recognizeBaiduTrafficLight(f, W, H, 3, false), recognizeBaiduTrafficLight(atlas(f), W, H, 0, false)];
    for (const [name, expected] of [['vertical', { color: 'red', seconds: 53 }],
        ['horizontal', { color: 'yellow', seconds: null, text: '注意' }]]) {
        for (const got of read(frameOf(cards[name]))) assert.deepStrictEqual(got, expected, name + ' 卡片识别（RGB 和车机图集）');
    }
    // 竖排卡片抹掉数字区：没有倒计时就不显示，不猜。
    const blank = (rgb, w) => { for (let y = 50; y < 76; y++) for (let x = 14; x < 64; x++) rgb.fill(30, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    for (const got of read(frameOf(cards.vertical, blank))) assert.strictEqual(got, null, '竖排卡片没有数字时不识别');
    // 灯环里面填白（像限速牌、禁停牌）：不是红绿灯。
    const fillRing = (rgb, w) => { for (let y = 22; y < 42; y++) for (let x = 26; x < 46; x++) rgb.fill(240, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    for (const got of read(frameOf(cards.vertical, fillRing))) assert.strictEqual(got, null, '白底圆环不当成竖排红绿灯');
    // 两张卡片同时在画面里：取离画面中心（544, 240）最近的那张。
    const red = { color: 'red', seconds: 53 }, caution = { color: 'yellow', seconds: null, text: '注意' };
    for (const [places, expected, message] of [
        [[[cards.vertical, 500, 190], [cards.horizontal, 60, 20]], red, '竖排卡片更靠近中心时选竖排'],
        [[[cards.vertical, 960, 20], [cards.horizontal, 460, 200]], caution, '横排卡片更靠近中心时选横排'],
        [[[cards.vertical, 40, 380], [cards.vertical, 520, 200]], red, '两张同类卡片也能选出一张']]) {
        for (const got of read(compose(places))) assert.deepStrictEqual(got, expected, message);
    }
    console.log('通过：百度红绿灯横排、竖排卡片识别（RGB 和车机图集），缺数字和白底圆环不识别，多张卡片取离中心最近的');

    // 电子眼卡片：粗红圈白底黑字限速，右边两行白字。巡航限速牌（深色底白字）不算电子眼。
    const { recognizeBaiduSpeedCamera } = require('../../../native/waze-on-cluster/hud/hud_baidu_speed_limit.js');
    const camera = (f) => [recognizeBaiduSpeedCamera(f, W, H, 3), recognizeBaiduSpeedCamera(atlas(f), W, H, 0)];
    for (const got of camera(frameOf(cards.camera))) assert.deepStrictEqual(got, { limitKmh: 40, distanceM: 735 }, '电子眼卡片读出限速 40 和距离 735 米');
    for (const got of camera(frameOf(cards.cruiseSign))) assert.strictEqual(got, null, '巡航限速牌不是电子眼');
    assert.strictEqual(recognizeBaiduSpeedLimit(frameOf(cards.cruiseSign), W, H, 3), 30, '巡航限速牌照常读出');
    // 抹掉右边两行字：只剩一个白底限速牌，不当成电子眼。
    const noText = (rgb, w) => { for (let y = 0; y < 72; y++) for (let x = 76; x < 166; x++) rgb.fill(30, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    for (const got of camera(frameOf(cards.camera, noText))) assert.strictEqual(got, null, '没有“即将抓拍”两行字时不当成电子眼');
    // 抹掉限速数字：读不出值就不显示。
    const noDigits = (rgb, w) => { for (let y = 22; y < 50; y++) for (let x = 16; x < 56; x++) rgb.fill(250, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    for (const got of camera(frameOf(cards.camera, noDigits))) assert.strictEqual(got, null, '电子眼限速读不出时不显示');
    // 只抹掉第二行开头的数字（“735”），留下“米”：仍是电子眼，距离读不出就不给。
    const noDistance = (rgb, w) => { for (let y = 36; y < 58; y++) for (let x = 76; x < 120; x++) rgb.fill(30, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    for (const got of camera(frameOf(cards.camera, noDistance))) assert.deepStrictEqual(got, { limitKmh: 40, distanceM: null }, '距离读不出时只给限速');
    // 只遮住其中一行仍是电子眼，不能被当成普通限速；单行路名标签是普通限速。
    const { recognizeBaiduWhiteSigns } = require('../../../native/waze-on-cluster/hud/hud_baidu_speed_limit.js');
    const fill = (x0, x1, y0, y1, v) => (rgb, w) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3); };
    const signs = (edit) => [recognizeBaiduWhiteSigns(frameOf(cards.camera, edit), W, H, 3), recognizeBaiduWhiteSigns(atlas(frameOf(cards.camera, edit)), W, H, 0)];
    const label = (rgb, w) => { fill(76, 166, 0, 72, 30)(rgb, w); fill(80, 150, 30, 42, 240)(rgb, w); };
    for (const [edit, expected, message] of [
        [fill(76, 166, 0, 33, 30), { cameraKmh: 40, cameraDistanceM: 735, signKmh: null }, '遮住“即将抓拍”仍是电子眼'],
        [fill(76, 166, 36, 72, 30), { cameraKmh: 40, cameraDistanceM: null, signKmh: null }, '遮住距离行仍是电子眼'],
        [fill(76, 166, 0, 72, 30), { cameraKmh: null, cameraDistanceM: null, signKmh: 40 }, '卡片上没有电子眼文字时按普通限速牌'],
        [label, { cameraKmh: null, cameraDistanceM: null, signKmh: 40 }, '单行标签是普通限速牌']]) {
        for (const got of signs(edit)) assert.deepStrictEqual(got, expected, message);
    }
    console.log('通过：百度电子眼卡片识别（RGB 和车机图集），读出限速和距离，遮住一行仍是电子眼，巡航限速牌、缺字、缺数字不识别');
    fixtures.label = label;
    return Object.assign(fixtures, { cards, compose, atlas });
}

// 帧读取：电子眼和限速一样，要连续两帧读到同一个值才显示，卡片消失后立即清掉。
async function testSpeedCameraReader(fixtures) {
    const os = require('os');
    const { HudTrafficReader } = require('../../../native/waze-on-cluster/hud/hud_traffic_reader.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-camera-'));
    const file = path.join(dir, 'hud-frame.yuv');
    let now = 10000;
    const logs = [];
    const reader = new HudTrafficReader(file, () => now, { info: (line) => logs.push(line), warn() {} });
    const write = (rgb) => {
        const header = Buffer.alloc(12);
        header.write('WOC1', 0, 'ascii');
        header.writeUInt32LE(now - 50, 4);
        fs.writeFileSync(file, Buffer.concat([header, Buffer.from(fixtures.atlas(rgb))]));
    };
    const step = async (rgb) => { now += 1100; write(rgb); return reader.read(); };
    try {
        const withCamera = fixtures.compose([[fixtures.cards.camera]]);
        const without = fixtures.compose([[fixtures.cards.cruiseSign]]);
        assert.strictEqual((await step(withCamera)).speedCamera, null, '第一帧看到电子眼先不显示');
        assert.deepStrictEqual((await step(withCamera)).speedCamera, { limitKmh: 40, distanceM: 735 }, '连续两帧确认后显示电子眼和距离');
        assert.strictEqual((await step(without)).speedCamera, null, '电子眼卡片消失后清掉');
        assert(logs.some((line) => line.startsWith('traffic frame: speed camera card 40 km/h')), '日志记录电子眼出现');
        assert(logs.includes('traffic frame: speed camera card gone'), '日志记录电子眼消失');
        // 限速牌两种都读，导航和巡航一样：白底牌（不带电子眼文字）优先，没有白底牌时读中下部深色底的牌。
        {
            const whiteSign = fixtures.compose([[fixtures.cards.camera, undefined, undefined, fixtures.label]]);
            const darkSign = fixtures.compose([[fixtures.cards.cruiseSign]]);
            const twice = async (rgb) => { now += 1100; write(rgb); await reader.read(); now += 1100; write(rgb); return reader.read(); };
            assert.strictEqual((await twice(whiteSign)).speedLimitKmh, 40, '读红圈白底限速牌');
            assert.strictEqual((await twice(whiteSign)).speedCamera, null, '单行标签的白底牌不算电子眼');
            const topHidden = fixtures.compose([[fixtures.cards.camera, undefined, undefined, (rgb, w) => { for (let y = 0; y < 33; y++) rgb.fill(30, (y * w + 76) * 3, (y * w + 166) * 3); }]]);
            const hidden = await twice(topHidden);
            assert.strictEqual(hidden.speedLimitKmh, null, '“即将抓拍”被遮住时，电子眼限速不能当成当前限速');
            assert.deepStrictEqual(hidden.speedCamera, { limitKmh: 40, distanceM: 735 }, '“即将抓拍”被遮住时仍按电子眼显示');
            assert.strictEqual((await twice(darkSign)).speedLimitKmh, 30, '读深色底限速牌');
            const both = fixtures.compose([[fixtures.cards.camera, undefined, undefined, fixtures.label], [fixtures.cards.cruiseSign]]);
            assert.strictEqual((await twice(both)).speedLimitKmh, 40, '白底和深色底的牌都有时白底优先');
            const camAndDark = fixtures.compose([[fixtures.cards.camera], [fixtures.cards.cruiseSign]]);
            const camResult = await twice(camAndDark);
            assert.strictEqual(camResult.speedLimitKmh, 30, '电子眼限速不算当前限速，当前限速取深色底牌');
            assert.deepStrictEqual(camResult.speedCamera, { limitKmh: 40, distanceM: 735 }, '同时显示电子眼');
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log('通过：电子眼连续两帧确认、消失即清除、出现和消失写日志，白底和深色底限速牌都读、白底优先');
}

async function main() {
    testCongestedSpeedLimit();
    await testSpeedCameraReader(testTrafficLightCards());
    const laneFont = new Font(require('../../../native/waze-on-cluster/hud/hud_font_data.js'));
    const lanes = [{ directions: ['left'], recommended: true },
        { directions: ['left'], recommended: true, leftBoundary: 'dashed' },
        { directions: ['straight'], leftBoundary: 'solid' }, { directions: ['right'] }];
    const laneView = { state: 'navigating', lanes };
    const pixels = renderer.render(laneView, laneFont, null, 100, 1);
    // 风格只有 1–3，其他编号（包括旧版本的 4–6）一律按风格 1。
    for (const other of [undefined, 0, 4, 5, 6, 2.5, '2']) {
        assert.deepStrictEqual(renderer.render(laneView, laneFont, null, 100, other), pixels, '风格 ' + other + ' 按风格 1 绘制');
    }
    const at = (x, y) => Array.from(pixels.slice((y * 800 + x) * 4, (y * 800 + x) * 4 + 4));
    assert(at(572, 334)[3] > 0, '实线保持连续');
    assert(at(459, 324)[3] > 0, '推荐车道也按数据画虚线');
    assert.strictEqual(at(459, 337)[3], 0, '虚线分段间留空');
    assert.strictEqual(at(685, 337)[3], 0, '未知边界不画线');
    assert.deepStrictEqual(at(401, 405), [84, 245, 165, 255], '推荐车道显示绿色底线');
    assert.strictEqual(at(367, 318)[3], 0, '推荐车道保持透明底');
    assert.strictEqual(nav.snapshot({ lanes: [{ directions: [] }, lanes[2]] }).lanes.length, 2, '无箭头车道保留边界位置');
    console.log('通过：风格 1 推荐绿线、透明底、实际虚实边界与未知边界隐藏，非法风格编号按风格 1');
    testArrowLighting();
    testLaneLighting(laneFont);
    for (const [style, x, y] of [[2, 192, 78], [3, 190.5, 86]]) {
        const view = { state: 'navigating', lanes: lanes.map(lane => ({ ...lane, recommended: false })) };
        const alpha = (frame, px, py) => frame[(Math.floor((py + 36) * 480 / 272) * 800 +
            Math.ceil((px + 0.5) * 800 / 454)) * 4 + 3];
        for (const boundary of ['solid', 'dashed', null]) {
            view.lanes[1].leftBoundary = boundary;
            const frame = renderer.render(view, laneFont, null, 100, style);
            assert.strictEqual(alpha(frame, x, y + 2) > 0, boundary !== null, '已知车道边界可见');
            assert.strictEqual(alpha(frame, x, y + 9) > 0, boundary === 'solid', '仅实线连续');
        }
    }
    const fourCards = renderer.render({ state: 'navigating', lanes: [0, 1, 2, 3].map((i) => ({
        directions: ['straight'], recommended: i >= 2
    })) }, laneFont, null, 100, 3);
    // 方案 D：第 4 条车道格子从 x 273.5 起，宽 41.5，绿线在 y 128–131。
    const fourthHighlight = (Math.floor((129.5 + 36) * 480 / 272) * 800 + Math.floor((294 + 0.5) * 800 / 454)) * 4;
    assert.deepStrictEqual(Array.from(fourCards.slice(fourthHighlight, fourthHighlight + 4)), [61, 220, 151, 255],
        '风格 3 推荐车道下方画方案 D 的绿线');
    for (let y = 295; y < 328; y++) {
        const textArea = fourCards.slice((y * 800 + 296) * 4, (y + 1) * 800 * 4);
        assert(!textArea.some(Boolean), '风格 3 不绘制推荐车道文字');
    }
    {
        // 只检查用绿色底块的风格 2。
        const frame = renderer.render({ state: 'navigating', lanes: [0, 1, 2].map((i) => ({
            directions: [i ? 'straight' : 'left'], recommended: i === 0, leftBoundary: i ? 'solid' : null
        })) }, laneFont, null, 100, 2);
        let green = null;
        for (let y = 0; y < renderer.height && !green; y++) {
            for (let x = 0; x < renderer.width; x++) {
                const i = (y * renderer.width + x) * 4;
                if (frame[i] === 74 && frame[i + 1] === 232 && frame[i + 2] === 156) {
                    let right = x;
                    while (frame[(y * renderer.width + right + 1) * 4 + 1] === 232) right++;
                    green = { y: y + 20, right };
                    break;
                }
            }
        }
        // 同一行上从车道线往左找最近的绿色像素，箭头在色块内部，不影响色块右边缘。
        let line = green.right + 1;
        while (line < renderer.width && frame[(green.y * renderer.width + line) * 4] !== 167) line++;
        let edge = line - 1;
        while (edge > 0 && frame[(green.y * renderer.width + edge) * 4] !== 74) edge--;
        assert(line < renderer.width && line - edge - 1 >= 10, '风格 2 推荐车道色块不贴虚实线');
    }
    const cruiseFrame = renderer.render({ state: 'cruising', currentRoad: '云海路', speedLimitKmh: 30,
        trafficLight: { color: 'red', seconds: 23 } }, laneFont, null, 100, 3);
    const bounds = (left, right) => {
        let minX = renderer.width, maxX = -1, top = -1, bottom = -1;
        for (let y = 0; y < renderer.height; y++) {
            for (let x = left; x < right; x++) {
                if (cruiseFrame[(y * renderer.width + x) * 4 + 3] <= 4) continue;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                if (top < 0) top = y;
                bottom = y;
            }
        }
        return { minX, maxX, top, bottom, mid: (top + bottom) / 2 };
    };
    const rowBottom = Math.floor((188 + 36) * renderer.height / 272);
    const rowMid = (164 + 36) * renderer.height / 272;
    const [speed, road, traffic] = [[0, 367], [367, 650], [650, 800]].map(([left, right]) => bounds(left, right));
    for (const item of [speed, road, traffic]) {
        assert(Math.abs(item.mid - rowMid) <= 1.5, '巡航限速、路名、红绿灯垂直居中在同一条中线上');
    }
    assert(Math.abs(speed.bottom - rowBottom) <= 2, '最高的限速牌底边仍留在安全区靠下位置');
    assert(speed.maxX < road.minX, '限速在路名左侧并留空');
    assert(Math.abs((speed.minX + road.maxX) / 2 - renderer.width / 2) <= 2, '限速和路名成组居中');
    const stockConfig = { minimumUpdateIntervalMs: 500, viewport: { maxElementCount: 1,
        includedTypes: ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS'] } };
    const calls = [];
    let down = 0, query = () => Promise.resolve(reply);
    const proxy = { init: () => Promise.resolve(), waitUntilAvailable: () => Promise.resolve(),
        shutdown: () => down++, _someIpProxy: { callMethod: (name, args) => {
            calls.push({ name, args });
            return name === 'getViewConfig' ? Promise.resolve({ viewConfig: stockConfig }) : query(args);
        } } };
    const reader = new GuidanceReader({ buildTypedProxy: (iface, instance) => {
        assert.strictEqual(iface, IFACE); assert.strictEqual(instance, INSTANCE);
        return Promise.resolve(proxy);
    } }, { timeoutMs: 30 });
    assert.deepStrictEqual(await reader.read(), reply);
    await reader.read();
    assert.deepStrictEqual(calls.map((c) => c.name), ['getViewConfig', 'queryContent', 'queryContent']);
    assert.strictEqual(calls[0].args.viewId, VIEW);
    const queryConfig = calls[1].args.viewConfigs[0];
    assert.deepStrictEqual(queryConfig.viewport.includedTypes,
        ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS', 'INCLUDE_LANE_GUIDINGS', 'INCLUDE_SPEED_LIMIT_ASSIST']);
    assert.strictEqual(queryConfig.viewport.maxElementCount, 6, '原厂只有一条事件时也要给转向和车道预留位置');
    assert.strictEqual(stockConfig.viewport.maxElementCount, 1);
    assert.strictEqual(calls[2].args.viewConfigs[0], queryConfig, '复用补齐车道事件的查询配置');
    assert(!stockConfig.viewport.includedTypes.includes('INCLUDE_LANE_GUIDINGS'), '不修改原厂视图配置');
    assert.strictEqual(nav.fromBmw(reply).distanceM, 147);
    ['UTURN_LEFT', 'UTURN_RIGHT'].forEach((name) => {
        const state = nav.fromBmw({ events: [{ intersection: { direction: { name } } }] });
        assert.strictEqual(state.direction, 'uturn', `${name} 应归一化为掉头`);
        const frame = renderer.render(state, laneFont);
        let alpha = 0;
        for (let i = 0; i < frame.length; i += 4) alpha += frame[i + 3];
        assert(alpha > 0, `${name} 应绘制掉头箭头`);
    });
    ['STRAIGHT_ON', 'HARD_LEFT', 'HARD_RIGHT'].forEach((name) => {
        const state = nav.fromBmw({ events: [{ intersection: { direction: { name } } }] });
        assert(state.direction, `${name} 应识别为可绘制方向`);
    });
    const distanceIn = (unit, distance) => nav.fromBmw({ events: [{ intersection: {
        formattedDistance: { unit: { name: unit }, distance }
    } }] }).distanceM;
    const units = { METER: 1, KM: 1000, KILOMETER: 1000, MILE_US: 1609.344, MILE_UK: 1609.344,
        YARD: 0.9144, FEET: 0.3048 };
    Object.keys(units).forEach(unit => assert.strictEqual(distanceIn(unit, '1'), units[unit], unit));
    assert.strictEqual(distanceIn('KM', '1.2'), 1200);
    assert.strictEqual(distanceIn('NONE', '1'), null);
    assert.strictEqual(distanceIn('KM', '—'), null);
    const laneReply = { viewContent: [{ eventsInView: [
        { intersection: { direction: { name: 'RIGHT' }, formattedDistance: { distance: '250', unit: { name: 'METER' } },
            description: { text: '科技园路' }, distanceToDestination: 7400 } },
        { destinationManeuver: { travelTime: 1080 } },
        { laneGuiding: {
            distanceToDestination: 7400,
            lanes: [
                { directionToFollow: { name: 'NONE' }, otherDirections: [{ name: 'LEFT' }], isHighlighted: false },
                { directionToFollow: { name: 'NONE' }, otherDirections: [{ name: 'STRAIGHT_ON' }], isHighlighted: false },
                { directionToFollow: { name: 'RIGHT' }, otherDirections: [{ name: 'STRAIGHT_ON' }], isHighlighted: true },
                { directionsToFollow: [{ name: 'RIGHT' }], otherDirections: [], isHighlighted: true }
            ],
            laneMarkers: [{ name: 'SOLID' }, { name: 'DASHED' }, { name: 'SOLID' }, { name: 'DASHED' }, { name: 'SOLID' }],
            recommendedCarPositionLaneIndex: 2
        } }
    ] }] };
    const laneState = nav.fromBmw(laneReply);
    assert.strictEqual(laneState.remainingTimeS, 1080, '同时含 destinationManeuver 与 laneGuiding 时应保留剩余时间');
    assert.deepStrictEqual(laneState.lanes, [
        { directions: ['left'], kind: null, recommended: false, follow: [], leftBoundary: null },
        { directions: ['straight'], kind: null, recommended: false, follow: [], leftBoundary: 'dashed' },
        { directions: ['right', 'straight'], kind: null, recommended: true, follow: ['right'], leftBoundary: 'solid' },
        { directions: ['right'], kind: null, recommended: true, follow: ['right'], leftBoundary: 'dashed' }
    ], 'fromBmw 应解析 laneGuiding 车道方向、推荐高亮、可跟随方向与虚实分隔线');
    const [turn, destination, currentLanes] = laneReply.viewContent[0].eventsInView;
    const laterLanes = { laneGuiding: { ...currentLanes.laneGuiding, distanceToDestination: 7150 } };
    const uncertain = { laneGuiding: { ...currentLanes.laneGuiding, unreliable: true } };
    for (const adapter of [nav, require('../../../native/waze-on-cluster/hud/hud_navigation.js')]) {
        const laneInfo = {};
        assert.deepStrictEqual(adapter.fromBmw({ events: [turn, laterLanes, destination, currentLanes] }, laneInfo).lanes,
            laneState.lanes, '选当前路口车道，忽略后一路口');
        assert.deepStrictEqual(laneInfo, { received: 2, eligible: 2, matched: 1, closestGapM: 0 });
        const mismatch = {};
        assert.deepStrictEqual(adapter.fromBmw({ events: [turn, laterLanes] }, mismatch).lanes, []);
        assert.deepStrictEqual(mismatch, { received: 1, eligible: 1, matched: 0, closestGapM: 250 });
        const near = {};
        const nearLanes = { laneGuiding: { ...currentLanes.laneGuiding, distanceToDestination: 7404.5 } };
        assert.deepStrictEqual(adapter.fromBmw({ events: [turn, nearLanes] }, near).lanes, laneState.lanes,
            '路口和车道位置相差少量浮点误差时仍显示车道');
        assert.strictEqual(near.matched, 1);
        for (const entries of [[laterLanes], [uncertain], [currentLanes, currentLanes],
            [{ laneGuiding: { ...currentLanes.laneGuiding, distanceToDestination: undefined } }]]) {
            assert.deepStrictEqual(adapter.fromBmw({ events: [turn, ...entries] }).lanes, [],
                '错配、不可信、重复或缺少位置时隐藏车道');
        }
    }
    query = ({ viewConfigs }) => {
        const slots = viewConfigs[0].viewport.maxElementCount;
        return Promise.resolve({ viewContent: [{ eventsInView: [turn, currentLanes, destination].slice(0, slots) }] });
    };
    assert.deepStrictEqual(nav.fromBmw(await reader.read()).lanes, laneState.lanes,
        '原厂单事件视图仍能查到与转向关联的车道');
    query = () => Promise.resolve({ GuidanceEventListError: { name: 'INVALID_VIEW_PARAMS' }, viewContent: [] });
    let queryError;
    try { await reader.read(); } catch (error) { queryError = error; }
    assert(queryError && /INVALID_VIEW_PARAMS/.test(queryError.message), '查询失败不能当成空的导航数据');
    query = () => new Promise(() => {});
    let failed = false;
    try { await reader.read(); } catch (error) { failed = /timed out/.test(error.message); }
    assert(failed, '超时读取必须失败');
    reader.stop();
    assert.strictEqual(down, 1);
    console.log('通过：导航代理只读查询、视图配置复用、超时和释放');

    const control = new EventEmitter();
    control.renderStatus = { hud: 0, cluster: 1 };
    let connected = true;
    control.render = { connected: () => connected, send: () => { throw new Error('简洁绘制器不持有视频控制连接'); } };
    control.patch = { path: '/tmp/unused-woc-simple.sock' };
    let reads = 0, stops = 0, input = () => Promise.resolve(reply);
    const outputs = [], publications = [];
    const engine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        outputFactory: (keepShown, onState) => {
            const output = { closed: false, setKeepShown: (keep) => { output.keepShown = keep; },
                report: onState,
                update: (frame, visible) => publications.push({ frame: visible ? Buffer.from(frame) : frame, visible }),
                close: () => { output.closed = true; } };
            outputs.push(output); return output;
        }
    });
    engine.tick();
    assert.strictEqual(engine.font, null, '未启用时不加载字体');
    engine.settings({ hud_simple: 1, hud: 0 });
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    await until(() => !engine.navBusy);
    assert.strictEqual(engine.font, null, '等待导航时仍未加载字体');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && publications.length === 1);
    assert(engine.font, '首个有效引导绘制时加载字体');
    assert.strictEqual(engine.state, 'unavailable', '提交图像后，仍须等待实际图层状态');
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'showing');
    assert(publications[0].visible);
    engine.settings({ hud_simple: 1, hud: 0, hud_keep_shown: 1 });
    assert.strictEqual(outputs[0].keepShown, true, '沿用普通 HUD 的弹窗让位设置');
    const expectedFirst = Object.assign({}, nav.fromBmw(reply), { initialDistanceM: 147 });
    assert.deepStrictEqual(publications[0].frame, Buffer.from(renderer.render(expectedFirst, new Font(require('../../../native/waze-on-cluster/hud/hud_font_data.js')))));
    const firstFrame = engine.frame;
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy);
    assert.strictEqual(publications.length, 1, '重复完整状态不重复发送像素');
    assert.strictEqual(engine.frame, firstFrame, '重复完整状态不重新分配帧');
    const halfReply = { viewContent: [{ eventsInView: [{ intersection: { direction: 'LEFT',
        formattedDistance: { distance: '73', unit: { name: 'METER' } },
        description: { text: '前方左转' }, distanceToDestination: 3079 } }] }] };
    engine.handleNav(nav.fromBmw(halfReply));
    await until(() => !engine.navBusy && publications.length === 2);
    const barPx = Array.from(publications[1].frame.slice((267 * 800 + 480) * 4, (267 * 800 + 480) * 4 + 4));
    assert(barPx[0] >= 250 && barPx[1] >= 250 && barPx[2] >= 250 && barPx[3] === 255, '同路口距离递减时进度条应推进显示白色填充');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && publications.length === 3);
    outputs[0].report('unavailable');
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy);
    assert.strictEqual(engine.state, 'unavailable', '相同导航数据不能掩盖输出断连');
    outputs[0].report('showing');
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    assert.strictEqual(engine.state, 'waiting');
    assert.deepStrictEqual(publications[publications.length - 1], { frame: null, visible: false }, '导航结束只更新可见性');
    const hiddenPublications = publications.length;
    engine.handleNav(nav.fromBmw({ viewContent: [] }));
    assert.strictEqual(publications.length, hiddenPublications, '重复等待不再提交隐藏帧');
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'waiting', '结束导航后的迟到回调不能恢复显示状态');
    engine.handleNavError('navigation unavailable');
    assert.strictEqual(engine.state, 'unavailable');
    engine.settings({ hud_simple: 0, hud: 0 });
    assert(outputs[0].closed);
    outputs[0].report('showing');
    assert.strictEqual(engine.state, 'off', '旧输出不能在关闭后改写状态');
    engine.settings({ hud_simple: 1, hud: 1 });
    assert.strictEqual(engine.enabled, false, '视频模式配置开启时不输出简洁导航');
    engine.settings({ hud_simple: 1, hud: 0 });
    engine.handleNav(nav.fromBmw(reply));
    await until(() => !engine.navBusy && outputs.length === 2);
    outputs[1].report('showing');
    assert.strictEqual(engine.state, 'showing');
    engine.lastNav = Date.now() - 6000;
    engine.tick();
    assert.strictEqual(engine.state, 'unavailable', '断流超过 5 秒清除旧引导');
    engine.settings(null);
    assert.strictEqual(engine.state, 'off', '后台模式配置连接断开后释放旧图层');
    engine.stop();
    console.log('通过：原生 HudEngine 实际像素、去重、进度条、结束清屏、读取失败、模式切换和断流清屏');

    /* 原生 SOME/IP Utf8D BOM/无BOM 编码与可用状态回调通知 */
    const someip = require('../../../native/waze-on-cluster/hud/hud_someip_guidance.js');
    const bomBuf = someip.encodeUtf8D('HUD.RB.Main', true);
    const rawBuf = someip.encodeUtf8D('HUD.RB.Main', false);
    assert.strictEqual(bomBuf.readUInt32BE(0), 3 + 11 + 1, '带 BOM Utf8D 长度应包含 3 字节 BOM 和结尾 NUL');
    assert.deepStrictEqual(Array.from(bomBuf.slice(4, 7)), [0xef, 0xbb, 0xbf]);
    assert.strictEqual(rawBuf.readUInt32BE(0), 11 + 1, '无 BOM Utf8D 长度应为字符串 + NUL');
    assert.strictEqual(rawBuf.slice(4, 15).toString('utf8'), 'HUD.RB.Main');
    const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v, 0); return b; };
    const f64be = (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v, 0); return b; };
    const subWrap = (parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32be(body.length), body]); };
    const lane0 = Buffer.concat([u32be(0), subWrap([u32be(1)]), Buffer.from([0]), u32be(0), subWrap([])]);
    const lane1 = Buffer.concat([u32be(5), subWrap([u32be(1)]), Buffer.from([1]), u32be(0), subWrap([u32be(5)])]);
    const lgBody = Buffer.concat([
        Buffer.alloc(8), f64be(7400), Buffer.from([0]),
        u32be(8), u32be(3), Buffer.alloc(8),
        f64be(200),
        subWrap([lane0, lane1]),
        subWrap([u32be(2)]),
        Buffer.from([1, 50])
    ]);
    const viewStruct = Buffer.concat([
        u32be(1), Buffer.from([1]), u32be(0), u32be(1),
        subWrap([u32be(lgBody.length), u32be(15), lgBody])
    ]);
    const lgDecoded = someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf, viewStruct])]));
    {
        // additionalLaneInfo 第 2 项是 BUS。
        const busLane = Buffer.concat([u32be(5), subWrap([]), Buffer.from([0]), u32be(2), subWrap([])]);
        const busBody = Buffer.concat([lgBody.slice(0, lgBody.length - 2 - subWrap([u32be(2)]).length - subWrap([lane0, lane1]).length),
            subWrap([lane0, busLane]), subWrap([u32be(2)]), Buffer.from([1, 50])]);
        const busView = Buffer.concat([u32be(1), Buffer.from([1]), u32be(0), u32be(1), subWrap([u32be(busBody.length), u32be(15), busBody])]);
        const busDecoded = someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf, busView])]));
        assert.deepStrictEqual(busDecoded.events[0].value.lanes.map((l) => l.additionalLaneInfo), ['NONE', 'BUS'],
            '原生解码保留 additionalLaneInfo');
        assert.strictEqual(nav.bmwLanes(busDecoded.events[0].value)[1].kind, 'bus', '原生 BUS 车道进入 HUD 数据');
    }
    assert.strictEqual(lgDecoded.error, 0);
    assert.strictEqual(lgDecoded.events.length, 1);
    assert.strictEqual(lgDecoded.events[0].type, 'laneGuiding');
    assert.strictEqual(lgDecoded.events[0].value.unreliable, false);
    const badBody = lgBody.slice(0, lgBody.length - 1);
    const mixedView = Buffer.concat([viewStruct.slice(0, 13), subWrap([
        u32be(badBody.length), u32be(15), badBody,
        u32be(lgBody.length), u32be(15), lgBody
    ])]);
    const mixed = someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf, mixedView])]));
    const maneuverBody = (position, meters, seconds, tail) => Buffer.concat([
        Buffer.alloc(8), f64be(position), Buffer.from([0]), u32be(8), u32be(3), Buffer.alloc(8),
        someip.encodeUtf8D(String(meters)), u32be(4), f64be(1), subWrap([]), u32be(seconds), u32be(0),
        subWrap([]), subWrap([]), u32be(0), u32be(4), u32be(1), u32be(0), u32be(0), u32be(0), tail
    ]);
    const event = (type, body) => Buffer.concat([u32be(body.length), u32be(type), body]);
    const nil = Buffer.concat([u32be(4), u32be(1), u32be(0)]);
    const ringBody = maneuverBody(3370, 147, 20, Buffer.concat([Buffer.from([0, 180, 3]), u32be(2), nil]));
    const upcoming = (type, body) => someip.decodeGetViewContent(Buffer.concat([u32be(0), subWrap([bomBuf,
        viewStruct.slice(0, 13), subWrap([event(17, maneuverBody(0, 3517, 465,
            Buffer.concat([u32be(2), Buffer.from([1]), u32be(0), nil, nil, nil]))), event(type, body)])]),
        f64be(3517), f64be(3517), f64be(183), f64be(183)]));
    const roundabout = nav.fromBmw(upcoming(18, ringBody));
    assert.strictEqual(roundabout.distanceM, 147, '目的地在列表最前也不能占用转向距离');
    assert.strictEqual(roundabout.remainingDistanceM, 3517, '全程距离读取独立字段');
    assert.strictEqual(roundabout.maneuverPositionM, 3370, '保留事件位置供车道匹配');
    assert.strictEqual(roundabout.remainingTimeS, 465, '全程剩余时间取终点事件');
    assert.strictEqual(roundabout.roundaboutExit, 3);
    assert.strictEqual(nav.fromBmw(upcoming(5, ringBody)).roundaboutExit, 3, '兼容正序环岛编号');
    assert.strictEqual(nav.fromBmw(upcoming(19, maneuverBody(3370, 147, 20, Buffer.concat([u32be(7), nil, u32be(0)])))).direction, 'slight_right');
    assert.strictEqual(nav.fromBmw(upcoming(11, maneuverBody(3370, 147, 20, u32be(1)))).direction, 'merge_left');
    assert.strictEqual(nav.fromBmw({ events: [{ intersection: { travelTime: 20 } }] }).remainingTimeS, null,
        '下一路口的用时不能冒充全程剩余时间');
    assert.strictEqual(nav.fromBmw({ guidanceState: 'CALCULATING_ROUTE' }).state, 'rerouting');
    assert.strictEqual(nav.fromBmw({ guidanceState: 'INACTIVE', currentDistances: { carDistanceToFinalDestination: 0 },
        events: [{ destinationManeuver: { isCheckeredFlag: true, formattedDistance: { distance: '0', unit: 'METER' } } }] }).state, 'arrived');
    const limit = { type: 'speedLimitAssist', value: { distanceToDestination: 3517,
        formattedDistance: { distance: '0', unit: 'METER' }, speedLimitAssistInfo: { value: {
            reason: { speedLimitInfo: { speedLimit: 40, speedUnit: 'MI_P_H_US' } }
        } } } };
    assert.strictEqual(nav.fromBmw({ currentDistances: { carDistanceToFinalDestination: 3517 },
        events: [{ intersection: { direction: 'LEFT' } }, limit] }).speedLimitKmh, 64);
    assert.strictEqual(nav.fromBmw({ currentDistances: { carDistanceToFinalDestination: 3617 },
        events: [{ intersection: { direction: 'LEFT' } }, limit] }).speedLimitKmh, null, '前方限速不能冒充当前位置限速');
    const noExit = { ...roundabout, roundaboutExit: null };
    const alternateExit = { ...roundabout, roundaboutExit: 2 };
    for (let style = 1; style <= 3; style++) {
        const frame = Buffer.from(renderer.render(roundabout, laneFont, null, 0, style));
        assert(!frame.equals(Buffer.from(renderer.render(noExit, laneFont, null, 0, style))), '环岛有有效出口时显示圈号');
        assert(!frame.equals(Buffer.from(renderer.render(alternateExit, laneFont, null, 0, style))), '圈号数字随出口变化');
        assert(Buffer.from(renderer.render({ ...roundabout, direction: 'left' }, laneFont, null, 0, style))
            .equals(Buffer.from(renderer.render({ ...noExit, direction: 'left' }, laneFont, null, 0, style))), '普通转向不显示环岛圈号');
    }


    assert.strictEqual(mixed.laneRejected, 1, '计数损坏的候选事件，且仍解码后续事件');
    assert.deepStrictEqual(mixed.events, lgDecoded.events);
    assert.deepStrictEqual(nav.fromBmw({ events: [{ type: 'intersection', value: { direction: 'RIGHT', distanceToDestination: 7400 } }, lgDecoded.events[0]] }).lanes, [
        { directions: ['straight'], kind: null, recommended: false, follow: [], leftBoundary: null },
        { directions: ['right', 'straight'], kind: null, recommended: true, follow: ['right'], leftBoundary: 'dashed' }
    ], '原生 SOME/IP laneGuiding 二进制解码应与 fromBmw 无缝衔接');
    const quiet = { info() {}, warn() {}, error() {} };
    const currentLaneLogs = [];
    const roadReader = new someip.NativeGuidanceReader({ log: { ...quiet, info: (s) => currentLaneLogs.push(s) } });
    const roadRequests = [];
    roadReader.child = { stdin: { write: (line) => roadRequests.push(line) } };
    const roadText = someip.encodeUtf8D('情侣北路');
    const roadWire = subWrap([u32be(roadText.length), u32be(3), roadText]).toString('hex');
    assert.strictEqual(roadReader.currentRoad(), '', '路名服务不可用时不查询');
    assert.deepStrictEqual(roadRequests, []);
    roadReader._onLine('road-avail 1');
    assert.strictEqual(roadReader.currentRoad(), '', '等待路名时转向可继续显示');
    roadReader.currentRoad();
    assert.deepStrictEqual(roadRequests, ['1 road -\n'], '同一时刻只请求一次当前路名');
    roadReader._onLine('reply 1 0001 00 ' + roadWire);
    assert.strictEqual(roadReader.currentRoad(), '情侣北路');
    let finishTraffic;
    const staleFrames = [];
    const staleEngine = new HudEngine({ nativeGuidance: null, log: quiet,
        traffic: { reset() {}, read: () => new Promise(resolve => { finishTraffic = resolve; }) },
        outputFactory: () => ({ update: (_, visible) => staleFrames.push(visible), close() {} }) });
    staleEngine.settings({ hud_simple: 1, hud: 0 });
    staleEngine.handleNav(laneState);
    await until(() => !!finishTraffic);
    staleEngine.handleNav({ state: 'inactive' });
    finishTraffic(null);
    await until(() => !staleEngine.navBusy);
    assert.deepStrictEqual(staleFrames, [], '导航结束后旧画面不能重新出现');
    staleEngine.stop();

    let alerts = null, currentRoad = '', resetCount = 0;
    const cruiseFrames = [];
    const cruise = new HudEngine({ log: quiet,
        nativeGuidance: { supported: () => false, currentRoad: () => currentRoad, stop() {} },
        traffic: { reset() { resetCount++; }, read: () => Promise.resolve(alerts) },
        outputFactory: () => ({ update: (_, visible) => cruiseFrames.push(visible), close() {} }) });
    cruise.settings({ hud_simple: 1, hud: 0, hud_simple_style: 6 });
    assert.strictEqual(cruise.hudStyle, 1, '风格 6 不存在，后端按风格 1');
    cruise.settings({ hud_simple: 1, hud: 0, hud_simple_style: 3 });
    assert.strictEqual(cruise.hudStyle, 3);
    const cruiseTick = async () => { cruise.tick(); await until(() => !cruise.navBusy); };
    const startedResets = resetCount;
    await cruiseTick();
    assert.strictEqual(cruise.state, 'waiting', '无仪表帧时继续等待');
    cruise.handleNav({ state: 'inactive' });
    const green = { color: 'green', seconds: 23 };
    alerts = { trafficLight: green, speedLimitKmh: null };
    await cruiseTick();
    assert.strictEqual(cruise.lastState.state, 'cruising');
    assert.deepStrictEqual(cruise.lastState.trafficLight, green, '巡航仅识别到红绿灯也显示');
    assert.deepStrictEqual(cruiseFrames, [true]);
    cruise.handleNavError('native guidance unavailable');
    assert.strictEqual(resetCount, startedResets, '导航停止或查询失败不能中断巡航取帧');
    currentRoad = '云海路';
    alerts = { trafficLight: green, speedLimitKmh: 30 };
    await cruiseTick();
    assert.strictEqual(cruise.lastState.currentRoad, '云海路');
    assert.strictEqual(cruise.lastState.speedLimitKmh, 30);
    cruise.handleNav(Object.assign({}, laneState, { speedLimitKmh: 60 }));
    await until(() => !cruise.navBusy);
    assert.strictEqual(cruise.lastState.state, 'navigating');
    assert.strictEqual(cruise.lastState.speedLimitKmh, 60, '导航结构化限速优先');
    cruise.handleNav({ state: 'inactive' });
    assert.strictEqual(cruise.state, 'waiting');
    await cruiseTick();
    assert.strictEqual(cruise.lastState.state, 'cruising');
    alerts = null;
    await cruiseTick();
    assert.strictEqual(cruiseFrames[cruiseFrames.length - 1], false, '投屏断流后连同路名清屏');
    cruise.stop();

    // 巡航车道：来自车机 Guidance.currentLaneGuiding（0x0019），查不到就不画。
    {
        let laneRow = null, cruiseAlerts = { trafficLight: { color: 'red', seconds: 53 }, speedLimitKmh: 60 };
        const fields = [], logs = [], frames = [];
        const laneRowOf = () => ({ lanes: [
            { directionToFollow: 'NONE', otherDirections: ['LEFT'] },
            { directionToFollow: 'NONE', otherDirections: ['STRAIGHT_ON'] },
            { directionToFollow: 'NONE', otherDirections: ['STRAIGHT_ON', 'RIGHT'], additionalLaneInfo: 'BUS' }
        ], laneMarkers: ['DASHED', 'SOLID'], recommendedCarPositionLaneIndex: 255 });
        const lanesEngine = new HudEngine({ log: { ...quiet, info: (line) => logs.push(line) },
            nativeGuidance: { supported: () => false, currentRoad: () => '情侣北路', stop() {},
                guidanceField: (key, context) => { fields.push([key, context]); return key === 'lanes' ? laneRow : null; } },
            traffic: { reset() {}, read: () => Promise.resolve(cruiseAlerts) },
            outputFactory: () => ({ update: (frame, visible) => frames.push(visible ? Buffer.from(frame) : null), close() {} }) });
        lanesEngine.settings({ hud_simple: 1, hud: 0, hud_simple_style: 3 });
        const tick = async () => { lanesEngine.tick(); await until(() => !lanesEngine.navBusy); };
        await tick();
        assert.deepStrictEqual(fields.filter(([key]) => key === 'lanes'), [['lanes', 'cruise']], '巡航时查询当前车道');
        assert.deepStrictEqual(lanesEngine.lastState.lanes, [], '车机没有车道时不画');
        assert(logs.includes('HUD lanes cruise: none'), '记录巡航时没有车道');
        const noLanes = frames[frames.length - 1];
        laneRow = laneRowOf();
        await tick();
        assert.deepStrictEqual(lanesEngine.lastState.lanes.map((l) => [l.kind, l.recommended]),
            [[null, false], [null, false], ['bus', false]], '巡航车道进入 HUD 状态，没有推荐');
        assert(logs.includes('HUD lanes cruise: shown selectedLanes=3 recommended=0'), '记录巡航车道数量');
        const withLanes = frames[frames.length - 1];
        // 车道画在路名和红绿灯之间：只在两者之间的列上多出像素，红绿灯不动。
        const lit = (frame, x0, x1) => { let n = 0; for (let y = 0; y < 480; y++) for (let x = x0; x < x1; x++) if (frame[(y * 800 + x) * 4 + 3]) n++; return n; };
        const trafficLeft = Math.floor(safePx(453 - 76));
        assert.strictEqual(lit(withLanes, trafficLeft, 800), lit(noLanes, trafficLeft, 800), '红绿灯位置和样式不变');
        let lanePixels = 0, laneLeft = 800, laneRight = 0;
        for (let y = 0; y < 480; y++) for (let x = 0; x < trafficLeft; x++) {
            const p = (y * 800 + x) * 4;
            if (withLanes[p] === 125 && withLanes[p + 1] === 131 && withLanes[p + 2] === 140) { lanePixels++; laneLeft = Math.min(laneLeft, x); laneRight = Math.max(laneRight, x); }
        }
        assert(lanePixels > 50, '巡航画出灰色车道箭头');
        let roadRight = 0;
        for (let y = 0; y < 480; y++) for (let x = 0; x < laneLeft; x++) {
            const p = (y * 800 + x) * 4;
            if (withLanes[p] === 255 && withLanes[p + 1] === 255 && withLanes[p + 2] === 255 && withLanes[p + 3] === 255) roadRight = Math.max(roadRight, x);
        }
        assert(roadRight > 0 && roadRight < laneLeft && laneRight < trafficLeft, '车道在路名右边、红绿灯左边');
        // 投屏帧断了，但车机还有车道：照样显示车道。
        cruiseAlerts = null;
        await tick();
        assert.strictEqual(lanesEngine.lastState.lanes.length, 3, '没有投屏帧时仍显示车机车道');
        assert.notStrictEqual(frames[frames.length - 1], null);
        laneRow = { lanes: [{ directionToFollow: 'NONE' }, { directionToFollow: 'NONE' }] };
        await tick();
        assert.strictEqual(frames[frames.length - 1], null, '车道没有方向、也没有投屏帧时清屏');
        assert(logs.includes('HUD lanes cruise: no-directions'), '记录巡航车道没有方向');
        lanesEngine.stop();
    }
    // 电子眼：限速位置照常显示当前路段限速，电子眼限速另外记下，每个 tick 翻转一次亮灭。
    {
        let clockMs = 0;
        const camFrames = [];
        let cameraAlert = { limitKmh: 40, distanceM: 735 };
        const camEngine = new HudEngine({ log: quiet, clock: () => clockMs, nativeGuidance: null,
            traffic: { reset() {}, read: () => Promise.resolve({ trafficLight: null, speedLimitKmh: 60, speedCamera: cameraAlert }) },
            outputFactory: () => ({ update: (frame, visible) => camFrames.push(visible ? Buffer.from(frame) : null), close() {} }) });
        camEngine.settings({ hud_simple: 1, hud: 0, hud_simple_style: 3 });
        const camTick = async () => { camEngine.tick(); await until(() => !camEngine.navBusy); };
        await camTick();
        assert.strictEqual(camEngine.lastState.speedLimitKmh, 60, '有电子眼时限速位置仍是当前路段限速');
        assert.deepStrictEqual(camEngine.lastState.speedCamera, { limitKmh: 40, distanceM: 735 });
        const first = camEngine.lastState.cameraBlink;
        const on = camFrames[camFrames.length - 1];
        await camTick();
        assert.strictEqual(camEngine.lastState.cameraBlink, !first, '下一个 tick 电子眼限速牌翻转');
        assert(!on.equals(camFrames[camFrames.length - 1]), '电子眼限速牌亮灭会重新推帧');
        camEngine.handleNav(laneState);
        await until(() => !camEngine.navBusy);
        // 导航数据隔很久才来一次（例如每秒一次），中间只有 tick：电子眼限速牌照样亮灭交替。
        const blinks = [];
        for (let i = 0; i < 6; i++) {
            await camTick();
            blinks.push(camEngine.lastState.cameraBlink);
        }
        assert.deepStrictEqual(blinks, blinks.map((_, i) => i % 2 === 0 ? blinks[0] : !blinks[0]), '没有新导航数据时 tick 也让电子眼限速牌亮灭交替');
        assert(blinks.includes(true), '电子眼限速牌不会一直不亮');
        const lastNavAt = camEngine.lastNav;
        cameraAlert = null;
        await camTick();
        assert(!camEngine.lastState.speedCamera, '新投屏帧上卡片消失后，即使导航没有回包也应清除电子眼');
        assert.strictEqual(camEngine.lastState.speedLimitKmh, 60, '清除电子眼后仍保留普通限速');
        assert.strictEqual(camEngine.lastNav, lastNavAt, '刷新图像提示不能延长导航数据的有效期');
        camEngine.stop();
    }
    // 风格 1 的限速牌和风格 2、3 一样是红圈白底：顶栏牌圆心（434, 20）左边 11 单位是白色牌面。
    {
        const frame = renderer.render({ state: 'navigating', direction: 'straight', distanceM: 735, speedLimitKmh: 40 }, laneFont, null, 100, 1);
        const p = (Math.floor((20 + 36) * 480 / 272) * 800 + Math.floor((434 - 11 + 0.5) * 800 / 454)) * 4;
        assert.deepStrictEqual(Array.from(frame.slice(p, p + 4)), [255, 255, 255, 255], '风格 1 限速牌是白底');
    }
    // 渲染：当前限速 60、电子眼 40、735 米。
    const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
    const yellow = (f, i) => f[i] > 200 && f[i + 1] > 140 && f[i + 1] < 220 && f[i + 2] < 120 && f[i + 3] > 0;
    for (const style of [1, 2, 3]) {
        const base = { state: 'navigating', direction: 'straight', distanceM: 250, nextRoad: '前湾二路' };
        const render = (st) => Buffer.from(renderer.render({ ...base, ...st }, laneFont, null, 100, style));
        const cam = { limitKmh: 40, distanceM: 735 };
        const lit = render({ speedLimitKmh: 60, speedCamera: cam, cameraBlink: true });
        const dark = render({ speedLimitKmh: 60, speedCamera: cam, cameraBlink: false });
        const plain = render({ speedLimitKmh: 60 });
        const other = render({ speedLimitKmh: 11 }); // 只有主牌数字和 plain 不同
        let mainDigit = 0, mainTouched = 0, darkExtra = 0, darkNotYellow = 0, litExtra = 0;
        for (let i = 0; i < lit.length; i += 4) {
            if (differs(plain, other, i)) { mainDigit++; if (differs(lit, plain, i) || differs(dark, plain, i)) mainTouched++; }
            if (differs(dark, plain, i)) { darkExtra++; if (!yellow(dark, i)) darkNotYellow++; }
            if (differs(lit, dark, i)) litExtra++;
        }
        assert(mainDigit > 50 && mainTouched === 0, '风格 ' + style + ' 主牌数字（当前限速 60）不被电子眼小牌盖住');
        assert(litExtra > 100, '风格 ' + style + ' 亮的那一帧多画出电子眼限速小牌');
        assert(darkExtra > 20 && darkNotYellow < darkExtra * 0.5, '风格 ' + style + ' 灭的那一帧只多出黄色距离文字');
        // 当前限速未知：主牌就是电子眼，整块闪。
        const merged = render({ speedLimitKmh: null, speedCamera: cam, cameraBlink: true });
        const mergedOff = render({ speedLimitKmh: null, speedCamera: cam, cameraBlink: false });
        const fortyOnly = render({ speedLimitKmh: 40 });
        let mergedSign = 0;
        for (let i = 0; i < merged.length; i += 4) if (differs(merged, mergedOff, i)) mergedSign++;
        assert(mergedSign > 200, '风格 ' + style + ' 只有电子眼时限速牌本身闪');
        assert(!merged.equals(fortyOnly), '风格 ' + style + ' 只有电子眼时还写出距离');
        // 当前限速和电子眼相同：不再叠小牌，主牌闪。
        const same = render({ speedLimitKmh: 40, speedCamera: cam, cameraBlink: true });
        assert(same.equals(merged), '风格 ' + style + ' 限速相同时和只有电子眼一样');
    }
    // 巡航（风格 3）：限速牌在底栏，距离写在牌上方，不碰路名。
    {
        const cruiseBase = { state: 'cruising', currentRoad: '深南大道辅路', speedLimitKmh: 60, trafficLight: { color: 'red', seconds: 53 } };
        const withCam = Buffer.from(renderer.render({ ...cruiseBase, speedCamera: { limitKmh: 40, distanceM: 735 }, cameraBlink: false }, laneFont, null, 100, 3));
        const without = Buffer.from(renderer.render(cruiseBase, laneFont, null, 100, 3));
        let lowest = 0;
        for (let i = 0; i < withCam.length; i += 4) if (differs(withCam, without, i)) lowest = Math.max(lowest, Math.floor(i / 4 / 800));
        assert(lowest > 0 && lowest < Math.floor((164 - 24 + 36) * 480 / 272), '巡航时距离写在底栏限速牌上方');
    }
    console.log('通过：巡航提示、原厂路名、导航优先和断流清屏，巡航车道取自车机并画在路名和红绿灯之间，电子眼限速牌闪烁和距离');

    let nativeWithoutLanes = { events: [laneReply.viewContent[0].eventsInView[0]] };
    const laneEngine = new HudEngine({ log: quiet,
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { available: true, supported: () => true, read: () => Promise.resolve(nativeWithoutLanes),
            currentRoad: () => roadReader.currentRoad(), stop() {} },
        outputFactory: () => ({ update() {}, close() {} }) });
    laneEngine.settings({ hud_simple: 1, hud: 0 });
    laneEngine.handleOapNav(laneState);
    await until(() => !laneEngine.navBusy);
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert(laneEngine.status().native_needs_lanes, '原生缺少车道时继续请求 OAP');
    assert.deepStrictEqual(laneEngine.lastState.lanes, laneState.lanes, '保留同一路口的车道和虚实线');
    laneEngine.handleOapNav(Object.assign({}, laneState, { maneuverPositionM: 7404.5 }));
    await until(() => !laneEngine.navBusy);
    assert.deepStrictEqual(laneEngine.lastState.lanes, laneState.lanes, '两路仅相差几米时保留同一路口的车道');
    for (const mismatch of [{ maneuverPositionM: 7406 }, { maneuverPositionM: null }, { direction: 'left' }]) {
        laneEngine.handleOapNav(Object.assign({}, laneState, mismatch));
        await until(() => !laneEngine.navBusy);
        assert.deepStrictEqual(laneEngine.lastState.lanes, [], '路口位置未知或超差、转向不同均不能合并车道');
    }
    laneEngine.handleOapNav(laneState);
    nativeWithoutLanes = { events: [turn, { laneGuiding: { ...currentLanes.laneGuiding,
        lanes: [{ directionToFollow: 'NONE' }, { directionToFollow: 'NONE' }] } }] };
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert(laneEngine.status().native_needs_lanes, '原生车道没有可绘制的方向时仍请求 OAP');
    assert.deepStrictEqual(laneEngine.lastState.lanes, laneState.lanes, '原生的空箭头行不应覆盖 OAP 提供的车道');
    assert.strictEqual(laneEngine.lastState.currentRoad, '情侣北路', '独立路名要进入实际 HUD 渲染状态');
    assert.strictEqual(laneEngine.lastState.instruction, '科技园路', '当前路名和下个转向描述各自显示');
    roadReader.roadNext = 0;
    roadReader.currentRoad();
    roadReader._onLine('reply 2 0001 00 00000000');
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert.strictEqual(laneEngine.lastState.currentRoad, '', '车机返回空路名后清除旧值');
    assert.strictEqual(laneEngine.lastState.instruction, '科技园路', '路名缺失不影响转向描述');
    roadReader.roadNext = 0;
    roadReader.currentRoad();
    roadReader._onLine('road-avail 0');
    roadReader._onLine('reply 3 0001 00 ' + roadWire);
    assert.strictEqual(roadReader.currentRoad(), '', '断开后忽略迟到的旧路名');
    roadReader._onLine('road-avail 1');
    assert.strictEqual(roadReader.guidanceField('destination'), null);
    assert(roadRequests[roadRequests.length - 1].endsWith(' destination -\n'));
    const destWire = Buffer.concat([u32be(0), u32be(0), u32be(465), Buffer.alloc(5),
        Buffer.from([0, 0x07, 0xea, 11, 23, 0, 19, 57, 43]), Buffer.alloc(8)]);
    const replyToField = (method, payload) => {
        const id = roadRequests[roadRequests.length - 1].split(' ')[0];
        roadReader._onLine('reply ' + id + ' ' + method + ' 00 ' + payload.toString('hex'));
    };
    replyToField('0005', destWire);
    assert.deepStrictEqual(roadReader.guidanceField('destination'), { remainingTimeS: 465, arrivalClock: '19:57' });
    roadReader.guidanceField('lanes', 'junction');
    const laneHeader = Buffer.concat([Buffer.alloc(8), f64be(7400), Buffer.from([0]), u32be(8), u32be(3), Buffer.alloc(8), f64be(200)]);
    const row = Buffer.concat([laneHeader, subWrap([lane0, lane1]), subWrap([u32be(2)]), Buffer.from([1, 50])]);
    replyToField('0019', Buffer.concat([subWrap([row]), Buffer.from([1])]));
    assert.strictEqual(nav.bmwLanes(roadReader.guidanceField('lanes', 'junction')).length, 2);
    assert.strictEqual(roadReader.guidanceField('lanes', 'next-junction'), null, '不能复用前一路口的车道');
    replyToField('0019', Buffer.concat([subWrap([row, row]), Buffer.from([1])]));
    assert.strictEqual(roadReader.guidanceField('lanes', 'next-junction'), null, '多行当前车道不猜对应路口');
    const unreliableHeader = Buffer.concat([Buffer.alloc(8), f64be(7400), Buffer.from([1]), u32be(8), u32be(3), Buffer.alloc(8), f64be(200)]);
    roadReader.guidanceField('lanes', 'unreliable');
    replyToField('0019', Buffer.concat([subWrap([Buffer.concat([unreliableHeader, row.slice(laneHeader.length)])]), Buffer.from([1])]));
    assert.strictEqual(roadReader.guidanceField('lanes', 'unreliable'), null, '不可信的当前车道不使用');
    for (const [context, response] of [['empty', Buffer.alloc(5)], ['bad', Buffer.alloc(1)]]) {
        roadReader.guidanceField('lanes', context);
        replyToField('0019', response);
        assert.strictEqual(roadReader.guidanceField('lanes', context), null);
    }
    roadReader.guidanceField('lanes', 'rejected');
    const rejectedId = roadRequests[roadRequests.length - 1].split(' ')[0];
    roadReader._onLine('err ' + rejectedId + ' service_unavailable');
    assert.strictEqual(roadReader.guidanceField('lanes', 'rejected'), null);
    roadReader._onLine('road-avail 0');
    assert.strictEqual(roadReader.guidanceField('destination'), null, '断连清除旧 ETA');
    roadReader.guidanceField('lanes', 'junction');
    roadReader.guidanceField('lanes', 'next-junction');
    const currentGetter = 'HUD lanes current getter: ';
    assert.deepStrictEqual(currentLaneLogs.filter((line) => line.startsWith(currentGetter)),
        ['received', 'not-single-row', 'unreliable', 'empty', 'decode-rejected', 'query-failed', 'service-unavailable']
            .map((status) => currentGetter + status), '区分当前车道查询结果并对重复日志限频');
    nativeWithoutLanes = { events: [{ intersection: { direction: 'RIGHT', distanceToDestination: 7000 } }] };
    laneEngine.tick();
    await until(() => !laneEngine.nativeBusy && !laneEngine.navBusy);
    assert.deepStrictEqual(laneEngine.lastState.lanes, [], '切换路口立即清除旧车道');
    laneEngine.stop();
    // 车机当前车道（0x0019）只在位置对得上同一路口时使用。
    const currentRow = {
        lanes: [{ directionToFollow: 'NONE', otherDirections: ['STRAIGHT_ON'] },
            { directionToFollow: 'RIGHT', isHighlighted: true, directionsToFollow: ['RIGHT'] }],
        laneMarkers: ['DASHED'], recommendedCarPositionLaneIndex: 1
    };
    let currentLaneRow = null;
    const currentLogs = [];
    const currentEngine = new HudEngine({ log: { ...quiet, info: (s) => currentLogs.push(s) },
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { currentRoad: () => '', guidanceField: (key) => key === 'lanes' ? currentLaneRow : null, stop() {} },
        outputFactory: () => ({ update() {}, close() {} }) });
    currentEngine.settings({ hud_simple: 1, hud: 0 });
    const turnAt = { state: 'navigating', direction: 'right', distanceM: 120, maneuverPositionM: 7000, maneuverId: '1:2' };
    for (const [position, length, expected, message] of [
        [7000, 200, 2, '车道位置记在路口处时使用'],
        [7200, 200, 2, '车道位置记在区段起点时使用'],
        [7400, 200, 0, '车道区段离转向 200 米以上时不用'],
        [7100, 200, 0, '转向只落在区段中间时不猜测车道归属'],
        [6800, 0, 0, '车道在转向之后时不用'],
        [0, 0, 2, '距离和长度都为 0 时视为没有位置信息，沿用当前车道']]) {
        currentLaneRow = Object.assign({}, currentRow, { distanceToDestination: position, length });
        currentEngine.handleNav(turnAt);
        await until(() => !currentEngine.navBusy);
        assert.strictEqual(currentEngine.lastState.lanes.length, expected, message);
    }
    currentLaneRow = Object.assign({}, currentRow, { distanceToDestination: 7000, length: 0 });
    currentEngine.handleNav(Object.assign({}, turnAt, { maneuverPositionM: null }));
    await until(() => !currentEngine.navBusy);
    assert.strictEqual(currentEngine.lastState.lanes.length, 0, '转向位置未知时不能核对，不用有位置的车道');
    assert(currentLogs.some((s) => s.startsWith('HUD lanes current: position-mismatch lanePositionM=7400 lengthM=200 maneuverPositionM=7000')));
    assert(currentLogs.some((s) => s.startsWith('HUD lanes current: used-without-position')));
    currentEngine.stop();

    // CarPlay 导航时 Guidance.currentRoad 为空，改用 Positioning.currentLocation 的 STREET。
    const speech = (text) => Buffer.concat([someip.encodeUtf8D(text), someip.encodeUtf8D(''), someip.encodeUtf8D('')]);
    const locationWire = (street) => Buffer.concat([Buffer.from([1, 0]), f64be(113.9), f64be(22.5),
        u32be(4), f64be(0), f64be(0), Buffer.from([11]),
        subWrap([u32be(13), speech('深圳市'), ...(street ? [u32be(14), speech(street)] : [])]),
        Buffer.alloc(24)]);
    const locLogs = [];
    const locReader = new someip.NativeGuidanceReader({ log: { ...quiet, info: (s) => locLogs.push(s) } });
    const locRequests = [];
    locReader.child = { stdin: { write: (line) => locRequests.push(line) } };
    const lastId = () => locRequests[locRequests.length - 1].split(' ')[0];
    assert.strictEqual(locReader.currentRoad(), '', '两路服务都不可用时不查询');
    assert.deepStrictEqual(locRequests, []);
    locReader._onLine('location-avail 1');
    locReader._onLine('road-avail 1');
    locReader.currentRoad();
    const roadReq = locRequests.find((l) => l.endsWith(' road -\n')).split(' ')[0];
    locReader._onLine('reply ' + roadReq + ' 0001 00 00000000');
    assert(locRequests[locRequests.length - 1].endsWith(' location -\n'), '原厂路名为空时查询定位街道');
    locReader._onLine('reply ' + lastId() + ' 0001 00 ' + locationWire('科技南十二路').toString('hex'));
    assert.strictEqual(locReader.currentRoad(), '科技南十二路', 'CarPlay 导航时显示原厂定位的街道名');
    locReader._onLine('road-avail 0');
    assert.strictEqual(locReader.currentRoad(), '科技南十二路', '导航服务断开不清除定位服务仍有效的街道');
    locReader._onLine('road-avail 1');
    locReader.fields.location.next = 0;
    locReader.currentRoad();
    locReader._onLine('reply ' + lastId() + ' 0001 00 ' + locationWire('').toString('hex'));
    assert.strictEqual(locReader.currentRoad(), '', '定位没有街道时不显示旧路名');
    locReader.roadNext = 0;
    locReader.currentRoad();
    const roadReq2 = locRequests.filter((l) => l.endsWith(' road -\n')).pop().split(' ')[0];
    locReader._onLine('reply ' + roadReq2 + ' 0001 00 ' + roadWire);
    assert.strictEqual(locReader.currentRoad(), '情侣北路', '有原厂路名时优先使用');
    locReader._onLine('road-avail 0');
    locReader.fields.location.next = 0;
    locReader.currentRoad();
    locReader._onLine('reply ' + lastId() + ' 0001 00 ' + locationWire('科技南十二路').toString('hex'));
    assert.strictEqual(locReader.currentRoad(), '科技南十二路', '导航服务断开时定位街道仍可用');
    locReader._onLine('location-avail 0');
    assert.strictEqual(locReader.currentRoad(), '', '定位服务断开后清除街道名');
    for (const bad of [Buffer.alloc(3), Buffer.concat([locationWire('科技南十二路').slice(0, 40)])]) {
        locReader._onLine('location-avail 1');
        locReader.currentRoad();
        locReader._onLine('reply ' + lastId() + ' 0001 00 ' + bad.toString('hex'));
        assert.strictEqual(locReader.currentRoad(), '', '定位数据截断时不显示');
    }

    // 开始导航时原生偶尔返回一次空事件表，不能立刻清屏。
    let graceReply = laneReply;
    const graceFrames = [];
    let graceClock = 0;
    const graceEngine = new HudEngine({ log: quiet, navEndGraceMs: 300, clock: () => graceClock,
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { available: true, supported: () => true, read: () => Promise.resolve(graceReply),
            currentRoad: () => '', stop() {} },
        outputFactory: () => ({ update: (_, visible) => graceFrames.push(visible), close() {} }) });
    graceEngine.settings({ hud_simple: 1, hud: 0 });
    const graceTick = async () => { graceEngine.tick(); await until(() => !graceEngine.nativeBusy && !graceEngine.navBusy); };
    await graceTick();
    assert.strictEqual(graceEngine.lastState.state, 'navigating');
    graceReply = { events: [] };
    await graceTick();
    graceEngine.handleOapNav({ state: 'inactive' });
    graceEngine.handleNavError('navigation unavailable');
    assert.deepStrictEqual(graceFrames.filter((v) => !v), [], '原生偶发空表期间，应用空表或错误也不清屏');
    graceReply = laneReply;
    await graceTick();
    graceReply = { events: [] };
    await graceTick();
    graceClock += 350;
    await graceTick();
    assert.strictEqual(graceFrames[graceFrames.length - 1], false, '空事件表持续超过宽限时间后结束导航');
    graceEngine.stop();
    for (const [type, direction] of [['roundabout', 'roundabout'], ['destinationManeuver', 'arrive']]) {
        const state = nav.fromBmw({ events: [{ type, value: { direction: direction.toUpperCase() } }] });
        assert.strictEqual(state.state, 'navigating');
        assert.strictEqual(state.direction, direction);
    }
    const maxFontFrame = renderer.render(laneState, laneFont, null, 150, 1);
    for (let i = 417 * 800 * 4 + 3; i < maxFontFrame.length; i += 4) {
        assert.strictEqual(maxFontFrame[i], 0, '最大字号 ETA 留在 453×200 安全区内');
    }
    const availEvents = [];
    const nativeReader = new someip.NativeGuidanceReader({
        bin: '/nonexistent/woc-guidance',
        onAvailability: (up) => availEvents.push(up)
    });
    const availChanges = [];
    const availEngine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: nativeReader
    });
    nativeReader.onAvailability = (up) => { availEvents.push(up); availEngine._onNativeAvailability(up); };
    availEngine.on('change', (st) => availChanges.push(st.native_guidance));
    availEngine.nativeRetryAt = Date.now() + 3000;
    nativeReader._onLine('avail 1');
    assert.strictEqual(availEngine.nativeRetryAt, 0, 'SOME/IP 恢复可用时应立即清除退避重试时间');
    assert.deepStrictEqual(availEvents, [true]);
    assert.deepStrictEqual(availChanges, [false], '未解出有效导航事件前不抢占 OAP 轮询');
    /* 回归：原生有效 -> 变空 -> 重置 nativeVerified 并广播 native_guidance=false 以恢复 OAP 兜底 */
    let nativeReply = reply;
    const toggleEngine = new HudEngine({
        traffic: { reset() {}, read: () => Promise.resolve(null) },
        nativeGuidance: { available: true, supported: () => true, read: () => Promise.resolve(nativeReply), stop() {} },
        outputFactory: (_keep, _onState) => ({ setKeepShown() {}, setLayout() {}, update() {}, close() {} })
    });
    const toggleNativeFlags = [];
    toggleEngine.on('change', (st) => toggleNativeFlags.push(st.native_guidance));
    toggleEngine.settings({ hud_simple: 1, hud: 0 });
    toggleEngine.tick();
    await until(() => !toggleEngine.nativeBusy && !toggleEngine.navBusy && toggleEngine.nativeVerified);
    assert.strictEqual(toggleEngine.status().native_guidance, true, '原生解出有效事件后应接管');
    nativeReply = { viewContent: [] };
    toggleEngine.tick();
    await until(() => !toggleEngine.nativeBusy && !toggleEngine.nativeVerified);
    assert.strictEqual(toggleEngine.status().native_guidance, false, '原生后续返回空事件时应释放接管并恢复 OAP');
    assert.strictEqual(toggleNativeFlags[toggleNativeFlags.length - 1], false, '空事件分支必须广播 native_guidance=false');
    toggleEngine.stop();
    availEngine.nativeVerified = true;
    nativeReader._onLine('avail 0');
    assert.strictEqual(availEngine.nativeVerified, false, 'SOME/IP 断开时应重置已验证标记');
    assert.deepStrictEqual(availEvents, [true, false]);
    assert.deepStrictEqual(availChanges, [false, false]);
    availEngine.stop();
    console.log('通过：原生 SOME/IP Utf8D 编码与可用状态同步回调');

    /* 端到端集成测试：patch.sock -> hud_daemon (hud.sock) -> OAP StructuredHud -> render.sock（含断线重连） */
    const pid = process.pid;
    const pSock = `/tmp/woc-e2e-patch-${pid}.sock`;
    const hSock = `/tmp/woc-e2e-hud-${pid}.sock`;
    const rSock = `/tmp/woc-e2e-render-${pid}.sock`;
    [pSock, hSock, rSock].forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
    const patchPeers = new Set();
    const patchSrv = net.createServer((s) => {
        patchPeers.add(s); s.setEncoding('utf8');
        s.on('data', (d) => {
            if (d.indexOf('hud-simple-status') >= 0) {
                s.write(JSON.stringify({ ev: 'map-settings', settings: { hud_simple: 1, hud: 0, hud_keep_shown: 0 } }) + '\n');
            }
        });
        s.on('close', () => patchPeers.delete(s));
    });
    const renderSessions = [], renderPeers = [];
    const crMsg = (obj) => {
        const b = Buffer.from(JSON.stringify(obj)), m = Buffer.alloc(b.length + 5);
        m.writeUInt32LE(b.length + 1, 0); m[4] = 74; b.copy(m, 5); return m;
    };
    const renderSrv = net.createServer((peer) => {
        const sess = { cmds: [], frames: 0 };
        renderSessions.push(sess); renderPeers.push(peer);
        let buf = Buffer.alloc(0);
        peer.on('error', () => {});
        peer.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 5 && buf.length >= buf.readUInt32LE(0) + 4) {
                const sz = buf.readUInt32LE(0), t = buf[4], body = buf.slice(5, sz + 4);
                buf = buf.slice(sz + 4);
                if (t === 70) { sess.frames++; continue; }
                const cmd = JSON.parse(body.toString());
                sess.cmds.push(cmd);
                if (cmd.op === 'hello') peer.write(crMsg({ ev: 'hello', backend: 'id7', proto: 1, targets: 'hud:800x480' }));
                if (cmd.op === 'set' && cmd.visible !== undefined) {
                    peer.write(crMsg({ ev: 'layer', ref: cmd.ref, state: cmd.visible === 1 ? 'shown' : 'hidden' }));
                }
            }
        });
    });
    await new Promise((r) => patchSrv.listen(pSock, r));
    await new Promise((r) => renderSrv.listen(rSock, r));
    const hudLogs = [];
    const daemon = startDaemon({
        hudSocket: hSock, patchSocket: pSock, renderSocket: rSock, logFile: null,
        log: { info(line) { hudLogs.push(line); }, warn() {}, error() {} }, retryMs: 50,
        traffic: { reset() {}, read: () => Promise.resolve(null) }
    });
    const bridge = new StructuredHud({
        control, hudPath: hSock, retryMs: 50, intervalMs: 50,
        reader: { read: () => { reads++; return Promise.resolve(laneReply); }, stop: () => stops++ },
        parkingReader: { read: () => Promise.resolve(true), stop() {} }
    });
    try {
        bridge.start();
        await until(() => bridge.supported && bridge.enabled && bridge.state === 'showing' && renderSessions[0] && renderSessions[0].frames > 0);
        assert(renderSessions[0].cmds.some((c) => c.op === 'hello' && c.app === 'robertn_waze_cluster_simple'));
        assert(renderSessions[0].cmds.some((c) => c.op === 'layer' && c.target === 'hud' && c.kind === 'image'));
        assert.deepStrictEqual(daemon.engine.lastState.lanes, laneState.lanes, '实际 OAP 桥接和 HUD 推帧保留车道及虚实线');
        assert(hudLogs.some((line) => line.includes('HUD lanes OAP: matched received=1 eligible=1 matched=1 selectedLanes=4')),
            '车道诊断穿过 OAP socket 并写入后台日志');
        renderPeers[0].destroy();
        await until(() => renderSessions.length >= 2 && renderSessions[1].frames > 0 && bridge.state === 'showing');
        bridge.settings({ hud_simple: 0, hud: 1 });
        await until(() => !bridge.enabled && bridge.state === 'off');
        bridge.settings({ hud_simple: 1, hud: 0 });
        await until(() => bridge.enabled && !bridge.suspended);
        bridge.startValidation();
        await until(() => !!daemon.engine.validation);
        bridge.stop();
        await until(() => !daemon.engine.validation && !daemon.engine.output);
        console.log('通过：端到端集成（patch.sock -> hud_daemon -> hud.sock -> OAP 桥接 -> render.sock 建层/推帧/断连重连/配置切换）');
    } finally {
        bridge.stop();
        daemon.close();
        renderPeers.forEach((p) => p.destroy());
        patchPeers.forEach((p) => p.destroy());
        await new Promise((r) => renderSrv.close(r));
        await new Promise((r) => patchSrv.close(r));
        [pSock, hSock, rSock].forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
    }

    /* 按正式链接器的扁平模块名和静态 require 规则校验整份清单，防止包内漏文件、相对引用失效或注释误触发链接失败。 */
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mgu-app.json'), 'utf8'));
    const builtins = require('module').builtinModules || [];
    const modules = {};
    manifest.modules.forEach((name) => {
        const key = './' + path.basename(name);
        assert(!modules[key], '模块重名：' + key);
        modules[key] = fs.readFileSync(path.join(root, name), 'utf8');
    });
    manifest.modules.forEach((name) => {
        const source = modules['./' + path.basename(name)];
        const re = /require\('([^']+)'\)/g;
        let m;
        while ((m = re.exec(source)) !== null) {
            const dep = m[1];
            assert(modules[dep] || manifest.sdk.includes(dep) || builtins.includes(dep),
                `${name} 包含未登记的 require('${dep}')（与 oap_link.js 静态扫描冲突）`);
        }
    });
    const cache = {};
    const load = (key) => {
        if (!modules[key]) return require(key);
        if (!cache[key]) {
            const module = cache[key] = { exports: {} };
            const factory = vm.runInThisContext('(function(require,module,exports){\n' + modules[key] + '\n})', { filename: key });
            factory(load, module, module.exports);
        }
        return cache[key].exports;
    };
    assert.strictEqual(typeof load('./structured_hud.js').StructuredHud, 'function');
    assert.strictEqual(typeof load('./guidance_reader.js').GuidanceReader, 'function');
    console.log('通过：正式源包中的 HUD 模块、字体和原版输出客户端依赖完整');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
