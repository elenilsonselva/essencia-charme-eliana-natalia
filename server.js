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

    CREATE INDEX IF NOT EXISTS idx_products_name
      ON products(name);

    CREATE INDEX IF NOT EXISTS idx_sales_date
      ON sales(date);

    CREATE INDEX IF NOT EXISTS idx_purchases_date
      ON purchases(date);

    CREATE INDEX IF NOT EXISTS idx_stock_moves_product
      ON stock_moves(product_id);

    CREATE INDEX IF NOT EXISTS idx_sale_installments_sale
      ON sale_installments(sale_id);

    CREATE INDEX IF NOT EXISTS idx_purchase_installments_purchase
      ON purchase_installments(purchase_id);
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
      return res.status(401).json({
        error: "Não autenticado.",
      });
    }

    const result = await pool.query(
      `
      SELECT id, username
      FROM sessions
      WHERE id = $1
        AND expires_at > NOW()
      `,
      [token]
    );

    if (!result.rows.length) {
      res.clearCookie("session");

      return res.status(401).json({
        error: "Sessão expirada.",
      });
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
      return res.json({
        authenticated: false,
      });
    }

    const result = await pool.query(
      `
      SELECT username
      FROM sessions
      WHERE id = $1
        AND expires_at > NOW()
      `,
      [token]
    );

    if (!result.rows.length) {
      res.clearCookie("session");

      return res.json({
        authenticated: false,
      });
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
    const adminPassword =
      process.env.ADMIN_PASSWORD || "123456";

    if (
      username !== adminUser ||
      password !== adminPassword
    ) {
      return res.status(401).json({
        error: "Usuário ou senha inválidos.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await pool.query(
      `
      INSERT INTO sessions (
        id,
        username,
        expires_at
      )
      VALUES (
        $1,
        $2,
        NOW() + INTERVAL '${SESSION_DAYS} days'
      )
      `,
      [token, username]
    );

    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      username,
    });
  })
);

app.post(
  "/api/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies.session;

    if (token) {
      await pool.query(
        `DELETE FROM sessions WHERE id = $1`,
        [token]
      );
    }

    res.clearCookie("session");

    res.json({
      ok: true,
    });
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
      SELECT
        p.*,
        s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s
        ON s.id = p.supplier_id
      ORDER BY p.name ASC, p.id ASC
    `);

    res.json(result.rows);
  })
);

app.post(
  "/api/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      code,
      name,
      brand,
      supplier_id,
      size,
      cost,
      price,
      stock,
      min_stock,
      photo,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do produto.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO products (
        code,
        name,
        brand,
        supplier_id,
        size,
        cost,
        price,
        stock,
        min_stock,
        photo
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      RETURNING *
      `,
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

    const {
      code,
      name,
      brand,
      supplier_id,
      size,
      cost,
      price,
      stock,
      min_stock,
      photo,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do produto.",
      });
    }

    const result = await pool.query(
      `
      UPDATE products
      SET
        code = $1,
        name = $2,
        brand = $3,
        supplier_id = $4,
        size = $5,
        cost = $6,
        price = $7,
        stock = $8,
        min_stock = $9,
        photo = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
      `,
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
      return res.status(404).json({
        error: "Produto não encontrado.",
      });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM products
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Produto não encontrado.",
      });
    }

    res.json({
      ok: true,
    });
  })
);

/* =========================================================
   CLIENTES
========================================================= */

app.get(
  "/api/clients",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT *
      FROM clients
      ORDER BY name ASC, id ASC
    `);

    res.json(result.rows);
  })
);

app.post(
  "/api/clients",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      name,
      phone,
      address,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do cliente.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO clients (
        name,
        phone,
        address,
        notes
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
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

    const {
      name,
      phone,
      address,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do cliente.",
      });
    }

    const result = await pool.query(
      `
      UPDATE clients
      SET
        name = $1,
        phone = $2,
        address = $3,
        notes = $4
      WHERE id = $5
      RETURNING *
      `,
      [
        String(name).trim(),
        String(phone || "").trim() || null,
        String(address || "").trim() || null,
        String(notes || "").trim() || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Cliente não encontrado.",
      });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/clients/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM clients
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Cliente não encontrado.",
      });
    }

    res.json({
      ok: true,
    });
  })
);

/* =========================================================
   FORNECEDORES
========================================================= */

app.get(
  "/api/suppliers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT *
      FROM suppliers
      ORDER BY name ASC, id ASC
    `);

    res.json(result.rows);
  })
);

app.post(
  "/api/suppliers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      name,
      phone,
      whatsapp,
      document,
      address,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do fornecedor.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO suppliers (
        name,
        phone,
        whatsapp,
        document,
        address,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
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

    const {
      name,
      phone,
      whatsapp,
      document,
      address,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do fornecedor.",
      });
    }

    const result = await pool.query(
      `
      UPDATE suppliers
      SET
        name = $1,
        phone = $2,
        whatsapp = $3,
        document = $4,
        address = $5,
        notes = $6
      WHERE id = $7
      RETURNING *
      `,
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
      return res.status(404).json({
        error: "Fornecedor não encontrado.",
      });
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/suppliers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM suppliers
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Fornecedor não encontrado.",
      });
    }

    res.json({
      ok: true,
    });
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
      SELECT
        p.id,
        p.code,
        p.name,
        p.brand,
        p.size,
        p.cost,
        p.price,
        p.stock,
        p.min_stock,
        CASE
          WHEN p.stock <= p.min_stock
          THEN true
          ELSE false
        END AS low_stock
      FROM products p
      ORDER BY p.name ASC
    `);

    res.json(result.rows);
  })
);

app.get(
  "/api/stock/moves",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT
        sm.*,
        p.name AS product_name,
        p.code AS product_code
      FROM stock_moves sm
      JOIN products p
        ON p.id = sm.product_id
      ORDER BY sm.created_at DESC, sm.id DESC
    `);

    res.json(result.rows);
  })
);

