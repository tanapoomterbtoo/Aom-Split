/**
 * Aom Split — localStorage + Google Sheet (Apps Script) shared DB
 * Build: 20260811sync
 *
 * กลุ่มเพื่อนใช้ Sheet ชุดเดียวกันอัตโนมัติ (ไม่ต้องใส่ URL/token เอง)
 * ซิงก์เร็วขึ้น: push เฉพาะทริปที่เปลี่ยน · bulk upsert · ดึง ~3.5 วิ
 */
(function (global) {
  const KEY = "aom_split_v1";
  const META_KEY = "aom_split_meta_v1";
  const REMOTE_KEY = "aom_split_remote_v1";

  /** Shared group backend — everyone uses this Sheet */
  const BUILTIN_REMOTE = {
    enabled: true,
    webAppUrl:
      "https://script.google.com/macros/s/AKfycbwy3w8vDXn7AYkcrFop6YM4VatktJ6v4fyMpo31EbKWE0kGlklzBjxLKRX5fDPCQC9HBw/exec",
    token: "aom_xcShnHEgQc2tZw7J",
  };

  /** ดึงของเพื่อนอัตโนมัติตอนแท็บเปิด (มิลลิวินาที) */
  const AUTO_PULL_MS = 3500;
  /** รอรวมแก้รัวๆ ก่อนอัป Sheet */
  const PUSH_DEBOUNCE_MS = 180;

  var pushTimer = null;
  var lastRemoteStatus = {
    ok: null,
    at: null,
    message: "พร้อมซิงก์กลุ่ม",
    mode: "cloud",
  };
  var syncInFlight = null;
  var pushInFlight = null;
  var pendingPushAfterPull = false;
  var autoPullTimer = null;
  var autoSyncBound = false;
  var lastPullFingerprint = "";
  /** sessionId → true — อัปเฉพาะทริปที่แก้ (ไม่ยิงทุกทริป) */
  var dirtySessionIds = Object.create(null);
  var lastPullAt = 0;
  var lastPushAt = 0;
  /** null=ยังไม่รู้, true/false = backend รองรับ upsert_many หรือไม่ */
  var bulkUpsertSupported = null;

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

  function emit(name, detail) {
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {
      /* old browsers */
    }
  }

  function setRemoteStatus(partial) {
    lastRemoteStatus = Object.assign({}, lastRemoteStatus, partial, {
      at: Date.now(),
    });
    emit("aom-split-remote", lastRemoteStatus);
  }

  function save(data, opts) {
    opts = opts || {};
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
      emit("aom-split-saved", {
        at: data.savedAt,
        count: (data.sessions || []).length,
      });
      if (!opts.skipRemotePush) {
        scheduleRemotePush();
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

  function markSessionDirty(id) {
    if (id) dirtySessionIds[id] = true;
  }

  function takeDirtySessionIds() {
    var ids = Object.keys(dirtySessionIds);
    dirtySessionIds = Object.create(null);
    return ids;
  }

  function redirtySessionIds(ids) {
    (ids || []).forEach(function (id) {
      if (id) dirtySessionIds[id] = true;
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
    markSessionDirty(session.id);
    save(data);
    return session;
  }

  function deleteSession(id) {
    const data = load();
    data.sessions = data.sessions.filter(function (s) {
      return s.id !== id;
    });
    // ไม่ mark dirty upsert — ลบตรงบน Sheet ทันที
    delete dirtySessionIds[id];
    save(data, { skipRemotePush: true });
    // push delete to sheet immediately when remote on
    var cfg = getRemoteConfig();
    if (cfg.enabled && cfg.webAppUrl) {
      remoteRequest("delete", { id: id }, { quiet: false })
        .then(function () {
          lastPushAt = Date.now();
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message: "ลบทริปบนกลุ่มแล้ว · " + formatClock(),
          });
        })
        .catch(function (err) {
          setRemoteStatus({
            ok: false,
            mode: "cloud",
            message: (err && err.message) || "ลบบน Sheet ไม่สำเร็จ",
          });
        });
    }
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
      title: title || "ทริปใหม่",
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
    if (!done) {
      delete s.transferMarks[key];
    } else {
      s.transferMarks[key] = {
        done: true,
        at: Date.now(),
      };
    }
    return upsertSession(s);
  }

  function transferKey(t) {
    return String(t.from) + "__" + String(t.to) + "__" + String(t.amountMinor);
  }

  function transferKeyAliases(t) {
    var modern = transferKey(t);
    var legacy = String(t.from) + "->" + String(t.to) + ":" + String(t.amountMinor);
    return [modern, legacy];
  }

  function isTransferMarked(session, t) {
    var marks = (session && session.transferMarks) || {};
    var keys = transferKeyAliases(t);
    for (var i = 0; i < keys.length; i++) {
      var m = marks[keys[i]];
      if (!m) continue;
      // รองรับ mark เก่าที่มี status: confirmed
      if (m.done || m.status === "confirmed") return true;
    }
    return false;
  }

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
          const et = existing.updatedAt || existing.createdAt || 0;
          const nt = s.updatedAt || s.createdAt || 0;
          map[s.id] = nt >= et ? s : existing;
        }
      });
      data.sessions = Object.keys(map).map(function (k) {
        return map[k];
      });
    }
    // import ทั้งชุด — ต้องอัปทุกทริป
    (data.sessions || []).forEach(function (s) {
      if (s && s.id) markSessionDirty(s.id);
    });
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
    const remote = getRemoteConfig();
    return {
      available: isStorageAvailable(),
      sessionCount: (data.sessions || []).length,
      savedAt: data.savedAt || (meta && meta.lastSavedAt) || null,
      approxBytes: bytes,
      key: KEY,
      remoteEnabled: !!(remote.enabled && remote.webAppUrl),
      remote: getRemoteStatus(),
    };
  }

  /* ───────── Google Sheet remote ───────── */

  function normalizeRemoteUrl(url) {
    url = String(url || "").trim();
    if (!url) return "";
    // accept /exec or /dev
    return url.replace(/\s+/g, "");
  }

  function getRemoteConfig() {
    // Always the shared group Sheet (built-in). Optional local override only if
    // someone saved a full custom config with webAppUrl + token.
    try {
      const raw = localStorage.getItem(REMOTE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        // Explicit offline / local-only
        if (o && o.enabled === false && o.forceLocal === true) {
          return { enabled: false, webAppUrl: "", token: "" };
        }
        // Custom backend only when both URL and token provided
        if (o && o.webAppUrl && o.token && o.useCustom === true) {
          return {
            enabled: o.enabled !== false,
            webAppUrl: normalizeRemoteUrl(o.webAppUrl),
            token: String(o.token || "").trim(),
          };
        }
      }
    } catch (e) {
      /* use builtin */
    }
    return {
      enabled: true,
      webAppUrl: BUILTIN_REMOTE.webAppUrl,
      token: BUILTIN_REMOTE.token,
    };
  }

  function setRemoteConfig(cfg) {
    cfg = cfg || {};
    var next;
    if (cfg.forceLocal === true || cfg.enabled === false) {
      next = { enabled: false, forceLocal: true, webAppUrl: "", token: "" };
    } else if (cfg.useCustom === true && cfg.webAppUrl && cfg.token) {
      next = {
        enabled: true,
        useCustom: true,
        webAppUrl: normalizeRemoteUrl(cfg.webAppUrl),
        token: String(cfg.token || "").trim(),
      };
    } else {
      // reset to built-in shared group
      next = { enabled: true, useBuiltin: true };
    }
    if (!isStorageAvailable()) {
      throw new Error("บันทึกการตั้งค่าไม่ได้");
    }
    localStorage.setItem(REMOTE_KEY, JSON.stringify(next));
    var active = getRemoteConfig();
    if (active.enabled && active.webAppUrl) {
      setRemoteStatus({ mode: "cloud", message: "เชื่อม Google Sheet กลุ่มแล้ว", ok: null });
    } else {
      setRemoteStatus({ mode: "local", message: "ใช้เฉพาะเครื่องนี้", ok: true });
    }
    emit("aom-split-remote-config", active);
    return active;
  }

  function getRemoteStatus() {
    return Object.assign({}, lastRemoteStatus);
  }

  function isRemoteEnabled() {
    var c = getRemoteConfig();
    return !!(c.enabled && c.webAppUrl && c.token);
  }

  function getBuiltinRemote() {
    return {
      enabled: BUILTIN_REMOTE.enabled,
      webAppUrl: BUILTIN_REMOTE.webAppUrl,
      token: BUILTIN_REMOTE.token,
    };
  }

  /**
   * Call Apps Script web app.
   * Content-Type text/plain avoids CORS preflight with Google Apps Script.
   * @param {string} action
   * @param {object} [extra]
   * @param {{quiet?: boolean}} [opts] quiet=true ไม่กระพริบสถานะตอน auto-pull
   */
  function remoteRequest(action, extra, opts) {
    opts = opts || {};
    var quiet = !!opts.quiet;
    var cfg = getRemoteConfig();
    if (!cfg.webAppUrl) {
      return Promise.reject(new Error("ยังไม่ได้ใส่ Web App URL"));
    }
    var body = Object.assign({ action: action, token: cfg.token }, extra || {});

    if (!quiet) {
      setRemoteStatus({ mode: "cloud", message: "กำลังคุยกับ Google Sheet…", ok: null });
    }

    return fetch(cfg.webAppUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error(
              "คำตอบจาก Sheet ไม่ใช่ JSON — ตรวจว่า Deploy แบบ Web app แล้ว (Anyone)"
            );
          }
          if (!res.ok && !data) {
            throw new Error("HTTP " + res.status);
          }
          if (data && data.ok === false) {
            var msg =
              data.message ||
              data.error ||
              "คำขอไม่สำเร็จ";
            if (data.error === "unauthorized") {
              msg = "token ไม่ถูกต้อง — ขอ token ใหม่จากคนที่สร้าง Sheet";
            }
            var err = new Error(msg);
            err.code = data.error;
            throw err;
          }
          return data;
        });
      })
      .then(function (data) {
        if (!quiet) {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message: "ซิงก์ Google Sheet แล้ว",
          });
        } else {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message: "ซิงก์อัตโนมัติ · " + formatClock(),
          });
        }
        return data;
      })
      .catch(function (err) {
        setRemoteStatus({
          ok: false,
          mode: "cloud",
          message: (err && err.message) || "เชื่อม Sheet ไม่สำเร็จ",
        });
        throw err;
      });
  }

  function formatClock() {
    try {
      return new Date().toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function sessionTime(s) {
    return (s && (s.updatedAt || s.createdAt)) || 0;
  }

  function fingerprintSessions(list) {
    return (list || [])
      .map(function (s) {
        return s.id + ":" + sessionTime(s) + ":" + ((s.expenses && s.expenses.length) || 0);
      })
      .sort()
      .join("|");
  }

  /** Merge remote sessions into local: newer updatedAt wins; remote-deleted removes local */
  function mergeSessions(localList, remoteList, remoteDeletedIds) {
    var map = {};
    (localList || []).forEach(function (s) {
      if (s && s.id) map[s.id] = s;
    });
    (remoteList || []).forEach(function (s) {
      if (!s || !s.id) return;
      var cur = map[s.id];
      if (!cur || sessionTime(s) >= sessionTime(cur)) {
        map[s.id] = s;
      }
    });
    (remoteDeletedIds || []).forEach(function (id) {
      delete map[id];
    });
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  function scheduleRemotePush() {
    if (!isRemoteEnabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      flushDirtyPush().catch(function () {
        /* status already set */
      });
    }, PUSH_DEBOUNCE_MS);
  }

  /**
   * อัปโหลดรายการทริป (bulk ครั้งเดียว ถ้า backend รองรับ; fallback ทีละอัน)
   * @param {object[]} sessions
   * @param {{quiet?: boolean}} [opts]
   */
  function pushSessions(sessions, opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true, count: 0 });
    }
    sessions = (sessions || []).filter(function (s) {
      return s && s.id;
    });
    if (!sessions.length) {
      return Promise.resolve({ count: 0 });
    }

    var quiet = !!opts.quiet;
    var ids = sessions.map(function (s) {
      return s.id;
    });

    function pushSequential() {
      var chain = Promise.resolve();
      var count = 0;
      sessions.forEach(function (s) {
        chain = chain.then(function () {
          return remoteRequest("upsert", { session: s }, { quiet: true }).then(
            function () {
              count++;
            }
          );
        });
      });
      return chain.then(function () {
        lastPushAt = Date.now();
        if (!quiet) {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message: "อัปแล้ว " + count + " ทริป · " + formatClock(),
          });
        }
        return { count: count, mode: "sequential" };
      });
    }

    function pushSingle() {
      return remoteRequest(
        "upsert",
        { session: sessions[0] },
        { quiet: quiet }
      ).then(function () {
        lastPushAt = Date.now();
        return { count: 1, mode: "single" };
      });
    }

    // รู้แล้วว่า backend เก่า — ไม่ลอง bulk ซ้ำ
    if (bulkUpsertSupported === false) {
      return (sessions.length === 1 ? pushSingle() : pushSequential()).catch(
        function (err) {
          redirtySessionIds(ids);
          throw err;
        }
      );
    }

    // 1 request สำหรับหลายทริป (ต้อง deploy Code.gs ที่มี upsert_many)
    // แม้ 1 ทริป ก็ใช้ bulk ได้ (เร็วพอๆ กัน + เส้นทางเดียว)
    return remoteRequest(
      "upsert_many",
      { sessions: sessions },
      { quiet: true }
    )
      .then(function (data) {
        bulkUpsertSupported = true;
        lastPushAt = Date.now();
        var count =
          (data && (data.count || data.saved)) || sessions.length;
        if (!quiet) {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message:
              "อัปแล้ว " +
              count +
              " ทริป · " +
              formatClock(),
          });
        }
        return { count: count, mode: "bulk" };
      })
      .catch(function (err) {
        var code = err && err.code;
        var msg = (err && err.message) || "";
        var isUnknown =
          code === "unknown_action" ||
          /unknown_action/i.test(msg) ||
          /unknown action/i.test(msg);

        if (isUnknown) {
          bulkUpsertSupported = false;
        }

        // network / auth ฯลฯ — ถ้า 1 ทริป ลอง upsert เดี่ยว; หลายทริปลอง sequential
        if (isUnknown || code !== "unauthorized") {
          return (sessions.length === 1 ? pushSingle() : pushSequential()).catch(
            function (err2) {
              redirtySessionIds(ids);
              throw err2;
            }
          );
        }

        redirtySessionIds(ids);
        throw err;
      });
  }

  /**
   * อัปเฉพาะทริปที่ dirty — ไม่ยิงทุกทริปในเครื่อง
   */
  function flushDirtyPush(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true, count: 0 });
    }

    // รอ pull จบก่อน กันเขียนทับกัน
    if (syncInFlight) {
      pendingPushAfterPull = true;
      return syncInFlight
        .catch(function () {
          /* ignore pull err */
        })
        .then(function () {
          pendingPushAfterPull = false;
          return flushDirtyPush(opts);
        });
    }

    if (pushInFlight) {
      pendingPushAfterPull = true;
      return pushInFlight.then(function () {
        if (pendingPushAfterPull || Object.keys(dirtySessionIds).length) {
          pendingPushAfterPull = false;
          return flushDirtyPush(opts);
        }
        return { count: 0 };
      });
    }

    var ids = takeDirtySessionIds();
    if (!ids.length) {
      return Promise.resolve({ count: 0 });
    }

    var idSet = {};
    ids.forEach(function (id) {
      idSet[id] = true;
    });
    var sessions = (load().sessions || []).filter(function (s) {
      return s && idSet[s.id];
    });

    // ทริปถูกลบไปแล้วระหว่าง dirty — ข้าม
    if (!sessions.length) {
      return Promise.resolve({ count: 0 });
    }

    if (!opts.quiet) {
      setRemoteStatus({
        ok: null,
        mode: "cloud",
        message:
          sessions.length === 1
            ? "กำลังอัปทริป…"
            : "กำลังอัป " + sessions.length + " ทริป…",
      });
    }

    pushInFlight = pushSessions(sessions, { quiet: !!opts.quiet })
      .then(function (result) {
        if (!opts.quiet) {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message:
              "อัปกลุ่มแล้ว · " +
              (result.count || sessions.length) +
              " · " +
              formatClock(),
          });
        } else {
          setRemoteStatus({
            ok: true,
            mode: "cloud",
            message: "ซิงก์อัตโนมัติ · " + formatClock(),
          });
        }
        return result;
      })
      .finally(function () {
        pushInFlight = null;
      });

    return pushInFlight;
  }

  /** Push every local session (import / full resync) */
  function pushAllToRemote(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true });
    }
    var sessions = load().sessions || [];
    sessions.forEach(function (s) {
      if (s && s.id) markSessionDirty(s.id);
    });
    return flushDirtyPush({ quiet: !!opts.quiet });
  }

  function pushSessionToRemote(session) {
    if (!isRemoteEnabled() || !session) {
      return Promise.resolve({ skipped: true });
    }
    markSessionDirty(session.id);
    // ดันคิวทันที (รวมกับ dirty อื่นถ้ามี) — ไม่รอ debounce
    clearTimeout(pushTimer);
    return flushDirtyPush({ quiet: false });
  }

  /**
   * Pull from Sheet and merge into localStorage.
   * @param {{quiet?: boolean, force?: boolean}} [opts]
   * @returns {Promise<{count:number, merged:number, changed:boolean}>}
   */
  function pullFromRemote(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true, count: 0, changed: false });
    }
    if (syncInFlight) return syncInFlight;

    // กันยิง list ถี่เกิน (focus + interval ซ้อน)
    var now = Date.now();
    if (!opts.force && lastPullAt && now - lastPullAt < 1200) {
      return Promise.resolve({
        skipped: true,
        count: 0,
        changed: false,
        throttled: true,
      });
    }

    syncInFlight = remoteRequest("list", {}, { quiet: !!opts.quiet })
      .then(function (data) {
        lastPullAt = Date.now();
        var remoteSessions = (data && data.sessions) || [];
        var deletedIds = (data && data.deletedIds) || [];
        var local = load();
        var beforeFp = fingerprintSessions(local.sessions);
        var merged = mergeSessions(local.sessions, remoteSessions, deletedIds);
        var afterFp = fingerprintSessions(merged);
        var changed = beforeFp !== afterFp;
        local.sessions = merged;
        if (!isStorageAvailable()) {
          throw new Error("บันทึก local ไม่ได้");
        }
        local.version = local.version || 1;
        local.savedAt = Date.now();
        // write local only — do NOT schedule push (would thrash on every auto-pull)
        localStorage.setItem(KEY, JSON.stringify(local));
        writeMeta(true, null);
        lastPullFingerprint = afterFp;

        // หลัง merge: ถ้า local ใหม่กว่า remote อยู่ ต้อง push กลับ
        var remoteTime = {};
        remoteSessions.forEach(function (s) {
          if (s && s.id) remoteTime[s.id] = sessionTime(s);
        });
        (merged || []).forEach(function (s) {
          if (!s || !s.id) return;
          var rt = remoteTime[s.id];
          if (rt == null || sessionTime(s) > rt) {
            markSessionDirty(s.id);
          }
        });

        emit("aom-split-pulled", {
          at: local.savedAt,
          count: remoteSessions.length,
          merged: merged.length,
          changed: changed,
          quiet: !!opts.quiet,
        });

        if (changed) {
          emit("aom-split-saved", {
            at: local.savedAt,
            count: merged.length,
            source: "pull",
          });
        }

        setRemoteStatus({
          ok: true,
          mode: "cloud",
          message: changed
            ? "มีอัปเดตจากกลุ่ม · " + formatClock()
            : "ซิงก์อัตโนมัติ · " + formatClock(),
        });
        return {
          count: remoteSessions.length,
          merged: merged.length,
          changed: changed,
          remoteSessions: remoteSessions,
        };
      })
      .finally(function () {
        syncInFlight = null;
        if (pendingPushAfterPull || Object.keys(dirtySessionIds).length) {
          pendingPushAfterPull = false;
          // เงียบ — ไม่กระพริบ UI ทุก auto cycle
          flushDirtyPush({ quiet: true }).catch(function () {});
        }
      });

    return syncInFlight;
  }

  /**
   * Full sync: pull merge, then push only local-newer / dirty rows.
   * @param {{quiet?: boolean}} [opts]
   */
  function syncNow(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.reject(new Error("ยังไม่ได้เชื่อม Google Sheet"));
    }
    return pullFromRemote({ quiet: !!opts.quiet, force: true }).then(function (
      pullResult
    ) {
      return flushDirtyPush({ quiet: !!opts.quiet }).then(function (pushResult) {
        setRemoteStatus({
          ok: true,
          mode: "cloud",
          message:
            "ซิงก์ครบ · ดึง " +
            (pullResult.count || 0) +
            " · อัป " +
            ((pushResult && pushResult.count) || 0) +
            " · " +
            formatClock(),
        });
        return { pull: pullResult, push: pushResult };
      });
    });
  }

  function isDocumentHidden() {
    try {
      return typeof document !== "undefined" && document.hidden;
    } catch (e) {
      return false;
    }
  }

  /** ดึงอัตโนมัติ (เงียบ) — ข้ามถ้าแท็บซ่อน / กำลังซิงก์ / เพิ่ง push */
  function autoPullTick() {
    if (!isRemoteEnabled()) return;
    if (isDocumentHidden()) return;
    if (syncInFlight || pushInFlight) return;
    // ถ้ายังมี dirty รอ push อยู่ ให้ flush ก่อน แล้วค่อยดึงรอบถัดไป
    if (Object.keys(dirtySessionIds).length) {
      flushDirtyPush({ quiet: true }).catch(function () {});
      return;
    }
    pullFromRemote({ quiet: true }).catch(function () {
      /* status set */
    });
  }

  /**
   * เริ่มซิงก์อัตโนมัติ (idempotent)
   * - ดึงรอบใหม่ทุก AUTO_PULL_MS ตอนแท็บเปิดอยู่
   * - กลับมาที่แท็บ / เน็ตกลับมา → ดึงทันที
   */
  function startAutoSync() {
    if (!isRemoteEnabled()) return false;
    if (autoPullTimer) {
      clearInterval(autoPullTimer);
    }
    autoPullTimer = setInterval(autoPullTick, AUTO_PULL_MS);
    // ดึงรอบแรกเร็ว (ไม่รอครบ interval)
    setTimeout(function () {
      autoPullTick();
    }, 400);

    if (!autoSyncBound && typeof document !== "undefined") {
      autoSyncBound = true;
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && isRemoteEnabled()) {
          pullFromRemote({ quiet: true, force: true }).catch(function () {});
        }
      });
      try {
        global.addEventListener("online", function () {
          if (isRemoteEnabled()) {
            syncNow({ quiet: true }).catch(function () {});
          }
        });
        // focus: throttle ผ่าน pullFromRemote เอง
        global.addEventListener("focus", function () {
          if (isRemoteEnabled() && !isDocumentHidden()) {
            pullFromRemote({ quiet: true }).catch(function () {});
          }
        });
      } catch (e) {
        /* ignore */
      }
    }
    setRemoteStatus({
      ok: lastRemoteStatus.ok,
      mode: "cloud",
      message: lastRemoteStatus.message || "ซิงก์อัตโนมัติเปิดอยู่",
    });
    return true;
  }

  function stopAutoSync() {
    if (autoPullTimer) {
      clearInterval(autoPullTimer);
      autoPullTimer = null;
    }
  }

  function testRemoteConnection() {
    var cfg = getRemoteConfig();
    if (!cfg.webAppUrl) {
      return Promise.reject(new Error("ใส่ Web App URL ก่อน"));
    }
    // ping without requiring success auth first
    return fetch(cfg.webAppUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "ping" }),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error("URL ไม่ตอบเป็น JSON — ตรวจ Web App URL");
          }
          if (!data || data.ok !== true) {
            throw new Error((data && data.message) || "ping ไม่สำเร็จ");
          }
          // then auth check via list
          if (!cfg.token) {
            setRemoteStatus({
              ok: true,
              mode: "cloud",
              message: "URL ใช้ได้ — ยังไม่มี token",
            });
            return { ping: data, authed: false };
          }
          return remoteRequest("list", {}).then(function (listData) {
            return {
              ping: data,
              authed: true,
              count: (listData.sessions || []).length,
            };
          });
        });
      });
  }

  // init status — built-in cloud on by default
  try {
    if (isRemoteEnabled()) {
      setRemoteStatus({ mode: "cloud", message: "DB กลุ่ม (Google Sheet) พร้อมใช้", ok: null });
    } else {
      setRemoteStatus({ mode: "local", message: "ใช้เฉพาะเครื่องนี้", ok: true });
    }
  } catch (e) {
    /* ignore */
  }

  global.AomStore = {
    KEY: KEY,
    REMOTE_KEY: REMOTE_KEY,
    BUILTIN_REMOTE: BUILTIN_REMOTE,
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
    transferKeyAliases: transferKeyAliases,
    isTransferMarked: isTransferMarked,
    isStorageAvailable: isStorageAvailable,
    exportData: exportData,
    exportJsonString: exportJsonString,
    importData: importData,
    downloadBackup: downloadBackup,
    storageInfo: storageInfo,
    getMeta: getMeta,
    // remote
    getRemoteConfig: getRemoteConfig,
    setRemoteConfig: setRemoteConfig,
    getRemoteStatus: getRemoteStatus,
    isRemoteEnabled: isRemoteEnabled,
    getBuiltinRemote: getBuiltinRemote,
    remoteRequest: remoteRequest,
    pullFromRemote: pullFromRemote,
    pushAllToRemote: pushAllToRemote,
    pushSessionToRemote: pushSessionToRemote,
    syncNow: syncNow,
    testRemoteConnection: testRemoteConnection,
    startAutoSync: startAutoSync,
    stopAutoSync: stopAutoSync,
    AUTO_PULL_MS: AUTO_PULL_MS,
  };
})(typeof window !== "undefined" ? window : globalThis);
