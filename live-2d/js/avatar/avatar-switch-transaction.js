'use strict';

const AVATAR_TYPES = new Set(['live2d', 'vrm', 'mmd', 'pngtuber']);

function normalizeAvatarType(value) {
    const type = String(value || '').trim().toLowerCase();
    return AVATAR_TYPES.has(type) ? type : null;
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

class AvatarSwitchTransaction {
    constructor(options = {}) {
        const required = [
            'readModelType',
            'updateModelType',
            'hasAvatarModel',
            'requestRendererSwitch',
            'publishModelType',
            'scheduleReload'
        ];
        for (const name of required) {
            if (typeof options[name] !== 'function') {
                throw new Error(`AvatarSwitchTransaction requires ${name}()`);
            }
        }

        this.readModelType = options.readModelType;
        this.updateModelType = options.updateModelType;
        this.hasAvatarModel = options.hasAvatarModel;
        this.requestRendererSwitch = options.requestRendererSwitch;
        this.publishModelType = options.publishModelType;
        this.scheduleReload = options.scheduleReload;
        this.log = typeof options.log === 'function' ? options.log : () => {};
        this.readyTimeoutMs = Number.isFinite(Number(options.readyTimeoutMs))
            ? Math.max(1000, Number(options.readyTimeoutMs))
            : 30000;
        this.setTimer = options.setTimer || setTimeout;
        this.clearTimer = options.clearTimer || clearTimeout;
        this._switchingWindows = new Set();
        this._pendingReloads = new Map();
    }

    async switchType(targetType, context = {}) {
        const target = normalizeAvatarType(targetType);
        const windowId = context.windowId;
        if (windowId === undefined || windowId === null) {
            return { success: false, phase: 'failed', message: '缺少切换窗口标识' };
        }
        if (!target) {
            return { success: false, phase: 'failed', message: `未知形态: ${targetType}` };
        }
        if (this._switchingWindows.has(windowId) || this._pendingReloads.has(windowId)) {
            return { success: false, phase: 'busy', targetType: target, message: '形态切换进行中' };
        }

        this._switchingWindows.add(windowId);
        try {
            if (!await this.hasAvatarModel(target, context)) {
                return {
                    success: false,
                    phase: 'failed',
                    targetType: target,
                    message: `${target} 形态没有可用模型，未切换`
                };
            }

            const previous = normalizeAvatarType(await this.readModelType(context)) || 'live2d';
            if (previous === target) {
                return {
                    success: true,
                    phase: 'ready',
                    targetType: target,
                    activeType: target,
                    reloadRequired: false,
                    message: `已是 ${target} 形态`
                };
            }

            try {
                await this.updateModelType(target, context);
            } catch (error) {
                return {
                    success: false,
                    phase: 'failed',
                    targetType: target,
                    activeType: previous,
                    message: `保存目标形态失败: ${errorMessage(error)}`
                };
            }

            let rendererResult;
            try {
                rendererResult = await this.requestRendererSwitch(target, context);
            } catch (error) {
                const rollback = await this._rollbackModelType(previous, context);
                return {
                    success: false,
                    phase: rollback.success ? 'rolled-back' : 'failed',
                    targetType: target,
                    activeType: previous,
                    restored: rollback.success,
                    message: rollback.success
                        ? `通知渲染进程失败，已恢复 ${previous}: ${errorMessage(error)}`
                        : `通知渲染进程失败，且配置回滚失败: ${rollback.message}`
                };
            }

            if (rendererResult?.success === true && rendererResult?.reloadRequired !== true) {
                await this.publishModelType(target, context);
                return {
                    success: true,
                    phase: 'ready',
                    targetType: target,
                    activeType: normalizeAvatarType(rendererResult.activeType) || target,
                    reloadRequired: false,
                    message: rendererResult.message || `已切换到 ${target}`
                };
            }

            if (rendererResult?.success === true && rendererResult?.reloadRequired === true) {
                await this.publishModelType(target, context);
                try {
                    await this._queueReload({
                        context,
                        previousType: previous,
                        targetType: target,
                        expectedType: target,
                        rollbackAttempted: false,
                        reason: rendererResult.message || '跨渲染引擎切换'
                    });
                } catch (error) {
                    const rollback = await this._rollbackModelType(previous, context);
                    if (rollback.success) await this.publishModelType(previous, context);
                    return {
                        success: false,
                        phase: rollback.success ? 'rolled-back' : 'failed',
                        targetType: target,
                        activeType: previous,
                        restored: rollback.success,
                        message: rollback.success
                            ? `窗口重载安排失败，已恢复 ${previous}: ${errorMessage(error)}`
                            : `窗口重载安排失败，且配置回滚失败: ${rollback.message}`
                    };
                }
                return {
                    success: true,
                    phase: 'reload-scheduled',
                    targetType: target,
                    activeType: normalizeAvatarType(rendererResult.activeType) || previous,
                    reloadRequired: true,
                    message: rendererResult.message || `已安排重载以切换到 ${target}`
                };
            }

            const rollback = await this._rollbackModelType(previous, context);
            if (!rollback.success) {
                return {
                    success: false,
                    phase: 'failed',
                    targetType: target,
                    activeType: normalizeAvatarType(rendererResult?.activeType),
                    restored: false,
                    message: `切换失败，且配置回滚失败: ${rollback.message}`
                };
            }
            await this.publishModelType(previous, context);

            const rendererRestored = rendererResult?.restored === true;
            const rendererUncertain = rendererResult?.reloadRequired === true
                || rendererResult?.timedOut === true
                || !rendererRestored;
            if (rendererUncertain) {
                try {
                    await this._queueReload({
                        context,
                        previousType: previous,
                        targetType: target,
                        expectedType: previous,
                        rollbackAttempted: true,
                        reason: rendererResult?.message || '切换失败后恢复旧形态'
                    });
                } catch (error) {
                    return {
                        success: false,
                        phase: 'rolled-back',
                        targetType: target,
                        activeType: rendererRestored ? previous : null,
                        restored: rendererRestored,
                        message: `配置已恢复为 ${previous}，但窗口重载安排失败: ${errorMessage(error)}`
                    };
                }
                return {
                    success: false,
                    phase: 'reload-scheduled',
                    targetType: target,
                    activeType: rendererRestored ? previous : null,
                    restored: rendererRestored,
                    reloadRequired: true,
                    message: rendererResult?.message || `切换失败，正在重载恢复 ${previous}`
                };
            }

            return {
                success: false,
                phase: 'rolled-back',
                targetType: target,
                activeType: previous,
                restored: true,
                reloadRequired: false,
                message: rendererResult?.message || `切换失败，已恢复 ${previous}`
            };
        } finally {
            this._switchingWindows.delete(windowId);
        }
    }

    async handleRuntimeReady(payload = {}) {
        const windowId = payload.windowId;
        const activeType = normalizeAvatarType(payload.activeType);
        const pending = this._pendingReloads.get(windowId);

        if (!pending) {
            return {
                success: payload.success === true,
                phase: payload.success === true ? 'ready' : 'failed',
                activeType,
                matchedPending: false,
                message: payload.message || (payload.success === true ? '运行时已就绪' : '运行时初始化失败')
            };
        }

        if (payload.success === true && activeType === pending.expectedType) {
            this._clearPending(windowId);
            this.log('info', `Avatar reload ready: ${activeType}`);
            return {
                success: true,
                phase: 'ready',
                targetType: pending.targetType,
                activeType,
                matchedPending: true,
                message: `${activeType} 形态已就绪`
            };
        }

        return this._recoverPendingReload(
            pending,
            payload.message || `运行时就绪类型不匹配: expected=${pending.expectedType}, actual=${activeType || 'none'}`
        );
    }

    hasPendingReload(windowId) {
        return this._pendingReloads.has(windowId);
    }

    clearWindow(windowId) {
        this._clearPending(windowId);
        this._switchingWindows.delete(windowId);
    }

    dispose() {
        for (const windowId of Array.from(this._pendingReloads.keys())) {
            this._clearPending(windowId);
        }
        this._switchingWindows.clear();
    }

    async _rollbackModelType(previousType, context) {
        try {
            await this.updateModelType(previousType, context);
            return { success: true };
        } catch (error) {
            return { success: false, message: errorMessage(error) };
        }
    }

    async _queueReload(pending) {
        const windowId = pending.context.windowId;
        this._clearPending(windowId);
        const entry = { ...pending, timer: null };
        this._pendingReloads.set(windowId, entry);
        this._armReadyTimeout(entry);
        try {
            await this.scheduleReload({
                context: entry.context,
                expectedType: entry.expectedType,
                targetType: entry.targetType,
                reason: entry.reason
            });
        } catch (error) {
            this._clearPending(windowId);
            throw error;
        }
    }

    _armReadyTimeout(pending) {
        if (pending.timer) this.clearTimer(pending.timer);
        pending.timer = this.setTimer(() => {
            this._recoverPendingReload(
                pending,
                `运行时未在 ${this.readyTimeoutMs}ms 内确认 ready`
            ).then((result) => {
                this.log(result.success ? 'info' : 'error', result.message);
            }).catch((error) => {
                this.log('error', `Avatar ready 超时恢复失败: ${errorMessage(error)}`);
            });
        }, this.readyTimeoutMs);
        pending.timer?.unref?.();
    }

    async _recoverPendingReload(pending, reason) {
        const windowId = pending.context.windowId;
        if (pending.rollbackAttempted) {
            this._clearPending(windowId);
            return {
                success: false,
                phase: 'failed',
                targetType: pending.targetType,
                activeType: null,
                restored: false,
                message: `${reason}；自动恢复已尝试一次，停止继续重载`
            };
        }

        const rollback = await this._rollbackModelType(pending.previousType, pending.context);
        if (!rollback.success) {
            this._clearPending(windowId);
            return {
                success: false,
                phase: 'failed',
                targetType: pending.targetType,
                activeType: null,
                restored: false,
                message: `${reason}；配置回滚失败: ${rollback.message}`
            };
        }
        await this.publishModelType(pending.previousType, pending.context);

        pending.expectedType = pending.previousType;
        pending.rollbackAttempted = true;
        pending.reason = reason;
        this._armReadyTimeout(pending);
        try {
            await this.scheduleReload({
                context: pending.context,
                expectedType: pending.previousType,
                targetType: pending.targetType,
                reason
            });
        } catch (error) {
            this._clearPending(windowId);
            return {
                success: false,
                phase: 'rolled-back',
                targetType: pending.targetType,
                activeType: null,
                restored: false,
                message: `${reason}；配置已回滚，但恢复重载安排失败: ${errorMessage(error)}`
            };
        }

        return {
            success: false,
            phase: 'rollback-reload-scheduled',
            targetType: pending.targetType,
            activeType: null,
            restored: false,
            reloadRequired: true,
            message: `${reason}；已回滚配置并安排恢复重载`
        };
    }

    _clearPending(windowId) {
        const pending = this._pendingReloads.get(windowId);
        if (pending?.timer) this.clearTimer(pending.timer);
        this._pendingReloads.delete(windowId);
    }
}

module.exports = {
    AVATAR_TYPES,
    AvatarSwitchTransaction,
    normalizeAvatarType
};
