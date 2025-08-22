from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit
import json
import threading
import time
from datetime import datetime
import os

class NeuroWebInterface:
    """My-Neuro Web界面系统"""
    
    def __init__(self, port=5000, host='0.0.0.0'):
        self.app = Flask(__name__, 
                        template_folder='templates',
                        static_folder='static')
        self.app.secret_key = 'neuro-web-secret-key'
        self.socketio = SocketIO(self.app, cors_allowed_origins="*")
        
        self.port = port
        self.host = host
        self.is_running = False
        
        # 连接到主程序的引用
        self.neuro_instance = None
        self.connected_clients = set()
        
        # 设置路由
        self.setup_routes()
        self.setup_socket_events()
        
        # 创建模板和静态文件
        self.create_web_files()
        
        print(f"🌐 Web界面系统已初始化 (端口: {port})")
    
    def setup_routes(self):
        """设置路由"""
        
        @self.app.route('/')
        def index():
            return render_template('index.html')
        
        @self.app.route('/chat')
        def chat():
            return render_template('chat.html')
        
        @self.app.route('/control')
        def control():
            return render_template('control.html')
        
        @self.app.route('/api/status')
        def api_status():
            status = {
                'connected': self.neuro_instance is not None,
                'clients': len(self.connected_clients),
                'timestamp': datetime.now().isoformat()
            }
            
            if self.neuro_instance:
                # 获取系统状态
                try:
                    # 假设有获取状态的方法
                    status.update({
                        'ai_status': '在线',
                        'memory_status': '正常',
                        'emotion_status': '正常'
                    })
                except:
                    pass
            
            return jsonify(status)
        
        @self.app.route('/api/send_message', methods=['POST'])
        def api_send_message():
            data = request.get_json()
            message = data.get('message', '')
            
            if not message:
                return jsonify({'error': '消息不能为空'}), 400
            
            if not self.neuro_instance:
                return jsonify({'error': 'AI系统未连接'}), 503
            
            try:
                # 发送消息到主程序
                response = self.send_to_neuro(message)
                
                return jsonify({
                    'success': True,
                    'user_message': message,
                    'ai_response': response,
                    'timestamp': datetime.now().isoformat()
                })
            except Exception as e:
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/control/<action>', methods=['POST'])
        def api_control(action):
            if not self.neuro_instance:
                return jsonify({'error': 'AI系统未连接'}), 503
            
            try:
                result = self.execute_control_action(action)
                return jsonify({
                    'success': True,
                    'action': action,
                    'result': result
                })
            except Exception as e:
                return jsonify({'error': str(e)}), 500
    
    def setup_socket_events(self):
        """设置Socket.IO事件"""
        
        @self.socketio.on('connect')
        def handle_connect():
            client_id = request.sid
            self.connected_clients.add(client_id)
            print(f"🌐 客户端连接: {client_id}")
            
            emit('status', {
                'type': 'connection',
                'message': '已连接到My-Neuro',
                'client_id': client_id
            })
        
        @self.socketio.on('disconnect')
        def handle_disconnect():
            client_id = request.sid
            self.connected_clients.discard(client_id)
            print(f"🌐 客户端断开: {client_id}")
        
        @self.socketio.on('send_message')
        def handle_message(data):
            message = data.get('message', '')
            
            if not message:
                emit('error', {'message': '消息不能为空'})
                return
            
            if not self.neuro_instance:
                emit('error', {'message': 'AI系统未连接'})
                return
            
            try:
                # 发送用户消息到所有客户端
                self.socketio.emit('user_message', {
                    'message': message,
                    'timestamp': datetime.now().isoformat()
                })
                
                # 发送到AI系统
                response = self.send_to_neuro(message)
                
                # 发送AI响应到所有客户端
                self.socketio.emit('ai_response', {
                    'message': response,
                    'timestamp': datetime.now().isoformat()
                })
                
            except Exception as e:
                emit('error', {'message': str(e)})
        
        @self.socketio.on('control_action')
        def handle_control(data):
            action = data.get('action', '')
            
            if not self.neuro_instance:
                emit('error', {'message': 'AI系统未连接'})
                return
            
            try:
                result = self.execute_control_action(action)
                emit('control_result', {
                    'action': action,
                    'result': result,
                    'timestamp': datetime.now().isoformat()
                })
                
            except Exception as e:
                emit('error', {'message': str(e)})
    
    def create_web_files(self):
        """创建Web文件"""
        # 创建目录
        os.makedirs('web_interface/templates', exist_ok=True)
        os.makedirs('web_interface/static/css', exist_ok=True)
        os.makedirs('web_interface/static/js', exist_ok=True)
        
        # 创建主页模板
        self.create_index_template()
        
        # 创建聊天页面模板
        self.create_chat_template()
        
        # 创建控制页面模板
        self.create_control_template()
        
        # 创建CSS文件
        self.create_css_file()
        
        # 创建JavaScript文件
        self.create_js_file()
    
    def create_index_template(self):
        """创建主页模板"""
        html_content = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My-Neuro Web界面</title>
    <link rel="stylesheet" href="/static/css/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🤖 My-Neuro Web界面</h1>
            <p>欢迎来到My-Neuro AI伙伴的Web控制台</p>
        </header>
        
        <main>
            <div class="features">
                <div class="feature-card">
                    <h3>💬 聊天对话</h3>
                    <p>与AI进行实时对话交流</p>
                    <a href="/chat" class="btn">开始聊天</a>
                </div>
                
                <div class="feature-card">
                    <h3>🎛️ 系统控制</h3>
                    <p>控制AI的各种功能和设置</p>
                    <a href="/control" class="btn">系统控制</a>
                </div>
                
                <div class="feature-card">
                    <h3>📊 状态监控</h3>
                    <p>查看AI系统的运行状态</p>
                    <a href="#" class="btn" onclick="checkStatus()">查看状态</a>
                </div>
            </div>
            
            <div id="status-info" class="status-panel"></div>
        </main>
    </div>
    
    <script src="/static/js/main.js"></script>
