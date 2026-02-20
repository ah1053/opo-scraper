const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const SOURCE = 'srtr';

// SRTR provides downloadable Excel files containing all OPO-Specific Report tables.
// URL pattern: https://www.srtr.org/assets/media/OSRdownloads/final_tables/OSR_final_tables{YYMM}.xlsx
// We try the latest period codes in order (semiannual releases in Jan and Jul).
const PERIOD_CODES = ['2507', '2505', '2501', '2407', '2401'];
const BASE_URL = 'https://www.srtr.org/assets/media/OSRdownloads/final_tables/OSR_final_tables';

async function downloadExcel() {
  for (const code of PERIOD_CODES) {
    const url = `${BASE_URL}${code}.xlsx`;
    try {
      logger.info(SOURCE, `Trying ${url}...`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: config.sources.srtr.timeout,
        headers: { 'User-Agent': 'opo-scraper/1.0' },
      });
      logger.info(SOURCE, `Downloaded ${(response.data.byteLength / 1024).toFixed(0)} KB from period ${code}`);
      return { data: response.data, period: code };
    } catch (err) {
      logger.warn(SOURCE, `Period ${code} not available: ${err.message}`);
    }
  }
  throw new Error('Could not download any SRTR Excel file');
}

function findSheet(workbook, patterns) {
  for (const pattern of patterns) {
    const re = new RegExp(pattern, 'i');
    const match = workbook.SheetNames.find(name => re.test(name));
    if (match) return match;
  }
  return null;
}

function parseUtilizationData(workbook) {
  // Look for sheets related to organ utilization/yield (Section C)
  // Common sheet names include variations of "C" tables
  const opoData = {};

  logger.info(SOURCE, `Available sheets: ${workbook.SheetNames.join(', ')}`);

  // Try to find sheets with OPO-level organ yield or utilization data
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (rows.length < 2) continue;

    // Look for rows containing OPO codes (4-letter codes like ALOB, AROR, etc.)
    const headerRow = rows[0] || [];
    const opoCodeColIdx = headerRow.findIndex(h =>
      h && typeof h === 'string' && /opo.*code|center.*code|code/i.test(h)
    );

    if (opoCodeColIdx === -1) {
      // Try checking if any column has values matching OPO code pattern
      for (let row = 1; row < Math.min(rows.length, 10); row++) {
        for (let col = 0; col < (rows[row]?.length || 0); col++) {
          const val = rows[row][col];
          if (val && typeof val === 'string' && /^[A-Z]{4}$/.test(val)) {
            // Found what looks like OPO codes, parse this sheet
            logger.info(SOURCE, `Found OPO data in sheet "${sheetName}" at column ${col}`);
            parseSheetWithOpoCol(rows, col, headerRow, opoData, sheetName);
            break;
          }
        }
      }
      continue;
    }

    logger.info(SOURCE, `Sheet "${sheetName}" has OPO code column at index ${opoCodeColIdx}`);
    parseSheetWithOpoCol(rows, opoCodeColIdx, headerRow, opoData, sheetName);
  }

  return opoData;
}

function parseSheetWithOpoCol(rows, opoColIdx, headerRow, opoData, sheetName) {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const code = row[opoColIdx];
    if (!code || typeof code !== 'string' || !/^[A-Z]{4}$/.test(code)) continue;

    if (!opoData[code]) {
      opoData[code] = { sheets: {} };
    }

    // Store all columns as key-value pairs using headers
    const entry = {};
    for (let j = 0; j < headerRow.length; j++) {
      const header = headerRow[j];
      if (header && j !== opoColIdx) {
        entry[String(header).trim()] = row[j] ?? null;
      }
    }

    if (!opoData[code].sheets[sheetName]) {
      opoData[code].sheets[sheetName] = [];
    }
    opoData[code].sheets[sheetName].push(entry);
  }
}

