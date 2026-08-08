/**
 * Aom Split — localStorage persistence
 */
(function (global) {
  const KEY = "aom_split_v1";

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { sessions: [] };
      const data = JSON.parse(raw);
      if (!data.sessions) data.sessions = [];
      return data;
    } catch (e) {
      return { sessions: [] };
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
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
    const names = (memberNames || []).map(function (n) {
      return String(n).trim();
    }).filter(Boolean);
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
  };
})(typeof window !== "undefined" ? window : globalThis);
