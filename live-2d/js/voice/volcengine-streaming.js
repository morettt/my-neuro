// volcengine-streaming.js
// 字节TTS单session流式播放：整段LLM回复一个session，PCM实时调度到Web Audio API
// 字幕根据音频播放进度逐字显示，与音频自然同步

'use strict';

const { randomUUID } = require('crypto');
const WebSocket = require('ws');
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');
const {
    EventType, MsgType,
    receiveMessage, waitForEvent,
    startConnection, finishConnection,
    startSession, finishSession, taskRequest,
} = require('./volcengine-protocols.js');

// 未闭合标签检测（含单尖括号情绪标签 <开心>，最多持有15字符）
const INCOMPLETE_TAG = /(?:<<[^>]*|\[[^\]]*|【[^】]*|[（(][^）)]*|<[^\s<>]{0,15})\s*$/;

class VolcengineStreamingSession {
    constructor(config, { onMouthValue, onStartCallback, onEndCallback, onComplete, emotionMapper, expressionMapper }) {
        this.config          = config;
        this.onMouthValue    = onMouthValue;
        this.onStartCallback = onStartCallback;
        this.onEndCallback   = onEndCallback;
        this.onComplete      = onComplete;
        this.emotionMapper   = emotionMapper;
        this.expressionMapper = expressionMapper;

        const volcCfg = config.cloud?.volcengine_tts || {};
        this.appid       = volcCfg.appid || '';
        this.accessToken = volcCfg.access_token || '';
        this.voiceType   = volcCfg.voice_type || 'saturn_zh_female_keainvsheng_tob';
        this.endpoint    = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
        this.resourceId  = 'seed-tts-2.0';

        // WebSocket / session
        this.ws        = null;
        this.sessionId = null;
        this.baseReq   = null;

        // Web Audio
        this.audioContext     = null;
        this.analyser         = null;
        this.gainNode         = null;
        this.nextStartTime    = 0;
        this.audioStarted     = false;
        this._audioStartedAt  = 0;   // audioContext 时间轴上第一帧的起点
        this._animId          = null; // requestAnimationFrame 句柄（嘴形+字幕共用）

        // 字幕
        this.tagBuf           = '';  // 未冲出的 token（等待完整标签）
        this._subtitleAccum   = '';  // 已显示的字幕文本
        this._subtitleFull    = '';  // 全部应显示的字幕文本（含未触发的）
        this._subtitleCharIdx = 0;   // 已调度的字幕字符数（用于计算延迟）

        this.stopped         = false;
        this.finalized       = false;
        this.sessionFinished = false;
    }

    // ── 建立连接并开启 session ─────────────────────────────

    async open() {
        this.ws = new WebSocket(this.endpoint, {
            headers: {
                'X-Api-App-Key':     this.appid,
                'X-Api-Access-Key':  this.accessToken,
                'X-Api-Resource-Id': this.resourceId,
                'X-Api-Connect-Id':  randomUUID(),
            },
            skipUTF8Validation: true,
        });

        await new Promise((resolve, reject) => {
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
        });

        this.ws.on('close', () => {
            if (!this.stopped) this._handleEnd();
        });

        await startConnection(this.ws);
        await waitForEvent(this.ws, MsgType.FullServerResponse, EventType.ConnectionStarted);

        this.sessionId = randomUUID();
        this.baseReq = {
            user: { uid: randomUUID() },
            namespace: 'BidirectionalTTS',
            req_params: {
                speaker: this.voiceType,
                audio_params: { format: 'pcm', sample_rate: 24000 },
            },
        };

        await startSession(
            this.ws,
            Buffer.from(JSON.stringify({ ...this.baseReq, event: EventType.StartSession })),
            this.sessionId,
        );
        await waitForEvent(this.ws, MsgType.FullServerResponse, EventType.SessionStarted);

        this._initAudio();
        this._receiveLoop();
    }

    // ── 接收 token ────────────────────────────────────────

