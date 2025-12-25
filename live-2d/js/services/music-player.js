// music-player.js - 支持分离音频的音乐播放模块（增强版 - 自动麦克风动作）
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class MusicPlayer {
    constructor(modelController) {
        this.modelController = modelController; // 用来控制嘴型
        this.musicFolder = 'song-library\\output';
        this.currentAudio = null;
        this.accAudio = null;      // 伴奏音频
        this.vocalAudio = null;    // 人声音频
        this.isPlaying = false;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;

        // 新增：情绪动作映射器引用
        this.emotionMapper = null;

        // 支持的音频格式
        this.supportedFormats = ['.mp3', '.wav', '.m4a', '.ogg'];
    }

    // 新增：设置情绪动作映射器
    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
        console.log('音乐播放器已设置情绪动作映射器');
    }

    // 新增：触发麦克风动作
    triggerMicrophoneMotion() {
        if (this.emotionMapper) {
            // 触发麦克风动作（索引8，对应Ctrl+Shift+9）
            this.emotionMapper.playMotion(8);
            console.log('已触发麦克风动作');
        } else {
            console.warn('情绪动作映射器未设置，无法触发麦克风动作');
        }
    }

    // 初始化音频分析器
    async initAudioAnalyzer() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    // 播放分离音频（伴奏+人声）- 增强版
    async playDualTrackSong(songFile, metadata = null) {
        if (this.isPlaying) {
            this.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 如果没有传入元数据，尝试解析
        if (!metadata) {
            metadata = await this.parseMetadata(songFile);
        }

        // 提取基础文件名
        const baseName = songFile.replace(/-(Acc|Vocal)\..*$/, '');
        const accFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Acc'));
        const vocalFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Vocal'));

        if (!accFile || !vocalFile) {
            console.log('未找到完整的分离音频，使用单音频播放');
            return this.playSingleTrackSong(songFile);
        }

        console.log('播放分离音频:', { 伴奏: accFile, 人声: vocalFile });

        try {
            await this.initAudioAnalyzer();

            // 创建两个音频对象
            const accPath = path.join(this.musicFolder, accFile);
            const vocalPath = path.join(this.musicFolder, vocalFile);

            this.accAudio = new Audio(`file:///${accPath.replace(/\\/g, '/')}`);
            this.vocalAudio = new Audio(`file:///${vocalPath.replace(/\\/g, '/')}`);

            this.currentAudio = this.accAudio; // 主音频用于控制播放状态
            this.isPlaying = true;

            // 🎤 新增：在开始播放时触发麦克风动作
            this.triggerMicrophoneMotion();

            // 只用人声音频连接到分析器（驱动口型）
            const vocalSource = this.audioContext.createMediaElementSource(this.vocalAudio);
            vocalSource.connect(this.analyser);

            // 伴奏音频直接连接到输出（只用于听觉）
            const accSource = this.audioContext.createMediaElementSource(this.accAudio);
            accSource.connect(this.audioContext.destination);

            // 人声音频也要连接到输出（但音量可以调低一点）
            const vocalGain = this.audioContext.createGain();
            vocalGain.gain.value = 0.8; // 人声稍微小一点，让伴奏更突出
            vocalSource.connect(vocalGain);
            vocalGain.connect(this.audioContext.destination);

            // 开始嘴型动画
            this.startMouthAnimation();

            // 🎵 开始歌词同步
            if (metadata && metadata.lyrics && metadata.lyrics !== '暂无歌词') {
                // 使用伴奏音频作为时间基准
                this.startLyricsSync(this.accAudio, metadata.lyrics);
            }

            // 设置播放结束事件（以伴奏为准）
            this.accAudio.onended = () => {
                this.stopMouthAnimation();
                this.stopLyricsSync(); // 停止歌词同步并隐藏气泡
                this.isPlaying = false;
                if (this.vocalAudio) {
                    this.vocalAudio.pause();
                }
                console.log('分离音频播放完毕:', baseName);

                // 🎤 新增：播放结束时播放默认动作，取消麦克风状态
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                    console.log('播放结束，已恢复默认动作');
                }
            };

            // 设置错误处理
            this.accAudio.onerror = (error) => {
                console.error('伴奏音频播放错误:', error);
                this.stopMouthAnimation();
                this.isPlaying = false;
                // 错误时也恢复默认动作
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                }
            };

            this.vocalAudio.onerror = (error) => {
                console.error('人声音频播放错误:', error);
                this.stopMouthAnimation();
                this.isPlaying = false;
                // 错误时也恢复默认动作
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                }
            };

            // 同步播放两个音频
            await Promise.all([
                this.accAudio.play(),
                this.vocalAudio.play()
            ]);

        } catch (error) {
            console.error('播放分离音频失败:', error);
            this.isPlaying = false;
            // 失败时也恢复默认动作
            if (this.emotionMapper) {
                this.emotionMapper.playDefaultMotion();
            }
        }
    }

    // 播放单音频（原来的方法）- 增强版
    async playSingleTrackSong(songFile, metadata = null) {
        if (this.isPlaying) {
            this.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 如果没有传入元数据，尝试解析
        if (!metadata) {
            metadata = await this.parseMetadata(songFile);
        }

        const songPath = path.join(this.musicFolder, songFile);
        console.log('开始播放单音频:', songFile);

        try {
            await this.initAudioAnalyzer();

            this.currentAudio = new Audio(`file:///${songPath.replace(/\\/g, '/')}`);
            this.isPlaying = true;

            // 🎤 新增：在开始播放时触发麦克风动作
            this.triggerMicrophoneMotion();

            // 连接音频分析器
            const source = this.audioContext.createMediaElementSource(this.currentAudio);
            source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            // 开始嘴型动画
            this.startMouthAnimation();

            // 🎵 开始歌词同步
            if (metadata && metadata.lyrics && metadata.lyrics !== '暂无歌词') {
                this.startLyricsSync(this.currentAudio, metadata.lyrics);
            }

            // 设置播放结束事件
            this.currentAudio.onended = () => {
                this.stopMouthAnimation();
                this.stopLyricsSync(); // 停止歌词同步并隐藏气泡
                this.isPlaying = false;
                console.log('单音频播放完毕:', songFile);

                // 🎤 新增：播放结束时播放默认动作，取消麦克风状态
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                    console.log('播放结束，已恢复默认动作');
                }
            };

            // 设置错误处理
            this.currentAudio.onerror = (error) => {
                console.error('单音频播放错误:', error);
                this.stopMouthAnimation();
                this.isPlaying = false;
                // 错误时也恢复默认动作
                if (this.emotionMapper) {
                    this.emotionMapper.playDefaultMotion();
                }
            };

            // 开始播放
            await this.currentAudio.play();
        } catch (error) {
            console.error('播放单音频失败:', error);
            this.isPlaying = false;
            // 失败时也恢复默认动作
            if (this.emotionMapper) {
                this.emotionMapper.playDefaultMotion();
            }
        }
    }

    // 从网易云音乐获取歌词 (备选源) - 使用原生https模块绕过CORS
    async fetchNeteaseLyrics(artist, title) {
        console.log(`尝试从网易云音乐获取歌词: ${artist} - ${title}`);
        const https = require('https');

        const makeRequest = (url, headers = {}) => {
            return new Promise((resolve, reject) => {
                const options = {
                    headers: {
                        'Cookie': 'appver=1.5.0.75771;',
                        'Referer': 'https://music.163.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        ...headers
                    }
                };

                https.get(url, options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(e);
                        }
                    });
                }).on('error', (err) => {
                    reject(err);
                });
            });
        };

        try {
            // 1. 搜索歌曲ID
            // 注意：这里需要对查询参数进行编码
            const query = encodeURIComponent(`${artist} ${title}`);
            const searchUrl = `https://music.163.com/api/search/get/web?s=${query}&type=1&limit=1`;

            const searchData = await makeRequest(searchUrl);

            if (!searchData || !searchData.result || !searchData.result.songs || searchData.result.songs.length === 0) {
                console.log('网易云音乐未找到该歌曲');
                return null;
            }

            const songId = searchData.result.songs[0].id;
            console.log(`网易云音乐找到歌曲ID: ${songId}`);

            // 2. 获取歌词
            const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
            const lyricData = await makeRequest(lyricUrl);

            if (lyricData && lyricData.lrc && lyricData.lrc.lyric) {
                console.log('成功从网易云音乐获取歌词');
                return lyricData.lrc.lyric;
            }

        } catch (error) {
            console.log('网易云音乐获取歌词失败:', error.message);
        }
        return null;
    }

    // 在线获取歌词
    async fetchOnlineLyrics(artist, title, baseName) {
        if (artist === '未知歌手' || !title) return null;

        console.log(`正在尝试在线获取歌词: ${artist} - ${title}`);

        let lyrics = null;

        // 1. 尝试 lrclib.net (首选)
        try {
            const response = await axios.get('https://lrclib.net/api/get', {
                params: {
                    artist_name: artist,
                    track_name: title
                },
                timeout: 5000 // 5秒超时
            });

            if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
                lyrics = response.data.syncedLyrics || response.data.plainLyrics;
                console.log('成功从 lrclib.net 获取歌词');
            }
        } catch (error) {
            console.log('lrclib.net 获取歌词失败:', error.message);
        }

        // 2. 如果失败，尝试网易云音乐 (备选)
        if (!lyrics) {
            lyrics = await this.fetchNeteaseLyrics(artist, title);
        }

        // 3. 保存歌词
        if (lyrics) {
            try {
                // 保存为本地文件
                const lrcPath = path.join(this.musicFolder, `${baseName}.lrc`);
                fs.writeFileSync(lrcPath, lyrics, 'utf8');
                console.log(`歌词已保存到: ${lrcPath}`);
                return lyrics;
            } catch (saveError) {
                console.error('保存歌词文件失败:', saveError);
            }
        }

        return null;
    }

    // 解析元数据（歌手、标题、歌词）
    async parseMetadata(filename) {
        // 移除扩展名和后缀
        const baseName = filename.replace(/-(Acc|Vocal)\..*$/, '').replace(/\.(mp3|wav|m4a|ogg)$/i, '');

        let artist = '未知歌手';
        let title = baseName;

        // 尝试解析 "歌手 - 标题" 格式
        if (baseName.includes(' - ')) {
            const parts = baseName.split(' - ');
            if (parts.length >= 2) {
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim(); // 处理标题中可能包含 " - " 的情况
            }
        }

        // 尝试读取歌词文件
        let lyrics = '暂无歌词';
        let lyricsFound = false;

        try {
            // 尝试 .lrc 和 .txt
            const lrcPath = path.join(this.musicFolder, `${baseName}.lrc`);
            const txtPath = path.join(this.musicFolder, `${baseName}.txt`);

            if (fs.existsSync(lrcPath)) {
                lyrics = fs.readFileSync(lrcPath, 'utf8');
                console.log(`已加载LRC歌词: ${baseName}`);
                lyricsFound = true;
            } else if (fs.existsSync(txtPath)) {
                lyrics = fs.readFileSync(txtPath, 'utf8');
                console.log(`已加载TXT歌词: ${baseName}`);
                lyricsFound = true;
            }
        } catch (error) {
            console.error('读取歌词失败:', error);
        }

        // 如果本地没有歌词，尝试在线获取
        if (!lyricsFound) {
            const onlineLyrics = await this.fetchOnlineLyrics(artist, title, baseName);
            if (onlineLyrics) {
                lyrics = onlineLyrics;
            }
        }

        return {
            filename,
            baseName,
            title,
            artist,
            lyrics
        };
    }

    // 智能播放指定歌曲（自动检测是否为分离音频）
    async playSpecificSong(songFile) {
        // 提取基础文件名，去掉-Acc或-Vocal后缀
        const baseName = songFile.replace(/-(Acc|Vocal)\..*$/, '').replace(/\.(mp3|wav|m4a|ogg)$/i, '');
        const accFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Acc'));
        const vocalFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Vocal'));

        // 获取元数据
        const metadata = await this.parseMetadata(songFile);
        const resultMessage = `正在播放: ${metadata.title} - ${metadata.artist}`;

        // 如果找到分离音频，优先使用分离播放
        if (accFile && vocalFile) {
            console.log(`检测到分离音频: ${baseName}`);
            await this.playDualTrackSong(songFile, metadata);
        } else {
            // 否则使用单音频播放
            await this.playSingleTrackSong(songFile, metadata);
        }

        // 返回包含元数据的对象（将被 http-server 序列化）
        return {
            message: resultMessage,
            metadata: metadata
        };
    }

    // 获取音乐文件列表
    getMusicFiles() {
        try {
            console.log('music-player当前工作目录:', process.cwd());
            console.log('music-player解析后的音乐路径:', path.resolve(this.musicFolder));

            const files = fs.readdirSync(this.musicFolder);
            return files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return this.supportedFormats.includes(ext);
            });
        } catch (error) {
            console.error('读取音乐文件夹失败:', error);
            return [];
        }
    }

    // 随机选择一首歌
    getRandomSong() {
        const musicFiles = this.getMusicFiles();
        if (musicFiles.length === 0) {
            console.log('音乐文件夹中没有找到音频文件');
            return null;
        }

        // 过滤掉重复的分离音频，优先选择有分离版本的歌曲
        const uniqueSongs = new Map();

        musicFiles.forEach(file => {
            const baseName = file.replace(/-(Acc|Vocal)\..*$/, '').replace(/\.(mp3|wav|m4a|ogg)$/i, '');

            if (!uniqueSongs.has(baseName)) {
                uniqueSongs.set(baseName, file);
            } else {
                // 如果已经有这首歌，检查是否是分离音频
                const existing = uniqueSongs.get(baseName);
                if (file.includes('-Acc') || file.includes('-Vocal')) {
                    // 如果当前文件是分离音频，优先使用
                    uniqueSongs.set(baseName, file);
                }
            }
        });

        const songList = Array.from(uniqueSongs.values());
        const randomIndex = Math.floor(Math.random() * songList.length);
        return songList[randomIndex];
    }

    // 播放随机音乐
    async playRandomMusic() {
        if (this.isPlaying) {
            console.log('已经在播放音乐了');
            return { message: '已经在播放音乐了', metadata: null };
        }

        const songFile = this.getRandomSong();
        if (!songFile) return { message: '没有找到歌曲', metadata: null };

        return await this.playSpecificSong(songFile);
    }

    // 开始嘴型动画
    startMouthAnimation() {
        let lastMouthValue = 0;

        const updateMouth = () => {
            if (!this.isPlaying) return;

            // 获取音频频谱数据
            this.analyser.getByteFrequencyData(this.dataArray);

            // 计算音频能量变化（检测是否在唱歌）
            const currentEnergy = this.dataArray.reduce((sum, val) => sum + val * val, 0);

            // 使用滑动平均检测能量突变
            if (!this.lastEnergy) this.lastEnergy = currentEnergy;
            const energyChange = Math.abs(currentEnergy - this.lastEnergy);
            this.lastEnergy = currentEnergy;

            // 检测高频内容（人声特征）
            const highFreqStart = Math.floor(this.dataArray.length * 0.1);
            const highFreqSum = this.dataArray.slice(highFreqStart, highFreqStart + 20).reduce((sum, val) => sum + val, 0);

            // 综合判断：能量变化 + 高频内容
            const isActuallySinging = energyChange > 5000 && highFreqSum > 500;

            let mouthOpenValue = 0;
            if (isActuallySinging) {
                // 根据能量变化调整张嘴程度
                mouthOpenValue = Math.min(energyChange / 50000, 0.8);
            }

            // 平滑过渡
            lastMouthValue = lastMouthValue * 0.7 + mouthOpenValue * 0.3;

            // 更新模型嘴型
            if (this.modelController) {
                this.modelController.setMouthOpenY(lastMouthValue);
            }

            // 继续动画
            this.animationId = requestAnimationFrame(updateMouth);
        };

        updateMouth();
    }

    // 停止嘴型动画
    stopMouthAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // 重置嘴型
        if (this.modelController) {
            this.modelController.setMouthOpenY(0);
        }
    }

    // 停止播放 - 增强版
    stop() {
        // 停止所有音频
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        if (this.accAudio) {
            this.accAudio.pause();
            this.accAudio = null;
        }

        if (this.vocalAudio) {
            this.vocalAudio.pause();
            this.vocalAudio = null;
        }

        this.stopMouthAnimation();
        this.stopLyricsSync(); // 停止歌词同步
        this.isPlaying = false;
        console.log('音乐播放已停止');

        // 🎤 新增：停止播放时恢复默认动作
        if (this.emotionMapper) {
            this.emotionMapper.playDefaultMotion();
            console.log('已恢复默认动作');
        }
    }

    // 解析LRC歌词
    parseLrc(lrcContent) {
        if (!lrcContent) return [];
        const lines = lrcContent.split('\n');
        const result = [];
        const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

        for (const line of lines) {
            const match = timeExp.exec(line);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const milliseconds = parseInt(match[3].length === 3 ? match[3] : match[3] + '0');
                const time = minutes * 60 + seconds + milliseconds / 1000;
                const text = line.replace(timeExp, '').trim();
                if (text) {
                    result.push({ time, text });
                }
            }
        }
        return result;
    }

    // 开始歌词同步
    startLyricsSync(audioElement, lyricsContent) {
        this.stopLyricsSync(); // 先停止之前的

        const lyrics = this.parseLrc(lyricsContent);
        if (lyrics.length === 0) return;

        console.log(`开始歌词同步，共 ${lyrics.length} 行`);
        let currentIndex = -1;

        const updateLyrics = () => {
            if (!this.isPlaying || !audioElement) return;

            const currentTime = audioElement.currentTime;

            // 找到当前时间对应的歌词行
            // 我们寻找最后一行时间小于等于当前时间的歌词
            let newIndex = -1;
            for (let i = 0; i < lyrics.length; i++) {
                if (currentTime >= lyrics[i].time) {
                    newIndex = i;
                } else {
                    break; // 后面的时间都比当前大，不用找了
                }
            }

            // 如果索引变化了，更新显示
            if (newIndex !== currentIndex && newIndex !== -1) {
                currentIndex = newIndex;
                const text = lyrics[currentIndex].text;
                if (global.showLyricsBubble) {
                    global.showLyricsBubble(text);
                }
            }

            this.lyricsInterval = requestAnimationFrame(updateLyrics);
        };

        this.lyricsInterval = requestAnimationFrame(updateLyrics);
    }

    // 停止歌词同步
    stopLyricsSync() {
        if (this.lyricsInterval) {
            cancelAnimationFrame(this.lyricsInterval);
            this.lyricsInterval = null;
        }
        if (global.hideLyricsBubble) {
            global.hideLyricsBubble();
        }
    }

    // 检查是否正在播放
    isCurrentlyPlaying() {
        return this.isPlaying;
    }
}

module.exports = { MusicPlayer };