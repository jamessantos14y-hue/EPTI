// API do backend hospedado no Render
const API_URL = "https://epti-0hm2.onrender.com/api";

const MINICURSOS_PERMITIDOS = [
  "Designer",
  "Programação",
  "Manutenção de computadores",
  "Infraestrutura de redes",
];

const TAMANHOS_CAMISA_PERMITIDOS = ["P", "M", "G", "GG"];

const ITENS = {
  camisa: { nome: "Camisa", preco: 35 },
  ecobag: { nome: "Ecobag", preco: 35 },
  broche: { nome: "Broche", preco: 8 },
  mochila: { nome: "Mochila", preco: 15 },
};

const screens = {
  login: document.getElementById("loginScreen"),
  register: document.getElementById("registerScreen"),
  home: document.getElementById("homeScreen"),
};

const state = {
  token: localStorage.getItem("epti_token"),
  user: JSON.parse(localStorage.getItem("epti_user") || "null"),
  pedidos: [],
};

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
}

function minicursoValido(minicurso) {
  return MINICURSOS_PERMITIDOS.includes(minicurso);
}

function tamanhoCamisaValido(tamanho) {
  return TAMANHOS_CAMISA_PERMITIDOS.includes(tamanho);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function limparMinicursoAntigoSeNecessario(user) {
  const minicursoCache = localStorage.getItem("epti_minicurso");

  if (minicursoCache && !minicursoValido(minicursoCache)) {
    localStorage.removeItem("epti_minicurso");
  }

  if (user?.minicurso && !minicursoValido(user.minicurso)) {
    user.minicurso = null;
  }

  return user;
}

function saveSession(token, user) {
  const userTratado = limparMinicursoAntigoSeNecessario(user || {});

  localStorage.setItem("epti_token", token);
  localStorage.setItem("epti_user", JSON.stringify(userTratado));

  if (userTratado?.minicurso && minicursoValido(userTratado.minicurso)) {
    localStorage.setItem("epti_minicurso", userTratado.minicurso);
  } else {
    localStorage.removeItem("epti_minicurso");
  }

  state.token = token;
  state.user = userTratado;

  updateHomeUser();
  showScreen("home");
  loadMyOrders();
}

function clearSession() {
  localStorage.removeItem("epti_token");
  localStorage.removeItem("epti_user");
  localStorage.removeItem("epti_minicurso");

  state.token = null;
  state.user = null;
  state.pedidos = [];

  showScreen("login");
}

function toast(message, type = "success") {
  const el = document.getElementById("toast");

  if (!el) return;

  el.textContent = message;
  el.className = `toast ${type}`;

  setTimeout(() => {
    el.classList.add("hidden");
  }, 3600);
}

async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Erro ao comunicar com o servidor.");
  }

  return data;
}

function validateInstitutionalEmail(email) {
  return email.trim().toLowerCase().endsWith("@aluno.ce.gov.br");
}

function getCurrentMinicurso() {
  const minicurso = state.user?.minicurso || localStorage.getItem("epti_minicurso") || "";

  if (!minicursoValido(minicurso)) {
    localStorage.removeItem("epti_minicurso");

    if (state.user) {
      state.user.minicurso = null;
      localStorage.setItem("epti_user", JSON.stringify(state.user));
    }

    return "";
  }

  return minicurso;
}

function renderCurrentCourse(minicurso) {
  const currentCourse = document.getElementById("currentCourse");
  const openCoursesBtn = document.getElementById("openCoursesBtn");

  if (!currentCourse || !openCoursesBtn) return;

  if (minicurso && minicursoValido(minicurso)) {
    currentCourse.classList.remove("hidden");
    currentCourse.innerHTML = `
      <strong>Minicurso escolhido:</strong>
      <span>${minicurso}</span>
    `;

    openCoursesBtn.textContent = "Mudar minicurso";
  } else {
    currentCourse.classList.add("hidden");
    currentCourse.innerHTML = "";
    openCoursesBtn.textContent = "Minicursos";
  }
}

