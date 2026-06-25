@echo off
cd /d "%~dp0"

echo ========================================
echo   AI Studio Startup
echo ========================================
echo.

echo Starting proxy server (port 8765)...
start /B py proxy_server.py

timeout /t 2 /nobreak >nul

echo Starting http server (port 8080)...
start /B py -m http.server 8080

timeout /t 1 /nobreak >nul

echo.
echo ========================================
echo   Done!
echo   Frontend: http://localhost:8080
echo   Proxy:    http://localhost:8765
echo ========================================
echo.
echo Opening browser...
explorer "http://localhost:8080"