</body>
</html>'''
        
        with open('web_interface/templates/index.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
    
    def create_chat_template(self):
        """创建聊天页面模板"""
        html_content = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>聊天 - My-Neuro</title>
    <link rel="stylesheet" href="/static/css/style.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.0.1/socket.io.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>💬 与My-Neuro对话</h1>
            <a href="/" class="back-btn">← 返回主页</a>
        </header>
        
        <main>
            <div class="chat-container">
                <div id="chat-messages" class="chat-messages"></div>
                
                <div class="chat-input-container">
                    <input type="text" id="message-input" placeholder="输入您的消息..." />
                    <button id="send-btn" onclick="sendMessage()">发送</button>
                </div>
            </div>
            
            <div class="chat-status">
                <span id="connection-status">连接状态: 断开</span>
                <span id="typing-indicator"></span>
            </div>
        </main>
    </div>
    
    <script src="/static/js/chat.js"></script>
</body>
</html>'''
        
        with open('web_interface/templates/chat.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
    
    def create_control_template(self):
        """创建控制页面模板"""
        html_content = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统控制 - My-Neuro</title>
    <link rel="stylesheet" href="/static/css/style.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.0.1/socket.io.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎛️ My-Neuro 系统控制</h1>
            <a href="/" class="back-btn">← 返回主页</a>
        </header>
        
        <main>
            <div class="control-panel">
                <div class="control-section">
                    <h3>🧠 情绪控制</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('emotion_happy')">开心</button>
                        <button onclick="controlAction('emotion_sad')">难过</button>
                        <button onclick="controlAction('emotion_angry')">生气</button>
                        <button onclick="controlAction('emotion_excited')">兴奋</button>
                        <button onclick="controlAction('emotion_reset')">重置情绪</button>
                    </div>
                </div>
                
                <div class="control-section">
                    <h3>🎭 动作控制</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('motion_wave')">挥手</button>
                        <button onclick="controlAction('motion_dance')">跳舞</button>
                        <button onclick="controlAction('motion_bow')">鞠躬</button>
                        <button onclick="controlAction('toggle_movement')">切换自由移动</button>
                    </div>
                </div>
                
                <div class="control-section">
                    <h3>🎨 显示控制</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('toggle_mood_color')">切换心情颜色</button>
                        <button onclick="controlAction('toggle_subtitle')">切换字幕</button>
                        <button onclick="controlAction('random_mood')">随机心情</button>
                    </div>
                </div>
                
                <div class="control-section">
                    <h3>🎮 游戏功能</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('start_trivia')">开始问答游戏</button>
                        <button onclick="controlAction('start_riddle')">开始猜谜游戏</button>
                        <button onclick="controlAction('start_rps')">石头剪刀布</button>
                    </div>
                </div>
                
                <div class="control-section">
                    <h3>📚 教学功能</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('start_programming_lesson')">编程课程</button>
                        <button onclick="controlAction('start_language_lesson')">语言学习</button>
                        <button onclick="controlAction('list_courses')">查看课程</button>
                    </div>
                </div>
                
                <div class="control-section">
                    <h3>💾 系统操作</h3>
                    <div class="control-buttons">
                        <button onclick="controlAction('memory_summary')">记忆摘要</button>
                        <button onclick="controlAction('emotion_summary')">情绪状态</button>
                        <button onclick="controlAction('save_config')">保存配置</button>
                        <button onclick="controlAction('restart_ai')">重启AI</button>
                    </div>
                </div>
            </div>
            
            <div id="control-log" class="control-log">
                <h4>操作日志:</h4>
                <div id="log-content"></div>
            </div>
        </main>
    </div>
    
    <script src="/static/js/control.js"></script>
</body>
</html>'''
        
        with open('web_interface/templates/control.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
    
    def create_css_file(self):
        """创建CSS文件"""
        css_content = '''/* My-Neuro Web界面样式 */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #333;
    min-height: 100vh;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 30px;
    background: rgba(255, 255, 255, 0.9);
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

header h1 {
    color: #4a5568;
    margin-bottom: 10px;
}

.back-btn {
    position: absolute;
    top: 20px;
    left: 20px;
    background: #4299e1;
    color: white;
    padding: 8px 15px;
    text-decoration: none;
    border-radius: 5px;
    transition: background 0.3s;
}

.back-btn:hover {
    background: #3182ce;
}

.features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.feature-card {
    background: rgba(255, 255, 255, 0.95);
    padding: 25px;
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    text-align: center;
    transition: transform 0.3s;
}

.feature-card:hover {
    transform: translateY(-5px);
}

.feature-card h3 {
    color: #4a5568;
    margin-bottom: 15px;
}

.btn {
    display: inline-block;
    background: #4299e1;
    color: white;
    padding: 10px 20px;
    text-decoration: none;
    border-radius: 5px;
    border: none;
    cursor: pointer;
    transition: background 0.3s;
    margin-top: 15px;
}

.btn:hover {
    background: #3182ce;
}

/* 聊天界面样式 */
.chat-container {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 10px;
    padding: 20px;
    height: 70vh;
    display: flex;
    flex-direction: column;
}

.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    border: 1px solid #e2e8f0;
    border-radius: 5px;
    margin-bottom: 15px;
    background: #f7fafc;
}

