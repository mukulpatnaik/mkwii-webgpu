#!/usr/bin/env python3
"""Print the header of Mario Kart Wii ghosts: finish time, lap splits, course, ghost type.

Usage:
    scripts/parity/rkg-info.py FILE [FILE...]      # .rkg files or rksys.dat saves
    scripts/parity/rkg-info.py --self-test

For an rksys.dat every stored ghost is listed with its licence and slot. The output is the
reference for the parity check: the finish time and lap splits a correct replay must reproduce.
It reads game-derived files and prints facts about them; keep the output out of git.

RKG header layout (big-endian, bit fields packed MSB first; mkwiiki.org "RKG (File Format)"):
  0x00  "RKGD"
  0x04  finish time: 7 bits minutes, 7 bits seconds, 10 bits milliseconds
  0x07  6 bits course (slot) ID, 2 bits unused
  0x08  6 bits vehicle, 6 bits character, 7 bits year-2000, 4 bits month, 5 bits day,
        4 bits controller
  0x0C  4 bits unused, 1 bit compressed, 2 bits unused, 7 bits ghost type, 1 bit drift type
        (0 manual, 1 automatic), 1 bit unused
  0x10  lap count, then 0x11: five lap split times in the finish-time format
rksys.dat keeps its ghosts from 0x28000 in 0x2800-byte slots (four licences of 0xA5000 bytes).
"""
import struct
import sys

COURSES = {
    0x00: "Mario Circuit", 0x01: "Moo Moo Meadows", 0x02: "Mushroom Gorge",
    0x03: "Grumble Volcano", 0x04: "Toad's Factory", 0x05: "Coconut Mall", 0x06: "DK Summit",
    0x07: "Wario's Gold Mine", 0x08: "Luigi Circuit", 0x09: "Daisy Circuit",
    0x0A: "Moonview Highway", 0x0B: "Maple Treeway", 0x0C: "Bowser's Castle",
    0x0D: "Rainbow Road", 0x0E: "Dry Dry Ruins", 0x0F: "Koopa Cape",
    # Retro courses (0x10-0x1F) print as their slot ID only: their names have not been checked
    # against the game here. Luigi Circuit (0x08) was checked against the in-game Ghosts screen.
}
GHOST_TYPES = {0x01: "player best time", 0x02: "world record", 0x03: "continental record",
               0x04: "rival", 0x05: "special", 0x06: "ghost race", 0x25: "normal staff",
               0x26: "expert staff"}
GHOST_BASE, LICENCE_SIZE, SLOT_SIZE = 0x28000, 0xA5000, 0x2800


def race_time(b):
    v = int.from_bytes(b[:3], "big")
    return (v >> 17) & 0x7F, (v >> 10) & 0x7F, v & 0x3FF


def fmt_time(t):
    return f"{t[0]}:{t[1]:02d}.{t[2]:03d}"


def parse(h):
    if h[:4] != b"RKGD":
        return None
    w8 = struct.unpack(">I", h[8:12])[0]
    w12 = struct.unpack(">H", h[12:14])[0]
    laps = h[0x10]
    return {
        "time": race_time(h[4:7]),
        "course": h[7] >> 2,
        "vehicle": w8 >> 26,
        "character": (w8 >> 20) & 0x3F,
        "date": (2000 + ((w8 >> 13) & 0x7F), (w8 >> 9) & 0xF, (w8 >> 4) & 0x1F),
        "controller": w8 & 0xF,
        "type": (w12 >> 2) & 0x7F,
        "drift": "automatic" if (w12 >> 1) & 1 else "manual",
        "laps": [race_time(h[0x11 + 3 * i:0x14 + 3 * i]) for i in range(min(laps, 5))],
    }


def describe(g):
    course = COURSES.get(g["course"], f"course 0x{g['course']:02X}")
    kind = GHOST_TYPES.get(g["type"], f"type 0x{g['type']:02X}")
    splits = "  ".join(fmt_time(t) for t in g["laps"])
    return (f"{course:24s} {fmt_time(g['time'])}  laps {splits}  ({kind}, character {g['character']}, "
            f"vehicle {g['vehicle']}, {g['drift']} drift, {g['date'][0]}-{g['date'][1]:02d}-{g['date'][2]:02d})")


def scan(path):
    data = open(path, "rb").read()
    if data[:4] == b"RKGD":
        g = parse(data)
        print(f"{path}: {describe(g)}")
        return [g]
    if data[:4] != b"RKSD":
        print(f"{path}: neither an RKG ghost nor an rksys.dat save", file=sys.stderr)
        return []
    found = []
    for off in range(GHOST_BASE, len(data) - 0x88, SLOT_SIZE):
        g = parse(data[off:off + 0x88])
        if g:
            licence = (off - GHOST_BASE) // LICENCE_SIZE + 1
            slot = ((off - GHOST_BASE) % LICENCE_SIZE) // SLOT_SIZE
            print(f"{path}: licence {licence} slot {slot:2d}: {describe(g)}")
            found.append(g)
    if not found:
        print(f"{path}: no ghosts stored")
    return found


def self_test():
    h = bytearray(0x88)
    h[:4] = b"RKGD"
    h[4:7] = ((1 << 17) | (23 << 10) | 456).to_bytes(3, "big")
    h[7] = 0x08 << 2
    h[8:12] = struct.pack(">I", (2 << 26) | (5 << 20) | (8 << 13) | (4 << 9) | (12 << 4) | 1)
    h[12:14] = struct.pack(">H", (0x25 << 2) | (0 << 1))
    h[0x10] = 3
    for i, t in enumerate([(0, 30, 1), (0, 29, 834), (0, 29, 835)]):
        h[0x11 + 3 * i:0x14 + 3 * i] = ((t[0] << 17) | (t[1] << 10) | t[2]).to_bytes(3, "big")
    g = parse(bytes(h))
    assert g["time"] == (1, 23, 456) and fmt_time(g["time"]) == "1:23.456"
    assert g["course"] == 8 and g["type"] == 0x25 and g["drift"] == "manual"
    assert g["vehicle"] == 2 and g["character"] == 5 and g["date"] == (2008, 4, 12)
    assert [fmt_time(t) for t in g["laps"]] == ["0:30.001", "0:29.834", "0:29.835"]
    print("self-test ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    else:
        for p in sys.argv[1:]:
            scan(p)
