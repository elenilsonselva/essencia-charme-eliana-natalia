const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não configurada.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

const sessions = new Map();

const SESSION_DAYS = 7;
const SESSION_COOKIE = "ec_new_session";

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

function now() {
  return new Date();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function money(value) {
  return round2(value).toFixed(2);
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  let text = String(value).trim();

  text = text.replace(/\s/g, "");

  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  const result = Number(text);

  return Number.isFinite(result) ? result : 0;
}

function int(value) {
  const result = parseInt(value, 10);
  return Number.isFinite(result) ? result : 0;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function dateOnly(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });

  return token;
}

function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];

  if (!token) {
    return res.status(401).json({
      error: "Não autenticado.",
    });
  }

  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({
      error: "Sessão inválida.",
    });
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);

    return res.status(401).json({
      error: "Sessão expirada.",
    });
  }

  req.user = session.username;

  next();
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100),
      name VARCHAR(255) NOT NULL,
      brand VARCHAR(255),
      size VARCHAR(100),
      supplier_id INTEGER,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      photo TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(100),
      address TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(100),
      whatsapp VARCHAR(100),
      document VARCHAR(100),
      address TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      client_id INTEGER,
      sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      entry NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment VARCHAR(50),
      installments INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(30) NOT NULL DEFAULT 'Pendente',
      notes TEXT,
      cancelled_at TIMESTAMP,
      cancelled_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sale_installments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      due_date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Pendente',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      installment_id INTEGER REFERENCES sale_installments(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      payment VARCHAR(50),
      paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER,
      purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      entry NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      installments INTEGER NOT NULL DEFAULT 1,
      payment VARCHAR(50),
      status VARCHAR(30) NOT NULL DEFAULT 'Pendente',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS purchase_installments (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      due_date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Pendente',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS purchase_payments (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      installment_id INTEGER REFERENCES purchase_installments(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      payment VARCHAR(50),
      paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_moves (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      type VARCHAR(30) NOT NULL,
      note TEXT,
      reference_id INTEGER,
      movement_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      token VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_sales_date
    ON sales(sale_date)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale
    ON sale_items(sale_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_sale_installments_sale
    ON sale_installments(sale_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_installments_purchase
    ON purchase_installments(purchase_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
    ON purchase_items(purchase_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_stock_moves_product
    ON stock_moves(product_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_purchases_date
    ON purchases(purchase_date)
  `);

  console.log("Banco de dados inicializado.");
}

/* =========================================================
   AUTH
========================================================= */

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (
    username !== ADMIN_USER ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Usuário ou senha inválidos.",
    });
  }

  const token = createSession(username);

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });

  res.json({
    ok: true,
    username,
  });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies[SESSION_COOKIE];

  if (token) {
    sessions.delete(token);
  }

  res.clearCookie(SESSION_COOKIE);

  res.json({
    ok: true,
  });
});

app.get("/api/me", (req, res) => {
  const token = req.cookies[SESSION_COOKIE];

  if (!token) {
    return res.json({
      authenticated: false,
    });
  }

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    if (session) {
      sessions.delete(token);
    }

    return res.json({
      authenticated: false,
    });
  }

  res.json({
    authenticated: true,
    username: session.username,
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      ok: true,
      database: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message,
    });
  }
});

/* =========================================================
   SUPPLIERS
========================================================= */

app.get("/api/suppliers", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT *
      FROM suppliers
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao buscar fornecedores.",
    });
  }
});

app.post("/api/suppliers", requireAuth, async (req, res) => {
  try {
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

    const result = await query(
      `
      INSERT INTO suppliers
      (name, phone, whatsapp, document, address, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        String(name).trim(),
        phone || null,
        whatsapp || null,
        document || null,
        address || null,
        notes || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao cadastrar fornecedor.",
    });
  }
});

app.put("/api/suppliers/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const {
      name,
      phone,
      whatsapp,
      document,
      address,
      notes,
    } = req.body;

    const result = await query(
      `
      UPDATE suppliers
      SET
        name=$1,
        phone=$2,
        whatsapp=$3,
        document=$4,
        address=$5,
        notes=$6
      WHERE id=$7
      RETURNING *
      `,
      [
        String(name || "").trim(),
        phone || null,
        whatsapp || null,
        document || null,
        address || null,
        notes || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Fornecedor não encontrado.",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao atualizar fornecedor.",
    });
  }
});

