@echo off
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo.exe >nul 2>nul
if errorlevel 1 (
    >&2 echo Rust/Cargo not found. Install Rust before running this script.
    exit /b 1
)
set "CARGO_NET_GIT_FETCH_WITH_CLI=true"
set "GIT_TERMINAL_PROMPT=0"
set "LIBSQLITE3_FLAGS=SQLITE_DISABLE_INTRINSIC"
set "CARGO_TARGET_DIR=%~dp0codex-rs\target"
set "CARGO_BUILD_TARGET="
pushd "%~dp0codex-rs"
if errorlevel 1 exit /b 1
cargo.exe build --locked -p codex-cli --bin codex --jobs 4
set "CC_BUILD_EXIT=%ERRORLEVEL%"
popd
if not "%CC_BUILD_EXIT%"=="0" (
    >&2 echo Build failed. If cc is running, close it before rebuilding.
    exit /b %CC_BUILD_EXIT%
)
echo Build complete. Run cc to open the local CLI.
exit /b 0
