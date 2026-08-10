/**
 * Aom Split — localStorage + Google Sheet (Apps Script) shared DB
 * Build: 20260810c
 *
 * กลุ่มเพื่อนใช้ Sheet ชุดเดียวกันอัตโนมัติ (ไม่ต้องใส่ URL/token เอง)
 * ซิงก์อัตโนมัติ: ตอนบันทึก + ดึงรอบ ๆ ทุก 12 วินาที + ตอนกลับมาที่แท็บ
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

  /** ดึงของเพื่อนอัตโนมัติ (มิลลิวินาที) */
  const AUTO_PULL_MS = 12000;

  var pushTimer = null;
  var lastRemoteStatus = {
    ok: null,
    at: null,
    message: "พร้อมซิงก์กลุ่ม",
    mode: "cloud",
  };
  var syncInFlight = null;
  var autoPullTimer = null;
  var autoSyncBound = false;
  var lastPullFingerprint = "";

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
      emit("aom-split-saved", {
        at: data.savedAt,
        count: (data.sessions || []).length,
      });
      scheduleRemotePush();
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
    // push delete to sheet immediately when remote on
    var cfg = getRemoteConfig();
    if (cfg.enabled && cfg.webAppUrl) {
      remoteRequest("delete", { id: id }).catch(function (err) {
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

  function transferKey(t) {
    return String(t.from) + "__" + String(t.to) + "__" + String(t.amountMinor);
  }

  function transferKeyAliases(t) {
    var modern = transferKey(t);
    var legacy = String(t.from) + "->" + String(t.to) + ":" + String(t.amountMinor);
    return [modern, legacy];
  }

  function getRawTransferMark(session, tOrKey) {
    var marks = (session && session.transferMarks) || {};
    if (typeof tOrKey === "string") {
      return marks[tOrKey] || null;
    }
    var keys = transferKeyAliases(tOrKey);
    for (var i = 0; i < keys.length; i++) {
      if (marks[keys[i]]) return marks[keys[i]];
    }
    return null;
  }

  /**
   * Normalize mark → status
   * pending | claimed | confirmed | rejected
   * Legacy: { done: true } → confirmed
   */
  function normalizeTransferMark(raw) {
    if (!raw) {
      return {
        status: "pending",
        done: false,
        ref: "",
        note: "",
        slipDataUrl: "",
        claimedAt: null,
        confirmedAt: null,
        rejectedAt: null,
      };
    }
    var status = raw.status;
    if (!status) {
      status = raw.done ? "confirmed" : "pending";
    }
    if (status === "done") status = "confirmed";
    return {
      status: status,
      done: status === "confirmed",
      ref: raw.ref || "",
      note: raw.note || "",
      slipDataUrl: raw.slipDataUrl || "",
      claimedAt: raw.claimedAt || raw.at || null,
      claimedBy: raw.claimedBy || "",
      confirmedAt: raw.confirmedAt || (status === "confirmed" ? raw.at || null : null),
      confirmedBy: raw.confirmedBy || "",
      rejectedAt: raw.rejectedAt || null,
      rejectNote: raw.rejectNote || "",
      at: raw.at || raw.claimedAt || raw.confirmedAt || null,
    };
  }

  function getTransferMark(session, t) {
    return normalizeTransferMark(getRawTransferMark(session, t));
  }

  function getTransferStatus(session, t) {
    return getTransferMark(session, t).status;
  }

  /** ยืนยันครบแล้ว (ผู้รับคอนเฟิร์ม) — ใช้แทน done เดิม */
  function isTransferMarked(session, t) {
    return getTransferStatus(session, t) === "confirmed";
  }

  function makePaymentRef() {
    var s = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return "AOM-" + s.slice(0, 4) + (Date.now().toString(36).toUpperCase().slice(-3));
  }

  function writeTransferMark(sessionId, key, mark) {
    const s = getSession(sessionId);
    if (!s) return null;
    s.transferMarks = s.transferMarks || {};
    // drop empty slip to save space if cleared
    s.transferMarks[key] = mark;
    return upsertSession(s);
  }

  /** เดิม: ติ๊ก done ตรง ๆ — ยังรองรับ, map เป็น confirmed/pending */
  function markTransfer(sessionId, key, done) {
    if (!done) {
      return clearTransferPayment(sessionId, key);
    }
    return confirmTransferPayment(sessionId, key, { confirmedBy: "manual" });
  }

  /**
   * ผู้จ่ายแจ้งว่าโอนแล้ว (รอผู้รับยืนยัน)
   * @param {{ note?: string, slipDataUrl?: string, claimedBy?: string, ref?: string }} [meta]
   */
  function claimTransferPayment(sessionId, key, meta) {
    meta = meta || {};
    const s = getSession(sessionId);
    if (!s) return null;
    const prev = normalizeTransferMark((s.transferMarks || {})[key]);
    const mark = {
      status: "claimed",
      done: false,
      ref: meta.ref || prev.ref || makePaymentRef(),
      note: meta.note != null ? String(meta.note) : prev.note || "",
      slipDataUrl:
        meta.slipDataUrl != null ? meta.slipDataUrl : prev.slipDataUrl || "",
      claimedAt: Date.now(),
      claimedBy: meta.claimedBy || prev.claimedBy || "",
      confirmedAt: null,
      confirmedBy: "",
      rejectedAt: null,
      rejectNote: "",
      at: Date.now(),
    };
    return writeTransferMark(sessionId, key, mark);
  }

  /** ผู้รับยืนยันว่าได้รับเงินจริง */
  function confirmTransferPayment(sessionId, key, meta) {
    meta = meta || {};
    const s = getSession(sessionId);
    if (!s) return null;
    const prev = normalizeTransferMark((s.transferMarks || {})[key]);
    const mark = {
      status: "confirmed",
      done: true,
      ref: prev.ref || makePaymentRef(),
      note: prev.note || "",
      slipDataUrl: prev.slipDataUrl || "",
      claimedAt: prev.claimedAt || Date.now(),
      claimedBy: prev.claimedBy || "",
      confirmedAt: Date.now(),
      confirmedBy: meta.confirmedBy || "",
      rejectedAt: null,
      rejectNote: "",
      at: Date.now(),
    };
    return writeTransferMark(sessionId, key, mark);
  }

  /** ผู้รับปฏิเสธ — ยังไม่ได้รับ / สลิปไม่ตรง */
  function rejectTransferPayment(sessionId, key, meta) {
    meta = meta || {};
    const s = getSession(sessionId);
    if (!s) return null;
    const prev = normalizeTransferMark((s.transferMarks || {})[key]);
    const mark = {
      status: "rejected",
      done: false,
      ref: prev.ref || "",
      note: prev.note || "",
      slipDataUrl: prev.slipDataUrl || "",
      claimedAt: prev.claimedAt || null,
      claimedBy: prev.claimedBy || "",
      confirmedAt: null,
      confirmedBy: "",
      rejectedAt: Date.now(),
      rejectNote: meta.note || meta.rejectNote || "",
      at: Date.now(),
    };
    return writeTransferMark(sessionId, key, mark);
  }

  function clearTransferPayment(sessionId, key) {
    const s = getSession(sessionId);
    if (!s) return null;
    s.transferMarks = s.transferMarks || {};
    delete s.transferMarks[key];
    // also clear legacy aliases if present later — key is modern
    return upsertSession(s);
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
      pushAllToRemote().catch(function () {
        /* status already set */
      });
    }, 700);
  }

  /** Push every local session (and rely on soft-delete for removed ones via deleteSession) */
  function pushAllToRemote() {
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true });
    }
    var sessions = load().sessions || [];
    // sequential upserts to reduce Apps Script race on same sheet
    var chain = Promise.resolve();
    var count = 0;
    sessions.forEach(function (s) {
      chain = chain.then(function () {
        return remoteRequest("upsert", { session: s }).then(function () {
          count++;
        });
      });
    });
    return chain.then(function () {
      setRemoteStatus({
        ok: true,
        mode: "cloud",
        message: "อัปโหลด " + count + " ทริปขึ้น Sheet แล้ว",
      });
      return { count: count };
    });
  }

  function pushSessionToRemote(session) {
    if (!isRemoteEnabled() || !session) {
      return Promise.resolve({ skipped: true });
    }
    return remoteRequest("upsert", { session: session });
  }

  /**
   * Pull from Sheet and merge into localStorage.
   * @param {{quiet?: boolean}} [opts]
   * @returns {Promise<{count:number, merged:number, changed:boolean}>}
   */
  function pullFromRemote(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.resolve({ skipped: true, count: 0, changed: false });
    }
    if (syncInFlight) return syncInFlight;

    syncInFlight = remoteRequest("list", {}, { quiet: !!opts.quiet })
      .then(function (data) {
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
        };
      })
      .finally(function () {
        syncInFlight = null;
      });

    return syncInFlight;
  }

  /**
   * Full sync: pull merge, then push local-only newer rows.
   * @param {{quiet?: boolean}} [opts]
   */
  function syncNow(opts) {
    opts = opts || {};
    if (!isRemoteEnabled()) {
      return Promise.reject(new Error("ยังไม่ได้เชื่อม Google Sheet"));
    }
    return pullFromRemote({ quiet: !!opts.quiet }).then(function (pullResult) {
      return pushAllToRemote().then(function (pushResult) {
        setRemoteStatus({
          ok: true,
          mode: "cloud",
          message:
            "ซิงก์ครบแล้ว · " +
            (pullResult.count || 0) +
            " ทริป · " +
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

  /** ดึงอัตโนมัติ (เงียบ) — ข้ามถ้าแท็บซ่อนหรือกำลังซิงก์อยู่ */
  function autoPullTick() {
    if (!isRemoteEnabled()) return;
    if (isDocumentHidden()) return;
    if (syncInFlight) return;
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

    if (!autoSyncBound && typeof document !== "undefined") {
      autoSyncBound = true;
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && isRemoteEnabled()) {
          pullFromRemote({ quiet: true }).catch(function () {});
        }
      });
      try {
        global.addEventListener("online", function () {
          if (isRemoteEnabled()) {
            syncNow({ quiet: true }).catch(function () {});
          }
        });
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
    getTransferMark: getTransferMark,
    getTransferStatus: getTransferStatus,
    claimTransferPayment: claimTransferPayment,
    confirmTransferPayment: confirmTransferPayment,
    rejectTransferPayment: rejectTransferPayment,
    clearTransferPayment: clearTransferPayment,
    makePaymentRef: makePaymentRef,
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
