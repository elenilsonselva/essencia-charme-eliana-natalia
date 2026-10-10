const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;

/* =========================================================
   CONFIGURAÇÃO
   ========================================================= */

const ADMIN_USER = String(
  process.env.ADMIN_USER || "admin"
).trim();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD !== undefined
    ? String(process.env.ADMIN_PASSWORD)
    : "123456";

const PIX_KEY = "97984031709";
const PIX_RECEIVER = "Eliana Natália Dias Lima";
const PIX_CITY = "SANTO ANTONIO";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024
  }
});

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

app.use(cookieParser());

app.use(
  express.static(
    path.join(__dirname, "public"),
    {
      maxAge:
        process.env.NODE_ENV === "production"
          ? "1h"
          : 0
    }
  )
);

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/* =========================================================
   SESSÕES
   ========================================================= */

const sessions = new Map();

function createSession(username) {
  const token = crypto
    .randomBytes(32)
    .toString("hex");

  sessions.set(token, {
    username,
    expiresAt:
      Date.now() +
      SESSION_DAYS *
        24 *
        60 *
        60 *
        1000
  });

  return token;
}

function getSession(req) {
  const token = req.cookies?.ec_session;

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res
      .status(401)
      .json({
        error: "Não autenticado."
      });
  }

  req.user = session.username;

  next();
}

/* =========================================================
   HELPERS
   ========================================================= */

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function money(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function integer(value, fallback = 0) {
  const n = Number.parseInt(value, 10);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function positiveInteger(value, fallback = 0) {
  const n = integer(value, fallback);

  return n > 0
    ? n
    : fallback;
}

function errorMessage(error) {
  console.error(error);

  if (
    error &&
    error.code === "23505"
  ) {
    return "Registro já cadastrado.";
  }

  if (
    error &&
    error.message
  ) {
    return error.message;
  }

  return "Ocorreu um erro inesperado.";
}

function formatDateBR(value) {
  if (!value) {
    return "";
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleDateString("pt-BR");
}

function formatDateTimeBR(value) {
  if (!value) {
    return "";
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleString("pt-BR");
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const s = String(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [
      year,
      month,
      day
    ] = s.split("-").map(Number);

    return new Date(
      year,
      month - 1,
      day,
      12,
      0,
      0
    );
  }

  const d = new Date(value);

  return Number.isNaN(d.getTime())
    ? null
    : d;
}

function dateToISO(date) {
  if (!date) {
    return null;
  }

  const y = date.getFullYear();

  const m = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const d = String(
    date.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function addMonthsSafe(date, months) {
  const d = new Date(date);

  const originalDay = d.getDate();

  d.setDate(1);

  d.setMonth(
    d.getMonth() + months
  );

  const lastDay =
    new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      0
    ).getDate();

  d.setDate(
    Math.min(
      originalDay,
      lastDay
    )
  );

  return d;
}

function calculateInstallments(
  total,
  quantity,
  firstDueDate
) {
  const cents =
    Math.round(
      Number(total) * 100
    );

  const q =
    Math.max(
      1,
      integer(quantity, 1)
    );

  const base =
    Math.floor(cents / q);

  const remainder =
    cents - base * q;

  return Array.from(
    { length: q },
    (_, index) => {
      const amountCents =
        index === q - 1
          ? base + remainder
          : base;

      const due =
        addMonthsSafe(
          firstDueDate,
          index
        );

      return {
        installment_number:
          index + 1,

        total_installments:
          q,

        amount:
          amountCents / 100,

        due_date:
          dateToISO(due)
      };
    }
  );
}

function imageToData(file) {
  if (!file) {
    return null;
  }

  return {
    data:
      file.buffer.toString("base64"),

    mime:
      file.mimetype
  };
}

/* =========================================================
   PIX
   ========================================================= */

function pixCrc16(payload) {
  let crc = 0xffff;

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
      if (crc & 0x8000) {
        crc =
          ((crc << 1) ^
            0x1021) &
          0xffff;
      } else {
        crc =
          (crc << 1) &
          0xffff;
      }
    }
  }

  return crc
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
}

function pixField(id, value) {
  const content = String(value);

  return (
    id +
    String(
      content.length
    ).padStart(2, "0") +
    content
  );
}

function normalizePixText(
  value,
  maxLength
) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^A-Za-z0-9 .\-\/]/g,
      ""
    )
    .trim()
    .toUpperCase()
    .slice(
      0,
      maxLength
    );
}

function gerarPixPayload(valor) {
  const nome =
    normalizePixText(
      PIX_RECEIVER,
      25
    );

  const cidade =
    normalizePixText(
      PIX_CITY,
      15
    );

  const valorPix =
    Number(valor).toFixed(2);

  const merchant =
    pixField(
      "00",
      "BR.GOV.BCB.PIX"
    ) +
    pixField(
      "01",
      PIX_KEY
    );

  const payload =
    pixField(
      "00",
      "01"
    ) +
    pixField(
      "26",
      merchant
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
      "54",
      valorPix
    ) +
    pixField(
      "58",
      "BR"
    ) +
    pixField(
      "59",
      nome
    ) +
    pixField(
      "60",
      cidade
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
    payload +
    pixCrc16(payload)
  );
}

/* =========================================================
   BANCO DE DADOS
   ========================================================= */

