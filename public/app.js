"use strict";

/*
====================================================
ESSÊNCIA & CHARME
APP.JS - PARTE 1/3
====================================================
*/


// ================================
// ESTADO DO SISTEMA
// ================================

let currentUser = {
  nome: "",
  tipo: ""
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



// ================================
// COMUNICAÇÃO COM SERVIDOR
// ================================

async function api(
  url,
  options={}
){

  const config={

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

    config.headers[
      "Content-Type"
    ]="application/json";


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
      await api(
        "/api/me"
      );



    if(
      data.authenticated
    ){


      currentUser = {

        nome:
          data.nome || "",

        tipo:
          data.tipo || ""

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
    $("username")?.value
    ||
    "";



  const password =
    $("password")?.value
    ||
    "";



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



    currentUser={

      nome:
        data.nome || "",

      tipo:
        data.tipo || ""

    };



    showApp();

    atualizarUsuario();


    await carregarTudo();



  }
  catch(error){


    alert(
      error.message
      ||
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
// USUÁRIO NA TELA
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

  return (
    currentUser.tipo ===
    "admin"
  );

}



function isVendedor(){

  return (
    currentUser.tipo ===
    "vendedor"
  );

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

    login.style.display =
      "flex";



  if(app)

    app.style.display =
      "none";


}




function showApp(){


  const login =
    $("loginScreen");


  const app =
    $("app");



  if(login)

    login.style.display =
      "none";



  if(app)

    app.style.display =
      "block";


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


        button.classList.remove(
            "active"
        );


        if(
            button.dataset.page === page
        ){

            button.classList.add(
                "active"
            );

        }


    });



    const titles = {

        dashboard:"🌸 Visão Geral",

        clients:"Clientes",

        products:"Produtos",

        sales:"Vendas",

        stock:"Estoque",

        reports:"Relatórios"

    };


    if(
        document.getElementById(
            "pageTitle"
        )
    ){

        document.getElementById(
            "pageTitle"
        ).textContent =
        titles[page] || page;

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

    carregarVendas()

    carregarPagamentos()

  ]);


}

async function carregarEstoque(){

    try{

        const produtos =
        await api("/api/products");


        const tabela =
        $("stockBody");


        if(!tabela) return;


        tabela.innerHTML =

        produtos.map(produto=>`

        <tr>

            <td>
                ${produto.name}
            </td>


            <td>
                ${produto.stock || 0}
            </td>


            <td>
                ${
                Number(produto.stock) <= Number(produto.min_stock)
                ?
                "⚠️ Baixo"
                :
                "✅ Normal"
                }
            </td>


        </tr>

        `).join("");


    }
    catch(error){

        console.error(
            "Erro estoque:",
            error
        );

    }

}



// ================================
// CLIENTES
// ================================


async function carregarClientes(){


  try{


    const data =
      await api(
        "/api/clients"
      );


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
      error
    );

  }


}

async function buscarClienteVenda(){

    const termo =
    $("globalSearch")?.value.trim();


    if(!termo){

        $("searchResults").innerHTML="";
        return;

    }


    const clientes =
    await api("/api/clients");


    const encontrados =
    clientes.filter(c=>

        c.name
        .toLowerCase()
        .includes(
            termo.toLowerCase()
        )

    );

    $("globalSearch")
?.addEventListener(
"focus",
function(){

this.placeholder =
"Digite o nome do cliente...";

this.style.textAlign =
"left";

}
);


$("globalSearch")
?.addEventListener(
"blur",
function(){

if(!this.value){

this.placeholder =
"BUSCAR";

this.style.textAlign =
"center";

}

}
);

    $("searchResults").innerHTML =

    encontrados.map(c=>`

        <div class="resultado-busca">

            <strong>
            ${c.name}
            </strong>

            <br>

            <span>
            ${c.phone || ""}
            </span>

        </div>

    `).join("");

}



function renderClientes(){


  const tabela =
    $("clientsBody");



  if(!tabela)

    return;



  tabela.innerHTML =
    clients
    .map(
      cliente=>`

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

`
    )
    .join("");



}




// ================================
// PRODUTOS
// ================================


async function carregarProdutos(){


  try{


    const data =
      await api(
        "/api/products"
      );


    products =
      Array.isArray(data)
      ?
      data
      :
      [];


    renderProdutos();


  }
  catch(error){

    console.error(error);

  }


}



function renderProdutos(){


  const tabela =
    $("productsBody");



  if(!tabela)

    return;



  tabela.innerHTML =
    products
    .map(
      produto=>{


        const custo =
        Number(produto.cost || 0);


        const venda =
        Number(produto.price || 0);


        const lucro =
        venda - custo;


        const margem =
        custo > 0
        ?
        ((lucro / custo) * 100).toFixed(1)
        :
        0;



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
${margem}%
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

      }
    )
    .join("");

}





// ================================
// VENDAS
// ================================


async function carregarVendas(){


  try{


    const data =
      await api(
        "/api/sales"
      );


    sales =
      Array.isArray(data)
      ?
      data
      :
      [];


    renderVendas();


  }
  catch(error){

    console.error(error);

  }


}


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


    }catch(error){

        console.error(
            "Erro pagamentos:",
            error
        );

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
p=>Number(p.sale_id)===Number(venda.id)
);