app.post(
  "/api/stock/move",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      product_id,
      quantity,
      type,
      note,
    } = req.body;

    const productId = integer(product_id);
    const qty = integer(quantity);
    const moveType = String(type || "").toLowerCase();

    if (!productId) {
      return res.status(400).json({
        error: "Selecione um produto.",
      });
    }

    if (!qty || qty <= 0) {
      return res.status(400).json({
        error: "Informe uma quantidade válida.",
      });
    }

    if (
      moveType !== "entrada" &&
      moveType !== "saida"
    ) {
      return res.status(400).json({
        error: "Tipo de movimentação inválido.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `
        SELECT id, stock
        FROM products
        WHERE id = $1
        FOR UPDATE
        `,
        [productId]
      );

      if (!productResult.rows.length) {
        throw new Error("Produto não encontrado.");
      }

      const currentStock =
        integer(productResult.rows[0].stock);

      if (
        moveType === "saida" &&
        currentStock < qty
      ) {
        throw new Error(
          "Estoque insuficiente para essa saída."
        );
      }

      const newStock =
        moveType === "entrada"
          ? currentStock + qty
          : currentStock - qty;

      await client.query(
        `
        UPDATE products
        SET
          stock = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [newStock, productId]
      );

      const result = await client.query(
        `
        INSERT INTO stock_moves (
          product_id,
          quantity,
          type,
          note,
          reference_type,
          reference_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'manual',
          NULL
        )
        RETURNING *
        `,
        [
          productId,
          qty,
          moveType,
          String(note || "").trim() || null,
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        move: result.rows[0],
        stock: newStock,
      });
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
      SELECT
        s.*,
        c.name AS client_name,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM sale_installments si
            WHERE si.sale_id = s.id
          ),
          0
        )::INTEGER AS installment_count
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
      ORDER BY
        s.date DESC,
        s.id DESC
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
      `
      SELECT
        s.*,
        c.name AS client_name,
        c.phone AS client_phone,
        c.address AS client_address
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
      WHERE s.id = $1
      `,
      [id]
    );

    if (!saleResult.rows.length) {
      return res.status(404).json({
        error: "Venda não encontrada.",
      });
    }

    const itemsResult = await pool.query(
      `
      SELECT
        si.*,
        p.name AS product_name,
        p.code AS product_code,
        p.brand AS product_brand,
        p.size AS product_size
      FROM sale_items si
      JOIN products p
        ON p.id = si.product_id
      WHERE si.sale_id = $1
      ORDER BY si.id
      `,
      [id]
    );

    const installmentsResult =
      await pool.query(
        `
        SELECT *
        FROM sale_installments
        WHERE sale_id = $1
        ORDER BY installment_no
        `,
        [id]
      );

    const paymentsResult =
      await pool.query(
        `
        SELECT *
        FROM sale_payments
        WHERE sale_id = $1
        ORDER BY paid_at ASC, id ASC
        `,
        [id]
      );

    res.json({
      sale: saleResult.rows[0],
      items: itemsResult.rows,
      installments:
        installmentsResult.rows,
      payments:
        paymentsResult.rows,
    });
  })
);

