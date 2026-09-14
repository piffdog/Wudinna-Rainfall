const fs = require("fs/promises");
const path = require("path");
const JSZip = require("jszip");
const Papa = require("papaparse");

const STATION = "018083";
const STATION_NAME = "Wudinna Aero";
const RAINFALL_YEAR_ENDING_OCTOBER = 2026;

const START_DATE = "2025-11-01";
const STATIC_CARRYOVER_END_DATE = "2025-12-31";
const REFRESH_START_DATE = "2026-01-01";
const END_DATE = "2026-10-31";

const OUT_PATH = path.join(__dirname, "..", "data", "current-year.json");

function bomZipUrl(year) {
  return `https://www.bom.gov.au/tmp/cdio/IDCJAC0009_${STATION}_${year}.zip`;
}

function monthAxis(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const base = {
    11: 0,
    12: 1,
    1: 2,
    2: 3,
    3: 4,
    4: 5,
    5: 6,
    6: 7,
    7: 8,
    8: 9,
    9: 10,
    10: 11
  }[month];

  return base + (day - 1) / daysInMonth;
}

function round1(x) {
  return Math.round((Number(x) + Number.EPSILON) * 10) / 10;
}

async function readExistingJson() {
  const raw = await fs.readFile(OUT_PATH, "utf8");
  return JSON.parse(raw);
}

async function fetchDailyCsv(year) {
  const url = bomZipUrl(year);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "application/zip,application/octet-stream,*/*",
      "Referer": "https://www.bom.gov.au/"
    }
  });

  if (!response.ok) {
    throw new Error(`BOM ZIP download failed for ${year}: HTTP ${response.status} ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(Buffer.from(arrayBuffer));
  const csvName = Object.keys(zip.files).find(name => name.toLowerCase().endsWith(".csv"));

  if (!csvName) {
    throw new Error(`No CSV found in BOM ZIP for ${year}`);
  }

  const csvText = await zip.file(csvName).async("string");
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true
  });

  if (parsed.errors.length) {
    throw new Error(`CSV parse errors for ${year}: ${JSON.stringify(parsed.errors.slice(0, 3))}`);
  }

  return parsed.data;
}

function normaliseRows(rows) {
  return rows.map(row => {
    const year = Number(row.Year);
    const month = Number(row.Month);
    const day = Number(row.Day);
    const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const rainKey = Object.keys(row).find(k => k.toLowerCase().includes("rainfall amount"));
    if (!rainKey) {
      throw new Error("Could not find rainfall amount column in BOM CSV");
    }

    const rainRaw = row[rainKey];
    const rainfall = rainRaw === "" || rainRaw == null ? 0 : Number(rainRaw);

    return {
      date,
      rainfall_mm: Number.isFinite(rainfall) ? rainfall : 0
    };
  });
}

function buildDailyRows(staticRows, refreshedRows) {
  const combined = [...staticRows, ...refreshedRows]
    .filter(d => d.date >= START_DATE && d.date <= END_DATE)
    .sort((a, b) => a.date.localeCompare(b.date));

  let cumulative = 0;

  return combined.map(d => {
    cumulative += Number(d.rainfall_mm || 0);
    return {
      date: d.date,
      rainfall_mm: round1(d.rainfall_mm),
      cumulative_mm: round1(cumulative),
      x: monthAxis(d.date)
    };
  });
}

async function main() {
  const existing = await readExistingJson();

  const staticCarryover = (existing.daily || [])
    .filter(d => d.date >= START_DATE && d.date <= STATIC_CARRYOVER_END_DATE)
    .map(d => ({
      date: d.date,
      rainfall_mm: Number(d.rainfall_mm || 0)
    }));

  if (!staticCarryover.length) {
    throw new Error("Existing data/current-year.json does not contain Nov-Dec 2025 carryover rows.");
  }

  const rows2026 = await fetchDailyCsv(2026);
  const refreshed2026 = normaliseRows(rows2026)
    .filter(d => d.date >= REFRESH_START_DATE && d.date <= END_DATE);

  if (!refreshed2026.length) {
    throw new Error("No 2026 daily rows after filtering.");
  }

  const daily = buildDailyRows(staticCarryover, refreshed2026);

  const output = {
    station: STATION,
    stationName: STATION_NAME,
    rainfallYearEndingOctober: RAINFALL_YEAR_ENDING_OCTOBER,
    startDate: START_DATE,
    endDate: END_DATE,
    updatedAt: new Date().toISOString(),
    source: "Nov-Dec 2025 retained from committed JSON; 2026 refreshed from BOM daily rainfall ZIP IDCJAC0009 for station 018083.",
    daily
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Wrote ${daily.length} daily rows to ${OUT_PATH}`);
  console.log(`Latest: ${daily[daily.length - 1].date} = ${daily[daily.length - 1].cumulative_mm}mm`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
