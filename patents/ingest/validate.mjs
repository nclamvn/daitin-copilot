import {loadDataset,validateDataset} from '../dataset.mjs';
const dataset=loadDataset();
const result=validateDataset(dataset);
console.log(JSON.stringify({...result,builtAt:dataset.builtAt,
  nativeClaims:dataset.records.filter(record=>record.claims&&record.textFidelity==='source_native_xml').length,
  ocrClaimsUnreviewed:dataset.records.filter(record=>record.claims&&record.textFidelity==='ocr_unreviewed').length,
  humanSemanticReview:'pending',legalStatusVerified:false,familyRelationsVerified:false,
  gaps:dataset.gaps.length},null,2));
