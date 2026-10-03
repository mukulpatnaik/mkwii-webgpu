#!/usr/bin/env python3
"""Virtual Xbox 360-style gamepads through /dev/uinput, for browser gamepad tests.

No sudo and no python-evdev: the uinput ioctls are issued with the standard library. The user
needs write access to /dev/uinput (here an ACL entry); the new joystick nodes (/dev/input/eventN
and /dev/input/jsN) are handed to the logged-in seat user by systemd's uaccess rule for
ID_INPUT_JOYSTICK devices, which is what Chrome needs to read them.

Each pad copies the xpad driver's layout and identity (045e:028e "Microsoft X-Box 360 pad"), so
Chrome on Linux applies its XInput-style standard mapping (Gamepad.mapping == "standard").

    ./virtual-pad.py --count 4 --socket /tmp/vpad.sock     # runs until "quit", SIGINT or SIGTERM

Commands (one per line on the Unix socket; every command gets one reply line, "ok ..." or "err ..."):

    info                         JSON list of the pads and their /dev/input nodes
    btn  <pad> <button> <0|1>    press or release
    tap  <pad> <button> [ms]     press, hold for ms (default 120), release; replies after release
    axis <pad> <axis> <value>    lx ly rx ry: -32768..32767 (ly/ry negative = up, as on xpad)
                                 lt rt: 0..255;  hatx haty: -1, 0, 1 (the d-pad)
    reset <pad>                  release everything and centre the sticks
    quit                         destroy the pads and exit

Buttons: a b x y lb rb back start guide ls rs  (also south east north west select mode)
         up down left right  (d-pad through the hat axes, the way xpad reports it)
<pad> is 0-based; "all" applies a command to every pad.

From the shell:  printf 'tap 0 a 150\n' | nc -U -q1 /tmp/vpad.sock   (or socat)
"""
import argparse
import fcntl
import json
import os
import signal
import socket
import struct
import sys
import threading
import time

# linux/input-event-codes.h
EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
BTN = {
    'a': 0x130, 'south': 0x130, 'b': 0x131, 'east': 0x131,
    'x': 0x133, 'north': 0x133, 'y': 0x134, 'west': 0x134,   # BTN_NORTH == BTN_X, BTN_WEST == BTN_Y
    'lb': 0x136, 'tl': 0x136, 'rb': 0x137, 'tr': 0x137,
    'back': 0x13a, 'select': 0x13a, 'start': 0x13b, 'guide': 0x13c, 'mode': 0x13c,
    'ls': 0x13d, 'thumbl': 0x13d, 'rs': 0x13e, 'thumbr': 0x13e,
}
ABS = {'lx': 0x00, 'ly': 0x01, 'lt': 0x02, 'rx': 0x03, 'ry': 0x04, 'rt': 0x05, 'hatx': 0x10, 'haty': 0x11}
ABS_RANGE = {  # (min, max, fuzz, flat) as xpad registers them
    'lx': (-32768, 32767, 16, 128), 'ly': (-32768, 32767, 16, 128),
    'rx': (-32768, 32767, 16, 128), 'ry': (-32768, 32767, 16, 128),
    'lt': (0, 255, 0, 0), 'rt': (0, 255, 0, 0), 'hatx': (-1, 1, 0, 0), 'haty': (-1, 1, 0, 0),
}
DPAD = {'up': ('haty', -1), 'down': ('haty', 1), 'left': ('hatx', -1), 'right': ('hatx', 1)}

# linux/uinput.h ioctls
def _ioc(direction, nr, size):
    return (direction << 30) | (size << 16) | (ord('U') << 8) | nr
UI_DEV_CREATE, UI_DEV_DESTROY = _ioc(0, 1, 0), _ioc(0, 2, 0)
UI_SET_EVBIT, UI_SET_KEYBIT, UI_SET_ABSBIT = _ioc(1, 100, 4), _ioc(1, 101, 4), _ioc(1, 103, 4)
UI_GET_SYSNAME = lambda n: _ioc(2, 44, n)
BUS_USB = 0x03
ABS_CNT = 64
INPUT_EVENT = struct.Struct('llHHi')  # struct input_event on 64-bit Linux (timeval + type, code, value)


