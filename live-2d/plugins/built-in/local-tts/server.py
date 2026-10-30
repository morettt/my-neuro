"""在 TTS 包自己的 Python 中运行原有 API，保持服务进程由控制面板管理。"""
import argparse
import json
import os
from pathlib import Path
import runpy
import sys

DEFAULT_TEXT = "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday."


def configure_cache():
    cache = Path(__file__).resolve().parents[3] / '.download-cache'
    temp = cache / 'tmp'
    for directory in ('tmp', 'modelscope', 'huggingface', 'torch', 'numba', 'cuda'):
        (cache / directory).mkdir(parents=True, exist_ok=True)
    os.environ.update(TEMP=str(temp), TMP=str(temp), TMPDIR=str(temp),
                      MODELSCOPE_CACHE=str(cache / 'modelscope'), HF_HOME=str(cache / 'huggingface'),
                      TORCH_HOME=str(cache / 'torch'), NUMBA_CACHE_DIR=str(cache / 'numba'),
                      CUDA_CACHE_PATH=str(cache / 'cuda'))


def parse_options(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle')
    parser.add_argument('--voice-config')
    return parser.parse_args(argv)


def launch_arguments(bundle, voice, cuda_available):
    model = Path(voice.get('model') or bundle / 'role_voice_api/neuro/merge.pth')
    reference = Path(voice.get('reference') or bundle / 'role_voice_api/neuro/01.wav')
    for file in (bundle / 'api.py', model, reference):
        if not file.is_file():
            raise RuntimeError(f'TTS 文件缺失：{file}，请安装 DLC 或重新选择声音模型')
    language = voice.get('language', 'en')
    if language not in ('zh', 'en', 'ja'):
        raise ValueError('参考音频语言无效')
    return [str(bundle / 'api.py'), '-p', '5000', '-d', 'cuda' if cuda_available else 'cpu',
            '-s', str(model), '-dr', str(reference), '-dt', voice.get('text') or DEFAULT_TEXT, '-dl', language]


def main(argv=None):
    options = parse_options(argv)
    configure_cache()
    if options.bundle:
        bundle = Path(options.bundle).resolve()
    else:
        bundle = Path(os.environ['MY_NEURO_SERVICE_RESOURCE_DIR']) / 'tts-hub/GPT-SoVITS-Bundle'
    runtime = bundle / 'runtime'
    os.environ['PATH'] = str(runtime) + os.pathsep + os.environ.get('PATH', '')
    voice = json.loads(Path(options.voice_config).read_text(encoding='utf-8-sig')) if options.voice_config else {}
    import torch
    sys.argv = launch_arguments(bundle, voice, torch.cuda.is_available())
    print(f'正在启动本地 TTS（{sys.argv[4]}），使用 TTS 独立运行环境', flush=True)
    sys.path.insert(0, str(bundle))
    os.chdir(bundle)
    runpy.run_path(str(bundle / 'api.py'), run_name='__main__')


if __name__ == '__main__':
    main()
