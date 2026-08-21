'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    FacialRegion,
    SemanticAction,
    Live2DSemanticAdapter,
    semanticActionsOverlap
} = require('../js/avatar/live2d/expression/semantic-actions.js');
const {
    EmotionKind,
    buildNativeExpressionUnits,
    buildExpressionRuntime,
    defaultSemanticUnits,
    emotionKindFromTag,
    loadExpressionProfile
} = require('../js/avatar/live2d/expression/expression-units.js');
const {
    ExpressionHistory,
    ExpressionSolver
} = require('../js/avatar/live2d/expression/expression-solver.js');
const { AuDriver } = require('../js/avatar/live2d/expression/au-driver.js');
const { eventBus } = require('../js/core/event-bus.js');
const { Events } = require('../js/core/events.js');

const DRIVER_PARAMETER_IDS = [
    'ParamBrowLY',
    'ParamBrowRY',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamMouthForm',
    'ParamMouthOpenY',
    'ParamMouthFunnel',
    'ParamMouthPressLipOpen',
    'ParamMouthShrug',
    'ParamMouthX',
    'ParamMouthPuckerWiden',
    'ParamJawOpen',
    'ParamCheeckPuff',
    'ParamTongueOut',
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamBodyAngleX',
    'ParamBodyAngleY',
    'ParamBodyAngleZ'
];

function makeSolver(units) {
    return new ExpressionSolver(units, [], {
        random: () => 0.5,
        typicalityFloor: 0.3
    });
}

