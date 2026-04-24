// =============================================
// STOCKFLOW — APP.JS
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
  doc, getDocs, query, where, orderBy,
  onSnapshot, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =============================================
// STATE
// =============================================
let currentUser = null;
let produtos = [];
let vendas = [];
let historico = [];
let vendaItensTemp = [];
let pendingVendaId = null;
let currentVendasFilter = "pendente";

let unsubProdutos = null;
let unsubVendas = null;
let unsubHistorico = null;

// =============================================
// AUTH
// =============================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    showApp();
    document.getElementById("user-display").textContent = user.displayName || user.email;
    subscribeAll();
  } else {
    currentUser = null;
    unsubscribeAll();
    showLogin();
  }
});

window.login = async function () {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;
  const err = document.getElementById("login-error");
  err.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    err.textContent = friendlyError(e.code);
  }
};

window.register = async function () {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass = document.getElementById("reg-password").value;
  const err = document.getElementById("reg-error");
  err.textContent = "";
  if (!name) { err.textContent = "Informe um nome."; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    showToast("Conta criada! Bem-vindo(a).", "success");
  } catch (e) {
    err.textContent = friendlyError(e.code);
  }
};

window.logout = async function () {
  await signOut(auth);
};

function friendlyError(code) {
  const map = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "E-mail já cadastrado.",
    "auth/weak-password": "Senha muito fraca (mínimo 6 caracteres).",
    "auth/invalid-credential": "E-mail ou senha incorretos."
  };
  return map[code] || "Erro ao autenticar. Tente novamente.";
}

// =============================================
// REALTIME SUBSCRIPTIONS
// =============================================
function subscribeAll() {
  const uid = currentUser.uid;

  unsubProdutos = onSnapshot(
    query(collection(db, "usuarios", uid, "produtos"), orderBy("nome")),
    (snap) => {
      produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
      setSynced();
    }
  );

  unsubVendas = onSnapshot(
    query(
      collection(db, "usuarios", uid, "vendas"),
      where("status", "==", "pendente"),
      orderBy("criadoEm", "desc")
    ),
    (snap) => {
      vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
      setSynced();
    }
  );

  unsubHistorico = onSnapshot(
    query(
      collection(db, "usuarios", uid, "vendas"),
      where("status", "==", "produzido"),
      orderBy("produzidoEm", "desc")
    ),
    (snap) => {
      historico = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderHistorico();
      setSynced();
    }
  );
}

function unsubscribeAll() {
  if (unsubProdutos) unsubProdutos();
  if (unsubVendas) unsubVendas();
  if (unsubHistorico) unsubHistorico();
}

// =============================================
// NAVIGATION
// =============================================
const pageTitles = {
  dashboard: "Dashboard",
  estoque: "Estoque",
  vendas: "Vendas",
  producao: "Produção",
  historico: "Histórico"
};

window.navigate = function (page, el) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  if (el) el.classList.add("active");
  document.getElementById("page-title").textContent = pageTitles[page] || page;
  closeSidebarMobile();

  if (page === "dashboard") renderDashboard();
  if (page === "estoque") renderEstoque();
  if (page === "vendas") renderVendas();
  if (page === "producao") renderProducao();
  if (page === "historico") renderHistorico();
};

window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show");
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
  if (id === "estoque") renderEstoque();
  if (id === "vendas") renderVendas();
  if (id === "producao") renderProducao();
  updateStats();
}

// =============================================
// STATS
// =============================================
function updateStats() {
  const totalEstoque = produtos.reduce((s, p) => s + (p.quantidade || 0), 0);
  document.getElementById("stat-estoque").textContent = totalEstoque;
  document.getElementById("stat-pendentes").textContent = vendas.length;

  const hoje = new Date().toDateString();
  const prodHoje = historico.filter(v => {
    if (!v.produzidoEm) return false;
    const d = v.produzidoEm.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm);
    return d.toDateString() === hoje;
  }).length;
  document.getElementById("stat-hoje").textContent = prodHoje;
  document.getElementById("stat-historico").textContent = historico.length;
}

