import os, time, sys
from pathlib import Path
import argparse
import shutil
import logging
from logging.handlers import RotatingFileHandler
import subprocess
import datetime
import base64
import librosa
import random
from cosyvoice.utils.common import set_all_random_seed

import torch
import torchaudio
from flask import Flask, request, jsonify, send_file, make_response

# --- Global Model Placeholders ---
sft_model = None
tts_model = None
VOICE_LIST = ['中文女', '中文男', '日语男', '粤语女', '英文女', '英文男', '韩语女']

# --- Flask App Initialization ---
app = Flask(__name__)

# --- Logging Setup ---
def setup_logging(logs_dir: Path):
    log = logging.getLogger('werkzeug')
    log.handlers[:] = []
    log.setLevel(logging.WARNING)

    root_log = logging.getLogger()
    root_log.handlers = []
    root_log.setLevel(logging.WARNING)

    app.logger.setLevel(logging.WARNING)
    log_file = logs_dir / f'{datetime.datetime.now().strftime("%Y%m%d")}.log'
    file_handler = RotatingFileHandler(str(log_file), maxBytes=1024 * 1024, backupCount=5)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setLevel(logging.WARNING)
    file_handler.setFormatter(formatter)
    app.logger.addHandler(file_handler)

# --- Core Functions ---

def setup_environment():
    """Sets up PYTHONPATH for Matcha-TTS and validates ffmpeg availability."""
    root_dir = Path(__file__).parent
    matcha_tts_path = root_dir / 'third_party' / 'Matcha-TTS'
    if str(matcha_tts_path) not in sys.path:
        sys.path.append(str(matcha_tts_path))

    if not shutil.which("ffmpeg"):
        print("ffmpeg not found in PATH. Please ensure it is installed and accessible.")
        # Simple check for homebrew path on macOS
        if sys.platform == 'darwin' and (Path("/opt/homebrew/bin") / "ffmpeg").exists():
             os.environ["PATH"] = "/opt/homebrew/bin" + os.pathsep + os.environ["PATH"]

    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg could not be found. Please install it and add it to your system's PATH.")
    print(f"ffmpeg found at: {shutil.which('ffmpeg')}")

def load_model(model_type: str, args):
    """
    Loads a specified model, downloading it if necessary and allowed.
    `model_type` can be 'sft' or 'tts'.
    """
    global sft_model, tts_model
    from cosyvoice.cli.cosyvoice import CosyVoice, CosyVoice2
    from modelscope import snapshot_download

    models_dir = Path(args.models_dir)

    if model_type == 'sft':
        model_id = 'iic/CosyVoice-300M-SFT'
        local_dir = models_dir / 'CosyVoice-300M-SFT'
        if sft_model is not None: return
    elif model_type == 'tts':
        model_id = 'iic/CosyVoice2-0.5B'
        local_dir = models_dir / 'CosyVoice2-0.5B'
        if tts_model is not None: return
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    if not local_dir.exists() and not args.disable_download:
        print(f"Model not found locally. Downloading {model_id} to {local_dir}...")
        snapshot_download(model_id, local_dir=str(local_dir))
    elif not local_dir.exists() and args.disable_download:
        raise FileNotFoundError(f"Model {model_type} not found at {local_dir} and downloading is disabled.")

    print(f"Loading model: {model_type}...")
    if model_type == 'sft':
        sft_model = CosyVoice(str(local_dir), load_jit=False, fp16=False)
    elif model_type == 'tts':
        tts_model = CosyVoice2(str(local_dir), load_jit=False, fp16=False)
    print(f"Model {model_type} loaded successfully.")

def postprocess(speech, sample_rate, top_db=60, hop_length=220, win_length=440):
    max_val = 0.8
    speech, _ = librosa.effects.trim(
        speech, top_db=top_db,
        frame_length=win_length,
        hop_length=hop_length
    )
    if speech.abs().max() > max_val:
        speech = speech / speech.abs().max() * max_val
    speech = torch.concat([speech, torch.zeros(1, int(sample_rate * 0.2))], dim=1)
    return speech

def base64_to_wav(encoded_str, output_path: Path):
    if not encoded_str: raise ValueError("Base64 encoded string is empty.")
    wav_bytes = base64.b64decode(encoded_str)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as wav_file:
        wav_file.write(wav_bytes)
    print(f"WAV file has been saved to {output_path}")

