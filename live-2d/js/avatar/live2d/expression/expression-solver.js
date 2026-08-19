'use strict';

const {
    FacialRegion,
    clampSemanticValue,
    neutralValue,
    semanticActionsOverlap
} = require('./semantic-actions.js');

const REGION_DIVERSITY_BONUS = 0.12;

class ExpressionHistory {
    constructor(capacity = 20) {
        this.capacity = Math.max(1, Number(capacity) || 20);
        this.queue = [];
    }

    recent() {
        return this.queue.map(item => ({
            unitIds: new Set(item.unitIds),
            emotion: item.emotion
        }));
    }

    record(signature) {
        this.queue.unshift({
            unitIds: new Set(signature.unitIds || []),
            emotion: signature.emotion
        });
        if (this.queue.length > this.capacity) this.queue.length = this.capacity;
    }

    penalty(candidate, historyAvoidance) {
        const avoidance = Math.max(0, Number(historyAvoidance) || 0);
        if (this.queue.length === 0 || avoidance <= 0) return 0;

        const candidateIds = new Set(candidate.unitIds || []);
        let maxWeighted = 0;
        for (let index = 0; index < this.queue.length; index++) {
            const historical = this.queue[index];
            const union = new Set([...candidateIds, ...historical.unitIds]);
            const unitJaccard = union.size === 0
                ? 1
                : intersectionSize(candidateIds, historical.unitIds) / union.size;
            const emotionMatch = candidate.emotion === historical.emotion ? 1 : 0;
            const similarity = Math.pow(unitJaccard * 0.65 + emotionMatch * 0.35, 2);
            const recencyWeight = Math.max(0, 1 - index / this.capacity);
            maxWeighted = Math.max(maxWeighted, similarity * recencyWeight);
        }
        return maxWeighted * avoidance;
    }

    snapshot() {
        return this.recent();
    }

    restore(snapshot) {
        this.queue = Array.isArray(snapshot)
            ? snapshot.slice(0, this.capacity).map(item => ({
                unitIds: new Set(item.unitIds || []),
                emotion: item.emotion
            }))
            : [];
    }

    get recentUnitIds() {
        return new Set(this.queue.flatMap(item => [...item.unitIds]));
    }

    get length() {
        return this.queue.length;
    }
}

class ExpressionSolver {
    constructor(units = [], rules = [], options = {}) {
        this.units = Array.isArray(units) ? units : [];
        this.rules = Array.isArray(rules) ? rules : [];
        this.history = options.history || new ExpressionHistory(options.historyCapacity || 20);
        this.topCandidates = Math.max(1, Number(options.topCandidates) || 14);
        this.typicalityFloor = clamp(options.typicalityFloor ?? 0.3, 0, 1);
        const typicalityPower = Number(options.typicalityPower);
        this.typicalityPower = Number.isFinite(typicalityPower)
            ? Math.max(0, typicalityPower)
            : 0.5;
        this.random = typeof options.random === 'function' ? options.random : Math.random;
    }

    solve(request) {
        const result = this._run(normalizeRequest(request));
        this.history.record({
            unitIds: result.units.map(unit => unit.id),
            emotion: result.emotion
        });
        return result;
    }

    preview(request) {
        return this._run(normalizeRequest(request));
    }

    _run(request) {
        const candidates = this._scoreUnits(request, this.history.recentUnitIds);
        if (candidates.length === 0) return emptyResult(request.emotion);

        const ranked = candidates
            .map(candidate => ({ candidate, rank: this._rank(candidate, request) }))
            .sort((left, right) => right.rank - left.rank)
            .map(item => item.candidate);
        return this._makeResult(this._buildCombo(ranked, request), request);
    }

    _resolveCorrelation(unit, emotion) {
        if (Object.prototype.hasOwnProperty.call(unit.emotions || {}, emotion)) {
            return {
                correlation: Number(unit.emotions[emotion]) || 0,
                viaBaseline: false
            };
        }
        const baseline = Number(unit.baseline) || 0;
        return { correlation: baseline, viaBaseline: baseline > 0 };
    }

    _peakCorrelation(unit) {
        return Math.max(
            Number(unit.baseline) || 0,
            ...Object.values(unit.emotions || {}).map(value => Number(value) || 0)
        );
    }

