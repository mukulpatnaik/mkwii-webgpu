// SPDX-License-Identifier: GPL-3.0-or-later
// macOS window facts for tools/video/capture.sh (run with osascript -l JavaScript):
//
//   osascript -l JavaScript tools/video/mac-windows.js workarea      -> "x y w h scale"
//   osascript -l JavaScript tools/video/mac-windows.js windows <pid>... -> "pid x y w h" per window
//
// workarea: the main display's visible frame (the screen minus the menu bar and the Dock) in
// points, top-left origin, the coordinates --window-position takes; scale is the display's
// backing scale (2 on Retina), physical pixels per point. windows: the on-screen, normal-layer
// windows owned by those processes, at least 600 points wide, in the same coordinates.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
// (JXA hands CoreGraphics constants back as strings: 1 | 16 is kCGWindowListOptionOnScreenOnly |
// kCGWindowListExcludeDesktopElements, 0 is kCGNullWindowID.)

function run(argv) {
  const what = argv[0];
  if (what === 'workarea') {
    const screen = $.NSScreen.mainScreen;
    const full = screen.frame, vis = screen.visibleFrame;
    const top = full.size.height - (vis.origin.y + vis.size.height);
    return [vis.origin.x, top, vis.size.width, vis.size.height, screen.backingScaleFactor].map((n) => Math.round(n * 1000) / 1000).join(' ');
  }
  if (what === 'windows') {
    const pids = new Set(argv.slice(1).map(Number));
    const list = ObjC.deepUnwrap(ObjC.castRefToObject(
      $.CGWindowListCopyWindowInfo(1 | 16, 0)));
    return (list || [])
      .filter((w) => pids.has(w.kCGWindowOwnerPID) && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 600)
      .map((w) => { const b = w.kCGWindowBounds; return [w.kCGWindowOwnerPID, b.X, b.Y, b.Width, b.Height].join(' '); })
      .join('\n');
  }
  throw new Error('usage: mac-windows.js workarea | windows <pid>...');
}
