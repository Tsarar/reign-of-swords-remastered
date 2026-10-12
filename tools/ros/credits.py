#!/usr/bin/env python3
"""The original games' credits, as their About screen shows them — read from each episode's string table (the strings
right after the version and copyright lines: section titles, names, a ' ' between sections) and written to
public/games/<episode>/credits.json for the in-game About screen.

Episode I also lists the teams of its other builds, whose credits differ: the Android port (v1.2.9, its own ros.dat
archive — same format, credits in strings 2–39, titles in capitals) and the PC build, whose three extra names come
from community research only (its executable is packed, so its credits can't be read from our copy).

    python tools/ros/credits.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from rosdat import Archive, open_episode  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = {1: "public/games/reign-of-swords/credits.json", 2: "public/games/reign-of-swords-2/credits.json"}
# string ids: the credits run [first, last] (Episode I's About text 3–51; Episode II's 8–61, after "-CREDITS-"),
# and the copyright line
RANGE = {1: (3, 51), 2: (8, 61)}
COPYRIGHT = {1: 1, 2: 3}
# your own copy of the Android APK's assets/ros.dat (not included in this repository): set ROS_DAT_ANDROID, or put it
# at extracted-assets/android/_raw/ beside the repository, as rosdat.py does for the iOS archives
ANDROID_DAT = os.environ.get("ROS_DAT_ANDROID") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "extracted-assets", "android", "_raw", "ros.dat"
)
ANDROID_RANGE = (2, 39)
# credited in the PC build (v1.6.0) and in no build we have: reported by community research, roles unknown
PC_ONLY = ["Brent Patterson", "Cuong Nguyen", "Nhung Ngo"]


def section_title(text):
    # "CREATIVE DIRECTOR:" → "Creative Director"; "QA:" stays "QA"
    words = text.rstrip(":").split()
    return " ".join(w if len(w) <= 2 or not w.isupper() else w.capitalize() for w in words)


def read_sections(strings, first, last):
    sections, current = [], None
    for text in strings[first : last + 1]:
        text = text.strip()
        if not text:
            current = None
            continue
        if current is None:
            current = {"title": section_title(text), "names": []}
            sections.append(current)
        else:
            current["names"].append(text)
    return sections


def other_builds():
    strings = Archive(ANDROID_DAT).strings()
    android = {
        "build": "Android",
        "version": re.search(r"v[\d.]+$", strings[0])[0],
        "sections": read_sections(strings, *ANDROID_RANGE),
    }
    pc = {
        "build": "PC",
        "version": "v1.6.0",
        "note": "Credited in the PC build, per community research; not in any build we have, so their roles aren't listed.",
        "sections": [{"title": "Also credited", "names": PC_ONLY}],
    }
    return [android, pc]


def credits(ep):
    strings = open_episode(ep).strings()
    sections = read_sections(strings, *RANGE[ep])
    # string 0 is the game's name ("… v1.0.48" in Episode I); Episode II adds "Episode II" (1) and "v1.0.11" (2)
    name = re.sub(r"\s+v[\d.]+$", "", strings[0]) + (" — " + strings[1] if ep == 2 else "")
    version = (re.search(r"v[\d.]+$", strings[0]) or [None])[0] if ep == 1 else strings[2]
    data = {
        "game": name,
        "version": version,
        "copyright": strings[COPYRIGHT[ep]].split(".")[0] + ".",
        "sections": sections,
    }
    if ep == 1:
        data["otherBuilds"] = other_builds()
    return data


if __name__ == "__main__":
    for ep, path in OUT.items():
        data = credits(ep)
        with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        sections = data["sections"] + [s for b in data.get("otherBuilds", []) for s in b["sections"]]
        names = {n for s in sections for n in s["names"]}
        print(path, len(sections), "sections,", len(names), "distinct names")