    async sendToken(token) {
        if (this.stopped || this.finalized) return;
        this.tagBuf += token;
        if (!INCOMPLETE_TAG.test(this.tagBuf)) {
            await this._flushTagBuf();
        }
    }

    // ── LLM 输出结束 ──────────────────────────────────────

    async finalize() {
        if (this.stopped || this.finalized) return;
        this.finalized = true;
        if (this.tagBuf.trim()) await this._flushTagBuf();
        await finishSession(this.ws, this.sessionId);
    }

    // ── 打断 ──────────────────────────────────────────────

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this._stopAudio();
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
        if (typeof hideSubtitle === 'function') hideSubtitle();
        if (this.onMouthValue) this.onMouthValue(0);
    }

    isPlaying() {
        if (!this.audioContext) return false;
        return this.nextStartTime > this.audioContext.currentTime + 0.05;
    }

    // ── 内部：冲 tagBuf ───────────────────────────────────

    async _flushTagBuf() {
        const raw = this.tagBuf;
        this.tagBuf = '';

        this._triggerEmotionMarkersDelayed(raw);

        const clean = this._cleanText(raw);
        if (!clean) return;

        // 逐字发给 TTS，同时按字符顺序延迟显示字幕（首字1秒后出现，之后每字250ms）
        for (const char of clean) {
            if (this.stopped || this.finalized) return;
            const c = char;
            const delay = 1000 + this._subtitleCharIdx * 210;
            this._subtitleCharIdx++;
            this._subtitleFull += c;
            setTimeout(() => {
                if (this.stopped) return;
                this._subtitleAccum += c;
                this._showSubtitle(this._subtitleAccum);
            }, delay);
            await taskRequest(
                this.ws,
                Buffer.from(JSON.stringify({
                    ...this.baseReq,
                    event: EventType.TaskRequest,
                    req_params: { ...this.baseReq.req_params, text: char },
                })),
                this.sessionId,
            );
        }
    }

    _cleanText(text) {
        return text
            .replace(/<<[^>]*>>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .replace(/【[^】]*】/g, '')
            .replace(/[（(][^）)]*[）)]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _triggerEmotionMarkersDelayed(raw) {
        // 按情绪标签在文本中的位置计算延迟，和对应字幕字符同步触发
        const parts = raw.split(/(<[^\s<>]+>)/);
        let cleanCharsBefore = 0;
        for (const part of parts) {
            const m = part.match(/^<([^\s<>]+)>$/);
            if (m) {
                const emotion = m[1];
                const delay = 1000 + (this._subtitleCharIdx + cleanCharsBefore) * 220;
                const em = this.emotionMapper;
                const ex = this.expressionMapper;
                setTimeout(() => {
                    if (!this.stopped) {
                        if (em?.playConfiguredEmotion) em.playConfiguredEmotion(emotion);
                        if (ex?.triggerExpressionByEmotion) ex.triggerExpressionByEmotion(emotion);
                    }
                }, delay);
            } else {
                cleanCharsBefore += this._cleanText(part).length;
            }
        }
    }

    // ── 内部：接收循环 ────────────────────────────────────

    async _receiveLoop() {
        try {
            while (!this.stopped) {
                const msg = await receiveMessage(this.ws);
                if (msg.type === MsgType.AudioOnlyServer) {
                    this._schedulePCM(msg.payload);
                } else if (msg.type === MsgType.FullServerResponse && msg.event === 350) {
                    // TaskStarted，忽略
                } else if (msg.type === MsgType.FullServerResponse && msg.event === 351) {
                    // TaskFinished：用上一段的结束时刻作为本段起点
                    try {
                        const data = JSON.parse(msg.payload.toString('utf8'));
                        const text = data.text || data.TEXT || '';
                        if (text) {
                            const segStart = this._lastSegmentEnd !== null
                                ? this._lastSegmentEnd
                                : (this._audioStartedAt || 0);
                            const segEnd = this.nextStartTime;
                            this._lastSegmentEnd = segEnd;
                            this._subtitleSegments.push({ text, start: segStart, end: segEnd });
                        }
                    } catch (_) {}
                } else if (msg.type === MsgType.FullServerResponse && msg.event === EventType.SessionFinished) {
                    this.sessionFinished = true;
                    this._waitForAudioEnd();
                    break;
                }
            }
        } catch (_) {
            if (!this.stopped) this._handleEnd();
        }
    }

    // ── 内部：Web Audio API ───────────────────────────────

    _initAudio() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.audioContext.resume().catch(() => {});
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
        this.nextStartTime = this.audioContext.currentTime;
    }

    _schedulePCM(buffer) {
        if (this.stopped || !this.audioContext) return;

        const samples = buffer.length / 2;
        const audioBuf = this.audioContext.createBuffer(1, samples, 24000);
        const channel  = audioBuf.getChannelData(0);
        for (let i = 0; i < samples; i++) {
            channel[i] = buffer.readInt16LE(i * 2) / 32768;
        }

        const source  = this.audioContext.createBufferSource();
        source.buffer = audioBuf;
        source.connect(this.gainNode);

        const startAt = Math.max(this.audioContext.currentTime, this.nextStartTime);
        source.start(startAt);
        this.nextStartTime = startAt + audioBuf.duration;

        if (!this.audioStarted) {
            this.audioStarted    = true;
            this._audioStartedAt = startAt;
            if (this.onStartCallback) this.onStartCallback();
            eventBus.emit(Events.TTS_START);
            this._startAnimLoop();
        }
    }

    // 嘴形 + 字幕同步，共用一个 rAF 循环
    _startAnimLoop() {
        const freqData = new Uint8Array(this.analyser?.frequencyBinCount || 128);

        const tick = () => {
            if (this.stopped) {
                if (this.onMouthValue) this.onMouthValue(0);
                return;
            }

            // 嘴形
            if (this.analyser && this.onMouthValue) {
                this.analyser.getByteFrequencyData(freqData);
                let sum = 0;
                const half = freqData.length / 2;
                for (let i = 0; i < half; i++) sum += freqData[i];
                this.onMouthValue(Math.pow(sum / half / 256, 0.8));
            }

            // 字幕由 setTimeout 驱动，rAF 只负责嘴形

            this._animId = requestAnimationFrame(tick);
        };

        this._animId = requestAnimationFrame(tick);
    }

    _waitForAudioEnd() {
        const check = () => {
            if (this.stopped) return;
            if (this.audioContext && this.nextStartTime > this.audioContext.currentTime + 0.05) {
                setTimeout(check, 100);
            } else {
                this._handleEnd();
            }
        };
        setTimeout(check, 100);
    }

    _handleEnd() {
        if (this.stopped) return;
        this.stopped = true;

        this._stopAudio();

        // 确保字幕完整显示（用全量文本，不受 stopped 影响）
        if (this._subtitleFull) this._showSubtitle(this._subtitleFull);

        try {
            finishConnection(this.ws).catch(() => {});
            setTimeout(() => { try { this.ws?.close(); } catch (_) {} }, 200);
        } catch (_) {}

        setTimeout(() => {
            if (typeof hideSubtitle === 'function') hideSubtitle();
        }, 1000);

        if (this.onEndCallback) this.onEndCallback();
        eventBus.emit(Events.TTS_END);
        if (this.onComplete) this.onComplete();
    }

    _stopAudio() {
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
        if (this.onMouthValue) this.onMouthValue(0);
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (_) {}
            this.audioContext = null;
        }
    }

    _showSubtitle(text) {
        const label = this.config.subtitle_labels?.ai || 'Fake Neuro';
        if (typeof showSubtitle === 'function') {
            showSubtitle(`${label}: ${text}`);
            const container = document.getElementById('subtitle-container');
            if (container) container.scrollTop = container.scrollHeight;
        }
    }
}

module.exports = { VolcengineStreamingSession };
