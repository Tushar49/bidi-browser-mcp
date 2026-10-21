# .githooks/

Cross-platform git hooks tracked in this repo. Install once per clone:

```bash
# macOS/Linux/Git Bash on Windows
bash .githooks/install.sh

# PowerShell on Windows
pwsh -File .githooks/install.ps1
```

Both installers just run `git config core.hooksPath .githooks` so git
uses these files instead of `.git/hooks/`.

## Hooks

### `pre-commit`

Warns (non-blocking) when staged changes touch code files but
`CHANGELOG.md` is not staged. Exits 0 either way - your commit
always succeeds. Skip with `git commit --no-verify`.

File classification:
- **CHANGELOG.md** - flips the "changelog updated" flag
- **docs/images/binaries** (`.md`, `.txt`, `.png`, `.jpg`, `.pdf`, etc.) - ignored
- **config** (`.json`, `.yml`, `.yaml`, `.toml`, `.ini`, `.cfg`) - ignored
- **everything else** - counts as code

Pattern matching is intentionally simple; false positives (e.g., a
script-only change flagged because the script is `.sh`) are tolerable
since the message is friendly and the commit goes through anyway.

## To disable

```bash
git config --unset core.hooksPath
```
