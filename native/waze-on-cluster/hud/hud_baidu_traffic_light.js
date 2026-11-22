'use strict';

// 百度地图 V22 夜间倒计时卡片。输入为 RGB、RGBA 或全范围 BT.601 图集。
const DIGITS = ['1110111', '0010010', '1011101', '1011011', '0111010',
    '1101011', '1101111', '1010010', '1111111', '1111011'];

function lampColor(r, g, b) {
    if (r >= 130 && r - g >= 65 && r - b >= 55) return 1;
    if (g >= 120 && g - r >= 60 && g - b >= 40) return 2;
    if (r >= 155 && g >= 120 && r - b >= 85 && g - b >= 55 && r - g >= -15 && r - g <= 65) return 3;
    return 0;
}

let chromaColor, chromaMinY;
function atlasColor(pixels, width, height) {
    // 同一组色度只计算一次：1=红，2=绿，3=黄，配合最低亮度阈值表。
    if (!chromaColor) {
        chromaColor = new Uint8Array(65536);
        chromaMinY = new Uint8Array(65536);
        for (let u = -128; u < 128; u++) for (let v = -128; v < 128; v++) {
            const red = 1.402 * v, green = -0.344136 * u - 0.714136 * v, blue = 1.772 * u;
            const key = ((u + 128) << 8) | (v + 128);
            if (red - green >= 65 && red - blue >= 55) {
                chromaColor[key] = 1;
                chromaMinY[key] = Math.max(0, Math.min(255, Math.ceil(130 - red)));
            } else if (green - red >= 60 && green - blue >= 40) {
                chromaColor[key] = 2;
                chromaMinY[key] = Math.max(0, Math.min(255, Math.ceil(120 - green)));
            } else if (red - blue >= 85 && green - blue >= 55 && red - green >= -15 && red - green <= 65) {
                chromaColor[key] = 3;
                chromaMinY[key] = Math.max(0, Math.min(255, Math.max(Math.ceil(155 - red), Math.ceil(120 - green))));
            }
        }
    }
    const chroma = width * height, plane = width >> 1;
    return (x, y, i) => {
        const uv = chroma + (y >> 1) * width + (x >> 1);
        const key = (pixels[uv] << 8) | pixels[uv + plane];
        const c = chromaColor[key];
        if (!c || pixels[i] < chromaMinY[key]) return 0;
        return c;
    };
}

function frame(pixels, width, height, channels) {
    function index(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        return x >= 0 && x < width && y >= 0 && y < height ? y * width + x : -1;
    }
    const atlas = channels === 0;
    const colorAt = atlas ? atlasColor(pixels, width, height) : (x, y, i) => {
        const p = i * channels;
        return lampColor(pixels[p], pixels[p + 1], pixels[p + 2]);
    };
    function rgb(i, fn) {
        if (!atlas) return fn(pixels[i * channels], pixels[i * channels + 1], pixels[i * channels + 2]);
        // 车机图集是全范围 BT.601，按需读取对应的色度，不转整张 RGB 图。
        const uv = width * height + (Math.floor(i / width) >> 1) * width + ((i % width) >> 1);
        const u = pixels[uv] - 128, v = pixels[uv + width / 2] - 128, y = pixels[i];
        return fn(y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u);
    }
    const white = (r, g, b) => Math.min(r, g, b) >= 150 && Math.max(r, g, b) >= 180;
    const dark = (r, g, b) => Math.max(r, g, b) < 115;
    return {
        colorAt,
        color(x, y) {
            x = Math.round(x);
            y = Math.round(y);
            return x < 0 || y < 0 || x >= width || y >= height ? 0 : colorAt(x, y, y * width + x);
        },
        white(x, y) {
            const i = index(x, y);
            return i >= 0 && rgb(i, white);
        },
        dark(x, y) {
            const i = index(x, y);
            return i >= 0 && rgb(i, dark);
        }
    };
}

