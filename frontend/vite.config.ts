import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Production pages carry a content security policy: scripts only from this
// site, data only from this site and the Supabase project, fonts from Google.
// It is left out of `npm run dev`, whose live reload needs inline scripts.
const SUPABASE = process.env.VITE_SUPABASE_URL || "https://cyhmgmsdqlnllsuobfcw.supabase.co";
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self' ${SUPABASE}`,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), csp()],
  // /api/* is served by the Netlify functions (netlify dev runs them locally)
});
