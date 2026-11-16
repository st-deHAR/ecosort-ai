// EcoSort AI: browser-based waste material classifier (CLIP zero-shot) with voice guidance.
import { CATEGORIES, loadClassifier, classifyBlob, isModelReady } from "./shared.js";

const STORAGE_KEY = "ecosort_activity_v4";
const VOICE_KEY = "ecosort_voice_v1";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const LOW_SCORE = 0.3;
const MAX_HISTORY = 20;
const POINTS_PER_ITEM = 10;

const RANKS = [
  { name: "Eco Beginner", icon: "🌱", min: 0 },
  { name: "Recycling Hero", icon: "🦸", min: 5 },
  { name: "Zero-Waste Champion", icon: "🏆", min: 15 }
];

const $ = (id) => document.getElementById(id);
const ui = {
  status: $("modelStatus"), tabUpload: $("tabUpload"), tabCamera: $("tabCamera"),
  uploadSection: $("uploadSection"), cameraSection: $("cameraSection"),
  dropZone: $("dropZone"), imageInput: $("imageInput"), preview: $("previewImage"),
  video: $("webcam"), capture: $("captureBtn"), stopCamera: $("stopCameraBtn"),
  empty: $("emptyState"), result: $("resultContent"), badge: $("confidenceBadge"),
  banner: $("categoryBanner"), icon: $("categoryIcon"), name: $("detectedName"),
  title: $("categoryTitle"), note: $("modelNote"), steps: $("disposalSteps"),
  tip: $("ecoAlternative"), guesses: $("topGuesses"), correct: $("fbCorrectBtn"),
  wrong: $("fbWrongBtn"), feedback: $("feedbackMsg"), picker: $("categoryPicker"),
  manual: $("manualCategory"), apply: $("applyCategoryBtn"), log: $("logActionBtn"),
  total: $("totalItems"), totalLarge: $("totalItemsLarge"), points: $("ecoPoints"),
  pointsLarge: $("ecoPointsLarge"), accuracy: $("accuracy"), history: $("historyList"),
  reset: $("resetStatsBtn"), copy: $("copyReportBtn"), download: $("downloadReportBtn"),
  toast: $("toast"), voiceBtn: $("voiceBtn"), replayBtn: $("replayBtn"),
  rankIcon: $("rankIcon"), rankName: $("rankName"), rankBar: $("rankBar"),
  rankBarWrap: $("rankBarWrap"), rankHint: $("rankHint")
};

let cameraStream = null;
let currentResult = null;
let previewUrl = null;
let toastTimer = null;
let busy = false;
let stats = loadStats();

const speechOk = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let voiceOn = true;
try { voiceOn = localStorage.getItem(VOICE_KEY) !== "off"; } catch { /* storage unavailable */ }

/* ---------- storage ---------- */
function defaultStats() {
  return { total: 0, points: 0, correct: 0, incorrect: 0, demo: 0, history: [] };
}

function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaultStats();
    const num = (v) => Math.max(0, Number(v) || 0);
    const history = Array.isArray(saved.history) ? saved.history.slice(0, MAX_HISTORY) : [];
    return {
      total: num(saved.total), points: num(saved.points),
      correct: num(saved.correct), incorrect: num(saved.incorrect), demo: num(saved.demo),
      history: history.map((h) => ({
        name: String(h && h.name || "Item").slice(0, 40),
        icon: String(h && h.icon || "♻️").slice(0, 4),
        points: num(h && h.points),
        demo: Boolean(h && h.demo),
        date: String(h && h.date || "").slice(0, 40)
      }))
    };
  } catch { return defaultStats(); }
}

function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); }
  catch { showToast("Browser storage is unavailable or full."); }
}

/* ---------- small helpers ---------- */
function showToast(message, ms = 3200) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), ms);
}

function setStatus(kind, message) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function categoryFor(id) { return CATEGORIES[id] || CATEGORIES.general; }

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not capture frame"))), "image/jpeg", 0.92);
  });
}

/* ---------- eco-rank ---------- */
function rankFor(n) {
  let rank = RANKS[0];
  for (const r of RANKS) if (n >= r.min) rank = r;
  return rank;
}

