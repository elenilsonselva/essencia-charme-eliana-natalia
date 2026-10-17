"use strict";

/*
====================================================
ESSÊNCIA & CHARME
APP.JS - CORRIGIDO
====================================================
*/


// ================================
// ESTADO DO SISTEMA
// ================================


let currentUser = {

    nome:"",
    tipo:""

};


let clients = [];

let products = [];

let sales = [];

let payments = [];




// ================================
// HELPERS
// ================================


function $(id){

    return document.getElementById(id);

}



function money(value){

    return Number(value || 0)
    .toLocaleString(
        "pt-BR",
        {
            style:"currency",
            currency:"BRL"
        }
    );

}



function escapeHtml(value){

    return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");

}




// Funções de interface que estavam ausentes no pacote original.
function openClientModal() {
  const form = $("clientForm");
  if (form) form.reset();
  if ($("clientId")) $("clientId").value = "";
  if ($("clientModal")) $("clientModal").style.display = "flex";
}
function openProductModal() {
  const form = $("productForm");
  if (form) form.reset();
  if ($("productId")) $("productId").value = "";
  calcularLucro();
  if ($("productModal")) $("productModal").style.display = "flex";
}
function calcularLucro() {
  const cost = Number($("productCost")?.value || 0);
  const price = Number($("productPrice")?.value || 0);
  if ($("productProfit")) $("productProfit").textContent = money(price - cost);
  if ($("productMargin")) $("productMargin").textContent = (price > 0 ? ((price-cost)/price*100) : 0).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + "%";
}
async function editarProduto(id) {
  const item = products.find(p => Number(p.id) === Number(id));
  if (!item) return;
  $("productId").value = item.id;
  $("productName").value = item.name || "";
  $("productBrand").value = item.brand || "";
  $("productCost").value = item.cost || 0;
  $("productPrice").value = item.price || 0;
  $("productStock").value = item.stock || 0;
  calcularLucro();
  $("productModal").style.display = "flex";
}
async function editarCliente(id) {
  const item = clients.find(c => Number(c.id) === Number(id));
  if (!item) return;
  $("clientId").value = item.id;
  $("clientName").value = item.name || "";
  $("clientPhone").value = item.phone || "";
  $("clientAddress").value = item.address || "";
  $("clientNotes").value = item.notes || "";
  $("clientModal").style.display = "flex";
}
async function excluirCliente(id) {
  if (!confirm("Deseja excluir este cliente?")) return;
  try { await api(`/api/clients/${id}`, {method:"DELETE"}); await carregarClientes(); }
  catch (e) { alert(e.message); }
}
async function carregarDashboard() {
  try {
    const d = await api("/api/dashboard");
    if ($("dashboardSales")) $("dashboardSales").textContent = money(d.today?.total || 0);
    if ($("dashboardClients")) $("dashboardClients").textContent = String(clients.length);
    if ($("dashboardStock")) $("dashboardStock").textContent = String(d.low || 0);
    if ($("dashboardRevenue")) $("dashboardRevenue").textContent = money(d.today?.total || 0);
  } catch (e) { console.warn("Dashboard:", e.message); }
}
function aplicarPermissoes() {
  document.querySelectorAll(".admin-only").forEach(el => { el.style.display = isAdmin() ? "" : "none"; });
}
async function carregarRelatorios() {
  try {
    const d = await api("/api/reports");
    const list = d.sales || [];
    if ($("reportSales")) $("reportSales").textContent = money(list.reduce((sum, v) => sum + Number(v.total || 0), 0));
    if ($("reportInstallments")) {
      const inst = await api("/api/installments");
      $("reportInstallments").textContent = money(inst.filter(i => !i.paid).reduce((sum, i) => sum + Number(i.amount || 0), 0));
    }
  } catch (e) { console.warn("Relatórios:", e.message); }
}

// ================================
// COMUNICAÇÃO COM SERVIDOR
// ================================


