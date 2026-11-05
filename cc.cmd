@echo off
if not exist "%~dp0codex-rs\target\debug\codex.exe" (
    >&2 echo Local Codex not found. Run "%~dp0build-cc.cmd" first.
    exit /b 1
)
"%~dp0codex-rs\target\debug\codex.exe" %*
exit /b %ERRORLEVEL%
