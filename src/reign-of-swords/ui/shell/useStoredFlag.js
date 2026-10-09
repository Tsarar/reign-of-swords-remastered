import { useState } from "react";

// A yes/no setting kept in localStorage as "1" / "0". Storage that is blocked (a private window, cleared site data)
// simply doesn't persist; the setting still works for the visit.
//   const [on, toggle, reset] = useStoredFlag("ros-muted");
// `toggle` flips and saves it; `reset` puts it back to `initial` WITHOUT writing (used after the keys are wiped).
export function useStoredFlag(key, initial = false) {
  const [on, setOn] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored == null ? initial : stored === "1";
    } catch (e) {
      return initial;
    }
  });
  const toggle = () =>
    setOn((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch (e) {}
      return next;
    });
  const reset = () => setOn(initial);
  return [on, toggle, reset];
}