async function api(url, options={}){


    const config = {

        credentials:"same-origin",

        ...options,


        headers:{
            ...(options.headers || {})
        }

    };



    if(
        config.body &&
        typeof config.body !== "string"
    ){

        config.headers["Content-Type"] =
        "application/json";


        config.body =
        JSON.stringify(config.body);

    }



    const response =
    await fetch(
        url,
        config
    );



    const data =
    await response
    .json()
    .catch(
        ()=>({})
    );



    if(!response.ok){

        throw new Error(
            data.error ||
            "Erro no servidor"
        );

    }



    return data;


}





// ================================
// LOGIN
// ================================


async function checkLogin(){


    try{


        const data =
        await api("/api/me");



        if(data.authenticated){


            currentUser = {

                nome:data.nome || "",

                tipo:data.tipo || ""

            };



            showApp();

            atualizarUsuario();



            return true;

        }


    }
    catch(error){

        console.error(error);

    }



    showLogin();

    return false;


}





async function login(event){


    if(event){

        event.preventDefault();

    }



    const username =
    $("username")?.value || "";



    const password =
    $("password")?.value || "";



    try{


        const data =
        await api(
            "/api/login",
            {

                method:"POST",

                body:{

                    username,

                    password

                }

            }
        );



        currentUser = {

            nome:data.nome || "",

            tipo:data.tipo || ""

        };



        showApp();

        atualizarUsuario();


        await carregarTudo();



    }
    catch(error){


        alert(
            error.message ||
            "Login inválido"
        );


    }


}





async function logout(){


    await api(
        "/api/logout",
        {
            method:"POST"
        }
    )
    .catch(()=>{});



    currentUser={

        nome:"",

        tipo:""

    };



    showLogin();


}





// ================================
// USUÁRIO
// ================================


function atualizarUsuario(){


    const element =
    $("loggedUser");



    if(element){

        element.textContent =
        currentUser.nome
        ?
        `Olá, ${currentUser.nome}`
        :
        "";

    }


}




// ================================
// PERMISSÕES
// ================================


function isAdmin(){
    return currentUser.tipo === "admin" || currentUser.nome === "admin";
}


function isVendedor(){

    return currentUser.tipo==="vendedor";

}




// ================================
// TELA
// ================================


function showLogin(){


    const login =
    $("loginScreen");


    const app =
    $("app");



    if(login)

        login.style.display="flex";



    if(app)

        app.style.display="none";


}




function showApp(){


    const login =
    $("loginScreen");


    const app =
    $("app");



    if(login)

        login.style.display="none";



    if(app)

        app.style.display="block";


}




// ================================
// NAVEGAÇÃO
// ================================


function showPage(page){


    document
    .querySelectorAll(".page")
    .forEach(section=>{

        section.classList.remove("active");

    });



    const target =
    document.getElementById(
        `page-${page}`
    );



    if(target){

        target.classList.add("active");

    }




    document
    .querySelectorAll(".nav-item")
    .forEach(button=>{


        button.classList.remove("active");


        if(button.dataset.page===page){

            button.classList.add("active");

        }


    });




    const titles={


        dashboard:"🌸 Visão Geral",

        clients:"Clientes",

        products:"Produtos",

        sales:"Vendas",

        payments:"Pagamentos",

        stock:"Estoque",

        reports:"Relatórios"


    };



    if($("pageTitle")){


        $("pageTitle").textContent =
        titles[page] || page;


    }



    if(page==="payments"){

        renderPagamentos();

    }



    if(page==="reports"){

        carregarRelatorios();

    }



}
// ================================
// CARREGAMENTO
// ================================


async function carregarTudo(){


    await Promise.allSettled([


        carregarClientes(),

        carregarProdutos(),

        carregarVendas(),

        carregarPagamentos()


    ]);


}




// ================================
// CLIENTES
// ================================


