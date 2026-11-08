#!/usr/bin/env bash
set -euo pipefail
if ! command -v gh >/dev/null; then
  echo 'GitHub CLI missing. On macOS: brew install gh'; exit 1
fi
if ! command -v git >/dev/null; then
  echo 'git is missing'; exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo 'Please log in: gh auth login'; exit 1
fi
if [ ! -d .git ]; then git init -b main; fi
if ! git var GIT_AUTHOR_IDENT >/dev/null 2>&1; then
  echo 'Git identity needed. Run: git config --global user.name "Your Name"';
  echo 'Also: git config --global user.email "you@example.com"'; exit 1
fi
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git add .
  git commit -m 'Initial standalone Site Quality Guardian agent'
fi
if git remote get-url origin >/dev/null 2>&1; then
  echo 'Existing origin:'; git remote -v
  git push -u origin main
else
  gh repo create site-quality-guardian --public --source=. --remote=origin --push
fi
printf '\nPublished. Next: Add CLAUDE_CODE_OAUTH_TOKEN to GitHub Actions secrets, enable Pages > Source: GitHub Actions, and run Audit external website from Actions.\n'
