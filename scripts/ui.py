#!/usr/bin/env python3
"""Tiny adb + uiautomator helper for the emulator walkthrough.

  ui.py wait TEXT [SECONDS]   wait until TEXT is on screen
  ui.py tap TEXT [SECONDS]    wait for TEXT, then tap its centre
  ui.py scroll-to TEXT        swipe up until TEXT is on screen, then tap it
  ui.py tap-input N           tap the N-th text field (0-based)
  ui.py shot NAME             save a screenshot to shots/NAME.png
  ui.py dump                  print every text on screen

Matches the start of a node's text (or content-desc), case-insensitive.
"""
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


def adb(*args, capture=False):
    return subprocess.run(["adb", *args], check=False, capture_output=capture, text=not capture)


def nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", capture=True)
    out = adb("exec-out", "cat", "/sdcard/ui.xml", capture=True).stdout
    try:
        root = ET.fromstring(out.decode("utf-8", "replace"))
    except ET.ParseError:
        return []
    return list(root.iter("node"))


def label(n):
    return (n.get("text") or n.get("content-desc") or "").strip()


def find(text):
    want = text.lower()
    for n in nodes():
        if label(n).lower().startswith(want):
            return n
    return None


def centre(n):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2


def wait(text, seconds=15):
    end = time.time() + seconds
    while time.time() < end:
        n = find(text)
        if n is not None:
            return n
        time.sleep(1)
    print(f"NOT FOUND: {text!r}. On screen:", file=sys.stderr)
    for n in nodes():
        if label(n):
            print("  ", label(n), file=sys.stderr)
    sys.exit(1)


def screen_size():
    out = adb("shell", "wm", "size", capture=True).stdout.decode()
    w, h = map(int, re.findall(r"(\d+)x(\d+)", out)[-1])
    return w, h


def tap(n):
    x, y = centre(n)
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(1.5)


def main():
    cmd, *rest = sys.argv[1:]
    if cmd == "wait":
        wait(rest[0], int(rest[1]) if len(rest) > 1 else 15)
        print(f"found: {rest[0]}")
    elif cmd == "tap":
        tap(wait(rest[0], int(rest[1]) if len(rest) > 1 else 15))
        print(f"tapped: {rest[0]}")
    elif cmd == "scroll-to":
        for _ in range(8):
            n = find(rest[0])
            if n is not None:
                tap(n)
                print(f"tapped: {rest[0]}")
                return
            w, h = screen_size()
            adb("shell", "input", "swipe", str(w // 2), str(h * 3 // 4), str(w // 2), str(h // 4), "300")
            time.sleep(1)
        wait(rest[0], 1)
    elif cmd == "tap-input":
        fields = [n for n in nodes() if n.get("class") == "android.widget.EditText"]
        idx = int(rest[0])
        if idx >= len(fields):
            sys.exit(f"only {len(fields)} text fields on screen")
        tap(fields[idx])
        print(f"tapped text field {idx}")
    elif cmd == "shot":
        os.makedirs("shots", exist_ok=True)
        with open(f"shots/{rest[0]}.png", "wb") as f:
            f.write(adb("exec-out", "screencap", "-p", capture=True).stdout)
    elif cmd == "dump":
        for n in nodes():
            if label(n):
                print(label(n))
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
