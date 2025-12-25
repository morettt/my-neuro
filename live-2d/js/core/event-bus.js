// event-bus.js - 全局事件总线
// 用于解耦模块间通信，替代直接调用和global变量

class EventBus {
    constructor() {
        this.events = new Map();
    }

    // 监听事件
    on(eventName, callback) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }
        this.events.get(eventName).push(callback);
        console.log(`[EventBus] 注册监听器: ${eventName}`);
    }

    // 移除监听
    off(eventName, callback) {
        if (!this.events.has(eventName)) return;

        const callbacks = this.events.get(eventName);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
            console.log(`[EventBus] 移除监听器: ${eventName}`);
        }
    }

    // 触发事件
    emit(eventName, data) {
        console.log(`[EventBus] 触发事件: ${eventName}`, data);

        if (!this.events.has(eventName)) return;

        const callbacks = this.events.get(eventName);
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[EventBus] 事件处理器错误 (${eventName}):`, error);
            }
        });
    }

    // 一次性监听
    once(eventName, callback) {
        const onceWrapper = (data) => {
            callback(data);
            this.off(eventName, onceWrapper);
        };
        this.on(eventName, onceWrapper);
    }

    // 清空所有监听器
    clear() {
        this.events.clear();
        console.log('[EventBus] 已清空所有监听器');
    }
}

// 导出单例
const eventBus = new EventBus();
module.exports = { eventBus };
