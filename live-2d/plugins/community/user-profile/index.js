const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const LIVE2D_ROOT = path.join(__dirname, '..', '..', '..');
const USER_ID = 'feiniu_default';

const CATEGORY_TO_FIELD = {
    habit: 'habits',
    trait: 'traits',
    like: 'preferences.likes',
    dislike: 'preferences.dislikes',
    fact: 'facts',
    relationship: 'relationships'
};

const DEFAULT_PROFILE = {
    name: '',
    nickname: '',
    traits: [],
    habits: [],
    preferences: { likes: [], dislikes: [] },
    facts: [],
    relationships: [],
    bootstrapped: false,
    updated_at: '',
    version: 1,
    _meta: { items: {} }
};

const DEFAULT_CANDIDATES = {
    candidates: [],
    archived: [],
    updated_at: '',
    version: 1
};

class UserProfilePlugin extends Plugin {

    async onInit() {
        this._cfg = {};
        this._profilePath = null;
        this._candidatePath = null;
        this._profile = this._clone(DEFAULT_PROFILE);
        this._candidateStore = this._clone(DEFAULT_CANDIDATES);
        this._renderedProfile = '';
        this._dirty = false;
        this._distilling = false;
        this._bootstrapRunning = false;
        this._idleTimer = null;
        this._watchers = [];
        this._watchDebounce = null;
        this._interactionHandler = null;
        this._lastProcessedMessageCount = 0;
    }

    async onStart() {
        this._cfg = this.context.getPluginFileConfig();
        if (this._cfg.enabled === false) {
            this.context.log('warn', '用户画像插件已禁用');
            return;
        }

        this._profilePath = this._resolveLivePath(this._cfg.profile_file || 'AI记录室/用户画像.json');
        this._candidatePath = this._resolveLivePath(this._cfg.candidate_file || 'AI记录室/用户画像_候选.json');

        this._loadProfile();
        this._loadCandidates();
        this._decayCandidates();
        this._decayProfileItems();
        this._refreshRenderedProfile();
        this._watchFiles();

        this._interactionHandler = () => this._resetIdleTimer();
        this.context.on('interaction:updated', this._interactionHandler);
        this._resetIdleTimer();

        if (this._cfg.bootstrap_on_first_run !== false && !this._profile.bootstrapped) {
            this._bootstrap().catch(err => {
                this.context.log('warn', `首次画像诊断失败（下次启动会重试）: ${err.message}`);
            });
        }

        this.context.log('info', `用户画像插件已启动，画像文件: ${this._profilePath}`);
    }

    async onStop() {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
        clearTimeout(this._watchDebounce);
        this._unwatchFiles();

        if (this._interactionHandler) {
            this.context.off('interaction:updated', this._interactionHandler);
            this._interactionHandler = null;
        }

        if (this._cfg.update_on_exit !== false && this._dirty) {
            try {
                await this._withTimeout(this._distill('stop'), 30000);
            } catch (err) {
                this.context.log('warn', `退出前画像更新未完成: ${err.message}`);
            }
        }
    }

    async onLLMRequest(request) {
        if (this._cfg.enabled === false || this._cfg.inject_profile === false) return;
        if (!this._renderedProfile) return;

        const sysMsg = request.messages.find(m => m.role === 'system');
        if (sysMsg) {
            sysMsg.content += `\n\n${this._renderedProfile}`;
        }
    }

    async onLLMResponse() {
        if (this._cfg.enabled === false) return;
        this._dirty = true;
        this._resetIdleTimer();
    }

    async onTTSEnd() {
        if (this._cfg.enabled === false) return;
        this._resetIdleTimer();
    }