async function initDatabase() {
  /*
   * =======================================================
   * PRODUTOS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_products (
      id SERIAL PRIMARY KEY,
      code TEXT DEFAULT '',
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      size TEXT DEFAULT '',
      cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 1,
      photo TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * IMPORTANTE:
   * A tabela ec_products pode ter sido criada anteriormente
   * sem algumas dessas colunas.
   *
   * CREATE TABLE IF NOT EXISTS não altera tabela existente.
   * Por isso fazemos a migração automaticamente.
   */

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS code TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS size TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS cost
    NUMERIC(12,2) NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS price
    NUMERIC(12,2) NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS stock
    INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS min_stock
    INTEGER NOT NULL DEFAULT 1
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS photo TEXT
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS active
    BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS created_at
    TIMESTAMP NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE ec_products
    ADD COLUMN IF NOT EXISTS updated_at
    TIMESTAMP NOT NULL DEFAULT NOW()
  `);

  /*
   * Corrige valores nulos eventualmente existentes
   * nas colunas adicionadas em tabelas antigas.
   */

  await pool.query(`
    UPDATE ec_products
    SET code = ''
    WHERE code IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET brand = ''
    WHERE brand IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET size = ''
    WHERE size IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET cost = 0
    WHERE cost IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET price = 0
    WHERE price IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET stock = 0
    WHERE stock IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET min_stock = 1
    WHERE min_stock IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET active = TRUE
    WHERE active IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET created_at = NOW()
    WHERE created_at IS NULL
  `);

  await pool.query(`
    UPDATE ec_products
    SET updated_at = NOW()
    WHERE updated_at IS NULL
  `);

  /*
   * =======================================================
   * CLIENTES
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * =======================================================
   * VENDAS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_sales (
      id SERIAL PRIMARY KEY,
      client_id INTEGER
        REFERENCES ec_clients(id)
        ON DELETE SET NULL,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Dinheiro',
      installments INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Pago',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * =======================================================
   * ITENS DAS VENDAS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL
        REFERENCES ec_sales(id)
        ON DELETE CASCADE,
      product_id INTEGER
        REFERENCES ec_products(id)
        ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0
    )
  `);

  /*
   * =======================================================
   * PAGAMENTOS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_sale_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL
        REFERENCES ec_sales(id)
        ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Dinheiro',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * =======================================================
   * MOVIMENTAÇÕES DE ESTOQUE
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_stock_moves (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL
        REFERENCES ec_products(id)
        ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      type TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * =======================================================
   * PARCELAS
   * =======================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ec_installments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL
        REFERENCES ec_sales(id)
        ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      total_installments INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      due_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente',
      paid_at TIMESTAMP NULL,
      payment_method TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (
        sale_id,
        installment_number
      )
    )
  `);

  /*
   * =======================================================
   * ÍNDICES
   * =======================================================
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    ec_installments_sale_idx
    ON ec_installments(sale_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    ec_installments_status_idx
    ON ec_installments(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    ec_installments_due_idx
    ON ec_installments(due_date)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    ec_sales_created_idx
    ON ec_sales(created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    ec_stock_product_idx
    ON ec_stock_moves(product_id)
  `);

  console.log(
    "Banco de dados inicializado e estrutura verificada."
  );
}

/* =========================================================
   LOGIN
   ========================================================= */

app.post(
  "/api/login",
  (req, res) => {
    try {
      const username =
        String(
          req.body?.username ?? ""
        ).trim();

      /*
       * Não usamos trim na senha.
       */
      const password =
        String(
          req.body?.password ?? ""
        );

      if (
        username !== ADMIN_USER ||
        password !== ADMIN_PASSWORD
      ) {
        console.log(
          "Login recusado:",
          JSON.stringify(username)
        );

        return res
          .status(401)
          .json({
            error:
              "Usuário ou senha inválidos."
          });
      }

      const token =
        createSession(username);

      res.cookie(
        "ec_session",
        token,
        {
          httpOnly: true,
          sameSite: "lax",
          secure:
            process.env.NODE_ENV ===
            "production",
          maxAge:
            SESSION_DAYS *
            24 *
            60 *
            60 *
            1000,
          path: "/"
        }
      );

      console.log(
        "Login realizado:",
        username
      );

      return res.json({
        ok: true,
        authenticated: true,
        username
      });
    } catch (error) {
      console.error(
        "Erro no login:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Erro interno no login."
        });
    }
  }
);

app.post(
  "/api/logout",
  (req, res) => {
    const token =
      req.cookies?.ec_session;

    if (token) {
      sessions.delete(token);
    }

    res.clearCookie(
      "ec_session",
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV ===
          "production",
        path: "/"
      }
    );

    res.json({
      ok: true
    });
  }
);

