const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

const SOURCE = 'normalize';

function loadRawData(source) {
  const filePath = path.join(config.paths.rawData, `${source}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function buildIndex(opos) {
  const index = {};
  for (const opo of opos) {
    index[opo.dsa_code] = opo;
  }
  return index;
}

function mergeFinancials(opo, propublicaEntry) {
  if (!propublicaEntry) return opo.financials;
  return {
    revenue: propublicaEntry.revenue ?? opo.financials.revenue,
    expenses: propublicaEntry.expenses ?? opo.financials.expenses,
    oac_per_organ: propublicaEntry.oac_per_organ ?? opo.financials.oac_per_organ,
    ceo_compensation: propublicaEntry.ceo_compensation ?? opo.financials.ceo_compensation,
    assets: propublicaEntry.assets ?? null,
    tax_year: propublicaEntry.tax_year ?? null,
  };
}

function mergeLocation(opo, hrsaEntry) {
  if (!hrsaEntry) return opo.location;
  return {
    state: opo.location.state,
    city: hrsaEntry.city ?? opo.location.city,
    address: hrsaEntry.address ?? null,
    phone: hrsaEntry.phone ?? null,
    region: opo.location.region,
  };
}

function mergeMetrics(opo, srtrEntry) {
  if (!srtrEntry) return opo.metrics;
  return {
    ...opo.metrics,
    conversion_rate: srtrEntry.conversion_rate ?? opo.metrics.conversion_rate,
    donation_rate: srtrEntry.donation_rate ?? opo.metrics.donation_rate,
    transplantation_rate: srtrEntry.transplantation_rate ?? opo.metrics.transplantation_rate,
    organs_transplanted_per_donor: srtrEntry.organs_transplanted_per_donor ?? null,
    observed_expected_ratio: srtrEntry.observed_expected_ratio ?? null,
    observed_expected_by_organ: srtrEntry.observed_expected_by_organ ?? null,
    total_donors_srtr: srtrEntry.total_donors ?? null,
    discard_rates: {
      kidney: srtrEntry.discard_rates?.kidney ?? opo.metrics.discard_rates.kidney,
      liver: srtrEntry.discard_rates?.liver ?? opo.metrics.discard_rates.liver,
      heart: srtrEntry.discard_rates?.heart ?? opo.metrics.discard_rates.heart,
      lung: srtrEntry.discard_rates?.lung ?? opo.metrics.discard_rates.lung,
    },
  };
}

function mergeTransplantCenters(opo, hrsaEntry) {
  if (!hrsaEntry?.transplant_centers?.length) return opo.relationships.transplant_centers;
  return hrsaEntry.transplant_centers;
}

async function run() {
  // Load base data (opodata.org)
  const opodataRaw = loadRawData('opodata');
  if (!opodataRaw) {
    throw new Error('No opodata.json found. Run opodata scraper first.');
  }

  const opos = opodataRaw.opos;
  logger.info(SOURCE, `Base: ${opos.length} OPOs from opodata.org`);

  // Load enrichment sources
  const propublicaRaw = loadRawData('propublica');
  const hrsaRaw = loadRawData('hrsa');
  const srtrRaw = loadRawData('srtr');
  const cmsRaw = loadRawData('cms-qcor');

  const propublicaIndex = propublicaRaw ? buildIndex(propublicaRaw.opos) : {};
  const hrsaIndex = hrsaRaw ? buildIndex(hrsaRaw.opos) : {};
  const srtrIndex = srtrRaw ? buildIndex(srtrRaw.opos) : {};
  const cmsIndex = cmsRaw ? buildIndex(cmsRaw.opos) : {};

  // Track coverage stats
  const coverage = {
    opodata: 0,
    propublica: 0,
    hrsa: 0,
    srtr: 0,
    'cms-qcor': 0,
  };

  const merged = opos.map(opo => {
    const dsa = opo.dsa_code;
    coverage.opodata++;

    const propublica = propublicaIndex[dsa];
    const hrsa = hrsaIndex[dsa];
    const srtr = srtrIndex[dsa];
    const cms = cmsIndex[dsa];

    if (propublica) coverage.propublica++;
    if (hrsa) coverage.hrsa++;
    if (srtr) coverage.srtr++;
    if (cms) coverage['cms-qcor']++;

    return {
      ...opo,
      location: mergeLocation(opo, hrsa),
      financials: mergeFinancials(opo, propublica),
      metrics: mergeMetrics(opo, srtr),
      relationships: {
        ...opo.relationships,
        transplant_centers: mergeTransplantCenters(opo, hrsa),
      },
      ein: propublica?.ein ?? null,
    };
  });

  merged.sort((a, b) => a.dsa_code.localeCompare(b.dsa_code));

  // Write normalized output
  const outDir = config.paths.normalizedData;
  fs.mkdirSync(outDir, { recursive: true });

  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      total_opos: merged.length,
      sources: {
        opodata: { count: coverage.opodata, pct: '100%' },
        propublica: { count: coverage.propublica, pct: `${Math.round((coverage.propublica / merged.length) * 100)}%` },
        hrsa: { count: coverage.hrsa, pct: `${Math.round((coverage.hrsa / merged.length) * 100)}%` },
        srtr: { count: coverage.srtr, pct: `${Math.round((coverage.srtr / merged.length) * 100)}%` },
        'cms-qcor': { count: coverage['cms-qcor'], pct: `${Math.round((coverage['cms-qcor'] / merged.length) * 100)}%` },
      },
    },
    opos: merged,
  };

  fs.writeFileSync(path.join(outDir, 'opos.json'), JSON.stringify(output, null, 2));

  // Write metadata separately for quick reference
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(output.metadata, null, 2));

  logger.info(SOURCE, `Wrote ${merged.length} normalized OPOs`);
  logger.info(SOURCE, `Coverage: opodata=${coverage.opodata}, propublica=${coverage.propublica}, hrsa=${coverage.hrsa}, srtr=${coverage.srtr}, cms-qcor=${coverage['cms-qcor']}`);

  return output;
}

module.exports = { run };
