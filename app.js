const STORAGE_KEY = "tank-tracker-state-v1";
const APP_VERSION_FALLBACK = "lokal";
const MILES_TO_KM = 1.609344;
const TANK_CAPACITY_LITERS = 55;
const ODOMETER_CORRECTION_FACTOR = 1.04;
const RANGE_BUFFER_KM = 25;
const FALLBACK_CONSUMPTION_L_PER_100_KM = 15;
const VISION_ENDPOINT_STORAGE_KEY = "tank-tracker-vision-endpoint-v1";
const DEFAULT_VISION_ENDPOINT = "https://t2-tank-odometer.thorsten-762.workers.dev/";
const ODOMETER_IMAGE_MAX_EDGE = 1600;
const ODOMETER_IMAGE_JPEG_QUALITY = 0.82;

const elements = {
  form: document.getElementById("fuel-form"),
  tourNameInput: document.getElementById("tourNameInput"),
  tourName: document.getElementById("tour-name"),
  date: document.getElementById("date"),
  odometerMiles: document.getElementById("odometerMiles"),
  captureOdometer: document.getElementById("capture-odometer"),
  odometerPhotoInput: document.getElementById("odometer-photo-input"),
  odometerPhotoPreview: document.getElementById("odometer-photo-preview"),
  odometerPhotoCanvas: document.getElementById("odometer-photo-canvas"),
  odometerPhotoStatus: document.getElementById("odometer-photo-status"),
  liters: document.getElementById("liters"),
  resetData: document.getElementById("reset-data"),
  exportData: document.getElementById("export-data"),
  importData: document.getElementById("import-data"),
  importFile: document.getElementById("import-file"),
  refreshApp: document.getElementById("refresh-app"),
  appVersion: document.getElementById("app-version"),
  formMessage: document.getElementById("form-message"),
  historyEmpty: document.getElementById("history-empty"),
  historyList: document.getElementById("history-list"),
  historyTemplate: document.getElementById("history-item-template"),
  lastConsumptionCard: document.getElementById("last-consumption-card"),
  lastConsumption: document.getElementById("last-consumption"),
  avgConsumption: document.getElementById("avg-consumption"),
  estimatedRange: document.getElementById("estimated-range"),
  estimatedRangeDetail: document.getElementById("estimated-range-detail"),
  maxOdometer: document.getElementById("max-odometer"),
  bufferedMaxOdometer: document.getElementById("buffered-max-odometer"),
  summaryBasis: document.getElementById("summary-basis"),
};

const state = loadState();
let waitingServiceWorker = null;
let currentAppVersion = APP_VERSION_FALLBACK;

init();

function init() {
  setDateFieldValue(getTodayIsoDate());
  setAppVersion(APP_VERSION_FALLBACK);
  elements.tourNameInput.value = state.tourName || "";

  elements.form.addEventListener("submit", handleSubmit);
  elements.resetData.addEventListener("click", handleReset);
  elements.exportData.addEventListener("click", handleExportData);
  elements.importData.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", handleImportFileChange);
  elements.refreshApp.addEventListener("click", handleRefreshApp);
  elements.tourNameInput.addEventListener("change", handleTourNameChange);
  elements.tourNameInput.addEventListener("blur", handleTourNameChange);
  elements.captureOdometer.addEventListener("click", () => elements.odometerPhotoInput.click());
  elements.odometerPhotoInput.addEventListener("change", handleOdometerPhotoChange);
  elements.date.addEventListener("focus", handleDateFieldActivate);
  elements.date.addEventListener("click", handleDateFieldActivate);
  elements.date.addEventListener("change", handleDateFieldChange);
  elements.date.addEventListener("blur", handleDateFieldBlur);

  render();
  registerServiceWorker();
  loadAppVersion();
}

function handleSubmit(event) {
  event.preventDefault();
  const isFirstEntry = state.entries.length === 0;

  const entry = {
    id: createEntryId(),
    date: elements.date.dataset.isoValue || "",
    odometerMiles: parseLocaleNumber(elements.odometerMiles.value),
    liters: isFirstEntry ? parseOptionalLocaleNumber(elements.liters.value) : parseLocaleNumber(elements.liters.value),
  };

  persistTourName();
  const validationMessage = validateEntry(entry, state.entries, isFirstEntry);
  if (validationMessage) {
    setFormMessage(validationMessage, true);
    return;
  }

  state.entries.push(entry);
  state.entries.sort((a, b) => a.odometerMiles - b.odometerMiles);
  saveState();

  elements.form.reset();
  elements.tourNameInput.value = state.tourName || "";
  setDateFieldValue(getTodayIsoDate());
  updateLitersFieldState();
  setFormMessage("Volltankvorgang gespeichert.");
  render();
}