function updateRankUI() {
  const n = stats.total;
  const rank = rankFor(n);
  const next = RANKS.find((r) => r.min > n) || null;
  ui.rankIcon.textContent = rank.icon;
  ui.rankName.textContent = rank.name;
  let pct = 100;
  if (next) {
    pct = Math.round(((n - rank.min) / (next.min - rank.min)) * 100);
    const left = next.min - n;
    ui.rankHint.textContent = `Log ${left} more sorted item${left === 1 ? "" : "s"} to become a ${next.name}.`;
  } else {
    ui.rankHint.textContent = "Top rank reached. Thank you for sorting responsibly!";
  }
  ui.rankBar.style.width = `${pct}%`;
  ui.rankBarWrap.setAttribute("aria-valuenow", String(pct));
}

/* ---------- voice guidance ---------- */
function speak(text, force = false) {
  if (!speechOk || (!voiceOn && !force)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch { /* speech not available */ }
}

function speechFor(r) {
  const c = categoryFor(r.id);
  const name = c.name.replace("/", " or ");
  if (r.simulated) return `Demo example. ${name}. ${c.steps}`;
  if (r.manual) return `Updated to ${name}. ${c.steps}`;
  const lead = r.score < LOW_SCORE
    ? `I am not very sure, but this might be ${name}.`
    : `This looks like ${name}.`;
  return `${lead} ${c.steps}`;
}

function updateVoiceUI() {
  ui.voiceBtn.textContent = voiceOn ? "🔊 Voice: ON" : "🔇 Voice: OFF";
  ui.voiceBtn.setAttribute("aria-pressed", String(voiceOn));
}

/* ---------- stats / history ---------- */
function updateStats() {
  ui.total.textContent = stats.total;
  ui.totalLarge.textContent = stats.total;
  ui.points.textContent = stats.points;
  ui.pointsLarge.textContent = stats.points;
  const n = stats.correct + stats.incorrect;
  ui.accuracy.textContent = n ? `${Math.round((stats.correct / n) * 100)}% (${n})` : "—";
  updateRankUI();
  renderHistory();
}

function renderHistory() {
  ui.history.replaceChildren();
  if (!stats.history.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No sorting actions logged yet.";
    ui.history.append(p);
    return;
  }
  stats.history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const left = document.createElement("span");
    left.textContent = `${item.icon} ${item.name}${item.demo ? " (demo)" : ""}`;
    const right = document.createElement("small");
    right.textContent = `${item.date} · +${item.points} points`;
    row.append(left, right);
    ui.history.append(row);
  });
}

/* ---------- model ---------- */
function onModelProgress(p) {
  if (p && p.status === "progress" && Number.isFinite(p.progress)) {
    setStatus("loading", `Loading AI model… ${Math.round(p.progress)}%`);
  }
}

async function loadModel() {
  setStatus("loading", "Loading AI model…");
  try {
    await loadClassifier(onModelProgress);
    setStatus("ready", "AI model ready");
  } catch (error) {
    console.error("Model loading error:", error);
    setStatus("error", "Model failed to load. Tap to retry.");
  }
}

/* ---------- results ---------- */
function startResult({ id, score, predictions, simulated }) {
  currentResult = {
    aiId: id, id, score, predictions: predictions || [], simulated: Boolean(simulated),
    manual: false, feedback: null, logged: false,
    showPicker: !simulated && score < LOW_SCORE, message: ""
  };
  renderResult(true);
}

function renderResult(speakIt = false) {
  const r = currentResult;
  if (!r) return;
  const c = categoryFor(r.id);

  ui.empty.classList.add("hidden");
  ui.result.classList.remove("hidden");
  ui.banner.className = `category-banner ${c.type}`;
  ui.icon.textContent = c.icon;
  ui.name.textContent = c.name;
  ui.title.textContent = c.subtitle;
  ui.steps.textContent = c.steps;
  ui.tip.textContent = c.tip;

  ui.badge.classList.remove("hidden");
  ui.badge.textContent = r.simulated ? "Demo example"
    : r.manual ? "Corrected by you"
    : `Similarity score: ${Math.round(r.score * 100)}%`;

  let note = r.simulated
    ? "This is a preset demonstration, not a real image prediction."
    : "This is a CLIP text-image similarity score, not a calibrated probability or a verified accuracy. Confirm the category before acting.";
  if (!r.simulated && !r.manual && r.score < LOW_SCORE) {
    note += " The match is uncertain; use the correction control or check local guidance.";
  }
  ui.note.textContent = note;

  ui.guesses.replaceChildren();
  r.predictions.slice(0, 3).forEach((prediction) => {
    const li = document.createElement("li");
    li.textContent = `${categoryFor(prediction.id).name}: ${Math.round(prediction.score * 100)}% similarity`;
    ui.guesses.append(li);
  });
  ui.guesses.parentElement.classList.toggle("hidden", r.predictions.length === 0);

  const feedbackLocked = r.simulated || r.feedback !== null || r.logged;
  ui.correct.disabled = feedbackLocked;
  ui.wrong.disabled = feedbackLocked;
  ui.feedback.textContent = r.logged ? "Logged. This result is now locked." : r.message;

  ui.picker.classList.toggle("hidden", !(r.showPicker && !r.logged));
  ui.manual.value = r.id;

  ui.log.disabled = r.logged;
  ui.log.textContent = r.logged ? "✓ Sorting action logged" : "Confirm sorting action";

  if (speakIt) speak(speechFor(r));
}

