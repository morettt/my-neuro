import os
import subprocess
from subprocess import Popen
import json
import argparse

script_dir = os.path.dirname(os.path.realpath(__file__))
parser = argparse.ArgumentParser(description="asr pipeline")
parser.add_argument("--name","-n",help="模型名称")
tmp = os.path.join(script_dir, "TEMP")
is_half = True

def train(
    version,
    batch_size,
    total_epoch,
    exp_name,
    text_low_lr_rate,
    if_save_latest,
    if_save_every_weights,
    save_every_epoch,
    pretrained_s2G,
    pretrained_s2D,
    if_grad_ckpt,
    lora_rank,
):
    p_train_SoVITS = None
    if p_train_SoVITS == None:
        exp_name = exp_name.rstrip(" ")
        config_file = (
            f"{script_dir}/configs/s2.json"
            if version not in {"v2Pro", "v2ProPlus"}
            else f"{script_dir}/configs/s2{version}.json"
        )
        with open(config_file) as f:
            data = f.read()
            data = json.loads(data)
        s2_dir = "%s/%s" % (os.path.join(script_dir,"logs"), exp_name)
        os.makedirs("%s/logs_s2_%s" % (s2_dir, version), exist_ok=True)
        if is_half == False:
            data["train"]["fp16_run"] = False
            batch_size = max(1, batch_size // 2)
        data["train"]["batch_size"] = batch_size
        data["train"]["epochs"] = total_epoch
        data["train"]["text_low_lr_rate"] = text_low_lr_rate
        data["train"]["pretrained_s2G"] = pretrained_s2G
        data["train"]["pretrained_s2D"] = pretrained_s2D
        data["train"]["if_save_latest"] = if_save_latest
        data["train"]["if_save_every_weights"] = if_save_every_weights
        data["train"]["save_every_epoch"] = save_every_epoch
        data["train"]["gpu_numbers"] = "0"
        data["train"]["grad_ckpt"] = if_grad_ckpt
        data["train"]["lora_rank"] = lora_rank
        data["model"]["version"] = version
        data["data"]["exp_dir"] = data["s2_ckpt_dir"] = s2_dir
        data["save_weight_dir"] = os.path.join(script_dir,"SoVITS_weights_v2")
        data["name"] = exp_name
        data["version"] = version
        tmp_config_path = "%s/tmp_s2.json" % tmp
        with open(tmp_config_path, "w") as f:
            f.write(json.dumps(data))
        cmd = f'python -s {script_dir}/s2_train.py --config "%s"' % tmp_config_path
        print(cmd)
        p_train_SoVITS = Popen(cmd, shell=True)
        p_train_SoVITS.wait()
        p_train_SoVITS = None

version = "v2"
batch_size = 4
total_epoch = 8
args = parser.parse_args()
exp_name = vars(args)["name"]
text_low_lr_rate = 0.4
if_save_latest = True
if_save_every_weights = True
save_every_epoch = 4
pretrained_s2G = os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth")
pretrained_s2D = os.path.join(os.path.dirname(script_dir),"tts-studio/pretrained_models/gsv-v2final-pretrained/s2D2333k.pth")
if_grad_ckpt = False
lora_rank = 32

if __name__ == "__main__":
    train(
        version,
        batch_size,
        total_epoch,
        exp_name,
        text_low_lr_rate,
        if_save_latest,
        if_save_every_weights,
        save_every_epoch,
        pretrained_s2G,
        pretrained_s2D,
        if_grad_ckpt,
        lora_rank,
    )
