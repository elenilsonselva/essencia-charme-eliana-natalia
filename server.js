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
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`SELECT * FROM clients ORDER BY name ASC, id ASC`);
    res.json(result.rows);
  })
);

app.post(
  "/api/clients",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, phone, address, notes } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do cliente." });
    }

    const result = await pool.query(
      `INSERT INTO clients (name, phone, address, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [
        String(name).trim(),
        String(phone || "").trim() || null,
        String(address || "").trim() || null,
        String(notes || "").trim() || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

app.put(
  "/api/clients/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const { name, phone, address, notes } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do cliente." });
    }

    const result = await pool.query(
      `UPDATE clients SET name = $1, phone = $2, address = $3, notes = $4 WHERE id = $5 RETURNING *`,
      [
        String(name).trim(),
        String(phone || "").trim() || null,
        String(address || "").trim() || null,
        String(notes || "").trim() || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/clients/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const result = await pool.query(`DELETE FROM clients WHERE id = $1 RETURNING id`, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    res.json({ ok: true });
  })
);

/* =========================================================
   FORNECEDORES
========================================================= */

app.get(
  "/api/suppliers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`SELECT * FROM suppliers ORDER BY name ASC, id ASC`);
    res.json(result.rows);
  })
);

app.post(
  "/api/suppliers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, phone, whatsapp, document, address, notes } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do fornecedor." });
    }

    const result = await pool.query(
      `INSERT INTO suppliers (name, phone, whatsapp, document, address, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        String(name).trim(),
        String(phone || "").trim() || null,
        String(whatsapp || "").trim() || null,
        String(document || "").trim() || null,
        String(address || "").trim() || null,
        String(notes || "").trim() || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

app.put(
  "/api/suppliers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const { name, phone, whatsapp, document, address, notes } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Informe o nome do fornecedor." });
    }

    const result = await pool.query(
      `UPDATE suppliers SET name = $1, phone = $2, whatsapp = $3, document = $4, address = $5, notes = $6 WHERE id = $7 RETURNING *`,
      [
        String(name).trim(),
        String(phone || "").trim() || null,
        String(whatsapp || "").trim() || null,
        String(document || "").trim() || null,
        String(address || "").trim() || null,
        String(notes || "").trim() || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Fornecedor não encontrado." });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/suppliers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);
    const result = await pool.query(`DELETE FROM suppliers WHERE id = $1 RETURNING id`, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Fornecedor não encontrado." });
    }

    res.json({ ok: true });
  })
);

/* =========================================================
   ESTOQUE
========================================================= */

app.get(
  "/api/stock",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT p.id, p.code, p.name, p.brand, p.size, p.cost, p.price, p.stock, p.min_stock,
      CASE WHEN p.stock <= p.min_stock THEN true ELSE false END AS low_stock
      FROM products p ORDER BY p.name ASC
    `);
    res.json(result.rows);
  })
);

app.get(
  "/api/stock/moves",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT sm.*, p.name AS product_name, p.code AS product_code
      FROM stock_moves sm JOIN products p ON p.id = sm.product_id
      ORDER BY sm.created_at DESC, sm.id DESC
    `);
    res.json(result.rows);
  })
);

