const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const SOURCE = 'hrsa';
const XLSX_URL = 'https://data.hrsa.gov/DataDownload/DD_Files/ORG_OTC_FCT_DET.xlsx';
const TIMEOUT = config.sources.hrsa.timeout;

// Mapping of OPO Provider Numbers to DSA codes.
// Provider numbers are CMS-style (##P###), DSA codes are UNOS 4-letter codes.
// Built from cross-referencing HRSA OPO names with opodata.org names.
const PROVIDER_TO_DSA = {
  '01P001': 'ALOB',  // Alabama Organ Center / Legacy of Hope
  '03P001': 'AZOB',  // Donor Network of Arizona
  '04P001': 'AROR',  // Arkansas Regional Organ Recovery Agency
  '05P001': 'CASD',  // Lifesharing - A Donate Life Organization (San Diego)
  '05P003': 'CAOP',  // OneLegacy
  '05P004': 'CAGS',  // Sierra Donor Services
  '05P005': 'CADN',  // Donor Network West
  '06P001': 'CORS',  // Donor Alliance (Colorado)
  // 07P001: LifeChoice Donor Services (CT) - no DSA mapping in opodata.org
  '10P001': 'FLWC',  // LifeLink of Florida
  '10P002': 'FLMP',  // Life Alliance Organ Recovery Agency
  '10P003': 'FLFH',  // TransLife / OurLegacy (Central Florida)
  '10P004': 'FLUF',  // LifeQuest Organ Recovery Services
  '11P002': 'GALL',  // LifeLink of Georgia
  '12P001': 'HIOP',  // Legacy of Life Hawaii
  '14P001': 'ILIP',  // Gift of Hope Organ & Tissue Donor Network
  '15P001': 'INOP',  // Indiana Donor Network
  '16P001': 'IAOP',  // Iowa Donor Network
  '17P001': 'MWOB',  // Midwest Transplant Network (Kansas)
  '18P001': 'KYDA',  // Kentucky Organ Donor Affiliates
  '19P001': 'LAOP',  // Louisiana Organ Procurement Agency
  '21P001': 'MDPC',  // The Living Legacy Foundation of Maryland
  '22P001': 'MAOB',  // New England Organ Bank / Donor Services
  '23P001': 'MIOP',  // Gift of Life Michigan
  '24P001': 'MNOP',  // LifeSource Upper Midwest
  '25P001': 'MSOP',  // Mississippi Organ Recovery Agency
  '26P002': 'MOMA',  // Mid-America Transplant Services
  '28P001': 'NEOR',  // Nebraska Organ Recovery System / Live On Nebraska
  '29P001': 'NVLV',  // Nevada Donor Network
  '31P001': 'NJTO',  // New Jersey Sharing Network
  '32P001': 'NMOP',  // New Mexico Donor Services
  '33P001': 'NYWN',  // Upstate NY Transplant Services / ConnectLife
  '33P003': 'NYRT',  // LiveOnNY
  '33P004': 'NYAP',  // Center for Donation and Transplant
  '33P005': 'NYFL',  // Finger Lakes Donor Recovery Network
  '34P001': 'NCNC',  // Carolina Donor Services / HonorBridge
  '34P003': 'NCCM',  // LifeShare of the Carolinas
  '36P001': 'OHLC',  // Life Connection of Ohio
  '36P002': 'OHLB',  // Lifebanc
  '36P003': 'OHOV',  // LifeCenter Organ Donor Network
  '36P005': 'OHLP',  // Lifeline of Ohio
  '37P002': 'OKOP',  // LifeShare of Oklahoma
  '38P001': 'ORUO',  // Pacific Northwest Transplant Bank
  '39P001': 'PADV',  // Gift of Life Donor Program
  '39P002': 'PATF',  // Center for Organ Recovery and Education (CORE)
  '40P002': 'PRLL',  // LifeLink of Puerto Rico
  '42P001': 'SCOP',  // We Are Sharing Hope SC
  '44P001': 'TNDS',  // Tennessee Donor Services
  '44P003': 'TNMS',  // Mid-South Transplant Foundation
  '45P002': 'TXSB',  // Southwest Transplant Alliance
  '45P003': 'TXGC',  // LifeGift Organ Donation Center
  '45P004': 'TXSA',  // Texas Organ Sharing Alliance
  '46P001': 'UTOP',  // Intermountain Donor Services / DonorConnect
  '49P001': 'VATB',  // LifeNet Health
  '49P003': 'DCTC',  // Washington Regional Transplant Community
  '50P003': 'WALC',  // LifeCenter Northwest
  '52P001': 'WIUW',  // UW Health Organ and Tissue Donation
  '52P002': 'WIDN',  // Wisconsin Donor Network / Versiti
};

