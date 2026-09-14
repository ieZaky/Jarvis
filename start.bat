@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 (
        py -3 jarvis.py
        goto finished
    )
)
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 (
        python jarvis.py
        goto finished
    )
)
echo Jarvis needs Python 3.11 or newer.
echo Install Python from https://www.python.org/downloads/windows/
echo Select "Add Python to PATH" during installation, then run this file again.
:finished
pause
