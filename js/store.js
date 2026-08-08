/**
 * Aom Split — localStorage persistence (auto-save on this device)
 */
(function (global) {
  const KEY = "aom_split_v1";
  const META_KEY = "aom_split_meta_v1";

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function isStorageAvailable() {
    try {
      const t = "__aom_split_probe__";
      localStorage.setItem(t, "1");
      localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { sessions: [], version: 1 };
      const data = JSON.parse(raw);
      if (!data.sessions) data.sessions = [];
      if (!data.version) data.version = 1;
      return data;
    } catch (e) {
      console.error("AomStore.load failed", e);
      return { sessions: [], version: 1 };
    }
  }

  function writeMeta(ok, errMsg) {
    try {
      localStorage.setItem(
        META_KEY,
        JSON.stringify({
          lastSavedAt: Date.now(),
          ok: !!ok,
          error: errMsg || null,
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function getMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function save(data) {
    if (!isStorageAvailable()) {
      writeMeta(false, "localStorage unavailable");
      const err = new Error("เบราว์เซอร์นี้บันทึกข้อมูลไม่ได้ (โหมดส่วนตัวหรือปิด storage)");
      err.code = "STORAGE_UNAVAILABLE";
      throw err;
    }
    try {
      data.version = data.version || 1;
      data.savedAt = Date.now();
      localStorage.setItem(KEY, JSON.stringify(data));
      writeMeta(true, null);
      try {
        global.dispatchEvent(
          new CustomEvent("aom-split-saved", {
            detail: { at: data.savedAt, count: (data.sessions || []).length },
          })
        );
      } catch (e) {
        /* old browsers */
      }
      return true;
    } catch (e) {
      writeMeta(false, String(e && e.message));
      if (e && e.name === "QuotaExceededError") {
        const err = new Error("ที่เก็บเต็ม — ลบทริปเก่าหรือส่งออกสำรองแล้วล้างข้อมูล");
        err.code = "QUOTA";
        throw err;
      }
      throw e;
    }
  }

  function listSessions() {
    return load().sessions.slice().sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function getSession(id) {
    return load().sessions.find(function (s) {
      return s.id === id;
    });
  }

  function upsertSession(session) {
    const data = load();
    session.updatedAt = Date.now();
    const i = data.sessions.findIndex(function (s) {
      return s.id === session.id;
    });
    if (i >= 0) data.sessions[i] = session;
    else {
      session.createdAt = session.createdAt || Date.now();
      data.sessions.push(session);
    }
    save(data);
    return session;
  }

  function deleteSession(id) {
    const data = load();
    data.sessions = data.sessions.filter(function (s) {
      return s.id !== id;
    });
    save(data);
  }

  function createSession(title, memberNames) {
    const names = (memberNames || [])
      .map(function (n) {
        return String(n).trim();
      })
      .filter(Boolean);
    const colors = ["#c9a227", "#3498db", "#e67e22", "#2ecc71", "#9b59b6", "#e74c3c", "#1abc9c"];
    const session = {
      id: uid("ses"),
      title: title || "ทริปกินเหล้า",
      date: new Date().toISOString().slice(0, 10),
      currency: "THB",
      status: "open",
      members: names.map(function (name, idx) {
        return {
          id: uid("m"),
          displayName: name,
          color: colors[idx % colors.length],
        };
      }),
      expenses: [],
      transferMarks: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return upsertSession(session);
  }

  function markTransfer(sessionId, key, done) {
    const s = getSession(sessionId);
    if (!s) return null;
    s.transferMarks = s.transferMarks || {};
    s.transferMarks[key] = {
      done: !!done,
      at: Date.now(),
    };
    return upsertSession(s);
  }

  function transferKey(t) {
    return t.from + "->" + t.to + ":" + t.amountMinor;
  }

  /** Full backup object for export */
  function exportData() {
    const data = load();
    return {
      app: "Aom Split",
      version: data.version || 1,
      exportedAt: new Date().toISOString(),
      sessions: data.sessions || [],
    };
  }

  function exportJsonString() {
    return JSON.stringify(exportData(), null, 2);
  }

  /**
   * Import backup.
   * mode: "replace" | "merge" (default merge by session id)
   */
  function importData(payload, mode) {
    mode = mode || "merge";
    let obj = payload;
    if (typeof payload === "string") {
      obj = JSON.parse(payload);
    }
    if (!obj || !Array.isArray(obj.sessions)) {
      throw new Error("ไฟล์สำรองไม่ถูกต้อง (ไม่พบ sessions)");
    }
    const data = load();
    if (mode === "replace") {
      data.sessions = obj.sessions.slice();
    } else {
      const map = {};
      data.sessions.forEach(function (s) {
        map[s.id] = s;
      });
      obj.sessions.forEach(function (s) {
        if (!s || !s.id) return;
        const existing = map[s.id];
        if (!existing) {
          map[s.id] = s;
        } else {
          // keep newer
          const et = existing.updatedAt || existing.createdAt || 0;
          const nt = s.updatedAt || s.createdAt || 0;
          map[s.id] = nt >= et ? s : existing;
        }
      });
      data.sessions = Object.keys(map).map(function (k) {
        return map[k];
      });
    }
    save(data);
    return data.sessions.length;
  }

  function downloadBackup() {
    const json = exportJsonString();
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp =
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0") +
      "-" +
      String(d.getHours()).padStart(2, "0") +
      String(d.getMinutes()).padStart(2, "0");
    a.href = url;
    a.download = "aom-split-backup-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function storageInfo() {
    const data = load();
    const meta = getMeta();
    let bytes = 0;
    try {
      bytes = (localStorage.getItem(KEY) || "").length;
    } catch (e) {
      bytes = 0;
    }
    return {
      available: isStorageAvailable(),
      sessionCount: (data.sessions || []).length,
      savedAt: data.savedAt || (meta && meta.lastSavedAt) || null,
      approxBytes: bytes,
      key: KEY,
    };
  }

  global.AomStore = {
    KEY: KEY,
    uid: uid,
    load: load,
    save: save,
    listSessions: listSessions,
    getSession: getSession,
    upsertSession: upsertSession,
    deleteSession: deleteSession,
    createSession: createSession,
    markTransfer: markTransfer,
    transferKey: transferKey,
    isStorageAvailable: isStorageAvailable,
    exportData: exportData,
    exportJsonString: exportJsonString,
    importData: importData,
    downloadBackup: downloadBackup,
    storageInfo: storageInfo,
    getMeta: getMeta,
  };
})(typeof window !== "undefined" ? window : globalThis);