async function scrape() {
  logger.info(SOURCE, `Downloading HRSA OPO directory from ${XLSX_URL}...`);

  const response = await axios.get(XLSX_URL, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT,
    headers: { 'User-Agent': 'opo-scraper/1.0' },
  });

  logger.info(SOURCE, `Downloaded ${(response.data.byteLength / 1024).toFixed(0)} KB`);

  const workbook = XLSX.read(response.data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  logger.info(SOURCE, `Parsed ${rows.length} rows from sheet "${sheetName}"`);

  // Group rows by OPO Provider Number
  const opoGroups = {};
  for (const row of rows) {
    const providerNum = row['OPO Provider #'] || row['OPO Provider Number'];
    if (!providerNum) continue;

    const key = String(providerNum).trim();
    if (!opoGroups[key]) {
      opoGroups[key] = {
        provider_number: key,
        name: (row['OPO Name'] || '').trim(),
        address: (row['Address'] || '').trim(),
        city: (row['City'] || '').trim(),
        state: (row['State'] || '').trim(),
        zip: (row['ZIP'] || '').trim(),
        phone: (row['OPO Telephone #'] || row['Telephone'] || '').trim(),
        transplant_centers: [],
      };
    }

    const otcName = (row['OTC Name'] || '').trim();
    const otcCode = (row['OTC Code'] || '').trim();
    const serviceType = (row['Organ Transplantation Center Service Type Description'] || '').trim();

    if (otcName) {
      // Check if we already have this OTC
      const existing = opoGroups[key].transplant_centers.find(tc => tc.code === otcCode);
      if (existing) {
        if (serviceType && !existing.services.includes(serviceType)) {
          existing.services.push(serviceType);
        }
      } else {
        opoGroups[key].transplant_centers.push({
          name: otcName,
          code: otcCode,
          city: (row['City'] || '').trim(), // OTC city may differ
          services: serviceType ? [serviceType] : [],
        });
      }
    }
  }

  logger.info(SOURCE, `Found ${Object.keys(opoGroups).length} unique OPOs`);

  // Map to DSA codes
  const opos = [];
  const unmapped = [];

  for (const [provNum, opoData] of Object.entries(opoGroups)) {
    const dsaCode = PROVIDER_TO_DSA[provNum];
    if (!dsaCode) {
      unmapped.push(`${provNum}: ${opoData.name}`);
      continue;
    }

    opos.push({
      dsa_code: dsaCode,
      name: opoData.name,
      provider_number: opoData.provider_number,
      city: opoData.city || null,
      address: opoData.address || null,
      state: opoData.state || null,
      zip: opoData.zip || null,
      phone: opoData.phone || null,
      transplant_centers: opoData.transplant_centers,
    });
  }

  if (unmapped.length > 0) {
    logger.warn(SOURCE, `Unmapped provider numbers: ${unmapped.join(', ')}`);
  }

  opos.sort((a, b) => a.dsa_code.localeCompare(b.dsa_code));

  const output = {
    metadata: {
      source: 'HRSA Data Downloads (ORG_OTC_FCT_DET.xlsx)',
      fetched_at: new Date().toISOString(),
      total_opos: opos.length,
      total_transplant_centers: opos.reduce((sum, o) => sum + o.transplant_centers.length, 0),
    },
    opos,
  };

  const outPath = path.join(config.paths.rawData, 'hrsa.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  logger.info(SOURCE, `Wrote ${opos.length} OPOs to ${outPath}`);

  return output;
}

module.exports = { scrape };