    getTools() {
        if (this._cfg.enabled === false) return [];
        return [
            {
                type: 'function',
                function: {
                    name: 'profile_view',
                    description: '查看当前自动用户画像（只包含已晋升的长期画像，不包含候选池）。',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'profile_update',
                    description: '手动修正自动用户画像。适合用户明确要求修改画像时使用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['add_trait', 'add_habit', 'add_like', 'add_dislike', 'add_fact', 'add_relationship', 'set_name', 'set_nickname', 'remove'],
                                description: '操作类型'
                            },
                            value: { type: 'string', description: '要写入或移除的内容' }
                        },
                        required: ['action', 'value']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'profile_rebuild',
                    description: '重新从 MemOS 长期记忆诊断用户画像。会保留当前文件备份，由后台重新生成画像。',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            }
        ];
    }

    async executeTool(name, params = {}) {
        switch (name) {
            case 'profile_view':
                return this._renderProfileForTool();
            case 'profile_update':
                return this._manualUpdate(params.action, params.value);
            case 'profile_rebuild':
                return this._rebuildProfile();
            default:
                return undefined;
        }
    }

    // ===== Startup bootstrap =====

    async _bootstrap() {
        if (this._bootstrapRunning) return;
        this._bootstrapRunning = true;

        try {
            const apiUrl = this._trimTrailingSlash(this._cfg.memos_api_url || 'http://127.0.0.1:8003');
            const ok = await this._memosHealth(apiUrl);
            if (!ok) {
                this.context.log('warn', 'MemOS 不可用，跳过首次用户画像诊断');
                return;
            }

            const [memories, preferences, graph] = await Promise.all([
                this._fetchMemosMemories(apiUrl),
                this._fetchMemosPreferences(apiUrl),
                this._fetchMemosGraph(apiUrl)
            ]);

            const selectedMemories = this._selectBootstrapMemories(memories);
            if (selectedMemories.length === 0 && preferences.length === 0) {
                this.context.log('warn', 'MemOS 中暂无可用于首次诊断的长期记忆');
                return;
            }

            const prompt = this._buildBootstrapPrompt(selectedMemories, preferences, graph);
            const response = await this._callProfileLLM(prompt, { temperature: 0.2 });
            const parsed = this._parseJsonObject(response);
            const nextProfile = this._normalizeProfile({
                ...this._profile,
                ...parsed,
                bootstrapped: true,
                updated_at: this._nowIso()
            });

            nextProfile._meta = nextProfile._meta || { items: {} };
            this._touchAllProfileItems(nextProfile, this._today());
            this._profile = nextProfile;
            this._saveProfile();
            this._refreshRenderedProfile();
            this.context.log('info', `首次用户画像诊断完成：使用 ${selectedMemories.length} 条记忆、${preferences.length} 条偏好`);
        } finally {
            this._bootstrapRunning = false;
        }
    }

    // ===== Distillation pipeline =====

    async _distill(reason = 'idle') {
        if (this._distilling) return;

        const messages = this.context.getMessages();
        const minNewMessages = this._numberCfg('min_new_messages', 4);
        const newCount = Math.max(0, messages.length - this._lastProcessedMessageCount);
        if (!this._dirty || newCount < minNewMessages) {
            this._decayCandidates();
            this._decayProfileItems();
            return;
        }

        this._distilling = true;
        try {
            const maxMessages = this._numberCfg('max_context_messages', 40);
            const recentMessages = messages
                .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
                .slice(-maxMessages);

            if (recentMessages.length === 0) return;

            const observations = await this._extractCandidates(recentMessages);
            const { changed, promotable } = await this._updateCandidatePool(observations);
            const promoted = await this._promoteCandidates(promotable);

            this._decayCandidates();
            this._decayProfileItems();

            if (changed || promoted > 0) {
                this._saveCandidates();
                this._saveProfile();
                this._refreshRenderedProfile();
            }

            this._dirty = false;
            this._lastProcessedMessageCount = messages.length;
            this.context.log('info', `画像后台分析完成 (${reason})：候选 ${observations.length} 条，晋升 ${promoted} 条`);
        } catch (err) {
            this.context.log('error', `画像后台分析失败: ${err.message}`);
        } finally {
            this._distilling = false;
        }
    }

    async _extractCandidates(recentMessages) {
        const prompt = this._buildCandidatePrompt(recentMessages);
        const response = await this._callProfileLLM(prompt, { temperature: 0.2 });
        const parsed = this._parseJsonObject(response);
        const observations = Array.isArray(parsed.observations) ? parsed.observations : [];

        return observations
            .map(obs => this._normalizeObservation(obs))
            .filter(obs => obs && obs.text);
    }

    async _updateCandidatePool(observations) {
        const today = this._today();
        let changed = false;
        const promotable = [];

        for (const obs of observations) {
            this._applyObservationContradictions(obs);

            const existingProfileItem = this._findProfileItem(obs.category, obs.text);
            if (existingProfileItem) {
                this._touchProfileItem(existingProfileItem.field, existingProfileItem.text, today);
                changed = true;
                continue;
            }

            let candidate = this._findCandidateForObservation(obs);
            if (!candidate) {
                candidate = {
                    id: this._candidateId(obs.category, obs.text),
                    category: obs.category,
                    text: obs.text,
                    count: 0,
                    first_seen: today,
                    last_seen: today,
                    last_counted_day: '',
                    self_declared: false,
                    status: 'candidate',
                    evidence: [],
                    memos_support: null
                };
                this._candidateStore.candidates.push(candidate);
            }

            const sameDay = candidate.last_counted_day === today;
            if (!sameDay) {
                candidate.count = Math.max(0, Number(candidate.count || 0)) + 1;
                candidate.last_counted_day = today;
            }

            candidate.last_seen = today;
            candidate.self_declared = Boolean(candidate.self_declared || obs.self_declared);
            candidate.one_off = Boolean(obs.one_off);
            candidate.status = candidate.status === 'promoted' ? 'promoted' : 'candidate';
            candidate.evidence = this._appendEvidence(candidate.evidence, {
                date: today,
                text: obs.evidence || obs.text,
                one_off: obs.one_off,
                self_declared: obs.self_declared
            });
            changed = true;

            if (candidate.status !== 'promoted' && await this._shouldPromote(candidate)) {
                promotable.push(candidate);
            }
        }

        return { changed, promotable };
    }

    async _promoteCandidates(candidates) {
        const pending = candidates.filter(c => c && c.status !== 'promoted');
        if (pending.length === 0) return 0;

        const refined = await this._refinePromotionTexts(pending);
        const today = this._today();
        let promoted = 0;

        for (const candidate of pending) {
            const item = refined.get(candidate.id) || { category: candidate.category, text: candidate.text };
            const category = this._normalizeCategory(item.category || candidate.category);
            const text = this._cleanText(item.text || candidate.text);
            if (!text) continue;

            this._addProfileItem(category, text, today);
            candidate.status = 'promoted';
            candidate.promoted_at = today;
            promoted += 1;
        }

        if (promoted > 0) {
            this._profile.updated_at = this._nowIso();
        }

        return promoted;
    }

    async _shouldPromote(candidate) {
        if (!candidate || candidate.status === 'promoted') return false;
        if (candidate.self_declared) return true;

        const category = this._normalizeCategory(candidate.category);
        const count = Number(candidate.count || 0);
        const spanDays = this._daysBetween(candidate.first_seen, candidate.last_seen);

        if (category === 'fact') return count >= 1;
        if (category === 'like' || category === 'dislike' || category === 'relationship') return count >= 2;

        const localPromote = count >= this._numberCfg('promote_count', 3)
            && spanDays >= this._numberCfg('promote_span_days', 3);
        if (localPromote) return true;

        const source = String(this._cfg.recurrence_source || 'hybrid').toLowerCase();
        if (source === 'local') return false;
        if (source === 'memos' || source === 'hybrid') {
            return await this._memosSupportsCandidate(candidate);
        }

        return false;
    }

    async _memosSupportsCandidate(candidate) {
        const apiUrl = this._trimTrailingSlash(this._cfg.memos_api_url || 'http://127.0.0.1:8003');
        try {
            const { data } = await axios.post(`${apiUrl}/search`, {
                query: `关于主人的长期习惯、偏好或特点：${candidate.text}`,
                top_k: 8,
                user_id: USER_ID,
                similarity_threshold: 0.45
            }, { timeout: 5000 });

            const memories = Array.isArray(data.memories) ? data.memories : [];
            if (memories.length === 0) return false;

            const mergeMax = memories.reduce((max, mem) => {
                const pl = mem && typeof mem.payload === 'object' ? mem.payload : {};
                return Math.max(max, Number(mem.merge_count || pl.merge_count || 0));
            }, 0);

            const dates = memories
                .map(mem => mem.created_at || mem.timestamp || (mem.payload && (mem.payload.created_at || mem.payload.timestamp)))
                .map(ts => this._dateOnly(ts))
                .filter(Boolean)
                .sort();

            const span = dates.length >= 2 ? this._daysBetween(dates[0], dates[dates.length - 1]) : 0;
            const enoughMerge = mergeMax >= this._numberCfg('promote_count', 3);
            const enoughDistinctHits = memories.length >= this._numberCfg('promote_count', 3)
                && span >= this._numberCfg('promote_span_days', 3);

            candidate.memos_support = {
                checked_at: this._nowIso(),
                hit_count: memories.length,
                merge_count: mergeMax,
                span_days: span
            };

            return enoughMerge || enoughDistinctHits;
        } catch (_) {
            return false;
        }
    }

    async _refinePromotionTexts(candidates) {
        const result = new Map();
        const prompt = `你是用户画像编辑器。请把以下已达晋升条件的候选观察润色为简洁、稳定、长期的画像条目。

要求：
- 只输出 JSON，不要解释。
- 保留候选 id。
- text 用一句自然中文，不要带"可能"、"今天"、"刚才"等一次性表述。
- category 只能是 habit、trait、like、dislike、fact、relationship。

候选：
${JSON.stringify(candidates.map(c => ({
    id: c.id,
    category: c.category,
    text: c.text,
    count: c.count,
    first_seen: c.first_seen,
    last_seen: c.last_seen,
    self_declared: c.self_declared,
    memos_support: c.memos_support
})), null, 2)}

输出格式：
{"items":[{"id":"...","category":"habit","text":"..."}]}`;

        try {
            const response = await this._callProfileLLM(prompt, { temperature: 0.1 });
            const parsed = this._parseJsonObject(response);
            const items = Array.isArray(parsed.items) ? parsed.items : [];
            for (const item of items) {
                if (item && item.id && item.text) {
                    result.set(item.id, {
                        category: this._normalizeCategory(item.category),
                        text: this._cleanText(item.text)
                    });
                }
            }
        } catch (err) {
            this.context.log('warn', `画像晋升润色失败，使用候选原文: ${err.message}`);
        }

        return result;
    }

    // ===== Profile LLM =====

    async _callProfileLLM(prompt, options = {}) {
        const primary = this._cfg.profile_llm || {};
        const hasDedicated = primary.model && primary.api_key && primary.base_url;

        if (!hasDedicated) {
            return await this.context.callLLM(prompt, {
                temperature: options.temperature ?? 0.2,
                max_tokens: primary.max_tokens || options.max_tokens || 4000
            });
        }

        const configs = [primary];
        const fallback = this._cfg.profile_llm_fallback || {};
        if (fallback.enabled && fallback.model && fallback.api_key && fallback.base_url) {
            configs.push({
                ...fallback,
                max_tokens: primary.max_tokens || options.max_tokens || 4000,
                timeout_seconds: primary.timeout_seconds || 120
            });
        }

        let lastError = null;
        for (const cfg of configs) {
            const timeouts = [this._numberValue(cfg.timeout_seconds, 120), this._numberValue(cfg.timeout_seconds, 120) * 2];
            for (const timeoutSeconds of timeouts) {
                try {
                    const { data } = await axios.post(
                        `${this._trimTrailingSlash(cfg.base_url)}/chat/completions`,
                        this._buildChatPayload(cfg, prompt, options),
                        {
                            headers: {
                                Authorization: `Bearer ${cfg.api_key}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: timeoutSeconds * 1000
                        }
                    );
                    return data.choices?.[0]?.message?.content || '';
                } catch (err) {
                    lastError = err;
                    this.context.log('warn', `画像模型调用失败 (${cfg.model}, ${timeoutSeconds}s): ${err.message}`);
                }
            }
        }

        throw lastError || new Error('画像模型调用失败');
    }

    _buildChatPayload(cfg, prompt, options) {
        const payload = {
                            model: cfg.model,
                            messages: [{ role: 'user', content: prompt }],
                            temperature: options.temperature ?? 0.2,
                            max_tokens: this._numberValue(cfg.max_tokens || options.max_tokens, 4000)
        };

        if (cfg.thinking_mode) {
            payload.thinking = { type: String(cfg.thinking_mode) };
        }

        return payload;
    }

    // ===== Storage =====

    _loadProfile() {
        const existed = fs.existsSync(this._profilePath);
        const loaded = this._readJson(this._profilePath, DEFAULT_PROFILE);
        this._profile = this._normalizeProfile(loaded);
        if (!existed) this._saveProfile();
    }

    _loadCandidates() {
        const existed = fs.existsSync(this._candidatePath);
        const loaded = this._readJson(this._candidatePath, DEFAULT_CANDIDATES);
        this._candidateStore = this._normalizeCandidates(loaded);
        if (!existed) this._saveCandidates();
    }

    _saveProfile() {
        this._writeJson(this._profilePath, this._profile);
    }

    _saveCandidates() {
        this._candidateStore.updated_at = this._nowIso();
        this._writeJson(this._candidatePath, this._candidateStore);
    }

    _readJson(filePath, fallback) {
        try {
            if (!fs.existsSync(filePath)) return this._clone(fallback);
            const raw = fs.readFileSync(filePath, 'utf-8').trim();
            if (!raw) return this._clone(fallback);
            return JSON.parse(raw);
        } catch (err) {
            this.context.log('warn', `读取 JSON 失败 (${filePath}): ${err.message}`);
            return this._clone(fallback);
        }
    }

    _writeJson(filePath, data) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    _normalizeProfile(profile) {
        const next = {
            ...this._clone(DEFAULT_PROFILE),
            ...(profile || {})
        };
        next.traits = this._limitItems(next.traits);
        next.habits = this._limitItems(next.habits);
        next.facts = this._limitItems(next.facts);
        next.relationships = this._limitItems(next.relationships);
        next.preferences = next.preferences && typeof next.preferences === 'object' ? next.preferences : {};
        next.preferences.likes = this._limitItems(next.preferences.likes);
        next.preferences.dislikes = this._limitItems(next.preferences.dislikes);
        next._meta = next._meta && typeof next._meta === 'object' ? next._meta : { items: {} };
        next._meta.items = next._meta.items && typeof next._meta.items === 'object' ? next._meta.items : {};
        next.version = 1;
        return next;
    }

    _normalizeCandidates(store) {
        const next = {
            ...this._clone(DEFAULT_CANDIDATES),
            ...(store || {})
        };
        next.candidates = Array.isArray(next.candidates) ? next.candidates : [];
        next.archived = Array.isArray(next.archived) ? next.archived : [];
        next.candidates = next.candidates.map(c => ({
            id: c.id || this._candidateId(c.category, c.text),
            category: this._normalizeCategory(c.category),
            text: this._cleanText(c.text),
            count: Math.max(0, Number(c.count || 0)),
            first_seen: c.first_seen || this._today(),
            last_seen: c.last_seen || this._today(),
            last_counted_day: c.last_counted_day || '',
            self_declared: Boolean(c.self_declared),
            status: c.status || 'candidate',
            evidence: Array.isArray(c.evidence) ? c.evidence.slice(-10) : [],
            memos_support: c.memos_support || null,
            promoted_at: c.promoted_at || undefined
        })).filter(c => c.text);
        return next;
    }

    _refreshRenderedProfile() {
        const parts = [];
        if (this._profile.name) parts.push(`姓名: ${this._profile.name}`);
        if (this._profile.nickname) parts.push(`称呼/昵称: ${this._profile.nickname}`);
        if (this._profile.traits.length) parts.push(`性格/做派:\n${this._profile.traits.map(x => `- ${x}`).join('\n')}`);
        if (this._profile.habits.length) parts.push(`长期习惯/行为模式:\n${this._profile.habits.map(x => `- ${x}`).join('\n')}`);
        if (this._profile.preferences.likes.length || this._profile.preferences.dislikes.length) {
            const prefs = [];
            if (this._profile.preferences.likes.length) prefs.push(`喜欢: ${this._profile.preferences.likes.join('；')}`);
            if (this._profile.preferences.dislikes.length) prefs.push(`不喜欢: ${this._profile.preferences.dislikes.join('；')}`);
            parts.push(`稳定偏好:\n${prefs.map(x => `- ${x}`).join('\n')}`);
        }
        if (this._profile.facts.length) parts.push(`稳定事实:\n${this._profile.facts.map(x => `- ${x}`).join('\n')}`);
        if (this._profile.relationships.length) parts.push(`重要关系:\n${this._profile.relationships.map(x => `- ${x}`).join('\n')}`);

        this._renderedProfile = parts.length
            ? `【用户画像 - 主人长期以来的习惯/性格/偏好，自然融入对话，勿照搬原文】\n${parts.join('\n')}`
            : '';
    }

    _watchFiles() {
        this._unwatchFiles();
        for (const filePath of [this._profilePath, this._candidatePath]) {
            try {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const base = path.basename(filePath);
                const watcher = fs.watch(dir, (eventType, filename) => {
                    if (filename !== base) return;
                    clearTimeout(this._watchDebounce);
                    this._watchDebounce = setTimeout(() => {
                        this._loadProfile();
                        this._loadCandidates();
                        this._refreshRenderedProfile();
                        this.context.log('info', '用户画像文件已变更，已重新加载');
                    }, 500);
                });
                this._watchers.push(watcher);
            } catch (err) {
                this.context.log('warn', `无法监听画像文件: ${err.message}`);
            }
        }
    }

    _unwatchFiles() {
        for (const watcher of this._watchers) {
            try { watcher.close(); } catch (_) {}
        }
        this._watchers = [];
    }

    // ===== Prompts =====

    _buildBootstrapPrompt(memories, preferences, graph) {
        return `你是用户画像诊断器。请基于肥牛的长期记忆，为"主人"生成一份长期稳定用户画像。

原则：
- 只提炼长期稳定的习惯、行为模式、性格做派、稳定偏好、稳定事实和重要关系。
- 忽略当天/一次性/偶发事件。
- 如果证据不足，宁可留空，不要猜测。
- 只输出 JSON，不要 markdown，不要解释。

输出 JSON 结构：
{
  "name": "",
  "nickname": "",
  "traits": [],
  "habits": [],
  "preferences": { "likes": [], "dislikes": [] },
  "facts": [],
  "relationships": []
}

长期记忆（已按 importance、merge_count、时间跨度筛选）：
${JSON.stringify(memories, null, 2)}

结构化偏好：
${JSON.stringify(preferences, null, 2)}

关系图谱摘要（可为空）：
${JSON.stringify(graph, null, 2)}`;
    }

    _buildCandidatePrompt(recentMessages) {
        const candidateSummary = this._candidateStore.candidates
            .filter(c => c.status !== 'archived')
            .slice(-50)
            .map(c => ({
                id: c.id,
                category: c.category,
                text: c.text,
                count: c.count,
                first_seen: c.first_seen,
                last_seen: c.last_seen,
                self_declared: c.self_declared
            }));

        return `你是用户画像观察器。请从最近对话中提取"可能值得长期跟踪"的用户观察，输出候选观察，不要直接判断它已是长期画像。

重要原则：
- 只提取与主人长期画像有关的观察：habit(习惯/行为模式)、trait(性格/做派)、like、dislike、fact(稳定事实)、relationship。
- 一次性事件也可以作为候选，但必须标注 one_off=true；不要把"今天/刚才/这次"说成长期。
- 如果主人明确说"我一直/经常/习惯/每天/通常/基本都..."，self_declared=true。
- 如果观察与已有候选相同，请填写 match_id；否则 match_id=null。
- 如发现某个正式画像项已被明确否定/取代，可填写 obsolete_profile_text。
- 只输出 JSON，不要 markdown，不要解释。

已有正式画像：
${JSON.stringify(this._profile, null, 2)}

已有候选池摘要：
${JSON.stringify(candidateSummary, null, 2)}

最近对话：
${JSON.stringify(recentMessages.map(m => ({ role: m.role, content: m.content })), null, 2)}

输出格式：
{
  "observations": [
    {
      "match_id": "已有候选id或null",
      "category": "habit|trait|like|dislike|fact|relationship",
      "text": "简洁观察",
      "evidence": "触发该观察的短证据",
      "one_off": false,
      "self_declared": false,
      "obsolete_profile_text": ""
    }
  ]
}`;
    }

    // ===== MemOS =====

    async _memosHealth(apiUrl) {
        try {
            const { data } = await axios.get(`${apiUrl}/health`, { timeout: 2000 });
            return data.status === 'healthy';
        } catch (_) {
            return false;
        }
    }

    async _fetchMemosMemories(apiUrl) {
        try {
            const { data } = await axios.get(`${apiUrl}/list`, {
                params: { user_id: USER_ID, limit: 0 },
                timeout: 15000
            });
            return Array.isArray(data.memories) ? data.memories : [];
        } catch (err) {
            this.context.log('warn', `拉取 MemOS 记忆失败: ${err.message}`);
            return [];
        }
    }

    async _fetchMemosPreferences(apiUrl) {
        try {
            const { data } = await axios.get(`${apiUrl}/preferences`, {
                params: { user_id: USER_ID },
                timeout: 8000
            });
            return Array.isArray(data.preferences) ? data.preferences : [];
        } catch (err) {
            this.context.log('warn', `拉取 MemOS 偏好失败: ${err.message}`);
            return [];
        }
    }

    async _fetchMemosGraph(apiUrl) {
        try {
            const [entities, relations] = await Promise.all([
                axios.get(`${apiUrl}/graph/entities`, { timeout: 5000 }),
                axios.get(`${apiUrl}/graph/relations`, { timeout: 5000 })
            ]);
            return {
                entities: entities.data.entities || entities.data || [],
                relations: relations.data.relations || relations.data || []
            };
        } catch (_) {
            return { entities: [], relations: [] };
        }
    }

    _selectBootstrapMemories(memories) {
        const max = this._numberCfg('bootstrap_max_memories', 200);
        return memories
            .map(mem => ({
                id: mem.id,
                content: mem.content,
                importance: Number(mem.importance || 0),
                merge_count: Number(mem.merge_count || 0),
                memory_type: mem.memory_type || 'general',
                created_at: mem.created_at || mem.timestamp,
                tags: mem.tags || []
            }))
            .filter(mem => mem.content)
            .sort((a, b) => this._memoryBootstrapScore(b) - this._memoryBootstrapScore(a))
            .slice(0, max);
    }

    _memoryBootstrapScore(mem) {
        const importance = Math.min(1, Math.max(0, Number(mem.importance || 0))) * 3;
        const merge = Math.min(5, Number(mem.merge_count || 0)) * 1.5;
        const typeBonus = ['preference', 'fact', 'semantic'].includes(mem.memory_type) ? 1 : 0;
        return importance + merge + typeBonus;
    }

    // ===== Decay =====

    _decayCandidates() {
        const ttl = this._numberCfg('candidate_ttl_days', 30);
        const today = this._today();
        let changed = false;

        const kept = [];
        for (const candidate of this._candidateStore.candidates) {
            if (candidate.status === 'promoted') {
                kept.push(candidate);
                continue;
            }

            const staleDays = this._daysBetween(candidate.last_seen, today);
            if (staleDays > ttl) {
                this._candidateStore.archived.push({
                    ...candidate,
                    status: 'archived',
                    archived_at: today,
                    archived_reason: 'candidate_ttl'
                });
                changed = true;
            } else {
                kept.push(candidate);
            }
        }

        if (changed) {
            this._candidateStore.candidates = kept;
            this._saveCandidates();
        }
    }

    _decayProfileItems() {
        const staleDays = this._numberCfg('profile_stale_days', 180);
        const today = this._today();
        const meta = this._profile._meta?.items || {};
        let changed = false;

        for (const [key, itemMeta] of Object.entries(meta)) {
            if (!itemMeta || itemMeta.field === 'facts') continue;
            const lastSeen = itemMeta.last_seen || itemMeta.promoted_at;
            if (!lastSeen || this._daysBetween(lastSeen, today) <= staleDays) continue;

            const removed = this._removeProfileText(itemMeta.field, itemMeta.text);
            if (removed) {
                this._candidateStore.candidates.push({
                    id: this._candidateId(itemMeta.field, itemMeta.text),
                    category: this._fieldToCategory(itemMeta.field),
                    text: itemMeta.text,
                    count: 1,
                    first_seen: today,
                    last_seen: today,
                    last_counted_day: today,
                    self_declared: false,
                    status: 'candidate',
                    evidence: [{ date: today, text: '正式画像长期未复现后软降级回候选池' }]
                });
                delete meta[key];
                changed = true;
            }
        }

        if (changed) {
            this._profile.updated_at = this._nowIso();
            this._saveProfile();
            this._saveCandidates();
            this._refreshRenderedProfile();
        }
    }

    // ===== Profile operations =====

    _addProfileItem(category, text, date = this._today()) {
        const field = CATEGORY_TO_FIELD[this._normalizeCategory(category)];
        if (!field || !text) return false;

        const list = this._getProfileList(field);
        if (!list) return false;

        const norm = this._normalizeComparable(text);
        const exists = list.some(item => this._normalizeComparable(item) === norm);
        if (!exists) {
            list.push(text);
            this._setProfileList(field, this._limitItems(list));
        }

        this._touchProfileItem(field, exists ? list.find(item => this._normalizeComparable(item) === norm) : text, date);
        return true;
    }

    _findProfileItem(category, text) {
        const field = CATEGORY_TO_FIELD[this._normalizeCategory(category)];
        const list = this._getProfileList(field);
        if (!list) return null;

        const norm = this._normalizeComparable(text);
        const found = list.find(item => {
            const itemNorm = this._normalizeComparable(item);
            return itemNorm === norm || itemNorm.includes(norm) || norm.includes(itemNorm);
        });
        return found ? { field, text: found } : null;
    }

    _touchProfileItem(field, text, date = this._today()) {
        this._profile._meta = this._profile._meta || { items: {} };
        this._profile._meta.items = this._profile._meta.items || {};
        const key = this._profileMetaKey(field, text);
        this._profile._meta.items[key] = {
            field,
            text,
            last_seen: date,
            promoted_at: this._profile._meta.items[key]?.promoted_at || date
        };
    }

    _touchAllProfileItems(profile, date = this._today()) {
        for (const field of ['traits', 'habits', 'facts', 'relationships', 'preferences.likes', 'preferences.dislikes']) {
            const list = this._getProfileListFrom(profile, field);
            for (const text of list) {
                const key = this._profileMetaKey(field, text);
                profile._meta.items[key] = { field, text, last_seen: date, promoted_at: date };
            }
        }
    }

    _applyObservationContradictions(obs) {
        const obsolete = this._cleanText(obs.obsolete_profile_text);
        if (!obsolete) return;
        for (const field of ['traits', 'habits', 'relationships', 'preferences.likes', 'preferences.dislikes']) {
            const removed = this._removeProfileText(field, obsolete);
            if (removed) {
                this.context.log('info', `画像项被新观察取代，已移除: ${obsolete}`);
                this._profile.updated_at = this._nowIso();
                break;
            }
        }
    }

    _removeProfileText(field, text) {
        const list = this._getProfileList(field);
        if (!list) return false;
        const norm = this._normalizeComparable(text);
        const next = list.filter(item => {
            const itemNorm = this._normalizeComparable(item);
            return itemNorm !== norm && !itemNorm.includes(norm) && !norm.includes(itemNorm);
        });
        if (next.length === list.length) return false;
        this._setProfileList(field, next);
        for (const key of Object.keys(this._profile._meta?.items || {})) {
            if (this._profile._meta.items[key].field === field && this._normalizeComparable(this._profile._meta.items[key].text) === norm) {
                delete this._profile._meta.items[key];
            }
        }
        return true;
    }

    _manualUpdate(action, value) {
        const text = this._cleanText(value);
        if (!text) return '错误：未提供有效内容。';

        switch (action) {
            case 'set_name':
                this._profile.name = text;
                break;
            case 'set_nickname':
                this._profile.nickname = text;
                break;
            case 'add_trait':
                this._addProfileItem('trait', text);
                break;
            case 'add_habit':
                this._addProfileItem('habit', text);
                break;
            case 'add_like':
                this._addProfileItem('like', text);
                break;
            case 'add_dislike':
                this._addProfileItem('dislike', text);
                break;
            case 'add_fact':
                this._addProfileItem('fact', text);
                break;
            case 'add_relationship':
                this._addProfileItem('relationship', text);
                break;
            case 'remove':
                for (const field of ['traits', 'habits', 'facts', 'relationships', 'preferences.likes', 'preferences.dislikes']) {
                    this._removeProfileText(field, text);
                }
                break;
            default:
                return `错误：不支持的操作 ${action}`;
        }

        this._profile.updated_at = this._nowIso();
        this._saveProfile();
        this._refreshRenderedProfile();
        return `用户画像已更新：${action} ${text}`;
    }

    async _rebuildProfile() {
        this._profile = this._normalizeProfile({
            ...this._clone(DEFAULT_PROFILE),
            bootstrapped: false
        });
        this._saveProfile();
        this._refreshRenderedProfile();
        this._bootstrap().catch(err => this.context.log('warn', `重新诊断失败: ${err.message}`));
        return '已开始重新诊断用户画像；完成后会写入用户画像.json。';
    }

    _renderProfileForTool() {
        if (!this._renderedProfile) return '当前没有已晋升的用户画像。';
        return `${this._renderedProfile}\n\n画像文件: ${this._profilePath}\n候选池文件: ${this._candidatePath}`;
    }

    // ===== Helpers =====

    _resetIdleTimer() {
        clearTimeout(this._idleTimer);
        const idleMs = this._numberCfg('idle_time', 180000);
        this._idleTimer = setTimeout(() => {
            this._distill('idle').catch(err => {
                this.context.log('error', `空闲画像分析失败: ${err.message}`);
            });
        }, idleMs);
    }

    _findCandidateForObservation(obs) {
        if (obs.match_id) {
            const found = this._candidateStore.candidates.find(c => c.id === obs.match_id && c.status !== 'archived');
            if (found) return found;
        }

        const norm = this._normalizeComparable(obs.text);
        return this._candidateStore.candidates.find(c => {
            if (c.status === 'archived') return false;
            if (this._normalizeCategory(c.category) !== obs.category) return false;
            const cNorm = this._normalizeComparable(c.text);
            return cNorm === norm || cNorm.includes(norm) || norm.includes(cNorm);
        });
    }

    _normalizeObservation(obs) {
        if (!obs || typeof obs !== 'object') return null;
        const text = this._cleanText(obs.text);
        if (!text) return null;
        return {
            match_id: typeof obs.match_id === 'string' ? obs.match_id : '',
            category: this._normalizeCategory(obs.category),
            text,
            evidence: this._cleanText(obs.evidence),
            one_off: Boolean(obs.one_off),
            self_declared: Boolean(obs.self_declared),
            obsolete_profile_text: this._cleanText(obs.obsolete_profile_text)
        };
    }

    _normalizeCategory(category) {
        const c = String(category || '').toLowerCase();
        if (['habit', 'habits'].includes(c)) return 'habit';
        if (['trait', 'traits', 'personality'].includes(c)) return 'trait';
        if (['like', 'likes', 'preference'].includes(c)) return 'like';
        if (['dislike', 'dislikes'].includes(c)) return 'dislike';
        if (['relationship', 'relationships', 'relation'].includes(c)) return 'relationship';
        if (['fact', 'facts'].includes(c)) return 'fact';
        return 'fact';
    }

    _fieldToCategory(field) {
        if (field === 'habits') return 'habit';
        if (field === 'traits') return 'trait';
        if (field === 'preferences.likes') return 'like';
        if (field === 'preferences.dislikes') return 'dislike';
        if (field === 'relationships') return 'relationship';
        return 'fact';
    }

    _candidateId(category, text) {
        const hash = crypto.createHash('sha1')
            .update(`${this._normalizeCategory(category)}:${this._normalizeComparable(text)}`)
            .digest('hex')
            .slice(0, 12);
        return `${this._normalizeCategory(category)}:${hash}`;
    }

    _appendEvidence(list, item) {
        const next = Array.isArray(list) ? list.slice() : [];
        next.push(item);
        return next.slice(-10);
    }

    _parseJsonObject(response) {
        if (!response) throw new Error('LLM 返回为空');
        let text = String(response).trim();

        if (text.startsWith('```')) {
            text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        }

        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            text = text.slice(firstBrace, lastBrace + 1);
        }

        try {
            return JSON.parse(text);
        } catch (err) {
            const fixed = this._tryFixJson(text);
            if (fixed) return fixed;
            throw new Error(`JSON 解析失败: ${err.message}`);
        }
    }

    _tryFixJson(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return null;
        const openBraces = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
        const openBrackets = (trimmed.match(/\[/g) || []).length - (trimmed.match(/\]/g) || []).length;
        if (openBraces < 0 || openBrackets < 0) return null;
        const fixed = trimmed + ']'.repeat(openBrackets) + '}'.repeat(openBraces);
        try {
            return JSON.parse(fixed);
        } catch (_) {
            return null;
        }
    }

    _getProfileList(field) {
        return this._getProfileListFrom(this._profile, field);
    }

    _getProfileListFrom(profile, field) {
        if (!field) return null;
        if (field === 'preferences.likes') return profile.preferences?.likes || [];
        if (field === 'preferences.dislikes') return profile.preferences?.dislikes || [];
        return Array.isArray(profile[field]) ? profile[field] : [];
    }

    _setProfileList(field, list) {
        if (field === 'preferences.likes') {
            this._profile.preferences.likes = list;
        } else if (field === 'preferences.dislikes') {
            this._profile.preferences.dislikes = list;
        } else {
            this._profile[field] = list;
        }
    }

    _profileMetaKey(field, text) {
        return crypto.createHash('sha1')
            .update(`${field}:${this._normalizeComparable(text)}`)
            .digest('hex')
            .slice(0, 16);
    }

    _limitItems(items) {
        const max = this._numberCfg('max_items_per_field', 20);
        const seen = new Set();
        const result = [];
        for (const item of Array.isArray(items) ? items : []) {
            const text = this._cleanText(typeof item === 'string' ? item : (item?.text || item?.item || JSON.stringify(item)));
            if (!text) continue;
            const key = this._normalizeComparable(text);
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(text);
            if (result.length >= max) break;
        }
        return result;
    }

    _cleanText(text) {
        if (text === null || text === undefined) return '';
        return String(text).replace(/\s+/g, ' ').trim();
    }

    _normalizeComparable(text) {
        return this._cleanText(text).toLowerCase().replace(/[，。！？、,.!?；;："“”'‘’\s]/g, '');
    }

    _resolveLivePath(filePath) {
        if (path.isAbsolute(filePath)) return filePath;
        return path.join(LIVE2D_ROOT, filePath);
    }

    _trimTrailingSlash(url) {
        return String(url || '').replace(/\/+$/, '');
    }

    _numberCfg(key, fallback) {
        return this._numberValue(this._cfg[key], fallback);
    }

    _numberValue(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    _nowIso() {
        return new Date().toISOString();
    }

    _today() {
        return this._dateOnly(new Date());
    }

    _dateOnly(value) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    _daysBetween(a, b) {
        const da = new Date(a);
        const db = new Date(b);
        if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
        const ms = db.setHours(0, 0, 0, 0) - da.setHours(0, 0, 0, 0);
        return Math.max(0, Math.floor(ms / 86400000));
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    async _withTimeout(promise, ms) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('timeout')), ms);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
}

module.exports = UserProfilePlugin;