async function carregarClientes(){


    try{


        const data =
        await api("/api/clients");



        clients =
        Array.isArray(data)
        ?
        data
        :
        [];



        renderClientes();


    }
    catch(error){

        console.error(
            "Erro clientes:",
            error
        );

    }


}





function renderClientes(){


    const tabela =
    $("clientsBody");



    if(!tabela)

        return;



    tabela.innerHTML =

    clients.map(cliente=>`


        <tr>


        <td>

        ${escapeHtml(cliente.name)}

        </td>


        <td>

        ${escapeHtml(cliente.phone || "")}

        </td>


        <td>


        <button onclick="editarCliente(${cliente.id})">

        Editar

        </button>


        <button onclick="excluirCliente(${cliente.id})">

        Excluir

        </button>


        </td>


        </tr>


    `).join("");


}





// ================================
// PRODUTOS
// ================================


async function carregarProdutos(){


    try{


        const data =
        await api("/api/products");



        products =
        Array.isArray(data)
        ?
        data
        :
        [];



        renderProdutos();


    }
    catch(error){

        console.error(
            "Erro produtos:",
            error
        );

    }


}





function renderProdutos(){


    const tabela =
    $("productsBody");



    if(!tabela)

        return;



    tabela.innerHTML =


    products.map(produto=>{


        const custo =
        Number(produto.cost || 0);


        const venda =
        Number(produto.price || 0);


        const lucro =
        venda - custo;



        return `


        <tr>


        <td>

        ${escapeHtml(produto.name)}

        </td>



        <td>

        ${escapeHtml(produto.brand || "")}

        </td>



        <td>

        ${money(custo)}

        </td>



        <td>

        ${money(venda)}

        </td>



        <td>

        ${money(lucro)}

        </td>



        <td>

        ${produto.stock || 0}

        </td>



        <td>


        <button onclick="editarProduto(${produto.id})">

        Editar

        </button>


        </td>


        </tr>


        `;


    }).join("");


}






// ================================
// VENDAS
// ================================


async function carregarVendas(){


    try{


        const data =
        await api("/api/sales");



        sales =
        Array.isArray(data)
        ?
        data
        :
        [];



        renderVendas();


    }
    catch(error){

        console.error(
            "Erro vendas:",
            error
        );

    }


}






function renderVendas(){


    const tabela =
    $("salesBody");



    if(!tabela)

        return;



    tabela.innerHTML =


    sales.map(venda=>`


    <tr>


    <td>

    #${venda.id}

    </td>



    <td>

    ${escapeHtml(

        venda.client ||
        venda.client_name ||
        "Consumidor"

    )}

    </td>



    <td>

    ${money(venda.total)}

    </td>



    <td>



    <button onclick="verVenda(${venda.id})">

    Ver

    </button>



    <button onclick="verParcelas(${venda.id})">

    Parcelas

    </button>



    <button onclick="excluirVenda(${venda.id})">

    Excluir

    </button>



    </td>


    </tr>


    `).join("");


}






// ================================
// PAGAMENTOS
// ================================



async function carregarPagamentos(){


    try{


        const data =
        await api("/api/payments");



        payments =
        Array.isArray(data)
        ?
        data
        :
        [];



        renderPagamentos();


    }
    catch(error){


        console.warn(
            "Pagamentos ainda não disponíveis:",
            error.message
        );


        payments=[];


    }


}






