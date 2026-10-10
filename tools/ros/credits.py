#!/usr/bin/env python3
"""The original games' credits, as their About screen shows them — read from each episode's string table (the strings
right after the version and copyright lines: section titles, names, a ' ' between sections) and written to
public/games/<episode>/credits.json for the in-game About screen.

    python tools/ros/credits.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from rosdat import open_episode  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = {1: "public/games/reign-of-swords/credits.json", 2: "public/games/reign-of-swords-2/credits.json"}
# string ids: the credits run [first, last] (Episode I's About text 3–51; Episode II's 8–61, after "-CREDITS-"),
# and the copyright line
RANGE = {1: (3, 51), 2: (8, 61)}
COPYRIGHT = {1: 1, 2: 3}


def credits(ep):
    strings = open_episode(ep).strings()
    first, last = RANGE[ep]
    sections, current = [], None
    for text in strings[first : last + 1]:
        text = text.strip()
        if not text:
            current = None
            continue
        if current is None:
            current = {"title": text.rstrip(":"), "names": []}
            sections.append(current)
        else:
            current["names"].append(text)
    # string 0 is the game's name ("… v1.0.48" in Episode I); Episode II adds "Episode II" (1) and "v1.0.11" (2)
    name = re.sub(r"\s+v[\d.]+$", "", strings[0]) + (" — " + strings[1] if ep == 2 else "")
    version = (re.search(r"v[\d.]+$", strings[0]) or [None])[0] if ep == 1 else strings[2]
    return {
        "game": name,
        "version": version,
        "copyright": strings[COPYRIGHT[ep]].split(".")[0] + ".",
        "sections": sections,
    }


if __name__ == "__main__":
    for ep, path in OUT.items():
        data = credits(ep)
        with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        names = sum(len(s["names"]) for s in data["sections"])
        print(path, len(data["sections"]), "sections,", names, "credits")
