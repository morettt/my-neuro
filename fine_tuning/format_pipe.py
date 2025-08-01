import os
import subprocess
from subprocess import Popen
import argparse

script_dir = os.path.dirname(__file__)
parser = argparse.ArgumentParser(description="format pipeline")
parser.add_argument("--name","-n",help="模型名称")

def format1(inp_text, inp_wav_dir, exp_name, bert_pretrained_dir):
    exp_name = exp_name.rstrip(" ")
    ps1a = []
    if ps1a == []:
        opt_dir = "%s/%s" % (os.path.join(script_dir,"logs"), exp_name)
        config = {
            "inp_text": inp_text,
            "inp_wav_dir": inp_wav_dir,
            "exp_name": exp_name,
            "opt_dir": opt_dir,
            "bert_pretrained_dir": bert_pretrained_dir,
        }
        all_parts = 1
        for i_part in range(all_parts):
            config.update(
                {
                    "i_part": str(i_part),
                    "all_parts": str(all_parts),
                    "_CUDA_VISIBLE_DEVICES": str(0),
                    "is_half": str(True),
                }
            )
            os.environ.update(config)
            cmd = f'python -s "{script_dir}"/prepare_datasets/1-get-text.py'
            print(cmd)
            p = Popen(cmd, shell=True)
            ps1a.append(p)
        for p in ps1a:
            p.wait()
        opt = []
        for i_part in range(all_parts):
            txt_path = "%s/2-name2text-%s.txt" % (opt_dir, i_part)
            with open(txt_path, "r", encoding="utf8") as f:
                opt += f.read().strip("\n").split("\n")
            os.remove(txt_path)
        path_text = "%s/2-name2text.txt" % opt_dir
        with open(path_text, "w", encoding="utf8") as f:
            f.write("\n".join(opt) + "\n")
        ps1a = []
    return

def format2(inp_text, inp_wav_dir, exp_name, ssl_pretrained_dir):
    ps1b = []
    exp_name = exp_name.rstrip(" ")
    if ps1b == []:
        config = {
            "inp_text": inp_text,
            "inp_wav_dir": inp_wav_dir,
            "exp_name": exp_name,
            "opt_dir": "%s/%s" % (os.path.join(script_dir,"logs"), exp_name),
            "cnhubert_base_dir": ssl_pretrained_dir,
            "sv_path": os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/sv/pretrained_eres2netv2w24s4ep4.ckpt"),
            "is_half": str(True),
        }
        all_parts = 1
        for i_part in range(all_parts):
            config.update(
                {
                    "i_part": str(i_part),
                    "all_parts": str(all_parts),
                    "_CUDA_VISIBLE_DEVICES": str(0),
                }
            )
            os.environ.update(config)
            cmd = f'python -s {script_dir}/prepare_datasets/2-get-hubert-wav32k.py'
            print(cmd)
            p = Popen(cmd, shell=True)
            ps1b.append(p)
        for p in ps1b:
            p.wait()
        ps1b = []
    return

def format3(version, inp_text, exp_name, pretrained_s2G_path):
    exp_name = exp_name.rstrip(" ")
    ps1c = []
    if ps1c == []:
        opt_dir = "%s/%s" % (os.path.join(script_dir,"logs"), exp_name)
        config_file = (
            os.path.join(script_dir,"configs/s2.json")
            if version not in {"v2Pro", "v2ProPlus"}
            else f"GPT_SoVITS/configs/s2{version}.json"
        )
        config = {
            "inp_text": inp_text,
            "exp_name": exp_name,
            "opt_dir": opt_dir,
            "pretrained_s2G": pretrained_s2G_path,
            "s2config_path": config_file,
            "is_half": str(True),
        }
        all_parts = 1
        for i_part in range(all_parts):
            config.update(
                {
                    "i_part": str(i_part),
                    "all_parts": str(all_parts),
                    "_CUDA_VISIBLE_DEVICES": str(0),
                }
            )
            os.environ.update(config)
            cmd = f'python -s "{script_dir}"/prepare_datasets/3-get-semantic.py'
            print(cmd)
            p = Popen(cmd, shell=True)
            ps1c.append(p)
        for p in ps1c:
            p.wait()
        opt = ["item_name\tsemantic_audio"]
        path_semantic = "%s/6-name2semantic.tsv" % opt_dir
        for i_part in range(all_parts):
            semantic_path = "%s/6-name2semantic-%s.tsv" % (opt_dir, i_part)
            with open(semantic_path, "r", encoding="utf8") as f:
                opt += f.read().strip("\n").split("\n")
            os.remove(semantic_path)
        with open(path_semantic, "w", encoding="utf8") as f:
            f.write("\n".join(opt) + "\n")
        ps1c = []
    return

version = "v2"
inp_text = os.path.join(script_dir,"output/asr/sliced.list")
inp_wav_dir = os.path.join(script_dir,"output/sliced")
args = parser.parse_args()
exp_name = vars(args)["name"]
bert_pretrained_dir = os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/chinese-roberta-wwm-ext-large")
ssl_pretrained_dir = os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/chinese-hubert-base")
pretrained_s2G_path = os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth")

if __name__ == "__main__":
    format1(inp_text, inp_wav_dir, exp_name, bert_pretrained_dir)
    format2(inp_text, inp_wav_dir, exp_name, ssl_pretrained_dir)
    format3(version, inp_text, exp_name, pretrained_s2G_path)
