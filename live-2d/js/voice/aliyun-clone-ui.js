(function () {
  'use strict';
  window.initAliyunCloneUI = function ({ getSettings, persistSelection }) {
    const $ = id => document.getElementById(id);
    const api = window.controlApi;
    const cacheKey = 'feiniu.aliyun.pending-voice.v1';
    let busy = false;
    let selected = null;
    let uploaded = null;
    let audioValid = false;
    let pending = null;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && typeof cached.voice_id === 'string' && typeof cached.model === 'string') pending = cached;
    } catch { /* A damaged local draft must not prevent opening settings. */ }

    const message = (text, kind = '') => {
      $('aliyun-clone-status').textContent = text;
      $('aliyun-clone-status').dataset.kind = kind;
    };
    function cachePending() {
      try {
        if (pending) localStorage.setItem(cacheKey, JSON.stringify(pending));
        else localStorage.removeItem(cacheKey);
      } catch { /* Naming and saving still work if local draft storage is unavailable. */ }
    }
    function stage(active) {
      const stages = ['upload', 'clone'];
      $('aliyun-clone-progress').hidden = !stages.includes(active);
      document.querySelectorAll('[data-voice-step]').forEach(element => {
        const index = stages.indexOf(element.dataset.voiceStep);
        element.classList.toggle('active', element.dataset.voiceStep === active);
        element.classList.toggle('done', active === 'saved' || index < stages.indexOf(active));
      });
    }
    function controls() {
      $('aliyun-select-audio').disabled = busy || Boolean(pending);
      $('aliyun-query-voice').disabled = busy;
      $('aliyun-query-voice').hidden = !pending;
      $('aliyun-query-voice').textContent = pending?.ready ? (pending.name ? '重试保存' : '命名') : '重新检查状态';
      $('aliyun-confirm-name').disabled = busy || (!audioValid && !pending?.ready);
      $('aliyun-saved-voices').disabled = busy;
      $('aliyun-clone-box').setAttribute('aria-busy', String(busy));
    }
    function settings() {
      const current = getSettings();
      return {
        api_key: $('aliyun-key').value.trim(), model: pending?.model || 'cosyvoice-v3-flash',
        workspace_id: current.workspace_id || '', voice_id: pending?.voice_id || '',
        audio_url: uploaded?.url || '', prefix: `fn${Date.now().toString(36).slice(-8)}`
      };
    }
    function renderLibrary() {
      const voices = (Array.isArray(getSettings().voices) ? getSettings().voices : [])
        .filter(voice => voice && typeof voice.name === 'string' && voice.voice_id && voice.model);
      const select = $('aliyun-saved-voices');
      select.replaceChildren();
      const currentId = $('aliyun-voice').value;
      const currentModel = $('aliyun-model').value;
      const current = voices.find(voice => voice.voice_id === currentId && voice.model === currentModel);
      if (!current) {
        const option = document.createElement('option');
        option.value = ''; option.textContent = currentId ? '当前声线' : '未设置'; select.append(option);
      }
      voices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.voice_id; option.textContent = voice.name;
        option.selected = voice === current; select.append(option);
      });
      $('aliyun-voice-library').hidden = false;
    }
    function openNameDialog() {
      $('aliyun-voice-name').value = pending?.name || '';
      $('aliyun-voice-name').setCustomValidity('');
      const dialog = $('aliyun-name-dialog');
      if (!dialog.open) dialog.showModal();
      $('aliyun-voice-name').focus();
      controls();
    }
    async function chooseAudio(filePath) {
      if (busy || pending) return;
      busy = true; controls();
      try {
        const result = await api.selectAliyunAudio(filePath);
        if (result.canceled) return;
        if (!result.ok) throw new Error(result.message);
        const player = $('aliyun-audio-preview');
        player.pause();
        selected = result; uploaded = null; audioValid = false;
        $('aliyun-file-title').textContent = result.filename;
        $('aliyun-file-info').textContent = `${(result.size / 1024 / 1024).toFixed(2)} MB · 正在读取音频`;
        player.hidden = false; player.src = result.preview;
        message('读取中……'); stage('');
      } catch (error) { message(error.message, 'error'); }
      finally { busy = false; controls(); }
    }
    $('aliyun-select-audio').addEventListener('click', () => chooseAudio());
    const drop = $('aliyun-select-audio');
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault(); if (!busy && !pending) drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (file?.path) return chooseAudio(file.path);
      else if (file) message('无法读取该文件，请点击选择音频。', 'error');
    });
    $('aliyun-audio-preview').addEventListener('loadedmetadata', () => {
      if (!selected) return;
      const duration = $('aliyun-audio-preview').duration;
      audioValid = Number.isFinite(duration) && duration >= 5 && duration <= 60;
      $('aliyun-file-info').textContent = `${(selected.size / 1024 / 1024).toFixed(2)} MB · ${Number.isFinite(duration) ? duration.toFixed(1) : '未知'} 秒`;
      message(audioValid ? '' : '请选择 5～60 秒的音频。', audioValid ? '' : 'error');
      controls();
      if (audioValid && !busy && !pending) openNameDialog();
    });
    $('aliyun-audio-preview').addEventListener('error', () => {
      audioValid = false; message('无法播放这段音频，请更换文件。', 'error'); controls();
    });

    async function checkPending(auto = false) {
      if (!pending) return;
      stage('clone');
      for (let attempt = 0; attempt < (auto ? 20 : 1); attempt++) {
        const result = await api.queryAliyunVoice(settings());
        if (!result.ok) throw new Error(result.message);
        if (result.status === 'OK') {
          if (result.model) pending.model = result.model;
          pending.ready = true; cachePending(); stage('');
          if (pending.name) await savePending();
          else { message('克隆成功，请取名。', 'success'); openNameDialog(); }
          return;
        }
        if (result.status !== 'DEPLOYING') {
          pending = null; cachePending(); stage('');
          throw new Error('音色未通过审核，请更换清晰的人声录音后重试。');
        }
        message('正在克隆声音，请稍候……');
        if (auto && attempt < 19) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      message('仍在处理中');
    }
    async function processNamedAudio(name) {
      busy = true; controls(); $('aliyun-audio-preview').pause();
      try {
        if (!uploaded || uploaded.expires_at * 1000 <= Date.now()) {
          stage('upload'); message('正在上传参考音频……');
          const result = await api.uploadAliyunAudio();
          if (!result.ok) throw new Error(result.message);
          uploaded = result;
        }
        stage('clone'); message('上传完成，正在创建克隆声线……');
        const result = await api.enrollAliyunVoice(settings());
        if (!result.ok) throw new Error(result.message);
        pending = { voice_id: result.voice_id, model: result.model, name, ready: false };
        cachePending(); await checkPending(true);
      } catch (error) {
        message(pending ? `处理未完成：${error.message}` : error.message, 'error');
      } finally { busy = false; controls(); }
    }
    $('aliyun-query-voice').addEventListener('click', async () => {
      if (busy || !pending) return;
      busy = true; controls();
      try {
        if (pending.ready) {
          if (pending.name) await savePending();
          else openNameDialog();
        } else await checkPending(true);
      }
      catch (error) { message(error.message, 'error'); }
      finally { busy = false; controls(); }
    });
    $('aliyun-voice-name').addEventListener('input', () => {
      $('aliyun-voice-name').setCustomValidity('');
    });
    function nameError(name) {
      if (!name || name.length > 30) return '请输入 1～30 个字的角色名称。';
      const voices = Array.isArray(getSettings().voices) ? getSettings().voices : [];
      if (voices.some(voice => voice.voice_id !== pending?.voice_id && String(voice.name).toLocaleLowerCase() === name.toLocaleLowerCase())) {
        return '已经有同名角色，请换一个名字。';
      }
      return '';
    }
    async function savePending() {
      if (!pending?.ready) return;
      const error = nameError(pending.name || '');
      if (error) { openNameDialog(); throw new Error(error); }
      const voices = Array.isArray(getSettings().voices) ? getSettings().voices : [];
      const voice = { name: pending.name, voice_id: pending.voice_id, model: pending.model };
      try { await persistSelection(voice, [...voices.filter(item => item.voice_id !== voice.voice_id), voice]); }
      catch (error) { throw new Error(`保存失败：${error.message}`); }
      pending = null; cachePending(); stage('saved'); renderLibrary();
      message(`已使用“${voice.name}”`, 'success');
    }
    $('aliyun-name-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || (!audioValid && !pending?.ready)) return;
      const name = $('aliyun-voice-name').value.trim();
      const error = nameError(name);
      if (error) {
        $('aliyun-voice-name').setCustomValidity(error);
        $('aliyun-voice-name').reportValidity(); return;
      }
      if (!$('aliyun-key').value.trim()) {
        $('aliyun-name-dialog').close(); message('请先填写阿里云 API Key。', 'error'); return;
      }
      $('aliyun-name-dialog').close();
      if (pending?.ready) {
        pending.name = name; cachePending(); busy = true; controls();
        try { await savePending(); }
        catch (error) { message(error.message, 'error'); }
        finally { busy = false; controls(); }
      } else await processNamedAudio(name);
    });
    $('aliyun-cancel-name').addEventListener('click', () => {
      $('aliyun-name-dialog').close();
    });
    $('aliyun-saved-voices').addEventListener('change', async () => {
      if (busy) return;
      const voice = (getSettings().voices || []).find(item => item.voice_id === $('aliyun-saved-voices').value);
      if (!voice) return;
      busy = true; controls();
      try { await persistSelection(voice); renderLibrary(); message(`已切换到“${voice.name}”。`, 'success'); }
      catch (error) { renderLibrary(); message(`切换失败：${error.message}`, 'error'); }
      finally { busy = false; controls(); }
    });
    ['aliyun-model', 'aliyun-voice'].forEach(id => $(id).addEventListener('input', renderLibrary));
    if (pending) {
      stage('');
      message(pending.ready ? '待保存' : '待检查状态');
    }
    controls();
    return { renderLibrary };
  };
})();
