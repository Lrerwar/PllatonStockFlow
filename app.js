// =============================================
// STOCKFLOW — APP.JS v3
// · Whitelist de e-mails (admin controla acesso)
// · Desconto automático de estoque ao produzir
// · Gráfico de linha no dashboard (semana/mês/ano)
// =============================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, query, where, onSnapshot, serverTimestamp,
  getDoc, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =============================================
// COLEÇÕES / DOCUMENTOS
// =============================================
const COL_PRODUTOS  = collection(db, "compartilhado", "principal", "produtos");
const COL_VENDAS    = collection(db, "compartilhado", "principal", "vendas");
const DOC_CONFIG    = doc(db, "compartilhado", "config");
// Coleção de snapshots diários para o gráfico
const COL_SNAPSHOTS = collection(db, "compartilhado", "principal", "snapshots");

// =============================================
// STATE
// =============================================
let currentUser        = null;
let isAdmin            = false;
let emailsPermitidos   = [];
let adminEmail         = "";

let produtos           = [];
let vendas             = [];
let historico          = [];
let vendaItensTemp     = [];
let pendingVendaId     = null;
let currentVendasFilter = "pendente";

let chartPeriod        = "semana";
let dashChartInstance  = null;
let snapshots          = [];   // dados do gráfico

let unsubProdutos      = null;
let unsubVendas        = null;
let unsubHistorico     = null;
let unsubConfig        = null;
let unsubSnapshots     = null;

// =============================================
// AUTH
// =============================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    isAdmin     = false;
    unsubscribeAll();
    resetState();
    showScreen("login-screen");
    return;
  }

  currentUser = user;
  const email = user.email?.toLowerCase() || "";

  // Carrega config de whitelist
  const configSnap = await getDoc(DOC_CONFIG);
  let config = configSnap.exists() ? configSnap.data() : null;

  // Primeiro acesso: cria config com este usuário como admin
  if (!config) {
    config = { admin: email, permitidos: [email] };
    await setDoc(DOC_CONFIG, config);
  }

  adminEmail       = config.admin || "";
  emailsPermitidos = config.permitidos || [];
  isAdmin          = (email === adminEmail);

  // Verifica whitelist
  if (!emailsPermitidos.includes(email) && !isAdmin) {
    showScreen("denied-screen");
    return;
  }

  // Acesso permitido
  document.getElementById("user-display").textContent = user.displayName || email;
  document.getElementById("nav-admin-li").style.display = isAdmin ? "" : "none";
  showScreen("app-screen");
  subscribeAll();
  subscribeConfig();
});

window.login = async function () {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-password").value;
  const err   = document.getElementById("login-error");
  err.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    err.textContent = friendlyError(e.code);
  }
};

window.register = async function () {
  const name  = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass  = document.getElementById("reg-password").value;
  const err   = document.getElementById("reg-error");
  err.textContent = "";
  if (!name) { err.textContent = "Informe um nome."; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    showToast("Conta criada! Aguarde aprovação do admin.", "success");
  } catch (e) {
    err.textContent = friendlyError(e.code);
  }
};

window.logout = async function () {
  await signOut(auth);
};

function friendlyError(code) {
  const map = {
    "auth/invalid-email":        "E-mail inválido.",
    "auth/user-not-found":       "Usuário não encontrado.",
    "auth/wrong-password":       "Senha incorreta.",
    "auth/email-already-in-use": "E-mail já cadastrado.",
    "auth/weak-password":        "Senha fraca (mínimo 6 caracteres).",
    "auth/invalid-credential":   "E-mail ou senha incorretos."
  };
  return map[code] || "Erro ao autenticar. Tente novamente.";
}

// =============================================
// ADMIN — WHITELIST
// =============================================
function subscribeConfig() {
  unsubConfig = onSnapshot(DOC_CONFIG, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    emailsPermitidos = data.permitidos || [];
    adminEmail       = data.admin || "";
    renderAdminEmails();
  });
}

window.adicionarEmail = async function () {
  if (!isAdmin) return;
  const input = document.getElementById("admin-email-input");
  const email = input.value.trim().toLowerCase();
  if (!email || !email.includes("@")) { showToast("E-mail inválido.", "error"); return; }
  if (emailsPermitidos.includes(email)) { showToast("E-mail já autorizado.", "error"); return; }

  const novos = [...emailsPermitidos, email];
  await setDoc(DOC_CONFIG, { admin: adminEmail, permitidos: novos });
  input.value = "";
  showToast("E-mail adicionado!", "success");
};

