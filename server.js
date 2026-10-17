require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;

const SESSION_DAYS = 7;


/* =========================
   CONFIGURAÇÕES
========================= */

const PIX_KEY =
  process.env.PIX_KEY ||
  "97984031709";

const PIX_NAME =
  process.env.PIX_NAME ||
  "ELIANA NATALIA DIAS LIMA";

const PIX_CITY =
  process.env.PIX_CITY ||
  "VENDA NOVA";


const ADMIN_USER =
  process.env.ADMIN_USER ||
  "admin";


const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "troque-esta-senha";


const sessions = new Map();



/* =========================
   BANCO
========================= */


if (!process.env.DATABASE_URL) {

  console.error(
    "DATABASE_URL não configurada"
  );

  process.exit(1);

}


const pool = new Pool({

  connectionString:
    process.env.DATABASE_URL,

  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized:false
        }
      : undefined

});



/* =========================
   UPLOAD
========================= */


const upload =
multer({

  storage:
    multer.memoryStorage(),

  limits:{
    fileSize:
      4 * 1024 * 1024
  }

});



/* =========================
   MIDDLEWARE
========================= */


app.use(
express.json({
limit:"6mb"
})
);


app.use(
express.urlencoded({
extended:true
})
);


app.use(cookieParser());


app.use(
express.static(
path.join(
__dirname,
"public"
)
)
);



/* =========================
   AUTENTICAÇÃO
========================= */


function requireAuth(req,res,next){


const token =
req.cookies.ec_session;


const session =
token &&
sessions.get(token);



if(
!session ||
session.expires < Date.now()
){


if(token)
sessions.delete(token);



return res
.status(401)
.json({

error:
"Não autenticado"

});


}


next();


}



function createSession(){


const token =
crypto
.randomBytes(32)
.toString("hex");



sessions.set(

token,

{

expires:
Date.now()
+
SESSION_DAYS *
86400000

}

);



return token;


}



/* =========================
   UTILITÁRIOS
========================= */


const money = value => Number(value || 0).toFixed(2);

function pixField(id, value) {
  const text = String(value ?? '');
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}
function crc16CCITT(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    crc &= 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function buildPixPayload({ key, name, city, amount, txid = '***' }) {
  const clean = (value, max) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 $%*+\-./:]/g, '').toUpperCase().slice(0, max);
  const merchant = pixField('00', 'BR.GOV.BCB.PIX') + pixField('01', String(key).trim());
  let payload = pixField('00', '01') + pixField('26', merchant) + pixField('52', '0000') + pixField('53', '986');
  if (Number(amount) > 0) payload += pixField('54', Number(amount).toFixed(2));
  payload += pixField('58', 'BR') + pixField('59', clean(name, 25) || 'FORNECEDOR') + pixField('60', clean(city, 15) || 'BRASIL');
  payload += pixField('62', pixField('05', clean(txid, 25) || '***')) + '6304';
  return payload + crc16CCITT(payload);
}



function photoData(file){


if(!file)
return null;



return (

`data:${file.mimetype};base64,`
+
file.buffer.toString("base64")

);


}



function gerarParcelas(
total,
quantidade,
primeiroVencimento
){


const permitidas =
[
1,
2,
3,
12
];


if(
!permitidas.includes(
Number(quantidade)
)
){

throw new Error(
"Parcelamento permitido: 1x, 2x, 3x ou 12x"
);

}



const parcelas=[];


const valorBase =
Math.floor(
(
Number(total) /
Number(quantidade)
)
*
100
)
/100;



for(
let i=1;
i<=Number(quantidade);
i++
){


const data =
new Date(
primeiroVencimento
);



data.setMonth(
data.getMonth()
+
i-1
);



let valor =
valorBase;



if(
i === Number(quantidade)
){

valor =
Number(total)
-
(
valorBase *
(
Number(quantidade)-1
)
);

}



parcelas.push({

numero:i,

valor:
Number(
valor.toFixed(2)
),

vencimento:
data
.toISOString()
.slice(0,10)

});


}



return parcelas;


}



/* =========================
   BANCO - TABELAS
========================= */


