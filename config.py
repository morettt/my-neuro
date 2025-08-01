import os

script_dir = os.path.dirname(os.path.realpath(__file__))

tts_model = {
    "path":os.path.join(script_dir, "tts-studio/tts-model/merged.pth"),
    "ref_audio":os.path.join(script_dir, "tts-studio/tts-model/neuro/01.wav"),
    "ref_text":os.path.join(script_dir, "tts-studio/tts-model/neuro/台本.txt"),
    "ref_language":"en"
}