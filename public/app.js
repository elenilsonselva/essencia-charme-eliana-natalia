/* =========================================================
   ESSÊNCIA & CHARME
   APP.JS
   ========================================================= */

"use strict";

/* =========================================================
   ESTADO
========================================================= */

let currentUser = "";
let products = [];
let clients = [];
let suppliers = [];
let sales = [];
let purchases = [];
let stockMoves = [];

let saleCart = [];
let currentSaleId = null;
let currentPurchaseId = null;

/* =========================================================
   HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

function money(value) {
  const n = Number(value || 0);

  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function number(value) {
  return Number(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("pt-BR");
}

function today() {
  const d = new Date();

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${d.getFullYear()}-${month}-${day}`;
}

function showAlert(message, type = "success") {
  const container = $("alertContainer");

  if (!container) {
    alert(message);
    return;
  }

  const div = document.createElement("div");

  div.className = `alert alert-${type}`;
  div.textContent = message;

  container.innerHTML = "";
  container.appendChild(div);

  setTimeout(() => {
    if (div.parentNode) {
      div.remove();
    }
  }, 4000);
}

function openModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.add("open");
  }
}

function closeModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.remove("open");
  }
}

function closeAllModals() {
  qsa(".modal").forEach(modal => {
    modal.classList.remove("open");
  });
}

async function api(url, options = {}) {
  const config = {
    credentials: "same-origin",
    ...options
  };

  config.headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };

  const response = await fetch(url, config);

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Erro HTTP ${response.status}`
    );
  }

  return data;
}

/* =========================================================
   LOGIN
========================================================= */

function setLoginError(message = "") {
  const errorBox = $("loginError");

  if (!errorBox) {
    if (message) {
      console.error("LOGIN:", message);
    }

    return;
  }

  errorBox.textContent = message;
  errorBox.style.display = message ? "block" : "none";
}

async function checkLogin() {
  try {

    const response = await fetch("/api/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });

    const data =
      await response.json().catch(() => ({}));

    if (
      response.ok &&
      data.authenticated
    ) {

      currentUser =
        data.username || "";

      if ($("loggedUser")) {
        $("loggedUser").textContent =
          currentUser
            ? `Olá, ${currentUser}`
            : "";
      }

      showApp();

      return true;
    }

  } catch (error) {

    console.error(
      "Erro ao verificar sessão:",
      error
    );

  }

  showLogin();

  return false;
}

function showLogin() {

  if ($("loginScreen")) {
    $("loginScreen").style.display = "flex";
  }

  if ($("app")) {
    $("app").style.display = "none";
  }
}

function showApp() {

  if ($("loginScreen")) {
    $("loginScreen").style.display = "none";
  }

  if ($("app")) {
    $("app").style.display = "block";

    $("app").classList.remove("hidden");
  }
}

async function login(event) {

  if (event) {
    event.preventDefault();
  }

  setLoginError("");

  const username =
    $("loginUsername")?.value?.trim() || "";

  const password =
    $("loginPassword")?.value || "";

  if (!username || !password) {
    setLoginError(
      "Informe usuário e senha."
    );

    return false;
  }

  const button =
    qs('#loginForm button[type="submit"]');

  const originalText =
    button?.textContent || "Entrar";

  if (button) {
    button.disabled = true;
    button.textContent = "Entrando...";
  }

  try {

    const response = await fetch(
      "/api/login",
      {
        method: "POST",

        credentials: "same-origin",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          username,
          password
        })
      }
    );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.message ||
        `Erro HTTP ${response.status}`
      );
    }

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Não foi possível realizar o login."
      );
    }

    currentUser =
      data.username ||
      username;

    /*
     * Confirma que a sessão realmente foi
     * criada e que o navegador recebeu o cookie.
     */
    const sessionResponse =
      await fetch(
        "/api/me",
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        }
      );

    const sessionData =
      await sessionResponse
        .json()
        .catch(() => ({}));

    if (
      !sessionResponse.ok ||
      !sessionData.authenticated
    ) {
      throw new Error(
        "O servidor aceitou o login, mas a sessão não foi criada."
      );
    }

    currentUser =
      sessionData.username ||
      currentUser;

    if ($("loggedUser")) {
      $("loggedUser").textContent =
        `Olá, ${currentUser}`;
    }

    showApp();

    await loadAll();

    showPage("dashboard");

    setLoginError("");

    return true;

  } catch (error) {

    console.error(
      "Erro no login:",
      error
    );

    setLoginError(
      error.message ||
      "Usuário ou senha inválidos."
    );

    showLogin();

    return false;

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }

  }
}

async function logout() {

  try {

    await fetch(
      "/api/logout",
      {
        method: "POST",
        credentials: "same-origin"
      }
    );

  } catch (error) {

    console.error(
      "Erro ao sair:",
      error
    );

  }

  currentUser = "";

  products = [];
  clients = [];
  suppliers = [];
  sales = [];
  purchases = [];
  stockMoves = [];

  saleCart = [];

  currentSaleId = null;
  currentPurchaseId = null;

  if ($("loginUsername")) {
    $("loginUsername").value = "";
  }

  if ($("loginPassword")) {
    $("loginPassword").value = "";
  }

  setLoginError("");

  showLogin();
}

/* =========================================================
   NAVEGAÇÃO
========================================================= */

