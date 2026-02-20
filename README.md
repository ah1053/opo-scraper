# OPO Scraper

Multi-source scraper for US Organ Procurement Organizations (OPOs). Aggregates data from 5 public sources into a unified dataset of all 57 OPOs.

## Data Sources

| Source | Data | Coverage |
|--------|------|----------|
| [opodata.org](https://www.opodata.org) | Base OPO directory, tiers, demographics, leadership | 57/57 |
| [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits) | Form 990 financials (revenue, expenses, CEO compensation) | ~47/57 |
| [HRSA Data Downloads](https://data.hrsa.gov) | City, address, phone, transplant center affiliations | 57/57 |
| [SRTR OPO Reports](https://www.srtr.org) | Organ utilization, discard rates, O/E ratios | 55/57 |
| [CMS QCOR](https://qcor.cms.gov) | Official tier classifications, historical tiers, donation/transplant rates | 56/57 |

## Quick Start

```bash
npm install
node src/index.js
```

Output: `data/normalized/opos.json` (merged) + `data/normalized/metadata.json`

## CLI Usage

```bash
# Run all scrapers + normalize
node src/index.js

# Run specific scraper
node src/index.js --source=opodata
node src/index.js --source=propublica
node src/index.js --source=hrsa
node src/index.js --source=srtr
node src/index.js --source=cms-qcor

# Skip a source
node src/index.js --skip-propublica

# Only normalize (from existing raw data)
node src/index.js --normalize-only
```

## Output Schema

Each OPO in `data/normalized/opos.json` includes:

- `opo_id` - Deterministic UUID (stable across runs)
- `name`, `dsa_code` - Identity
- `location` - City, state, address, phone (HRSA)
- `cms_status` - Tier, cycle year, at-risk flag
- `metrics` - Recovery rates, discard rates, O/E ratios, OTPD (SRTR)
- `financials` - Revenue, expenses, assets, CEO compensation (ProPublica)
- `leadership` - CEO, board independence
- `demographics` - Eligible deaths, recovery rates by race
- `relationships` - Affiliated transplant centers (HRSA)
- `ein` - IRS Employer Identification Number

## Docker

```bash
docker build -t opo-scraper .
docker run opo-scraper
```

## Automation

GitHub Actions workflow runs weekly (Monday 6AM UTC) and on push to main. See `.github/workflows/scrape.yml`.
