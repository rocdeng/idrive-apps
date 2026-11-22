'use strict';

const IFACE = 'de.bmw.infotainment.navigation.guiding.GuidanceEventList';
const INSTANCE = 'Main_Instance', VIEW = 'HUD.RB.Main';
const INCLUDE_LANES = 'INCLUDE_LANE_GUIDINGS';
const FALLBACK_CONFIG = { viewport: { startPoint: { anchorPoint: { standardReferencePoint: 'CCP' }, offsets: [] },
    maxElementCount: 6, endPoints: [], includedTypes: ['INCLUDE_DESTINATIONS', 'INCLUDE_ACTIVE_MANEUVERS', INCLUDE_LANES] },
    options: ['ENABLE_PRIORITIZED_VIEW'], minimumUpdateIntervalMs: 500, segmentItemRasterLength: 0 };

function within(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('navigation query timed out')), ms);
        promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}

/* 只读查询原厂 HUD 使用的导航视图；不注册、修改视图或读取手机画面。 */
class GuidanceReader {
    constructor(builders, options) {
        this.builders = builders;
        this.timeout = (options || {}).timeoutMs || 3000;
        this.proxy = null;
        this.config = null;
        this.generation = 0;
    }

    call(proxy, method, params) {
        return within(Promise.resolve().then(() => {
            const raw = proxy._someIpProxy;
            if (raw && typeof raw.callMethod === 'function') return raw.callMethod(method, params, this.timeout);
            if (typeof proxy[method] === 'function') return proxy[method](params);
            throw new Error('navigation method unavailable');
        }), this.timeout);
    }

    read() {
        const generation = this.generation;
        const current = () => {
            if (generation !== this.generation) throw new Error('navigation reader stopped');
        };
        return Promise.resolve().then(() => {
            if (this.proxy) return this.proxy;
            return within(Promise.resolve().then(() => this.builders.buildTypedProxy(IFACE, INSTANCE))
                .then((proxy) => {
                    if (generation !== this.generation) {
                        if (proxy.shutdown) proxy.shutdown();
                        current();
                    }
                    this.proxy = proxy;
                    return Promise.resolve(proxy.init()).then(() => proxy);
                }), this.timeout);
        }).then((proxy) => {
            current();
            return within(Promise.resolve().then(() => proxy.waitUntilAvailable(this.timeout)), this.timeout).then(() => proxy);
        }).then((proxy) => {
            current();
            const config = this.config ? Promise.resolve(this.config) : this.call(proxy, 'getViewConfig', { viewId: VIEW })
                .then((reply) => reply && reply.viewConfig && reply.GenericListError !== 'UNKNOWN_VIEW_ID' ? reply.viewConfig : FALLBACK_CONFIG,
                    () => FALLBACK_CONFIG);
            return config.then((value) => {
                current();
                if (!this.config) {
                    const viewport = value.viewport || FALLBACK_CONFIG.viewport;
                    const types = viewport.includedTypes || FALLBACK_CONFIG.viewport.includedTypes;
                    const hasLanes = types.some((type) => type === INCLUDE_LANES || type === 0 || (type && type.name === INCLUDE_LANES));
                    this.config = Object.assign({}, value, { viewport: Object.assign({}, viewport, {
                        includedTypes: hasLanes ? types : types.concat(INCLUDE_LANES)
                    }) });
                }
                return this.call(proxy, 'queryContent', { viewConfigs: [this.config] });
            });
        }).then((reply) => { current(); return reply; });
    }

    stop() {
        this.generation++;
        const proxy = this.proxy;
        this.proxy = null;
        this.config = null;
        try { if (proxy && proxy.shutdown) proxy.shutdown(); } catch (error) { /* 代理可能已随服务断开。 */ }
    }
}

module.exports = { GuidanceReader, IFACE, INSTANCE, VIEW };
