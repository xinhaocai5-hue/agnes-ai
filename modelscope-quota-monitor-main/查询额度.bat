@echo off
cd /d "%~dp0"
title ModelScope Quota Monitor
echo.
echo  ModelScope Quota Monitor
echo  -------------------------
echo.
echo  Querying, please wait...
echo.
py main.py
echo.
echo  -------------------------
echo  Press any key to close...
pause >nul