window.removerEmail = async function (email) {
  if (!isAdmin) return;
  if (email === adminEmail) { showToast("Não é possível remover o admin.", "error"); return; }
  const novos = emailsPermitidos.filter(e => e !== email);
  await setDoc(DOC_CONFIG, { admin: adminEmail, permitidos: novos });
  showToast("E-mail removido.", "success");
};

function renderAdminEmails() {
  const list = document.getElementById("admin-emails-list");
  if (!list) return;
  if (!emailsPermitidos.length) {
    list.innerHTML = '<div class="empty-state">Nenhum e-mail autorizado</div>';
    return;
  }
  list.innerHTML = `<table>
    <thead><tr><th>E-mail</th><th>Papel</th><th>Ação</th></tr></thead>
    <tbody>
    ${emailsPermitidos.map(e => `<tr>
      <td>${e}</td>
      <td>${e === adminEmail ? '<span class="badge success">Admin</span>' : '<span class="badge neutral">Usuário</span>'}</td>
      <td>${e !== adminEmail
        ? `<button class="btn-sm danger" onclick="removerEmail('${e}')">Remover</button>`
        : "—"
      }</td>
    </tr>`).join("")}
    </tbody>
  </table>`;
}

// =============================================
// SUBSCRIPTIONS
// =============================================
function subscribeAll() {
  unsubProdutos = onSnapshot(COL_PRODUTOS, (snap) => {
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    produtos.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    renderAll();
    salvarSnapshotHoje();
    setSynced();
  });

  unsubVendas = onSnapshot(
    query(COL_VENDAS, where("status", "==", "pendente")),
    (snap) => {
      vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      vendas.sort((a, b) => tsToMs(b.criadoEm) - tsToMs(a.criadoEm));
      renderAll();
      salvarSnapshotHoje();
      setSynced();
    }
  );

  unsubHistorico = onSnapshot(
    query(COL_VENDAS, where("status", "==", "produzido")),
    (snap) => {
      historico = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      historico.sort((a, b) => tsToMs(b.produzidoEm) - tsToMs(a.produzidoEm));
      renderHistorico();
      updateStats();
      setSynced();
    }
  );

  // Snapshots para o gráfico (últimos 400 registros é suficiente para anos)
  unsubSnapshots = onSnapshot(COL_SNAPSHOTS, (snap) => {
    snapshots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    snapshots.sort((a, b) => (a.id > b.id ? 1 : -1));
    buildChart();
  });
}

function unsubscribeAll() {
  [unsubProdutos, unsubVendas, unsubHistorico, unsubConfig, unsubSnapshots]
    .forEach(u => u && u());
}

function resetState() {
  produtos = []; vendas = []; historico = []; snapshots = [];
}

// =============================================
// SNAPSHOT DIÁRIO (para o gráfico)
// Salva um documento por dia com os totais do momento
// =============================================
let snapshotThrottle = null;
async function salvarSnapshotHoje() {
  clearTimeout(snapshotThrottle);
  snapshotThrottle = setTimeout(async () => {
    const hoje = isoDate(new Date());
    const totalEstoque = produtos.reduce((s, p) => s + (Number(p.quantidade) || 0), 0);
    const totalPendentes = vendas.length;
    const totalProduzidosHoje = historico.filter(v => {
      const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm || 0);
      return isoDate(d) === hoje;
    }).length;

    try {
      await setDoc(doc(COL_SNAPSHOTS, hoje), {
        data: hoje,
        estoque:   totalEstoque,
        pedidos:   totalPendentes,
        produzidos: totalProduzidosHoje
      }, { merge: true });
    } catch (_) {}
  }, 2000);
}

