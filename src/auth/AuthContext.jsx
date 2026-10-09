// Accounts are not part of this repository. The game asks for the signed-in player (the Online Battles lobby shows
// only Hot-seat when there is none), so this provides the same interface with nobody signed in.
import { createContext, useContext } from "react";

const OFFLINE = Object.freeze({
  enabled: false,
  ready: true,
  user: null,
  profile: null,
  providers: { email: false, oauth: [] },
  recovering: false,
});

const AuthCtx = createContext(OFFLINE);

export function AuthProvider({ children }) {
  return <AuthCtx.Provider value={OFFLINE}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
