#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import json
import sys

def load_model_config():
    """加载模型配置文件"""
    config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models_config.json')
    
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"错误: 找不到配置文件 '{config_file}'")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"错误: 配置文件 '{config_file}' 格式不正确")
        sys.exit(1)

def show_main_menu(config):
    """显示主菜单 - 选择模型家族"""
    families = list(config['models'].keys())
    
    print("\n==== 模型下载工具 ====")
    print("请选择模型家族:")
    
    for i, family in enumerate(families, 1):
        print(f"{i}. {family}")
    print("0. 退出程序")
    
    while True:
        try:
            choice = input("\n请输入选项[0-{}]: ".format(len(families)))
            if choice == '0':
                sys.exit(0)
            
            idx = int(choice) - 1
            if 0 <= idx < len(families):
                return families[idx]
            else:
                print("无效选项，请重新输入")
        except ValueError:
            print("请输入数字")

def show_models_menu(config, family):
    """显示指定模型家族的所有模型"""
    models = config['models'][family]
    
    print(f"\n==== {family} 模型列表 ====")
    
    for i, model in enumerate(models, 1):
        print(f"{i}. {model}")
    print("0. 返回上级菜单")
    
    while True:
        try:
            choice = input("\n请输入选项[0-{}]: ".format(len(models)))
            if choice == '0':
                return None
            
            idx = int(choice) - 1
            if 0 <= idx < len(models):
                return models[idx]
            else:
                print("无效选项，请重新输入")
        except ValueError:
            print("请输入数字")

def download_model(family, model):
    """下载指定的模型"""
    # 构建完整的模型路径
    full_model_name = f"{family}/{model}"
    
    # 创建目标目录
    target_dir = os.path.join("./models", f"{family}_{model}")
    os.makedirs(target_dir, exist_ok=True)
    
    # 执行下载命令
    download_cmd = f"modelscope download --model {full_model_name} --local_dir {target_dir}"
    print(f"\n准备下载: {full_model_name}")
    
    # 二次确认
    confirm = input("确认下载? (y/n): ").strip().lower()
    if confirm == 'y':
        print("开始下载...")
        os.system(download_cmd)
        print(f"下载完成，模型保存在: {os.path.abspath(target_dir)}")
        # 下载完成后直接退出程序
        sys.exit(0)
    else:
        print("已取消下载")
        # 取消下载后直接退出程序
        sys.exit(0)

def main():
    """主程序流程"""
    # 加载模型配置
    config = load_model_config()
    
    # 显示模型家族菜单
    family = show_main_menu(config)
    
    # 显示选定家族的模型菜单
    model = show_models_menu(config, family)
    if model is None:
        # 返回上级菜单
        main()
    else:
        # 下载选定的模型并退出
        download_model(family, model)

if __name__ == "__main__":
    main()
