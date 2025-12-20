class LiveStreamModule {
    constructor(config) {
        // 配置参数
        this.roomId = config.roomId || '30230160'; // 默认房间ID
        this.checkInterval = config.checkInterval || 5000; // 轮询间隔，默认5秒
        this.maxMessages = config.maxMessages || 50; // 最大缓存消息数
        this.apiUrl = config.apiUrl || 'http://api.live.bilibili.com/ajax/msg'; // 弹幕API地址
        this.onNewMessage = config.onNewMessage || null; // 新消息回调函数
        
        // 状态变量
        this.lastCheckedTimestamp = Date.now() / 1000; // 上次检查的时间戳
        this.isRunning = false; // 模块是否运行中
        this.checkTimer = null; // 轮询定时器
        this.messageCache = []; // 消息缓存
    }

    // 启动直播模块
    start() {
        if (this.isRunning) return false;
        
        this.isRunning = true;
        this.fetchBarrage(); // 立即获取一次
        
        // 设置定时获取
        this.checkTimer = setInterval(() => {
            this.fetchBarrage();
        }, this.checkInterval);
        
        console.log(`直播模块已启动，监听房间: ${this.roomId}`);
        return true;
    }

    // 停止直播模块
    stop() {
        if (!this.isRunning) return false;
        
        clearInterval(this.checkTimer);
        this.checkTimer = null;
        this.isRunning = false;
        
        console.log('直播模块已停止');
        return true;
    }

    // 获取弹幕
    async fetchBarrage() {
        try {
            // 构建API请求URL
            const url = `${this.apiUrl}?roomid=${this.roomId}`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`获取弹幕失败：HTTP状态码 ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !data.data || !data.data.room) {
                throw new Error('API返回数据格式错误');
            }
            
            const messages = data.data.room;
            
            // 过滤出新消息
            const newMessages = messages.filter(message => {
                const messageTime = new Date(message.timeline).getTime() / 1000;
                return messageTime > this.lastCheckedTimestamp;
            });
            
            // 只有在有新消息时更新时间戳
            if (newMessages.length > 0) {
                this.lastCheckedTimestamp = Date.now() / 1000;
                
                // 更新消息缓存
                this.messageCache = [...this.messageCache, ...newMessages];
                
                // 如果超过最大缓存数量，裁剪旧消息
                if (this.messageCache.length > this.maxMessages) {
                    this.messageCache = this.messageCache.slice(-this.maxMessages);
                }
                
                // 处理每条新消息
                for (const message of newMessages) {
                    if (this.onNewMessage) {
                        this.onNewMessage(message);
                    }
                }
            }
        } catch (error) {
            console.error('获取弹幕出错:', error);
        }
    }

    // 获取缓存的所有消息
    getMessages() {
        return [...this.messageCache];
    }

    // 清除消息缓存
    clearMessages() {
        this.messageCache = [];
    }

    // 修改房间ID
    setRoomId(roomId) {
        if (!roomId) return false;
        
        this.roomId = roomId;
        
        // 如果正在运行，重启以应用新的房间ID
        if (this.isRunning) {
            this.stop();
            this.start();
        }
        
        return true;
    }

    // 修改轮询间隔
    setCheckInterval(interval) {
        if (!interval || interval < 1000) return false; // 至少1秒
        
        this.checkInterval = interval;
        
        // 如果正在运行，重启以应用新的轮询间隔
        if (this.isRunning) {
            this.stop();
            this.start();
        }
        
        return true;
    }

    // 获取模块当前状态
    getStatus() {
        return {
            isRunning: this.isRunning,
            roomId: this.roomId,
            checkInterval: this.checkInterval,
            lastCheckedTimestamp: this.lastCheckedTimestamp,
            messageCount: this.messageCache.length
        };
    }
}

module.exports = { LiveStreamModule };