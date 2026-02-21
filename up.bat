@echo off
title Cap nhat img-dim len GitHub
echo ========================================
echo Dang tien hanh up code...
echo ========================================

:: 1. Dam bao da khoi tao Git
if not exist .git (
    git init
    git branch -M main
)

:: 2. Gan Token moi nhat (Dung ma co quyen Write ban vua tao)
:: Luu y: Ma Token nay can duoc cap quyen cho repository "imgdim"
git remote set-url origin https://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@github.com/quy281/imgdim.git || git remote add origin https://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@github.com/quy281/imgdim.git

:: 3. Day code
git add .
git commit -m "update code %date% %time%"
git push -u origin main

echo ========================================
echo DA XONG!
echo ========================================
pause