// =============================================
// GRÁFICO
// =============================================
window.setChartPeriod = function (period, el) {
  chartPeriod = period;
  document.querySelectorAll(".chart-filters .tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  buildChart();
};

function buildChart() {
  const canvas = document.getElementById("dashChart");
  if (!canvas) return;

  const now   = new Date();
  let filtered = [];
  let labelFn;

  if (chartPeriod === "semana") {
    // últimos 7 dias
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6);
    filtered = snapshots.filter(s => s.data >= isoDate(cutoff));
    labelFn  = s => {
      const d = new Date(s.data + "T12:00:00");
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    };
  } else if (chartPeriod === "mes") {
    // últimos 30 dias
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 29);
    filtered = snapshots.filter(s => s.data >= isoDate(cutoff));
    labelFn  = s => {
      const d = new Date(s.data + "T12:00:00");
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    };
  } else {
    // ano — agrupa por mês
    const cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 1);
    const byMonth = {};
    snapshots
      .filter(s => s.data >= isoDate(cutoff))
      .forEach(s => {
        const mes = s.data.slice(0, 7); // "2024-03"
        if (!byMonth[mes]) byMonth[mes] = { data: mes, estoque: 0, pedidos: 0, produzidos: 0, count: 0 };
        byMonth[mes].estoque    += s.estoque    || 0;
        byMonth[mes].pedidos    += s.pedidos    || 0;
        byMonth[mes].produzidos += s.produzidos || 0;
        byMonth[mes].count++;
      });
    // média por mês
    filtered = Object.values(byMonth).map(m => ({
      data: m.data,
      estoque:    Math.round(m.estoque    / m.count),
      pedidos:    Math.round(m.pedidos    / m.count),
      produzidos: Math.round(m.produzidos / m.count)
    })).sort((a, b) => a.data > b.data ? 1 : -1);
    labelFn = s => {
      const [y, m] = s.data.split("-");
      return new Date(+y, +m - 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    };
  }

  const labels    = filtered.map(labelFn);
  const estoque   = filtered.map(s => s.estoque    || 0);
  const pedidos   = filtered.map(s => s.pedidos    || 0);
  const produzidos= filtered.map(s => s.produzidos || 0);

  if (dashChartInstance) {
    dashChartInstance.data.labels          = labels;
    dashChartInstance.data.datasets[0].data = estoque;
    dashChartInstance.data.datasets[1].data = pedidos;
    dashChartInstance.data.datasets[2].data = produzidos;
    dashChartInstance.update();
    return;
  }

  dashChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Estoque",
          data: estoque,
          borderColor: "#c8f135",
          backgroundColor: "rgba(200,241,53,0.08)",
          tension: 0.4,
          pointBackgroundColor: "#c8f135",
          pointRadius: 4,
          fill: true
        },
        {
          label: "Pedidos",
          data: pedidos,
          borderColor: "#5b8fff",
          backgroundColor: "rgba(91,143,255,0.08)",
          tension: 0.4,
          pointBackgroundColor: "#5b8fff",
          pointRadius: 4,
          fill: true
        },
        {
          label: "Produzidos",
          data: produzidos,
          borderColor: "#2ed573",
          backgroundColor: "rgba(46,213,115,0.08)",
          tension: 0.4,
          pointBackgroundColor: "#2ed573",
          pointRadius: 4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c1c21",
          borderColor: "#2a2a32",
          borderWidth: 1,
          titleColor: "#f0f0f2",
          bodyColor: "#7a7a8e",
          padding: 12
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: { color: "#7a7a8e", font: { family: "DM Mono", size: 11 } }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: { color: "#7a7a8e", font: { family: "DM Mono", size: 11 } },
          beginAtZero: true
        }
      }
    }
  });
}

// =============================================
// NAVIGATION
// =============================================
const pageTitles = {
  dashboard: "Dashboard", estoque: "Estoque",
  vendas: "Vendas", producao: "Produção",
  historico: "Histórico", admin: "Administração"
};

window.navigate = function (page, el) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  if (el) el.classList.add("active");
  document.getElementById("page-title").textContent = pageTitles[page] || page;
  closeSidebarMobile();
  if (page === "dashboard") renderDashboard();
  if (page === "estoque")   renderEstoque();
  if (page === "vendas")    renderVendas();
  if (page === "producao")  renderProducao();
  if (page === "historico") renderHistorico();
  if (page === "admin")     renderAdminEmails();
};

window.toggleSidebar = function () {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("show");
};

function closeSidebarMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("overlay").classList.remove("show");
  }
}

// =============================================
// RENDER ALL
// =============================================
function renderAll() {
  const active = document.querySelector(".page.active");
  if (!active) return;
  const id = active.id.replace("page-", "");
  if (id === "dashboard") renderDashboard();
  if (id === "estoque")   renderEstoque();
  if (id === "vendas")    renderVendas();
  if (id === "producao")  renderProducao();
  updateStats();
}

