import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/zahrashairgloss/" : "/",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
