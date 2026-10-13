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

    return currentUser.tipo==="admin";

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
            "Erro ao excluir venda"
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


    if(event)

        event.preventDefault();



    const id =
    $("productId")?.value;



    const body={


        name:
        $("productName").value,


        brand:
        $("productBrand").value || "",


        cost:
        Number(
            $("productCost").value || 0
        ),


        price:
        Number(
            $("productPrice").value || 0
        ),


        stock:
        Number(
            $("productStock").value || 0
        )


    };



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
        "Produto salvo"
    );


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



    const entrou =
    await checkLogin();



    if(entrou){


        await carregarTudo();


        await carregarDashboard();


        aplicarPermissoes();


    }



});




// ================================
// NOVA VENDA
// ================================

function newSale(){

    showPage("sales");


    window.currentSale = {

        client_id:null,

        items:[],

        discount:0,

        payment:"Dinheiro",

        installments:1

    };


    const modal =
    document.getElementById(
        "saleModal"
    );


    if(modal){

        modal.style.display="flex";

    }
    else{

        console.error(
            "Modal de venda não encontrado: saleModal"
        );

        alert(
            "Erro: tela de venda não encontrada"
        );

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


window.openClientModal =
openClientModal;


window.openProductModal =
openProductModal;


window.openPaymentModal =
openPaymentModal;


window.savePayment =
savePayment;


window.pdfPagamento =
pdfPagamento;


window.closeModal =
closeModal;


window.verVenda =
verVenda;


window.verParcelas =
verParcelas;


window.excluirVenda =
excluirVenda;


window.showPage =
showPage;

window.newSale = newSale;
