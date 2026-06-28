/**
 * Food-Marketplace Backend – komplette API in EINER Datei.
 *
 * Benötigte Umgebungsvariablen (z. B. in einer .env-Datei per `dotenv`,
 * oder direkt beim Hosting-Anbieter gesetzt):
 *   DATABASE_URL                postgresql://user:pass@host:5432/db
 *   SUPABASE_URL                https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Service-Role-Key aus Supabase (Settings -> API)
 *   PORT                        optional, Standard 4000
 *
 * Start:
 *   npm install
 *   node server.js
 *
 * Die Tabellen werden beim Start automatisch angelegt, falls sie noch
 * nicht existieren – kein separater Migrationsschritt nötig.
 */

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

// ============================================================================
// Setup: DB-Pool & Supabase-Admin-Client
// ============================================================================

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// Datenbank-Struktur (User, Listings, Offers, Chats, Messages)
// Wird beim Start automatisch angelegt – idempotent dank IF NOT EXISTS.
// ============================================================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id  TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  avatar_url   TEXT,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  image_url       TEXT NOT NULL,
  pickup_address  TEXT NOT NULL,
  pickup_lat      DOUBLE PRECISION NOT NULL,
  pickup_lng      DOUBLE PRECISION NOT NULL,
  expiry_date     TIMESTAMPTZ NOT NULL,
  price           NUMERIC(10,2),                  -- NULL = "Zu verschenken"
  is_free         BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | RESERVED | SOLD | EXPIRED | CANCELLED
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id),
  buyer_id    UUID NOT NULL REFERENCES users(id),
  amount      NUMERIC(10,2),
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING',     -- PENDING | ACCEPTED | REJECTED | CANCELLED
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    UUID UNIQUE NOT NULL REFERENCES offers(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES chats(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_listings_status_expiry ON listings(status, expiry_date);
CREATE INDEX IF NOT EXISTS idx_offers_listing_status ON offers(listing_id, status);
`;

async function initDb() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'); // für gen_random_uuid()
  await pool.query(SCHEMA_SQL);
  console.log("✅ Datenbankschema geprüft/angelegt.");
}

// ============================================================================
// Auth-Middleware: prüft Supabase-Access-Token, mapped auf internen User
// ============================================================================

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Kein Token übergeben." });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Token ungültig oder abgelaufen." });
  }

  // Bei Erstanmeldung automatisch internen User-Datensatz anlegen
  const { rows } = await pool.query(
    `INSERT INTO users (supabase_id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (supabase_id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [
      data.user.id,
      data.user.email ?? "",
      data.user.user_metadata?.name ?? data.user.email ?? "Unbekannt",
    ]
  );

  req.userId = rows[0].id;
  next();
}

// ============================================================================
// Helper: Validierung & Mapping (snake_case DB <-> camelCase API)
// ============================================================================

function validateCreateListing(body) {
  const errors = [];
  if (!body.title || body.title.length < 3) errors.push("title fehlt oder zu kurz.");
  if (!body.description || body.description.length < 10) errors.push("description fehlt oder zu kurz.");
  if (!body.imageUrl) errors.push("imageUrl fehlt.");
  if (!body.pickupAddress) errors.push("pickupAddress fehlt.");
  if (typeof body.pickupLat !== "number" || typeof body.pickupLng !== "number") {
    errors.push("pickupLat/pickupLng müssen Zahlen sein.");
  }
  if (!body.expiryDate || isNaN(Date.parse(body.expiryDate))) errors.push("expiryDate ungültig.");
  if (body.price !== null && (typeof body.price !== "number" || body.price <= 0)) {
    errors.push("price muss eine positive Zahl oder null (= Zu verschenken) sein.");
  }
  return errors;
}

function mapListing(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    pickupAddress: row.pickup_address,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    expiryDate: row.expiry_date,
    price: row.price === null ? null : Number(row.price),
    isFree: row.is_free,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.seller_name
      ? { seller: { name: row.seller_name, avatarUrl: row.seller_avatar_url } }
      : {}),
  };
}

// ============================================================================
// Express-App
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// --- Inserate ----------------------------------------------------------------

// Aktive Inserate listen
app.get("/api/listings", requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, u.name AS seller_name, u.avatar_url AS seller_avatar_url
     FROM listings l
     JOIN users u ON u.id = l.seller_id
     WHERE l.status = 'ACTIVE' AND l.expiry_date > now()
     ORDER BY l.created_at DESC`
  );
  res.json(rows.map(mapListing));
});

// Schritt 1 des Foto-Uploads: signierte Upload-URL.
// Das Foto geht direkt vom Client zu Supabase Storage, nicht über diese API.
app.get("/api/listings/upload-url", requireAuth, async (req, res) => {
  const ext = req.query.ext || "jpg";
  const path = `${req.userId}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from("listing-images")
    .createSignedUploadUrl(path);

  if (error) {
    return res.status(500).json({ error: "Upload-URL konnte nicht erstellt werden." });
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from("listing-images").getPublicUrl(path);

  res.json({
    uploadUrl: data.signedUrl, // Frontend macht hierhin ein PUT mit den Bilddaten
    publicUrl: publicUrlData.publicUrl, // anschließend an POST /api/listings übergeben
  });
});

