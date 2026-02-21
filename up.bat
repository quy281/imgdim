@echo off
title Dang day code img-dim len GitHub
echo ========================================
echo Dang tien hanh up code...
echo ========================================

:: Khoi tao git neu thu muc chua co
if not exist .git (
    git init
    git remote add origin https://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@github.com/quy281/imgdim.git
    git branch -M main
)

:: Cap nhat lai remote de dam bao dung Token co quyen ghi
git remote set-url origin https://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@github.com/quy281/imgdim.git

:: Thuc hien day code
git add .
git commit -m "Initial commit - update code %date% %time%"
git push -u origin main

echo ========================================
echo DA XONG!
echo ========================================
pause