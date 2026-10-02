@echo off
chcp 65001 >nul
title Infiniti - WuXian LianJie (Infiniti)
cd /d "%~dp0"

echo ============================================
echo   Infiniti Startup Script
echo ============================================
echo.

:: ---------- 前置检查 ----------

:: 1. 检查依赖（node_modules 不存在则 npm install）；前端构建产物不入库，没有则构建
if not exist "node_modules\" (
    echo [1/5] First run: installing dependencies...
    call npm install || goto :fail
) else (
    echo [1/5] Dependencies OK.
)
if not exist "public\app\index.html" (
    echo       First run: building web frontend...
    call npm --prefix web install || goto :fail
    call npm run web:build || goto :fail
)

:: 2. 检查 .env（没有则从模板复制并提示填 key）
if not exist ".env" (
    echo [2/5] .env not found, creating from template...
    copy ".env.example" ".env" >nul
    echo       Please edit .env and fill in DEEPSEEK_API_KEY, then rerun!
    goto :fail
)
echo [2/5] Config OK.

:: 3. Docker Desktop 检查：未运行则尝试拉起，并等待就绪
docker info >nul 2>&1
if errorlevel 1 (
    echo [3/5] Starting Docker Desktop, please wait...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    :waitdocker
    docker info >nul 2>&1
    if errorlevel 1 (
        echo|set /p="."
        timeout /t 3 /nobreak >nul
        goto :waitdocker
    )
)
echo [3/5] Docker OK.

:: 4. Neo4j：未运行则启动，并等待宿主机 Bolt 连接真正可用
docker ps --filter "name=infiniti-neo4j" --filter "status=running" --format "{{.Names}}" | findstr /x "infiniti-neo4j" >nul
if errorlevel 1 (
    echo       Starting Neo4j...
    docker compose up -d || goto :fail
)
echo|set /p="[4/5] Waiting for Neo4j"
:: wait-db.js 从宿主机发起真实 Bolt 连接（验证端口映射，不只是容器内进程活着）
node src\scripts\wait-db.js || goto :fail
echo.

:: ---------- 启动服务 ----------

:: 5. 端口 3100 被占用则先杀掉旧进程（避免双开）
:: 注意：必须用 /c: 把整串作为一个正则传给 findstr。
:: 旧写法 ":3000 .*LISTENING"（无 /c:）中，findstr 把空格当模式分隔符，
:: 实际含义变成 ":3000" OR ".*LISTENING"——后者匹配所有 LISTENING 行，
:: 导致 taskkill 误杀 Docker Desktop 等所有带监听端口的进程！
:: 新正则含义：地址以 :3100 结尾，行尾是 LISTENING（tokens=5 取 PID 列）
netstat -ano | findstr /r /c:":3100 .*LISTENING" >nul
if not errorlevel 1 (
    echo       Port 3100 busy, stopping old server...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":3100 .*LISTENING"') do taskkill /pid %%a /f >nul 2>&1
)
echo [5/5] Starting worker + web server...

:: 后台启动管道 worker（最小化窗口），日志同时写入 logs\worker.log
if not exist "logs" mkdir logs
start "Infiniti Worker" /min cmd /c "node src\pipeline\worker.js >> logs\worker.log 2>&1"

:: 前台启动网站。浏览器自动打开首页
echo       Web: http://localhost:3100
echo       Worker log: logs\worker.log
echo       (Close this window to stop web; worker window closes separately)
echo.
start "" http://localhost:3100
node src\server.js
goto :eof

:fail
echo.
echo Startup FAILED. Fix the issues above and rerun.
pause
exit /b 1
