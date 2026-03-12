@echo off
chcp 65001 > nul
title GeoLoom 一键启动
echo ============================================================
echo   GeoLoom-RAG 全栈一键启动
echo   前端: npm run dev (Vite, port 5173)
echo   后端: npm run dev:stack (Fastify + Python, port 3200)
echo ============================================================
echo.

:: 启动后端 dev:stack（在新窗口）
start "GeoLoom Backend" cmd /k "cd /d %~dp0V1-fastify-backend && npm run dev:stack"

:: 等待 2 秒让后端先初始化
timeout /t 2 /nobreak > nul

:: 启动前端（在新窗口）
start "GeoLoom Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo [OK] 前端和后端已在新窗口中启动。
echo      前端: http://localhost:5173
echo      后端: http://localhost:3200
echo.
echo 关闭此窗口不影响运行中的服务。
echo 要停止服务，请关闭对应的终端窗口。
echo ============================================================
pause
