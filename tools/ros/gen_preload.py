"""Write public/games/<episode>/preload.json — the interface images the game menu warms in the background
(engine.js preloadReign): skill / class / status icons (hud/), unit icons, heraldry, crests, dialogue portraits and
UI frames. Re-run after adding or renaming files in those folders:  python tools/ros/gen_preload.py
"""
import json, os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'games')
DIRS = ['hud', 'icons', 'heraldry', 'crests', 'portraits', 'ui']

for ep in ('reign-of-swords', 'reign-of-swords-2'):
    base = os.path.join(ROOT, ep)
    files = []
    for d in DIRS:
        top = os.path.join(base, d)
        if not os.path.isdir(top):
            continue
        for dirpath, _, names in os.walk(top):
            for n in sorted(names):
                if n.lower().endswith(('.png', '.jpg', '.webp')):
                    files.append(os.path.relpath(os.path.join(dirpath, n), base).replace(os.sep, '/'))
    with open(os.path.join(base, 'preload.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(sorted(files), f, indent=0)
        f.write('\n')
    print(ep, len(files))