async function initDb(){

// Cria as tabelas-base antes das tabelas dependentes. IF NOT EXISTS preserva os dados existentes.
await pool.query(`
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  size TEXT DEFAULT '',
  cost NUMERIC(12,2) DEFAULT 0,
  price NUMERIC(12,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 1,
  photo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  total NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  payment TEXT DEFAULT 'Dinheiro',
  installments INTEGER DEFAULT 1,
  status TEXT DEFAULT 'paid',
  date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2) DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  qty INTEGER DEFAULT 0,
  type TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment TEXT DEFAULT 'Dinheiro';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS installments INTEGER DEFAULT 1;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE products ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS size TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  supplier_pix_key TEXT DEFAULT '',
  supplier_pix_name TEXT DEFAULT '',
  supplier_pix_city TEXT DEFAULT '',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);
`);

await pool.query(`

CREATE TABLE IF NOT EXISTS sale_installments (

id SERIAL PRIMARY KEY,

sale_id INTEGER
REFERENCES sales(id)
ON DELETE CASCADE,

installment_no INTEGER NOT NULL DEFAULT 1,

number INTEGER DEFAULT 1,

total_installments INTEGER DEFAULT 1,

amount NUMERIC(12,2) DEFAULT 0,

due_date DATE DEFAULT CURRENT_DATE,

paid BOOLEAN DEFAULT FALSE,

paid_at TIMESTAMPTZ,

payment_method TEXT DEFAULT '',

created_at TIMESTAMPTZ DEFAULT NOW()

);


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS installment_no INTEGER DEFAULT 1;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS number INTEGER DEFAULT 1;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS total_installments INTEGER DEFAULT 1;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) DEFAULT 0;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS due_date DATE DEFAULT CURRENT_DATE;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT FALSE;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;


ALTER TABLE sale_installments
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT '';

`);

}
/* =========================
   LOGIN
========================= */