app.get(
  "/api/sales/:id/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {

    const saleId =
      integer(req.params.id);

    /* =====================================================
       VENDA
    ===================================================== */

    const saleResult =
      await pool.query(
        `
        SELECT
          s.*,
          c.name AS client_name,
          c.phone AS client_phone,
          c.address AS client_address
        FROM sales s
        LEFT JOIN clients c
          ON c.id = s.client_id
        WHERE s.id = $1
        `,
        [saleId]
      );

    if (!saleResult.rows.length) {
      return res.status(404).json({
        error: "Venda não encontrada.",
      });
    }

    const sale =
      saleResult.rows[0];

    /* =====================================================
       ITENS
    ===================================================== */

    const itemsResult =
      await pool.query(
        `
        SELECT
          si.*,
          p.name AS product_name,
          p.code AS product_code,
          p.brand AS product_brand,
          p.size AS product_size
        FROM sale_items si
        JOIN products p
          ON p.id = si.product_id
        WHERE si.sale_id = $1
        ORDER BY si.id
        `,
        [saleId]
      );

    /* =====================================================
       PARCELAS
    ===================================================== */

    const installmentsResult =
      await pool.query(
        `
        SELECT *
        FROM sale_installments
        WHERE sale_id = $1
        ORDER BY installment_no
        `,
        [saleId]
      );

    /* =====================================================
       PAGAMENTOS
    ===================================================== */

    const paymentsResult =
      await pool.query(
        `
        SELECT *
        FROM sale_payments
        WHERE sale_id = $1
        ORDER BY paid_at ASC, id ASC
        `,
        [saleId]
      );

    /* =====================================================
       FUNÇÕES AUXILIARES
    ===================================================== */

    function brl(value) {
      return Number(value || 0)
        .toLocaleString(
          "pt-BR",
          {
            style: "currency",
            currency: "BRL",
          }
        );
    }

    function dateBR(value) {

      if (!value) {
        return "";
      }

      const text =
        String(value).slice(0, 10);

      const parts =
        text.split("-");

      if (parts.length !== 3) {
        return text;
      }

      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function safeFileName(value) {

      return String(value || "")
        .replace(
          /[<>:"/\\|?*]/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();
    }

    function line() {

      doc
        .moveTo(
          doc.page.margins.left,
          doc.y
        )
        .lineTo(
          doc.page.width -
            doc.page.margins.right,
          doc.y
        )
        .stroke();
    }

    /* =====================================================
       PIX
    ===================================================== */

    function crc16(payload) {

      let crc = 0xFFFF;

      for (
        let i = 0;
        i < payload.length;
        i++
      ) {

        crc ^=
          payload.charCodeAt(i) << 8;

        for (
          let j = 0;
          j < 8;
          j++
        ) {

          if (
            crc & 0x8000
          ) {

            crc =
              (
                crc << 1
              ) ^
              0x1021;

          } else {

            crc =
              crc << 1;
          }

          crc &=
            0xFFFF;
        }
      }

      return crc
        .toString(16)
        .toUpperCase()
        .padStart(
          4,
          "0"
        );
    }

    function pixField(
      id,
      value
    ) {

      const text =
        String(value);

      return (
        id +
        text.length
          .toString()
          .padStart(
            2,
            "0"
          ) +
        text
      );
    }

    function createPixPayload() {

      const merchantAccountInformation =
        pixField(
          "00",
          "BR.GOV.BCB.PIX"
        ) +
        pixField(
          "01",
          "97984031709"
        );

      const payloadWithoutCRC =
        pixField(
          "00",
          "01"
        ) +

        pixField(
          "26",
          merchantAccountInformation
        ) +

        pixField(
          "52",
          "0000"
        ) +

        pixField(
          "53",
          "986"
        ) +

        pixField(
          "58",
          "BR"
        ) +

        pixField(
          "59",
          "ELIANA NATALIA"
        ) +

        pixField(
          "60",
          "SANTO ANTONIO DO ICA"
        ) +

        pixField(
          "62",
          pixField(
            "05",
            "***"
          )
        ) +

        "6304";

      return (
        payloadWithoutCRC +
        crc16(
          payloadWithoutCRC
        )
      );
    }

    const pixPayload =
      createPixPayload();

    const pixQrCode =
      await QRCode.toDataURL(
        pixPayload,
        {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
        }
      );

    /* =====================================================
       DOCUMENTO PDF
    ===================================================== */

    const doc =
      new PDFDocument({
        size: "A4",
        margin: 45,
      });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    /* =====================================================
       NOME DO ARQUIVO
       
       Exemplo:
       Venda - Carmita Monteiro CRSAI.pdf
    ===================================================== */

    const clientName =
      sale.client_name ||
      "Consumidor";

    const safeClientName =
      safeFileName(
        clientName
      );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Venda - ${safeClientName} CRSAI.pdf"`
    );

    doc.pipe(res);

    const pageWidth =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right;

    /* =====================================================
       CABEÇALHO
    ===================================================== */

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(
        "ESSÊNCIA & CHARME",
        {
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Perfumes, moda e charme para você.",
        {
          align: "center",
        }
      );

    doc.moveDown(1);

    /* =====================================================
       TÍTULO INTERNO
    ===================================================== */

    doc
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(
        `VENDA #${sale.id}`,
        {
          align: "center",
        }
      );

    doc.moveDown(0.5);

    /* =====================================================
       DATA
    ===================================================== */

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Data: ${dateBR(
          sale.date
        )}`
      )
      .text(
        `Status: ${
          sale.status || ""
        }`
      );

    doc.moveDown(0.7);

    line();

    doc.moveDown(0.7);

    /* =====================================================
       CLIENTE
    ===================================================== */

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(
        "CLIENTE"
      );

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Nome: ${
          sale.client_name ||
          "Não informado"
        }`
      );

    if (sale.client_phone) {

      doc.text(
        `Telefone: ${sale.client_phone}`
      );
    }

    if (sale.client_address) {

      doc.text(
        `Endereço: ${sale.client_address}`
      );
    }

    doc.moveDown(0.8);

    line();

    doc.moveDown(0.7);

    /* =====================================================
       ITENS
    ===================================================== */

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(
        "ITENS DA VENDA"
      );

    doc.moveDown(0.4);

    const x =
      doc.page.margins.left;

    const itemWidth =
      pageWidth * 0.47;

    const qtyX =
      x + pageWidth * 0.49;

    const unitX =
      x + pageWidth * 0.62;

    const totalX =
      x + pageWidth * 0.79;

    doc
      .fontSize(9)
      .font("Helvetica-Bold");

    doc.text(
      "Produto",
      x,
      doc.y,
      {
        width: itemWidth,
      }
    );

    doc.text(
      "Qtd.",
      qtyX,
      doc.y,
      {
        width: 45,
      }
    );

    doc.text(
      "Unit.",
      unitX,
      doc.y,
      {
        width: 70,
      }
    );

    doc.text(
      "Total",
      totalX,
      doc.y,
      {
        width: 80,
      }
    );

    doc.moveDown(0.5);

    for (
      const item
      of itemsResult.rows
    ) {

      const startY =
        doc.y;

      const productName =
        item.product_name || "";

      const description =
        [
          item.product_brand,
          item.product_size,
        ]
          .filter(Boolean)
          .join(" - ");

      const fullName =
        description
          ? `${productName} (${description})`
          : productName;

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          fullName,
          x,
          startY,
          {
            width: itemWidth,
          }
        );

      doc.text(
        String(
          integer(
            item.quantity
          )
        ),
        qtyX,
        startY,
        {
          width: 45,
        }
      );

      doc.text(
        brl(item.price),
        unitX,
        startY,
        {
          width: 70,
        }
      );

      doc.text(
        brl(
          Number(item.price) *
          integer(
            item.quantity
          )
        ),
        totalX,
        startY,
        {
          width: 80,
        }
      );

      doc.moveDown(0.55);
    }

    doc.moveDown(0.4);

    line();

    doc.moveDown(0.6);

    /* =====================================================
       TOTAIS
    ===================================================== */

    doc
      .fontSize(10)
      .font("Helvetica");

    doc.text(
      `Subtotal: ${brl(
        sale.subtotal
      )}`,
      {
        align: "right",
      }
    );

    doc.text(
      `Desconto: ${brl(
        sale.discount
      )}`,
      {
        align: "right",
      }
    );

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(
        `TOTAL: ${brl(
          sale.total
        )}`,
        {
          align: "right",
        }
      );

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Entrada: ${brl(
          sale.entry
        )}`,
        {
          align: "right",
        }
      )
      .text(
        `Total pago: ${brl(
          sale.paid_amount
        )}`,
        {
          align: "right",
        }
      )
      .text(
        `Saldo a receber: ${brl(
          sale.balance
        )}`,
        {
          align: "right",
        }
      );

    if (sale.payment) {

      doc.text(
        `Forma de pagamento: ${sale.payment}`,
        {
          align: "right",
        }
      );
    }

    /* =====================================================
       PARCELAS
    ===================================================== */

    if (
      installmentsResult.rows.length
    ) {

      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(
          "PARCELAS",
          {
            align: "left",
          }
        );

      doc.moveDown(0.4);

      for (
        const installment
        of installmentsResult.rows
      ) {

        const installmentText =
          `${installment.installment_no}ª parcela — vencimento ${dateBR(
            installment.due_date
          )} — valor ${brl(
            installment.amount
          )} — pago ${brl(
            installment.paid_amount
          )} — ${
            installment.status || ""
          }`;

        const rowY =
          doc.y;

        const rowHeight =
          22;

        doc
          .rect(
            doc.page.margins.left,
            rowY - 2,
            pageWidth,
            rowHeight
          )
          .stroke();

        doc
          .fontSize(9)
          .font("Helvetica")
          .text(
            installmentText,
            doc.page.margins.left + 8,
            rowY + 5,
            {
              width:
                pageWidth - 16,
              align: "left",
            }
          );

        doc.y =
          rowY +
          rowHeight +
          3;
      }
    }

    /* =====================================================
       PAGAMENTOS REALIZADOS
    ===================================================== */

    if (
      paymentsResult.rows.length
    ) {

      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(
          "PAGAMENTOS REALIZADOS"
        );

      doc.moveDown(0.3);

      for (
        const payment
        of paymentsResult.rows
      ) {

        doc
          .fontSize(9)
          .font("Helvetica")
          .text(
            `${dateBR(
              payment.paid_at
            )} — ${brl(
              payment.amount
            )}${
              payment.payment
                ? ` — ${payment.payment}`
                : ""
            }${
              payment.note
                ? ` — ${payment.note}`
                : ""
            }`
          );
      }
    }

    /* =====================================================
       OBSERVAÇÕES
    ===================================================== */

    if (sale.notes) {

      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(
          "OBSERVAÇÕES"
        );

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          sale.notes
        );
    }

    /* =====================================================
       PIX
    ===================================================== */

    doc.moveDown(1);

    line();

    doc.moveDown(0.7);

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(
        "PAGAMENTO VIA PIX",
        {
          align: "center",
        }
      );

    doc.moveDown(0.3);

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Eliana Natália",
        {
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Chave Pix: 97984031709",
        {
          align: "center",
        }
      );

    doc.moveDown(0.5);

    /* =====================================================
       QR CODE
    ===================================================== */

    const qrSize =
      130;

    const qrX =
      doc.page.margins.left +
      (
        pageWidth -
        qrSize
      ) / 2;

    const qrY =
      doc.y;

    doc.image(
      pixQrCode,
      qrX,
      qrY,
      {
        width: qrSize,
        height: qrSize,
      }
    );

    doc.y =
      qrY +
      qrSize +
      8;

    doc
      .fontSize(8)
      .font("Helvetica")
      .text(
        "Escaneie o QR Code para realizar o pagamento.",
        {
          align: "center",
        }
      );

    doc.moveDown(0.8);

    /* =====================================================
       RODAPÉ
    ===================================================== */

    line();

    doc.moveDown(0.6);

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Obrigado pela preferência!",
        {
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(
        "Eliana Natália",
        {
          align: "center",
        }
      );

    /* =====================================================
       FINALIZA
    ===================================================== */

    doc.end();
  })
);

/* =========================================================
   CRIAÇÃO DE VENDA
========================================================= */

app.post(
  "/api/sales",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      client_id,
      date,
      discount,
      entry,
      installments,
      payment,
      notes,
      items,
    } = req.body;

    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      return res.status(400).json({
        error: "Adicione pelo menos um produto à venda.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let subtotal = 0;
      const normalizedItems = [];

      for (const item of items) {
        const productId =
          integer(item.product_id);
        const quantity =
          integer(item.quantity);
        const price =
          money(item.price);

        if (!productId || quantity <= 0) {
          throw new Error(
            "Existe um item de venda inválido."
          );
        }

        const productResult =
          await client.query(
            `
            SELECT *
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [productId]
          );

        if (!productResult.rows.length) {
          throw new Error(
            "Produto não encontrado."
          );
        }

        const product =
          productResult.rows[0];

        if (
          integer(product.stock) <
          quantity
        ) {
          throw new Error(
            `Estoque insuficiente para o produto "${product.name}".`
          );
        }

        const unitPrice =
          price > 0
            ? price
            : money(product.price);

        const itemTotal =
          money(unitPrice * quantity);

        subtotal += itemTotal;

        normalizedItems.push({
          productId,
          quantity,
          price: unitPrice,
          cost: money(product.cost),
        });
      }

      subtotal = money(subtotal);

      const discountValue =
        Math.min(
          Math.max(0, money(discount)),
          subtotal
        );

      const total =
        money(subtotal - discountValue);

      const entryValue =
        Math.min(
          Math.max(0, money(entry)),
          total
        );

      const installmentCount =
        Math.max(
          1,
          integer(installments) || 1
        );

      const paidAmount =
        entryValue;

      const balance =
        money(total - paidAmount);

      const status =
        calculateStatus(
          total,
          paidAmount
        );

      const saleResult =
        await client.query(
          `
          INSERT INTO sales (
            client_id,
            date,
            subtotal,
            discount,
            total,
            payment,
            installments,
            entry,
            paid_amount,
            balance,
            status,
            notes
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
          )
          RETURNING *
          `,
          [
            client_id
              ? integer(client_id)
              : null,
            date || today(),
            subtotal,
            discountValue,
            total,
            String(payment || "").trim() ||
              null,
            installmentCount,
            entryValue,
            paidAmount,
            balance,
            status,
            String(notes || "").trim() ||
              null,
          ]
        );

      const sale =
        saleResult.rows[0];

      for (const item of normalizedItems) {
        await client.query(
          `
          INSERT INTO sale_items (
            sale_id,
            product_id,
            quantity,
            price,
            cost
          )
          VALUES ($1,$2,$3,$4,$5)
          `,
          [
            sale.id,
            item.productId,
            item.quantity,
            item.price,
            item.cost,
          ]
        );

        await client.query(
          `
          UPDATE products
          SET
            stock = stock - $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            item.quantity,
            item.productId,
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves (
            product_id,
            quantity,
            type,
            note,
            reference_type,
            reference_id
          )
          VALUES (
            $1,
            $2,
            'saida',
            $3,
            'venda',
            $4
          )
          `,
          [
            item.productId,
            item.quantity,
            `Venda #${sale.id}`,
            sale.id,
          ]
        );
      }

      /*
       * O valor restante após a entrada é dividido
       * entre as parcelas.
       */
      if (balance > 0.005) {
        const installmentBase =
          money(
            balance /
              installmentCount
          );

        let accumulated = 0;

        for (
          let i = 1;
          i <= installmentCount;
          i++
        ) {
          let installmentAmount =
            installmentBase;

          if (
            i === installmentCount
          ) {
            installmentAmount =
              money(
                balance -
                  accumulated
              );
          }

          accumulated +=
            installmentAmount;

          const dueDate =
            addMonths(
              date || today(),
              i - 1
            );

          await client.query(
            `
            INSERT INTO sale_installments (
              sale_id,
              installment_no,
              due_date,
              amount,
              paid_amount,
              status
            )
            VALUES (
              $1,$2,$3,$4,0,'Em aberto'
            )
            `,
            [
              sale.id,
              i,
              dueDate,
              installmentAmount,
            ]
          );
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        sale,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   PAGAMENTO DE VENDA
========================================================= */

app.post(
  "/api/sales/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const saleId =
      integer(req.params.id);

    const amount =
      money(req.body.amount);

    const payment =
      String(
        req.body.payment || ""
      ).trim();

    const note =
      String(
        req.body.note || ""
      ).trim();

    if (amount <= 0) {
      return res.status(400).json({
        error: "Informe um valor de pagamento válido.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const saleResult =
        await client.query(
          `
          SELECT *
          FROM sales
          WHERE id = $1
          FOR UPDATE
          `,
          [saleId]
        );

      if (!saleResult.rows.length) {
        throw new Error(
          "Venda não encontrada."
        );
      }

      const sale =
        saleResult.rows[0];

      if (
        String(
          sale.status || ""
        ).toLowerCase() ===
        "cancelada"
      ) {
        throw new Error(
          "Esta venda está cancelada e não pode receber pagamentos."
        );
      }

      const currentBalance =
        money(sale.balance);

      if (
        currentBalance <= 0.005
      ) {
        throw new Error(
          "Esta venda já está totalmente paga."
        );
      }

      const paymentAmount =
        Math.min(
          amount,
          currentBalance
        );

      let remaining =
        paymentAmount;

      const installmentsResult =
        await client.query(
          `
          SELECT *
          FROM sale_installments
          WHERE sale_id = $1
            AND paid_amount < amount
          ORDER BY
            installment_no ASC
          FOR UPDATE
          `,
          [saleId]
        );

      let selectedInstallmentId =
        null;

      for (
        const installment
        of installmentsResult.rows
      ) {
        if (
          remaining <= 0.005
        ) {
          break;
        }

        const installmentBalance =
          money(
            installment.amount -
              installment.paid_amount
          );

        const applied =
          Math.min(
            remaining,
            installmentBalance
          );

        if (
          applied <= 0
        ) {
          continue;
        }

        selectedInstallmentId =
          selectedInstallmentId ||
          installment.id;

        const newPaid =
          money(
            Number(
              installment.paid_amount
            ) + applied
          );

        const newStatus =
          calculateStatus(
            Number(
              installment.amount
            ),
            newPaid
          );

        await client.query(
          `
          UPDATE sale_installments
          SET
            paid_amount = $1,
            status = $2
          WHERE id = $3
          `,
          [
            newPaid,
            newStatus,
            installment.id,
          ]
        );

        remaining =
          money(
            remaining - applied
          );
      }

      await client.query(
        `
        INSERT INTO sale_payments (
          sale_id,
          installment_id,
          amount,
          payment,
          note
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          saleId,
          selectedInstallmentId,
          paymentAmount,
          payment || null,
          note || null,
        ]
      );

      const newPaidAmount =
        money(
          Number(
            sale.paid_amount
          ) + paymentAmount
        );

      const newBalance =
        money(
          Number(sale.total) -
            newPaidAmount
        );

      const newStatus =
        calculateStatus(
          Number(sale.total),
          newPaidAmount
        );

      await client.query(
        `
        UPDATE sales
        SET
          paid_amount = $1,
          balance = $2,
          status = $3
        WHERE id = $4
        `,
        [
          newPaidAmount,
          newBalance,
          newStatus,
          saleId,
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        paid_amount:
          newPaidAmount,
        balance:
          newBalance,
        status:
          newStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   CANCELAMENTO DE VENDA
   Devolve ao estoque os produtos que saíram pela venda.
========================================================= */

app.post(
  "/api/sales/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const saleId =
      integer(req.params.id);

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const saleResult =
        await client.query(
          `
          SELECT *
          FROM sales
          WHERE id = $1
          FOR UPDATE
          `,
          [saleId]
        );

      if (!saleResult.rows.length) {
        throw new Error(
          "Venda não encontrada."
        );
      }

      const sale =
        saleResult.rows[0];

      if (
        String(
          sale.status || ""
        ).toLowerCase() ===
        "cancelada"
      ) {
        throw new Error(
          "Esta venda já está cancelada."
        );
      }

      const itemsResult =
        await client.query(
          `
          SELECT *
          FROM sale_items
          WHERE sale_id = $1
          ORDER BY id
          `,
          [saleId]
        );

      for (
        const item
        of itemsResult.rows
      ) {
        const productResult =
          await client.query(
            `
            SELECT id, stock
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [item.product_id]
          );

        if (
          !productResult.rows.length
        ) {
          throw new Error(
            `Produto ID ${item.product_id} não encontrado.`
          );
        }

        const quantity =
          integer(item.quantity);

        await client.query(
          `
          UPDATE products
          SET
            stock = stock + $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            quantity,
            integer(item.product_id),
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves (
            product_id,
            quantity,
            type,
            note,
            reference_type,
            reference_id
          )
          VALUES (
            $1,
            $2,
            'entrada',
            $3,
            'cancelamento_venda',
            $4
          )
          `,
          [
            item.product_id,
            quantity,
            `Retorno ao estoque referente ao cancelamento da venda #${saleId}`,
            saleId,
          ]
        );
      }

      await client.query(
        `
        UPDATE sales
        SET
          status = 'Cancelada',
          balance = 0
        WHERE id = $1
        `,
        [saleId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        message:
          "Venda cancelada e produtos devolvidos ao estoque.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   COMPRAS
========================================================= */

app.get(
  "/api/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result =
      await pool.query(`
        SELECT
          p.*,
          s.name AS supplier_name,
          COALESCE(
            (
              SELECT COUNT(*)
              FROM purchase_installments pi
              WHERE pi.purchase_id = p.id
            ),
            0
          )::INTEGER AS installment_count
        FROM purchases p
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        ORDER BY
          p.date DESC,
          p.id DESC
      `);

    res.json(result.rows);
  })
);

app.get(
  "/api/purchases/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id =
      integer(req.params.id);

    const purchaseResult =
      await pool.query(
        `
        SELECT
          p.*,
          s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        WHERE p.id = $1
        `,
        [id]
      );

    if (
      !purchaseResult.rows.length
    ) {
      return res.status(404).json({
        error:
          "Compra não encontrada.",
      });
    }

    const itemsResult =
      await pool.query(
        `
        SELECT
          pi.*,
          pr.name AS product_name,
          pr.code AS product_code,
          pr.brand AS product_brand,
          pr.size AS product_size
        FROM purchase_items pi
        JOIN products pr
          ON pr.id = pi.product_id
        WHERE pi.purchase_id = $1
        ORDER BY pi.id
        `,
        [id]
      );

    const installmentsResult =
      await pool.query(
        `
        SELECT *
        FROM purchase_installments
        WHERE purchase_id = $1
        ORDER BY installment_no
        `,
        [id]
      );

    const paymentsResult =
      await pool.query(
        `
        SELECT *
        FROM purchase_payments
        WHERE purchase_id = $1
        ORDER BY paid_at ASC, id ASC
        `,
        [id]
      );

    res.json({
      purchase:
        purchaseResult.rows[0],
      items:
        itemsResult.rows,
      installments:
        installmentsResult.rows,
      payments:
        paymentsResult.rows,
    });
  })
);

/* =========================================================
   PDF DA COMPRA
========================================================= */

app.get(
  "/api/purchases/:id/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchaseId = integer(req.params.id);

    const purchaseResult = await pool.query(
      `
      SELECT
        p.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        s.whatsapp AS supplier_whatsapp,
        s.document AS supplier_document,
        s.address AS supplier_address
      FROM purchases p
      LEFT JOIN suppliers s
        ON s.id = p.supplier_id
      WHERE p.id = $1
      `,
      [purchaseId]
    );

    if (!purchaseResult.rows.length) {
      return res.status(404).json({
        error: "Compra não encontrada.",
      });
    }

    const purchase = purchaseResult.rows[0];

    const itemsResult = await pool.query(
      `
      SELECT
        pi.*,
        pr.name AS product_name,
        pr.code AS product_code,
        pr.brand AS product_brand,
        pr.size AS product_size
      FROM purchase_items pi
      JOIN products pr
        ON pr.id = pi.product_id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id
      `,
      [purchaseId]
    );

    const installmentsResult = await pool.query(
      `
      SELECT *
      FROM purchase_installments
      WHERE purchase_id = $1
      ORDER BY installment_no
      `,
      [purchaseId]
    );

    const paymentsResult = await pool.query(
      `
      SELECT *
      FROM purchase_payments
      WHERE purchase_id = $1
      ORDER BY paid_at ASC, id ASC
      `,
      [purchaseId]
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 45,
    });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="compra-${purchaseId}.pdf"`
    );

    doc.pipe(res);

    const pageWidth =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right;

    function brl(value) {
      return Number(value || 0).toLocaleString(
        "pt-BR",
        {
          style: "currency",
          currency: "BRL",
        }
      );
    }

    function dateBR(value) {
      if (!value) return "";

      const text = String(value).slice(0, 10);
      const parts = text.split("-");

      if (parts.length !== 3) {
        return text;
      }

      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function line() {
      doc
        .moveTo(
          doc.page.margins.left,
          doc.y
        )
        .lineTo(
          doc.page.width -
            doc.page.margins.right,
          doc.y
        )
        .stroke();
    }

    /* =====================================================
       CABEÇALHO
    ===================================================== */

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(
        "ESSÊNCIA & CHARME",
        {
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Perfumes, moda e charme para você.",
        {
          align: "center",
        }
      );

    doc.moveDown(1);

    doc
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(
        `COMPRA #${purchase.id}`,
        {
          align: "center",
        }
      );

    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Data: ${dateBR(purchase.date)}`
      )
      .text(
        `Status: ${purchase.status || ""}`
      );

    doc.moveDown(0.7);

    line();

    doc.moveDown(0.7);

    /* =====================================================
       FORNECEDOR
    ===================================================== */

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("FORNECEDOR");

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Nome: ${
          purchase.supplier_name ||
          "Não informado"
        }`
      );

    if (purchase.supplier_phone) {
      doc.text(
        `Telefone: ${purchase.supplier_phone}`
      );
    }

    if (purchase.supplier_whatsapp) {
      doc.text(
        `WhatsApp: ${purchase.supplier_whatsapp}`
      );
    }

    if (purchase.supplier_document) {
      doc.text(
        `Documento: ${purchase.supplier_document}`
      );
    }

    if (purchase.supplier_address) {
      doc.text(
        `Endereço: ${purchase.supplier_address}`
      );
    }

    doc.moveDown(0.8);

    line();

    doc.moveDown(0.7);

    /* =====================================================
       ITENS DA COMPRA
    ===================================================== */

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("ITENS DA COMPRA");

    doc.moveDown(0.4);

    const x = doc.page.margins.left;

    const itemWidth = pageWidth * 0.47;

    const qtyX =
      x + pageWidth * 0.49;

    const unitX =
      x + pageWidth * 0.62;

    const totalX =
      x + pageWidth * 0.79;

    doc
      .fontSize(9)
      .font("Helvetica-Bold");

    doc.text(
      "Produto",
      x,
      doc.y,
      {
        width: itemWidth,
      }
    );

    doc.text(
      "Qtd.",
      qtyX,
      doc.y,
      {
        width: 45,
      }
    );

    doc.text(
      "Custo",
      unitX,
      doc.y,
      {
        width: 70,
      }
    );

    doc.text(
      "Total",
      totalX,
      doc.y,
      {
        width: 80,
      }
    );

    doc.moveDown(0.5);

    let calculatedTotal = 0;

    for (const item of itemsResult.rows) {
      const startY = doc.y;

      const productName =
        item.product_name || "";

      const description = [
        item.product_brand,
        item.product_size,
      ]
        .filter(Boolean)
        .join(" - ");

      const fullName = description
        ? `${productName} (${description})`
        : productName;

      const quantity =
        integer(item.quantity);

      const unitCost =
        money(item.cost);

      const itemTotal =
        money(unitCost * quantity);

      calculatedTotal += itemTotal;

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          fullName,
          x,
          startY,
          {
            width: itemWidth,
          }
        );

      doc.text(
        String(quantity),
        qtyX,
        startY,
        {
          width: 45,
        }
      );

      doc.text(
        brl(unitCost),
        unitX,
        startY,
        {
          width: 70,
        }
      );

      doc.text(
        brl(itemTotal),
        totalX,
        startY,
        {
          width: 80,
        }
      );

      doc.moveDown(0.55);
    }

    doc.moveDown(0.4);

    line();

    doc.moveDown(0.6);

    /* =====================================================
       RESUMO FINANCEIRO
    ===================================================== */

    doc
      .fontSize(10)
      .font("Helvetica");

    doc.text(
      `Total da compra: ${brl(
        purchase.total
      )}`,
      {
        align: "right",
      }
    );

    doc.text(
      `Entrada: ${brl(
        purchase.entry
      )}`,
      {
        align: "right",
      }
    );

    doc.text(
      `Total pago: ${brl(
        purchase.paid_amount
      )}`,
      {
        align: "right",
      }
    );

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(
        `Saldo a pagar: ${brl(
          purchase.balance
        )}`,
        {
          align: "right",
        }
      );

    if (purchase.payment) {
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          `Forma de pagamento: ${purchase.payment}`,
          {
            align: "right",
          }
        );
    }

    /* =====================================================
       PARCELAS
    ===================================================== */

    if (installmentsResult.rows.length) {
      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("PARCELAS");

      doc.moveDown(0.3);

      for (
        const installment
        of installmentsResult.rows
      ) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .text(
            `${installment.installment_no}ª parcela — vencimento ${dateBR(
              installment.due_date
            )} — valor ${brl(
              installment.amount
            )} — pago ${brl(
              installment.paid_amount
            )} — ${
              installment.status
            }`
          );
      }
    }

    /* =====================================================
       PAGAMENTOS
    ===================================================== */

    if (paymentsResult.rows.length) {
      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(
          "PAGAMENTOS REALIZADOS"
        );

      doc.moveDown(0.3);

      for (
        const payment
        of paymentsResult.rows
      ) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .text(
            `${dateBR(
              payment.paid_at
            )} — ${brl(
              payment.amount
            )}${
              payment.payment
                ? ` — ${payment.payment}`
                : ""
            }${
              payment.note
                ? ` — ${payment.note}`
                : ""
            }`
          );
      }
    }

    /* =====================================================
       OBSERVAÇÕES
    ===================================================== */

    if (purchase.notes) {
      doc.moveDown(0.8);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("OBSERVAÇÕES");

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          purchase.notes
        );
    }

    doc.moveDown(1);

    line();

    doc.moveDown(0.6);

    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        "Documento de controle interno — Essência & Charme.",
        {
          align: "center",
        }
      );

    doc.end();
  })
);