let visited, queue;
function rings(image, width, height) {
    const found = [];
    if (!visited || visited.length !== width * height) {
        visited = new Uint8Array(width * height);
    } else visited.fill(0);
    const maxSize = Math.floor(height * 0.21);
    const maxArea = Math.floor(maxSize * maxSize * 0.62);
    if (!queue || queue.length !== maxArea) queue = new Int32Array(maxArea);
    let visitsLeft = 65536;
    const minSize = Math.max(18, height * 0.065);
    for (let y = 1; y < height - 1; y += 2) {
        seed: for (let x = 1; x < width - 1; x += 2) {
            const start = y * width + x;
            if (visited[start]) continue;
            const color = image.colorAt(x, y, start);
            if (!color) continue;
            let tail = 1;
            let left = x, right = x, top = y, bottom = y;
            queue[0] = start;
            visited[start] = 1;
            for (let head = 0; head < tail; head++) {
                // 整帧也有预算，大色块反复碰到上限时直接放弃这一帧。
                if (--visitsLeft < 0) return [];
                const index = queue[head];
                const col = index % width;
                const row = Math.floor(index / width);
                left = Math.min(left, col);
                right = Math.max(right, col);
                top = Math.min(top, row);
                bottom = Math.max(bottom, row);
                if (right - left + 1 > maxSize || bottom - top + 1 > maxSize) continue seed;
                for (let axis = 0; axis < 4; axis++) {
                    const nx = col + (axis === 0 ? -1 : axis === 1 ? 1 : 0);
                    const ny = row + (axis === 2 ? -1 : axis === 3 ? 1 : 0);
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const next = ny * width + nx;
                    if (!visited[next] && image.colorAt(nx, ny, next) === color) {
                        visited[next] = 1;
                        if (tail === maxArea) continue seed;
                        queue[tail++] = next;
                    }
                }
            }
            const dx = right - left + 1, dy = bottom - top + 1;
            if (dx < minSize || dx > maxSize || dx / dy < 0.83 || dx / dy > 1.20 ||
                tail < dx * dy * 0.10 || tail > dx * dy * 0.62) continue;
            const cx = (left + right) / 2, cy = (top + bottom) / 2;
            let sectors = 0;
            for (let n = 0; n < 16; n++) {
                const angle = n * Math.PI / 8;
                if ([0.40, 0.44, 0.47].some(r => image.color(cx + dx * r * Math.cos(angle),
                    cy + dy * r * Math.sin(angle)) === color)) sectors++;
            }
            if (sectors >= 13) {
                if (found.length >= 12) return [];
                found.push({cx, cy, size: (dx + dy) / 2, color});
            }
        }
    }
    return found;
}

