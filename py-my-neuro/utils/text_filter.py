"""
文本过滤工具 - 过滤（）和**包裹的文本内容
"""
import re


def filter_text_markers(text):
    """
    过滤文本中的（）和**包裹的内容
    
    Args:
        text (str): 要过滤的文本
    
    Returns:
        str: 过滤后的文本
    """
    if not text:
        return text
    
    # 过滤（）包裹的内容 - 支持中英文括号
    text = re.sub(r'[（(].*?[）)]', '', text)
    
    # 过滤**包裹的内容
    text = re.sub(r'\*\*.*?\*\*', '', text)
    
    # 清理多余的空格
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text


def clean_subtitle_text(text):
    """
    专门用于字幕显示的文本清理
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 清理后的文本
    """
    if not text:
        return text
    
    # 应用基本过滤
    filtered_text = filter_text_markers(text)
    
    # 额外的字幕优化
    # 移除多余的标点符号
    filtered_text = re.sub(r'[.]{2,}', '...', filtered_text)
    
    # 移除首尾多余的标点符号
    filtered_text = filtered_text.strip('.,，。!！?？')
    
    return filtered_text


def filter_for_tts(text):
    """
    专门用于TTS的文本清理
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 清理后的文本
    """
    if not text:
        return text
    
    # 应用基本过滤
    filtered_text = filter_text_markers(text)
    
    # TTS特殊处理
    # 移除可能影响语音合成的符号
    filtered_text = re.sub(r'[#@$%^&*_+=\[\]{}|\\;:"]', '', filtered_text)
    
    # 保留自然的语音停顿符号
    filtered_text = re.sub(r'[.]{2,}', '...', filtered_text)
    
    return filtered_text


def filter_emotion_tags(text):
    """
    过滤情绪标签但保留原有的情绪标签功能
    
    Args:
        text (str): 包含情绪标签的文本
    
    Returns:
        tuple: (清理后的文本, 情绪标签列表)
    """
    if not text:
        return text, []
    
    # 提取情绪标签
    emotion_pattern = r'<([^>]+)>'
    emotions = re.findall(emotion_pattern, text)
    
    # 应用基本过滤（但保留情绪标签）
    filtered_text = text
    
    # 过滤（）包裹的内容 - 支持中英文括号
    filtered_text = re.sub(r'[（(].*?[）)]', '', filtered_text)
    
    # 过滤**包裹的内容
    filtered_text = re.sub(r'\*\*.*?\*\*', '', filtered_text)
    
    # 清理多余的空格
    filtered_text = re.sub(r'\s+', ' ', filtered_text).strip()
    
    return filtered_text, emotions


# 测试函数
if __name__ == "__main__":
    # 测试用例
    test_texts = [
        "你好（这是一个测试）世界！",
        "这是**强调的内容**普通文本",
        "正常文本（括号内容）**星号内容**结束",
        "<开心>你好啊（心情描述）**这是想法**<难过>",
        "混合测试（中文括号）(English brackets)**asterisk content**正常文本"
    ]
    
    print("=== 文本过滤测试 ===")
    for text in test_texts:
        filtered = filter_text_markers(text)
        print(f"原文: {text}")
        print(f"过滤: {filtered}")
        print()
    
    print("=== 情绪标签测试 ===")
    emotion_text = "<开心>你好啊（心情描述）**这是想法**<难过>再见"
    filtered_emotion, emotions = filter_emotion_tags(emotion_text)
    print(f"原文: {emotion_text}")
    print(f"过滤: {filtered_emotion}")
    print(f"情绪: {emotions}")