function updateHomeUser() {
  const userName = document.getElementById("userName");

  if (!state.user) return;

  if (userName) {
    userName.textContent = `${state.user.nome || "Aluno(a)"} • ${state.user.turma || "Turma"}`;
  }

  renderCurrentCourse(getCurrentMinicurso());
}

function renderMyOrders(pedidos = []) {
  const myOrders = document.getElementById("myOrders");
  if (!myOrders) return;

  if (!pedidos.length) {
    myOrders.classList.add("hidden");
    myOrders.innerHTML = "";
    return;
  }

  myOrders.classList.remove("hidden");
  myOrders.innerHTML = `
    <h3>Meus pedidos</h3>
    <div class="order-list">
      ${pedidos
        .map((pedido) => {
          const status = pedido.status_pagamento === "APROVADO" ? "Pagamento aprovado" : "Aguardando aprovação";
          const tamanho = pedido.tamanho_camisa ? ` • Tam. ${pedido.tamanho_camisa}` : "";
          return `
            <div class="order-row">
              <span>${pedido.item_nome || pedido.item}${tamanho}</span>
              <strong>${formatMoney((pedido.preco_centavos || 0) / 100)}</strong>
              <em class="status ${pedido.status_pagamento === "APROVADO" ? "approved" : "pending"}">${status}</em>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadMyOrders() {
  if (!state.token) return;

  try {
    const data = await apiFetch("/pedidos/me");
    state.pedidos = data.pedidos || [];
    renderMyOrders(state.pedidos);
  } catch (error) {
    console.error(error);
  }
}

async function restoreSession() {
  if (!state.token) {
    showScreen("login");
    return;
  }

  try {
    const data = await apiFetch("/me");

    const minicursoCache = localStorage.getItem("epti_minicurso");

    if (!data.user.minicurso && minicursoCache && minicursoValido(minicursoCache)) {
      data.user.minicurso = minicursoCache;
    }

    saveSession(state.token, data.user);
  } catch (error) {
    clearSession();
  }
}

// Navegação login/cadastro

document.getElementById("goRegister").addEventListener("click", () => {
  showScreen("register");
});

document.getElementById("goLogin").addEventListener("click", () => {
  showScreen("login");
});

document.getElementById("logoutBtn").addEventListener("click", clearSession);

// Login

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const senha = document.getElementById("loginSenha").value;

  if (!validateInstitutionalEmail(email)) {
    toast("Use seu email institucional @aluno.ce.gov.br.", "error");
    return;
  }

  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });

    saveSession(data.token, data.user);
    toast("Login realizado com sucesso!");
  } catch (error) {
    toast(error.message, "error");
  }
});

// Cadastro

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const nome = document.getElementById("registerNome").value.trim();
  const turma = document.getElementById("registerTurma").value;
  const email = document.getElementById("registerEmail").value.trim().toLowerCase();
  const senha = document.getElementById("registerSenha").value;

  if (!validateInstitutionalEmail(email)) {
    toast("O cadastro só aceita email @aluno.ce.gov.br.", "error");
    return;
  }

  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ nome, turma, email, senha }),
    });

    saveSession(data.token, data.user);
    toast("Cadastro criado e login realizado!");
  } catch (error) {
    toast(error.message, "error");
  }
});

// Modal de compra

const buyModal = document.getElementById("buyModal");
const paymentModal = document.getElementById("paymentModal");
const openBuyBtn = document.getElementById("openBuyBtn");
const closeBuyBtn = document.getElementById("closeBuyBtn");
const closePaymentBtn = document.getElementById("closePaymentBtn");
const confirmBuyBtn = document.getElementById("confirmBuyBtn");
const shirtSizeArea = document.getElementById("shirtSizeArea");
const buyShirtSize = document.getElementById("buyShirtSize");
const buyTotal = document.getElementById("buyTotal");

function getSelectedItems() {
  return Array.from(document.querySelectorAll(".buy-option input:checked")).map((input) => input.value);
}

