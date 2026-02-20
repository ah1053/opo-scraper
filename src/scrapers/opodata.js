const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const SOURCE = 'opodata';
const { base, indexPageData, userAgent, timeout } = config.sources.opodata;

function generateId(dsaCode) {
  const hash = crypto.createHash('sha256').update(`opo:${dsaCode}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

async function fetchJson(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': userAgent },
    timeout,
  });
  return data;
}

async function findOpoDataHash(hashes) {
  for (const hash of hashes) {
    const url = `${base}/page-data/sq/d/${hash}.json`;
    try {
      const data = await fetchJson(url);
      if (data?.data?.opoData?.nodes) {
        return { hash, data: data.data };
      }
    } catch {
      // skip hashes that fail
    }
  }
  return null;
}

function parseTier(tierStr) {
  const match = tierStr?.match(/^(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseAtRisk(tierStr) {
  const tier = parseTier(tierStr);
  return tier !== null ? tier >= 2 : null;
}

function parseStates(statesStr) {
  if (!statesStr) return { states: [], regions: [] };
  const parts = statesStr.split(';');
  const states = [];
  const regions = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const dashIdx = trimmed.indexOf(' - ');
    if (dashIdx !== -1) {
      const st = trimmed.substring(0, dashIdx).trim();
      const region = trimmed.substring(dashIdx + 3).trim();
      states.push(st);
      regions.push(`${st}: ${region}`);
    } else {
      states.push(trimmed);
      regions.push(trimmed);
    }
  }
  return { states: [...new Set(states)], regions };
}

function toNum(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function transformOpo(raw) {
  const { states, regions } = parseStates(raw.states);
  const primaryState = states[0] || null;

  return {
    opo_id: generateId(raw.abbreviation),
    name: raw.name,
    dsa_code: raw.abbreviation,
    location: {
      state: primaryState,
      city: null,
      region: regions.join('; ') || null,
    },
    cms_status: {
      tier: parseTier(raw.tier),
      cycle_year: 2023,
      at_risk: parseAtRisk(raw.tier),
    },
    metrics: {
      donation_rate: null,
      transplantation_rate: null,
      conversion_rate: null,
      donors_recovered: toNum(raw.nhw_donors) !== null || toNum(raw.nhb_donors) !== null
        ? (toNum(raw.nhw_donors) || 0) + (toNum(raw.nhb_donors) || 0) +
          (toNum(raw.h_donors) || 0) + (toNum(raw.a_donors) || 0)
        : null,
      recovery_rate: {
        nhw: toNum(raw.nhw_recovery),
        nhb: toNum(raw.nhb_recovery),
        hispanic: toNum(raw.h_recovery),
        asian: toNum(raw.a_recovery),
      },
      shadow_deaths: toNum(raw.shadows),
      rank: toNum(raw.rank),
      discard_rates: {
        kidney: null,
        liver: null,
        heart: null,
        lung: null,
      },
    },
    financials: {
      revenue: null,
      expenses: null,
      oac_per_organ: null,
      ceo_compensation: toNum(raw.compensation),
    },
    leadership: {
      ceo: raw.ceo || null,
      board_independence_disclosed: raw.board === 'Yes' ? true :
        raw.board === 'No' ? false : null,
    },
    demographics: {
      eligible_deaths: {
        nhw: toNum(raw.nhw_death),
        nhb: toNum(raw.nhb_death),
        hispanic: toNum(raw.h_death),
        asian: toNum(raw.a_death),
      },
      demographic_rank: {
        nhw: toNum(raw.nhw_rank),
        nhb: toNum(raw.nhb_rank),
        hispanic: toNum(raw.h_rank),
        asian: toNum(raw.a_rank),
      },
    },
    states_served: states,
    investigations: {
      house: raw.investigation === 'checked' || false,
      house_url: raw.investigation_url || null,
      senate: raw.investigation_senate === 'checked' || false,
      senate_url: raw.investigation_senate_url || null,
    },
    relationships: {
      transplant_centers: [],
    },
    controversies: [],
    news_feed: [],
  };
}

async function scrape() {
  logger.info(SOURCE, 'Fetching opodata.org index page-data...');
  const indexData = await fetchJson(indexPageData);
  const hashes = indexData.staticQueryHashes || [];
  logger.info(SOURCE, `Found ${hashes.length} static query hashes`);

  logger.info(SOURCE, 'Probing for OPO data...');
  const result = await findOpoDataHash(hashes);
  if (!result) {
    throw new Error('Could not find OPO data in any static query hash');
  }

  logger.info(SOURCE, `Found OPO data in hash ${result.hash}`);
  const opoNodes = result.data.opoData.nodes;
  logger.info(SOURCE, `Raw OPOs: ${opoNodes.length}`);

  const opos = opoNodes.map(transformOpo);
  opos.sort((a, b) => a.dsa_code.localeCompare(b.dsa_code));

  const output = {
    metadata: {
      source: 'opodata.org',
      fetched_at: new Date().toISOString(),
      total_opos: opos.length,
      data_year: 2023,
    },
    opos,
  };

  const outPath = path.join(config.paths.rawData, 'opodata.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  logger.info(SOURCE, `Wrote ${opos.length} OPOs to ${outPath}`);

  const tiers = { 1: 0, 2: 0, 3: 0 };
  for (const opo of opos) {
    const t = opo.cms_status.tier;
    if (t) tiers[t]++;
  }
  logger.info(SOURCE, `Tier breakdown: Tier 1: ${tiers[1]}, Tier 2: ${tiers[2]}, Tier 3: ${tiers[3]}`);

  return output;
}

module.exports = { scrape, generateId };