function showPage(pageName) {

  qsa(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page =
    $(`page-${pageName}`);

  if (page) {
    page.classList.add("active");
  }

  qsa(".nav-item").forEach(button => {

    button.classList.remove("active");

    if (
      button.dataset.page === pageName
    ) {
      button.classList.add("active");
    }

  });

  const titles = {
    dashboard: "Dashboard",
    products: "Produtos",
    clients: "Clientes",
    suppliers: "Fornecedores",
    sale: "Nova Venda",
    sales: "Vendas",
    stock: "Estoque",
    reports: "Relatórios",
    purchases: "Compras / Contas a Pagar"
  };

  if ($("topbarTitle")) {
    $("topbarTitle").textContent =
      titles[pageName] ||
      "Essência & Charme";
  }

  if (pageName === "dashboard") {
    loadDashboard();
  }

  if (pageName === "products") {
    renderProducts();
  }

  if (pageName === "clients") {
    renderClients();
  }

  if (pageName === "suppliers") {
    renderSuppliers();
  }

  if (pageName === "sales") {
    renderSales();
  }

  if (pageName === "stock") {
    renderStock();
  }

  if (pageName === "reports") {
    loadReports();
  }

  if (pageName === "purchases") {
    renderPurchases();
  }

  if (pageName === "sale") {
    prepareSalePage();
  }
}

/* =========================================================
   CARREGAMENTO GERAL
========================================================= */

async function loadAll() {

  await Promise.allSettled([
    loadProducts(),
    loadClients(),
    loadSuppliers(),
    loadSales(),
    loadPurchases(),
    loadStock()
  ]);

  loadDashboard();

  updateProductSelects();
  updateClientSelect();
  updateSupplierSelect();
}

/* =========================================================
   PRODUTOS
========================================================= */

async function loadProducts() {

  try {

    const data =
      await api("/api/products");

    products =
      Array.isArray(data)
        ? data
        : data.products || [];

    renderProducts();

    updateProductSelects();

  } catch (error) {

    console.error(
      "Produtos:",
      error
    );

  }
}

function renderProducts() {

  const tbody =
    $("productsTableBody");

  if (!tbody) return;

  if (!products.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-state-icon">💎</div>
            <strong>Nenhum produto cadastrado</strong>
            <span>Cadastre seu primeiro produto.</span>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    products.map(product => {

      const stock =
        number(product.stock);

      let stockClass =
        "badge-success";

      if (stock <= 0) {

        stockClass =
          "badge-danger";

      } else if (
        product.min_stock != null &&
        stock <= number(product.min_stock)
      ) {

        stockClass =
          "badge-warning";

      }

      return `
        <tr>

          <td>
            <strong>
              ${escapeHtml(product.name)}
            </strong>

            ${
              product.code
                ? `
                  <div
                    style="font-size:11px;color:var(--muted)">
                    Código:
                    ${escapeHtml(product.code)}
                  </div>
                `
                : ""
            }
          </td>

          <td>
            ${escapeHtml(product.brand || "-")}
          </td>

          <td>
            ${escapeHtml(
              product.supplier_name || "-"
            )}
          </td>

          <td>
            ${money(product.cost)}
          </td>

          <td>
            ${money(product.price)}
          </td>

          <td>
            <span class="badge ${stockClass}">
              ${stock}
            </span>
          </td>

          <td>
            ${formatDate(product.created_at)}
          </td>

          <td>
            <div class="actions">

              <button
                class="btn btn-light btn-sm"
                onclick="editProduct(${product.id})">
                Editar
              </button>

              <button
                class="btn btn-danger btn-sm"
                onclick="deleteProduct(${product.id})">
                Excluir
              </button>

            </div>
          </td>

        </tr>
      `;

    }).join("");
}

function openProductModal(product = null) {

  const form =
    $("productForm");

  if (!form) return;

  form.reset();

  if ($("productId")) {
    $("productId").value =
      product?.id || "";
  }

  if ($("productCode")) {
    $("productCode").value =
      product?.code || "";
  }

  if ($("productName")) {
    $("productName").value =
      product?.name || "";
  }

  if ($("productBrand")) {
    $("productBrand").value =
      product?.brand || "";
  }

  if ($("productSupplier")) {
    $("productSupplier").value =
      product?.supplier_id || "";
  }

  if ($("productSize")) {
    $("productSize").value =
      product?.size || "";
  }

  if ($("productCost")) {
    $("productCost").value =
      product?.cost ?? "";
  }

  if ($("productPrice")) {
    $("productPrice").value =
      product?.price ?? "";
  }

  if ($("productStock")) {
    $("productStock").value =
      product?.stock ?? 0;
  }

  if ($("productMinStock")) {
    $("productMinStock").value =
      product?.min_stock ?? 0;
  }

  if ($("productModalTitle")) {
    $("productModalTitle").textContent =
      product
        ? "Editar Produto"
        : "Novo Produto";
  }

  openModal("productModal");
}

function editProduct(id) {

  const product =
    products.find(
      p => Number(p.id) === Number(id)
    );

  if (!product) return;

  openProductModal(product);
}

async function saveProduct(event) {

  event.preventDefault();

  const id =
    $("productId")?.value;

  const payload = {

    code:
      $("productCode")?.value?.trim() || "",

    name:
      $("productName")?.value?.trim() || "",

    brand:
      $("productBrand")?.value?.trim() || "",

    supplier_id:
      $("productSupplier")?.value || null,

    size:
      $("productSize")?.value?.trim() || "",

    cost:
      number($("productCost")?.value),

    price:
      number($("productPrice")?.value),

    stock:
      number($("productStock")?.value),

    min_stock:
      number($("productMinStock")?.value)
  };

  if (!payload.name) {

    showAlert(
      "Informe o nome do produto.",
      "danger"
    );

    return;
  }

  try {

    await api(
      id
        ? `/api/products/${id}`
        : "/api/products",
      {
        method:
          id ? "PUT" : "POST",

        body:
          JSON.stringify(payload)
      }
    );

    closeModal("productModal");

    await loadProducts();

    showAlert(
      id
        ? "Produto atualizado com sucesso."
        : "Produto cadastrado com sucesso."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

async function deleteProduct(id) {

  if (
    !confirm(
      "Deseja realmente excluir este produto?"
    )
  ) {
    return;
  }

  try {

    await api(
      `/api/products/${id}`,
      {
        method: "DELETE"
      }
    );

    await loadProducts();

    showAlert(
      "Produto excluído."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   CLIENTES
========================================================= */

async function loadClients() {

  try {

    const data =
      await api("/api/clients");

    clients =
      Array.isArray(data)
        ? data
        : data.clients || [];

    renderClients();
    updateClientSelect();

  } catch (error) {

    console.error(
      "Clientes:",
      error
    );

  }
}

function renderClients() {

  const tbody =
    $("clientsTableBody");

  if (!tbody) return;

  if (!clients.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">👤</div>
            <strong>Nenhum cliente cadastrado</strong>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    clients.map(client => `

      <tr>

        <td>
          <strong>
            ${escapeHtml(client.name)}
          </strong>
        </td>

        <td>
          ${escapeHtml(
            client.phone || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            client.address || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            client.notes || "-"
          )}
        </td>

        <td>
          ${formatDate(
            client.created_at
          )}
        </td>

        <td>
          <div class="actions">

            <button
              class="btn btn-light btn-sm"
              onclick="editClient(${client.id})">
              Editar
            </button>

            <button
              class="btn btn-danger btn-sm"
              onclick="deleteClient(${client.id})">
              Excluir
            </button>

          </div>
        </td>

      </tr>

    `).join("");
}

function openClientModal(client = null) {

  const form =
    $("clientForm");

  if (!form) return;

  form.reset();

  if ($("clientId")) {
    $("clientId").value =
      client?.id || "";
  }

  if ($("clientName")) {
    $("clientName").value =
      client?.name || "";
  }

  if ($("clientPhone")) {
    $("clientPhone").value =
      client?.phone || "";
  }

  if ($("clientAddress")) {
    $("clientAddress").value =
      client?.address || "";
  }

  if ($("clientNotes")) {
    $("clientNotes").value =
      client?.notes || "";
  }

  if ($("clientModalTitle")) {
    $("clientModalTitle").textContent =
      client
        ? "Editar Cliente"
        : "Novo Cliente";
  }

  openModal("clientModal");
}

function editClient(id) {

  const client =
    clients.find(
      c => Number(c.id) === Number(id)
    );

  if (!client) return;

  openClientModal(client);
}

async function saveClient(event) {

  event.preventDefault();

  const id =
    $("clientId")?.value;

  const payload = {

    name:
      $("clientName")?.value?.trim() || "",

    phone:
      $("clientPhone")?.value?.trim() || "",

    address:
      $("clientAddress")?.value?.trim() || "",

    notes:
      $("clientNotes")?.value?.trim() || ""
  };

  if (!payload.name) {

    showAlert(
      "Informe o nome do cliente.",
      "danger"
    );

    return;
  }

  try {

    await api(
      id
        ? `/api/clients/${id}`
        : "/api/clients",
      {
        method:
          id ? "PUT" : "POST",

        body:
          JSON.stringify(payload)
      }
    );

    closeModal("clientModal");

    await loadClients();

    showAlert(
      id
        ? "Cliente atualizado."
        : "Cliente cadastrado."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

async function deleteClient(id) {

  if (
    !confirm(
      "Deseja excluir este cliente?"
    )
  ) {
    return;
  }

  try {

    await api(
      `/api/clients/${id}`,
      {
        method: "DELETE"
      }
    );

    await loadClients();

    showAlert(
      "Cliente excluído."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   FORNECEDORES
========================================================= */

async function loadSuppliers() {

  try {

    const data =
      await api("/api/suppliers");

    suppliers =
      Array.isArray(data)
        ? data
        : data.suppliers || [];

    renderSuppliers();
    updateSupplierSelect();

  } catch (error) {

    console.error(
      "Fornecedores:",
      error
    );

  }
}

function renderSuppliers() {

  const tbody =
    $("suppliersTableBody");

  if (!tbody) return;

  if (!suppliers.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">🏢</div>
            <strong>Nenhum fornecedor cadastrado</strong>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    suppliers.map(supplier => `

      <tr>

        <td>
          <strong>
            ${escapeHtml(
              supplier.name
            )}
          </strong>
        </td>

        <td>
          ${escapeHtml(
            supplier.phone || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            supplier.whatsapp || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            supplier.document || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            supplier.address || "-"
          )}
        </td>

        <td>
          <div class="actions">

            <button
              class="btn btn-light btn-sm"
              onclick="editSupplier(${supplier.id})">
              Editar
            </button>

            <button
              class="btn btn-danger btn-sm"
              onclick="deleteSupplier(${supplier.id})">
              Excluir
            </button>

          </div>
        </td>

      </tr>

    `).join("");
}

function openSupplierModal(supplier = null) {

  const form =
    $("supplierForm");

  if (!form) return;

  form.reset();

  if ($("supplierId")) {
    $("supplierId").value =
      supplier?.id || "";
  }

  if ($("supplierName")) {
    $("supplierName").value =
      supplier?.name || "";
  }

  if ($("supplierPhone")) {
    $("supplierPhone").value =
      supplier?.phone || "";
  }

  if ($("supplierWhatsapp")) {
    $("supplierWhatsapp").value =
      supplier?.whatsapp || "";
  }

  if ($("supplierDocument")) {
    $("supplierDocument").value =
      supplier?.document || "";
  }

  if ($("supplierAddress")) {
    $("supplierAddress").value =
      supplier?.address || "";
  }

  if ($("supplierNotes")) {
    $("supplierNotes").value =
      supplier?.notes || "";
  }

  if ($("supplierModalTitle")) {
    $("supplierModalTitle").textContent =
      supplier
        ? "Editar Fornecedor"
        : "Novo Fornecedor";
  }

  openModal("supplierModal");
}

function editSupplier(id) {

  const supplier =
    suppliers.find(
      s => Number(s.id) === Number(id)
    );

  if (!supplier) return;

  openSupplierModal(supplier);
}

async function saveSupplier(event) {

  event.preventDefault();

  const id =
    $("supplierId")?.value;

  const payload = {

    name:
      $("supplierName")?.value?.trim() || "",

    phone:
      $("supplierPhone")?.value?.trim() || "",

    whatsapp:
      $("supplierWhatsapp")?.value?.trim() || "",

    document:
      $("supplierDocument")?.value?.trim() || "",

    address:
      $("supplierAddress")?.value?.trim() || "",

    notes:
      $("supplierNotes")?.value?.trim() || ""
  };

  if (!payload.name) {

    showAlert(
      "Informe o nome do fornecedor.",
      "danger"
    );

    return;
  }

  try {

    await api(
      id
        ? `/api/suppliers/${id}`
        : "/api/suppliers",
      {
        method:
          id ? "PUT" : "POST",

        body:
          JSON.stringify(payload)
      }
    );

    closeModal("supplierModal");

    await loadSuppliers();

    showAlert(
      id
        ? "Fornecedor atualizado."
        : "Fornecedor cadastrado."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

async function deleteSupplier(id) {

  if (
    !confirm(
      "Deseja excluir este fornecedor?"
    )
  ) {
    return;
  }

  try {

    await api(
      `/api/suppliers/${id}`,
      {
        method: "DELETE"
      }
    );

    await loadSuppliers();

    showAlert(
      "Fornecedor excluído."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   SELECTS
========================================================= */

function updateProductSelects() {

  const selects =
    qsa(
      "#saleProduct, #stockProduct, #purchaseProduct"
    );

  selects.forEach(select => {

    const current =
      select.value;

    let options = `
      <option value="">
        Selecione o produto
      </option>
    `;

    options +=
      products.map(product => `

        <option value="${product.id}">
          ${escapeHtml(product.name)}
          ${
            product.brand
              ? ` - ${escapeHtml(product.brand)}`
              : ""
          }
        </option>

      `).join("");

    select.innerHTML =
      options;

    if (current) {
      select.value =
        current;
    }

  });
}

function updateClientSelect() {

  const select =
    $("saleClient");

  if (!select) return;

  const current =
    select.value;

  select.innerHTML = `
    <option value="">
      Consumidor / cliente
    </option>

    ${clients.map(client => `

      <option value="${client.id}">
        ${escapeHtml(client.name)}
      </option>

    `).join("")}
  `;

  if (current) {
    select.value =
      current;
  }
}

function updateSupplierSelect() {

  const selects =
    qsa(
      "#productSupplier, #purchaseSupplier"
    );

  selects.forEach(select => {

    const current =
      select.value;

    select.innerHTML = `

      <option value="">
        Selecione o fornecedor
      </option>

      ${suppliers.map(supplier => `

        <option value="${supplier.id}">
          ${escapeHtml(supplier.name)}
        </option>

      `).join("")}

    `;

    if (current) {
      select.value =
        current;
    }

  });
}

/* =========================================================
   VENDAS
========================================================= */

async function loadSales() {

  try {

    const data =
      await api("/api/sales");

    sales =
      Array.isArray(data)
        ? data
        : data.sales || [];

    renderSales();

  } catch (error) {

    console.error(
      "Vendas:",
      error
    );

  }
}

function prepareSalePage() {

  updateProductSelects();

  updateClientSelect();

  renderSaleCart();

  calculateSaleTotals();
}

function addSaleProduct() {

  const productId =
    Number(
      $("saleProduct")?.value || 0
    );

  const qty =
    number(
      $("saleQuantity")?.value || 1
    );

  if (!productId) {

    showAlert(
      "Selecione um produto.",
      "danger"
    );

    return;
  }

  if (qty <= 0) {

    showAlert(
      "Informe uma quantidade válida.",
      "danger"
    );

    return;
  }

  const product =
    products.find(
      p => Number(p.id) === productId
    );

  if (!product) {

    showAlert(
      "Produto não encontrado.",
      "danger"
    );

    return;
  }

  const existing =
    saleCart.find(
      item =>
        Number(item.product_id) ===
        productId
    );

  const newQuantity =
    (existing?.quantity || 0) +
    qty;

  if (
    product.stock != null &&
    newQuantity > number(product.stock)
  ) {

    showAlert(
      `Estoque insuficiente. Disponível: ${product.stock}.`,
      "danger"
    );

    return;
  }

  if (existing) {

    existing.quantity =
      newQuantity;

  } else {

    saleCart.push({

      product_id:
        product.id,

      name:
        product.name,

      price:
        number(product.price),

      cost:
        number(product.cost),

      quantity:
        qty

    });

  }

  if ($("saleQuantity")) {
    $("saleQuantity").value = 1;
  }

  if ($("saleProduct")) {
    $("saleProduct").value = "";
  }

  renderSaleCart();

  calculateSaleTotals();
}

function removeSaleProduct(index) {

  saleCart.splice(
    index,
    1
  );

  renderSaleCart();

  calculateSaleTotals();
}

function changeSaleQuantity(
  index,
  quantity
) {

  quantity =
    number(quantity);

  if (quantity <= 0) {

    removeSaleProduct(index);

    return;
  }

  const item =
    saleCart[index];

  const product =
    products.find(
      p =>
        Number(p.id) ===
        Number(item.product_id)
    );

  if (
    product &&
    product.stock != null &&
    quantity > number(product.stock)
  ) {

    showAlert(
      `Estoque insuficiente. Disponível: ${product.stock}.`,
      "danger"
    );

    renderSaleCart();

    return;
  }

  item.quantity =
    quantity;

  renderSaleCart();

  calculateSaleTotals();
}

function renderSaleCart() {

  const container =
    $("saleCart");

  if (!container) return;

  if (!saleCart.length) {

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛍️</div>
        <strong>Nenhum produto na venda</strong>
        <span>
          Selecione produtos para começar.
        </span>
      </div>
    `;

    return;
  }

  container.innerHTML =
    saleCart.map(
      (item, index) => `

        <div class="cart-item">

          <div>

            <div class="cart-item-name">
              ${escapeHtml(item.name)}
            </div>

            <div class="cart-item-detail">
              ${money(item.price)} cada
            </div>

          </div>

          <div
            style="
              display:flex;
              align-items:center;
              gap:8px
            ">

            <input
              type="number"
              min="1"
              value="${item.quantity}"
              style="width:70px"
              onchange="
                changeSaleQuantity(
                  ${index},
                  this.value
                )
              "
            >

            <strong>
              ${money(
                item.price *
                item.quantity
              )}
            </strong>

            <button
              class="btn btn-danger btn-sm"
              onclick="
                removeSaleProduct(${index})
              ">
              ×
            </button>

          </div>

        </div>

      `
    ).join("");
}

function calculateSaleTotals() {

  const subtotal =
    saleCart.reduce(
      (total, item) =>
        total +
        item.price *
        item.quantity,
      0
    );

  const discount =
    number(
      $("saleDiscount")?.value || 0
    );

  const total =
    Math.max(
      0,
      subtotal - discount
    );

  const entry =
    number(
      $("saleEntry")?.value || 0
    );

  const balance =
    Math.max(
      0,
      total - entry
    );

  if ($("saleSubtotal")) {
    $("saleSubtotal").textContent =
      money(subtotal);
  }

  if ($("saleTotal")) {
    $("saleTotal").textContent =
      money(total);
  }

  if ($("saleEntryValue")) {
    $("saleEntryValue").textContent =
      money(entry);
  }

  if ($("saleBalance")) {
    $("saleBalance").textContent =
      money(balance);
  }

  const installments =
    number(
      $("saleInstallments")?.value || 1
    );

  const installmentValue =
    installments > 0
      ? balance / installments
      : balance;

  if ($("saleInstallmentValue")) {
    $("saleInstallmentValue").textContent =
      money(installmentValue);
  }

  return {

    subtotal,

    discount,

    total,

    entry,

    balance,

    installments,

    installmentValue

  };
}

async function saveSale(event) {

  event.preventDefault();

  if (!saleCart.length) {

    showAlert(
      "Adicione pelo menos um produto à venda.",
      "danger"
    );

    return;
  }

  const totals =
    calculateSaleTotals();

  if (totals.total <= 0) {

    showAlert(
      "O valor total da venda precisa ser maior que zero.",
      "danger"
    );

    return;
  }

  if (totals.entry > totals.total) {

    showAlert(
      "A entrada não pode ser maior que o total.",
      "danger"
    );

    return;
  }

  const payload = {

    client_id:
      $("saleClient")?.value ||
      null,

    date:
      $("saleDate")?.value ||
      today(),

    subtotal:
      totals.subtotal,

    discount:
      totals.discount,

    total:
      totals.total,

    payment:
      $("salePayment")?.value ||
      "Fiado",

    installments:
      totals.installments,

    entry:
      totals.entry,

    notes:
      $("saleNotes")?.value?.trim() ||
      "",

    items:
      saleCart.map(item => ({

        product_id:
          item.product_id,

        quantity:
          item.quantity,

        price:
          item.price,

        cost:
          item.cost

      }))

  };

  try {

    await api(
      "/api/sales",
      {
        method: "POST",

        body:
          JSON.stringify(payload)
      }
    );

    showAlert(
      "Venda registrada com sucesso."
    );

    saleCart = [];

    if ($("saleForm")) {
      $("saleForm").reset();
    }

    if ($("saleDate")) {
      $("saleDate").value =
        today();
    }

    renderSaleCart();

    calculateSaleTotals();

    await Promise.all([
      loadProducts(),
      loadSales(),
      loadDashboard()
    ]);

    showPage("sales");

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

function renderSales() {

  const tbody =
    $("salesTableBody");

  if (!tbody) return;

  if (!sales.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-state-icon">🛍️</div>
            <strong>Nenhuma venda registrada</strong>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    sales.map(sale => {

      const balance =
        number(
          sale.balance ??
          (
            number(sale.total) -
            number(sale.paid_amount)
          )
        );

      let statusClass =
        "badge-success";

      if (balance > 0) {
        statusClass =
          "badge-warning";
      }

      if (
        sale.status ===
        "cancelada"
      ) {
        statusClass =
          "badge-danger";
      }

      return `

        <tr>

          <td>
            ${formatDate(
              sale.date ||
              sale.created_at
            )}
          </td>

          <td>
            ${escapeHtml(
              sale.client_name ||
              "Consumidor"
            )}
          </td>

          <td>
            ${money(sale.total)}
          </td>

          <td>
            ${money(
              sale.entry ||
              sale.paid_amount ||
              0
            )}
          </td>

          <td>
            ${money(balance)}
          </td>

          <td>

            <span
              class="badge ${statusClass}">

              ${escapeHtml(
                sale.status ||
                (
                  balance > 0
                    ? "Em aberto"
                    : "Pago"
                )
              )}

            </span>

          </td>

          <td>
            ${escapeHtml(
              sale.payment || "-"
            )}
          </td>

          <td>
            ${number(
              sale.installments || 1
            )}
          </td>

          <td>

            <div class="actions">

              <button
                class="btn btn-light btn-sm"
                onclick="viewSale(${sale.id})">
                Ver
              </button>

              ${
                balance > 0
                  ? `
                    <button
                      class="btn btn-rose btn-sm"
                      onclick="
                        openSalePayment(
                          ${sale.id}
                        )
                      ">
                      Receber
                    </button>
                  `
                  : ""
              }

            </div>

          </td>

        </tr>

      `;

    }).join("");
}

async function viewSale(id) {

  try {

    const data =
      await api(
        `/api/sales/${id}`
      );

    const sale =
      data.sale || data;

    currentSaleId =
      id;

    let html = `

      <div class="form-grid">

        <div>
          <strong>Cliente</strong>

          <div>
            ${escapeHtml(
              sale.client_name ||
              "Consumidor"
            )}
          </div>
        </div>

        <div>
          <strong>Data</strong>

          <div>
            ${formatDate(
              sale.date ||
              sale.created_at
            )}
          </div>
        </div>

        <div>
          <strong>Total</strong>

          <div>
            ${money(
              sale.total
            )}
          </div>
        </div>

        <div>
          <strong>Entrada</strong>

          <div>
            ${money(
              sale.entry ||
              sale.paid_amount ||
              0
            )}
          </div>
        </div>

        <div>
          <strong>Saldo</strong>

          <div>
            ${money(
              sale.balance ??
              number(sale.total) -
              number(sale.paid_amount)
            )}
          </div>
        </div>

        <div>
          <strong>Pagamento</strong>

          <div>
            ${escapeHtml(
              sale.payment || "-"
            )}
          </div>
        </div>

      </div>

    `;

    if (
      Array.isArray(
        sale.items
      )
    ) {

      html += `

        <div
          style="margin-top:20px">

          <h4
            style="color:var(--purple-dark)">
            Produtos
          </h4>

          <div class="table-wrapper">

            <table>

              <thead>

                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Valor</th>
                  <th>Total</th>
                </tr>

              </thead>

              <tbody>

                ${
                  sale.items.map(
                    item => `

                      <tr>

                        <td>
                          ${escapeHtml(
                            item.product_name ||
                            item.name ||
                            "-"
                          )}
                        </td>

                        <td>
                          ${item.quantity}
                        </td>

                        <td>
                          ${money(
                            item.price
                          )}
                        </td>

                        <td>
                          ${money(
                            number(item.price) *
                            number(item.quantity)
                          )}
                        </td>

                      </tr>

                    `
                  ).join("")
                }

              </tbody>

            </table>

          </div>

        </div>

      `;
    }

    if ($("saleDetailsBody")) {
      $("saleDetailsBody").innerHTML =
        html;
    }

    openModal(
      "saleDetailsModal"
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

function openSalePayment(id) {

  currentSaleId =
    id;

  if ($("paymentSaleId")) {
    $("paymentSaleId").value =
      id;
  }

  if ($("paymentAmount")) {
    $("paymentAmount").value =
      "";
  }

  openModal(
    "paymentModal"
  );
}

async function saveSalePayment(event) {

  event.preventDefault();

  const saleId =
    currentSaleId;

  const amount =
    number(
      $("paymentAmount")?.value
    );

  if (
    !saleId ||
    amount <= 0
  ) {

    showAlert(
      "Informe um valor válido.",
      "danger"
    );

    return;
  }

  const payload = {

    amount,

    payment:
      $("paymentMethod")?.value ||
      "PIX",

    note:
      $("paymentNote")?.value?.trim() ||
      ""

  };

  try {

    await api(
      `/api/sales/${saleId}/payments`,
      {
        method: "POST",

        body:
          JSON.stringify(payload)
      }
    );

    closeModal(
      "paymentModal"
    );

    await Promise.all([
      loadSales(),
      loadDashboard()
    ]);

    showAlert(
      "Pagamento registrado com sucesso."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   ESTOQUE
========================================================= */

async function loadStock() {

  try {

    const data =
      await api("/api/stock");

    stockMoves =
      Array.isArray(data)
        ? data
        : data.moves || [];

    renderStock();

  } catch (error) {

    console.error(
      "Estoque:",
      error
    );

    renderStockFromProducts();
  }
}

function renderStockFromProducts() {

  const tbody =
    $("stockTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    products.map(product => {

      const stock =
        number(product.stock);

      let badge =
        "badge-success";

      if (stock <= 0) {

        badge =
          "badge-danger";

      } else if (
        product.min_stock != null &&
        stock <= number(product.min_stock)
      ) {

        badge =
          "badge-warning";
      }

      return `

        <tr>

          <td>
            ${escapeHtml(
              product.name
            )}
          </td>

          <td>
            ${escapeHtml(
              product.brand || "-"
            )}
          </td>

          <td>

            <span
              class="badge ${badge}">

              ${stock}

            </span>

          </td>

          <td>
            ${product.min_stock ?? 0}
          </td>

          <td>
            ${money(product.cost)}
          </td>

          <td>
            ${money(product.price)}
          </td>

          <td>

            <button
              class="btn btn-light btn-sm"
              onclick="
                openStockModal(
                  ${product.id}
                )
              ">
              Ajustar
            </button>

          </td>

        </tr>

      `;

    }).join("");
}

function renderStock() {

  const tbody =
    $("stockTableBody");

  if (!tbody) return;

  if (!stockMoves.length) {

    renderStockFromProducts();

    return;
  }

  renderStockFromProducts();
}

function openStockModal(
  productId = null
) {

  if ($("stockProduct")) {
    $("stockProduct").value =
      productId || "";
  }

  if ($("stockQuantity")) {
    $("stockQuantity").value =
      "";
  }

  openModal(
    "stockModal"
  );
}

async function saveStockMove(event) {

  event.preventDefault();

  const productId =
    Number(
      $("stockProduct")?.value || 0
    );

  const quantity =
    number(
      $("stockQuantity")?.value
    );

  const type =
    $("stockType")?.value ||
    "entrada";

  if (
    !productId ||
    quantity <= 0
  ) {

    showAlert(
      "Informe produto e quantidade.",
      "danger"
    );

    return;
  }

  try {

    await api(
      "/api/stock",
      {
        method: "POST",

        body:
          JSON.stringify({
            product_id:
              productId,

            quantity,

            type,

            note:
              $("stockNote")?.value?.trim() ||
              ""
          })
      }
    );

    closeModal(
      "stockModal"
    );

    await Promise.all([
      loadProducts(),
      loadStock(),
      loadDashboard()
    ]);

    showAlert(
      "Estoque atualizado."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   COMPRAS
========================================================= */

async function loadPurchases() {

  try {

    const data =
      await api("/api/purchases");

    purchases =
      Array.isArray(data)
        ? data
        : data.purchases || [];

    renderPurchases();

  } catch (error) {

    console.error(
      "Compras:",
      error
    );

  }
}

function renderPurchases() {

  const tbody =
    $("purchasesTableBody");

  if (!tbody) return;

  if (!purchases.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="9">

          <div class="empty-state">

            <div class="empty-state-icon">
              📦
            </div>

            <strong>
              Nenhuma compra cadastrada
            </strong>

            <span>
              As compras de fornecedores aparecerão aqui.
            </span>

          </div>

        </td>
      </tr>
    `;

  } else {

    tbody.innerHTML =
      purchases.map(
        purchase => {

          const total =
            number(
              purchase.total
            );

          const paid =
            number(
              purchase.paid_amount ??
              purchase.entry
            );

          const balance =
            number(
              purchase.balance ??
              total - paid
            );

          let statusClass =
            "badge-success";

          if (balance > 0) {
            statusClass =
              "badge-warning";
          }

          return `

            <tr>

              <td>
                ${formatDate(
                  purchase.date ||
                  purchase.created_at
                )}
              </td>

              <td>
                ${escapeHtml(
                  purchase.supplier_name ||
                  "-"
                )}
              </td>

              <td>
                ${money(total)}
              </td>

              <td>
                ${money(
                  purchase.entry || 0
                )}
              </td>

              <td>
                ${money(balance)}
              </td>

              <td>
                ${number(
                  purchase.installments ||
                  1
                )}
              </td>

              <td>

                <span
                  class="badge ${statusClass}">

                  ${escapeHtml(
                    purchase.status ||
                    (
                      balance > 0
                        ? "Em aberto"
                        : "Pago"
                    )
                  )}

                </span>

              </td>

              <td>
                ${escapeHtml(
                  purchase.payment ||
                  "-"
                )}
              </td>

              <td>

                <div class="actions">

                  <button
                    class="btn btn-light btn-sm"
                    onclick="
                      viewPurchase(
                        ${purchase.id}
                      )
                    ">
                    Ver
                  </button>

                  ${
                    balance > 0
                      ? `
                        <button
                          class="btn btn-rose btn-sm"
                          onclick="
                            openPurchasePayment(
                              ${purchase.id}
                            )
                          ">
                          Pagar
                        </button>
                      `
                      : ""
                  }

                </div>

              </td>

            </tr>

          `;

        }
      ).join("");
  }

  updatePurchaseSummary();
}

function updatePurchaseSummary() {

  const total =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        number(
          purchase.total
        ),
      0
    );

  const paid =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        number(
          purchase.paid_amount ??
          purchase.entry
        ),
      0
    );

  const balance =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        number(
          purchase.balance ??
          number(purchase.total) -
          number(
            purchase.paid_amount ??
            purchase.entry
          )
        ),
      0
    );

  if ($("purchasesTotal")) {
    $("purchasesTotal").textContent =
      money(total);
  }

  if ($("purchasesPaid")) {
    $("purchasesPaid").textContent =
      money(paid);
  }

  if ($("purchasesBalance")) {
    $("purchasesBalance").textContent =
      money(balance);
  }
}

function openPurchaseModal() {

  const form =
    $("purchaseForm");

  if (form) {
    form.reset();
  }

  if ($("purchaseDate")) {
    $("purchaseDate").value =
      today();
  }

  updateSupplierSelect();

  updateProductSelects();

  openModal(
    "purchaseModal"
  );
}

function addPurchaseItem() {

  const productId =
    Number(
      $("purchaseProduct")?.value || 0
    );

  const quantity =
    number(
      $("purchaseQuantity")?.value ||
      1
    );

  const cost =
    number(
      $("purchaseCost")?.value ||
      0
    );

  if (
    !productId ||
    quantity <= 0 ||
    cost <= 0
  ) {

    showAlert(
      "Informe produto, quantidade e custo.",
      "danger"
    );

    return;
  }

  const product =
    products.find(
      p =>
        Number(p.id) ===
        productId
    );

  if (!product) return;

  const container =
    $("purchaseItems");

  if (!container) return;

  const item =
    document.createElement("div");

  item.className =
    "cart-item";

  item.dataset.productId =
    productId;

  item.dataset.quantity =
    quantity;

  item.dataset.cost =
    cost;

  item.innerHTML = `

    <div>

      <div class="cart-item-name">
        ${escapeHtml(
          product.name
        )}
      </div>

      <div class="cart-item-detail">
        ${quantity}
        unidade(s) ×
        ${money(cost)}
      </div>

    </div>

    <div
      style="
        display:flex;
        align-items:center;
        gap:10px
      ">

      <strong>
        ${money(
          quantity * cost
        )}
      </strong>

      <button
        type="button"
        class="btn btn-danger btn-sm"
        onclick="
          this.closest('.cart-item').remove();
          calculatePurchaseTotal()
        ">
        ×
      </button>

    </div>

  `;

  container.appendChild(
    item
  );

  if ($("purchaseProduct")) {
    $("purchaseProduct").value =
      "";
  }

  if ($("purchaseQuantity")) {
    $("purchaseQuantity").value =
      1;
  }

  if ($("purchaseCost")) {
    $("purchaseCost").value =
      "";
  }

  calculatePurchaseTotal();
}

function getPurchaseItems() {

  const container =
    $("purchaseItems");

  if (!container) {
    return [];
  }

  return qsa(
    ".cart-item",
    container
  ).map(item => ({

    product_id:
      Number(
        item.dataset.productId
      ),

    quantity:
      number(
        item.dataset.quantity
      ),

    cost:
      number(
        item.dataset.cost
      )

  }));
}

function calculatePurchaseTotal() {

  const items =
    getPurchaseItems();

  const total =
    items.reduce(
      (sum, item) =>
        sum +
        item.quantity *
        item.cost,
      0
    );

  const entry =
    number(
      $("purchaseEntry")?.value ||
      0
    );

  const balance =
    Math.max(
      0,
      total - entry
    );

  if ($("purchaseTotalValue")) {
    $("purchaseTotalValue").textContent =
      money(total);
  }

  if ($("purchaseBalanceValue")) {
    $("purchaseBalanceValue").textContent =
      money(balance);
  }

  return {

    total,

    entry,

    balance

  };
}

async function savePurchase(event) {

  event.preventDefault();

  const items =
    getPurchaseItems();

  if (!items.length) {

    showAlert(
      "Adicione pelo menos um produto à compra.",
      "danger"
    );

    return;
  }

  const totals =
    calculatePurchaseTotal();

  const supplierId =
    $("purchaseSupplier")?.value ||
    null;

  if (!supplierId) {

    showAlert(
      "Selecione o fornecedor.",
      "danger"
    );

    return;
  }

  const payload = {

    supplier_id:
      supplierId,

    date:
      $("purchaseDate")?.value ||
      today(),

    total:
      totals.total,

    entry:
      totals.entry,

    payment:
      $("purchasePayment")?.value ||
      "Fiado",

    installments:
      number(
        $("purchaseInstallments")?.value ||
        1
      ),

    notes:
      $("purchaseNotes")?.value?.trim() ||
      "",

    items

  };

  try {

    await api(
      "/api/purchases",
      {
        method: "POST",

        body:
          JSON.stringify(payload)
      }
    );

    closeModal(
      "purchaseModal"
    );

    await Promise.all([
      loadPurchases(),
      loadProducts(),
      loadStock(),
      loadDashboard()
    ]);

    showAlert(
      "Compra registrada e estoque atualizado."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

async function viewPurchase(id) {

  try {

    const data =
      await api(
        `/api/purchases/${id}`
      );

    const purchase =
      data.purchase ||
      data;

    currentPurchaseId =
      id;

    let html = `

      <div class="form-grid">

        <div>

          <strong>
            Fornecedor
          </strong>

          <div>
            ${escapeHtml(
              purchase.supplier_name ||
              "-"
            )}
          </div>

        </div>

        <div>

          <strong>
            Data
          </strong>

          <div>
            ${formatDate(
              purchase.date ||
              purchase.created_at
            )}
          </div>

        </div>

        <div>

          <strong>
            Total
          </strong>

          <div>
            ${money(
              purchase.total
            )}
          </div>

        </div>

        <div>

          <strong>
            Entrada
          </strong>

          <div>
            ${money(
              purchase.entry || 0
            )}
          </div>

        </div>

        <div>

          <strong>
            A pagar
          </strong>

          <div>
            ${money(
              purchase.balance ??
              number(purchase.total) -
              number(
                purchase.paid_amount
              )
            )}
          </div>

        </div>

        <div>

          <strong>
            Parcelas
          </strong>

          <div>
            ${purchase.installments || 1}
          </div>

        </div>

      </div>

    `;

    if (
      Array.isArray(
        purchase.items
      )
    ) {

      html += `

        <div
          style="margin-top:20px">

          <h4
            style="color:var(--purple-dark)">
            Produtos
          </h4>

          <div class="table-wrapper">

            <table>

              <thead>

                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Custo</th>
                  <th>Total</th>
                </tr>

              </thead>

              <tbody>

                ${
                  purchase.items.map(
                    item => `

                      <tr>

                        <td>
                          ${escapeHtml(
                            item.product_name ||
                            item.name ||
                            "-"
                          )}
                        </td>

                        <td>
                          ${item.quantity}
                        </td>

                        <td>
                          ${money(
                            item.cost
                          )}
                        </td>

                        <td>
                          ${money(
                            number(item.cost) *
                            number(item.quantity)
                          )}
                        </td>

                      </tr>

                    `
                  ).join("")
                }

              </tbody>

            </table>

          </div>

        </div>

      `;
    }

    if (
      $("purchaseDetailsBody")
    ) {

      $("purchaseDetailsBody").innerHTML =
        html;
    }

    openModal(
      "purchaseDetailsModal"
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

function openPurchasePayment(id) {

  currentPurchaseId =
    id;

  if (
    $("purchasePaymentAmount")
  ) {

    $("purchasePaymentAmount").value =
      "";

  }

  openModal(
    "purchasePaymentModal"
  );
}

async function savePurchasePayment(
  event
) {

  event.preventDefault();

  const amount =
    number(
      $("purchasePaymentAmount")?.value
    );

  if (
    !currentPurchaseId ||
    amount <= 0
  ) {

    showAlert(
      "Informe um valor válido.",
      "danger"
    );

    return;
  }

  try {

    await api(
      `/api/purchases/${currentPurchaseId}/payments`,
      {
        method: "POST",

        body:
          JSON.stringify({

            amount,

            payment:
              $("purchasePaymentMethod")?.value ||
              "PIX",

            note:
              $("purchasePaymentNote")?.value?.trim() ||
              ""

          })
      }
    );

    closeModal(
      "purchasePaymentModal"
    );

    await Promise.all([
      loadPurchases(),
      loadDashboard()
    ]);

    showAlert(
      "Pagamento da compra registrado."
    );

  } catch (error) {

    showAlert(
      error.message,
      "danger"
    );

  }
}

/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {

  const totalSales =
    sales.reduce(
      (sum, sale) =>
        sum +
        number(
          sale.total
        ),
      0
    );

  const receivable =
    sales.reduce(
      (sum, sale) =>
        sum +
        number(
          sale.balance ??
          number(sale.total) -
          number(
            sale.paid_amount ??
            sale.entry
          )
        ),
      0
    );

  const totalPurchases =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        number(
          purchase.total
        ),
      0
    );

  const payable =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        number(
          purchase.balance ??
          number(purchase.total) -
          number(
            purchase.paid_amount ??
            purchase.entry
          )
        ),
      0
    );

  const lowStock =
    products.filter(
      product => {

        const stock =
          number(product.stock);

        if (stock <= 0) {
          return true;
        }

        return (
          product.min_stock != null &&
          stock <=
          number(product.min_stock)
        );

      }
    ).length;

  setText(
    "dashboardSales",
    money(totalSales)
  );

  setText(
    "dashboardReceivable",
    money(receivable)
  );

  setText(
    "dashboardPurchases",
    money(totalPurchases)
  );

  setText(
    "dashboardPayable",
    money(payable)
  );

  setText(
    "dashboardProducts",
    products.length
  );

  setText(
    "dashboardClients",
    clients.length
  );

  setText(
    "dashboardLowStock",
    lowStock
  );
}

function setText(
  id,
  value
) {

  const element =
    $(id);

  if (element) {
    element.textContent =
      value;
  }
}

/* =========================================================
   RELATÓRIOS
========================================================= */

async function loadReports() {

  try {

    const data =
      await api(
        "/api/reports"
      );

    renderReports(data);

  } catch (error) {

    console.error(
      "Relatórios:",
      error
    );

    renderReports({

      sales:
        sales,

      purchases:
        purchases,

      products

    });
  }
}

function renderReports(data) {

  const reportSales =
    data.sales ||
    sales;

  const reportPurchases =
    data.purchases ||
    purchases;

  const totalSales =
    Array.isArray(reportSales)
      ? reportSales.reduce(
          (sum, item) =>
            sum +
            number(item.total),
          0
        )
      : number(
          data.total_sales
        );

  const totalPurchases =
    Array.isArray(reportPurchases)
      ? reportPurchases.reduce(
          (sum, item) =>
            sum +
            number(item.total),
          0
        )
      : number(
          data.total_purchases
        );

  setText(
    "reportTotalSales",
    money(totalSales)
  );

  setText(
    "reportTotalPurchases",
    money(totalPurchases)
  );

  setText(
    "reportReceivable",

    money(
      sales.reduce(
        (sum, sale) =>
          sum +
          number(
            sale.balance ??
            number(sale.total) -
            number(
              sale.paid_amount ??
              sale.entry
            )
          ),
        0
      )
    )
  );

  setText(
    "reportPayable",

    money(
      purchases.reduce(
        (sum, purchase) =>
          sum +
          number(
            purchase.balance ??
            number(purchase.total) -
            number(
              purchase.paid_amount ??
              purchase.entry
            )
          ),
        0
      )
    )
  );
}

/* =========================================================
   EVENTOS
========================================================= */

function setupEvents() {

  /* LOGIN */

  $("loginForm")?.addEventListener(
    "submit",
    login
  );

  $("logoutButton")?.addEventListener(
    "click",
    logout
  );

  /* NAVEGAÇÃO */

  qsa(".nav-item").forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          const page =
            button.dataset.page;

          if (page) {
            showPage(page);
          }

        }
      );

    }
  );

  /* PRODUTO */

  $("productForm")?.addEventListener(
    "submit",
    saveProduct
  );

  /* CLIENTE */

  $("clientForm")?.addEventListener(
    "submit",
    saveClient
  );

  /* FORNECEDOR */

  $("supplierForm")?.addEventListener(
    "submit",
    saveSupplier
  );

  /* VENDA */

  $("saleForm")?.addEventListener(
    "submit",
    saveSale
  );

  $("saleAddProduct")?.addEventListener(
    "click",
    addSaleProduct
  );

  $("saleDiscount")?.addEventListener(
    "input",
    calculateSaleTotals
  );

  $("saleEntry")?.addEventListener(
    "input",
    calculateSaleTotals
  );

  $("saleInstallments")?.addEventListener(
    "input",
    calculateSaleTotals
  );

  /* PAGAMENTO VENDA */

  $("paymentForm")?.addEventListener(
    "submit",
    saveSalePayment
  );

  /* ESTOQUE */

  $("stockForm")?.addEventListener(
    "submit",
    saveStockMove
  );

  /* COMPRA */

  $("purchaseForm")?.addEventListener(
    "submit",
    savePurchase
  );

  $("purchaseAddProduct")?.addEventListener(
    "click",
    addPurchaseItem
  );

  $("purchaseEntry")?.addEventListener(
    "input",
    calculatePurchaseTotal
  );

  /* PAGAMENTO COMPRA */

  $("purchasePaymentForm")?.addEventListener(
    "submit",
    savePurchasePayment
  );

  /* FECHAR MODAIS */

  qsa("[data-close-modal]").forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          closeModal(
            button.dataset.closeModal
          );

        }
      );

    }
  );

  qsa(".modal").forEach(
    modal => {

      modal.addEventListener(
        "click",
        event => {

          if (
            event.target === modal
          ) {

            modal.classList.remove(
              "open"
            );

          }

        }
      );

    }
  );

  /* ESC */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {

        closeAllModals();

      }

    }
  );
}

/* =========================================================
   BOTÕES GLOBAIS
========================================================= */

function newProduct() {
  openProductModal();
}

function newClient() {
  openClientModal();
}

function newSupplier() {
  openSupplierModal();
}

function newSale() {

  saleCart = [];

  if ($("saleForm")) {
    $("saleForm").reset();
  }

  if ($("saleDate")) {
    $("saleDate").value =
      today();
  }

  showPage("sale");
}

function newPurchase() {
  openPurchaseModal();
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    setupEvents();

    if ($("saleDate")) {
      $("saleDate").value =
        today();
    }

    if ($("purchaseDate")) {
      $("purchaseDate").value =
        today();
    }

    const logged =
      await checkLogin();

    if (logged) {

      await loadAll();

      showPage(
        "dashboard"
      );

    }

  }
);

/* =========================================================
   EXPOR FUNÇÕES PARA HTML INLINE
========================================================= */

window.login =
  login;

window.logout =
  logout;

window.showPage =
  showPage;

window.openModal =
  openModal;

window.closeModal =
  closeModal;

window.newProduct =
  newProduct;

window.editProduct =
  editProduct;

window.deleteProduct =
  deleteProduct;

window.newClient =
  newClient;

window.editClient =
  editClient;

window.deleteClient =
  deleteClient;

window.newSupplier =
  newSupplier;

window.editSupplier =
  editSupplier;

window.deleteSupplier =
  deleteSupplier;

window.newSale =
  newSale;

window.addSaleProduct =
  addSaleProduct;

window.removeSaleProduct =
  removeSaleProduct;

window.changeSaleQuantity =
  changeSaleQuantity;

window.viewSale =
  viewSale;

window.openSalePayment =
  openSalePayment;

window.openStockModal =
  openStockModal;

window.newPurchase =
  newPurchase;

window.addPurchaseItem =
  addPurchaseItem;

window.calculatePurchaseTotal =
  calculatePurchaseTotal;

window.viewPurchase =
  viewPurchase;

window.openPurchasePayment =
  openPurchasePayment;

window.calculateSaleTotals =
  calculateSaleTotals;