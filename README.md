# Essência & Charme — Versão 3 ONLINE

Sistema web de vendas com login, PostgreSQL e interface responsiva para iPhone.

## Recursos
- Login protegido por sessão
- Usuário administrador
- Dashboard
- Produtos, marcas, tamanhos, custos, preços, estoque e fotos
- Clientes
- Vendas com desconto
- Dinheiro, PIX, débito, crédito e fiado
- Parcelamento informado na venda
- Baixa automática do estoque
- Entradas de estoque
- Relatórios e lucro estimado
- Controle de vendas fiadas e recebimento
- Comprovante PDF
- PostgreSQL online
- Interface adaptável a celular

## Deploy no Render + Neon

### 1. Banco no Neon
Crie um projeto em https://neon.tech/ e copie a connection string PostgreSQL.

### 2. Código no GitHub
Envie todos os arquivos mantendo:
public/index.html
server.js
package.json
README.md
.gitignore

### 3. Web Service no Render
- Build Command: `npm install`
- Start Command: `npm start`
- Node 20+
- Environment:
  - `DATABASE_URL` = connection string do Neon
  - `NODE_ENV` = `production`
  - `ADMIN_USER` = seu usuário
  - `ADMIN_PASSWORD` = uma senha forte

NUNCA coloque DATABASE_URL ou ADMIN_PASSWORD dentro do código ou no GitHub.

### Segurança
A sessão usa cookie HTTP-only e expira em 7 dias. As sessões são armazenadas em memória; após reinício/deploy do serviço, será necessário entrar novamente. Para uma operação maior, recomenda-se armazenar sessões no PostgreSQL/Redis.

O banco cria as tabelas automaticamente no primeiro start.

## iPhone
Abra a URL HTTPS fornecida pelo Render no Safari. Depois:
Compartilhar → Adicionar à Tela de Início.

## Importante
Faça backup do PostgreSQL periodicamente. Fotos são armazenadas no banco como base64 nesta versão, o que é adequado para uma pequena quantidade de imagens; para muitas fotos, prefira armazenamento de objetos (S3/Cloudinary etc.).