.message {
    margin-bottom: 15px;
    padding: 10px;
    border-radius: 8px;
    max-width: 80%;
}

.user-message {
    background: #4299e1;
    color: white;
    margin-left: auto;
    text-align: right;
}

.ai-message {
    background: #e2e8f0;
    color: #2d3748;
}

.chat-input-container {
    display: flex;
    gap: 10px;
}

#message-input {
    flex: 1;
    padding: 10px;
    border: 1px solid #cbd5e0;
    border-radius: 5px;
    font-size: 16px;
}

#send-btn {
    padding: 10px 20px;
    background: #48bb78;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
}

#send-btn:hover {
    background: #38a169;
}

.chat-status {
    text-align: center;
    margin-top: 15px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 5px;
}

/* 控制面板样式 */
.control-panel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.control-section {
    background: rgba(255, 255, 255, 0.95);
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.control-section h3 {
    color: #4a5568;
    margin-bottom: 15px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 5px;
}

.control-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.control-buttons button {
    background: #4299e1;
    color: white;
    border: none;
    padding: 8px 12px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
    font-size: 14px;
}

.control-buttons button:hover {
    background: #3182ce;
}

.control-log {
    background: rgba(255, 255, 255, 0.95);
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    max-height: 300px;
    overflow-y: auto;
}

.control-log h4 {
    color: #4a5568;
    margin-bottom: 10px;
}

#log-content {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    background: #f7fafc;
    padding: 10px;
    border-radius: 5px;
    white-space: pre-wrap;
}

.status-panel {
    background: rgba(255, 255, 255, 0.95);
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-top: 20px;
}

/* 响应式设计 */
@media (max-width: 768px) {
    .container {
        padding: 10px;
    }
    
    .features {
        grid-template-columns: 1fr;
    }
    
    .control-panel {
        grid-template-columns: 1fr;
    }
    
    .control-buttons {
        justify-content: center;
    }
}'''
        
        with open('web_interface/static/css/style.css', 'w', encoding='utf-8') as f:
            f.write(css_content)
    
    def create_js_file(self):
        """创建JavaScript文件"""
        # 主页JS
        main_js = '''// My-Neuro 主页脚本

