#!/usr/bin/env pwsh
git config core.hooksPath .githooks
Write-Host "Hooks installed. They'll run on every commit in this repo."
Write-Host "To disable: git config --unset core.hooksPath"
