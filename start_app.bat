@echo off
echo Starting Basic Pitch App...

:: Start Backend
start "Basic Pitch Backend" cmd /k "cd fastapi_backend && venv\Scripts\activate && uvicorn main:app --reload --port 8001"

:: Start Frontend
start "Basic Pitch Frontend" cmd /k "cd frontend && npm run dev"

:: Wait for servers to spin up
timeout /t 5

:: Open Browser
start http://localhost:5173

echo App started! You can close this window if you want, but keep the other two windows open.
pause
