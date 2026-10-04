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

function $(id) {
  return document.getElementById(id);
}

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

function money(value) {
  const numberValue = Number(value || 0);

  return numberValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function number(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  let text = String(value).trim();

  text = text.replace(/\s/g, "");

  if (text.includes(",")) {
    text = text
      .replace(/\./g, "")
      .replace(",", ".");
  }

  const result = parseFloat(text);

  return Number.isFinite(result)
    ? result
    : 0;
}

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {

  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("pt-BR");
}

function today() {

  const date = new Date();

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function showAlert(
  message,
  type = "success"
) {

  if (
    typeof window.showToast ===
    "function"
  ) {

    window.showToast(
      message,
      type
    );

    return;
  }

  alert(message);
}

function openModal(id) {

  const modal = $(id);

  if (!modal) {

    console.warn(
      "Modal não encontrado:",
      id
    );

    return;
  }

  modal.classList.add("open");
  modal.style.display = "flex";
}

function closeModal(id) {

  const modal = $(id);

  if (!modal) return;

  modal.classList.remove("open");
  modal.style.display = "none";
}

function closeAllModals() {

  qsa(".modal").forEach(
    modal => {

      modal.classList.remove("open");
      modal.style.display = "none";

    }
  );
}


/* =========================================================
   API
========================================================= */

async function api(
  url,
  options = {}
) {

  const config = {

    credentials:
      "same-origin",

    ...options,

    headers: {
      ...(options.headers || {})
    }

  };

  if (
    config.body &&
    typeof config.body !== "string" &&
    !(config.body instanceof FormData)
  ) {

    config.headers[
      "Content-Type"
    ] =
      "application/json";

    config.body =
      JSON.stringify(
        config.body
      );
  }

  const response =
    await fetch(
      url,
      config
    );

  const text =
    await response.text();

  let data = {};

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {
      raw: text
    };

  }

  if (!response.ok) {

    const message =
      data?.error ||
      data?.message ||
      data?.raw ||
      `Erro HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}


/* =========================================================
   LOGIN
========================================================= */

function setLoginError(message) {

  const element =
    $("loginError") ||
    $("loginMessage") ||
    $("loginStatus");

  if (!element) return;

  element.textContent =
    message || "";

  element.style.display =
    message
      ? "block"
      : "none";
}

async function checkLogin() {

  try {

    const response =
      await fetch(
        "/api/me",
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (
      response.ok &&
      data.authenticated
    ) {

      currentUser =
        data.username || "";

      showApp();

      const loggedUser =
        $("loggedUser");

      if (loggedUser) {

        loggedUser.textContent =
          currentUser
            ? `Olá, ${currentUser}`
            : "";

      }

      return true;
    }

  } catch (error) {

    console.error(
      "Erro ao verificar login:",
      error
    );

  }

  showLogin();

  return false;
}

function showLogin() {

  const loginScreen =
    $("loginScreen");

  const app =
    $("app");

  if (loginScreen) {

    loginScreen.style.display =
      "flex";

  }

  if (app) {

    app.style.display =
      "none";

  }
}

function showApp() {

  const loginScreen =
    $("loginScreen");

  const app =
    $("app");

  if (loginScreen) {

    loginScreen.style.display =
      "none";

  }

  if (app) {

    app.style.display =
      "block";

  }
}

async function login(event) {

  if (event) {
    event.preventDefault();
  }

  const username =
    $("username")?.value?.trim() ||
    $("loginUsername")?.value?.trim() ||
    "";

  const password =
    $("password")?.value ||
    $("loginPassword")?.value ||
    "";

  if (
    !username ||
    !password
  ) {

    setLoginError(
      "Informe usuário e senha."
    );

    return;
  }

  try {

    setLoginError("");

    const data =
      await api(
        "/api/login",
        {
          method: "POST",
          body: {
            username,
            password
          }
        }
      );

    currentUser =
      data.username ||
      username;

    showApp();

    const loggedUser =
      $("loggedUser");

    if (loggedUser) {

      loggedUser.textContent =
        `Olá, ${currentUser}`;

    }

    await loadAll();

    showPage("dashboard");

  } catch (error) {

    console.error(
      "Erro no login:",
      error
    );

    showLogin();

    setLoginError(
      error.message ||
      "Usuário ou senha inválidos."
    );
  }
}

async function logout(event) {

  if (event) {
    event.preventDefault();
  }

  try {

    await api(
      "/api/logout",
      {
        method: "POST"
      }
    );

  } catch (error) {

    console.error(
      "Erro ao sair:",
      error
    );

  }

  currentUser = "";

  showLogin();
}


/* =========================================================
   NAVEGAÇÃO
========================================================= */

function showPage(pageName) {

  if (!pageName) return;

  qsa(".page").forEach(
    page => {

      page.classList.remove(
        "active"
      );

    }
  );

  const page =
    $(`page-${pageName}`);

  if (page) {

    page.classList.add(
      "active"
    );

  }

  qsa(".nav-item").forEach(
    item => {

      item.classList.toggle(
        "active",
        item.dataset.page ===
          pageName
      );

    }
  );

  const titles = {

    dashboard:
      "Dashboard",

    products:
      "Produtos",

    clients:
      "Clientes",

    suppliers:
      "Fornecedores",

    sales:
      "Vendas",

    stock:
      "Estoque",

    purchases:
      "Compras / Contas a Pagar",

    reports:
      "Relatórios"

  };

  const pageTitle =
    $("pageTitle");

  if (pageTitle) {

    pageTitle.textContent =
      titles[pageName] ||
      pageName;

  }

  if (
    pageName ===
    "products"
  ) {

    renderProducts();

  }

  if (
    pageName ===
    "clients"
  ) {

    renderClients();

  }

  if (
    pageName ===
    "suppliers"
  ) {

    renderSuppliers();

  }

  if (
    pageName ===
    "sales"
  ) {

    prepareSalePage();
    renderSales();

  }

  if (
    pageName ===
    "stock"
  ) {

    renderStock();

  }

  if (
    pageName ===
    "purchases"
  ) {

    renderPurchases();

  }

  if (
    pageName ===
    "reports"
  ) {

    loadReports();

  }

  if (
    pageName ===
    "dashboard"
  ) {

    loadDashboard();

  }
}


/* =========================================================
   CARREGAMENTO GERAL
========================================================= */

async function loadAll() {

  const results =
    await Promise.allSettled([

      loadProducts(),

      loadClients(),

      loadSuppliers(),

      loadSales(),

      loadPurchases(),

      loadStock()

    ]);

  results.forEach(
    result => {

      if (
        result.status ===
        "rejected"
      ) {

        console.error(
          "Erro no carregamento:",
          result.reason
        );

      }

    }
  );

  updateProductSelects();

  updateClientSelect();

  updateSupplierSelects();

  renderProducts();

  renderClients();

  renderSuppliers();

  renderSales();

  renderPurchases();

  renderStock();

  await loadDashboard();
}


/* =========================================================
   PRODUTOS
========================================================= */

async function loadProducts() {

  try {

    const data =
      await api(
        "/api/products"
      );

    products =
      Array.isArray(data)
        ? data
        : (
          data.products ||
          data.rows ||
          []
        );

    return products;

  } catch (error) {

    console.error(
      "Erro ao carregar produtos:",
      error
    );

    products = [];

    throw error;
  }
}

function renderProducts() {

  const tbody =
    $("productsTableBody") ||
    $("productsBody");

  if (!tbody) return;

  if (!products.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">
          Nenhum produto cadastrado.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    products
      .map(product => {

        const id =
          product.id ??
          product.product_id;

        const stock =
          number(
            product.stock
          );

        const minimum =
          number(
            product.min_stock ??
            product.minimum_stock ??
            0
          );

        return `
          <tr>

            <td>
              ${escapeHtml(
                product.name ||
                product.product_name ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                product.brand ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                product.supplier_name ||
                product.supplier ||
                ""
              )}
            </td>

            <td>
              ${money(
                product.cost ??
                product.cost_price ??
                0
              )}
            </td>

            <td>
              ${money(
                product.price ??
                product.sale_price ??
                0
              )}
            </td>

            <td class="${
              stock <= minimum
                ? "stock-low"
                : ""
            }">
              ${stock}
            </td>

            <td>
              ${formatDate(
                product.created_at ||
                product.createdAt
              )}
            </td>

            <td class="actions">

              <button
                type="button"
                onclick="editProduct(${id})">
                Editar
              </button>

              <button
                type="button"
                onclick="deleteProduct(${id})">
                Excluir
              </button>

            </td>

          </tr>
        `;

      })
      .join("");
}

function openProductModal(
  product = null
) {

  const form =
    $("productForm");

  if (!form) return;

  form.reset();

  const idField =
    $("productId");

  if (idField) {

    idField.value =
      product?.id ??
      product?.product_id ??
      "";

  }

  if ($("productName")) {

    $("productName").value =
      product?.name ||
      product?.product_name ||
      "";

  }

  if ($("productBrand")) {

    $("productBrand").value =
      product?.brand ||
      "";

  }

  if ($("productSupplier")) {

    $("productSupplier").value =
      product?.supplier_id ??
      product?.supplierId ??
      "";

  }

  if ($("productCode")) {

    $("productCode").value =
      product?.code ||
      "";

  }

  if ($("productSize")) {

    $("productSize").value =
      product?.size ||
      "";

  }

  if ($("productCost")) {

    $("productCost").value =
      product?.cost ??
      product?.cost_price ??
      "";

  }

  if ($("productPrice")) {

    $("productPrice").value =
      product?.price ??
      product?.sale_price ??
      "";

  }

  if ($("productStock")) {

    $("productStock").value =
      product?.stock ??
      0;

  }

  if ($("productMinStock")) {

    $("productMinStock").value =
      product?.min_stock ??
      product?.minimum_stock ??
      0;

  }

  updateSupplierSelects();

  openModal(
    "productModal"
  );
}

function editProduct(id) {

  const product =
    products.find(
      item =>
        Number(
          item.id ??
          item.product_id
        ) === Number(id)
    );

  if (!product) {

    showAlert(
      "Produto não encontrado.",
      "error"
    );

    return;
  }

  openProductModal(
    product
  );
}

async function saveProduct(
  event
) {

  event.preventDefault();

  const id =
    $("productId")?.value ||
    "";

  const body = {

    code:
      $("productCode")
        ?.value
        ?.trim() ||
      "",

    name:
      $("productName")
        ?.value
        ?.trim() ||
      "",

    brand:
      $("productBrand")
        ?.value
        ?.trim() ||
      "",

    size:
      $("productSize")
        ?.value
        ?.trim() ||
      "",

    supplier_id:
      $("productSupplier")
        ?.value ||
      null,

    cost:
      number(
        $("productCost")
          ?.value
      ),

    price:
      number(
        $("productPrice")
          ?.value
      ),

    stock:
      number(
        $("productStock")
          ?.value
      ),

    min_stock:
      number(
        $("productMinStock")
          ?.value
      )

  };

  if (!body.name) {

    showAlert(
      "Informe o nome do produto.",
      "error"
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
          id
            ? "PUT"
            : "POST",
        body
      }
    );

    closeModal(
      "productModal"
    );

    await loadProducts();

    updateProductSelects();

    renderProducts();

    showAlert(
      id
        ? "Produto atualizado."
        : "Produto cadastrado."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível salvar o produto.",
      "error"
    );
  }
}

async function deleteProduct(
  id
) {

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

    updateProductSelects();

    renderProducts();

    showAlert(
      "Produto excluído."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível excluir o produto.",
      "error"
    );
  }
}


/* =========================================================
   CLIENTES
========================================================= */

async function loadClients() {

  try {

    const data =
      await api(
        "/api/clients"
      );

    clients =
      Array.isArray(data)
        ? data
        : (
          data.clients ||
          data.rows ||
          []
        );

    return clients;

  } catch (error) {

    console.error(
      "Erro ao carregar clientes:",
      error
    );

    clients = [];

    throw error;
  }
}

function renderClients() {

  const tbody =
    $("clientsTableBody") ||
    $("clientsBody");

  if (!tbody) return;

  if (!clients.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          Nenhum cliente cadastrado.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    clients
      .map(client => {

        const id =
          client.id ??
          client.client_id;

        return `
          <tr>

            <td>
              ${escapeHtml(
                client.name ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                client.phone ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                client.address ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                client.notes ||
                ""
              )}
            </td>

            <td>
              ${formatDate(
                client.created_at
              )}
            </td>

            <td class="actions">

              <button
                type="button"
                onclick="editClient(${id})">
                Editar
              </button>

              <button
                type="button"
                onclick="deleteClient(${id})">
                Excluir
              </button>

            </td>

          </tr>
        `;

      })
      .join("");
}

function openClientModal(
  client = null
) {

  const form =
    $("clientForm");

  if (!form) return;

  form.reset();

  if ($("clientId")) {

    $("clientId").value =
      client?.id ??
      client?.client_id ??
      "";

  }

  if ($("clientName")) {

    $("clientName").value =
      client?.name ||
      "";

  }

  if ($("clientPhone")) {

    $("clientPhone").value =
      client?.phone ||
      "";

  }

  if ($("clientAddress")) {

    $("clientAddress").value =
      client?.address ||
      "";

  }

  if ($("clientNotes")) {

    $("clientNotes").value =
      client?.notes ||
      "";

  }

  openModal(
    "clientModal"
  );
}

function editClient(id) {

  const client =
    clients.find(
      item =>
        Number(
          item.id ??
          item.client_id
        ) === Number(id)
    );

  if (!client) {

    showAlert(
      "Cliente não encontrado.",
      "error"
    );

    return;
  }

  openClientModal(
    client
  );
}

async function saveClient(
  event
) {

  event.preventDefault();

  const id =
    $("clientId")?.value ||
    "";

  const body = {

    name:
      $("clientName")
        ?.value
        ?.trim() ||
      "",

    phone:
      $("clientPhone")
        ?.value
        ?.trim() ||
      "",

    address:
      $("clientAddress")
        ?.value
        ?.trim() ||
      "",

    notes:
      $("clientNotes")
        ?.value
        ?.trim() ||
      ""

  };

  if (!body.name) {

    showAlert(
      "Informe o nome do cliente.",
      "error"
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
          id
            ? "PUT"
            : "POST",
        body
      }
    );

    closeModal(
      "clientModal"
    );

    await loadClients();

    updateClientSelect();

    renderClients();

    showAlert(
      id
        ? "Cliente atualizado."
        : "Cliente cadastrado."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível salvar o cliente.",
      "error"
    );
  }
}

async function deleteClient(
  id
) {

  if (
    !confirm(
      "Deseja realmente excluir este cliente?"
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

    updateClientSelect();

    renderClients();

    showAlert(
      "Cliente excluído."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível excluir o cliente.",
      "error"
    );
  }
}


/* =========================================================
   FORNECEDORES
========================================================= */

async function loadSuppliers() {

  try {

    const data =
      await api(
        "/api/suppliers"
      );

    suppliers =
      Array.isArray(data)
        ? data
        : (
          data.suppliers ||
          data.rows ||
          []
        );

    return suppliers;

  } catch (error) {

    console.error(
      "Erro ao carregar fornecedores:",
      error
    );

    suppliers = [];

    throw error;
  }
}

function renderSuppliers() {

  const tbody =
    $("suppliersTableBody") ||
    $("suppliersBody");

  if (!tbody) return;

  if (!suppliers.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          Nenhum fornecedor cadastrado.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    suppliers
      .map(supplier => {

        const id =
          supplier.id ??
          supplier.supplier_id;

        return `
          <tr>

            <td>
              ${escapeHtml(
                supplier.name ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                supplier.phone ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                supplier.email ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                supplier.address ||
                ""
              )}
            </td>

            <td>
              ${formatDate(
                supplier.created_at
              )}
            </td>

            <td class="actions">

              <button
                type="button"
                onclick="editSupplier(${id})">
                Editar
              </button>

              <button
                type="button"
                onclick="deleteSupplier(${id})">
                Excluir
              </button>

            </td>

          </tr>
        `;

      })
      .join("");
}

function openSupplierModal(
  supplier = null
) {

  const form =
    $("supplierForm");

  if (!form) return;

  form.reset();

  if ($("supplierId")) {

    $("supplierId").value =
      supplier?.id ??
      supplier?.supplier_id ??
      "";

  }

  if ($("supplierName")) {

    $("supplierName").value =
      supplier?.name ||
      "";

  }

  if ($("supplierPhone")) {

    $("supplierPhone").value =
      supplier?.phone ||
      "";

  }

  if ($("supplierEmail")) {

    $("supplierEmail").value =
      supplier?.email ||
      "";

  }

  if ($("supplierAddress")) {

    $("supplierAddress").value =
      supplier?.address ||
      "";

  }

  if ($("supplierNotes")) {

    $("supplierNotes").value =
      supplier?.notes ||
      "";

  }

  openModal(
    "supplierModal"
  );
}

function editSupplier(id) {

  const supplier =
    suppliers.find(
      item =>
        Number(
          item.id ??
          item.supplier_id
        ) === Number(id)
    );

  if (!supplier) {

    showAlert(
      "Fornecedor não encontrado.",
      "error"
    );

    return;
  }

  openSupplierModal(
    supplier
  );
}

async function saveSupplier(
  event
) {

  event.preventDefault();

  const id =
    $("supplierId")?.value ||
    "";

  const body = {

    name:
      $("supplierName")
        ?.value
        ?.trim() ||
      "",

    phone:
      $("supplierPhone")
        ?.value
        ?.trim() ||
      "",

    email:
      $("supplierEmail")
        ?.value
        ?.trim() ||
      "",

    address:
      $("supplierAddress")
        ?.value
        ?.trim() ||
      "",

    notes:
      $("supplierNotes")
        ?.value
        ?.trim() ||
      ""

  };

  if (!body.name) {

    showAlert(
      "Informe o nome do fornecedor.",
      "error"
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
          id
            ? "PUT"
            : "POST",
        body
      }
    );

    closeModal(
      "supplierModal"
    );

    await loadSuppliers();

    updateSupplierSelects();

    renderSuppliers();

    showAlert(
      id
        ? "Fornecedor atualizado."
        : "Fornecedor cadastrado."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível salvar o fornecedor.",
      "error"
    );
  }
}

async function deleteSupplier(
  id
) {

  if (
    !confirm(
      "Deseja realmente excluir este fornecedor?"
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

    updateSupplierSelects();

    renderSuppliers();

    showAlert(
      "Fornecedor excluído."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível excluir o fornecedor.",
      "error"
    );
  }
}


/* =========================================================
   SELECTS
========================================================= */

function updateProductSelects() {

  const selects =
    qsa(
      "#saleProduct, #purchaseProduct, #stockProduct"
    );

  selects.forEach(
    select => {

      const current =
        select.value;

      select.innerHTML = `
        <option value="">
          Selecione o produto
        </option>
      `;

      products.forEach(
        product => {

          const id =
            product.id ??
            product.product_id;

          const name =
            product.name ||
            product.product_name ||
            "";

          const stock =
            number(
              product.stock
            );

          const option =
            document.createElement(
              "option"
            );

          option.value =
            id;

          option.textContent =
            `${name} — Estoque: ${stock}`;

          select.appendChild(
            option
          );

        }
      );

      if (current) {
        select.value =
          current;
      }

    }
  );
}

function updateClientSelect() {

  const selects =
    qsa(
      "#saleClient"
    );

  selects.forEach(
    select => {

      const current =
        select.value;

      select.innerHTML = `
        <option value="">
          Selecione o cliente
        </option>
      `;

      clients.forEach(
        client => {

          const id =
            client.id ??
            client.client_id;

          const option =
            document.createElement(
              "option"
            );

          option.value =
            id;

          option.textContent =
            client.name ||
            "";

          select.appendChild(
            option
          );

        }
      );

      if (current) {
        select.value =
          current;
      }

    }
  );
}

function updateSupplierSelects() {

  const selects =
    qsa(
      "#productSupplier, #purchaseSupplier"
    );

  selects.forEach(
    select => {

      const current =
        select.value;

      select.innerHTML = `
        <option value="">
          Selecione o fornecedor
        </option>
      `;

      suppliers.forEach(
        supplier => {

          const id =
            supplier.id ??
            supplier.supplier_id;

          const option =
            document.createElement(
              "option"
            );

          option.value =
            id;

          option.textContent =
            supplier.name ||
            "";

          select.appendChild(
            option
          );

        }
      );

      if (current) {
        select.value =
          current;
      }

    }
  );
}


/* =========================================================
   VENDAS
========================================================= */

async function loadSales() {

  try {

    const data =
      await api(
        "/api/sales"
      );

    sales =
      Array.isArray(data)
        ? data
        : (
          data.sales ||
          data.rows ||
          []
        );

    return sales;

  } catch (error) {

    console.error(
      "Erro ao carregar vendas:",
      error
    );

    sales = [];

    throw error;
  }
}


/* =========================================================
   RENDER VENDAS
========================================================= */

function renderSales() {

  const tbody =
    $("salesTableBody") ||
    $("salesBody");

  if (!tbody) return;

  if (!sales.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty">
          Nenhuma venda registrada.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    sales
      .map(sale => {

        const id =
          sale.id ??
          sale.sale_id;

        const total =
          number(
            sale.total
          );

        const entry =
          number(
            sale.entry ??
            sale.paid_amount ??
            0
          );

        const remaining =
          Math.max(
            0,
            total - entry
          );

        const installments =
          Number(
            sale.installments ||
            sale.installment_count ||
            1
          );

        const client =
          sale.client_name ||
          sale.customer_name ||
          "Consumidor";

        const status =
          sale.status ||
          (
            remaining <= 0
              ? "Pago"
              : "Pendente"
          );

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
                client
              )}
            </td>

            <td>
              ${money(total)}
            </td>

            <td>
              ${money(entry)}
            </td>

            <td>
              ${money(remaining)}
            </td>

            <td>
              ${escapeHtml(
                status
              )}
            </td>

            <td>
              ${escapeHtml(
                sale.payment_method ||
                sale.payment ||
                ""
              )}
            </td>

            <td>
              ${installments}
            </td>

            <td class="actions">

              <button
                type="button"
                onclick="viewSale(${id})">
                Ver
              </button>

              <button
                type="button"
                onclick="downloadSalePdf(${id})">
                PDF
              </button>

              ${
                remaining > 0
                  ? `
                    <button
                      type="button"
                      onclick="openSalePayment(${id})">
                      Pagamento
                    </button>
                  `
                  : ""
              }

            </td>

          </tr>
        `;

      })
      .join("");
}

