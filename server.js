const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 7;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   UTILITÁRIOS
========================================================= */

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function integer(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const d = new Date(`${date}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + integer(days));
  return d.toISOString().slice(0, 10);
}

function calculateStatus(total, paid) {
  const t = money(total);
  const p = money(paid);
  const balance = money(Math.max(0, t - p));

  if (balance <= 0.005) return "Pago";
  if (p > 0.005) return "Parcial";
  return "Em aberto";
}

function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

function sendError(res, error, fallback = "Ocorreu um erro.") {
  console.error(error);

  if (error && error.code === "23505") {
    return res.status(409).json({
      error: "Já existe um cadastro com esses dados.",
    });
  }

  if (error && error.code === "23503") {
    return res.status(409).json({
      error: "Este registro está sendo utilizado por outro cadastro.",
    });
  }

  return res.status(500).json({
    error: error?.message || fallback,
  });
}

function brl(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dateBR(value) {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  const parts = text.split("-");
  if (parts.length !== 3) return text;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   UTILITÁRIOS PIX (EMV QRCPS)
========================================================= */

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function pixField(id, value) {
  const text = String(value);
  return id + text.length.toString().padStart(2, "0") + text;
}

function createPixPayload(pixKey, merchantName, merchantCity, amount, txid = "***") {
  const key = String(pixKey || "").trim();
  const name = String(merchantName || "RECEBEDOR").trim().slice(0, 25);
  const city = String(merchantCity || "CIDADE").trim().slice(0, 15);
  
  const merchantAccount =
    pixField("00", "BR.GOV.BCB.PIX") +
    pixField("01", key);

  let payload =
    pixField("00", "01") +
    pixField("26", merchantAccount) +
    pixField("52", "0000") +
    pixField("53", "986");

  if (amount && Number(amount) > 0) {
    payload += pixField("54", Number(amount).toFixed(2));
  }

  payload +=
    pixField("58", "BR") +
    pixField("59", name) +
    pixField("60", city) +
    pixField("62", pixField("05", txid)) +
    "6304";

  return payload + crc16(payload);
}

/* =========================================================
   BANCO DE DADOS
========================================================= */

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      whatsapp VARCHAR(50),
      document VARCHAR(50),
      address TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      address TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100),
      name VARCHAR(200) NOT NULL,
      brand VARCHAR(150),
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      size VARCHAR(100),
      cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      photo TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment VARCHAR(100),
      installments INTEGER NOT NULL DEFAULT 1,
      entry NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Em aberto',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_installments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      due_date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Em aberto',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sale_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      installment_id INTEGER REFERENCES sale_installments(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      payment VARCHAR(100),
      paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      entry NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      installments INTEGER NOT NULL DEFAULT 1,
      payment VARCHAR(100),
      status VARCHAR(30) NOT NULL DEFAULT 'Em aberto',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS purchase_installments (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      due_date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Em aberto',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS purchase_payments (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      installment_id INTEGER REFERENCES purchase_installments(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      payment VARCHAR(100),
      paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_moves (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      type VARCHAR(30) NOT NULL,
      note TEXT,
      reference_type VARCHAR(50),
      reference_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(128) PRIMARY KEY,
      username VARCHAR(150) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
    CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves(product_id);
    CREATE INDEX IF NOT EXISTS idx_sale_installments_sale ON sale_installments(sale_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_installments_purchase ON purchase_installments(purchase_id);
  `);

  console.log("Banco de dados inicializado.");
}

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.session;

    if (!token) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    const result = await pool.query(
      `SELECT id, username FROM sessions WHERE id = $1 AND expires_at > NOW()`,
      [token]
    );

    if (!result.rows.length) {
      res.clearCookie("session");
      return res.status(401).json({ error: "Sessão expirada." });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    return sendError(res, error);
  }
}

app.get(
  "/api/me",
  asyncHandler(async (req, res) => {
    const token = req.cookies.session;

    if (!token) {
      return res.json({ authenticated: false });
    }

    const result = await pool.query(
      `SELECT username FROM sessions WHERE id = $1 AND expires_at > NOW()`,
      [token]
    );

    if (!result.rows.length) {
      res.clearCookie("session");
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      username: result.rows[0].username,
    });
  })
);

app.post(
  "/api/login",
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "123456";

    if (username !== adminUser || password !== adminPassword) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await pool.query(
      `INSERT INTO sessions (id, username, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,
      [token, username]
    );

    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true, username });
  })
);

app.post(
  "/api/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies.session;

    if (token) {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [token]);
    }

    res.clearCookie("session");
    res.json({ ok: true });
  })
);

/* =========================================================
   PRODUTOS
========================================================= */

app.get(
  "/api/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT p.*, s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      ORDER BY p.name ASC, p.id ASC
    `);
    res.json(result.rows);
  })
);

app.post(
  "/api/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code, name, brand, supplier_id, size, cost, price, stock, min_stock, photo } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do produto." });
    }

    const result = await pool.query(
      `INSERT INTO products (code, name, brand, supplier_id, size, cost, price, stock, min_stock, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        String(code || "").trim() || null,
        String(name).trim(),
        String(brand || "").trim() || null,
        supplier_id ? integer(supplier_id) : null,
        String(size || "").trim() || null,
        money(cost),
        money(price),
        integer(stock),
        integer(min_stock),
        photo || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

app.put(
  "/api/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const { code, name, brand, supplier_id, size, cost, price, stock, min_stock, photo } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do produto." });
    }

    const result = await pool.query(
      `UPDATE products SET code = $1, name = $2, brand = $3, supplier_id = $4, size = $5, cost = $6, price = $7, stock = $8, min_stock = $9, photo = $10, updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [
        String(code || "").trim() || null,
        String(name).trim(),
        String(brand || "").trim() || null,
        supplier_id ? integer(supplier_id) : null,
        String(size || "").trim() || null,
        money(cost),
        money(price),
        integer(stock),
        integer(min_stock),
        photo || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const result = await pool.query(`DELETE FROM products WHERE id = $1 RETURNING id`, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    res.json({ ok: true });
  })
);

/* =========================================================
   CLIENTES
========================================================= */

app.get(
  "/api/clients",
