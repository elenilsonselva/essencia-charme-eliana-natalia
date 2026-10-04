const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 7;

const VALID_PAYMENTS = [
  "Dinheiro",
  "PIX",
  "Débito",
  "Crédito",
  "Fiado"
];

/* =========================
   SESSÃO / CONFIGURAÇÕES
========================= */

const sessions = new Map();

const ADMIN_USER =
  process.env.ADMIN_USER || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "troque-esta-senha";

if (!process.env.DATABASE_URL) {

  console.error(
    "ERRO: configure a variável DATABASE_URL com a URL do PostgreSQL."
  );

  process.exit(1);
}

/* =========================
   BANCO
========================= */

const pool = new Pool({

  connectionString:
    process.env.DATABASE_URL,

  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : undefined

});

/* =========================
   UPLOAD
========================= */

const upload = multer({

  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      4 * 1024 * 1024
  }

});

/* =========================
   MIDDLEWARES
========================= */

app.use(
  express.json({
    limit: "6mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(cookieParser());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   AUTENTICAÇÃO
========================= */

function requireAuth(req, res, next) {

  const token =
    req.cookies.ec_session;

  const session =
    token &&
    sessions.get(token);

  if (
    !session ||
    session.expires < Date.now()
  ) {

    if (token) {
      sessions.delete(token);
    }

    return res
      .status(401)
      .json({
        error:
          "Não autenticado"
      });

  }

  next();

}

function createSession() {

  const token =
    crypto.randomBytes(32)
      .toString("hex");

  sessions.set(
    token,
    {
      expires:
        Date.now() +
        SESSION_DAYS *
        86400000
    }
  );

  return token;

}

/* =========================
   UTILITÁRIOS
========================= */

const money =
  value =>
    Number(value || 0)
      .toFixed(2);

const now =
  () =>
    new Date().toISOString();

function num(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (
    typeof value === "number"
  ) {

    return Number.isFinite(value)
      ? value
      : 0;

  }

  let s =
    String(value)
      .trim()
      .replace(/R\$|\s/g, "");

  s =
    s
      .replace(
        /\.(?=\d{3}(?:,|$))/g,
        ""
      )
      .replace(
        ",",
        "."
      );

  s =
    s.replace(
      /[^\d.-]/g,
      ""
    );

  const n =
    Number(s);

  return Number.isFinite(n)
    ? n
    : 0;

}

const int =
  value =>
    Math.trunc(
      num(value)
    );

const round2 =
  value =>
    Math.round(
      num(value) * 100
    ) / 100;

function photoData(file) {

  if (!file) {
    return null;
  }

  return (
    `data:${file.mimetype || "image/jpeg"};base64,` +
    file.buffer.toString("base64")
  );

}

function normalizePayment(value) {

  const p =
    String(
      value || "Dinheiro"
    ).trim();

  return VALID_PAYMENTS.includes(p)
    ? p
    : "Dinheiro";

}

function toDate(value) {

  const d =
    value
      ? new Date(value)
      : new Date();

  return Number.isNaN(
    d.getTime()
  )
    ? new Date()
    : d;

}

function addMonths(date, months) {

  const d =
    new Date(date);

  const day =
    d.getDate();

  d.setDate(1);

  d.setMonth(
    d.getMonth() + months
  );

  const last =
    new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      0
    ).getDate();

  d.setDate(
    Math.min(
      day,
      last
    )
  );

  return d;

}

async function addColumn(
  table,
  definition
) {

  await pool.query(
    `ALTER TABLE ${table}
     ADD COLUMN IF NOT EXISTS ${definition}`
  );

}

/* =========================
   BANCO — INICIALIZAÇÃO
========================= */

async function initDb() {

  await pool.query(`

    CREATE TABLE IF NOT EXISTS products (

      id SERIAL PRIMARY KEY,

      code TEXT UNIQUE,

      name TEXT NOT NULL,

      brand TEXT DEFAULT '',

      size TEXT DEFAULT '',

      cost NUMERIC(12,2)
        DEFAULT 0,

      price NUMERIC(12,2)
        DEFAULT 0,

      stock INTEGER
        DEFAULT 0,

      min_stock INTEGER
        DEFAULT 1,

      photo TEXT,

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS clients (

      id SERIAL PRIMARY KEY,

      name TEXT NOT NULL,

      phone TEXT DEFAULT '',

      address TEXT DEFAULT '',

      notes TEXT DEFAULT '',

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS sales (

      id SERIAL PRIMARY KEY,

      client_id INTEGER
        REFERENCES clients(id)
        ON DELETE SET NULL,

      date TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      total NUMERIC(12,2)
        NOT NULL,

      discount NUMERIC(12,2)
        DEFAULT 0,

      payment TEXT
        NOT NULL,

      installments INTEGER
        DEFAULT 1,

      status TEXT
        DEFAULT 'paid',

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS sale_items (

      id SERIAL PRIMARY KEY,

      sale_id INTEGER
        REFERENCES sales(id)
        ON DELETE CASCADE,

      product_id INTEGER
        REFERENCES products(id)
        ON DELETE RESTRICT,

      qty INTEGER
        NOT NULL,

      price NUMERIC(12,2)
        NOT NULL,

      cost NUMERIC(12,2)
        DEFAULT 0

    );


    CREATE TABLE IF NOT EXISTS stock_moves (

      id SERIAL PRIMARY KEY,

      product_id INTEGER
        REFERENCES products(id)
        ON DELETE CASCADE,

      qty INTEGER
        NOT NULL,

      type TEXT
        NOT NULL,

      note TEXT
        DEFAULT '',

      date TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS suppliers (

      id SERIAL PRIMARY KEY,

      name TEXT NOT NULL,

      phone TEXT DEFAULT '',

      notes TEXT DEFAULT '',

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS purchases (

      id SERIAL PRIMARY KEY,

      supplier TEXT DEFAULT '',

      date TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      total NUMERIC(12,2)
        NOT NULL
        DEFAULT 0,

      entry NUMERIC(12,2)
        DEFAULT 0,

      paid_amount NUMERIC(12,2)
        DEFAULT 0,

      balance NUMERIC(12,2)
        DEFAULT 0,

      installments INTEGER
        DEFAULT 1,

      payment TEXT
        DEFAULT 'Dinheiro',

      status TEXT
        DEFAULT 'open',

      notes TEXT
        DEFAULT '',

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS purchase_payments (

      id SERIAL PRIMARY KEY,

      purchase_id INTEGER
        REFERENCES purchases(id)
        ON DELETE CASCADE,

      amount NUMERIC(12,2)
        NOT NULL,

      payment TEXT
        NOT NULL,

      paid_at TIMESTAMPTZ
        DEFAULT NOW(),

      note TEXT
        DEFAULT ''

    );


    CREATE TABLE IF NOT EXISTS sale_installments (

      id SERIAL PRIMARY KEY,

      sale_id INTEGER
        REFERENCES sales(id)
        ON DELETE CASCADE,

      installment_no INTEGER
        NOT NULL,

      due_date DATE
        NOT NULL,

      amount NUMERIC(12,2)
        NOT NULL,

      paid_amount NUMERIC(12,2)
        NOT NULL
        DEFAULT 0,

      status TEXT
        NOT NULL
        DEFAULT 'open',

      created_at
        TIMESTAMPTZ
        DEFAULT NOW()

    );


    CREATE TABLE IF NOT EXISTS sale_payments (

      id SERIAL PRIMARY KEY,

      sale_id INTEGER
        REFERENCES sales(id)
        ON DELETE CASCADE,

      installment_id INTEGER
        REFERENCES sale_installments(id)
        ON DELETE SET NULL,

      amount NUMERIC(12,2)
        NOT NULL,

      payment TEXT
        NOT NULL,

      paid_at TIMESTAMPTZ
        DEFAULT NOW(),

      note TEXT
        DEFAULT ''

    );


    CREATE INDEX IF NOT EXISTS
      idx_sales_date
      ON sales(date);


    CREATE INDEX IF NOT EXISTS
      idx_sale_items_sale
      ON sale_items(sale_id);


    CREATE INDEX IF NOT EXISTS
      idx_sale_inst_sale
      ON sale_installments(sale_id);


    CREATE INDEX IF NOT EXISTS
      idx_sale_payments_sale
      ON sale_payments(sale_id);


    CREATE INDEX IF NOT EXISTS
      idx_purchase_date
      ON purchases(date);

  `);

  /* =========================
     MIGRAÇÕES — VENDAS
  ========================= */

  await addColumn(
    "sales",
    "entry NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "sales",
    "paid_amount NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "sales",
    "balance NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "sales",
    "cancelled_at TIMESTAMPTZ"
  );

  await addColumn(
    "sales",
    "cancelled_reason TEXT DEFAULT ''"
  );


  /* =========================
     MIGRAÇÕES — COMPRAS
  ========================= */

  await addColumn(
    "purchases",
    "supplier TEXT DEFAULT ''"
  );

  await addColumn(
    "purchases",
    "entry NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "purchases",
    "paid_amount NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "purchases",
    "balance NUMERIC(12,2) DEFAULT 0"
  );

  await addColumn(
    "purchases",
    "installments INTEGER DEFAULT 1"
  );

  await addColumn(
    "purchases",
    "payment TEXT DEFAULT 'Dinheiro'"
  );

  await addColumn(
    "purchases",
    "status TEXT DEFAULT 'open'"
  );

  await addColumn(
    "purchases",
    "notes TEXT DEFAULT ''"
  );


  /* =========================
     CORREÇÃO DAS VENDAS ANTIGAS
  ========================= */

  await pool.query(`

    UPDATE sales

    SET

      discount =
        COALESCE(
          discount,
          0
        ),

      entry =
        CASE

          WHEN
            COALESCE(entry,0) = 0
            AND status = 'paid'

          THEN total

          ELSE
            COALESCE(entry,0)

        END

    WHERE total IS NOT NULL

  `);


  await pool.query(`

    UPDATE sales

    SET

      paid_amount =
        CASE

          WHEN status = 'paid'
          THEN total

          WHEN
            COALESCE(paid_amount,0) = 0
          THEN
            COALESCE(entry,0)

          ELSE
            paid_amount

        END,

      balance =
        GREATEST(

          total -

          CASE

            WHEN status = 'paid'
            THEN total

            WHEN
              COALESCE(paid_amount,0) = 0

            THEN
              COALESCE(entry,0)

            ELSE
              paid_amount

          END,

          0

        ),

      installments =
        GREATEST(
          COALESCE(
            installments,
            1
          ),
          1
        )

    WHERE total IS NOT NULL

  `);


  /* =========================
     CORREÇÃO DAS COMPRAS ANTIGAS
  ========================= */

  await pool.query(`

    UPDATE purchases

    SET

      entry =
        COALESCE(
          entry,
          0
        ),

      paid_amount =
        CASE

          WHEN
            status = 'paid'
            AND COALESCE(
              paid_amount,
              0
            ) = 0

          THEN total

          ELSE
            COALESCE(
              paid_amount,
              0
            )

        END,

      balance =
        GREATEST(

          total -

          CASE

            WHEN
              status = 'paid'
              AND COALESCE(
                paid_amount,
                0
              ) = 0

            THEN total

            ELSE
              COALESCE(
                paid_amount,
                0
              )

          END,

          0

        ),

      installments =
        GREATEST(
          COALESCE(
            installments,
            1
          ),
          1
        ),

      payment =
        COALESCE(
          NULLIF(
            payment,
            ''
          ),
          'Dinheiro'
        )

  `);


  /* =========================
     CRIA PARCELA PARA VENDAS ANTIGAS
     QUE AINDA NÃO POSSUEM PARCELAS
  ========================= */

  const missingInstallments =
    await pool.query(`

      SELECT

        s.id,
        s.date,
        s.total,
        s.entry,
        s.paid_amount,
        s.balance,
        s.status

      FROM sales s

      LEFT JOIN
        sale_installments si
        ON si.sale_id = s.id

      WHERE
        si.id IS NULL

        AND s.status <> 'cancelled'

    `);


  for (
    const s
    of missingInstallments.rows
  ) {

    const paid =
      num(
        s.paid_amount
      );

    const openBalance =
      num(
        s.balance
      );

    const amount =
      openBalance > 0
        ? openBalance
        : num(s.total);


    await pool.query(`

      INSERT INTO sale_installments(

        sale_id,
        installment_no,
        due_date,
        amount,
        paid_amount,
        status

      )

      VALUES(
        $1,
        1,
        $2,
        $3,
        $4,
        $5
      )

    `, [

      s.id,

      toDate(
        s.date
      )
        .toISOString()
        .slice(
          0,
          10
        ),

      amount,

      openBalance > 0
        ? 0
        : amount,

      openBalance > 0
        ? "open"
        : "paid"

    ]);


    if (
      openBalance <= 0 &&
      paid < num(s.total)
    ) {

      await pool.query(`

        UPDATE sales

        SET

          paid_amount = total,

          balance = 0,

          status = 'paid'

        WHERE id=$1

      `, [s.id]);

    }

  }

}

/* =========================
   LOGIN
========================= */

app.post(
  "/api/login",
  (req, res) => {

    const {
      username,
      password
    } = req.body || {};


    if (
      username === ADMIN_USER &&
      password === ADMIN_PASSWORD
    ) {

      const token =
        createSession();


      res.cookie(
        "ec_session",
        token,
        {

          httpOnly: true,

          secure:
            process.env.NODE_ENV ===
            "production",

          sameSite: "lax",

          maxAge:
            SESSION_DAYS *
            86400000

        }
      );


      return res.json({

        ok: true,

        username:
          ADMIN_USER

      });

    }


    res
      .status(401)
      .json({

        error:
          "Usuário ou senha inválidos"

      });

  }
);


/* =========================
   LOGOUT
========================= */

app.post(
  "/api/logout",
  (req, res) => {

    const token =
      req.cookies.ec_session;

    if (token) {
      sessions.delete(token);
    }

    res.clearCookie(
      "ec_session"
    );

    res.json({
      ok: true
    });

  }
);


/* =========================
   ME
========================= */

app.get(
  "/api/me",
  (req, res) => {

    const token =
      req.cookies.ec_session;

    const session =
      token &&
      sessions.get(token);

    const authenticated =
      !!(
        session &&
        session.expires >
        Date.now()
      );

    res.json({

      authenticated,

      username:
        authenticated
          ? ADMIN_USER
          : null

    });

  }
);


/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  async (req, res) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      res.json({

        ok: true,

        app:
          "Essência & Charme"

      });

    } catch (error) {

      res
        .status(500)
        .json({

          ok: false,

          error:
            error.message

        });

    }

  }
);


