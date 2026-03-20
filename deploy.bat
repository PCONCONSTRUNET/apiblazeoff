@echo off
git rm -r --cached .
git add .
git commit --amend -m "feat: prepare api for railway deployment"
git push -u origin main -f