function toNum(val) {
  if (val === null || val === undefined || val === '' || val === 'N/A') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function getVal(sheets, sheetPattern, colName) {
  for (const [name, rows] of Object.entries(sheets)) {
    if (!sheetPattern.test(name)) continue;
    for (const row of rows) {
      if (colName in row) return row[colName];
    }
  }
  return null;
}

function calcDiscardRate(sheets, organ) {
  // Discard rate = (recovered for transplant, not transplanted) / (recovered for transplant total)
  // From Table C1: "{organ}s recovered for transplant, not transplanted" and "{organ}s recovered for transplant, transplanted"
  const c1 = /Table C1/i;
  const abbrevMap = { kidney: 'KI', liver: 'LI', heart: 'HR', lung: 'LU' };
  const abbrev = abbrevMap[organ];
  if (!abbrev) return null;

  const notTransplanted = toNum(getVal(sheets, c1, `${abbrev}s recovered for transplant, not transplanted`));
  const transplanted = toNum(getVal(sheets, c1, `${abbrev}s recovered for transplant, transplanted`));

  if (notTransplanted === null || transplanted === null) return null;
  const total = notTransplanted + transplanted;
  if (total === 0) return 0;
  return Math.round((notTransplanted / total) * 10000) / 100; // percentage with 2 decimals
}

function extractMetrics(opoSheetData) {
  const metrics = {
    conversion_rate: null,
    donation_rate: null,
    transplantation_rate: null,
    organs_transplanted_per_donor: null,
    observed_expected_ratio: null,
    observed_expected_by_organ: {
      heart: null,
      kidney: null,
      liver: null,
      lung: null,
    },
    total_donors: null,
    total_referrals: null,
    discard_rates: {
      kidney: null,
      liver: null,
      heart: null,
      lung: null,
    },
  };

  if (!opoSheetData?.sheets) return metrics;
  const sheets = opoSheetData.sheets;

  // Figure C5: "All organs transplanted per donor" (OTPD)
  metrics.organs_transplanted_per_donor = toNum(
    getVal(sheets, /Figure C5/i, 'All organs transplanted per donor')
  );

  // Table C2, Figure C7: Observed/Expected ratios
  const c2Pattern = /Table C2/i;
  metrics.observed_expected_ratio = toNum(
    getVal(sheets, c2Pattern, 'Observed to expected ratio - aggregate')
  );
  metrics.observed_expected_by_organ.heart = toNum(
    getVal(sheets, c2Pattern, 'Observed to expected ratio - heart')
  );
  metrics.observed_expected_by_organ.kidney = toNum(
    getVal(sheets, c2Pattern, 'Observed to expected ratio - kidney')
  );
  metrics.observed_expected_by_organ.liver = toNum(
    getVal(sheets, c2Pattern, 'Observed to expected ratio - liver')
  );
  metrics.observed_expected_by_organ.lung = toNum(
    getVal(sheets, c2Pattern, 'Observed to expected ratio - lung')
  );

  // Total donors from Table C2
  metrics.total_donors = toNum(
    getVal(sheets, c2Pattern, 'Number of donors')
  );

  // Discard rates from Table C1
  metrics.discard_rates.kidney = calcDiscardRate(sheets, 'kidney');
  metrics.discard_rates.liver = calcDiscardRate(sheets, 'liver');
  metrics.discard_rates.heart = calcDiscardRate(sheets, 'heart');
  metrics.discard_rates.lung = calcDiscardRate(sheets, 'lung');

  return metrics;
}

async function scrape() {
  logger.info(SOURCE, 'Downloading SRTR OPO-Specific Report tables...');

  const { data, period } = await downloadExcel();
  const workbook = XLSX.read(data, { type: 'buffer' });

  logger.info(SOURCE, `Workbook has ${workbook.SheetNames.length} sheets`);

  const opoSheetData = parseUtilizationData(workbook);
  const opoCodes = Object.keys(opoSheetData);
  logger.info(SOURCE, `Found data for ${opoCodes.length} OPOs`);

  const opos = [];
  for (const code of opoCodes.sort()) {
    const metrics = extractMetrics(opoSheetData[code]);
    opos.push({
      dsa_code: code,
      ...metrics,
    });
  }

  const output = {
    metadata: {
      source: 'SRTR OPO-Specific Reports (Excel)',
      period_code: period,
      fetched_at: new Date().toISOString(),
      total_opos: opos.length,
      sheets_parsed: workbook.SheetNames.length,
    },
    opos,
  };

  const outPath = path.join(config.paths.rawData, 'srtr.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  logger.info(SOURCE, `Wrote ${opos.length} OPOs to ${outPath}`);

  return output;
}

module.exports = { scrape };
