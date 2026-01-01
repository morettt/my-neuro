import os
import json
import time


def get_motions_from_folder(character_path):
    """获取角色文件夹下motions文件夹中的所有motion文件"""
    motion_files_list = []

    try:
        items = os.listdir(character_path)
        for item in items:
            item_path = os.path.join(character_path, item)
            if os.path.isdir(item_path) and "motions" in item.lower():
                try:
                    motion_items = os.listdir(item_path)
                    for motion_item in motion_items:
                        if motion_item.endswith('.motion3.json'):
                            motion_entry = {
                                "File": f"motions/{motion_item}"
                            }
                            motion_files_list.append(motion_entry)
                except PermissionError:
                    print(f"      警告：无法访问 {item_path}")
    except PermissionError:
        print(f"   警告：无法访问 {character_path}")

    return motion_files_list


def process_model_file(model_file_path, character_path):
    """处理单个model3.json文件，重构Motions结构"""
    try:
        with open(model_file_path, 'r', encoding='utf-8') as f:
            model_data = json.load(f)

        has_motions = False

        if "FileReferences" in model_data and "Motions" in model_data["FileReferences"]:
            has_motions = True
            motions_location = model_data["FileReferences"]
        elif "Motions" in model_data:
            has_motions = True
            motions_location = model_data

        if has_motions:
            motion_files_list = get_motions_from_folder(character_path)
            original_motions = motions_location["Motions"]
            new_motions = {}

            # 处理Idle标签
            if "Idle" in original_motions:
                new_motions["Idle"] = original_motions["Idle"]
                print(f"      ├─ 保留原有Idle设置")
            else:
                new_motions["Idle"] = [
                    {
                        "File": "",
                        "FadeInTime": 0.5,
                        "FadeOutTime": 0.5
                    }
                ]
                print(f"      ├─ 添加默认Idle设置")

            # 重构TapBody
            new_motions["TapBody"] = motion_files_list
            motions_location["Motions"] = new_motions

            print(f"      ├─ 已重新构建Motions结构")
            print(f"      ├─ TapBody: {len(motion_files_list)} 个动作文件")

            # 直接覆盖原文件
            with open(model_file_path, 'w', encoding='utf-8') as f:
                json.dump(model_data, f, ensure_ascii=False, indent=2)

            print(f"      └─ 已覆盖原文件: {os.path.basename(model_file_path)}")
            return True
        else:
            print(f"      └─ 文件中不存在Motions字段，跳过处理")
            return False

    except Exception as e:
        print(f"      └─ 处理文件失败 {model_file_path}: {e}")
        return False


def process_single_motion_file(motion_file_path):
    """处理单个motion文件，删除包含mouth关键词的Curves条目并更新CurveCount"""
    try:
        with open(motion_file_path, 'r', encoding='utf-8') as f:
            motion_data = json.load(f)

        if "Curves" not in motion_data:
            return False

        original_count = len(motion_data["Curves"])
        filtered_curves = []
        removed_count = 0

        # 过滤掉包含"mouth"关键词的Curves
        for curve in motion_data["Curves"]:
            if "Id" in curve and "mouth" in curve["Id"].lower():
                removed_count += 1
                continue
            filtered_curves.append(curve)

        if removed_count > 0:
            # 更新Curves数组
            motion_data["Curves"] = filtered_curves

            # 更新Meta中的CurveCount - 这里是关键！
            if "Meta" in motion_data and "CurveCount" in motion_data["Meta"]:
                motion_data["Meta"]["CurveCount"] = len(filtered_curves)
                print(f"      ├─ 更新CurveCount: {original_count} -> {len(filtered_curves)}")

            # 保存文件
            with open(motion_file_path, 'w', encoding='utf-8') as f:
                json.dump(motion_data, f, ensure_ascii=False, indent=2)

            filename = os.path.basename(motion_file_path)
            print(
                f"      ├─ {filename}: 删除了 {removed_count} 个mouth相关的Curves ({original_count} -> {len(filtered_curves)})")
            return True
        else:
            return False

    except Exception as e:
        print(f"      └─ 处理motion文件失败 {motion_file_path}: {e}")
        return False


