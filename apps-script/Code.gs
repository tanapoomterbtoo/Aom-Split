/**
 * Aom Split — Google Sheets backend (fast path)
 *
 * Setup ย่อ:
 * 1) สร้าง Google Sheet ว่าง → Extensions → Apps Script → วางไฟล์นี้ทั้งก้อน
 * 2) รันฟังก์ชัน setupOnce() หนึ่งครั้ง (อนุญาตสิทธิ์)
 * 3) Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4) แก้โค้ดทีหลัง: Deploy → Manage deployments → ✏️ → New version → Deploy
 *
 * ชีต Sessions: id | updatedAt | deleted | payload
 * เร่งความเร็ว: rev counter + CacheService + upsert_many
 */

var SESSIONS_SHEET = "Sessions";
var CONFIG_SHEET = "Config";
var TOKEN_PROP = "AOM_TOKEN";
var REV_PROP = "AOM_REV";
var CACHE_LIST = "AOM_LIST_JSON";
var CACHE_REV = "AOM_REV_CACHE";
var APP_NAME = "Aom Split";

function setupOnce() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSessionsSheet_(ss);
  ensureConfigSheet_(ss);

  var token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP);
  if (!token) {
    token = makeToken_();
    PropertiesService.getScriptProperties().setProperty(TOKEN_PROP, token);
  }
  writeConfigToken_(ss, token);
  if (!PropertiesService.getScriptProperties().getProperty(REV_PROP)) {
    PropertiesService.getScriptProperties().setProperty(REV_PROP, "1");
  }

  Logger.log("Aom Split setup OK");
  Logger.log("Token (ใส่ในแอป + ส่งให้เพื่อน): " + token);
  Logger.log("จากนั้น Deploy → Web app → Anyone แล้วคัดลอก URL");
  return token;
}

function doGet(e) {
  return handleRequest_(e, null);
}

function doPost(e) {
  var body = null;
  try {
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return json_({ ok: false, error: "invalid_json", message: String(err) });
  }
  return handleRequest_(e, body);
}

