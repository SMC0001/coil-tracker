// server.js
console.log('Starting Tracker App Backend - Version 1.2.4'); // updated version
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from "./db.js";
import multer from "multer";
import xlsx from "xlsx";

const upload = multer({ dest: "uploads/" })

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------------- DB bootstrap (Persistent Disk Only) ----------------
const PERSIST_DIR = process.env.DB_DIR || "/data";     // Render disk mount
const DB_PATH = path.join(PERSIST_DIR, "tracker.db");  // Always use /data/tracker.db
const schemaPath = path.join(__dirname, "schema.sql");

// ensure /data exists (safe if already mounted)
try { fs.mkdirSync(PERSIST_DIR, { recursive: true }); } catch {}

// open DB directly on /data/tracker.db
console.log("Using DB at:", DB_PATH);
const db = new Database(DB_PATH);

// apply schema if present (idempotent — runs CREATE TABLE IF NOT EXISTS)
if (fs.existsSync(schemaPath)) {
  try {
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema);
    console.log("✅ Schema applied");
  } catch (e) {
    console.error("❌ Schema init failed:", e.message);
  }
}

// light migrations (safe if already exist)
try { db.prepare(`ALTER TABLE coils ADD COLUMN purchase_date TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE circle_runs ADD COLUMN patta_size TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE circle_runs ADD COLUMN patta_weight_kg REAL`).run(); } catch {}
// ✅ Add patta_size to patta_runs if missing
try { db.prepare(`ALTER TABLE patta_runs ADD COLUMN patta_size REAL`).run(); } catch {}

// --- add purchase price columns (safe if already exist)
try { db.prepare(`ALTER TABLE coils ADD COLUMN purchase_price REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE coil_stock ADD COLUMN purchase_price REAL`).run(); } catch {}

// ✅ Add order_no to circle_sales_new (link sales to orders)
try { db.prepare(`ALTER TABLE circle_sales_new ADD COLUMN order_no INTEGER`).run(); } catch {}

// Make sure old DBs have the new columns used below
try { db.prepare(`ALTER TABLE scrap_sales ADD COLUMN grade TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE coil_direct_sales ADD COLUMN sale_date TEXT`).run(); } catch {}

// ✅ Add updated_at to pl_stock (used by /api/pl-sales)
try { db.prepare(`ALTER TABLE pl_stock ADD COLUMN updated_at TEXT`).run(); } catch {}

try { db.prepare(`ALTER TABLE patta_runs ADD COLUMN grade TEXT`).run(); } catch {}

// ✅ orders table migrations (idempotent) — add missing columns safely
try { db.prepare(`ALTER TABLE orders ADD COLUMN order_by TEXT`).run(); } catch {}

// ✅ Ensure RN column exists and is unique
try { db.prepare(`ALTER TABLE coils ADD COLUMN rn TEXT`).run(); } catch {}
try { db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coils_rn ON coils(rn)`).run(); } catch {}

// ✅ cancellations (idempotent, no reason)
try { db.prepare(`ALTER TABLE orders ADD COLUMN cancelled_at TEXT`).run(); } catch {}

try { db.prepare(`ALTER TABLE orders ADD COLUMN cancel_remarks TEXT`).run(); } catch {}

// Scrap sales: add rn + source_type if missing
try { db.prepare(`ALTER TABLE scrap_sales ADD COLUMN rn TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE scrap_sales ADD COLUMN source_type TEXT`).run(); } catch {}

try { db.prepare(`ALTER TABLE circle_runs ADD COLUMN pl_size REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE circle_runs ADD COLUMN pl_weight_kg REAL`).run(); } catch {}

try { db.prepare(`ALTER TABLE pl_sales ADD COLUMN pl_stock_id INTEGER`).run(); } catch {}

// ✅ orders table migrations (idempotent)
try { db.prepare(`ALTER TABLE orders ADD COLUMN thickness_mm REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN op_size_mm REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN ordered_qty_pcs INTEGER`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN fulfilled_qty_pcs INTEGER DEFAULT 0`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN ordered_weight_kg REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN remaining_weight_kg REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN price_per_kg REAL`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'open'`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN notes TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN order_date TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN company TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN grade TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE orders ADD COLUMN updated_at TEXT`).run(); } catch {}

// Backfill order_date for old rows
try { db.exec(`UPDATE orders SET order_date = COALESCE(order_date, created_at)`); } catch {}

// Helpful on startup to verify columns (remove later)
try { 
  const cols = db.prepare(`PRAGMA table_info(orders)`).all();
  console.log('orders columns:', cols.map(c => c.name));
} catch {}

try { db.prepare(`ALTER TABLE patta_runs ADD COLUMN grade TEXT`).run(); } catch {}

// NEW: circle_stock & circle_sales tables (if not in schema.sql)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS circle_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL, -- 'circle' or 'patta'
      source_id INTEGER NOT NULL,
      size_mm REAL,
      weight_kg REAL,
      qty INTEGER,
      production_date TEXT,
      operator TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS circle_sales_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      sold_qty INTEGER NOT NULL,
      sold_weight_kg REAL NOT NULL,
      buyer TEXT,
      price_per_kg REAL,
      sale_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch {}

// NEW: coil_stock table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coil_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coil_id INTEGER NOT NULL UNIQUE,
      rn TEXT NOT NULL,
      grade TEXT,
      thickness REAL,
      width REAL,
      supplier TEXT,
      purchase_date TEXT,
      initial_weight_kg REAL NOT NULL,
      available_weight_kg REAL NOT NULL,
      purchase_price REAL,                          -- 👈 NEW
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch {}

// --- PL stock & sales ---
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pl_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('circle','pl','patta')),
      source_id INTEGER NOT NULL,
      grade TEXT,
      size_mm REAL,
      weight_kg REAL NOT NULL,
      qty INTEGER,
      production_date TEXT NOT NULL,
      operator TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS pl_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pl_id INTEGER NOT NULL,
      sold_qty INTEGER,
      sold_weight_kg REAL,
      buyer TEXT,
      price_per_kg REAL,
      sale_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch (e) {
  console.error("Failed to create pl tables", e);
}

// NEW: orders table (used by /orders list & updates)
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE,
    order_by TEXT,
    company TEXT,
    grade TEXT,
    thickness_mm REAL,
    op_size_mm REAL,
    ordered_qty_pcs INTEGER,
    fulfilled_qty_pcs INTEGER DEFAULT 0,
    ordered_weight_kg REAL,
    fulfilled_weight_kg REAL DEFAULT 0,   -- <== add this
    remaining_weight_kg REAL,
    price_per_kg REAL,
    status TEXT DEFAULT 'open',
    notes TEXT,
    order_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  );
`);
} catch {}

// NEW: scrap_sales + small helper tables to avoid reference errors
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrap_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_date TEXT,
  buyer TEXT,
  grade TEXT,              -- NEW
  rn TEXT,               -- 👈 add this
  source_type TEXT,      -- 👈 add this
  weight_kg REAL NOT NULL,
  price_per_kg REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
    CREATE TABLE IF NOT EXISTS coil_direct_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coil_id INTEGER NOT NULL,
  sold_weight_kg REAL NOT NULL,
  buyer TEXT,
  price_per_kg REAL,
  sale_date TEXT,                                   -- NEW
  created_at TEXT DEFAULT (datetime('now'))
);
    CREATE TABLE IF NOT EXISTS coil_scrap (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coil_id INTEGER NOT NULL,
      scrap_weight_kg REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch {}

/* ------------------------------ AUTH SETUP ------------------------------ */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SECRET_KEY = process.env.JWT_SECRET || "change-me-now"; // ❗ change this to something strong

// Create users table if it doesn't exist
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `).run();
} catch (err) {
  console.error("Error creating users table:", err);
}

// ✅ Auto-create default admin if not exists
try {
  const admin = db.prepare("SELECT * FROM users WHERE username = ?").get("admin");

  if (!admin) {
    const hashedPassword = bcrypt.hashSync("Admin@123", 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(
      "admin",
      hashedPassword,
      "admin"
    );
    console.log("✅ Default admin created: username=admin, password=admin123");
  }
} catch (err) {
  console.error("Error seeding admin user:", err);
}

// ✅ Seed demo PL Stock if empty
try {
  const anyPlStock = db.prepare("SELECT id FROM pl_stock LIMIT 1").get();
  if (!anyPlStock) {
    db.prepare(`
      INSERT INTO pl_stock (source_type, source_id, grade, size_mm, weight_kg, qty, production_date, operator)
      VALUES (?,?,?,?,?,?,?,?)
    `).run("circle", 1, "304", 1500, 500, 1, new Date().toISOString(), "System");
    console.log("🌱 Seeded sample pl_stock");
  }
} catch (e) {
  console.error("PL Stock seeding failed:", e);
}


// ========================== AUTH ROUTES ========================== //

// Signup route (for creating new users)
app.post("/api/signup", (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const wantAdmin = String(role || "").toLowerCase() === "admin";
  const { n: userCount } = db.prepare("SELECT COUNT(*) AS n FROM users").get();

    // Only allow admin creation if it's the first ever user
  if (wantAdmin && userCount > 0) {
    return res.status(403).json({ error: "Admin signup not allowed after initial setup" });
  }

  // If not admin, always default role = 'user'
  const finalRole = wantAdmin ? "admin" : "user";


  const password_hash = bcrypt.hashSync(password, 10);

  try {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)")
      .run(username, password_hash, finalRole);
    res.json({ message: "User created successfully" });
  } catch (_err) {
    res.status(400).json({ error: "User already exists" });
  }
});

// Login route
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: "1h" });
  res.json({ token });
});

// ========================== AUTH MIDDLEWARE ========================== //
function auth(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "No token provided" });

    const token = authHeader.split(" ")[1];
    try {
      const user = jwt.verify(token, SECRET_KEY);
      if (requiredRole && user.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden: insufficient rights" });
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

// ========================== PROTECTED EXAMPLES ========================== //
// Anyone logged in
app.get("/api/secure-data", auth(), (req, res) => {
  res.json({ message: `Hello, you are logged in as ${req.user.role}` });
});

// Only admin
app.get("/api/admin-data", auth("admin"), (req, res) => {
  res.json({ message: "This is secret admin-only data" });
});

// List all users (admin only)
app.get("/api/users", auth("admin"), (req, res) => {
  const users = all("SELECT id, username, role FROM users ORDER BY id ASC");
  res.json(users);
});

// Delete a user (admin only, prevent deleting last admin)
app.delete("/api/users/:id", auth("admin"), (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.role === "admin") {
    const { n: countAdmins } = get("SELECT COUNT(*) AS n FROM users WHERE role='admin'");
    if (countAdmins <= 1) {
      return res.status(400).json({ error: "Cannot delete the last admin" });
    }
  }

  run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

// Users API
app.get('/api/users', (req, res) => {
  const rows = db.prepare(`SELECT id, username, role FROM users`).all();
  res.json(rows);
});

// Create user (admin only)
app.post("/api/users", auth("admin"), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Missing fields" });
  }
  try {
    const password_hash = bcrypt.hashSync(password, 10);
    const info = run(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
      [username, password_hash, role]
    );
    res.json({ id: info.lastInsertRowid, username, role });
  } catch (err) {
    res.status(400).json({ error: "User already exists" });
  }
});


app.delete('/api/users/:id', (req, res) => {
  db.prepare(`DELETE FROM users WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

	

const run = (sql, p = []) => db.prepare(sql).run(p);
const all = (sql, p = []) => db.prepare(sql).all(p);
const get = (sql, p = []) => db.prepare(sql).get(p);

/* ──────────────────────────────────────────────────────────────────────────
   Orders: ensure the extra columns exist (non-destructive migrations)
   ────────────────────────────────────────────────────────────────────────── */
(() => {
  const cols = new Set(db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name));
  const add = (name, ddl) => {
  if (!cols.has(name)) {
    try {
      db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${ddl}`);
      cols.add(name); // keep our set in sync
    } catch (e) {
      console.warn('ALTER orders ADD COLUMN failed:', name, e.message);
    }
  }
};

  // Target columns for your Orders tab and auto-fulfillment tracking
  add('thickness_mm',         'REAL');                 // ✅ you use this in routes/queries
  add('op_size_mm',           'REAL');                 // Op. size (mm)
  add('ordered_qty_pcs',      'INTEGER');              // Ordered Qty (pcs)
  add('ordered_weight_kg',    'REAL');                 // Ordered Weight (kg)
  add('fulfilled_qty_pcs',    'INTEGER DEFAULT 0');    // Running fulfillment (pcs)
  add('fulfilled_weight_kg',  'REAL DEFAULT 0');       // Running fulfillment (kg)

  // Timestamps (used by PATCH/SELECT)
  add('created_at',           `TEXT DEFAULT (datetime('now'))`);
  add('updated_at',           `TEXT DEFAULT (datetime('now'))`);

  // Normalize status default
  if (!cols.has('status')) {
    try { db.exec(`ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'Pending'`); } catch {}
  }
})();

/* ──────────────────────────────────────────────────────────────────────────
   Helper: recompute a single order’s fulfillment (qty/weight) and status
   Call this after creating/updating/deleting a circle sale linked to the order.
   NOTE: This version uses your existing tables:
     - orders.id (we treat it as the Order No)
     - circle_sales_new with "order_no" column (already added above)
     - Falls back to legacy fields if new ordered_* are empty
   ────────────────────────────────────────────────────────────────────────── */
function recomputeOrder(orderId) {
  if (!orderId) return null;

  // Read targets (new columns only)
  const order = db.prepare(`
    SELECT
      id AS order_no,
      IFNULL(ordered_qty_pcs, 0)    AS target_qty,
      IFNULL(ordered_weight_kg, 0)  AS target_wt,
      cancelled_at
    FROM orders
    WHERE id = ?
  `).get(orderId);

  if (!order) return null;

  // ⛔ If cancelled, don’t recompute
  if (order.cancelled_at) {
    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  }


  // Sum sales linked to this order
  const agg = db.prepare(`
    SELECT
      IFNULL(SUM(sold_qty), 0)        AS sum_qty,
      IFNULL(SUM(sold_weight_kg), 0)  AS sum_wt
    FROM circle_sales_new
    WHERE order_no = ?
  `).get(orderId);

  const fQty = Number(agg.sum_qty || 0);
  const fWt  = Number(agg.sum_wt  || 0);
  const oQty = Number(order.target_qty || 0);
  const oWt  = Number(order.target_wt  || 0);

  // Decide status
  let status = 'Pending';
  const hasTargets = (oQty > 0) || (oWt > 0);
  const hitQty     = oQty > 0 && fQty >= oQty;
  const hitWt      = oWt > 0 && fWt  >= oWt;

  if (!hasTargets) {
    status = (fQty > 0 || fWt > 0) ? 'Partial' : 'Pending';
  } else if (hitQty || hitWt) {
    status = 'Fulfilled';
  } else if (fQty > 0 || fWt > 0) {
    status = 'Partial';
  }

  db.prepare(`
    UPDATE orders
    SET fulfilled_qty_pcs   = ?,
        fulfilled_weight_kg = ?,
        status              = ?,
        updated_at          = datetime('now')
    WHERE id = ?
  `).run(fQty, fWt, status, orderId);

  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* ------------------------- Circle Stock → Order match ------------------------- */
app.get('/api/circle-stock/:id/matches', auth(), (req, res) => {
  const stockId = req.params.id;

  const stock = get(`
SELECT cs.id, cs.size_mm, cs.weight_kg, cs.qty,

       /* grade from either path */
       CASE
         WHEN cs.source_type='circle' THEN cr.grade
         WHEN cs.source_type='patta'  THEN COALESCE(cr2.grade,c2.grade,cr3.grade,c3.grade)
       END AS grade,

       /* ✅ thickness for both paths */
       CASE 
         WHEN cs.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
         WHEN cs.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
       END AS thickness_mm,

       /* available weight */
       CASE WHEN (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg),0)) < 0
            THEN 0 ELSE (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg),0)) END AS available_weight_kg

FROM circle_stock cs
LEFT JOIN circle_runs cr   ON cs.source_type='circle' AND cs.source_id = cr.id
LEFT JOIN coils c          ON c.id = cr.coil_id              -- ✅ add this
LEFT JOIN patta_runs pr    ON cs.source_type='patta' AND cs.source_id = pr.id
LEFT JOIN circle_runs cr2  ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
LEFT JOIN coils c2         ON c2.id = cr2.coil_id
LEFT JOIN patta_runs pr2   ON pr.source_type='patta'  AND pr.patta_source_id = pr2.id
LEFT JOIN circle_runs cr3  ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
LEFT JOIN coils c3         ON c3.id = cr3.coil_id
LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id
WHERE cs.id=?
GROUP BY cs.id
  `, [stockId]);

  if (!stock) return res.status(404).json({ error: 'Stock not found' });

// Only orders that still need something, and match grade/thickness/op_size
const orders = all(`
  WITH sold AS (
    SELECT order_no, IFNULL(SUM(sold_weight_kg),0) AS sold_wt
    FROM circle_sales_new
    GROUP BY order_no
  )
  SELECT 
    o.id AS order_no,
    o.order_date,
    o.company,
    o.grade,
    o.thickness_mm,
    o.op_size_mm,
    o.ordered_weight_kg,
    IFNULL(s.sold_wt, 0) AS fulfilled_weight_kg,
    MAX(0, IFNULL(o.ordered_weight_kg,0) - IFNULL(s.sold_wt,0)) AS remaining_weight_kg,
    o.status
  FROM orders o
  LEFT JOIN sold s ON s.order_no = o.id
  WHERE
    o.grade = ?
    AND o.thickness_mm = ?
    AND o.op_size_mm = ?
    AND MAX(0, IFNULL(o.ordered_weight_kg,0) - IFNULL(s.sold_wt,0)) > 0
  ORDER BY o.order_date ASC, o.id ASC
`, [stock.grade, stock.thickness_mm, stock.size_mm]);

  const matches = orders
    .map(o => ({
      ...o,
      fulfillment:
        stock.available_weight_kg >= o.remaining_weight_kg
          ? 'full'
          : stock.available_weight_kg > 0
            ? 'partial'
            : 'none'
    }))
    .filter(m => m.fulfillment !== 'none');

  res.json({ stock, matches });
});

/* -------------------------------- Companies ------------------------------- */
app.post('/api/companies', auth('admin'), (req, res) => {
  const { name, country, city, email, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = run(
    `INSERT INTO companies(name,country,city,email,phone) VALUES (?,?,?,?,?)`,
    [name, country || null, city || null, email || null, phone || null]
  );
  res.json(get(`SELECT * FROM companies WHERE id=?`, [info.lastInsertRowid]));
});
app.get('/api/companies', auth(), (_req, res) => res.json(all(`SELECT * FROM companies ORDER BY created_at DESC`)));
app.delete('/api/companies/:id', auth('admin'), (req, res) => {
  run(`DELETE FROM companies WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

/* ---------------------------------- Orders -------------------------------- */

// List orders
app.get('/api/orders', auth(), (req, res) => {
  const { q, status, grade, company } = req.query;

  let sql = `
    SELECT
      id AS order_no,
      order_date,
      order_by,
      company,
      grade,
      thickness_mm,
      op_size_mm,
      ordered_qty_pcs,
      ordered_weight_kg,
      fulfilled_qty_pcs,
      fulfilled_weight_kg,
      MAX(0, IFNULL(ordered_weight_kg,0) - IFNULL(fulfilled_weight_kg,0)) AS remaining_weight_kg,
      status,
      cancelled_at,
      cancel_remarks,
      created_at,
      updated_at
    FROM orders
  `;

  const where = [];
  const p = [];

  if (q) {
    where.push(`(
      CAST(id AS TEXT) LIKE ?
      OR IFNULL(company,'') LIKE ?
      OR IFNULL(grade,'') LIKE ?
    )`);
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) { where.push(`status = ?`); p.push(status); }
  if (grade)  { where.push(`grade  = ?`); p.push(grade); }
  if (company){ where.push(`company= ?`); p.push(company); }

  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += `
  ORDER BY
    (order_date IS NULL OR TRIM(order_date) = '') ASC,                  -- push NULL/empty last
    COALESCE(datetime(NULLIF(order_date, '')), date(NULLIF(order_date, ''))) DESC,  -- newest first
    order_no DESC
`;

  res.json(all(sql, p));
});

// Create order (writes only the 9-tab fields; order_no is auto)

// helper: coerce numbers or NULL
const toNum = v =>
  (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));

