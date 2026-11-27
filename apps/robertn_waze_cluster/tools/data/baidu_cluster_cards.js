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

// 实际百度仪表画面中的「即将抓拍」灰度裁样。只留文字一行，限速牌和距离都不在裁样内。
const cameraText = require('zlib').inflateSync(Buffer.from(
    'eNoB3AUj+iUwOjgxKzA/MCYqNDszNUA4IyIlIykrSEcoKCItRTQdIiUiIiUkIR8tRj0lIyQkJiAkKi86QCcfIigiJDs6Gx8iJSUn' +
    'PiwiGh8eJDVklJiHhJuibzJPj5uDiaB/NiYrIB1GrJEzFC92rYNBMTI2KyAlKSRTooMwIykqLyo8V3acp10nFiMqRZ2OOygcHxtj' +
    'n3M8FiAgGj+a7vLf39/vqz9z4Pbj4P3LTiAqKB5V5rU7HGbT/+W7trq7hDghJBxj1acqJ2iSp7DBzt3343IuHiIgTNS2OiEZKSmJ' +
    'zX86HSQaIkCZ06VvbpPZukR66cyPnezTTyY3TTNT4K5MaL/y5sm7yPT2ozkdLjJn1a44O7Xo0Of507DLtUceISosW9a2RzlRiZfM' +
    '9aeCiY9bMEScy4hKRG/RtkB3551KWdPcTTJfsXRd3L2Mw927lHFfi+zdeikrZ6bJ8eGtgtjhg6Huk2XImzUhIEqTxvLnsXqO3Nnm' +
    '5tDJ1OSGOUee3culn8Hktkd03ZI1ScfZUjBjzLxw3cV7uIiVtnt6uOekSR8udcPi/eq+lNXJW3/bd0+6mDUjKFum2vX3xpCm262F' +
    'hoGIseqTOEaj7OPCus3ruUp325I3RcXaTSRDrd6I57lPYEKI49jS0KRWIiYsQGWV4sl2UsPRUHLkbka6ojoeHzVgiuLTdk6e2Xs6' +
    'MjY6ddeQO0ag2KFkXYbTsT934ZI2Q8XfUScpccma565NaJjH8e26lFUtIiojICZr2qQtJcDZU2zqcke1qTcbKiEmWNG0Qyyd2F4j' +
    'HB4bXNabPD2b1ZNQToTduUF54ZE3Q8TdTyIrO1tx37NOjtnOtJBghp5RJSEnJRZdzbBocNbET2fmdEWssjwYKhkWTsLAeF6o0Wcj' +
    'IyMpadOYPEOi69izrsLotkJ435I5RMTcSyIpIiNq3L1ch76ni3J0yPCOVDYjKTJ+5eW7p+W9TXDjcz6kuksbHyM4bNzsuY+t4q6B' +
    'hXiIt+iYO0aW4dewqbbMhTZ235AyRsbYUiwjM1en5MGJsMS9s66/+vnNpFUoapzB/e2hgNmySXDmcDqWwlEXIEqJtfbvqnOc6dnF' +
    'yL/G4fmVO0mW1J5VWHqRSjF63JA2RsnSUCw7dKbg97h4nL+9qa2z8vnMnU83mc3a88lcXNujQ2nocziDy2IdKGm42fPPakGX4K6G' +
    'gIKBqu+WPEWbzHgkOH6FTjZ73pM3QMfZRzyAy8/I8bFKU7SlXlhkyPCCUjktYoCe3Ko0YduRQHHidixrxIYrHUl4lt+8OTCb2mwu' +
    'KykvbtGSPD+fymokQ5vOhzl345ZUctzZRUagyYVu3Lc9OqfGdjQ1sO1bJSIhLSlg1qUyluZ1OXfdfCVPwa01FictUMrANjGV2F4Y' +
    'GRofYtCWO0Ghx3tTdbzxwF1y3KaOvei7NjNjZjFM4rYxI2rUu0I0qupbKCIqIxJY3aFEx9dTMXjbgCQ8r788IiEaUcW7OTGL1XAo' +
    'Ix0hZNSZOlK66MO2xc7S2JuD2ad+p6Z1KCEtKR9W3604JC2Gl0VGruVbLh0iJS1u2KZ86Kc3LHXbfyYuls9PJxopXdGxNjWY455x' +
    'cXV5pOeTOV7I68+7o4iKtZ+G1plLU0YzJiQnISNZ17A8IiVEcn+D0+dKKx8kQXqtz6Kf4m0rKXPdeyUlctJkLC1untugNTCU6NfC' +
    'v8PG3v+QOlGSoINgSDY8ZF6CxIY4KCEkJCYnJBxZ0q4zGh8zdrnI1a84JCckTrLRuG55p0okJmrRdCofTZpaJTygyrlwKSuCzrae' +
    'kZCMrtGINi87OS8oKiMgNi1XelUwISMoIiUhKiE/g20wJyQwWoSShVwlICMdMnV6Zi4+WykgJEmGSCUfLlQ4HSdle2Q3ICZQdEgn' +
    'IC0rTXJZLyYkIB8gJCEjJh0pLicmHyYoIiUgKyggLCQpIx4fIyclJCIeJB4iHiYlJRchJBcmISUsGCAhGSUZIRkgJh0UICEeJhEW' +
    'EhwPEiYdJqBfqeQ=', 'base64'));

module.exports = {
    cameraText: card(75, 20, 443, 37, (rect) => {
        cameraText.forEach((v, i) => rect(i % 75, Math.floor(i / 75), 1, 1, [v, v, v]));
    }),
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
