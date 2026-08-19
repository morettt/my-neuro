'use strict';

function parseDuration(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeDuration(value, fallback, options = {}) {
    const fallbackNumber = parseDuration(fallback);
    if (fallbackNumber === null) {
        throw new TypeError('Duration fallback must be a finite number');
    }

    const min = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;
    const maxCandidate = Number(options.max);
    const max = Number.isFinite(maxCandidate) ? Math.max(min, maxCandidate) : Infinity;
    const parsed = parseDuration(value);
    const number = parsed === null ? fallbackNumber : parsed;
    return Math.max(min, Math.min(max, number));
}

function normalizeDurationField(source, keys, fallback, options = {}) {
    const record = source && typeof source === 'object' ? source : {};
    const candidates = Array.isArray(keys) ? keys : [keys];
    let value;
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            value = record[key];
            break;
        }
    }
    return normalizeDuration(value, fallback, options);
}

module.exports = {
    normalizeDuration,
    normalizeDurationField,
    parseDuration
};
