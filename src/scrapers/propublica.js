const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const EIN_MAP = require('../utils/ein-map');

const SOURCE = 'propublica';
const API_BASE = config.sources.propublica.base;
const SEARCH_BASE = config.sources.propublica.searchBase;
const DELAY = config.sources.propublica.delay;
const TIMEOUT = config.sources.propublica.timeout;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiGet(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'opo-scraper/1.0' },
    timeout: TIMEOUT,
  });
  return data;
}

// Search ProPublica for an OPO by name and return the best EIN match
async function searchEin(opoName) {
  const query = encodeURIComponent(opoName);
  const url = `${SEARCH_BASE}?q=${query}`;
  try {
    const data = await apiGet(url);
    if (!data.organizations?.length) return null;

    // Look for an exact or close name match
    const nameNorm = opoName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const org of data.organizations) {
      const orgName = (org.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const subName = (org.sub_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (orgName.includes(nameNorm) || subName.includes(nameNorm) || nameNorm.includes(orgName)) {
        return org.ein;
      }
    }

    // Fallback: return top result if it looks like a nonprofit in the right domain
    return data.organizations[0].ein;
  } catch (err) {
    logger.warn(SOURCE, `Search failed for "${opoName}": ${err.message}`);
    return null;
  }
}

// Fetch organization details + latest filing from ProPublica
async function fetchOrg(ein) {
  const url = `${API_BASE}/organizations/${ein}.json`;
  try {
    const data = await apiGet(url);
    const org = data.organization;
    const filing = data.filings_with_data?.[0]; // newest first

    return {
      ein,
      org_name: org.name,
      city: org.city,
      state: org.state,
      filing: filing ? {
        tax_year: filing.tax_prd_yr,
        total_revenue: filing.totrevenue,
        total_expenses: filing.totfuncexpns,
        total_assets: filing.totassetsend,
        total_liabilities: filing.totliabend,
        net_assets: filing.totnetassetend,
        officer_compensation: filing.compnsatncurrofcr,
        program_revenue: filing.totprgmrevnue,
        contributions: filing.totcntrbgfts,
        investment_income: filing.invstmntinc,
        other_salaries: filing.othrsalwages,
      } : null,
    };
  } catch (err) {
    logger.warn(SOURCE, `Fetch failed for EIN ${ein}: ${err.message}`);
    return null;
  }
}

// Build EIN map by searching for each OPO name
async function buildEinMap() {
  const rawPath = path.join(config.paths.rawData, 'opodata.json');
  if (!fs.existsSync(rawPath)) {
    throw new Error('Run opodata scraper first to generate data/raw/opodata.json');
  }

  const opodata = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const results = {};

  logger.info(SOURCE, `Searching ProPublica for ${opodata.opos.length} OPOs...`);

  for (const opo of opodata.opos) {
    const ein = await searchEin(opo.name);
    results[opo.dsa_code] = ein;
    logger.info(SOURCE, `${opo.dsa_code} (${opo.name}): EIN=${ein || 'NOT FOUND'}`);
    await sleep(DELAY);
  }

  // Output as a JS module for manual review/editing
  const mapPath = path.join(config.paths.rawData, 'ein-discoveries.json');
  fs.writeFileSync(mapPath, JSON.stringify(results, null, 2));
  logger.info(SOURCE, `EIN map written to ${mapPath}`);

  return results;
}

async function scrape() {
  const rawPath = path.join(config.paths.rawData, 'opodata.json');
  if (!fs.existsSync(rawPath)) {
    throw new Error('Run opodata scraper first to generate data/raw/opodata.json');
  }

  const opodata = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const opos = opodata.opos;

  // Step 1: Resolve EINs (use static map, fall back to search)
  logger.info(SOURCE, 'Resolving EINs for OPOs...');
  const einMap = {};
  const needSearch = [];

  for (const opo of opos) {
    const staticEin = EIN_MAP[opo.dsa_code];
    if (staticEin) {
      einMap[opo.dsa_code] = staticEin;
    } else {
      needSearch.push(opo);
    }
  }

  logger.info(SOURCE, `Static EINs: ${Object.keys(einMap).length}, need search: ${needSearch.length}`);

  for (const opo of needSearch) {
    const ein = await searchEin(opo.name);
    if (ein) {
      einMap[opo.dsa_code] = ein;
    }
    logger.info(SOURCE, `${opo.dsa_code}: EIN=${ein || 'NOT FOUND'}`);
    await sleep(DELAY);
  }

  // Step 2: Fetch financial data for each EIN
  logger.info(SOURCE, `Fetching financials for ${Object.keys(einMap).length} OPOs...`);
  const results = [];
  let found = 0;

  for (const opo of opos) {
    const ein = einMap[opo.dsa_code];
    if (!ein) {
      logger.warn(SOURCE, `No EIN for ${opo.dsa_code}, skipping`);
      continue;
    }

    const orgData = await fetchOrg(ein);
    await sleep(DELAY);

    if (!orgData || !orgData.filing) {
      logger.warn(SOURCE, `No filing data for ${opo.dsa_code} (EIN ${ein})`);
      continue;
    }

    found++;
    results.push({
      dsa_code: opo.dsa_code,
      name: opo.name,
      ein,
      revenue: orgData.filing.total_revenue,
      expenses: orgData.filing.total_expenses,
      assets: orgData.filing.total_assets,
      ceo_compensation: orgData.filing.officer_compensation,
      oac_per_organ: null, // not available from ProPublica
      tax_year: orgData.filing.tax_year,
      program_revenue: orgData.filing.program_revenue,
      contributions: orgData.filing.contributions,
      investment_income: orgData.filing.investment_income,
    });

    logger.debug(SOURCE, `${opo.dsa_code}: revenue=$${(orgData.filing.total_revenue || 0).toLocaleString()}, expenses=$${(orgData.filing.total_expenses || 0).toLocaleString()}`);
  }

  const output = {
    metadata: {
      source: 'ProPublica Nonprofit Explorer API v2',
      fetched_at: new Date().toISOString(),
      total_matched: results.length,
      total_searched: opos.length,
    },
    opos: results,
  };

  const outPath = path.join(config.paths.rawData, 'propublica.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  logger.info(SOURCE, `Wrote ${results.length} OPOs with financial data to ${outPath}`);

  return output;
}

module.exports = { scrape, buildEinMap };
