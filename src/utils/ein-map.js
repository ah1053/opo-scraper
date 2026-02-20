// Static mapping of DSA codes to EINs (Employer Identification Numbers)
// for ProPublica Nonprofit Explorer API lookups.
//
// These are 501(c)(3) organizations. EINs were obtained by searching
// ProPublica's API for each OPO name and manually verified.
//
// Notes:
// - Some OPOs are hospital-based and don't file separate 990s (marked null)
// - FLWC, GALL, PRLL all operate under LifeLink Foundation (EIN 592193032)
// - CAGS (Sierra Donor Services) merged into CADN (Donor Network West)

const EIN_MAP = {
  ALOB: null,       // Legacy of Hope - hospital-based at UAB, no separate 990
  AROR: null,       // Arkansas Regional Organ Recovery Agency - hospital-based
  AZOB: 860707697,  // Donor Network of Arizona
  CADN: 943062436,  // Donor Network West
  CAGS: 943062436,  // Sierra Donor Services (merged into Donor Network West)
  CAOP: 953138799,  // OneLegacy
  CASD: 30370105,   // LifeSharing (San Diego)
  CORS: 841003771,  // Donor Alliance
  DCTC: 521528461,  // Washington Regional Transplant Community
  FLFH: null,       // OurLegacy (Orlando) - not in ProPublica
  FLMP: null,       // Life Alliance Organ Recovery Agency - hospital-based at U of Miami
  FLUF: null,       // LifeQuest Organ Recovery Services - hospital-based at UF/Shands
  FLWC: 592193032,  // LifeLink of Florida (LifeLink Foundation)
  GALL: 592193032,  // LifeLink of Georgia (LifeLink Foundation)
  HIOP: 710656542,  // Legacy of Life (Hawaii)
  IAOP: 421414092,  // Iowa Donor Network
  ILIP: 363516431,  // Gift of Hope Organ & Tissue Donor Network
  INOP: 351746358,  // Indiana Donor Network (Indiana Organ Procurement Organization)
  KYDA: null,       // Kentucky Organ Donor Affiliates - not in ProPublica
  LAOP: 721110932,  // Louisiana Organ Procurement Agency
  MAOB: 813650975,  // New England Donor Services
  MDPC: 521736533,  // Living Legacy Foundation of Maryland (now Infinite Legacy)
  MIOP: 382772488,  // Gift of Life Michigan (Organ Procurement Agency of Michigan)
  MNOP: 363584029,  // LifeSource Upper Midwest
  MOMA: 237426306,  // Mid-America Transplant Services
  MSOP: 582032232,  // Mississippi Organ Recovery Agency
  MWOB: 431016328,  // Midwest Transplant Network
  NCCM: null,       // LifeShare Carolinas - not found separately in ProPublica
  NCNC: 581627444,  // HonorBridge (formerly Carolina Donor Services)
  NEOR: 470597541,  // Live On Nebraska (Nebraska Organ Recovery System)
  NJTO: 222490603,  // New Jersey Sharing Network
  NMOP: null,       // New Mexico Donor Services - not in ProPublica
  NVLV: 880253675,  // Nevada Donor Network
  NYAP: 141820447,  // Center for Donation and Transplant
  NYFL: 161172453,  // Finger Lakes Donor Recovery (Upstate NY Transplant Services)
  NYRT: 132945229,  // LiveOnNY
  NYWN: 822829407,  // ConnectLife
  OHLB: 341525159,  // LifeBanc
  OHLC: 311285637,  // Life Connection of Ohio
  OHLP: 311116603,  // LifeLine of Ohio
  OHOV: 311040508,  // LifeCenter Organ Donor Network
  OKOP: 731281589,  // Lifeshare of Oklahoma
  ORUO: null,       // Pacific NW Transplant Bank - not in ProPublica
  PADV: 237388767,  // Gift of Life Donor Program (Philadelphia)
  PATF: 251332885,  // Center for Organ Recovery and Education
  PRLL: 592193032,  // LifeLink of Puerto Rico (LifeLink Foundation)
  SCOP: 570875658,  // We Are Sharing Hope SC
  TNDS: 581990866,  // Tennessee Donor Services (DCI Donor Services)
  TNMS: 620992075,  // Mid-South Transplant Foundation
  TXGC: 760231238,  // LifeGift
  TXSA: 741849716,  // Texas Organ Sharing Alliance
  TXSB: 751469319,  // Southwest Transplant Alliance
  UTOP: 870447660,  // DonorConnect
  VATB: 521273592,  // LifeNet
  WALC: 943253342,  // LifeCenter Northwest
  WIDN: 390807235,  // Versiti Blood Center of Wisconsin
  WIUW: null,       // UW Organ and Tissue Donation - hospital-based under UW Hospitals
};

module.exports = EIN_MAP;
