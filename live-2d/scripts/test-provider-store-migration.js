'use strict';

// 旧三格 → llm_providers.json 迁移，第二次 load 必须稳定。
// 用法: node live-2d/scripts/test-provider-store-migration.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { persistProviderStore } = require('../js/core/llm-provider-store.js');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-mig-'));
    const configPath = path.join(dir, 'config.json');
    const storePath = path.join(dir, 'llm_providers.json');

    const config = {
        llm: {
            api_key: 'sk-mig',
            api_url: 'https://example.com/v1',
            model: 'mig-model'
        }
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    persistProviderStore(dir, configPath, config, { writeBack: false });
    assert.ok(fs.existsSync(storePath), '第一次 load 应写出 llm_providers.json');
    assert.ok(
        fs.existsSync(`${configPath}.pre-provider.bak`),
        '首次迁移必须备份 config.json.pre-provider.bak'
    );
    const backup = readJson(`${configPath}.pre-provider.bak`);
    assert.strictEqual(backup.llm.api_key, 'sk-mig');
    const diskAfterNoWriteBack = readJson(configPath);
    assert.strictEqual(
        diskAfterNoWriteBack.llm.api_key,
        'sk-mig',
        'writeBack:false 不得把清洗后的空三格写回 config.json'
    );

    const firstStore = readJson(storePath);
    assert.ok(Array.isArray(firstStore.providers));
    assert.ok(firstStore.providers.length >= 1, '应至少迁出 1 个 provider');
    const first = firstStore.providers[0];
    assert.strictEqual(first.api_url, 'https://example.com/v1');
    assert.strictEqual(first.api_key, 'sk-mig');
    assert.ok(
        (first.models || []).some((m) => m.model_id === 'mig-model'),
        '模型列表应含旧 model 名'
    );

    const afterFirst = readJson(configPath);
    persistProviderStore(dir, configPath, afterFirst);
    const secondStore = readJson(storePath);
    assert.strictEqual(
        secondStore.providers.length,
        firstStore.providers.length,
        '第二次 load 不应再造一批 provider'
    );
    assert.strictEqual(secondStore.providers[0].api_key, 'sk-mig');

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('provider-store migration: ok');
}

main();