    _scoreUnits(request, recentIds) {
        const scored = [];
        for (const unit of this.units) {
            if (!unit || unit.enabled === false) continue;
            const { correlation, viaBaseline } = this._resolveCorrelation(unit, request.emotion);
            if (correlation <= 0) continue;
            const peak = this._peakCorrelation(unit);
            const typicality = peak > 0 ? correlation / peak : 0;
            if (typicality < this.typicalityFloor) continue;
            const novelty = recentIds.has(unit.id) ? 0.35 : 1;
            // 跨区域加分只给语义复合 AU：原生单元的多区域是定义使然，
            // 吃加分会让预制文件（exp3 固定 3 区域 +0.24）系统性霸榜。
            const regionBonus = unit.kind === 'semantic'
                ? Math.max(0, new Set(unit.regions || []).size - 1) * REGION_DIVERSITY_BONUS
                : 0;
            scored.push({
                unit,
                score: correlation * 0.8 + novelty * 0.2 + regionBonus,
                correlation,
                typicality,
                viaBaseline
            });
        }
        return scored
            .sort((left, right) => right.score - left.score)
            .slice(0, this.topCandidates);
    }

    _rank(scored, request) {
        if (request.randomness <= 0) return scored.score;
        return scored.score + this._uniform(-1, 1) * request.randomness * request.diversity * 0.3;
    }

    _selectionDecision(scored, request) {
        if (request.randomness <= 0) return true;
        let base;
        if (scored.score >= request.coreScore || scored.correlation >= 0.8) {
            base = 1;
        } else {
            base = Math.min(
                1,
                Math.max(0.05, scored.score) * (0.55 + request.diversity * 0.55) + scored.correlation * 0.2
            );
        }
        const probability = base * Math.pow(scored.typicality, this.typicalityPower);
        return this._random() <= probability;
    }

    _buildCombo(ranked, request) {
        const combo = [];
        let unmet = 1;

        for (const candidate of ranked) {
            if (combo.length >= request.maxUnits) break;
            if (candidate.viaBaseline && combo.length === 0) continue;
            if (!this._selectionDecision(candidate, request)) continue;

            const conflicts = this._findConflicts(candidate, combo, request.emotion);
            if (conflicts.length > 0) {
                if (candidate.viaBaseline) continue;
                const strongest = Math.max(...conflicts.map(item => item.score));
                const strongestWeight = Math.max(...conflicts.map(item => unitControlWeight(item.unit)));
                const replaceMargin = 0.03 + Math.max(0, strongestWeight - unitControlWeight(candidate.unit)) * 0.08;
                if (candidate.score <= strongest + replaceMargin) continue;
                for (const conflict of conflicts) {
                    const index = combo.indexOf(conflict);
                    if (index >= 0) combo.splice(index, 1);
                }
            }

            combo.push(candidate);
            unmet *= 1 - clamp(candidate.correlation, 0, 1);
            const coveredRegions = new Set(combo.flatMap(item => item.unit.regions || []));
            if (
                request.randomness > 0 &&
                1 - unmet >= 0.9 &&
                coveredRegions.size >= 2 &&
                this._random() > request.diversity
            ) {
                break;
            }
        }
        return combo;
    }

    _findConflicts(candidate, combo, emotion) {
        const conflicts = [];
        const candidateActions = candidate.unit.kind === 'semantic'
            ? new Set(candidate.unit.targets.map(item => item.action))
            : new Set();
        const mutualExclusionIds = new Set();

        for (const rule of this.rules) {
            if (rule?.kind !== 'mutual_exclusion') continue;
            if (Array.isArray(rule.emotions) && rule.emotions.length > 0 && !rule.emotions.includes(emotion)) continue;
            const ids = Array.isArray(rule.unitIds) ? rule.unitIds : [];
            if (ids.includes(candidate.unit.id)) {
                for (const id of ids) mutualExclusionIds.add(id);
            }
        }

        for (const existing of combo) {
            if (mutualExclusionIds.has(existing.unit.id)) {
                conflicts.push(existing);
                continue;
            }
            if (
                candidateActions.size > 0 &&
                existing.unit.kind === 'semantic' &&
                actionsOverlap(candidateActions, new Set(existing.unit.targets.map(item => item.action)))
            ) {
                conflicts.push(existing);
            }
        }
        return conflicts;
    }

