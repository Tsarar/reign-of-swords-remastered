import { useEffect, useRef } from "react";
import { base } from "../../data/shell-data.js";
import { sfxLevel } from "../../util/volume.js";

// The menus' sounds, respecting the Effects mute and volume:
//  • a short click blip (the game's own select sound) on every button / tile press anywhere in the page — debounced,
//    so a double-fired event doesn't stack into a rattle;
//  • playSfx(name, volume) for a named clip from audio/ (coins on a trade or spoils, upgrade on an army upgrade).
// Returns playSfx. (snd_003 is an in-battle order-confirm in the original, not a menu sound, so it isn't used here.)
export function useUiSounds(muted) {
  const clickSfx = useRef(null);
  const lastClick = useRef(0);
  useEffect(() => {
    const onClick = (e) => {
      if (muted) return;
      const b =
        e.target.closest &&
        e.target.closest("button, .ros-army-tile, .ros-rost, .ros-swatch, .ros-device, .ros-bgtype");
      if (!b || b.disabled) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastClick.current < 90) return; // at most one blip per 90 ms
      lastClick.current = now;
      try {
        if (!clickSfx.current) {
          clickSfx.current = new Audio(base + "audio/select.mp3");
        }
        clickSfx.current.volume = 0.3 * sfxLevel();
        clickSfx.current.currentTime = 0;
        clickSfx.current.play().catch(() => {});
      } catch (err) {}
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [muted]);

  const clips = useRef({}); // one Audio per clip name
  return (name, vol = 0.5) => {
    if (muted) return;
    try {
      let a = clips.current[name];
      if (!a) {
        a = new Audio(base + "audio/" + name + ".mp3");
        clips.current[name] = a;
      }
      a.currentTime = 0;
      a.volume = Math.min(1, vol * sfxLevel());
      a.play().catch(() => {});
    } catch (e) {}
  };
}
