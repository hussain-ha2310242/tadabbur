// apply the saved theme before first paint so there is no flash
(function () {
  try {
    var t = localStorage.getItem("ara-theme") || "light";
    var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
})();