function handleReset() {
  const confirmed = window.confirm("Wirklich alle gespeicherten Tankdaten löschen?");
  if (!confirmed) {
    return;
  }

  state.entries = [];
  state.tourName = "";
  saveState();
  elements.tourNameInput.value = "";
  setFormMessage("Alle gespeicherten Daten wurden gelöscht.");
  render();
}

function handleExportData() {
  const exportPayload = {
    app: "Jay Tank App",
    tourName: state.tourName || "",
    version: currentAppVersion,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `jay-tank-app-backup-${dateStamp}.json`;
  link.click();

  URL.revokeObjectURL(url);
  setFormMessage("Datenexport erstellt.");
}

async function handleImportFileChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    const importedEntries = normalizeImportedEntries(parsed.entries);
    const importedTourName = typeof parsed.tourName === "string" ? parsed.tourName.trim() : "";

    state.entries = importedEntries.sort((a, b) => a.odometerMiles - b.odometerMiles);
    state.tourName = importedTourName;
    saveState();
    elements.tourNameInput.value = state.tourName || "";
    render();
    setFormMessage(`${importedEntries.length} Tankvorgänge importiert.`);
  } catch {
    setFormMessage("Import fehlgeschlagen. Bitte eine gültige JSON-Datei verwenden.", true);
  } finally {
    event.target.value = "";
  }
}

async function handleOdometerPhotoChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  elements.captureOdometer.disabled = true;
  setOdometerPhotoStatus("Tachofoto wird vorbereitet ...");

  try {
    const endpoint = getVisionEndpoint();
    if (!endpoint) {
      setOdometerPhotoStatus("Kein Vision-Endpunkt konfiguriert. Bitte Worker-URL eintragen und erneut fotografieren.", true);
      return;
    }

    const image = await loadImageFromFile(file);
    const compressedImage = compressOdometerImage(image);
    drawCanvasImage(elements.odometerPhotoCanvas, compressedImage.canvas);
    setOdometerPhotoStatus("Meilenstand wird per OpenAI Vision gelesen ...");

    const recognition = await requestOdometerVision(endpoint, compressedImage.dataUrl);
    const validationMessage = validateOdometerVisionResult(recognition);

    if (validationMessage) {
      setOdometerPhotoStatus(validationMessage, true);
      return;
    }

    elements.odometerMiles.value = recognition.odometerMiles.toFixed(1);
    elements.odometerMiles.focus();
    setOdometerPhotoSuccess(recognition);
  } catch (error) {
    setOdometerPhotoStatus(`Fotoauswertung fehlgeschlagen: ${error.message}. Bitte manuell eintragen oder Worker-Konsole prüfen.`, true);
  } finally {
    elements.captureOdometer.disabled = false;
    event.target.value = "";
  }
}

function deleteEntry(entryId) {
  const confirmed = window.confirm("Diesen Tankvorgang wirklich löschen?");
  if (!confirmed) {
    return;
  }

  state.entries = state.entries.filter((entry) => entry.id !== entryId);
  saveState();
  render();
}

function handleRefreshApp() {
  if (waitingServiceWorker) {
    waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
  } else {
    window.location.reload();
  }
}

function getVisionEndpoint() {
  const storedEndpoint = localStorage.getItem(VISION_ENDPOINT_STORAGE_KEY);
  if (storedEndpoint) {
    return storedEndpoint;
  }

  const enteredEndpoint = window.prompt("OpenAI Vision Worker URL eintragen:", DEFAULT_VISION_ENDPOINT);
  const normalizedEndpoint = normalizeVisionEndpoint(enteredEndpoint);

  if (normalizedEndpoint) {
    localStorage.setItem(VISION_ENDPOINT_STORAGE_KEY, normalizedEndpoint);
  }

  return normalizedEndpoint || DEFAULT_VISION_ENDPOINT;
}

function normalizeVisionEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