async function analyze(blob) {
  if (busy) {
    showToast("Still analyzing the previous image. Please wait a moment.");
    return;
  }
  busy = true;
  updateScanControls();
  try {
    setStatus("loading", isModelReady() ? "Analyzing image…" : "Loading AI model…");
    const predictions = await classifyBlob(blob);
    const best = predictions[0];
    if (!best) throw new Error("No predictions returned.");
    startResult({ id: best.id, score: best.score, predictions });
    setStatus("ready", "AI model ready");
  } catch (error) {
    console.error("Image classification error:", error);
    if (isModelReady()) {
      setStatus("ready", "AI model ready");
      showToast("Could not analyze this image. Try a different photo (JPG, PNG or WEBP).");
    } else {
      setStatus("error", "Model failed to load. Tap to retry.");
      showToast("The AI model could not be loaded. Check your internet connection.");
    }
  } finally {
    busy = false;
    updateScanControls();
  }
}

function updateScanControls() {
  ui.capture.disabled = busy || !cameraStream;
}

/* ---------- upload & camera ---------- */
function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Please select an image file.");
  if (file.size > MAX_FILE_BYTES) return showToast("The image must be 10 MB or smaller.");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  ui.preview.src = previewUrl;
  ui.preview.classList.remove("hidden");
  analyze(file);
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  ui.video.srcObject = null;
  updateScanControls();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera access requires HTTPS or localhost. Use image upload instead.");
    switchTab("upload");
    return;
  }
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, audio: false
    });
    ui.video.srcObject = cameraStream;
    await ui.video.play();
    updateScanControls();
  } catch (error) {
    console.error("Camera error:", error);
    showToast("Camera permission was denied or the camera is unavailable.");
    switchTab("upload");
  }
}

function switchTab(tab) {
  const camera = tab === "camera";
  ui.tabCamera.classList.toggle("active", camera);
  ui.tabUpload.classList.toggle("active", !camera);
  ui.tabCamera.setAttribute("aria-selected", String(camera));
  ui.tabUpload.setAttribute("aria-selected", String(!camera));
  ui.cameraSection.classList.toggle("hidden", !camera);
  ui.uploadSection.classList.toggle("hidden", camera);
  if (!camera) stopCamera();
}

async function captureFrame() {
  if (!ui.video.videoWidth) return showToast("Camera is not ready yet.");
  const canvas = document.createElement("canvas");
  canvas.width = ui.video.videoWidth;
  canvas.height = ui.video.videoHeight;
  canvas.getContext("2d").drawImage(ui.video, 0, 0);
  try {
    await analyze(await canvasToBlob(canvas));
  } catch (error) {
    console.error(error);
    showToast("Could not capture the camera frame.");
  }
}

/* ---------- feedback, correction, logging ---------- */
function recordFeedback(isCorrect) {
  const r = currentResult;
  if (!r || r.simulated || r.feedback !== null) return false;
  r.feedback = isCorrect;
  if (isCorrect) stats.correct += 1; else stats.incorrect += 1;
  saveStats();
  updateStats();
  return true;
}

function applyCorrection() {
  const r = currentResult;
  if (!r || r.logged) return;
  const id = ui.manual.value;
  if (!CATEGORIES[id]) return;
  // Using the picker without pressing Yes/No still counts as feedback, once.
  if (!r.simulated && r.feedback === null) recordFeedback(id === r.aiId);
  r.id = id;
  r.manual = id !== r.aiId;
  r.message = r.manual
    ? "Your correction is applied. Please double-check the advice before sorting."
    : "Category confirmed.";
  renderResult(true);
}

