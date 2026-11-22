/* 按需解包字形。车机端只需 Node 内置 zlib，不需要字体服务或图形库。 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('zlib'));
    else root.HudFont = factory(null);
}(this, function(zlib) {
    'use strict';
    function unpack4(buf, offset, count) {
        var out = new Uint8Array(count);
        for (var i = 0; i < count; i++) {
            var b = buf[offset + (i >> 1)];
            out[i] = ((i & 1) ? (b & 15) : (b >> 4)) * 17;
        }
        return out;
    }
    function decodeMeta(raw) {
        if (!Array.isArray(raw)) return raw;
        return { w: raw[0], h: raw[1], x: raw[2], y: raw[3], advance: raw[4], off: raw[5], s: raw[6] || 64 };
    }
    function Font(data) { this.data = data; this.cache = {}; this.blob = null; }
    Font.prototype._ensureBlob = function() {
        if (this.blob || !this.data.blob || !zlib) return;
        this.blob = zlib.inflateSync(Buffer.from(this.data.blob, 'base64'));
    };
    Font.prototype._decode = function(key) {
        var g = decodeMeta(this.data.glyphs[key]);
        if (this.blob) {
            var count = g.w * g.h;
            var pixels = this.data.bits === 4 ? unpack4(this.blob, g.off, count) :
                this.blob.subarray(g.off, g.off + count);
            return { w: g.w, h: g.h, x: g.x, y: g.y, advance: g.advance, s: g.s || 64, pixels: pixels };
        }
        if (g && g.data && zlib) {
            return Object.assign({}, g, { pixels: zlib.inflateSync(Buffer.from(g.data, 'base64')) });
        }
        return null;
    };
    Font.prototype.glyph = function(ch) {
        var key = this.data.glyphs[ch] ? ch : '□';
        if (!this.cache[key]) {
            this._ensureBlob();
            var decoded = this._decode(key);
            if (decoded) this.cache[key] = decoded;
        }
        return this.cache[key];
    };
    Font.prototype.prepare = function(strings) {
        if (zlib) return Promise.resolve();
        var self = this;
        if (this.data.blob) {
            var ready = this.blob ? Promise.resolve() : (function() {
                var encoded = Uint8Array.from(atob(self.data.blob), function(c) { return c.charCodeAt(0); });
                return new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()
                    .then(function(buf) { self.blob = new Uint8Array(buf); });
            }());
            return ready.then(function() {
                Array.from(new Set(Array.from(strings.join('') + '□…'))).forEach(function(ch) { self.glyph(ch); });
            });
        }
        var keys = new Set(Array.from(strings.join('') + '□…'));
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
