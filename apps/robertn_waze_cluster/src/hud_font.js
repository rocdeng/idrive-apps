/* 按需解压字形。车机端只需 Node 内置 zlib，不需要字体服务或图形库。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('zlib'));
    else root.HudFont = factory(null);
}(this, function(zlib) {
    'use strict';
    function Font(data) { this.data = data; this.cache = {}; }
    Font.prototype.glyph = function(ch) {
        var key = this.data.glyphs[ch] ? ch : '□';
        if (!this.cache[key] && zlib) {
            var g = this.data.glyphs[key];
            this.cache[key] = Object.assign({}, g, { pixels: zlib.inflateSync(Buffer.from(g.data, 'base64')) });
        }
        return this.cache[key];
    };
    Font.prototype.prepare = function(strings) {
        if (zlib) return Promise.resolve();
        var self = this, keys = new Set(Array.from(strings.join('') + '□…'));
        return Promise.all(Array.from(keys).map(function(ch) {
            var key = self.data.glyphs[ch] ? ch : '□', g = self.data.glyphs[key];
            if (self.cache[key]) return Promise.resolve();
            var encoded = Uint8Array.from(atob(g.data), function(c) { return c.charCodeAt(0); });
            return new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()
                .then(function(buf) { self.cache[key] = Object.assign({}, g, { pixels: new Uint8Array(buf) }); });
        }));
    };
    return Font;
}));