function updateBuyModal() {
  const selected = getSelectedItems();
  const hasCamisa = selected.includes("camisa");
  const total = selected.reduce((sum, item) => sum + (ITENS[item]?.preco || 0), 0);

  if (shirtSizeArea) {
    shirtSizeArea.classList.toggle("hidden", !hasCamisa);
  }

  if (!hasCamisa && buyShirtSize) {
    buyShirtSize.value = "";
  }

  if (buyTotal) {
    buyTotal.textContent = `Total: ${formatMoney(total)}`;
  }
}

if (openBuyBtn && buyModal) {
  openBuyBtn.addEventListener("click", () => {
    buyModal.classList.remove("hidden");
    updateBuyModal();
  });
}

if (closeBuyBtn && buyModal) {
  closeBuyBtn.addEventListener("click", () => buyModal.classList.add("hidden"));
}

if (closePaymentBtn && paymentModal) {
  closePaymentBtn.addEventListener("click", () => paymentModal.classList.add("hidden"));
}

[buyModal, paymentModal].forEach((modal) => {
  if (!modal) return;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

document.querySelectorAll(".buy-option input").forEach((input) => {
  input.addEventListener("change", updateBuyModal);
});

if (confirmBuyBtn) {
  confirmBuyBtn.addEventListener("click", async () => {
    const itens = getSelectedItems();
    const tamanho_camisa = buyShirtSize?.value || "";

    if (!itens.length) {
      toast("Escolha pelo menos um item para comprar.", "error");
      return;
    }

    if (itens.includes("camisa") && !tamanhoCamisaValido(tamanho_camisa)) {
      toast("Escolha o tamanho da camisa.", "error");
      return;
    }

    try {
      confirmBuyBtn.disabled = true;
      confirmBuyBtn.textContent = "Salvando pedido...";

      const data = await apiFetch("/pedidos", {
        method: "POST",
        body: JSON.stringify({ itens, tamanho_camisa }),
      });

      state.pedidos = data.pedidos || [];
      renderMyOrders(state.pedidos);

      document.querySelectorAll(".buy-option input").forEach((input) => {
        input.checked = false;
      });
      if (buyShirtSize) buyShirtSize.value = "";
      updateBuyModal();

      buyModal.classList.add("hidden");
      paymentModal.classList.remove("hidden");
      toast("Pedido salvo com sucesso!");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      confirmBuyBtn.disabled = false;
      confirmBuyBtn.textContent = "Finalizar pedido";
    }
  });
}

// Modal de minicursos

const courseModal = document.getElementById("courseModal");

document.getElementById("openCoursesBtn").addEventListener("click", () => {
  courseModal.classList.remove("hidden");
});

document.getElementById("closeCoursesBtn").addEventListener("click", () => {
  courseModal.classList.add("hidden");
});

courseModal.addEventListener("click", (event) => {
  if (event.target === courseModal) {
    courseModal.classList.add("hidden");
  }
});

document.querySelectorAll(".course-list button").forEach((button) => {
  button.addEventListener("click", async () => {
    const minicurso = button.dataset.course;

    if (!minicurso || !minicursoValido(minicurso)) {
      toast("Escolha um minicurso válido.", "error");
      return;
    }

    try {
      const data = await apiFetch("/minicursos/escolher", {
        method: "POST",
        body: JSON.stringify({ minicurso }),
      });

      const userAtualizado = data.user || {
        ...state.user,
        minicurso,
      };

      userAtualizado.minicurso = minicurso;

      localStorage.setItem("epti_minicurso", minicurso);
      localStorage.setItem("epti_user", JSON.stringify(userAtualizado));

      state.user = userAtualizado;

      renderCurrentCourse(minicurso);

      courseModal.classList.add("hidden");

      toast("Minicurso salvo com sucesso!");
    } catch (error) {
      console.error(error);

      toast("Não foi possível salvar o minicurso agora.", "error");
    }
  });
});

restoreSession();
