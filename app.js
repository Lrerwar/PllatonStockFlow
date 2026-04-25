// =============================================
// STOCKFLOW PRO — APP.JS v4
// Insumos · Produtos · Receitas (BOM) · Pedidos
// Produção · Movimentações · Whitelist · Gráfico
// =============================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
  getDoc, setDoc, getDocs, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =============================================
// COLEÇÕES
// =============================================
const C = {
  insumos:       collection(db, "compartilhado", "principal", "insumos"),
  produtos:      collection(db, "compartilhado", "principal", "produtos"),
  receitas:      collection(db, "compartilhado", "principal", "receitas"),
  pedidos:       collection(db, "compartilhado", "principal", "pedidos"),
  movimentacoes: collection(db, "compartilhado", "principal", "movimentacoes"),
};
const DOC_CONFIG = doc(db, "compartilhado", "config");

// =============================================
// STATE
// =============================================
let currentUser       = null;
let isAdmin           = false;
let adminEmail        = "";
let emailsPermitidos  = [];

let insumos           = [];
let produtos          = [];
let receitas          = [];
let pedidos           = [];
let movimentacoes     = [];

let receitaMateriais  = [];   // temp p/ modal receita
let pendingPedidoId   = null;
let pedidosFiltro     = "pendente";
let chartPeriod       = "semana";
let dashChartInstance = null;

let unsubs = {};

// =============================================
// AUTH
// =============================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null; isAdmin = false;
    Object.values(unsubs).forEach(u => u && u());
    unsubs = {};
    showScreen("login-screen");
    return;
  }
  currentUser = user;
  const email = user.email?.toLowerCase() || "";

  const configSnap = await getDoc(DOC_CONFIG);
  let config = configSnap.exists() ? configSnap.data() : null;
  if (!config) {
    config = { admin: email, permitidos: [email] };
    await setDoc(DOC_CONFIG, config);
  }
  adminEmail      = config.admin || "";
  emailsPermitidos = config.permitidos || [];
  isAdmin         = email === adminEmail;

  if (!emailsPermitidos.includes(email) && !isAdmin) {
    showScreen("denied-screen"); return;
  }

  document.getElementById("user-display").textContent = user.displayName || email;
  document.getElementById("nav-admin-li").style.display = isAdmin ? "" : "none";
  showScreen("app-screen");
  subscribeAll();
  subscribeConfig();
});

window.login = async () => {
  const email = v("login-email"), pass = v("login-password");
  const err   = document.getElementById("login-error");
  err.textContent = "";
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { err.textContent = friendlyError(e.code); }
};

window.register = async () => {
  const name = v("reg-name"), email = v("reg-email"), pass = v("reg-password");
  const err  = document.getElementById("reg-error");
  err.textContent = "";
  if (!name) { err.textContent = "Informe um nome."; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    showToast("Conta criada!", "success");
  } catch (e) { err.textContent = friendlyError(e.code); }
};

window.logout = () => signOut(auth);

function friendlyError(c) {
  return ({
    "auth/invalid-email":        "E-mail inválido.",
    "auth/user-not-found":       "Usuário não encontrado.",
    "auth/wrong-password":       "Senha incorreta.",
    "auth/email-already-in-use": "E-mail já cadastrado.",
    "auth/weak-password":        "Senha fraca (mín. 6 chars).",
    "auth/invalid-credential":   "E-mail ou senha incorretos."
  }[c]) || "Erro ao autenticar.";
}

// =============================================
// WHITELIST ADMIN
// =============================================
function subscribeConfig() {
  unsubs.config = onSnapshot(DOC_CONFIG, snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    emailsPermitidos = d.permitidos || [];
    adminEmail       = d.admin || "";
    renderAdminEmails();
  });
}

window.adicionarEmail = async () => {
  if (!isAdmin) return;
  const input = document.getElementById("admin-email-input");
  const email = input.value.trim().toLowerCase();
  if (!email.includes("@")) { showToast("E-mail inválido.", "error"); return; }
  if (emailsPermitidos.includes(email)) { showToast("Já autorizado.", "error"); return; }
  await setDoc(DOC_CONFIG, { admin: adminEmail, permitidos: [...emailsPermitidos, email] });
  input.value = "";
  showToast("E-mail adicionado!", "success");
};

window.removerEmail = async (email) => {
  if (!isAdmin || email === adminEmail) return;
  await setDoc(DOC_CONFIG, { admin: adminEmail, permitidos: emailsPermitidos.filter(e => e !== email) });
  showToast("Removido.", "success");
};

