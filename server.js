import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "offers.json");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readOffers() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveOffers(offers) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(offers, null, 2), "utf8");
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizePrice(text = "") {
  const match = String(text).replace(/\s+/g, " ").match(/R\$\s?\d{1,6}(?:[.,]\d{2})?/);
  return match ? match[0].replace("R$ ", "R$") : "";
}

app.get("/api/offers", (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json(readOffers());
});

app.post("/api/offers", (req, res) => {
  const { titulo = "", preco = "", cupom = "", link = "", imagem = "", descricao = "" } = req.body;
  const offers = readOffers();

  const offer = {
    id: Date.now().toString(),
    titulo,
    preco,
    cupom,
    link,
    imagem,
    descricao,
    createdAt: new Date().toISOString()
  };

  offers.unshift(offer);
  saveOffers(offers);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json({ ok: true, offer });
});

app.delete("/api/offers/:id", (req, res) => {
  saveOffers(readOffers().filter(o => o.id !== req.params.id));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json({ ok: true });
});

app.post("/api/scrape", async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, message: "Link não informado." });

  try {
    const response = await axios.get(url, {
      maxRedirects: 8,
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const title =
      cleanText($('meta[property="og:title"]').attr("content")) ||
      cleanText($('meta[name="title"]').attr("content")) ||
      cleanText($("title").first().text());

    const description =
      cleanText($('meta[property="og:description"]').attr("content")) ||
      cleanText($('meta[name="description"]').attr("content"));

    const image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      "";

    const bodyText = $("body").text();
    let price =
      normalizePrice($('meta[property="product:price:amount"]').attr("content")) ||
      normalizePrice($('[class*="price"]').first().text()) ||
      normalizePrice(bodyText);

    let cleanTitle = title
      .replace(/\| Amazon.com.br.*$/i, "")
      .replace(/Amazon.com.br[:\s-]*/i, "")
      .replace(/\| Shopee Brasil.*$/i, "")
      .replace(/Shopee Brasil[:\s-]*/i, "")
      .trim();

    if (!cleanTitle && !price && !image) {
      return res.json({
        ok: false,
        message: "Não consegui puxar esse link. Preencha manualmente."
      });
    }

    return res.json({
      ok: true,
      title: cleanTitle,
      price,
      image,
      description
    });
  } catch (error) {
    return res.json({
      ok: false,
      message: "Não consegui puxar esse link. Tente o link completo ou preencha manualmente.",
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Achou Levou link afiliado rodando em http://localhost:${PORT}`);
});
