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
  if (!/^[A-Za-z0-9_-]+$/.test(item.id)) {
    errors.push(`[${item.id}] Invalid ID format. Must contain only alphanumeric characters, dashes, or underscores.`);
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

  // Validate imageUrl if present (photos are hosted on private Google Drive; imageUrl serves as legacy fallback path)
  if (item.imageUrl && typeof item.imageUrl !== 'string') {
    errors.push(`[${item.id}] imageUrl must be a string path`);
  }
}

// Check that no private photo files are committed anywhere under public/
const photoRegex = /\.(jpe?g|png|webp|gif)$/i;

function scanDirForPrivatePhotos(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForPrivatePhotos(fullPath);
    } else if (photoRegex.test(entry.name)) {
      const relPath = path.relative(projectRoot, fullPath);
      errors.push(`[Privacy Guard] Forbidden private photo file at ${relPath}. Photos must be stored in private Google Drive ("SmartCloset_Photos"), not committed to the repository.`);
    }
  }
}

scanDirForPrivatePhotos(publicDir);

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

// 3. Check for escape hatches in src/ and functions/
const srcDir = path.join(projectRoot, 'src');
const functionsDir = path.join(projectRoot, 'functions');
const escapeHatchRegex = /@ts-ignore|@ts-nocheck|eslint-disable/;

function scanDirForEscapeHatches(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForEscapeHatches(fullPath);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (escapeHatchRegex.test(line)) {
          const relPath = path.relative(projectRoot, fullPath);
          errors.push(`[Escape Hatch] Forbidden comment at ${relPath}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
}

if (fs.existsSync(srcDir)) {
  scanDirForEscapeHatches(srcDir);
}
if (fs.existsSync(functionsDir)) {
  scanDirForEscapeHatches(functionsDir);
}

// 4. Secret Guard: Check that no actual secrets are committed in source code or docs
// Allowed placeholders: __SMART_CLOSET_SECRET_TOKEN__, https://script.google.com/macros/s/.../exec
const realGasUrlRegex = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/;
const realSecretTokenRegex = /sc_[0-9a-f]{32}/;
const realGoogleOAuthClientSecretRegex = /GOCSPX-[A-Za-z0-9_-]{20,}/;

function scanFilesForSecrets(targetPaths) {
  for (const targetPath of targetPaths) {
    if (!fs.existsSync(targetPath)) continue;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        scanFilesForSecrets([path.join(targetPath, entry.name)]);
      }
    } else if (/\.(ts|tsx|js|jsx|mjs|json|md|html|yml|yaml)$/.test(targetPath)) {
      const content = fs.readFileSync(targetPath, 'utf-8');
      const relPath = path.relative(projectRoot, targetPath);

      if (realGasUrlRegex.test(content)) {
        errors.push(`[Secret Guard] Forbidden hardcoded real GAS URL found in ${relPath}. Secrets must be stored in Cloudflare Pages Secret or meta_config, not committed to repository.`);
      }
      if (realSecretTokenRegex.test(content)) {
        errors.push(`[Secret Guard] Forbidden real secret token (sc_...) found in ${relPath}. Tokens must be stored in Cloudflare Pages Secret or meta_config, not committed to repository.`);
      }
      if (realGoogleOAuthClientSecretRegex.test(content)) {
        errors.push(`[Secret Guard] Forbidden Google OAuth Client Secret (GOCSPX-...) found in ${relPath}. OAuth credentials must never be committed to repository.`);
      }
    }
  }
}

scanFilesForSecrets([
  path.join(projectRoot, 'src'),
  path.join(projectRoot, 'functions'),
  path.join(projectRoot, 'docs'),
  path.join(projectRoot, 'README.md'),
  path.join(projectRoot, 'AGENTS.md'),
]);

// 5. Broken Path Guard: Verify that file/directory paths referenced in documentation actually exist
const docFilesToVerify = [
  path.join(projectRoot, 'AGENTS.md'),
  path.join(projectRoot, 'README.md'),
  path.join(projectRoot, 'docs/OPERATIONS.md'),
  path.join(projectRoot, 'docs/SPECIFICATION.md'),
  path.join(projectRoot, 'docs/STYLING_RULES.md'),
  path.join(projectRoot, '.agents/skills/manage-wardrobe/SKILL.md'),
];

// Paths explicitly abolished or mentioned as forbidden in docs
const allowedNonexistentPaths = new Set(['public/images/']);

const docPathRegex = /(?:file:\/\/\/[^\s)]*?smart-closet\/|(?:\.\/|\.\.\/)?\b)((?:src|docs|gas|scripts|functions|public|\.agents)\/[A-Za-z0-9_./-]+)/g;

for (const docPath of docFilesToVerify) {
  if (!fs.existsSync(docPath)) continue;
  const content = fs.readFileSync(docPath, 'utf-8');
  let match;
  while ((match = docPathRegex.exec(content)) !== null) {
    let rawPath = match[1];
    rawPath = rawPath.replace(/[,\.:)\]"'`]+$/, '');
    if (rawPath.includes('<') || rawPath.includes('>') || rawPath.includes('{') || rawPath.includes('*')) continue;
    if (allowedNonexistentPaths.has(rawPath)) continue;

    let targetPath = path.resolve(path.dirname(docPath), rawPath);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.resolve(projectRoot, rawPath);
    }

    if (!fs.existsSync(targetPath)) {
      const relDoc = path.relative(projectRoot, docPath);
      errors.push(`[Broken Path Guard] Non-existent path reference "${rawPath}" found in ${relDoc}.`);
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

console.log(`✅ closet.json and source code are valid! Verified ${data.items.length} items (${shirtIds.size} shirts, ${pantsIds.size} pants) and clean source code.`);

