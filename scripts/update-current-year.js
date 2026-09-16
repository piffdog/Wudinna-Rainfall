const fs = require("fs/promises");
const path = require("path");
const Papa = require("papaparse");

const STATION = "018083";
const STATION_NAME = "Wudinna Aero";
const DWO_STATION_CODE = "5073";
const RAINFALL_YEAR_ENDING_OCTOBER = 2026;

const START_DATE = "2025-11-01";
const END_DATE = "2026-10-31";

const OUT_PATH = path.join(__dirname, "..", "data", "current-year.json");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept": "text/csv,text/plain,*/*",
  "Referer": "https://www.bom.gov.au/"
};

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

function isoMonth(year, month) {
  return `${year}${String(month).padStart(2, "0")}`;
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1
  };
}

function monthRange(startYear, startMonth, endYear, endMonth) {
  const out = [];
  let i = 0;
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));

  while (true) {
    const d = new Date(
      Date.UTC(startYear, startMonth - 1 + i, 1)
    );

    if (d > end) break;

    out.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1
    });

    i += 1;
  }

  return out;
}

function dailyCsvUrl(year, month) {
  const ym = isoMonth(year, month);

  return `https://www.bom.gov.au/climate/dwo/${ym}/text/IDCJDW${DWO_STATION_CODE}.${ym}.csv`;
}

async function fetchWithRetry(url, attempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS });

      if (response.ok) {
        return await response.text();
      }

      lastError = new Error(
        `BOM request failed: HTTP ${response.status} ${url}`
      );
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      const waitMs = 1500 * attempt;

      console.log(
        `Retrying BOM request in ${waitMs}ms ` +
        `(attempt ${attempt + 1}/${attempts})`
      );

      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

function parseBOMMonthlyCsv(csvText, year, month) {
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true
  });

  if (parsed.errors.length) {
    throw new Error(
      `CSV parse errors for ${year}-${String(month).padStart(2, "0")}: ` +
      JSON.stringify(parsed.errors.slice(0, 3))
    );
  }

  const dateKey = Object.keys(parsed.data[0] || {}).find(
    k => k.trim().toLowerCase() === "date"
  );

  const rainfallKey =
    Object.keys(parsed.data[0] || {}).find(
      k => k.trim().toLowerCase() === "rainfall (mm)"
    ) ||
    Object.keys(parsed.data[0] || {}).find(
      k => k.trim().toLowerCase().includes("rainfall")
    );

  if (!dateKey || !rainfallKey) {
    throw new Error(
      `Could not identify Date/Rainfall columns for ` +
      `${year}-${String(month).padStart(2, "0")}. ` +
      `Headers: ${Object.keys(parsed.data[0] || {}).join(", ")}`
    );
  }

  const rows = [];

  for (const row of parsed.data) {
    const rawDate = String(row[dateKey] || "").trim();

    if (!rawDate || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(rawDate)) {
      continue;
    }

    const rainfallRaw = String(row[rainfallKey] ?? "").trim();

    if (rainfallRaw === "") continue;

    const rainfall = Number(rainfallRaw);

    if (!Number.isFinite(rainfall)) continue;

    const dateParts = rawDate.split("-").map(Number);

    const date =
      `${String(dateParts[0]).padStart(4, "0")}-` +
      `${String(dateParts[1]).padStart(2, "0")}-` +
      `${String(dateParts[2]).padStart(2, "0")}`;

    rows.push({
      date,
      rainfall_mm: rainfall
    });
  }

  return rows;
}

async function fetchDailyRowsForDateRange() {
  const now = new Date();

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const months = monthRange(
    2025,
    11,
    currentYear,
    currentMonth
  );

  const all = [];

  for (const { year, month } of months) {
    const url = dailyCsvUrl(year, month);

    console.log(
      `Fetching BOM daily data: ${url}`
    );

    const csvText = await fetchWithRetry(url);

    const rows = parseBOMMonthlyCsv(
      csvText,
      year,
      month
    );

    all.push(...rows);
  }

  return all
    .filter(
      d =>
        d.date >= START_DATE &&
        d.date <= END_DATE &&
        d.date <= todayISO()
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date)
    );
}

function todayISO() {
  const d = new Date();

  const y = d.getUTCFullYear();

  const m = String(
    d.getUTCMonth() + 1
  ).padStart(2, "0");

  const day = String(
    d.getUTCDate()
  ).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function buildDailyRows(rows) {
  let cumulative = 0;

  return rows.map(d => {
    cumulative += d.rainfall_mm;

    return {
      date: d.date,
      rainfall_mm: round1(d.rainfall_mm),
      cumulative_mm: round1(cumulative),
      x: monthAxis(d.date)
    };
  });
}

async function main() {
  const dailySourceRows =
    await fetchDailyRowsForDateRange();

  if (!dailySourceRows.length) {
    throw new Error(
      "No BOM daily rainfall rows were retrieved " +
      "for the current rainfall year."
    );
  }

  const daily =
    buildDailyRows(dailySourceRows);

  const latest =
    daily[daily.length - 1];

  const output = {
    station: STATION,
    stationName: STATION_NAME,
    rainfallYearEndingOctober:
      RAINFALL_YEAR_ENDING_OCTOBER,
    startDate: START_DATE,
    endDate: END_DATE,
    updatedAt:
      new Date().toISOString(),
    source:
      "BOM Daily Weather Observations monthly " +
      "CSV files for Wudinna Aero station 018083 " +
      "(DWO station code 5073).",
    daily
  };

  await fs.mkdir(
    path.dirname(OUT_PATH),
    { recursive: true }
  );

  await fs.writeFile(
    OUT_PATH,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Wrote ${daily.length} daily rows to ${OUT_PATH}`
  );

  console.log(
    `Latest: ${latest.date} = ` +
    `${latest.cumulative_mm}mm`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
