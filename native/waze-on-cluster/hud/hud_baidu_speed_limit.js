'use strict';

/*
 * Baidu cruise-map speed sign recognizer.
 * The sign is a red circular outline with white digits on a dark centre.
 * Input is RGB, RGBA or full-range BT.601 YUV420p, matching the traffic reader.
 */
// 8×12 数字字形，按实际亮像素的边界归一化后比对。
const DIGITS = [
    '3c7e66c3c3c3c3c3c3627e3c', 'f0fcefe1e0e0e0e0e0e0e0e0',
    '3c7ec3c3406030180c06ffff', '3c7ec3c0603878c0c0c37e3c',
    '3070786c6c646263ffff6060', '7e7f03033b7fc3c0c1c37e3c',
    '3c7ec6033b7fc7c3c3c67e3c', 'ffffc06060303018180c0c06',
    '3c7e4343663c7ec3c3c37e3c', '3c7e63c3c3e3fedcc0637e3c'
].map(hex => Buffer.from(hex, 'hex'));
const ANGLES = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);

function imageOf(pixels, width, height, channels) {
    const atlas = channels === 0;
    const chroma = width * height;
    const plane = width >> 1;
    function luma(x, y) {
        const i = (y * width + x) * (channels || 1);
        return atlas ? pixels[i] : 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    return {
        red(x, y) {
            if (x < 0 || y < 0 || x >= width || y >= height) return false;
            if (atlas) {
                const uv = chroma + (y >> 1) * width + (x >> 1);
                const u = pixels[uv], v = pixels[uv + plane];
                return pixels[y * width + x] >= 45 && v >= 155 && v - u >= 31;
            }
            const i = (y * width + x) * channels;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            return r >= 100 && r - g >= 48 && r - b >= 38;
        },
        white(x, y) {
            if (luma(x, y) < 145) return false;
            if (atlas) {
                const uv = chroma + (y >> 1) * width + (x >> 1);
                return Math.abs(pixels[uv] - 128) <= 28 && Math.abs(pixels[uv + plane] - 128) <= 28;
            }
            const i = (y * width + x) * channels;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            return Math.max(r, g, b) - Math.min(r, g, b) <= 48;
        },
        dark(x, y) { return luma(x, y) <= 110; }
    };
}

function digit(image, left, right, top, bottom, size) {
    const width = right - left + 1, height = bottom - top + 1;
    if (height < size * 0.23 || height > size * 0.57 || width > height * 0.95) return null;
    const mask = new Uint8Array(12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) {
        const px = left + Math.floor((x + 0.5) * width / 8);
        const py = top + Math.floor((y + 0.5) * height / 12);
        if (image.white(px, py)) mask[y] |= 1 << x;
    }
    const scores = DIGITS.map((pattern, value) => {
        let errors = 0;
        for (let y = 0; y < 12; y++) {
            for (let bits = mask[y] ^ pattern[y]; bits; bits &= bits - 1) errors++;
        }
        return { value, errors };
    }).sort((a, b) => a.errors - b.errors);
    return scores[0].errors <= 23 && scores[1].errors - scores[0].errors >= 5 ? scores[0].value : null;
}

function readDigits(image, cx, cy, size) {
    const left = Math.ceil(cx - size * 0.34), right = Math.floor(cx + size * 0.34);
    const top = Math.ceil(cy - size * 0.34), bottom = Math.floor(cy + size * 0.34);
    const groups = [];
    let group = [];
    for (let x = left; x <= right + 1; x++) {
        const points = [];
        if (x <= right) {
            for (let y = top; y <= bottom; y++) {
                const dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= size * size * 0.105 && image.white(x, y)) points.push({ x, y });
            }
        }
        if (points.length) group = group.concat(points);
        else if (group.length) { groups.push(group); group = []; }
    }
    if (groups.length < 1 || groups.length > 3) return null;
    const values = groups.map(points => digit(image, points[0].x, points[points.length - 1].x,
        Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.y)), size));
    if (values[0] === 0 || values.includes(null)) return null;
    const value = Number(values.join(''));
    return value >= 10 && value <= 199 ? value : null;
}

