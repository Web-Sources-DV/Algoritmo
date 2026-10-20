/* Interacción sin frameworks: compatible con index.html abierto como archivo. */
"use strict";
const $ = (id) => document.getElementById(id);
const V = window.ValueBet;
let result = null,
  page = 0,
  running = false;
const number = (n, d = 2) =>
  new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
const percent = (n) => `${number(n * 100)}%`;
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function updateSource() {
  const source = $("source").value;
  $("csv-controls").hidden = source !== "csv";
  $("download-controls").hidden = source !== "download";
  $("source-help").textContent =
    source === "demo"
      ? "2.400 partidos artificiales para explorar la herramienta."
      : source === "csv"
        ? "CSV históricos de football-data.co.uk. Se procesan localmente."
        : "Datos históricos públicos. La descarga puede estar limitada por CORS o por la red.";
}
function markStale() {
  if (result) $("stale").hidden = false;
}
$("source").addEventListener("change", updateSource);
$("threshold").addEventListener("input", () => {
  $("ev-label").textContent = `${$("threshold").value}%`;
});
$("files").addEventListener("change", () => {
  $("file-list").textContent =
    Array.from($("files").files)
      .map((f) => f.name)
      .join(" · ") || "Puedes cargar varias temporadas.";
});
$("analysis-form").addEventListener("input", markStale);
$("analysis-form").addEventListener("change", markStale);
function options() {
  const o = {};
  for (const k of Object.keys(V.defaults))
    o[k] = k === "model" ? $(k).value : Number($(k).value);
  for (const k of [
    "threshold",
    "fraction",
    "cap",
    "dailyCap",
    "commission",
    "haircut",
  ])
    o[k] /= 100;
  V.validateOptions(o);
  return o;
}
async function readSources() {
  const source = $("source").value;
  if (source === "demo")
    return [{ name: "demo-sintetica.csv", text: V.demoCSV() }];
  if (source === "csv") {
    const files = Array.from($("files").files);
    if (!files.length) throw new Error("Selecciona al menos un archivo CSV.");
    if (files.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024)
      throw new Error("Los archivos no pueden superar 20 MB en total.");
    return Promise.all(
      files.map(async (f) => ({ name: f.name, text: await f.text() })),
    );
  }
  const seasons = $("seasons")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !seasons.length ||
    seasons.length > 15 ||
    seasons.some((s) => !/^\d{4}$/.test(s))
  )
    throw new Error(
      "Indica entre 1 y 15 temporadas de cuatro dígitos, por ejemplo: 2324,2425.",
    );
  const files = [];
  for (const season of [...new Set(seasons)]) {
    $("status-text").textContent = `Descargando temporada ${season}…`;
    const url = `https://www.football-data.co.uk/mmz4281/${season}/SP1.csv`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.includes("HomeTeam"))
        throw new Error("El proveedor no devolvió un CSV válido.");
      files.push({ name: url, text });
    } catch (error) {
      throw new Error(
        `No se pudo descargar ${season}. La red o la política CORS del proveedor puede impedirlo. Abre la fuente de datos, descarga el CSV y usa «Mis archivos CSV». Detalle: ${error.message}`,
      );
    }
  }
  return files;
}
function switchTab(target, focus = false) {
  for (const button of document.querySelectorAll("[role=tab]")) {
    const active = button.id === target;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !active;
    if (active && focus) button.focus();
  }
}
const tabs = Array.from(document.querySelectorAll("[role=tab]"));
tabs.forEach((button, i) => {
  button.addEventListener("click", () => switchTab(button.id));
  button.addEventListener("keydown", (e) => {
    let next;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      switchTab(tabs[next].id, true);
    }
  });
});
function renderChart(rows) {
  const width = 960,
    height = 280,
    left = 58,
    right = 12,
    top = 15,
    bottom = 16;
  const values = rows.map((r) => r.bankroll),
    low = Math.min(...values),
    high = Math.max(...values);
  const pad = Math.max((high - low) * 0.12, 1),
    min = Math.max(0, low - pad),
    max = high + pad;
  const x = (i) =>
    left + ((width - left - right) * i) / Math.max(1, rows.length - 1);
  const y = (v) => top + ((max - v) / (max - min)) * (height - top - bottom);
  const coords = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const ticks = Array.from(
    { length: 5 },
    (_, i) => min + ((max - min) * i) / 4,
  );
  const grid = ticks
    .map(
      (v) =>
        `<line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" stroke="#e7edf0" stroke-dasharray="4 5"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end" fill="#7c8d98" font-size="11">${escapeHTML(number(v, 0))}</text>`,
    )
    .join("");
  $("equity-chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución del capital de ${escapeHTML(number(values[0]))} a ${escapeHTML(number(values.at(-1)))} unidades"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0b8f7b" stop-opacity=".18"/><stop offset="100%" stop-color="#0b8f7b" stop-opacity=".01"/></linearGradient></defs>${grid}<path d="M${coords.join(" L")} L${x(rows.length - 1)},${height - bottom} L${left},${height - bottom} Z" fill="url(#area)"/><polyline points="${coords.join(" ")}" stroke="#0b8f7b" stroke-width="2.5" stroke-linejoin="round" fill="none"/><circle cx="${x(rows.length - 1)}" cy="${y(values.at(-1))}" r="4" fill="#0b8f7b"/></svg>`;
  $("chart-start").textContent = rows[0].date;
  $("chart-end").textContent = rows.at(-1).date;
}
function renderBets() {
  const filter = $("bet-filter").value;
  const bets = result.bets.filter(
    (b) => filter === "all" || (filter === "won" ? b.won : !b.won),
  );
  const pages = Math.max(1, Math.ceil(bets.length / 25));
  page = Math.max(0, Math.min(page, pages - 1));
  $("bets-table").innerHTML = bets.length
    ? bets
        .slice(page * 25, page * 25 + 25)
        .map(
          (b) =>
            `<tr><td>${escapeHTML(b.date)}</td><td>${escapeHTML(b.home)} <span class="muted">vs</span> ${escapeHTML(b.away)}</td><td>${b.selection}</td><td>${percent(b.probability)}</td><td>${number(b.effective_odds)}</td><td class="positive">${percent(b.ev)}</td><td>${number(b.stake)}</td><td class="${b.profit >= 0 ? "positive" : "negative"}">${number(b.profit)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="8">No hay apuestas con estos criterios.</td></tr>';
  $("page-info").textContent =
    `${bets.length} selecciones · Página ${page + 1} de ${pages}`;
  $("prev-page").disabled = page === 0;
  $("next-page").disabled = page >= pages - 1;
}
$("bet-filter").addEventListener("change", () => {
  page = 0;
  renderBets();
});
$("prev-page").addEventListener("click", () => {
  page--;
  renderBets();
});
$("next-page").addEventListener("click", () => {
  page++;
  renderBets();
});
function render() {
  const s = result.summary,
    b = s.backtest,
    v = s.validation;
  $("welcome").hidden = true;
  $("results").hidden = false;
  $("stale").hidden = true;
  $("data-badge").textContent = s.synthetic
    ? "MODO DEMOSTRACIÓN"
    : "DATOS HISTÓRICOS";
  $("demo-warning").hidden = !s.synthetic;
  $("period").textContent =
    `${s.audit.reduce((sum, a) => sum + a.aceptadas, 0).toLocaleString("es-ES")} partidos válidos · ${s.period.from} → ${s.period.to} · ${v.matches.toLocaleString("es-ES")} fuera de muestra`;
  $("metric-bankroll").textContent = number(b.final_bankroll);
  $("metric-return").textContent =
    `${percent(b.bankroll_return)} de retorno del capital`;
  $("metric-return").className =
    b.bankroll_return >= 0 ? "positive" : "negative";
  $("metric-roi").textContent =
    b.roi_on_stakes === null ? "Sin apuestas" : percent(b.roi_on_stakes);
  $("metric-roi").className =
    b.roi_on_stakes === null
      ? ""
      : b.roi_on_stakes >= 0
        ? "positive"
        : "negative";
  $("metric-drawdown").textContent = percent(b.max_drawdown);
  $("metric-bets").textContent = number(b.bets, 0);
  $("metric-staked").textContent =
    `${number(b.total_staked)} u. apostadas en total`;
  const interval = b.roi_95pct_week_block_bootstrap;
  $("interval").textContent = interval
    ? `Intervalo descriptivo de ROI al 95%: ${percent(interval[0])} a ${percent(interval[1])}.`
    : "No hubo apuestas. No se puede calcular ROI ni su intervalo.";
  $("model-table").innerHTML = [
    ["Modelo", v.model],
    ["Mercado sin margen", v.market],
  ]
    .map(
      ([label, m]) =>
        `<tr><td>${label}</td><td>${number(m.log_loss, 4)}</td><td>${number(m.brier, 4)}</td></tr>`,
    )
    .join("");
  $("model-context").textContent =
    `Margen medio implícito de las cuotas: ${percent(v.mean_market_overround)}. Comparación en los mismos partidos fuera de muestra.`;
  $("folds-table").innerHTML = s.folds
    .map(
      (f) =>
        `<tr><td>${f.train_until}</td><td>${f.test_from}</td><td>${f.test_until}</td><td>${f.train_n}</td><td>${f.test_n}</td></tr>`,
    )
    .join("");
  $("audit").replaceChildren(
    ...s.audit.map((a) => {
      const p = document.createElement("p");
      p.textContent = `${a.archivo}: ${a.aceptadas} aceptadas / ${a.descartadas} descartadas de ${a.filas} filas.`;
      return p;
    }),
  );
  $("parameters").textContent = JSON.stringify(
    {
      generated_at: s.generated_at,
      analysis_type: s.analysis_type,
      model: s.model_spec,
      parameters: s.parameters,
      optional_data: s.optional_data,
      sources: s.sources,
    },
    null,
    2,
  );
  $("data-coverage").textContent =
    `Cobertura avanzada: ${s.optional_data.xg_matches} partidos con xG y ${s.optional_data.final_third_matches} con posesión en último tercio. Si faltan, no se inventan métricas. Generado: ${s.generated_at} (análisis retrospectivo).`;
  page = 0;
  $("bet-filter").value = "all";
  renderBets();
  renderChart(result.equity);
  switchTab("tab-capital");
}
function download(kind) {
  if (!result) return;
  let content, ext, type;
  if (kind === "report") {
    content = JSON.stringify(result.summary, null, 2);
    ext = "json";
    type = "application/json";
  } else {
    let rows = result[kind],
      columns;
    if (kind === "predictions") {
      rows = rows.map((m) => ({
        Date: m.date,
        HomeTeam: m.home,
        AwayTeam: m.away,
        FTR: m.result,
        B365H: m.odds[0],
        B365D: m.odds[1],
        B365A: m.odds[2],
        pH: m.p[0],
        pD: m.p[1],
        pA: m.p[2],
        fold: m.fold,
      }));
    }
    if (kind === "bets")
      columns = [
        "date",
        "home",
        "away",
        "selection",
        "probability",
        "effective_odds",
        "ev",
        "stake",
        "won",
        "profit",
      ];
    content = "\uFEFF" + V.toCSV(rows, columns);
    ext = "csv";
    type = "text/csv;charset=utf-8";
  }
  const url = URL.createObjectURL(new Blob([content], { type })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `valuebet-${kind}${result.summary.synthetic ? "-demo" : ""}.${ext}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$("export-report").addEventListener("click", () => download("report"));
for (const button of document.querySelectorAll("[data-export]"))
  button.addEventListener("click", () => download(button.dataset.export));
$("quick-demo").addEventListener("click", () => {
  $("source").value = "demo";
  updateSource();
  $("analysis-form").requestSubmit();
});
$("analysis-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;
  running = true;
  result = null;
  $("error").hidden = true;
  $("results").hidden = true;
  $("stale").hidden = true;
  $("welcome").hidden = true;
  $("status").hidden = false;
  $("progress").value = 0;
  $("status-text").textContent = "Preparando datos…";
  // Congelar entradas conserva la correspondencia entre configuración e informe.
  const controls = Array.from(
    document.querySelectorAll(
      "#analysis-form input, #analysis-form select, #analysis-form button, #quick-demo",
    ),
  );
  try {
    const settings = options(),
      synthetic = $("source").value === "demo";
    controls.forEach((c) => (c.disabled = true));
    const files = await readSources();
    result = await V.analyze(files, settings, synthetic, (text, progress) => {
      $("status-text").textContent = text;
      $("progress").value = progress;
    });
    render();
    $("results").scrollIntoView({ behavior: "auto", block: "start" });
  } catch (error) {
    $("error").textContent =
      error.message || "No se pudo completar el análisis.";
    $("error").hidden = false;
    $("welcome").hidden = false;
  } finally {
    running = false;
    controls.forEach((c) => (c.disabled = false));
    $("status").hidden = true;
  }
});
updateSource();
