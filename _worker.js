/* Difor Comercial V16.57 · Cloudflare Pages advanced mode
   Archivo único en la raíz: evita depender de subir la carpeta /functions. */
const MAX_RECORDS = 40;
const MAX_PAYLOAD_BYTES = 1_900_000;
const MAX_REQUEST_BYTES = 8_000_000;
const PULL_LIMIT = 5_000;
const FULL_LIMIT = 12_000;

const ALLOWED_STORES = new Set([
  "settings","executive","businessCard","vehiclePrices","priceHistory","offers","brands","models","versions","vehicleLinks",
  "clients","attentions","reviewedModels","prospects","prospectContacts","advertisements","advertisementSends","showroom","playlists",
  "salesFloor","history","sales","events","reminders","workLinks","templates","files","auditLog","calculations","operationCharges",
  "accessoryCatalog","leads","negotiations","vehicleFees","bkBonusRules","creditApplications","stockRecords","insuranceRecords","notes",
  "operations","syncConflicts","deviceState","priceLists","vehicleProfiles","warranties","maintenancePlans","deliveryChecklists",
  "garageDocuments","afterSalesContacts","garageFaqs","afterSalesFollowUps"
]);

let schemaReady;
function database(env) {
  return env?.DIFOR_DB || env?.DB || null;
}


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    }
  });
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function authorize(request, env) {
  const expected = env.DIFOR_APP_KEY || env.DIFOR_SYNC_KEY || "";
  if (!expected) return { ok: false, error: "APP_KEY_NOT_CONFIGURED", status: 500 };
  const supplied = request.headers.get("X-Difor-App-Key") || request.headers.get("X-Difor-Sync-Key") || "";
  if (!timingSafeEqual(supplied, expected)) return { ok: false, error: "UNAUTHORIZED", status: 401 };
  return { ok: true };
}

async function ensureSchema(db) {
  if (!db) throw Object.assign(new Error("D1 binding missing"), { code: "D1_BINDING_MISSING" });
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS central_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("INSERT OR IGNORE INTO central_state (id, initialized, revision) VALUES (1, 0, 0)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS central_records (
        store_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (store_name, record_id)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS ix_central_records_revision ON central_records(revision)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS central_changes (
        revision INTEGER PRIMARY KEY,
        store_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS ix_central_changes_record ON central_changes(store_name, record_id, revision DESC)")
    ]).catch(error => { schemaReady = undefined; throw error; });
  }
  return schemaReady;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") throw Object.assign(new Error("Invalid record"), { code: "INVALID_BODY" });
  const store = String(record.store || "").trim();
  const id = String(record.id || "").trim();
  const deleted = Boolean(record.deleted);
  const updatedBy = String(record.updatedBy || record.deviceId || "web").slice(0, 200);
  if (!ALLOWED_STORES.has(store) || !id || id.length > 500) {
    throw Object.assign(new Error("Invalid record fields"), { code: "INVALID_BODY" });
  }
  let payload = null;
  if (!deleted) {
    if (!record.payload || typeof record.payload !== "object") throw Object.assign(new Error("Payload required"), { code: "INVALID_BODY" });
    payload = JSON.stringify(record.payload);
    if (byteLength(payload) > MAX_PAYLOAD_BYTES) throw Object.assign(new Error("Payload too large"), { code: "RECORD_TOO_LARGE" });
  }
  return { store, id, payload, deleted: deleted ? 1 : 0, updatedBy };
}

function errorResponse(error) {
  const code = error?.code || "CENTRAL_DATA_ERROR";
  const statusByCode = {
    UNAUTHORIZED: 401,
    INVALID_BODY: 400,
    TOO_MANY_RECORDS: 413,
    RECORD_TOO_LARGE: 413,
    D1_BINDING_MISSING: 500,
    APP_KEY_NOT_CONFIGURED: 500
  };
  return json({ error: code, message: error?.message || "Central data error" }, statusByCode[code] || 500);
}

async function state(db) {
  return (await db.prepare("SELECT initialized, revision FROM central_state WHERE id = 1").first()) || { initialized: 0, revision: 0 };
}

async function nextRevision(db) {
  const row = await db.prepare(`UPDATE central_state
    SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    RETURNING revision`).first();
  const revision = Number(row?.revision) || 0;
  if (!revision) throw new Error("Could not allocate revision");
  return revision;
}