/* =========================
   DASHBOARD
========================= */

app.get(
  "/api/dashboard",
  requireAuth,
  async (req, res) => {

    try {

      const daily =
        await pool.query(`

          SELECT

            COALESCE(
              SUM(total),
              0
            ) total,

            COUNT(*)::int
            count

          FROM sales

          WHERE
            date::date =
            CURRENT_DATE

            AND status <>
            'cancelled'

        `);


      const monthly =
        await pool.query(`

          SELECT

            COALESCE(
              SUM(total),
              0
            ) total

          FROM sales

          WHERE

            date >=
              date_trunc(
                'month',
                CURRENT_DATE
              )

            AND status <>
              'cancelled'

        `);


      const low =
        await pool.query(`

          SELECT
            COUNT(*)::int c

          FROM products

          WHERE
            stock <= min_stock

        `);


      const receivable =
        await pool.query(`

          SELECT

            COALESCE(
              SUM(balance),
              0
            ) v,

            COUNT(*)::int c

          FROM sales

          WHERE

            status = 'open'

            AND balance > 0

        `);


      const payable =
        await pool.query(`

          SELECT

            COALESCE(
              SUM(balance),
              0
            ) v,

            COUNT(*)::int c

          FROM purchases

          WHERE

            status = 'open'

            AND balance > 0

        `);


      res.json({

        today:
          daily.rows[0],

        month:
          monthly.rows[0],

        low:
          low.rows[0].c,

        debt:
          receivable.rows[0],

        receivables:
          receivable.rows[0],

        payables:
          payable.rows[0]

      });

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            "Erro ao carregar dashboard.",

          detail:
            error.message

        });

    }

  }
);


