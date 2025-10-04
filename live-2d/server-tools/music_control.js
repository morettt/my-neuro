// musicControl.js - 音乐控制Function Call工具模块（HTTP通信版）
const http = require('http');
const fs = require('fs');
const path = require('path');

// 音乐文件夹路径
const MUSIC_FOLDER = path.join(__dirname, '..', 'song-library', 'output');
// 支持的音频格式
const SUPPORTED_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg'];

// 工具定义
const MUSIC_TOOLS = [
    {
        name: "play_random_music",
        description: "使用你的真实声音开始唱一首随机的歌曲。调用这个工具后，你就会开始用声音实际演唱，不需要再用文字模拟唱歌。直接告诉用户你在唱歌即可。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "stop_music",
        description: "停止你当前的歌曲演唱。调用后你就会停止用声音唱歌。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "list_music_files",
        description: "查看你的歌曲库中有哪些可以用声音演唱的歌曲",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "play_specific_music",
        description: "使用你的真实声音唱指定的歌曲。调用这个工具后，你就会开始用声音实际演唱指定歌曲，不需要再用文字模拟歌词。",
        parameters: {
            type: "object",
            properties: {
                filename: {
                    type: "string",
                    description: "要唱的歌曲文件名（不需要包含路径）"
                }
            },
            required: ["filename"]
        }
    }
];

// 通过HTTP调用音乐控制
async function makeRequest(action, filename = null) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ action, filename });
        
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/control-music',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result.success ? result.message : `操作失败: ${result.message}`);
                } catch (e) {
                    resolve('操作完成');
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('HTTP请求错误:', error);
            resolve('连接音乐控制服务失败，请确保应用已启动');
        });
        
        req.write(postData);
        req.end();
    });
}

// 获取音乐文件列表（本地读取）
function getMusicFiles() {
    try {

        console.log('music_control当前工作目录:', process.cwd());
        console.log('music_control解析后的音乐路径:', path.resolve(MUSIC_FOLDER));

        if (!fs.existsSync(MUSIC_FOLDER)) {
            return [];
        }
        
        const files = fs.readdirSync(MUSIC_FOLDER);
        return files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return SUPPORTED_FORMATS.includes(ext);
        });
    } catch (error) {
        console.error('读取音乐文件夹失败:', error);
        return [];
    }
}

// 播放随机音乐
async function playRandomMusic() {
    const musicFiles = getMusicFiles();
    if (musicFiles.length === 0) {
        return "我的歌曲库中没有找到任何歌曲";
    }
    
    const result = await makeRequest('play_random');
    return `开始用声音演唱随机歌曲（歌曲库共有 ${musicFiles.length} 首歌）。重要：你现在已经在用真实声音唱歌了，不要再用文字模拟歌词或"啦啦啦"等声音，只需要告诉用户你在唱歌即可。`;
}

// 停止音乐
async function stopMusic() {
    const result = await makeRequest('stop');
    return result.replace('音乐已停止', '好的，我停止唱歌了');
}

// 列出音乐文件
function listMusicFiles() {
    const musicFiles = getMusicFiles();
    
    if (musicFiles.length === 0) {
        return "我的歌曲库中没有找到任何歌曲";
    }
    
    // 过滤和清理歌曲名称，去除-Acc和-Vocal后缀，去重
    const cleanSongNames = new Set();
    
    musicFiles.forEach(file => {
        // 去除扩展名和-Acc/-Vocal后缀
        let cleanName = file.replace(/\.(mp3|wav|m4a|ogg)$/i, '');
        cleanName = cleanName.replace(/-(Acc|Vocal)$/i, '');
        cleanSongNames.add(cleanName);
    });
    
    const uniqueSongs = Array.from(cleanSongNames).sort();
    
    return `我会唱 ${uniqueSongs.length} 首歌:\n${uniqueSongs.map((song, index) => `${index + 1}. ${song}`).join('\n')}`;
}

// 播放指定音乐
async function playSpecificMusic(filename) {
    const musicFiles = getMusicFiles();
    
    if (musicFiles.length === 0) {
        return "我的歌曲库中没有找到任何歌曲";
    }
    
    // 查找匹配的文件名（支持模糊匹配）
    const matchedFile = musicFiles.find(file => 
        file.toLowerCase().includes(filename.toLowerCase()) ||
        filename.toLowerCase().includes(file.toLowerCase().replace(/\.[^/.]+$/, "")) // 去掉扩展名匹配
    );
    
    if (!matchedFile) {
        return `我不会唱这首歌: ${filename}\n我会唱这些歌:\n${musicFiles.map((file, index) => `${index + 1}. ${file}`).join('\n')}`;
    }
    
    const result = await makeRequest('play_specific', matchedFile);
    return `开始用声音演唱: ${matchedFile}。重要：你现在已经在用真实声音唱这首歌了，不要再用文字模拟歌词，只需要告诉用户你在演唱即可。`;
}

// Function Call模块接口
module.exports = {
    // 获取工具定义
    getToolDefinitions: function() {
        return MUSIC_TOOLS;
    },
    
    // 执行工具函数
    executeFunction: async function(name, parameters) {
        console.log(`执行音乐控制工具: ${name}`, parameters);
        
        switch (name) {
            case "play_random_music":
                return await playRandomMusic();
                
            case "stop_music":
                return await stopMusic();
                
            case "list_music_files":
                return listMusicFiles();
                
            case "play_specific_music":
                if (!parameters.filename) {
                    return "缺少参数: filename";
                }
                return await playSpecificMusic(parameters.filename);
                
            default:
                throw new Error(`不支持的音乐控制功能: ${name}`);
        }
    }
};