function logAction() {
  const r = currentResult;
  if (!r || r.logged) return;
  const category = categoryFor(r.id);
  const before = rankFor(stats.total);
  stats.total += 1;
  stats.points += POINTS_PER_ITEM;
  if (r.simulated) stats.demo += 1;
  stats.history.unshift({
    name: category.name, icon: category.icon, points: POINTS_PER_ITEM,
    demo: r.simulated, date: new Date().toLocaleString()
  });
  stats.history = stats.history.slice(0, MAX_HISTORY);
  r.logged = true;
  saveStats();
  updateStats();
  renderResult(false);
  const after = rankFor(stats.total);
  if (after.name !== before.name) {
    const message = `Level up! You are now a ${after.name}.`;
    showToast(`🎉 ${message}`, 5000);
    speak(message);
  } else {
    showToast("Sorting action saved on this device.");
  }
}

/* ---------- report ---------- */
function buildReport() {
  const rank = rankFor(stats.total);
  const lines = [
    "ECOSORT AI — ACTIVITY REPORT",
    `Generated: ${new Date().toLocaleString()}`,
    `Eco-Rank: ${rank.icon} ${rank.name}`,
    `Items logged: ${stats.total}${stats.demo ? ` (including ${stats.demo} demo example${stats.demo === 1 ? "" : "s"})` : ""}`,
    `Eco points: ${stats.points}`,
    `User feedback: ${stats.correct} confirmed correct, ${stats.incorrect} corrected (self-reported, not an independent accuracy score)`,
    "",
    "Recent sorting actions:",
    ...(stats.history.length
      ? stats.history.map((item) => `- ${item.name}${item.demo ? " (demo)" : ""} | ${item.date}`)
      : ["(none yet)"]),
    "",
    "Note: Activity is stored locally in this browser. Counts are not independently verified waste diversion, and no CO2 savings are claimed."
  ];
  return lines.join("\n");
}

async function copyReport() {
  const report = buildReport();
  try {
    await navigator.clipboard.writeText(report);
    showToast("Report copied.");
  } catch {
    const area = document.createElement("textarea");
    area.value = report;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    showToast(ok ? "Report copied." : "Copy failed. Use Download instead.");
  }
}

function downloadReport() {
  const blob = new Blob([buildReport()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ecosort-activity-report.txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- init ---------- */
function init() {
  updateStats();
  updateVoiceUI();
  if (!speechOk) {
    ui.voiceBtn.classList.add("hidden");
    ui.replayBtn.classList.add("hidden");
  }

  ui.dropZone.addEventListener("click", () => ui.imageInput.click());
  ui.imageInput.addEventListener("change", (event) => {
    handleFile(event.target.files?.[0]);
    event.target.value = "";
  });
  ["dragenter", "dragover"].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("dragover");
  }));
  ui.dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));

  ui.tabUpload.addEventListener("click", () => switchTab("upload"));
  ui.tabCamera.addEventListener("click", async () => { switchTab("camera"); await startCamera(); });
  ui.capture.addEventListener("click", captureFrame);
  ui.stopCamera.addEventListener("click", () => switchTab("upload"));

  document.querySelectorAll(".sample-chip").forEach((button) => button.addEventListener("click", () => {
    ui.preview.classList.add("hidden");
    startResult({ id: button.dataset.demo, score: 1, predictions: [], simulated: true });
  }));

  ui.correct.addEventListener("click", () => {
    if (recordFeedback(true)) {
      currentResult.message = "Thank you. Feedback recorded.";
      renderResult(false);
    }
  });
  ui.wrong.addEventListener("click", () => {
    if (recordFeedback(false)) {
      currentResult.showPicker = true;
      currentResult.message = "Thanks. Choose the correct category below.";
      renderResult(false);
    }
  });
  ui.apply.addEventListener("click", applyCorrection);
  ui.log.addEventListener("click", logAction);
  ui.copy.addEventListener("click", copyReport);
  ui.download.addEventListener("click", downloadReport);

  ui.voiceBtn.addEventListener("click", () => {
    voiceOn = !voiceOn;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? "on" : "off"); } catch { /* ignore */ }
    if (!voiceOn && speechOk) window.speechSynthesis.cancel();
    updateVoiceUI();
  });
  ui.replayBtn.addEventListener("click", () => {
    if (currentResult) speak(speechFor(currentResult), true);
  });

  ui.reset.addEventListener("click", () => {
    if (!confirm("Delete the activity history saved in this browser?")) return;
    stats = defaultStats();
    saveStats();
    updateStats();
    if (currentResult) renderResult(false);
    showToast("Activity history reset.");
  });

  ui.status.addEventListener("click", () => {
    if (ui.status.classList.contains("error")) loadModel();
  });
  window.addEventListener("pagehide", stopCamera);
  loadModel();
}

init();
