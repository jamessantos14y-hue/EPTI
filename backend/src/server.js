require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { run, get, all, transaction } = require("./db");
const { createToken, authMiddleware } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

const turmasPermitidas = ["1C", "2A", "2D", "3D", "2° Marta Giffoni"];

const minicursosConfig = [
  { nome: "Programação", limite: 30 },
  { nome: "Infraestrutura", limite: 25 },
  { nome: "Design", limite: 30 },
  { nome: "Manutenção de celulares", limite: 25 },
  { nome: "Eletrônica", limite: 25 },
];

const minicursosPermitidos = minicursosConfig.map((curso) => curso.nome);
const limitesMinicursos = Object.fromEntries(minicursosConfig.map((curso) => [curso.nome, curso.limite]));

const tamanhosCamisaPermitidos = ["P", "M", "G", "GG"];

const itensPermitidos = {
  camisa: { nome: "Camisa", preco_centavos: 3500 },
  ecobag: { nome: "Ecobag", preco_centavos: 3500 },
  broche: { nome: "Broche", preco_centavos: 800 },
  mochila: { nome: "Mochila", preco_centavos: 1500 },
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validarEmailInstitucional(email) {
  return normalizarEmail(email).endsWith("@aluno.ce.gov.br");
}

function normalizarTurma(valor) {
  return String(valor || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[º°]/g, "");
}

function turmaSemMinicurso(turma) {
  return normalizarTurma(turma) === "2A";
}

async function listarStatusMinicursos() {
  const contagens = await all(
    `
    SELECT minicurso, COUNT(*)::int AS inscritos
    FROM usuarios
    WHERE minicurso = ANY($1)
    GROUP BY minicurso
    `,
    [minicursosPermitidos]
  );

  const inscritosPorCurso = Object.fromEntries(
    contagens.map((row) => [row.minicurso, Number(row.inscritos || 0)])
  );

  return minicursosConfig.map((curso) => {
    const inscritos = inscritosPorCurso[curso.nome] || 0;
    const vagas_restantes = Math.max(curso.limite - inscritos, 0);

    return {
      nome: curso.nome,
      limite: curso.limite,
      inscritos,
      vagas_restantes,
      esgotado: vagas_restantes <= 0,
    };
  });
}

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    turma: user.turma,
    email: user.email,
    minicurso: user.minicurso || null,
    tamanho_camisa: user.tamanho_camisa || null,
  };
}