app.get(
  "/api/me",
  (req, res) => {
    const session =
      getSession(req);

    if (!session) {
      return res
        .status(401)
        .json({
          authenticated: false
        });
    }

    res.json({
      authenticated: true,
      username:
        session.username
    });
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
      const today =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(total),
              0
            ) AS total
          FROM ec_sales
          WHERE created_at::date =
                CURRENT_DATE
        `);

      const month =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(total),
              0
            ) AS total
          FROM ec_sales
          WHERE DATE_TRUNC(
                  'month',
                  created_at
                ) =
                DATE_TRUNC(
                  'month',
                  CURRENT_DATE
                )
        `);

      const low =
        await pool.query(`
          SELECT
            COUNT(*)::int AS total
          FROM ec_products
          WHERE active = TRUE
            AND stock <= min_stock
        `);

      const debt =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN i.status = 'Pendente'
                  THEN i.amount
                  ELSE 0
                END
              ),
              0
            ) AS total
          FROM ec_installments i
        `);

      res.json({
        today: {
          total:
            Number(
              today.rows[0].total
            )
        },

        month: {
          total:
            Number(
              month.rows[0].total
            )
        },

        low:
          Number(
            low.rows[0].total
          ),

        debt: {
          v:
            Number(
              debt.rows[0].total
            )
        }
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   PRODUTOS
   ========================================================= */

app.get(
  "/api/products",
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            code,
            name,
            brand,
            size,
            cost,
            price,
            stock,
            min_stock,
            photo,
            active,
            created_at
          FROM ec_products
          WHERE active = TRUE
          ORDER BY name ASC
        `);

      res.json(result.rows);
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.post(
  "/api/products",
  requireAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      const name =
        text(req.body.name);

      if (!name) {
        return res
          .status(400)
          .json({
            error:
              "Informe o nome do produto."
          });
      }

      const code =
        text(req.body.code);

      const brand =
        text(req.body.brand);

      const size =
        text(req.body.size);

      const cost =
        money(req.body.cost);

      const price =
        money(req.body.price);

      const stock =
        integer(req.body.stock);

      const minStock =
        integer(
          req.body.min_stock,
          1
        );

      let photo = null;

      if (req.file) {
        const image =
          imageToData(
            req.file
          );

        photo =
          `data:${image.mime};base64,${image.data}`;
      }

      const result =
        await pool.query(
          `
          INSERT INTO ec_products (
            code,
            name,
            brand,
            size,
            cost,
            price,
            stock,
            min_stock,
            photo
          )
          VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9
          )
          RETURNING *
          `,
          [
            code,
            name,
            brand,
            size,
            cost,
            price,
            stock,
            minStock,
            photo
          ]
        );

      if (stock !== 0) {
        await pool.query(
          `
          INSERT INTO ec_stock_moves (
            product_id,
            quantity,
            type,
            reason
          )
          VALUES (
            $1,$2,$3,$4
          )
          `,
          [
            result.rows[0].id,
            stock,
            stock > 0
              ? "ENTRADA"
              : "SAIDA",
            "Estoque inicial"
          ]
        );
      }

      res
        .status(201)
        .json(
          result.rows[0]
        );
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.put(
  "/api/products/:id",
  requireAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const oldResult =
        await pool.query(
          `
          SELECT *
          FROM ec_products
          WHERE id = $1
          `,
          [id]
        );

      if (!oldResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Produto não encontrado."
          });
      }

      const old =
        oldResult.rows[0];

      const name =
        text(req.body.name) ||
        old.name;

      const code =
        req.body.code !== undefined
          ? text(req.body.code)
          : old.code;

      const brand =
        req.body.brand !== undefined
          ? text(req.body.brand)
          : old.brand;

      const size =
        req.body.size !== undefined
          ? text(req.body.size)
          : old.size;

      const cost =
        req.body.cost !== undefined
          ? money(req.body.cost)
          : Number(old.cost);

      const price =
        req.body.price !== undefined
          ? money(req.body.price)
          : Number(old.price);

      const stock =
        req.body.stock !== undefined
          ? integer(req.body.stock)
          : Number(old.stock);

      const minStock =
        req.body.min_stock !== undefined
          ? integer(
              req.body.min_stock,
              1
            )
          : Number(
              old.min_stock
            );

      let photo =
        old.photo;

      if (req.file) {
        const image =
          imageToData(
            req.file
          );

        photo =
          `data:${image.mime};base64,${image.data}`;
      }

      const result =
        await pool.query(
          `
          UPDATE ec_products
          SET
            code = $1,
            name = $2,
            brand = $3,
            size = $4,
            cost = $5,
            price = $6,
            stock = $7,
            min_stock = $8,
            photo = $9,
            updated_at = NOW()
          WHERE id = $10
          RETURNING *
          `,
          [
            code,
            name,
            brand,
            size,
            cost,
            price,
            stock,
            minStock,
            photo,
            id
          ]
        );

      const difference =
        stock -
        Number(old.stock);

      if (difference !== 0) {
        await pool.query(
          `
          INSERT INTO ec_stock_moves (
            product_id,
            quantity,
            type,
            reason
          )
          VALUES (
            $1,$2,$3,$4
          )
          `,
          [
            id,
            difference,
            difference > 0
              ? "ENTRADA"
              : "SAIDA",
            "Ajuste de estoque"
          ]
        );
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.delete(
  "/api/products/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const result =
        await pool.query(
          `
          UPDATE ec_products
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id
          `,
          [id]
        );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Produto não encontrado."
          });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   CLIENTES
   ========================================================= */

app.get(
  "/api/clients",
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT *
          FROM ec_clients
          ORDER BY name ASC
        `);

      res.json(
        result.rows
      );
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.post(
  "/api/clients",
  requireAuth,
  async (req, res) => {
    try {
      const name =
        text(req.body.name);

      if (!name) {
        return res
          .status(400)
          .json({
            error:
              "Informe o nome do cliente."
          });
      }

      const result =
        await pool.query(
          `
          INSERT INTO ec_clients (
            name,
            phone,
            address,
            notes
          )
          VALUES (
            $1,$2,$3,$4
          )
          RETURNING *
          `,
          [
            name,
            text(req.body.phone),
            text(req.body.address),
            text(req.body.notes)
          ]
        );

      res
        .status(201)
        .json(
          result.rows[0]
        );
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.put(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const result =
        await pool.query(
          `
          UPDATE ec_clients
          SET
            name = $1,
            phone = $2,
            address = $3,
            notes = $4,
            updated_at = NOW()
          WHERE id = $5
          RETURNING *
          `,
          [
            text(req.body.name),
            text(req.body.phone),
            text(req.body.address),
            text(req.body.notes),
            id
          ]
        );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Cliente não encontrado."
          });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.delete(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const result =
        await pool.query(
          `
          DELETE FROM ec_clients
          WHERE id = $1
          RETURNING *
          `,
          [id]
        );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Cliente não encontrado."
          });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   VENDAS
   ========================================================= */

app.get(
  "/api/sales",
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            s.id,
            s.created_at,
            s.subtotal,
            s.discount,
            s.total,
            s.payment_method,
            s.installments,
            s.status,
            c.name AS client
          FROM ec_sales s
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          ORDER BY
            s.created_at DESC
        `);

      res.json(
        result.rows
      );
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

