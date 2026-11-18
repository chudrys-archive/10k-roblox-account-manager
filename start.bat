@echo off
title Isa's Roblox Account Manager
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node src\main.js %*
if errorlevel 1 pause