function renderPagamentos(){


    const tabela =
    $("paymentsBody");



    if(!tabela)

        return;




    tabela.innerHTML =



    sales.map(venda=>{


        const lista =

        payments.filter(

            p=>

            Number(p.sale_id) ===
            Number(venda.id)

        );



        const pago =


        lista.reduce(

            (total,p)=>

            total +
            Number(
                p.valor || 0
            ),

            0

        );



        const restante =

        Number(venda.total) -
        pago;



        const ultimo =

        lista.length

        ?

        lista[lista.length-1].data

        :

        "-";




        return `


        <tr>


        <td>

        #${venda.id}

        </td>



        <td>

        ${escapeHtml(
            venda.client ||
            venda.client_name ||
            "Consumidor"
        )}

        </td>



        <td>

        ${money(venda.total)}

        </td>



        <td>

        ${money(pago)}

        </td>



        <td>

        ${money(restante)}

        </td>



        <td>

        ${ultimo}

        </td>



        <td>

        ${
            restante <= 0

            ?

            "✅ Pago"

            :

            "⏳ Pendente"

        }

        </td>



        <td>


        <button onclick="openPaymentModal(${venda.id})">

        + Pagamento

        </button>



        </td>



        </tr>


        `;



    }).join("");

}






// ================================
// EXCLUIR VENDA
// ================================



async function excluirVenda(id){


    if(
        !confirm(
            "Deseja realmente excluir esta venda?"
        )
    ){

        return;

    }




    try{


        await api(

            `/api/sales/${id}`,

            {

                method:"DELETE"

            }

        );



        await carregarVendas();



        alert(
            "Venda excluída com sucesso"
        );


    }
    catch(error){


        console.error(error);


        alert(
            error.message || "Erro ao excluir venda"
        );


    }


}
// ================================
// PAGAMENTO MODAL
// ================================


function openPaymentModal(vendaId){


    const venda =
    sales.find(
        v =>
        Number(v.id) === Number(vendaId)
    );



    if(!venda)

        return;



    if($("paymentSaleId"))

        $("paymentSaleId").value =
        venda.id;



    if($("paymentClient"))

        $("paymentClient").value =
        venda.client ||
        venda.client_name ||
        "Consumidor";



    if($("paymentDate"))

        $("paymentDate").value =
        new Date()
        .toISOString()
        .split("T")[0];



    const modal =
    $("paymentModal");



    if(modal)

        modal.style.display="flex";


}





async function savePayment(){


    const body = {


        sale_id:

        Number(
            $("paymentSaleId").value
        ),



        valor:

        Number(
            $("paymentValue").value || 0
        ),



        forma:

        $("paymentMethod").value,



        data:

        $("paymentDate").value,



        observacao:

        $("paymentNote").value || ""


    };



    if(body.valor <= 0){

        alert(
            "Informe um valor válido"
        );

        return;

    }



    try{


        await api(

            "/api/payments",

            {

                method:"POST",

                body

            }

        );



        await carregarPagamentos();



        closeModal(
            "paymentModal"
        );



        alert(
            "Pagamento registrado com sucesso"
        );


    }
    catch(error){


        alert(
            error.message ||
            "Erro ao salvar pagamento"
        );


    }


}





// ================================
// PDF PAGAMENTO
// ================================



async function pdfPagamento(id){


    try{


        const response =

        await fetch(

            `/api/payments/${id}/pdf`,

            {

                credentials:"same-origin"

            }

        );



        if(!response.ok){

            throw new Error(
                "Não foi possível gerar PDF"
            );

        }



        const blob =
        await response.blob();



        const url =
        URL.createObjectURL(blob);



        window.open(
            url,
            "_blank"
        );


    }
    catch(error){


        alert(
            error.message
        );


    }


}






// ================================
// CLIENTE
// ================================



async function salvarCliente(event){


    if(event)

        event.preventDefault();



    const id =
    $("clientId").value;



    const body={


        name:

        $("clientName").value,



        phone:

        $("clientPhone").value,



        address:

        $("clientAddress").value,



        notes:

        $("clientNotes").value


    };



    await api(

        id

        ?

        `/api/clients/${id}`

        :

        "/api/clients",

        {

            method:
            id
            ?
            "PUT"
            :
            "POST",


            body

        }

    );



    await carregarClientes();



    closeModal(
        "clientModal"
    );



    alert(
        "Cliente salvo"
    );


}





// ================================
// PRODUTO
// ================================


