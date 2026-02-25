@echo off
title Cap nhat du an imgdim - Chuyen nghiep
cd /d "%~dp0"
echo Dang quet thay doi trong folder imgdim...

:: 1. Chuan hoa URL (KHONG ĐỂ TOKEN Ở ĐÂY)
git remote set-url origin https://github.com/quy281/imgdim.git

:: 2. Loai bo cac file rac neu co
git rm -r --cached node_modules 2>nul
git rm -r --cached dist 2>nul

:: 3. Thuc hien commit va push
git add .
git commit -m "update du an imgdim %date% %time%"

:: 4. Push len nhanh main (Dung -f de tranh loi 'fetch first' nhu luc nay)
git push origin main -f

echo.
echo === DA XONG! Repo imgdim da duoc cap nhat ===
pause