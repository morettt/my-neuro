"""FastAPI router for private uploads and temporary public reference audio."""
import hmac
import os
from pathlib import Path
import re
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(tags=['voice-audio'])
ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / 'uploads' / 'voice_audio'
TOKEN_FILE = ROOT / '.voice-upload-token'
PUBLIC_BASE = os.environ.get('VOICE_AUDIO_PUBLIC_BASE', 'https://mynewbot.com').rstrip('/')
MAX_BYTES = 10 * 1024 * 1024
TTL = 24 * 60 * 60
MIMES = {'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'm4a': 'audio/mp4'}


def authorize(request):
    expected = os.environ.get('VOICE_AUDIO_UPLOAD_TOKEN', '')
    if not expected and TOKEN_FILE.exists():
        expected = TOKEN_FILE.read_text().strip()
    supplied = request.headers.get('authorization', '')
    if not expected or not hmac.compare_digest(supplied.encode('utf-8'), ('Bearer ' + expected).encode('utf-8')):
        raise HTTPException(401, '上传密钥无效')


def valid_header(data, extension):
    if extension == 'wav':
        return data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    if extension == 'm4a':
        return data[4:8] == b'ftyp'
    return data[:3] == b'ID3' or (len(data) >= 2 and data[0] == 255 and data[1] & 224 == 224)


@router.post('/api/voice-audio')
async def upload_voice_audio(request: Request, format: str = ''):
    authorize(request)
    extension = format.lower()
    if extension not in MIMES:
        raise HTTPException(400, '仅支持 WAV、MP3、M4A 音频')
    try:
        size = int(request.headers.get('content-length', '0'))
    except ValueError:
        raise HTTPException(400, '文件长度无效')
    if size > MAX_BYTES:
        raise HTTPException(413, '音频不能超过 10 MB')
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for old in UPLOAD_DIR.iterdir():
        if old.is_file() and old.stat().st_mtime < now - TTL:
            old.unlink(missing_ok=True)
    # Bound the storage used by this endpoint independently of other site uploads.
    if sum(p.stat().st_size for p in UPLOAD_DIR.iterdir() if p.is_file()) >= 1024 * MAX_BYTES:
        raise HTTPException(507, '临时音频存储空间已满，请稍后重试')
    filename = uuid.uuid4().hex + '.' + extension
    target = UPLOAD_DIR / filename
    total = 0
    header = bytearray()
    try:
        with target.open('xb') as output:
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, '音频不能超过 10 MB')
                if len(header) < 32:
                    header.extend(chunk[:32 - len(header)])
                output.write(chunk)
        if not total or not valid_header(header, extension):
            raise HTTPException(400, '音频内容与文件格式不符')
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {'ok': True, 'url': f'{PUBLIC_BASE}/api/voice-audio/{filename}',
            'expires_at': int(now + TTL), 'size': total}


@router.get('/api/voice-audio/{filename}')
def download_voice_audio(filename: str):
    if not re.fullmatch(r'[a-f0-9]{32}\.(wav|mp3|m4a)', filename):
        raise HTTPException(404, '音频不存在')
    target = UPLOAD_DIR / filename
    if not target.is_file() or target.stat().st_mtime < time.time() - TTL:
        raise HTTPException(404, '音频不存在或已过期')
    return FileResponse(target, media_type=MIMES[target.suffix[1:]],
                        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