app.delete("/api/suppliers/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const products = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM products
      WHERE supplier_id=$1
      `,
      [id]
    );

    const purchases = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM purchases
      WHERE supplier_id=$1
      `,
      [id]
    );

    if (
      products.rows[0].total > 0 ||
      purchases.rows[0].total > 0
    ) {
      return res.status(400).json({
        error:
          "Este fornecedor possui produtos ou compras vinculados e não pode ser excluído.",
      });
    }

    await query(
      `DELETE FROM suppliers WHERE id=$1`,
      [id]
    );

    res.json({
      ok: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao excluir fornecedor.",
    });
  }
});

/* =========================================================
   PRODUCTS
========================================================= */

app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.*,
        s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s
        ON s.id = p.supplier_id
      ORDER BY p.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao buscar produtos.",
    });
  }
});

app.post("/api/products", requireAuth, async (req, res) => {
  try {
    const {
      code,
      name,
      brand,
      size,
      supplier_id,
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

    const result = await query(
      `
      INSERT INTO products
      (
        code,
        name,
        brand,
        size,
        supplier_id,
        cost,
        price,
        stock,
        min_stock,
        photo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        code || null,
        String(name).trim(),
        brand || null,
        size || null,
        supplier_id ? int(supplier_id) : null,
        num(cost),
        num(price),
        int(stock),
        int(min_stock),
        photo || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao cadastrar produto.",
    });
  }
});

app.put("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const {
      code,
      name,
      brand,
      size,
      supplier_id,
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

    const result = await query(
      `
      UPDATE products
      SET
        code=$1,
        name=$2,
        brand=$3,
        size=$4,
        supplier_id=$5,
        cost=$6,
        price=$7,
        stock=$8,
        min_stock=$9,
        photo=$10
      WHERE id=$11
      RETURNING *
      `,
      [
        code || null,
        String(name).trim(),
        brand || null,
        size || null,
        supplier_id ? int(supplier_id) : null,
        num(cost),
        num(price),
        int(stock),
        int(min_stock),
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
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao atualizar produto.",
    });
  }
});

app.delete("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const used = await query(
      `
      SELECT
        (SELECT COUNT(*) FROM sale_items WHERE product_id=$1) AS sales,
        (SELECT COUNT(*) FROM purchase_items WHERE product_id=$1) AS purchases,
        (SELECT COUNT(*) FROM stock_moves WHERE product_id=$1) AS stock_moves
      `,
      [id]
    );

    const row = used.rows[0];

    if (
      Number(row.sales) > 0 ||
      Number(row.purchases) > 0 ||
      Number(row.stock_moves) > 0
    ) {
      return res.status(400).json({
        error:
          "Este produto já possui movimentações e não pode ser excluído.",
      });
    }

    await query(
      `DELETE FROM products WHERE id=$1`,
      [id]
    );

    res.json({
      ok: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao excluir produto.",
    });
  }
});

/* =========================================================
   CLIENTS
========================================================= */

app.get("/api/clients", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT *
      FROM clients
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao buscar clientes.",
    });
  }
});

app.post("/api/clients", requireAuth, async (req, res) => {
  try {
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

    const result = await query(
      `
      INSERT INTO clients
      (name, phone, address, notes)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        String(name).trim(),
        phone || null,
        address || null,
        notes || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao cadastrar cliente.",
    });
  }
});

app.put("/api/clients/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const {
      name,
      phone,
      address,
      notes,
    } = req.body;

    const result = await query(
      `
      UPDATE clients
      SET
        name=$1,
        phone=$2,
        address=$3,
        notes=$4
      WHERE id=$5
      RETURNING *
      `,
      [
        String(name || "").trim(),
        phone || null,
        address || null,
        notes || null,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Cliente não encontrado.",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao atualizar cliente.",
    });
  }
});