function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatarDataBrasil(data) {
  if (!data) return "-";

  let dataConvertida;

  if (data instanceof Date) {
    dataConvertida = data;
  } else {
    const texto = String(data).trim();
    dataConvertida = texto.includes("T") ? new Date(texto) : new Date(texto.replace(" ", "T") + "Z");
  }

  if (Number.isNaN(dataConvertida.getTime())) {
    return String(data);
  }

  return dataConvertida.toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatarPrecoCentavos(precoCentavos) {
  return Number((precoCentavos || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function listarPedidosDoUsuario(usuarioId) {
  return all(
    `
    SELECT
      id,
      item,
      item_nome,
      tamanho_camisa,
      preco_centavos,
      status_pagamento,
      criado_em,
      aprovado_em
    FROM pedidos
    WHERE usuario_id = $1
    ORDER BY id DESC
    `,
    [usuarioId]
  );
}

function normalizarBuscaNome(valor) {
  return String(valor || "").trim();
}

function normalizarStatusFiltro(valor) {
  const status = String(valor || "").trim().toLowerCase();

  if (status === "pendente" || status === "pendentes" || status === "pendente primeiro") {
    return "PENDENTE";
  }

  if (status === "aprovado" || status === "aprovados" || status === "aprovado primeiro") {
    return "APROVADO";
  }

  return "";
}

function montarUrlAdminComFiltros(buscaNome, statusPrioritario) {
  const params = new URLSearchParams();

  if (buscaNome) params.set("q", buscaNome);
  if (statusPrioritario) params.set("status", statusPrioritario.toLowerCase());

  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

function montarOrderByPedidos(buscaNome, statusPrioritario, params) {
  const criterios = [];

  if (buscaNome) {
    params.push(`%${buscaNome}%`);
    criterios.push(`CASE WHEN u.nome ILIKE $${params.length} THEN 0 ELSE 1 END`);
  }

  if (statusPrioritario) {
    params.push(statusPrioritario);
    criterios.push(`CASE WHEN p.status_pagamento = $${params.length} THEN 0 ELSE 1 END`);
  }

  criterios.push("u.turma ASC");
  criterios.push("p.id DESC");

  return criterios.join(", ");
}

async function buscarPedidosAdmin({ buscaNome = "", statusPrioritario = "" } = {}) {
  const params = [];
  const orderBy = montarOrderByPedidos(buscaNome, statusPrioritario, params);

  return all(
    `
    SELECT
      p.id,
      p.usuario_id,
      u.nome,
      u.turma,
      u.email,
      p.item,
      p.item_nome,
      p.tamanho_camisa,
      p.preco_centavos,
      p.status_pagamento,
      p.criado_em,
      p.aprovado_em
    FROM pedidos p
    JOIN usuarios u ON u.id = p.usuario_id
    ORDER BY ${orderBy}
    `,
    params
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "UP",
    app: "EPTI Evento Backend",
    database: process.env.DATABASE_URL ? "PostgreSQL/Supabase" : "Sem DATABASE_URL",
  });
});

app.get("/api/admin/usuarios", async (req, res) => {
  try {
    const usuarios = await all(
      `
      SELECT
        id,
        nome,
        turma,
        email,
        minicurso,
        tamanho_camisa,
        criado_em,
        minicurso_atualizado_em,
        tamanho_camisa_atualizado_em
      FROM usuarios
      ORDER BY id DESC
      `
    );

    const usuariosFormatados = usuarios.map((user) => ({
      ...user,
      criado_em_brasil: formatarDataBrasil(user.criado_em),
      minicurso_atualizado_em_brasil: formatarDataBrasil(user.minicurso_atualizado_em),
      tamanho_camisa_atualizado_em_brasil: formatarDataBrasil(user.tamanho_camisa_atualizado_em),
    }));

    return res.json({ total: usuariosFormatados.length, usuarios: usuariosFormatados });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao listar usuários." });
  }
});

app.get("/api/admin/pedidos", async (req, res) => {
  try {
    const buscaNome = normalizarBuscaNome(req.query.q);
    const statusPrioritario = normalizarStatusFiltro(req.query.status);
    const pedidos = await buscarPedidosAdmin({ buscaNome, statusPrioritario });

    return res.json({
      total: pedidos.length,
      filtros: {
        busca: buscaNome,
        status_prioritario: statusPrioritario || null,
        ordenacao_padrao: "turma e mais recentes",
      },
      pedidos,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao listar pedidos." });
  }
});

app.post("/api/admin/pedidos/:id/aprovar", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Pedido inválido." });
    }

    const pedido = await get("SELECT id FROM pedidos WHERE id = $1", [id]);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido não encontrado." });
    }

    await run(
      `
      UPDATE pedidos
      SET status_pagamento = 'APROVADO',
          aprovado_em = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [id]
    );

    return res.json({ message: "Pagamento aprovado com sucesso." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao aprovar pagamento." });
  }
});

app.post("/api/admin/pedidos/:id/desaprovar", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Pedido inválido." });
    }

    const pedido = await get("SELECT id FROM pedidos WHERE id = $1", [id]);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido não encontrado." });
    }

    await run(
      `
      UPDATE pedidos
      SET status_pagamento = 'PENDENTE',
          aprovado_em = NULL
      WHERE id = $1
      `,
      [id]
    );

    return res.json({ message: "Pagamento voltou para pendente com sucesso." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao desaprovar pagamento." });
  }
});

app.post("/admin/pedidos/:id/aprovar", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (Number.isInteger(id) && id > 0) {
      await run(
        `
        UPDATE pedidos
        SET status_pagamento = 'APROVADO',
            aprovado_em = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [id]
      );
    }

    return res.redirect(req.get("referer") || "/admin");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Erro ao aprovar pagamento.");
  }
});

