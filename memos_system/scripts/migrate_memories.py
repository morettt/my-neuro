# migrate_memories.py - 迁移旧记忆库到 MemOS
import requests
import sys
import os

MEMOS_API_URL = "http://127.0.0.1:8003"
# 获取项目根目录
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.join(script_dir, "..", "..")
OLD_MEMORY_FILE = os.path.join(project_root, "live-2d", "AI记录室", "记忆库.txt")

def check_service():
    """检查 MemOS 服务是否运行"""
    try:
        response = requests.get(f"{MEMOS_API_URL}/health", timeout=2)
        return response.status_code == 200
    except:
        return False

def migrate():
    """执行迁移"""
    print("=" * 60)
    print("  MemOS 记忆库迁移工具")
    print("=" * 60)
    print()
    
    # 检查服务
    print("🔍 检查 MemOS 服务状态...")
    if not check_service():
        print("❌ MemOS 服务未启动！")
        print()
        print("请先运行 MEMOS-API.bat 启动服务，然后再运行此脚本。")
        print()
        input("按任意键退出...")
        sys.exit(1)
    
    print("✅ MemOS 服务运行正常")
    print()
    
    # 检查文件
    if not os.path.exists(OLD_MEMORY_FILE):
        print(f"❌ 旧记忆库文件不存在: {OLD_MEMORY_FILE}")
        print()
        input("按任意键退出...")
        sys.exit(1)
    
    print(f"📂 找到旧记忆库: {OLD_MEMORY_FILE}")
    print()
    
    # 确认迁移
    confirm = input("⚠️ 是否开始迁移？这可能需要几分钟时间。(y/n): ")
    if confirm.lower() != 'y':
        print("❌ 已取消迁移")
        sys.exit(0)
    
    print()
    print("🚀 开始迁移...")
    print()
    
    # 调用 API 迁移
    try:
        response = requests.post(
            f"{MEMOS_API_URL}/migrate",
            json={"file_path": OLD_MEMORY_FILE},
            timeout=120
        )
        
        if response.status_code == 200:
            data = response.json()
            imported_count = data.get('imported_count', 0)
            
            print("=" * 60)
            print(f"✅ 迁移完成！")
            print(f"📊 成功导入 {imported_count} 条记忆")
            print("=" * 60)
            print()
            print("现在您可以：")
            print("1. 启动肥牛AI，体验智能记忆召回")
            print("2. 运行 MEMOS-WebUI.bat 查看和管理记忆")
            print()
        else:
            print(f"❌ 迁移失败: {response.text}")
    except Exception as e:
        print(f"❌ 迁移出错: {e}")
    
    print()
    input("按任意键退出...")

if __name__ == "__main__":
    migrate()

