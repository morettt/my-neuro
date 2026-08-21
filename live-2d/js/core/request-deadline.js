'use strict';

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeRequestTimeout(value, fallback = DEFAULT_REQUEST_TIMEOUT_MS) {
    const configured = Number(value);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.max(1, Math.round(configured));
    }

    const fallbackValue = Number(fallback);
    return Number.isFinite(fallbackValue) && fallbackValue > 0
        ? Math.max(1, Math.round(fallbackValue))
        : DEFAULT_REQUEST_TIMEOUT_MS;
}

function createTimeoutError(code, timeoutMs, message) {
    const error = new Error(message || `Request timed out after ${timeoutMs} ms`);
    error.name = 'TimeoutError';
    error.code = code || 'REQUEST_TIMEOUT';
    error.timeoutMs = timeoutMs;
    return error;
}

function createRequestDeadline(timeoutMs, options = {}) {
    const normalizedTimeout = normalizeRequestTimeout(timeoutMs);
    const controller = new AbortController();
    const timeoutError = createTimeoutError(
        options.code,
        normalizedTimeout,
        options.message
    );
    const parentSignal = options.parentSignal || null;
    let timedOut = false;

    const onParentAbort = () => {
        if (!controller.signal.aborted) {
            controller.abort(parentSignal.reason);
        }
    };

    if (parentSignal) {
        if (parentSignal.aborted) {
            onParentAbort();
        } else {
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
    }

    const timer = setTimeout(() => {
        timedOut = true;
        if (!controller.signal.aborted) {
            controller.abort(timeoutError);
        }
    }, normalizedTimeout);
    if (timer && typeof timer.unref === 'function') timer.unref();

    return {
        controller,
        signal: controller.signal,
        timeoutError,
        timeoutMs: normalizedTimeout,
        didTimeout: () => timedOut,
        cleanup() {
            clearTimeout(timer);
            if (parentSignal) {
                parentSignal.removeEventListener('abort', onParentAbort);
            }
        }
    };
}

function withDeadline(promise, timeoutMs, options = {}) {
    const deadline = createRequestDeadline(timeoutMs, options);
    const abortPromise = new Promise((resolve, reject) => {
        const rejectForAbort = () => {
            reject(deadline.didTimeout()
                ? deadline.timeoutError
                : (deadline.signal.reason || new Error('Request aborted')));
        };

        if (deadline.signal.aborted) {
            rejectForAbort();
            return;
        }
        deadline.signal.addEventListener('abort', rejectForAbort, { once: true });
    });

    return Promise.race([Promise.resolve(promise), abortPromise])
        .finally(() => deadline.cleanup());
}

module.exports = {
    DEFAULT_REQUEST_TIMEOUT_MS,
    normalizeRequestTimeout,
    createRequestDeadline,
    createTimeoutError,
    withDeadline
};