function prepareSalePage() {

  updateProductSelects();

  updateClientSelect();

  renderSaleCart();

  calculateSaleTotals();
}

function addSaleProduct() {

  const productId =
    $("saleProduct")?.value;

  if (!productId) {

    showAlert(
      "Selecione um produto.",
      "error"
    );

    return;
  }

  const product =
    products.find(
      item =>
        Number(
          item.id ??
          item.product_id
        ) === Number(productId)
    );

  if (!product) {

    showAlert(
      "Produto não encontrado.",
      "error"
    );

    return;
  }

  const quantity =
    number(
      $("saleQuantity")?.value ||
      1
    );

  if (quantity <= 0) {

    showAlert(
      "Informe uma quantidade válida.",
      "error"
    );

    return;
  }

  const stock =
    number(
      product.stock
    );

  if (quantity > stock) {

    showAlert(
      `Estoque insuficiente. Disponível: ${stock}.`,
      "error"
    );

    return;
  }

  const existing =
    saleCart.find(
      item =>
        Number(
          item.product_id
        ) ===
        Number(productId)
    );

  if (existing) {

    const newQuantity =
      existing.quantity +
      quantity;

    if (
      newQuantity >
      stock
    ) {

      showAlert(
        `Estoque insuficiente. Disponível: ${stock}.`,
        "error"
      );

      return;
    }

    existing.quantity =
      newQuantity;

  } else {

    saleCart.push({

      product_id:
        Number(productId),

      name:
        product.name ||
        product.product_name ||
        "",

      price:
        number(
          product.price ??
          product.sale_price
        ),

      quantity

    });

  }

  renderSaleCart();

  calculateSaleTotals();

  if ($("saleQuantity")) {

    $("saleQuantity").value =
      1;

  }
}

