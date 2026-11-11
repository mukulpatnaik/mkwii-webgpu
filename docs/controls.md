# Controls: keyboard and game controllers

How player input reaches the game in the browser build, the default bindings, how to change them,
and what is known not to work. Verified on 2026-10-03 against the `athena-web-ntsc` web build
(staged Track E site) in Chrome 154 on Linux, with virtual pads; see "How this was tested".

## Input path

```
keyboard / mouse ──► SDL3 (Emscripten events) ──┐
                                                ├─► aurora PADRead (4 GameCube ports) ─► game's PADRead
Gamepad API ─► Emscripten html5 gamepad glue ─► SDL3 Emscripten joystick ─► SDL gamepad
```

- The game only sees **GameCube controllers** on ports 1-4. Every browser pad becomes a GameCube pad.
- SDL gives each connected pad a player index in connection order: first pad port 1, second port 2,
  and so on. F10 → Controller settings → Port N → "Assign connected controller" moves a pad to
  another port; the choice is saved.
- The web build turns on the **keyboard for port 1** at first start (arrow keys preset below).
  A pad on port 1 works alongside it: the pad is read and the keyboard adds to it (F10 says
  "Works alongside a gamepad on this port"). Natively the keyboard replaces the pad on its port.
- The browser hides pads from a page until a button is pressed on them while the page is open.

## Keyboard (port 1, default)

These are the defaults of the "Use arrow keys preset" in F10, which the web build applies at
first start: the arrow keys steer and the left hand does the rest, as PC kart racers and
Dolphin's GameCube pad default have it. A browser that already has saved bindings keeps them;
the preset buttons in F10 → Controller settings → Keyboard switch layouts. The page's Controls
card shows the live bindings for port 1: in the game, the faint menu button in the top right
corner (or Tab), then Controls; before the game, Controls on the menu.

| Key | GameCube input | In a race | In menus |
|---|---|---|---|
| ← / → | Control stick left / right | Steer | Move |
| ↑ / ↓ | Control stick up / down | Aim item forward / back | Move |
| X | A | Accelerate | Confirm |
| Z | B | Brake / reverse | Back |
| Left Shift | R (button and full analog pull) | Drift, hop | — |
| Space | L (button and full analog pull) | Use item | — |
| W / A / S / D | D-pad up / left / down / right | W: trick (in the air, as you leave a ramp) | D-pad |
| Enter | Start | Pause | — |
| C | X | not listed on the page | — |
| V | Y | not listed on the page | — |
| Q | Z | not listed on the page | — |
| L / J / I / K | C-stick right / left / up / down | not listed on the page | — |

### The WASD + mouse preset

"Use WASD + mouse preset" in F10 is the layout the web build used as its default until
2026-11-10, and the one Dolphin's emulated Wii Remote and Nunchuk default resembles:

| Key | GameCube input | In a race |
|---|---|---|
| A / D, W / S | Control stick | Steer; aim item forward / back |
| Left click | A | Accelerate |
| Space | B | Brake / reverse |
| Right click | R | Drift, hop |
| Left Shift | L | Use item |
| ↑ ← ↓ → | D-pad | ↑: trick |
| Enter | Start | Pause |
| E, Q, Middle click | X, Y, Z | not listed on the page |
| L / J / I / K | C-stick | not listed on the page |