// helper: pick the first defined key from an object
const pick = (o, ...keys) => {
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
  return undefined;
};

// Create order (writes only the 9-tab fields; order_no is auto)
app.post('/api/orders', auth(), (req, res) => {
  // TEMP: see what the UI actually posts
  console.log('Create order payload:', req.body);

  // helper to coerce numeric inputs (empty string -> null)
  const toNum = (v) =>
    v === undefined || v === null || String(v).trim() === '' ? null : Number(v);

  // Accept snake_case AND camelCase
  const {
    order_date, orderDate,
    order_by, orderBy,
    company,
    grade,

    // thickness
    thickness_mm, thicknessMm, thickness,

    // op size
    op_size_mm, opSizeMm, op_size, opSize,

    // qty
    ordered_qty_pcs, orderedQty, orderedQuantity, quantity, qty,

    // weight
    ordered_weight_kg, orderedWeightKg, ordered_weight, orderedWeight,
    status
  } = req.body;

const ins = run(`
  INSERT INTO orders(
    order_date, order_by, company, grade,
    thickness_mm, op_size_mm,
    ordered_qty_pcs, ordered_weight_kg, status
  ) VALUES (?,?,?,?,?,?,?,?,?)
`, [
  order_date ?? orderDate ?? null,
  order_by ?? orderBy ?? null,
  company ?? null,
  grade ?? null,
  toNum(thickness_mm ?? thicknessMm ?? thickness),
  toNum(op_size_mm ?? opSizeMm ?? op_size ?? opSize),
  toNum(ordered_qty_pcs ?? orderedQty ?? orderedQuantity ?? quantity ?? qty),
  toNum(ordered_weight_kg ?? orderedWeightKg ?? ordered_weight ?? orderedWeight),
  status ?? 'Pending'
]);

  res.json(get(`
    SELECT id AS order_no, order_date, order_by, company, grade,
           thickness_mm, op_size_mm,
           ordered_qty_pcs, ordered_weight_kg,
           fulfilled_qty_pcs, fulfilled_weight_kg,
           status, created_at, updated_at
    FROM orders WHERE id = ?
  `, [ins.lastInsertRowid]));
});


// Edit order inline (allow only Orders tab fields)
app.patch('/api/orders/:order_no', auth(), (req, res) => {
  const body = { ...req.body };

if (body.orderBy !== undefined && body.order_by === undefined) body.order_by = body.orderBy;

  // Normalize camelCase/snake_case aliases to canonical column names
  if (body.thicknessMm !== undefined && body.thickness_mm === undefined) body.thickness_mm = body.thicknessMm;
  if (body.thickness    !== undefined && body.thickness_mm === undefined) body.thickness_mm = body.thickness;

  if (body.opSizeMm   !== undefined && body.op_size_mm === undefined) body.op_size_mm = body.opSizeMm;
  if (body.opSize     !== undefined && body.op_size_mm === undefined) body.op_size_mm = body.opSize;
  if (body.op_size    !== undefined && body.op_size_mm === undefined) body.op_size_mm = body.op_size;

  if (body.orderedQty       !== undefined && body.ordered_qty_pcs === undefined) body.ordered_qty_pcs = body.orderedQty;
  if (body.orderedQuantity  !== undefined && body.ordered_qty_pcs === undefined) body.ordered_qty_pcs = body.orderedQuantity;
  if (body.quantity         !== undefined && body.ordered_qty_pcs === undefined) body.ordered_qty_pcs = body.quantity;
  if (body.qty              !== undefined && body.ordered_qty_pcs === undefined) body.ordered_qty_pcs = body.qty;
  if (body.ordered_qty      !== undefined && body.ordered_qty_pcs === undefined) body.ordered_qty_pcs = body.ordered_qty;

  if (body.orderedWeightKg  !== undefined && body.ordered_weight_kg === undefined) body.ordered_weight_kg = body.orderedWeightKg;
  if (body.orderedWeight    !== undefined && body.ordered_weight_kg === undefined) body.ordered_weight_kg = body.orderedWeight;
  if (body.ordered_weight   !== undefined && body.ordered_weight_kg === undefined) body.ordered_weight_kg = body.ordered_weight;

  if (body.orderDate !== undefined && body.order_date === undefined) body.order_date = body.orderDate;

  const toNum = (v) =>
    v === undefined || v === null || String(v).trim() === '' ? null : Number(v);

  const allowed = [
    'order_date', 'order_by', 'company', 'grade',
    'thickness_mm', 'op_size_mm',
    'ordered_qty_pcs', 'ordered_weight_kg',
    'status'
  ];

  const fields = [];
  const params = [];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      const v = ['thickness_mm','op_size_mm','ordered_qty_pcs','ordered_weight_kg'].includes(k)
        ? toNum(body[k])
        : (body[k] === '' ? null : body[k]);
      fields.push(`${k} = ?`);
      params.push(v);
    }
  }

  if (fields.length) {
    fields.push(`updated_at = datetime('now')`);
    params.push(req.params.order_no);
    run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  res.json(get(`
    SELECT id AS order_no, order_date, order_by, company, grade,
           thickness_mm, op_size_mm,
           ordered_qty_pcs, ordered_weight_kg,
           fulfilled_qty_pcs, fulfilled_weight_kg,
           status, created_at, updated_at
    FROM orders WHERE id = ?
  `, [req.params.order_no]));
});


app.delete('/api/orders/:order_no', auth("admin"), (req, res) => {
  run(`DELETE FROM orders WHERE id = ?`, [req.params.order_no]);
  res.json({ ok: true });
});

// ------------------------- Cancel / Un-cancel an order -------------------------
app.patch('/api/orders/:id/cancel', auth('admin'), (req, res) => {
  const { id } = req.params;
  const { remarks } = req.body;

  // remarks are required
  if (!remarks || !remarks.trim()) {
    return res.status(400).json({ error: "Cancellation remarks are required" });
  }

  const order = get(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.cancelled_at) return res.status(409).json({ error: 'Already cancelled' });

  const when = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  run(
    `UPDATE orders
       SET cancelled_at   = ?,
           cancel_remarks = ?,
           status         = 'Cancelled',
           updated_at     = datetime('now')
     WHERE id = ?`,
    [when, remarks.trim(), id]
  );

  res.json(get(`SELECT * FROM orders WHERE id = ?`, [id]));
});

app.patch('/api/orders/:id/uncancel', auth('admin'), (req, res) => {
  const { id } = req.params;

  const order = get(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.cancelled_at) return res.status(409).json({ error: 'Not cancelled' });

  run(
    `UPDATE orders
       SET cancelled_at   = NULL,
           cancel_remarks = NULL,
           status         = 'Pending',
           updated_at     = datetime('now')
     WHERE id = ?`,
    [id]
  );

  // Recompute status after uncancel
  recomputeOrder(id);

  res.json(get(`SELECT * FROM orders WHERE id = ?`, [id]));
});

// ================= ORDERS: Auto update status =================
app.post("/api/orders/:id/update-status", auth(), (req, res) => {
  try {
    const id = req.params.id;

    // fetch order by id
    const order = get(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (!order) return res.status(404).send("Order not found");

    // get total sales linked to this order
    const totals = get(
      `SELECT 
         COALESCE(SUM(sold_qty), 0) as qty,
         COALESCE(SUM(sold_weight_kg), 0) as wt
       FROM circle_sales_new
       WHERE order_no = ?`,   // keep this as order_no because sales table links to orders.id
      [id]
    );

    const status =
      totals.wt >= (order.ordered_weight_kg || 0)
        ? "Fulfilled"
        : totals.wt > 0
        ? "Partial"
        : "Pending";

    run(
      `UPDATE orders
         SET fulfilled_qty_pcs = ?,
             fulfilled_weight_kg = ?,
             remaining_weight_kg = ?,
             status = ?,
             updated_at = datetime('now')
       WHERE id = ?`,    // 🔑 use id here
      [
        totals.qty,
        totals.wt,
        Math.max(0, (order.ordered_weight_kg || 0) - totals.wt),
        status,
        id,
      ]
    );

    res.json({ ok: true, status, totals });
  } catch (e) {
    console.error("Failed to update order status", e);
    res.status(500).send("Error updating order");
  }
});


/* ---------------------------------- Coils --------------------------------- */
// RN: plain 4-digit, zero-padded sequence "0001, 0002, ..."
function nextRN() {
  // find last purely numeric RN
  const row = get(`SELECT rn FROM coils WHERE rn GLOB '[0-9]*' ORDER BY CAST(rn AS INTEGER) DESC LIMIT 1`);
  const last = row ? parseInt(row.rn, 10) : 0;
  return String(last + 1).padStart(4, '0');
}

function coilSummaryRow(coilId) {
  const coil = get(`SELECT * FROM coils WHERE id=?`, [coilId]);
  if (!coil) return null;

  const purchased_kg = coil.purchase_weight_kg || 0;

  // Direct Sold
  const direct = get(`
    SELECT IFNULL(SUM(sold_weight_kg),0) AS w
    FROM coil_direct_sales
    WHERE coil_id = ?
  `, [coilId])?.w || 0;

  // Circles, Patta, PL, Scrap from circle_runs
  const cuts = get(`
    SELECT 
      IFNULL(SUM(circle_weight_kg),0) AS circles,
      IFNULL(SUM(patta_weight_kg),0)  AS patta,
      IFNULL(SUM(pl_weight_kg),0)     AS pl,
      IFNULL(SUM(scrap_weight_kg),0)  AS scrap
    FROM circle_runs
    WHERE coil_id = ?
  `, [coilId]);

  // Balance = Purchased – (all above)
  const balance = purchased_kg
                - direct
                - (cuts.circles || 0)
                - (cuts.patta || 0)
                - (cuts.pl || 0)
                - (cuts.scrap || 0);

  return {
    id: coil.id,
    rn: coil.rn,
    grade: coil.grade,
    thickness: coil.thickness,
    width: coil.width,
    supplier: coil.supplier,
    purchase_date: coil.purchase_date,
    purchase_price: coil.purchase_price ?? null,
    purchased_kg,
    direct_sold_kg: direct,
    circles_kg: cuts.circles || 0,
    patta_kg: cuts.patta || 0,
    pl_kg: cuts.pl || 0,
    scrap_kg: cuts.scrap || 0,
    balance_kg: balance,
  };
}

function coilSummaryRowStrict(coilId) {
  const coil = get(`SELECT * FROM coils WHERE id = ?`, [coilId]);
  if (!coil) return null;

  const purchased_kg = coil.purchase_weight_kg || 0;

  // Sales from Circle
  const circleSold = get(`
    SELECT IFNULL(SUM(s.sold_weight_kg),0) AS w
    FROM circle_sales_new s
    JOIN circle_stock cs ON cs.id = s.stock_id
    JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id=cr.id
    WHERE cr.coil_id = ?
  `, [coilId])?.w || 0;

  // Sales from PL
  const plSold = get(`
    SELECT IFNULL(SUM(ps.sold_weight_kg),0) AS w
    FROM pl_sales ps
    JOIN pl_stock pls ON ps.pl_stock_id = pls.id
    JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id=cr.id
    WHERE cr.coil_id = ?
  `, [coilId])?.w || 0;

  // Scrap sales (using rn)
  const scrapSold = get(`
    SELECT IFNULL(SUM(weight_kg),0) AS w
    FROM scrap_sales
    WHERE rn = ?
  `, [coil.rn])?.w || 0;

  // Direct coil sales
  const directSold = get(`
    SELECT IFNULL(SUM(sold_weight_kg),0) AS w
    FROM coil_direct_sales
    WHERE coil_id = ?
  `, [coilId])?.w || 0;

  // ✅ Balance = Purchase – (all sales)
  const totalSold = circleSold + plSold + scrapSold + directSold;
  const balance_kg = purchased_kg - totalSold;

  return {
    id: coil.id,
    rn: coil.rn,
    purchase_price: coil.purchase_price || 0,
    purchased_kg,
    balance_kg
  };
}

// Create coil purchase (supports purchase_price ₹/kg)
app.post('/api/coils/purchase', auth(), (req, res) => {
  try {
    const {
      rn,
      grade,
      thickness,
      width,
      supplier,
      purchase_weight_kg,
      purchase_date,
      purchase_price: purchase_price_snake,
      purchasePrice
    } = req.body;

    // Normalize price input
    const normalizedPrice = purchase_price_snake ?? purchasePrice;
    const priceVal =
      (normalizedPrice === undefined || normalizedPrice === '')
        ? null
        : Number(normalizedPrice);

    if (!purchase_weight_kg || purchase_weight_kg <= 0) {
      return res.status(400).json({ error: 'purchase_weight_kg must be > 0' });
    }

// Prevent duplicate RN
if (rn) {
  const existing = get(`SELECT id FROM coils WHERE rn = ?`, [rn]);
  if (existing) {
    return res.status(400).json({ error: `S.No. ${rn} already exists` });
  }
}

    const today = new Date().toISOString().slice(0, 10);

    // Insert into coils
    const info = run(
      `INSERT INTO coils(
         rn, grade, thickness, width, supplier,
         purchase_weight_kg, purchase_date, purchase_price
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        rn || null,
        grade || null,
        thickness || null,
        width || null,
        supplier || null,
        Number(purchase_weight_kg),
        purchase_date || today,
        priceVal
      ]
    );

    const newCoil = get(`SELECT * FROM coils WHERE id=?`, [info.lastInsertRowid]);

    // ✅ Single insert into coil_stock
    run(
      `INSERT INTO coil_stock(
         coil_id, rn, grade, thickness, width, supplier, purchase_date,
         initial_weight_kg, available_weight_kg, purchase_price, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
      [
        newCoil.id,
        newCoil.rn,
        newCoil.grade || null,
        newCoil.thickness || null,
        newCoil.width || null,
        newCoil.supplier || null,
        newCoil.purchase_date || today,
        newCoil.purchase_weight_kg,
        newCoil.purchase_weight_kg,
        priceVal
      ]
    );

    res.json(newCoil);
  } catch (err) {
    console.error("❌ Coil purchase failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Parse Excel/Indian style dates safely
function parseDate(value) {
  if (!value) return null;

  // Case 1: Already a JS Date
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10); // yyyy-mm-dd
  }

  // Case 2: Excel serial number (e.g., 45678)
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000)); 
    return date.toISOString().slice(0, 10);
  }

  // Case 3: String like "13-08-2025"
  if (typeof value === "string" && /^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [day, month, year] = value.split("-");
    return `${year}-${month}-${day}`; // convert to yyyy-mm-dd
  }

  // Fallback: try normal Date parsing
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// Bulk Import Coils from Excel
app.post("/api/coils/import", auth("admin"), upload.single("file"), (req, res) => {
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const insert = db.prepare(`
      INSERT INTO coils (rn, grade, thickness, width, supplier, purchase_date, purchase_weight_kg, purchase_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStock = db.prepare(`
      INSERT INTO coil_stock (coil_id, rn, grade, thickness, width, supplier, purchase_date, initial_weight_kg, available_weight_kg, purchase_price, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    let inserted = 0;
    let skipped = 0;
    let skippedRNs = [];

    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        // Skip blank/invalid rows
        if (!r["RN"] || !r["Purchase Weight (kg)"]) continue;

const rnVal = String(r["RN"]).trim();

// Prevent duplicates (RN must be unique)
const existing = get(`SELECT id FROM coils WHERE rn = ?`, [rnVal]);
if (existing) {
  skipped++;
  skippedRNs.push(rnVal);
  continue;
}

const purchaseDate = parseDate(r["Purchase Date"]);

const info = insert.run(
  rnVal,
  r["Grade"],
  r["Thickness (mm)"],
  r["Width (mm)"],
  r["Supplier"],
  purchaseDate,
  r["Purchase Weight (kg)"],
  r["Purchase Price (₹/kg)"] || 0
);

insertStock.run(
  info.lastInsertRowid,
  rnVal,
  r["Grade"],
  r["Thickness (mm)"],
  r["Width (mm)"],
  r["Supplier"],
  purchaseDate,
  r["Purchase Weight (kg)"],
  r["Purchase Weight (kg)"],
  r["Purchase Price (₹/kg)"] || 0
);

        inserted++;
      }
    });

    insertMany(rows);

    // cleanup uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      message: "✅ Coil import completed",
      inserted,
      skipped,
      skippedRNs,
      total: rows.length
    });
  } catch (err) {
    console.error("❌ Import error:", err.message);
    res.status(500).json({ error: "Failed to import coils" });
  }
});

// Bulk Import Orders from Excel
app.post("/api/orders/import", auth("admin"), upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);
    if (!rows.length) return res.status(400).json({ error: "No rows found in worksheet" });

    const insert = db.prepare(`
      INSERT INTO orders (
        order_date, order_by, company, grade, thickness_mm, op_size_mm,
        ordered_qty_pcs, ordered_weight_kg, remarks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `);

    const isBlank = (v) =>
      v === undefined || v === null || (typeof v === "string" && v.trim() === "");

    const dashToNull = (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === "" || s === "-" ? null : s;
    };

    const numOrNull = (v) => {
      const s = dashToNull(v);
      if (s === null) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    const insertMany = db.transaction((rows) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const orderDate = parseDate(r["Order Date"]); // supports 8/30/2025 etc.
        const orderBy   = dashToNull(r["Order By"]);
        const company   = dashToNull(r["Company"]);
        const grade     = dashToNull(r["Grade"]);
        const thickness = numOrNull(r["Thickness (mm)"]);
        const opSize    = numOrNull(r["Op. Size (mm)"]);
        const orderedPcs= numOrNull(r["Ordered Pcs"]);          // "—" or "-" -> null
        const orderedWt = numOrNull(r["Ordered Weight (kg)"]);  // "—" or "-" -> null
        const remarks   = dashToNull(r["Remarks"]);

        const rowErrors = [];
        if (!orderDate) rowErrors.push("Invalid/blank Order Date");
        if (!company) rowErrors.push("Company required");
        if (!grade) rowErrors.push("Grade required");
        if (thickness === null) rowErrors.push("Thickness (mm) required/invalid");
        if (opSize === null) rowErrors.push("Op. Size (mm) required/invalid");
        if (orderedPcs == null && orderedWt == null) {
          rowErrors.push("Either Ordered Pcs or Ordered Weight (kg) required");
        }

        if (rowErrors.length) {
          skipped++;
          errors.push({ line: i + 2, issues: rowErrors }); // +2 for header row
          continue;
        }

        insert.run(
          orderDate,
          orderBy,
          company,
          grade,
          thickness,
          opSize,
          orderedPcs,
          orderedWt,
          remarks
        );
        inserted++;
      }
    });

    insertMany(rows);

    try { fs.unlinkSync(req.file.path); } catch {}

    return res.json({
      message: "✅ Orders import completed",
      inserted,
      skipped,
      errors,
      total: rows.length,
    });
  } catch (err) {
    console.error("❌ Orders import error:", err);
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ error: err.message || "Failed to import orders" });
  }
});