def process_motion_files_in_folder(character_path):
    """处理角色文件夹下motions文件夹中的所有motion文件"""
    processed_motion_count = 0

    try:
        items = os.listdir(character_path)
        for item in items:
            item_path = os.path.join(character_path, item)
            if os.path.isdir(item_path) and "motions" in item.lower():
                print(f"   └─ 处理motions文件夹: {item}")
                try:
                    motion_items = os.listdir(item_path)
                    for motion_item in motion_items:
                        if motion_item.endswith('.motion3.json'):
                            motion_file_path = os.path.join(item_path, motion_item)
                            if process_single_motion_file(motion_file_path):
                                processed_motion_count += 1
                except PermissionError:
                    print(f"      警告：无法访问 {item_path}")
    except PermissionError:
        print(f"   警告：无法访问 {character_path}")

    return processed_motion_count


def scan_character_folder(folder_path):
    """扫描单个角色文件夹，返回动作文件列表"""
    motion_files = []
    processed_model_count = 0

    try:
        items = os.listdir(folder_path)

        # 处理model文件
        for item in items:
            item_path = os.path.join(folder_path, item)
            if os.path.isfile(item_path) and item.endswith('.model3.json'):
                print(f"   ├─ 处理model文件: {item}")
                if process_model_file(item_path, folder_path):
                    processed_model_count += 1

        # 处理motion文件
        processed_motion_count = process_motion_files_in_folder(folder_path)

        # 扫描获取配置文件列表
        for item in items:
            item_path = os.path.join(folder_path, item)
            if os.path.isdir(item_path) and "motions" in item.lower():
                print(f"   └─ 扫描motions文件夹生成配置: {item}")
                try:
                    motion_items = os.listdir(item_path)
                    for motion_item in motion_items:
                        if motion_item.endswith('.motion3.json'):
                            motion_files.append(f"motions/{motion_item}")
                except PermissionError:
                    print(f"      警告：无法访问 {item_path}")

        if processed_motion_count > 0:
            print(f"   ├─ 成功处理 {processed_motion_count} 个motion文件（删除mouth相关Curves并更新CurveCount）")

    except PermissionError:
        print(f"   警告：无法访问 {folder_path}")

    return motion_files, processed_model_count


def get_latest_motions_time():
    """获取所有motions文件夹的最新修改时间"""
    folder_2d = "2D"
    latest_time = 0

    if not os.path.exists(folder_2d):
        return 0

    try:
        for item in os.listdir(folder_2d):
            item_path = os.path.join(folder_2d, item)
            if os.path.isdir(item_path):
                motions_path = os.path.join(item_path, "motions")
                if os.path.exists(motions_path):
                    folder_time = os.path.getmtime(motions_path)
                    if folder_time > latest_time:
                        latest_time = folder_time

                    # 检查motions文件夹内文件的修改时间
                    try:
                        for motion_file in os.listdir(motions_path):
                            if motion_file.endswith('.motion3.json'):
                                file_path = os.path.join(motions_path, motion_file)
                                file_time = os.path.getmtime(file_path)
                                if file_time > latest_time:
                                    latest_time = file_time
                    except PermissionError:
                        pass
    except PermissionError:
        pass

    return latest_time


def should_update_config(force_update=False):
    """检查是否需要更新配置"""
    if force_update:
        print("强制更新模式")
        return True

    config_path = 'emotion_actions.json'

    if not os.path.exists(config_path):
        print("配置文件不存在，需要生成")
        return True

    # 获取配置文件修改时间
    config_time = os.path.getmtime(config_path)

    # 获取motions文件的最新修改时间
    latest_motion_time = get_latest_motions_time()

    if latest_motion_time > config_time:
        print("检测到motions文件变化，需要更新配置")
        return True
    else:
        print("motions文件无变化，跳过配置更新")
        return False