function removeSaleProduct(
  index
) {

  saleCart.splice(
    Number(index),
    1
  );

  renderSaleCart();

  calculateSaleTotals();
}

function changeSaleQuantity(
  index,
  value
) {

  const item =
    saleCart[index];

  if (!item) return;

  const quantity =
    number(value);

  if (quantity <= 0) {

    removeSaleProduct(
      index
    );

    return;
  }

  const product =
    products.find(
      p =>
        Number(
          p.id ??
          p.product_id
        ) ===
        Number(
          item.product_id
        )
    );

  if (product) {

    const stock =
      number(
        product.stock
      );

    if (
      quantity >
      stock
    ) {

      showAlert(
        `Estoque insuficiente. Disponível: ${stock}.`,
        "error"
      );

      renderSaleCart();

      return;
    }

  }

  item.quantity =
    quantity;

  renderSaleCart();

  calculateSaleTotals();
}

function renderSaleCart() {

  const container =
    $("saleCart") ||
    $("saleItems");

  if (!container) return;

  if (!saleCart.length) {

    container.innerHTML = `
      <div class="empty">
        Nenhum produto adicionado.
      </div>
    `;

    return;
  }

  container.innerHTML =
    saleCart
      .map(
        (item, index) => {

          const subtotal =
            item.quantity *
            item.price;

          return `
            <div class="cart-item">

              <div class="cart-product">
                ${escapeHtml(
                  item.name
                )}
              </div>

              <div class="cart-price">
                ${money(
                  item.price
                )}
              </div>

              <div class="cart-quantity">

                <input
                  type="number"
                  min="1"
                  value="${item.quantity}"
                  onchange="changeSaleQuantity(${index}, this.value)"
                >

              </div>

              <div class="cart-subtotal">
                ${money(
                  subtotal
                )}
              </div>

              <button
                type="button"
                onclick="removeSaleProduct(${index})">
                Remover
              </button>

            </div>
          `;

        }
      )
      .join("");
}

