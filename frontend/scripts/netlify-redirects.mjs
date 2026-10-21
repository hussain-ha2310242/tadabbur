// Netlify: write dist/_redirects after the build.
// Calls to /api/* are forwarded to the backend named in API_URL (set it in
// Netlify > Site configuration > Environment variables, e.g.
// https://tadabbur-api-xxxxx.a.run.app), so the app keeps calling /api on its
// own address and needs no CORS. Every other path serves the app.
import { writeFileSync } from "node:fs";

const api = (process.env.API_URL || "").trim().replace(/\/+$/, "");
const lines = [];
if (api) {
  if (!/^https:\/\/[^\s]+$/.test(api)) {
    console.error(`API_URL must be an https:// address, got "${api}"`);
    process.exit(1);
  }
  lines.push(`/api/*  ${api}/api/:splat  200`);
} else {
  console.warn("API_URL is not set: the site builds, but /api calls will fail until it is set.");
}
lines.push("/*  /index.html  200");
writeFileSync(new URL("../dist/_redirects", import.meta.url), lines.join("\n") + "\n");
console.log("wrote dist/_redirects:\n" + lines.join("\n"));
