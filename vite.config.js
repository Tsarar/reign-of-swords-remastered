import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The game is served from the site root: its data lives in public/games/reign-of-swords[-2]/ and the code builds its
// asset URLs from import.meta.env.BASE_URL, exactly as on the website.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
