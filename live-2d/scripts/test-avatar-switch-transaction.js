'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AvatarSwitchTransaction } = require('../js/avatar/avatar-switch-transaction.js');
const {
    PROFILE_FILE_NAME,
    loadExpressionProfile
} = require('../js/avatar/live2d/expression/expression-units.js');

function createHarness(options = {}) {
    const config = {
        ui: {
            model_type: options.initialType || 'live2d',
            unrelated: 'keep'
        }
    };
    const events = [];
    const rendererResults = [...(options.rendererResults || [])];
    const scheduled = [];
    const published = [];
    const manager = new AvatarSwitchTransaction({
        readyTimeoutMs: options.readyTimeoutMs || 30000,
        readModelType() {
            events.push('read');
            return config.ui.model_type;
        },
        updateModelType(type) {
            events.push(`write:${type}`);
            if (options.failWrites?.includes(type)) throw new Error(`write ${type} failed`);
            config.ui.model_type = type;
        },
        hasAvatarModel(type) {
            events.push(`model:${type}`);
            return !(options.missingModels || []).includes(type);
        },
        async requestRendererSwitch(type) {
            events.push(`renderer:${type}`);
            if (options.rendererError) throw new Error(options.rendererError);
            if (options.rendererPromise) return options.rendererPromise;
            return rendererResults.shift() || {
                success: true,
                phase: 'ready',
                activeType: type
            };
        },
        publishModelType(type) {
            events.push(`publish:${type}`);
            published.push(type);
        },
        scheduleReload(payload) {
            events.push(`reload:${payload.expectedType}`);
            if (options.reloadError) throw new Error(options.reloadError);
            scheduled.push(payload);
        },
        log() {}
    });
    return { config, events, manager, published, scheduled };
}

const context = { windowId: 7 };

