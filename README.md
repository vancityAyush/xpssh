# xpssh

SSH keys for git providers, done right. One command takes you from nothing to a working `git clone` over SSH — key generated, `~/.ssh/config` wired, agent loaded, public key delivered, connection tested.

Supports **GitHub**, **GitLab**, **Bitbucket**, and **Azure DevOps**, with first-class multi-account support (work + personal on the same machine without the wrong-key headaches).

```
npx xpssh            # interactive TUI
npx xpssh setup github -e you@example.com   # or go straight to it
```

<sub>Requires Node ≥ 22 (or Bun). Works on macOS and Linux; Windows is best-effort.</sub>

## What it does

```
$ xpssh setup github -n work -e you@company.com
· Generate SSH key                ✓ ed25519 key written to ~/.ssh/xpssh_github_work
· Add host entry to ~/.ssh/config ✓ Host github.com-work added
· Load key into ssh-agent         ✓ Key in agent (persisted to Keychain)
· Deliver public key to provider  ✓ copied to clipboard, settings page opened
· Test SSH connection             ✓ Hi you! You've successfully authenticated
✓ Profile github-work ready — clone with git@github.com-work:<owner>/<repo>.git
```

Launching `xpssh` with no arguments opens the TUI: a dashboard of your profiles with status badges, a setup wizard, connection tester, agent manager — plus a Claude-Code-style command bar (`/`) that accepts every CLI command from anywhere.

## Commands

| Command | What it does |
|---|---|
| `xpssh setup <provider>` | End-to-end key setup (`-n` name, `-e` email, `--token` API upload, `--dir` bind a folder, `-y` non-interactive) |
| `xpssh list [--json]` | All profiles with key/test status and clone prefixes |
| `xpssh test [<profile>] [--all]` | Verify SSH auth actually works |
| `xpssh copy <profile> [--open]` | Public key → clipboard (+ provider settings page) |
| `xpssh upload <profile>` | Push the public key via provider API (token from flag, env, or prompt) |
| `xpssh agent [list\|add\|remove\|start]` | ssh-agent management (macOS Keychain aware) |
| `xpssh remove <profile>` | Clean removal: config block, key files, manifest |
| `xpssh doctor [--fix]` | Detect & repair drift between manifest, ssh config, keys, and perms |

Providers accept aliases: `gh`, `gl`, `bb`, `ado`.

## Multi-account, solved properly

Each key is a named **profile** (`github-work`, `github-personal`). xpssh writes fenced, marker-tracked blocks to `~/.ssh/config` — your own content is never touched, and removal restores the file byte-for-byte:

```ssh-config
# >>> xpssh:github-work >>>
Host github.com-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/xpssh_github_work
    IdentitiesOnly yes        # ← the line that prevents wrong-account auth
    AddKeysToAgent yes
    UseKeychain yes           # macOS only
# <<< xpssh:github-work <<<
```

- Your **first** profile per provider claims the bare host (`git@github.com:…` just works); later ones get aliases (`git@github.com-work:…`).
- `--dir ~/work` binds a directory to a profile via git `includeIf`: repos under it automatically commit with the right email *and* the right key, even when cloned with the bare URL.

## API token upload

Skip the copy-paste: `xpssh setup github --token <PAT>` (or `xpssh upload github-work`) pushes the key via the provider's REST API. Tokens are read from flags, `XPSSH_TOKEN_GITHUB` / `XPSSH_TOKEN_GITLAB` / `XPSSH_TOKEN_BITBUCKET`, or a masked prompt — and are **never persisted or logged**. Azure DevOps has no key API; xpssh opens the settings page instead.

## Safety

- `~/.ssh/config` edits are fenced, round-trip byte-exact, backed up to `config.xpssh.bak` first, and hard-error (never guess) on tampered fences
- Key files and config written with `600`, `~/.ssh` with `700`
- `xpssh doctor --fix` reconciles everything: missing/orphaned/stale config blocks, loose permissions, shadowed Host entries, missing key files

## Development

```
bun install
bun run dev          # run from source
bun test             # 90+ tests
bun run typecheck
bun run build        # dist/ for npm (runs on plain Node)
```

## License

MIT
