# Spike: the user's disc image, read in the browser

Proves M3 ("players bring their own disc") is cheap: nod, the Rust GameCube/Wii disc library that
WiiCompiled's setup already uses as `nodtool`, compiles to `wasm32-unknown-unknown` with no C
dependencies (`default-features = false`; ISO, WBFS and CISO need no compression backend) and
can open an image through a host read callback instead of a file.

Result on 2026-10-02 against a 2.6 GB NTSC-U WBFS (Node, same ABI a Web Worker would use):

```text
wasm size: 401,038 bytes
game id: RMCE01  (open 18 ms, 9 reads, 8.4 MB)
fst: 2007 files, 2.50 GiB  (33 ms)
main.dol:        2,749,248 bytes  sha256 matches the region manifest   (3 ms)
rel/StaticR.rel: 4,902,804 bytes  sha256 matches the region manifest   (50 ms, 8 reads, 16.8 MB)
Race/Course/castle_course.szs: 2,577,993 bytes  (16 ms, 3 reads, 6.3 MB)
```

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
node test.mjs /path/to/your/RMCx01.{wbfs,iso,ciso} [expected-main.dol-sha256]
```

## ABI

One import, `env.host_read_at(ptr, len, offset_lo, offset_hi) -> 0|err`, which the host serves
synchronously. In a Web Worker that is `FileReaderSync` on `File.slice()` of the file the user
picked, or an OPFS sync access handle. Exports: `disc_open(len_lo, len_hi)`, `disc_game_id`,
`disc_list_files` ("size\tpath\n"), `disc_read(which, path, path_len, out, cap)` where `which`
selects an FST path or `main.dol`/`fst.bin`/`boot.bin`/`bi2.bin`/apploader, plus `disc_alloc`,
`disc_free`, `disc_last_error`.

## How this becomes M3

The runtime mounts `/game` from a WASMFS backend whose JS half today fetches a staged copy of
the extracted disc over HTTP (`mkw_fetchfs.js`). Two ways to replace that with the user's file:

1. **Lazy, no extraction:** a WASMFS backend whose JS half serves `/game/DATA/files/...` and
   `/game/DATA/sys/...` by calling this wasm (FST lookup, decrypting reads with a bounded chunk
   cache) against the picked `File`. No 2.5 GiB copy; the user re-picks the file per session, or
   the page keeps a `FileSystemFileHandle` in IndexedDB and asks permission again on reload. The
   existing manifest-driven prefetch logic keeps working against the same paths.
2. **Extract once into OPFS:** a worker walks the FST and writes files with sync access handles,
   then `/game` is an OPFS-backed WASMFS directory. Costs the copy and about 2.5 GiB of quota, but
   reloads are instant and need no permission prompt.

Either way the DOL/REL hashes identify the revision before anything else happens, and nothing
leaves the device. RVZ/GCZ support would need zstd/zlib compiled for wasm (nod's `*-vendored`
features through Emscripten's clang, as dusk-wasm did); WBFS, ISO and CISO work as is.

Licensing: nod is MIT/Apache-2.0; this directory is GPL-3.0-or-later like the rest of the project.