async function requestOdometerVision(endpoint, imageDataUrl) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl }),
  });

  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw new Error("Vision request failed");
  }
  if (!response.ok || payload.error) {
    throw new Error(payload.error);
  }

  return {
    odometerMiles: Number(payload.odometerMiles),
    visibleDigits: typeof payload.visibleDigits === "string" ? payload.visibleDigits : "",
    confidence: typeof payload.confidence === "string" ? payload.confidence : "low",
    confidencePercent: normalizeConfidencePercent(payload.confidencePercent, payload.confidence),
    notes: typeof payload.notes === "string" ? payload.notes : "",
  };
}

function validateOdometerVisionResult(result) {
  if (!Number.isFinite(result.odometerMiles) || result.odometerMiles < 0) {
    return "OpenAI Vision konnte keinen plausiblen Meilenstand erkennen. Bitte manuell eintragen.";
  }

  if (!Number.isFinite(result.confidencePercent) || result.confidencePercent < 50) {
    return `Keinen ausreichend sicheren Meilenstand erkannt (${result.confidencePercent || 0}%). Bitte Foto erneut aufnehmen oder manuell eintragen.`;
  }

  const highestOdometer = getHighestSavedOdometer();
  if (Number.isFinite(highestOdometer) && result.odometerMiles <= highestOdometer) {
    return `Erkannt: ${formatNumber(result.odometerMiles, 1)} mi. Der Wert liegt nicht über dem letzten gespeicherten Stand. Bitte manuell prüfen.`;
  }

  return "";
}

function normalizeConfidencePercent(confidencePercent, confidence) {
  const numericConfidence = Number(confidencePercent);
  if (Number.isFinite(numericConfidence)) {
    return Math.max(0, Math.min(100, Math.round(numericConfidence)));
  }

  if (confidence === "high") {
    return 95;
  }

  if (confidence === "medium") {
    return 75;
  }

  return 45;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

function compressOdometerImage(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, ODOMETER_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    canvas,
    dataUrl: canvas.toDataURL("image/jpeg", ODOMETER_IMAGE_JPEG_QUALITY),
  };
}

function drawCanvasImage(targetCanvas, sourceCanvas) {
  const context = targetCanvas.getContext("2d");

  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  context.drawImage(sourceCanvas, 0, 0);
}

function setOdometerPhotoStatus(message, isError = false) {
  elements.odometerPhotoPreview.hidden = false;
  elements.odometerPhotoStatus.textContent = message;
  elements.odometerPhotoStatus.classList.remove("is-success");
  elements.odometerPhotoStatus.classList.toggle("is-error", isError);
}

function setOdometerPhotoSuccess(result) {
  elements.odometerPhotoPreview.hidden = false;
  elements.odometerPhotoStatus.classList.remove("is-error");
  elements.odometerPhotoStatus.classList.add("is-success");
  elements.odometerPhotoStatus.innerHTML = "";

  const check = document.createElement("span");
  const text = document.createElement("span");

  check.className = "odometer-photo-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  text.textContent = `Erkannt: ${formatNumber(result.odometerMiles, 1)} (${result.confidencePercent}%)`;

  elements.odometerPhotoStatus.append(check, text);
}

function handleTourNameChange() {
  persistTourName();
  renderTourName();
}

function handleDateFieldActivate() {
  const isoValue = elements.date.dataset.isoValue || getTodayIsoDate();

  if (elements.date.type !== "date") {
    elements.date.readOnly = false;
    elements.date.type = "date";
  }

  elements.date.value = isoValue;
  elements.date.showPicker?.();
}

function handleDateFieldChange() {
  if (elements.date.type === "date" && elements.date.value) {
    setDateFieldValue(elements.date.value);
  }
}

function handleDateFieldBlur() {
  if (elements.date.type === "date") {
    setDateFieldValue(elements.date.value || elements.date.dataset.isoValue || "");
  }
}