app.get(
  "/api/sales/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const saleResult =
        await pool.query(
          `
          SELECT
            s.*,
            c.name AS client,
            c.phone AS client_phone,
            c.address AS client_address
          FROM ec_sales s
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          WHERE s.id = $1
          `,
          [id]
        );

      if (!saleResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Venda não encontrada."
          });
      }

      const items =
        await pool.query(
          `
          SELECT *
          FROM ec_sale_items
          WHERE sale_id = $1
          ORDER BY id
          `,
          [id]
        );

      const payments =
        await pool.query(
          `
          SELECT *
          FROM ec_sale_payments
          WHERE sale_id = $1
          ORDER BY created_at
          `,
          [id]
        );

      const installments =
        await pool.query(
          `
          SELECT *
          FROM ec_installments
          WHERE sale_id = $1
          ORDER BY installment_number
          `,
          [id]
        );

      res.json({
        sale:
          saleResult.rows[0],

        items:
          items.rows,

        payments:
          payments.rows,

        installments:
          installments.rows
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   CRIAR VENDA
   ========================================================= */

app.post(
  "/api/sales",
  requireAuth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const items =
        Array.isArray(
          req.body.items
        )
          ? req.body.items
          : [];

      if (!items.length) {
        return res
          .status(400)
          .json({
            error:
              "Adicione produtos à venda."
          });
      }

      const clientId =
        req.body.client_id
          ? positiveInteger(
              req.body.client_id
            )
          : null;

      const discount =
        Math.max(
          0,
          money(
            req.body.discount
          )
        );

      const paymentMethod =
        text(
          req.body.payment ??
          req.body.payment_method
        ) || "Dinheiro";

      let status =
        text(
          req.body.status ??
          req.body.payment_status
        ) || "Pago";

      if (
        status !== "Parcelado" &&
        status !== "Pago"
      ) {
        status = "Pago";
      }

      const installments =
        Math.max(
          1,
          positiveInteger(
            req.body.installments,
            1
          )
        );

      const firstDueDate =
        parseDateInput(
          req.body.first_due_date ??
          req.body.firstDueDate
        );

      if (
        status === "Parcelado" &&
        !firstDueDate
      ) {
        return res
          .status(400)
          .json({
            error:
              "Informe o primeiro vencimento."
          });
      }

      if (
        status === "Parcelado" &&
        installments < 2
      ) {
        return res
          .status(400)
          .json({
            error:
              "Uma venda parcelada precisa ter pelo menos 2 parcelas."
          });
      }

      if (
        paymentMethod.toLowerCase() ===
          "fiado" &&
        !clientId
      ) {
        return res
          .status(400)
          .json({
            error:
              "Venda fiada precisa ter cliente."
          });
      }

      await client.query("BEGIN");

      let subtotal = 0;

      const prepared = [];

      for (const item of items) {
        const productId =
          positiveInteger(
            item.product_id
          );

        const quantity =
          positiveInteger(
            item.qty ??
            item.quantity,
            1
          );

        if (!productId) {
          throw new Error(
            "Produto inválido."
          );
        }

        const productResult =
          await client.query(
            `
            SELECT *
            FROM ec_products
            WHERE id = $1
              AND active = TRUE
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
          Number(product.stock) <
          quantity
        ) {
          throw new Error(
            `Estoque insuficiente para "${product.name}".`
          );
        }

        const unitPrice =
          item.price !== undefined
            ? money(item.price)
            : item.unit_price !== undefined
              ? money(
                  item.unit_price
                )
              : Number(
                  product.price
                );

        const itemTotal =
          unitPrice *
          quantity;

        subtotal += itemTotal;

        prepared.push({
          productId,
          product,
          quantity,
          unitPrice,
          itemTotal
        });
      }

      const total =
        Math.max(
          0,
          subtotal -
            discount
        );

      const saleResult =
        await client.query(
          `
          INSERT INTO ec_sales (
            client_id,
            subtotal,
            discount,
            total,
            payment_method,
            installments,
            status
          )
          VALUES (
            $1,$2,$3,$4,
            $5,$6,$7
          )
          RETURNING *
          `,
          [
            clientId,
            subtotal,
            discount,
            total,
            paymentMethod,
            status === "Parcelado"
              ? installments
              : 1,
            status
          ]
        );

      const sale =
        saleResult.rows[0];

      for (const item of prepared) {
        await client.query(
          `
          INSERT INTO ec_sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            total
          )
          VALUES (
            $1,$2,$3,$4,$5,$6
          )
          `,
          [
            sale.id,
            item.productId,
            item.product.name,
            item.quantity,
            item.unitPrice,
            item.itemTotal
          ]
        );

        await client.query(
          `
          UPDATE ec_products
          SET
            stock = stock - $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            item.quantity,
            item.productId
          ]
        );

        await client.query(
          `
          INSERT INTO ec_stock_moves (
            product_id,
            quantity,
            type,
            reason
          )
          VALUES (
            $1,$2,$3,$4
          )
          `,
          [
            item.productId,
            -item.quantity,
            "SAIDA",
            `Venda #${sale.id}`
          ]
        );
      }

      if (status === "Pago") {
        await client.query(
          `
          INSERT INTO ec_sale_payments (
            sale_id,
            amount,
            payment_method,
            notes
          )
          VALUES (
            $1,$2,$3,$4
          )
          `,
          [
            sale.id,
            total,
            paymentMethod,
            "Pagamento integral"
          ]
        );
      } else {
        const schedule =
          calculateInstallments(
            total,
            installments,
            firstDueDate
          );

        for (
          const parcel of schedule
        ) {
          await client.query(
            `
            INSERT INTO ec_installments (
              sale_id,
              installment_number,
              total_installments,
              amount,
              due_date,
              status
            )
            VALUES (
              $1,$2,$3,$4,$5,'Pendente'
            )
            `,
            [
              sale.id,
              parcel.installment_number,
              parcel.total_installments,
              parcel.amount,
              parcel.due_date
            ]
          );
        }
      }

      await client.query("COMMIT");

      res
        .status(201)
        .json({
          ...sale,
          status,
          id: sale.id
        });
    } catch (error) {
      await client.query("ROLLBACK");

      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   PARCELAS
   ========================================================= */

app.get(
  "/api/sales/:id/installments",
  requireAuth,
  async (req, res) => {
    try {
      const saleId =
        positiveInteger(
          req.params.id
        );

      const saleResult =
        await pool.query(
          `
          SELECT
            s.*,
            c.name AS client
          FROM ec_sales s
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          WHERE s.id = $1
          `,
          [saleId]
        );

      if (!saleResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Venda não encontrada."
          });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM ec_installments
          WHERE sale_id = $1
          ORDER BY installment_number
          `,
          [saleId]
        );

      res.json({
        sale:
          saleResult.rows[0],

        installments:
          result.rows
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   PAGAR PARCELA
   ========================================================= */

async function payInstallmentHandler(
  req,
  res
) {
  const installmentId =
    positiveInteger(
      req.params.installmentId ??
      req.params.id
    );

  const client =
    await pool.connect();

  try {
    const paymentMethod =
      text(
        req.body.payment ??
        req.body.payment_method
      ) || "Dinheiro";

    const notes =
      text(req.body.notes);

    await client.query("BEGIN");

    const installmentResult =
      await client.query(
        `
        SELECT
          i.*,
          s.total AS sale_total,
          s.status AS sale_status
        FROM ec_installments i
        JOIN ec_sales s
          ON s.id = i.sale_id
        WHERE i.id = $1
        FOR UPDATE
        `,
        [installmentId]
      );

    if (!installmentResult.rows.length) {
      throw new Error(
        "Parcela não encontrada."
      );
    }

    const installment =
      installmentResult.rows[0];

    if (
      installment.status ===
      "Pago"
    ) {
      throw new Error(
        "Esta parcela já foi paga."
      );
    }

    await client.query(
      `
      UPDATE ec_installments
      SET
        status = 'Pago',
        paid_at = NOW(),
        payment_method = $1,
        notes = $2
      WHERE id = $3
      `,
      [
        paymentMethod,
        notes,
        installmentId
      ]
    );

    await client.query(
      `
      INSERT INTO ec_sale_payments (
        sale_id,
        amount,
        payment_method,
        notes
      )
      VALUES (
        $1,$2,$3,$4
      )
      `,
      [
        installment.sale_id,
        Number(
          installment.amount
        ),
        paymentMethod,
        `Parcela ${installment.installment_number}/${installment.total_installments}`
      ]
    );

    const pending =
      await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM ec_installments
        WHERE sale_id = $1
          AND status = 'Pendente'
        `,
        [installment.sale_id]
      );

    const isQuitado =
      Number(
        pending.rows[0].total
      ) === 0;

    await client.query(
      `
      UPDATE ec_sales
      SET status = $1
      WHERE id = $2
      `,
      [
        isQuitado
          ? "Quitado"
          : "Parcelado",
        installment.sale_id
      ]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      message:
        "Parcela recebida com sucesso.",
      quitado:
        isQuitado,
      sale: {
        id:
          installment.sale_id,
        status:
          isQuitado
            ? "Quitado"
            : "Parcelado"
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");

    res
      .status(400)
      .json({
        error:
          errorMessage(error)
      });
  } finally {
    client.release();
  }
}

app.post(
  "/api/installments/:id/pay",
  requireAuth,
  payInstallmentHandler
);

app.post(
  "/api/sales/:saleId/installments/:installmentId/pay",
  requireAuth,
  payInstallmentHandler
);

/* =========================================================
   RECEBER VENDA
   ========================================================= */

async function paySaleHandler(
  req,
  res
) {
  const saleId =
    positiveInteger(
      req.params.id
    );

  const client =
    await pool.connect();

  try {
    const paymentMethod =
      text(
        req.body.payment ??
        req.body.payment_method
      ) || "Dinheiro";

    await client.query("BEGIN");

    const saleResult =
      await client.query(
        `
        SELECT *
        FROM ec_sales
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

    const pending =
      await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM ec_installments
        WHERE sale_id = $1
          AND status = 'Pendente'
        `,
        [saleId]
      );

    if (
      Number(
        pending.rows[0].total
      ) > 0
    ) {
      throw new Error(
        "Esta venda possui parcelas pendentes. Receba as parcelas individualmente."
      );
    }

    const payments =
      await client.query(
        `
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS paid
        FROM ec_sale_payments
        WHERE sale_id = $1
        `,
        [saleId]
      );

    const paid =
      Number(
        payments.rows[0].paid
      );

    const remaining =
      Math.max(
        0,
        Number(sale.total) -
          paid
      );

    if (remaining <= 0) {
      throw new Error(
        "Esta venda já está totalmente paga."
      );
    }

    await client.query(
      `
      INSERT INTO ec_sale_payments (
        sale_id,
        amount,
        payment_method,
        notes
      )
      VALUES (
        $1,$2,$3,$4
      )
      `,
      [
        saleId,
        remaining,
        paymentMethod,
        "Recebimento"
      ]
    );

    await client.query(
      `
      UPDATE ec_sales
      SET status = 'Pago'
      WHERE id = $1
      `,
      [saleId]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      quitado: true,
      message:
        "Recebimento registrado com sucesso.",
      sale: {
        id: saleId,
        status: "Pago"
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");

    res
      .status(400)
      .json({
        error:
          errorMessage(error)
      });
  } finally {
    client.release();
  }
}

app.post(
  "/api/sales/:id/pay",
  requireAuth,
  paySaleHandler
);

app.post(
  "/api/sales/:id/payment",
  requireAuth,
  paySaleHandler
);

/* =========================================================
   APAGAR TODAS AS VENDAS
   ========================================================= */

app.delete(
  "/api/sales/all",
  requireAuth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const items =
        await client.query(`
          SELECT
            product_id,
            SUM(quantity)::int AS qty
          FROM ec_sale_items
          WHERE product_id IS NOT NULL
          GROUP BY product_id
        `);

      for (
        const item of items.rows
      ) {
        await client.query(
          `
          UPDATE ec_products
          SET
            stock = stock + $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            item.qty,
            item.product_id
          ]
        );
      }

      await client.query(
        "DELETE FROM ec_sales"
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        message:
          "Histórico de vendas apagado com sucesso."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   ESTOQUE
   ========================================================= */

app.post(
  "/api/stock",
  requireAuth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const productId =
        positiveInteger(
          req.body.product_id
        );

      const type =
        text(
          req.body.type
        ).toUpperCase();

      const qty =
        positiveInteger(
          req.body.qty ??
          req.body.quantity
        );

      const note =
        text(
          req.body.note ??
          req.body.reason
        );

      if (!productId) {
        throw new Error(
          "Selecione o produto."
        );
      }

      if (!qty) {
        throw new Error(
          "Informe a quantidade."
        );
      }

      if (
        type !== "ENTRADA" &&
        type !== "SAIDA"
      ) {
        throw new Error(
          "Tipo de movimentação inválido."
        );
      }

      await client.query("BEGIN");

      const productResult =
        await client.query(
          `
          SELECT *
          FROM ec_products
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
        type === "SAIDA" &&
        Number(product.stock) <
          qty
      ) {
        throw new Error(
          "Estoque insuficiente."
        );
      }

      const change =
        type === "ENTRADA"
          ? qty
          : -qty;

      await client.query(
        `
        UPDATE ec_products
        SET
          stock = stock + $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          change,
          productId
        ]
      );

      await client.query(
        `
        INSERT INTO ec_stock_moves (
          product_id,
          quantity,
          type,
          reason
        )
        VALUES (
          $1,$2,$3,$4
        )
        `,
        [
          productId,
          change,
          type,
          note
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res
        .status(400)
        .json({
          error:
            errorMessage(error)
        });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   RELATÓRIOS
   ========================================================= */

async function reportsHandler(
  req,
  res
) {
  try {
    const from =
      parseDateInput(
        req.query.from
      ) ||
      new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
        0,
        0,
        0
      );

    const to =
      parseDateInput(
        req.query.to
      ) ||
      new Date();

    const end =
      new Date(to);

    end.setHours(
      23,
      59,
      59,
      999
    );

    const salesResult =
      await pool.query(
        `
        SELECT
          s.id,
          s.created_at,
          s.total,
          s.payment_method,
          s.status,
          c.name AS client
        FROM ec_sales s
        LEFT JOIN ec_clients c
          ON c.id = s.client_id
        WHERE s.created_at >= $1
          AND s.created_at <= $2
        ORDER BY
          s.created_at DESC
        `,
        [
          from,
          end
        ]
      );

    const totalsResult =
      await pool.query(
        `
        SELECT
          COALESCE(
            SUM(s.total),
            0
          ) AS revenue,

          COALESCE(
            SUM(
              s.total -
              COALESCE(
                (
                  SELECT
                    SUM(
                      si.quantity *
                      p.cost
                    )
                  FROM ec_sale_items si
                  LEFT JOIN ec_products p
                    ON p.id =
                       si.product_id
                  WHERE si.sale_id =
                        s.id
                ),
                0
              )
            ),
            0
          ) AS profit

        FROM ec_sales s

        WHERE s.created_at >= $1
          AND s.created_at <= $2
        `,
        [
          from,
          end
        ]
      );

    const topResult =
      await pool.query(
        `
        SELECT
          si.product_name AS name,
          SUM(
            si.quantity
          )::int AS qty

        FROM ec_sale_items si

        JOIN ec_sales s
          ON s.id = si.sale_id

        WHERE s.created_at >= $1
          AND s.created_at <= $2

        GROUP BY
          si.product_name

        ORDER BY
          qty DESC

        LIMIT 10
        `,
        [
          from,
          end
        ]
      );

    const debtResult =
      await pool.query(
        `
        SELECT
          s.id,
          c.name,
          s.total,
          s.status,

          COALESCE(
            SUM(
              CASE
                WHEN i.status =
                     'Pendente'
                THEN i.amount
                ELSE 0
              END
            ),
            0
          ) AS remaining

        FROM ec_sales s

        LEFT JOIN ec_clients c
          ON c.id = s.client_id

        LEFT JOIN ec_installments i
          ON i.sale_id = s.id

        WHERE
          s.status IN (
            'Parcelado',
            'Pendente',
            'Em aberto'
          )

        GROUP BY
          s.id,
          c.name,
          s.total,
          s.status

        HAVING
          COALESCE(
            SUM(
              CASE
                WHEN i.status =
                     'Pendente'
                THEN i.amount
                ELSE 0
              END
            ),
            0
          ) > 0

        ORDER BY
          s.created_at DESC
        `
      );

    res.json({
      totals: {
        revenue:
          Number(
            totalsResult.rows[0]
              .revenue
          ),

        profit:
          Number(
            totalsResult.rows[0]
              .profit
          )
      },

      sales:
        salesResult.rows,

      top:
        topResult.rows,

      debts:
        debtResult.rows
    });
  } catch (error) {
    res
      .status(500)
      .json({
        error:
          errorMessage(error)
      });
  }
}

app.get(
  "/api/reports",
  requireAuth,
  reportsHandler
);

app.get(
  "/api/reports/sales",
  requireAuth,
  reportsHandler
);

/* =========================================================
   PDF DA VENDA
   ========================================================= */

app.get(
  "/api/sales/:id/pdf",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const saleResult =
        await pool.query(
          `
          SELECT
            s.*,
            c.name AS client_name,
            c.phone AS client_phone
          FROM ec_sales s
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          WHERE s.id = $1
          `,
          [id]
        );

      if (!saleResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Venda não encontrada."
          });
      }

      const sale =
        saleResult.rows[0];

      const itemsResult =
        await pool.query(
          `
          SELECT *
          FROM ec_sale_items
          WHERE sale_id = $1
          ORDER BY id
          `,
          [id]
        );

      const paymentsResult =
        await pool.query(
          `
          SELECT *
          FROM ec_sale_payments
          WHERE sale_id = $1
          ORDER BY created_at
          `,
          [id]
        );

      const installmentsResult =
        await pool.query(
          `
          SELECT *
          FROM ec_installments
          WHERE sale_id = $1
          ORDER BY installment_number
          `,
          [id]
        );

      const doc =
        new PDFDocument({
          size: "A5",
          margin: 35
        });

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="venda-${id}-essencia-charme.pdf"`
      );

      doc.pipe(res);

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(
          "Essência & Charme",
          {
            align: "center"
          }
        );

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          "PERFUMES, MODA & VENDAS · Eliana Natália",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(
          `VENDA #${sale.id}`
        );

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Data: ${formatDateTimeBR(
            sale.created_at
          )}`
        );

      doc.text(
        `Cliente: ${
          sale.client_name ||
          "Consumidor"
        }`
      );

      if (sale.client_phone) {
        doc.text(
          `Telefone: ${sale.client_phone}`
        );
      }

      doc.moveDown();

      doc
        .font("Helvetica-Bold")
        .text("Produtos");

      doc.moveDown(0.3);

      for (
        const item of
        itemsResult.rows
      ) {
        doc
          .font("Helvetica")
          .fontSize(9)
          .text(
            `${item.quantity}x ${item.product_name}`
          );

        doc.text(
          `R$ ${money(
            item.unit_price
          ).toFixed(2)} cada — R$ ${money(
            item.total
          ).toFixed(2)}`,
          {
            indent: 12
          }
        );

        doc.moveDown(0.2);
      }

      doc.moveDown();

      doc.text(
        `Subtotal: R$ ${money(
          sale.subtotal
        ).toFixed(2)}`
      );

      doc.text(
        `Desconto: R$ ${money(
          sale.discount
        ).toFixed(2)}`
      );

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(
          `TOTAL: R$ ${money(
            sale.total
          ).toFixed(2)}`
        );

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Pagamento: ${sale.payment_method}`
        );

      doc.text(
        `Status: ${sale.status}`
      );

      if (
        sale.status === "Parcelado" &&
        installmentsResult.rows.length
      ) {
        doc.moveDown();

        doc
          .font("Helvetica-Bold")
          .text(
            "Cronograma de parcelas"
          );

        doc.moveDown(0.3);

        for (
          const item of
          installmentsResult.rows
        ) {
          doc
            .font("Helvetica")
            .text(
              `${item.installment_number}/${item.total_installments} — ${formatDateBR(item.due_date)} — R$ ${money(item.amount).toFixed(2)} — ${item.status}`
            );
        }
      }

      doc.moveDown();

      const totalPaid =
        paymentsResult.rows.reduce(
          (sum, item) =>
            sum +
            money(
              item.amount
            ),
          0
        );

      if (totalPaid > 0) {
        doc.text(
          `Total pago: R$ ${totalPaid.toFixed(2)}`
        );

        doc.text(
          `Saldo: R$ ${Math.max(
            0,
            Number(sale.total) -
              totalPaid
          ).toFixed(2)}`
        );
      }

      doc.moveDown();

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(
          "PAGAMENTO VIA PIX",
          {
            align: "center"
          }
        );

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          `Recebedor: ${PIX_RECEIVER}`,
          {
            align: "center"
          }
        );

      doc.text(
        `Chave PIX: ${PIX_KEY}`,
        {
          align: "center"
        }
      );

      doc.text(
        `Valor: R$ ${money(
          sale.total
        ).toFixed(2)}`,
        {
          align: "center"
        }
      );

      const payload =
        gerarPixPayload(
          sale.total
        );

      const qrDataUrl =
        await QRCode.toDataURL(
          payload,
          {
            errorCorrectionLevel:
              "M",
            margin: 1,
            width: 220
          }
        );

      const qrBuffer =
        Buffer.from(
          qrDataUrl.split(",")[1],
          "base64"
        );

      doc.moveDown(0.4);

      doc.image(
        qrBuffer,
        {
          fit: [140, 140],
          align: "center"
        }
      );

      doc.moveDown();

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          "Aponte a câmera do aplicativo do seu banco para pagar.",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc.text(
        "Obrigado pela preferência!",
        {
          align: "center"
        }
      );

      doc.end();
    } catch (error) {
      console.error(
        "Erro ao gerar PDF:",
        error
      );

      if (!res.headersSent) {
        res
          .status(500)
          .json({
            error:
              errorMessage(error)
          });
      }
    }
  }
);

/* =========================================================
   PDF DO RECIBO DA PARCELA
   ========================================================= */

app.get(
  "/api/installments/:id/pdf",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        positiveInteger(
          req.params.id
        );

      const result =
        await pool.query(
          `
          SELECT
            i.*,
            s.id AS sale_id,
            s.total AS sale_total,
            c.name AS client
          FROM ec_installments i
          JOIN ec_sales s
            ON s.id = i.sale_id
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          WHERE i.id = $1
          `,
          [id]
        );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Parcela não encontrada."
          });
      }

      const parcel =
        result.rows[0];

      if (
        parcel.status !==
        "Pago"
      ) {
        return res
          .status(400)
          .json({
            error:
              "O recibo só pode ser emitido após o pagamento."
          });
      }

      const pending =
        await pool.query(
          `
          SELECT COUNT(*)::int AS total
          FROM ec_installments
          WHERE sale_id = $1
            AND status = 'Pendente'
          `,
          [parcel.sale_id]
        );

      const doc =
        new PDFDocument({
          size: "A5",
          margin: 40
        });

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="recibo-parcela-${id}.pdf"`
      );

      doc.pipe(res);

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(
          "Essência & Charme",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(
          "RECIBO DE PAGAMENTO",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Venda: #${parcel.sale_id}`
        );

      doc.text(
        `Cliente: ${
          parcel.client ||
          "Consumidor"
        }`
      );

      doc.text(
        `Parcela: ${parcel.installment_number}/${parcel.total_installments}`
      );

      doc.text(
        `Vencimento: ${formatDateBR(
          parcel.due_date
        )}`
      );

      doc.text(
        `Pagamento: ${formatDateTimeBR(
          parcel.paid_at
        )}`
      );

      doc.text(
        `Forma de pagamento: ${
          parcel.payment_method ||
          "Dinheiro"
        }`
      );

      doc.moveDown();

      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(
          `Valor recebido: R$ ${money(
            parcel.amount
          ).toFixed(2)}`,
          {
            align: "center"
          }
        );

      doc.moveDown();

      if (
        Number(
          pending.rows[0].total
        ) === 0
      ) {
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .text(
            "VENDA TOTALMENTE QUITADA",
            {
              align: "center"
            }
          );
      }

      doc.moveDown(2);

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          "Essência & Charme · Eliana Natália",
          {
            align: "center"
          }
        );

      doc.end();
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/* =========================================================
   TERMO DE QUITAÇÃO
   ========================================================= */

