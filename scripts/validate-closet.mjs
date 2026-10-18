import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const closetJsonPath = path.join(projectRoot, 'src/data/closet.json');
const publicDir = path.join(projectRoot, 'public');

console.log('🔍 Validating closet.json & assets...');

if (!fs.existsSync(closetJsonPath)) {
  console.error(`❌ Error: ${closetJsonPath} not found.`);
  process.exit(1);
}

let data;
try {
  const raw = fs.readFileSync(closetJsonPath, 'utf-8');
  data = JSON.parse(raw);
} catch (e) {
  console.error('❌ Error parsing closet.json:', e.message);
  process.exit(1);
}

if (!Array.isArray(data.items)) {
  console.error('❌ Error: closet.json must contain an "items" array.');
  process.exit(1);
}

const idSet = new Set();
const shirtIds = new Set();
const pantsIds = new Set();
const errors = [];
const warnings = [];

// 1. Check uniqueness and basic fields
for (const item of data.items) {
  if (!item.id || typeof item.id !== 'string') {
    errors.push(`Item missing string id: ${JSON.stringify(item)}`);
    continue;
  }
  if (idSet.has(item.id)) {
    errors.push(`Duplicate item id: ${item.id}`);
  }
  idSet.add(item.id);

  if (item.category === 'shirt') shirtIds.add(item.id);
  else if (item.category === 'pants') pantsIds.add(item.id);
  else errors.push(`[${item.id}] Invalid category: ${item.category} (must be 'shirt' or 'pants')`);

  if (!item.name) errors.push(`[${item.id}] Missing name`);
  if (typeof item.dressScore !== 'number' || item.dressScore < 1 || item.dressScore > 5) {
    errors.push(`[${item.id}] Invalid dressScore: ${item.dressScore} (must be 1.0 - 5.0)`);
  }
  if (typeof item.comfortScore !== 'number' || item.comfortScore < 1 || item.comfortScore > 5) {
    errors.push(`[${item.id}] Invalid comfortScore: ${item.comfortScore} (must be 1.0 - 5.0)`);
  }

  // Check image file in public
  if (item.imageUrl) {
    const relPath = item.imageUrl.startsWith('/') ? item.imageUrl.slice(1) : item.imageUrl;
    const fullImagePath = path.join(publicDir, relPath);
    if (!fs.existsSync(fullImagePath)) {
      warnings.push(`[${item.id}] Image file not found at ${fullImagePath} (fallback SVG will be used)`);
    }
  } else {
    warnings.push(`[${item.id}] Missing imageUrl`);
  }
}

// 2. Check relationship references
for (const item of data.items) {
  const isShirt = item.category === 'shirt';
  const targetCategoryName = isShirt ? 'pants' : 'shirt';
  const targetIds = isShirt ? pantsIds : shirtIds;

  const checkRefs = (list, fieldName) => {
    if (!Array.isArray(list)) {
      errors.push(`[${item.id}] ${fieldName} must be an array`);
      return;
    }
    for (const refId of list) {
      if (!idSet.has(refId)) {
        errors.push(`[${item.id}] ${fieldName} references non-existent ID: ${refId}`);
      } else if (!targetIds.has(refId)) {
        errors.push(`[${item.id}] ${fieldName} references ${refId} which is not a ${targetCategoryName}`);
      }
    }
  };

  checkRefs(item.officeRecommendIds, 'officeRecommendIds');
  checkRefs(item.remoteRecommendIds, 'remoteRecommendIds');
  checkRefs(item.ngIds, 'ngIds');

  // Check no intersection between recommends and ngIds
  const recommendSet = new Set([...(item.officeRecommendIds || []), ...(item.remoteRecommendIds || [])]);
  for (const ngId of (item.ngIds || [])) {
    if (recommendSet.has(ngId)) {
      errors.push(`[${item.id}] Conflict: ID ${ngId} appears in both recommendation and ngIds!`);
    }
  }
}

if (warnings.length > 0) {
  console.log(`⚠️  ${warnings.length} warning(s):`);
  warnings.forEach(w => console.log('  ' + w));
}

if (errors.length > 0) {
  console.error(`❌ Validation failed with ${errors.length} error(s):`);
  errors.forEach(e => console.error('  ' + e));
  process.exit(1);
}

console.log(`✅ closet.json is valid! Verified ${data.items.length} items (${shirtIds.size} shirts, ${pantsIds.size} pants).`);
