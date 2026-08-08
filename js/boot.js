/**
 * Early boot: normalize GitHub Pages directory URL before other scripts run.
 * Must be included first (inline or as first script).
 */
(function () {
  try {
    var path = location.pathname || "";
    var last = path.split("/").pop() || "";
    var looksLikeFile = last.indexOf(".") !== -1;
    if (path && !path.endsWith("/") && !looksLikeFile) {
      location.replace(path + "/" + (location.search || "") + (location.hash || ""));
    }
  } catch (e) {
    /* ignore */
  }
})();