app.get(
  "/api/sales/:id/quitation/pdf",
  requireAuth,
  async (req, res) => {
    try {
      const saleId =
        positiveInteger(
          req.params.id
        );

      const saleResult =
        await pool.query(
          `
          SELECT
            s.*,
            c.name AS client
          FROM ec_sales s
          LEFT JOIN ec_clients c
            ON c.id = s.client_id
          WHERE s.id = $1
          `,
          [saleId]
        );

      if (!saleResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Venda não encontrada."
          });
      }

      const sale =
        saleResult.rows[0];

      const pending =
        await pool.query(
          `
          SELECT COUNT(*)::int AS total
          FROM ec_installments
          WHERE sale_id = $1
            AND status = 'Pendente'
          `,
          [saleId]
        );

      if (
        Number(
          pending.rows[0].total
        ) > 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Ainda existem parcelas pendentes."
          });
      }

      const payments =
        await pool.query(
          `
          SELECT *
          FROM ec_sale_payments
          WHERE sale_id = $1
          ORDER BY created_at
          `,
          [saleId]
        );

      const doc =
        new PDFDocument({
          size: "A5",
          margin: 45
        });

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="quitacao-venda-${saleId}.pdf"`
      );

      doc.pipe(res);

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(
          "Essência & Charme",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .fontSize(15)
        .text(
          "TERMO DE QUITAÇÃO",
          {
            align: "center"
          }
        );

      doc.moveDown(2);

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Venda nº: ${saleId}`
        );

      doc.text(
        `Cliente: ${
          sale.client ||
          "Consumidor"
        }`
      );

      doc.text(
        `Valor total: R$ ${money(
          sale.total
        ).toFixed(2)}`
      );

      doc.moveDown();

      doc.text(
        "Declaramos que os valores referentes à venda acima foram integralmente recebidos."
      );

      doc.moveDown();

      const totalPaid =
        payments.rows.reduce(
          (sum, p) =>
            sum +
            money(p.amount),
          0
        );

      doc
        .font("Helvetica-Bold")
        .text(
          `Total recebido: R$ ${totalPaid.toFixed(2)}`
        );

      doc.moveDown(2);

      doc.text(
        `Emitido em: ${formatDateTimeBR(
          new Date()
        )}`
      );

      doc.moveDown(3);

      doc.text(
        "Essência & Charme",
        {
          align: "center"
        }
      );

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          "Eliana Natália",
          {
            align: "center"
          }
        );

      doc.end();
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            errorMessage(error)
        });
    }
  }
);