function calculateSaleTotals() {

  const subtotal =
    saleCart.reduce(
      (
        sum,
        item
      ) =>
        sum +
        (
          item.quantity *
          item.price
        ),
      0
    );

  const discount =
    number(
      $("saleDiscount")?.value
    );

  const entry =
    number(
      $("saleEntry")?.value
    );

  const installments =
    Math.max(
      1,
      parseInt(
        $("saleInstallments")
          ?.value ||
        "1",
        10
      )
    );

  const total =
    Math.max(
      0,
      subtotal -
      discount
    );

  const remaining =
    Math.max(
      0,
      total -
      entry
    );

  const installmentValue =
    installments > 0
      ? remaining /
        installments
      : remaining;

  const fields = {

    saleSubtotal:
      subtotal,

    saleTotal:
      total,

    saleRemaining:
      remaining,

    saleReceivable:
      remaining,

    saleInstallmentValue:
      installmentValue

  };

  Object.entries(
    fields
  ).forEach(
    ([id, value]) => {

      const element =
        $(id);

      if (!element) return;

      if (
        element.tagName ===
          "INPUT" ||
        element.tagName ===
          "SELECT"
      ) {

        element.value =
          value.toFixed(2);

      } else {

        element.textContent =
          money(value);

      }

    }
  );

  const totalElement =
    $("saleTotalDisplay");

  if (totalElement) {

    totalElement.textContent =
      money(total);

  }

  const remainingElement =
    $("saleRemainingDisplay");

  if (remainingElement) {

    remainingElement.textContent =
      money(remaining);

  }

  const installmentElement =
    $("saleInstallmentDisplay");

  if (installmentElement) {

    installmentElement.textContent =
      money(
        installmentValue
      );

  }

  return {

    subtotal,

    discount,

    total,

    entry,

    remaining,

    installments,

    installmentValue

  };
}

async function saveSale(
  event
) {

  event.preventDefault();

  if (!saleCart.length) {

    showAlert(
      "Adicione pelo menos um produto à venda.",
      "error"
    );

    return;
  }

  const totals =
    calculateSaleTotals();

  const clientId =
    $("saleClient")?.value ||
    null;

  const paymentMethod =
    $("salePaymentMethod")
      ?.value ||
    $("salePayment")
      ?.value ||
    "Pendente";

  const body = {

    client_id:
      clientId
        ? Number(clientId)
        : null,

    date:
      $("saleDate")?.value ||
      today(),

    discount:
      totals.discount,

    entry:
      totals.entry,

    installments:
      totals.installments,

    payment_method:
      paymentMethod,

    total:
      totals.total,

    items:
      saleCart.map(
        item => ({

          product_id:
            Number(
              item.product_id
            ),

          quantity:
            Number(
              item.quantity
            ),

          price:
            Number(
              item.price
            )

        })
      )

  };

  try {

    await api(
      "/api/sales",
      {
        method: "POST",
        body
      }
    );

    saleCart = [];

    const form =
      $("saleForm");

    if (form) {
      form.reset();
    }

    if ($("saleDate")) {

      $("saleDate").value =
        today();

    }

    renderSaleCart();

    calculateSaleTotals();

    await Promise.allSettled([

      loadSales(),

      loadProducts(),

      loadStock()

    ]);

    updateProductSelects();

    renderProducts();

    renderSales();

    renderStock();

    showAlert(
      "Venda registrada com sucesso."
    );

    showPage(
      "sales"
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível registrar a venda.",
      "error"
    );
  }
}


/* =========================================================
   VISUALIZAR VENDA
========================================================= */

async function viewSale(id) {

  try {

    const data =
      await api(
        `/api/sales/${id}`
      );

    const sale =
      data.sale ||
      data;

    const items =
      data.items ||
      sale.items ||
      [];

    const total =
      number(
        sale.total
      );

    const entry =
      number(
        sale.entry ??
        sale.paid_amount
      );

    const remaining =
      Math.max(
        0,
        total -
        entry
      );

    let html = `

      <div class="details">

        <p>
          <strong>Cliente:</strong>
          ${escapeHtml(
            sale.client_name ||
            sale.customer_name ||
            "Consumidor"
          )}
        </p>

        <p>
          <strong>Data:</strong>
          ${formatDate(
            sale.date ||
            sale.created_at
          )}
        </p>

        <p>
          <strong>Total:</strong>
          ${money(total)}
        </p>

        <p>
          <strong>Entrada:</strong>
          ${money(entry)}
        </p>

        <p>
          <strong>A receber:</strong>
          ${money(remaining)}
        </p>

      </div>

      <h4>Produtos</h4>

      <div class="details-items">
    `;

    if (items.length) {

      html +=
        items
          .map(
            item => {

              const quantity =
                number(
                  item.quantity
                );

              const price =
                number(
                  item.price ??
                  item.unit_price
                );

              return `

                <div class="detail-row">

                  <span>
                    ${escapeHtml(
                      item.product_name ||
                      item.name ||
                      ""
                    )}
                  </span>

                  <span>
                    ${quantity}
                    ×
                    ${money(price)}
                  </span>

                </div>

              `;

            }
          )
          .join("");

    } else {

      html += `
        <p>
          Nenhum item encontrado.
        </p>
      `;

    }

    html += `
      </div>
    `;

    const container =
      $("saleDetails");

    if (container) {

      container.innerHTML =
        html;

    }

    openModal(
      "saleDetailsModal"
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível carregar a venda.",
      "error"
    );
  }
}


