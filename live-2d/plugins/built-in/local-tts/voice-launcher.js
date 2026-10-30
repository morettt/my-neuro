const fs = require('fs');
const path = require('path');

function writeVoiceLauncher({ factoryDir, character, model, reference, text, language }) {
    const name = String(character).replace(/[<>:"/\\|?*%!?&^()]/g, '_');
    fs.mkdirSync(factoryDir, { recursive: true });
    const configFile = `${name}.voice.json`;
    fs.writeFileSync(path.join(factoryDir, configFile), JSON.stringify({ model, reference, text, language }, null, 2), 'utf8');
    const file = path.join(factoryDir, `${name}_TTS.bat`);
    const lines = [
        '@echo off', 'setlocal',
        'set "TTS_BUNDLE=%~dp0..\\plugins-dlc\\local-tts\\tts-hub\\GPT-SoVITS-Bundle"',
        'if not exist "%TTS_BUNDLE%\\runtime\\python.exe" set "TTS_BUNDLE=%~dp0..\\..\\full-hub\\tts-hub\\GPT-SoVITS-Bundle"',
        'if not exist "%TTS_BUNDLE%\\runtime\\python.exe" (',
        '  echo TTS DLC is not installed. Install it from the plugin page first.', '  pause', '  exit /b 1', ')',
        'set "PATH=%TTS_BUNDLE%\\runtime;%PATH%"',
        `"%TTS_BUNDLE%\\runtime\\python.exe" -u "%~dp0..\\plugins\\built-in\\local-tts\\server.py" --bundle "%TTS_BUNDLE%" --voice-config "%~dp0${configFile}"`,
        'pause', 'endlocal', ''
    ];
    fs.writeFileSync(file, lines.join('\r\n'), 'utf8');
    return file;
}

module.exports = { writeVoiceLauncher };