def create_character_backups(all_emotions_data):
    """为每个角色创建独立的备份记录"""
    backup_file = 'character_backups.json'

    # 读取现有备份文件
    existing_backups = {}
    if os.path.exists(backup_file):
        try:
            with open(backup_file, 'r', encoding='utf-8') as f:
                existing_backups = json.load(f)
        except:
            existing_backups = {}

    # 为新角色或更新的角色创建备份
    current_time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    updated_count = 0

    for character_name, character_data in all_emotions_data.items():
        # 如果角色不存在备份，或者需要强制更新，则创建/更新备份
        if character_name not in existing_backups:
            existing_backups[character_name] = {
                "original_config": character_data,
                "backup_time": current_time_str,
                "created_by": "AI_set_live2d.py"
            }
            updated_count += 1
            print(f"   ├─ 为角色 {character_name} 创建原始配置备份")
        else:
            # 检查动作数量是否发生变化，如果变化则更新备份
            old_actions = existing_backups[character_name]["original_config"]["emotion_actions"]
            new_actions = character_data["emotion_actions"]

            old_action_count = len([k for k in old_actions.keys() if k.startswith("动作")])
            new_action_count = len([k for k in new_actions.keys() if k.startswith("动作")])

            if old_action_count != new_action_count:
                existing_backups[character_name]["original_config"] = character_data
                existing_backups[character_name]["backup_time"] = current_time_str
                existing_backups[character_name]["updated_by"] = "AI_set_live2d.py"
                updated_count += 1
                print(f"   ├─ 角色 {character_name} 动作数量变化 ({old_action_count} -> {new_action_count})，更新备份")

    # 保存备份文件
    with open(backup_file, 'w', encoding='utf-8') as f:
        json.dump(existing_backups, f, ensure_ascii=False, indent=2)

    if updated_count > 0:
        print(f"[备份] 创建/更新了 {updated_count} 个角色的原始配置备份")

    return updated_count


def main(force_update=False):
    """主函数，支持强制更新参数"""
    folder_2d = "2D"

    if not os.path.exists(folder_2d):
        print("找不到2D文件夹！")
        return

    # 检查是否需要更新配置
    if not should_update_config(force_update):
        return

    character_folders = []
    for item in os.listdir(folder_2d):
        item_path = os.path.join(folder_2d, item)
        if os.path.isdir(item_path):
            character_folders.append(item)

    if not character_folders:
        print("2D文件夹下没有找到子文件夹！")
        return

    print(f"找到 {len(character_folders)} 个角色文件夹，开始批量扫描...")
    print("=" * 60)

    all_emotions_data = {}
    total_processed_files = 0
    default_emotions = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]

    for character_name in character_folders:
        print(f"[文件夹] 正在扫描: {character_name}")

        character_path = os.path.join(folder_2d, character_name)
        motion_files, processed_model_count = scan_character_folder(character_path)

        total_processed_files += processed_model_count

        if motion_files:
            print(f"   ├─ 找到 {len(motion_files)} 个动作文件")
            print(f"   └─ 成功处理 {processed_model_count} 个model文件")

            character_emotions = {
                "emotion_actions": {}
            }

            for emotion in default_emotions:
                character_emotions["emotion_actions"][emotion] = []

            for i, motion_file in enumerate(motion_files, 1):
                action_name = f"动作{i}"
                character_emotions["emotion_actions"][action_name] = [motion_file]

            all_emotions_data[character_name] = character_emotions
        else:
            print(f"   └─ 未找到动作文件")

        print("-" * 40)

    # 保存配置文件（只有需要更新时才执行到这里）
    if all_emotions_data:
        config_file = 'emotion_actions.json'

        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(all_emotions_data, f, ensure_ascii=False, indent=2)

        # 设置文件时间戳为当前时间
        current_time = time.time()
        os.utime(config_file, (current_time, current_time))

        # 创建分角色备份
        backup_count = create_character_backups(all_emotions_data)

        print("=" * 60)
        print("[成功] 任务完成！")
        print(f"[配置文件] 成功生成 emotion_actions.json 文件")
        print(f"[备份文件] character_backups.json 文件")
        print(f"[文件处理] 总共处理了 {total_processed_files} 个model文件")
        print(f"[角色统计] 总共处理了 {len(all_emotions_data)} 个角色:")

        for character_name, data in all_emotions_data.items():
            action_count = len([k for k in data["emotion_actions"].keys() if k.startswith("动作")])
            print(f"   - {character_name}: {action_count} 个动作")

        print("\n文件处理结果:")
        print("  - emotion_actions.json (配置文件)")
        print("  - character_backups.json (分角色备份文件)")
        print("  - 各角色的 .model3.json 文件已直接更新")
        print("  - motions文件夹中的 .motion3.json 文件已删除mouth相关Curves并更新CurveCount")
    else:
        print("\n[错误] 没有找到任何包含动作文件的角色文件夹")


if __name__ == '__main__':
    import sys

    # 支持命令行参数强制更新
    force = '--force' in sys.argv
    main(force_update=force)