/* =========================================================
   PDF DA VENDA
========================================================= */

async function downloadSalePdf(
  id
) {

  try {

    const response =
      await fetch(
        `/api/sales/${id}/pdf`,
        {
          method: "GET",
          credentials: "same-origin"
        }
      );

    if (!response.ok) {

      const text =
        await response.text();

      let message =
        `Erro HTTP ${response.status}`;

      try {

        const data =
          JSON.parse(text);

        message =
          data.error ||
          data.message ||
          message;

      } catch {

        if (text) {
          message = text;
        }

      }

      throw new Error(
        message
      );
    }

    const blob =
      await response.blob();

    const url =
      window.URL.createObjectURL(
        blob
      );

    const link =
      document.createElement(
        "a"
      );

    link.href =
      url;

    link.download =
      `venda-${id}.pdf`;

    document.body.appendChild(
      link
    );

    link.click();

    link.remove();

    window.URL.revokeObjectURL(
      url
    );

  } catch (error) {

    console.error(
      "Erro ao gerar PDF da venda:",
      error
    );

    showAlert(
      error.message ||
      "Não foi possível gerar o PDF da venda.",
      "error"
    );
  }
}


/* =========================================================
   PAGAMENTO DA VENDA
========================================================= */

function openSalePayment(id) {

  currentSaleId =
    Number(id);

  const sale =
    sales.find(
      item =>
        Number(
          item.id ??
          item.sale_id
        ) === Number(id)
    );

  if ($("paymentSaleId")) {

    $("paymentSaleId").value =
      id;

  }

  if ($("paymentAmount")) {

    const total =
      number(
        sale?.total
      );

    const entry =
      number(
        sale?.entry ??
        sale?.paid_amount
      );

    $("paymentAmount").value =
      Math.max(
        0,
        total -
        entry
      ).toFixed(2);

  }

  if ($("paymentDate")) {

    $("paymentDate").value =
      today();

  }

  openModal(
    "paymentModal"
  );
}

async function saveSalePayment(
  event
) {

  event.preventDefault();

  if (!currentSaleId) {

    showAlert(
      "Venda não selecionada.",
      "error"
    );

    return;
  }

  const amount =
    number(
      $("paymentAmount")
        ?.value
    );

  if (amount <= 0) {

    showAlert(
      "Informe um valor de pagamento válido.",
      "error"
    );

    return;
  }

  const body = {

    amount,

    payment_method:
      $("paymentMethod")
        ?.value ||
      $("paymentType")
        ?.value ||
      "Dinheiro",

    date:
      $("paymentDate")
        ?.value ||
      today()

  };

  try {

    await api(
      `/api/sales/${currentSaleId}/payments`,
      {
        method: "POST",
        body
      }
    );

    closeModal(
      "paymentModal"
    );

    currentSaleId =
      null;

    await loadSales();

    renderSales();

    await loadDashboard();

    showAlert(
      "Pagamento registrado."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível registrar o pagamento.",
      "error"
    );
  }
}


/* =========================================================
   ESTOQUE
========================================================= */

async function loadStock() {

  try {

    const data =
      await api(
        "/api/stock"
      );

    stockMoves =
      Array.isArray(data)
        ? data
        : (
          data.stock ||
          data.moves ||
          data.rows ||
          []
        );

    return stockMoves;

  } catch (error) {

    console.error(
      "Erro ao carregar estoque:",
      error
    );

    stockMoves = [];

    return [];
  }
}

function renderStockFromProducts() {

  const tbody =
    $("stockTableBody") ||
    $("stockBody");

  if (!tbody) return;

  if (!products.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty">
          Nenhum produto cadastrado.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    products
      .map(product => {

        const id =
          product.id ??
          product.product_id;

        const stock =
          number(
            product.stock
          );

        const minimum =
          number(
            product.min_stock ??
            product.minimum_stock
          );

        return `
          <tr>

            <td>
              ${escapeHtml(
                product.name ||
                product.product_name ||
                ""
              )}
            </td>

            <td>
              ${escapeHtml(
                product.brand ||
                ""
              )}
            </td>

            <td class="${
              stock <= minimum
                ? "stock-low"
                : ""
            }">
              ${stock}
            </td>

            <td>
              ${minimum}
            </td>

            <td>
              ${money(
                product.cost ??
                product.cost_price
              )}
            </td>

            <td>
              ${money(
                product.price ??
                product.sale_price
              )}
            </td>

            <td class="actions">

              <button
                type="button"
                onclick="openStockModal(${id})">
                Movimentar
              </button>

            </td>

          </tr>
        `;

      })
      .join("");
}

function renderStock() {
  renderStockFromProducts();
}

function openStockModal(
  productId = null
) {

  const form =
    $("stockForm");

  if (form) {
    form.reset();
  }

  if ($("stockProduct")) {

    updateProductSelects();

    if (productId) {

      $("stockProduct").value =
        productId;

    }

  }

  if ($("stockDate")) {

    $("stockDate").value =
      today();

  }

  if ($("stockType")) {

    $("stockType").value =
      "entrada";

  }

  openModal(
    "stockModal"
  );
}

async function saveStockMove(
  event
) {

  event.preventDefault();

  const productId =
    $("stockProduct")?.value;

  const quantity =
    number(
      $("stockQuantity")
        ?.value
    );

  const type =
    $("stockType")?.value ||
    "entrada";

  const note =
    $("stockNote")
      ?.value
      ?.trim() ||
    "";

  if (!productId) {

    showAlert(
      "Selecione o produto.",
      "error"
    );

    return;
  }

  if (quantity <= 0) {

    showAlert(
      "Informe uma quantidade válida.",
      "error"
    );

    return;
  }

  try {

    await api(
      "/api/stock",
      {
        method: "POST",
        body: {

          product_id:
            Number(productId),

          quantity,

          type,

          note,

          date:
            $("stockDate")
              ?.value ||
            today()

        }
      }
    );

    closeModal(
      "stockModal"
    );

    await Promise.allSettled([

      loadProducts(),

      loadStock()

    ]);

    updateProductSelects();

    renderProducts();

    renderStock();

    showAlert(
      "Movimentação registrada."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível registrar a movimentação.",
      "error"
    );
  }
}


/* =========================================================
   COMPRAS
========================================================= */

async function loadPurchases() {

  try {

    const data =
      await api(
        "/api/purchases"
      );

    purchases =
      Array.isArray(data)
        ? data
        : (
          data.purchases ||
          data.rows ||
          []
        );

    return purchases;

  } catch (error) {

    console.error(
      "Erro ao carregar compras:",
      error
    );

    purchases = [];

    throw error;
  }
}

function renderPurchases() {

  const tbody =
    $("purchasesTableBody") ||
    $("purchasesBody");

  if (!tbody) return;

  if (!purchases.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty">
          Nenhuma compra cadastrada.
        </td>
      </tr>
    `;

    updatePurchaseSummary();

    return;
  }

  tbody.innerHTML =
    purchases
      .map(
        purchase => {

          const id =
            purchase.id ??
            purchase.purchase_id;

          const total =
            number(
              purchase.total
            );

          const entry =
            number(
              purchase.entry ??
              purchase.paid_amount ??
              0
            );

          const remaining =
            Math.max(
              0,
              total -
              entry
            );

          const installments =
            Number(
              purchase.installments ||
              purchase.installment_count ||
              1
            );

          const status =
            purchase.status ||
            (
              remaining <= 0
                ? "Pago"
                : "Pendente"
            );

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
                  purchase.supplier ||
                  ""
                )}
              </td>

              <td>
                ${money(total)}
              </td>

              <td>
                ${money(entry)}
              </td>

              <td>
                ${money(remaining)}
              </td>

              <td>
                ${installments}
              </td>

              <td>
                ${escapeHtml(
                  status
                )}
              </td>

              <td>
                ${escapeHtml(
                  purchase.payment_method ||
                  purchase.payment ||
                  ""
                )}
              </td>

              <td class="actions">

                <button
                  type="button"
                  onclick="viewPurchase(${id})">
                  Ver
                </button>

                <button
                  type="button"
                  onclick="downloadPurchasePdf(${id})">
                  PDF
                </button>

                ${
                  remaining > 0
                    ? `
                      <button
                        type="button"
                        onclick="openPurchasePayment(${id})">
                        Pagamento
                      </button>
                    `
                    : ""
                }

              </td>

            </tr>
          `;

        }
      )
      .join("");

  updatePurchaseSummary();
}

