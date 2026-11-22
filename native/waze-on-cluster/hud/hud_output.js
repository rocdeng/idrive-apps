'use strict';
var ClusterRender = require('./hud_cluster_render_client.js').ClusterRender;

// 沿用 Waze on Cluster 的 HUD target，身份、场景与弹窗让位由现有 renderer 管理。
function HudOutput(socket, keepShown, onState, log) {
    this.client = new ClusterRender('robertn_waze_cluster_simple', socket);
    this.layer = null; this.frame = null; this.visible = false;
    this.keepShown = keepShown === true;
    this.onState = onState || function() {};
    this.log = log || {
        info: function(m) { console.log(m); },
        warn: function(m) { console.error(m); }
    };
    this.layerState = null;
    this.lastSocketErr = null;
    this.lastReason = 'connecting to cluster-render';
    var self = this;
    this.client.on('socket_error', function(err) {
        var detail = err ? (err.code || err.message || String(err)) : 'socket error';
        self.layerState = null;
        self.lastReason = 'render.sock: ' + detail;
        if (detail !== self.lastSocketErr) {
            self.lastSocketErr = detail;
            self.log.warn('cluster-render socket error (' + self.client.path + '): ' + detail);
        }
        self.report();
    });
    this.client.on('ready', function() {
        self.layerState = null;
        self.lastSocketErr = null;
        self.lastReason = 'waiting for hud layer';
        self.log.info('cluster-render ready: backend=' + self.client.backend + ' targets=' + self.client.targets);
        var targets = String(self.client.targets || '').split(',');
        if (self.client.backend !== 'id7' || targets.indexOf('hud:800x480') < 0) {
            self.lastReason = 'unsupported backend/targets: ' + self.client.backend + ' / ' + self.client.targets;
            self.log.warn('HUD 简洁模式只支持 iDrive 7 的 800×480 HUD；已关闭输出 (' + self.lastReason + ')');
            self.close(); return;
        }
        // 先通过 hello 核对尺寸，再创建图层，避免把 ID7 布局发给 ID8。
        if (!self.layer) {
            self.layer = self.client.image({ target: 'hud', klass: 'content', z: 1,
                x: 0, y: 0, w: 800, h: 480, iw: 800, ih: 480, fps: 2,
                visible: false, exclusive: false, contend: true, yield: !self.keepShown });
            self.log.info('created hud image layer ref=' + self.layer + ' yield=' + (!self.keepShown));
        }
        self.flush();
    });
    this.client.on('layer', function(ref, state, reason) {
        if (ref !== self.layer || self.client.closed) return;
        self.layerState = state;
        self.lastReason = state === 'shown' ? '' : ('layer ' + state + (reason ? ': ' + reason : ''));
        self.log.info('HUD 图层：' + state + (reason ? ' / ' + reason : ''));
        self.report();
    });
    this.client.on('disconnected', function() {
        self.layerState = null;
        self.lastReason = 'cluster-render disconnected';
        self.log.warn('cluster-render disconnected');
        self.report();
    });
    this.client.on('refused', function(op, ref, reason) {
        self.layerState = null;
        self.lastReason = 'refused ' + op + ': ' + reason;
        self.log.warn('HUD 拒绝：' + op + ' ref=' + ref + ' / ' + reason);
        self.report();
    });
    this.log.info('connecting to cluster-render: ' + this.client.path);
    this.client.connect();
}
HudOutput.prototype.update = function(pixels, visible) {
    if (!visible) {
        if (!this.visible) return;
        this.visible = false;
        this.frame = null;
        this.layerState = null;
        // set() 缓存可见性，断连期间隐藏也能在重连时生效。
        if (this.layer) this.client.set(this.layer, { visible: false });
    } else {
        this.frame = Buffer.from(pixels);
        this.visible = true;
        this.flush();
    }
    this.report();
};
HudOutput.prototype.report = function() {
    var showing = this.visible && this.client.ready && !this.client.closed && this.layerState === 'shown';
    this.onState(showing ? 'showing' : 'unavailable', showing ? '' : this.lastReason);
};
HudOutput.prototype.setKeepShown = function(keepShown) {
    this.keepShown = keepShown;
    if (this.layer) this.client.set(this.layer, { yield: !keepShown });
};
HudOutput.prototype.flush = function() {
    if (!this.layer || !this.client.ready) return;
    if (this.frame && this.visible) this.client.pixels(this.layer, null, this.frame);
    this.client.set(this.layer, { visible: this.visible });
};
HudOutput.prototype.close = function() {
    this.visible = false;
    this.client.close();
    this.report();
};
module.exports = HudOutput;
