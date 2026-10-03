# mkw-web: one-file local server

`mkw-web` serves the private browser build on `127.0.0.1` with the headers it needs
(cross-origin isolation, byte ranges) and offers your disc image to the page, so you just run it
and play in Chrome. The page files are built into the executable; your disc image is not: keep it
next to the executable (or pass its path).

```bash
scripts/build-private-bundle.sh --skip-extract --skip-translate   # the page files, if not built yet
scripts/build-web-server.sh                                       # work/dist/mkw-web-linux-x86_64
work/dist/mkw-web-linux-x86_64 "game/Mario Kart Wii (USA) (En,Fr,Es).wbfs"
```

Options: `[disc image] [--port 8010] [--no-open] [--site DIR]`. Without a disc argument it takes the
first `.wbfs`/`.iso`/`.ciso`/`.gcm` next to the executable or in the current folder; without any,
the page asks you to pick one. It opens Chrome (or Edge/Chromium, else the default browser) unless
`--no-open`; the next free port is used when 8010 is taken.

## On a Mac

Build the kit here and finish on the Mac (needs [Bun](https://bun.sh) there):

```bash
scripts/build-web-server.sh --mac-kit        # work/dist/mkw-web-mac-kit.tar.gz (~25 MB)
```

On the Mac:

```bash
mkdir mkw-web && tar -xzf mkw-web-mac-kit.tar.gz -C mkw-web && cd mkw-web && ./build.sh
cp /path/to/your/disc.wbfs . && ./mkw-web
```

`bun server.js` in the kit folder also works without building. If macOS kills a freshly built
binary ("killed: 9"), sign it ad hoc: `codesign --sign - mkw-web`.

## Privacy

The executable and the kit contain translated game code: keep them on your own machines, never
upload or share them. The disc image is read from your disk by your own browser; nothing leaves
the machine (the server listens on 127.0.0.1 only).