function createDriverFixture(expressionSolver = {}) {
    const ids = [...DRIVER_PARAMETER_IDS];
    const values = ids.map(id => (
        id === 'ParamEyeLOpen' || id === 'ParamEyeROpen' ? 1 : 0
    ));
    const coreModel = {
        getParameterCount: () => ids.length,
        getParameterId: index => ids[index],
        getParameterMinimumValue: index => {
            if (ids[index].includes('Angle')) return -30;
            if (ids[index].includes('Eye') && ids[index].includes('Open')) return 0;
            return -1;
        },
        getParameterMaximumValue: index => ids[index].includes('Angle') ? 30 : 1,
        getParameterDefaultValue: index => (
            ids[index].includes('Eye') && ids[index].includes('Open') ? 1 : 0
        ),
        getParameterValueByIndex: index => values[index],
        setParameterValueByIndex: (index, value) => {
            values[index] = value;
        }
    };
    const model = {
        internalModel: {
            coreModel,
            settings: { url: '2D/test/test.model3.json' }
        }
    };
    const driver = new AuDriver(model, {
        expression_solver: {
            enabled: true,
            randomness: 0,
            transition_ms: 0,
            neutral_ms: 0,
            min_hold_ms: 0,
            ...expressionSolver
        }
    });
    driver.setEmotionEngine({
        getModelAssetRoot: () => null,
        motionConfig: {},
        expressionConfig: {},
        playNativeExpressionFile: () => true,
        playNativeMotionFile: () => true,
        clearNativeExpressions: () => true,
        stopNativeMotions: () => true
    });
    return { driver, coreModel };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function testDefaultRecipes() {
    const joy = makeSolver(defaultSemanticUnits()).solve({
        emotion: EmotionKind.JOY,
        randomness: 0,
        maxUnits: 5
    });
    assert.ok(
        joy.semanticTargets.some(item => item.action === SemanticAction.MOUTH_SMILE),
        'joy should include a mouth smile'
    );

    assert.strictEqual(
        emotionKindFromTag('俏皮'),
        EmotionKind.PLAYFUL,
        'the playful tag should resolve to the playful recipe'
    );
    const playful = makeSolver(defaultSemanticUnits()).solve({
        emotion: EmotionKind.PLAYFUL,
        randomness: 0,
        maxUnits: 5
    });
    assert.ok(
        playful.units.some(unit => unit.id === 'wink 左眼' || unit.id === 'wink 右眼'),
        'playful should include a one-eye wink'
    );

    const surprise = makeSolver(defaultSemanticUnits()).solve({
        emotion: EmotionKind.SURPRISE,
        randomness: 0,
        maxUnits: 5
    });
    assert.ok(
        surprise.semanticTargets.some(
            item => item.action === SemanticAction.BODY_ANGLE_Y && item.value < 0
        ),
        'surprise should include a lean-back body target'
    );
}

function testConflictsAndHistory() {
    assert.strictEqual(
        semanticActionsOverlap(SemanticAction.EYE_OPEN, SemanticAction.EYE_OPEN_LEFT),
        true,
        'global and left eye-open actions must conflict'
    );

    const history = new ExpressionHistory(5);
    const signature = { unitIds: new Set(['a', 'b']), emotion: EmotionKind.JOY };
    history.record(signature);
    assert.ok(
        history.penalty(signature, 1) > 0.5,
        'recently repeated AU combinations should be penalized'
    );
}

function testNativeUnits() {
    const units = buildNativeExpressionUnits(
        { 开心: ['wave.motion3.json'] },
        { 开心: ['smile.exp3.json'], 害羞: ['smile.exp3.json'] }
    );
    assert.strictEqual(units.length, 2, 'duplicate native expression files should merge');
    const smile = units.find(unit => unit.nativeRef === 'smile.exp3.json');
    const motion = units.find(unit => unit.nativeRef === 'wave.motion3.json');
    assert.strictEqual(smile.emotions[EmotionKind.JOY], 0.85);
    assert.strictEqual(smile.emotions[EmotionKind.SHY], 0.85);
    assert.ok(motion.regions.includes(FacialRegion.HEAD));
    assert.ok(motion.regions.includes(FacialRegion.BODY));
}

function testPlatformMapping() {
    const ids = [
        'ParamMouthForm',
        'ParamEyeLOpen',
        'ParamEyeROpen',
        'ParamBodyAngleY'
    ];
    const coreModel = {
        getParameterCount: () => ids.length,
        getParameterId: index => ids[index],
        getParameterMinimumValue: index => ids[index].includes('Angle')
            ? -30
            : index === 0
                ? -1
                : 0,
        getParameterMaximumValue: index => ids[index].includes('Angle') ? 30 : 1,
        getParameterDefaultValue: index => (
            index === 0 || ids[index].includes('Angle') ? 0 : 1
        )
    };
    const adapter = new Live2DSemanticAdapter(null, coreModel);
    assert.strictEqual(
        adapter.toPlatformTargets(SemanticAction.MOUTH_SMILE, 0.5).length,
        1
    );
    assert.strictEqual(
        adapter.toPlatformTargets(SemanticAction.EYE_OPEN, 0.8).length,
        2
    );
    const bodyTargets = adapter.toPlatformTargets(SemanticAction.BODY_ANGLE_Y, 0.5);
    assert.strictEqual(bodyTargets[0].id, 'ParamBodyAngleY');
    assert.strictEqual(bodyTargets[0].value, 15);
}

function testProfileMissingUsesMemoryDefaults() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-profile-'));
    try {
        const result = loadExpressionProfile(tempDir, { info() {}, warn() {} });
        const profilePath = path.join(tempDir, 'expression_profile.json');
        assert.strictEqual(result.seeded, false);
        assert.strictEqual(result.path, profilePath);
        assert.strictEqual(
            fs.existsSync(profilePath),
            false,
            'loading a missing AU profile must not write into the model directory'
        );
        assert.ok(result.profile.units && Object.keys(result.profile.units).length > 0);

        const runtime = buildExpressionRuntime({
            modelDir: tempDir,
            motionConfig: {},
            expressionConfig: {},
            logger: { info() {}, warn() {} }
        });
        assert.strictEqual(runtime.seeded, false, 'the saved profile should be reused');
        assert.ok(runtime.units.length > 0);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function testExistingProfileIsReadWithoutMutation() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-profile-existing-'));
    const profilePath = path.join(tempDir, 'expression_profile.json');
    try {
        const profile = {
            version: 1,
            units: {
                joy: {
                    targets: [{ action: 'mouth_smile', minValue: 0.2, maxValue: 0.9 }]
                }
            },
            bindings: {},
            rules: []
        };
        fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
        const before = fs.readFileSync(profilePath, 'utf8');
        const result = loadExpressionProfile(tempDir, { info() {}, warn() {} });
        assert.strictEqual(result.seeded, false);
        assert.strictEqual(result.path, profilePath);
        assert.deepStrictEqual(result.profile.units.joy.targets, profile.units.joy.targets);
        assert.strictEqual(
            fs.readFileSync(profilePath, 'utf8'),
            before,
            'loading an existing AU profile must not rewrite the sidecar'
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function testTtsReleaseLifecycle() {
    const { driver, coreModel } = createDriverFixture();
    try {
        assert.strictEqual(driver.playEmotion('开心'), true);
        driver.applyFrame(coreModel, performance.now() + 1);
        assert.ok(driver.states.size > 0, 'AU parameters should remain active during TTS');
        eventBus.emit(Events.TTS_END);
        driver.applyFrame(coreModel, performance.now() + 2);
        assert.strictEqual(driver.states.size, 0, 'TTS end should release AU parameters');
    } finally {
        driver.destroy();
    }
}

async function testMinimumHoldLifecycle() {
    const { driver, coreModel } = createDriverFixture({
        min_hold_ms: 35,
        neutral_ms: 0
    });
    try {
        assert.strictEqual(driver.playEmotion('惊讶'), true);
        driver.applyFrame(coreModel, performance.now() + 1);
        eventBus.emit(Events.TTS_INTERRUPTED);
        assert.ok(driver.states.size > 0, 'interrupt should respect the minimum hold');
        await delay(50);
        driver.applyFrame(coreModel, performance.now() + 1);
        assert.strictEqual(driver.states.size, 0, 'AU parameters should release after hold');
    } finally {
        driver.destroy();
    }
}

async function main() {
    testDefaultRecipes();
    testConflictsAndHistory();
    testNativeUnits();
    testPlatformMapping();
    testProfileMissingUsesMemoryDefaults();
    testExistingProfileIsReadWithoutMutation();
    testTtsReleaseLifecycle();
    await testMinimumHoldLifecycle();
    console.log('AU expression solver tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