async function salvarProduto(event){
  if(event) event.preventDefault();
  const id = $("productId")?.value;
  const body = {
    name: $("productName").value.trim(),
    brand: $("productBrand").value || "",
    cost: Number($("productCost").value || 0),
    price: Number($("productPrice").value || 0),
    stock: Number($("productStock").value || 0)
  };
  if (!body.name) return alert("Informe o nome do produto.");
  try {
    await api(id ? `/api/products/${id}` : "/api/products", {method:id ? "PUT" : "POST", body});
    await carregarProdutos();
    closeModal("productModal");
    alert("Produto salvo com sucesso.");
  } catch (error) { alert("Não foi possível salvar o produto: " + error.message); }
}



// ================================
// FECHAR MODAL
// ================================


function closeModal(id){


    const modal =
    $(id);



    if(modal)

        modal.style.display="none";


}






// ================================
// CONFIGURAÇÃO MENU
// ================================


function configurarMenu(){


    document
    .querySelectorAll("[data-page]")
    .forEach(button=>{


        button.addEventListener(

            "click",

            ()=>{


                showPage(
                    button.dataset.page
                );


            }

        );


    });


}






// ================================
// EVENTOS
// ================================



function configurarEventos(){



    $("loginForm")
    ?.addEventListener(
        "submit",
        login
    );



    $("logoutButton")
    ?.addEventListener(
        "click",
        logout
    );



    $("clientForm")
    ?.addEventListener(

        "submit",

        salvarCliente

    );



    $("productForm")
    ?.addEventListener(

        "submit",

        salvarProduto

    );


}






// ================================
// INICIALIZAÇÃO
// ================================



document.addEventListener(

"DOMContentLoaded",

async()=>{


    configurarEventos();


    configurarMenu();
    $("saleDiscount")?.addEventListener("input", renderItensVenda);

    const entrou =
    await checkLogin();



    if(entrou){


        await carregarTudo();


        await carregarDashboard();


        aplicarPermissoes();


    }



});




