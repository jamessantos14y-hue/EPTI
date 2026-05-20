const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      turma TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      minicurso TEXT,
      tamanho_camisa TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      minicurso_atualizado_em TIMESTAMP,
      tamanho_camisa_atualizado_em TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS minicurso TEXT,
    ADD COLUMN IF NOT EXISTS tamanho_camisa TEXT,
    ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS minicurso_atualizado_em TIMESTAMP,
    ADD COLUMN IF NOT EXISTS tamanho_camisa_atualizado_em TIMESTAMP;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      item TEXT NOT NULL,
      item_nome TEXT NOT NULL,
      tamanho_camisa TEXT,
      preco_centavos INTEGER NOT NULL,
      status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE',
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      aprovado_em TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE pedidos
    ADD COLUMN IF NOT EXISTS item_nome TEXT,
    ADD COLUMN IF NOT EXISTS tamanho_camisa TEXT,
    ADD COLUMN IF NOT EXISTS preco_centavos INTEGER,
    ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT 'PENDENTE',
    ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMP;
  `);
}

async function run(sql, params = []) {
  const result = await pool.query(sql, params);

  return {
    id: result.rows?.[0]?.id,
    changes: result.rowCount,
    rows: result.rows,
  };
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

initDb().catch((error) => {
  console.error("Erro ao inicializar banco PostgreSQL:", error);
});

async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  run,
  get,
  all,
  transaction,
};
