const { randomUUID } = require('node:crypto');

const DEFAULT_SPEAKER = 'S_RCbi2PGQ1';
const RESOURCE_ID = 'seed-icl-2.0';
const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

function readVolcengineConfig(config = {}) {
  const settings = config.cloud?.volcengine_tts || {};
  const speaker = String(settings.voice_type || '').trim();
  return {
    apiKey: String(settings.api_key || '').trim(),
    voiceType: speaker.startsWith('S_') ? speaker : DEFAULT_SPEAKER,
    resourceId: RESOURCE_ID,
    endpoint: ENDPOINT
  };
}

function volcengineHeaders(apiKey) {
  if (!apiKey) throw new Error('请先填写字节 TTS API Key');
  return {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Connect-Id': randomUUID()
  };
}

module.exports = { DEFAULT_SPEAKER, RESOURCE_ID, ENDPOINT, readVolcengineConfig, volcengineHeaders };