async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        const statusPanel = document.getElementById('status-info');
        statusPanel.innerHTML = `
            <h3>📊 系统状态</h3>
            <p><strong>连接状态:</strong> ${status.connected ? '✅ 已连接' : '❌ 未连接'}</p>
            <p><strong>客户端数:</strong> ${status.clients}</p>
            <p><strong>AI状态:</strong> ${status.ai_status || '未知'}</p>
            <p><strong>记忆状态:</strong> ${status.memory_status || '未知'}</p>
            <p><strong>情绪状态:</strong> ${status.emotion_status || '未知'}</p>
            <p><strong>更新时间:</strong> ${new Date(status.timestamp).toLocaleString()}</p>
        `;
        statusPanel.style.display = 'block';
    } catch (error) {
        alert('获取状态失败: ' + error.message);
    }
}

// 页面加载时自动检查状态
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(checkStatus, 1000);
});'''
        
        with open('web_interface/static/js/main.js', 'w', encoding='utf-8') as f:
            f.write(main_js)
        
        # 聊天页面JS
        chat_js = '''// My-Neuro 聊天脚本

const socket = io();
let isConnected = false;

// Socket事件处理
socket.on('connect', function() {
    isConnected = true;
    updateConnectionStatus('已连接');
    console.log('Socket连接成功');
});

socket.on('disconnect', function() {
    isConnected = false;
    updateConnectionStatus('连接断开');
    console.log('Socket连接断开');
});

socket.on('user_message', function(data) {
    addMessage(data.message, 'user', data.timestamp);
});

socket.on('ai_response', function(data) {
    addMessage(data.message, 'ai', data.timestamp);
    hideTypingIndicator();
});

socket.on('error', function(data) {
    alert('错误: ' + data.message);
    hideTypingIndicator();
});

function updateConnectionStatus(status) {
    document.getElementById('connection-status').textContent = '连接状态: ' + status;
}