// =============================================
// DASHBOARD
// =============================================
function renderDashboard() {
  updateStats();

  // Pendentes
  const dashPend = document.getElementById("dash-pendentes");
  if (!vendas.length) {
    dashPend.innerHTML = '<div class="empty-state">Nenhuma venda pendente 🎉</div>';
  } else {
    dashPend.innerHTML = vendas.slice(0, 5).map(v => vendaCardHTML(v, true)).join("");
  }

  // Estoque baixo
  const baixo = produtos.filter(p => (p.quantidade || 0) <= (p.minimo || 0) && (p.minimo || 0) > 0);
  const dashBaixo = document.getElementById("dash-estoque-baixo");
  if (!baixo.length) {
    dashBaixo.innerHTML = '<div class="empty-state">Estoque em dia ✓</div>';
  } else {
    dashBaixo.innerHTML = `<table><thead><tr><th>Produto</th><th>Qtd</th><th>Mínimo</th></tr></thead><tbody>
      ${baixo.map(p => `<tr>
        <td>${p.nome}</td>
        <td class="qty-low">${p.quantidade || 0} ${p.unidade || ""}</td>
        <td>${p.minimo} ${p.unidade || ""}</td>
      </tr>`).join("")}
    </tbody></table>`;
  }
}

// =============================================
// ESTOQUE
// =============================================
window.renderEstoque = function () {
  const search = (document.getElementById("search-estoque")?.value || "").toLowerCase();
  const filtered = produtos.filter(p => p.nome?.toLowerCase().includes(search));
  const list = document.getElementById("list-estoque");
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto encontrado</div>';
    return;
  }
  list.innerHTML = `<table>
    <thead><tr>
      <th>Produto</th><th>Categoria</th><th>Qtd</th><th>Unid.</th>
      <th>Custo</th><th>Preço</th><th>Ações</th>
    </tr></thead>
    <tbody>
    ${filtered.map(p => {
      const baixo = (p.quantidade || 0) <= (p.minimo || 0) && (p.minimo || 0) > 0;
      return `<tr>
        <td>${p.nome}</td>
        <td>${p.categoria || "—"}</td>
        <td class="${baixo ? "qty-low" : "qty-ok"}">${p.quantidade || 0}</td>
        <td>${p.unidade || "un"}</td>
        <td>${p.custo ? "R$ " + Number(p.custo).toFixed(2) : "—"}</td>
        <td>${p.preco ? "R$ " + Number(p.preco).toFixed(2) : "—"}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn-sm" onclick="editProduto('${p.id}')">Editar</button>
            <button class="btn-sm danger" onclick="deleteProduto('${p.id}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join("")}
    </tbody>
  </table>`;
};

window.saveProduto = async function () {
  const id = document.getElementById("prod-id").value;
  const nome = document.getElementById("prod-nome").value.trim();
  const qtd = parseFloat(document.getElementById("prod-qtd").value) || 0;
  if (!nome) { showToast("Informe o nome do produto.", "error"); return; }

  const data = {
    nome,
    categoria: document.getElementById("prod-categoria").value.trim(),
    quantidade: qtd,
    unidade: document.getElementById("prod-unidade").value.trim() || "un",
    custo: parseFloat(document.getElementById("prod-custo").value) || 0,
    preco: parseFloat(document.getElementById("prod-preco").value) || 0,
    minimo: parseFloat(document.getElementById("prod-minimo").value) || 0,
    obs: document.getElementById("prod-obs").value.trim(),
    atualizadoEm: serverTimestamp()
  };

  try {
    const uid = currentUser.uid;
    if (id) {
      await updateDoc(doc(db, "usuarios", uid, "produtos", id), data);
      showToast("Produto atualizado!", "success");
    } else {
      data.criadoEm = serverTimestamp();
      await addDoc(collection(db, "usuarios", uid, "produtos"), data);
      showToast("Produto cadastrado!", "success");
    }
    closeModal("modal-produto");
    clearFormProduto();
  } catch (e) {
    showToast("Erro ao salvar: " + e.message, "error");
  }
};

window.editProduto = function (id) {
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  document.getElementById("prod-id").value = p.id;
  document.getElementById("prod-nome").value = p.nome || "";
  document.getElementById("prod-categoria").value = p.categoria || "";
  document.getElementById("prod-qtd").value = p.quantidade || 0;
  document.getElementById("prod-unidade").value = p.unidade || "";
  document.getElementById("prod-custo").value = p.custo || "";
  document.getElementById("prod-preco").value = p.preco || "";
  document.getElementById("prod-minimo").value = p.minimo || "";
  document.getElementById("prod-obs").value = p.obs || "";
  document.getElementById("modal-produto-title").textContent = "Editar Produto";
  openModal("modal-produto");
};

window.deleteProduto = async function (id) {
  if (!confirm("Remover este produto?")) return;
  try {
    await deleteDoc(doc(db, "usuarios", currentUser.uid, "produtos", id));
    showToast("Produto removido.", "success");
  } catch (e) {
    showToast("Erro ao remover.", "error");
  }
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
  if (currentVendasFilter === "pendente") items = vendas;
  else if (currentVendasFilter === "produzido") items = historico;
  else items = [...vendas, ...historico].sort((a, b) => {
    const da = (a.criadoEm?.toDate ? a.criadoEm.toDate() : new Date(a.criadoEm || 0));
    const db2 = (b.criadoEm?.toDate ? b.criadoEm.toDate() : new Date(b.criadoEm || 0));
    return db2 - da;
  });

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma venda encontrada</div>';
    return;
  }
  list.innerHTML = items.map(v => vendaCardHTML(v, false)).join("");
}

function vendaCardHTML(v, compact) {
  const itensStr = (v.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(", ");
  const entrega = v.entrega ? ` · Entrega: ${formatDate(v.entrega)}` : "";
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

  return `<div class="venda-card ${v.status || "pendente"}">
    <div class="venda-card-header">
      <div class="venda-card-cliente">${v.cliente || "Sem nome"}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${status} ${pago}</div>
    </div>
    <div class="venda-card-data">${formatDate(v.criadoEm)}${entrega}${v.contato ? " · " + v.contato : ""}</div>
    <div class="venda-card-itens">${itensStr || "Sem itens"}</div>
    ${v.obs ? `<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e">${v.obs}</div>` : ""}
    <div class="venda-card-footer">
      <div class="venda-card-total">${formatMoney(v.total || 0)}</div>
      <div class="venda-card-actions">${actions}</div>
    </div>
  </div>`;
}

// Venda itens temp
window.addItemVenda = function () {
  const sel = document.getElementById("venda-prod-select");
  const prodId = sel.value;
  const qtd = parseFloat(document.getElementById("venda-item-qtd").value) || 1;
  if (!prodId) { showToast("Selecione um produto.", "error"); return; }

  const prod = produtos.find(p => p.id === prodId);
  if (!prod) return;

  const existing = vendaItensTemp.findIndex(i => i.prodId === prodId);
  if (existing >= 0) {
    vendaItensTemp[existing].qtd += qtd;
  } else {
    vendaItensTemp.push({ prodId, nome: prod.nome, qtd, preco: prod.preco || 0 });
  }

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
      <span class="item-row-price">${formatMoney((item.qtd * item.preco) || 0)}</span>
      <button class="item-remove" onclick="removeItemVenda(${i})">✕</button>
    </div>
  `).join("");
  const total = vendaItensTemp.reduce((s, i) => s + (i.qtd * i.preco), 0);
  document.getElementById("venda-total-display").textContent = formatMoney(total);
}

