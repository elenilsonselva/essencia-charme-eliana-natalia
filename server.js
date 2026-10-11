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


const money =
value =>
Number(value || 0)
.toFixed(2);



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


await pool.query(`


CREATE TABLE IF NOT EXISTS sale_installments (

id SERIAL PRIMARY KEY,

sale_id INTEGER
REFERENCES sales(id)
ON DELETE CASCADE,


number INTEGER NOT NULL,


total_installments INTEGER NOT NULL,


amount NUMERIC(12,2) NOT NULL,


due_date DATE NOT NULL,


paid BOOLEAN DEFAULT FALSE,


paid_at TIMESTAMPTZ,


payment_method TEXT DEFAULT '',


created_at TIMESTAMPTZ DEFAULT NOW()

);


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







for(
const item of produtos
){


await connection.query(

`

INSERT INTO sale_items

(

sale_id,

product_id,

qty,

price,

cost

)


VALUES

($1,$2,$3,$4,$5)

`

,

[

venda.id,

item.produto.id,

item.quantidade,

item.produto.price,

item.produto.cost

]

);





await connection.query(

`

UPDATE products

SET stock =
stock-$1

WHERE id=$2

`

,

[

item.quantidade,

item.produto.id

]

);


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

number,

total_installments,

amount,

due_date

)


VALUES

($1,$2,$3,$4,$5)

`

,

[

venda.id,

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

s.total,

c.name client


FROM sale_installments si


JOIN sales s

ON s.id=si.sale_id


LEFT JOIN clients c

ON c.id=s.client_id


ORDER BY si.due_date


`

);



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



const itens =
(
await pool.query(

`

SELECT

si.*,

p.name,

p.size


FROM sale_items si


JOIN products p

ON p.id=si.product_id


WHERE si.sale_id=$1


`

,

[
venda.id
]

)

.rows;




const parcelas =
(
await pool.query(

`

SELECT *

FROM sale_installments

WHERE sale_id=$1

ORDER BY number


`

,

[
venda.id
]

)

.rows;





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


const valor =
Number(item.qty)
*
Number(item.price);



doc.text(

`${item.qty}x ${item.name}${item.size ? " - "+item.size : ""}`

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