function digit(pixels, height, scale) {
    const left = pixels[0].x;
    const right = pixels[pixels.length - 1].x;
    let top = pixels[0].y, bottom = top;
    for (const point of pixels) {
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    const width = right - left + 1;
    const tall = bottom - top + 1;
    if (tall < scale * 0.42 || tall > height || width > tall * 0.88) return null;
    const normalized = pixels.map(p => [(p.x - left) / (width || 1), (p.y - top) / (tall || 1)]);
    if (width / tall < 0.36) {
        // “1”的上下两段均应有亮像素，排除短划和催促高亮线。
        return normalized.filter(p => p[1] < 0.4).length >= tall * 0.35 &&
            normalized.filter(p => p[1] > 0.6).length >= tall * 0.35 ? 1 : null;
    }
    function lit(x, y, wx, wy) {
        return normalized.filter(p => Math.abs(p[0] - x) < wx && Math.abs(p[1] - y) < wy).length >=
            Math.max(2, width * tall * wx * wy * 1.1);
    }
    const segments = [lit(0.5, 0.07, 0.19, 0.13), lit(0.12, 0.26, 0.22, 0.12),
        lit(0.86, 0.26, 0.22, 0.12), lit(0.5, 0.5, 0.19, 0.11),
        lit(0.12, 0.74, 0.22, 0.12), lit(0.86, 0.74, 0.22, 0.12),
        lit(0.5, 0.91, 0.19, 0.12)].map(Number).join('');
    const value = DIGITS.indexOf(segments);
    return value < 0 ? null : value;
}

function countdown(image, left, right, cy, scale) {
    const columns = [];
    const halfHeight = Math.round(scale * 0.35);
    for (let x = Math.ceil(left); x <= right; x++) {
        const points = [];
        for (let y = -halfHeight; y <= halfHeight; y++) {
            // 按数字的倾斜方向校正，避免相邻数字在列投影里粘在一起。
            if (image.white(x - y * 0.12, cy + y)) points.push({x, y});
        }
        columns.push(points);
    }
    const groups = [];
    let current = [];
    for (const column of columns.concat([[]])) {
        if (column.length) current.push(...column);
        else if (current.length) {
            groups.push(current);
            current = [];
        }
    }
    if (groups.length < 1 || groups.length > 2) return null;
    const values = groups.map(group => digit(group, 2 * halfHeight, scale));
    if (values.includes(null)) return null;
    return Number(values.join(''));
}

function direction(image, cx, cy, size) {
    // 确认箭杆和两个对称箭翼；绿灯图标左侧的短条没有这三个特征。
    const templates = [[0, 'right'], [2, 'left'], [3, 'straight']];
    const matches = templates.filter(([turn]) => {
        const angle = turn * Math.PI / 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const sample = (x, y) => image.white(cx + size * (x * cos - y * sin), cy + size * (x * sin + y * cos));
        const wing = (side, rear) => [0.025, 0.05, 0.075, 0.10, 0.125].reduce((count, x) =>
            count + [0.22, 0.25, 0.28].filter(y => sample(rear ? -x : x, side * y)).length, 0);
        return sample(-0.14, 0) && sample(0, 0) && sample(0.13, 0) &&
            [-1, 1].every(side => wing(side, true) >= 1) &&
            wing(-1, true) + wing(1, true) >= wing(-1, false) + wing(1, false) + 2;
    });
    return matches.length === 1 ? matches[0][1] : null;
}

function hasCautionLabel(image, left, right, cy, scale) {
    const halfHeight = Math.round(scale * 0.34);
    let lit = 0;
    for (let x = Math.ceil(left); x <= right; x++) {
        for (let y = -halfHeight; y <= halfHeight; y++) {
            if (image.white(x, cy + y)) lit++;
        }
    }
    return lit >= Math.max(12, scale * scale * 0.04);
}

function readCard(image, ring, includeDirection) {
    const {cx, cy, size, color} = ring;
    // 确认图标右边是深色卡片，且数字或“注意”文案与图标垂直居中。
    const darkCorners = [0.66, 1.08, 1.47].every(x =>
        image.dark(cx + x * size, cy - size * 0.39) && image.dark(cx + x * size, cy + size * 0.39));
    if (!darkCorners) return null;
    const seconds = countdown(image, cx + size * 0.56, cx + size * 1.55, cy, size);
    const name = color === 1 ? 'red' : color === 2 ? 'green' : 'yellow';
    if (seconds === null) {
        if (color !== 3 || !hasCautionLabel(image, cx + size * 0.56, cx + size * 1.55, cy, size)) return null;
        const caution = {color: 'yellow', seconds: null, text: '注意'};
        if (includeDirection) caution.direction = direction(image, cx, cy, size);
        return caution;
    }
    const light = {color: name, seconds};
    if (includeDirection) light.direction = direction(image, cx, cy, size);
    return light;
}

function recognizeBaiduTrafficLight(pixels, width, height, channels = 3, includeDirection = true) {
    if (!(pixels instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width <= 0 || height <= 0 || width * height > 3840 * 2160 ||
        (channels === 0 ? width % 2 || height % 2 || pixels.length !== width * height * 1.5 :
            (channels !== 3 && channels !== 4) || pixels.length !== width * height * channels)) return null;
    const image = frame(pixels, width, height, channels);
    const matches = rings(image, width, height).map(ring => readCard(image, ring, includeDirection)).filter(Boolean);
    // 同一帧同时识别到多张卡片时，无法仅凭位置确定是哪一个路口。
    return matches.length === 1 ? matches[0] : null;
}

module.exports = {recognizeBaiduTrafficLight};