(async () => {
    {
        const harness = createHarness();
        const result = await harness.manager.switchType('invalid', context);
        assert.equal(result.success, false);
        assert.equal(harness.events.length, 0);
    }

    {
        const harness = createHarness({ missingModels: ['vrm'] });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.success, false);
        assert.deepEqual(harness.events, ['model:vrm']);
    }

    {
        const harness = createHarness();
        const result = await harness.manager.switchType('live2d', context);
        assert.equal(result.phase, 'ready');
        assert.deepEqual(harness.events, ['model:live2d', 'read']);
    }

    {
        const harness = createHarness();
        const result = await harness.manager.switchType('pngtuber', context);
        assert.equal(result.success, true);
        assert.equal(result.phase, 'ready');
        assert.equal(harness.config.ui.model_type, 'pngtuber');
        assert.equal(harness.config.ui.unrelated, 'keep');
        assert.deepEqual(harness.events, [
            'model:pngtuber',
            'read',
            'write:pngtuber',
            'renderer:pngtuber',
            'publish:pngtuber'
        ]);
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: true,
                phase: 'reload-required',
                reloadRequired: true,
                activeType: 'live2d'
            }]
        });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.phase, 'reload-scheduled');
        assert.equal(harness.config.ui.model_type, 'vrm');
        assert.equal(harness.manager.hasPendingReload(context.windowId), true);
        assert.equal(harness.scheduled[0].expectedType, 'vrm');

        const ready = await harness.manager.handleRuntimeReady({
            windowId: context.windowId,
            success: true,
            activeType: 'vrm'
        });
        assert.equal(ready.phase, 'ready');
        assert.equal(harness.manager.hasPendingReload(context.windowId), false);
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: false,
                restored: true,
                activeType: 'live2d',
                message: 'init failed'
            }]
        });
        const result = await harness.manager.switchType('mmd', context);
        assert.equal(result.phase, 'rolled-back');
        assert.equal(harness.config.ui.model_type, 'live2d');
        assert.equal(harness.scheduled.length, 0);
        assert.deepEqual(harness.published, ['live2d']);
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: false,
                restored: false,
                reloadRequired: true,
                message: 'restore failed'
            }]
        });
        const result = await harness.manager.switchType('mmd', context);
        assert.equal(result.phase, 'reload-scheduled');
        assert.equal(harness.config.ui.model_type, 'live2d');
        assert.equal(harness.scheduled[0].expectedType, 'live2d');

        const ready = await harness.manager.handleRuntimeReady({
            windowId: context.windowId,
            success: true,
            activeType: 'live2d'
        });
        assert.equal(ready.phase, 'ready');
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: false,
                restored: false,
                timedOut: true,
                message: 'timeout'
            }]
        });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.phase, 'reload-scheduled');
        assert.equal(harness.config.ui.model_type, 'live2d');
        assert.equal(harness.scheduled[0].expectedType, 'live2d');
    }

    {
        const harness = createHarness({ failWrites: ['vrm'] });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.success, false);
        assert.equal(harness.events.includes('renderer:vrm'), false);
        assert.equal(harness.config.ui.model_type, 'live2d');
    }

    {
        const harness = createHarness({ rendererError: 'send failed' });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.phase, 'rolled-back');
        assert.equal(harness.config.ui.model_type, 'live2d');
        assert.equal(harness.scheduled.length, 0);
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: true,
                reloadRequired: true,
                activeType: 'live2d'
            }],
            reloadError: 'reload unavailable'
        });
        const result = await harness.manager.switchType('vrm', context);
        assert.equal(result.phase, 'rolled-back');
        assert.equal(harness.config.ui.model_type, 'live2d');
    }

    {
        const harness = createHarness({
            rendererResults: [{
                success: true,
                reloadRequired: true,
                activeType: 'live2d'
            }]
        });
        await harness.manager.switchType('vrm', context);
        const mismatch = await harness.manager.handleRuntimeReady({
            windowId: context.windowId,
            success: true,
            activeType: 'mmd'
        });
        assert.equal(mismatch.phase, 'rollback-reload-scheduled');
        assert.equal(harness.config.ui.model_type, 'live2d');
        assert.equal(harness.scheduled.length, 2);
        assert.equal(harness.scheduled[1].expectedType, 'live2d');

        const secondFailure = await harness.manager.handleRuntimeReady({
            windowId: context.windowId,
            success: false,
            activeType: null,
            message: 'rollback boot failed'
        });
        assert.equal(secondFailure.phase, 'failed');
        assert.equal(harness.manager.hasPendingReload(context.windowId), false);
    }

    {
        let resolveRenderer;
        const rendererPromise = new Promise(resolve => {
            resolveRenderer = resolve;
        });
        const harness = createHarness({ rendererPromise });
        const first = harness.manager.switchType('vrm', context);
        const second = await harness.manager.switchType('mmd', context);
        assert.equal(second.phase, 'busy');
        resolveRenderer({ success: true, activeType: 'vrm' });
        assert.equal((await first).phase, 'ready');
    }

    {
        const facadeSource = fs.readFileSync(
            path.resolve(__dirname, '..', 'js/avatar/avatar-facade.js'),
            'utf8'
        );
        assert.equal(
            facadeSource.includes('window.location.reload'),
            false,
            'renderer facade must not reload the window directly'
        );
        assert.equal(
            facadeSource.includes("ipcRenderer.invoke('avatar-runtime-ready'"),
            true,
            'renderer facade must report runtime readiness'
        );
        assert.equal(
            facadeSource.includes("phase: 'reload-required'"),
            true,
            'renderer facade must distinguish reload-required from ready'
        );
    }

    {
        const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-expression-profile-'));
        try {
            const loaded = loadExpressionProfile(modelDir, { info() {}, warn() {} });
            assert.equal(loaded.seeded, false);
            assert.equal(
                fs.existsSync(path.join(modelDir, PROFILE_FILE_NAME)),
                false,
                'startup must not write a generated expression profile into the model directory'
            );
        } finally {
            fs.rmSync(modelDir, { recursive: true, force: true });
        }
    }

    console.log('avatar switch transaction tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