/* =========================
   PRODUTOS
========================= */

app.get(
  "/api/products",
  requireAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT *

          FROM products

          ORDER BY name

        `);


      res.json(
        result.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


app.post(
  "/api/products",
  upload.single("photo"),
  requireAuth,
  async (req, res) => {

    try {

      const data =
        req.body;


      const result =
        await pool.query(`

          INSERT INTO products(

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

          VALUES(
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9
          )

          RETURNING id

        `, [

          data.code || null,

          data.name,

          data.brand || "",

          data.size || "",

          round2(
            data.cost
          ),

          round2(
            data.price
          ),

          int(
            data.stock
          ),

          Math.max(
            int(data.min_stock) ||
            1,
            0
          ),

          photoData(
            req.file
          )

        ]);


      res.json({

        id:
          result.rows[0].id

      });

    } catch (error) {

      res
        .status(400)
        .json({
          error:
            error.message
        });

    }

  }
);


app.put(
  "/api/products/:id",
  upload.single("photo"),
  requireAuth,
  async (req, res) => {

    try {

      const old =
        await pool.query(`

          SELECT photo

          FROM products

          WHERE id=$1

        `, [
          req.params.id
        ]);


      if (!old.rows.length) {

        return res
          .status(404)
          .json({

            error:
              "Produto não encontrado"

          });

      }


      const data =
        req.body;


      await pool.query(`

        UPDATE products

        SET

          code=$1,

          name=$2,

          brand=$3,

          size=$4,

          cost=$5,

          price=$6,

          stock=$7,

          min_stock=$8,

          photo=$9

        WHERE id=$10

      `, [

        data.code || null,

        data.name,

        data.brand || "",

        data.size || "",

        round2(
          data.cost
        ),

        round2(
          data.price
        ),

        int(
          data.stock
        ),

        Math.max(
          int(data.min_stock) ||
          1,
          0
        ),

        photoData(
          req.file
        ) ||
        old.rows[0].photo,

        req.params.id

      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


app.delete(
  "/api/products/:id",
  requireAuth,
  async (req, res) => {

    try {

      await pool.query(`

        DELETE FROM products

        WHERE id=$1

      `, [
        req.params.id
      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            "Não foi possível excluir. Verifique se o produto já foi vendido."

        });

    }

  }
);


/* =========================
   CLIENTES
========================= */

app.get(
  "/api/clients",
  requireAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT *

          FROM clients

          ORDER BY name

        `);


      res.json(
        result.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


app.post(
  "/api/clients",
  requireAuth,
  async (req, res) => {

    try {

      const d =
        req.body || {};


      if (!d.name) {

        return res
          .status(400)
          .json({

            error:
              "Informe o nome do cliente"

          });

      }


      const result =
        await pool.query(`

          INSERT INTO clients(

            name,
            phone,
            address,
            notes

          )

          VALUES(
            $1,$2,$3,$4
          )

          RETURNING id

        `, [

          d.name,

          d.phone || "",

          d.address || "",

          d.notes || ""

        ]);


      res.json({

        id:
          result.rows[0].id

      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


app.put(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {

    try {

      const d =
        req.body || {};


      await pool.query(`

        UPDATE clients

        SET

          name=$1,

          phone=$2,

          address=$3,

          notes=$4

        WHERE id=$5

      `, [

        d.name,

        d.phone || "",

        d.address || "",

        d.notes || "",

        req.params.id

      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


app.delete(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {

    try {

      await pool.query(`

        DELETE FROM clients

        WHERE id=$1

      `, [
        req.params.id
      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            "Não foi possível excluir este cliente."

        });

    }

  }
);


/* =========================
   FORNECEDORES
========================= */

app.get(
  "/api/suppliers",
  requireAuth,
  async (req, res) => {

    try {

      const r =
        await pool.query(`

          SELECT *

          FROM suppliers

          ORDER BY name

        `);


      res.json(
        r.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


app.post(
  "/api/suppliers",
  requireAuth,
  async (req, res) => {

    try {

      const d =
        req.body || {};


      if (!d.name) {

        return res
          .status(400)
          .json({

            error:
              "Informe o nome do fornecedor"

          });

      }


      const r =
        await pool.query(`

          INSERT INTO suppliers(

            name,
            phone,
            notes

          )

          VALUES(
            $1,$2,$3
          )

          RETURNING id

        `, [

          d.name,

          d.phone || "",

          d.notes || ""

        ]);


      res.json({

        id:
          r.rows[0].id

      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   VENDAS — LISTA
========================= */

app.get(
  "/api/sales",
  requireAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT

            s.*,

            c.name client,

            COALESCE(
              s.entry,
              0
            ) AS entry,

            COALESCE(
              s.paid_amount,
              0
            ) AS paid_amount,

            GREATEST(

              COALESCE(
                s.total,
                0
              )
              -
              COALESCE(
                s.paid_amount,
                0
              ),

              0

            ) AS balance

          FROM sales s

          LEFT JOIN clients c
            ON c.id = s.client_id

          ORDER BY
            s.id DESC

          LIMIT 500

        `);


      res.json(
        result.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   DETALHE DA VENDA
========================= */

app.get(
  "/api/sales/:id",
  requireAuth,
  async (req, res) => {

    try {

      const sale =
        (
          await pool.query(`

            SELECT

              s.*,

              c.name client,

              c.phone

            FROM sales s

            LEFT JOIN clients c
              ON c.id =
                s.client_id

            WHERE s.id=$1

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!sale) {

        return res
          .status(404)
          .json({

            error:
              "Venda não encontrada"

          });

      }


      const items =
        (
          await pool.query(`

            SELECT

              si.*,

              p.name,

              p.brand,

              p.size

            FROM sale_items si

            JOIN products p
              ON p.id =
                si.product_id

            WHERE
              si.sale_id=$1

            ORDER BY si.id

          `, [
            req.params.id
          ])
        )
        .rows;


      const installments =
        (
          await pool.query(`

            SELECT *

            FROM sale_installments

            WHERE
              sale_id=$1

            ORDER BY
              installment_no

          `, [
            req.params.id
          ])
        )
        .rows;


      const payments =
        (
          await pool.query(`

            SELECT *

            FROM sale_payments

            WHERE
              sale_id=$1

            ORDER BY
              paid_at,
              id

          `, [
            req.params.id
          ])
        )
        .rows;


      res.json({

        sale,

        items,

        installments,

        payments

      });

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   CRIA PARCELAS
========================= */

async function createInstallments(

  client,
  saleId,
  balance,
  count,
  firstDueDate

) {

  const totalCents =
    Math.round(
      round2(balance) *
      100
    );

  const n =
    Math.max(
      1,
      int(count) || 1
    );

  const base =
    Math.floor(
      totalCents / n
    );

  const remainder =
    totalCents -
    base * n;

  const start =
    toDate(
      firstDueDate
    );


  for (
    let i = 1;
    i <= n;
    i++
  ) {

    const cents =
      base +
      (
        i <= remainder
          ? 1
          : 0
      );


    if (
      cents <= 0
    ) {
      continue;
    }


    const due =
      addMonths(
        start,
        i - 1
      )
        .toISOString()
        .slice(
          0,
          10
        );


    await client.query(`

      INSERT INTO sale_installments(

        sale_id,

        installment_no,

        due_date,

        amount,

        paid_amount,

        status

      )

      VALUES(
        $1,
        $2,
        $3,
        $4,
        0,
        'open'
      )

    `, [

      saleId,

      i,

      due,

      cents / 100

    ]);

  }

}


/* =========================
   NOVA VENDA
========================= */

app.post(
  "/api/sales",
  requireAuth,
  async (req, res) => {

    const d =
      req.body || {};

    const clientId =
      d.client_id ||
      null;

    const items =
      d.items;

    const payment =
      normalizePayment(
        d.payment
      );

    const discount =
      Math.max(
        0,
        round2(
          d.discount
        )
      );

    const installments =
      Math.max(
        1,
        int(
          d.installments
        ) || 1
      );

    const entry =
      Math.max(
        0,
        round2(
          d.entry
        )
      );


    if (
      !Array.isArray(
        items
      ) ||
      !items.length
    ) {

      return res
        .status(400)
        .json({

          error:
            "Venda sem produtos"

        });

    }


    if (
      payment === "Fiado" &&
      !clientId
    ) {

      return res
        .status(400)
        .json({

          error:
            "Selecione o cliente para venda fiada"

        });

    }


    const connection =
      await pool.connect();


    try {

      await connection.query(
        "BEGIN"
      );


      let subtotal =
        0;

      const checked =
        [];


      for (
        const item
        of items
      ) {

        const product =
          (
            await connection.query(`

              SELECT *

              FROM products

              WHERE id=$1

              FOR UPDATE

            `, [
              item.product_id
            ])
          )
          .rows[0];


        if (!product) {

          throw new Error(
            "Produto não encontrado"
          );

        }


        const qty =
          int(
            item.qty
          );


        if (
          qty < 1
        ) {

          throw new Error(
            "Quantidade inválida"
          );

        }


        if (
          Number(
            product.stock
          ) < qty
        ) {

          throw new Error(
            `Estoque insuficiente: ${product.name}`
          );

        }


        subtotal +=
          Number(
            product.price
          ) *
          qty;


        checked.push({

          product,

          qty

        });

      }


      const total =
        Math.max(

          0,

          round2(
            subtotal -
            discount
          )

        );


      if (
        entry > total
      ) {

        throw new Error(
          "A entrada não pode ser maior que o total da venda"
        );

      }


      const balance =
        round2(
          total -
          entry
        );


      const status =
        balance <= 0
          ? "paid"
          : "open";


      const sale =
        (
          await connection.query(`

            INSERT INTO sales(

              client_id,

              total,

              discount,

              payment,

              installments,

              status,

              entry,

              paid_amount,

              balance

            )

            VALUES(

              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $7,
              $8

            )

            RETURNING id

          `, [

            clientId,

            total,

            discount,

            payment,

            installments,

            status,

            entry,

            balance

          ])
        )
        .rows[0];


      for (
        const {
          product,
          qty
        } of checked
      ) {

        await connection.query(`

          INSERT INTO sale_items(

            sale_id,

            product_id,

            qty,

            price,

            cost

          )

          VALUES(
            $1,
            $2,
            $3,
            $4,
            $5
          )

        `, [

          sale.id,

          product.id,

          qty,

          product.price,

          product.cost

        ]);


        await connection.query(`

          UPDATE products

          SET stock =
            stock - $1

          WHERE id=$2

        `, [

          qty,

          product.id

        ]);


        await connection.query(`

          INSERT INTO stock_moves(

            product_id,

            qty,

            type,

            note

          )

          VALUES(

            $1,

            $2,

            'SAIDA',

            $3

          )

        `, [

          product.id,

          -qty,

          `Venda #${sale.id}`

        ]);

      }


      if (
        balance > 0
      ) {

        await createInstallments(

          connection,

          sale.id,

          balance,

          installments,

          d.first_due_date ||
          now()

        );

      }


      if (
        entry > 0
      ) {

        await connection.query(`

          INSERT INTO sale_payments(

            sale_id,

            installment_id,

            amount,

            payment,

            note

          )

          VALUES(

            $1,

            NULL,

            $2,

            $3,

            $4

          )

        `, [

          sale.id,

          entry,

          payment,

          "Entrada"

        ]);

      }


      await connection.query(
        "COMMIT"
      );


      res.json({

        id:
          sale.id,

        total,

        entry,

        paid_amount:
          entry,

        balance,

        status

      });

    } catch (error) {

      await connection.query(
        "ROLLBACK"
      );


      res
        .status(400)
        .json({

          error:
            error.message

        });

    } finally {

      connection.release();

    }

  }
);


/* =========================
   PARCELAS
========================= */

app.get(
  "/api/sales/:id/installments",
  requireAuth,
  async (req, res) => {

    try {

      const r =
        await pool.query(`

          SELECT *

          FROM sale_installments

          WHERE
            sale_id=$1

          ORDER BY
            installment_no

        `, [
          req.params.id
        ]);


      res.json(
        r.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   PAGAMENTOS
========================= */

app.get(
  "/api/sales/:id/payments",
  requireAuth,
  async (req, res) => {

    try {

      const r =
        await pool.query(`

          SELECT *

          FROM sale_payments

          WHERE
            sale_id=$1

          ORDER BY
            paid_at,
            id

        `, [
          req.params.id
        ]);


      res.json(
        r.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   RECEBIMENTO PARCIAL
========================= */

app.post(
  "/api/sales/:id/pay",
  requireAuth,
  async (req, res) => {

    const amount =
      round2(
        req.body.amount ??
        req.body.value ??
        0
      );

    const payment =
      normalizePayment(
        req.body.payment
      );


    if (
      amount <= 0
    ) {

      return res
        .status(400)
        .json({

          error:
            "Informe um valor de pagamento válido"

        });

    }


    const connection =
      await pool.connect();


    try {

      await connection.query(
        "BEGIN"
      );


      const sale =
        (
          await connection.query(`

            SELECT *

            FROM sales

            WHERE id=$1

            FOR UPDATE

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!sale) {

        throw new Error(
          "Venda não encontrada"
        );

      }


      if (
        sale.status ===
        "cancelled"
      ) {

        throw new Error(
          "Venda cancelada"
        );

      }


      const currentBalance =
        round2(

          Number(
            sale.total
          ) -

          Number(
            sale.paid_amount ||
            0
          )

        );


      if (
        currentBalance <= 0
      ) {

        throw new Error(
          "Venda já está quitada"
        );

      }


      if (
        amount >
        currentBalance +
        0.01
      ) {

        throw new Error(

          `Pagamento maior que o saldo. Saldo: R$ ${money(currentBalance).replace(".", ",")}`

        );

      }


      let remaining =
        amount;


      const insts =
        (
          await connection.query(`

            SELECT *

            FROM sale_installments

            WHERE

              sale_id=$1

              AND status <> 'paid'

            ORDER BY
              installment_no

            FOR UPDATE

          `, [
            req.params.id
          ])
        )
        .rows;


      if (
        !insts.length
      ) {

        await connection.query(`

          INSERT INTO sale_installments(

            sale_id,

            installment_no,

            due_date,

            amount,

            paid_amount,

            status

          )

          VALUES(

            $1,

            1,

            CURRENT_DATE,

            $2,

            0,

            'open'

          )

        `, [

          req.params.id,

          currentBalance

        ]);


        insts.push(

          (
            await connection.query(`

              SELECT *

              FROM sale_installments

              WHERE
                sale_id=$1

              ORDER BY
                installment_no DESC

              LIMIT 1

            `, [
              req.params.id
            ])
          )
          .rows[0]

        );

      }


      for (
        const inst
        of insts
      ) {

        if (
          remaining <=
          0.009
        ) {
          break;
        }


        const openInst =
          round2(

            Number(
              inst.amount
            ) -

            Number(
              inst.paid_amount ||
              0
            )

          );


        if (
          openInst <= 0
        ) {
          continue;
        }


        const applied =
          Math.min(
            remaining,
            openInst
          );


        const newPaid =
          round2(

            Number(
              inst.paid_amount ||
              0
            ) +
            applied

          );


        const newStatus =
          newPaid +
          0.009 >=
          Number(
            inst.amount
          )
            ? "paid"
            : "partial";


        await connection.query(`

          UPDATE sale_installments

          SET

            paid_amount=$1,

            status=$2

          WHERE id=$3

        `, [

          newPaid,

          newStatus,

          inst.id

        ]);


        await connection.query(`

          INSERT INTO sale_payments(

            sale_id,

            installment_id,

            amount,

            payment,

            note

          )

          VALUES(

            $1,

            $2,

            $3,

            $4,

            $5

          )

        `, [

          req.params.id,

          inst.id,

          applied,

          payment,

          req.body.note ||
          "Pagamento parcial"

        ]);


        remaining =
          round2(
            remaining -
            applied
          );

      }


      const newPaidTotal =
        round2(

          Number(
            sale.paid_amount ||
            0
          ) +
          amount

        );


      const newBalance =
        Math.max(

          0,

          round2(

            Number(
              sale.total
            ) -
            newPaidTotal

          )

        );


      const newStatus =
        newBalance <=
        0.009
          ? "paid"
          : "open";


      await connection.query(`

        UPDATE sales

        SET

          paid_amount=$1,

          balance=$2,

          status=$3

        WHERE id=$4

      `, [

        newPaidTotal,

        newBalance,

        newStatus,

        req.params.id

      ]);


      await connection.query(
        "COMMIT"
      );


      res.json({

        ok:
          true,

        paid_amount:
          newPaidTotal,

        balance:
          newBalance,

        status:
          newStatus

      });

    } catch (error) {

      await connection.query(
        "ROLLBACK"
      );


      res
        .status(400)
        .json({

          error:
            error.message

        });

    } finally {

      connection.release();

    }

  }
);


/* =========================
   CANCELAR / EXCLUIR VENDA
   RESTAURA ESTOQUE
========================= */

app.delete(
  "/api/sales/:id",
  requireAuth,
  async (req, res) => {

    const connection =
      await pool.connect();


    try {

      await connection.query(
        "BEGIN"
      );


      const sale =
        (
          await connection.query(`

            SELECT *

            FROM sales

            WHERE id=$1

            FOR UPDATE

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!sale) {

        throw new Error(
          "Venda não encontrada"
        );

      }


      if (
        sale.status ===
        "cancelled"
      ) {

        throw new Error(
          "Venda já está cancelada"
        );

      }


      const items =
        (
          await connection.query(`

            SELECT *

            FROM sale_items

            WHERE sale_id=$1

          `, [
            sale.id
          ])
        )
        .rows;


      for (
        const item
        of items
      ) {

        await connection.query(`

          UPDATE products

          SET stock =
            stock + $1

          WHERE id=$2

        `, [

          item.qty,

          item.product_id

        ]);


        await connection.query(`

          INSERT INTO stock_moves(

            product_id,

            qty,

            type,

            note

          )

          VALUES(

            $1,

            $2,

            'ENTRADA',

            $3

          )

        `, [

          item.product_id,

          item.qty,

          `Estorno da venda #${sale.id}`

        ]);

      }


      await connection.query(`

        UPDATE sales

        SET

          status='cancelled',

          cancelled_at=NOW(),

          cancelled_reason=$1,

          balance=0

        WHERE id=$2

      `, [

        req.body.reason ||
        "Venda excluída/cancelada",

        sale.id

      ]);


      await connection.query(
        "COMMIT"
      );


      res.json({
        ok: true
      });

    } catch (error) {

      await connection.query(
        "ROLLBACK"
      );


      res
        .status(400)
        .json({

          error:
            error.message

        });

    } finally {

      connection.release();

    }

  }
);


/* =========================
   ESTOQUE
========================= */

app.post(
  "/api/stock",
  requireAuth,
  async (req, res) => {

    const productId =
      req.body.product_id;

    const quantity =
      int(
        req.body.qty
      );

    const type =
      req.body.type;


    if (
      quantity < 1
    ) {

      return res
        .status(400)
        .json({

          error:
            "Quantidade inválida"

        });

    }


    if (
      ![
        "ENTRADA",
        "SAIDA"
      ].includes(type)
    ) {

      return res
        .status(400)
        .json({

          error:
            "Tipo de movimentação inválido"

        });

    }


    const connection =
      await pool.connect();


    try {

      await connection.query(
        "BEGIN"
      );


      const product =
        (
          await connection.query(`

            SELECT stock

            FROM products

            WHERE id=$1

            FOR UPDATE

          `, [
            productId
          ])
        )
        .rows[0];


      if (!product) {

        throw new Error(
          "Produto não encontrado"
        );

      }


      if (
        type === "SAIDA" &&
        Number(
          product.stock
        ) < quantity
      ) {

        throw new Error(
          "Estoque insuficiente"
        );

      }


      const delta =
        type === "ENTRADA"
          ? quantity
          : -quantity;


      await connection.query(`

        UPDATE products

        SET stock =
          stock + $1

        WHERE id=$2

      `, [

        delta,

        productId

      ]);


      await connection.query(`

        INSERT INTO stock_moves(

          product_id,

          qty,

          type,

          note

        )

        VALUES(
          $1,
          $2,
          $3,
          $4
        )

      `, [

        productId,

        delta,

        type,

        req.body.note ||
        "Ajuste"

      ]);


      await connection.query(
        "COMMIT"
      );


      res.json({
        ok: true
      });

    } catch (error) {

      await connection.query(
        "ROLLBACK"
      );


      res
        .status(400)
        .json({

          error:
            error.message

        });

    } finally {

      connection.release();

    }

  }
);


app.get(
  "/api/stock/moves",
  requireAuth,
  async (req, res) => {

    try {

      const r =
        await pool.query(`

          SELECT

            sm.*,

            p.name product

          FROM stock_moves sm

          JOIN products p
            ON p.id =
              sm.product_id

          ORDER BY
            sm.id DESC

          LIMIT 500

        `);


      res.json(
        r.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   COMPRAS / CONTAS A PAGAR
========================= */

app.get(
  "/api/purchases",
  requireAuth,
  async (req, res) => {

    try {

      const r =
        await pool.query(`

          SELECT

            p.*,

            COALESCE(

              NULLIF(
                p.supplier,
                ''
              ),

              'Fornecedor não informado'

            ) AS fornecedor,

            GREATEST(

              COALESCE(
                p.total,
                0
              )

              -

              COALESCE(
                p.paid_amount,
                0
              ),

              0

            ) AS balance

          FROM purchases p

          ORDER BY
            p.date DESC,
            p.id DESC

        `);


      res.json(
        r.rows
      );

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   DETALHE DA COMPRA
========================= */

app.get(
  "/api/purchases/:id",
  requireAuth,
  async (req, res) => {

    try {

      const purchase =
        (
          await pool.query(`

            SELECT

              *,

              GREATEST(

                total -
                COALESCE(
                  paid_amount,
                  0
                ),

                0

              ) AS balance

            FROM purchases

            WHERE id=$1

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!purchase) {

        return res
          .status(404)
          .json({

            error:
              "Compra não encontrada"

          });

      }


      const payments =
        (
          await pool.query(`

            SELECT *

            FROM purchase_payments

            WHERE
              purchase_id=$1

            ORDER BY
              paid_at,
              id

          `, [
            req.params.id
          ])
        )
        .rows;


      res.json({

        purchase,

        payments

      });

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   NOVA COMPRA
========================= */

app.post(
  "/api/purchases",
  requireAuth,
  async (req, res) => {

    try {

      const d =
        req.body || {};


      const total =
        Math.max(
          0,
          round2(
            d.total
          )
        );


      const entry =
        Math.max(
          0,
          round2(
            d.entry
          )
        );


      if (
        total <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Informe o valor da compra"

          });

      }


      if (
        entry > total
      ) {

        return res
          .status(400)
          .json({

            error:
              "A entrada não pode ser maior que o total da compra"

          });

      }


      const balance =
        round2(
          total -
          entry
        );


      const status =
        balance <= 0
          ? "paid"
          : "open";


      const result =
        await pool.query(`

          INSERT INTO purchases(

            supplier,

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

          VALUES(

            $1,

            $2,

            $3,

            $4,

            $4,

            $5,

            $6,

            $7,

            $8,

            $9

          )

          RETURNING id

        `, [

          d.supplier ||
          d.fornecedor ||
          "",

          d.date
            ? toDate(
                d.date
              )
            : new Date(),

          total,

          entry,

          balance,

          Math.max(
            1,
            int(
              d.installments
            ) || 1
          ),

          normalizePayment(
            d.payment
          ),

          status,

          d.notes ||
          ""

        ]);


      if (
        entry > 0
      ) {

        await pool.query(`

          INSERT INTO purchase_payments(

            purchase_id,

            amount,

            payment,

            note

          )

          VALUES(

            $1,

            $2,

            $3,

            'Entrada'

          )

        `, [

          result.rows[0].id,

          entry,

          normalizePayment(
            d.payment
          )

        ]);

      }


      res.json({

        id:
          result.rows[0].id,

        total,

        entry,

        paid_amount:
          entry,

        balance,

        status

      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   ALTERAR COMPRA
========================= */

app.put(
  "/api/purchases/:id",
  requireAuth,
  async (req, res) => {

    try {

      const old =
        (
          await pool.query(`

            SELECT *

            FROM purchases

            WHERE id=$1

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!old) {

        return res
          .status(404)
          .json({

            error:
              "Compra não encontrada"

          });

      }


      const d =
        req.body || {};


      const total =
        Math.max(

          0,

          round2(
            d.total ??
            old.total
          )

        );


      const supplier =
        d.supplier ??
        d.fornecedor ??
        old.supplier ??
        "";


      await pool.query(`

        UPDATE purchases

        SET

          supplier=$1,

          date=$2,

          total=$3,

          installments=$4,

          payment=$5,

          notes=$6,

          balance =
            GREATEST(

              $3 -
              COALESCE(
                paid_amount,
                0
              ),

              0

            ),

          status =
            CASE

              WHEN
                GREATEST(

                  $3 -
                  COALESCE(
                    paid_amount,
                    0
                  ),

                  0

                ) <= 0

              THEN
                'paid'

              ELSE
                'open'

            END

        WHERE id=$7

      `, [

        supplier,

        d.date
          ? toDate(
              d.date
            )
          : old.date,

        total,

        Math.max(

          1,

          int(
            d.installments
          ) ||
          int(
            old.installments
          ) ||
          1

        ),

        normalizePayment(
          d.payment ||
          old.payment
        ),

        (
          d.notes ??
          old.notes ??
          ""
        ),

        req.params.id

      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   EXCLUIR COMPRA
========================= */

app.delete(
  "/api/purchases/:id",
  requireAuth,
  async (req, res) => {

    try {

      await pool.query(`

        DELETE FROM purchases

        WHERE id=$1

      `, [
        req.params.id
      ]);


      res.json({
        ok: true
      });

    } catch (error) {

      res
        .status(400)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   PAGAMENTO DE COMPRA
========================= */

app.post(
  "/api/purchases/:id/pay",
  requireAuth,
  async (req, res) => {

    const amount =
      round2(

        req.body.amount ??
        req.body.value ??
        0

      );


    const payment =
      normalizePayment(
        req.body.payment
      );


    if (
      amount <= 0
    ) {

      return res
        .status(400)
        .json({

          error:
            "Informe um valor válido"

        });

    }


    const connection =
      await pool.connect();


    try {

      await connection.query(
        "BEGIN"
      );


      const purchase =
        (
          await connection.query(`

            SELECT *

            FROM purchases

            WHERE id=$1

            FOR UPDATE

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!purchase) {

        throw new Error(
          "Compra não encontrada"
        );

      }


      const balance =
        round2(

          Number(
            purchase.total
          ) -

          Number(
            purchase.paid_amount ||
            0
          )

        );


      if (
        balance <= 0
      ) {

        throw new Error(
          "Compra já está quitada"
        );

      }


      if (
        amount >
        balance +
        0.01
      ) {

        throw new Error(

          `Pagamento maior que o saldo. Saldo: R$ ${money(balance).replace(".", ",")}`

        );

      }


      const paid =
        round2(

          Number(
            purchase.paid_amount ||
            0
          ) +

          amount

        );


      const newBalance =
        Math.max(

          0,

          round2(

            Number(
              purchase.total
            ) -
            paid

          )

        );


      const status =
        newBalance <=
        0.009
          ? "paid"
          : "open";


      await connection.query(`

        INSERT INTO purchase_payments(

          purchase_id,

          amount,

          payment,

          note

        )

        VALUES(

          $1,

          $2,

          $3,

          $4

        )

      `, [

        purchase.id,

        amount,

        payment,

        req.body.note ||
        "Pagamento"

      ]);


      await connection.query(`

        UPDATE purchases

        SET

          paid_amount=$1,

          balance=$2,

          status=$3

        WHERE id=$4

      `, [

        paid,

        newBalance,

        status,

        purchase.id

      ]);


      await connection.query(
        "COMMIT"
      );


      res.json({

        ok:
          true,

        paid_amount:
          paid,

        balance:
          newBalance,

        status

      });

    } catch (error) {

      await connection.query(
        "ROLLBACK"
      );


      res
        .status(400)
        .json({

          error:
            error.message

        });

    } finally {

      connection.release();

    }

  }
);


/* =========================
   RELATÓRIOS
========================= */

app.get(
  "/api/reports",
  requireAuth,
  async (req, res) => {

    try {

      const from =
        req.query.from ||
        "1900-01-01";


      const to =
        (
          req.query.to ||
          new Date()
            .toISOString()
            .slice(
              0,
              10
            )
        ) +
        " 23:59:59.999";


      const sales =
        (
          await pool.query(`

            SELECT

              s.*,

              c.name client,

              COALESCE(
                s.entry,
                0
              ) entry,

              COALESCE(
                s.paid_amount,
                0
              ) paid_amount,

              GREATEST(

                s.total -

                COALESCE(
                  s.paid_amount,
                  0
                ),

                0

              ) balance

            FROM sales s

            LEFT JOIN clients c
              ON c.id =
                s.client_id

            WHERE

              s.date
              BETWEEN $1
              AND $2

            ORDER BY
              s.id DESC

          `, [
            from,
            to
          ])
        )
        .rows;


      const totals =
        (
          await pool.query(`

            SELECT

              COALESCE(

                SUM(total)
                FILTER (
                  WHERE
                    status <>
                    'cancelled'
                ),

                0

              ) revenue,


              COALESCE(

                SUM(paid_amount)
                FILTER (
                  WHERE
                    status <>
                    'cancelled'
                ),

                0

              ) received,


              COALESCE(

                SUM(balance)
                FILTER (
                  WHERE
                    status =
                    'open'
                ),

                0

              ) receivable,


              COALESCE(

                SUM(

                  CASE

                    WHEN
                      status =
                      'paid'

                    THEN (

                      SELECT
                        COALESCE(

                          SUM(

                            (
                              si.price -
                              si.cost
                            ) *
                            si.qty

                          ),

                          0

                        )

                      FROM sale_items si

                      WHERE
                        si.sale_id =
                        s.id

                    )

                    ELSE
                      0

                  END

                ),

                0

              ) profit

            FROM sales s

            WHERE

              s.date
              BETWEEN $1
              AND $2

          `, [
            from,
            to
          ])
        )
        .rows[0];


      const top =
        (
          await pool.query(`

            SELECT

              p.name,

              SUM(
                si.qty
              )::int qty

            FROM sale_items si

            JOIN products p
              ON p.id =
                si.product_id

            JOIN sales s
              ON s.id =
                si.sale_id

            WHERE

              s.date
              BETWEEN $1
              AND $2

              AND s.status <>
                'cancelled'

            GROUP BY

              p.id,

              p.name

            ORDER BY
              qty DESC

            LIMIT 10

          `, [
            from,
            to
          ])
        )
        .rows;


      const debts =
        (
          await pool.query(`

            SELECT

              s.id,

              s.date,

              s.total,

              s.entry,

              s.paid_amount,

              s.balance,

              c.name,

              c.phone,

              s.installments,

              s.payment

            FROM sales s

            LEFT JOIN clients c
              ON c.id =
                s.client_id

            WHERE

              s.status =
                'open'

              AND s.balance > 0

            ORDER BY
              s.id DESC

          `)
        )
        .rows;


      const purchases =
        (
          await pool.query(`

            SELECT

              p.*,

              COALESCE(

                NULLIF(
                  p.supplier,
                  ''
                ),

                'Fornecedor não informado'

              ) fornecedor,

              GREATEST(

                p.total -

                COALESCE(
                  p.paid_amount,
                  0
                ),

                0

              ) balance

            FROM purchases p

            WHERE

              p.date
              BETWEEN $1
              AND $2

            ORDER BY
              p.id DESC

          `, [
            from,
            to
          ])
        )
        .rows;


      const payable =
        (
          await pool.query(`

            SELECT

              COALESCE(
                SUM(balance),
                0
              ) total,

              COUNT(*)::int
              count

            FROM purchases

            WHERE

              status =
                'open'

              AND balance > 0

          `)
        )
        .rows[0];


      res.json({

        sales,

        totals,

        top,

        debts,

        purchases,

        payable,

        payables:
          payable

      });

    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


/* =========================
   COMPROVANTE PDF
========================= */

app.get(
  "/api/sales/:id/pdf",
  requireAuth,
  async (req, res) => {

    try {

      const sale =
        (
          await pool.query(`

            SELECT

              s.*,

              c.name client,

              c.phone

            FROM sales s

            LEFT JOIN clients c
              ON c.id =
                s.client_id

            WHERE
              s.id=$1

          `, [
            req.params.id
          ])
        )
        .rows[0];


      if (!sale) {

        return res
          .status(404)
          .end();

      }


      const items =
        (
          await pool.query(`

            SELECT

              si.*,

              p.name,

              p.brand,

              p.size

            FROM sale_items si

            JOIN products p
              ON p.id =
                si.product_id

            WHERE
              si.sale_id=$1

          `, [
            sale.id
          ])
        )
        .rows;


      const doc =
        new PDFDocument({

          size:
            "A5",

          margin:
            35

        });


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(

        "Content-Disposition",

        `inline; filename="comprovante-${sale.id}.pdf"`

      );


      doc.pipe(res);


      doc
        .fontSize(19)
        .fillColor("#8f4e5d")
        .text(
          "Essência & Charme",
          {
            align:
              "center"
          }
        );


      doc
        .fontSize(10)
        .fillColor("#777")
        .text(
          "Comprovante de venda",
          {
            align:
              "center"
          }
        );


      doc.moveDown();


      doc
        .strokeColor("#d8b3bc")
        .moveTo(
          35,
          doc.y
        )
        .lineTo(
          385,
          doc.y
        )
        .stroke();


      doc.moveDown();


      doc
        .fontSize(10)
        .fillColor("#403338")
        .text(
          `Venda #${sale.id}`
        );


      doc.text(
        new Date(
          sale.date
        ).toLocaleString(
          "pt-BR"
        )
      );


      doc.text(
        `Cliente: ${
          sale.client ||
          "Consumidor"
        }`
      );


      if (sale.phone) {

        doc.text(
          `Telefone: ${sale.phone}`
        );

      }


      doc.moveDown();


      items.forEach(
        item => {

          const value =
            Number(
              item.qty
            ) *
            Number(
              item.price
            );


          const name =
            item.name +
            (
              item.size
                ? ` - ${item.size}`
                : ""
            );


          doc
            .fontSize(10)
            .fillColor("#403338")
            .text(

              `${item.qty}x ${name}`,

              {
                continued:
                  true
              }

            );


          doc.text(

            `R$ ${money(value).replace(".", ",")}`,

            {
              align:
                "right"
            }

          );

        }
      );


      doc.moveDown();


      doc
        .strokeColor("#eadfe0")
        .moveTo(
          35,
          doc.y
        )
        .lineTo(
          385,
          doc.y
        )
        .stroke();


      doc.moveDown();


      if (
        Number(
          sale.discount
        ) > 0
      ) {

        doc
          .fontSize(10)
          .text(

            `Desconto: R$ ${money(sale.discount).replace(".", ",")}`

          );

      }


      doc.text(

        `Entrada: R$ ${money(sale.entry).replace(".", ",")}`

      );


      doc
        .fontSize(15)
        .fillColor("#8f4e5d")
        .text(

          `TOTAL: R$ ${money(sale.total).replace(".", ",")}`

        );


      doc
        .fontSize(10)
        .fillColor("#403338")
        .text(

          `Pago: R$ ${money(sale.paid_amount).replace(".", ",")}`

        );


      doc.text(

        `Saldo: R$ ${money(

          Math.max(

            0,

            Number(
              sale.total
            ) -
            Number(
              sale.paid_amount ||
              0
            )

          )

        ).replace(".", ",")}`

      );


      doc.text(

        `Pagamento: ${
          sale.payment
        }${
          sale.installments > 1
            ? ` - ${sale.installments}x`
            : ""
        }`

      );


      doc.moveDown(2);


      doc
        .fontSize(11)
        .fillColor("#8f4e5d")
        .text(

          "Obrigada pela preferência!",

          {
            align:
              "center"
          }

        );


      doc
        .fontSize(8)
        .fillColor("#999")
        .text(

          "Essência & Charme",

          {
            align:
              "center"
          }

        );


      doc.end();

    } catch (error) {

      res
        .status(500)
        .end();

    }

  }
);


/* =========================
   PÁGINA PRINCIPAL
========================= */

app.use(
  (req, res, next) => {

    if (
      req.method === "GET" &&
      !req.path.startsWith(
        "/api/"
      )
    ) {

      return res.sendFile(

        path.join(
          __dirname,
          "public",
          "index.html"
        )

      );

    }

    next();

  }
);


/* =========================
   TRATAMENTO DE ERRO
========================= */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {

    console.error(err);

    if (
      res.headersSent
    ) {

      return next(err);

    }

    res
      .status(500)
      .json({

        error:
          "Erro interno do servidor"

      });

  }
);


/* =========================
   INICIAR
========================= */

initDb()

  .then(
    () => {

      app.listen(

        PORT,

        "0.0.0.0",

        () => {

          console.log(
            `🌸 Essência & Charme online na porta ${PORT}`
          );

        }

      );

    }
  )

  .catch(
    error => {

      console.error(

        "Erro ao iniciar o sistema:",

        error

      );

      process.exit(1);

    }
  );