function updatePurchaseSummary() {

  const total =
    purchases.reduce(
      (
        sum,
        purchase
      ) =>
        sum +
        number(
          purchase.total
        ),
      0
    );

  const paid =
    purchases.reduce(
      (
        sum,
        purchase
      ) =>
        sum +
        number(
          purchase.entry ??
          purchase.paid_amount
        ),
      0
    );

  const payable =
    Math.max(
      0,
      total -
      paid
    );

  const totalElement =
    $("purchasesTotal");

  const paidElement =
    $("purchasesPaid");

  const payableElement =
    $("purchasesPayable");

  if (totalElement) {

    totalElement.textContent =
      money(total);

  }

  if (paidElement) {

    paidElement.textContent =
      money(paid);

  }

  if (payableElement) {

    payableElement.textContent =
      money(payable);

  }

  const total2 =
    $("purchaseTotalValue");

  const paid2 =
    $("purchasePaidValue");

  const payable2 =
    $("purchasePayableValue");

  if (total2) {

    total2.textContent =
      money(total);

  }

  if (paid2) {

    paid2.textContent =
      money(paid);

  }

  if (payable2) {

    payable2.textContent =
      money(payable);

  }
}

function openPurchaseModal(
  purchase = null
) {

  const form =
    $("purchaseForm");

  if (form) {
    form.reset();
  }

  currentPurchaseId =
    purchase?.id ??
    purchase?.purchase_id ??
    null;

  if ($("purchaseId")) {

    $("purchaseId").value =
      currentPurchaseId ||
      "";

  }

  if ($("purchaseDate")) {

    $("purchaseDate").value =
      purchase?.date ||
      today();

  }

  if ($("purchaseSupplier")) {

    updateSupplierSelects();

    $("purchaseSupplier").value =
      purchase?.supplier_id ||
      "";

  }

  if ($("purchaseEntry")) {

    $("purchaseEntry").value =
      purchase?.entry ??
      0;

  }

  if ($("purchaseInstallments")) {

    $("purchaseInstallments").value =
      purchase?.installments ||
      1;

  }

  if ($("purchaseItems")) {

    $("purchaseItems").innerHTML =
      "";

  }

  calculatePurchaseTotal();

  openModal(
    "purchaseModal"
  );
}

function addPurchaseItem() {

  const productId =
    $("purchaseProduct")?.value;

  if (!productId) {

    showAlert(
      "Selecione o produto.",
      "error"
    );

    return;
  }

  const product =
    products.find(
      item =>
        Number(
          item.id ??
          item.product_id
        ) === Number(productId)
    );

  if (!product) {

    showAlert(
      "Produto não encontrado.",
      "error"
    );

    return;
  }

  const quantity =
    number(
      $("purchaseQuantity")
        ?.value ||
      1
    );

  const price =
    number(
      $("purchaseUnitPrice")
        ?.value ||
      product.cost ||
      product.cost_price ||
      0
    );

  if (quantity <= 0) {

    showAlert(
      "Informe uma quantidade válida.",
      "error"
    );

    return;
  }

  const container =
    $("purchaseItems");

  if (!container) return;

  const existing =
    container.querySelector(
      `[data-product-id="${productId}"]`
    );

  if (existing) {

    const quantityInput =
      existing.querySelector(
        ".purchase-item-quantity"
      );

    if (quantityInput) {

      quantityInput.value =
        number(
          quantityInput.value
        ) +
        quantity;

    }

  } else {

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "purchase-item";

    row.dataset.productId =
      productId;

    row.setAttribute(
      "data-product-id",
      productId
    );

    row.innerHTML = `

      <div class="purchase-item-name">
        ${escapeHtml(
          product.name ||
          product.product_name ||
          ""
        )}
      </div>

      <div>

        <input
          type="number"
          class="purchase-item-quantity"
          min="1"
          value="${quantity}"
          oninput="calculatePurchaseTotal()"
        >

      </div>

      <div>

        <input
          type="number"
          class="purchase-item-price"
          min="0"
          step="0.01"
          value="${price.toFixed(2)}"
          oninput="calculatePurchaseTotal()"
        >

      </div>

      <div class="purchase-item-subtotal">
        ${money(
          quantity * price
        )}
      </div>

      <button
        type="button"
        onclick="
          this.closest('.purchase-item').remove();
          calculatePurchaseTotal();
        ">
        Remover
      </button>

    `;

    container.appendChild(
      row
    );
  }

  calculatePurchaseTotal();

  if ($("purchaseQuantity")) {

    $("purchaseQuantity").value =
      1;

  }

  if ($("purchaseUnitPrice")) {

    $("purchaseUnitPrice").value =
      "";

  }
}

function getPurchaseItems() {

  const container =
    $("purchaseItems");

  if (!container) return [];

  return qsa(
    ".purchase-item",
    container
  )
    .map(
      row => {

        const productId =
          row.dataset.productId;

        const quantity =
          number(
            qs(
              ".purchase-item-quantity",
              row
            )?.value
          );

        const price =
          number(
            qs(
              ".purchase-item-price",
              row
            )?.value
          );

        return {

          product_id:
            Number(productId),

          quantity,

          price

        };

      }
    )
    .filter(
      item =>
        item.product_id &&
        item.quantity > 0
    );
}

function calculatePurchaseTotal() {

  const items =
    getPurchaseItems();

  let total = 0;

  items.forEach(
    item => {

      total +=
        item.quantity *
        item.price;

    }
  );

  const itemsContainer =
    $("purchaseItems");

  if (itemsContainer) {

    qsa(
      ".purchase-item",
      itemsContainer
    ).forEach(
      row => {

        const quantity =
          number(
            qs(
              ".purchase-item-quantity",
              row
            )?.value
          );

        const price =
          number(
            qs(
              ".purchase-item-price",
              row
            )?.value
          );

        const subtotal =
          qs(
            ".purchase-item-subtotal",
            row
          );

        if (subtotal) {

          subtotal.textContent =
            money(
              quantity *
              price
            );

        }

      }
    );

  }

  const entry =
    number(
      $("purchaseEntry")
        ?.value
    );

  const payable =
    Math.max(
      0,
      total -
      entry
    );

  const installments =
    Math.max(
      1,
      parseInt(
        $("purchaseInstallments")
          ?.value ||
        "1",
        10
      )
    );

  const installmentValue =
    payable /
    installments;

  const totalElement =
    $("purchaseTotal");

  if (totalElement) {

    if (
      totalElement.tagName ===
      "INPUT"
    ) {

      totalElement.value =
        total.toFixed(2);

    } else {

      totalElement.textContent =
        money(total);

    }

  }

  const totalDisplay =
    $("purchaseTotalDisplay");

  if (totalDisplay) {

    totalDisplay.textContent =
      money(total);

  }

  const payableDisplay =
    $("purchasePayableDisplay");

  if (payableDisplay) {

    payableDisplay.textContent =
      money(payable);

  }

  const installmentDisplay =
    $("purchaseInstallmentDisplay");

  if (installmentDisplay) {

    installmentDisplay.textContent =
      money(
        installmentValue
      );

  }

  return {

    total,

    entry,

    payable,

    installments,

    installmentValue

  };
}