function addMessage(message, sender, timestamp) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const time = new Date(timestamp).toLocaleTimeString();
    messageDiv.innerHTML = `
        <div class="message-content">${message}</div>
        <div class="message-time">${time}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!isConnected) {
        alert('未连接到服务器');
        return;
    }
    
    // 清空输入框
    input.value = '';
    
    // 显示正在输入指示器
    showTypingIndicator();
    
    // 发送消息
    socket.emit('send_message', { message: message });
}

function showTypingIndicator() {
    document.getElementById('typing-indicator').textContent = '肥牛正在输入...';
}

function hideTypingIndicator() {
    document.getElementById('typing-indicator').textContent = '';
}

// 回车发送消息
document.getElementById('message-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// 页面加载完成后聚焦输入框
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('message-input').focus();
});'''
        
        with open('web_interface/static/js/chat.js', 'w', encoding='utf-8') as f:
            f.write(chat_js)
        
        # 控制页面JS  
        control_js = '''// My-Neuro 控制脚本

const socket = io();

socket.on('connect', function() {
    console.log('控制面板已连接');
    addLog('✅ 控制面板已连接');
});

socket.on('control_result', function(data) {
    addLog(`✅ ${data.action}: ${data.result}`);
});

socket.on('error', function(data) {
    addLog(`❌ 错误: ${data.message}`);
});

function controlAction(action) {
    if (!socket.connected) {
        alert('未连接到服务器');
        return;
    }
    
    addLog(`🎛️ 执行操作: ${action}`);
    socket.emit('control_action', { action: action });
}

function addLog(message) {
    const logContent = document.getElementById('log-content');
    const timestamp = new Date().toLocaleTimeString();
    logContent.textContent += `[${timestamp}] ${message}\\n`;
    logContent.scrollTop = logContent.scrollHeight;
}

// 页面加载完成后添加欢迎消息
document.addEventListener('DOMContentLoaded', function() {
    addLog('🎛️ My-Neuro 控制面板已就绪');
});'''
        
        with open('web_interface/static/js/control.js', 'w', encoding='utf-8') as f:
            f.write(control_js)
    
    def send_to_neuro(self, message: str) -> str:
        """发送消息到Neuro主程序"""
        if not self.neuro_instance:
            return "❌ AI系统未连接"
        
        try:
            # 这里需要调用主程序的聊天方法
            # 假设主程序有一个处理消息的方法
            if hasattr(self.neuro_instance, 'process_web_message'):
                return self.neuro_instance.process_web_message(message)
            else:
                return "🤖 收到消息: " + message
        except Exception as e:
            return f"❌ 处理消息时出错: {str(e)}"
    
    def execute_control_action(self, action: str) -> str:
        """执行控制操作"""
        if not self.neuro_instance:
            return "AI系统未连接"
        
        try:
            # 情绪控制
            if action.startswith('emotion_'):
                emotion = action.replace('emotion_', '')
                if emotion == 'reset':
                    if hasattr(self.neuro_instance, 'reset_emotions'):
                        self.neuro_instance.reset_emotions()
                    return "情绪已重置"
                else:
                    if hasattr(self.neuro_instance, 'trigger_emotion'):
                        self.neuro_instance.trigger_emotion(emotion)
                    return f"已触发{emotion}情绪"
            
            # 动作控制
            elif action.startswith('motion_'):
                motion = action.replace('motion_', '')
                if hasattr(self.neuro_instance, 'trigger_motion'):
                    self.neuro_instance.trigger_motion(motion)
                return f"已执行{motion}动作"
            
            # 显示控制
            elif action == 'toggle_mood_color':
                if hasattr(self.neuro_instance, 'toggle_mood_color'):
                    self.neuro_instance.toggle_mood_color()
                return "心情颜色已切换"
            
            elif action == 'toggle_movement':
                if hasattr(self.neuro_instance, 'toggle_free_movement'):
                    self.neuro_instance.toggle_free_movement()
                return "自由移动已切换"
            
            elif action == 'random_mood':
                if hasattr(self.neuro_instance, 'trigger_random_mood'):
                    self.neuro_instance.trigger_random_mood()
                return "已触发随机心情"
            
            # 游戏功能
            elif action.startswith('start_'):
                game_type = action.replace('start_', '')
                if hasattr(self.neuro_instance, 'start_game'):
                    result = self.neuro_instance.start_game(game_type)
                    return result
                return f"已启动{game_type}游戏"
            
            # 教学功能
            elif action.endswith('_lesson'):
                subject = action.replace('_lesson', '').replace('start_', '')
                if hasattr(self.neuro_instance, 'start_lesson'):
                    result = self.neuro_instance.start_lesson(subject)
                    return result
                return f"已启动{subject}课程"
            
            elif action == 'list_courses':
                if hasattr(self.neuro_instance, 'list_courses'):
                    return self.neuro_instance.list_courses()
                return "课程列表功能暂不可用"
            
            # 系统操作
            elif action == 'memory_summary':
                if hasattr(self.neuro_instance, 'get_memory_summary'):
                    return self.neuro_instance.get_memory_summary()
                return "记忆摘要功能暂不可用"
            
            elif action == 'emotion_summary':
                if hasattr(self.neuro_instance, 'get_emotion_status'):
                    return self.neuro_instance.get_emotion_status()
                return "情绪状态功能暂不可用"
            
            elif action == 'save_config':
                if hasattr(self.neuro_instance, 'save_config'):
                    self.neuro_instance.save_config()
                return "配置已保存"
            
            elif action == 'restart_ai':
                if hasattr(self.neuro_instance, 'restart'):
                    self.neuro_instance.restart()
                return "AI系统重启中..."
            
            else:
                return f"未知操作: {action}"
        
        except Exception as e:
            return f"执行操作时出错: {str(e)}"
    
    def connect_to_neuro(self, neuro_instance):
        """连接到Neuro主程序实例"""
        self.neuro_instance = neuro_instance
        print("🌐 已连接到My-Neuro主程序")
    
    def start_server(self):
        """启动Web服务器"""
        if self.is_running:
            print("⚠️ Web服务器已经在运行")
            return
        
        def run_server():
            self.is_running = True
            print(f"🌐 Web界面启动在 http://{self.host}:{self.port}")
            self.socketio.run(self.app, host=self.host, port=self.port, debug=False)
        
        # 在单独线程中运行服务器
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        
        return server_thread
    
    def stop_server(self):
        """停止Web服务器"""
        self.is_running = False
        # Socket.IO服务器会在主程序退出时自动关闭
        print("🌐 Web服务器已停止")
    
    def broadcast_message(self, message_type: str, data: dict):
        """向所有客户端广播消息"""
        if self.socketio and self.connected_clients:
            self.socketio.emit(message_type, data)
    
    def get_status(self) -> dict:
        """获取Web界面状态"""
        return {
            'is_running': self.is_running,
            'port': self.port,
            'host': self.host,
            'connected_clients': len(self.connected_clients),
            'neuro_connected': self.neuro_instance is not None
        }