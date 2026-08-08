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
    let el = document.getElementById("aom-toast");
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
    const m = (session.members || []).find(function (x) {
      return x.id === id;
    });
    return m ? m.displayName : id;
  }

  function memberColor(session, id) {
    const m = (session.members || []).find(function (x) {
      return x.id === id;
    });
    return (m && m.color) || "#888";
  }

  function avatar(session, id, size) {
    size = size || 32;
    const name = memberName(session, id);
    const color = memberColor(session, id);
    const initial = name.charAt(0);
    return (
      '<span class="avatar" style="width:' +
      size +
      "px;height:" +
      size +
      "px;background:" +
      color +
      '" title="' +
      name +
      '">' +
      initial +
      "</span>"
    );
  }

  function getQuery(name) {
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get(name);
      if (v != null && v !== "") return v;
    } catch (e) {
      /* fall through */
    }
    // Fallback for odd environments
    const q = (location.search || "").replace(/^\?/, "");
    const parts = q.split("&");
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split("=");
      if (decodeURIComponent(kv[0] || "") === name) {
        return decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      }
    }
    return null;
  }

  /** Build URL to a sibling page in the same folder (works on GitHub Pages /Aom-Split/) */
  function pageUrl(file, params) {
    const path = location.pathname || "/";
    const dir = /\/$/.test(path) ? path : path.replace(/\/[^/]*$/, "/");
    let url = dir + file;
    if (params && typeof params === "object") {
      const qs = Object.keys(params)
        .filter(function (k) {
          return params[k] != null && params[k] !== "";
        })
        .map(function (k) {
          return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        })
        .join("&");
      if (qs) url += "?" + qs;
    }
    return url;
  }

  function go(file, params) {
    location.href = pageUrl(file, params);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        toast("คัดลอกแล้ว");
      });
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("คัดลอกแล้ว");
    return Promise.resolve();
  }

  function buildShareText(session, plan) {
    const lines = [];
    lines.push("🍺 " + session.title);
    lines.push("วันที่ " + (session.date || ""));
    lines.push("");
    lines.push("— ยอดต่อคน —");
    (session.members || []).forEach(function (m) {
      const paid = plan.paid[m.id] || 0;
      const owed = plan.owed[m.id] || 0;
      const bal = plan.balances[m.id] || 0;
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
    if (!plan.transfers.length) {
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
    pageUrl: pageUrl,
    go: go,
    copyText: copyText,
    buildShareText: buildShareText,
  };
})(typeof window !== "undefined" ? window : globalThis);