app.post(
  "/api/stock/move",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { product_id, quantity, type, note } = req.body;
    const productId = integer(product_id);
    const qty = integer(quantity);
    const moveType = String(type || "").toLowerCase();

    if (!productId) {
      return res.status(400).json({ error: "Selecione um produto." });
    }
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: "Informe uma quantidade válida." });
    }
    if (moveType !== "entrada" && moveType !== "saida") {
      return res.status(400).json({ error: "Tipo de movimentação inválido." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `SELECT id, stock FROM products WHERE id = $1 FOR UPDATE`,
        [productId]
      );

      if (!productResult.rows.length) {
        throw new Error("Produto não encontrado.");
      }

      const currentStock = integer(productResult.rows[0].stock);

      if (moveType === "saida" && currentStock < qty) {
        throw new Error("Estoque insuficiente para essa saída.");
      }

      const newStock = moveType === "entrada" ? currentStock + qty : currentStock - qty;

      await client.query(
        `UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2`,
        [newStock, productId]
      );

      const result = await client.query(
        `INSERT INTO stock_moves (product_id, quantity, type, note, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, 'manual', NULL) RETURNING *`,
        [productId, qty, moveType, String(note || "").trim() || null]
      );

      await client.query("COMMIT");
      res.status(201).json({ ok: true, move: result.rows[0], stock: newStock });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   VENDAS
========================================================= */

app.get(
  "/api/sales",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT s.*, c.name AS client_name,
      COALESCE((SELECT COUNT(*) FROM sale_installments si WHERE si.sale_id = s.id), 0)::INTEGER AS installment_count
      FROM sales s LEFT JOIN clients c ON c.id = s.client_id
      ORDER BY s.date DESC, s.id DESC
    `);
    res.json(result.rows);
  })
);

app.get(
  "/api/sales/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const saleResult = await pool.query(
      `SELECT s.*, c.name AS client_name, c.phone AS client_phone, c.address AS client_address
       FROM sales s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = $1`,
      [id]
    );

    if (!saleResult.rows.length) {
      return res.status(404).json({ error: "Venda não encontrada." });
    }

    const itemsResult = await pool.query(
      `SELECT si.*, p.name AS product_name, p.code AS product_code, p.brand AS product_brand, p.size AS product_size
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 ORDER BY si.id`,
      [id]
    );

    const installmentsResult = await pool.query(
      `SELECT * FROM sale_installments WHERE sale_id = $1 ORDER BY installment_no`,
      [id]
    );

    const paymentsResult = await pool.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at ASC, id ASC`,
      [id]
    );

    res.json({
      sale: saleResult.rows[0],
      items: itemsResult.rows,
      installments: installmentsResult.rows,
      payments: paymentsResult.rows,
    });
  })
);

app.get(
  "/api/sales/:id/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const saleId = integer(req.params.id);

    const saleResult = await pool.query(
      `SELECT s.*, c.name AS client_name, c.phone AS client_phone, c.address AS client_address
       FROM sales s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = $1`,
      [saleId]
    );

    if (!saleResult.rows.length) {
      return res.status(404).json({ error: "Venda não encontrada." });
    }

    const sale = saleResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT si.*, p.name AS product_name, p.code AS product_code, p.brand AS product_brand, p.size AS product_size
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 ORDER BY si.id`,
      [saleId]
    );

    const installmentsResult = await pool.query(
      `SELECT * FROM sale_installments WHERE sale_id = $1 ORDER BY installment_no`,
      [saleId]
    );

    const paymentsResult = await pool.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at ASC, id ASC`,
      [saleId]
    );

    // Inicialização do PDFKit
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="venda-${saleId}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Funções auxiliares locais do PDF
    function brl(value) {
      return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    function dateBR(value) {
      if (!value) return "";
      const text = String(value).slice(0, 10);
      const parts = text.split("-");
      if (parts.length !== 3) return text;
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    // Exemplo de cabeçalho básico no PDF
    doc.fontSize(16).font("Helvetica-Bold").text("COMPROVANTE DE VENDA", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(10).font("Helvetica").text(`Venda ID: #${sale.id} | Data: ${dateBR(sale.date)}`);
    doc.text(`Cliente: ${sale.client_name || "Cliente não informado"}`);
    doc.moveDown(1);

    if (installmentsResult.rows.length) {
      doc.fontSize(12).font("Helvetica-Bold").text("PARCELAS");
      doc.moveDown(0.4);

      for (const installment of installmentsResult.rows) {
        const installmentText = `${installment.installment_no}ª parcela — vencimento ${dateBR(installment.due_date)} — valor ${brl(installment.amount)} — pago ${brl(installment.paid_amount)} — ${installment.status || ""}`;
        
        const rowY = doc.y;
        doc.rect(doc.page.margins.left, rowY - 2, pageWidth, 22).stroke();
        doc.fontSize(9).font("Helvetica").text(installmentText, doc.page.margins.left + 8, rowY + 5, { width: pageWidth - 16 });
        doc.y = rowY + 25;
      }
    }

    doc.end();
  })
);

/* =========================================================
   INICIALIZAÇÃO DO SERVIDOR
========================================================= */

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar banco de dados:", err);
  });