async function savePurchase(
  event
) {

  event.preventDefault();

  const items =
    getPurchaseItems();

  if (!items.length) {

    showAlert(
      "Adicione pelo menos um produto à compra.",
      "error"
    );

    return;
  }

  const totals =
    calculatePurchaseTotal();

  const supplierId =
    $("purchaseSupplier")
      ?.value ||
    null;

  const body = {

    supplier_id:
      supplierId
        ? Number(supplierId)
        : null,

    date:
      $("purchaseDate")
        ?.value ||
      today(),

    entry:
      totals.entry,

    installments:
      totals.installments,

    payment_method:
      $("purchasePaymentMethod")
        ?.value ||
      $("purchasePayment")
        ?.value ||
      "Pendente",

    total:
      totals.total,

    items

  };

  try {

    await api(
      currentPurchaseId
        ? `/api/purchases/${currentPurchaseId}`
        : "/api/purchases",
      {
        method:
          currentPurchaseId
            ? "PUT"
            : "POST",
        body
      }
    );

    closeModal(
      "purchaseModal"
    );

    currentPurchaseId =
      null;

    await Promise.allSettled([

      loadPurchases(),

      loadProducts(),

      loadStock()

    ]);

    updateProductSelects();

    renderPurchases();

    renderProducts();

    renderStock();

    showAlert(
      "Compra registrada com sucesso."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível salvar a compra.",
      "error"
    );
  }
}

async function viewPurchase(
  id
) {

  try {

    const data =
      await api(
        `/api/purchases/${id}`
      );

    const purchase =
      data.purchase ||
      data;

    const items =
      data.items ||
      purchase.items ||
      [];

    const total =
      number(
        purchase.total
      );

    const entry =
      number(
        purchase.entry ??
        purchase.paid_amount
      );

    const remaining =
      Math.max(
        0,
        total -
        entry
      );

    let html = `

      <div class="details">

        <p>
          <strong>Fornecedor:</strong>
          ${escapeHtml(
            purchase.supplier_name ||
            ""
          )}
        </p>

        <p>
          <strong>Data:</strong>
          ${formatDate(
            purchase.date ||
            purchase.created_at
          )}
        </p>

        <p>
          <strong>Total:</strong>
          ${money(total)}
        </p>

        <p>
          <strong>Entrada:</strong>
          ${money(entry)}
        </p>

        <p>
          <strong>A pagar:</strong>
          ${money(remaining)}
        </p>

      </div>

      <h4>Produtos</h4>

      <div class="details-items">
    `;

    if (items.length) {

      html +=
        items
          .map(
            item => {

              const quantity =
                number(
                  item.quantity
                );

              const price =
                number(
                  item.price ??
                  item.unit_price
                );

              return `

                <div class="detail-row">

                  <span>
                    ${escapeHtml(
                      item.product_name ||
                      item.name ||
                      ""
                    )}
                  </span>

                  <span>
                    ${quantity}
                    ×
                    ${money(price)}
                  </span>

                </div>

              `;

            }
          )
          .join("");

    } else {

      html += `
        <p>
          Nenhum item encontrado.
        </p>
      `;

    }

    html += `
      </div>
    `;

    const container =
      $("purchaseDetails");

    if (container) {

      container.innerHTML =
        html;

    }

    openModal(
      "purchaseDetailsModal"
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível carregar a compra.",
      "error"
    );
  }
}


/* =========================================================
   PDF DA COMPRA
========================================================= */

async function downloadPurchasePdf(
  id
) {

  try {

    const response =
      await fetch(
        `/api/purchases/${id}/pdf`,
        {
          method: "GET",
          credentials: "same-origin"
        }
      );

    if (!response.ok) {

      const text =
        await response.text();

      let message =
        `Erro HTTP ${response.status}`;

      try {

        const data =
          JSON.parse(text);

        message =
          data.error ||
          data.message ||
          message;

      } catch {

        if (text) {
          message = text;
        }

      }

      throw new Error(
        message
      );
    }

    const blob =
      await response.blob();

    const url =
      window.URL.createObjectURL(
        blob
      );

    const link =
      document.createElement(
        "a"
      );

    link.href =
      url;

    link.download =
      `compra-${id}.pdf`;

    document.body.appendChild(
      link
    );

    link.click();

    link.remove();

    window.URL.revokeObjectURL(
      url
    );

  } catch (error) {

    console.error(
      "Erro ao gerar PDF da compra:",
      error
    );

    showAlert(
      error.message ||
      "Não foi possível gerar o PDF da compra.",
      "error"
    );
  }
}


/* =========================================================
   PAGAMENTO DA COMPRA
========================================================= */

function openPurchasePayment(
  id
) {

  currentPurchaseId =
    Number(id);

  const purchase =
    purchases.find(
      item =>
        Number(
          item.id ??
          item.purchase_id
        ) === Number(id)
    );

  if ($("purchasePaymentId")) {

    $("purchasePaymentId").value =
      id;

  }

  if (
    $("purchasePaymentAmount")
  ) {

    const total =
      number(
        purchase?.total
      );

    const entry =
      number(
        purchase?.entry ??
        purchase?.paid_amount
      );

    $("purchasePaymentAmount")
      .value =
      Math.max(
        0,
        total -
        entry
      ).toFixed(2);

  }

  if (
    $("purchasePaymentDate")
  ) {

    $("purchasePaymentDate")
      .value =
      today();

  }

  openModal(
    "purchasePaymentModal"
  );
}

async function savePurchasePayment(
  event
) {

  event.preventDefault();

  if (!currentPurchaseId) {

    showAlert(
      "Compra não selecionada.",
      "error"
    );

    return;
  }

  const amount =
    number(
      $("purchasePaymentAmount")
        ?.value
    );

  if (amount <= 0) {

    showAlert(
      "Informe um valor de pagamento válido.",
      "error"
    );

    return;
  }

  const body = {

    amount,

    payment_method:
      $("purchasePaymentMethod")
        ?.value ||
      $("purchasePaymentType")
        ?.value ||
      "Dinheiro",

    date:
      $("purchasePaymentDate")
        ?.value ||
      today()

  };

  try {

    await api(
      `/api/purchases/${currentPurchaseId}/payments`,
      {
        method: "POST",
        body
      }
    );

    closeModal(
      "purchasePaymentModal"
    );

    currentPurchaseId =
      null;

    await loadPurchases();

    renderPurchases();

    showAlert(
      "Pagamento registrado."
    );

  } catch (error) {

    console.error(error);

    showAlert(
      error.message ||
      "Não foi possível registrar o pagamento.",
      "error"
    );
  }
}


/* =========================================================
   DASHBOARD
========================================================= */

function setText(
  id,
  value
) {

  const element =
    $(id);

  if (!element) return;

  element.textContent =
    value;
}

