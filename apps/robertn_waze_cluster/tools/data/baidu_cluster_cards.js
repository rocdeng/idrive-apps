'use strict';

// 用几何图形合成测试画面，避免测试依赖真实车机画面和道路数据。
function card(w, h, x, y, draw) {
    function pixels() {
        const rgb = Buffer.alloc(w * h * 3, 30);
        function pixel(px, py, color) {
            const i = (py * w + px) * 3;
            rgb[i] = color[0]; rgb[i + 1] = color[1]; rgb[i + 2] = color[2];
        }
        function rect(left, top, width, height, color) {
            for (let py = top; py < top + height; py++) {
                for (let px = left; px < left + width; px++) pixel(px, py, color);
            }
        }
        function circle(cx, cy, radius, inner, rim, face) {
            for (let py = cy - radius; py <= cy + radius; py++) {
                for (let px = cx - radius; px <= cx + radius; px++) {
                    const r2 = (px - cx) ** 2 + (py - cy) ** 2;
                    if (r2 <= radius ** 2) pixel(px, py, r2 >= inner ** 2 ? rim : face);
                }
            }
        }
        function digit(value, left, top, width, height, color) {
            const mask = Buffer.from(BITMAPS[value], 'hex');
            for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
                if (mask[Math.floor(py * 12 / height)] & (1 << Math.floor(px * 8 / width))) {
                    pixel(left + px, top + py, color);
                }
            }
        }
        draw(rect, circle, digit);
        return rgb;
    }
    return { w, h, x, y, pixels };
}

const WHITE = [245, 245, 245], BLACK = [16, 16, 16], FACE = [30, 30, 30];
const RED = [226, 48, 43], YELLOW = [235, 195, 34];
const BITMAPS = {
    0: '3c7e66c3c3c3c3c3c3627e3c', 3: '3c7ec3c0603878c0c1c37e3c',
    4: '3070786c6c646263ffff6060', 5: '7e7f03033b7fc3c0c1c37e3c', 7: 'ffffc06060303018180c0c06'
};

function segmented(rect, left, top, value) {
    const bars = [[1, 0, 8, 2], [0, 1, 2, 8], [8, 1, 2, 8], [1, 8, 8, 2],
        [0, 9, 2, 8], [8, 9, 2, 8], [1, 16, 8, 2]];
    const mask = value === 5 ? '1101011' : '1011011';
    bars.forEach(([x, y, w, h], i) => { if (mask[i] === '1') rect(left + x, top + y, w, h, WHITE); });
}

module.exports = {
    vertical: card(80, 90, 510, 150, (rect, circle) => {
        circle(36, 31, 16, 12, RED, FACE);
        segmented(rect, 23, 55, 5);
        segmented(rect, 36, 55, 3);
    }),
    horizontal: card(172, 78, 430, 210, (rect, circle) => {
        circle(36, 37, 20, 15, YELLOW, FACE);
        rect(62, 34, 11, 8, WHITE);
        rect(78, 34, 11, 8, WHITE);
    }),
    camera: card(166, 72, 396, 112, (rect, circle, digit) => {
        circle(36, 34, 32, 25, RED, WHITE);
        digit(4, 17, 22, 16, 24, BLACK);
        digit(0, 36, 22, 16, 24, BLACK);
        for (let x = 77; x < 144; x += 17) rect(x, 16, 12, 11, WHITE);
        [7, 3, 5].forEach((n, i) => digit(n, 77 + i * 14, 40, 12, 18, WHITE));
        rect(123, 40, 18, 17, WHITE);
    }),
    cruiseSign: card(130, 48, 530, 304, (rect, circle, digit) => {
        circle(64, 24, 21, 17, RED, FACE);
        digit(3, 52, 16, 10, 15, WHITE);
        digit(0, 65, 16, 10, 15, WHITE);
    })
};