app.post("/admin/pedidos/:id/desaprovar", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (Number.isInteger(id) && id > 0) {
      await run(
        `
        UPDATE pedidos
        SET status_pagamento = 'PENDENTE',
            aprovado_em = NULL
        WHERE id = $1
        `,
        [id]
      );
    }

    return res.redirect(req.get("referer") || "/admin");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Erro ao desaprovar pagamento.");
  }
});

app.get("/admin", async (req, res) => {
  try {
    const buscaNome = normalizarBuscaNome(req.query.q);
    const statusPrioritario = normalizarStatusFiltro(req.query.status);

    const usuarios = await all(
      `
      SELECT
        id,
        nome,
        turma,
        email,
        minicurso,
        criado_em,
        minicurso_atualizado_em
      FROM usuarios
      ORDER BY turma ASC, id DESC
      `
    );

    const pedidos = await buscarPedidosAdmin({ buscaNome, statusPrioritario });

    const totalPendentes = pedidos.filter((pedido) => pedido.status_pagamento !== "APROVADO").length;
    const totalAprovados = pedidos.filter((pedido) => pedido.status_pagamento === "APROVADO").length;

    const linhasPedidos = pedidos
      .map((pedido) => {
        const aprovado = pedido.status_pagamento === "APROVADO";
        const statusLabel = aprovado ? "Aprovado" : "Pendente";
        const statusClass = aprovado ? "ok" : "wait";

        return `
          <tr>
            <td>${escaparHtml(pedido.id)}</td>
            <td>${escaparHtml(pedido.nome)}</td>
            <td>${escaparHtml(pedido.turma)}</td>
            <td>${escaparHtml(pedido.email)}</td>
            <td>${escaparHtml(pedido.item_nome)}</td>
            <td>${escaparHtml(pedido.tamanho_camisa || "-")}</td>
            <td>${escaparHtml(formatarPrecoCentavos(pedido.preco_centavos))}</td>
            <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            <td>${escaparHtml(formatarDataBrasil(pedido.criado_em))}</td>
            <td>${escaparHtml(formatarDataBrasil(pedido.aprovado_em))}</td>
            <td>
              ${aprovado ? `
                <form method="POST" action="/admin/pedidos/${pedido.id}/desaprovar">
                  <button class="danger" type="submit">Voltar para pendente</button>
                </form>
              ` : `
                <form method="POST" action="/admin/pedidos/${pedido.id}/aprovar">
                  <button type="submit">Aprovar pagamento</button>
                </form>
              `}
            </td>
          </tr>
        `;
      })
      .join("");

    const linhasUsuarios = usuarios
      .map(
        (user) => `
          <tr>
            <td>${escaparHtml(user.id)}</td>
            <td>${escaparHtml(user.nome)}</td>
            <td>${escaparHtml(user.turma)}</td>
            <td>${escaparHtml(user.email)}</td>
            <td>${escaparHtml(user.minicurso || "Ainda não escolheu")}</td>
            <td>${escaparHtml(formatarDataBrasil(user.criado_em))}</td>
            <td>${escaparHtml(formatarDataBrasil(user.minicurso_atualizado_em))}</td>
          </tr>
        `
      )
      .join("");

    const statusSelecionado = statusPrioritario.toLowerCase();
    const apiPedidosUrl = `/api/admin/pedidos${montarUrlAdminComFiltros(buscaNome, statusPrioritario).replace("/admin", "")}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Admin EPTI</title>
        <style>
          :root{--bg:#050609;--card:rgba(12,15,23,.96);--text:#f6f7fb;--muted:#a9afc3;--line:rgba(255,255,255,.14);--primary:#ff2f4f;--primary2:#ff8a00;--ok:#2ee6a6;--wait:#ffd166;--danger:#ff5964}*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Arial,sans-serif;color:var(--text);background:radial-gradient(circle at top,#3a0710 0%,var(--bg) 55%);padding:24px}.card{max-width:1450px;margin:0 auto 24px;border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 20px 70px rgba(0,0,0,.45);overflow:hidden}header{padding:24px;border-bottom:1px solid var(--line)}h1,h2{margin:0 0 8px}p{margin:0;color:var(--muted)}.actions{display:flex;gap:10px;flex-wrap:wrap;padding:16px 24px;border-bottom:1px solid var(--line)}.filters{display:grid;grid-template-columns:2fr 1fr auto auto;gap:12px;align-items:end;padding:16px 24px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.025)}.field label{display:block;margin:0 0 7px;color:var(--muted);font-size:.88rem;font-weight:800}.field input,.field select{width:100%;min-height:43px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--text);background:rgba(255,255,255,.08);outline:none}.field option{color:#111}.active-filters{padding:0 24px 16px;color:var(--muted);font-size:.92rem}.active-filters strong{color:#fff}a,button{border:0;border-radius:12px;padding:11px 14px;cursor:pointer;text-decoration:none;color:#fff;font-weight:800;background:linear-gradient(90deg,var(--primary),var(--primary2))}.secondary{display:inline-block;background:rgba(255,255,255,.08);border:1px solid var(--line)}button.danger{background:linear-gradient(90deg,#ff5964,#a91d2b)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:1120px}th,td{padding:14px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:#ffe7ea;background:rgba(255,47,79,.18)}tr:hover td{background:rgba(255,255,255,.04)}.empty{padding:24px;color:var(--muted)}.count{color:var(--primary);font-weight:800}.hint{margin-top:8px;font-size:.9rem;color:var(--muted)}.badge{display:inline-block;border-radius:999px;padding:7px 10px;font-weight:800;font-size:.82rem}.badge.ok{color:#062317;background:rgba(46,230,166,.9)}.badge.wait{color:#2a1b00;background:rgba(255,209,102,.95)}.stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.stat{padding:8px 11px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.05);font-weight:800}.stat.ok{color:var(--ok)}.stat.wait{color:var(--wait)}form{margin:0}@media(max-width:760px){body{padding:12px}header{padding:18px}h1{font-size:1.5rem}.actions{padding:14px 18px}.filters{grid-template-columns:1fr;padding:14px 18px}a,button{width:100%;text-align:center}th,td{padding:12px;font-size:.9rem}.active-filters{padding:0 18px 14px}}
        </style>
      </head>
      <body>
        <div class="card">
          <header>
            <h1>Admin EPTI - Pedidos</h1>
            <p>Pedidos realizados pelos alunos. Total: <span class="count">${pedidos.length}</span></p>
            <p class="hint">Padrão: organizado por sala/turma e, dentro de cada sala, pelos pedidos mais recentes.</p>
            <div class="stats">
              <span class="stat wait">Pendentes: ${totalPendentes}</span>
              <span class="stat ok">Aprovados: ${totalAprovados}</span>
            </div>
          </header>

          <form class="filters" method="GET" action="/admin">
            <div class="field">
              <label for="q">Buscar por nome</label>
              <input id="q" name="q" type="search" value="${escaparHtml(buscaNome)}" placeholder="Digite o nome do aluno" />
            </div>

            <div class="field">
              <label for="status">Organizar por status</label>
              <select id="status" name="status">
                <option value="" ${!statusSelecionado ? "selected" : ""}>Padrão: sala e recentes</option>
                <option value="pendente" ${statusSelecionado === "pendente" ? "selected" : ""}>Pendentes primeiro</option>
                <option value="aprovado" ${statusSelecionado === "aprovado" ? "selected" : ""}>Aprovados primeiro</option>
              </select>
            </div>

            <button type="submit">Aplicar</button>
            <a class="secondary" href="/admin">Limpar</a>
          </form>

          <div class="active-filters">
            ${buscaNome ? `Busca ativa: <strong>${escaparHtml(buscaNome)}</strong>. ` : ""}
            ${statusPrioritario ? `Filtro ativo: <strong>${statusPrioritario === "PENDENTE" ? "Pendentes primeiro" : "Aprovados primeiro"}</strong>. ` : ""}
            Os resultados buscados aparecem primeiro, sem esconder os demais.
          </div>

          <div class="actions">
            <button onclick="location.reload()">Atualizar</button>
            <a href="${apiPedidosUrl}" target="_blank">Ver pedidos em JSON</a>
            <a href="/api/admin/usuarios" target="_blank">Ver usuários em JSON</a>
          </div>
          ${
            pedidos.length
              ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Nome</th><th>Turma</th><th>Email</th><th>Item</th><th>Tam.</th><th>Preço</th><th>Status</th><th>Pedido em</th><th>Aprovado em</th><th>Ação</th></tr></thead><tbody>${linhasPedidos}</tbody></table></div>`
              : `<div class="empty">Nenhum pedido realizado ainda.</div>`
          }
        </div>

        <div class="card">
          <header>
            <h2>Usuários cadastrados</h2>
            <p>Total: <span class="count">${usuarios.length}</span></p>
            <p class="hint">Também organizado por sala/turma e cadastros mais recentes.</p>
          </header>
          ${
            usuarios.length
              ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Nome</th><th>Turma</th><th>Email</th><th>Minicurso</th><th>Criado em</th><th>Minicurso atualizado em</th></tr></thead><tbody>${linhasUsuarios}</tbody></table></div>`
              : `<div class="empty">Nenhum usuário cadastrado ainda.</div>`
          }
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    return res.status(500).send("Erro ao carregar painel admin.");
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const nome = String(req.body.nome || "").trim();
    const turma = String(req.body.turma || "").trim();
    const email = normalizarEmail(req.body.email);
    const senha = String(req.body.senha || "");

    if (!nome || !turma || !email || !senha) return res.status(400).json({ message: "Preencha todos os campos." });
    if (!turmasPermitidas.includes(turma)) return res.status(400).json({ message: "Turma inválida." });
    if (!validarEmailInstitucional(email)) return res.status(400).json({ message: "Use um email institucional @aluno.ce.gov.br." });
    if (senha.length < 6) return res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres." });

    const existe = await get("SELECT id FROM usuarios WHERE email = $1", [email]);
    if (existe) return res.status(409).json({ message: "Este email já está cadastrado." });

    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await run("INSERT INTO usuarios (nome, turma, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING id", [nome, turma, email, senhaHash]);
    const user = await get("SELECT * FROM usuarios WHERE id = $1", [result.id]);
    const token = createToken(user);

    return res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro interno ao cadastrar usuário." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizarEmail(req.body.email);
    const senha = String(req.body.senha || "");

    if (!email || !senha) return res.status(400).json({ message: "Informe email e senha." });
    if (!validarEmailInstitucional(email)) return res.status(400).json({ message: "Use seu email institucional @aluno.ce.gov.br." });

    const user = await get("SELECT * FROM usuarios WHERE email = $1", [email]);
    if (!user) return res.status(401).json({ message: "Email ou senha inválidos." });

    const senhaOk = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaOk) return res.status(401).json({ message: "Email ou senha inválidos." });

    const token = createToken(user);
    return res.json({ token, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro interno ao fazer login." });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await get("SELECT * FROM usuarios WHERE id = $1", [req.auth.id]);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao buscar usuário." });
  }
});

app.get("/api/minicursos", async (req, res) => {
  try {
    const cursos = await listarStatusMinicursos();
    return res.json({ minicursos: cursos });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao listar minicursos." });
  }
});

app.get("/api/itens", (req, res) => {
  res.json({ itens: itensPermitidos });
});

async function salvarOuMudarMinicurso(req, res) {
  try {
    const minicurso = String(req.body.minicurso || "").trim();
    if (!minicursosPermitidos.includes(minicurso)) return res.status(400).json({ message: "Minicurso inválido." });

    const resultado = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(20260520)");

      const userResult = await client.query("SELECT * FROM usuarios WHERE id = $1 FOR UPDATE", [req.auth.id]);
      const user = userResult.rows[0];

      if (!user) {
        return { status: 404, body: { message: "Usuário não encontrado." } };
      }

      if (turmaSemMinicurso(user.turma)) {
        return {
          status: 403,
          body: { message: "Alunos da turma 2°A não podem escolher minicurso." },
        };
      }

      if (user.minicurso === minicurso) {
        return {
          status: 200,
          body: {
            message: "Você já está inscrito neste minicurso.",
            user: publicUser(user),
            minicursos: await listarStatusMinicursos(),
          },
        };
      }

      const limite = limitesMinicursos[minicurso];
      const countResult = await client.query(
        "SELECT COUNT(*)::int AS inscritos FROM usuarios WHERE minicurso = $1 AND id <> $2",
        [minicurso, user.id]
      );
      const inscritos = Number(countResult.rows[0]?.inscritos || 0);

      if (inscritos >= limite) {
        return {
          status: 409,
          body: {
            message: `O limite de inscrições para ${minicurso} acabou.`,
            minicurso,
            limite,
            inscritos,
          },
        };
      }

      await client.query(
        "UPDATE usuarios SET minicurso = $1, minicurso_atualizado_em = CURRENT_TIMESTAMP WHERE id = $2",
        [minicurso, user.id]
      );

      const updatedResult = await client.query("SELECT * FROM usuarios WHERE id = $1", [user.id]);
      const updatedUser = updatedResult.rows[0];

      return {
        status: 200,
        body: {
          message: user.minicurso ? "Minicurso alterado com sucesso." : "Minicurso salvo com sucesso.",
          user: publicUser(updatedUser),
        },
      };
    });

    return res.status(resultado.status).json(resultado.body);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao salvar minicurso." });
  }
}

app.post("/api/minicursos/escolher", authMiddleware, salvarOuMudarMinicurso);
app.put("/api/minicursos/escolher", authMiddleware, salvarOuMudarMinicurso);

app.get("/api/pedidos/me", authMiddleware, async (req, res) => {
  try {
    const pedidos = await listarPedidosDoUsuario(req.auth.id);
    return res.json({ pedidos });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao buscar seus pedidos." });
  }
});

app.post("/api/pedidos", authMiddleware, async (req, res) => {
  try {
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    const itensUnicos = [...new Set(itens.map((item) => String(item || "").trim().toLowerCase()))];
    const tamanhoCamisa = String(req.body.tamanho_camisa || "").trim().toUpperCase();

    if (!itensUnicos.length) return res.status(400).json({ message: "Escolha pelo menos um item." });
    if (itensUnicos.length > 4) return res.status(400).json({ message: "Quantidade de itens inválida." });

    for (const item of itensUnicos) {
      if (!itensPermitidos[item]) return res.status(400).json({ message: `Item inválido: ${item}` });
    }

    if (itensUnicos.includes("camisa") && !tamanhosCamisaPermitidos.includes(tamanhoCamisa)) {
      return res.status(400).json({ message: "Escolha o tamanho da camisa." });
    }

    const user = await get("SELECT id FROM usuarios WHERE id = $1", [req.auth.id]);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    for (const item of itensUnicos) {
      const produto = itensPermitidos[item];
      await run(
        `
        INSERT INTO pedidos (usuario_id, item, item_nome, tamanho_camisa, preco_centavos, status_pagamento)
        VALUES ($1, $2, $3, $4, $5, 'PENDENTE')
        `,
        [user.id, item, produto.nome, item === "camisa" ? tamanhoCamisa : null, produto.preco_centavos]
      );
    }

    const pedidos = await listarPedidosDoUsuario(user.id);
    return res.status(201).json({
      message: "Pedido salvo com sucesso. Envie o comprovante do Pix para +55 88 9927-6593.",
      whatsapp: "+55 88 9927-6593",
      pedidos,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao salvar pedido." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor EPTI rodando na porta ${PORT}`);
});
