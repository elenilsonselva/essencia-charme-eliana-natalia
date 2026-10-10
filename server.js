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

/* =========================
   CONFIGURAÇÕES
========================= */

const sessions = new Map();

const ADMIN_USER =
  process.env.ADMIN_USER || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "troque-esta-senha";

if (!process.env.DATABASE_URL) {

  console.error(
    "ERRO: configure a variável DATABASE_URL com a URL do PostgreSQL."
  );

  process.exit(1);
}

/* =========================
   BANCO DE DADOS
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
   UPLOAD DE IMAGENS
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
   SESSÃO / AUTENTICAÇÃO
========================= */

function requireAuth(req, res, next) {

  const token =
    req.cookies.ec_session;

  const session =
    token && sessions.get(token);

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
    crypto.randomBytes(32).toString("hex");

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
        ok: true
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
   VERIFICAÇÃO DE LOGIN
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
   UTILITÁRIOS
========================= */

const money = value =>
  Number(value || 0)
    .toFixed(2);

const now = () =>
  new Date().toISOString();

function photoData(file) {

  if (!file) {
    return null;
  }

  const mime =
    file.mimetype ||
    "image/jpeg";

  return (
    `data:${mime};base64,` +
    file.buffer.toString("base64")
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


    CREATE INDEX IF NOT EXISTS
      idx_sales_date
      ON sales(date);


    CREATE INDEX IF NOT EXISTS
      idx_sale_items_sale
      ON sale_items(sale_id);

  `);

}

/* =========================
   HEALTH CHECK
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
        app: "Essência & Charme"
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

      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      const daily =
        await pool.query(

          `

          SELECT

            COALESCE(
              SUM(total),
              0
            ) total,

            COUNT(*)::int count

          FROM sales

          WHERE
            date::date = $1

            AND status = 'paid'

          `,

          [today]

        );


      const monthly =
        await pool.query(

          `

          SELECT

            COALESCE(
              SUM(total),
              0
            ) total

          FROM sales

          WHERE

            date::date >=
              date_trunc(
                'month',
                CURRENT_DATE
              )

            AND status = 'paid'

          `

        );


      const low =
        await pool.query(

          `

          SELECT
            COUNT(*)::int c

          FROM products

          WHERE
            stock <= min_stock

          `

        );


      const debt =
        await pool.query(

          `

          SELECT

            COALESCE(
              SUM(total),
              0
            ) v,

            COUNT(*)::int c

          FROM sales

          WHERE
            payment = 'Fiado'

            AND status = 'open'

          `

        );


      res.json({

        today:
          daily.rows[0],

        month:
          monthly.rows[0],

        low:
          low.rows[0].c,

        debt:
          debt.rows[0]

      });

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            "Erro ao carregar dashboard."
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

    const result =
      await pool.query(
        `
        SELECT *
        FROM products
        ORDER BY name
        `
      );

    res.json(
      result.rows
    );

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
        await pool.query(

          `

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

          `,

          [

            data.code || null,

            data.name,

            data.brand || "",

            data.size || "",

            Number(data.cost) || 0,

            Number(data.price) || 0,

            Number(data.stock) || 0,

            Number(data.min_stock) || 1,

            photoData(req.file)

          ]

        );

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

      const data =
        req.body;

      const old =
        await pool.query(

          `
          SELECT photo
          FROM products
          WHERE id=$1
          `,

          [req.params.id]

        );

      if (!old.rows.length) {

        return res
          .status(404)
          .json({
            error:
              "Produto não encontrado"
          });

      }

      await pool.query(

        `

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

        `,

        [

          data.code || null,

          data.name,

          data.brand || "",

          data.size || "",

          Number(data.cost) || 0,

          Number(data.price) || 0,

          Number(data.stock) || 0,

          Number(data.min_stock) || 1,

          photoData(req.file) ||
            old.rows[0].photo,

          req.params.id

        ]

      );

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

      await pool.query(
        `
        DELETE FROM products
        WHERE id=$1
        `,
        [req.params.id]
      );

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

    const result =
      await pool.query(
        `
        SELECT *
        FROM clients
        ORDER BY name
        `
      );

    res.json(
      result.rows
    );

  }
);


app.post(
  "/api/clients",
  requireAuth,
  async (req, res) => {

    const data =
      req.body;

    const result =
      await pool.query(

        `

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

        `,

        [

          data.name,

          data.phone || "",

          data.address || "",

          data.notes || ""

        ]

      );

    res.json({
      id:
        result.rows[0].id
    });

  }
);


app.put(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {

    const data =
      req.body;

    await pool.query(

      `

      UPDATE clients

      SET

        name=$1,

        phone=$2,

        address=$3,

        notes=$4

      WHERE id=$5

      `,

      [

        data.name,

        data.phone || "",

        data.address || "",

        data.notes || "",

        req.params.id

      ]

    );

    res.json({
      ok: true
    });

  }
);


app.delete(
  "/api/clients/:id",
  requireAuth,
  async (req, res) => {

    try {

      await pool.query(

        `
        DELETE FROM clients
        WHERE id=$1
        `,

        [req.params.id]

      );

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
   VENDAS
========================= */

app.get(
  "/api/sales",
  requireAuth,
  async (req, res) => {

    const result =
      await pool.query(

        `

        SELECT

          s.*,

          c.name client

        FROM sales s

        LEFT JOIN clients c
          ON c.id=s.client_id

        ORDER BY s.id DESC

        LIMIT 300

        `

      );

    res.json(
      result.rows
    );

  }
);


app.post(
  "/api/sales",
  requireAuth,
  async (req, res) => {

    const {

      client_id,
      items,
      discount,
      payment,
      installments

    } = req.body;


    if (
      !Array.isArray(items) ||
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
      !client_id
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


      let subtotal = 0;

      const checked = [];


      for (
        const item of items
      ) {

        const product =
          (

            await connection.query(

              `
              SELECT *
              FROM products
              WHERE id=$1
              FOR UPDATE
              `,

              [item.product_id]

            )

          ).rows[0];


        if (!product) {

          throw new Error(
            "Produto não encontrado"
          );

        }


        const qty =
          Number(item.qty);


        if (
          !Number.isInteger(qty) ||
          qty < 1
        ) {

          throw new Error(
            "Quantidade inválida"
          );

        }


        if (
          Number(product.stock) <
          qty
        ) {

          throw new Error(

            "Estoque insuficiente: " +
            product.name

          );

        }


        subtotal +=
          Number(product.price) *
          qty;


        checked.push({

          item,

          product,

          qty

        });

      }


      const total =
        Math.max(

          0,

          subtotal -
          (
            Number(discount) || 0
          )

        );


      const status =
        payment === "Fiado"
          ? "open"
          : "paid";


      const sale =
        (

          await connection.query(

            `

            INSERT INTO sales(

              client_id,
              total,
              discount,
              payment,
              installments,
              status

            )

            VALUES(
              $1,$2,$3,$4,$5,$6
            )

            RETURNING id

            `,

            [

              client_id || null,

              total,

              Number(discount) || 0,

              payment,

              Number(installments) || 1,

              status

            ]

          )

        ).rows[0];


      for (
        const {
          product,
          qty
        } of checked
      ) {

        await connection.query(

          `

          INSERT INTO sale_items(

            sale_id,
            product_id,
            qty,
            price,
            cost

          )

          VALUES(
            $1,$2,$3,$4,$5
          )

          `,

          [

            sale.id,

            product.id,

            qty,

            product.price,

            product.cost

          ]

        );


        await connection.query(

          `

          UPDATE products

          SET stock =
            stock - $1

          WHERE id=$2

          `,

          [

            qty,

            product.id

          ]

        );


        await connection.query(

          `

          INSERT INTO stock_moves(

            product_id,
            qty,
            type,
            note

          )

          VALUES(
            $1,$2,'SAIDA',$3
          )

          `,

          [

            product.id,

            -qty,

            "Venda #" +
            sale.id

          ]

        );

      }


      await connection.query(
        "COMMIT"
      );


      res.json({
        id:
          sale.id
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

    const {

      product_id,
      qty,
      type,
      note

    } = req.body;


    const quantity =
      Number(qty) || 0;


    if (
      !Number.isInteger(quantity) ||
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
      type !== "ENTRADA" &&
      type !== "SAIDA"
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

          await connection.query(

            `
            SELECT stock
            FROM products
            WHERE id=$1
            FOR UPDATE
            `,

            [product_id]

          )

        ).rows[0];


      if (!product) {

        throw new Error(
          "Produto não encontrado"
        );

      }


      if (
        type === "SAIDA" &&
        Number(product.stock) <
        quantity
      ) {

        throw new Error(
          "Estoque insuficiente"
        );

      }


      const delta =
        type === "ENTRADA"
          ? quantity
          : -quantity;


      await connection.query(

        `

        UPDATE products

        SET stock =
          stock + $1

        WHERE id=$2

        `,

        [

          delta,

          product_id

        ]

      );


      await connection.query(

        `

        INSERT INTO stock_moves(

          product_id,
          qty,
          type,
          note

        )

        VALUES(
          $1,$2,$3,$4
        )

        `,

        [

          product_id,

          delta,

          type,

          note || "Ajuste"

        ]

      );


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
   RELATÓRIOS
========================= */

app.get(
  "/api/reports",
  requireAuth,
  async (req, res) => {

    const from =
      req.query.from ||
      "1900-01-01";


    const to =
      (
        req.query.to ||
        new Date()
          .toISOString()
          .slice(0,10)
      ) +
      " 23:59:59.999";


    const sales =
      (

        await pool.query(

          `

          SELECT

            s.*,

            c.name client

          FROM sales s

          LEFT JOIN clients c
            ON c.id=s.client_id

          WHERE
            s.date BETWEEN $1 AND $2

          ORDER BY
            s.id DESC

          `,

          [from,to]

        )

      ).rows;


    const totals =
      (

        await pool.query(

          `

          SELECT

            COALESCE(
              SUM(total),
              0
            ) revenue,

            COALESCE(

              SUM(

                CASE

                  WHEN status='paid'

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
                      si.sale_id=s.id

                  )

                  ELSE 0

                END

              ),

              0

            ) profit

          FROM sales s

          WHERE
            s.date BETWEEN $1 AND $2

          `,

          [from,to]

        )

      ).rows[0];


    const top =
      (

        await pool.query(

          `

          SELECT

            p.name,

            SUM(
              si.qty
            )::int qty

          FROM sale_items si

          JOIN products p
            ON p.id=si.product_id

          JOIN sales s
            ON s.id=si.sale_id

          WHERE

            s.date BETWEEN $1 AND $2

            AND s.status='paid'

          GROUP BY
            p.id,
            p.name

          ORDER BY
            qty DESC

          LIMIT 10

          `,

          [from,to]

        )

      ).rows;


    const debts =
      (

        await pool.query(

          `

          SELECT

            s.id,

            s.date,

            s.total,

            c.name,

            c.phone

          FROM sales s

          LEFT JOIN clients c
            ON c.id=s.client_id

          WHERE

            s.payment='Fiado'

            AND s.status='open'

          ORDER BY
            s.id DESC

          `

        )

      ).rows;


    res.json({

      sales,

      totals,

      top,

      debts

    });

  }
);

/* =========================
   RECEBIMENTO DE FIADO
========================= */

app.post(
  "/api/sales/:id/pay",
  requireAuth,
  async (req, res) => {

    const result =
      await pool.query(

        `

        UPDATE sales

        SET

          status='paid',

          payment =
            COALESCE(
              NULLIF($1,''),
              payment
            )

        WHERE

          id=$2

          AND status='open'

        RETURNING id

        `,

        [

          req.body.payment ||
          "Dinheiro",

          req.params.id

        ]

      );


    if (!result.rows.length) {

      return res
        .status(400)
        .json({

          error:
            "Venda não encontrada ou já paga"

        });

    }


    res.json({
      ok: true
    });

  }
);

/* =========================
   COMPROVANTE PDF
========================= */

app.get(
  "/api/sales/:id/pdf",
  requireAuth,
  async (req, res) => {

    const sale =
      (

        await pool.query(

          `

          SELECT

            s.*,

            c.name client,

            c.phone

          FROM sales s

          LEFT JOIN clients c
            ON c.id=s.client_id

          WHERE
            s.id=$1

          `,

          [req.params.id]

        )

      ).rows[0];


    if (!sale) {

      return res
        .status(404)
        .end();

    }


    const items =
      (

        await pool.query(

          `

          SELECT

            si.*,

            p.name,

            p.brand,

            p.size

          FROM sale_items si

          JOIN products p
            ON p.id=si.product_id

          WHERE
            si.sale_id=$1

          `,

          [sale.id]

        )

      ).rows;


    res.setHeader(
      "Content-Type",
      "application/pdf"
    );


    res.setHeader(

      "Content-Disposition",

      `inline; filename="comprovante-${sale.id}.pdf"`

    );


    const doc =
      new PDFDocument({

        size: "A5",

        margin: 35

      });


    doc.pipe(res);


    /* CABEÇALHO */

    doc
      .fontSize(19)
      .fillColor("#8f4e5d")
      .text(
        "Essência & Charme",
        {
          align: "center"
        }
      );


    doc
      .fontSize(10)
      .fillColor("#777777")
      .text(
        "Comprovante de venda",
        {
          align: "center"
        }
      );


    doc
      .moveDown();


    doc
      .strokeColor("#d8b3bc")
      .moveTo(35, doc.y)
      .lineTo(385, doc.y)
      .stroke();


    doc
      .moveDown();


    /* INFORMAÇÕES */

    doc
      .fontSize(10)
      .fillColor("#403338")
      .text(
        "Venda #" +
        sale.id
      );


    doc.text(

      new Date(
        sale.date
      ).toLocaleString(
        "pt-BR"
      )

    );


    doc.text(

      "Cliente: " +
      (
        sale.client ||
        "Consumidor"
      )

    );


    if (sale.phone) {

      doc.text(
        "Telefone: " +
        sale.phone
      );

    }


    doc.moveDown();


    /* PRODUTOS */

    items.forEach(
      item => {

        const value =
          Number(item.qty) *
          Number(item.price);


        const name =
          item.name +
          (
            item.size
              ? " - " +
                item.size
              : ""
          );


        doc
          .fontSize(10)
          .fillColor("#403338")
          .text(

            `${item.qty}x ${name}`,

            {
              continued: true
            }

          );


        doc
          .text(

            `R$ ${money(value)
              .replace(".",",")}`,

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
      .moveTo(35, doc.y)
      .lineTo(385, doc.y)
      .stroke();


    doc.moveDown();


    doc
      .fontSize(10)
      .fillColor("#403338")
      .text(

        "Desconto: R$ " +
        money(sale.discount)
          .replace(".",",")

      );


    doc
      .fontSize(15)
      .fillColor("#8f4e5d")
      .text(

        "TOTAL: R$ " +
        money(sale.total)
          .replace(".",",")

      );


    doc
      .fontSize(10)
      .fillColor("#403338")
      .text(

        "Pagamento: " +
        sale.payment +
        (
          sale.installments > 1
            ? " - " +
              sale.installments +
              "x"
            : ""
        )

      );


    doc.moveDown(2);


    doc
      .fontSize(11)
      .fillColor("#8f4e5d")
      .text(

        "Obrigada pela preferência! 🌸",

        {
          align: "center"
        }

      );


    doc
      .fontSize(8)
      .fillColor("#999999")
      .text(

        "Essência & Charme",

        {
          align: "center"
        }

      );


    doc.end();

  }
);

/* =========================
   PÁGINA PRINCIPAL
========================= */

app.use(
  (req, res, next) => {

    if (
      req.method === "GET" &&
      !req.path.startsWith("/api/")
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
   INICIALIZAÇÃO
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