def get_params(req, args):
    output_dir = Path(args.output_dir)
    params = {
        "text": req.args.get("text", "").strip() or req.form.get("text", "").strip(),
        "lang": req.args.get("lang", "").strip().lower() or req.form.get("lang", "").strip().lower(),
        "role": req.args.get("role", "中文女").strip() or req.form.get("role", "中文女"),
        "reference_audio": req.args.get("reference_audio") or req.form.get("reference_audio"),
        "reference_text": req.args.get("reference_text", "").strip() or req.form.get("reference_text", ""),
        "speed": float(req.args.get("speed") or req.form.get("speed") or 1.0),
        "seed": int(req.args.get("seed") or req.form.get("seed") or -1)
    }
    if params['lang'] == 'ja': params['lang'] = 'jp'
    elif params['lang'].startswith('zh'): params['lang'] = 'zh'

    if req.args.get('encode', '') == 'base64' or req.form.get('encode', '') == 'base64':
        if params["reference_audio"]:
            tmp_name = f'{time.time()}-clone-{len(params["reference_audio"])}.wav'
            output_path = output_dir / tmp_name
            base64_to_wav(params['reference_audio'], output_path)
            params['reference_audio'] = str(output_path)
    return params

def batch(tts_type, outname, params, args):
    from cosyvoice.utils.file_utils import load_wav

    # Seed priority: API param > command-line arg > random
    seed = args.seed  # Start with global seed as a fallback
    api_seed = params.get('seed', -1)
    if api_seed != -1:
        seed = api_seed  # API-level seed takes precedence

    # If no seed was provided by API or command line, generate a random one
    if seed == -1:
        seed = random.randint(1, 100000000)

    print(f"Using seed: {seed}")
    set_all_random_seed(seed)

    output_dir = Path(args.output_dir)
    reference_dir = Path(args.refer_audio_dir)

    if tts_type == 'tts':
        load_model('sft', args)
    else:
        load_model('tts', args)

    model = sft_model if tts_type == 'tts' else tts_model

    prompt_speech_16k = None
    if tts_type != 'tts':
        ref_audio_path_str = params['reference_audio']
        if not ref_audio_path_str:
            raise Exception('参考音频未传入。')

        # FIX: Clearer variable names to avoid confusion
        user_provided_path = Path(ref_audio_path_str)
        full_ref_path = user_provided_path
        if not user_provided_path.is_absolute():
            full_ref_path = reference_dir / user_provided_path

        if not full_ref_path.exists():
            raise Exception(f'参考音频不存在: {full_ref_path}')

        # Align with webui.py by removing the explicit ffmpeg call.
        # The load_wav function is expected to handle resampling.
        # Also, use model.sample_rate for postprocessing padding to match webui.py.
        prompt_speech_16k = str(full_ref_path)

    text = params['text']
    audio_list = []

    if tts_type == 'tts':
        inference_stream = model.inference_sft(text, params['role'], stream=False, speed=params['speed'])
    elif tts_type == 'clone_eq' and params.get('reference_text'):
        inference_stream = model.inference_zero_shot(text, params.get('reference_text'), prompt_speech_16k, stream=False, speed=params['speed'])
    else:  # clone_mul
        inference_stream = model.inference_cross_lingual(text, prompt_speech_16k, stream=False, speed=params['speed'])

    for i, j in enumerate(inference_stream):
        audio_list.append(j['tts_speech'])

    if not audio_list:
        raise Exception("模型未能生成任何音频数据。")

    audio_data = torch.cat(audio_list, dim=1)
    sample_rate = model.sample_rate

    output_path = output_dir / outname

    # Use torchaudio's save function with soundfile backend to avoid deprecation warning
    torchaudio.save(str(output_path), audio_data, sample_rate, format="wav", backend='soundfile')

    print(f"音频文件生成成功：{output_path}")
    return str(output_path)

# --- Flask Routes ---

@app.route('/tts', methods=['GET', 'POST'])
def tts():
    try:
        params = get_params(request, app.config['args'])
        if not params['text']:
            return make_response(jsonify({"code": 1, "msg": '缺少待合成的文本'}), 400)
        outname = f"tts-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.wav"
        outfile = batch(tts_type='tts', outname=outname, params=params, args=app.config['args'])
        return send_file(outfile, mimetype='audio/x-wav')
    except Exception as e:
        app.logger.error(f"TTS Error: {e}", exc_info=True)
        return make_response(jsonify({"code": 2, "msg": str(e)}), 500)

