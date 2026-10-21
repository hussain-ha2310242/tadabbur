import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // in docker the backend is reachable by service name
      "/api": process.env.DOCKER ? "http://backend:8000" : "http://localhost:8000",
    },
  },
});