function ringCandidate(image, cx, cy, size) {
    // Thin antialiased outlines may land anywhere in this radial band.
    const sectors = ANGLES.filter(([dx, dy]) => [0.41, 0.44, 0.47, 0.50].some(r =>
        image.red(Math.round(cx + size * r * dx), Math.round(cy + size * r * dy))));
    if (sectors.length < 13) return null;
    // A traffic-light ring has an icon or coloured fill. Cruise signs have a dark face.
    if (ANGLES.filter(([dx, dy]) => image.dark(Math.round(cx + size * 0.31 * dx),
        Math.round(cy + size * 0.31 * dy))).length < 12) return null;
    return readDigits(image, cx, cy, size);
}

function recognizeBaiduSpeedLimit(pixels, width, height, channels = 3) {
    if (!(pixels instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width <= 0 || height <= 0 || width * height > 3840 * 2160 ||
        (channels === 0 ? width % 2 || height % 2 || pixels.length !== width * height * 1.5 :
            (channels !== 3 && channels !== 4) || pixels.length !== width * height * channels)) return null;
    const image = imageOf(pixels, width, height, channels);
    let result = null;
    // 限速牌在画面中下部，遍历量受这个搜索区域的面积限制。
    const yStart = Math.floor(height * 0.48);
    const xStart = Math.floor(width * 0.22), xEnd = Math.ceil(width * 0.78);
    const stride = xEnd - xStart;
    const visited = new Uint8Array(stride * (height - yStart));
    const spans = [];
    const rowStart = y => (y - yStart) * stride - xStart;
    function redUnvisited(x, y, row) {
        return !visited[row + x] && image.red(x, y);
    }
    for (let y = yStart; y < height; y += 2) for (let x = xStart; x < xEnd; x += 2) {
        if (!redUnvisited(x, y, rowStart(y))) continue;
        let left = x, right = x, top = y, bottom = y, area = 0;
        // 按行标记完整红色连通域。超大红线最后只丢弃自身，不重新进入剩余像素。
        function addSpan(col, row, offset) {
            let start = col, end = col;
            while (start > xStart && redUnvisited(start - 1, row, offset)) start--;
            while (end + 1 < xEnd && redUnvisited(end + 1, row, offset)) end++;
            visited.fill(1, offset + start, offset + end + 1);
            spans.push(start, end, row);
            left = Math.min(left, start);
            right = Math.max(right, end);
            top = Math.min(top, row);
            bottom = Math.max(bottom, row);
            area += end - start + 1;
            return end;
        }
        addSpan(x, y, rowStart(y));
        while (spans.length) {
            const row = spans.pop(), end = spans.pop(), start = spans.pop();
            // 相邻行左右各多检查一格，保留斜向相连的圆圈边缘。
            const first = Math.max(xStart, start - 1), last = Math.min(xEnd - 1, end + 1);
            for (let adjacent = row - 1; adjacent <= row + 1; adjacent += 2) {
                if (adjacent < yStart || adjacent >= height) continue;
                const offset = rowStart(adjacent);
                for (let col = first; col <= last; col++) {
                    if (redUnvisited(col, adjacent, offset)) col = addSpan(col, adjacent, offset);
                }
            }
        }
        const w = right - left + 1, h = bottom - top + 1;
        if (area < 18 || w < 10 || h < 10 || w > 110 || h > 110 || w / h < 0.82 || w / h > 1.22 || area > w * h * 0.55) continue;
        const value = ringCandidate(image, (left + right) / 2, (top + bottom) / 2, (w + h) / 2);
        if (value !== null) {
            if (result !== null) return null;
            result = value;
        }
    }
    return result;
}

module.exports = { recognizeBaiduSpeedLimit };
