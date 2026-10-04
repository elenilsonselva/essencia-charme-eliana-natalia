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
const sessions = new Map();

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "troque-esta-senha";

if (!process.env.DATABASE_URL) {
  console.error("ERRO: configure a variável DATABASE_URL com a URL do PostgreSQL.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req,res,next){
  const token=req.cookies.ec_session;
  const s=token && sessions.get(token);
  if(!s || s.expires<Date.now()){
    if(token) sessions.delete(token);
    return res.status(401).json({error:"Não autenticado"});
  }
  next();
}

function createSession(){
  const token=crypto.randomBytes(32).toString("hex");
  sessions.set(token,{expires:Date.now()+SESSION_DAYS*86400000});
  return token;
}

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body||{};
  if(username===ADMIN_USER && password===ADMIN_PASSWORD){
    const token=createSession();
    res.cookie("ec_session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:SESSION_DAYS*86400000});
    return res.json({ok:true});
  }
  res.status(401).json({error:"Usuário ou senha inválidos"});
});
app.post("/api/logout",(req,res)=>{
  if(req.cookies.ec_session) sessions.delete(req.cookies.ec_session);
  res.clearCookie("ec_session");
  res.json({ok:true});
});
app.get("/api/me",(req,res)=>{
  const token=req.cookies.ec_session, s=token&&sessions.get(token);
  res.json({authenticated:!!(s&&s.expires>Date.now()),username:ADMIN_USER});
});