app.post(
"/api/login",
(req,res)=>{


const {

username,

password

}=req.body || {};



if(

username === ADMIN_USER

&&

password === ADMIN_PASSWORD

){

const token =
createSession();



res.cookie(

"ec_session",

token,

{

httpOnly:true,

secure:
process.env.NODE_ENV ===
"production",

sameSite:"lax",

maxAge:
SESSION_DAYS *
86400000

}

);



return res.json({

ok:true

});


}



res.status(401)
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
(req,res)=>{


const token =
req.cookies.ec_session;



if(token){

sessions.delete(token);

}



res.clearCookie(
"ec_session"
);



res.json({

ok:true

});


}

);





/* =========================
   ME
========================= */


app.get(
"/api/me",
(req,res)=>{


const token =
req.cookies.ec_session;



const session =
token &&
sessions.get(token);



const authenticated =
Boolean(

session
&&
session.expires > Date.now()

);



res.json({

authenticated,

username:
authenticated
?
ADMIN_USER
:
null

});


}

);





/* =========================
   HEALTH
========================= */


app.get(
"/api/health",
async(req,res)=>{


try{


await pool.query(
"SELECT 1"
);



res.json({

ok:true,

app:
"Essência & Charme"

});



}catch(error){


res.status(500)
.json({

ok:false,

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
async(req,res)=>{


try{


const hoje =
new Date()
.toISOString()
.slice(0,10);



const vendasHoje =
await pool.query(

`

SELECT

COALESCE(
SUM(total),
0
) total,

COUNT(*)::int quantidade


FROM sales


WHERE

date::date=$1

AND status='paid'

`

,

[hoje]

);




const estoque =
await pool.query(

`

SELECT

COUNT(*)::int quantidade


FROM products


WHERE stock <= min_stock

`

);




const parcelas =
await pool.query(

`

SELECT

COALESCE(
SUM(amount),
0
) total


FROM sale_installments


WHERE paid=false

`

);



res.json({

today:
vendasHoje.rows[0],

low:
estoque.rows[0].quantidade,

installments:
parcelas.rows[0]

});



}catch(error){


res.status(500)
.json({

error:
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
async(req,res)=>{


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
async(req,res)=>{


try{


const data =
req.body;



const result =
await pool.query(

`

INSERT INTO products

(

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


VALUES

($1,$2,$3,$4,$5,$6,$7,$8,$9)


RETURNING id

`

,

[


data.code || null,

data.name,

data.brand || "",

data.size || "",

Number(data.cost)||0,

Number(data.price)||0,

Number(data.stock)||0,

Number(data.min_stock)||1,

photoData(req.file)


]

);



res.json({

id:
result.rows[0].id

});



}catch(error){


res.status(400)
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
async(req,res)=>{


try{


const data =
req.body;



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

photo=
COALESCE($9,photo)


WHERE id=$10

`

,

[


data.code || null,

data.name,

data.brand || "",

data.size || "",

Number(data.cost)||0,

Number(data.price)||0,

Number(data.stock)||0,

Number(data.min_stock)||1,

photoData(req.file),

req.params.id


]

);



res.json({

ok:true

});



}catch(error){


res.status(400)
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
async(req,res)=>{


await pool.query(

`

DELETE FROM products

WHERE id=$1

`

,

[
req.params.id
]

);



res.json({

ok:true

});


}

);
/* =========================
   CLIENTES
========================= */


app.get(
"/api/clients",
requireAuth,
async(req,res)=>{


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
async(req,res)=>{


const data =
req.body;



const result =
await pool.query(

`

INSERT INTO clients

(

name,

phone,

address,

notes

)


VALUES

($1,$2,$3,$4)


RETURNING id

`

,

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
async(req,res)=>{


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

`

,

[

data.name,

data.phone || "",

data.address || "",

data.notes || "",

req.params.id

]

);



res.json({

ok:true

});


}

);





app.delete(
"/api/clients/:id",
requireAuth,
async(req,res)=>{


await pool.query(

`

DELETE FROM clients

WHERE id=$1

`

,

[
req.params.id
]

);



res.json({

ok:true

});


}

);







/* =========================
   VENDAS
========================= */


app.get(
"/api/sales",
requireAuth,
async(req,res)=>{


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
async(req,res)=>{


const {

client_id,

items,

discount,

payment,

installments,

first_due_date

}=req.body;



if(
!Array.isArray(items)
||
!items.length
){

return res.status(400)
.json({

error:
"Venda sem produtos"

});

}



const parcelasQtd =
Number(installments)
||
1;



if(
![1,2,3,12]
.includes(parcelasQtd)
){

return res.status(400)
.json({

error:
"Parcelas permitidas: 1x, 2x, 3x ou 12x"

});

}





const connection =
await pool.connect();



try{


await connection.query(
"BEGIN"
);



let subtotal=0;


const produtos=[];



for(
const item of items
){


const produto =
(
  await connection.query(
    `
    SELECT *
    FROM products
    WHERE id=$1
    FOR UPDATE
    `,
    [
      item.product_id
    ]
  )
).rows[0];



if(!produto){

throw new Error(
"Produto não encontrado"
);

}



const quantidade =
Number(item.qty);



if(
quantidade < 1
){

throw new Error(
"Quantidade inválida"
);

}



if(
Number(produto.stock)
<
quantidade
){

throw new Error(

"Estoque insuficiente: "
+
produto.name

);

}




subtotal +=
Number(produto.price)
*
quantidade;



produtos.push({

produto,

quantidade

});


}





const total =
Math.max(

0,

subtotal -
(
Number(discount)||0
)

);






const status =
payment === "Fiado"

?
"open"

:
"paid";






const venda =
(
await connection.query(

`

INSERT INTO sales

(

client_id,

total,

discount,

payment,

installments,

status

)


VALUES

($1,$2,$3,$4,$5,$6)


RETURNING id

`

,

[

client_id || null,

total,

Number(discount)||0,

payment || "Dinheiro",

parcelasQtd,

status

]

)

)

.rows[0];







// Detecta a coluna de quantidade existente no banco. Algumas versões antigas
// usam "quantity" em vez de "qty"; preservamos os dados existentes.
const saleItemColumnsResult = await connection.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'sale_items'
`);
const saleItemColumns = new Set(saleItemColumnsResult.rows.map(row => row.column_name));
const saleItemQtyColumn = saleItemColumns.has("qty") ? "qty" :
  (saleItemColumns.has("quantity") ? "quantity" : null);
if (!saleItemQtyColumn) {
  throw new Error('A tabela sale_items não possui a coluna qty nem quantity.');
}

for (const item of produtos) {
  await connection.query(`
    INSERT INTO sale_items
      (sale_id, product_id, ${saleItemQtyColumn}, price, cost)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    venda.id,
    item.produto.id,
    item.quantidade,
    item.produto.price,
    item.produto.cost
  ]);

  await connection.query(`
    UPDATE products
    SET stock = stock - $1
    WHERE id = $2
  `, [item.quantidade, item.produto.id]);
}






if(
parcelasQtd > 1
){


const parcelas =
gerarParcelas(

total,

parcelasQtd,

first_due_date ||
new Date()

);




for(
const parcela of parcelas
){


await connection.query(

`

INSERT INTO sale_installments

(

sale_id,

installment_no,

number,

total_installments,

amount,

due_date

)


VALUES

($1,$2,$3,$4,$5,$6)

`

,

[

venda.id,

parcela.numero,

parcela.numero,

parcelasQtd,

parcela.valor,

parcela.vencimento

]

);


}



}






await connection.query(
"COMMIT"
);



res.json({

id:
venda.id

});




}catch(error){


await connection.query(
"ROLLBACK"
);



res.status(400)
.json({

error:
error.message

});



}finally{


connection.release();


}



}

);







// Exclui uma venda em transação e devolve ao estoque todos os itens vendidos.
app.delete("/api/sales/:id", requireAuth, async (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isInteger(saleId) || saleId < 1) {
    return res.status(400).json({ error: "Número de venda inválido" });
  }

  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");

    // Bloqueia a venda para evitar duas exclusões simultâneas.
    const saleResult = await connection.query(
      "SELECT id FROM sales WHERE id = $1 FOR UPDATE",
      [saleId]
    );
    if (!saleResult.rowCount) {
      await connection.query("ROLLBACK");
      return res.status(404).json({ error: "Venda não encontrada" });
    }

    // Detecta os nomes reais das colunas para funcionar também com bancos
    // antigos que usam "quantity" em vez de "qty".
    const saleItemColumnsResult = await connection.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'sale_items'
    `);
    const saleItemColumns = new Set(saleItemColumnsResult.rows.map(row => row.column_name));
    const qtyColumn = saleItemColumns.has("qty") ? "qty" :
      (saleItemColumns.has("quantity") ? "quantity" : null);
    if (!qtyColumn) {
      throw new Error('A tabela sale_items não possui a coluna qty nem quantity.');
    }

    // O nome da coluna vem exclusivamente da lista permitida acima.
    const itemsResult = await connection.query(`
      SELECT product_id, SUM(COALESCE(${qtyColumn}, 0))::integer AS qty
      FROM sale_items
      WHERE sale_id = $1 AND product_id IS NOT NULL
      GROUP BY product_id
    `, [saleId]);

    const stockMoveColumnsResult = await connection.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'stock_moves'
    `);
    const stockMoveColumns = new Set(stockMoveColumnsResult.rows.map(row => row.column_name));
    const movementQtyColumn = stockMoveColumns.has("qty") ? "qty" :
      (stockMoveColumns.has("quantity") ? "quantity" : null);

    for (const item of itemsResult.rows) {
      const qty = Number(item.qty) || 0;
      if (qty <= 0) continue;

      const productResult = await connection.query(
        "UPDATE products SET stock = COALESCE(stock, 0) + $1 WHERE id = $2 RETURNING id",
        [qty, item.product_id]
      );

      // Registra a devolução usando o nome de coluna existente no banco.
      if (productResult.rowCount && movementQtyColumn && stockMoveColumns.has("product_id") && stockMoveColumns.has("type") && stockMoveColumns.has("note")) {
        await connection.query(`
          INSERT INTO stock_moves (product_id, ${movementQtyColumn}, type, note)
          VALUES ($1, $2, $3, $4)
        `, [item.product_id, qty, "ENTRADA", `Restituição por exclusão da venda #${saleId}`]);
      }
    }

    // Remoção explícita dos registros dependentes: bancos antigos podem ter
    // sido criados sem ON DELETE CASCADE nas chaves estrangeiras.
    await connection.query("DELETE FROM sale_installments WHERE sale_id = $1", [saleId]);
    await connection.query("DELETE FROM sale_items WHERE sale_id = $1", [saleId]);
    await connection.query("DELETE FROM sales WHERE id = $1", [saleId]);
    await connection.query("COMMIT");
    return res.json({ ok: true, message: "Venda excluída e estoque restituído" });
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    console.error("Erro ao excluir venda:", error);
    // Mostra a mensagem real do PostgreSQL para facilitar o diagnóstico,
    // mantendo a transação desfeita caso qualquer etapa falhe.
    return res.status(500).json({ error: `Não foi possível excluir a venda e restituir o estoque. Nenhuma alteração foi confirmada. Detalhe: ${error.message}` });
  } finally {
    connection.release();
  }
});

// Detalhes de uma venda, incluindo os itens vendidos.
app.get("/api/sales/:id/details", requireAuth, async (req, res) => {
  try {
    const saleResult = await pool.query(`
      SELECT s.*, c.name AS client FROM sales s
      LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = $1
    `, [req.params.id]);
    if (!saleResult.rows.length) return res.status(404).json({ error: "Venda não encontrada" });
    const colResult = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sale_items'`);
    const cols = new Set(colResult.rows.map(r => r.column_name));
    const qtyColumn = cols.has('qty') ? 'qty' : (cols.has('quantity') ? 'quantity' : null);
    if (!qtyColumn) throw new Error('A tabela sale_items não possui coluna de quantidade reconhecida.');
    const items = await pool.query(`
      SELECT si.*, COALESCE(p.name, 'Produto #' || COALESCE(si.product_id::text, si.id::text)) AS name,
             COALESCE(p.size, '') AS size, si.${qtyColumn} AS display_qty,
             COALESCE(si.price, 0) AS display_price
      FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1 ORDER BY si.id
    `, [req.params.id]);
    res.json({ sale: saleResult.rows[0], items: items.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

/* =========================
   PARCELAS
========================= */


app.get(
"/api/installments",
requireAuth,
async(req,res)=>{


const result =
await pool.query(

`

SELECT

si.*,
COALESCE(si.number, si.installment_no, 1) AS display_installment_no,
s.total,

c.name client


FROM sale_installments si


JOIN sales s

ON s.id=si.sale_id


LEFT JOIN clients c

ON c.id=s.client_id


WHERE ($1::integer IS NULL OR si.sale_id = $1)
ORDER BY si.due_date


`, [req.query.sale_id ? Number(req.query.sale_id) : null]);



res.json(
result.rows
);


}

);





app.post(
"/api/installments/:id/pay",
requireAuth,
async(req,res)=>{


await pool.query(

`

UPDATE sale_installments

SET

paid=true,

paid_at=NOW(),

payment_method=$1


WHERE id=$2

`

,

[

req.body.payment ||
"Dinheiro",

req.params.id

]

);



res.json({

ok:true

});


}

);
/* =========================
   ESTOQUE
========================= */


app.post(
"/api/stock",
requireAuth,
async(req,res)=>{


const {

product_id,

qty,

type,

note

}=req.body;



const quantidade =
Number(qty);



if(
!Number.isInteger(quantidade)
||
quantidade < 1
){

return res.status(400)
.json({

error:
"Quantidade inválida"

});

}



const delta =
type === "ENTRADA"
?
quantidade
:
-quantidade;



await pool.query(

`

UPDATE products

SET stock =
stock+$1

WHERE id=$2

`

,

[

delta,

product_id

]

);



await pool.query(

`

INSERT INTO stock_moves

(

product_id,

qty,

type,

note

)

VALUES

($1,$2,$3,$4)

`

,

[

product_id,

delta,

type,

note || "Ajuste"

]

);



res.json({

ok:true

});


}

);







/* =========================
   RELATÓRIOS
========================= */


app.get(
"/api/reports",
requireAuth,
async(req,res)=>{


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


`

);



res.json({

sales:
result.rows

});


}

);







/* =========================
   COMPRAS E PDF COM PIX DO FORNECEDOR
========================= */
app.get('/api/purchases', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM purchases ORDER BY id DESC LIMIT 300');
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/purchases', requireAuth, async (req, res) => {
  const { supplier_name, supplier_pix_key, supplier_pix_name, supplier_pix_city, items } = req.body || {};
  if (!String(supplier_name || '').trim()) return res.status(400).json({ error: 'Informe o nome do fornecedor.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Adicione pelo menos um item à compra.' });
  const cleanItems = items.map(i => ({
    product_name: String(i.product_name || '').trim(),
    qty: Number(i.qty), unit_price: Number(i.unit_price)
  }));
  if (cleanItems.some(i => !i.product_name || !Number.isFinite(i.qty) || i.qty <= 0 || !Number.isFinite(i.unit_price) || i.unit_price < 0))
    return res.status(400).json({ error: 'Confira nome, quantidade e preço de cada produto.' });
  const total = cleanItems.reduce((sum, i) => sum + i.qty * i.unit_price, 0);
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const purchase = (await cx.query(`INSERT INTO purchases (supplier_name, supplier_pix_key, supplier_pix_name, supplier_pix_city, total) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [String(supplier_name).trim(), String(supplier_pix_key || '').trim(), String(supplier_pix_name || '').trim(), String(supplier_pix_city || '').trim(), total])).rows[0];
    for (const item of cleanItems) await cx.query(`INSERT INTO purchase_items (purchase_id, product_name, qty, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)`, [purchase.id, item.product_name, item.qty, item.unit_price, item.qty * item.unit_price]);
    await cx.query('COMMIT');
    res.json({ id: purchase.id, total: purchase.total });
  } catch (error) { await cx.query('ROLLBACK').catch(()=>{}); res.status(500).json({ error: error.message }); }
  finally { cx.release(); }
});

app.get('/api/purchases/:id/pdf', requireAuth, async (req, res) => {
  try {
    const purchase = (await pool.query('SELECT * FROM purchases WHERE id=$1', [req.params.id])).rows[0];
    if (!purchase) return res.status(404).json({ error: 'Compra não encontrada.' });
    const items = (await pool.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [purchase.id])).rows;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="compra-${purchase.id}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    doc.pipe(res);
    doc.fillColor('#8f4e5d').fontSize(20).text('Essência & Charme', { align: 'center' });
    doc.fillColor('#333').fontSize(13).text(`Pedido de compra #${purchase.id}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Fornecedor: ${purchase.supplier_name}`);
    doc.text(`Data: ${new Date(purchase.created_at).toLocaleDateString('pt-BR')}`);
    doc.moveDown();
    doc.fontSize(10).text('PRODUTO                                      QTD.        UNITÁRIO          TOTAL');
    doc.moveDown(0.5);
    for (const item of items) {
      doc.text(`${item.product_name}  |  ${item.qty}  |  R$ ${money(item.unit_price).replace('.', ',')}  |  R$ ${money(item.line_total).replace('.', ',')}`);
    }
    doc.moveDown();
    doc.fontSize(15).fillColor('#8f4e5d').text(`TOTAL: R$ ${money(purchase.total).replace('.', ',')}`);
    doc.moveDown();
    if (purchase.supplier_pix_key) {
      doc.fillColor('#333').fontSize(12).text('DADOS PARA PAGAMENTO PIX');
      if (purchase.supplier_pix_name) doc.fontSize(10).text(`Beneficiário: ${purchase.supplier_pix_name}`);
      if (purchase.supplier_pix_city) doc.fontSize(10).text(`Cidade: ${purchase.supplier_pix_city}`);
      doc.fontSize(10).text(`Chave PIX: ${purchase.supplier_pix_key}`);
      doc.moveDown(0.5);
      const pixPayload = buildPixPayload({ key: purchase.supplier_pix_key, name: purchase.supplier_pix_name || purchase.supplier_name, city: purchase.supplier_pix_city || 'BRASIL', amount: purchase.total, txid: `COMPRA${purchase.id}` });
      const pixQrData = await QRCode.toDataURL(pixPayload, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
      const pixQrBuffer = Buffer.from(pixQrData.split(',')[1], 'base64');
      doc.image(pixQrBuffer, { fit: [145, 145], align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#555').text('Leia o QR Code no aplicativo do seu banco e confira os dados do beneficiário e o valor antes de confirmar o pagamento.', { align: 'center' });
    } else {
      doc.fontSize(10).text('Dados PIX do fornecedor não informados. Solicite a chave PIX ao fornecedor antes de efetuar o pagamento.');
    }
    doc.end();
  } catch (error) { console.error('Erro ao gerar PDF de compra:', error); if (!res.headersSent) res.status(500).json({ error: error.message }); }
});

/* =========================
   PDF VENDA + PIX
========================= */


app.get(
"/api/sales/:id/pdf",
requireAuth,
async(req,res)=>{


const venda =
(
  await pool.query(

  `

  SELECT

  s.*,

  c.name client


  FROM sales s


  LEFT JOIN clients c

  ON c.id=s.client_id


  WHERE s.id=$1


  `,

  [
    req.params.id
  ]

  )
).rows[0];



if(!venda){

return res.status(404)
.end();

}



const saleItemColumnsResult = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sale_items'`);
const saleItemColumnNames = new Set(saleItemColumnsResult.rows.map(r => r.column_name));
const pdfQtyColumn = saleItemColumnNames.has('qty') ? 'qty' : (saleItemColumnNames.has('quantity') ? 'quantity' : null);
if (!pdfQtyColumn) return res.status(500).json({ error: 'A tabela sale_items não possui coluna de quantidade reconhecida.' });
const itens = (await pool.query(`
  SELECT si.*, COALESCE(p.name, 'Produto #' || COALESCE(si.product_id::text, si.id::text)) AS name,
         COALESCE(p.size, '') AS size, si.${pdfQtyColumn} AS display_qty,
         COALESCE(si.price, 0) AS display_price
  FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
  WHERE si.sale_id = $1 ORDER BY si.id
`, [venda.id])).rows;




const parcelas =
(
  await pool.query(

  `

  SELECT *

  FROM sale_installments

  WHERE sale_id=$1

  ORDER BY number

  `,

  [
    venda.id
  ]

  )
).rows;





res.setHeader(
"Content-Type",
"application/pdf"
);



const doc =
new PDFDocument({

size:"A5",

margin:35

});



doc.pipe(res);



doc.fontSize(18)
.fillColor("#8f4e5d")
.text(
"Essência & Charme",
{
align:"center"
}
);



doc.fontSize(10)
.fillColor("#555")
.text(
"Comprovante de venda",
{
align:"center"
}
);



doc.moveDown();



doc.text(
"Venda #"
+
venda.id
);



doc.text(

"Cliente: "
+
(
venda.client ||
"Consumidor"
)

);



doc.moveDown();



itens.forEach(item=>{


const quantidade = Number(item.display_qty ?? item.qty ?? item.quantity ?? item.quantidade ?? 0);


const valor =
quantidade *
Number(item.display_price ?? item.price ?? 0);



doc.text(

`${quantidade}x ${item.name || `Produto #${item.product_id || item.id}`}${item.size ? " - "+item.size : ""}`

);



doc.text(

"R$ "
+
money(valor)
.replace(".",",")

);


});



doc.moveDown();



doc.fontSize(14)
.fillColor("#8f4e5d")
.text(

"TOTAL: R$ "
+
money(venda.total)
.replace(".",",")

);





doc.fontSize(10)
.fillColor("#333")
.text(

"Pagamento: "
+
(
venda.payment ||
"Não informado"
)

);






if(parcelas.length){


doc.moveDown();

doc.text(
"Parcelas:"
);



parcelas.forEach(p=>{


doc.text(

`${p.number}/${p.total_installments} - R$ ${money(p.amount).replace(".",",")} - ${new Date(p.due_date).toLocaleDateString("pt-BR")}`

);


});


}







/* GERAR PIX */


const pixPayload =

`00020126580014BR.GOV.BCB.PIX0136${PIX_KEY}520400005303986540${money(venda.total)}5802BR5918${PIX_NAME}6009${PIX_CITY}6304`;



const qr =
await QRCode.toDataURL(
pixPayload
);



const imagem =
Buffer.from(

qr.replace(
"data:image/png;base64,",
""
),

"base64"

);



doc.moveDown();



doc.fontSize(11)
.fillColor("#8f4e5d")
.text(
"PIX",
{
align:"center"
}
);



doc.image(
imagem,
{

fit:[120,120],

align:"center"

}

);



doc.fontSize(8)
.fillColor("#555")
.text(

"Chave PIX: "
+
PIX_KEY,

{

align:"center"

}

);



doc.moveDown();



doc.fontSize(10)
.fillColor("#8f4e5d")
.text(

"Obrigada pela preferência!",

{

align:"center"

}

);



doc.end();



}

);






/* =========================
   PÁGINA
========================= */


app.use(
(req,res,next)=>{


if(

req.method==="GET"

&&

!req.path.startsWith("/api/")

){


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
   START
========================= */


initDb()

.then(()=>{


app.listen(

PORT,

"0.0.0.0",

()=>{


console.log(

`🌸 Essência & Charme online na porta ${PORT}`

);


}

);


})

.catch(error=>{


console.error(

"Erro ao iniciar:",

error

);



process.exit(1);


});