// List coils
app.get('/api/coils', auth(), (req, res) => {
  const { q, limit = 200, grade, operator } = req.query;
  let sql = `SELECT DISTINCT coils.* FROM coils`;
  const where = [], p = [];
  if (operator) {
    sql += ` LEFT JOIN circle_runs cr ON cr.coil_id = coils.id`;
    where.push(`cr.operator = ?`);
    p.push(operator);
  }
  if (q) { where.push(`(coils.rn LIKE ? OR coils.supplier LIKE ?)`); p.push(`%${q}%`, `%${q}%`); }
  if (grade) { where.push(`coils.grade = ?`); p.push(grade); }
  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` ORDER BY coils.created_at DESC LIMIT ?`;
  p.push(Number(limit));
  const base = all(sql, p);
  res.json(base.map(r => coilSummaryRow(r.id)));
});

// Bulk delete coils
app.post('/api/coils/bulk-delete', auth("admin"), (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: "No coil IDs provided" });
  }

  try {
    const bulkDelete = db.transaction((ids) => {
      const placeholders = ids.map(() => '?').join(',');
      // delete stock first, then coils
      run(`DELETE FROM coil_stock WHERE coil_id IN (${placeholders})`, ids);
      run(`DELETE FROM coils WHERE id IN (${placeholders})`, ids);
    });

    bulkDelete(ids);

    res.json({
      ok: true,
      deleted: ids.length,
      ids
    });
  } catch (err) {
    console.error("❌ Bulk delete failed:", err.message);
    res.status(500).json({ error: "Failed to delete coils" });
  }
});


// Get coil summary
app.get('/api/coils/:id/summary', auth(), (req, res) => {
  const s = coilSummaryRow(req.params.id);
  if (!s) return res.status(404).json({ error: 'Coil not found' });
  res.json(s);
});

// Edit coil (sync coil_stock and propagate changes)
app.patch('/api/coils/:id', auth('admin'), (req, res) => {
  const allowed = [
    'rn', 'grade', 'thickness', 'width',
    'supplier', 'purchase_weight_kg',
    'purchase_date', 'purchase_price'
  ];
  const fields = [], p = [];
  const before = get(`SELECT * FROM coils WHERE id=?`, [req.params.id]);
  if (!before) return res.status(404).json({ error: 'Coil not found' });

  for (const k of allowed) {
    if (k in req.body) {
      fields.push(`${k}=?`);
      p.push(req.body[k]);
    }
  }
  if (!fields.length) return res.json(coilSummaryRow(before.id));
  p.push(req.params.id);

  // Update coils table
  run(`UPDATE coils SET ${fields.join(', ')} WHERE id=?`, p);
  const after = get(`SELECT * FROM coils WHERE id=?`, [req.params.id]);

  // ✅ Sync coil_stock
  const cs = get(`SELECT * FROM coil_stock WHERE coil_id=?`, [after.id]);
  if (cs) {
    let available = cs.available_weight_kg;
    let initial = cs.initial_weight_kg;

    if ('purchase_weight_kg' in req.body && req.body.purchase_weight_kg != null) {
      const newInitial = Number(req.body.purchase_weight_kg);
      const delta = newInitial - initial;
      initial = newInitial;
      available = Math.max(0, available + delta);
    }

    run(`
      UPDATE coil_stock
      SET rn=?, grade=?, thickness=?, width=?, supplier=?, purchase_date=?,
          initial_weight_kg=?, available_weight_kg=?, purchase_price=?, updated_at=datetime('now')
      WHERE coil_id=?`,
      [
        after.rn, after.grade || null, after.thickness || null, after.width || null,
        after.supplier || null, after.purchase_date || null,
        initial, available, (after.purchase_price ?? null), after.id
      ]
    );
  }

  // ✅ Sync circle_runs (grade, thickness, width)
run(`
  UPDATE circle_runs
  SET grade = ?,
      thickness = ?,
      width = ?
  WHERE coil_id = ?
`, [after.grade, after.thickness, after.width, after.id]);

// ✅ Sync patta_runs directly linked to this coil (through circle_runs)
run(`
  UPDATE patta_runs
  SET grade = ?,
      thickness = ?,
      width = ?
  WHERE source_type = 'circle'
    AND patta_source_id IN (
      SELECT id FROM circle_runs WHERE coil_id = ?
    )
`, [after.grade, after.thickness, after.width, after.id]);

// ✅ Cascade one more level: patta derived from patta
run(`
  UPDATE patta_runs
  SET grade = ?,
      thickness = ?,
      width = ?
  WHERE source_type = 'patta'
    AND patta_source_id IN (
      SELECT id FROM patta_runs
      WHERE source_type = 'circle'
        AND patta_source_id IN (SELECT id FROM circle_runs WHERE coil_id = ?)
    )
`, [after.grade, after.thickness, after.width, after.id]);

  // ✅ Sync circle_stock (grade, thickness, width)
  run(`
    UPDATE circle_stock
    SET grade=?, size_mm=?, updated_at=datetime('now')
    WHERE source_type='circle'
      AND source_id IN (SELECT id FROM circle_runs WHERE coil_id=?)`,
    [after.grade || null, after.width || null, after.id]
  );

  // ✅ Return same shape as /coils/:id/summary
  res.json(coilSummaryRow(after.id));
});

// Direct sell from coil (reduces coil_stock)
app.post('/api/coils/:id/sell-direct', auth(), (req, res) => {
  const { sold_weight_kg, buyer, price_per_kg, sale_date } = req.body;
  if (!sold_weight_kg || sold_weight_kg <= 0) return res.status(400).json({ error: 'sold_weight_kg must be > 0' });
  const coil = get(`SELECT * FROM coils WHERE id=?`, [req.params.id]);
  if (!coil) return res.status(404).json({ error: 'Coil not found' });

  const info = run(
  `INSERT INTO coil_direct_sales(coil_id,sold_weight_kg,buyer,price_per_kg,sale_date) VALUES (?,?,?,?,?)`,
  [req.params.id, Number(sold_weight_kg), buyer || null, price_per_kg ?? null, sale_date || new Date().toISOString().slice(0,10)]
);

  // reduce coil_stock
  const cs = get(`SELECT * FROM coil_stock WHERE coil_id=?`, [req.params.id]);
  if (cs) {
    run(`UPDATE coil_stock SET available_weight_kg = MAX(0, available_weight_kg - ?), updated_at=datetime('now') WHERE coil_id=?`,
      [Number(sold_weight_kg), req.params.id]);
  }

  res.json(get(`SELECT * FROM coil_direct_sales WHERE id=?`, [info.lastInsertRowid]));
});

// List all coil direct sales
app.get('/api/coil-direct-sales', auth(), (req, res) => {
  const sql = `SELECT s.*, c.rn, c.grade, c.thickness, c.width FROM coil_direct_sales s JOIN coils c ON s.coil_id = c.id ORDER BY s.created_at DESC`;
  res.json(all(sql));
});

