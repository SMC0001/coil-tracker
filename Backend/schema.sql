PRAGMA foreign_keys = ON;

/* ========================
   CORE CRM TABLES
======================== */
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  country TEXT,
  city TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT,
  email TEXT,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  source TEXT,
  value_estimate REAL,
  status TEXT NOT NULL DEFAULT 'New',
  priority TEXT DEFAULT 'Normal',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL,
  unit TEXT,
  grade TEXT,
  dimensions TEXT,
  target_price REAL
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT,
  by_user TEXT,
  at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_updated ON enquiries(updated_at);

/* ========================
   COIL TRACKING TABLES
======================== */
CREATE TABLE IF NOT EXISTS coils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rn TEXT UNIQUE NOT NULL,            -- e.g. RN202508-0001
  grade TEXT,
  thickness REAL,                     -- mm
  width REAL,                         -- mm
  supplier TEXT,
  heat_no TEXT,
  purchase_weight_kg REAL NOT NULL,
  purchase_date TEXT,                 -- YYYY-MM-DD
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coils_rn ON coils(rn);

/* legacy tables kept (used for direct sells etc.) */
CREATE TABLE IF NOT EXISTS coil_direct_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coil_id INTEGER NOT NULL REFERENCES coils(id) ON DELETE CASCADE,
  sold_weight_kg REAL NOT NULL,
  buyer TEXT,
  price_per_kg REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circle_sales (  -- kept for compatibility
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coil_cut_id INTEGER,                -- not used by new design
  sold_weight_kg REAL NOT NULL,
  buyer TEXT,
  price_per_kg REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coil_scrap (    -- manual scrap log (optional)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coil_id INTEGER NOT NULL REFERENCES coils(id) ON DELETE CASCADE,
  scrap_weight_kg REAL NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

/* ========================
   CIRCLE PRODUCTION RUNS  (source of truth for Circle/Patta/Scrap tabs)
======================== */
CREATE TABLE IF NOT EXISTS circle_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coil_id INTEGER NOT NULL REFERENCES coils(id) ON DELETE CASCADE,
  run_date TEXT NOT NULL,                 -- YYYY-MM-DD
  operator TEXT,                          -- Duta / Jay Prakash / Majesh / Ram Patel / Sunil
  grade TEXT,
  thickness REAL,
  width REAL,
  net_weight_kg REAL,                     -- input weight
  op_size_mm REAL,                        -- operator size (circle dia)
  circle_weight_kg REAL,                  -- output circle total weight
  qty INTEGER,                            -- no. of circles
  scrap_weight_kg REAL,                   -- scrap from this run
  patta_size TEXT,                        -- e.g. "50mm"
  patta_weight_kg REAL,                   -- patta total weight
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_circle_runs_coil ON circle_runs(coil_id);
CREATE INDEX IF NOT EXISTS idx_circle_runs_date ON circle_runs(run_date);
CREATE INDEX IF NOT EXISTS idx_circle_runs_operator ON circle_runs(operator);

/* ========================
   PATTA PRODUCTION RUNS
======================== */
CREATE TABLE IF NOT EXISTS patta_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patta_source_id INTEGER NOT NULL, -- references circle_runs.id or other patta_runs.id
  source_type TEXT NOT NULL CHECK(source_type IN ('circle', 'patta')), -- what was cut
  run_date TEXT NOT NULL,
  operator TEXT,
  net_weight_kg REAL,           -- input patta weight
  op_size_mm REAL,              -- size being cut
  circle_weight_kg REAL,        -- circles produced from patta
  qty INTEGER,                  -- number of circles
  scrap_weight_kg REAL,         -- scrap from patta cutting
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patta_runs_source ON patta_runs(patta_source_id, source_type);

/* ========================
   STOCK & SALES
======================== */
-- Stock table to track all produced circles (not yet sold)
CREATE TABLE IF NOT EXISTS circle_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK(source_type IN ('circle', 'patta')),
  source_id INTEGER NOT NULL,   -- circle_runs.id or patta_runs.id
  size_mm REAL,
  weight_kg REAL NOT NULL,
  qty INTEGER NOT NULL,
  production_date TEXT NOT NULL,
  operator TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_type, source_id)
);

-- Sales table for actual circle sales
CREATE TABLE IF NOT EXISTS circle_sales_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id INTEGER NOT NULL REFERENCES circle_stock(id) ON DELETE CASCADE,
  sold_qty INTEGER NOT NULL,
  sold_weight_kg REAL NOT NULL,
  buyer TEXT,
  price_per_kg REAL,
  sale_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_circle_stock_source ON circle_stock(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_circle_sales_stock ON circle_sales_new(stock_id);