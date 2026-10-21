// Look-and-feel helpers: the theme, the card style and the Arabic text size.
// They apply the saved choices on load; there is no settings page to change them.

export function applyTextScale(scale: string) {
  document.documentElement.style.setProperty("--ar-scale", scale);
}

export function applyCardStyle(style: string) {
  document.documentElement.dataset.card = style === "index" ? "index" : "sticky";
}

// the chosen theme; "system" follows the Mac's light or dark setting as it changes
let chosenTheme = "light";
const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
systemDark?.addEventListener?.("change", () => {
  if (chosenTheme === "system") applyTheme("system");
});

export function applyTheme(theme: string) {
  chosenTheme = theme;
  const dark = theme === "dark" || (theme === "system" && !!systemDark?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    localStorage.setItem("ara-theme", theme); // read before paint by index.html
  } catch {
    /* private mode: the server setting still applies on next load */
  }
}