async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function onRequestGet(context) {
  const auth = authorize(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    await ensureSchema(database(context.env));
    const db = database(context.env);
    const url = new URL(context.request.url);
    const full = url.searchParams.get("full") === "1";
    const current = await state(db);

    if (full) {
      const result = await db.prepare(`SELECT store_name, record_id, payload, deleted, revision, updated_at, updated_by
        FROM central_records
        WHERE deleted = 0
        ORDER BY store_name, record_id
        LIMIT ?1`).bind(FULL_LIMIT).all();
      const rows = result.results || [];
      return json({
        mode: "full",
        initialized: Boolean(current.initialized),
        revision: Number(current.revision) || 0,
        records: rows.map(row => ({
          store: row.store_name,
          id: row.record_id,
          payload: row.payload,
          deleted: false,
          revision: Number(row.revision) || 0,
          updatedAt: Number(row.updated_at) || 0,
          updatedBy: row.updated_by || ""
        })),
        truncated: rows.length === FULL_LIMIT,
        serverTime: Date.now()
      });
    }

    const since = Math.max(0, Math.trunc(Number(url.searchParams.get("since")) || 0));
    const result = await db.prepare(`SELECT revision, store_name, record_id, payload, deleted, updated_at, updated_by
      FROM central_changes
      WHERE revision > ?1
      ORDER BY revision ASC
      LIMIT ?2`).bind(since, PULL_LIMIT).all();
    const rows = result.results || [];
    return json({
      mode: "changes",
      initialized: Boolean(current.initialized),
      revision: Number(current.revision) || since,
      records: rows.map(row => ({
        store: row.store_name,
        id: row.record_id,
        payload: row.payload,
        deleted: Boolean(row.deleted),
        revision: Number(row.revision) || 0,
        updatedAt: Number(row.updated_at) || 0,
        updatedBy: row.updated_by || ""
      })),
      hasMore: rows.length === PULL_LIMIT,
      serverTime: Date.now()
    });
  } catch (error) {
    console.error("central GET failed", error);
    return errorResponse(error);
  }
}

async function onRequestPost(context) {
  const auth = authorize(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const declaredSize = Number(context.request.headers.get("content-length")) || 0;
    if (declaredSize > MAX_REQUEST_BYTES) throw Object.assign(new Error("Request too large"), { code: "TOO_MANY_RECORDS" });
    await ensureSchema(database(context.env));
    const db = database(context.env);
    let body;
    try { body = await context.request.json(); }
    catch { throw Object.assign(new Error("Invalid JSON"), { code: "INVALID_BODY" }); }
    if (!Array.isArray(body?.records)) throw Object.assign(new Error("records must be an array"), { code: "INVALID_BODY" });
    if (body.records.length > MAX_RECORDS) throw Object.assign(new Error(`Maximum ${MAX_RECORDS} records per request`), { code: "TOO_MANY_RECORDS" });
    const records = body.records.map(normalizeRecord);
    let latestRevision = Number((await state(db)).revision) || 0;
    let accepted = 0;

    for (const record of records) {
      const revision = await nextRevision(db);
      const updatedAt = Date.now();
      await db.batch([
        db.prepare(`INSERT INTO central_records
          (store_name, record_id, payload, deleted, revision, updated_at, updated_by)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT(store_name, record_id) DO UPDATE SET
            payload = excluded.payload,
            deleted = excluded.deleted,
            revision = excluded.revision,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
          WHERE excluded.revision > central_records.revision`).bind(record.store, record.id, record.payload, record.deleted, revision, updatedAt, record.updatedBy),
        db.prepare(`INSERT INTO central_changes
          (revision, store_name, record_id, payload, deleted, updated_at, updated_by)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(revision, record.store, record.id, record.payload, record.deleted, updatedAt, record.updatedBy)
      ]);
      latestRevision = revision;
      accepted += 1;
    }

    if (body.initialize || records.length) {
      await db.prepare("UPDATE central_state SET initialized = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
    }
    if (latestRevision > 50000) {
      await db.prepare("DELETE FROM central_changes WHERE revision < ?1").bind(latestRevision - 50000).run();
    }
    return json({ accepted, revision: latestRevision, initialized: true, serverTime: Date.now() });
  } catch (error) {
    console.error("central POST failed", error);
    return errorResponse(error);
  }
}


async function health(env) {
  return json({
    ok: true,
    api: "difor-sync",
    version: "16.57.0",
    d1: Boolean(database(env)),
    keyConfigured: Boolean(env?.DIFOR_APP_KEY || env?.DIFOR_SYNC_KEY),
    serverTime: Date.now()
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/api/health") return health(env);
    if (path === "/api/sync") {
      const context = { request, env };
      if (request.method === "OPTIONS") return onRequestOptions(context);
      if (request.method === "GET") return onRequestGet(context);
      if (request.method === "POST") return onRequestPost(context);
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    return env.ASSETS.fetch(request);
  }
};
