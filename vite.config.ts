import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Vite refuses unknown Host headers, so the cloudflared tunnel would get a
    // 403 without this.
    allowedHosts: ['.dataturd.com'],
  },
});
