const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const SOURCE = 'cms-qcor';

const EXCEL_URLS = [
  'https://qcor.cms.gov/documents/Public%202024%20%26%202025%20OPO%20Report%20-%20July%202025.xlsx',
  'https://qcor.cms.gov/documents/Public%202024%20%26%202025%20OPO%20Report%20-%20January%202025.xlsx',
  'https://qcor.cms.gov/documents/Public%202023%20%26%202024%20OPO%20Report%20-%20July%202024.xlsx',
];

const TIMEOUT = config.sources.cmsQcor.timeout;
const YEARS = [2019, 2020, 2021, 2022, 2023];

async function downloadExcel() {
  for (const url of EXCEL_URLS) {
    try {
      logger.info(SOURCE, `Trying ${url}...`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT,
        headers: { 'User-Agent': 'opo-scraper/1.0' },
      });
      logger.info(SOURCE, `Downloaded ${(response.data.byteLength / 1024).toFixed(0)} KB`);
      return response.data;
    } catch (err) {
      logger.warn(SOURCE, `Not available: ${err.message}`);
    }
  }
  throw new Error('Could not download any CMS QCOR Excel file');
}

function toNum(val) {
  if (val === null || val === undefined || val === '' || val === 'N/A' || val === '-') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseSummarySheet(workbook) {
  const sheetName = workbook.SheetNames.find(n => /summary/i.test(n));
  if (!sheetName) {
    logger.warn(SOURCE, 'No Summary sheet found');
    return [];
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Summary structure (multi-row header):
  // Row 7: [OPO Name, OPO Code, "Tier1", null, null, null, null, "Donation Rate...", ...]
  // Row 9: [null, null, 2019, 2020, 2021, 2022, 2023, 2019, 2020, 2021, 2022, 2023, 2019, ...]
  // Row 12+: Data rows

  // Find the row containing "OPO Code"
  let mainHeaderRow = -1;
  for (let i = 0; i < 20; i++) {
    if (rows[i]?.some(c => c && typeof c === 'string' && /opo.*code/i.test(c))) {
      mainHeaderRow = i;
      break;
    }
  }
  if (mainHeaderRow === -1) return [];

  // Find the year subheader row (contains 2019, 2020, etc.)
  let yearRow = -1;
  for (let i = mainHeaderRow + 1; i < mainHeaderRow + 5; i++) {
    if (rows[i]?.some(c => c === 2019 || c === 2020 || c === '2019' || c === '2020')) {
      yearRow = i;
      break;
    }
  }

  const mainHeaders = rows[mainHeaderRow] || [];
  const codeIdx = mainHeaders.findIndex(h => h && typeof h === 'string' && /opo.*code/i.test(h));
  const nameIdx = mainHeaders.findIndex(h => h && typeof h === 'string' && /organ.*procurement|opo/i.test(h));

  // Determine column layout: after OPO Code, we have 5 tier cols, 5 donation rate cols, 5 transplant rate cols
  // Tier columns start at codeIdx + 1
  const tierStartCol = codeIdx + 1;
  const donRateStartCol = tierStartCol + 5;
  const txpRateStartCol = donRateStartCol + 5;

  const opos = [];

  // Data rows start after the year subheader (skip empty rows)
  const dataStart = yearRow !== -1 ? yearRow + 1 : mainHeaderRow + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const code = row[codeIdx];
    if (!code || typeof code !== 'string' || !/^[A-Z]{4}$/.test(code.trim())) continue;

    const tierHistory = {};
    const donRateCats = {};
    const txpRateCats = {};

    for (let y = 0; y < YEARS.length; y++) {
      tierHistory[YEARS[y]] = toNum(row[tierStartCol + y]);
      donRateCats[YEARS[y]] = row[donRateStartCol + y] ? String(row[donRateStartCol + y]).trim() : null;
      txpRateCats[YEARS[y]] = row[txpRateStartCol + y] ? String(row[txpRateStartCol + y]).trim() : null;
    }

    opos.push({
      dsa_code: code.trim(),
      name: row[nameIdx] ? String(row[nameIdx]).trim() : null,
      tier_history: tierHistory,
      latest_tier: tierHistory[2023] ?? tierHistory[2022] ?? null,
      donation_rate_categories: donRateCats,
      transplant_rate_categories: txpRateCats,
    });
  }

  return opos;
}

function parseAssessmentSheet(workbook) {
  // Find the most recent assessment sheet
  const assessmentSheets = workbook.SheetNames
    .filter(n => /\d{4}\s*assessment/i.test(n))
    .sort()
    .reverse();

  if (assessmentSheets.length === 0) return {};

  const sheetName = assessmentSheets[0];
  logger.info(SOURCE, `Parsing latest assessment: ${sheetName}`);

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // The 2025 Assessment data rows have the structure (starting ~row 47):
  // [OPO Name, OPO Code, Donation Rate, Upper CI, median gap, top25 gap, Rate Cat,
  //  Expected Txp Rate, Observed Txp Rate, Age-Adjusted, Upper CI, median gap, top25 gap, Rate Cat,
  //  Tier 2019, 2020, 2021, 2022, 2023]

  // Find data rows by looking for 4-letter OPO codes in column 1
  const assessments = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const code = row[1];
    if (!code || typeof code !== 'string' || !/^[A-Z]{4}$/.test(code.trim())) continue;

    assessments[code.trim()] = {
      donation_rate: toNum(row[2]),
      donation_rate_upper_ci: toNum(row[3]),
      donation_rate_category: row[6] ? String(row[6]).trim() : null,
      expected_transplant_rate: toNum(row[7]),
      observed_transplant_rate: toNum(row[8]),
      age_adjusted_transplant_rate: toNum(row[9]),
      transplant_rate_upper_ci: toNum(row[10]),
      transplant_rate_category: row[13] ? String(row[13]).trim() : null,
      tier_2019: toNum(row[14]),
      tier_2020: toNum(row[15]),
      tier_2021: toNum(row[16]),
      tier_2022: toNum(row[17]),
      tier_2023: toNum(row[18]),
    };
  }

  return assessments;
}

async function scrape() {
  logger.info(SOURCE, 'Downloading CMS QCOR OPO Performance Report...');

  const data = await downloadExcel();
  const workbook = XLSX.read(data, { type: 'buffer' });

  logger.info(SOURCE, `Workbook sheets: ${workbook.SheetNames.join(', ')}`);

  const summaryOpos = parseSummarySheet(workbook);
  logger.info(SOURCE, `Summary: ${summaryOpos.length} OPOs`);

  const assessments = parseAssessmentSheet(workbook);
  logger.info(SOURCE, `Assessment: ${Object.keys(assessments).length} OPOs`);

  const opos = summaryOpos.map(opo => {
    const assessment = assessments[opo.dsa_code] || {};
    return {
      ...opo,
      assessment,
    };
  });

  const output = {
    metadata: {
      source: 'CMS QCOR OPO Performance Report',
      fetched_at: new Date().toISOString(),
      total_opos: opos.length,
    },
    opos,
  };

  const outPath = path.join(config.paths.rawData, 'cms-qcor.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  logger.info(SOURCE, `Wrote ${opos.length} OPOs to ${outPath}`);

  return output;
}

module.exports = { scrape };
