const puppeteer = require("puppeteer");
const path = require("path");

const CHROME_PROFILE = path.join(__dirname, "chrome-profile");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 80,
    userDataDir: CHROME_PROFILE,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox",
      "--disable-setuid-sandbox",
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

  console.log("Abrindo Shopee com perfil fixo:", CHROME_PROFILE);
  await page.goto("https://shopee.com.br", { waitUntil: "domcontentloaded", timeout: 120000 });

  console.log("Faça login na janela aberta.");
  console.log("Resolva idioma/cookies/captcha se aparecer.");
  console.log("Depois do login, espere uns 20 segundos.");
  console.log("Vou aguardar 5 minutos e depois fechar automaticamente.");

  await new Promise(r => setTimeout(r, 300000));

  await browser.close();
  console.log("Sessão salva no chrome-profile. Agora rode: node server.js");
})();
