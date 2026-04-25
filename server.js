import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "offers.json");
const CHROME_PROFILE = path.join(__dirname, "chrome-profile");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readOffers() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return []; }
}

function saveOffers(offers) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(offers, null, 2), "utf8");
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizePrice(text = "") {
  const match = String(text).replace(/\s+/g, " ").match(/R\$\s?\d{1,6}(?:[.,]\d{2})?/);
  return match ? match[0].replace("R$ ", "R$") : "";
}

function priceToNumber(price = "") {
  const n = Number(String(price).replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function chooseOldPrice(currentPrice, allPrices) {
  const current = priceToNumber(currentPrice);
  if (!current) return "";

  const bigger = allPrices
    .map(raw => ({ raw, value: priceToNumber(raw) }))
    .filter(p => p.value && p.value > current)
    .sort((a, b) => b.value - a.value)[0];

  return bigger ? bigger.raw : "";
}

function cleanProductTitle(title = "") {
  return cleanText(title)
    .replace(/\| Amazon.com.br.*$/i, "")
    .replace(/Amazon.com.br[:\s-]*/i, "")
    .replace(/\| Shopee Brasil.*$/i, "")
    .replace(/Shopee Brasil.*$/i, "")
    .replace(/\| Mercado Livre.*$/i, "")
    .trim();
}

async function resolveShortLink(url) {
  try {
    const response = await axios.get(url, {
      maxRedirects: 10,
      timeout: 20000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });

    return response.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
}

async function scrapeWithAxios(url) {
  const response = await axios.get(url, {
    maxRedirects: 8,
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
    }
  });

  const html = response.data;
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const title =
    cleanText($('meta[property="og:title"]').attr("content")) ||
    cleanText($('meta[name="title"]').attr("content")) ||
    cleanText($("#productTitle").text()) ||
    cleanText($("title").first().text());

  const description =
    cleanText($('meta[property="og:description"]').attr("content")) ||
    cleanText($('meta[name="description"]').attr("content"));

  const image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("#landingImage").attr("src") ||
    "";

  let price =
    normalizePrice($('meta[property="product:price:amount"]').attr("content")) ||
    normalizePrice($("#priceblock_dealprice").text()) ||
    normalizePrice($("#priceblock_ourprice").text()) ||
    normalizePrice($(".a-price .a-offscreen").first().text()) ||
    normalizePrice($('[class*="price"]').first().text()) ||
    normalizePrice(bodyText);

  let oldPrice =
    normalizePrice($(".a-text-price .a-offscreen").first().text()) ||
    normalizePrice($('[data-a-strike="true"] .a-offscreen').first().text()) ||
    normalizePrice($('[class*="priceBlockStrikePrice"]').text()) ||
    normalizePrice($('[class*="listPrice"]').text()) ||
    "";

  return {
    title,
    price,
    oldPrice,
    image,
    description,
    finalUrl: response.request?.res?.responseUrl || url
  };
}

async function abrirChromeSessao(url) {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 80,
    defaultViewport: null,
    userDataDir: CHROME_PROFILE,
    protocolTimeout: 180000,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=pt-BR"
    ]
  });

  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  });

  console.log("Abrindo Shopee com perfil salvo:", CHROME_PROFILE);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  }).catch(err => {
    console.log("Aviso no carregamento:", err.message);
  });

  return { browser, page };
}