// ================================
// NOVA VENDA E CONSULTA
// ================================
let saleDraftItems = [];
function newSale() {
  saleDraftItems = [];
  showPage("sales");
  const form = $("saleForm"); if (form) form.reset();
  if ($("saleDiscount")) $("saleDiscount").value = "0";
  preencherSelectsVenda(); renderItensVenda();
  const modal = $("saleModal");
  if (modal) modal.style.display = "flex";
  else alert("A tela de nova venda não foi carregada. Atualize a página.");
}
function preencherSelectsVenda() {
  if ($("saleClient")) $("saleClient").innerHTML = '<option value="">Consumidor</option>' + clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if ($("saleProduct")) $("saleProduct").innerHTML = '<option value="">Selecione um produto</option>' + products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${money(p.price)} (estoque: ${Number(p.stock||0)})</option>`).join("");
}
function adicionarItemVenda() {
  const id = Number($("saleProduct")?.value);
  const qty = Number($("saleQty")?.value || 1);
  const product = products.find(p => Number(p.id) === id);
  if (!product) return alert("Cadastre ou selecione um produto.");
  if (!Number.isInteger(qty) || qty < 1) return alert("Informe uma quantidade válida.");
  const existing = saleDraftItems.find(i => i.product_id === id);
  const totalQty = qty + (existing?.qty || 0);
  if (totalQty > Number(product.stock || 0)) return alert(`Estoque insuficiente para ${product.name}. Disponível: ${product.stock || 0}.`);
  if (existing) existing.qty = totalQty; else saleDraftItems.push({product_id:id, qty});
  renderItensVenda();
}
function renderItensVenda() {
  const box = $("saleItemsList");
  let subtotal = 0;
  if (box) box.innerHTML = saleDraftItems.length ? saleDraftItems.map(item => {
    const p = products.find(x => Number(x.id) === item.product_id);
    const line = Number(p?.price || 0) * item.qty; subtotal += line;
    return `<div class="sale-item-row"><span>${escapeHtml(p?.name || "Produto removido")} × ${item.qty}</span><strong>${money(line)}</strong><button type="button" onclick="removerItemVenda(${item.product_id})">Remover</button></div>`;
  }).join("") : "Nenhum produto adicionado.";
  const total = Math.max(0, subtotal - Number($("saleDiscount")?.value || 0));
  if ($("saleTotal")) $("saleTotal").textContent = money(total);
}
function removerItemVenda(id) { saleDraftItems = saleDraftItems.filter(i => i.product_id !== Number(id)); renderItensVenda(); }
async function salvarVenda(event) {
  if (event) event.preventDefault();
  if (!saleDraftItems.length) return alert("Adicione pelo menos um produto à venda.");
  const body = {
    client_id: $("saleClient")?.value || null,
    items: saleDraftItems,
    discount: Number($("saleDiscount")?.value || 0),
    payment: $("salePayment")?.value || "Dinheiro",
    installments: Number($("saleInstallments")?.value || 1),
    first_due_date: $("saleDueDate")?.value || new Date().toISOString().slice(0,10)
  };
  try {
    await api("/api/sales", {method:"POST", body});
    closeModal("saleModal");
    await Promise.all([carregarVendas(), carregarProdutos(), carregarDashboard()]);
    saleDraftItems = [];
    alert("Venda registrada com sucesso.");
  } catch (e) { alert("Não foi possível registrar a venda: " + e.message); }
}
async function verVenda(id) {
  try {
    const data = await api(`/api/sales/${id}/details`);
    const v = data.sale;
    const linhas = (data.items || []).map(i => `• ${i.name || "Produto"} × ${i.qty} — ${money(Number(i.price||0)*Number(i.qty||0))}`).join("\n") || "Nenhum item detalhado.";
    alert(`VENDA #${v.id}\nCliente: ${v.client || "Consumidor"}\nData: ${v.date ? new Date(v.date).toLocaleString("pt-BR") : "—"}\n\n${linhas}\n\nDesconto: ${money(v.discount)}\nTOTAL: ${money(v.total)}\nPagamento: ${v.payment || "—"}\nParcelas: ${v.installments || 1}`);
  } catch (e) { alert("Não foi possível abrir a venda: " + e.message); }
}
async function verParcelas(id) {
  try {
    const rows = await api(`/api/installments?sale_id=${id}`);
    if (!rows.length) return alert(`A venda #${id} não possui parcelas cadastradas. Vendas à vista não geram parcelas.`);
    alert(`PARCELAS DA VENDA #${id}\n\n` + rows.map(p => `${p.number}/${p.total_installments} — ${money(p.amount)} — vencimento ${new Date(`${p.due_date}T12:00:00`).toLocaleDateString("pt-BR")} — ${p.paid ? "PAGA" : "EM ABERTO"}`).join("\n"));
  } catch (e) { alert("Não foi possível consultar as parcelas: " + e.message); }
}

// Exportar funções usadas pelos botões inline.
window.login = login;
window.logout = logout;
window.salvarCliente = salvarCliente;
window.salvarProduto = salvarProduto;
window.openClientModal = openClientModal;
window.openProductModal = openProductModal;
window.openPaymentModal = openPaymentModal;
window.savePayment = savePayment;
window.pdfPagamento = pdfPagamento;
window.closeModal = closeModal;
window.verVenda = verVenda;
window.verParcelas = verParcelas;
window.excluirVenda = excluirVenda;
window.showPage = showPage;
window.newSale = newSale;
window.salvarVenda = salvarVenda;
window.adicionarItemVenda = adicionarItemVenda;
window.removerItemVenda = removerItemVenda;
window.calcularLucro = calcularLucro;
window.editarProduto = editarProduto;
window.editarCliente = editarCliente;
window.excluirCliente = excluirCliente;

