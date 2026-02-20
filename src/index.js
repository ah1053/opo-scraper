const logger = require('./utils/logger');

const SCRAPERS = {
  opodata: () => require('./scrapers/opodata'),
  propublica: () => require('./scrapers/propublica'),
  hrsa: () => require('./scrapers/hrsa'),
  srtr: () => require('./scrapers/srtr'),
  'cms-qcor': () => require('./scrapers/cms-qcor'),
};

function parseArgs(argv) {
  const args = {
    sources: [],
    skip: [],
    normalizeOnly: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--normalize-only') {
      args.normalizeOnly = true;
    } else if (arg.startsWith('--source=')) {
      args.sources.push(arg.split('=')[1]);
    } else if (arg.startsWith('--skip-')) {
      args.skip.push(arg.replace('--skip-', ''));
    }
  }

  if (args.sources.length === 0 && !args.normalizeOnly) {
    // Default: run opodata, propublica, hrsa (non-stretch sources)
    args.sources = ['opodata', 'propublica', 'hrsa'];
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const startTime = Date.now();

  logger.info('main', `OPO Scraper starting`);

  if (!args.normalizeOnly) {
    const sourcesToRun = args.sources.filter(s => !args.skip.includes(s));
    logger.info('main', `Sources: ${sourcesToRun.join(', ')}`);

    for (const source of sourcesToRun) {
      const loader = SCRAPERS[source];
      if (!loader) {
        logger.error('main', `Unknown source: ${source}`);
        continue;
      }

      try {
        logger.info('main', `--- Running ${source} scraper ---`);
        const scraper = loader();
        await scraper.scrape();
        logger.info('main', `--- ${source} complete ---`);
      } catch (err) {
        logger.error('main', `${source} scraper failed`, err);
      }
    }
  }

  // Run normalization
  try {
    logger.info('main', '--- Running normalization ---');
    const normalize = require('./utils/normalize');
    await normalize.run();
    logger.info('main', '--- Normalization complete ---');
  } catch (err) {
    logger.error('main', 'Normalization failed', err);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('main', `Done in ${elapsed}s`);
}

main().catch(err => {
  logger.error('main', 'Fatal error', err);
  process.exit(1);
});
