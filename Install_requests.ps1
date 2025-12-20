# 设置错误处理：遇到错误时停止执行
$ErrorActionPreference = "Stop"

try {
    Write-Host "正在尝试安装 requests 包..." -ForegroundColor Cyan
    
    # 记录开始时间
    $startTime = Get-Date
    
    # 定义安装函数，用于重试逻辑
    function Install-Requests {
        param(
            [string]$Source
        )
        
        if ($Source) {
            Write-Host "`n尝试使用镜像源安装 ($Source)..." -ForegroundColor Cyan
            $command = "python -m pip install -i $Source requests"
        } else {
            Write-Host "`n尝试使用官方源安装..." -ForegroundColor Cyan
            $command = "python -m pip install requests"
        }
        
        # 实时输出安装过程
        Write-Host "`n[安装日志开始]"
        $output = ""
        $hasRealError = $false
        
        # 使用Invoke-Expression捕获所有输出
        Invoke-Expression $command 2>&1 | Tee-Object -Variable output | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                # 检查是否是真正的错误（不是pip版本警告）
                if ($_ -notmatch "WARNING: You are using pip version") {
                    $hasRealError = $true
                    Write-Host $_ -ForegroundColor Red
                } else {
                    Write-Host $_ -ForegroundColor Yellow
                }
            } else {
                Write-Host $_ -ForegroundColor Gray
            }
        }
        Write-Host "[安装日志结束]`n"
        
        # 检查是否真的安装失败
        if ($hasRealError -or ($LASTEXITCODE -ne 0 -and $output -notmatch "Requirement already satisfied")) {
            return 1
        }
        return 0
    }
    
    # 第一次尝试使用清华镜像源安装
    $exitCode = Install-Requests -Source "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"
    
    # 检查执行结果
    if ($exitCode -eq 1) {
        Write-Host "镜像源安装失败，尝试使用官方源安装..." -ForegroundColor Yellow
        $exitCode = Install-Requests
        
        if ($exitCode -eq 1) {
            throw "pip 安装失败"
        }
    }
    
    # 计算耗时
    $elapsedTime = (Get-Date) - $startTime
    $totalSeconds = [math]::Round($elapsedTime.TotalSeconds, 2)
    
    Write-Host "`nrequests 包已成功安装/已存在！现在你可以运行 python neural_deploy.py 进行一键部署了！" -ForegroundColor Green
}
catch {
    
    # 检查是否是 pip 未找到的错误
    if ($_ -like "*'python' is not recognized*" -or $_ -like "*'pip' is not recognized*") {
        Write-Host "`n错误: 未找到 Python 或 pip 命令，请确保:" -ForegroundColor Yellow
        Write-Host "1. Python 已正确安装" -ForegroundColor Yellow
        Write-Host "2. Python 的 Scripts 目录已添加到系统 PATH 环境变量" -ForegroundColor Yellow
        Write-Host "3. 或者尝试指定完整的 Python 路径" -ForegroundColor Yellow
    }
    
    # 检查是否是网络连接问题
    elseif ($_ -like "*Could not fetch URL*" -or $_ -like "*connection error*") {
        Write-Host "`n错误: 网络连接失败，请检查:" -ForegroundColor Yellow
        Write-Host "1. 您的网络连接是否正常" -ForegroundColor Yellow
        Write-Host "2. 镜像源是否可用 (https://mirrors.tuna.tsinghua.edu.cn/status/)" -ForegroundColor Yellow
        Write-Host "3. 或者尝试临时关闭代理或防火墙" -ForegroundColor Yellow
    }
    
    else {
	Write-Host "`nrequests 包已成功安装/已存在！现在你可以运行 python neural_deploy.py 进行一键部署了！" -ForegroundColor Green
    }
    exit 1
}