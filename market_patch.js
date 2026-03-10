// 广场下载功能补丁 - 重定向到独立服务器
// 在浏览器控制台执行此脚本

(function() {
    const INDEPENDENT_API = 'http://localhost:5001';
    
    console.log('='.repeat(50));
    console.log('广场下载功能补丁已加载');
    console.log('独立 API 服务器:', INDEPENDENT_API);
    console.log('='.repeat(50));
    
    // 重写工具下载函数
    window.downloadTool = async function(toolName, downloadUrl, fileName) {
        console.log('[工具下载] 开始下载:', toolName);
        console.log('[工具下载] URL:', downloadUrl);
        console.log('[工具下载] 文件名:', fileName);
        
        try {
            const result = await fetch(`${INDEPENDENT_API}/api/market/tools/download`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    tool_name: toolName,
                    download_url: downloadUrl,
                    file_name: fileName || (toolName + '.js')
                })
            });
            
            const res = await result.json();
            if (res.success) {
                alert(`✅ 工具 ${toolName} 已下载！\n\n请重启桌宠以加载新工具`);
            } else {
                alert(`❌ 下载失败：${res.error || '未知错误'}`);
            }
        } catch (error) {
            alert(`❌ 下载时出错：${error.message}`);
        }
    };
    
    // 重写 FC 工具下载函数
    window.downloadFCtool = async function(toolName, downloadUrl) {
        console.log('[FC 工具下载] 开始下载:', toolName);
        console.log('[FC 工具下载] URL:', downloadUrl);
        
        try {
            const result = await fetch(`${INDEPENDENT_API}/api/market/fc-tools/download`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    tool_name: toolName,
                    download_url: downloadUrl
                })
            });
            
            const res = await result.json();
            if (res.success) {
                alert(`✅ FC 工具 ${toolName} 已下载！\n\n请重启桌宠以加载新工具`);
            } else {
                alert(`❌ 下载失败：${res.error || '未知错误'}`);
            }
        } catch (error) {
            alert(`❌ 下载时出错：${error.message}`);
        }
    };
    
    // 重写提示词应用函数
    window.applyPrompt = async function(title) {
        console.log('[提示词应用] 开始应用:', title);
        
        try {
            // 从服务器获取提示词详细内容
            const response = await fetch(`${INDEPENDENT_API}/api/market/prompts`);
            const data = await response.json();
            
            if (data.success) {
                const prompt = data.prompts.find(p => p.title === title);
                if (prompt && prompt.content) {
                    const result = await fetch(`${INDEPENDENT_API}/api/market/prompts/apply`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({content: prompt.content})
                    });
                    
                    const res = await result.json();
                    if (res.success) {
                        alert(`✅ 提示词已应用到 AI 人设！\n\n请重启桌宠以应用新人设`);
                    } else {
                        alert(`❌ 应用失败：${res.error || '未知错误'}`);
                    }
                } else {
                    alert(`❌ 未找到提示词：${title}`);
                }
            } else {
                alert(`❌ 获取提示词列表失败`);
            }
        } catch (error) {
            alert(`❌ 应用时出错：${error.message}`);
        }
    };
    
    console.log('✅ 所有广场下载函数已重定向到独立服务器');
    console.log('');
    console.log('使用说明:');
    console.log('1. 确保独立服务器正在运行 (http://localhost:5001)');
    console.log('2. 刷新页面后点击下载/应用按钮');
    console.log('3. 成功后根据提示重启桌宠或 AI 人设');
})();
