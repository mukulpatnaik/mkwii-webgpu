# Notes for messages upstream (facts only; write the text yourself)

Both upstream projects want words written by the person who sends them. WiiCompiled's
`CONTRIBUTING.md` (origin/main `ae54b6e`, 2026-10-27) says PR descriptions and responses "must be
written by you, **not** generated", that you must be able to explain every line, one change per
PR, and hardware-identical behaviour with evidence for anything touching the game. So these are
the facts to draw on, checked on 2026-10-28, not drafts to paste. Nothing here has been sent.

## 1. Minithena (owner of the browser port)

Contact: Discord `hiemal` (their `HANDOVER.md`, in `work/mariokartwebtest`). GitHub `Minithena`.

What happened:
- `https://github.com/Minithena/mariokartwebtest` returned 404 on 2026-10-28 (HTTP 404, also from
  the API; a DMCA takedown shows as 451 and nothing in `github/dmca` names them). Their profile and
  `Minithena/Wiicompiled` (branch `web`, tip `c305fba`, 2026-10-07) are still public. So the page
  tooling, Cloudflare Worker, room relay and notes were deleted or made private on purpose.
- We hold a complete clone of it at its last public commit `384cffa` (2026-10-02), plus our three
  staging-script commits, in the private repo `mukulpatnaik/mkwii-webgpu-webtest` and in git
  bundles. We have not published it and will not without their answer (the relay is AGPL-3.0, the
  rest of that repo carries no licence file).

Things to ask or say:
- Was taking `mariokartwebtest` down intentional? Should we keep our copy private, or do they want
  it gone too?
- Their `web` branch's last change (`1a2751b`, real-time catch-up by wall clock, course-music
  prefetch, `[web-net]` silence logging) was reverted the same day (`c305fba`). If they say why, it
  tells us whether to avoid the same ground.

What we have that they listed as open in `HANDOVER.md`, all on our branch `athena-web-ntsc`
(`mukulpatnaik/mkwii-webgpu-wiicompiled`), each verified in Chrome 156 on Linux with an RTX 4090
(evidence files under `tools/browser-test/out/`, listed in `docs/release-checklist.md`):
- **M3, players bring their own disc** (their deferred milestone): nod compiled to wasm32 in a
  worker reads the picked WBFS/ISO/CISO with `FileReaderSync`, checks the game ID and the DOL/REL
  hashes, serves `/game` through the WASMFS backend with a 256 MiB LRU chunk cache and the
  existing prefetch channels; file handle kept in IndexedDB. A Grand Prix race from a picked WBFS
  with no `game/` on the server: `race steps/s=60.0`, `fps=60.0`. Fork commits `afbb70b`,
  `7528b2f`, `a7674ee`, `6244d21`, docs `docs/web-local-disc.md`. Node tests with a synthetic disc.
- **Display-tied presentation** (their known issue 2): present at the browser's frame callback,
  simulate on the VI clock. Chrome trace: 299 pushes over 300 vsyncs, 0 vsyncs without a new frame
  and 0 with two. `?present=immediate` keeps the old path. Commits `10a71ca`, `d32f0d7`, `7913843`,
  `9dadeb1`. Cost: 16.8-29 ms canvas latency after retrace instead of ~6.6 ms. Real 120/144 Hz
  displays untested (only emulated with `?rafhz=`).
- **Saves panel**: export, import and backup of `rksys.dat` and settings from OPFS, a Web Lock
  against two tabs, a `persist()` request. Export then import into a fresh profile gives the same
  sha256. Commits `e1416da`, `c1ccae0`, `0b75584`.
- **Pads**: a pad on port 1 alongside the keyboard (`b33c613`); pads without a standard layout get
  SDL's Linux mapping automatically, and the F10 wizard can bind a D-pad reported as two axes
  (`701a350`, `a5a814f`, `3d9da4d`); `docs/controls.md`. Verified with virtual uinput pads and a
  simulated PowerA Core Plus; the real pad and macOS/Firefox untested.
- **NTSC-U** on their branch (the region merge `3a3e192` and the web hooks ported to region
  identities, `0f6f139`, `feb5e88`, `c42095a`, `7d8ef17`), with physics parity: a staff ghost
  finishes at the same timer value natively and on the web (`docs/parity-ntsc-u.md`).
- Two small fixes to their branch that any Linux build host needs: the ELF blob-symbol regex
  (`2317efe`, below) and the NAND save test heap (`5b57402`, below).
- They built only on a Mac; we build on Linux (Emscripten 6.0.11, `scripts/build-private-bundle.sh`).

## 2. patchzyy/Wiicompiled

State on 2026-10-28:
- DarthMDev's PR #247 (the NTSC-U/J/K region support our fork merged) was closed on 2026-10-21,
  superseded by #326, merged the same day: "one precompiled runtime now serves PAL, NTSC-U and
  NTSC-J ... NTSC-K is left out for now." patchzyy had retargeted it to `v1.0-beta`; since
  #310/#311 the runtime is precompiled and shipped, so nothing in `runtime/src` or
  `runtime/include` may include `generated/`.