function handleRequest_(e, body) {
  body = body || {};
  var params = (e && e.parameter) || {};
  var action = String(body.action || params.action || "ping").toLowerCase();
  var token = String(body.token || params.token || "");

  try {
    if (action === "ping") {
      return json_({
        ok: true,
        app: APP_NAME,
        action: "ping",
        authRequired: true,
        time: new Date().toISOString(),
        rev: getRev_(),
      });
    }

    if (!checkToken_(token)) {
      return json_({ ok: false, error: "unauthorized", message: "token ไม่ถูกต้อง" });
    }

    // ── เบาที่สุด: เช็กว่ามีของใหม่ไหม (ไม่แตะชีตถ้า cache hit)
    if (action === "rev" || action === "head" || action === "poll") {
      return json_({
        ok: true,
        rev: getRev_(),
        action: "rev",
      });
    }

    // ── versions: id→updatedAt เบาๆ (fallback ถ้า client เก่า)
    if (action === "versions") {
      var ssV = SpreadsheetApp.getActiveSpreadsheet();
      ensureSessionsSheet_(ssV);
      return json_({
        ok: true,
        rev: getRev_(),
        versions: listVersions_(ssV),
        deletedIds: listDeletedIds_(ssV),
      });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSessionsSheet_(ss);

    if (action === "list") {
      var listPayload = listPayload_(ss, !!body.includeDeleted, !!body.nocache);
      return json_(listPayload);
    }
    if (action === "get") {
      var id = String(body.id || params.id || "");
      if (!id) return json_({ ok: false, error: "missing_id" });
      var row = findSessionRow_(ss, id);
      if (!row || row.deleted) {
        return json_({ ok: false, error: "not_found" });
      }
      return json_({ ok: true, session: row.session, rev: getRev_() });
    }
    if (action === "upsert") {
      var session = body.session;
      if (!session || !session.id) {
        return json_({ ok: false, error: "missing_session" });
      }
      var saved = upsertSession_(ss, session);
      var revU = bumpRev_();
      return json_({ ok: true, session: saved, rev: revU });
    }
    if (action === "upsert_many" || action === "bulk_upsert") {
      var many = body.sessions;
      if (!Array.isArray(many)) {
        return json_({ ok: false, error: "missing_sessions" });
      }
      var bulk = upsertMany_(ss, many);
      var revB = bumpRev_();
      return json_({ ok: true, count: bulk.count, saved: bulk.count, rev: revB });
    }
    if (action === "delete") {
      var delId = String(body.id || params.id || "");
      if (!delId) return json_({ ok: false, error: "missing_id" });
      deleteSession_(ss, delId);
      var revD = bumpRev_();
      return json_({ ok: true, id: delId, rev: revD });
    }
    if (action === "replace_all") {
      var sessions = body.sessions;
      if (!Array.isArray(sessions)) {
        return json_({ ok: false, error: "missing_sessions" });
      }
      replaceAll_(ss, sessions);
      var revR = bumpRev_();
      return json_({ ok: true, count: sessions.length, rev: revR });
    }

    return json_({ ok: false, error: "unknown_action", action: action });
  } catch (err) {
    return json_({
      ok: false,
      error: "server_error",
      message: String(err && err.message ? err.message : err),
    });
  }
}

/* ───────── rev + cache ───────── */

function getRev_() {
  try {
    var cache = CacheService.getScriptCache();
    var c = cache.get(CACHE_REV);
    if (c != null && c !== "") return Number(c) || 0;
  } catch (e0) {
    /* ignore */
  }
  var rev = Number(
    PropertiesService.getScriptProperties().getProperty(REV_PROP) || 0
  );
  try {
    CacheService.getScriptCache().put(CACHE_REV, String(rev), 30);
  } catch (e1) {
    /* ignore */
  }
  return rev;
}

function bumpRev_() {
  var p = PropertiesService.getScriptProperties();
  var rev = Number(p.getProperty(REV_PROP) || 0) + 1;
  p.setProperty(REV_PROP, String(rev));
  try {
    var cache = CacheService.getScriptCache();
    cache.put(CACHE_REV, String(rev), 30);
    cache.remove(CACHE_LIST);
  } catch (e) {
    /* ignore */
  }
  return rev;
}

function listPayload_(ss, includeDeleted, nocache) {
  if (!includeDeleted && !nocache) {
    try {
      var cached = CacheService.getScriptCache().get(CACHE_LIST);
      if (cached) {
        var parsed = JSON.parse(cached);
        // แน่ใจว่า rev ล่าสุด
        parsed.rev = getRev_();
        return parsed;
      }
    } catch (e) {
      /* rebuild */
    }
  }

  var payload = {
    ok: true,
    sessions: listSessions_(ss, includeDeleted),
    deletedIds: listDeletedIds_(ss),
    rev: getRev_(),
  };

  if (!includeDeleted) {
    try {
      // cache สั้นๆ — ลดอ่านชีตซ้ำตอนเพื่อนหลายคน poll
      CacheService.getScriptCache().put(
        CACHE_LIST,
        JSON.stringify(payload),
        8
      );
    } catch (e2) {
      /* ignore size/quota */
    }
  }
  return payload;
}

/* ───────── sheet helpers ───────── */

function ensureSessionsSheet_(ss) {
  var sh = ss.getSheetByName(SESSIONS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SESSIONS_SHEET);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 4).setValues([["id", "updatedAt", "deleted", "payload"]]);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 140);
    sh.setColumnWidth(3, 80);
    sh.setColumnWidth(4, 600);
  }
  return sh;
}

function ensureConfigSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG_SHEET);
    sh.getRange(1, 1, 3, 2).setValues([
      ["token", ""],
      ["note", "token นี้ใช้ร่วมกันในกลุ่มเพื่อน — อย่าโพสต์สาธารณะ"],
      ["app", APP_NAME],
    ]);
    sh.setColumnWidth(1, 100);
    sh.setColumnWidth(2, 360);
  }
  return sh;
}

function writeConfigToken_(ss, token) {
  var sh = ensureConfigSheet_(ss);
  sh.getRange(1, 2).setValue(token);
}

function readConfigToken_(ss) {
  try {
    var sh = ss.getSheetByName(CONFIG_SHEET);
    if (!sh) return "";
    return String(sh.getRange(1, 2).getValue() || "").trim();
  } catch (e) {
    return "";
  }
}

function checkToken_(token) {
  if (!token) return false;
  var prop = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP) || "";
  if (prop && token === prop) return true;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cfg = readConfigToken_(ss);
    if (cfg && token === cfg) {
      if (!prop) {
        PropertiesService.getScriptProperties().setProperty(TOKEN_PROP, cfg);
      }
      return true;
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}