const money = n => Number(n || 0).toFixed(2);
const now = () => new Date().toISOString();

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE,
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
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total NUMERIC(12,2) NOT NULL,
      discount NUMERIC(12,2) DEFAULT 0,
      payment TEXT NOT NULL,
      installments INTEGER DEFAULT 1,
      status TEXT DEFAULT 'paid',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      cost NUMERIC(12,2) DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_moves (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      type TEXT NOT NULL,
      note TEXT DEFAULT '',
      date TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
  `);
}

function photoData(file) {
  if (!file) return null;
  const mime = file.mimetype || "image/jpeg";
  return `data:${mime};base64,${file.buffer.toString("base64")}`;
}

app.get("/api/health", async (req,res) => {
  try { await pool.query("SELECT 1"); res.json({ok:true}); }
  catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

app.get("/api/dashboard", requireAuth, async (req,res) => {
  const today = new Date().toISOString().slice(0,10);
  const d = await pool.query(
    `SELECT COALESCE(SUM(total),0) total, COUNT(*)::int count FROM sales
     WHERE date::date=$1 AND status='paid'`, [today]);
  const m = await pool.query(
    `SELECT COALESCE(SUM(total),0) total FROM sales
     WHERE date::date >= date_trunc('month', CURRENT_DATE) AND status='paid'`);
  const low = await pool.query(`SELECT COUNT(*)::int c FROM products WHERE stock<=min_stock`);
  const debt = await pool.query(
    `SELECT COALESCE(SUM(total),0) v, COUNT(*)::int c FROM sales
     WHERE payment='Fiado' AND status='open'`);
  res.json({today:d.rows[0], month:m.rows[0], low:low.rows[0].c, debt:debt.rows[0]});
});

app.get("/api/products", requireAuth, async (req,res) => {
  const r = await pool.query("SELECT * FROM products ORDER BY name");
  res.json(r.rows);
});

app.post("/api/products", upload.single("photo"), requireAuth, async (req,res) => {
  try {
    const x=req.body;
    const r=await pool.query(
      `INSERT INTO products(code,name,brand,size,cost,price,stock,min_stock,photo)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [x.code||null,x.name,x.brand||"",x.size||"",Number(x.cost)||0,Number(x.price)||0,
       Number(x.stock)||0,Number(x.min_stock)||1,photoData(req.file)]);
    res.json({id:r.rows[0].id});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.put("/api/products/:id", upload.single("photo"), requireAuth, async (req,res) => {
  try {
    const x=req.body;
    const old=await pool.query("SELECT photo FROM products WHERE id=$1",[req.params.id]);
    if(!old.rows.length) return res.status(404).json({error:"Produto não encontrado"});
    await pool.query(
      `UPDATE products SET code=$1,name=$2,brand=$3,size=$4,cost=$5,price=$6,
       stock=$7,min_stock=$8,photo=$9 WHERE id=$10`,
      [x.code||null,x.name,x.brand||"",x.size||"",Number(x.cost)||0,Number(x.price)||0,
       Number(x.stock)||0,Number(x.min_stock)||1,photoData(req.file)||old.rows[0].photo,req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete("/api/products/:id", requireAuth, async (req,res) => {
  try { await pool.query("DELETE FROM products WHERE id=$1",[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:"Não foi possível excluir. Verifique se o produto já foi vendido."}); }
});

app.get("/api/clients", requireAuth, async (req,res) => {
  const r=await pool.query("SELECT * FROM clients ORDER BY name"); res.json(r.rows);
});
app.post("/api/clients", requireAuth, async (req,res) => {
  const x=req.body; const r=await pool.query(
    "INSERT INTO clients(name,phone,address,notes) VALUES($1,$2,$3,$4) RETURNING id",
    [x.name,x.phone||"",x.address||"",x.notes||""]); res.json({id:r.rows[0].id});
});
app.put("/api/clients/:id", requireAuth, async (req,res) => {
  const x=req.body; await pool.query(
    "UPDATE clients SET name=$1,phone=$2,address=$3,notes=$4 WHERE id=$5",
    [x.name,x.phone||"",x.address||"",x.notes||"",req.params.id]); res.json({ok:true});
});
app.delete("/api/clients/:id", requireAuth, async (req,res) => {
  try { await pool.query("DELETE FROM clients WHERE id=$1",[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:"Não foi possível excluir este cliente."}); }
});

app.get("/api/sales", requireAuth, async (req,res) => {
  const r=await pool.query(
    `SELECT s.*,c.name client FROM sales s LEFT JOIN clients c ON c.id=s.client_id
     ORDER BY s.id DESC LIMIT 300`);
  res.json(r.rows);
});

app.post("/api/sales", requireAuth, async (req,res) => {
  const {client_id,items,discount,payment,installments}=req.body;
  if(!Array.isArray(items)||!items.length) return res.status(400).json({error:"Venda sem produtos"});
  if(payment==="Fiado"&&!client_id) return res.status(400).json({error:"Selecione o cliente para venda fiada"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    let subtotal=0;
    const checked=[];
    for(const i of items){
      const p=(await client.query("SELECT * FROM products WHERE id=$1 FOR UPDATE",[i.product_id])).rows[0];
      if(!p) throw Error("Produto não encontrado");
      const qty=Number(i.qty);
      if(!Number.isInteger(qty)||qty<1) throw Error("Quantidade inválida");
      if(p.stock<qty) throw Error("Estoque insuficiente: "+p.name);
      subtotal+=Number(p.price)*qty;
      checked.push({i,p,qty});
    }
    const total=Math.max(0,subtotal-(Number(discount)||0));
    const status=payment==="Fiado"?"open":"paid";
    const sale=(await client.query(
      `INSERT INTO sales(client_id,total,discount,payment,installments,status)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [client_id||null,total,Number(discount)||0,payment,Number(installments)||1,status])).rows[0];
    for(const {p,qty} of checked){
      await client.query(
        `INSERT INTO sale_items(sale_id,product_id,qty,price,cost) VALUES($1,$2,$3,$4,$5)`,
        [sale.id,p.id,qty,p.price,p.cost]);
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2",[qty,p.id]);
      await client.query(
        `INSERT INTO stock_moves(product_id,qty,type,note) VALUES($1,$2,'SAIDA',$3)`,
        [p.id,-qty,"Venda #"+sale.id]);
    }
    await client.query("COMMIT");
    res.json({id:sale.id});
  } catch(e) { await client.query("ROLLBACK"); res.status(400).json({error:e.message}); }
  finally { client.release(); }
});

app.post("/api/stock", requireAuth, async (req,res) => {
  const {product_id,qty,type,note}=req.body; const n=Number(qty)||0;
  if(!Number.isInteger(n)||n<1) return res.status(400).json({error:"Quantidade inválida"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const p=(await client.query("SELECT stock FROM products WHERE id=$1 FOR UPDATE",[product_id])).rows[0];
    if(!p) throw Error("Produto não encontrado");
    if(type==="SAIDA"&&Number(p.stock)<n) throw Error("Estoque insuficiente");
    const delta=type==="ENTRADA"?n:-n;
    await client.query("UPDATE products SET stock=stock+$1 WHERE id=$2",[delta,product_id]);
    await client.query("INSERT INTO stock_moves(product_id,qty,type,note) VALUES($1,$2,$3,$4)",
      [product_id,delta,type,note||"Ajuste"]);
    await client.query("COMMIT"); res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");res.status(400).json({error:e.message});}
  finally{client.release();}
});

app.get("/api/reports", requireAuth, async (req,res) => {
  const from=req.query.from||"1900-01-01";
  const to=(req.query.to||new Date().toISOString().slice(0,10))+" 23:59:59.999";
  const sales=(await pool.query(
    `SELECT s.*,c.name client FROM sales s LEFT JOIN clients c ON c.id=s.client_id
     WHERE s.date BETWEEN $1 AND $2 ORDER BY s.id DESC`,[from,to])).rows;
  const totals=(await pool.query(
    `SELECT COALESCE(SUM(total),0) revenue,
      COALESCE(SUM(CASE WHEN status='paid' THEN
        (SELECT COALESCE(SUM((si.price-si.cost)*si.qty),0) FROM sale_items si WHERE si.sale_id=s.id)
        ELSE 0 END),0) profit
     FROM sales s WHERE s.date BETWEEN $1 AND $2`,[from,to])).rows[0];
  const top=(await pool.query(
    `SELECT p.name,SUM(si.qty)::int qty FROM sale_items si
     JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id
     WHERE s.date BETWEEN $1 AND $2 AND s.status='paid'
     GROUP BY p.id,p.name ORDER BY qty DESC LIMIT 10`,[from,to])).rows;
  const debts=(await pool.query(
    `SELECT s.id,s.date,s.total,c.name,c.phone FROM sales s
     LEFT JOIN clients c ON c.id=s.client_id WHERE s.payment='Fiado' AND s.status='open'
     ORDER BY s.id DESC`)).rows;
  res.json({sales,totals,top,debts});
});

app.post("/api/sales/:id/pay", requireAuth, async (req,res) => {
  const r=await pool.query(
    "UPDATE sales SET status='paid', payment=COALESCE(NULLIF($1,''),payment) WHERE id=$2 AND status='open' RETURNING id",
    [req.body.payment||"Dinheiro",req.params.id]);
  if(!r.rows.length) return res.status(400).json({error:"Venda não encontrada ou já paga"});
  res.json({ok:true});
});

app.get("/api/sales/:id/pdf", requireAuth, async (req,res) => {
  const s=(await pool.query(
    `SELECT s.*,c.name client,c.phone FROM sales s LEFT JOIN clients c ON c.id=s.client_id WHERE s.id=$1`,
    [req.params.id])).rows[0];
  if(!s) return res.status(404).end();
  const items=(await pool.query(
    `SELECT si.*,p.name,p.brand,p.size FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=$1`,
    [s.id])).rows;
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`inline; filename="comprovante-${s.id}.pdf"`);
  const doc=new PDFDocument({size:"A5",margin:35});
  doc.pipe(res);
  doc.fontSize(18).text("Essência & Charme",{align:"center"})
    .fontSize(10).text("Comprovante de venda",{align:"center"}).moveDown();
  doc.text("Venda #"+s.id+"   "+new Date(s.date).toLocaleString("pt-BR"));
  doc.text("Cliente: "+(s.client||"Consumidor")).moveDown();
  items.forEach(i=>doc.text(`${i.qty}x ${i.name}${i.size?" - "+i.size:""}   R$ ${money(Number(i.qty)*Number(i.price)).replace(".",",")}`));
  doc.moveDown().text("Desconto: R$ "+money(s.discount).replace(".",","));
  doc.fontSize(13).text("TOTAL: R$ "+money(s.total).replace(".",","));
  doc.fontSize(10).text("Pagamento: "+s.payment+(s.installments>1?" - "+s.installments+"x":""));
  doc.moveDown().text("Obrigado pela preferência!",{align:"center"});
  doc.end();
});

app.use((req,res,next)=>{
  if(req.method==="GET" && !req.path.startsWith("/api/"))
    return res.sendFile(path.join(__dirname,"public","index.html"));
  next();
});

initDb().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log(`Essência & Charme online na porta ${PORT}`)))
.catch(e=>{console.error(e);process.exit(1);});