class Pad:
    def __init__(self, index, name, vendor, product):
        self.index = index
        self.fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
        self.lock = threading.Lock()
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_ABS)
        for code in sorted(set(BTN.values())):
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        absmax, absmin, absfuzz, absflat = ([0] * ABS_CNT for _ in range(4))
        for axis, code in ABS.items():
            fcntl.ioctl(self.fd, UI_SET_ABSBIT, code)
            absmin[code], absmax[code], absfuzz[code], absflat[code] = ABS_RANGE[axis]
        # struct uinput_user_dev: name[80], input_id{bustype,vendor,product,version}, ff_effects_max,
        # absmax[64], absmin[64], absfuzz[64], absflat[64]
        dev = struct.pack('80sHHHHI', name.encode()[:79], BUS_USB, vendor, product, 0x0114, 0)
        dev += struct.pack(f'{ABS_CNT}i' * 4, *absmax, *absmin, *absfuzz, *absflat)
        os.write(self.fd, dev)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        buf = bytearray(64)
        fcntl.ioctl(self.fd, UI_GET_SYSNAME(len(buf)), buf)
        self.sysname = buf.split(b'\0', 1)[0].decode()  # e.g. input42
        self.nodes = self._nodes()
        self.reset()

    def _nodes(self):
        base = f'/sys/devices/virtual/input/{self.sysname}'
        for _ in range(50):  # udev creates the nodes, then uaccess adds the user's ACL, asynchronously
            try:
                names = sorted(n for n in os.listdir(base) if n.startswith(('event', 'js')))
                if any(n.startswith('js') for n in names) and all(os.access('/dev/input/' + n, os.R_OK) for n in names):
                    return ['/dev/input/' + n for n in names]
            except FileNotFoundError:
                pass
            time.sleep(0.1)
        return ['/dev/input/' + n for n in sorted(os.listdir(base)) if n.startswith(('event', 'js'))]

    def emit(self, etype, code, value):
        now = time.time()
        with self.lock:
            os.write(self.fd, INPUT_EVENT.pack(int(now), int((now % 1) * 1e6), etype, code, value))
            os.write(self.fd, INPUT_EVENT.pack(int(now), int((now % 1) * 1e6), EV_SYN, SYN_REPORT, 0))

    def button(self, name, down):
        if name in DPAD:
            axis, value = DPAD[name]
            self.emit(EV_ABS, ABS[axis], value if down else 0)
        elif name in BTN:
            self.emit(EV_KEY, BTN[name], 1 if down else 0)
        else:
            raise ValueError(f'unknown button {name}')

    def axis(self, name, value):
        if name not in ABS:
            raise ValueError(f'unknown axis {name}')
        lo, hi, _, _ = ABS_RANGE[name]
        self.emit(EV_ABS, ABS[name], max(lo, min(hi, int(value))))

    def reset(self):
        for code in sorted(set(BTN.values())):
            self.emit(EV_KEY, code, 0)
        for name in ABS:
            self.axis(name, 0)

    def info(self):
        return {'pad': self.index, 'sysname': self.sysname, 'nodes': self.nodes,
                'readable': {n: os.access(n, os.R_OK) for n in self.nodes}}

    def destroy(self):
        try:
            fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        finally:
            os.close(self.fd)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--count', type=int, default=1, help='number of pads (default 1)')
    ap.add_argument('--socket', default='/tmp/vpad.sock', help='Unix socket for commands')
    ap.add_argument('--name', default='Microsoft X-Box 360 pad')
    ap.add_argument('--vendor', type=lambda s: int(s, 16), default=0x045e)
    ap.add_argument('--product', type=lambda s: int(s, 16), default=0x028e)
    args = ap.parse_args()

    pads = []
    stop = threading.Event()

    def shutdown(*_):
        stop.set()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        for i in range(args.count):
            pads.append(Pad(i, args.name, args.vendor, args.product))
        for p in pads:
            print(json.dumps(p.info()), flush=True)

        def targets(spec):
            return pads if spec == 'all' else [pads[int(spec)]]

        def handle(line):
            words = line.split()
            if not words:
                return 'ok'
            cmd, rest = words[0], words[1:]
            if cmd == 'info':
                return 'ok ' + json.dumps([p.info() for p in pads])
            if cmd == 'quit':
                stop.set()
                return 'ok bye'
            if cmd == 'btn':
                for p in targets(rest[0]):
                    p.button(rest[1], rest[2] != '0')
            elif cmd == 'tap':
                hold = int(rest[2]) if len(rest) > 2 else 120
                for p in targets(rest[0]):
                    p.button(rest[1], True)
                time.sleep(hold / 1000)
                for p in targets(rest[0]):
                    p.button(rest[1], False)
            elif cmd == 'axis':
                for p in targets(rest[0]):
                    p.axis(rest[1], int(rest[2]))
            elif cmd == 'reset':
                for p in targets(rest[0]):
                    p.reset()
            else:
                return f'err unknown command {cmd}'
            return 'ok'

        def serve_client(conn):
            with conn, conn.makefile('rw') as f:
                for line in f:
                    try:
                        reply = handle(line.strip())
                    except (IndexError, ValueError) as e:
                        reply = f'err {e}'
                    f.write(reply + '\n')
                    f.flush()
                    if stop.is_set():
                        break

        if os.path.exists(args.socket):
            os.unlink(args.socket)
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(args.socket)
        srv.listen()
        srv.settimeout(0.2)
        print(f'listening on {args.socket}', flush=True)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            threading.Thread(target=serve_client, args=(conn,), daemon=True).start()
        srv.close()
        os.unlink(args.socket)
    finally:
        for p in pads:
            p.destroy()
        print('destroyed', len(pads), 'pad(s)', flush=True)


if __name__ == '__main__':
    sys.exit(main())