// Delete a coil direct sale (undo sale)
app.delete('/api/coil-direct-sales/:id', auth('admin'), (req, res) => {
  const { id } = req.params;
  const sale = get(`SELECT * FROM coil_direct_sales WHERE id=?`, [id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  try {
    db.transaction(() => {
      // remove the sale record
      run(`DELETE FROM coil_direct_sales WHERE id=?`, [id]);
      // restore available coil stock
      run(`UPDATE coil_stock
           SET available_weight_kg = available_weight_kg + ?, updated_at=datetime('now')
           WHERE coil_id = ?`,
        [sale.sold_weight_kg, sale.coil_id]
      );
    })();

    res.json({ ok: true });
  } catch (e) {
    console.error('Error undoing coil sale:', e);
    res.status(500).json({ error: 'Failed to undo coil sale' });
  }
});

// ---- Helper: recompute all order fulfilments from truth ----
function recomputeAllOrders() {
  const orders = all(`SELECT id FROM orders`);
  for (const o of orders) {
    const fulfilled = get(
      `SELECT IFNULL(SUM(sold_weight_kg), 0) AS sum_wt
       FROM circle_sales_new
       WHERE order_no = ?`,
      [o.id]
    )?.sum_wt || 0;

    run(
      `UPDATE orders
       SET fulfilled_weight_kg = ?
       WHERE id = ?`,
      [fulfilled, o.id]
    );
  }
}

// ---- Helper: sweep any orphaned rows left after deletes ----
function cleanupOrphans() {
  run(`
    DELETE FROM circle_stock
    WHERE (source_type='circle' AND source_id NOT IN (SELECT id FROM circle_runs))
       OR (source_type='patta'  AND source_id NOT IN (SELECT id FROM patta_runs))
       OR (source_type='pl'     AND source_id NOT IN (SELECT id FROM pl_runs))
  `);

  run(`
    DELETE FROM pl_stock
    WHERE (source_type='circle' AND source_id NOT IN (SELECT id FROM circle_runs))
       OR (source_type='patta'  AND source_id NOT IN (SELECT id FROM patta_runs))
       OR (source_type='pl'     AND source_id NOT IN (SELECT id FROM pl_runs))
  `);

  run(`DELETE FROM circle_sales_new WHERE stock_id   NOT IN (SELECT id FROM circle_stock)`);
  run(`DELETE FROM pl_sales        WHERE pl_stock_id NOT IN (SELECT id FROM pl_stock)`);

  run(`DELETE FROM patta_runs WHERE source_type='patta' AND patta_source_id NOT IN (SELECT id FROM patta_runs)`);
}

// ---- Delete a coil everywhere ----
app.delete('/api/coils/:id', auth('admin'), (req, res) => {
  const coilId = Number(req.params.id);

  try {
    db.transaction(() => {
      // 1) find all circle runs of this coil
      const circleIds = all(`SELECT id FROM circle_runs WHERE coil_id=?`, [coilId]).map(r => r.id);

      // 2) patta directly from those circle runs
      const patta1 = all(
        `SELECT id FROM patta_runs WHERE source_type='circle' AND patta_source_id IN (${circleIds.length ? circleIds.map(()=>'?').join(',') : 'NULL'})`,
        circleIds
      ).map(r => r.id);

      // 3) patta from patta
      const patta2 = patta1.length ? all(
        `SELECT id FROM patta_runs WHERE source_type='patta' AND patta_source_id IN (${patta1.map(()=>'?').join(',')})`,
        patta1
      ).map(r => r.id) : [];

      // 4) delete stocks tied to those sources
      if (circleIds.length) {
        run(`DELETE FROM circle_stock WHERE source_type='circle' AND source_id IN (${circleIds.map(()=>'?').join(',')})`, circleIds);
        run(`DELETE FROM pl_stock     WHERE source_type='circle' AND source_id IN (${circleIds.map(()=>'?').join(',')})`, circleIds);
      }
      if (patta1.length) {
        run(`DELETE FROM circle_stock WHERE source_type='patta' AND source_id IN (${patta1.map(()=>'?').join(',')})`, patta1);
        run(`DELETE FROM pl_stock     WHERE source_type='patta'  AND source_id IN (${patta1.map(()=>'?').join(',')})`, patta1);
      }
      if (patta2.length) {
        run(`DELETE FROM circle_stock WHERE source_type='patta' AND source_id IN (${patta2.map(()=>'?').join(',')})`, patta2);
        run(`DELETE FROM pl_stock     WHERE source_type='patta' AND source_id IN (${patta2.map(()=>'?').join(',')})`, patta2);
      }

      // 5) delete PL runs that came from those sources
      if (circleIds.length) {
        run(`DELETE FROM pl_runs WHERE source_type='circle' AND pl_source_id IN (${circleIds.map(()=>'?').join(',')})`, circleIds);
      }
      if (patta1.length) {
        run(`DELETE FROM pl_runs WHERE source_type='pl' AND pl_source_id IN (${patta1.map(()=>'?').join(',')})`, patta1);
      }

      // 6) delete sales that referenced now-removed stock
      run(`DELETE FROM circle_sales_new WHERE stock_id NOT IN (SELECT id FROM circle_stock)`);
      run(`DELETE FROM pl_sales        WHERE pl_stock_id NOT IN (SELECT id FROM pl_stock)`);

      // 7) delete the runs themselves
      if (patta2.length) run(`DELETE FROM patta_runs WHERE id IN (${patta2.map(()=>'?').join(',')})`, patta2);
      if (patta1.length) run(`DELETE FROM patta_runs WHERE id IN (${patta1.map(()=>'?').join(',')})`, patta1);
      if (circleIds.length) run(`DELETE FROM circle_runs WHERE id IN (${circleIds.map(()=>'?').join(',')})`, circleIds);

      // 8) direct coil data
      run(`DELETE FROM coil_direct_sales WHERE coil_id=?`, [coilId]);
      run(`DELETE FROM coil_scrap        WHERE coil_id=?`, [coilId]);
      run(`DELETE FROM coil_stock        WHERE coil_id=?`, [coilId]); // mirror row
      run(`DELETE FROM coils             WHERE id=?`, [coilId]);

      // 9) cleanup
      cleanupOrphans();

      // 🔄 10) recompute all orders so Planning tab stays accurate
      recomputeAllOrders();
    })();

    res.json({ ok: true });
  } catch (e) {
    console.error('Delete coil failed:', e);
    res.status(500).json({ error: 'Failed to delete coil fully' });
  }
});


/* ------------------------------ Circle Runs ------------------------------- */
app.post('/api/circle-runs', auth(), (req, res) => {
  const { coil_id, run_date, operator } = req.body;
  if (!coil_id) return res.status(400).json({ error: 'coil_id is required' });
  const coil = get(`SELECT * FROM coils WHERE id=?`, [coil_id]);
  if (!coil) return res.status(404).json({ error: 'Coil not found' });

// How much already cut in previous runs
const cutSum = get(`SELECT IFNULL(SUM(net_weight_kg),0) AS total_cut FROM circle_runs WHERE coil_id=?`, [coil_id]);
const alreadyCut = cutSum?.total_cut || 0;

// How much this new run plans to cut
const newCut = Number(req.body.net_weight_kg || 0);

// Check limit
if (alreadyCut + newCut > coil.purchase_weight_kg) {
  return res.status(400).json({ error: 'Cutting exceeds available coil weight. Please check balance.' });
}

  const info = run(
  `INSERT INTO circle_runs(coil_id,run_date,operator,grade,thickness,width,net_weight_kg)
   VALUES (?,?,?,?,?,?,?)`,
  [
    coil_id,
    run_date || new Date().toISOString().slice(0, 10),
    operator || null,
    coil.grade || null,
    coil.thickness || null,
    coil.width || null,
    newCut
  ]
);
  res.json(get(`SELECT * FROM circle_runs WHERE id=?`, [info.lastInsertRowid]));
});

// Bulk start circle runs for multiple coils
app.post('/api/circle-runs/bulk-start', auth(), (req, res) => {
  try {
    const { coil_ids, operator, run_date } = req.body || {};
    if (!Array.isArray(coil_ids) || coil_ids.length === 0) {
      return res.status(400).json({ error: 'coil_ids (array) is required' });
    }
    if (!operator) {
      return res.status(400).json({ error: 'operator is required' });
    }

    const dateStr = (run_date && String(run_date).trim())
      ? String(run_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const checkExists = db.prepare(`
      SELECT id FROM circle_runs
      WHERE coil_id = ? AND date(run_date) = date(?)
    `);

    const insertRun = db.prepare(`
      INSERT INTO circle_runs (coil_id, operator, run_date, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);

    const results = { started: 0, skipped: 0, created_ids: [], skipped_ids: [] };

    const tx = db.transaction((ids) => {
      for (const coilId of ids) {
        const exists = checkExists.get(coilId, dateStr);
        if (exists) {
          results.skipped++;
          results.skipped_ids.push(coilId);
          continue;
        }
        const info = insertRun.run(coilId, operator, dateStr);
        results.started++;
        results.created_ids.push(info.lastInsertRowid);
      }
    });

    tx(coil_ids);
    res.json({
      ok: true,
      ...results,
      first_run_id: results.created_ids[0] ?? null
    });
  } catch (e) {
    console.error('Bulk start error:', e);
    res.status(500).json({ error: 'Failed to bulk start circle runs' });
  }
});

// List Circle runs (show coil's current grade; no cr.balance_kg)
app.get('/api/circle-runs', auth(), (req, res) => {
  const { from, to, q, operator } = req.query;

  let sql = `
    SELECT
      cr.id, cr.run_date, cr.coil_id, cr.operator,
      COALESCE(coils.grade, cr.grade) AS grade,   -- prefer coil grade
      cr.thickness, cr.width, cr.net_weight_kg, cr.op_size_mm,
      cr.circle_weight_kg, cr.qty, cr.scrap_weight_kg,
      cr.patta_size, cr.patta_weight_kg, cr.pl_size, cr.pl_weight_kg,
      coils.rn
    FROM circle_runs cr
    JOIN coils ON coils.id = cr.coil_id
  `;

  const where = [], p = [];
  if (from)     { where.push(`cr.run_date >= ?`); p.push(from); }
  if (to)       { where.push(`cr.run_date <= ?`); p.push(to); }
  if (operator) { where.push(`cr.operator = ?`);  p.push(operator); }
  if (q) {
    where.push(`(coils.rn LIKE ? OR COALESCE(coils.grade, cr.grade) LIKE ?)`);
    p.push(`%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` ORDER BY cr.run_date DESC, cr.id DESC`;

  res.json(all(sql, p));
});


// update circle run — also adjust: circle_stock and coil_stock
app.patch('/api/circle-runs/:id', auth(), (req, res) => {
  const allowed = [
    'run_date', 'operator', 'net_weight_kg', 'op_size_mm', 'circle_weight_kg',
    'qty', 'scrap_weight_kg', 'patta_size', 'patta_weight_kg', 'pl_size', 'pl_weight_kg'
  ];

  const before = get(`SELECT * FROM circle_runs WHERE id=?`, [req.params.id]);
  if (!before) return res.status(404).json({ error: 'Circle run not found' });

  // ---- Prevent exceeding coil purchase weight ----
  if ('net_weight_kg' in req.body) {
    const coil = get(`SELECT * FROM coils WHERE id=?`, [before.coil_id]);
    if (coil) {
      const cutSum = get(`SELECT IFNULL(SUM(net_weight_kg),0) AS total_cut FROM circle_runs WHERE coil_id=?`, [before.coil_id]);
      const alreadyCut = cutSum?.total_cut || 0;
      const prevNet = Number(before.net_weight_kg || 0);
      const newNet = Number(req.body.net_weight_kg || 0);
      const adjustedTotal = alreadyCut - prevNet + newNet;

      if (adjustedTotal > coil.purchase_weight_kg) {
        return res.status(400).json({ error: 'Cutting exceeds available coil weight. Please check balance.' });
      }
    }
  }

  const fields = [], p = [];
  for (const key of allowed) if (key in req.body) { fields.push(`${key}=?`); p.push(req.body[key]); }
  if (!fields.length) return res.json(before);
  p.push(req.params.id);

  run(`UPDATE circle_runs SET ${fields.join(', ')} WHERE id=?`, p);

  // After update
  const circleRun = get(`SELECT * FROM circle_runs WHERE id=?`, [req.params.id]);

  // --- Auto-update circle stock (source_type='circle') ---
  if (circleRun && circleRun.circle_weight_kg && circleRun.qty) {
    run(`DELETE FROM circle_stock WHERE source_type='circle' AND source_id=?`, [req.params.id]);
    run(`INSERT INTO circle_stock(source_type, source_id, size_mm, weight_kg, qty, production_date, operator)
         VALUES (?,?,?,?,?,?,?)`,
      ['circle', req.params.id, circleRun.op_size_mm, circleRun.circle_weight_kg, circleRun.qty, circleRun.run_date, circleRun.operator]
    );
  } else {
    run(`DELETE FROM circle_stock WHERE source_type='circle' AND source_id=?`, [req.params.id]);
  }

  // --- Adjust coil_stock by net_weight_kg delta ---
  const prevNet = Number(before.net_weight_kg || 0);
  const newNet = Number(circleRun.net_weight_kg || 0);
  const delta = newNet - prevNet; // positive => more coil used
  if (delta !== 0) {
    const cs = get(`SELECT * FROM coil_stock WHERE coil_id=?`, [before.coil_id]);
    if (cs) {
      run(`UPDATE coil_stock SET available_weight_kg = MAX(0, available_weight_kg - ?), updated_at=datetime('now') WHERE coil_id=?`,
        [delta, before.coil_id]);
    }
  }

// --- Manual PL output from a circle run (no auto <100 rule) ---
run(`DELETE FROM pl_stock WHERE source_type='circle' AND source_id=?`, [req.params.id]);

if (circleRun && Number(circleRun.pl_weight_kg) > 0) {
  run(
    `INSERT OR REPLACE INTO pl_stock
       (source_type, source_id, grade, size_mm, weight_kg, qty, production_date, operator)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      'circle',
      circleRun.id,
      circleRun.grade || null,
      circleRun.pl_size != null && circleRun.pl_size !== '' ? Number(circleRun.pl_size) : null,
      Number(circleRun.pl_weight_kg) || 0,
      0, // pcs not tracked here
      circleRun.run_date || new Date().toISOString().slice(0,10),
      circleRun.operator || null
    ]
  );
}

// --- Handle Patta output (independent of PL) ---
if (circleRun && circleRun.patta_size && circleRun.patta_weight_kg) {
  const existing = get(`SELECT * FROM patta_runs WHERE patta_source_id=?`, [req.params.id]);
  if (existing) {
    run(
      `UPDATE patta_runs
         SET run_date=?,
             operator=?,
             net_weight_kg=?,
             patta_size=?,
             grade=COALESCE(?, grade)
       WHERE patta_source_id=?`,
      [
        circleRun.run_date,
        circleRun.operator,
        Number(circleRun.patta_weight_kg) || 0,
        Number(circleRun.patta_size) || null,
        circleRun.grade || null,
        req.params.id
      ]
    );
  } else {
    run(
      `INSERT INTO patta_runs
         (patta_source_id, source_type, run_date, operator,
          net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg,
          patta_size, grade)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        req.params.id, 'circle', circleRun.run_date, circleRun.operator,
        Number(circleRun.patta_weight_kg) || 0,
        null, null, 0, null,
        Number(circleRun.patta_size) || null,
        circleRun.grade || null
      ]
    );
  }
} else {
  // Patta cleared
  run(`DELETE FROM patta_runs WHERE patta_source_id=?`, [req.params.id]);
}

res.json(circleRun);
});

app.delete('/api/circle-runs/:id', auth('admin'), (req, res) => {
  const row = get(`SELECT * FROM circle_runs WHERE id=?`, [req.params.id]);
  if (row) {
    const restore = Number(row.net_weight_kg || 0);
    if (restore > 0) {
      run(`UPDATE coil_stock SET available_weight_kg = available_weight_kg + ?, updated_at=datetime('now') WHERE coil_id=?`,
        [restore, row.coil_id]);
    }
  }
  run(`DELETE FROM circle_runs WHERE id=?`, [req.params.id]);
  run(`DELETE FROM circle_stock WHERE source_type='circle' AND source_id=?`, [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------ PL Runs ------------------------------- */
// New table for PL runs (like patta but for <100mm size)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pl_source_id INTEGER NOT NULL,
      source_type TEXT NOT NULL, -- 'circle' or 'pl'
      run_date TEXT,
      operator TEXT,
      net_weight_kg REAL,
      op_size_mm REAL,
      circle_weight_kg REAL,
      qty INTEGER,
      scrap_weight_kg REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch {}

// Add new PL run
app.post('/api/pl-runs', auth(), (req, res) => {
  const { pl_source_id, source_type, run_date, operator, net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg } = req.body;
  if (!pl_source_id || !source_type) return res.status(400).json({ error: 'pl_source_id and source_type required' });

  const info = run(
    `INSERT INTO pl_runs(pl_source_id, source_type, run_date, operator, net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [pl_source_id, source_type, run_date || new Date().toISOString().slice(0, 10), operator, net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg]
  );

const newId = info.lastInsertRowid;

// ✅ NEW: also insert into pl_stock
run(
  `INSERT OR REPLACE INTO pl_stock
     (source_type, source_id, grade, size_mm, weight_kg, qty, production_date, operator)
   VALUES (?,?,?,?,?,?,?,?)`,
  [source_type, newId, null, op_size_mm,
   circle_weight_kg || 0, qty || 0, run_date || new Date().toISOString().slice(0,10), operator]
);

  // Auto-add to circle stock if circles produced (source_type='pl')
  if (circle_weight_kg && qty) {
    run(`INSERT INTO circle_stock(source_type, source_id, size_mm, weight_kg, qty, production_date, operator)
         VALUES (?,?,?,?,?,?,?)`,
      ['pl', info.lastInsertRowid, op_size_mm, circle_weight_kg, qty, run_date || new Date().toISOString().slice(0, 10), operator]
    );
  }

  res.json(get(`SELECT * FROM pl_runs WHERE id=?`, [info.lastInsertRowid]));
});

// List PL runs
app.get('/api/pl-runs', auth(), (req, res) => {
  const { from, to, q, operator } = req.query;
  let sql = `
    SELECT pl.*, 
           CASE 
             WHEN pl.source_type = 'circle' THEN c.rn
             WHEN pl.source_type = 'pl' THEN 'PL-' || pl.pl_source_id
           END as source_ref
    FROM pl_runs pl
    LEFT JOIN circle_runs cr ON pl.source_type = 'circle' AND pl.pl_source_id = cr.id
    LEFT JOIN coils c ON c.id = cr.coil_id
  `;
  const where = [], p = [];
  if (from) { where.push(`pl.run_date >= ?`); p.push(from); }
  if (to) { where.push(`pl.run_date <= ?`); p.push(to); }
  if (operator) { where.push(`pl.operator = ?`); p.push(operator); }
  if (q) { where.push(`(c.rn LIKE ? OR pl.operator LIKE ?)`); p.push(`%${q}%`, `%${q}%`); }
  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` ORDER BY pl.run_date DESC, pl.id DESC`;
  res.json(all(sql, p));
});

// Edit PL run
app.patch('/api/pl-runs/:id', auth(), (req, res) => {
  const allowed = [
    'run_date', 'operator', 'net_weight_kg', 'op_size_mm', 'circle_weight_kg',
    'qty', 'scrap_weight_kg'
  ];
  const fields = [], p = [];
  for (const key of allowed) if (key in req.body) { fields.push(`${key}=?`); p.push(req.body[key]); }
  if (!fields.length) return res.json({ ok: true });
  p.push(req.params.id);

  run(`UPDATE pl_runs SET ${fields.join(', ')} WHERE id=?`, p);

  // Auto-update stock entry (source_type='pl')
  const plRun = get(`SELECT * FROM pl_runs WHERE id=?`, [req.params.id]);
  if (plRun) {
// ✅ NEW: update pl_stock
    run(`INSERT OR REPLACE INTO pl_stock
         (source_type, source_id, grade, size_mm, weight_kg, qty, production_date, operator)
         VALUES (?,?,?,?,?,?,?,?)`,
        [plRun.source_type, plRun.id, null, plRun.op_size_mm, plRun.circle_weight_kg || 0, plRun.qty || 0, plRun.run_date, plRun.operator]);

// Existing circle_stock update (keep as is)
    run(`DELETE FROM circle_stock WHERE source_type='pl' AND source_id=?`, [req.params.id]);
    if (plRun.circle_weight_kg && plRun.qty) {
      run(`INSERT INTO circle_stock(source_type, source_id, size_mm, weight_kg, qty, production_date, operator)
           VALUES (?,?,?,?,?,?,?)`,
        ['pl', req.params.id, plRun.op_size_mm, plRun.circle_weight_kg, plRun.qty, plRun.run_date, plRun.operator]
      );
    }
  }

  res.json(get(`SELECT * FROM pl_runs WHERE id=?`, [req.params.id]));
});

// Delete PL run
app.delete('/api/pl-runs/:id', auth('admin'), (req, res) => {
  run(`DELETE FROM pl_runs WHERE id=?`, [req.params.id]);

  // NEW: also delete from pl_stock
  run(`DELETE FROM pl_stock WHERE source_type='pl' AND source_id=?`, [req.params.id]);

  // Existing: delete from circle_stock
  run(`DELETE FROM circle_stock WHERE source_type='pl' AND source_id=?`, [req.params.id]);

  res.json({ ok: true });
});

/* ------------------------------ Patta Runs ------------------------------- */
app.post('/api/patta-runs', auth(), (req, res) => {
  const {
    patta_source_id, source_type, run_date, operator,
    net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg,
    patta_size, grade
  } = req.body;

  if (!patta_source_id || !source_type) {
    return res.status(400).json({ error: 'patta_source_id and source_type required' });
  }

  const dateVal = run_date || new Date().toISOString().slice(0, 10);

  // 1) Save run (now storing patta_size & grade)
  const info = run(
    `INSERT INTO patta_runs
      (patta_source_id, source_type, run_date, operator,
       net_weight_kg, op_size_mm, circle_weight_kg, qty, scrap_weight_kg,
       patta_size, grade)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [patta_source_id, source_type, dateVal, operator,
     net_weight_kg, op_size_mm, circle_weight_kg, qty || 0, scrap_weight_kg,
     patta_size ?? null, grade || null]
  );
  const newId = info.lastInsertRowid;

  // 2) If grade missing, derive from origin chain
  if (!grade) {
    const g = get(`
      SELECT
        CASE
          WHEN ?='circle' THEN COALESCE(cr.grade, c.grade)
          WHEN ?='patta'  THEN COALESCE(cr2.grade, c2.grade, cr3.grade, c3.grade)
        END AS g
      FROM (SELECT 1)
      LEFT JOIN circle_runs cr ON ?='circle' AND ? = cr.id
      LEFT JOIN coils c        ON c.id = cr.coil_id
      LEFT JOIN patta_runs pr2 ON ?='patta'  AND ? = pr2.id
      LEFT JOIN circle_runs cr2 ON pr2.source_type='circle' AND pr2.patta_source_id = cr2.id
      LEFT JOIN coils c2        ON c2.id = cr2.coil_id
      LEFT JOIN patta_runs pr3  ON pr2.source_type='patta'  AND pr2.patta_source_id = pr3.id
      LEFT JOIN circle_runs cr3 ON pr3.source_type='circle' AND pr3.patta_source_id = cr3.id
      LEFT JOIN coils c3        ON c3.id = cr3.coil_id
    `, [source_type, source_type, source_type, patta_source_id, source_type, patta_source_id]);
    if (g?.g) run(`UPDATE patta_runs SET grade=? WHERE id=?`, [g.g, newId]);
  }

// 4) Circles output -> Circle Stock (now includes grade)
if (circle_weight_kg && Number(circle_weight_kg) > 0) {
run(
  `INSERT INTO circle_stock(source_type, source_id, size_mm, weight_kg, qty, production_date, operator)
   VALUES (?,?,?,?,?,?,?)`,
  ['patta', newId, op_size_mm, circle_weight_kg, qty || 0, dateVal, operator]
);
}

  res.json(get(`SELECT * FROM patta_runs WHERE id=?`, [newId]));
});


app.get('/api/patta-runs', auth(), (req, res) => {
  const { from, to, q, operator } = req.query;

  let sql = `
    SELECT 
      pr.id,
      pr.patta_source_id,
      pr.source_type,
      pr.run_date,
      pr.operator,
      pr.net_weight_kg,
      pr.op_size_mm,
      pr.circle_weight_kg,
      pr.qty,
      pr.scrap_weight_kg,
      pr.patta_size,

      -- ✅ Corrected grade resolution (source takes priority, fallback to pr.grade)
      CASE
        WHEN pr.source_type = 'circle' THEN COALESCE(cr.grade, c.grade, pr.grade)
        WHEN pr.source_type = 'patta'  THEN COALESCE(cr2.grade, c2.grade, cr3.grade, c3.grade, pr.grade)
        ELSE pr.grade
      END AS grade,

      CASE 
        WHEN pr.source_type = 'circle' THEN c.rn
        WHEN pr.source_type = 'patta'  THEN 'PATTA-' || pr.patta_source_id
      END AS source_ref,

      -- ✅ Thickness resolution (unchanged)
      CASE
        WHEN pr.source_type = 'circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN pr.source_type = 'patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
      END AS thickness_mm

    FROM patta_runs pr
    LEFT JOIN circle_runs cr  ON pr.source_type = 'circle' AND pr.patta_source_id = cr.id
    LEFT JOIN coils c         ON c.id = cr.coil_id

    LEFT JOIN circle_runs cr2 ON pr.source_type='patta' AND pr.patta_source_id = cr2.id
    LEFT JOIN coils c2        ON c2.id = cr2.coil_id

    LEFT JOIN patta_runs pr2  ON pr.source_type='patta' AND pr.patta_source_id = pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
    LEFT JOIN coils c3        ON c3.id = cr3.coil_id

    WHERE 1=1
  `;

  const where = [], p = [];
  if (from)     { where.push(`pr.run_date >= ?`); p.push(from); }
  if (to)       { where.push(`pr.run_date <= ?`); p.push(to); }
  if (operator) { where.push(`pr.operator = ?`);  p.push(operator); }
  if (q) {
  where.push(`(c.rn LIKE ? OR pr.operator LIKE ?)`);
  p.push(`%${q}%`, `%${q}%`);}

  if (where.length) sql += ` AND ` + where.join(' AND ');
  sql += ` ORDER BY pr.run_date DESC, pr.id DESC`;

  res.json(all(sql, p));
});


app.patch('/api/patta-runs/:id', auth(), (req, res) => {
  const allowed = [
    'run_date', 'operator', 'net_weight_kg', 'op_size_mm', 'circle_weight_kg',
    'qty', 'scrap_weight_kg', 'grade'
  ];
  const fields = [], p = [];
  for (const key of allowed) if (key in req.body) { fields.push(`${key}=?`); p.push(req.body[key]); }
  if (!fields.length) return res.json({ ok: true });
  p.push(req.params.id);

  run(`UPDATE patta_runs SET ${fields.join(', ')} WHERE id=?`, p);

  // Auto-update stock entry (source_type='patta')
  const pattaRun = get(`SELECT * FROM patta_runs WHERE id=?`, [req.params.id]);
  if (pattaRun) {
    run(`DELETE FROM circle_stock WHERE source_type='patta' AND source_id=?`, [req.params.id]);
if (Number(pattaRun.circle_weight_kg) > 0) {
  run(`INSERT INTO circle_stock(source_type, source_id, size_mm, weight_kg, qty, production_date, operator)
       VALUES (?,?,?,?,?,?,?)`,
['patta', req.params.id, pattaRun.op_size_mm,   // keep op_size_mm as circle size
 pattaRun.circle_weight_kg || 0, pattaRun.qty || 0, pattaRun.run_date, pattaRun.operator]
  );
}
  }

  res.json(get(`SELECT * FROM patta_runs WHERE id=?`, [req.params.id]));
});

app.delete('/api/patta-runs/:id', auth('admin'), (req, res) => {
  const { id } = req.params;

  try {
    db.transaction(() => {
      // delete the patta run itself
      run(`DELETE FROM patta_runs WHERE id=?`, [id]);

      // delete any circle stock created from this patta run
      run(`DELETE FROM circle_stock WHERE source_type='patta' AND source_id=?`, [id]);

      // ✅ also delete any PL stock that was auto-created from this patta run
      run(`DELETE FROM pl_stock WHERE source_type='patta' AND source_id=?`, [id]);
    })();

    res.json({ ok: true });
  } catch (e) {
    console.error('Error deleting patta run:', e);
    res.status(500).json({ error: 'Failed to delete patta run' });
  }
});

/* ------------------------------ Patta sources ----------------------------- */
// Used by Patta tab to populate "Select Patta Source" (auto-fetched)
// Pull patta produced in circle runs (patta_weight_kg > 0)
app.get('/api/patta', auth(), (_req, res) => {
  const rows = all(`
    SELECT cr.id AS source_id,
           'circle' AS source_type,
           c.rn AS rn,
           cr.patta_size,
           cr.patta_weight_kg
    FROM circle_runs cr
    JOIN coils c ON c.id = cr.coil_id
    WHERE cr.patta_weight_kg IS NOT NULL AND cr.patta_weight_kg > 0
    ORDER BY cr.run_date DESC, cr.id DESC
  `);
  res.json(rows);
});

/* --------------------------- Stock & Sales ------------------------------- */
// Coil Stock
app.get('/api/coil-stock', auth(), (req, res) => {
  const { q } = req.query;

  let sql = `SELECT * FROM coil_stock WHERE available_weight_kg > 0`;
  const where = [], p = [];

  if (q) {
    where.push(`(rn LIKE ? OR supplier LIKE ? OR grade LIKE ?)`);
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' AND ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  res.json(all(sql, p));
});


// Circle Stock
app.get('/api/circle-stock', auth(), (req, res) => {
  const { q } = req.query;

let sql = `
  SELECT 
    cs.*,
    cs.qty AS qty_pcs,  -- 👈 pieces alias

    CASE
      WHEN cs.source_type = 'circle' THEN c.rn
      WHEN cs.source_type = 'patta' THEN
        (CASE
          WHEN pr.source_type = 'circle' THEN c2.rn
          WHEN pr.source_type = 'patta' THEN 'PATTA-' || pr.patta_source_id
        END)
    END AS source_ref,

    /* grade resolution:
       - direct circle -> use cr.grade
       - patta -> try pr.grade, or circle (cr2), its coil (c2), one level deeper (cr3/c3)
    */
    CASE
      WHEN cs.source_type = 'circle' THEN cr.grade
      WHEN cs.source_type = 'patta' THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade)
    END AS grade,

    /* sales aggregates */
    IFNULL(SUM(csl.sold_qty), 0)       AS sold_qty,
    IFNULL(SUM(csl.sold_qty), 0)       AS sold_pcs,         -- 👈 pieces alias
    IFNULL(SUM(csl.sold_weight_kg), 0) AS sold_weight_kg,

    /* availability in pcs + kg */
    CASE 
      WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0 THEN 0 
      ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) 
    END AS available_qty,
    CASE 
      WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0 THEN 0 
      ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) 
    END AS available_pcs,                                   -- 👈 pieces alias
    CASE 
      WHEN (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) < 0 THEN 0 
      ELSE (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) 
    END AS available_weight_kg

  FROM circle_stock cs

  /* direct circle origin */
  LEFT JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id = cr.id
  LEFT JOIN coils c        ON c.id = cr.coil_id

  /* patta origin (first hop) */
  LEFT JOIN patta_runs pr  ON cs.source_type='patta' AND cs.source_id = pr.id
  LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
  LEFT JOIN coils c2        ON c2.id = cr2.coil_id

  /* patta -> patta -> circle (second hop) */
  LEFT JOIN patta_runs pr2 ON pr.source_type='patta' AND pr.patta_source_id = pr2.id
  LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
  LEFT JOIN coils c3        ON c3.id = cr3.coil_id

  LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id
`;

  const where = [], p = [];
  if (q) {
  where.push(`(c.rn LIKE ? OR c2.rn LIKE ? OR cs.operator LIKE ? OR
               cr.grade LIKE ? OR pr.grade LIKE ? OR cr2.grade LIKE ? OR cr3.grade LIKE ? OR
               c2.grade LIKE ? OR c3.grade LIKE ?)`);
  p.push(`%${q}%`,`%${q}%`,`%${q}%`,
         `%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,
         `%${q}%`,`%${q}%`);
}

  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` GROUP BY cs.id ORDER BY cs.production_date DESC, cs.id DESC`;

  res.json(all(sql, p));
});


// >>> NEW: Patta Stock (source_type='patta') — separate endpoint for Patta tab
// Patta Stock (only source_type='patta')
app.get('/api/patta-stock', auth(), (req, res) => {
  const { q } = req.query;

  let sql = `
    SELECT cs.*,
           CASE
             WHEN pr.source_type = 'circle' THEN c2.rn
             WHEN pr.source_type = 'patta'  THEN 'PATTA-' || pr.patta_source_id
           END AS source_ref,

           /* 👇 same multi-hop coalesce */
           COALESCE(cr2.grade, c2.grade, cr3.grade, c3.grade) AS grade,

           IFNULL(SUM(csl.sold_qty), 0)        AS sold_qty,
           IFNULL(SUM(csl.sold_weight_kg), 0)  AS sold_weight_kg,
           CASE WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0 THEN 0 ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) END AS available_qty,
           CASE WHEN (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) < 0 THEN 0 ELSE (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) END AS available_weight_kg
    FROM circle_stock cs
    LEFT JOIN patta_runs pr  ON cs.source_type='patta' AND cs.source_id = pr.id

    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
    LEFT JOIN coils c2        ON c2.id = cr2.coil_id

    LEFT JOIN patta_runs pr2 ON pr.source_type='patta' AND pr.patta_source_id = pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
    LEFT JOIN coils c3        ON c3.id = cr3.coil_id

    LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id
    WHERE cs.source_type = 'patta'
  `;

  const where = [], p = [];
  if (q) {
    where.push(`(c2.rn LIKE ? OR cs.operator LIKE ? OR cr2.grade LIKE ? OR cr3.grade LIKE ? OR c2.grade LIKE ? OR c3.grade LIKE ?)`);
    p.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`);
  }
  if (where.length) sql += ` AND ` + where.join(' AND ');
  sql += ` GROUP BY cs.id ORDER BY cs.production_date DESC, cs.id DESC`;

  res.json(all(sql, p));
});

// >>> NEW: Circle Stock ONLY (source_type='circle') — separate endpoint for Circle tab

app.get('/api/circle-stock-only', auth(), (req, res) => {
  const { q } = req.query;

let sql = `
  SELECT cs.*,
         cs.qty AS qty_pcs,

         /* source label for both origins */
         CASE
           WHEN cs.source_type = 'circle' THEN c.rn
           WHEN cs.source_type = 'patta' THEN
             (CASE
                WHEN pr.source_type = 'circle' THEN c2.rn
                WHEN pr.source_type = 'patta' THEN 'PATTA-' || pr.patta_source_id
              END)
         END AS source_ref,

           /* thickness resolution for both origins */
           CASE
             WHEN cs.source_type = 'circle' THEN COALESCE(cr.thickness, c.thickness)
             WHEN cs.source_type = 'patta' THEN
               COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
           END AS thickness_mm,

         /* grade resolution for both origins */
         CASE
           WHEN cs.source_type = 'circle' THEN cr.grade
           WHEN cs.source_type = 'patta' THEN
             COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade)
         END AS grade,

         IFNULL(SUM(csl.sold_qty), 0)          AS sold_qty,
         IFNULL(SUM(csl.sold_qty), 0)          AS sold_pcs,
         IFNULL(SUM(csl.sold_weight_kg), 0)    AS sold_weight_kg,
         CASE WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0
              THEN 0 ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) END AS available_qty,
         CASE WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0
              THEN 0 ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) END AS available_pcs,
         CASE WHEN (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) < 0
              THEN 0 ELSE (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) END AS available_weight_kg

  FROM circle_stock cs

  /* circle origin */
  LEFT JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id = cr.id
  LEFT JOIN coils c        ON c.id = cr.coil_id

  /* patta origin (+ one more hop if needed) */
  LEFT JOIN patta_runs pr   ON cs.source_type='patta' AND cs.source_id = pr.id
  LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
  LEFT JOIN coils c2        ON c2.id = cr2.coil_id
  LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id = pr2.id
  LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
  LEFT JOIN coils c3        ON c3.id = cr3.coil_id

  LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id
  WHERE cs.source_type IN ('circle','patta')
`;

const where = [], p = [];
if (q) {
  where.push(`(
      c.rn LIKE ? OR c2.rn LIKE ? OR cs.operator LIKE ?
      OR cr.grade LIKE ? OR pr.grade LIKE ? OR cr2.grade LIKE ? OR cr3.grade LIKE ?
      OR c2.grade LIKE ? OR c3.grade LIKE ?
  )`);
  p.push(`%${q}%`,`%${q}%`,`%${q}%`,
         `%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,
         `%${q}%`,`%${q}%`);
}
if (where.length) sql += ` AND ` + where.join(' AND ');
sql += ` GROUP BY cs.id ORDER BY cs.production_date DESC, cs.id DESC`;

  res.json(all(sql, p));
});

// >>> NEW: Patta Stock ONLY (source_type='patta') — separate endpoint for Patta tab
app.get('/api/patta-stock-only', auth(), (req, res) => {
  const { q } = req.query;

  let sql = `
    SELECT cs.*,
           cs.qty AS qty_pcs,
           -- Show proper source reference (coil RN or parent patta id)
           CASE 
             WHEN pr.source_type = 'circle' THEN c2.rn
             WHEN pr.source_type = 'patta' THEN 'PATTA-' || pr.patta_source_id
           END as source_ref,
           COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade) AS grade,
           IFNULL(SUM(csl.sold_qty), 0) as sold_qty,
           IFNULL(SUM(csl.sold_qty), 0) as sold_pcs, 
           IFNULL(SUM(csl.sold_weight_kg), 0) as sold_weight_kg,
           CASE WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0 THEN 0 ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) END as available_qty,
           CASE WHEN (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) < 0 THEN 0 ELSE (cs.qty - IFNULL(SUM(csl.sold_qty), 0)) END as available_pcs,
           CASE WHEN (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) < 0 THEN 0 ELSE (cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg), 0)) END as available_weight_kg
    FROM circle_stock cs
    LEFT JOIN patta_runs pr ON cs.source_type='patta' AND cs.source_id = pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
    LEFT JOIN coils c2 ON c2.id = cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id = pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
    LEFT JOIN coils c3        ON c3.id = cr3.coil_id
    LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id
    WHERE cs.source_type = 'patta'
  `;

  const where = [], p = [];
  if (q) {
    where.push(`(c2.rn LIKE ? OR cs.operator LIKE ? OR
                 COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade) LIKE ?)`);
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ` AND ` + where.join(' AND ');
  sql += ` GROUP BY cs.id ORDER BY cs.production_date DESC, cs.id DESC`;

  res.json(all(sql, p));
});

// >>> NEW: Scrap Stock ONLY — flat list for Scrap tab (no sales here)
app.get('/api/scrap-only', auth(), (req, res) => {
  const { q } = req.query;

  // Scrap from circle runs
  const fromCircles = all(`
    SELECT cr.run_date AS date,
           c.rn        AS source_ref,
           c.grade     AS grade,
           cr.operator AS operator,
           cr.scrap_weight_kg AS scrap_weight_kg,
           'circle'    AS source_type
    FROM circle_runs cr
    JOIN coils c ON c.id = cr.coil_id
    WHERE cr.scrap_weight_kg IS NOT NULL AND cr.scrap_weight_kg > 0
  `);

  // Scrap from patta runs (trace back to coil when patta came from a circle run)
  const fromPatta = all(`
    SELECT pr.run_date AS date,
           CASE
             WHEN pr.source_type = 'circle' THEN c2.rn
             WHEN pr.source_type = 'patta'  THEN 'PATTA-' || pr.patta_source_id
           END       AS source_ref,
           CASE
             WHEN pr.source_type = 'circle' THEN c2.grade
             WHEN pr.source_type = 'patta'  THEN c3.grade
           END       AS grade,
           pr.operator AS operator,
           pr.scrap_weight_kg AS scrap_weight_kg,
           'patta'    AS source_type
    FROM patta_runs pr
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
    LEFT JOIN coils c2        ON c2.id = cr2.coil_id
    LEFT JOIN patta_runs pr3  ON pr.source_type='patta'  AND pr.patta_source_id = pr3.id
    LEFT JOIN circle_runs cr3 ON pr3.source_type='circle' AND pr3.patta_source_id = cr3.id
    LEFT JOIN coils c3        ON c3.id = cr3.coil_id
    WHERE pr.scrap_weight_kg IS NOT NULL AND pr.scrap_weight_kg > 0
  `);

  // Merge, optional filter, sort newest first
  let rows = [...fromCircles, ...fromPatta];

  if (q && String(q).trim() !== '') {
    const needle = String(q).toLowerCase();
    rows = rows.filter(r =>
      (r.source_ref || '').toLowerCase().includes(needle) ||
      (r.grade || '').toLowerCase().includes(needle) ||
      (r.operator || '').toLowerCase().includes(needle)
    );
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(rows);
});


// Circle sales
app.post('/api/circle-sales', auth(), (req, res) => {
  const { stock_id, sold_weight_kg, buyer, price_per_kg, sale_date, order_no } = req.body;

  // ✅ only check stock_id + weight now
  if (!stock_id || !sold_weight_kg) {
    return res.status(400).json({ error: 'stock_id and sold_weight_kg required' });
  }

  const stock = get(`SELECT * FROM circle_stock WHERE id=?`, [stock_id]);
  if (!stock) return res.status(404).json({ error: 'Stock not found' });

  const info = run(
    `INSERT INTO circle_sales_new
       (stock_id, sold_qty, sold_weight_kg, buyer, price_per_kg, sale_date, order_no)
     VALUES (?,?,?,?,?,?,?)`,
    [
      stock_id,
      0, // 👈 always 0 now (no pcs tracking)
      sold_weight_kg,
      buyer || null,
      price_per_kg || null,
      sale_date || new Date().toISOString().slice(0, 10),
      order_no || null,
    ]
  );

  if (order_no) recomputeOrder(order_no);

  res.json(get(`SELECT * FROM circle_sales_new WHERE id=?`, [info.lastInsertRowid]));
});

/* ------------------------- Record Circle Sale (Order) ------------------------- */

app.post('/api/circle-sales/record-order', auth(), (req, res) => {
  const { stock_id, order_id } = req.body;
  if (!stock_id || !order_id) {
    return res.status(400).json({ error: 'stock_id and order_id are required' });
  }

  const stock = get(`SELECT * FROM circle_stock WHERE id=?`, [stock_id]);
  if (!stock) return res.status(404).json({ error: 'Stock not found' });

  const order = get(`
    SELECT id, company, grade, ordered_qty_pcs, ordered_weight_kg
    FROM orders WHERE id = ?
  `, [order_id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // How much stock is still available
  const soldSoFar = get(
    `SELECT IFNULL(SUM(sold_weight_kg),0) AS used 
     FROM circle_sales_new 
     WHERE stock_id=?`,
    [stock_id]
  )?.used || 0;

  const availableWeight = Math.max(0, (stock.weight_kg || 0) - soldSoFar);
  if (availableWeight <= 0) {
    return res.status(400).json({ error: 'No available weight left in this stock' });
  }

  // Decide how much to sell
  const targetWt = Number(order.ordered_weight_kg || 0);
  let soldWeight = availableWeight;

  if (targetWt > 0) {
    const alreadyFulfilled = get(
      `SELECT IFNULL(SUM(sold_weight_kg),0) AS sum_wt 
       FROM circle_sales_new 
       WHERE order_no=?`,
      [order_id]
    )?.sum_wt || 0;

    const remainingTarget = Math.max(0, targetWt - alreadyFulfilled);
    soldWeight = Math.min(availableWeight, remainingTarget || availableWeight);
  }

  if (soldWeight <= 0) {
    return res.status(400).json({ error: 'Order target already fulfilled' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    db.transaction(() => {
      // Insert the sale
      run(
        `INSERT INTO circle_sales_new 
          (stock_id, order_no, sold_qty, sold_weight_kg, buyer, price_per_kg, sale_date)
         VALUES (?,?,?,?,?,?,?)`,
        [
          stock_id,
          order_id,
          0,                          // qty not known here
          soldWeight,
          order.company || null,
          null,
          today
        ]
      );
    })();

    // Recompute order fulfillment
    const updatedOrder = recomputeOrder(order_id);

    res.json({
      ok: true,
      sale: get(`SELECT * FROM circle_sales_new ORDER BY id DESC LIMIT 1`),
      order: updatedOrder
    });
  } catch (e) {
    console.error('record-order failed:', e);
    res.status(500).json({ error: 'Failed to record sale for order' });
  }
});


// Circle sales (now includes grade + thickness_mm for both origins)
app.get('/api/circle-sales', auth(), (_req, res) => {
  const sql = `
    SELECT 
      csl.*,
      cs.size_mm,
      cs.source_type,

      -- Human-friendly source label
      CASE 
        WHEN cs.source_type = 'circle' THEN c.rn
        WHEN cs.source_type = 'patta'  THEN 
          (CASE 
             WHEN pr.source_type = 'circle' THEN c2.rn
             WHEN pr.source_type = 'patta'  THEN 'PATTA-' || pr.patta_source_id
           END)
      END AS source_ref,

      /* NEW: grade for both origins */
      CASE
        WHEN cs.source_type = 'circle' THEN COALESCE(cr.grade, c.grade)
        WHEN cs.source_type = 'patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade)
      END AS grade,

      /* NEW: thickness for both origins */
      CASE
        WHEN cs.source_type = 'circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN cs.source_type = 'patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
      END AS thickness_mm

    FROM circle_sales_new csl
    JOIN circle_stock cs ON cs.id = csl.stock_id

    /* circle-origin path */
    LEFT JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id = cr.id
    LEFT JOIN coils c        ON c.id = cr.coil_id

    /* patta-origin (first hop) */
    LEFT JOIN patta_runs pr  ON cs.source_type='patta' AND cs.source_id = pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id = cr2.id
    LEFT JOIN coils c2        ON c2.id = cr2.coil_id

    /* patta -> patta -> circle (second hop) */
    LEFT JOIN patta_runs pr2 ON pr.source_type='patta' AND pr.patta_source_id = pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
    LEFT JOIN coils c3        ON c3.id = cr3.coil_id

    ORDER BY csl.sale_date DESC, csl.id DESC
  `;
  res.json(all(sql));
});

app.delete('/api/circle-sales/:id', auth('admin'), (req, res) => {
  const sale = get(`SELECT order_no FROM circle_sales_new WHERE id=?`, [req.params.id]);
  run(`DELETE FROM circle_sales_new WHERE id=?`, [req.params.id]);
  if (sale && sale.order_no) {
    recomputeOrder(sale.order_no);
  }
  res.json({ ok: true });
});

// PL Stock (with coil RN source mapping)
app.get('/api/pl-stock', auth(), (req, res) => {
  const { q } = req.query;

  let sql = `
    SELECT pls.id, pls.source_type, pls.source_id, pls.size_mm, pls.weight_kg, pls.qty,
           pls.qty AS qty_pcs, 
           pls.production_date, pls.operator,
           -- ✅ Show proper source
           CASE 
             WHEN pls.source_type = 'circle' THEN c.rn
             WHEN pls.source_type = 'patta' THEN 'PATTA-' || pr.id
             WHEN pls.source_type = 'pl' THEN 'PL-' || pl.id
           END as source_ref,
           c.grade, c.thickness, c.width,
    IFNULL(SUM(ps.sold_qty), 0)        as sold_qty,
    IFNULL(SUM(ps.sold_qty), 0)        as sold_pcs,
    IFNULL(SUM(ps.sold_weight_kg), 0)  as sold_weight_kg,
    pls.qty                            as available_qty,
    pls.qty                            as available_pcs,
    pls.weight_kg                      as available_weight_kg           
    FROM pl_stock pls
    LEFT JOIN pl_runs pl ON pls.source_type='pl' AND pls.source_id = pl.id
    LEFT JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id = cr.id
    LEFT JOIN coils c ON c.id = cr.coil_id
    LEFT JOIN patta_runs pr ON pls.source_type='patta' AND pls.source_id = pr.id
    LEFT JOIN pl_sales ps ON ps.pl_stock_id = pls.id
  `;

  const where = [], p = [];
  if (q) {
    where.push(`(c.rn LIKE ? OR c.grade LIKE ? OR pls.operator LIKE ?)`);
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` GROUP BY pls.id ORDER BY pls.production_date DESC, pls.id DESC`;

  res.json(all(sql, p));
});

// ================== PL SALES ==================

// ✅ Single PL Sale
app.post('/api/pl-sales', auth(), (req, res) => {
  let { pl_stock_id, sold_qty, sold_weight_kg, buyer, price_per_kg, sale_date } = req.body;

  sold_qty = Number(sold_qty || 0);
  sold_weight_kg = Number(sold_weight_kg || 0);
  price_per_kg = (price_per_kg != null && price_per_kg !== '') ? Number(price_per_kg) : null;
  sale_date = sale_date || new Date().toISOString().slice(0, 10);

  // Must have pl_stock_id and a positive weight
  if (!pl_stock_id || sold_weight_kg <= 0) {
    return res.status(400).json({ error: 'pl_stock_id and positive sold_weight_kg required' });
  }

  const stockRow = get(`SELECT * FROM pl_stock WHERE id=?`, [pl_stock_id]);
  if (!stockRow) return res.status(404).json({ error: 'PL stock row not found' });

  // Availability checks
  if (sold_weight_kg > Number(stockRow.weight_kg || 0)) {
    return res.status(400).json({ error: 'Sold weight exceeds available PL stock weight' });
  }
  if (sold_qty > Number(stockRow.qty || 0)) {
    return res.status(400).json({ error: 'Sold qty exceeds available PL stock qty' });
  }

  try {
    // Resolve pl_id (only if source_type='pl')
    let resolvedPlId = 0;
    if (stockRow.source_type === 'pl') {
      const maybe = Number(stockRow.source_id);
      if (Number.isFinite(maybe) && maybe > 0) resolvedPlId = maybe;
    }

    const info = run(
      `INSERT INTO pl_sales(pl_id, pl_stock_id, sold_qty, sold_weight_kg, buyer, price_per_kg, sale_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [resolvedPlId, pl_stock_id, sold_qty, sold_weight_kg, buyer || null, price_per_kg, sale_date]
    );

    run(
      `UPDATE pl_stock
         SET qty = MAX(0, IFNULL(qty,0) - ?),
             weight_kg = MAX(0, IFNULL(weight_kg,0) - ?),
             updated_at = datetime('now')
       WHERE id = ?`,
      [sold_qty, sold_weight_kg, pl_stock_id]
    );

    res.json(get(`SELECT * FROM pl_sales WHERE id=?`, [info.lastInsertRowid]));
  } catch (e) {
    console.error('PL sale insert failed:', e);
    return res.status(500).json({ error: 'Failed to record PL sale' });
  }
});


// ✅ Bulk PL Sale (grade-wise FIFO)
app.post('/api/pl-sales/record-bulk', auth(), (req, res) => {
  let { grade, weight_kg, buyer, price_per_kg, sale_date, size_mm, thickness_mm } = req.body || {};
  const need = Number(weight_kg || 0);

  if (!grade || !Number.isFinite(need) || need <= 0) {
    return res.status(400).json({ error: "grade and positive weight_kg are required" });
  }
  price_per_kg = (price_per_kg != null && price_per_kg !== '') ? Number(price_per_kg) : null;
  sale_date = sale_date || new Date().toISOString().slice(0, 10);

  // Pull PL stock candidates
  const candidates = all(`
    SELECT 
      pls.id AS pl_stock_id,
      pls.production_date,
      pls.size_mm,
      IFNULL(pls.weight_kg,0) AS available_wt,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.grade, c.grade)
        WHEN pls.source_type='patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade, pls.grade)
        WHEN pls.source_type='pl'     THEN COALESCE(pls.grade, cr4.grade, c4.grade, cr5.grade, c5.grade)
      END AS r_grade,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN pls.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
        WHEN pls.source_type='pl'     THEN COALESCE(cr4.thickness, c4.thickness, cr5.thickness, c5.thickness)
      END AS r_thickness
    FROM pl_stock pls
    LEFT JOIN pl_runs pl ON pls.source_type='pl' AND pls.source_id=pl.id
    LEFT JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id=cr.id
    LEFT JOIN coils c ON c.id=cr.coil_id
    LEFT JOIN patta_runs pr ON pls.source_type='patta' AND pls.source_id=pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2 ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2 ON pr.source_type='patta' AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3 ON c3.id=cr3.coil_id
    LEFT JOIN circle_runs cr4 ON pls.source_type='pl' AND pl.source_type='circle' AND pl.pl_source_id=cr4.id
    LEFT JOIN coils c4 ON c4.id=cr4.coil_id
    LEFT JOIN pl_runs pl2 ON pls.source_type='pl' AND pl.source_type='pl' AND pl.pl_source_id=pl2.id
    LEFT JOIN circle_runs cr5 ON pl2.source_type='circle' AND pl2.pl_source_id=cr5.id
    LEFT JOIN coils c5 ON c5.id=cr5.coil_id
    WHERE IFNULL(pls.weight_kg,0) > 0
  `).filter(r =>
    String(r.r_grade || '').toLowerCase() === String(grade).toLowerCase() &&
    (size_mm == null || Number(r.size_mm) === Number(size_mm)) &&
    (thickness_mm == null || Number(r.r_thickness) === Number(thickness_mm))
  ).sort((a,b) => new Date(a.production_date) - new Date(b.production_date));

  if (!candidates.length) {
    return res.status(400).json({ error: "No matching PL stock available for the given filters." });
  }

  try {
    let remaining = need;
    const allocations = [];

    db.transaction(() => {
      for (const row of candidates) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(row.available_wt || 0));
        if (take <= 0) continue;

        const stockInfo = get(`SELECT source_type, source_id FROM pl_stock WHERE id=?`, [row.pl_stock_id]);
        let resolvedPlId = 0;
        if (stockInfo && stockInfo.source_type === 'pl') {
          const maybe = Number(stockInfo.source_id);
          if (Number.isFinite(maybe) && maybe > 0) resolvedPlId = maybe;
        }

        const info = run(
          `INSERT INTO pl_sales(pl_id, pl_stock_id, sold_qty, sold_weight_kg, buyer, price_per_kg, sale_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [resolvedPlId, row.pl_stock_id, 0, take, buyer || null, price_per_kg, sale_date]
        );

        run(
          `UPDATE pl_stock
             SET weight_kg = MAX(0, IFNULL(weight_kg,0) - ?),
                 updated_at = datetime('now')
           WHERE id = ?`,
          [take, row.pl_stock_id]
        );

        allocations.push({ pl_stock_id: row.pl_stock_id, sold_weight_kg: take, sale_id: info.lastInsertRowid });
        remaining -= take;
      }
    })();

    res.json({
      ok: true,
      grade,
      filters: { size_mm: size_mm ?? null, thickness_mm: thickness_mm ?? null },
      total_requested: need,
      total_sold: allocations.reduce((s, a) => s + a.sold_weight_kg, 0),
      leftover: Math.max(0, remaining),
      allocations,
    });
  } catch (e) {
    console.error("PL record-bulk failed:", e);
    res.status(500).json({ error: "Failed to record PL bulk sale" });
  }
});


app.get('/api/pl-sales', auth(), (_req, res) => {
  const sql = `
    SELECT 
      ps.id,
      ps.pl_stock_id,
      ps.sold_qty,
      ps.sold_weight_kg,
      ps.buyer,
      ps.price_per_kg,
      ps.sale_date,
      ps.created_at,

      pls.size_mm,
      pls.weight_kg,
      pls.operator,
      pls.production_date,

      -- Show proper source reference
      CASE 
        WHEN pls.source_type = 'circle' THEN c.rn
        WHEN pls.source_type = 'patta'  THEN 'PATTA-' || pr.id
        WHEN pls.source_type = 'pl'     THEN 'PL-' || pl.id
      END as source_ref,
      c.grade, c.thickness, c.width
    FROM pl_sales ps
    JOIN pl_stock pls ON ps.pl_stock_id = pls.id
    LEFT JOIN pl_runs pl     ON pls.source_type='pl' AND pls.source_id = pl.id
    LEFT JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id = cr.id
    LEFT JOIN coils c        ON c.id = cr.coil_id
    LEFT JOIN patta_runs pr  ON pls.source_type='patta' AND pls.source_id = pr.id
    ORDER BY ps.sale_date DESC, ps.id DESC
  `;
  res.json(all(sql));
});

app.delete('/api/pl-sales/:id', auth('admin'), (req, res) => {
  const { id } = req.params;

  const sale = get(`SELECT * FROM pl_sales WHERE id=?`, [id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  try {
    db.transaction(() => {
      // delete sale record
      run(`DELETE FROM pl_sales WHERE id=?`, [id]);

      // ✅ always restore via pl_stock_id
      if (sale.pl_stock_id) {
        run(`UPDATE pl_stock
             SET qty = qty + ?,
                 weight_kg = weight_kg + ?,
                 updated_at=datetime('now')
             WHERE id=?`,
          [Number(sale.sold_qty || 0), Number(sale.sold_weight_kg || 0), sale.pl_stock_id]
        );
      }
    })();

    res.json({ ok: true });
  } catch (e) {
    console.error('Error undoing PL sale:', e);
    res.status(500).json({ error: 'Failed to undo PL sale' });
  }
});

/* --------------------------- Scrap & Scrap Sales -------------------------- */
app.get('/api/scrap', auth(), (_req, res) => {
  // raw scrap from runs
  const fromCircles = all(`
    SELECT cr.run_date as date, c.rn, 'circle' as source_type, c.grade, cr.scrap_weight_kg as base_weight
    FROM circle_runs cr
    JOIN coils c ON c.id = cr.coil_id
    WHERE cr.scrap_weight_kg > 0
  `);

  const fromPatta = all(`
    SELECT pr.run_date as date,
           CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END as rn,
           'patta' as source_type,
           COALESCE(c2.grade,c3.grade) as grade,
           pr.scrap_weight_kg as base_weight
    FROM patta_runs pr
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2 ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2 ON pr.source_type='patta' AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3 ON c3.id=cr3.coil_id
    WHERE pr.scrap_weight_kg > 0
  `);

  let rows = [...fromCircles, ...fromPatta];

  // subtract sales
  const sales = all(`SELECT rn, source_type, SUM(weight_kg) as sold FROM scrap_sales GROUP BY rn, source_type`);
  const soldMap = {};
  for (const s of sales) {
    soldMap[`${s.rn}|${s.source_type}`] = Number(s.sold || 0);
  }

  rows = rows.map(r => {
    const sold = soldMap[`${r.rn}|${r.source_type}`] || 0;
    const base = Number(r.base_weight || 0);
    return {
      date: r.date,
      rn: r.rn,
      source_type: r.source_type,
      grade: r.grade,
      base_weight: base,
      sold,
      remaining: Math.max(0, base - sold)
    };
  });

  const totalScrap = rows.reduce((s, r) => s + r.base_weight, 0);
  const totalSold = rows.reduce((s, r) => s + r.sold, 0);

  res.json({
    rows,
    totals: {
      total_kg: totalScrap,
      sold_kg: totalSold,
      available_kg: Math.max(0, totalScrap - totalSold)
    }
  });
});


/* 1) Single scrap sale */
app.post('/api/scrap-sales', auth(), (req, res) => {
  const { sale_date, buyer, grade, rn, source_type, weight_kg, price_per_kg } = req.body;
  const weight = Number(weight_kg || 0);

  if (!weight || weight <= 0) {
    return res.status(400).json({ error: "weight_kg must be > 0" });
  }

  // Check available scrap first
  const scrapRow = get(
    `
    SELECT 
      SUM(base_weight) as base_weight,
      IFNULL(SUM(s.weight_kg),0) as sold
    FROM (
      SELECT cr.scrap_weight_kg as base_weight, c.rn, 'circle' as source_type
      FROM circle_runs cr
      JOIN coils c ON c.id = cr.coil_id
      WHERE c.rn = ? AND 'circle' = ?

      UNION ALL

      SELECT pr.scrap_weight_kg as base_weight, 
             CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END as rn,
             'patta' as source_type
      FROM patta_runs pr
      LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
      LEFT JOIN coils c2 ON c2.id=cr2.coil_id
      WHERE (CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END) = ?
        AND 'patta' = ?
    ) t
    LEFT JOIN scrap_sales s ON s.rn = t.rn AND s.source_type = t.source_type
    WHERE t.rn = ? AND t.source_type = ?
    GROUP BY t.rn, t.source_type
    `,
    [rn, source_type, rn, source_type, rn, source_type]
  );

  const base = scrapRow?.base_weight || 0;
  const sold = scrapRow?.sold || 0;
  const remaining = base - sold;

  if (weight > remaining) {
    return res.status(400).json({
      error: `Cannot sell ${weight}kg. Only ${remaining}kg available.`,
    });
  }

  const info = run(
    `INSERT INTO scrap_sales(sale_date, buyer, grade, rn, source_type, weight_kg, price_per_kg)
     VALUES (?,?,?,?,?,?,?)`,
    [
      sale_date || new Date().toISOString().slice(0, 10),
      buyer || null,
      grade || null,
      rn || null,
      source_type || null,
      weight,
      (price_per_kg != null && price_per_kg !== '') ? Number(price_per_kg) : null
    ]
  );

  res.json(get(`SELECT * FROM scrap_sales WHERE id=?`, [info.lastInsertRowid]));
});


/* 2) Bulk scrap sale — MOVED OUTSIDE (its own top-level route now) */
app.post('/api/scrap-sales/record-bulk', auth(), (req, res) => {
  let { grade, weight_kg, buyer, price_per_kg, sale_date, source_type } = req.body || {};
  const need = Number(weight_kg || 0);

  if (!grade || !Number.isFinite(need) || need <= 0) {
    return res.status(400).json({ error: "grade and positive weight_kg are required" });
  }
  if (source_type && !['circle','patta'].includes(String(source_type))) {
    return res.status(400).json({ error: "source_type must be 'circle' or 'patta' if provided" });
  }
  price_per_kg = (price_per_kg != null && price_per_kg !== '') ? Number(price_per_kg) : null;
  sale_date = sale_date || new Date().toISOString().slice(0, 10);

  // Build availability like /api/scrap (but filtered by grade and optional source_type)
  const fromCircles = all(`
    SELECT cr.run_date AS date, c.rn AS rn, 'circle' AS source_type, c.grade AS grade,
           IFNULL(cr.scrap_weight_kg,0) AS base_weight
    FROM circle_runs cr
    JOIN coils c ON c.id = cr.coil_id
    WHERE cr.scrap_weight_kg IS NOT NULL AND cr.scrap_weight_kg > 0
      AND LOWER(c.grade) = LOWER(?)
  `, [grade]);

  const fromPatta = all(`
    SELECT pr.run_date AS date,
           CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END as rn,
           'patta' as source_type,
           COALESCE(c2.grade,c3.grade) as grade,
           IFNULL(pr.scrap_weight_kg,0) as base_weight
    FROM patta_runs pr
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2        ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3        ON c3.id=cr3.coil_id
    WHERE pr.scrap_weight_kg IS NOT NULL AND pr.scrap_weight_kg > 0
      AND LOWER(COALESCE(c2.grade,c3.grade)) = LOWER(?)
  `, [grade]);

  let pools = [...fromCircles, ...fromPatta];
  if (source_type) pools = pools.filter(p => p.source_type === source_type);

  // Subtract already sold
  const sales = all(`SELECT rn, source_type, IFNULL(SUM(weight_kg),0) AS sold FROM scrap_sales GROUP BY rn, source_type`);
  const soldMap = new Map(sales.map(s => [`${s.rn}|${s.source_type}`, Number(s.sold || 0)]));

  const avail = pools.map(p => {
    const key = `${p.rn}|${p.source_type}`;
    const sold = soldMap.get(key) || 0;
    const remaining = Math.max(0, Number(p.base_weight || 0) - sold);
    return { date: p.date, rn: p.rn, source_type: p.source_type, remaining };
  }).filter(x => x.remaining > 0)
    .sort((a,b) => new Date(a.date) - new Date(b.date)); // FIFO

  if (!avail.length) {
    return res.status(400).json({ error: "No matching scrap available for the given filters." });
  }

  try {
    let remaining = need;
    const allocations = [];

    db.transaction(() => {
      for (const pool of avail) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, pool.remaining);
        if (take <= 0) continue;

        const info = run(
          `INSERT INTO scrap_sales(sale_date, buyer, grade, rn, source_type, weight_kg, price_per_kg)
           VALUES (?,?,?,?,?,?,?)`,
          [sale_date, buyer || null, grade, pool.rn, pool.source_type, take, price_per_kg]
        );

        allocations.push({ rn: pool.rn, source_type: pool.source_type, weight_kg: take, sale_id: info.lastInsertRowid });
        remaining -= take;
      }
    })();

    res.json({
      ok: true,
      grade,
      filter_source_type: source_type || null,
      total_requested: need,
      total_sold: allocations.reduce((s,a)=>s+a.weight_kg,0),
      leftover: Math.max(0, remaining),
      allocations
    });
  } catch (e) {
    console.error("SCRAP record-bulk failed:", e);
    res.status(500).json({ error: "Failed to record scrap bulk sale" });
  }
});


/* 3) List scrap sales */
app.get('/api/scrap-sales', auth(), (_req, res) => {
  const rows = all(`
    SELECT id, sale_date, buyer, grade, rn, source_type, weight_kg, price_per_kg,
           (weight_kg * IFNULL(price_per_kg,0)) AS total_value
    FROM scrap_sales
    ORDER BY sale_date DESC, id DESC
  `);
  res.json(rows);
});


/* 4) Edit a scrap sale (with availability check) */
app.patch('/api/scrap-sales/:id', auth(), (req, res) => {
  const { id } = req.params;
  const sale = get(`SELECT * FROM scrap_sales WHERE id=?`, [id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  // Use new values or fall back to existing
  const rn          = req.body.rn ?? sale.rn;
  const source_type = req.body.source_type ?? sale.source_type;
  const sale_date   = req.body.sale_date ?? sale.sale_date;
  const buyer       = req.body.buyer ?? sale.buyer;
  const grade       = req.body.grade ?? sale.grade;

  // coerce numeric fields; allow empty -> keep previous
  const price_per_kg =
    req.body.price_per_kg === '' || req.body.price_per_kg == null
      ? sale.price_per_kg
      : Number(req.body.price_per_kg);

  const newWeight =
    req.body.weight_kg === '' || req.body.weight_kg == null
      ? Number(sale.weight_kg)
      : Number(req.body.weight_kg);

  if (!Number.isFinite(newWeight) || newWeight <= 0) {
    return res.status(400).json({ error: 'weight_kg must be > 0' });
  }

  // How much scrap is available if we "give back" this sale first
  const scrapRow = get(
    `
    SELECT 
      SUM(base_weight) as base_weight,
      IFNULL(SUM(s.weight_kg),0) as sold
    FROM (
      SELECT cr.scrap_weight_kg as base_weight, c.rn, 'circle' as source_type
      FROM circle_runs cr
      JOIN coils c ON c.id = cr.coil_id
      WHERE c.rn = ? AND 'circle' = ?

      UNION ALL

      SELECT pr.scrap_weight_kg as base_weight, 
             CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END as rn,
             'patta' as source_type
      FROM patta_runs pr
      LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
      LEFT JOIN coils c2 ON c2.id=cr2.coil_id
      WHERE (CASE WHEN pr.source_type='circle' THEN c2.rn ELSE 'PATTA-'||pr.patta_source_id END) = ?
        AND 'patta' = ?
    ) t
    LEFT JOIN scrap_sales s ON s.rn = t.rn AND s.source_type = t.source_type
    WHERE t.rn = ? AND t.source_type = ?
    GROUP BY t.rn, t.source_type
    `,
    [rn, source_type, rn, source_type, rn, source_type]
  );

  const base = scrapRow?.base_weight || 0;
  const sold = scrapRow?.sold || 0;

  // add back current sale so we don't double-count it
  const remainingWithRollback = base - sold + Number(sale.weight_kg || 0);
  if (newWeight > remainingWithRollback) {
    return res.status(400).json({
      error: `Cannot set ${newWeight}kg. Only ${remainingWithRollback}kg available for RN ${rn}.`,
    });
  }

  run(
    `UPDATE scrap_sales
       SET sale_date=?,
           buyer=?,
           grade=?,
           rn=?,
           source_type=?,
           weight_kg=?,
           price_per_kg=?
     WHERE id=?`,
    [sale_date, buyer || null, grade || null, rn, source_type, newWeight, price_per_kg, id]
  );

  res.json(get(`SELECT * FROM scrap_sales WHERE id=?`, [id]));
});


/* 5) Delete a scrap sale */
app.delete('/api/scrap-sales/:id', auth('admin'), (req, res) => {
  run(`DELETE FROM scrap_sales WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

/* -------------------------------- Dashboard ------------------------------- */
app.get('/api/dashboard', auth(), (_req, res) => {
  const totals = get(`
    SELECT
      IFNULL(SUM(circle_weight_kg),0) AS circles_kg,
      IFNULL(SUM(net_weight_kg),0)     AS net_kg,
      IFNULL(SUM(scrap_weight_kg),0)   AS scrap_kg,
      IFNULL(SUM(patta_weight_kg),0)   AS patta_kg
    FROM circle_runs
  `);

  const pattaTotals = get(`
    SELECT
      IFNULL(SUM(circle_weight_kg),0) AS circles_kg,
      IFNULL(SUM(net_weight_kg),0)     AS net_kg,
      IFNULL(SUM(scrap_weight_kg),0)   AS scrap_kg
    FROM patta_runs
  `);

  const combinedTotals = {
    circles_kg: totals.circles_kg + pattaTotals.circles_kg,
    net_kg: totals.net_kg + pattaTotals.net_kg,
    scrap_kg: totals.scrap_kg + pattaTotals.scrap_kg,
    patta_kg: totals.patta_kg
  };

  const byOperator = all(`
    SELECT operator,
           IFNULL(SUM(circle_weight_kg),0) AS circles_kg,
           IFNULL(SUM(net_weight_kg),0)     AS net_kg,
           ROUND(100.0 * IFNULL(SUM(circle_weight_kg),0) / NULLIF(SUM(net_weight_kg),0), 2) AS yield_pct
    FROM (
      SELECT operator, circle_weight_kg, net_weight_kg FROM circle_runs
      UNION ALL
      SELECT operator, circle_weight_kg, net_weight_kg FROM patta_runs
    ) combined
    GROUP BY operator
    ORDER BY circles_kg DESC
  `);

  const recent = all(`
    SELECT run_date, rn, operator, circle_weight_kg, scrap_weight_kg, patta_weight_kg, source_type
    FROM (
      SELECT cr.run_date, c.rn, cr.operator, cr.circle_weight_kg, cr.scrap_weight_kg, cr.patta_weight_kg, 'circle' as source_type
      FROM circle_runs cr JOIN coils c ON c.id=cr.coil_id
      UNION ALL
      SELECT pr.run_date, 
             CASE 
               WHEN pr.source_type = 'circle' THEN c.rn
               WHEN pr.source_type = 'patta' THEN 'PATTA-' || pr.patta_source_id
             END as rn,
             pr.operator, pr.circle_weight_kg, pr.scrap_weight_kg, NULL as patta_weight_kg, 'patta' as source_type
      FROM patta_runs pr
      LEFT JOIN circle_runs cr ON pr.source_type = 'circle' AND pr.patta_source_id = cr.id
      LEFT JOIN coils c ON c.id = cr.coil_id
    ) combined
    ORDER BY run_date DESC, source_type DESC
    LIMIT 10
  `);

  res.json({ totals: combinedTotals, byOperator, recent });
});

/* ----------------- Dashboard: Coil Profitability ----------------- */
app.get('/api/dashboard/profitability', auth(), (_req, res) => {
  const coils = all(`SELECT id FROM coils ORDER BY created_at DESC`);

  const result = coils.map(r => {
  const s = coilSummaryRowStrict(r.id);   // ✅ strict check
  if (!s) return null;

  console.log("Profitability check:", s.rn, "Balance =", s.balance_kg);


    const purchase_cost = (s.purchase_price || 0) * (s.purchased_kg || 0);

    const circleRevenue = get(`
      SELECT IFNULL(SUM(s.sold_weight_kg * IFNULL(s.price_per_kg,0)),0) AS rev
      FROM circle_sales_new s
      JOIN circle_stock cs ON cs.id = s.stock_id
      JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id=cr.id
      WHERE cr.coil_id = ?
    `, [s.id])?.rev || 0;

    const plRevenue = get(`
      SELECT IFNULL(SUM(ps.sold_weight_kg * IFNULL(ps.price_per_kg,0)),0) AS rev
      FROM pl_sales ps
      JOIN pl_stock pls ON ps.pl_stock_id = pls.id
      JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id=cr.id
      WHERE cr.coil_id = ?
    `, [s.id])?.rev || 0;

    const scrapRevenue = get(`
      SELECT IFNULL(SUM(ss.weight_kg * IFNULL(ss.price_per_kg,0)),0) AS rev
      FROM scrap_sales ss
      WHERE ss.rn = ?
    `, [s.rn])?.rev || 0;

    const totalRevenue = circleRevenue + plRevenue + scrapRevenue;
    const profit = totalRevenue - purchase_cost;

    return {
      coil_no: s.rn,
      purchase_cost,
      total_revenue: totalRevenue,
      profit,
      balance_kg: s.balance_kg
    };
  }).filter(Boolean);

  // ✅ only fully sold coils
  res.json(result.filter(r => (r.balance_kg || 0) === 0));
});

// ------------------------------ Yield summary (minimal) ------------------------------
app.get('/api/yield', auth(), (_req, res) => {
  const sql = `
    SELECT
      c.id,
      c.rn,
      c.grade,

      IFNULL(cir.circle_net, 0)  AS net_input_kg,
      IFNULL(cir.circle_out, 0)  AS circle_out_kg,
      IFNULL(pat.patta_net, 0)   AS patta_net_kg,
      IFNULL(pat.patta_out, 0)   AS patta_out_kg

    FROM coils c

    LEFT JOIN (
      SELECT
        coil_id,
        SUM(net_weight_kg)    AS circle_net,
        SUM(circle_weight_kg) AS circle_out
      FROM circle_runs
      GROUP BY coil_id
    ) cir ON cir.coil_id = c.id

    LEFT JOIN (
      SELECT
        COALESCE(cr.coil_id, cr2.coil_id) AS coil_id,
        SUM(pr.net_weight_kg)             AS patta_net,
        SUM(pr.circle_weight_kg)          AS patta_out
      FROM patta_runs pr
      LEFT JOIN circle_runs cr
             ON pr.source_type = 'circle' AND pr.patta_source_id = cr.id
      LEFT JOIN patta_runs pr2
             ON pr.source_type = 'patta'  AND pr.patta_source_id = pr2.id
      LEFT JOIN circle_runs cr2
             ON pr2.source_type = 'circle' AND pr2.patta_source_id = cr2.id
      GROUP BY COALESCE(cr.coil_id, cr2.coil_id)
    ) pat ON pat.coil_id = c.id

    WHERE cir.circle_net IS NOT NULL OR pat.patta_net IS NOT NULL
    ORDER BY c.created_at DESC, c.id DESC
  `;

  const rowsRaw = all(sql);

  const safePct = (num, den) => (den > 0 ? Math.round((num * 10000) / den) / 100 : null);

  const rows = rowsRaw.map(r => ({
    rn: r.rn,
    grade: r.grade,
    circle_yield_pct: safePct(r.circle_out_kg, r.net_input_kg),
    patta_yield_pct:  safePct(r.patta_out_kg,  r.patta_net_kg),
    total_yield_pct:  safePct((r.circle_out_kg || 0) + (r.patta_out_kg || 0), r.net_input_kg)
  }));

  res.json(rows);
});

// 🔄 Recalculate coil stock from truth
app.post('/api/coil-stock/recalc', auth('admin'), (_req, res) => {
  try {
    const coils = all(`SELECT id, purchase_weight_kg FROM coils`);

    db.transaction(() => {
      for (const c of coils) {
        // Direct sold
        const direct = get(
          `SELECT IFNULL(SUM(sold_weight_kg),0) AS v
           FROM coil_direct_sales WHERE coil_id=?`,
          [c.id]
        )?.v || 0;

        // Circle runs (circles, patta, pl, scrap)
        const cuts = get(
          `SELECT 
             IFNULL(SUM(circle_weight_kg),0) AS circle,
             IFNULL(SUM(patta_weight_kg),0)  AS patta,
             IFNULL(SUM(pl_weight_kg),0)     AS pl,
             IFNULL(SUM(scrap_weight_kg),0)  AS scrap
           FROM circle_runs WHERE coil_id=?`,
          [c.id]
        );

        // Extra scrap
        const extra = get(
          `SELECT IFNULL(SUM(scrap_weight_kg),0) AS v
           FROM coil_scrap WHERE coil_id=?`,
          [c.id]
        )?.v || 0;

        // Compute available
        const avail =
          Math.max(
            0,
            Number(c.purchase_weight_kg || 0) -
              direct -
              (cuts.circle || 0) -
              (cuts.patta || 0) -
              (cuts.pl || 0) -
              (cuts.scrap || 0) -
              extra
          );

        // Update coil_stock
        run(
          `UPDATE coil_stock
           SET available_weight_kg=?, updated_at=datetime('now')
           WHERE coil_id=?`,
          [avail, c.id]
        );
      }
    })();

    res.json({ ok: true, message: "Coil stock recalculated" });
  } catch (e) {
    console.error("Recalc failed", e);
    res.status(500).json({ error: "Failed to recalc coil stock" });
  }
});

// ------------------------------ Excel Exports ------------------------------
import ExcelJS from 'exceljs';
import { Readable } from 'stream';

// helper: write rows with ordered headers
function addSheet(workbook, name, rows, headers) {
  const ws = workbook.addWorksheet(name);

  if (!headers || !headers.length) {
    // fallback – infer from first row
    if (!rows || rows.length === 0) { ws.addRow(["No data"]); return; }
    ws.addRow(Object.keys(rows[0]));
    rows.forEach(r => ws.addRow(Object.values(r)));
    return;
  }

  // header row (use label if present, else key)
  ws.addRow(headers.map(h => h.label || h.key));

  // body rows, strictly in header order
  (rows || []).forEach(r => {
    ws.addRow(headers.map(h => r[h.key]));
  });
}

/** 
 * Export specs per tab.
 * Each item declares a SQL that already SELECTs/aliases the columns
 * exactly as you want them to appear in Excel, and a headers[] array
 * which defines the order (and human labels) for the sheet.
 */
const EXPORTS = [
/* Coils — match UI columns & order */
{
  key: "coils",
  sheet: "Coils",
  filename: "coils",
  sql: `
    WITH direct AS (
      SELECT coil_id, IFNULL(SUM(sold_weight_kg),0) AS w
      FROM coil_direct_sales
      GROUP BY coil_id
    ),
    cuts AS (
      SELECT
        coil_id,
        IFNULL(SUM(circle_weight_kg),0) AS circles,
        IFNULL(SUM(patta_weight_kg),0)  AS patta,
        IFNULL(SUM(pl_weight_kg),0)     AS pl,
        IFNULL(SUM(scrap_weight_kg),0)  AS scrap
      FROM circle_runs
      GROUP BY coil_id
    ),
    extra_scrap AS (
      SELECT coil_id, IFNULL(SUM(scrap_weight_kg),0) AS w
      FROM coil_scrap
      GROUP BY coil_id
    )
    SELECT
      c.rn                                              AS rn,
      c.grade                                           AS grade,
      (CASE
         WHEN c.thickness IS NOT NULL AND c.width IS NOT NULL
         THEN (c.thickness || ' x ' || c.width)
         ELSE NULL
       END)                                             AS spec,
      c.supplier                                        AS supplier,
      c.purchase_date                                   AS purchased_on,
      c.purchase_weight_kg                              AS purchased_kg,
      c.purchase_price                                  AS purchase_price_per_kg,
      IFNULL(d.w,0)                                     AS direct_sold_kg,
      IFNULL(ct.circles,0)                              AS circles_kg,
      IFNULL(ct.patta,0)                                AS patta_kg,
      IFNULL(ct.pl,0)                                   AS pl_kg,
      (IFNULL(ct.scrap,0) + IFNULL(es.w,0))             AS scrap_kg,
      (c.purchase_weight_kg
        - IFNULL(d.w,0)
        - IFNULL(ct.circles,0)
        - IFNULL(ct.patta,0)
        - IFNULL(ct.pl,0)
        - (IFNULL(ct.scrap,0) + IFNULL(es.w,0)))        AS balance_kg
    FROM coils c
    LEFT JOIN direct      d  ON d.coil_id = c.id
    LEFT JOIN cuts        ct ON ct.coil_id = c.id
    LEFT JOIN extra_scrap es ON es.coil_id = c.id
    ORDER BY c.created_at DESC
  `,
  headers: [
    { key: "rn",                    label: "RN" },
    { key: "grade",                 label: "Grade" },
    { key: "spec",                  label: "Spec" },
    { key: "supplier",              label: "Supplier" },
    { key: "purchased_on",          label: "Purchased On" },
    { key: "purchased_kg",          label: "Purchased (kg)" },
    { key: "purchase_price_per_kg", label: "Purchase Price (₹/kg)" },
    { key: "direct_sold_kg",        label: "Direct Sold (kg)" },
    { key: "circles_kg",            label: "Circles (kg)" },
    { key: "patta_kg",              label: "Patta (kg)" },
    { key: "pl_kg",                 label: "PL (kg)" },
    { key: "scrap_kg",              label: "Scrap (kg)" },
    { key: "balance_kg",            label: "Balance (kg)" },
  ],
},

/* Coil Stock — match UI columns & order */
{
  key: "coil_stock",
  aliases: ["stock_coil"],
  sheet: "Coil Stock",
  filename: "coil_stock",
  sql: `
    SELECT
      rn                                                   AS rn,
      grade                                                AS grade,
      (CASE
        WHEN thickness IS NOT NULL AND width IS NOT NULL
        THEN (thickness || ' x ' || width)
        ELSE NULL
      END)                                                 AS spec,
      supplier                                             AS supplier,
      purchase_date                                        AS purchase_date,
      available_weight_kg                                  AS available_weight_kg
    FROM coil_stock
    WHERE available_weight_kg > 0                    -- match UI
    ORDER BY created_at DESC
  `,
  headers: [
    { key: "rn",                   label: "RN" },
    { key: "grade",                label: "Grade" },
    { key: "spec",                 label: "Spec" },
    { key: "supplier",             label: "Supplier" },
    { key: "purchase_date",        label: "Purchase Date" },
    { key: "available_weight_kg",  label: "Available Weight (kg)" },
  ],
},

  /* Patta Runs — align with UI */
{
  key: "patta_runs",
  sheet: "Patta Runs",
  filename: "patta_runs",
  sql: `
    SELECT
      pr.run_date                                                                 AS date,
      CASE
        WHEN pr.source_type='circle' THEN c.rn
        WHEN pr.source_type='patta'  THEN 'PATTA-' || pr.patta_source_id
      END                                                                          AS source_ref,
      pr.operator                                                                  AS operator,
      pr.grade                                                                     AS grade,
      CASE
        WHEN pr.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN pr.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
      END                                                                          AS thickness_mm,
      pr.patta_size                                                                AS patta_size,
      pr.net_weight_kg                                                             AS net_weight_kg,
      pr.op_size_mm                                                                AS circle_size_mm,
      COALESCE(pr.circle_weight_kg,0)                                              AS circle_weight_kg,
      COALESCE(pr.qty,0)                                                           AS qty,
      COALESCE(pr.scrap_weight_kg,0)                                               AS scrap_weight_kg,
      ROUND(COALESCE(pr.net_weight_kg,0) - COALESCE(pr.circle_weight_kg,0), 3)     AS balance_kg,
      CASE 
        WHEN COALESCE(pr.net_weight_kg,0) > 0 
        THEN ROUND(100.0 * COALESCE(pr.circle_weight_kg,0) / pr.net_weight_kg, 2)
        ELSE NULL
      END                                                                          AS yield_pct
    FROM patta_runs pr
    LEFT JOIN circle_runs cr   ON pr.source_type='circle' AND pr.patta_source_id = cr.id
    LEFT JOIN coils c          ON c.id = cr.coil_id
    LEFT JOIN patta_runs pr2   ON pr.source_type='patta'  AND pr.patta_source_id = pr2.id
    LEFT JOIN circle_runs cr2  ON pr2.source_type='circle' AND pr2.patta_source_id = cr2.id
    LEFT JOIN coils c2         ON c2.id = cr2.coil_id
    LEFT JOIN patta_runs pr3   ON pr2.source_type='patta'  AND pr2.patta_source_id = pr3.id
    LEFT JOIN circle_runs cr3  ON pr2.source_type='circle' AND pr2.patta_source_id = cr3.id
    LEFT JOIN coils c3         ON c3.id = cr3.coil_id
    ORDER BY pr.run_date DESC, pr.id DESC
  `,
  headers: [
    { key: "date",               label: "Date" },
    { key: "source_ref",         label: "Source Ref" },
    { key: "operator",           label: "Operator" },
    { key: "grade",              label: "Grade" },
    { key: "thickness_mm",       label: "Thickness (mm)" },
    { key: "patta_size",         label: "Patta size" },
    { key: "net_weight_kg",      label: "Net weight" },
    { key: "circle_size_mm",     label: "Circle size" },
    { key: "circle_weight_kg",   label: "Circle weight" },
    { key: "qty",                label: "Pcs" },
    { key: "scrap_weight_kg",    label: "Scrap" },
    { key: "balance_kg",         label: "Balance" },
    { key: "yield_pct",          label: "Yield %" },
  ],
},


 /* Circle Runs — match UI exactly */
{
  key: "circle_runs",
  sheet: "Circle Runs",
  filename: "circle_runs",
  sql: `
    SELECT
      cr.run_date                                               AS date,
      c.rn                                                      AS rn,
      cr.operator                                               AS operator,
      COALESCE(c.grade, cr.grade)                               AS grade,
      cr.thickness                                              AS thickness_mm,
      cr.width                                                  AS width_mm,
      cr.net_weight_kg                                          AS net_weight_kg,
      cr.op_size_mm                                             AS op_size_mm,
      COALESCE(cr.circle_weight_kg, 0)                          AS circle_weight_kg,
      COALESCE(cr.qty, 0)                                       AS qty,
      COALESCE(cr.scrap_weight_kg, 0)                           AS scrap_weight_kg,
      cr.patta_size                                             AS patta_size,
      COALESCE(cr.patta_weight_kg, 0)                           AS patta_weight_kg,
      cr.pl_size                                                AS pl_size,
      COALESCE(cr.pl_weight_kg, 0)                              AS pl_weight_kg,
      ROUND(COALESCE(cr.net_weight_kg,0) - COALESCE(cr.circle_weight_kg,0), 3) AS balance_kg,
      CASE
        WHEN COALESCE(cr.net_weight_kg,0) > 0
          THEN ROUND(100.0 * COALESCE(cr.circle_weight_kg,0) / cr.net_weight_kg, 2)
        ELSE NULL
      END                                                       AS yield_pct
    FROM circle_runs cr
    JOIN coils c ON c.id = cr.coil_id
    ORDER BY cr.run_date DESC, cr.id DESC
  `,
  headers: [
    { key: "date",              label: "Date" },
    { key: "rn",                label: "Coil RN no." },
    { key: "operator",          label: "Operator" },
    { key: "grade",             label: "Grade" },
    { key: "thickness_mm",      label: "Thickness" },
    { key: "width_mm",          label: "Width" },
    { key: "net_weight_kg",     label: "Net weight" },
    { key: "op_size_mm",        label: "Op. size" },
    { key: "circle_weight_kg",  label: "Circle weight" },
    { key: "qty",               label: "Pcs" },
    { key: "scrap_weight_kg",   label: "Scrap" },
    { key: "patta_size",        label: "Patta Size" },
    { key: "patta_weight_kg",   label: "Patta weight" },
    { key: "pl_size",           label: "PL Size" },
    { key: "pl_weight_kg",      label: "PL weight" },
    { key: "balance_kg",        label: "Balance" },
    { key: "yield_pct",         label: "Yield %" },
  ],
},


/* Circle Stock — match UI exactly */
{
  key: "circle_stock",
  sheet: "Circle Stock",
  filename: "circle_stock",
  sql: `
    SELECT
      cs.production_date                                           AS production_date,
      CASE
        WHEN cs.source_type='circle' THEN c.rn
        WHEN cs.source_type='patta'  THEN
          CASE
            WHEN pr.source_type='circle' THEN c2.rn
            WHEN pr.source_type='patta'  THEN 'PATTA-' || pr.patta_source_id
          END
      END                                                          AS source,
      CASE
        WHEN cs.source_type='circle' THEN 'Circle'
        WHEN cs.source_type='patta'  THEN 'Patta'
        ELSE cs.source_type
      END                                                          AS origin,
      CASE
        WHEN cs.source_type='circle' THEN cr.grade
        WHEN cs.source_type='patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade)
      END                                                          AS grade,
      CASE
        WHEN cs.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN cs.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
      END                                                          AS thickness_mm,
      cs.size_mm                                                   AS size_mm,
      MAX(0, cs.weight_kg - IFNULL(SUM(csl.sold_weight_kg),0))     AS available_weight_kg
    FROM circle_stock cs

    /* circle origin */
    LEFT JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id=cr.id
    LEFT JOIN coils c        ON c.id=cr.coil_id

    /* patta origin (+ one more hop if needed) */
    LEFT JOIN patta_runs pr   ON cs.source_type='patta'  AND cs.source_id=pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2        ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3        ON c3.id=cr3.coil_id

    LEFT JOIN circle_sales_new csl ON csl.stock_id = cs.id

    GROUP BY cs.id
    ORDER BY cs.production_date DESC, cs.id DESC
  `,
  headers: [
    { key: "production_date",     label: "Production Date" },
    { key: "source",              label: "Source" },
    { key: "origin",              label: "Origin" },
    { key: "grade",               label: "Grade" },
    { key: "thickness_mm",        label: "Thickness (mm)" },
    { key: "size_mm",             label: "Size (mm)" },
    { key: "available_weight_kg", label: "Available Weight (kg)" },
  ],
},


  /* Circle Sales — align with UI */
{
  key: "circle_sales",
  sheet: "Circle Sales",
  filename: "circle_sales",
  sql: `
    SELECT
      csl.sale_date                                                AS date,
      CASE 
        WHEN cs.source_type='circle' THEN c.rn
        WHEN cs.source_type='patta'  THEN 
          CASE WHEN pr.source_type='circle' THEN c2.rn
               WHEN pr.source_type='patta'  THEN 'PATTA-' || pr.patta_source_id END
      END                                                           AS source,
      CASE WHEN cs.source_type='circle' THEN COALESCE(cr.grade, c.grade)
           WHEN cs.source_type='patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade)
      END                                                           AS grade,
      CASE WHEN cs.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
           WHEN cs.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
      END                                                           AS thickness_mm,
      cs.size_mm                                                    AS size_mm,
      csl.buyer                                                     AS buyer,
      IFNULL(csl.sold_qty,0)                                        AS pcs,
      csl.sold_weight_kg                                            AS weight_kg,
      csl.price_per_kg                                              AS price_per_kg,
      (csl.sold_weight_kg * IFNULL(csl.price_per_kg,0))            AS total_value
    FROM circle_sales_new csl
    JOIN circle_stock cs ON cs.id = csl.stock_id
    LEFT JOIN circle_runs cr ON cs.source_type='circle' AND cs.source_id=cr.id
    LEFT JOIN coils c        ON c.id=cr.coil_id
    LEFT JOIN patta_runs pr  ON cs.source_type='patta' AND cs.source_id=pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2        ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3        ON c3.id=cr3.coil_id
    ORDER BY csl.sale_date DESC, csl.id DESC
  `,
  headers: [
    { key: "date",          label: "Sale Date" },
    { key: "source",        label: "Source" },
    { key: "grade",         label: "Grade" },
    { key: "thickness_mm",  label: "Thickness (mm)" },
    { key: "size_mm",       label: "Size (mm)" },
    { key: "buyer",         label: "Buyer" },
    { key: "pcs",           label: "Pcs" },
    { key: "weight_kg",     label: "Weight (kg)" },
    { key: "price_per_kg",  label: "Price/kg" },
    { key: "total_value",   label: "Total Value" },
  ],
},


/* Coil Direct Sales — match UI */
{
  key: "coil_direct_sales",
  aliases: ["coil_sales"],                 // /api/export/coil_sales will work
  sheet: "Coil Direct Sales",
  filename: "coil_direct_sales",
  sql: `
    SELECT
      s.sale_date         AS sale_date,
      c.rn                AS rn,
      c.grade             AS grade,
      s.sold_weight_kg    AS weight_kg,
      s.buyer             AS buyer,
      s.price_per_kg      AS price_per_kg
    FROM coil_direct_sales s
    JOIN coils c ON c.id = s.coil_id
    ORDER BY s.sale_date DESC, s.id DESC
  `,
  headers: [
    { key: "sale_date",   label: "Sale Date" },
    { key: "rn",          label: "RN" },
    { key: "grade",       label: "Grade" },
    { key: "weight_kg",   label: "Weight (kg)" },
    { key: "buyer",       label: "Buyer" },
    { key: "price_per_kg",label: "Price/kg" },
  ],
},

 /* PL Stock — align with UI */
{
  key: "pl_stock",
  sheet: "PL Stock",
  filename: "pl_stock",
  sql: `
    SELECT
      pls.production_date                                                                 AS date,
      CASE 
        WHEN pls.source_type='circle' THEN c.rn
        WHEN pls.source_type='patta'  THEN 'PATTA-' || pr.id
        WHEN pls.source_type='pl'     THEN 'PL-' || pl.id
      END                                                                                 AS source,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.grade, c.grade)
        WHEN pls.source_type='patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade, pls.grade)
        WHEN pls.source_type='pl'     THEN COALESCE(pls.grade, cr4.grade, c4.grade, cr5.grade, c5.grade)
      END                                                                                 AS grade,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN pls.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
        WHEN pls.source_type='pl'     THEN COALESCE(cr4.thickness, c4.thickness, cr5.thickness, c5.thickness)
      END                                                                                 AS thickness_mm,
      pls.size_mm                                                                         AS size_mm,
      MAX(0, IFNULL(pls.weight_kg,0))                                                     AS available_weight_kg
    FROM pl_stock pls
    LEFT JOIN pl_runs pl     ON pls.source_type='pl' AND pls.source_id=pl.id

    /* circle path */
    LEFT JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id=cr.id
    LEFT JOIN coils c        ON c.id=cr.coil_id

    /* patta path */
    LEFT JOIN patta_runs pr  ON pls.source_type='patta'  AND pls.source_id=pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2        ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3        ON c3.id=cr3.coil_id

    /* pl->circle or deeper (best-effort) */
    LEFT JOIN circle_runs cr4 ON pls.source_type='pl' AND pl.source_type='circle' AND pl.pl_source_id = cr4.id
    LEFT JOIN coils c4        ON c4.id = cr4.coil_id
    LEFT JOIN pl_runs pl2     ON pls.source_type='pl' AND pl.source_type='pl' AND pl.pl_source_id = pl2.id
    LEFT JOIN circle_runs cr5 ON pl2.source_type='circle' AND pl2.pl_source_id = cr5.id
    LEFT JOIN coils c5        ON c5.id = cr5.coil_id

    GROUP BY pls.id
    ORDER BY pls.production_date DESC, pls.id DESC
  `,
  headers: [
    { key: "date",                 label: "Date" },
    { key: "source",               label: "Source" },
    { key: "grade",                label: "Grade" },
    { key: "thickness_mm",         label: "Thickness (mm)" },
    { key: "size_mm",              label: "Size (mm)" },
    { key: "available_weight_kg",  label: "Available Weight (kg)" },
  ],
},

  /* PL Sales — align with UI */
{
  key: "pl_sales",
  sheet: "PL Sales",
  filename: "pl_sales",
  sql: `
    SELECT
      ps.sale_date                                                                       AS date,
      CASE 
        WHEN pls.source_type='circle' THEN c.rn
        WHEN pls.source_type='patta'  THEN 'PATTA-' || pr.id
        WHEN pls.source_type='pl'     THEN 'PL-' || pl.id
      END                                                                                AS source,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.grade, c.grade)
        WHEN pls.source_type='patta'  THEN COALESCE(pr.grade, cr2.grade, c2.grade, cr3.grade, c3.grade, pls.grade)
        WHEN pls.source_type='pl'     THEN COALESCE(pls.grade, cr4.grade, c4.grade, cr5.grade, c5.grade)
      END                                                                                AS grade,
      CASE
        WHEN pls.source_type='circle' THEN COALESCE(cr.thickness, c.thickness)
        WHEN pls.source_type='patta'  THEN COALESCE(cr2.thickness, c2.thickness, cr3.thickness, c3.thickness)
        WHEN pls.source_type='pl'     THEN COALESCE(cr4.thickness, c4.thickness, cr5.thickness, c5.thickness)
      END                                                                                AS thickness_mm,
      pls.size_mm                                                                        AS size_mm,
      ps.buyer                                                                           AS buyer,
      ps.sold_weight_kg                                                                  AS weight_kg,
      ps.price_per_kg                                                                    AS price_per_kg,
      (ps.sold_weight_kg * IFNULL(ps.price_per_kg,0))                                    AS total_value
    FROM pl_sales ps
    JOIN pl_stock pls ON ps.pl_stock_id = pls.id
    LEFT JOIN pl_runs pl     ON pls.source_type='pl' AND pls.source_id=pl.id

    /* circle path */
    LEFT JOIN circle_runs cr ON pls.source_type='circle' AND pls.source_id=cr.id
    LEFT JOIN coils c        ON c.id=cr.coil_id

    /* patta path */
    LEFT JOIN patta_runs pr  ON pls.source_type='patta' AND pls.source_id=pr.id
    LEFT JOIN circle_runs cr2 ON pr.source_type='circle' AND pr.patta_source_id=cr2.id
    LEFT JOIN coils c2        ON c2.id=cr2.coil_id
    LEFT JOIN patta_runs pr2  ON pr.source_type='patta'  AND pr.patta_source_id=pr2.id
    LEFT JOIN circle_runs cr3 ON pr2.source_type='circle' AND pr2.patta_source_id=cr3.id
    LEFT JOIN coils c3        ON c3.id=cr3.coil_id

    /* pl->circle or deeper (best-effort) */
    LEFT JOIN circle_runs cr4 ON pls.source_type='pl' AND pl.source_type='circle' AND pl.pl_source_id = cr4.id
    LEFT JOIN coils c4        ON c4.id = cr4.coil_id
    LEFT JOIN pl_runs pl2     ON pls.source_type='pl' AND pl.source_type='pl' AND pl.pl_source_id = pl2.id
    LEFT JOIN circle_runs cr5 ON pl2.source_type='circle' AND pl2.pl_source_id = cr5.id
    LEFT JOIN coils c5        ON c5.id = cr5.coil_id

    ORDER BY ps.sale_date DESC, ps.id DESC
  `,
  headers: [
    { key: "date",          label: "Sale Date" },
    { key: "source",        label: "Source" },
    { key: "grade",         label: "Grade" },
    { key: "thickness_mm",  label: "Thickness (mm)" },
    { key: "size_mm",       label: "Size (mm)" },
    { key: "buyer",         label: "Buyer" },
    { key: "weight_kg",     label: "Weight (kg)" },
    { key: "price_per_kg",  label: "Price/kg" },
    { key: "total_value",   label: "Total Value" },
  ],
},

 /* Scrap Sales — align with UI (note exact label casing) */
{
  key: "scrap_sales",
  sheet: "Scrap Sales",
  filename: "scrap_sales",
  sql: `
    SELECT
      sale_date                                   AS date,
      buyer                                       AS buyer,
      grade                                       AS grade,
      rn                                          AS rn,
      weight_kg                                   AS weight_kg,
      price_per_kg                                AS price_per_kg,
      (weight_kg * IFNULL(price_per_kg,0))        AS total_value
    FROM scrap_sales
    ORDER BY sale_date DESC, id DESC
  `,
  headers: [
    { key: "date",         label: "Sale Date" },
    { key: "buyer",        label: "Buyer" },
    { key: "grade",        label: "Grade" },
    { key: "rn",           label: "RN" },
    { key: "weight_kg",    label: "Weight (kg)" },
    { key: "price_per_kg", label: "Price/kg" },
    { key: "total_value",  label: "Total ValuE" }, // exact casing per your UI
  ],
},


  /* Orders — align with UI */
{
  key: "orders",
  sheet: "Orders",
  filename: "orders",
  sql: `
    SELECT
      id                                                      AS order_no,
      order_date                                              AS order_date,
      order_by                                                AS order_by,
      company                                                 AS company,
      grade                                                   AS grade,
      thickness_mm                                            AS thickness_mm,
      op_size_mm                                              AS op_size_mm,
      ordered_qty_pcs                                         AS ordered_qty_pcs,
      ordered_weight_kg                                       AS ordered_weight_kg,
      fulfilled_weight_kg                                     AS fulfilled_weight_kg,
      MAX(0, IFNULL(ordered_weight_kg,0) - IFNULL(fulfilled_weight_kg,0)) AS remaining_weight_kg,
      cancelled_at                                            AS cancelled_on,
      status                                                  AS status
    FROM orders
    ORDER BY
      (order_date IS NULL OR TRIM(order_date)='') ASC,
      COALESCE(datetime(NULLIF(order_date,'')), date(NULLIF(order_date,''))) DESC,
      order_no DESC
  `,
  headers: [
    { key: "order_no",             label: "Order No" },
    { key: "order_date",           label: "Order Date" },
    { key: "order_by",             label: "Order By" },
    { key: "company",              label: "Company" },
    { key: "grade",                label: "Grade" },
    { key: "thickness_mm",         label: "Thickness" },          // exact UI text
    { key: "op_size_mm",           label: "Op. Size (mm)" },
    { key: "ordered_qty_pcs",      label: "Ordered Pcs" },
    { key: "ordered_weight_kg",    label: "Ordered (kg)" },
    { key: "fulfilled_weight_kg",  label: "Fulfilled (kg)" },
    { key: "remaining_weight_kg",  label: "Remaining (kg)" },
    { key: "cancelled_on",         label: "Cancelled On" },
    { key: "status",               label: "Status" },
  ],
},

/* Yield — new export to match UI */
{
  key: "yield",
  sheet: "Yield",
  filename: "yield",
  sql: `
    WITH cir AS (
      SELECT coil_id, SUM(net_weight_kg) AS circle_net, SUM(circle_weight_kg) AS circle_out
      FROM circle_runs
      GROUP BY coil_id
    ),
    pat AS (
      SELECT
        COALESCE(cr.coil_id, cr2.coil_id) AS coil_id,
        SUM(pr.net_weight_kg)             AS patta_net,
        SUM(pr.circle_weight_kg)          AS patta_out
      FROM patta_runs pr
      LEFT JOIN circle_runs cr
             ON pr.source_type='circle' AND pr.patta_source_id = cr.id
      LEFT JOIN patta_runs pr2
             ON pr.source_type='patta'  AND pr.patta_source_id = pr2.id
      LEFT JOIN circle_runs cr2
             ON pr2.source_type='circle' AND pr2.patta_source_id = cr2.id
      GROUP BY COALESCE(cr.coil_id, cr2.coil_id)
    )
    SELECT
      c.rn                                          AS coil_rn,
      c.grade                                       AS grade,
      IFNULL(cir.circle_net, 0)                     AS net_weight_kg,
      CASE WHEN IFNULL(cir.circle_net,0) > 0
           THEN ROUND(100.0 * IFNULL(cir.circle_out,0) / cir.circle_net, 2)
           ELSE NULL END                            AS circle_yield_pct,
      CASE WHEN IFNULL(pat.patta_net,0) > 0
           THEN ROUND(100.0 * IFNULL(pat.patta_out,0) / pat.patta_net, 2)
           ELSE NULL END                            AS patta_yield_pct,
      CASE WHEN IFNULL(cir.circle_net,0) > 0
           THEN ROUND(100.0 * (IFNULL(cir.circle_out,0) + IFNULL(pat.patta_out,0)) / cir.circle_net, 2)
           ELSE NULL END                            AS total_yield_pct
    FROM coils c
    LEFT JOIN cir ON cir.coil_id = c.id
    LEFT JOIN pat ON pat.coil_id = c.id
    WHERE cir.circle_net IS NOT NULL OR pat.patta_net IS NOT NULL
    ORDER BY c.created_at DESC, c.id DESC
  `,
  headers: [
    { key: "coil_rn",          label: "Coil RN" },
    { key: "grade",            label: "Grade" },
    { key: "net_weight_kg",    label: "Net Weight (kg)" },
    { key: "circle_yield_pct", label: "Circle Yield %" },
    { key: "patta_yield_pct",  label: "Patta Yield %" },
    { key: "total_yield_pct",  label: "Total Yield %" },
  ],
},

  /* Dispatched — order-level view with fulfillment */
{
  key: "dispatched",
  sheet: "Dispatched",
  filename: "dispatched",
  sql: `
    SELECT
      o.id                                   AS order_no,
      o.order_date                           AS order_date,
      o.order_by                             AS order_by,
      o.company                              AS company,
      o.grade                                AS grade,
      o.thickness_mm                         AS thickness,
      o.op_size_mm                           AS op_size_mm,
      o.ordered_weight_kg                    AS ordered_kg,
      IFNULL(SUM(csl.sold_weight_kg), 0)     AS fulfilled_kg,
      o.status                               AS status
    FROM orders o
    LEFT JOIN circle_sales_new csl ON csl.order_no = o.id
    GROUP BY o.id
    HAVING IFNULL(SUM(csl.sold_weight_kg), 0) > 0
    ORDER BY COALESCE(datetime(NULLIF(o.order_date,'')), date(NULLIF(o.order_date,''))) DESC, o.id DESC
  `,
  headers: [
    { key: "order_no",      label: "Order No" },
    { key: "order_date",    label: "Order Date" },
    { key: "order_by",      label: "Order By" },
    { key: "company",       label: "Company" },
    { key: "grade",         label: "Grade" },
    { key: "thickness",     label: "Thickness" },
    { key: "op_size_mm",    label: "Op. Size (mm)" },
    { key: "ordered_kg",    label: "Ordered (kg)" },
    { key: "fulfilled_kg",  label: "Fulfilled (kg)" },
    { key: "status",        label: "Status" },
  ],
},
];

// Export "all" → redirect to bulk exporter
app.get('/api/export/all', (_req, res) => {
  res.redirect(307, '/api/export-all');
});

// Export one tab only
app.get('/api/export/:tab', (req, res) => {
  try {
    const def = EXPORTS.find(e =>
      e.key === String(req.params.tab).toLowerCase() ||
      (e.aliases && e.aliases.includes(String(req.params.tab).toLowerCase()))
    );
    if (!def) return res.status(400).json({ error: 'Unknown tab: ' + req.params.tab });

    const rows = all(def.sql);
    const wb = new ExcelJS.Workbook();
    addSheet(wb, def.sheet, rows, def.headers);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${def.filename}.xlsx`);
    res.setHeader('Cache-Control', 'no-store');

    wb.xlsx.write(res).then(() => res.end());
  } catch (e) {
    console.error("Export failed:", e);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Export ALL tabs into one workbook
app.get('/api/export-all', (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    for (const def of EXPORTS) {
      const rows = all(def.sql);
      addSheet(wb, def.sheet, rows, def.headers);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=all_tabs.xlsx');
    res.setHeader('Cache-Control', 'no-store');

    wb.xlsx.write(res).then(() => res.end());
  } catch (e) {
    console.error("Export-all failed:", e);
    res.status(500).json({ error: 'Export-all failed' });
  }
});

app.get("/api/_health/db", async (req, res) => {
  try {
    const r = await query(
      "select now() as now, current_database() as db, version() as version"
    );
    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    console.error("DB healthcheck failed:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

(async () => {
  try {
    await query("select 1");
    console.log("✅ Connected to Postgres");
  } catch (e) {
    console.error("❌ Postgres connection failed:", e.message);
  }
})();

// Serve frontend build

const PORT = process.env.PORT || 4000;

// Serve frontend (React build)
const frontendPath = path.join(__dirname, "../Frontend/dist");
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));

  // Catch-all → send React index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });
}

// 🚨 DEBUG ONLY: List all users
app.get("/api/debug/users", (req, res) => {
  try {
    const users = db.prepare("SELECT id, username, role FROM users").all();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Could not fetch users" });
  }
});

// 🚨 DEBUG ONLY — remove later
app.get("/api/debug/pl-stock", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM pl_stock").all();
    res.json(rows);
  } catch (err) {
    console.error("Debug PL Stock failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log("API running on :" + PORT));

