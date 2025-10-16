// music-player.js - 支持分离音频的音乐播放模块（增强版 - 自动麦克风动作）
const fs = require('fs');
const path = require('path');

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
    async playDualTrackSong(songFile) {
        if (this.isPlaying) {
            this.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
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

            // 设置播放结束事件（以伴奏为准）
            this.accAudio.onended = () => {
                this.stopMouthAnimation();
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
    async playSingleTrackSong(songFile) {
        if (this.isPlaying) {
            this.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
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

            // 设置播放结束事件
            this.currentAudio.onended = () => {
                this.stopMouthAnimation();
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

    // 智能播放指定歌曲（自动检测是否为分离音频）
    async playSpecificSong(songFile) {
        // 提取基础文件名，去掉-Acc或-Vocal后缀
        const baseName = songFile.replace(/-(Acc|Vocal)\..*$/, '').replace(/\.(mp3|wav|m4a|ogg)$/i, '');
        const accFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Acc'));
        const vocalFile = this.getMusicFiles().find(f => f.includes(baseName) && f.includes('-Vocal'));

        // 如果找到分离音频，优先使用分离播放
        if (accFile && vocalFile) {
            console.log(`检测到分离音频: ${baseName}`);
            return this.playDualTrackSong(songFile);
        } else {
            // 否则使用单音频播放
            return this.playSingleTrackSong(songFile);
        }
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
            return;
        }

        const songFile = this.getRandomSong();
        if (!songFile) return;

        await this.playSpecificSong(songFile);
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
        this.isPlaying = false;
        console.log('音乐播放已停止');

        // 🎤 新增：停止播放时恢复默认动作
        if (this.emotionMapper) {
            this.emotionMapper.playDefaultMotion();
            console.log('已恢复默认动作');
        }
    }

    // 检查是否正在播放
    isCurrentlyPlaying() {
        return this.isPlaying;
    }
}

module.exports = { MusicPlayer };