    _makeResult(combo, request) {
        const units = combo.map(item => item.unit);
        const semanticTargets = [];
        const nativeTriggers = [];
        const unitsByRegion = {};

        for (const scored of combo) {
            const unit = scored.unit;
            for (const region of unit.regions || []) {
                (unitsByRegion[region] ||= []).push(unit);
            }
            if (unit.kind === 'semantic') {
                const linkedProgress = unit.linkedSampling ? this._random() : null;
                for (const item of unit.targets) {
                    const sampled = linkedProgress === null
                        ? this._uniform(item.minValue, item.maxValue)
                        : this._uniformAt(item.minValue, item.maxValue, linkedProgress);
                    const neutral = neutralValue(item.action);
                    semanticTargets.push({
                        action: item.action,
                        value: clampSemanticValue(
                            item.action,
                            neutral + (sampled - neutral) * request.intensity
                        ),
                        easing: unit.easing || 'out_cubic'
                    });
                }
            } else if (unit.kind === 'native') {
                nativeTriggers.push({
                    nativeType: unit.nativeType,
                    nativeRef: unit.nativeRef
                });
            }
        }

        return {
            units,
            emotion: request.emotion,
            score: this._comboScore(combo, request),
            semanticTargets,
            nativeTriggers,
            unitsByRegion
        };
    }

    _comboScore(combo, request) {
        if (combo.length === 0) return 0;
        const unitIds = new Set(combo.map(item => item.unit.id));
        const regions = new Set(combo.flatMap(item => item.unit.regions || []));
        let unmet = 1;
        for (const item of combo) unmet *= 1 - clamp(item.correlation, 0, 1);
        const fulfillment = 1 - unmet;
        const typicalityAverage = combo.reduce((sum, item) => sum + item.typicality, 0) / combo.length;
        const regionSteps = Math.max(0, regions.size - 1);
        const variety = regionSteps > 0
            ? Math.log1p(regionSteps) / Math.log(Object.keys(FacialRegion).length) * 0.22 * typicalityAverage
            : 0;
        const sizePenalty = Math.max(0, combo.length - 1) * 0.04;
        const historyPenalty = this.history.penalty({
            unitIds,
            emotion: request.emotion
        }, request.historyAvoidance);
        return fulfillment + variety - sizePenalty + this._ruleScore(unitIds, request.emotion) - historyPenalty;
    }

    _ruleScore(comboIds, emotion) {
        let score = 0;
        for (const rule of this.rules) {
            if (rule?.kind !== 'bonus') continue;
            if (Array.isArray(rule.emotions) && rule.emotions.length > 0 && !rule.emotions.includes(emotion)) continue;
            const unitIds = Array.isArray(rule.unitIds) ? rule.unitIds : [];
            if (unitIds.every(id => comboIds.has(id))) score += Number(rule.value) || 0;
        }
        return score;
    }

    _random() {
        return clamp(Number(this.random()), 0, 1);
    }

    _uniform(minimum, maximum) {
        return this._uniformAt(minimum, maximum, this._random());
    }

    _uniformAt(minimum, maximum, progress) {
        const min = Number(minimum) || 0;
        const max = Number(maximum) || 0;
        return min + (max - min) * clamp(progress, 0, 1);
    }
}

function normalizeRequest(request = {}) {
    return {
        emotion: String(request.emotion || ''),
        intensity: clamp(request.intensity ?? 1, 0, 1),
        randomness: clamp(request.randomness ?? 0.5, 0, 1),
        diversity: clamp(request.diversity ?? 0.6, 0, 1),
        historyAvoidance: clamp(request.historyAvoidance ?? request.history_avoidance ?? 0.7, 0, 1),
        maxUnits: Math.max(1, Math.floor(Number(request.maxUnits ?? request.max_units) || 5)),
        coreScore: clamp(request.coreScore ?? request.core_score ?? 0.65, 0, 1)
    };
}

function emptyResult(emotion) {
    return {
        units: [],
        emotion,
        score: 0,
        semanticTargets: [],
        nativeTriggers: [],
        unitsByRegion: {}
    };
}

function actionsOverlap(left, right) {
    for (const leftAction of left) {
        for (const rightAction of right) {
            if (semanticActionsOverlap(leftAction, rightAction)) return true;
        }
    }
    return false;
}

function unitControlWeight(unit) {
    return unit?.kind === 'semantic'
        ? Math.max(1, unit.targets?.length || 0)
        : Math.max(1, unit?.regions?.length || 0);
}

function intersectionSize(left, right) {
    let count = 0;
    for (const item of left) {
        if (right.has(item)) count++;
    }
    return count;
}

function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.max(minimum, Math.min(maximum, number));
}

module.exports = {
    ExpressionHistory,
    ExpressionSolver
};