/*
 * Mantém também a grafia alternativa.
 */

app.get(
  "/api/sales/:id/quitacao/pdf",
  requireAuth,
  async (req, res) => {
    req.url =
      `/api/sales/${req.params.id}/quitation/pdf`;

    return app._router.handle(
      req,
      res,
      () => {}
    );
  }
);

/* =========================================================
   404 API
   ========================================================= */

app.use(
  "/api",
  (req, res) => {
    res
      .status(404)
      .json({
        error:
          "Endpoint não encontrado."
      });
  }
);

/* =========================================================
   FRONTEND
   ========================================================= */

app.get(
  "/{*splat}",
  (req, res) => {
    if (
      req.path.startsWith(
        "/api/"
      )
    ) {
      return res
        .status(404)
        .end();
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================================
   ERROS
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

    res
      .status(500)
      .json({
        error:
          errorMessage(error)
      });
  }
);

/* =========================================================
   START
   ========================================================= */

async function start() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Essência & Charme rodando na porta ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Erro ao iniciar aplicação:",
      error
    );

    process.exit(1);
  }
}

start();

/* =========================================================
   ENCERRAMENTO
   ========================================================= */

async function shutdown() {
  try {
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on(
  "SIGTERM",
  shutdown
);

process.on(
  "SIGINT",
  shutdown
);
