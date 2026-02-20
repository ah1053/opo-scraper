const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  sources: {
    opodata: {
      base: 'https://www.opodata.org',
      indexPageData: 'https://www.opodata.org/page-data/index/page-data.json',
      userAgent: 'opo-scraper/1.0',
      timeout: 30000,
    },
    propublica: {
      base: 'https://projects.propublica.org/nonprofits/api/v2',
      searchBase: 'https://projects.propublica.org/nonprofits/api/v2/search.json',
      delay: 500,
      timeout: 30000,
    },
    hrsa: {
      url: 'https://data.hrsa.gov/data/download/optn/OPTN-OPO.xlsx',
      timeout: 60000,
    },
    srtr: {
      base: 'https://www.srtr.org',
      opoReportUrl: (code) => `https://www.srtr.org/opo-reports/${code.toLowerCase()}/`,
      timeout: 60000,
    },
    cmsQcor: {
      base: 'https://qcor.cms.gov',
      timeout: 60000,
    },
  },
  paths: {
    root: ROOT,
    rawData: path.join(ROOT, 'data', 'raw'),
    normalizedData: path.join(ROOT, 'data', 'normalized'),
  },
};
