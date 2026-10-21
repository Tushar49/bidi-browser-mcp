#!/usr/bin/env bash
git config core.hooksPath .githooks
echo "Hooks installed. They'll run on every commit in this repo."
echo "To disable: git config --unset core.hooksPath"