const pago =
lista.reduce(
(total,p)=>
total + Number(p.valor),
0
);


const restante =
Number(venda.total)-pago;



return `

<tr>

<td>
#${venda.id}
</td>


<td>
${venda.client || "Consumidor"}
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
${lista.length ? lista[lista.length-1].data : "-"}
</td>


<td>

${
restante <=0
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

function renderVendas(){


  const tabela =
    $("salesBody");



  if(!tabela)

    return;



  tabela.innerHTML =
    sales
    .map(
      venda=>`

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


`
    )
    .join("");



}




// ================================
// NOVO CLIENTE
// ================================


async function salvarCliente(event){

    if(event){
        event.preventDefault();
    }

    const body = {

        name: $("clientName").value,

        phone: $("clientPhone").value,

        address: $("clientAddress").value,

        notes: $("clientNotes").value

    };


    const id =
$("clientId").value;


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


    closeModal("clientModal");


    alert("Cliente salvo com sucesso");

}





// ================================
// PRODUTO
// ================================


async function salvarProduto(event){

    if(event){
        event.preventDefault();
    }


    const id =
    $("productId")?.value;


    const body = {

        name:
        $("productName").value,


        brand:
        $("productBrand")?.value || "",


        cost:
        Number(
            $("productCost")?.value || 0
        ),


        price:
        Number(
            $("productPrice")?.value || 0
        ),


        stock:
        Number(
            $("productStock")?.value || 0
        )

    };


    console.log(
        "PRODUTO:",
        body
    );


    await api(

        id
        ?
        `/api/products/${id}`
        :
        "/api/products",

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


    await carregarProdutos();


    closeModal(
        "productModal"
    );


    alert(
        "Produto salvo com sucesso"
    );

}





// ================================
// EDITAR CLIENTE
// ================================


function editarCliente(id){

    const cliente =
    clients.find(
        c => Number(c.id) === Number(id)
    );


    if(!cliente){
        return;
    }


    $("clientId").value =
    cliente.id;


    $("clientName").value =
    cliente.name || "";


    $("clientPhone").value =
    cliente.phone || "";


    $("clientAddress").value =
    cliente.address || "";


    $("clientNotes").value =
    cliente.notes || "";


    openClientModal();

}





// ================================
// EDITAR PRODUTO
// ================================


function editarProduto(id){


    const produto =
    products.find(
        p => Number(p.id) === Number(id)
    );


    if(!produto){

        alert("Produto não encontrado");

        return;

    }



    $("productId").value =
    produto.id;



    $("productName").value =
    produto.name || "";



    $("productBrand").value =
    produto.brand || "";



    $("productCost").value =
    produto.cost || 0;



    $("productPrice").value =
    produto.price || 0;



    $("productStock").value =
    produto.stock || 0;



    calcularLucro();



    openProductModal();


}



// ================================
// VER VENDA
// ================================

async function verVenda(id){

    try{

        const response =
        await fetch(
            `/api/sales/${id}/pdf`,
            {
                credentials:"same-origin"
            }
        );


        if(!response.ok){

            throw new Error(
                "Não foi possível gerar o PDF"
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
// INICIALIZAÇÃO
// ================================


window.addEventListener(
"load",

async()=>{


 await checkLogin();


}

);

function newSale(){

    showPage("sales");


    // limpa venda atual
    window.currentSale = {

        client_id:null,

        items:[],

        discount:0,

        payment:"Dinheiro",

        installments:1

    };


    // abre modal de venda
    const modal =
    document.getElementById(
        "saleModal"
    );


    if(modal){

        modal.style.display="flex";

    }


}


function openProductModal(){

    const modal =
    document.getElementById(
        "productModal"
    );


    if(modal){

        modal.style.display="flex";

    }

}


function openClientModal(){

    const modal =
    document.getElementById(
        "clientModal"
    );


    if(modal){

        modal.style.display="flex";

    }

}

// ================================
// EXPORTAR FUNÇÕES
// ================================


window.login =
login;


window.logout =
logout;


window.salvarCliente =
salvarCliente;


window.salvarProduto =
salvarProduto;


window.editarCliente =
editarCliente;


window.editarProduto =
editarProduto;


window.verVenda =
verVenda;

window.openClientModal =
openClientModal;


window.closeModal =
closeModal;

window.newSale =
newSale;


window.openProductModal =
openProductModal;


window.openClientModal =
openClientModal;

window.buscarClienteVenda =
buscarClienteVenda;

window.salvarProduto =
salvarProduto;


window.editarProduto =
editarProduto;

// =====================================================
// PARTE 3/3
// DASHBOARD + PERMISSÕES + FINALIZAÇÃO
// =====================================================



// ================================
// DASHBOARD
// ================================


async function carregarDashboard(){


  try{


    const data =
      await api(
        "/api/dashboard"
      );


    if($("dashboardSales")){

      $("dashboardSales").textContent =
        money(
          data.today?.total || 0
        );

    }


    if($("dashboardStock")){

      $("dashboardStock").textContent =
        data.low || 0;

    }


    if($("dashboardClients")){

      $("dashboardClients").textContent =
        clients.length;

    }



  }
  catch(error){

    console.error(
      "Erro dashboard",
      error
    );

  }


}



// ================================
// APLICAR PERMISSÕES
// ================================


function aplicarPermissoes(){


  const elementosAdmin =
    document.querySelectorAll(
      ".admin-only"
    );



  elementosAdmin.forEach(
    item=>{


      if(isAdmin()){

        item.style.display =
          "";

      }
      else{

        item.style.display =
          "none";

      }


    }
  );



}





// ================================
// NAVEGAÇÃO MENU
// ================================


function configurarMenu(){


 document
 .querySelectorAll(
   "[data-page]"
 )
 .forEach(
 button=>{


 button.addEventListener(
 "click",

 ()=>{


 const page =
 button.dataset.page;


 showPage(page);
if(page === "stock"){

    carregarEstoque();

}

 }

 );


 }

 );


}





// ================================
// BOTÕES
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

 function(e){

 e.preventDefault();

 salvarCliente();

 }

 );

 }

 $("productForm")
?.addEventListener(
"submit",
function(e){

    e.preventDefault();

    salvarProduto(e);

}
);

// ================================
// INICIALIZAÇÃO COMPLETA
// ================================


document.addEventListener(

"DOMContentLoaded",

async()=>{


 configurarEventos();


 configurarMenu();


 const entrou =
 await checkLogin();



 if(entrou){


  await carregarTudo();


  await carregarDashboard();


  aplicarPermissoes();


 }


}

);



// ================================
// EXPORTAÇÕES
// ================================


window.login =
login;


window.logout =
logout;


window.salvarCliente =
salvarCliente;


window.salvarProduto =
salvarProduto;


window.editarCliente =
editarCliente;


window.editarProduto =
editarProduto;


window.verVenda =
verVenda;

window.carregarEstoque =
carregarEstoque;

window.excluirCliente =
excluirCliente;

window.verParcelas =
verParcelas;


window.showPage =
showPage;
function openClientModal(){

    const modal =
    document.getElementById(
        "clientModal"
    );


    if(modal){

        modal.style.display="flex";

    }

}
function closeModal(id){

    const modal =
    document.getElementById(id);


    if(modal){

        modal.style.display="none";

    }

}
async function carregarRelatorios(){

    try{


        const data =
        await api("/api/reports");


        const vendas =
        data.sales || [];


        let total = 0;


        vendas.forEach(venda=>{

            total += Number(
                venda.total || 0
            );

        });



        if($("reportTotalSales")){

            $("reportTotalSales")
            .textContent =
            money(total);

        }



        if($("reportCountSales")){

            $("reportCountSales")
            .textContent =
            vendas.length;

        }



        const tabela =
        $("reportsBody");


        if(tabela){


            tabela.innerHTML =

            vendas.map(v=>`

            <tr>

            <td>
            #${v.id}
            </td>


            <td>
            ${v.client || "Consumidor"}
            </td>


            <td>
            ${money(v.total)}
            </td>


            <td>
            ${v.date || ""}
            </td>


            </tr>

            `).join("");

        }



    }
    catch(error){

        console.error(
            "Erro relatórios:",
            error
        );

    }

}
async function excluirCliente(id){

    if(
        !confirm("Deseja excluir este cliente?")
    ){
        return;
    }


    try{

        await api(
            `/api/clients/${id}`,
            {
                method:"DELETE"
            }
        );


        await carregarClientes();


        alert(
            "Cliente excluído"
        );


    }catch(error){

        console.error(error);

        alert(
            "Erro ao excluir cliente"
        );

    }

}
async function verParcelas(vendaId){

    try{

        const parcelas =
        await api("/api/installments");


        const lista =
        parcelas.filter(
            p => Number(p.sale_id) === Number(vendaId)
        );


        if(!lista.length){

            alert(
                "Essa venda não possui parcelas."
            );

            return;

        }


        let texto =
        "Parcelas da venda:\n\n";


        lista.forEach(p=>{

            texto +=
            `${p.number}/${p.total_installments} - `+
            `${money(p.amount)} - `+
            `${p.paid ? "Pago" : "Pendente"}\n`;

        });


        alert(texto);


    }
    catch(error){

        alert(
            "Erro ao carregar parcelas"
        );

    }

}
function calcularLucro(){

const custo =
Number(
$("productCost").value || 0
);


const venda =
Number(
$("productPrice").value || 0
);


const lucro =
venda - custo;


$("productProfit").textContent =
money(lucro);


$("productMargin").textContent =
custo
?
((lucro / custo)*100).toFixed(1)+"%"
:
"0%";


}
