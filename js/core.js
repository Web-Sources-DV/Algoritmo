/* Motor independiente: navegador y Node. No envía datos a un servidor. */
(function (root) {
  "use strict";
  const LABELS = ["H", "D", "A"];
  const DAY = 86400000;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  function rng(seed = 42) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const iso = (time) => new Date(time).toISOString().slice(0, 10);
  function parseDate(value) {
    const s = value.trim();
    let y, m, d, match;
    if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)))
      [, y, m, d] = match.map(Number);
    else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
      d = +match[1];
      m = +match[2];
      y = +match[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
    } else return NaN;
    const time = Date.UTC(y, m - 1, d),
      date = new Date(time);
    return date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
      ? time
      : NaN;
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const sep = firstLine.includes(";") ? ";" : ",";
    const rows = [];
    let row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (!quoted && cell.trim() !== "")
          throw new Error("CSV: comillas en un campo sin escapar.");
        else quoted = !quoted;
      } else if (!quoted && (c === sep || c === "\n" || c === "\r")) {
        row.push(cell.trim());
        cell = "";
        if (c !== sep) {
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (c === "\r" && text[i + 1] === "\n") i++;
        }
      } else cell += c;
    }
    if (quoted) throw new Error("CSV: campo entre comillas sin cerrar.");
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2)
      throw new Error("El CSV está vacío o no contiene partidos.");
    const headers = rows.shift();
    if (new Set(headers).size !== headers.length)
      throw new Error("El CSV tiene columnas duplicadas.");
    return rows.map((values, i) => {
      if (values.length !== headers.length)
        throw new Error(
          `CSV: número de campos incorrecto en la fila ${i + 2}.`,
        );
      return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
    });
  }
  function cleanCSV(files) {
    const matches = [],
      audit = [],
      seen = new Set();
    const required = [
      "Date",
      "HomeTeam",
      "AwayTeam",
      "FTHG",
      "FTAG",
      "FTR",
      "B365H",
      "B365D",
      "B365A",
    ];
    for (const file of files) {
      const rows = parseCSV(file.text);
      const missing = required.filter((k) => !(k in rows[0]));
      if (missing.length)
        throw new Error(`${file.name}: faltan ${missing.join(", ")}.`);
      let dropped = 0;
      for (const r of rows) {
        const time = parseDate(r.Date),
          home = r.HomeTeam.trim(),
          away = r.AwayTeam.trim();
        const numeric = ["FTHG", "FTAG", "B365H", "B365D", "B365A"];
        const nums = numeric.map((k) => (r[k] === "" ? NaN : Number(r[k])));
        const [hg, ag, ...odds] = nums;
        const result = hg > ag ? "H" : hg < ag ? "A" : "D";
        if (
          !Number.isFinite(time) ||
          !home ||
          !away ||
          home === away ||
          !nums.every(Number.isFinite) ||
          !Number.isInteger(hg) ||
          !Number.isInteger(ag) ||
          hg < 0 ||
          ag < 0 ||
          odds.some((o) => o <= 1) ||
          r.FTR !== result
        ) {
          dropped++;
          continue;
        }
        const key = JSON.stringify([time, home, away]);
        if (seen.has(key))
          throw new Error(
            `Partido duplicado: ${home} / ${away}, ${iso(time)}. Revisa los CSV.`,
          );
        seen.add(key);
        // Columnas opcionales propias: observaciones POSTPARTIDO del proveedor.
        // Sólo entran como medias de partidos ANTERIORES en featureRows.
        const optional = (key, min, max) => {
          if (!(key in r) || r[key] === "") return null;
          const value = Number(r[key]);
          if (!Number.isFinite(value) || value < min || value > max)
            throw new Error(`${file.name}: ${key} fuera de rango.`);
          return value;
        };
        matches.push({
          time,
          date: iso(time),
          home,
          away,
          hg,
          ag,
          result,
          odds,
          xgh: optional("xGH", 0, 100),
          xga: optional("xGA", 0, 100),
          thirdh: optional("FinalThirdH", 0, 100),
          thirda: optional("FinalThirdA", 0, 100),
        });
      }
      audit.push({
        archivo: file.name,
        filas: rows.length,
        aceptadas: rows.length - dropped,
        descartadas: dropped,
      });
    }
    matches.sort(
      (a, b) =>
        a.time - b.time ||
        a.home.localeCompare(b.home) ||
        a.away.localeCompare(b.away),
    );
    if (!matches.length)
      throw new Error(
        "No quedan partidos válidos después de limpiar los datos.",
      );
    if (matches.length > 15000)
      throw new Error(
        "Máximo 15.000 partidos por análisis en esta versión para navegador.",
      );
    return { matches, audit };
  }
  function demoCSV() {
    const random = rng(42),
      teams = Array.from(
        { length: 20 },
        (_, i) => `Equipo ${String(i + 1).padStart(2, "0")}`,
      );
    const strengths = teams.map(() => (random() - 0.5) * 1.2);
    const poisson = (lambda) => {
      let n = 0,
        p = 1;
      do {
        n++;
        p *= random();
      } while (p > Math.exp(-lambda));
      return n - 1;
    };
    const rows = [
      [
        "Date",
        "HomeTeam",
        "AwayTeam",
        "FTHG",
        "FTAG",
        "FTR",
        "B365H",
        "B365D",
        "B365A",
      ],
    ];
    for (let week = 0; week < 240; week++) {
      const order = teams.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let i = 0; i < order.length; i += 2) {
        const h = order[i],
          a = order[i + 1],
          diff = strengths[h] - strengths[a];
        const hg = poisson(Math.exp(0.35 + diff)),
          ag = poisson(Math.exp(0.1 - diff));
        const p = softmax([0.3 + diff, -0.35, -diff]);
        rows.push([
          iso(Date.UTC(2018, 7, 1) + week * 7 * DAY),
          teams[h],
          teams[a],
          hg,
          ag,
          hg > ag ? "H" : hg < ag ? "A" : "D",
          ...p.map((q) => 1 / (q * 1.06)),
        ]);
      }
    }
    return rows.map((row) => row.join(",")).join("\n");
  }
  function featureRows(matches) {
    const history = new Map(),
      venue = new Map(),
      output = [];
    const ratings = new Map(),
      lastPlayed = new Map(),
      calendar = new Map(),
      h2h = new Map(),
      advanced = new Map();
    const avg = (rows, j) => {
      const valid = (rows || [])
        .map((r) => r[j])
        .filter((v) => v !== null && v !== undefined);
      return [
        valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0,
        valid.length / 5,
      ];
    };
    const advancedSummary = (team) =>
      [0, 1, 2, 3].flatMap((j) => avg(advanced.get(team), j));
    const summary = (records) =>
      records?.length
        ? [0, 1, 2].map(
            (j) => records.reduce((s, r) => s + r[j], 0) / records.length,
          )
        : [1, 1.2, 1.2];
    const push = (map, key, record) => {
      const list = map.get(key) || [];
      list.push(record);
      if (list.length > 5) list.shift();
      map.set(key, list);
    };
    for (let begin = 0; begin < matches.length; ) {
      let end = begin + 1;
      while (end < matches.length && matches[end].time === matches[begin].time)
        end++;
      // Primero todas las predicciones de la fecha, después sus resultados.
      for (let i = begin; i < end; i++) {
        const m = matches[i];
        const eh = ratings.get(m.home) || 1500,
          ea = ratings.get(m.away) || 1500;
        const rest = (team) =>
          lastPlayed.has(team)
            ? Math.min(30, (m.time - lastPlayed.get(team)) / DAY)
            : 30;
        const load = (team) =>
          (calendar.get(team) || []).filter((time) => time >= m.time - 14 * DAY)
            .length;
        output.push([
          ...summary(history.get(m.home)),
          ...summary(history.get(m.away)),
          ...summary(venue.get(JSON.stringify([m.home, "H"]))),
          ...summary(venue.get(JSON.stringify([m.away, "A"]))),
          history.get(m.home)?.length || 0,
          history.get(m.away)?.length || 0,
          (eh - 1500) / 400,
          (ea - 1500) / 400,
          (eh - ea) / 400,
          rest(m.home),
          rest(m.away),
          lastPlayed.has(m.home) ? 1 : 0,
          lastPlayed.has(m.away) ? 1 : 0,
          load(m.home),
          load(m.away),
          ...summary(h2h.get(JSON.stringify([m.home, m.away]))),
          ...advancedSummary(m.home),
          ...advancedSummary(m.away),
        ]);
      }
      const deltas = new Map();
      for (let i = begin; i < end; i++) {
        const m = matches[i],
          hp = m.result === "H" ? 3 : m.result === "D" ? 1 : 0,
          ap = m.result === "A" ? 3 : m.result === "D" ? 1 : 0;
        push(history, m.home, [hp, m.hg, m.ag]);
        push(history, m.away, [ap, m.ag, m.hg]);
        push(venue, JSON.stringify([m.home, "H"]), [hp, m.hg, m.ag]);
        push(venue, JSON.stringify([m.away, "A"]), [ap, m.ag, m.hg]);
        // Elo de apertura de fecha para no favorecer el orden de los registros.
        const eh = ratings.get(m.home) || 1500,
          ea = ratings.get(m.away) || 1500;
        const expected = 1 / (1 + 10 ** ((ea - eh - 60) / 400)),
          actual = m.result === "H" ? 1 : m.result === "D" ? 0.5 : 0;
        const change = 20 * (actual - expected);
        deltas.set(m.home, (deltas.get(m.home) || 0) + change);
        deltas.set(m.away, (deltas.get(m.away) || 0) - change);
        for (const team of [m.home, m.away]) {
          lastPlayed.set(team, m.time);
          calendar.set(team, [
            ...(calendar.get(team) || []).filter(
              (time) => time >= m.time - 14 * DAY,
            ),
            m.time,
          ]);
        }
        push(h2h, JSON.stringify([m.home, m.away]), [hp, m.hg, m.ag]);
        push(h2h, JSON.stringify([m.away, m.home]), [ap, m.ag, m.hg]);
        push(advanced, m.home, [
          m.xgh ?? null,
          m.xga ?? null,
          m.thirdh ?? null,
          m.thirda ?? null,
        ]);
        push(advanced, m.away, [
          m.xga ?? null,
          m.xgh ?? null,
          m.thirda ?? null,
          m.thirdh ?? null,
        ]);
      }
      for (const [team, delta] of deltas)
        ratings.set(team, (ratings.get(team) || 1500) + delta);
      begin = end;
    }
    return output;
  }
  function softmax(logits) {
    const max = Math.max(...logits),
      exp = logits.map((x) => Math.exp(x - max)),
      sum = exp.reduce((a, b) => a + b, 0);
    return exp.map((x) => x / sum);
  }
  async function fitModel(x, y, epochs = 180) {
    const n = x.length,
      d = x[0].length;
    const means = Array.from(
      { length: d },
      (_, j) => x.reduce((s, r) => s + r[j], 0) / n,
    );
    const scales = means.map(
      (m, j) => Math.sqrt(x.reduce((s, r) => s + (r[j] - m) ** 2, 0) / n) || 1,
    );
    const z = x.map((r) => [1, ...r.map((v, j) => (v - means[j]) / scales[j])]);
    const width = d + 1,
      weights = new Float64Array(3 * width);
    // Descenso de gradiente determinista sobre entropía cruzada media + L2.
    // Lambda y pasos fijos; nunca se seleccionan usando el conjunto de prueba.
    for (let epoch = 0; epoch < epochs; epoch++) {
      const grad = new Float64Array(weights.length);
      for (let i = 0; i < n; i++) {
        const logits = [0, 0, 0];
        for (let c = 0; c < 3; c++)
          for (let j = 0; j < width; j++)
            logits[c] += weights[c * width + j] * z[i][j];
        const probs = softmax(logits);
        for (let c = 0; c < 3; c++) {
          const error = probs[c] - (y[i] === c ? 1 : 0);
          for (let j = 0; j < width; j++)
            grad[c * width + j] += error * z[i][j];
        }
      }
      for (let c = 0; c < 3; c++)
        for (let j = 0; j < width; j++) {
          const k = c * width + j;
          weights[k] -= 0.12 * (grad[k] / n + (j ? 0.01 * weights[k] : 0));
        }
      if (epoch % 30 === 0) await pause();
    }
    return {
      means,
      scales,
      weights: Array.from(weights),
      predict(row) {
        const v = [1, ...row.map((a, j) => (a - means[j]) / scales[j])];
        return softmax(
          [0, 1, 2].map((c) =>
            v.reduce((s, a, j) => s + a * weights[c * width + j], 0),
          ),
        );
      },
    };
  }
  async function fitBoosting(x, y, rounds = 70) {
    const n = x.length,
      d = x[0].length,
      lambda = 1,
      rate = 0.15,
      trees = [];
    // Umbrales cuantiles calculados SÓLO en entrenamiento. Stumps de un nivel.
    const cuts = Array.from({ length: d }, (_, j) => {
      const sorted = x.map((r) => r[j]).sort((a, b) => a - b),
        out = [];
      for (let q = 1; q < 12; q++) {
        const cut = sorted[Math.floor((q * (n - 1)) / 12)];
        if (cut < sorted.at(-1) && !out.includes(cut)) out.push(cut);
      }
      return out;
    });
    const bins = x.map((row) =>
      row.map((value, j) => {
        let b = 0;
        while (b < cuts[j].length && value > cuts[j][b]) b++;
        return b;
      }),
    );
    const logits = Array.from({ length: n }, () => [0, 0, 0]);
    for (let round = 0; round < rounds; round++) {
      const probabilities = logits.map(softmax);
      const current = [];
      for (let c = 0; c < 3; c++) {
        const gradients = probabilities.map(
            (p, i) => p[c] - (y[i] === c ? 1 : 0),
          ),
          hessians = probabilities.map((p) =>
            Math.max(0.001, p[c] * (1 - p[c])),
          );
        const G = gradients.reduce((a, b) => a + b, 0),
          H = hessians.reduce((a, b) => a + b, 0);
        let best = {
            feature: -1,
            cut: 0,
            left: Math.max(-2, Math.min(2, -G / (H + lambda))),
            right: 0,
          },
          gain = 0;
        for (let j = 0; j < d; j++) {
          const gs = new Float64Array(cuts[j].length + 1),
            hs = new Float64Array(gs.length),
            counts = new Uint32Array(gs.length);
          for (let i = 0; i < n; i++) {
            const b = bins[i][j];
            gs[b] += gradients[i];
            hs[b] += hessians[i];
            counts[b]++;
          }
          let gl = 0,
            hl = 0,
            count = 0;
          for (let b = 0; b < cuts[j].length; b++) {
            gl += gs[b];
            hl += hs[b];
            count += counts[b];
            if (count < 15 || n - count < 15) continue;
            const improvement =
              (gl * gl) / (hl + lambda) +
              (G - gl) ** 2 / (H - hl + lambda) -
              (G * G) / (H + lambda);
            if (improvement > gain) {
              gain = improvement;
              best = {
                feature: j,
                cut: cuts[j][b],
                left: Math.max(-2, Math.min(2, -gl / (hl + lambda))),
                right: Math.max(-2, Math.min(2, -(G - gl) / (H - hl + lambda))),
              };
            }
          }
        }
        current.push(best);
      }
      trees.push(current);
      for (let i = 0; i < n; i++)
        for (let c = 0; c < 3; c++) {
          const t = current[c];
          logits[i][c] +=
            rate *
            (t.feature < 0 || x[i][t.feature] <= t.cut ? t.left : t.right);
        }
      if (round % 10 === 0) await pause();
    }
    return {
      trees,
      predict(row) {
        const logits = [0, 0, 0];
        for (const round of trees)
          for (let c = 0; c < 3; c++) {
            const t = round[c];
            logits[c] +=
              rate *
              (t.feature < 0 || row[t.feature] <= t.cut ? t.left : t.right);
          }
        return softmax(logits);
      },
    };
  }
  async function walkForward(
    matches,
    minTrain = 760,
    blockDays = 90,
    progress = () => {},
    algorithm = "logistic",
  ) {
    if (
      !Number.isInteger(minTrain) ||
      minTrain < 1 ||
      !Number.isInteger(blockDays) ||
      blockDays < 1
    )
      throw new Error("Configuración temporal inválida.");
    if (matches.length <= minTrain)
      throw new Error(
        `Se necesitan más de ${minTrain} partidos válidos. Carga más temporadas o reduce el entrenamiento inicial.`,
      );
    const x = featureRows(matches),
      y = matches.map((m) => LABELS.indexOf(m.result)),
      predictions = [],
      folds = [];
    let start = matches[minTrain].time;
    const occupied = new Set(
      matches
        .slice(minTrain)
        .map((m) => Math.floor((m.time - start) / (blockDays * DAY))),
    );
    if (occupied.size > 100)
      throw new Error(
        "Demasiados bloques para el navegador (máximo 100). Aumenta los días por bloque o reduce el historial.",
      );
    while (start <= matches.at(-1).time) {
      const end = start + blockDays * DAY;
      const trainEnd = matches.findIndex((m) => m.time >= start);
      let testEnd = trainEnd;
      while (testEnd < matches.length && matches[testEnd].time < end) testEnd++;
      if (trainEnd >= minTrain && testEnd > trainEnd) {
        if (new Set(y.slice(0, trainEnd)).size !== 3)
          throw new Error("El entrenamiento debe incluir H, D y A.");
        progress(
          `Entrenando bloque ${folds.length + 1} · ${trainEnd} partidos anteriores`,
          Math.round((trainEnd / matches.length) * 90),
        );
        const fit = algorithm === "boosting" ? fitBoosting : fitModel;
        const model = await fit(x.slice(0, trainEnd), y.slice(0, trainEnd));
        for (let i = trainEnd; i < testEnd; i++)
          predictions.push({
            ...matches[i],
            p: model.predict(x[i]),
            fold: folds.length,
          });
        folds.push({
          train_n: trainEnd,
          test_n: testEnd - trainEnd,
          train_until: matches[trainEnd - 1].date,
          test_from: iso(start),
          test_until: matches[testEnd - 1].date,
        });
      }
      start = end;
    }
    if (!predictions.length)
      throw new Error("No hay bloques temporales evaluables.");
    return { predictions, folds };
  }
  function scores(predictions) {
    const out = {
      matches: predictions.length,
      mean_market_overround: 0,
      model: { log_loss: 0, brier: 0 },
      market: { log_loss: 0, brier: 0 },
    };
    for (const m of predictions) {
      const implied = m.odds.map((o) => 1 / o),
        sum = implied.reduce((a, b) => a + b, 0),
        y = LABELS.indexOf(m.result);
      out.mean_market_overround += sum - 1;
      for (const [name, p] of [
        ["model", m.p],
        ["market", implied.map((q) => q / sum)],
      ]) {
        out[name].log_loss -= Math.log(Math.max(1e-15, p[y]));
        out[name].brier += p.reduce(
          (s, q, j) => s + (q - (j === y ? 1 : 0)) ** 2,
          0,
        );
      }
    }
    for (const name of ["model", "market"]) {
      out[name].log_loss /= predictions.length;
      out[name].brier /= predictions.length;
    }
    out.mean_market_overround /= predictions.length;
    return out;
  }
  const defaults = {
    bankroll: 1000,
    threshold: 0.05,
    fraction: 0.25,
    cap: 0.02,
    dailyCap: 0.1,
    commission: 0.02,
    haircut: 0,
    minTrain: 760,
    blockDays: 90,
    model: "logistic",
  };
  function validateOptions(o) {
    if (
      !Object.entries(o)
        .filter(([k]) => k !== "model")
        .every(([, v]) => Number.isFinite(v)) ||
      !["logistic", "boosting"].includes(o.model) ||
      !(
        o.bankroll > 0 &&
        o.threshold >= 0 &&
        o.fraction > 0 &&
        o.fraction <= 1 &&
        o.cap > 0 &&
        o.cap <= o.dailyCap &&
        o.dailyCap <= 1 &&
        o.commission >= 0 &&
        o.commission < 1 &&
        o.haircut >= 0 &&
        o.haircut < 1 &&
        Number.isInteger(o.minTrain) &&
        o.minTrain > 0 &&
        Number.isInteger(o.blockDays) &&
        o.blockDays > 0
      )
    )
      throw new Error(
        "Revisa los parámetros: el tope por apuesta no puede superar el límite diario y todos los valores deben estar en rango.",
      );
  }
  function kelly(p, odds, fraction = 0.25, cap = 0.02) {
    return Math.min(cap, Math.max(0, (fraction * (p * odds - 1)) / (odds - 1)));
  }
  function simulate(predictions, options = {}) {
    const o = { ...defaults, ...options };
    validateOptions(o);
    let bankroll = o.bankroll;
    const bets = [],
      equity = [{ date: iso(predictions[0].time - DAY), bankroll }],
      weekly = [];
    const nWeeks =
      Math.floor((predictions.at(-1).time - predictions[0].time) / (7 * DAY)) +
      1;
    for (let i = 0; i < nWeeks; i++) weekly.push([0, 0]);
    for (let begin = 0; begin < predictions.length; ) {
      let end = begin + 1;
      while (
        end < predictions.length &&
        predictions[end].time === predictions[begin].time
      )
        end++;
      const opening = bankroll,
        candidates = [];
      for (let i = begin; i < end; i++) {
        const m = predictions[i],
          odds = m.odds.map(
            (q) => 1 + (q - 1) * (1 - o.commission) * (1 - o.haircut),
          );
        const evs = odds.map((q, j) => m.p[j] * q - 1),
          j = evs.indexOf(Math.max(...evs));
        const weight = kelly(m.p[j], odds[j], o.fraction, o.cap);
        if (evs[j] > o.threshold && weight > 0)
          candidates.push({ m, j, odds: odds[j], ev: evs[j], weight });
      }
      const total = candidates.reduce((s, c) => s + c.weight, 0),
        scale = total > 0 ? Math.min(1, o.dailyCap / total) : 1;
      for (const c of candidates) {
        const stake = opening * c.weight * scale,
          won = c.m.result === LABELS[c.j],
          profit = stake * (won ? c.odds - 1 : -1);
        if (stake <= 0) continue;
        bankroll += profit;
        bets.push({
          date: c.m.date,
          home: c.m.home,
          away: c.m.away,
          selection: LABELS[c.j],
          probability: c.m.p[c.j],
          effective_odds: c.odds,
          ev: c.ev,
          stake,
          won,
          profit,
        });
        const w = Math.floor((c.m.time - predictions[0].time) / (7 * DAY));
        weekly[w][0] += profit;
        weekly[w][1] += stake;
      }
      equity.push({ date: predictions[begin].date, bankroll });
      begin = end;
    }
    let peak = o.bankroll,
      maxDrawdown = 0;
    for (const row of equity) {
      peak = Math.max(peak, row.bankroll);
      maxDrawdown = Math.max(maxDrawdown, 1 - row.bankroll / peak);
    }
    const turnover = bets.reduce((s, b) => s + b.stake, 0),
      intervals = [],
      random = rng(42);
    if (turnover > 0)
      for (let i = 0; i < 2000; i++) {
        let profit = 0,
          stake = 0;
        for (let j = 0; j < weekly.length; j++) {
          const w = weekly[Math.floor(random() * weekly.length)];
          profit += w[0];
          stake += w[1];
        }
        if (stake > 0) intervals.push(profit / stake);
      }
    intervals.sort((a, b) => a - b);
    const quantile = (p) => {
      const index = (intervals.length - 1) * p,
        lower = Math.floor(index);
      return (
        intervals[lower] +
        (intervals[Math.ceil(index)] - intervals[lower]) * (index - lower)
      );
    };
    return {
      bets,
      equity,
      report: {
        bets: bets.length,
        initial_bankroll: o.bankroll,
        final_bankroll: bankroll,
        total_staked: turnover,
        profit: bankroll - o.bankroll,
        roi_on_stakes: turnover ? (bankroll - o.bankroll) / turnover : null,
        bankroll_return: bankroll / o.bankroll - 1,
        max_drawdown: maxDrawdown,
        roi_95pct_week_block_bootstrap: intervals.length
          ? [quantile(0.025), quantile(0.975)]
          : null,
      },
    };
  }
  async function analyze(
    files,
    options = {},
    synthetic = false,
    progress = () => {},
  ) {
    const settings = { ...defaults, ...options };
    validateOptions(settings);
    progress("Limpiando y ordenando partidos…", 3);
    await pause();
    const { matches, audit } = cleanCSV(files);
    const { predictions, folds } = await walkForward(
      matches,
      settings.minTrain,
      settings.blockDays,
      progress,
      settings.model,
    );
    progress("Simulando capital e incertidumbre…", 95);
    await pause();
    const { bets, equity, report } = simulate(predictions, settings);
    const generatedAt = new Date().toISOString(),
      sources = [];
    for (const file of files) {
      const hash = globalThis.crypto?.subtle
        ? Array.from(
            new Uint8Array(
              await globalThis.crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(file.text),
              ),
            ),
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : null;
      sources.push({ name: file.name, sha256: hash });
    }
    return {
      summary: {
        version: "2.0.0-js",
        generated_at: generatedAt,
        analysis_type: "retrospective-backtest",
        timestamp_note:
          "Fecha de generación, no prueba de predicción publicada antes de los partidos.",
        model_spec:
          settings.model === "boosting"
            ? {
                name: "Gradient boosting de stumps",
                rounds: 70,
                learning_rate: 0.15,
                lambda: 1,
                min_leaf: 15,
                max_depth: 1,
              }
            : {
                name: "Softmax L2",
                epochs: 180,
                learning_rate: 0.12,
                lambda: 0.01,
              },
        optional_data: {
          xg_matches: matches.filter((m) => m.xgh !== null && m.xga !== null)
            .length,
          final_third_matches: matches.filter(
            (m) => m.thirdh !== null && m.thirda !== null,
          ).length,
        },
        synthetic,
        parameters: settings,
        sources,
        period: { from: matches[0].date, to: matches.at(-1).date },
        audit,
        validation: scores(predictions),
        folds,
        backtest: report,
        warning:
          "Sin garantía de ganancias. Riesgo de pérdida total. Intervalo descriptivo, no predictivo.",
      },
      predictions,
      bets,
      equity,
    };
  }
  function toCSV(rows, columns = Object.keys(rows[0] || {})) {
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s) && typeof v === "string") s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
    };
    return [columns, ...rows.map((r) => columns.map((k) => r[k]))]
      .map((row) => row.map(escape).join(","))
      .join("\r\n");
  }
  const api = {
    LABELS,
    DAY,
    rng,
    parseDate,
    parseCSV,
    cleanCSV,
    demoCSV,
    featureRows,
    softmax,
    fitModel,
    fitBoosting,
    walkForward,
    scores,
    defaults,
    validateOptions,
    kelly,
    simulate,
    analyze,
    toCSV,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ValueBet = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
