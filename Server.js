/**
 * Food-Marketplace Backend – komplette API in EINER Datei (Supabase SDK Edition).
 *
 * Benötigte Umgebungsvariablen bei Render:
 *   SUPABASE_URL                https://keaahccmqnmvtcmabvvz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Dein Supabase Service-Role Key
 *   PORT                        optional, Standard 4000
 */

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// ============================================================================
// Setup: Supabase-Admin-Client (nutzt HTTPS Port 443)
// ============================================================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FEHLER: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt!");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

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

  // Bei Erstanmeldung automatisch internen User-Datensatz anlegen / aktualisieren
  const { data: user, error: dbErr } = await supabaseAdmin
    .from("users")
    .upsert(
      {
        supabase_id: data.user.id,
        email: data.user.email ?? "",
        name: data.user.user_metadata?.name ?? data.user.email ?? "Unbekannt",
      },
      { onConflict: "supabase_id" }
    )
    .select("id")
    .single();

  if (dbErr) {
    return res.status(500).json({ error: "Benutzer konnte nicht synchronisiert werden." });
  }

  req.userId = user.id;
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
    ...(row.users
      ? { seller: { name: row.users.name, avatarUrl: row.users.avatar_url } }
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
  const { data, error } = await supabaseAdmin
    .from("listings")
    .select("*, users!seller_id(name, avatar_url)")
    .eq("status", "ACTIVE")
    .gt("expiry_date", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(mapListing));
});

// Schritt 1 des Foto-Uploads: signierte Upload-URL
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
    uploadUrl: data.signedUrl,
    publicUrl: publicUrlData.publicUrl,
  });
});

// Kernfunktion 2: Inserat erstellen
app.post("/api/listings", requireAuth, async (req, res) => {
  const errors = validateCreateListing(req.body);
  if (errors.length) return res.status(400).json({ error: errors });

  const { title, description, imageUrl, pickupAddress, pickupLat, pickupLng, expiryDate, price } =
    req.body;

  const { data, error } = await supabaseAdmin
    .from("listings")
    .insert({
      seller_id: req.userId,
      title,
      description,
      image_url: imageUrl,
      pickup_address: pickupAddress,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      expiry_date: expiryDate,
      price,
      is_free: price === null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(mapListing(data));
});

// --- Angebote ------------------------------------------------------------------

// Angebot für ein Inserat abgeben
app.post("/api/offers", requireAuth, async (req, res) => {
  const { listingId, amount, message } = req.body;
  if (!listingId) return res.status(400).json({ error: "listingId fehlt." });
  if (amount !== null && amount !== undefined && (typeof amount !== "number" || amount <= 0)) {
    return res.status(400).json({ error: "amount muss eine positive Zahl oder null sein." });
  }

  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .single();

  if (!listing || listing.status !== "ACTIVE") {
    return res.status(404).json({ error: "Inserat nicht verfügbar." });
  }
  if (listing.seller_id === req.userId) {
    return res.status(400).json({ error: "Eigene Inserate können nicht beboten werden." });
  }

  const { data, error } = await supabaseAdmin
    .from("offers")
    .insert({
      listing_id: listingId,
      buyer_id: req.userId,
      amount: amount ?? null,
      message: message ?? null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Kernfunktion 3: Angebot annehmen
app.patch("/api/offers/:offerId/accept", requireAuth, async (req, res) => {
  const { offerId } = req.params;

  const { data: offer } = await supabaseAdmin
    .from("offers")
    .select("*, listings!inner(seller_id, status)")
    .eq("id", offerId)
    .single();

  if (!offer) return res.status(404).json({ error: "Angebot nicht gefunden." });
  if (offer.listings.seller_id !== req.userId) {
    return res.status(403).json({ error: "Nur die Verkäufer:in darf dieses Angebot annehmen." });
  }
  if (offer.status !== "PENDING") {
    return res.status(409).json({ error: "Angebot wurde bereits bearbeitet." });
  }
  if (offer.listings.status !== "ACTIVE") {
    return res.status(409).json({ error: "Inserat ist nicht mehr aktiv." });
  }

  // 1. Dieses Angebot akzeptieren
  await supabaseAdmin.from("offers").update({ status: "ACCEPTED", updated_at: new Date() }).eq("id", offerId);

  // 2. Andere offene Angebote ablehnen
  await supabaseAdmin
    .from("offers")
    .update({ status: "REJECTED", updated_at: new Date() })
    .eq("listing_id", offer.listing_id)
    .neq("id", offerId)
    .eq("status", "PENDING");

  // 3. Inserat als RESERVED markieren
  await supabaseAdmin
    .from("listings")
    .update({ status: "RESERVED", updated_at: new Date() })
    .eq("id", offer.listing_id);

  // 4. Chat erstellen
  const { data: chat, error: chatErr } = await supabaseAdmin
    .from("chats")
    .insert({ offer_id: offerId })
    .select("id")
    .single();

  if (chatErr) return res.status(500).json({ error: chatErr.message });

  res.json({ message: "Angebot angenommen.", chatId: chat.id });
});

// Angebot ablehnen
app.patch("/api/offers/:offerId/reject", requireAuth, async (req, res) => {
  const { offerId } = req.params;

  const { data: offer } = await supabaseAdmin
    .from("offers")
    .select("*, listings!inner(seller_id)")
    .eq("id", offerId)
    .single();

  if (!offer) return res.status(404).json({ error: "Angebot nicht gefunden." });
  if (offer.listings.seller_id !== req.userId) {
    return res.status(403).json({ error: "Nur die Verkäufer:in darf dieses Angebot ablehnen." });
  }

  await supabaseAdmin.from("offers").update({ status: "REJECTED", updated_at: new Date() }).eq("id", offerId);
  res.json({ message: "Angebot abgelehnt." });
});

// ============================================================================
// Start
// ============================================================================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 API läuft auf Port ${PORT} (Verbindung über Supabase API)`);
});
