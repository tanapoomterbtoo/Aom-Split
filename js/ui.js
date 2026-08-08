/**
 * Aom Split — shared UI helpers
 */
(function (global) {
  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function toast(msg) {
    var el = document.getElementById("aom-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "aom-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove("show");
    }, 2400);
  }

  function memberName(session, id) {
    var m = (session.members || []).find(function (x) {
      return x.id === id;
    });
    return m ? m.displayName : id;
  }

  function memberColor(session, id) {
    var m = (session.members || []).find(function (x) {
      return x.id === id;
    });
    return (m && m.color) || "#888";
  }

  function avatar(session, id, size) {
    size = size || 32;
    var name = memberName(session, id);
    var color = memberColor(session, id);
    var initial = (name && name.charAt(0)) || "?";
    return (
      '<span class="avatar" style="width:' +
      size +
      "px;height:" +
      size +
      "px;background:" +
      color +
      '" title="' +
      String(name).replace(/"/g, "&quot;") +
      '">' +
      initial +
      "</span>"
    );
  }

  function getQuery(name) {
    try {
      var u = new URL(location.href);
      var v = u.searchParams.get(name);
      if (v != null && v !== "") return v;
    } catch (e) {
      /* fall through */
    }
    var q = (location.search || "").replace(/^\?/, "");
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (decodeURIComponent(kv[0] || "") === name) {
        return decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      }
    }
    return null;
  }

  /**
   * Directory of current page, always ends with /
   * Fixes GitHub Pages case: pathname "/Aom-Split" (no trailing slash)
   * must NOT become "/" 
   */
  function currentDir() {
    try {
      var path = location.pathname || "/";
      var segments = path.split("/");
      var last = segments[segments.length - 1] || "";
      var looksLikeFile = last.indexOf(".") !== -1;

      if (path.endsWith("/")) {
        return path;
      }
      if (looksLikeFile) {
        // /Aom-Split/index.html -> /Aom-Split/
        return path.replace(/\/[^/]*$/, "/") || "/";
      }
      // /Aom-Split  (project root without slash) -> /Aom-Split/
      return path + "/";
    } catch (e) {
      return "./";
    }
  }

  /** Relative or root-path URL to a file next to the app */
  function pageUrl(file, params) {
    file = String(file || "").replace(/^\.\//, "");
    // Prefer simple relative name — browser resolves against current directory URL
    // But when pathname is "/repo" without slash, relative breaks; so use absolute path from currentDir()
    var url = currentDir() + file;
    if (params && typeof params === "object") {
      var qs = [];
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== "") {
          qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
        }
      });
      if (qs.length) url += "?" + qs.join("&");
    }
    return url;
  }

  function go(file, params) {
    var target = pageUrl(file, params);
    // location.assign is more predictable than href setter on some mobile browsers
    try {
      location.assign(target);
    } catch (e) {
      location.href = target;
    }
  }

  /**
   * If opened as https://user.github.io/Aom-Split (no trailing slash),
   * normalize to .../Aom-Split/ so relative links keep working.
   */
  function ensureTrailingSlashForDir() {
    try {
      var path = location.pathname || "";
      var last = path.split("/").pop() || "";
      var looksLikeFile = last.indexOf(".") !== -1;
      if (path && !path.endsWith("/") && !looksLikeFile) {
        location.replace(
          path + "/" + (location.search || "") + (location.hash || "")
        );
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          toast("คัดลอกแล้ว");
        },
        function () {
          fallbackCopy(text);
        }
      );
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("คัดลอกแล้ว");
    } catch (e) {
      toast("คัดลอกไม่สำเร็จ");
    }
    document.body.removeChild(ta);
  }

  function buildShareText(session, plan) {
    var lines = [];
    lines.push("🍺 " + (session.title || "ทริป"));
    lines.push("วันที่ " + (session.date || ""));
    lines.push("");
    lines.push("— ยอดต่อคน —");
    (session.members || []).forEach(function (m) {
      var paid = plan.paid[m.id] || 0;
      var owed = plan.owed[m.id] || 0;
      var bal = plan.balances[m.id] || 0;
      lines.push(
        m.displayName +
          ": กิน " +
          AomMoney.formatMoney(owed) +
          " · จ่าย " +
          AomMoney.formatMoney(paid) +
          " · สุทธิ " +
          AomMoney.formatSigned(bal)
      );
    });
    lines.push("");
    if (!plan.transfers || !plan.transfers.length) {
      lines.push("✅ ลงตัว ไม่ต้องโอนเพิ่ม");
    } else {
      lines.push("— ต้องโอน —");
      plan.transfers.forEach(function (t) {
        lines.push(
          memberName(session, t.from) +
            " → " +
            memberName(session, t.to) +
            " " +
            AomMoney.formatMoney(t.amountMinor)
        );
      });
    }
    lines.push("");
    lines.push("จาก Aom Split");
    return lines.join("\n");
  }

  global.AomUI = {
    qs: qs,
    qsa: qsa,
    toast: toast,
    memberName: memberName,
    memberColor: memberColor,
    avatar: avatar,
    getQuery: getQuery,
    currentDir: currentDir,
    pageUrl: pageUrl,
    go: go,
    ensureTrailingSlashForDir: ensureTrailingSlashForDir,
    copyText: copyText,
    buildShareText: buildShareText,
  };
})(typeof window !== "undefined" ? window : globalThis);