async function scrapeShopeeComSessao(url) {
  let browser;
  try {
    const sessao = await abrirChromeSessao(url);
    browser = sessao.browser;
    const page = sessao.page;

    console.log("Se pedir login/captcha/idioma, resolva na janela aberta.");
    console.log("Vou esperar 90 segundos antes de tentar ler os dados...");
    await new Promise(r => setTimeout(r, 90000));

    for (let i = 0; i < 8; i++) {
      await page.mouse.move(150 + i * 20, 200 + i * 12).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, 450)).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
    }

    try {
      await page.waitForFunction(() => /R\$\s?\d/.test(document.body?.innerText || ""), { timeout: 30000 });
    } catch {
      console.log("Preço não apareceu no tempo limite. Tentando extrair mesmo assim...");
    }

    const data = await page.evaluate(() => {
      const clean = (v = "") => String(v).replace(/\s+/g, " ").trim();
      const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";

      const title =
        meta('meta[property="og:title"]') ||
        meta('meta[name="title"]') ||
        document.querySelector("h1")?.innerText ||
        document.title ||
        "";

      const description =
        meta('meta[property="og:description"]') ||
        meta('meta[name="description"]') ||
        "";

      const image =
        meta('meta[property="og:image"]') ||
        meta('meta[name="twitter:image"]') ||
        Array.from(document.images).map(img => img.src).find(src => src && src.includes("shopee")) ||
        "";

      const bodyText = document.body?.innerText || "";
      const prices = [...new Set((bodyText.match(/R\$\s?\d{1,6}(?:[.,]\d{2})?/g) || []).map(p => p.replace("R$ ", "R$")))];

      return {
        title: clean(title),
        description: clean(description),
        image,
        prices,
        finalUrl: location.href
      };
    });

    const prices = data.prices || [];
    const price = prices[0] || "";
    const oldPrice = chooseOldPrice(price, prices);

    return {
      title: data.title,
      price,
      oldPrice,
      image: data.image,
      description: data.description,
      finalUrl: data.finalUrl
    };
  } finally {
    if (browser) await browser.close();
  }
}

// ================= ROTAS =================

app.get("/api/offers", (req, res) => {
  res.json(readOffers());
});

app.post("/api/offers", (req, res) => {
  const { titulo = "", preco = "", precoAntigo = "", cupom = "", link = "", imagem = "", descricao = "" } = req.body;
  const offers = readOffers();

  const offer = {
    id: Date.now().toString(),
    titulo,
    preco,
    precoAntigo,
    cupom,
    link,
    imagem,
    descricao,
    createdAt: new Date().toISOString()
  };

  offers.unshift(offer);
  saveOffers(offers);

  res.json({ ok: true, offer });
});

app.delete("/api/offers/:id", (req, res) => {
  saveOffers(readOffers().filter(o => o.id !== req.params.id));
  res.json({ ok: true });
});

app.post("/api/scrape", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, message: "Link não informado." });

  let cleanUrl = String(url).replaceAll("\\", "/").trim();

  try {
    if (/s\.shopee\.com/i.test(cleanUrl)) {
      console.log("Resolvendo link curto Shopee...");
      cleanUrl = await resolveShortLink(cleanUrl);
      console.log("Link final:", cleanUrl);
    }

    let data = {};
    const isShopee = /shopee\.com/i.test(cleanUrl);

    if (!isShopee) {
      try { data = await scrapeWithAxios(cleanUrl); } catch { data = {}; }
    }

    if (isShopee || !data.title || !data.price) {
      console.log("Puxando com sessão salva:", cleanUrl);
      const puppeteerData = await scrapeShopeeComSessao(cleanUrl);
      data = { ...data, ...Object.fromEntries(Object.entries(puppeteerData).filter(([k, v]) => v)) };
    }

    const title = cleanProductTitle(data.title);
    const price = data.price || "";
    const oldPrice = data.oldPrice || "";
    const image = data.image || "";
    const description = data.description || "";

    if (!title && !price && !image) {
      return res.json({
        ok: false,
        message: "Não consegui puxar esse link. Se abriu login/captcha, resolva e tente de novo."
      });
    }

    return res.json({
      ok: true,
      title,
      price,
      oldPrice,
      image,
      description,
      finalUrl: data.finalUrl || cleanUrl
    });
  } catch (error) {
    console.log("Erro no scraper:", error.message);
    return res.json({
      ok: false,
      message: "Não consegui puxar esse link. A Shopee pode ter bloqueado ou pedido verificação.",
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Achou Levou HARDCORE rodando em http://localhost:${PORT}`);
  console.log(`Perfil da Shopee: ${CHROME_PROFILE}`);
});