@app.route('/clone_mul', methods=['GET', 'POST'])
@app.route('/clone', methods=['GET', 'POST'])
def clone():
    try:
        params = get_params(request, app.config['args'])
        if not params['text']:
            return make_response(jsonify({"code": 6, "msg": '缺少待合成的文本'}), 400)
        outname = f"clone-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.wav"
        outfile = batch(tts_type='clone_mul', outname=outname, params=params, args=app.config['args'])
        return send_file(outfile, mimetype='audio/x-wav')
    except Exception as e:
        app.logger.error(f"Clone Error: {e}", exc_info=True)
        return make_response(jsonify({"code": 8, "msg": str(e)}), 500)

@app.route('/clone_eq', methods=['GET', 'POST'])
def clone_eq():
    try:
        params = get_params(request, app.config['args'])
        if not params['text']:
            return make_response(jsonify({"code": 6, "msg": '缺少待合成的文本'}), 400)
        if not params['reference_text']:
            return make_response(jsonify({"code": 7, "msg": '同语言克隆必须传递引用文本'}), 400)
        outname = f"clone_eq-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.wav"
        outfile = batch(tts_type='clone_eq', outname=outname, params=params, args=app.config['args'])
        return send_file(outfile, mimetype='audio/x-wav')
    except Exception as e:
        app.logger.error(f"Clone EQ Error: {e}", exc_info=True)
        return make_response(jsonify({"code": 8, "msg": str(e)}), 500)

@app.route('/v1/audio/speech', methods=['POST'])
def audio_speech():
    import random
    if not request.is_json: return jsonify({"error": "请求必须是 JSON 格式"}), 400
    data = request.get_json()
    if 'input' not in data or 'voice' not in data: return jsonify({"error": "请求缺少必要的参数： input, voice"}), 400

    params = {
        'text': data.get('input'),
        'speed': float(data.get('speed', 1.0)),
        'role': data.get('voice', '中文女'),
        'reference_audio': None
    }

    api_name = 'tts'
    if params['role'] not in VOICE_LIST:
        api_name = 'clone_mul'
        params['reference_audio'] = params['role']

    filename = f'openai-{len(params["text"] )}-{time.time()}-{random.randint(1000,99999)}.wav'
    try:
        outfile = batch(tts_type=api_name, outname=filename, params=params, args=app.config['args'])
        return send_file(outfile, mimetype='audio/x-wav')
    except Exception as e:
        app.logger.error(f"OpenAI API Error: {e}", exc_info=True)
        return jsonify({"error": {"message": str(e), "type": e.__class__.__name__}}), 500

# --- Main Execution ---
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="CosyVoice API Server", formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('--port', type=int, default=9233, help='Port to bind the server to.')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host to bind the server to.')
    parser.add_argument('--models-dir', type=str, default='./pretrained_models', help='Directory to store and load models from.')
    parser.add_argument('--output-dir', type=str, default='./tmp', help='Directory to save generated audio files.')
    parser.add_argument('--refer-audio-dir', type=str, default='.', dest='refer_audio_dir', help='Base directory for reference audio files.')
    parser.add_argument('--seed', type=int, default=-1, help='Global random seed. -1 for random. Overridden by seed in API call.')
    parser.add_argument('--preload-models', nargs='*', choices=['sft', 'tts'], default=[], help='Space-separated list of models to preload at startup (e.g., sft tts).')
    parser.add_argument('--disable-download', action='store_true', help='Disable automatic model downloading.')
    args = parser.parse_args()

    app.config['args'] = args

    output_dir = Path(args.output_dir)
    logs_dir = output_dir / 'logs'
    output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(exist_ok=True)
    app.static_folder = str(output_dir)
    app.static_url_path = '/' + output_dir.name

    setup_logging(logs_dir)
    setup_environment()

    for model_key in args.preload_models:
        try:
            load_model(model_key, args)
        except Exception as e:
            app.logger.error(f"Failed to preload model '{model_key}': {e}", exc_info=True)
            sys.exit(1)

    """
    print(f"\n--- CosyVoice API Server ---")
    print(f"- Host: {args.host}")
    print(f"- Port: {args.port}")
    print(f"- Models Dir: {Path(args.models_dir).resolve()}")
    print(f"- Output Dir: {Path(args.output_dir).resolve()}")
    print(f"- Reference Dir: {Path(args.refer_audio_dir).resolve()}")
    print(f"- Preloaded models: {args.preload_models if args.preload_models else 'None'}")
    print(f"- Auto-download: {'Disabled' if args.disable_download else 'Enabled'}")
    print(f"- API running at: http://{args.host}:{args.port}")
    print(f"----------------------------")
    """

    try:
        from waitress import serve
        serve(app, host=args.host, port=args.port)
    except ImportError:
        app.run(host=args.host, port=args.port)