function renderAdminEmails() {
  const el = document.getElementById("admin-emails-list");
  if (!el) return;
  if (!emailsPermitidos.length) { el.innerHTML = '<div class="empty-state">Vazio</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>E-mail</th><th>Papel</th><th></th></tr></thead>
    <tbody>${emailsPermitidos.map(e => `<tr>
      <td>${e}</td>
      <td>${e === adminEmail ? '<span class="badge success">Admin</span>' : '<span class="badge neutral">Usuário</span>'}</td>
      <td>${e !== adminEmail ? `<button class="btn-sm danger" onclick="removerEmail('${e}')">Remover</button>` : "—"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

// =============================================
// SUBSCRIPTIONS
// =============================================
function subscribeAll() {
  unsubs.insumos = onSnapshot(C.insumos, snap => {
    insumos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    insumos.sort((a, b) => (a.nome||"").localeCompare(b.nome||""));
    renderAll(); setSynced();
  });
  unsubs.produtos = onSnapshot(C.produtos, snap => {
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    produtos.sort((a, b) => (a.nome||"").localeCompare(b.nome||""));
    renderAll(); setSynced();
  });
  unsubs.receitas = onSnapshot(C.receitas, snap => {
    receitas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll(); setSynced();
  });
  unsubs.pedidos = onSnapshot(C.pedidos, snap => {
    pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pedidos.sort((a, b) => tsToMs(b.criadoEm) - tsToMs(a.criadoEm));
    renderAll(); setSynced();
  });
  unsubs.movimentacoes = onSnapshot(C.movimentacoes, snap => {
    movimentacoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    movimentacoes.sort((a, b) => tsToMs(b.criadoEm) - tsToMs(a.criadoEm));
    renderMovimentacoes(); updateStats(); buildChart(); setSynced();
  });
}

// =============================================
// NAVIGATION
// =============================================
const pageTitles = {
  dashboard:"Dashboard", insumos:"Insumos", produtos:"Produtos",
  receitas:"Receitas (BOM)", pedidos:"Pedidos", producao:"Produção",
  movimentacoes:"Histórico de Movimentações", admin:"Administração"
};

window.navigate = (page, el) => {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  if (el) el.classList.add("active");
  document.getElementById("page-title").textContent = pageTitles[page] || page;
  closeSidebarMobile();
  ({
    dashboard:       renderDashboard,
    insumos:         renderInsumos,
    produtos:        renderProdutos,
    receitas:        renderReceitas,
    pedidos:         renderPedidos,
    producao:        renderProducao,
    movimentacoes:   renderMovimentacoes,
    admin:           renderAdminEmails
  }[page] || (() => {}))();
};

window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("show");
};
function closeSidebarMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("overlay").classList.remove("show");
  }
}

function renderAll() {
  const active = document.querySelector(".page.active");
  if (!active) return;
  const id = active.id.replace("page-", "");
  ({
    dashboard: renderDashboard, insumos: renderInsumos,
    produtos: renderProdutos, receitas: renderReceitas,
    pedidos: renderPedidos, producao: renderProducao,
  }[id] || (() => {}))();
  updateStats();
}

// =============================================
// STATS & CHART
// =============================================
function updateStats() {
  set("stat-insumos",  insumos.length);
  set("stat-produtos", produtos.filter(p => p.usaEstoque && (p.estoque||0) > 0).length);
  set("stat-pedidos",  pedidos.filter(p => p.status === "pendente").length);
  const hoje = new Date().toDateString();
  const movHoje = movimentacoes.filter(m => {
    const d = m.criadoEm?.toDate ? m.criadoEm.toDate() : new Date(m.criadoEm||0);
    return d.toDateString() === hoje;
  }).length;
  set("stat-mov", movHoje);
}

window.setChartPeriod = (period, el) => {
  chartPeriod = period;
  document.querySelectorAll(".chart-filters .tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  buildChart();
};

function buildChart() {
  const canvas = document.getElementById("dashChart");
  if (!canvas) return;

  const now = new Date();
  let labels = [], producoes = [], vendas_ = [], entradas = [];

  if (chartPeriod === "semana" || chartPeriod === "mes") {
    const days = chartPeriod === "semana" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const iso = isoDate(d);
      labels.push(d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" }));
      const dayMovs = movimentacoes.filter(m => {
        const md = m.criadoEm?.toDate ? m.criadoEm.toDate() : new Date(m.criadoEm||0);
        return isoDate(md) === iso;
      });
      producoes.push(dayMovs.filter(m => m.tipo === "producao").length);
      vendas_.push(dayMovs.filter(m => m.tipo === "venda").length);
      entradas.push(dayMovs.filter(m => m.tipo === "entrada_insumo").length);
    }
  } else {
    // Ano — agrupa por mês
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mes = isoDate(d).slice(0, 7);
      labels.push(d.toLocaleDateString("pt-BR", { month:"short", year:"2-digit" }));
      const monthMovs = movimentacoes.filter(m => {
        const md = m.criadoEm?.toDate ? m.criadoEm.toDate() : new Date(m.criadoEm||0);
        return isoDate(md).slice(0, 7) === mes;
      });
      producoes.push(monthMovs.filter(m => m.tipo === "producao").length);
      vendas_.push(monthMovs.filter(m => m.tipo === "venda").length);
      entradas.push(monthMovs.filter(m => m.tipo === "entrada_insumo").length);
    }
  }

  if (dashChartInstance) {
    dashChartInstance.data.labels = labels;
    dashChartInstance.data.datasets[0].data = producoes;
    dashChartInstance.data.datasets[1].data = vendas_;
    dashChartInstance.data.datasets[2].data = entradas;
    dashChartInstance.update(); return;
  }

  dashChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label:"Produções", data:producoes, borderColor:"#c8f135", backgroundColor:"rgba(200,241,53,0.08)", tension:0.4, pointBackgroundColor:"#c8f135", pointRadius:4, fill:true },
        { label:"Vendas",    data:vendas_,   borderColor:"#5b8fff", backgroundColor:"rgba(91,143,255,0.08)",  tension:0.4, pointBackgroundColor:"#5b8fff", pointRadius:4, fill:true },
        { label:"Entradas",  data:entradas,  borderColor:"#ff9f43", backgroundColor:"rgba(255,159,67,0.08)", tension:0.4, pointBackgroundColor:"#ff9f43", pointRadius:4, fill:true },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{
        legend:{ display:false },
        tooltip:{ backgroundColor:"#1c1c21", borderColor:"#2a2a32", borderWidth:1, titleColor:"#f0f0f2", bodyColor:"#7a7a8e", padding:12 }
      },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,0.04)" }, ticks:{ color:"#7a7a8e", font:{ family:"DM Mono", size:11 } } },
        y:{ grid:{ color:"rgba(255,255,255,0.04)" }, ticks:{ color:"#7a7a8e", font:{ family:"DM Mono", size:11 } }, beginAtZero:true }
      }
    }
  });
}

// =============================================
// DASHBOARD
// =============================================
function renderDashboard() {
  updateStats(); buildChart();

  // Insumos baixo
  const baixo = insumos.filter(i => (i.estoque||0) <= (i.estoqueMinimo||0) && (i.estoqueMinimo||0) > 0);
  const elBaixo = document.getElementById("dash-insumos-baixo");
  elBaixo.innerHTML = baixo.length
    ? `<table><thead><tr><th>Insumo</th><th>Estoque</th><th>Mínimo</th></tr></thead><tbody>
      ${baixo.map(i => `<tr>
        <td>${i.nome}</td>
        <td class="qty-low">${fmt(i.estoque||0)} ${i.unidade||""}</td>
        <td>${fmt(i.estoqueMinimo)} ${i.unidade||""}</td>
      </tr>`).join("")}
      </tbody></table>`
    : '<div class="empty-state">Estoque em dia ✓</div>';

  // Pedidos pendentes
  const pend = pedidos.filter(p => p.status === "pendente").slice(0, 5);
  const elPed = document.getElementById("dash-pedidos");
  elPed.innerHTML = pend.length
    ? pend.map(p => pedidoCardHTML(p)).join("")
    : '<div class="empty-state">Nenhum pedido pendente 🎉</div>';
}

// =============================================
// INSUMOS
// =============================================
window.renderInsumos = () => {
  const search = (document.getElementById("search-insumos")?.value || "").toLowerCase();
  const fil    = insumos.filter(i => i.nome?.toLowerCase().includes(search));
  const el     = document.getElementById("list-insumos");
  if (!fil.length) { el.innerHTML = '<div class="empty-state">Nenhum insumo</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Unidade</th><th>Estoque</th><th>Mínimo</th><th>Custo/un</th><th>Ações</th></tr></thead>
    <tbody>${fil.map(i => {
      const baixo = (i.estoque||0) <= (i.estoqueMinimo||0) && (i.estoqueMinimo||0) > 0;
      return `<tr>
        <td>${i.nome}</td>
        <td><span class="badge neutral">${i.unidade||"un"}</span></td>
        <td class="${baixo?"qty-low":"qty-ok"}">${fmt(i.estoque||0)} ${i.unidade||""}</td>
        <td>${fmt(i.estoqueMinimo||0)} ${i.unidade||""}</td>
        <td>${i.custo ? "R$ "+Number(i.custo).toFixed(2) : "—"}</td>
        <td><div style="display:flex;gap:4px">
          <button class="btn-sm" onclick="editInsumo('${i.id}')">Editar</button>
          <button class="btn-sm success" onclick="abrirEntradaInsumo('${i.id}')">↑ Entrada</button>
          <button class="btn-sm danger" onclick="deleteInsumo('${i.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
};

window.saveInsumo = async () => {
  const id   = v("insumo-id");
  const nome = v("insumo-nome");
  if (!nome) { showToast("Informe o nome.", "error"); return; }
  const data = {
    nome, unidade: v("insumo-unidade") || "un",
    estoque:       parseFloat(v("insumo-estoque"))  || 0,
    estoqueMinimo: parseFloat(v("insumo-minimo"))   || 0,
    custo:         parseFloat(v("insumo-custo"))    || 0,
    obs:           v("insumo-obs"),
    atualizadoPor: currentUser.email, atualizadoEm: serverTimestamp()
  };
  try {
    if (id) {
      await updateDoc(doc(db,"compartilhado","principal","insumos",id), data);
      showToast("Insumo atualizado!", "success");
    } else {
      data.criadoEm = serverTimestamp(); data.criadoPor = currentUser.email;
      await addDoc(C.insumos, data);
      showToast("Insumo cadastrado!", "success");
    }
    closeModal("modal-insumo"); clearInsumoForm();
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

window.editInsumo = (id) => {
  const i = insumos.find(x => x.id === id); if (!i) return;
  set2("insumo-id", i.id); set2("insumo-nome", i.nome||"");
  set2("insumo-unidade", i.unidade||"un"); set2("insumo-estoque", i.estoque||0);
  set2("insumo-minimo", i.estoqueMinimo||0); set2("insumo-custo", i.custo||"");
  set2("insumo-obs", i.obs||"");
  document.getElementById("modal-insumo-title").textContent = "Editar Insumo";
  openModal("modal-insumo");
};

window.deleteInsumo = async (id) => {
  if (!confirm("Remover insumo?")) return;
  await deleteDoc(doc(db,"compartilhado","principal","insumos",id));
  showToast("Insumo removido.", "success");
};

function clearInsumoForm() {
  ["insumo-id","insumo-nome","insumo-estoque","insumo-minimo","insumo-custo","insumo-obs"].forEach(id => set2(id,""));
  set2("insumo-unidade","un");
  document.getElementById("modal-insumo-title").textContent = "Novo Insumo";
}

// Entrada de insumo
window.abrirEntradaInsumo = (id) => {
  populateSelect("entrada-insumo-id", insumos, "Selecionar insumo...");
  set2("entrada-insumo-id", id||"");
  set2("entrada-quantidade",""); set2("entrada-custo",""); set2("entrada-obs","");
  openModal("modal-entrada-insumo");
};

window.salvarEntradaInsumo = async () => {
  const insumoId = v("entrada-insumo-id");
  const qtd      = parseFloat(v("entrada-quantidade"));
  if (!insumoId || !qtd || qtd <= 0) { showToast("Preencha insumo e quantidade.", "error"); return; }
  const insumo   = insumos.find(i => i.id === insumoId);
  if (!insumo) return;
  const custoUnit = parseFloat(v("entrada-custo")) || insumo.custo || 0;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db,"compartilhado","principal","insumos",insumoId), {
      estoque: (insumo.estoque||0) + qtd,
      atualizadoEm: serverTimestamp()
    });
    batch.set(doc(C.movimentacoes), {
      tipo: "entrada_insumo",
      insumoId, insumoNome: insumo.nome,
      quantidade: qtd, unidade: insumo.unidade||"un",
      custoUnitario: custoUnit,
      custoTotal: custoUnit * qtd,
      obs: v("entrada-obs"),
      criadoPor: currentUser.email, criadoEm: serverTimestamp()
    });
    await batch.commit();
    showToast(`Entrada registrada: +${fmt(qtd)} ${insumo.unidade||"un"} de ${insumo.nome}`, "success");
    closeModal("modal-entrada-insumo");
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

// =============================================
// PRODUTOS
// =============================================
window.renderProdutos = () => {
  const search = (document.getElementById("search-produtos")?.value || "").toLowerCase();
  const fil    = produtos.filter(p => p.nome?.toLowerCase().includes(search));
  const el     = document.getElementById("list-produtos");
  if (!fil.length) { el.innerHTML = '<div class="empty-state">Nenhum produto</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Categoria</th><th>Estoque</th><th>Preço</th><th>Tipo</th><th>Ações</th></tr></thead>
    <tbody>${fil.map(p => {
      const rec = receitas.find(r => r.produtoId === p.id);
      const tags = [
        p.usaEstoque ? '<span class="badge success">PE</span>' : '',
        p.producaoSobDemanda ? '<span class="badge info">SD</span>' : '',
        !rec ? '<span class="badge warn">sem receita</span>' : ''
      ].join(" ");
      return `<tr>
        <td>${p.nome}</td>
        <td>${p.categoria||"—"}</td>
        <td class="${p.usaEstoque?(p.estoque>0?"qty-ok":"qty-low"):"text-dim"}">${p.usaEstoque ? fmt(p.estoque||0)+" un" : "—"}</td>
        <td>${p.preco ? "R$ "+Number(p.preco).toFixed(2) : "—"}</td>
        <td><div style="display:flex;gap:3px;flex-wrap:wrap">${tags}</div></td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap">
          ${p.usaEstoque ? `<button class="btn-sm success" onclick="abrirVenderPE('${p.id}')">Vender</button>` : ""}
          <button class="btn-sm" onclick="editProduto('${p.id}')">Editar</button>
          <button class="btn-sm danger" onclick="deleteProduto('${p.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
};

// Toggle visibilidade do campo estoque
document.getElementById("produto-usa-estoque")?.addEventListener("change", function() {
  document.getElementById("prod-estoque-field").style.display = this.checked ? "" : "none";
});

window.saveProduto = async () => {
  const id   = v("produto-id");
  const nome = v("produto-nome");
  if (!nome) { showToast("Informe o nome.", "error"); return; }
  const usaEstoque = document.getElementById("produto-usa-estoque").checked;
  const data = {
    nome, categoria: v("produto-categoria"),
    preco:           parseFloat(v("produto-preco")) || 0,
    usaEstoque,
    estoque:         usaEstoque ? (parseFloat(v("produto-estoque"))||0) : 0,
    producaoSobDemanda: document.getElementById("produto-sob-demanda").checked,
    obs:             v("produto-obs"),
    atualizadoPor:   currentUser.email, atualizadoEm: serverTimestamp()
  };
  try {
    if (id) {
      await updateDoc(doc(db,"compartilhado","principal","produtos",id), data);
      showToast("Produto atualizado!", "success");
    } else {
      data.criadoEm = serverTimestamp(); data.criadoPor = currentUser.email;
      await addDoc(C.produtos, data);
      showToast("Produto cadastrado!", "success");
    }
    closeModal("modal-produto"); clearProdutoForm();
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

window.editProduto = (id) => {
  const p = produtos.find(x => x.id === id); if (!p) return;
  set2("produto-id", p.id); set2("produto-nome", p.nome||"");
  set2("produto-categoria", p.categoria||""); set2("produto-preco", p.preco||"");
  document.getElementById("produto-usa-estoque").checked = !!p.usaEstoque;
  document.getElementById("prod-estoque-field").style.display = p.usaEstoque ? "" : "none";
  set2("produto-estoque", p.estoque||0);
  document.getElementById("produto-sob-demanda").checked = !!p.producaoSobDemanda;
  set2("produto-obs", p.obs||"");
  document.getElementById("modal-produto-title").textContent = "Editar Produto";
  openModal("modal-produto");
};

window.deleteProduto = async (id) => {
  if (!confirm("Remover produto?")) return;
  await deleteDoc(doc(db,"compartilhado","principal","produtos",id));
  showToast("Produto removido.", "success");
};

function clearProdutoForm() {
  ["produto-id","produto-nome","produto-categoria","produto-preco","produto-estoque","produto-obs"].forEach(id => set2(id,""));
  document.getElementById("produto-usa-estoque").checked = true;
  document.getElementById("produto-sob-demanda").checked = true;
  document.getElementById("prod-estoque-field").style.display = "";
  document.getElementById("modal-produto-title").textContent = "Novo Produto";
}

// Venda pronta entrega
window.abrirVenderPE = (id) => {
  const p = produtos.find(x => x.id === id); if (!p) return;
  set2("vender-pe-produto-id", id);
  set2("vender-pe-cliente",""); set2("vender-pe-qtd",1); set2("vender-pe-obs","");
  document.getElementById("vender-pe-info").textContent =
    `${p.nome} — Estoque atual: ${fmt(p.estoque||0)} un`;
  openModal("modal-vender-pe");
};

window.confirmarVendaPE = async () => {
  const id  = v("vender-pe-produto-id");
  const qtd = parseInt(v("vender-pe-qtd")) || 0;
  const p   = produtos.find(x => x.id === id);
  if (!p || qtd <= 0) { showToast("Dados inválidos.", "error"); return; }
  if ((p.estoque||0) < qtd) { showToast(`Estoque insuficiente: ${fmt(p.estoque||0)} un disponíveis.`, "error"); return; }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db,"compartilhado","principal","produtos",id), {
      estoque: (p.estoque||0) - qtd,
      atualizadoEm: serverTimestamp()
    });
    batch.set(doc(C.movimentacoes), {
      tipo: "venda",
      produtoId: id, produtoNome: p.nome,
      quantidade: qtd,
      cliente: v("vender-pe-cliente"),
      obs: v("vender-pe-obs"),
      totalVenda: (p.preco||0) * qtd,
      criadoPor: currentUser.email, criadoEm: serverTimestamp()
    });
    await batch.commit();
    showToast(`Venda registrada! -${qtd} un de ${p.nome}`, "success");
    closeModal("modal-vender-pe");
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

// =============================================
// RECEITAS (BOM)
// =============================================
window.renderReceitas = () => {
  const el = document.getElementById("list-receitas");
  if (!receitas.length) { el.innerHTML = '<div class="empty-state">Nenhuma receita cadastrada</div>'; return; }
  el.innerHTML = receitas.map(r => {
    const prod = produtos.find(p => p.id === r.produtoId);
    const mats = (r.materiais||[]).map(m => {
      const ins = insumos.find(i => i.id === m.insumoId);
      return ins ? `<span class="mat-tag">${fmt(m.quantidade)} ${ins.unidade||"un"} ${ins.nome}</span>` : "";
    }).join("");
    const custo = calcCustoReceita(r);
    return `<div class="receita-card">
      <div class="receita-header">
        <div>
          <div class="receita-produto">${prod?.nome || "Produto removido"}</div>
          <div class="receita-mats">${mats || "Sem materiais"}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem">
          ${custo > 0 ? `<span class="badge neutral">Custo: R$ ${custo.toFixed(2)}/un</span>` : ""}
          <div style="display:flex;gap:4px">
            <button class="btn-sm" onclick="editReceita('${r.id}')">Editar</button>
            <button class="btn-sm danger" onclick="deleteReceita('${r.id}')">✕</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
};

function calcCustoReceita(receita) {
  return (receita.materiais||[]).reduce((sum, m) => {
    const ins = insumos.find(i => i.id === m.insumoId);
    return sum + (ins?.custo||0) * m.quantidade;
  }, 0);
}

// Materiais temp
window.addMaterialReceita = () => {
  const insumoId = v("receita-insumo-sel");
  const qtd      = parseFloat(v("receita-insumo-qtd")) || 0;
  if (!insumoId || qtd <= 0) { showToast("Selecione insumo e quantidade.", "error"); return; }
  const idx = receitaMateriais.findIndex(m => m.insumoId === insumoId);
  if (idx >= 0) receitaMateriais[idx].quantidade = qtd;
  else receitaMateriais.push({ insumoId, quantidade: qtd });
  set2("receita-insumo-sel",""); set2("receita-insumo-qtd",1);
  renderMateriaisReceita();
};

window.removeMaterialReceita = (idx) => {
  receitaMateriais.splice(idx, 1);
  renderMateriaisReceita();
};

function renderMateriaisReceita() {
  const el = document.getElementById("receita-materiais-list");
  if (!receitaMateriais.length) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.78rem;padding:0.5rem 0">Nenhum material</div>';
    document.getElementById("receita-custo-estimado").innerHTML = "";
    return;
  }
  el.innerHTML = receitaMateriais.map((m, i) => {
    const ins = insumos.find(x => x.id === m.insumoId);
    return `<div class="item-row">
      <span class="item-row-name">${ins?.nome||"?"}</span>
      <span class="item-row-qty">${fmt(m.quantidade)} ${ins?.unidade||"un"}</span>
      <span class="item-row-price">${ins?.custo ? "R$ "+(ins.custo*m.quantidade).toFixed(2) : "—"}</span>
      <button class="item-remove" onclick="removeMaterialReceita(${i})">✕</button>
    </div>`;
  }).join("");
  const custoTotal = receitaMateriais.reduce((s, m) => {
    const ins = insumos.find(x => x.id === m.insumoId);
    return s + (ins?.custo||0) * m.quantidade;
  }, 0);
  document.getElementById("receita-custo-estimado").innerHTML = custoTotal > 0
    ? `<div class="custo-estimado">Custo estimado por unidade: <strong>R$ ${custoTotal.toFixed(2)}</strong></div>` : "";
}

window.saveReceita = async () => {
  const id        = v("receita-id");
  const produtoId = v("receita-produto-id");
  if (!produtoId)             { showToast("Selecione o produto.", "error"); return; }
  if (!receitaMateriais.length) { showToast("Adicione ao menos um material.", "error"); return; }
  const data = {
    produtoId,
    materiais: receitaMateriais.map(m => ({ insumoId: m.insumoId, quantidade: m.quantidade })),
    atualizadoPor: currentUser.email, atualizadoEm: serverTimestamp()
  };
  try {
    if (id) {
      await updateDoc(doc(db,"compartilhado","principal","receitas",id), data);
      showToast("Receita atualizada!", "success");
    } else {
      data.criadoEm = serverTimestamp(); data.criadoPor = currentUser.email;
      await addDoc(C.receitas, data);
      showToast("Receita criada!", "success");
    }
    closeModal("modal-receita");
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

window.editReceita = (id) => {
  const r = receitas.find(x => x.id === id); if (!r) return;
  set2("receita-id", r.id);
  populateSelect("receita-produto-id", produtos, "Selecionar produto...");
  set2("receita-produto-id", r.produtoId||"");
  populateSelect("receita-insumo-sel", insumos, "Selecionar insumo...");
  receitaMateriais = (r.materiais||[]).map(m => ({ ...m }));
  renderMateriaisReceita();
  document.getElementById("modal-receita-title").textContent = "Editar Receita";
  openModal("modal-receita");
};

window.deleteReceita = async (id) => {
  if (!confirm("Remover receita?")) return;
  await deleteDoc(doc(db,"compartilhado","principal","receitas",id));
  showToast("Receita removida.", "success");
};

// =============================================
// PEDIDOS
// =============================================
window.filterPedidos = (filtro, el) => {
  pedidosFiltro = filtro;
  document.querySelectorAll(".filter-tabs .tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  renderPedidos();
};

function renderPedidos() {
  const el    = document.getElementById("list-pedidos");
  let items   = pedidosFiltro === "pendente" ? pedidos.filter(p => p.status==="pendente")
              : pedidosFiltro === "produzido" ? pedidos.filter(p => p.status==="produzido")
              : pedidos;
  if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum pedido</div>'; return; }
  el.innerHTML = items.map(p => pedidoCardHTML(p)).join("");
}

function pedidoCardHTML(p) {
  const prod   = produtos.find(x => x.id === p.produtoId);
  const status = p.status === "produzido"
    ? '<span class="badge success">Produzido</span>'
    : '<span class="badge warn">Pendente</span>';
  const pag = p.pagStatus === "pago" ? '<span class="badge success">Pago</span>'
    : p.pagStatus === "parcial" ? '<span class="badge warn">Parcial</span>'
    : '<span class="badge danger">A pagar</span>';
  const actions = p.status === "pendente"
    ? `<button class="btn-sm success" onclick="abrirConfirmarProducaoPedido('${p.id}')">⚙ Produzir</button>
       <button class="btn-sm danger" onclick="deletePedido('${p.id}')">✕</button>`
    : `<button class="btn-sm danger" onclick="deletePedido('${p.id}')">✕</button>`;
  return `<div class="venda-card ${p.status||"pendente"}">
    <div class="venda-card-header">
      <div class="venda-card-cliente">${p.cliente||"Sem cliente"} — <span style="color:var(--text-muted)">${prod?.nome||"?"}</span></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${status} ${pag}</div>
    </div>
    <div class="venda-card-data">${formatDate(p.criadoEm)}${p.entrega ? " · Entrega: "+formatDate(p.entrega) : ""}${p.criadoPor?" · "+p.criadoPor:""}</div>
    ${p.obs?`<div class="venda-card-itens" style="font-style:italic">${p.obs}</div>`:""}
    <div class="venda-card-footer">
      <div class="venda-card-total"><span style="color:var(--text-muted);font-size:0.8rem">Qtd: </span>${p.quantidade||1} un ${p.totalEstimado?` · R$ ${Number(p.totalEstimado).toFixed(2)}`:""}</div>
      <div class="venda-card-actions">${actions}</div>
    </div>
  </div>`;
}

window.onPedidoProdutoChange = () => {
  const id   = v("pedido-produto-id");
  const prod = produtos.find(p => p.id === id);
  const info = document.getElementById("pedido-tipo-info");
  if (!prod) { info.style.display = "none"; return; }
  const tags = [];
  if (prod.usaEstoque) tags.push(`✓ Pronta Entrega — Estoque: ${fmt(prod.estoque||0)} un`);
  if (prod.producaoSobDemanda) tags.push("✓ Aceita produção sob demanda");
  const rec = receitas.find(r => r.produtoId === id);
  if (!rec) tags.push("⚠️ Sem receita cadastrada — produção não será possível");
  info.innerHTML = tags.map(t => `<div>${t}</div>`).join("");
  info.style.display = "";
  calcPedidoTotal();
};

window.calcPedidoTotal = () => {
  const id   = v("pedido-produto-id");
  const qtd  = parseInt(v("pedido-quantidade")) || 1;
  const prod = produtos.find(p => p.id === id);
  const row  = document.getElementById("pedido-total-row");
  if (prod?.preco) {
    document.getElementById("pedido-total-display").textContent = "R$ "+(prod.preco*qtd).toFixed(2);
    row.style.display = "";
  } else {
    row.style.display = "none";
  }
};

window.savePedido = async () => {
  const cliente   = v("pedido-cliente");
  const produtoId = v("pedido-produto-id");
  const qtd       = parseInt(v("pedido-quantidade")) || 1;
  if (!cliente || !produtoId) { showToast("Preencha cliente e produto.", "error"); return; }
  const prod = produtos.find(p => p.id === produtoId);
  if (!prod) return;
  const data = {
    cliente, produtoId, produtoNome: prod.nome,
    quantidade: qtd,
    entrega:    v("pedido-entrega"),
    pagamento:  v("pedido-pagamento"),
    pagStatus:  v("pedido-pag-status") || "pendente",
    obs:        v("pedido-obs"),
    totalEstimado: (prod.preco||0)*qtd,
    status:     "pendente",
    tipo:       prod.usaEstoque && (prod.estoque||0) >= qtd ? "pronta_entrega" : "producao",
    criadoPor:  currentUser.email, criadoEm: serverTimestamp()
  };
  try {
    await addDoc(C.pedidos, data);
    showToast("Pedido criado!", "success");
    closeModal("modal-pedido"); clearPedidoForm();
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

window.deletePedido = async (id) => {
  if (!confirm("Excluir pedido?")) return;
  await deleteDoc(doc(db,"compartilhado","principal","pedidos",id));
  showToast("Pedido excluído.", "success");
};

function clearPedidoForm() {
  ["pedido-cliente","pedido-produto-id","pedido-quantidade","pedido-entrega",
   "pedido-pagamento","pedido-obs"].forEach(id => set2(id,""));
  set2("pedido-pag-status","pendente"); set2("pedido-quantidade",1);
  document.getElementById("pedido-tipo-info").style.display = "none";
  document.getElementById("pedido-total-row").style.display = "none";
}

// =============================================
// PRODUÇÃO
// =============================================
function renderProducao() {
  const el   = document.getElementById("list-producao-pedidos");
  const pend = pedidos.filter(p => p.status === "pendente");
  if (!pend.length) { el.innerHTML = '<div class="empty-state">Nenhum pedido pendente 🎉</div>'; return; }
  el.innerHTML = pend.map(p => {
    const prod = produtos.find(x => x.id === p.produtoId);
    const rec  = receitas.find(r => r.produtoId === p.produtoId);
    const semReceita = !rec ? `<span class="badge danger">Sem receita</span>` : "";
    return `<div class="venda-card pendente">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${p.cliente} — ${prod?.nome||"?"} × ${p.quantidade}</div>
        ${semReceita}
      </div>
      ${p.entrega?`<div class="venda-card-data">Entrega: ${formatDate(p.entrega)}</div>`:""}
      ${p.obs?`<div class="venda-card-itens" style="font-style:italic">${p.obs}</div>`:""}
      <div class="venda-card-footer">
        <div class="venda-card-total">${p.totalEstimado?"R$ "+Number(p.totalEstimado).toFixed(2):""}</div>
        <button class="btn-primary" style="padding:0.5rem 1rem;font-size:0.8rem" onclick="abrirConfirmarProducaoPedido('${p.id}')">⚙ Produzir</button>
      </div>
    </div>`;
  }).join("");
}

window.abrirConfirmarProducaoPedido = (id) => {
  const pedido = pedidos.find(x => x.id === id); if (!pedido) return;
  pendingPedidoId = id;
  const prod = produtos.find(x => x.id === pedido.produtoId);
  const rec  = receitas.find(r => r.produtoId === pedido.produtoId);
  document.getElementById("conf-prod-texto").textContent =
    `Produzir ${pedido.quantidade}x "${prod?.nome||"?"}" para ${pedido.cliente}.`;
  const preview = document.getElementById("conf-prod-preview");
  if (rec) {
    const linhas = (rec.materiais||[]).map(m => {
      const ins    = insumos.find(i => i.id === m.insumoId);
      const consume = m.quantidade * pedido.quantidade;
      const apos   = (ins?.estoque||0) - consume;
      const ok     = apos >= 0;
      return `<div style="color:${ok?"var(--success)":"var(--danger)"}">
        ${ok?"✓":"✕"} ${ins?.nome||"?"}: ${fmt(ins?.estoque||0)} → ${fmt(apos)} ${ins?.unidade||"un"}
        ${!ok?" ⚠️ INSUFICIENTE":""}
      </div>`;
    }).join("");
    preview.innerHTML = linhas;
    preview.style.display = "";
  } else {
    preview.innerHTML = '<div style="color:var(--danger)">⚠️ Nenhuma receita cadastrada para este produto.</div>';
    preview.style.display = "";
  }
  set2("conf-prod-obs","");
  openModal("modal-confirmar-producao");
};

window.finalizarPedidoConfirmado = async () => {
  if (!pendingPedidoId) return;
  const pedido = pedidos.find(x => x.id === pendingPedidoId); if (!pedido) return;
  const obs    = v("conf-prod-obs");
  try {
    await produzirProduto(pedido.produtoId, pedido.quantidade, obs, pendingPedidoId);
    closeModal("modal-confirmar-producao");
    pendingPedidoId = null;
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

// Preview produção livre
window.calcProducaoPreview = () => {
  const produtoId = v("prod-livre-produto");
  const qtd       = parseInt(v("prod-livre-qtd")) || 1;
  const preview   = document.getElementById("prod-livre-preview");
  if (!produtoId) { preview.style.display = "none"; return; }
  const rec = receitas.find(r => r.produtoId === produtoId);
  if (!rec) {
    preview.innerHTML = '<div style="color:var(--danger)">⚠️ Sem receita cadastrada para este produto.</div>';
    preview.style.display = ""; return;
  }
  const linhas = (rec.materiais||[]).map(m => {
    const ins    = insumos.find(i => i.id === m.insumoId);
    const consume = m.quantidade * qtd;
    const apos   = (ins?.estoque||0) - consume;
    const ok     = apos >= 0;
    return `<div style="color:${ok?"var(--success)":"var(--danger)"}">
      ${ok?"✓":"✕"} ${ins?.nome||"?"}: ${fmt(ins?.estoque||0)} → ${fmt(apos)} ${ins?.unidade||"un"}
      ${!ok?" ⚠️ INSUFICIENTE":""}
    </div>`;
  }).join("");
  preview.innerHTML = linhas;
  preview.style.display = "";
};

window.produzirLivre = async () => {
  const produtoId = v("prod-livre-produto");
  const qtd       = parseInt(v("prod-livre-qtd")) || 1;
  if (!produtoId || qtd <= 0) { showToast("Preencha produto e quantidade.", "error"); return; }
  try {
    await produzirProduto(produtoId, qtd, "", null);
    closeModal("modal-produzir-livre");
  } catch(e) { showToast("Erro: "+e.message, "error"); }
};

// =============================================
// FUNÇÃO CENTRAL: PRODUZIR PRODUTO
// =============================================
async function produzirProduto(produtoId, quantidade, obs, pedidoId) {
  const prod = produtos.find(p => p.id === produtoId);
  if (!prod) throw new Error("Produto não encontrado.");
  const rec = receitas.find(r => r.produtoId === produtoId);
  if (!rec)  throw new Error("Receita não encontrada para este produto. Cadastre a receita antes de produzir.");

  // Validar insumos
  const consumos = [];
  for (const mat of rec.materiais||[]) {
    const ins     = insumos.find(i => i.id === mat.insumoId);
    if (!ins)     throw new Error(`Insumo não encontrado: ${mat.insumoId}`);
    const consume = mat.quantidade * quantidade;
    if ((ins.estoque||0) < consume) {
      throw new Error(`Estoque insuficiente de "${ins.nome}": tem ${fmt(ins.estoque||0)} ${ins.unidade||""}, precisa ${fmt(consume)} ${ins.unidade||""}.`);
    }
    consumos.push({ insumoId: ins.id, insumoNome: ins.nome, delta: -consume, unidade: ins.unidade||"un" });
  }

  // Tudo ok — batch de escrita
  const batch = writeBatch(db);

  // 1. Descontar insumos
  for (const c of consumos) {
    const ins = insumos.find(i => i.id === c.insumoId);
    batch.update(doc(db,"compartilhado","principal","insumos", c.insumoId), {
      estoque: (ins.estoque||0) + c.delta,  // delta é negativo
      atualizadoEm: serverTimestamp()
    });
  }

  // 2. Incrementar estoque do produto (se usaEstoque)
  if (prod.usaEstoque) {
    batch.update(doc(db,"compartilhado","principal","produtos", produtoId), {
      estoque: (prod.estoque||0) + quantidade,
      atualizadoEm: serverTimestamp()
    });
  }

  // 3. Atualizar pedido para "produzido" (se houver)
  if (pedidoId) {
    batch.update(doc(db,"compartilhado","principal","pedidos", pedidoId), {
      status: "produzido",
      produzidoEm: serverTimestamp(),
      produzidoPor: currentUser.email,
      obsProducao: obs
    });
  }

  // 4. Registrar movimentação
  batch.set(doc(C.movimentacoes), {
    tipo: "producao",
    produtoId, produtoNome: prod.nome,
    quantidade,
    pedidoId: pedidoId||null,
    insumos: consumos,
    obs,
    criadoPor: currentUser.email, criadoEm: serverTimestamp()
  });

  await batch.commit();
  showToast(`Produção concluída! ${quantidade}x ${prod.nome}. Estoque de insumos atualizado. ✓`, "success");
}

// =============================================
// MOVIMENTAÇÕES
// =============================================
window.renderMovimentacoes = () => {
  const tipo = v("mov-tipo-filter");
  const from = v("mov-from");
  const to   = v("mov-to");
  let items  = [...movimentacoes];
  if (tipo) items = items.filter(m => m.tipo === tipo);
  if (from) items = items.filter(m => {
    const d = m.criadoEm?.toDate ? m.criadoEm.toDate() : new Date(m.criadoEm||0);
    return d >= new Date(from+"T00:00:00");
  });
  if (to) items = items.filter(m => {
    const d = m.criadoEm?.toDate ? m.criadoEm.toDate() : new Date(m.criadoEm||0);
    return d <= new Date(to+"T23:59:59");
  });

  const el = document.getElementById("list-movimentacoes");
  if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhuma movimentação</div>'; return; }
  el.innerHTML = items.map(m => {
    const tipoLabel = {
      "entrada_insumo": "Entrada de Insumo",
      "producao":       "Produção",
      "venda":          "Venda",
      "ajuste_manual":  "Ajuste Manual"
    }[m.tipo] || m.tipo;
    const tipoClass = { "entrada_insumo":"info", "producao":"success", "venda":"warn", "ajuste_manual":"neutral" }[m.tipo]||"neutral";
    let detalhe = "";
    if (m.tipo === "producao")      detalhe = `${m.quantidade}x ${m.produtoNome||""} ${m.pedidoId?"(pedido)":"(livre)"}`;
    else if (m.tipo === "venda")    detalhe = `${m.quantidade}x ${m.produtoNome||""} ${m.cliente?"→ "+m.cliente:""}`;
    else if (m.tipo === "entrada_insumo") detalhe = `+${fmt(m.quantidade)} ${m.unidade||""} ${m.insumoNome||""}`;
    return `<div class="venda-card ${m.tipo==="producao"?"produzido":"pendente"}">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${detalhe}</div>
        <span class="badge ${tipoClass}">${tipoLabel}</span>
      </div>
      <div class="venda-card-data">${formatDate(m.criadoEm)} · ${m.criadoPor||""}</div>
      ${m.obs?`<div class="venda-card-itens" style="font-style:italic">${m.obs}</div>`:""}
      ${m.tipo==="producao" && m.insumos?.length ? `<div class="venda-card-itens">${m.insumos.map(i=>`${fmt(Math.abs(i.delta))} ${i.unidade} ${i.insumoNome}`).join(" · ")}</div>` : ""}
    </div>`;
  }).join("");
};

window.clearMovFilter = () => {
  set2("mov-tipo-filter",""); set2("mov-from",""); set2("mov-to","");
  renderMovimentacoes();
};

// =============================================
// MODAIS
// =============================================
window.openModal = (id) => {
  if (id === "modal-receita") {
    populateSelect("receita-produto-id", produtos, "Selecionar produto...");
    populateSelect("receita-insumo-sel", insumos,  "Selecionar insumo...");
    if (!v("receita-id")) { receitaMateriais = []; renderMateriaisReceita(); }
    document.getElementById("modal-receita-title").textContent = "Nova Receita";
  }
  if (id === "modal-pedido") {
    populateSelect("pedido-produto-id", produtos.filter(p => p.usaEstoque || p.producaoSobDemanda), "Selecionar produto...");
  }
  if (id === "modal-produzir-livre") {
    populateSelect("prod-livre-produto", produtos.filter(p => receitas.find(r => r.produtoId === p.id)), "Selecionar produto...");
    document.getElementById("prod-livre-preview").style.display = "none";
    set2("prod-livre-qtd",1);
  }
  if (id === "modal-entrada-insumo") {
    populateSelect("entrada-insumo-id", insumos, "Selecionar insumo...");
  }
  document.getElementById(id).classList.add("open");
};

window.closeModal = (id) => {
  document.getElementById(id).classList.remove("open");
  if (id === "modal-insumo")   clearInsumoForm();
  if (id === "modal-produto")  clearProdutoForm();
  if (id === "modal-receita")  { set2("receita-id",""); receitaMateriais=[]; renderMateriaisReceita(); }
  if (id === "modal-pedido")   clearPedidoForm();
};

document.querySelectorAll(".modal-backdrop").forEach(bd => {
  bd.addEventListener("click", e => { if (e.target===bd) closeModal(bd.id); });
});

// =============================================
// SCREENS / HELPERS
// =============================================
function showScreen(id) {
  ["login-screen","register-screen","denied-screen","app-screen"].forEach(s => {
    document.getElementById(s).classList.toggle("active", s===id);
  });
}
window.showRegister = () => showScreen("register-screen");
window.showLogin    = () => showScreen("login-screen");

function populateSelect(elId, items, placeholder) {
  const sel = document.getElementById(elId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(i => {
    const opt = document.createElement("option");
    opt.value = i.id;
    opt.textContent = i.nome;
    sel.appendChild(opt);
  });
}

function setSynced() { document.getElementById("sync-dot")?.classList.remove("loading"); }

let toastTimeout;
function showToast(msg, type="") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show "+type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove("show"), 4000);
}

// =============================================
// UTILS
// =============================================
function v(id)        { return document.getElementById(id)?.value || ""; }
function set2(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function set(id, val)  { const el = document.getElementById(id); if (el) el.textContent = val; }

function tsToMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  return new Date(ts).getTime();
}

function isoDate(d) { return d.toISOString().split("T")[0]; }

function fmt(n) {
  const num = Number(n||0);
  return num % 1 === 0 ? String(num) : num.toFixed(3).replace(/\.?0+$/, "");
}

function formatDate(val) {
  if (!val) return "—";
  let d;
  if (val?.toDate)                  d = val.toDate();
  else if (typeof val === "string") d = new Date(val + (val.includes("T") ? "" : "T12:00:00"));
  else                              d = new Date(val);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
}