// =============================================
// STATS
// =============================================
function updateStats() {
  const totalEstoque = produtos.reduce((s, p) => s + (Number(p.quantidade) || 0), 0);
  document.getElementById("stat-estoque").textContent    = totalEstoque;
  document.getElementById("stat-pendentes").textContent  = vendas.length;
  const hoje = new Date().toDateString();
  const prodHoje = historico.filter(v => {
    const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm || 0);
    return d.toDateString() === hoje;
  }).length;
  document.getElementById("stat-hoje").textContent      = prodHoje;
  document.getElementById("stat-historico").textContent = historico.length;
}

// =============================================
// DASHBOARD
// =============================================
function renderDashboard() {
  updateStats();
  buildChart();

  const dashPend = document.getElementById("dash-pendentes");
  dashPend.innerHTML = vendas.length
    ? vendas.slice(0, 5).map(v => vendaCardHTML(v)).join("")
    : '<div class="empty-state">Nenhuma venda pendente 🎉</div>';

  const baixo = produtos.filter(p => (Number(p.quantidade)||0) <= (Number(p.minimo)||0) && (Number(p.minimo)||0) > 0);
  const dashBaixo = document.getElementById("dash-estoque-baixo");
  dashBaixo.innerHTML = baixo.length
    ? `<table><thead><tr><th>Produto</th><th>Qtd</th><th>Mínimo</th></tr></thead><tbody>
        ${baixo.map(p => `<tr>
          <td>${p.nome}</td>
          <td class="qty-low">${p.quantidade||0} ${p.unidade||""}</td>
          <td>${p.minimo} ${p.unidade||""}</td>
        </tr>`).join("")}
      </tbody></table>`
    : '<div class="empty-state">Estoque em dia ✓</div>';
}