async function loadDashboard() {

  const totalProducts =
    products.length;

  const totalClients =
    clients.length;

  const totalSales =
    sales.reduce(
      (
        sum,
        sale
      ) =>
        sum +
        number(
          sale.total
        ),
      0
    );

  const totalPurchases =
    purchases.reduce(
      (
        sum,
        purchase
      ) =>
        sum +
        number(
          purchase.total
        ),
      0
    );

  const receivable =
    sales.reduce(
      (
        sum,
        sale
      ) => {

        const total =
          number(
            sale.total
          );

        const paid =
          number(
            sale.entry ??
            sale.paid_amount
          );

        return sum +
          Math.max(
            0,
            total -
            paid
          );

      },
      0
    );

  const payable =
    purchases.reduce(
      (
        sum,
        purchase
      ) => {

        const total =
          number(
            purchase.total
          );

        const paid =
          number(
            purchase.entry ??
            purchase.paid_amount
          );

        return sum +
          Math.max(
            0,
            total -
            paid
          );

      },
      0
    );

  setText(
    "dashboardProducts",
    totalProducts
  );

  setText(
    "dashboardClients",
    totalClients
  );

  setText(
    "dashboardSales",
    money(totalSales)
  );

  setText(
    "dashboardPurchases",
    money(totalPurchases)
  );

  setText(
    "dashboardReceivable",
    money(receivable)
  );

  setText(
    "dashboardPayable",
    money(payable)
  );

  setText(
    "totalProducts",
    totalProducts
  );

  setText(
    "totalClients",
    totalClients
  );

  setText(
    "totalSales",
    money(totalSales)
  );

  setText(
    "totalPurchases",
    money(totalPurchases)
  );

  setText(
    "totalReceivable",
    money(receivable)
  );

  setText(
    "totalPayable",
    money(payable)
  );
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

    renderReports(
      data
    );

  } catch (error) {

    console.error(
      "Erro ao carregar relatórios:",
      error
    );

  }
}

function renderReports(
  data = {}
) {

  const reports =
    data.reports ||
    data;

  const receivables =
    reports.receivables ||
    {};

  const months =
    receivables.months ||
    [];

  const container =
    $("receivablesMonths");

  if (!container) return;

  if (!months.length) {

    container.innerHTML = `
      <div class="empty">
        Nenhum valor previsto.
      </div>
    `;

    return;
  }

  container.innerHTML =
    months
      .slice(0, 3)
      .map(
        month => `

          <div class="report-month">

            <div>
              ${escapeHtml(
                month.label ||
                ""
              )}
            </div>

            <strong>
              ${money(
                month.total
              )}
            </strong>

            <small>
              ${number(
                month.quantity
              )}
              parcela(s)
            </small>

          </div>

        `
      )
      .join("");
}


/* =========================================================
   NOVOS REGISTROS
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

  const form =
    $("saleForm");

  if (form) {
    form.reset();
  }

  if ($("saleDate")) {

    $("saleDate").value =
      today();

  }

  if ($("saleInstallments")) {

    $("saleInstallments")
      .value =
      1;

  }

  if ($("saleEntry")) {

    $("saleEntry").value =
      "0";

  }

  if ($("saleDiscount")) {

    $("saleDiscount").value =
      "0";

  }

  updateProductSelects();

  updateClientSelect();

  renderSaleCart();

  calculateSaleTotals();

  showPage(
    "sales"
  );
}

function newPurchase() {

  currentPurchaseId =
    null;

  openPurchaseModal();
}


/* =========================================================
   EVENTOS
========================================================= */

function setupEvents() {

  $("loginForm")
    ?.addEventListener(
      "submit",
      login
    );

  $("logoutButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        logout();

      }
    );

  qsa(".nav-item")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          function(event) {

            event.preventDefault();

            const page =
              button.dataset.page;

            if (page) {
              showPage(page);
            }

          }
        );

      }
    );

  qsa(".quick-action")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          function(event) {

            event.preventDefault();

            const page =
              button.dataset.page;

            if (page) {
              showPage(page);
            }

          }
        );

      }
    );

  $("newProductButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        newProduct();

      }
    );

  $("newClientButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        newClient();

      }
    );

  $("newSupplierButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        newSupplier();

      }
    );

  $("newStockButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        openStockModal();

      }
    );

  $("newPurchaseButton")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        newPurchase();

      }
    );

  $("productForm")
    ?.addEventListener(
      "submit",
      saveProduct
    );

  $("clientForm")
    ?.addEventListener(
      "submit",
      saveClient
    );

  $("supplierForm")
    ?.addEventListener(
      "submit",
      saveSupplier
    );

  $("saleForm")
    ?.addEventListener(
      "submit",
      saveSale
    );

  $("saleAddProduct")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        addSaleProduct();

      }
    );

  $("saleDiscount")
    ?.addEventListener(
      "input",
      calculateSaleTotals
    );

  $("saleEntry")
    ?.addEventListener(
      "input",
      calculateSaleTotals
    );

  $("saleInstallments")
    ?.addEventListener(
      "input",
      calculateSaleTotals
    );

  $("paymentForm")
    ?.addEventListener(
      "submit",
      saveSalePayment
    );

  $("stockForm")
    ?.addEventListener(
      "submit",
      saveStockMove
    );

  $("purchaseForm")
    ?.addEventListener(
      "submit",
      savePurchase
    );

  $("purchaseAddProduct")
    ?.addEventListener(
      "click",
      function(event) {

        event.preventDefault();

        addPurchaseItem();

      }
    );

  $("purchaseEntry")
    ?.addEventListener(
      "input",
      calculatePurchaseTotal
    );

  $("purchaseInstallments")
    ?.addEventListener(
      "input",
      calculatePurchaseTotal
    );

  $("purchasePaymentForm")
    ?.addEventListener(
      "submit",
      savePurchasePayment
    );

  qsa(
    "[data-close-modal], [data-close]"
  ).forEach(
    button => {

      button.addEventListener(
        "click",
        function(event) {

          event.preventDefault();

          event.stopPropagation();

          const modalId =
            button.dataset.closeModal ||
            button.dataset.close;

          if (modalId) {

            closeModal(
              modalId
            );

          }

        }
      );

    }
  );

  qsa(".modal")
    .forEach(
      modal => {

        modal.addEventListener(
          "click",
          function(event) {

            if (
              event.target ===
              modal
            ) {

              closeModal(
                modal.id
              );

            }

          }
        );

      }
    );

  document.addEventListener(
    "keydown",
    function(event) {

      if (
        event.key ===
        "Escape"
      ) {

        closeAllModals();

      }

    }
  );
}


/* =========================================================
   EXPORTAÇÕES GLOBAIS
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

window.closeAllModals =
  closeAllModals;

window.newProduct =
  newProduct;

window.newClient =
  newClient;

window.newSupplier =
  newSupplier;

window.newSale =
  newSale;

window.newPurchase =
  newPurchase;

window.editProduct =
  editProduct;

window.deleteProduct =
  deleteProduct;

window.editClient =
  editClient;

window.deleteClient =
  deleteClient;

window.editSupplier =
  editSupplier;

window.deleteSupplier =
  deleteSupplier;

window.addSaleProduct =
  addSaleProduct;

window.removeSaleProduct =
  removeSaleProduct;

window.changeSaleQuantity =
  changeSaleQuantity;

window.viewSale =
  viewSale;

window.downloadSalePdf =
  downloadSalePdf;

window.openSalePayment =
  openSalePayment;

window.openStockModal =
  openStockModal;

window.openPurchaseModal =
  openPurchaseModal;

window.addPurchaseItem =
  addPurchaseItem;

window.calculatePurchaseTotal =
  calculatePurchaseTotal;

window.viewPurchase =
  viewPurchase;

window.downloadPurchasePdf =
  downloadPurchasePdf;

window.openPurchasePayment =
  openPurchasePayment;


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async function() {

    try {

      setupEvents();

      if ($("saleDate")) {

        $("saleDate").value =
          today();

      }

      if ($("purchaseDate")) {

        $("purchaseDate").value =
          today();

      }

      if ($("stockDate")) {

        $("stockDate").value =
          today();

      }

      if ($("paymentDate")) {

        $("paymentDate").value =
          today();

      }

      if (
        $("purchasePaymentDate")
      ) {

        $("purchasePaymentDate")
          .value =
          today();

      }

      const authenticated =
        await checkLogin();

      if (authenticated) {

        await loadAll();

        showPage(
          "dashboard"
        );

      }

    } catch (error) {

      console.error(
        "Erro na inicialização:",
        error
      );

      showLogin();

    }

  }
);