window.removeItemVenda = function (i) {
  vendaItensTemp.splice(i, 1);
  renderVendaItens();
};

window.saveVenda = async function () {
  const id = document.getElementById("venda-id").value;
  const cliente = document.getElementById("venda-cliente").value.trim();
  if (!cliente) { showToast("Informe o nome do cliente.", "error"); return; }
  if (!vendaItensTemp.length) { showToast("Adicione ao menos um item.", "error"); return; }

  const total = vendaItensTemp.reduce((s, i) => s + (i.qtd * i.preco), 0);

  const data = {
    cliente,
    contato: document.getElementById("venda-contato").value.trim(),
    data: document.getElementById("venda-data").value,
    entrega: document.getElementById("venda-entrega").value,
    itens: vendaItensTemp.map(i => ({ prodId: i.prodId, nome: i.nome, qtd: i.qtd, preco: i.preco })),
    total,
    pagamento: document.getElementById("venda-pagamento").value,
    pagStatus: document.getElementById("venda-pag-status").value,
    obs: document.getElementById("venda-obs").value.trim(),
    status: "pendente",
    atualizadoEm: serverTimestamp()
  };

  try {
    const uid = currentUser.uid;
    if (id) {
      await updateDoc(doc(db, "usuarios", uid, "vendas", id), data);
      showToast("Venda atualizada!", "success");
    } else {
      data.criadoEm = serverTimestamp();
      await addDoc(collection(db, "usuarios", uid, "vendas"), data);
      showToast("Venda cadastrada!", "success");
    }
    closeModal("modal-venda");
    clearFormVenda();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
};

window.editVenda = function (id) {
  const v = vendas.find(x => x.id === id);
  if (!v) return;
  document.getElementById("venda-id").value = v.id;
  document.getElementById("venda-cliente").value = v.cliente || "";
  document.getElementById("venda-contato").value = v.contato || "";
  document.getElementById("venda-data").value = v.data || "";
  document.getElementById("venda-entrega").value = v.entrega || "";
  document.getElementById("venda-pagamento").value = v.pagamento || "";
  document.getElementById("venda-pag-status").value = v.pagStatus || "pendente";
  document.getElementById("venda-obs").value = v.obs || "";
  vendaItensTemp = (v.itens || []).map(i => ({ ...i }));
  renderVendaItens();
  document.getElementById("modal-venda-title").textContent = "Editar Venda";
  openModal("modal-venda");
};

window.deleteVenda = async function (id) {
  if (!confirm("Excluir esta venda?")) return;
  try {
    await deleteDoc(doc(db, "usuarios", currentUser.uid, "vendas", id));
    showToast("Venda excluída.", "success");
  } catch (e) {
    showToast("Erro ao excluir.", "error");
  }
};

function clearFormVenda() {
  document.getElementById("venda-id").value = "";
  ["venda-cliente","venda-contato","venda-data","venda-entrega","venda-obs"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("venda-pagamento").value = "";
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
  if (!vendas.length) {
    list.innerHTML = '<div class="empty-state">Nada para produzir agora 🎉</div>';
    return;
  }
  list.innerHTML = vendas.map(v => {
    const itensStr = (v.itens || []).map(i => `<strong>${i.qtd}x</strong> ${i.nome}`).join(", ");
    const entrega = v.entrega ? `<span class="badge warn">Entrega: ${formatDate(v.entrega)}</span>` : "";
    return `<div class="venda-card pendente">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${v.cliente}</div>
        ${entrega}
      </div>
      <div class="venda-card-itens" style="margin-bottom:0.5rem">${itensStr}</div>
      ${v.obs ? `<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e;margin-bottom:0.4rem">${v.obs}</div>` : ""}
      <div class="venda-card-footer">
        <div class="venda-card-total">${formatMoney(v.total || 0)}</div>
        <button class="btn-primary" style="padding:0.5rem 1rem;font-size:0.8rem" onclick="abrirConfirmProducao('${v.id}')">✓ Marcar como Produzido</button>
      </div>
    </div>`;
  }).join("");
}

window.abrirConfirmProducao = function (id) {
  const v = vendas.find(x => x.id === id);
  if (!v) return;
  pendingVendaId = id;
  const itensStr = (v.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(", ");
  document.getElementById("prod-confirm-text").textContent =
    `Confirmar que o pedido de "${v.cliente}" foi produzido?\n\nItens: ${itensStr}`;
  document.getElementById("prod-confirm-obs").value = "";
  openModal("modal-producao");
};

window.confirmarProducao = async function () {
  if (!pendingVendaId) return;
  const obs = document.getElementById("prod-confirm-obs").value.trim();
  try {
    await updateDoc(doc(db, "usuarios", currentUser.uid, "vendas", pendingVendaId), {
      status: "produzido",
      produzidoEm: serverTimestamp(),
      obsProducao: obs
    });
    showToast("Marcado como produzido! ✓", "success");
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
  const to = document.getElementById("hist-to")?.value;
  let items = historico;

  if (from) {
    const fromDate = new Date(from + "T00:00:00");
    items = items.filter(v => {
      const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm || 0);
      return d >= fromDate;
    });
  }
  if (to) {
    const toDate = new Date(to + "T23:59:59");
    items = items.filter(v => {
      const d = v.produzidoEm?.toDate ? v.produzidoEm.toDate() : new Date(v.produzidoEm || 0);
      return d <= toDate;
    });
  }

  const list = document.getElementById("list-historico");
  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhum item encontrado</div>';
    return;
  }

  const total = items.reduce((s, v) => s + (v.total || 0), 0);
  const header = `<div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
    <span style="color:var(--text-muted);font-size:0.8rem">${items.length} pedidos produzidos</span>
    <span style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;color:var(--accent)">${formatMoney(total)} total</span>
  </div>`;

  list.innerHTML = header + items.map(v => {
    const itensStr = (v.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(", ");
    const prodEm = v.produzidoEm?.toDate ? formatDate(v.produzidoEm) : "—";
    return `<div class="venda-card produzido">
      <div class="venda-card-header">
        <div class="venda-card-cliente">${v.cliente}</div>
        <span class="badge success">Produzido em ${prodEm}</span>
      </div>
      <div class="venda-card-itens">${itensStr}</div>
      ${v.obsProducao ? `<div class="venda-card-itens" style="font-style:italic;color:#5a5a6e">Obs: ${v.obsProducao}</div>` : ""}
      <div class="venda-card-footer">
        <div class="venda-card-total">${formatMoney(v.total || 0)}</div>
        <div style="display:flex;gap:4px">
          <span class="badge ${v.pagStatus === "pago" ? "success" : "warn"}">${v.pagStatus || "pendente"}</span>
          <button class="btn-sm danger" onclick="deleteVenda('${v.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join("");
};

window.clearHistFilter = function () {
  document.getElementById("hist-from").value = "";
  document.getElementById("hist-to").value = "";
  renderHistorico();
};

// =============================================
// MODAL
// =============================================
window.openModal = function (id) {
  if (id === "modal-venda") populateProdutoSelect();
  document.getElementById(id).classList.add("open");
};

window.closeModal = function (id) {
  document.getElementById(id).classList.remove("open");
  if (id === "modal-produto") clearFormProduto();
  if (id === "modal-venda") clearFormVenda();
};

function populateProdutoSelect() {
  const sel = document.getElementById("venda-prod-select");
  sel.innerHTML = '<option value="">Selecionar produto...</option>';
  produtos.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.nome} — R$ ${Number(p.preco || 0).toFixed(2)}`;
    sel.appendChild(opt);
  });
}

// Close modal on backdrop click
document.querySelectorAll(".modal-backdrop").forEach(bd => {
  bd.addEventListener("click", (e) => {
    if (e.target === bd) closeModal(bd.id);
  });
});

// =============================================
// SCREEN HELPERS
// =============================================
function showApp() {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("register-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
}

function showLogin() {
  document.getElementById("login-screen").classList.add("active");
  document.getElementById("register-screen").classList.remove("active");
  document.getElementById("app-screen").classList.remove("active");
}

window.showRegister = function () {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("register-screen").classList.add("active");
};

window.showLogin = function () {
  document.getElementById("register-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
};

// =============================================
// SYNC INDICATOR
// =============================================
function setSynced() {
  const dot = document.getElementById("sync-dot");
  dot?.classList.remove("loading");
}

// =============================================
// TOAST
// =============================================
let toastTimeout;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = "toast show " + type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// =============================================
// UTILS
// =============================================
function formatDate(val) {
  if (!val) return "—";
  let d;
  if (val?.toDate) d = val.toDate();
  else if (typeof val === "string") d = new Date(val + (val.includes("T") ? "" : "T12:00:00"));
  else d = new Date(val);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(val) {
  return "R$ " + Number(val || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Set today's date as default on venda form open
document.getElementById("modal-venda").addEventListener("animationend", () => {
  if (!document.getElementById("venda-data").value) {
    document.getElementById("venda-data").value = new Date().toISOString().split("T")[0];
  }
});
