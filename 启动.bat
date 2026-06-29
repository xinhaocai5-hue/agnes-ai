@echo off
chcp 65001 >nul 2>&1
title Agnes AI Studio
echo.
echo  Agnes AI Studio
echo  ---------------
echo.

:: Find Node.js
set "NODE_EXE="
if exist "c:\Users\cxh\.trae-cn\sdks\versions\node\current\node.exe" (
    set "NODE_EXE=c:\Users\cxh\.trae-cn\sdks\versions\node\current\node.exe"
)
if not defined NODE_EXE (
    for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
    echo  [Error] Node.js not found.
    echo  Please install from https://nodejs.org/
    pause
    exit /b 1
)

echo  Using: %NODE_EXE%

:: 设置代理绕过：魔搭、阿里云等国内域名不走梯子
set "NO_PROXY=modelscope.cn,aliyuncs.com,aliyun.com,localhost,127.0.0.1"
set "no_proxy=%NO_PROXY%"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="
echo  Proxy bypass: %NO_PROXY%

:: Start server in background
start /b "" "%NODE_EXE%" "%~dp0server.js"

:: Wait for server to be ready
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:8000/Agnes.html

echo  Server started at http://localhost:8000
echo  Press Ctrl+C to stop.
echo.

:: Keep window open
"%NODE_EXE%" -e "process.stdin.resume()"