async function loadAppVersion() {
  try {
    const response = await fetch("./version.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const versionInfo = await response.json();
    if (typeof versionInfo.version === "string" && versionInfo.version.trim()) {
      setAppVersion(versionInfo.version.trim());
    }
  } catch {
    // No-op: fallback version remains visible for local or offline use.
  }
}

function render() {
  updateLitersFieldState();
  renderTourName();
  renderSummary();
  renderHistory();
}

function renderTourName() {
  const tourName = (state.tourName || "").trim();
  elements.tourName.textContent = tourName;
  elements.tourName.hidden = !tourName;
}

function renderSummary() {
  const sortedEntries = [...state.entries].sort((a, b) => a.odometerMiles - b.odometerMiles);
  const intervals = getIntervals(state.entries);
  const lastInterval = intervals.at(-1);
  const latestEntry = sortedEntries.at(-1);

  if (!lastInterval) {
    setLastConsumptionCardTone(null);
    elements.lastConsumption.textContent = "Noch keine Daten";
    elements.avgConsumption.textContent = "Noch keine Daten";

    if (latestEntry) {
      renderRangeEstimate(latestEntry, FALLBACK_CONSUMPTION_L_PER_100_KM / 100);
      elements.estimatedRangeDetail.textContent =
        `Fallback mit ${formatNumber(FALLBACK_CONSUMPTION_L_PER_100_KM, 0)} l / 100 km und ${TANK_CAPACITY_LITERS} l`;
      elements.summaryBasis.textContent =
        `Fallback: ${formatNumber(FALLBACK_CONSUMPTION_L_PER_100_KM, 0)} l / 100 km bis zur zweiten Volltankung.`;
    } else {
      elements.estimatedRange.textContent = "Noch keine Daten";
      elements.estimatedRangeDetail.textContent = "Es fehlen mindestens zwei Volltankungen";
      elements.maxOdometer.textContent = "Nicht berechenbar";
      elements.bufferedMaxOdometer.textContent = "Nicht berechenbar";
      elements.summaryBasis.textContent = "Basis wird ab zwei Volltankungen angezeigt.";
    }

    return;
  }

  const avgConsumptionLPerKm = getAverageConsumption(intervals);
  const lastLPer100Km = lastInterval.consumptionLPerKm * 100;
  const avgLPer100Km = avgConsumptionLPerKm * 100;
  const totalDistanceKm = getTotalDistanceKm(intervals);
  const totalTankEvents = intervals.length;

  setLastConsumptionCardTone(lastInterval);
  elements.lastConsumption.textContent = `${formatNumber(lastLPer100Km, 2)} l / 100 km`;

  elements.avgConsumption.textContent = `${formatNumber(avgLPer100Km, 2)} l / 100 km`;

  const estimatedRangeKm = renderRangeEstimate(latestEntry, avgConsumptionLPerKm);
  elements.estimatedRangeDetail.textContent = `${formatNumber(estimatedRangeKm, 0)} km real mit ${TANK_CAPACITY_LITERS} l`;
  elements.summaryBasis.textContent = `Basis: ${formatNumber(totalDistanceKm, 0)} km aus ${totalTankEvents} Tankvorgängen`;
}

function renderRangeEstimate(latestEntry, consumptionLPerKm) {
  const estimatedRangeKm = TANK_CAPACITY_LITERS / consumptionLPerKm;
  const estimatedRangeActualMiles = estimatedRangeKm / MILES_TO_KM;
  const estimatedRangeDisplayedMiles = estimatedRangeActualMiles / ODOMETER_CORRECTION_FACTOR;
  const bufferedRangeKm = Math.max(0, estimatedRangeKm - RANGE_BUFFER_KM);
  const bufferedRangeDisplayedMiles = (bufferedRangeKm / MILES_TO_KM) / ODOMETER_CORRECTION_FACTOR;
  const maxOdometerMiles = latestEntry.odometerMiles + estimatedRangeDisplayedMiles;
  const bufferedMaxOdometerMiles = latestEntry.odometerMiles + bufferedRangeDisplayedMiles;

  elements.estimatedRange.textContent = `${formatNumber(estimatedRangeActualMiles, 0)} mi`;
  elements.maxOdometer.textContent = `${formatNumber(maxOdometerMiles, 0)} mi`;
  elements.bufferedMaxOdometer.textContent = `${formatNumber(bufferedMaxOdometerMiles, 0)} mi`;

  return estimatedRangeKm;
}

function renderHistory() {
  elements.historyList.innerHTML = "";

  if (!state.entries.length) {
    elements.historyEmpty.hidden = false;
    elements.historyList.hidden = true;
    return;
  }

  elements.historyEmpty.hidden = true;
  elements.historyList.hidden = false;

  const intervals = getIntervals(state.entries);
  const intervalByEntryId = new Map(intervals.map((interval) => [interval.entry.id, interval]));

  [...state.entries]
    .sort((a, b) => b.odometerMiles - a.odometerMiles)
    .forEach((entry) => {
      const fragment = elements.historyTemplate.content.cloneNode(true);
      const item = fragment.querySelector(".history-item");
      const date = fragment.querySelector(".history-date");
      const odometer = fragment.querySelector(".history-odometer");
      const metrics = fragment.querySelector(".history-metrics");
      const deleteButton = fragment.querySelector(".history-delete");
      const interval = intervalByEntryId.get(entry.id);

      item.classList.add(getConsumptionClassName(interval));
      date.textContent = formatDate(entry.date);
      odometer.textContent = `${formatNumber(entry.odometerMiles, 1)} mi`;
      deleteButton.addEventListener("click", () => deleteEntry(entry.id));

      addMetric(
        metrics,
        "Getankt",
        Number.isFinite(entry.liters) ? `${formatNumber(entry.liters, 2)} l` : "Nicht erforderlich",
      );

      if (interval) {
        addMetric(metrics, "Strecke", `${formatNumber(interval.actualDistanceMiles, 1)} mi real / ${formatNumber(interval.actualDistanceKm, 1)} km`);
        addMetric(metrics, "Verbrauch", `${formatNumber(interval.consumptionLPerKm * 100, 2)} l / 100 km`);
        addMetric(metrics, "Tendenz", formatTrend(interval));
      } else {
        addMetric(metrics, "Strecke", "Erster Eintrag");
        addMetric(metrics, "Verbrauch", "Noch nicht berechenbar");
        addMetric(metrics, "Tendenz", "Noch nicht berechenbar");
      }

      elements.historyList.appendChild(item);
    });
}

function addMetric(container, label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");

  dt.textContent = label;
  dd.textContent = value;

  wrapper.append(dt, dd);
  container.appendChild(wrapper);
}

function formatTrend(interval) {
  if (!Number.isFinite(interval.trendPercentage)) {
    return "Noch kein Vergleich";
  }

  if (Math.abs(interval.trendPercentage) < 0.05) {
    return "Unverändert";
  }

  const direction = interval.trendPercentage > 0 ? "gestiegen" : "gesunken";
  return `${formatNumber(Math.abs(interval.trendPercentage), 1)} % ${direction}`;
}

function getConsumptionClassName(interval) {
  if (!interval) {
    return "history-item--consumption-neutral";
  }

  const consumptionLPer100Km = interval.consumptionLPerKm * 100;

  if (consumptionLPer100Km < 14) {
    return "history-item--consumption-low";
  }

  if (consumptionLPer100Km < 15) {
    return "history-item--consumption-medium";
  }

  return "history-item--consumption-high";
}

function setLastConsumptionCardTone(interval) {
  elements.lastConsumptionCard.classList.remove(
    "stat-card--consumption-low",
    "stat-card--consumption-medium",
    "stat-card--consumption-high",
    "stat-card--consumption-neutral",
  );

  if (!interval) {
    elements.lastConsumptionCard.classList.add("stat-card--consumption-neutral");
    return;
  }

  const consumptionClassName = getConsumptionClassName(interval).replace("history-item", "stat-card");
  elements.lastConsumptionCard.classList.add(consumptionClassName);
}

function validateEntry(entry, entries, isFirstEntry = entries.length === 0) {
  if (!entry.date) {
    return "Bitte ein Datum eintragen.";
  }

  if (!Number.isFinite(entry.odometerMiles) || entry.odometerMiles < 0) {
    return "Der Meilenstand muss eine gültige Zahl sein.";
  }

  if (isFirstEntry) {
    if (Number.isFinite(entry.liters) && entry.liters <= 0) {
      return "Falls du beim ersten Eintrag Liter angibst, müssen sie größer als 0 sein.";
    }
  } else if (!Number.isFinite(entry.liters) || entry.liters <= 0) {
    return "Die getankten Liter müssen größer als 0 sein.";
  }

  const highestOdometer = getHighestSavedOdometer(entries);

  if (entries.length && entry.odometerMiles <= highestOdometer) {
    return "Der neue Meilenstand muss höher sein als der letzte gespeicherte.";
  }

  return "";
}

function updateLitersFieldState() {
  const isFirstEntry = state.entries.length === 0;
  elements.liters.required = !isFirstEntry;
  elements.liters.placeholder = isFirstEntry ? "Beim ersten Eintrag optional" : "z. B. 42.50";
}

function getHighestSavedOdometer(entries = state.entries) {
  return entries.reduce(
    (maxValue, currentEntry) => Math.max(maxValue, currentEntry.odometerMiles),
    -Infinity,
  );
}

function setDateFieldValue(isoValue) {
  elements.date.type = "text";
  elements.date.readOnly = true;
  elements.date.dataset.isoValue = isoValue || "";
  elements.date.value = isoValue ? formatDate(isoValue) : "";
}

function setAppVersion(version) {
  currentAppVersion = version;
  elements.appVersion.textContent = `Version ${version}`;
}

function getIntervals(entries) {
  const sortedEntries = [...entries].sort((a, b) => a.odometerMiles - b.odometerMiles);
  const intervals = [];

  for (let index = 1; index < sortedEntries.length; index += 1) {
    const previousEntry = sortedEntries[index - 1];
    const entry = sortedEntries[index];
    const displayedDistanceMiles = entry.odometerMiles - previousEntry.odometerMiles;
    const actualDistanceMiles = displayedDistanceMiles * ODOMETER_CORRECTION_FACTOR;
    const actualDistanceKm = actualDistanceMiles * MILES_TO_KM;
    const consumptionLPerKm = entry.liters / actualDistanceKm;

    if (actualDistanceKm <= 0 || !Number.isFinite(consumptionLPerKm)) {
      continue;
    }

    const previousInterval = intervals.at(-1);
    const trendPercentage = previousInterval
      ? ((consumptionLPerKm - previousInterval.consumptionLPerKm) / previousInterval.consumptionLPerKm) * 100
      : null;

    intervals.push({
      entry,
      previousEntry,
      displayedDistanceMiles,
      actualDistanceMiles,
      actualDistanceKm,
      consumptionLPerKm,
      trendPercentage,
    });
  }

  return intervals;
}

function getAverageConsumption(intervals) {
  const totals = getConsumptionTotals(intervals);
  return totals.liters / totals.distanceKm;
}

function getTotalDistanceKm(intervals) {
  return getConsumptionTotals(intervals).distanceKm;
}

function getConsumptionTotals(intervals) {
  const totals = intervals.reduce(
    (accumulator, interval) => {
      accumulator.distanceKm += interval.actualDistanceKm;
      accumulator.liters += interval.entry.liters;
      return accumulator;
    },
    { distanceKm: 0, liters: 0 },
  );

  return totals;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { tourName: "", entries: [] };
    }

    const parsed = JSON.parse(raw);
    return {
      tourName: typeof parsed.tourName === "string" ? parsed.tourName : "",
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { tourName: "", entries: [] };
  }
}

function normalizeImportedEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Invalid import");
  }

  const normalizedEntries = entries.map((entry) => {
    const normalizedEntry = {
      id: typeof entry.id === "string" && entry.id ? entry.id : createEntryId(),
      date: typeof entry.date === "string" ? entry.date : "",
      odometerMiles: Number(entry.odometerMiles),
      liters: entry.liters == null ? null : Number(entry.liters),
    };

    const isFirstLikeEntry = normalizedEntry.liters == null;
    const validationMessage = validateEntry(normalizedEntry, [], isFirstLikeEntry);

    if (validationMessage && validationMessage !== "Der neue Meilenstand muss höher sein als der letzte gespeicherte.") {
      throw new Error("Invalid entry");
    }

    return normalizedEntry;
  });

  normalizedEntries.sort((a, b) => a.odometerMiles - b.odometerMiles);

  for (let index = 0; index < normalizedEntries.length; index += 1) {
    const currentEntry = normalizedEntries[index];
    const previousEntries = normalizedEntries.slice(0, index);
    const validationMessage = validateEntry(currentEntry, previousEntries, index === 0);

    if (validationMessage) {
      throw new Error("Invalid entry order");
    }
  }

  return normalizedEntries;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistTourName() {
  state.tourName = elements.tourNameInput.value.trim();
  saveState();
}

function createEntryId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setFormMessage(message, isError = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle("is-error", isError);
}

function parseLocaleNumber(value) {
  if (typeof value !== "string" || !value.trim()) {
    return Number.NaN;
  }

  return Number(value.replace(",", "."));
}

function parseOptionalLocaleNumber(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return Number(value.replace(",", "."));
}

function formatNumber(value, maximumFractionDigits) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    registration.update().catch(() => {});

    if (registration.waiting) {
      waitingServiceWorker = registration.waiting;
      elements.refreshApp.hidden = false;
    }

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
          waitingServiceWorker = registration.waiting || installingWorker;
          elements.refreshApp.hidden = false;
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  } catch {
    // No-op: app remains usable without offline cache.
  }
}
