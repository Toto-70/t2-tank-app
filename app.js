const STORAGE_KEY = "tank-tracker-state-v1";
const MILES_TO_KM = 1.609344;
const TANK_CAPACITY_LITERS = 55;
const ODOMETER_CORRECTION_FACTOR = 1.04;
const RANGE_BUFFER_KM = 50;

const elements = {
  form: document.getElementById("fuel-form"),
  date: document.getElementById("date"),
  odometerMiles: document.getElementById("odometerMiles"),
  liters: document.getElementById("liters"),
  resetData: document.getElementById("reset-data"),
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

init();

function init() {
  setDateFieldValue(getTodayIsoDate());

  elements.form.addEventListener("submit", handleSubmit);
  elements.resetData.addEventListener("click", handleReset);
  elements.date.addEventListener("focus", handleDateFieldActivate);
  elements.date.addEventListener("click", handleDateFieldActivate);
  elements.date.addEventListener("change", handleDateFieldChange);
  elements.date.addEventListener("blur", handleDateFieldBlur);

  render();
  registerServiceWorker();
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

  const validationMessage = validateEntry(entry, state.entries, isFirstEntry);
  if (validationMessage) {
    setFormMessage(validationMessage, true);
    return;
  }

  state.entries.push(entry);
  state.entries.sort((a, b) => a.odometerMiles - b.odometerMiles);
  saveState();

  elements.form.reset();
  setDateFieldValue(getTodayIsoDate());
  updateLitersFieldState();
  setFormMessage("Volltankvorgang gespeichert.");
  render();
}

function handleReset() {
  const confirmed = window.confirm("Wirklich alle gespeicherten Tankdaten loeschen?");
  if (!confirmed) {
    return;
  }

  state.entries = [];
  saveState();
  setFormMessage("Alle gespeicherten Daten wurden geloescht.");
  render();
}

function deleteEntry(entryId) {
  state.entries = state.entries.filter((entry) => entry.id !== entryId);
  saveState();
  render();
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

function render() {
  updateLitersFieldState();
  renderSummary();
  renderHistory();
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
    elements.estimatedRange.textContent = "Noch keine Daten";
    elements.estimatedRangeDetail.textContent = "Es fehlen mindestens zwei Volltankungen";
    elements.maxOdometer.textContent = "Nicht berechenbar";
    elements.bufferedMaxOdometer.textContent = "Nicht berechenbar";
    elements.summaryBasis.textContent = "Basis wird ab zwei Volltankungen angezeigt.";
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

  const estimatedRangeKm = TANK_CAPACITY_LITERS / avgConsumptionLPerKm;
  const estimatedRangeActualMiles = estimatedRangeKm / MILES_TO_KM;
  const estimatedRangeDisplayedMiles = estimatedRangeActualMiles / ODOMETER_CORRECTION_FACTOR;
  const bufferedRangeKm = Math.max(0, estimatedRangeKm - RANGE_BUFFER_KM);
  const bufferedRangeDisplayedMiles = (bufferedRangeKm / MILES_TO_KM) / ODOMETER_CORRECTION_FACTOR;
  const maxOdometerMiles = latestEntry.odometerMiles + estimatedRangeDisplayedMiles;
  const bufferedMaxOdometerMiles = latestEntry.odometerMiles + bufferedRangeDisplayedMiles;

  elements.estimatedRange.textContent = `${formatNumber(estimatedRangeActualMiles, 0)} mi`;
  elements.estimatedRangeDetail.textContent = `${formatNumber(estimatedRangeKm, 0)} km real mit ${TANK_CAPACITY_LITERS} l`;
  elements.maxOdometer.textContent = `${formatNumber(maxOdometerMiles, 0)} mi`;
  elements.bufferedMaxOdometer.textContent = `${formatNumber(bufferedMaxOdometerMiles, 0)} mi`;
  elements.summaryBasis.textContent = `Basis: ${formatNumber(totalDistanceKm, 0)} km aus ${totalTankEvents} Tankvorgaengen`;
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
    return "Unveraendert";
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

function validateEntry(entry, entries) {
  if (!entry.date) {
    return "Bitte ein Datum eintragen.";
  }

  if (!Number.isFinite(entry.odometerMiles) || entry.odometerMiles < 0) {
    return "Der Meilenstand muss eine gueltige Zahl sein.";
  }

  if (!entries.length) {
    if (Number.isFinite(entry.liters) && entry.liters <= 0) {
      return "Falls du beim ersten Eintrag Liter angibst, muessen sie groesser als 0 sein.";
    }
  } else if (!Number.isFinite(entry.liters) || entry.liters <= 0) {
    return "Die getankten Liter muessen groesser als 0 sein.";
  }

  const highestOdometer = entries.reduce(
    (maxValue, currentEntry) => Math.max(maxValue, currentEntry.odometerMiles),
    -Infinity,
  );

  if (entries.length && entry.odometerMiles <= highestOdometer) {
    return "Der neue Meilenstand muss hoeher sein als der letzte gespeicherte.";
  }

  return "";
}

function updateLitersFieldState() {
  const isFirstEntry = state.entries.length === 0;
  elements.liters.required = !isFirstEntry;
  elements.liters.placeholder = isFirstEntry ? "Beim ersten Eintrag optional" : "z. B. 42.50";
}

function setDateFieldValue(isoValue) {
  elements.date.type = "text";
  elements.date.readOnly = true;
  elements.date.dataset.isoValue = isoValue || "";
  elements.date.value = isoValue ? formatDate(isoValue) : "";
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
      return { entries: [] };
    }

    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // No-op: app remains usable without offline cache.
  }
}
