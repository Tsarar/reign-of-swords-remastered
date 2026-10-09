import { useEffect, useState } from "react";

// Shows an engine announcement (an object with an `id`: a turn banner, a reinforcement wave, a notice) for `ms`
// milliseconds after it arrives, then hides it. A new announcement (a new id) restarts the timer.
export function useFlash(item, ms) {
  const [shown, setShown] = useState(null);
  const id = item && item.id;
  useEffect(() => {
    if (!id) return;
    setShown(item);
    const timer = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(timer);
    // Keyed on the id alone: a fresh snapshot of the same announcement must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return shown;
}