`?layout=wasd` (or `?layout=arrows`) in the page's address applies that preset to port 1 at start,
whatever is saved. The browser test drivers add `layout=wasd` themselves: their recorded routes
speak this layout (a click is the game's A button, a and d steer).

Page and runtime keys (not game inputs):

| Key | Action |
|---|---|
| F10 (Mac: fn+F10) | Open or close the settings bar. Game input is blocked while it is open. |
| Escape | Closes the settings bar if open; otherwise opens a "Quit the game?" prompt (Cancel returns). |
| \ (backslash) | Mute / unmute (rebindable from the page) |

The game's own pause screen (Start during a race with a pad on port 1) labels the GameCube pad as:
stick Steer, A Accelerate, L Use Item, R Brake.

### Changing keys

- **On the page:** click a key in the Controls card (it is enabled once the game runs), then press
  a key or click a mouse button in the game. Backspace or Delete clears the binding; Cancel, or
  ten seconds without input, keeps the old one. The page sends the request to the runtime
  (`Module._mkw_web_rebind`), the runtime applies it at the next frame and publishes player 1's
  bindings back to the page as JSON (`window.mkwSetBindings`), which relabels every key.
- **In F10 → Controller settings:** pick a port, tick "Keyboard and mouse" for it, and click any
  binding. "Use arrow keys preset" restores the defaults; "Use WASD + mouse preset" switches to the
  mouse layout. F10 cannot be bound.
- Bindings are saved in the browser's storage for this site (OPFS, under `/persist`), so they
  survive a reload but not clearing site data or a different browser profile. If the storage is
  not persistent, the page says so ("Changes are lost when you reload").
- When keyboard and mouse are turned off for port 1, the page shows "—" for every key and a note
  telling you how to turn it back on.

## Game controllers

Any pad the browser reports with `Gamepad.mapping == "standard"` works without setup. SDL also
reads the vendor and product IDs from the Gamepad `id` string (Chrome:
`... (STANDARD GAMEPAD Vendor: 045e Product: 028e)`), so an Xbox pad shows up as
"Xbox 360 Controller" in F10, and picks the default table for its type (Xbox, PlayStation,
Switch Pro and generic pads all use the table below; GameCube adapters and Wii U Pro Controllers
have their own).

### Default pad bindings

| Standard Gamepad button / axis | Xbox name | PlayStation name | GameCube input | In a race | In menus |
|---|---|---|---|---|---|
| buttons[0] (bottom) | A | Cross | A | Accelerate | Confirm |
| buttons[1] (right) | B | Circle | B | Brake / reverse | Back |
| buttons[2] (left) | X | Square | X | — | — |
| buttons[3] (top) | Y | Triangle | Y | — | — |
| buttons[4] | LB | L1 | (unbound) | — | — |
| buttons[5] | RB | R1 | Z | — | — |
| buttons[6] (analog) | LT | L2 | L analog; L button past the activation point | Use item | — |
| buttons[7] (analog) | RT | R2 | R analog; R button past the activation point | Drift, hop | — |
| buttons[8] | Back / View | Share / Create | (unbound) | — | — |
| buttons[9] | Start / Menu | Options | Start | Pause | — |
| buttons[10], [11] | stick clicks | L3, R3 | (unbound) | — | — |
| buttons[12-15] | D-pad | D-pad | D-pad | Up: trick | Move |
| buttons[16] | Guide | PS | (unbound) | — | — |
| axes[0], axes[1] | left stick | left stick | Control stick (dead zone 8000 of 32767) | Steer; up/down aims items | Move |
| axes[2], axes[3] | right stick | right stick | C-stick (dead zone 8000 of 32767) | — | — |

Presets in F10 → Controller settings (with a pad on the selected port): **GameCube** (the table
above), **Classic Controller Pro** (A right, B bottom, X top, Y left, LB/RB → L/R, Back → Z) and
**PlayStation** (bottom/right/left/top as above, L1/R1 → L/R, Share → Z). Any GameCube input can
also be rebound to a pad button, trigger or stick direction, with an optional second binding, and
dead zones and Dolphin-style expressions are in the same menu. These are saved per pad model
(`<name>_<VID>_<PID>.controller`) and per port (`controller_ports.dat`) in the same browser
storage. Pads the browser cannot map (`mapping == ""`) should be offered "Set up" (the mapping
wizard) in F10 → Controller settings; not tested in the browser.

### Controllers the browser does not know (no standard layout)

Chrome gives only controllers it recognises the `standard` layout; others (many third-party
pads, for example the PowerA Core Plus Wired Controller for Switch, 20d6:a711) arrive with
`mapping: ""`, buttons in the device's own order and the D-pad as two extra axes. In the web
build SDL then falls back to a generic layout that rarely fits. What happens now:

- **Browser on Linux:** if SDL's Linux database knows the vendor and product, the page uses that
  mapping automatically, with the D-pad read from the two extra axes. The console says
  `[web-pad] 20d6:a711: using SDL's Linux mapping "PowerA Wired GameCube Controller"`. For a
  Switch-layout pad this means the **bottom** button is the game's A and the **right** button its B.
- **Otherwise** (an unknown pad, or Chrome on macOS/Windows, where the raw order differs and is
  untested): the console says no mapping fits, and F10 -> Controller settings lists the pad under
  "Unrecognized controllers" with **Fix mapping**. The wizard asks for each control; D-pad
  directions that arrive as axes are accepted. Save remembers it in this browser.

Tested in Chrome on Linux with simulated pads (`tools/browser-test/pad-drive.js`, `FAKE_PROFILE=powera`
and `FAKE_PROFILE=unknown`): the automatic mapping drives the menus with the bottom button and
D-pad; the wizard binds all 16 controls of the unknown pad and the saved mapping drives the menus.
Not tested: the real PowerA in the game, Chrome on macOS (which may report a raw D-pad as one
combined axis; the wizard cannot bind that, so skip the D-pad steps there), Firefox.

### Several players

- Local multiplayer (Main Menu → Multiplayer → 2/3/4 Players) opens the game's Controller
  Registration screen; each player presses A on their own controller. A pad's player number is
  the order of registration, not the port number.
- With four pads, they take ports 1-4; the keyboard shares port 1 with the first pad. (Only
  checked with four simulated pads in the page, before the port-1 fix; see the checklist.)

## Known problems and limits

1. **Fixed: a single pad did nothing while the keyboard was on for port 1** (fork commit
   b33c613, "Web: read a pad on port 1 even though the keyboard is on there by default"). Aurora's
   `PADRead` used to skip a port's pad whenever its keyboard was on, and the web build turns the
   keyboard on for port 1. Verified after the fix with one virtual pad and default settings: the
   pad alone drives title → licence → Grand Prix → race (`tools/browser-test/out/pad-fix/`).
2. **Mouse clicks in the F10 bar land in the wrong place when the game area is not 16:9.** The
   canvas element fills the area and letterboxes the picture with `object-fit: contain`, but
   SDL scales mouse positions by the element size, so on a non-16:9 window clicks hit a point
   above or below the item under the pointer. Keyboard play is unaffected (a click is position
   independent). Workaround: make the window close to 16:9 (the picture now takes the whole window, so the
   window's shape is the element's shape).
3. **Wii Remotes, Nunchuks and Classic Controllers do not work in the browser.** The game reads
   them through WPAD/KPAD, which the runtime feeds from SDL's HIDAPI Wii driver over Bluetooth;
   the Emscripten SDL build has no HIDAPI, so the "Wii Remotes (Bluetooth)" menu finds nothing and
   the "Add a Wii Remote" slots on the registration screen stay empty (console at boot:
   `[runtime-config] Bluetooth Wii Remote support enabled`, but nothing can connect).
4. **Rumble** goes through the Gamepad API's `vibrationActuator` ("dual-rumble") in SDL's
   Emscripten joystick driver; SDL reports rumble only when the browser gives the pad an actuator.
   Browser support varies. Untested (see checklist).
5. **The page must be focused.** Browsers stop reporting pad input to background tabs, and
   keyboard input needs the game canvas focused (click the game once; that click is also A).

## How this was tested

`tools/browser-test/virtual-pad.py` creates Xbox 360-style pads through `/dev/uinput` (no sudo:
the user has an ACL on `/dev/uinput`, and systemd's uaccess rule gives the seat user the new
`/dev/input/js*` and `event*` nodes). `tools/browser-test/pad-drive.js` boots the page in Chrome
on a nested display and drives it with pad commands only. Verified with screenshots (kept in the
gitignored `tools/browser-test/out/pad/`):

- `navigator.getGamepads()` lists the pad with `mapping: "standard"`; B, RT, D-pad up and the left
  stick show up as buttons 1, 7, 12 and axes[0].
- F10 shows the pad as "Xbox 360 Controller" on port 1 (hidden behind the keyboard until it is
  turned off).
- Pad only: title → licence → Main Menu → Single Player → Grand Prix → 50cc → character (stick and
  D-pad move the cursor, B goes back) → kart → drift type → Mushroom Cup → race. In the race: A
  accelerates, the stick steers, B reverses, Start pauses, the pause menu is driven with D-pad and
  stick. In Time Trials, LT used the mushrooms (three, then two, then one).
- Hot-plug: a pad connected after the game started works; unplugging it makes the game show
  "Communication with the controller has been interrupted"; plugging it back in and pressing A
  continues, and B then works.
- Four players: Chrome on Linux shows only one of several uinput pads (it groups device nodes by
  the sysfs path before `input`, which is `/sys/devices/virtual/` for every uinput device), so four
  pads were simulated in the page (`pad-drive.js` `fake:4`, which replaces
  `navigator.getGamepads()`). F10 showed "Xbox 360 Controller" on ports 2-4, a port-2 pad drove the
  menus, and the Controller Registration screen for 4 players registered ports 2, 3, 4 and the
  keyboard on port 1, then opened Multiplayer (4P).

## Human checklist (not verified here)

- [ ] A real USB or Bluetooth pad (Xbox, DualShock/DualSense, Switch Pro) in Chrome on Windows and
      macOS: detected, buttons as in the table, analog triggers.
- [ ] Four real pads at once: four entries in `navigator.getGamepads()`, ports 1-4 in F10 (after
      turning the keyboard off for port 1), four players register and race.
- [ ] Rumble on a real pad in Chrome (hit by an item, or the F10 "Controller vibration" switch);
      check it stops when turned off and when the tab is hidden.
- [ ] Hot-plug of a real pad mid-race and after sleep/resume; Bluetooth reconnects.
- [ ] Firefox: pad detection (Firefox uses a different `id` format), `mapping`, D-pad and triggers.
- [ ] A pad without the standard mapping (generic DirectInput pad on Windows): F10 mapping wizard.
- [ ] A GameCube controller adapter and an 8BitDo GameCube-style pad.
- [ ] Keyboard and pad together after the proposed fix: both drive port 1 without fighting.
- [ ] Mouse clicks in the F10 bar on a 16:10 or 4:3 window (known problem 2).