app.delete("/api/clients/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const sales = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM sales
      WHERE client_id=$1
      `,
      [id]
    );

    if (sales.rows[0].total > 0) {
      return res.status(400).json({
        error:
          "Este cliente possui vendas vinculadas e não pode ser excluído.",
      });
    }

    await query(
      `DELETE FROM clients WHERE id=$1`,
      [id]
    );

    res.json({
      ok: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao excluir cliente.",
    });
  }
});

/* =========================================================
   STOCK
========================================================= */

app.post("/api/stock", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productId = int(req.body.product_id);
    const quantity = int(req.body.quantity);
    const type = String(req.body.type || "").trim();
    const note = req.body.note || null;

    if (!productId || !quantity || quantity === 0) {
      throw new Error("Produto e quantidade são obrigatórios.");
    }

    const allowed = [
      "Entrada",
      "Saída",
      "Ajuste",
    ];

    if (!allowed.includes(type)) {
      throw new Error("Tipo de movimentação inválido.");
    }

    const productResult = await client.query(
      `
      SELECT *
      FROM products
      WHERE id=$1
      FOR UPDATE
      `,
      [productId]
    );

    if (!productResult.rows.length) {
      throw new Error("Produto não encontrado.");
    }

    let delta = quantity;

    if (type === "Saída") {
      delta = -Math.abs(quantity);
    }

    if (type === "Entrada") {
      delta = Math.abs(quantity);
    }

    const newStock =
      int(productResult.rows[0].stock) + delta;

    if (newStock < 0) {
      throw new Error(
        "Estoque insuficiente para esta movimentação."
      );
    }

    await client.query(
      `
      UPDATE products
      SET stock=$1
      WHERE id=$2
      `,
      [newStock, productId]
    );

    await client.query(
      `
      INSERT INTO stock_moves
      (product_id, quantity, type, note)
      VALUES ($1,$2,$3,$4)
      `,
      [
        productId,
        delta,
        type,
        note,
      ]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      stock: newStock,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(400).json({
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.get("/api/stock/moves", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        sm.*,
        p.name AS product_name
      FROM stock_moves sm
      JOIN products p
        ON p.id = sm.product_id
      ORDER BY sm.movement_date DESC, sm.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao buscar movimentações.",
    });
  }
});

/* =========================================================
   SALES
========================================================= */

async function createSaleInstallments(
  client,
  saleId,
  balance,
  installments,
  firstDueDate
) {
  const count = Math.max(1, int(installments));
  const total = round2(balance);

  if (total <= 0) {
    return;
  }

  const baseAmount = round2(total / count);

  let accumulated = 0;

  for (let i = 1; i <= count; i++) {
    let amount = baseAmount;

    if (i === count) {
      amount = round2(total - accumulated);
    }

    accumulated = round2(accumulated + amount);

    const dueDate = new Date(firstDueDate);

    dueDate.setMonth(
      dueDate.getMonth() + (i - 1)
    );

    await client.query(
      `
      INSERT INTO sale_installments
      (
        sale_id,
        installment_no,
        due_date,
        amount,
        paid_amount,
        status
      )
      VALUES ($1,$2,$3,$4,0,'Pendente')
      `,
      [
        saleId,
        i,
        dateOnly(dueDate),
        amount,
      ]
    );
  }
}

app.get("/api/sales", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        s.*,
        c.name AS client_name
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
      ORDER BY s.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao buscar vendas.",
    });
  }
});

app.get("/api/sales/:id", requireAuth, async (req, res) => {
  try {
    const id = int(req.params.id);

    const sale = await query(
      `
      SELECT
        s.*,
        c.name AS client_name,
        c.phone AS client_phone
      FROM sales s
      LEFT JOIN clients c
        ON c.id=s.client_id
      WHERE s.id=$1
      `,
      [id]
    );

    if (!sale.rows.length) {
      return res.status(404).json({
        error: "Venda não encontrada.",
      });
    }

    const items = await query(
      `
      SELECT
        si.*,
        p.name AS product_name,
        p.code AS product_code
      FROM sale_items si
      JOIN products p
        ON p.id=si.product_id
      WHERE si.sale_id=$1
      ORDER BY si.id
      `,
      [id]
    );

    const installments = await query(
      `
      SELECT *
      FROM sale_installments
      WHERE sale_id=$1
      ORDER BY installment_no
      `,
      [id]
    );

    const payments = await query(
      `
      SELECT *
      FROM sale_payments
      WHERE sale_id=$1
      ORDER BY paid_at DESC, id DESC
      `,
      [id]
    );

    res.json({
      sale: sale.rows[0],
      items: items.rows,
      installments: installments.rows,
      payments: payments.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao buscar detalhes da venda.",
    });
  }
});

app.post("/api/sales", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      client_id,
      discount,
      payment,
      installments,
      entry,
      first_due_date,
      notes,
      items,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        "Adicione pelo menos um produto à venda."
      );
    }

    let subtotal = 0;

    const preparedItems = [];

    for (const item of items) {
      const productId = int(item.product_id);
      const quantity = int(item.quantity);

      if (!productId || quantity <= 0) {
        throw new Error(
          "Produto ou quantidade inválida."
        );
      }

      const productResult = await client.query(
        `
        SELECT *
        FROM products
        WHERE id=$1
        FOR UPDATE
        `,
        [productId]
      );

      if (!productResult.rows.length) {
        throw new Error(
          "Produto não encontrado."
        );
      }

      const product = productResult.rows[0];

      if (int(product.stock) < quantity) {
        throw new Error(
          `Estoque insuficiente para ${product.name}.`
        );
      }

      const price = round2(
        item.price !== undefined
          ? num(item.price)
          : num(product.price)
      );

      const cost = round2(product.cost);

      const lineTotal = round2(
        price * quantity
      );

      subtotal = round2(
        subtotal + lineTotal
      );

      preparedItems.push({
        productId,
        quantity,
        price,
        cost,
      });
    }

    const discountValue = Math.max(
      0,
      num(discount)
    );

    const total = Math.max(
      0,
      round2(subtotal - discountValue)
    );

    const entryValue = Math.max(
      0,
      Math.min(num(entry), total)
    );

    const balance = round2(
      total - entryValue
    );

    let status = "Pendente";

    if (balance <= 0) {
      status = "Pago";
    } else if (entryValue > 0) {
      status = "Parcial";
    }

    const saleResult = await client.query(
      `
      INSERT INTO sales
      (
        client_id,
        subtotal,
        discount,
        total,
        entry,
        paid_amount,
        balance,
        payment,
        installments,
        status,
        notes
      )
      VALUES
      ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        client_id ? int(client_id) : null,
        subtotal,
        discountValue,
        total,
        entryValue,
        balance,
        payment || null,
        Math.max(1, int(installments)),
        status,
        notes || null,
      ]
    );

    const sale = saleResult.rows[0];

    for (const item of preparedItems) {
      await client.query(
        `
        INSERT INTO sale_items
        (
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
        SET stock = stock - $1
        WHERE id=$2
        `,
        [
          item.quantity,
          item.productId,
        ]
      );

      await client.query(
        `
        INSERT INTO stock_moves
        (
          product_id,
          quantity,
          type,
          note,
          reference_id
        )
        VALUES ($1,$2,'Saída',$3,$4)
        `,
        [
          item.productId,
          -item.quantity,
          `Venda #${sale.id}`,
          sale.id,
        ]
      );
    }

    if (entryValue > 0) {
      await client.query(
        `
        INSERT INTO sale_payments
        (
          sale_id,
          installment_id,
          amount,
          payment,
          note
        )
        VALUES ($1,NULL,$2,$3,'Entrada da venda')
        `,
        [
          sale.id,
          entryValue,
          payment || null,
        ]
      );
    }

    if (balance > 0) {
      await createSaleInstallments(
        client,
        sale.id,
        balance,
        installments,
        first_due_date || dateOnly(addMonths(now(), 1))
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      sale_id: sale.id,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(400).json({
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.get(
  "/api/sales/:id/installments",
  requireAuth,
  async (req, res) => {
    try {
      const id = int(req.params.id);

      const result = await query(
        `
        SELECT *
        FROM sale_installments
        WHERE sale_id=$1
        ORDER BY installment_no
        `,
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar parcelas.",
      });
    }
  }
);

app.get(
  "/api/sales/:id/payments",
  requireAuth,
  async (req, res) => {
    try {
      const id = int(req.params.id);

      const result = await query(
        `
        SELECT *
        FROM sale_payments
        WHERE sale_id=$1
        ORDER BY paid_at DESC, id DESC
        `,
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar pagamentos.",
      });
    }
  }
);

app.post(
  "/api/sales/:id/pay",
  requireAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const saleId = int(req.params.id);
      const amount = num(req.body.amount);
      const payment = req.body.payment || null;
      const installmentId = req.body.installment_id
        ? int(req.body.installment_id)
        : null;
      const note = req.body.note || null;

      if (amount <= 0) {
        throw new Error(
          "Informe um valor de pagamento válido."
        );
      }

      const saleResult = await client.query(
        `
        SELECT *
        FROM sales
        WHERE id=$1
        FOR UPDATE
        `,
        [saleId]
      );

      if (!saleResult.rows.length) {
        throw new Error(
          "Venda não encontrada."
        );
      }

      const sale = saleResult.rows[0];

      if (num(sale.balance) <= 0) {
        throw new Error(
          "Esta venda já está totalmente paga."
        );
      }

      const paymentAmount = Math.min(
        amount,
        num(sale.balance)
      );

      let targetInstallment = null;

      if (installmentId) {
        const installmentResult =
          await client.query(
            `
            SELECT *
            FROM sale_installments
            WHERE id=$1
              AND sale_id=$2
            FOR UPDATE
            `,
            [
              installmentId,
              saleId,
            ]
          );

        if (!installmentResult.rows.length) {
          throw new Error(
            "Parcela não encontrada."
          );
        }

        targetInstallment =
          installmentResult.rows[0];
      } else {
        const installmentResult =
          await client.query(
            `
            SELECT *
            FROM sale_installments
            WHERE sale_id=$1
              AND paid_amount < amount
            ORDER BY installment_no
            LIMIT 1
            FOR UPDATE
            `,
            [saleId]
          );

        if (installmentResult.rows.length) {
          targetInstallment =
            installmentResult.rows[0];
        }
      }

      await client.query(
        `
        INSERT INTO sale_payments
        (
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
          targetInstallment
            ? targetInstallment.id
            : null,
          paymentAmount,
          payment,
          note,
        ]
      );

      if (targetInstallment) {
        const newPaid = round2(
          num(targetInstallment.paid_amount) +
            paymentAmount
        );

        const newStatus =
          newPaid >= num(targetInstallment.amount)
            ? "Pago"
            : newPaid > 0
            ? "Parcial"
            : "Pendente";

        await client.query(
          `
          UPDATE sale_installments
          SET
            paid_amount=$1,
            status=$2
          WHERE id=$3
          `,
          [
            Math.min(
              newPaid,
              num(targetInstallment.amount)
            ),
            newStatus,
            targetInstallment.id,
          ]
        );
      }

      const newPaidAmount = Math.min(
        num(sale.paid_amount) +
          paymentAmount,
        num(sale.total)
      );

      const newBalance = Math.max(
        0,
        round2(
          num(sale.total) -
            newPaidAmount
        )
      );

      const newStatus =
        newBalance <= 0
          ? "Pago"
          : newPaidAmount > 0
          ? "Parcial"
          : "Pendente";

      await client.query(
        `
        UPDATE sales
        SET
          paid_amount=$1,
          balance=$2,
          status=$3
        WHERE id=$4
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
        paid_amount: newPaidAmount,
        balance: newBalance,
        status: newStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(400).json({
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/sales/:id",
  requireAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const saleId = int(req.params.id);

      const saleResult = await client.query(
        `
        SELECT *
        FROM sales
        WHERE id=$1
        FOR UPDATE
        `,
        [saleId]
      );

      if (!saleResult.rows.length) {
        throw new Error(
          "Venda não encontrada."
        );
      }

      const sale = saleResult.rows[0];

      if (sale.cancelled_at) {
        throw new Error(
          "Esta venda já foi cancelada."
        );
      }

      const itemsResult = await client.query(
        `
        SELECT *
        FROM sale_items
        WHERE sale_id=$1
        `,
        [saleId]
      );

      for (const item of itemsResult.rows) {
        await client.query(
          `
          UPDATE products
          SET stock=stock+$1
          WHERE id=$2
          `,
          [
            int(item.quantity),
            int(item.product_id),
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves
          (
            product_id,
            quantity,
            type,
            note,
            reference_id
          )
          VALUES
          ($1,$2,'Entrada',$3,$4)
          `,
          [
            int(item.product_id),
            int(item.quantity),
            `Cancelamento da venda #${saleId}`,
            saleId,
          ]
        );
      }

      await client.query(
        `
        UPDATE sales
        SET
          status='Cancelada',
          cancelled_at=CURRENT_TIMESTAMP,
          cancelled_reason=$1
        WHERE id=$2
        `,
        [
          req.body.reason ||
            "Venda cancelada.",
          saleId,
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(400).json({
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   PURCHASES
========================================================= */

async function createPurchaseInstallments(
  client,
  purchaseId,
  balance,
  installments,
  firstDueDate
) {
  const count = Math.max(1, int(installments));
  const total = round2(balance);

  if (total <= 0) {
    return;
  }

  const baseAmount = round2(
    total / count
  );

  let accumulated = 0;

  for (let i = 1; i <= count; i++) {
    let amount = baseAmount;

    if (i === count) {
      amount = round2(
        total - accumulated
      );
    }

    accumulated = round2(
      accumulated + amount
    );

    const dueDate = new Date(firstDueDate);

    dueDate.setMonth(
      dueDate.getMonth() + (i - 1)
    );

    await client.query(
      `
      INSERT INTO purchase_installments
      (
        purchase_id,
        installment_no,
        due_date,
        amount,
        paid_amount,
        status
      )
      VALUES ($1,$2,$3,$4,0,'Pendente')
      `,
      [
        purchaseId,
        i,
        dateOnly(dueDate),
        amount,
      ]
    );
  }
}

app.get(
  "/api/purchases",
  requireAuth,
  async (req, res) => {
    try {
      const result = await query(`
        SELECT
          p.*,
          s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s
          ON s.id=p.supplier_id
        ORDER BY p.id DESC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar compras.",
      });
    }
  }
);

app.get(
  "/api/purchases/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id = int(req.params.id);

      const purchase = await query(
        `
        SELECT
          p.*,
          s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s
          ON s.id=p.supplier_id
        WHERE p.id=$1
        `,
        [id]
      );

      if (!purchase.rows.length) {
        return res.status(404).json({
          error: "Compra não encontrada.",
        });
      }

      const items = await query(
        `
        SELECT
          pi.*,
          p.name AS product_name
        FROM purchase_items pi
        JOIN products p
          ON p.id=pi.product_id
        WHERE pi.purchase_id=$1
        ORDER BY pi.id
        `,
        [id]
      );

      const installments = await query(
        `
        SELECT *
        FROM purchase_installments
        WHERE purchase_id=$1
        ORDER BY installment_no
        `,
        [id]
      );

      const payments = await query(
        `
        SELECT *
        FROM purchase_payments
        WHERE purchase_id=$1
        ORDER BY paid_at DESC, id DESC
        `,
        [id]
      );

      res.json({
        purchase: purchase.rows[0],
        items: items.rows,
        installments: installments.rows,
        payments: payments.rows,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar detalhes da compra.",
      });
    }
  }
);

app.post(
  "/api/purchases",
  requireAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        supplier_id,
        purchase_date,
        payment,
        installments,
        entry,
        first_due_date,
        notes,
        items,
      } = req.body;

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        throw new Error(
          "Adicione pelo menos um produto à compra."
        );
      }

      let subtotal = 0;

      const preparedItems = [];

      for (const item of items) {
        const productId = int(
          item.product_id
        );

        const quantity = int(
          item.quantity
        );

        const cost = num(item.cost);

        if (
          !productId ||
          quantity <= 0 ||
          cost < 0
        ) {
          throw new Error(
            "Produto, quantidade ou custo inválido."
          );
        }

        const productResult =
          await client.query(
            `
            SELECT *
            FROM products
            WHERE id=$1
            FOR UPDATE
            `,
            [productId]
          );

        if (!productResult.rows.length) {
          throw new Error(
            "Produto não encontrado."
          );
        }

        subtotal = round2(
          subtotal +
            cost * quantity
        );

        preparedItems.push({
          productId,
          quantity,
          cost,
        });
      }

      const total = subtotal;

      const entryValue = Math.max(
        0,
        Math.min(num(entry), total)
      );

      const balance = round2(
        total - entryValue
      );

      let status = "Pendente";

      if (balance <= 0) {
        status = "Pago";
      } else if (entryValue > 0) {
        status = "Parcial";
      }

      const purchaseResult =
        await client.query(
          `
          INSERT INTO purchases
          (
            supplier_id,
            purchase_date,
            subtotal,
            total,
            entry,
            paid_amount,
            balance,
            installments,
            payment,
            status,
            notes
          )
          VALUES
          ($1,$2,$3,$3,$4,$4,$5,$6,$7,$8,$9)
          RETURNING *
          `,
          [
            supplier_id
              ? int(supplier_id)
              : null,
            purchase_date ||
              dateOnly(now()),
            subtotal,
            entryValue,
            balance,
            Math.max(
              1,
              int(installments)
            ),
            payment || null,
            status,
            notes || null,
          ]
        );

      const purchase =
        purchaseResult.rows[0];

      for (const item of preparedItems) {
        await client.query(
          `
          INSERT INTO purchase_items
          (
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
            stock=stock+$1,
            cost=$2
          WHERE id=$3
          `,
          [
            item.quantity,
            item.cost,
            item.productId,
          ]
        );

        await client.query(
          `
          INSERT INTO stock_moves
          (
            product_id,
            quantity,
            type,
            note,
            reference_id
          )
          VALUES
          ($1,$2,'Entrada',$3,$4)
          `,
          [
            item.productId,
            item.quantity,
            `Compra #${purchase.id}`,
            purchase.id,
          ]
        );
      }

      if (entryValue > 0) {
        await client.query(
          `
          INSERT INTO purchase_payments
          (
            purchase_id,
            installment_id,
            amount,
            payment,
            note
          )
          VALUES ($1,NULL,$2,$3,'Entrada da compra')
          `,
          [
            purchase.id,
            entryValue,
            payment || null,
          ]
        );
      }

      if (balance > 0) {
        await createPurchaseInstallments(
          client,
          purchase.id,
          balance,
          installments,
          first_due_date ||
            dateOnly(
              addMonths(now(), 1)
            )
        );
      }

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        purchase_id: purchase.id,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(400).json({
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/purchases/:id/installments",
  requireAuth,
  async (req, res) => {
    try {
      const id = int(req.params.id);

      const result = await query(
        `
        SELECT *
        FROM purchase_installments
        WHERE purchase_id=$1
        ORDER BY installment_no
        `,
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar parcelas.",
      });
    }
  }
);

app.post(
  "/api/purchases/:id/pay",
  requireAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const purchaseId = int(
        req.params.id
      );

      const amount = num(
        req.body.amount
      );

      const payment =
        req.body.payment || null;

      const installmentId =
        req.body.installment_id
          ? int(req.body.installment_id)
          : null;

      const note =
        req.body.note || null;

      if (amount <= 0) {
        throw new Error(
          "Informe um valor de pagamento válido."
        );
      }

      const purchaseResult =
        await client.query(
          `
          SELECT *
          FROM purchases
          WHERE id=$1
          FOR UPDATE
          `,
          [purchaseId]
        );

      if (!purchaseResult.rows.length) {
        throw new Error(
          "Compra não encontrada."
        );
      }

      const purchase =
        purchaseResult.rows[0];

      if (num(purchase.balance) <= 0) {
        throw new Error(
          "Esta compra já está totalmente paga."
        );
      }

      let targetInstallment = null;

      if (installmentId) {
        const installmentResult =
          await client.query(
            `
            SELECT *
            FROM purchase_installments
            WHERE id=$1
              AND purchase_id=$2
            FOR UPDATE
            `,
            [
              installmentId,
              purchaseId,
            ]
          );

        if (!installmentResult.rows.length) {
          throw new Error(
            "Parcela não encontrada."
          );
        }

        targetInstallment =
          installmentResult.rows[0];
      } else {
        const installmentResult =
          await client.query(
            `
            SELECT *
            FROM purchase_installments
            WHERE purchase_id=$1
              AND paid_amount < amount
            ORDER BY installment_no
            LIMIT 1
            FOR UPDATE
            `,
            [purchaseId]
          );

        if (
          installmentResult.rows.length
        ) {
          targetInstallment =
            installmentResult.rows[0];
        }
      }

      const paymentAmount =
        Math.min(
          amount,
          num(purchase.balance)
        );

      await client.query(
        `
        INSERT INTO purchase_payments
        (
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
          targetInstallment
            ? targetInstallment.id
            : null,
          paymentAmount,
          payment,
          note,
        ]
      );

      if (targetInstallment) {
        const newPaid = round2(
          num(
            targetInstallment.paid_amount
          ) + paymentAmount
        );

        const newStatus =
          newPaid >=
          num(
            targetInstallment.amount
          )
            ? "Pago"
            : newPaid > 0
            ? "Parcial"
            : "Pendente";

        await client.query(
          `
          UPDATE purchase_installments
          SET
            paid_amount=$1,
            status=$2
          WHERE id=$3
          `,
          [
            Math.min(
              newPaid,
              num(
                targetInstallment.amount
              )
            ),
            newStatus,
            targetInstallment.id,
          ]
        );
      }

      const newPaidAmount =
        Math.min(
          num(purchase.paid_amount) +
            paymentAmount,
          num(purchase.total)
        );

      const newBalance =
        Math.max(
          0,
          round2(
            num(purchase.total) -
              newPaidAmount
          )
        );

      const newStatus =
        newBalance <= 0
          ? "Pago"
          : newPaidAmount > 0
          ? "Parcial"
          : "Pendente";

      await client.query(
        `
        UPDATE purchases
        SET
          paid_amount=$1,
          balance=$2,
          status=$3
        WHERE id=$4
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
        balance: newBalance,
        status: newStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(400).json({
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  "/api/dashboard",
  requireAuth,
  async (req, res) => {
    try {
      const today = dateOnly(now());

      const monthStart = new Date();
      monthStart.setDate(1);

      const monthStartText =
        dateOnly(monthStart);

      const salesToday = await query(
        `
        SELECT COALESCE(SUM(total),0) AS total
        FROM sales
        WHERE sale_date=$1
          AND status <> 'Cancelada'
        `,
        [today]
      );

      const salesMonth = await query(
        `
        SELECT COALESCE(SUM(total),0) AS total
        FROM sales
        WHERE sale_date >= $1
          AND status <> 'Cancelada'
        `,
        [monthStartText]
      );

      const receivables = await query(
        `
        SELECT COALESCE(SUM(balance),0) AS total
        FROM sales
        WHERE status <> 'Cancelada'
          AND balance > 0
        `
      );

      const payables = await query(
        `
        SELECT COALESCE(SUM(balance),0) AS total
        FROM purchases
        WHERE balance > 0
        `
      );

      const lowStock = await query(
        `
        SELECT COUNT(*)::int AS total
        FROM products
        WHERE stock <= min_stock
        `
      );

      const receivedMonth = await query(
        `
        SELECT COALESCE(SUM(amount),0) AS total
        FROM sale_payments
        WHERE paid_at >= $1::date
        `,
        [monthStartText]
      );

      const nextReceivables =
        await query(`
          SELECT
            si.id,
            si.sale_id,
            si.installment_no,
            si.due_date,
            si.amount,
            si.paid_amount,
            si.status,
            c.name AS client_name
          FROM sale_installments si
          JOIN sales s
            ON s.id=si.sale_id
          LEFT JOIN clients c
            ON c.id=s.client_id
          WHERE si.paid_amount < si.amount
          ORDER BY si.due_date
          LIMIT 10
        `);

      const nextPayables =
        await query(`
          SELECT
            pi.id,
            pi.purchase_id,
            pi.installment_no,
            pi.due_date,
            pi.amount,
            pi.paid_amount,
            pi.status,
            s.name AS supplier_name
          FROM purchase_installments pi
          JOIN purchases p
            ON p.id=pi.purchase_id
          LEFT JOIN suppliers s
            ON s.id=p.supplier_id
          WHERE pi.paid_amount < pi.amount
          ORDER BY pi.due_date
          LIMIT 10
        `);

      res.json({
        sales_today: num(
          salesToday.rows[0].total
        ),
        sales_month: num(
          salesMonth.rows[0].total
        ),
        receivables: num(
          receivables.rows[0].total
        ),
        payables: num(
          payables.rows[0].total
        ),
        low_stock: int(
          lowStock.rows[0].total
        ),
        received_month: num(
          receivedMonth.rows[0].total
        ),
        next_receivables:
          nextReceivables.rows,
        next_payables:
          nextPayables.rows,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao carregar dashboard.",
      });
    }
  }
);

/* =========================================================
   REPORTS
========================================================= */

app.get(
  "/api/reports",
  requireAuth,
  async (req, res) => {
    try {
      const from =
        req.query.from ||
        dateOnly(
          new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1
          )
        );

      const to =
        req.query.to ||
        dateOnly(now());

      const sales = await query(
        `
        SELECT
          COUNT(*)::int AS quantity,
          COALESCE(SUM(total),0) AS total
        FROM sales
        WHERE sale_date BETWEEN $1 AND $2
          AND status <> 'Cancelada'
        `,
        [from, to]
      );

      const received = await query(
        `
        SELECT
          COALESCE(SUM(amount),0) AS total
        FROM sale_payments
        WHERE paid_at::date BETWEEN $1 AND $2
        `,
        [from, to]
      );

      const purchases = await query(
        `
        SELECT
          COUNT(*)::int AS quantity,
          COALESCE(SUM(total),0) AS total
        FROM purchases
        WHERE purchase_date BETWEEN $1 AND $2
        `,
        [from, to]
      );

      const receivable = await query(`
        SELECT
          COALESCE(SUM(balance),0) AS total
        FROM sales
        WHERE status <> 'Cancelada'
          AND balance > 0
      `);

      const payable = await query(`
        SELECT
          COALESCE(SUM(balance),0) AS total
        FROM purchases
        WHERE balance > 0
      `);

      const topProducts = await query(
        `
        SELECT
          p.name,
          SUM(si.quantity)::int AS quantity,
          COALESCE(
            SUM(si.quantity * si.price),
            0
          ) AS total
        FROM sale_items si
        JOIN sales s
          ON s.id=si.sale_id
        JOIN products p
          ON p.id=si.product_id
        WHERE s.sale_date BETWEEN $1 AND $2
          AND s.status <> 'Cancelada'
        GROUP BY p.id,p.name
        ORDER BY quantity DESC
        LIMIT 10
        `,
        [from, to]
      );

      const debtors = await query(`
        SELECT
          c.name,
          COUNT(s.id)::int AS sales_count,
          COALESCE(SUM(s.balance),0) AS balance
        FROM sales s
        LEFT JOIN clients c
          ON c.id=s.client_id
        WHERE s.status <> 'Cancelada'
          AND s.balance > 0
        GROUP BY c.id,c.name
        ORDER BY balance DESC
        LIMIT 20
      `);

      res.json({
        period: {
          from,
          to,
        },
        sales: sales.rows[0],
        received: received.rows[0],
        purchases: purchases.rows[0],
        receivable:
          receivable.rows[0],
        payable:
          payable.rows[0],
        top_products:
          topProducts.rows,
        debtors:
          debtors.rows,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao gerar relatório.",
      });
    }
  }
);

/* =========================================================
   SPA FALLBACK
========================================================= */

app.get("*", (req, res) => {
  res.sendFile(
    require("path").join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(error);

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        error.message ||
        "Erro interno do servidor.",
    });
  }
);

/* =========================================================
   START
========================================================= */

initDb()
  .then(() => {
    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Servidor iniciado na porta ${PORT}`
        );
      }
    );
  })
  .catch((error) => {
    console.error(
      "Erro ao inicializar banco:",
      error
    );

    process.exit(1);
  });
