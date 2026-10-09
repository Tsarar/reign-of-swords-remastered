// Online battles need a backend that is not part of this repository: here they are switched off, and the game's
// network module (src/reign-of-swords/online/net.js) reports that they are not available on this build.
export const SUPABASE_URL = "";
export const onlineConfigured = false;

export function getSupabase() {
  return Promise.resolve(null);
}

export async function enabledProviders() {
  return { email: false, oauth: [] };
}
