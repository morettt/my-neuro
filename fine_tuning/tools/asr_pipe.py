import os
import subprocess
from subprocess import Popen
from tools.asr.config import asr_dict
import argparse

script_dir = os.path.dirname(os.path.realpath(__file__))
parser = argparse.ArgumentParser(description="asr pipeline")
parser.add_argument("--language","-l",help="语言")

def asr(asr_inp_dir,asr_opt_dir,asr_model,asr_model_size,asr_lang,asr_precision):
    cmd = f'python -s fine_tuning/tools/asr/{asr_dict[asr_model]["path"]}'
    cmd += f' -i "{asr_inp_dir}"'
    cmd += f' -o "{asr_opt_dir}"'
    cmd += f" -s {asr_model_size}"
    cmd += f" -l {asr_lang}"
    cmd += f" -p {asr_precision}"
    print(cmd)
    p_asr = Popen(cmd, shell=True)
    p_asr.wait()
    return

args = parser.parse_args()
asr_inp_dir = os.path.join(os.path.dirname(script_dir),"output/sliced")
asr_opt_dir = os.path.join(os.path.dirname(script_dir),"output/asr")
asr_model = "Faster Whisper (多语种)"
asr_model_size = "medium"
asr_lang = vars(args)["language"]
asr_precision = "float32"

if __name__ == "__main__":
    asr(
        asr_inp_dir,
        asr_opt_dir,
        asr_model,
        asr_model_size,
        asr_lang,
        asr_precision
    )