// =============================================
// ESTOQUE
// =============================================
window.renderEstoque = function () {
  const search   = (document.getElementById("search-estoque")?.value || "").toLowerCase();
  const filtered = produtos.filter(p => p.nome?.toLowerCase().includes(search));
  const list     = document.getElementById("list-estoque");
  if (!filtered.length) { list.innerHTML = '<div class="empty-state">Nenhum produto encontrado</div>'; return; }
  list.innerHTML = `<table>
    <thead><tr><th>Produto</th><th>Categoria</th><th>Qtd</th><th>Unid.</th><th>Custo</th><th>Preço</th><th>Ações</th></tr></thead>
    <tbody>
    ${filtered.map(p => {
      const baixo = (Number(p.quantidade)||0) <= (Number(p.minimo)||0) && (Number(p.minimo)||0) > 0;
      return `<tr>
        <td>${p.nome}</td>
        <td>${p.categoria||"—"}</td>
        <td class="${baixo?"qty-low":"qty-ok"}">${p.quantidade||0}</td>
        <td>${p.unidade||"un"}</td>
        <td>${p.custo?"R$ "+Number(p.custo).toFixed(2):"—"}</td>
        <td>${p.preco?"R$ "+Number(p.preco).toFixed(2):"—"}</td>
        <td><div style="display:flex;gap:4px">
          <button class="btn-sm" onclick="editProduto('${p.id}')">Editar</button>
          <button class="btn-sm danger" onclick="deleteProduto('${p.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join("")}
    </tbody>
  </table>`;
};

window.saveProduto = async function () {
  const id   = document.getElementById("prod-id").value;
  const nome = document.getElementById("prod-nome").value.trim();
  if (!nome) { showToast("Informe o nome do produto.", "error"); return; }
  const data = {
    nome,
    categoria:     document.getElementById("prod-categoria").value.trim(),
    quantidade:    parseFloat(document.getElementById("prod-qtd").value) || 0,
    unidade:       document.getElementById("prod-unidade").value.trim() || "un",
    custo:         parseFloat(document.getElementById("prod-custo").value) || 0,
    preco:         parseFloat(document.getElementById("prod-preco").value) || 0,
    minimo:        parseFloat(document.getElementById("prod-minimo").value) || 0,
    obs:           document.getElementById("prod-obs").value.trim(),
    atualizadoPor: currentUser.email,
    atualizadoEm:  serverTimestamp()
  };
  try {
    if (id) {
      await updateDoc(doc(db, "compartilhado", "principal", "produtos", id), data);
      showToast("Produto atualizado!", "success");
    } else {
      data.criadoEm  = serverTimestamp();
      data.criadoPor = currentUser.email;
      await addDoc(COL_PRODUTOS, data);
      showToast("Produto cadastrado!", "success");
    }
    closeModal("modal-produto"); clearFormProduto();
  } catch (e) { showToast("Erro: " + e.message, "error"); }
};

window.editProduto = function (id) {
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  document.getElementById("prod-id").value        = p.id;
  document.getElementById("prod-nome").value      = p.nome || "";
  document.getElementById("prod-categoria").value = p.categoria || "";
  document.getElementById("prod-qtd").value       = p.quantidade || 0;
  document.getElementById("prod-unidade").value   = p.unidade || "";
  document.getElementById("prod-custo").value     = p.custo || "";
  document.getElementById("prod-preco").value     = p.preco || "";
  document.getElementById("prod-minimo").value    = p.minimo || "";
  document.getElementById("prod-obs").value       = p.obs || "";
  document.getElementById("modal-produto-title").textContent = "Editar Produto";
  openModal("modal-produto");
};

window.deleteProduto = async function (id) {
  if (!confirm("Remover este produto?")) return;
  try {
    await deleteDoc(doc(db, "compartilhado", "principal", "produtos", id));
    showToast("Produto removido.", "success");
  } catch (e) { showToast("Erro ao remover.", "error"); }
};

function clearFormProduto() {
  ["prod-id","prod-nome","prod-categoria","prod-qtd","prod-unidade",
   "prod-custo","prod-preco","prod-minimo","prod-obs"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("modal-produto-title").textContent = "Novo Produto";
}

// =============================================
// VENDAS
// =============================================
window.filterVendas = function (filter, el) {
  currentVendasFilter = filter;
  document.querySelectorAll(".filter-tabs .tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  renderVendas();
};

function renderVendas() {
  const list = document.getElementById("list-vendas");
  let items;
  if (currentVendasFilter === "pendente")       items = vendas;
  else if (currentVendasFilter === "produzido") items = historico;
  else {
    items = [...vendas, ...historico];
    items.sort((a, b) => tsToMs(b.criadoEm) - tsToMs(a.criadoEm));
  }
  if (!items.length) { list.innerHTML = '<div class="empty-state">Nenhuma venda encontrada</div>'; return; }
  list.innerHTML = items.map(v => vendaCardHTML(v)).join("");
}

function vendaCardHTML(v) {
  const itensStr  = (v.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(", ");
  const entrega   = v.entrega ? ` · Entrega: ${formatDate(v.entrega)}` : "";
  const criadoPor = v.criadoPor ? ` · ${v.criadoPor}` : "";
  const pago = v.pagStatus === "pago"
    ? `<span class="badge success">Pago</span>`
    : v.pagStatus === "parcial"
    ? `<span class="badge warn">Parcial</span>`
    : `<span class="badge danger">A pagar</span>`;
  const status = v.status === "produzido"
    ? `<span class="badge success">Produzido</span>`
    : `<span class="badge warn">Pendente</span>`;
  const actions = v.status === "pendente"
    ? `<button class="btn-sm success" onclick="abrirConfirmProducao('${v.id}')">✓ Produzido</button>
       <button class="btn-sm" onclick="editVenda('${v.id}')">Editar</button>
       <button class="btn-sm danger" onclick="deleteVenda('${v.id}')">✕</button>`
    : `<button class="btn-sm danger" onclick="deleteVenda('${v.id}')">Excluir</button>`;
  return `<div class="venda-card ${v.status||"pendente"}">
    <div class="venda-card-header">
      <div class="venda-card-cliente">${v.cliente||"Sem nome"}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${status} ${pago}</div>
    </div>
    <div class="venda-card-data">${formatDate(v.criadoEm)}${criadoPor}${entrega}</div>
    <div class="venda-card-itens">${itensStr||"Sem itens"}</div>
    ${v.obs?`<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e">${v.obs}</div>`:""}
    <div class="venda-card-footer">
      <div class="venda-card-total">${formatMoney(v.total||0)}</div>
      <div class="venda-card-actions">${actions}</div>
    </div>
  </div>`;
}

window.addItemVenda = function () {
  const sel    = document.getElementById("venda-prod-select");
  const prodId = sel.value;
  const qtd    = parseFloat(document.getElementById("venda-item-qtd").value) || 1;
  if (!prodId) { showToast("Selecione um produto.", "error"); return; }
  const prod = produtos.find(p => p.id === prodId);
  if (!prod) return;
  const idx = vendaItensTemp.findIndex(i => i.prodId === prodId);
  if (idx >= 0) vendaItensTemp[idx].qtd += qtd;
  else vendaItensTemp.push({ prodId, nome: prod.nome, qtd, preco: prod.preco || 0 });
  sel.value = "";
  document.getElementById("venda-item-qtd").value = 1;
  renderVendaItens();
};

function renderVendaItens() {
  const list = document.getElementById("venda-itens-list");
  if (!vendaItensTemp.length) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:0.78rem;padding:0.5rem 0">Nenhum item adicionado</div>';
    document.getElementById("venda-total-display").textContent = "R$ 0,00";
    return;
  }
  list.innerHTML = vendaItensTemp.map((item, i) => `
    <div class="item-row">
      <span class="item-row-name">${item.nome}</span>
      <span class="item-row-qty">${item.qtd}x</span>
      <span class="item-row-price">${formatMoney((item.qtd*item.preco)||0)}</span>
      <button class="item-remove" onclick="removeItemVenda(${i})">✕</button>
    </div>`).join("");
  const total = vendaItensTemp.reduce((s, i) => s + (i.qtd*i.preco), 0);
  document.getElementById("venda-total-display").textContent = formatMoney(total);
}

window.removeItemVenda = function (i) { vendaItensTemp.splice(i, 1); renderVendaItens(); };

window.saveVenda = async function () {
  const id      = document.getElementById("venda-id").value;
  const cliente = document.getElementById("venda-cliente").value.trim();
  if (!cliente)               { showToast("Informe o cliente.", "error"); return; }
  if (!vendaItensTemp.length) { showToast("Adicione ao menos um item.", "error"); return; }
  const total = vendaItensTemp.reduce((s, i) => s + (i.qtd*i.preco), 0);
  const data = {
    cliente,
    contato:       document.getElementById("venda-contato").value.trim(),
    data:          document.getElementById("venda-data").value,
    entrega:       document.getElementById("venda-entrega").value,
    itens:         vendaItensTemp.map(i => ({ prodId:i.prodId, nome:i.nome, qtd:i.qtd, preco:i.preco })),
    total,
    pagamento:     document.getElementById("venda-pagamento").value,
    pagStatus:     document.getElementById("venda-pag-status").value,
    obs:           document.getElementById("venda-obs").value.trim(),
    status:        "pendente",
    atualizadoPor: currentUser.email,
    atualizadoEm:  serverTimestamp()
  };
  try {
    if (id) {
      await updateDoc(doc(db, "compartilhado", "principal", "vendas", id), data);
      showToast("Venda atualizada!", "success");
    } else {
      data.criadoEm  = serverTimestamp();
      data.criadoPor = currentUser.email;
      await addDoc(COL_VENDAS, data);
      showToast("Venda cadastrada!", "success");
    }
    closeModal("modal-venda"); clearFormVenda();
  } catch (e) { showToast("Erro: " + e.message, "error"); }
};

window.editVenda = function (id) {
  const v = vendas.find(x => x.id === id);
  if (!v) return;
  document.getElementById("venda-id").value         = v.id;
  document.getElementById("venda-cliente").value    = v.cliente || "";
  document.getElementById("venda-contato").value    = v.contato || "";
  document.getElementById("venda-data").value       = v.data || "";
  document.getElementById("venda-entrega").value    = v.entrega || "";
  document.getElementById("venda-pagamento").value  = v.pagamento || "";
  document.getElementById("venda-pag-status").value = v.pagStatus || "pendente";
  document.getElementById("venda-obs").value        = v.obs || "";
  vendaItensTemp = (v.itens || []).map(i => ({ ...i }));
  renderVendaItens();
  document.getElementById("modal-venda-title").textContent = "Editar Venda";
  openModal("modal-venda");
};

window.deleteVenda = async function (id) {
  if (!confirm("Excluir esta venda?")) return;
  try {
    await deleteDoc(doc(db, "compartilhado", "principal", "vendas", id));
    showToast("Venda excluída.", "success");
  } catch (e) { showToast("Erro ao excluir.", "error"); }
};

function clearFormVenda() {
  document.getElementById("venda-id").value = "";
  ["venda-cliente","venda-contato","venda-data","venda-entrega","venda-obs"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("venda-pagamento").value  = "";
  document.getElementById("venda-pag-status").value = "pendente";
  vendaItensTemp = [];
  renderVendaItens();
  document.getElementById("modal-venda-title").textContent = "Nova Venda";
}

// =============================================
// PRODUÇÃO
// =============================================
function renderProducao() {
  const list = document.getElementById("list-producao");
  if (!vendas.length) { list.innerHTML = '<div class="empty-state">Nada para produzir agora 🎉</div>'; return; }
  list.innerHTML = vendas.map(v => {
    const itensStr  = (v.itens||[]).map(i => `<strong>${i.qtd}x</strong> ${i.nome}`).join(", ");
    const entrega   = v.entrega ? `<span class="badge warn">Entrega: ${formatDate(v.entrega)}</span>` : "";
    const criadoPor = v.criadoPor ? `<span class="badge neutral">por ${v.criadoPor}</span>` : "";
    return `<div class="venda-card pendente">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${v.cliente}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${entrega}${criadoPor}</div>
      </div>
      <div class="venda-card-itens" style="margin-bottom:0.5rem">${itensStr}</div>
      ${v.obs?`<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e;margin-bottom:0.4rem">${v.obs}</div>`:""}
      <div class="venda-card-footer">
        <div class="venda-card-total">${formatMoney(v.total||0)}</div>
        <button class="btn-primary" style="padding:0.5rem 1rem;font-size:0.8rem" onclick="abrirConfirmProducao('${v.id}')">✓ Marcar como Produzido</button>
      </div>
    </div>`;
  }).join("");
}

window.abrirConfirmProducao = function (id) {
  const v = vendas.find(x => x.id === id);
  if (!v) return;
  pendingVendaId = id;
  const itensStr = (v.itens||[]).map(i => `${i.qtd}x ${i.nome}`).join(", ");
  document.getElementById("prod-confirm-text").textContent =
    `Confirmar que o pedido de "${v.cliente}" foi produzido?\n\nItens: ${itensStr}`;

  // Aviso de estoque
  const avisoEl = document.getElementById("prod-estoque-aviso");
  const avisos = [];
  (v.itens||[]).forEach(item => {
    const prod = produtos.find(p => p.id === item.prodId);
    if (!prod) { avisos.push(`⚠️ ${item.nome}: produto não encontrado`); return; }
    const apos = (Number(prod.quantidade)||0) - item.qtd;
    if (apos < 0) avisos.push(`⚠️ ${item.nome}: estoque insuficiente (tem ${prod.quantidade||0}, precisa ${item.qtd})`);
    else avisos.push(`✓ ${item.nome}: ${prod.quantidade||0} → ${apos} ${prod.unidade||"un"}`);
  });
  avisoEl.innerHTML = avisos.length
    ? `<div class="info-box">${avisos.map(a => `<div>${a}</div>`).join("")}</div>` : "";

  document.getElementById("prod-confirm-obs").value = "";
  openModal("modal-producao");
};

window.confirmarProducao = async function () {
  if (!pendingVendaId) return;
  const venda = vendas.find(x => x.id === pendingVendaId);
  if (!venda) return;
  const obs = document.getElementById("prod-confirm-obs").value.trim();

  try {
    const batch = writeBatch(db);

    // 1. Marca a venda como produzida
    batch.update(doc(db, "compartilhado", "principal", "vendas", pendingVendaId), {
      status:       "produzido",
      produzidoEm:  serverTimestamp(),
      produzidoPor: currentUser.email,
      obsProducao:  obs
    });

    // 2. Desconta do estoque para cada item
    for (const item of (venda.itens || [])) {
      const prod = produtos.find(p => p.id === item.prodId);
      if (!prod) continue;
      const novaQtd = Math.max(0, (Number(prod.quantidade)||0) - item.qtd);
      batch.update(doc(db, "compartilhado", "principal", "produtos", item.prodId), {
        quantidade:    novaQtd,
        atualizadoPor: currentUser.email,
        atualizadoEm:  serverTimestamp()
      });
    }

    await batch.commit();
    showToast("Produzido! Estoque atualizado ✓", "success");
    closeModal("modal-producao");
    pendingVendaId = null;
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
};

// =============================================
// HISTÓRICO
// =============================================
window.renderHistorico = function () {
  const from = document.getElementById("hist-from")?.value;
  const to   = document.getElementById("hist-to")?.value;
  let items  = [...historico];
  if (from) {
    const fromDate = new Date(from + "T00:00:00");
    items = items.filter(v => {
      const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm||0);
      return d >= fromDate;
    });
  }
  if (to) {
    const toDate = new Date(to + "T23:59:59");
    items = items.filter(v => {
      const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm||0);
      return d <= toDate;
    });
  }
  const list = document.getElementById("list-historico");
  if (!items.length) { list.innerHTML = '<div class="empty-state">Nenhum item encontrado</div>'; return; }
  const total  = items.reduce((s, v) => s + (v.total||0), 0);
  const header = `<div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
    <span style="color:var(--text-muted);font-size:0.8rem">${items.length} pedidos produzidos</span>
    <span style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;color:var(--accent)">${formatMoney(total)} total</span>
  </div>`;
  list.innerHTML = header + items.map(v => {
    const itensStr     = (v.itens||[]).map(i => `${i.qtd}x ${i.nome}`).join(", ");
    const prodEm       = v.produzidoEm?.toDate ? formatDate(v.produzidoEm) : "—";
    const produzidoPor = v.produzidoPor ? ` · ${v.produzidoPor}` : "";
    return `<div class="venda-card produzido">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${v.cliente}</div>
        <span class="badge success">Produzido em ${prodEm}${produzidoPor}</span>
      </div>
      <div class="venda-card-itens">${itensStr}</div>
      ${v.obsProducao?`<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e">Obs: ${v.obsProducao}</div>`:""}
      <div class="venda-card-footer">
        <div class="venda-card-total">${formatMoney(v.total||0)}</div>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="badge ${v.pagStatus==="pago"?"success":"warn"}">${v.pagStatus||"pendente"}</span>
          <button class="btn-sm danger" onclick="deleteVenda('${v.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join("");
};