/* =========================================================
   CRIAÇÃO DE COMPRA
========================================================= */

app.post(
  "/api/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      supplier_id,
      date,
      first_due_date,
      entry,
      installments,
      payment,
      notes,
      items,
      total,
    } = req.body;

    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      return res.status(400).json({
        error:
          "Adicione pelo menos um produto à compra.",
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      let calculatedTotal = 0;
      const normalizedItems = [];

      for (const item of items) {
        const productId =
          integer(item.product_id);

        const quantity =
          integer(item.quantity);

        const cost =
          money(item.cost);

        if (
          !productId ||
          quantity <= 0
        ) {
          throw new Error(
            "Existe um item de compra inválido."
          );
        }

        const productResult =
          await client.query(
            `
            SELECT *
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [productId]
          );

        if (
          !productResult.rows.length
        ) {
          throw new Error(
            "Produto não encontrado."
          );
        }

        const product =
          productResult.rows[0];

        const unitCost =
          cost > 0
            ? cost
            : money(product.cost);

        const itemTotal =
          money(
            unitCost *
              quantity
          );

        calculatedTotal +=
          itemTotal;

        normalizedItems.push({
          productId,
          quantity,
          cost: unitCost,
        });
      }

      calculatedTotal =
        money(calculatedTotal);

      const totalValue =
        money(total) > 0
          ? money(total)
          : calculatedTotal;

      const entryValue =
        Math.min(
          Math.max(
            0,
            money(entry)
          ),
          totalValue
        );

      const installmentCount =
        Math.max(
          1,
          integer(installments) ||
            1
        );

      const paidAmount =
        entryValue;

      const balance =
        money(
          totalValue -
            paidAmount
        );

      const status =
        calculateStatus(
          totalValue,
          paidAmount
        );

      const purchaseResult =
        await client.query(
          `
          INSERT INTO purchases (
            supplier_id,
            date,
            total,
            entry,
            paid_amount,
            balance,
            installments,
            payment,
            status,
            notes
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
          )
          RETURNING *
          `,
          [
            supplier_id
              ? integer(supplier_id)
              : null,
            date || today(),
            totalValue,
            entryValue,
            paidAmount,
            balance,
            installmentCount,
            String(
              payment || ""
            ).trim() || null,
            status,
            String(
              notes || ""
            ).trim() || null,
          ]
        );

      const purchase =
        purchaseResult.rows[0];

      for (
        const item
        of normalizedItems
      ) {
        await client.query(
          `
          INSERT INTO purchase_items (
            purchase_id,
            product_id,
            quantity,
            cost
          )
          VALUES ($1,$2,$3,$4)
          `,
          [
            purchase.id,
            item.productId,
            item.quantity,
            item.cost,
          ]
        );

        await client.query(
          `
          UPDATE products
          SET
            stock = stock + $1,
            cost = $2,
            updated_at = NOW()
          WHERE id = $3
          `,
          [
            item.quantity,
            item.cost,
            item.productId,
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves (
            product_id,
            quantity,
            type,
            note,
            reference_type,
            reference_id
          )
          VALUES (
            $1,
            $2,
            'entrada',
            $3,
            'compra',
            $4
          )
          `,
          [
            item.productId,
            item.quantity,
            `Compra #${purchase.id}`,
            purchase.id,
          ]
        );
      }

      if (balance > 0.005) {
        const installmentBase =
          money(
            balance /
              installmentCount
          );

        let accumulated = 0;

        const firstDate =
          first_due_date ||
          date ||
          today();

        for (
          let i = 1;
          i <= installmentCount;
          i++
        ) {
          let installmentAmount =
            installmentBase;

          if (
            i ===
            installmentCount
          ) {
            installmentAmount =
              money(
                balance -
                  accumulated
              );
          }

          accumulated +=
            installmentAmount;

          /*
           * As parcelas da compra
           * começam na data informada
           * e avançam de 30 em 30 dias.
           */
          const dueDate =
            addDays(
              firstDate,
              (i - 1) * 30
            );

          await client.query(
            `
            INSERT INTO purchase_installments (
              purchase_id,
              installment_no,
              due_date,
              amount,
              paid_amount,
              status
            )
            VALUES (
              $1,$2,$3,$4,0,'Em aberto'
            )
            `,
            [
              purchase.id,
              i,
              dueDate,
              installmentAmount,
            ]
          );
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        purchase,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   PAGAMENTO DE COMPRA
========================================================= */

app.post(
  "/api/purchases/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchaseId =
      integer(req.params.id);

    const amount =
      money(req.body.amount);

    const payment =
      String(
        req.body.payment || ""
      ).trim();

    const note =
      String(
        req.body.note || ""
      ).trim();

    if (amount <= 0) {
      return res.status(400).json({
        error:
          "Informe um valor de pagamento válido.",
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const purchaseResult =
        await client.query(
          `
          SELECT *
          FROM purchases
          WHERE id = $1
          FOR UPDATE
          `,
          [purchaseId]
        );

      if (
        !purchaseResult.rows.length
      ) {
        throw new Error(
          "Compra não encontrada."
        );
      }

      const purchase =
        purchaseResult.rows[0];

      if (
        String(
          purchase.status || ""
        ).toLowerCase() ===
        "cancelada"
      ) {
        throw new Error(
          "Esta compra está cancelada e não pode receber pagamentos."
        );
      }

      const currentBalance =
        money(purchase.balance);

      if (
        currentBalance <= 0.005
      ) {
        throw new Error(
          "Esta compra já está totalmente paga."
        );
      }

      const paymentAmount =
        Math.min(
          amount,
          currentBalance
        );

      let remaining =
        paymentAmount;

      const installmentsResult =
        await client.query(
          `
          SELECT *
          FROM purchase_installments
          WHERE purchase_id = $1
            AND paid_amount < amount
          ORDER BY
            installment_no ASC
          FOR UPDATE
          `,
          [purchaseId]
        );

      let selectedInstallmentId =
        null;

      for (
        const installment
        of installmentsResult.rows
      ) {
        if (
          remaining <= 0.005
        ) {
          break;
        }

        const installmentBalance =
          money(
            installment.amount -
              installment.paid_amount
          );

        const applied =
          Math.min(
            remaining,
            installmentBalance
          );

        if (
          applied <= 0
        ) {
          continue;
        }

        selectedInstallmentId =
          selectedInstallmentId ||
          installment.id;

        const newPaid =
          money(
            Number(
              installment.paid_amount
            ) + applied
          );

        const newStatus =
          calculateStatus(
            Number(
              installment.amount
            ),
            newPaid
          );

        await client.query(
          `
          UPDATE purchase_installments
          SET
            paid_amount = $1,
            status = $2
          WHERE id = $3
          `,
          [
            newPaid,
            newStatus,
            installment.id,
          ]
        );

        remaining =
          money(
            remaining - applied
          );
      }

      await client.query(
        `
        INSERT INTO purchase_payments (
          purchase_id,
          installment_id,
          amount,
          payment,
          note
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          purchaseId,
          selectedInstallmentId,
          paymentAmount,
          payment || null,
          note || null,
        ]
      );

      const newPaidAmount =
        money(
          Number(
            purchase.paid_amount
          ) + paymentAmount
        );

      const newBalance =
        money(
          Number(
            purchase.total
          ) -
            newPaidAmount
        );

      const newStatus =
        calculateStatus(
          Number(
            purchase.total
          ),
          newPaidAmount
        );

      await client.query(
        `
        UPDATE purchases
        SET
          paid_amount = $1,
          balance = $2,
          status = $3
        WHERE id = $4
        `,
        [
          newPaidAmount,
          newBalance,
          newStatus,
          purchaseId,
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        paid_amount:
          newPaidAmount,
        balance:
          newBalance,
        status:
          newStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   CANCELAMENTO DE COMPRA
   Retira do estoque os produtos que haviam entrado pela compra.
========================================================= */

app.post(
  "/api/purchases/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchaseId =
      integer(req.params.id);

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const purchaseResult =
        await client.query(
          `
          SELECT *
          FROM purchases
          WHERE id = $1
          FOR UPDATE
          `,
          [purchaseId]
        );

      if (
        !purchaseResult.rows.length
      ) {
        throw new Error(
          "Compra não encontrada."
        );
      }

      const purchase =
        purchaseResult.rows[0];

      if (
        String(
          purchase.status || ""
        ).toLowerCase() ===
        "cancelada"
      ) {
        throw new Error(
          "Esta compra já está cancelada."
        );
      }

      const itemsResult =
        await client.query(
          `
          SELECT *
          FROM purchase_items
          WHERE purchase_id = $1
          ORDER BY id
          `,
          [purchaseId]
        );

      for (
        const item
        of itemsResult.rows
      ) {
        const productResult =
          await client.query(
            `
            SELECT id, stock
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [item.product_id]
          );

        if (
          !productResult.rows.length
        ) {
          throw new Error(
            `Produto ID ${item.product_id} não encontrado.`
          );
        }

        const currentStock =
          integer(
            productResult.rows[0]
              .stock
          );

        const quantity =
          integer(item.quantity);

        if (
          currentStock <
          quantity
        ) {
          throw new Error(
            `Não é possível cancelar a compra #${purchaseId}: o estoque atual do produto ID ${item.product_id} é menor que a quantidade que entrou nessa compra.`
          );
        }

        await client.query(
          `
          UPDATE products
          SET
            stock = stock - $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            quantity,
            integer(
              item.product_id
            ),
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves (
            product_id,
            quantity,
            type,
            note,
            reference_type,
            reference_id
          )
          VALUES (
            $1,
            $2,
            'saida',
            $3,
            'cancelamento_compra',
            $4
          )
          `,
          [
            item.product_id,
            quantity,
            `Retirada do estoque referente ao cancelamento da compra #${purchaseId}`,
            purchaseId,
          ]
        );
      }

      await client.query(
        `
        UPDATE purchases
        SET
          status = 'Cancelada',
          balance = 0
        WHERE id = $1
        `,
        [purchaseId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        message:
          "Compra cancelada e a entrada correspondente foi retirada do estoque.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return sendError(res, error);
    } finally {
      client.release();
    }
  })
);
/* =========================================================
   RELATÓRIOS
========================================================= */

app.get(
  "/api/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const salesResult =
      await pool.query(`
        SELECT
          COALESCE(
            SUM(total),
            0
          ) AS total_sales,

          COALESCE(
            SUM(balance),
            0
          ) AS receivable

        FROM sales

        WHERE LOWER(
          COALESCE(
            status,
            ''
          )
        ) <> 'cancelada'
      `);

    const purchasesResult =
      await pool.query(`
        SELECT
          COALESCE(
            SUM(total),
            0
          ) AS total_purchases,

          COALESCE(
            SUM(balance),
            0
          ) AS payable

        FROM purchases

        WHERE LOWER(
          COALESCE(
            status,
            ''
          )
        ) <> 'cancelada'
      `);

    const salesByMonth =
      await pool.query(`
        SELECT
          EXTRACT(
            YEAR FROM date
          )::INTEGER AS year,

          EXTRACT(
            MONTH FROM date
          )::INTEGER AS month,

          TO_CHAR(
            date,
            'TMMonth/YYYY'
          ) AS label,

          COALESCE(
            SUM(total),
            0
          ) AS total,

          COUNT(*)::INTEGER
            AS quantity

        FROM sales

        WHERE LOWER(
          COALESCE(
            status,
            ''
          )
        ) <> 'cancelada'

        GROUP BY
          EXTRACT(
            YEAR FROM date
          ),
          EXTRACT(
            MONTH FROM date
          ),
          TO_CHAR(
            date,
            'TMMonth/YYYY'
          )

        ORDER BY
          year,
          month
      `);

    const purchasesByMonth =
      await pool.query(`
        SELECT
          EXTRACT(
            YEAR FROM date
          )::INTEGER AS year,

          EXTRACT(
            MONTH FROM date
          )::INTEGER AS month,

          TO_CHAR(
            date,
            'TMMonth/YYYY'
          ) AS label,

          COALESCE(
            SUM(total),
            0
          ) AS total,

          COUNT(*)::INTEGER
            AS quantity

        FROM purchases

        WHERE LOWER(
          COALESCE(
            status,
            ''
          )
        ) <> 'cancelada'

        GROUP BY
          EXTRACT(
            YEAR FROM date
          ),
          EXTRACT(
            MONTH FROM date
          ),
          TO_CHAR(
            date,
            'TMMonth/YYYY'
          )

        ORDER BY
          year,
          month
      `);

    const receivables =
      await pool.query(`
        SELECT
          EXTRACT(
            YEAR FROM due_date
          )::INTEGER AS year,

          EXTRACT(
            MONTH FROM due_date
          )::INTEGER AS month,

          TO_CHAR(
            due_date,
            'TMMonth/YYYY'
          ) AS label,

          COALESCE(
            SUM(
              amount -
              paid_amount
            ),
            0
          ) AS total,

          COUNT(*)::INTEGER
            AS quantity

        FROM sale_installments si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          amount > paid_amount

          AND LOWER(
            COALESCE(
              s.status,
              ''
            )
          ) <> 'cancelada'

        GROUP BY
          EXTRACT(
            YEAR FROM due_date
          ),
          EXTRACT(
            MONTH FROM due_date
          ),
          TO_CHAR(
            due_date,
            'TMMonth/YYYY'
          )

        ORDER BY
          year,
          month
      `);

    const payables =
      await pool.query(`
        SELECT
          EXTRACT(
            YEAR FROM due_date
          )::INTEGER AS year,

          EXTRACT(
            MONTH FROM due_date
          )::INTEGER AS month,

          TO_CHAR(
            due_date,
            'TMMonth/YYYY'
          ) AS label,

          COALESCE(
            SUM(
              amount -
              paid_amount
            ),
            0
          ) AS total,

          COUNT(*)::INTEGER
            AS quantity

        FROM purchase_installments pi

        JOIN purchases p
          ON p.id = pi.purchase_id

        WHERE
          amount > paid_amount

          AND LOWER(
            COALESCE(
              p.status,
              ''
            )
          ) <> 'cancelada'

        GROUP BY
          EXTRACT(
            YEAR FROM due_date
          ),
          EXTRACT(
            MONTH FROM due_date
          ),
          TO_CHAR(
            due_date,
            'TMMonth/YYYY'
          )

        ORDER BY
          year,
          month
      `);

    res.json({
      sales: {
        total:
          Number(
            salesResult.rows[0]
              .total_sales
          ),

        receivable:
          Number(
            salesResult.rows[0]
              .receivable
          ),

        months:
          salesByMonth.rows,
      },

      purchases: {
        total:
          Number(
            purchasesResult
              .rows[0]
              .total_purchases
          ),

        payable:
          Number(
            purchasesResult
              .rows[0]
              .payable
          ),

        months:
          purchasesByMonth.rows,
      },

      receivables: {
        total:
          Number(
            salesResult.rows[0]
              .receivable
          ),

        months:
          receivables.rows,
      },

      payables: {
        total:
          Number(
            purchasesResult
              .rows[0]
              .payable
          ),

        months:
          payables.rows,
      },
    });
  })
);

/* =========================================================
   ROTA PRINCIPAL
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   ERROS
========================================================= */

app.use((req, res) => {
  if (
    req.path.startsWith("/api/")
  ) {
    return res.status(404).json({
      error:
        "Rota não encontrada.",
    });
  }

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "ERRO NÃO TRATADO:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        error?.message ||
        "Erro interno do servidor.",
    });
  }
);

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function start() {
  try {
    await initDb();

    app.listen(
      PORT,
      () => {
        console.log(
          `Servidor iniciado na porta ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Não foi possível iniciar o servidor:",
      error
    );

    process.exit(1);
  }
}

start();
