'use strict';

const {execFileSync} = require('child_process');
const path = require('path');
const {recognizeBaiduTrafficLight} = require('./baidu_traffic_light.js');

// ImageMagick 只用于 Mac/PC 的截图回放，像素识别模块不依赖它。
try {
    const names = process.argv.slice(2);
    if (!names.length) throw new Error('用法：node recognize_baidu_traffic_light.js 截图.jpg [截图.png ...]');
    for (const name of names) {
        const file = path.resolve(name) + '[0]';
        const [width, height] = execFileSync('magick', [file, '-format', '%w %h', 'info:'],
            {encoding: 'utf8', timeout: 10000}).split(' ').map(Number);
        if (!width || !height || width * height > 3840 * 2160) throw new Error('截图尺寸无效或超过 830 万像素');
        const rgb = execFileSync('magick', [file, '-alpha', 'off', '-colorspace', 'sRGB', '-depth', '8', 'rgb:-'],
            {maxBuffer: width * height * 3 + 4096, timeout: 10000});
        console.log(JSON.stringify({file: name, trafficLight: recognizeBaiduTrafficLight(rgb, width, height)}));
    }
} catch (error) {
    console.error(error.code === 'ENOENT' ? '截图回放需要安装 ImageMagick（magick）。' : error.message);
    process.exitCode = 1;
}
