const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
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
    const adminPassword = process.env.ADMIN_PASSWORD || "123456";

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
      DELETE FROM sessions
      WHERE expires_at <= NOW()
      `
    );

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

    return res.json({
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
        `
        DELETE FROM sessions
        WHERE id = $1
        `,
        [token]
      );
    }

    res.clearCookie("session");

    return res.json({
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
        min_stock
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
      ]
    );

    const product = result.rows[0];

    if (integer(stock) !== 0) {
      await pool.query(
        `
        INSERT INTO stock_moves (
          product_id,
          quantity,
          type,
          note,
          reference_type
        )
        VALUES ($1,$2,'entrada',$3,'cadastro')
        `,
        [
          product.id,
          integer(stock),
          "Estoque inicial",
        ]
      );
    }

    res.status(201).json(product);
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
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        error: "Informe o nome do produto.",
      });
    }

    const oldResult = await pool.query(
      `
      SELECT stock
      FROM products
      WHERE id = $1
      `,
      [id]
    );

    if (!oldResult.rows.length) {
      return res.status(404).json({
        error: "Produto não encontrado.",
      });
    }

    const oldStock = integer(oldResult.rows[0].stock);
    const newStock = integer(stock);

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
        updated_at = NOW()
      WHERE id = $10
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
        newStock,
        integer(min_stock),
        id,
      ]
    );

    if (newStock !== oldStock) {
      const difference = newStock - oldStock;

      await pool.query(
        `
        INSERT INTO stock_moves (
          product_id,
          quantity,
          type,
          note,
          reference_type
        )
        VALUES ($1,$2,$3,$4,'ajuste')
        `,
        [
          id,
          Math.abs(difference),
          difference > 0 ? "entrada" : "saida",
          "Ajuste no cadastro do produto",
        ]
      );
    }

    res.json(result.rows[0]);
  })
);

app.delete(
  "/api/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const used = await pool.query(
      `
      SELECT
        EXISTS(
          SELECT 1 FROM sale_items WHERE product_id = $1
        ) AS used_in_sales,
        EXISTS(
          SELECT 1 FROM purchase_items WHERE product_id = $1
        ) AS used_in_purchases
      `,
      [id]
    );

    if (
      used.rows[0].used_in_sales ||
      used.rows[0].used_in_purchases
    ) {
      return res.status(409).json({
        error:
          "Este produto já possui movimentações e não pode ser excluído.",
      });
    }

    await pool.query(
      `
      DELETE FROM products
      WHERE id = $1
      `,
      [id]
    );

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

    const used = await pool.query(
      `
      SELECT EXISTS(
        SELECT 1
        FROM sales
        WHERE client_id = $1
      ) AS used
      `,
      [id]
    );

    if (used.rows[0].used) {
      return res.status(409).json({
        error:
          "Este cliente já possui vendas e não pode ser excluído.",
      });
    }

    await pool.query(
      `
      DELETE FROM clients
      WHERE id = $1
      `,
      [id]
    );

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

    const used = await pool.query(
      `
      SELECT
        EXISTS(
          SELECT 1 FROM products WHERE supplier_id = $1
        ) AS used_in_products,
        EXISTS(
          SELECT 1 FROM purchases WHERE supplier_id = $1
        ) AS used_in_purchases
      `,
      [id]
    );

    if (
      used.rows[0].used_in_products ||
      used.rows[0].used_in_purchases
    ) {
      return res.status(409).json({
        error:
          "Este fornecedor já possui movimentações e não pode ser excluído.",
      });
    }

    await pool.query(
      `
      DELETE FROM suppliers
      WHERE id = $1
      `,
      [id]
    );

    res.json({ ok: true });
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
        c.name AS client_name
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
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
      `
      SELECT
        s.*,
        c.name AS client_name
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
        p.code AS product_code
      FROM sale_items si
      JOIN products p
        ON p.id = si.product_id
      WHERE si.sale_id = $1
      ORDER BY si.id
      `,
      [id]
    );

    const installmentsResult = await pool.query(
      `
      SELECT *
      FROM sale_installments
      WHERE sale_id = $1
      ORDER BY installment_no
      `,
      [id]
    );

    const paymentsResult = await pool.query(
      `
      SELECT *
      FROM sale_payments
      WHERE sale_id = $1
      ORDER BY paid_at DESC, id DESC
      `,
      [id]
    );

    res.json({
      sale: {
        ...saleResult.rows[0],
        items: itemsResult.rows,
        installments: installmentsResult.rows,
        payments: paymentsResult.rows,
      },
    });
  })
);

app.post(
  "/api/sales",
  requireAuth,
  asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        client_id,
        date,
        subtotal,
        discount,
        total,
        payment,
        installments,
        entry,
        notes,
        items,
        first_due_date,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "Adicione pelo menos um produto à venda.",
        });
      }

      const saleDate = date || today();
      const saleSubtotal = money(subtotal);
      const saleDiscount = money(discount);
      const saleTotal = money(
        total || saleSubtotal - saleDiscount
      );

      if (saleTotal <= 0) {
        return res.status(400).json({
          error: "O valor total da venda deve ser maior que zero.",
        });
      }

      let saleEntry = money(entry);

      if (saleEntry < 0) saleEntry = 0;
      if (saleEntry > saleTotal) saleEntry = saleTotal;

      let installmentCount = integer(installments);

      if (installmentCount < 1) {
        installmentCount = 1;
      }

      await client.query("BEGIN");

      /* Verifica estoque e produtos */
      const normalizedItems = [];

      for (const item of items) {
        const productId = integer(item.product_id);
        const quantity = integer(item.quantity);
        const price = money(item.price);
        const cost = money(item.cost);

        if (!productId || quantity <= 0) {
          throw new Error(
            "Existe um item da venda com quantidade inválida."
          );
        }

        const productResult = await client.query(
          `
          SELECT
            id,
            name,
            stock,
            cost,
            price
          FROM products
          WHERE id = $1
          FOR UPDATE
          `,
          [productId]
        );

        if (!productResult.rows.length) {
          throw new Error(
            `Produto ID ${productId} não encontrado.`
          );
        }

        const product = productResult.rows[0];

        if (integer(product.stock) < quantity) {
          throw new Error(
            `Estoque insuficiente para o produto "${product.name}". Estoque disponível: ${product.stock}.`
          );
        }

        normalizedItems.push({
          product_id: productId,
          quantity,
          price:
            price > 0
              ? price
              : money(product.price),
          cost:
            cost > 0
              ? cost
              : money(product.cost),
        });
      }

      const initialPaid = money(saleEntry);
      const initialBalance = money(
        Math.max(0, saleTotal - initialPaid)
      );

      const status = calculateStatus(
        saleTotal,
        initialPaid
      );

      const saleResult = await client.query(
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
          client_id ? integer(client_id) : null,
          saleDate,
          saleSubtotal,
          saleDiscount,
          saleTotal,
          String(payment || "").trim() || null,
          installmentCount,
          saleEntry,
          initialPaid,
          initialBalance,
          status,
          String(notes || "").trim() || null,
        ]
      );

      const sale = saleResult.rows[0];

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
            item.product_id,
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
            item.product_id,
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
            $1,$2,'saida',$3,'venda',$4
          )
          `,
          [
            item.product_id,
            item.quantity,
            `Saída referente à venda #${sale.id}`,
            sale.id,
          ]
        );
      }

      /* Entrada da venda */
      if (saleEntry > 0) {
        await client.query(
          `
          INSERT INTO sale_payments (
            sale_id,
            amount,
            payment,
            note
          )
          VALUES ($1,$2,$3,$4)
          `,
          [
            sale.id,
            saleEntry,
            String(payment || "").trim() || "Entrada",
            "Entrada da venda",
          ]
        );
      }

      /* Parcelas */
      if (initialBalance > 0) {
        const firstDate =
          first_due_date || addMonths(saleDate, 1);

        const baseAmount = Math.floor(
          (initialBalance / installmentCount) * 100
        ) / 100;

        let accumulated = 0;

        for (let i = 1; i <= installmentCount; i++) {
          let installmentAmount;

          if (i === installmentCount) {
            installmentAmount = money(
              initialBalance - accumulated
            );
          } else {
            installmentAmount = money(baseAmount);
            accumulated = money(
              accumulated + installmentAmount
            );
          }

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
            VALUES ($1,$2,$3,$4,0,'Em aberto')
            `,
            [
              sale.id,
              i,
              addMonths(firstDate, i - 1),
              installmentAmount,
            ]
          );
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        ...sale,
        paid_amount: initialPaid,
        balance: initialBalance,
        status,
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
   PAGAMENTOS DE VENDAS
========================================================= */

app.post(
  "/api/sales/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const saleId = integer(req.params.id);

    const amount = money(req.body.amount);
    const payment = String(
      req.body.payment || ""
    ).trim();
    const note = String(
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

      const saleResult = await client.query(
        `
        SELECT *
        FROM sales
        WHERE id = $1
        FOR UPDATE
        `,
        [saleId]
      );

      if (!saleResult.rows.length) {
        throw new Error("Venda não encontrada.");
      }

      const sale = saleResult.rows[0];

      const currentBalance = money(sale.balance);

      if (currentBalance <= 0) {
        throw new Error(
          "Esta venda já está totalmente paga."
        );
      }

      if (amount > currentBalance + 0.005) {
        throw new Error(
          `O pagamento não pode ser maior que o saldo de R$ ${currentBalance.toFixed(2)}.`
        );
      }

      let remainingPayment = amount;

      /* Distribui o pagamento pelas parcelas mais antigas */
      const installmentsResult = await client.query(
        `
        SELECT *
        FROM sale_installments
        WHERE sale_id = $1
          AND paid_amount < amount
        ORDER BY installment_no
        FOR UPDATE
        `,
        [saleId]
      );

      for (const installment of installmentsResult.rows) {
        if (remainingPayment <= 0.005) break;

        const installmentBalance = money(
          Number(installment.amount) -
            Number(installment.paid_amount)
        );

        const paymentForInstallment = money(
          Math.min(
            remainingPayment,
            installmentBalance
          )
        );

        if (paymentForInstallment <= 0) continue;

        const newPaid = money(
          Number(installment.paid_amount) +
            paymentForInstallment
        );

        const newStatus =
          newPaid >= Number(installment.amount) - 0.005
            ? "Pago"
            : "Parcial";

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

        remainingPayment = money(
          remainingPayment - paymentForInstallment
        );
      }

      /* Caso exista entrada/valor pago sem parcelas */
      await client.query(
        `
        INSERT INTO sale_payments (
          sale_id,
          amount,
          payment,
          note
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          saleId,
          amount,
          payment || "Pagamento",
          note || null,
        ]
      );

      const newPaidAmount = money(
        Number(sale.paid_amount) + amount
      );

      const newBalance = money(
        Math.max(
          0,
          Number(sale.total) - newPaidAmount
        )
      );

      const newStatus = calculateStatus(
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
        paid_amount: newPaidAmount,
        balance: newBalance,
        status: newStatus,
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
   ESTOQUE
========================================================= */

app.get(
  "/api/stock",
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
  "/api/stock",
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = integer(req.body.product_id);
    const quantity = integer(req.body.quantity);
    const type = String(
      req.body.type || "entrada"
    ).trim();
    const note = String(
      req.body.note || ""
    ).trim();

    if (!productId) {
      return res.status(400).json({
        error: "Selecione um produto.",
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        error: "Informe uma quantidade válida.",
      });
    }

    if (!["entrada", "saida", "ajuste"].includes(type)) {
      return res.status(400).json({
        error: "Tipo de movimentação inválido.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `
        SELECT *
        FROM products
        WHERE id = $1
        FOR UPDATE
        `,
        [productId]
      );

      if (!productResult.rows.length) {
        throw new Error("Produto não encontrado.");
      }

      const product = productResult.rows[0];

      let newStock = integer(product.stock);

      if (type === "entrada") {
        newStock += quantity;
      } else if (type === "saida") {
        if (newStock < quantity) {
          throw new Error(
            `Estoque insuficiente. Disponível: ${newStock}.`
          );
        }

        newStock -= quantity;
      } else {
        /*
         * Ajuste:
         * quantidade positiva = aumenta estoque
         * quantidade negativa = reduz estoque
         */
        const signedQuantity = Number(
          req.body.quantity
        );

        newStock = integer(
          integer(product.stock) + signedQuantity
        );

        if (newStock < 0) {
          throw new Error(
            "O estoque não pode ficar negativo."
          );
        }
      }

      await client.query(
        `
        UPDATE products
        SET
          stock = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          newStock,
          productId,
        ]
      );

      await client.query(
        `
        INSERT INTO stock_moves (
          product_id,
          quantity,
          type,
          note,
          reference_type
        )
        VALUES ($1,$2,$3,$4,'manual')
        `,
        [
          productId,
          quantity,
          type,
          note || "Movimentação manual",
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
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
   COMPRAS
========================================================= */

app.get(
  "/api/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT
        p.*,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s
        ON s.id = p.supplier_id
      ORDER BY p.date DESC, p.id DESC
    `);

    res.json(result.rows);
  })
);

app.get(
  "/api/purchases/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = integer(req.params.id);

    const purchaseResult = await pool.query(
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

    if (!purchaseResult.rows.length) {
      return res.status(404).json({
        error: "Compra não encontrada.",
      });
    }

    const itemsResult = await pool.query(
      `
      SELECT
        pi.*,
        p.name AS product_name,
        p.code AS product_code
      FROM purchase_items pi
      JOIN products p
        ON p.id = pi.product_id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id
      `,
      [id]
    );

    const installmentsResult = await pool.query(
      `
      SELECT *
      FROM purchase_installments
      WHERE purchase_id = $1
      ORDER BY installment_no
      `,
      [id]
    );

    const paymentsResult = await pool.query(
      `
      SELECT *
      FROM purchase_payments
      WHERE purchase_id = $1
      ORDER BY paid_at DESC, id DESC
      `,
      [id]
    );

    res.json({
      purchase: {
        ...purchaseResult.rows[0],
        items: itemsResult.rows,
        installments: installmentsResult.rows,
        payments: paymentsResult.rows,
      },
    });
  })
);

app.post(
  "/api/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        supplier_id,
        date,
        total,
        entry,
        payment,
        installments,
        notes,
        items,
        first_due_date,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error:
            "Adicione pelo menos um produto à compra.",
        });
      }

      const purchaseDate = date || today();
      const purchaseTotal = money(total);

      if (purchaseTotal <= 0) {
        return res.status(400).json({
          error:
            "O valor total da compra deve ser maior que zero.",
        });
      }

      let purchaseEntry = money(entry);

      if (purchaseEntry < 0) purchaseEntry = 0;
      if (purchaseEntry > purchaseTotal) {
        purchaseEntry = purchaseTotal;
      }

      let installmentCount = integer(installments);

      if (installmentCount < 1) {
        installmentCount = 1;
      }

      await client.query("BEGIN");

      const normalizedItems = [];

      for (const item of items) {
        const productId = integer(item.product_id);
        const quantity = integer(item.quantity);
        const cost = money(item.cost);

        if (!productId || quantity <= 0) {
          throw new Error(
            "Existe um item da compra com quantidade inválida."
          );
        }

        const productResult = await client.query(
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
            `Produto ID ${productId} não encontrado.`
          );
        }

        const product = productResult.rows[0];

        normalizedItems.push({
          product_id: productId,
          quantity,
          cost:
            cost > 0
              ? cost
              : money(product.cost),
        });
      }

      const initialPaid = money(purchaseEntry);

      const initialBalance = money(
        Math.max(
          0,
          purchaseTotal - initialPaid
        )
      );

      const status = calculateStatus(
        purchaseTotal,
        initialPaid
      );

      const purchaseResult = await client.query(
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
          purchaseDate,
          purchaseTotal,
          purchaseEntry,
          initialPaid,
          initialBalance,
          installmentCount,
          String(payment || "").trim() || null,
          status,
          String(notes || "").trim() || null,
        ]
      );

      const purchase =
        purchaseResult.rows[0];

      for (const item of normalizedItems) {
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
            item.product_id,
            item.quantity,
            item.cost,
          ]
        );

        /*
         * COMPRA ENTRA NO ESTOQUE
         */
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
            item.product_id,
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
            $1,$2,'entrada',$3,'compra',$4
          )
          `,
          [
            item.product_id,
            item.quantity,
            `Entrada referente à compra #${purchase.id}`,
            purchase.id,
          ]
        );
      }

      if (purchaseEntry > 0) {
        await client.query(
          `
          INSERT INTO purchase_payments (
            purchase_id,
            amount,
            payment,
            note
          )
          VALUES ($1,$2,$3,$4)
          `,
          [
            purchase.id,
            purchaseEntry,
            String(payment || "").trim() ||
              "Entrada",
            "Entrada da compra",
          ]
        );
      }

      if (initialBalance > 0) {
        const firstDate =
          first_due_date ||
          addMonths(purchaseDate, 1);

        const baseAmount = Math.floor(
          (initialBalance /
            installmentCount) *
            100
        ) / 100;

        let accumulated = 0;

        for (
          let i = 1;
          i <= installmentCount;
          i++
        ) {
          let installmentAmount;

          if (i === installmentCount) {
            installmentAmount = money(
              initialBalance -
                accumulated
            );
          } else {
            installmentAmount =
              money(baseAmount);

            accumulated = money(
              accumulated +
                installmentAmount
            );
          }

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
              addMonths(
                firstDate,
                i - 1
              ),
              installmentAmount,
            ]
          );
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        ...purchase,
        paid_amount: initialPaid,
        balance: initialBalance,
        status,
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
   PAGAMENTOS DE COMPRAS
========================================================= */

app.post(
  "/api/purchases/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchaseId =
      integer(req.params.id);

    const amount = money(req.body.amount);
    const payment = String(
      req.body.payment || ""
    ).trim();
    const note = String(
      req.body.note || ""
    ).trim();

    if (amount <= 0) {
      return res.status(400).json({
        error:
          "Informe um valor de pagamento válido.",
      });
    }

    const client = await pool.connect();

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

      if (!purchaseResult.rows.length) {
        throw new Error(
          "Compra não encontrada."
        );
      }

      const purchase =
        purchaseResult.rows[0];

      const currentBalance = money(
        purchase.balance
      );

      if (currentBalance <= 0) {
        throw new Error(
          "Esta compra já está totalmente paga."
        );
      }

      if (
        amount >
        currentBalance + 0.005
      ) {
        throw new Error(
          `O pagamento não pode ser maior que o saldo de R$ ${currentBalance.toFixed(2)}.`
        );
      }

      let remainingPayment =
        amount;

      const installmentsResult =
        await client.query(
          `
          SELECT *
          FROM purchase_installments
          WHERE purchase_id = $1
            AND paid_amount < amount
          ORDER BY installment_no
          FOR UPDATE
          `,
          [purchaseId]
        );

      for (
        const installment of
          installmentsResult.rows
      ) {
        if (
          remainingPayment <=
          0.005
        ) {
          break;
        }

        const installmentBalance =
          money(
            Number(
              installment.amount
            ) -
              Number(
                installment.paid_amount
              )
          );

        const paymentForInstallment =
          money(
            Math.min(
              remainingPayment,
              installmentBalance
            )
          );

        if (
          paymentForInstallment <=
          0
        ) {
          continue;
        }

        const newPaid =
          money(
            Number(
              installment.paid_amount
            ) +
              paymentForInstallment
          );

        const newStatus =
          newPaid >=
          Number(
            installment.amount
          ) -
            0.005
            ? "Pago"
            : "Parcial";

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

        remainingPayment =
          money(
            remainingPayment -
              paymentForInstallment
          );
      }

      await client.query(
        `
        INSERT INTO purchase_payments (
          purchase_id,
          amount,
          payment,
          note
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          purchaseId,
          amount,
          payment ||
            "Pagamento",
          note || null,
        ]
      );

      const newPaidAmount =
        money(
          Number(
            purchase.paid_amount
          ) + amount
        );

      const newBalance =
        money(
          Math.max(
            0,
            Number(
              purchase.total
            ) -
              newPaidAmount
          )
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
   RELATÓRIOS
========================================================= */

app.get(
  "/api/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const salesResult = await pool.query(`
      SELECT
        COALESCE(SUM(total),0) AS total_sales,
        COALESCE(SUM(balance),0) AS receivable
      FROM sales
    `);

    const purchasesResult =
      await pool.query(`
        SELECT
          COALESCE(SUM(total),0) AS total_purchases,
          COALESCE(SUM(balance),0) AS payable
        FROM purchases
      `);

    const salesByMonth =
      await pool.query(`
        SELECT
          EXTRACT(YEAR FROM date)::INTEGER AS year,
          EXTRACT(MONTH FROM date)::INTEGER AS month,
          TO_CHAR(
            date,
            'TMMonth/YYYY'
          ) AS label,
          COALESCE(SUM(total),0) AS total,
          COUNT(*)::INTEGER AS quantity
        FROM sales
        GROUP BY
          EXTRACT(YEAR FROM date),
          EXTRACT(MONTH FROM date),
          TO_CHAR(date,'TMMonth/YYYY')
        ORDER BY
          year,
          month
      `);

    const purchasesByMonth =
      await pool.query(`
        SELECT
          EXTRACT(YEAR FROM date)::INTEGER AS year,
          EXTRACT(MONTH FROM date)::INTEGER AS month,
          TO_CHAR(
            date,
            'TMMonth/YYYY'
          ) AS label,
          COALESCE(SUM(total),0) AS total,
          COUNT(*)::INTEGER AS quantity
        FROM purchases
        GROUP BY
          EXTRACT(YEAR FROM date),
          EXTRACT(MONTH FROM date),
          TO_CHAR(date,'TMMonth/YYYY')
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
              amount - paid_amount
            ),
            0
          ) AS total,
          COUNT(*)::INTEGER AS quantity
        FROM sale_installments
        WHERE amount > paid_amount
        GROUP BY
          EXTRACT(YEAR FROM due_date),
          EXTRACT(MONTH FROM due_date),
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
              amount - paid_amount
            ),
            0
          ) AS total,
          COUNT(*)::INTEGER AS quantity
        FROM purchase_installments
        WHERE amount > paid_amount
        GROUP BY
          EXTRACT(YEAR FROM due_date),
          EXTRACT(MONTH FROM due_date),
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
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "Rota não encontrada.",
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

app.use((error, req, res, next) => {
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
});

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function start() {
  try {
    await initDb();

    app.listen(PORT, () => {
      console.log(
        `Servidor iniciado na porta ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Não foi possível iniciar o servidor:",
      error
    );

    process.exit(1);
  }
}

start();