- Upstream's mechanism now (origin/main): `runtime/include/guest_abi/guest_region.h` keeps the
  PAL-identity spelling (`MKW_GADDR(801A9E84)`) but resolves it at run time through delta ranges in
  `guest_abi/guest_versions.inc`, with `runtime/game/guest_region.cpp` supplying the translated
  region at link time; "a PAL address outside every range of a region does not compile".
  `projects/mkwii-ntsc-u/` and `mkwii-ntsc-j/` carry `MAP.txt`, `data_addresses.txt`,
  `recomp.yml` and `region_port.json` (chunk table vendored from mkw-sp's `port.py`, MIT). There is
  no `tools/region` and no `projects/mkwii-ntsc-k` on main.
- Our fork's region mechanism is the #247 one (compile-time headers under
  `runtime/include/region/*.h` written by `tools/region`, `generated/RuntimeConfig.h` naming the
  header). It is now a different design from upstream's; a rebase of the web branch onto upstream
  would adopt theirs. None of the items below is a drop-in PR; each needs re-deriving against main.

Per item, what it fixes, whether upstream still has the problem, and the PR shape:

1. **ELF blob symbols** (fork `2317efe`, `runtime/cmake/PublicProducts.cmake`, one character:
   `^\.globl _(.+)$` → `^\.globl _?(.+)$`). The translator writes Mach-O labels as `_kData_x`
   and ELF labels as `kData_x`; the web branch's configure-time `#embed` conversion of
   `data_sections_init_blobs.S` only matched the former, so Linux hosts produced nameless arrays.
   **Upstream does not have this code**: on main `PublicProducts.cmake` assembles
   `data_sections_init_blobs.S` directly as ASM (lines 10-30) and never parses its labels. The
   conversion is Minithena's web-branch addition. Belongs to Minithena, not upstream (section 1).

2. **NAND save test heap under Node** (fork `5b57402`, `runtime/CMakeLists.txt`:
   `-sALLOW_MEMORY_GROWTH` on `mkw_nand_save_tests` when `MKW_PLATFORM_WEB`; the fixture outgrows
   Emscripten's 16 MiB default heap and the test aborted in `abortOnCannotGrowMemory`). Upstream
   has no Emscripten target, so **not applicable upstream** until a web port lands there. Belongs
   to Minithena (section 1).

3. **Region porter anchoring** (fork `c63a1e3`, `tools/region/port_data_addresses.py`): for data
   the chunk table does not map and no reference site proves (all REL data), the porter fell back
   to the same offset within the section, which is wrong where a section shifts internally
   (RMCK01's REL `.data` is 0x18 further in than PAL from `808B3984` on). The fix anchors to the
   nearest chunk-mapped word below when the verified NTSC-U table shows the same offset and the
   next mapped word above moved by the same amount. **Upstream has no `tools/region`** on main
   (PR #326 touched `tools/region/gen_guest_address_table.py`, but it is not on main now), and
   its tables are range deltas, so the porter fix has no target there. It matters for anyone
   regenerating NTSC-K rows with the #247 tooling, i.e. our fork and DarthMDev's branch. Possible
   note to DarthMDev on #247 (closed, but the thread is where the tooling lives).

4. **Web data-address rows** (fork `aadd7fc`; 11 NTSC-U rows in
   `projects/mkwii-ntsc-u/data_addresses.txt`, hand-ported NTSC-J/K rows in a marked block;
   `docs/web-regions.md` has the evidence table: REL relocations for the StaticR singleton slots and
   kart-name tables, the `lis`/`addi` pair in `RFL::SearchDefaultData` for the default Mii table,
   every value matching Wiimm's four-region port database, three matching mkw-tournament-museum).
   The globals are `Input::Manager`, `Racedata`, `Raceinfo`, `RKSYS::Mgr`, `SectionMgr`,
   `RKNet::Controller`, the four kart-name tables and the default Mii records. **Upstream's
   `projects/mkwii-ntsc-u/data_addresses.txt` has none of these addresses** (grep for `809B8F4C`,
   `809B8F68`, `809B8F70`, `809B8F88`, `809BD508`, `809BD918`, `808AF240`, `808AF300`, `808AF390`,
   `808AF39C`, `8024C1B8`: 0 hits), because nothing on main reads those objects; they are used by
   the web branch's hooks (race warmup, benchmark, invite rooms). Several are not fixed deltas from
   PAL (SectionMgr is `.bss`+0x45E8 in RMCE01 but +0x4758 in PAL; the name tables PAL-0x4850), so
   upstream's range tables would reject them. The rows become a PR only together with the code
   that uses them, i.e. when the web port is proposed upstream; on their own, a note on #326 that
   these objects need rows (and how each was proven) is the useful shape. Keep the evidence format
   of upstream's file (`<PAL hex> <NTSC hex> <PALfuncname@ntscaddr instr ...>`).

5. **NTSC-K**: #326 says "left out for now". Our fork has `projects/mkwii-ntsc-k/` (from #247:
   `MAP.txt`, `recomp.yml`, `data_addresses.txt`, plus our hand-ported rows marked COMMUNITY where
   only a binary could prove them). We have no NTSC-K disc, so nothing on our side was run; the
   #247 rows came from DarthMDev's tooling against stand-in images. If asked, the honest offer is
   the tables and the porter, not a tested build.

6. The **web port itself** (Minithena's branch plus ours) is the big one and is out of scope for
   a note: upstream's README still says only clean PAL `RMCP01` works and lists Windows, Linux and
   macOS; a browser target would be a design conversation with patchzyy first (precompiled
   runtime vs the web branch's `-sPROXY_TO_PTHREAD` JSPI build), then PRs of one change each.
   `docs/plan.md` ("upstream contribution rules") already notes the sizes involved.

Formalities upstream expects: one change per PR, your own description, evidence of identical
behaviour for anything touching the game (ghost replay timings are the kind they accept), GPLv3,
and never any game data in a PR, issue or comment.
