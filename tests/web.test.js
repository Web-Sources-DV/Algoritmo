"use strict";
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const V = require("../js/core.js");
async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: "8099" },
    stdio: "pipe",
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.once("data", resolve);
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`server exit ${code}`)));
    });
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:8099");
    await page.locator("#welcome").waitFor({ state: "visible" });
    await fs.mkdir("outputs/web", { recursive: true });
    await page.screenshot({
      path: "outputs/web/desktop-start.png",
      fullPage: true,
    });
    await page.locator("#quick-demo").click();
    await page
      .locator("#results")
      .waitFor({ state: "visible", timeout: 60000 });
    assert.match(
      await page.locator("#demo-warning").innerText(),
      /ARTIFICIALES/,
    );
    assert.equal(await page.locator(".metrics article").count(), 4);
    assert.ok(await page.locator("#equity-chart svg").count());
    assert.ok(
      Number(
        (await page.locator("#metric-bets").innerText()).replaceAll(".", ""),
      ) > 0,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: "outputs/web/desktop-results.png",
      fullPage: true,
    });
    await page.locator("#tab-model").click();
    assert.equal(await page.locator("#model-table tr").count(), 2);
    assert.ok((await page.locator("#folds-table tr").count()) > 1);
    await page.locator("#tab-bets").click();
    assert.equal(await page.locator("#bets-table tr").count(), 25);
    await page.locator("#next-page").click();
    assert.match(await page.locator("#page-info").innerText(), /Página 2/);
    await page.locator("#bet-filter").selectOption("lost");
    assert.match(await page.locator("#page-info").innerText(), /Página 1/);
    await page.locator("#tab-downloads").click();
    const event = page.waitForEvent("download");
    await page.locator('[data-export="report"]').click();
    const downloaded = await event;
    assert.equal(downloaded.suggestedFilename(), "valuebet-report-demo.json");
    const report = JSON.parse(
      await fs.readFile(await downloaded.path(), "utf8"),
    );
    assert.equal(report.synthetic, true);
    assert.equal(report.validation.matches, 1640);
    // Un cambio señala resultados obsoletos; un intento erróneo no conserva cifras antiguas.
    await page.locator("#source").selectOption("csv");
    assert.equal(await page.locator("#stale").isVisible(), true);
    await page.locator("#run").click();
    await page.locator("#error").waitFor({ state: "visible" });
    assert.match(await page.locator("#error").innerText(), /Selecciona/);
    assert.equal(await page.locator("#results").isVisible(), false);
    // Carga real de CSV en navegador, con nombre malicioso tratado como texto.
    const text = V.demoCSV().replaceAll(
      "Equipo 01",
      "<img src=x onerror=alert(1)>",
    );
    await page
      .locator("#files")
      .setInputFiles({
        name: "historial.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(text),
      });
    await page.locator("#run").click();
    await page
      .locator("#results")
      .waitFor({ state: "visible", timeout: 60000 });
    assert.equal(await page.locator("#demo-warning").isVisible(), false);
    await page.locator("#tab-bets").click();
    assert.equal(await page.locator("#bets-table img").count(), 0);
    // Modelo alternativo completo desde los controles.
    await page.locator("#model").selectOption("boosting");
    await page.locator("#run").click();
    await page
      .locator("#results")
      .waitFor({ state: "visible", timeout: 60000 });
    await page.locator("#tab-downloads").click();
    assert.match(
      await page.locator("#parameters").innerText(),
      /Gradient boosting/,
    );
    // Riesgo inválido: tope individual mayor al diario.
    await page
      .locator("summary")
      .filter({ hasText: "Riesgo y costes" })
      .first()
      .click();
    await page.locator("#cap").fill("20");
    await page.locator("#run").click();
    await page.locator("#error").waitFor({ state: "visible" });
    assert.match(await page.locator("#error").innerText(), /tope por apuesta/);
    // Móvil: sin desbordamiento horizontal y controles visibles.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: "outputs/web/mobile.png", fullPage: true });
    // Abrir index.html directamente: el mismo flujo funciona sin Node ni Python.
    try {
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.locator("#quick-demo").click();
      await page
        .locator("#results")
        .waitFor({ state: "visible", timeout: 60000 });
      assert.equal(await page.locator("#demo-warning").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      console.log("PASS file://");
    } catch (error) {
      if (!error.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")) throw error;
      console.log(
        "SKIP file://: la política administrada de Chromium impide abrir archivos locales; el flujo HTTP sí fue verificado.",
      );
    }
    assert.deepEqual(errors, []);
    // El servidor no expone metadatos Git ni archivos locales del análisis.
    for (const file of ["/.git/config", "/data/synthetic.csv", "/package.json"])
      assert.equal((await fetch(`http://127.0.0.1:8099${file}`)).status, 404);
    console.log(
      "PASS: demo HTTP, métricas, tabs, paginación, exportación, CSV, errores, XSS, móvil y ambos modelos. Sin errores JavaScript.",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