function listSessions_(ss, includeDeleted) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last, 4).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || "");
    if (!id) continue;
    var deleted = toBool_(values[i][2]);
    if (deleted && !includeDeleted) continue;
    var session = parsePayload_(values[i][3]);
    if (!session) continue;
    if (!session.id) session.id = id;
    out.push(session);
  }
  return out;
}

/** เบา: อ่านแค่ id + updatedAt + deleted */
function listVersions_(ss) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return {};
  var values = sh.getRange(2, 1, last, 3).getValues();
  var out = {};
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || "");
    if (!id) continue;
    if (toBool_(values[i][2])) continue;
    out[id] = Number(values[i][1]) || 0;
  }
  return out;
}

function listDeletedIds_(ss) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last, 3).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || "");
    if (!id) continue;
    if (toBool_(values[i][2])) out.push(id);
  }
  return out;
}

function findSessionRow_(ss, id) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var values = sh.getRange(2, 1, last, 4).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      return {
        row: i + 2,
        id: id,
        updatedAt: Number(values[i][1]) || 0,
        deleted: toBool_(values[i][2]),
        session: parsePayload_(values[i][3]),
      };
    }
  }
  return null;
}

function upsertSession_(ss, session) {
  var sh = ensureSessionsSheet_(ss);
  session = JSON.parse(JSON.stringify(session));
  session.updatedAt = Number(session.updatedAt) || Date.now();
  if (!session.createdAt) session.createdAt = session.updatedAt;

  var found = findSessionRow_(ss, session.id);
  var payload = JSON.stringify(session);
  var rowData = [session.id, session.updatedAt, false, payload];

  if (found) {
    sh.getRange(found.row, 1, 1, 4).setValues([rowData]);
  } else {
    sh.appendRow(rowData);
  }
  return session;
}

function upsertMany_(ss, sessions) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  var idToRow = {};
  if (last >= 2) {
    var idVals = sh.getRange(2, 1, last, 1).getValues();
    for (var i = 0; i < idVals.length; i++) {
      var rid = String(idVals[i][0] || "");
      if (rid) idToRow[rid] = i + 2;
    }
  }

  var appends = [];
  var count = 0;
  var byId = {};
  for (var j = 0; j < sessions.length; j++) {
    var raw = sessions[j];
    if (!raw || !raw.id) continue;
    byId[String(raw.id)] = raw;
  }
  var ids = Object.keys(byId);
  for (var k = 0; k < ids.length; k++) {
    var session = byId[ids[k]];
    try {
      session = JSON.parse(JSON.stringify(session));
    } catch (e) {
      continue;
    }
    session.updatedAt = Number(session.updatedAt) || Date.now();
    if (!session.createdAt) session.createdAt = session.updatedAt;
    var payload = JSON.stringify(session);
    var rowData = [session.id, session.updatedAt, false, payload];
    var row = idToRow[session.id];
    if (row && row > 0) {
      sh.getRange(row, 1, 1, 4).setValues([rowData]);
    } else {
      appends.push(rowData);
    }
    count++;
  }

  if (appends.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, start + appends.length - 1, 4).setValues(appends);
  }
  return { count: count };
}

function deleteSession_(ss, id) {
  var sh = ensureSessionsSheet_(ss);
  var found = findSessionRow_(ss, id);
  if (!found) return;
  sh.getRange(found.row, 3).setValue(true);
  sh.getRange(found.row, 2).setValue(Date.now());
}

function replaceAll_(ss, sessions) {
  var sh = ensureSessionsSheet_(ss);
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last, 4).clearContent();
  }
  if (!sessions.length) return;
  var rows = sessions
    .map(function (s) {
      s = s || {};
      var id = s.id || "";
      var updatedAt = Number(s.updatedAt) || Date.now();
      return [id, updatedAt, false, JSON.stringify(s)];
    })
    .filter(function (r) {
      return !!r[0];
    });
  if (rows.length) {
    sh.getRange(2, 1, 1 + rows.length - 1, 4).setValues(rows);
  }
}

function parsePayload_(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}

function toBool_(v) {
  if (v === true || v === 1 || v === "TRUE" || v === "true" || v === "1") return true;
  return false;
}

function makeToken_() {
  var chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var out = "aom_";
  for (var i = 0; i < 16; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