window.clearHistFilter = function () {
  document.getElementById("hist-from").value = "";
  document.getElementById("hist-to").value   = "";
  renderHistorico();
};

// =============================================
// MODAIS
// =============================================
window.openModal = function (id) {
  if (id === "modal-venda") populateProdutoSelect();
  document.getElementById(id).classList.add("open");
};

window.closeModal = function (id) {
  document.getElementById(id).classList.remove("open");
  if (id === "modal-produto") clearFormProduto();
  if (id === "modal-venda")   clearFormVenda();
};

function populateProdutoSelect() {
  const sel = document.getElementById("venda-prod-select");
  sel.innerHTML = '<option value="">Selecionar produto...</option>';
  produtos.forEach(p => {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = `${p.nome} — R$ ${Number(p.preco||0).toFixed(2)}`;
    sel.appendChild(opt);
  });
}

document.querySelectorAll(".modal-backdrop").forEach(bd => {
  bd.addEventListener("click", e => { if (e.target === bd) closeModal(bd.id); });
});

// =============================================
// SCREENS
// =============================================
function showScreen(id) {
  ["login-screen","register-screen","denied-screen","app-screen"].forEach(s => {
    document.getElementById(s).classList.toggle("active", s === id);
  });
}

window.showRegister = function () { showScreen("register-screen"); };
window.showLogin    = function () { showScreen("login-screen"); };

// =============================================
// SYNC DOT
// =============================================
function setSynced() {
  document.getElementById("sync-dot")?.classList.remove("loading");
}

// =============================================
// TOAST
// =============================================
let toastTimeout;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = "toast show " + type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3500);
}

// =============================================
// UTILS
// =============================================
function tsToMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  return new Date(ts).getTime();
}

function isoDate(d) {
  return d.toISOString().split("T")[0];
}

function formatDate(val) {
  if (!val) return "—";
  let d;
  if (val?.toDate)                  d = val.toDate();
  else if (typeof val === "string") d = new Date(val + (val.includes("T") ? "" : "T12:00:00"));
  else                              d = new Date(val);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(val) {
  return "R$ " + Number(val||0).toLocaleString("pt-BR", { minimumFractionDigits:2, maximumFractionDigits:2 });
}
