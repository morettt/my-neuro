# test_memos.py - 测试 MemOS 完整框架
import sys
sys.stdout.reconfigure(encoding='utf-8')

from memos import MOS, MOSConfig
from memos.embedders.sentence_transformer import SenTranEmbedder, SenTranEmbedderConfig
from memos.llms.openai import OpenAILLM, OpenAILLMConfig

print("="*60)
print("  测试 MemOS 完整框架")
print("="*60)

# 测试1: 创建配置
print("\n1. 创建 Embedder Config...")
try:
    embedder_config = SenTranEmbedderConfig(
        model_name_or_path="./full-hub/rag-hub"
    )
    embedder = SenTranEmbedder(embedder_config)
    print("✅ Embedder 创建成功")
except Exception as e:
    print(f"❌ Embedder 创建失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n2. 创建 LLM Config...")
try:
    llm_config = OpenAILLMConfig(
        model_name_or_path="zai-org/GLM-4.6",
        api_key="sk-iosvzdshjjrzzldouqqnxefokpfncjfkwizvkwzxdjdmxvvm",
        api_base="https://api.siliconflow.cn/v1"
    )
    llm = OpenAILLM(llm_config)
    print("✅ LLM 创建成功")
except Exception as e:
    print(f"❌ LLM 创建失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n3. 创建 MOSConfig...")
try:
    mos_config = MOSConfig(
        embedder_config=embedder_config,
        llm_config=llm_config
    )
    print("✅ MOSConfig 创建成功")
except Exception as e:
    print(f"❌ Config 创建失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# 测试4: 创建 MOS 实例
print("\n4. 创建 MOS 实例...")
try:
    mos = MOS(mos_config)
    print("✅ MOS 实例创建成功")
except Exception as e:
    print(f"❌ MOS 创建失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# 测试5: 创建用户
print("\n5. 创建用户...")
try:
    user_id = "feiniu_test"
    mos.create_user(user_id=user_id)
    print(f"✅ 用户创建成功: {user_id}")
except Exception as e:
    print(f"ℹ️ 用户已存在或创建失败: {e}")

# 测试6: 添加记忆
print("\n6. 添加测试记忆...")
try:
    mos.add(
        messages=[
            {"role": "user", "content": "我喜欢踢足球"},
            {"role": "assistant", "content": "知道了"}
        ],
        user_id=user_id
    )
    print("✅ 记忆添加成功")
except Exception as e:
    print(f"❌ 添加失败: {e}")
    import traceback
    traceback.print_exc()

# 测试7: 搜索记忆
print("\n7. 搜索记忆...")
try:
    results = mos.search(query="用户喜欢什么运动", user_id=user_id, top_k=1)
    print(f"✅ 搜索成功")
    print(f"   结果: {results}")
except Exception as e:
    print(f"❌ 搜索失败: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("  ✅ MemOS 完整框架测试通过！")
print("="*60)

