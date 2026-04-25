const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();

app.use(cors());
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth()
});

// Grupos cadastrados no bot
const gruposDisponiveis = {
  achouLevou: {
    nome: "Achou Levou",
    id: "120363425895590957@g.us"
  },
  grupoTeste: {
    nome: "Grupo teste",
    id: "120363426800905804@g.us"
  }
};

client.on('qr', (qr) => {
  console.log("QR Code solicitado. Se aparecer no terminal, escaneie pelo WhatsApp.");
});

client.on('ready', () => {
  console.log("WhatsApp conectado 🚀");
});

client.initialize();

app.get('/grupos', (req, res) => {
  res.json({
    ok: true,
    grupos: Object.entries(gruposDisponiveis).map(([chave, grupo]) => ({
      chave,
      nome: grupo.nome,
      id: grupo.id
    }))
  });
});

app.post('/enviar', async (req, res) => {
  const { mensagem, grupos } = req.body;

  if (!mensagem) {
    return res.status(400).json({ ok: false, erro: "Mensagem vazia" });
  }

  if (!Array.isArray(grupos) || grupos.length === 0) {
    return res.status(400).json({ ok: false, erro: "Nenhum grupo selecionado" });
  }

  const gruposSelecionados = grupos
    .map(chave => gruposDisponiveis[chave])
    .filter(Boolean);

  if (!gruposSelecionados.length) {
    return res.status(400).json({ ok: false, erro: "Grupos inválidos" });
  }

  try {
    for (const grupo of gruposSelecionados) {
      await client.sendMessage(grupo.id, mensagem);
      console.log(`Enviado para: ${grupo.nome} - ${grupo.id}`);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    return res.json({
      ok: true,
      status: "Mensagem enviada",
      enviados: gruposSelecionados.map(g => g.nome)
    });
  } catch (err) {
    console.error("Erro ao enviar:", err);
    return res.status(500).json({ ok: false, erro: "Erro ao enviar mensagem" });
  }
});

app.listen(3001, () => {
  console.log("API do Bot Achou Levou rodando em http://localhost:3001 🚀");
});
