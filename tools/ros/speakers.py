# -*- coding: utf-8 -*-
"""
speakers.py - the single source of truth for dialogue portraits and speaker labels, both episodes.

Portraits (data-driven):
  Ep1  screen field 2 is a speaker id 41..72; the 32 busts published as portraits/face000-031.png
       are indexed by  face = speakerId - 41  (41 = the "?" debug bust, 42 = Sir Anston).
  Ep2  screen field 2 is a FRAME INDEX straight into resource 5017 (the 88-frame portrait pool);
       published as portraits/faceNNN.png with NNN = the frame index.
Side (data-driven): screen field 3, 0 = your side, anything else = the foe.

Names are NOT in the data. Enemy / allied lines fired by a round trigger carry the trigger's team,
so those get the real army name from the scenario record (Duke Pellus, Baron Valeuve, ...).
Everything else is a role label chosen per bust; proper names only where the lines themselves
establish them (Sir Anston, the Emperor, Duke Pellus, Baron Valeuve).
"""

# Episode I speaker id -> (label, side)   [carried over from the earlier spk_identity map]
EP1 = {
    42: ('Sir Anston', 'you'), 43: ('The Emperor', 'you'), 44: ('War Advisor', 'you'), 45: ('War Advisor', 'you'),
    46: ('Imperial Lord', 'you'), 47: ('Imperial Lord', 'you'),
    49: ('Field Officer', 'you'), 50: ('Herald', 'you'), 51: ('Sergeant', 'you'), 52: ('Field Officer', 'you'), 53: ('Herald', 'you'),
    69: ('Imperial Lord', 'you'), 70: ('Ally Lord', 'you'), 71: ('Loyal Lord', 'you'), 72: ('Loyal Lord', 'you'),
    54: ('Duke Pellus', 'foe'), 55: ('Enemy Lord', 'foe'), 56: ('Enemy Lord', 'foe'),
    57: ('Baron Valeuve', 'foe'), 58: ('Baron Valeuve', 'foe'),
    59: ('Enemy Lord', 'foe'), 60: ('Enemy Lord', 'foe'), 61: ('Enemy Lord', 'foe'),
    62: ('Enemy Captain', 'foe'), 63: ('Enemy Commander', 'foe'), 64: ('Lord of Corbeau', 'foe'),
    65: ('Enemy Lord', 'foe'), 66: ('Rebel Captain', 'foe'), 67: ('Siege Master', 'foe'), 68: ('Enemy Lord', 'foe'),
}

# Episode II portrait-pool frame -> label (busts grouped by the character they depict)
EP2 = {52: 'War Advisor', 54: 'War Advisor', 59: 'Field Officer', 60: 'Field Officer', 61: 'Field Officer',
       63: 'Field Officer', 80: 'Field Officer', 81: 'Field Officer', 82: 'Field Officer',
       83: 'Dark Sorcerer', 84: 'Dark Sorcerer', 85: 'Dark Sorcerer', 86: 'Desert Chieftain',
       53: 'War Advisor'}

# ONE ART STYLE — the old realistic one, in both episodes (user decision). Every 86-px bust in the Ep2 pool is a
# pixel-exact copy of an Episode I portrait (frame 53 = Ep1 face 002, 56 = 005, 60 = 009 ...); only the 90-px frames
# are Ep2's new cartoon art. Where a cartoon frame redraws an Episode I character, show that character's realistic
# Ep1 portrait with the same expression (the Ep1 image is copied into the Ep2 portraits dir by export_levels):
#   Sir Anston 52 calm -> 001, 54 angry -> 003, 55 wounded -> 004;  the green-collared noble 75 -> 024, 78 wounded -> 027.
# Ep2-only characters have no realistic version and keep their art (the young officer 59/61/63, 83-87).
EP2_REALISTIC = {52: 1, 54: 3, 55: 4, 75: 24, 78: 27}


def face(ep, spk):
    if ep != 1 and spk in EP2_REALISTIC:
        return 'face%03d' % EP2_REALISTIC[spk]
    return 'face%03d' % ((spk - 41) if ep == 1 else spk)


def label(ep, spk, side_flag, team_name=None):
    """Display name for a line. team_name = the scenario team that fired the trigger (enemy/ally barks)."""
    if team_name:
        return team_name
    if ep == 1:
        return EP1.get(spk, ('War Advisor' if side_flag == 0 else 'Enemy Commander'))[0]
    return EP2.get(spk, 'Field Officer' if side_flag == 0 else 'Enemy Commander')


def line(ep, spk, side_flag, text, team_name=None):
    return {'speaker': label(ep, spk, side_flag, team_name), 'side': 'you' if side_flag == 0 else 'foe',
            'face': face(ep, spk), 'text': text}
