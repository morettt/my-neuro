'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isReasoningEnabled,
    applyReasoningToRequestBody
} = require('./reasoning-request.js');

describe('isReasoningEnabled', () => {
    it('treats missing fields as disabled', () => {
        assert.equal(isReasoningEnabled({}), false);
        assert.equal(isReasoningEnabled(null), false);
        assert.equal(isReasoningEnabled(undefined), false);
    });

    it('only treats explicit true as enabled', () => {
        assert.equal(isReasoningEnabled({ reasoning_enabled: true }), true);
        assert.equal(isReasoningEnabled({ reasoningEnabled: true }), true);
        assert.equal(isReasoningEnabled({ reasoning_enabled: false }), false);
        assert.equal(isReasoningEnabled({ reasoning_effort: 'max' }), false);
    });
});

describe('applyReasoningToRequestBody', () => {
    it('sends thinking disabled and drops effort when fields are missing', () => {
        const body = applyReasoningToRequestBody({}, {});
        assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.equal(Object.prototype.hasOwnProperty.call(body, 'reasoning_effort'), false);
    });

    it('sends enabled thinking and effort when both are set', () => {
        const body = applyReasoningToRequestBody({}, {
            reasoning_enabled: true,
            reasoning_effort: 'max'
        });
        assert.deepEqual(body.thinking, { type: 'enabled' });
        assert.equal(body.reasoning_effort, 'max');
    });

    it('does not send reasoning_effort when disabled even if effort remains', () => {
        const body = applyReasoningToRequestBody(
            { reasoning_effort: 'max' },
            { reasoning_enabled: false, reasoning_effort: 'max' }
        );
        assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.equal(Object.prototype.hasOwnProperty.call(body, 'reasoning_effort'), false);
    });

    it('sends enabled thinking without effort when effort is empty', () => {
        const body = applyReasoningToRequestBody(
            { reasoning_effort: 'stale' },
            { reasoning_enabled: true }
        );
        assert.deepEqual(body.thinking, { type: 'enabled' });
        assert.equal(Object.prototype.hasOwnProperty.call(body, 'reasoning_effort'), false);
    });

    it('reads camelCase fields from LLMClient-style objects', () => {
        const body = applyReasoningToRequestBody({}, {
            reasoningEnabled: true,
            reasoningEffort: 'high'
        });
        assert.deepEqual(body.thinking, { type: 'enabled' });
        assert.equal(body.reasoning_effort, 'high');
    });
});
