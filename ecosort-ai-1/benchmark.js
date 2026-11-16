// Independent benchmark: scores the EcoSort model on labelled photos supplied by the user.
// File names must start with the category id, e.g. plastic_01.jpg, organic-banana.png.
import { CATEGORIES, loadClassifier, classifyBlob } from "./shared.js";

const IDS = Object.keys(CATEGORIES);
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("modelStatus"), input: $("benchInput"), summary: $("benchSummary"),
  run: $("runBenchBtn"), stop: $("stopBenchBtn"), progress: $("benchProgress"),
  results: $("benchResults"), download: $("benchCsvBtn")
};

let items = [];      // { file, truth }
let skipped = [];
let rows = [];       // { name, truth, predicted, second, score, correct }
let stopRequested = false;

function setStatus(kind, message) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function parseFiles(fileList) {
  items = [];
  skipped = [];
  for (const file of fileList) {
    const match = /^([a-z]+)/i.exec(file.name);
    const truth = match ? match[1].toLowerCase() : "";
    if (file.type.startsWith("image/") && IDS.includes(truth)) items.push({ file, truth });
    else skipped.push(file.name);
  }
}

function renderSummary() {
  ui.summary.replaceChildren();
  const counts = {};
  items.forEach((i) => { counts[i.truth] = (counts[i.truth] || 0) + 1; });
  const p = document.createElement("p");
  p.textContent = `${items.length} usable image${items.length === 1 ? "" : "s"}. ` +
    (items.length ? IDS.filter((id) => counts[id]).map((id) => `${id}: ${counts[id]}`).join(" · ") : "");
  ui.summary.append(p);
  if (skipped.length) {
    const s = document.createElement("p");
    s.className = "warning-text";
    s.textContent = `Skipped ${skipped.length} file(s) without a valid category prefix: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? "…" : ""}`;
    ui.summary.append(s);
  }
  ui.run.disabled = items.length === 0;
}

// 95% Wilson score interval for a proportion.
function wilson(correct, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

function cell(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function renderResults() {
  ui.results.replaceChildren();
  if (!rows.length) return;

  const n = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const top2 = rows.filter((r) => r.correct || r.second === r.truth).length;
  const [lo, hi] = wilson(correct, n);

  const grid = document.createElement("div");
  grid.className = "metric-grid";
  [["Images tested", String(n)], ["Top-1 accuracy", pct(correct / n)], ["Top-2 accuracy", pct(top2 / n)]]
    .forEach(([label, value]) => {
      const box = document.createElement("div");
      box.className = "metric";
      box.append(cell("span", label), cell("strong", value));
      grid.append(box);
    });
  ui.results.append(grid);

  const ci = cell("p", `95% confidence interval for top-1 accuracy: ${pct(lo)} to ${pct(hi)}. ` +
    (n < 50 ? "With fewer than 50 images the interval is wide, so treat this as a rough estimate." : ""));
  ci.className = "metric-note";
  ui.results.append(ci);

  const table = document.createElement("table");
  table.className = "bench-table";
  const head = document.createElement("tr");
  ["Category", "Images", "Correct", "Accuracy"].forEach((h) => head.append(cell("th", h)));
  table.append(head);
  IDS.forEach((id) => {
    const subset = rows.filter((r) => r.truth === id);
    if (!subset.length) return;
    const ok = subset.filter((r) => r.correct).length;
    const tr = document.createElement("tr");
    [id, String(subset.length), String(ok), pct(ok / subset.length)].forEach((v) => tr.append(cell("td", v)));
    table.append(tr);
  });
  ui.results.append(table);

  const wrong = rows.filter((r) => !r.correct);
  const heading = cell("h3", wrong.length ? "Misclassified images" : "No misclassifications");
  ui.results.append(heading);
  if (wrong.length) {
    const list = document.createElement("ul");
    list.className = "bench-list";
    wrong.slice(0, 40).forEach((r) => {
      list.append(cell("li", `${r.name}: expected ${r.truth}, predicted ${r.predicted} (${Math.round(r.score * 100)}%)`));
    });
    ui.results.append(list);
  }
  ui.download.disabled = false;
}

async function runBenchmark() {
  if (!items.length) return;
  stopRequested = false;
  rows = [];
  ui.results.replaceChildren();
  ui.run.disabled = true;
  ui.input.disabled = true;
  ui.stop.disabled = false;
  ui.download.disabled = true;
  try {
    setStatus("loading", "Loading AI model…");
    await loadClassifier((p) => {
      if (p && p.status === "progress" && Number.isFinite(p.progress)) {
        setStatus("loading", `Loading AI model… ${Math.round(p.progress)}%`);
      }
    });
    setStatus("ready", "AI model ready");
    for (let i = 0; i < items.length; i++) {
      if (stopRequested) break;
      const { file, truth } = items[i];
      ui.progress.textContent = `Testing ${i + 1} of ${items.length}: ${file.name}`;
      try {
        const preds = await classifyBlob(file);
        rows.push({
          name: file.name, truth, predicted: preds[0].id, second: preds[1] ? preds[1].id : "",
          score: preds[0].score, correct: preds[0].id === truth
        });
      } catch (error) {
        console.error("Failed on", file.name, error);
      }
    }
    ui.progress.textContent = stopRequested
      ? `Stopped after ${rows.length} image(s).`
      : `Finished: ${rows.length} of ${items.length} image(s) analysed.`;
    renderResults();
  } catch (error) {
    console.error(error);
    setStatus("error", "Model failed to load. Reload the page to retry.");
    ui.progress.textContent = "The AI model could not be loaded.";
  } finally {
    ui.run.disabled = items.length === 0;
    ui.input.disabled = false;
    ui.stop.disabled = true;
  }
}

function downloadCsv() {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ["file,expected,predicted,score,correct"];
  rows.forEach((r) => lines.push([esc(r.name), r.truth, r.predicted, r.score.toFixed(4), r.correct].join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ecosort-benchmark.csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui.input.addEventListener("change", () => {
  parseFiles(Array.from(ui.input.files || []));
  renderSummary();
});
ui.run.addEventListener("click", runBenchmark);
ui.stop.addEventListener("click", () => { stopRequested = true; });
ui.download.addEventListener("click", downloadCsv);
renderSummary();
