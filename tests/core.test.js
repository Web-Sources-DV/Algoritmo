"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/core.js");
const demo = V.cleanCSV([{ name: "demo.csv", text: V.demoCSV() }]);
const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("CSV: fechas, comillas, campos vacíos y duplicados", () => {
  assert.equal(V.parseDate("31/02/2024"), NaN);
  assert.equal(V.parseDate("29/02/24"), Date.UTC(2024, 1, 29));
  assert.equal(
    V.parseCSV('Name,Value\r\n"Equipo, A","un ""valor"""')[0].Name,
    "Equipo, A",
  );
  assert.equal(V.parseCSV("Name;Value\nA;2")[0].Value, "2");
  assert.throws(() => V.parseCSV('Name,Value\n"unclosed,2'), /comillas/);
  const csv =
    "Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A\n01/01/2024,A,B,2,1,H,2,3,4";
  const cleaned = V.cleanCSV([
    { name: "a", text: csv + "\n02/01/2024,A,B,2,1,H,,3,4" },
  ]);
  assert.equal(cleaned.matches.length, 1);
  assert.equal(cleaned.audit[0].descartadas, 1);
  assert.throws(
    () =>
      V.cleanCSV([
        { name: "a", text: csv },
        { name: "b", text: csv },
      ]),
    /duplicado/,
  );
  assert.throws(
    () => V.cleanCSV([{ name: "a", text: "Date,HomeTeam\n2024-01-01,A" }]),
    /faltan/,
  );
});
test("Features: cambiar resultados de hoy/futuros no altera variables de hoy/pasado", () => {
  const matches = demo.matches,
    original = V.featureRows(matches),
    cutoff = matches[1000].time;
  const changed = matches.map((m) =>
    m.time >= cutoff ? { ...m, hg: 8, ag: 0, result: "H" } : m,
  );
  const altered = V.featureRows(changed);
  for (let i = 0; i < matches.length; i++)
    if (matches[i].time <= cutoff) assert.deepEqual(original[i], altered[i]);
});
test("Modelo: aprendizaje real, probabilidades normalizadas y escalado sólo de entrenamiento", async () => {
  const x = Array.from({ length: 90 }, (_, i) => [(i % 3) * 4]),
    y = x.map((r) => r[0] / 4);
  const model = await V.fitModel(x, y, 300);
  near(model.means[0], 4);
  let loss = 0;
  for (let i = 0; i < x.length; i++) {
    const p = model.predict(x[i]);
    near(
      p.reduce((a, b) => a + b),
      1,
    );
    assert.ok(p.every((q) => q > 0 && q < 1));
    loss -= Math.log(p[y[i]]);
  }
  assert.ok(loss / x.length < 0.65);
});
test("Kelly, comisión, límites diarios y liquidación sin reinversión", () => {
  near(V.kelly(0.6, 2, 0.25, 1), 0.05);
  near(V.kelly(0.4, 2), 0);
  near(V.kelly(0.99, 10), 0.02);
  const m = {
    time: Date.UTC(2024, 0, 1),
    date: "2024-01-01",
    home: "A",
    away: "B",
    result: "H",
    odds: [2, 3, 4],
    p: [0.8, 0.1, 0.1],
  };
  const rows = Array.from({ length: 10 }, () => ({ ...m }));
  const out = V.simulate(rows, { commission: 0 });
  near(out.report.total_staked, 100);
  near(out.report.final_bankroll, 1100);
  const cost = V.simulate(rows, { commission: 0.1, haircut: 0.1 });
  near(cost.bets[0].effective_odds, 1.81);
  near(cost.report.final_bankroll, 1081);
  const lost = V.simulate(
    rows.map((r) => ({ ...r, result: "A" })),
    { commission: 0 },
  );
  near(lost.report.final_bankroll, 900);
  near(lost.report.max_drawdown, 0.1);
  const empty = V.simulate(rows, { threshold: 10 });
  assert.equal(empty.report.bets, 0);
  assert.equal(empty.report.roi_on_stakes, null);
  assert.equal(empty.report.roi_95pct_week_block_bootstrap, null);
  assert.throws(
    () => V.simulate(rows, { cap: 0.5, dailyCap: 0.1 }),
    /parámetros/,
  );
});
test("Métricas contra ejemplo conocido y exportación segura", () => {
  const score = V.scores([
    { odds: [3, 3, 3], p: [1 / 3, 1 / 3, 1 / 3], result: "H" },
  ]);
  near(score.model.log_loss, Math.log(3));
  near(score.model.brier, 2 / 3);
  near(score.mean_market_overround, 0);
  assert.match(V.toCSV([{ home: "=cmd", profit: -1 }]), /'=cmd,-1/);
});
test("Demo completa: folds temporales, incertidumbre y resultados reproducibles", async () => {
  const out = await V.analyze(
    [{ name: "demo.csv", text: V.demoCSV() }],
    {},
    true,
  );
  assert.equal(out.summary.synthetic, true);
  assert.equal(out.summary.audit[0].aceptadas, 2400);
  assert.ok(out.predictions.length > 0);
  assert.ok(out.bets.length > 0);
  for (const fold of out.summary.folds) {
    assert.ok(fold.train_until < fold.test_from);
    assert.ok(fold.train_n >= 760);
  }
  for (const p of out.predictions)
    near(
      p.p.reduce((a, b) => a + b),
      1,
    );
  assert.equal(
    new Set(out.predictions.map((m) => m.date + m.home + m.away)).size,
    out.predictions.length,
  );
  const byDay = new Map();
  for (const b of out.bets)
    byDay.set(b.date, (byDay.get(b.date) || 0) + b.stake);
  for (let i = 1; i < out.equity.length; i++)
    assert.ok(
      (byDay.get(out.equity[i].date) || 0) <=
        out.equity[i - 1].bankroll * 0.1 + 1e-8,
    );
  const interval = out.summary.backtest.roi_95pct_week_block_bootstrap;
  assert.ok(interval[0] <= interval[1]);
  assert.deepEqual(V.simulate(out.predictions).report, out.summary.backtest);
  await assert.rejects(
    V.analyze([{ name: "demo.csv", text: V.demoCSV() }], { minTrain: 3000 }),
    /más de/,
  );
  console.log(
    "DEMO",
    JSON.stringify({
      validation: out.summary.validation,
      backtest: out.summary.backtest,
    }),
  );
});

test("Variables avanzadas: Elo, descanso, carga e historial opcional sin fuga", () => {
  const base = demo.matches
    .slice(0, 30)
    .map((m, i) => ({
      ...m,
      xgh: 1 + i / 100,
      xga: 0.8,
      thirdh: 45,
      thirda: 55,
    }));
  const rows = V.featureRows(base);
  assert.ok(rows[0].length > 14);
  assert.ok(rows.every((row) => row.every(Number.isFinite)));
  // La cobertura de métricas avanzadas es cero en el primer día.
  assert.ok(rows[0].slice(-16).every((v) => v === 0));
  const changed = base.map((m) =>
    m.time === base[20].time
      ? { ...m, xgh: 99, thirdh: 99, hg: 9, ag: 0, result: "H" }
      : m,
  );
  const modified = V.featureRows(changed);
  for (let i = 0; i < base.length; i++)
    if (base[i].time <= base[20].time) assert.deepEqual(rows[i], modified[i]);
  assert.notDeepEqual(rows[20], rows[0]);
});
test("Gradient boosting aprende y usa reglas de entrenamiento reproducibles", async () => {
  const x = Array.from({ length: 120 }, (_, i) => [i % 3]),
    y = x.map((r) => r[0]);
  const model = await V.fitBoosting(x, y);
  for (let c = 0; c < 3; c++) {
    const p = model.predict([c]);
    near(
      p.reduce((a, b) => a + b),
      1,
    );
    assert.ok(p[c] > 0.8);
  }
  assert.equal(model.trees.length, 70);
});
test("Boosting walk-forward conserva separación temporal y metadatos de trazabilidad", async () => {
  const out = await V.analyze(
    [{ name: "history.csv", text: V.demoCSV() }],
    { model: "boosting", blockDays: 365 },
    false,
  );
  assert.equal(out.summary.model_spec.name, "Gradient boosting de stumps");
  assert.equal(out.summary.optional_data.xg_matches, 0);
  assert.equal(out.summary.optional_data.final_third_matches, 0);
  assert.equal(out.summary.analysis_type, "retrospective-backtest");
  assert.equal(out.summary.sources[0].sha256.length, 64);
  assert.ok(Number.isFinite(Date.parse(out.summary.generated_at)));
  for (const fold of out.summary.folds)
    assert.ok(fold.train_until < fold.test_from);
});
