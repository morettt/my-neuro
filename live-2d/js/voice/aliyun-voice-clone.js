const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 10 * 1024 * 1024;
const MODELS = new Set(['cosyvoice-v3-flash', 'cosyvoice-v3-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3.5-plus', 'cosyvoice-v2']);

function enrollmentUrl(workspaceId = '') {
  const workspace = workspaceId.trim();
  if (workspace && !/^[a-zA-Z0-9-]+$/.test(workspace)) throw new Error('业务空间 ID 格式无效');
  const host = workspace ? `${workspace}.cn-beijing.maas.aliyuncs.com` : 'dashscope.aliyuncs.com';
  return `https://${host}/api/v1/services/audio/tts/customization`;
}

function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写有效的公网音频 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('音频 URL 必须是 HTTP 或 HTTPS 地址');
  return url.href;
}

function audioReference(value) {
  if (typeof value === 'string' && value.startsWith('data:')) {
    const match = /^data:audio\/(wav|mpeg|mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw new Error('参考音频格式无效');
    const audio = Buffer.from(match[2], 'base64');
    if (!audio.length || audio.length > MAX_BYTES || audio.toString('base64') !== match[2]) {
      throw new Error('参考音频无效或超过 10 MB');
    }
    return value;
  }
  return publicUrl(value);
}

async function jsonRequest(fetcher, url, init) {
  const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60000) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务返回了无效响应（HTTP ${response.status}）`); }
  if (!response.ok || data.code || data.ok === false) {
    throw new Error(String(data.message || data.detail || data.error || data.code || `HTTP ${response.status}`).slice(0, 600));
  }
  return data;
}

async function uploadAudio(filePath, settings = {}, fetcher = fetch) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!['wav', 'mp3', 'm4a'].includes(extension)) throw new Error('仅支持 WAV、MP3、M4A 音频');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || !stat.size || stat.size > MAX_BYTES) throw new Error('请选择不超过 10 MB 的非空音频文件');
  const body = await fs.promises.readFile(filePath);
  if (!body.length || body.length > MAX_BYTES) throw new Error('请选择不超过 10 MB 的非空音频文件');
  const token = String(settings.upload_token || '').trim();
  if (!token) {
    const mime = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' }[extension];
    return { url: `data:${mime};base64,${body.toString('base64')}`,
      filename: path.basename(filePath), expires_at: Math.floor(Date.now() / 1000) + 86400 };
  }
  const url = new URL(settings.upload_url || 'https://mynewbot.com/api/voice-audio');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('上传地址必须使用 HTTPS');
  url.searchParams.set('format', extension);
  const data = await jsonRequest(fetcher, url.href, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body
  });
  return { url: publicUrl(data.url), filename: path.basename(filePath), expires_at: data.expires_at };
}

async function enrollVoice(options, fetcher = fetch) {
  const apiKey = String(options.api_key || '').trim();
  const model = String(options.model || '').trim();
  const prefix = String(options.prefix || '').trim();
  if (!apiKey) throw new Error('请先填写阿里云 API Key');
  if (!MODELS.has(model)) throw new Error('请选择支持复刻的 CosyVoice 模型');
  if (!/^[a-zA-Z0-9]{1,10}$/.test(prefix)) throw new Error('音色名称请使用 1～10 位英文字母或数字');
  const url = enrollmentUrl(options.workspace_id);
  const data = await jsonRequest(fetcher, url, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'voice-enrollment', input: {
      action: 'create_voice', target_model: model, prefix, audio: audioReference(options.audio_url)
    } })
  });
  if (!data.output?.voice_id) throw new Error('阿里云未返回音色 ID');
  return { voice_id: data.output.voice_id, model };
}

async function queryVoice(options, fetcher = fetch) {
  const apiKey = String(options.api_key || '').trim();
  if (!apiKey || !options.voice_id) throw new Error('请填写 API Key 和音色 ID');
  const data = await jsonRequest(fetcher, enrollmentUrl(options.workspace_id), {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'query_voice', voice_id: options.voice_id } })
  });
  if (!data.output?.status) throw new Error('阿里云未返回音色状态');
  return { status: data.output.status, model: data.output.target_model };
}

module.exports = { enrollmentUrl, uploadAudio, enrollVoice, queryVoice };