// Kernfunktion 2: Inserat erstellen
app.post("/api/listings", requireAuth, async (req, res) => {
  const errors = validateCreateListing(req.body);
  if (errors.length) return res.status(400).json({ error: errors });

  const { title, description, imageUrl, pickupAddress, pickupLat, pickupLng, expiryDate, price } =
    req.body;

  const { rows } = await pool.query(
    `INSERT INTO listings
       (seller_id, title, description, image_url, pickup_address, pickup_lat, pickup_lng, expiry_date, price, is_free)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.userId,
      title,
      description,
      imageUrl,
      pickupAddress,
      pickupLat,
      pickupLng,
      expiryDate,
      price,
      price === null,
    ]
  );

  res.status(201).json(mapListing(rows[0]));
});

// --- Angebote ------------------------------------------------------------------

// Angebot für ein Inserat abgeben
app.post("/api/offers", requireAuth, async (req, res) => {
  const { listingId, amount, message } = req.body;
  if (!listingId) return res.status(400).json({ error: "listingId fehlt." });
  if (amount !== null && amount !== undefined && (typeof amount !== "number" || amount <= 0)) {
    return res.status(400).json({ error: "amount muss eine positive Zahl oder null sein." });
  }

  const { rows: listingRows } = await pool.query("SELECT * FROM listings WHERE id = $1", [listingId]);
  const listing = listingRows[0];
  if (!listing || listing.status !== "ACTIVE") {
    return res.status(404).json({ error: "Inserat nicht verfügbar." });
  }
  if (listing.seller_id === req.userId) {
    return res.status(400).json({ error: "Eigene Inserate können nicht beboten werden." });
  }

  const { rows } = await pool.query(
    `INSERT INTO offers (listing_id, buyer_id, amount, message) VALUES ($1,$2,$3,$4) RETURNING *`,
    [listingId, req.userId, amount ?? null, message ?? null]
  );

  res.status(201).json(rows[0]);
});

// Kernfunktion 3: Angebot annehmen – läuft als DB-Transaktion mit Zeilensperre
// (FOR UPDATE), damit nie zwei Käufer:innen gleichzeitig denselben Artikel
// "gewinnen" können. Lehnt automatisch alle anderen offenen Angebote ab und
// legt den Chat für die Abhol-Absprache an (Kernfunktion 4).
app.patch("/api/offers/:offerId/accept", requireAuth, async (req, res) => {
  const { offerId } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: offerRows } = await client.query(
      `SELECT o.*, l.seller_id, l.status AS listing_status
       FROM offers o JOIN listings l ON l.id = o.listing_id
       WHERE o.id = $1 FOR UPDATE`,
      [offerId]
    );
    const offer = offerRows[0];

    if (!offer) throw { status: 404, message: "Angebot nicht gefunden." };
    if (offer.seller_id !== req.userId) {
      throw { status: 403, message: "Nur die Verkäufer:in darf dieses Angebot annehmen." };
    }
    if (offer.status !== "PENDING") {
      throw { status: 409, message: "Angebot wurde bereits bearbeitet." };
    }
    if (offer.listing_status !== "ACTIVE") {
      throw { status: 409, message: "Inserat ist nicht mehr aktiv." };
    }

    await client.query(
      "UPDATE offers SET status = 'ACCEPTED', updated_at = now() WHERE id = $1",
      [offerId]
    );
    await client.query(
      `UPDATE offers SET status = 'REJECTED', updated_at = now()
       WHERE listing_id = $1 AND id != $2 AND status = 'PENDING'`,
      [offer.listing_id, offerId]
    );
    await client.query(
      "UPDATE listings SET status = 'RESERVED', updated_at = now() WHERE id = $1",
      [offer.listing_id]
    );

    const { rows: chatRows } = await client.query(
      "INSERT INTO chats (offer_id) VALUES ($1) RETURNING id",
      [offerId]
    );

    await client.query("COMMIT");
    res.json({ message: "Angebot angenommen.", chatId: chatRows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.status || 500).json({ error: err.message || "Interner Fehler." });
  } finally {
    client.release();
  }
});

// Angebot ablehnen
app.patch("/api/offers/:offerId/reject", requireAuth, async (req, res) => {
  const { offerId } = req.params;
  const { rows } = await pool.query(
    `SELECT o.*, l.seller_id FROM offers o JOIN listings l ON l.id = o.listing_id WHERE o.id = $1`,
    [offerId]
  );
  const offer = rows[0];
  if (!offer) return res.status(404).json({ error: "Angebot nicht gefunden." });
  if (offer.seller_id !== req.userId) {
    return res.status(403).json({ error: "Nur die Verkäufer:in darf dieses Angebot ablehnen." });
  }

  await pool.query("UPDATE offers SET status = 'REJECTED', updated_at = now() WHERE id = $1", [offerId]);
  res.json({ message: "Angebot abgelehnt." });
});

// ============================================================================
// Start
// ============================================================================

const PORT = process.env.PORT || 4000;

initDb()
  .then(() => app.listen(PORT, () => console.log(`🚀 API läuft auf Port ${PORT}`)))
  .catch((err) => {
    console.error("❌ Datenbank-Init fehlgeschlagen:", err);
    process.exit(1);
  });
