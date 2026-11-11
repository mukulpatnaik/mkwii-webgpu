# Contributing

Thanks for looking. Two repositories take changes:

- **This one** (`mkwii-webgpu`): scripts, hosting, browser tests, the parity harness, docs.
- **The fork** ([mukulpatnaik/mkwii-webgpu-wiicompiled](https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled),
  branch `athena-web-ntsc`): the runtime and the browser platform. Changes that are not specific
  to this project belong upstream in [patchzyy/Wiicompiled](https://github.com/patchzyy/Wiicompiled);
  send them there first and reference the upstream PR here.

The fork is a submodule of this repository at `work/Wiicompiled` (clone with `--recursive`, or
`git submodule update --init`). A change that touches both is two pull requests: the fork's
first, then one here that moves the submodule to the merged commit (`git add work/Wiicompiled`).

## The one rule that cannot be broken

**Nothing derived from the game goes into git.** Not a disc image, not an extracted file, not a
`main.dol` or `StaticR.rel`, not translated C++ (`generated/`), not a built `.wasm`/`.data`, not a
staged site, not a screenshot of the game, not a save file, not a hash dump of game assets beyond
the two retail hashes the translator already pins. `.gitignore` covers the usual paths; look at
`git status` and `git diff --stat` before every commit, and `git log --stat` before a pull request.
A pull request that contains any of it is closed and the history is rewritten.

The same goes for builds: never attach one to an issue or a pull request, never link to a hosted
build on a public address.

## Before a pull request

```bash
scripts/doctor.sh                                         # toolchain and checkouts
shellcheck --severity=warning -x scripts/*.sh scripts/parity/*.sh tools/hosting/*.sh tools/hosting/*/*.sh
node --check tools/browser-test/*.js tools/web-server/*.js tools/hosting/cloudflare/*.js
node --test tools/hosting/cloudflare/worker.test.mjs
python3 -m py_compile $(git ls-files '*.py')
```

That is what `.github/workflows/checks.yml` runs, without the game. Changes to the page or the
runtime also need a real Chrome run on a machine with a disc (`tools/browser-test/README.md`):
say in the pull request what you ran and paste the healthy console lines (`[web-disc] opened`,
`mounted ... game files`, `[web-perf] fps=`), not screenshots of the game.

## Style

- Shell scripts: `set -euo pipefail`, `shellcheck` clean at warning level, a usage comment at
  the top that `--help` prints. Python: standard library only. JavaScript: no build step.
- Every script that touches game-derived data says so in its header and writes only under
  gitignored paths (`work/`, `game/`, `tools/browser-test/out/`).
- Write pull request text yourself. Describe what changed, why, and how you checked it.

## Licence

Contributions are under GPLv3, like the rest of the project, except in `tools/relay/`: that
folder is Minithena's room relay under the AGPL-3.0-only (its own `LICENSE`), and changes to it
stay under that licence.
