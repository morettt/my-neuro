// Runtime wrappers live in the plugin and leave prototypes intact.
// Instance methods are restored when the plugin/action is stopped.
const { stripMotionTags } = require('./protocol');
const BODY_OWNER = Symbol.for('feiniu.body-actions.owner');

class InstancePatches {
    constructor() { this.entries = []; }

    wrap(target, key, factory) {
        if (!target || typeof target[key] !== 'function') return;
        if (this.entries.some(entry => entry.target === target && entry.key === key)) return;
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        const original = target[key];
        const wrapped = factory(original);
        Object.defineProperty(target, key, { configurable: true, writable: true,
            enumerable: descriptor?.enumerable ?? false, value: wrapped });
        this.entries.push({ target, key, descriptor, wrapped });
    }

    restore() {
        for (const { target, key, descriptor, wrapped } of this.entries.reverse()) {
            if (target[key] !== wrapped) continue; // Respect another plugin's later wrapper.
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
        this.entries = [];
    }
}

function getBodyPlayer(adapter) { return adapter?.[BODY_OWNER] || null; }

function attachBodyPlayer(adapter, player) {
    if (getBodyPlayer(adapter) && getBodyPlayer(adapter) !== player) throw new Error('身体动作插件仍在播放');
    const patches = new InstancePatches();
    let updating = false, restorePending = false;
    const restore = () => {
        patches.restore();
        if (getBodyPlayer(adapter) === player) delete adapter[BODY_OWNER];
    };
    adapter[BODY_OWNER] = player;
    patches.wrap(adapter, 'update', original => function (delta) {
        if (!player.active) return original.call(this, delta);
        updating = true;
        try {
            player.update(delta);
            return original.call(this, delta);
        } finally {
            updating = false;
            if (restorePending) restore();
        }
    });
    for (const key of ['_updateIdleAnimation', '_updateGazeTracking']) {
        patches.wrap(adapter, key, original => function (...args) {
            if (!player.active && !updating) return original.apply(this, args);
        });
    }
    patches.wrap(adapter, 'updateCameraOrbit', original => function (...args) {
        if (!player.active) return original.apply(this, args);
        return original.call(this, player.getCameraTarget());
    });
    patches.wrap(adapter, 'dispose', original => function (...args) {
        player.stop('model-disposed');
        return original.apply(this, args);
    });
    return {
        restore() {
            if (updating) restorePending = true;
            else restore();
        }
    };
}

class RuntimeHooks {
    constructor(plugin, runtime = global) {
        this.plugin = plugin;
        this.runtime = runtime;
        this.patches = new InstancePatches();
        this.clearPending();
    }

    clearPending() {
        this.buffer = '';
        this.pendingText = null;
        this.deferred = false;
    }

    beginRequest(active) {
        this.deferSpeech = active;
        this.clearPending();
        this.refresh();
    }

    setReply(text) { this.pendingText = text; }

    refresh() {
        const hooks = this, plugin = this.plugin, runtime = this.runtime;
        this.patches.wrap(runtime.uiController, 'showSubtitle', original => function (text, ...args) {
            return original.call(this, plugin.onDisplayText(text), ...args);
        });
        this.patches.wrap(runtime, 'showSubtitle', original => function (text, ...args) {
            return original.call(this, plugin.onDisplayText(text), ...args);
        });
        const tts = runtime.ttsProcessor || runtime.voiceChat?.ttsProcessor;
        const model = plugin.adapter?.();
        this.patches.wrap(model, 'update', original => function (...args) {
            const result = original.apply(this, args);
            if (!plugin.stopped && !getBodyPlayer(this)) plugin.updateIdle?.(this, args[0]);
            return result;
        });
        this.patches.wrap(tts, 'reset', original => function (...args) {
            hooks.clearPending();
            return original.apply(this, args);
        });
        this.patches.wrap(tts, 'addStreamingText', original => function (text, ...args) {
            if (!plugin.stopped && hooks.deferSpeech) {
                hooks.deferred = true;
                hooks.buffer += String(text || '');
                return;
            }
            return original.call(this, text, ...args);
        });
        this.patches.wrap(tts, 'processTextToSpeech', original => function (text, ...args) {
            const active = !plugin.stopped && (hooks.deferSpeech || plugin.adapter());
            const cleaned = active ? stripMotionTags(text).trim() : text;
            hooks.clearPending();
            return original.call(this, cleaned, ...args);
        });
        this.patches.wrap(tts, 'finalizeStreamingText', original => function (...args) {
            if (!plugin.stopped && hooks.deferred) {
                const text = stripMotionTags(hooks.pendingText ?? hooks.buffer).trim();
                hooks.clearPending();
                return this.processTextToSpeech(text);
            }
            return original.apply(this, args);
        });
    }

    dispose() {
        this.clearPending();
        this.deferSpeech = false;
        this.patches.restore();
    }
}

module.exports = { RuntimeHooks, InstancePatches, attachBodyPlayer, getBodyPlayer };
