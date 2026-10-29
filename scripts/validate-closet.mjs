import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const closetJsonPath = path.join(projectRoot, 'src/data/closet.json');
const publicDir = path.join(projectRoot, 'public');
const srcDir = path.join(projectRoot, 'src');
const functionsDir = path.join(projectRoot, 'functions');

const photoRegex = /\.(jpe?g|png|webp|gif)$/i;
const escapeHatchRegex = /@ts-ignore|@ts-nocheck|eslint-disable/;
const realGasUrlRegex = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/;
const realSecretTokenRegex = /sc_[0-9a-f]{32}/;
const realGoogleOAuthClientSecretRegex = /GOCSPX-[A-Za-z0-9_-]{20,}/;

export const allowedNonexistentPaths = new Set(['public/images/', '/images/<ID>.jpg', '/images/{ID}.jpg']);

export const validGarmentColors = new Set([
  '白',
  '生成り',
  '黒',
  'チャコール',
  'ミディアムグレー',
  'ライトグレー',
  'グレージュ',
  '濃紺',
  'ブルー',
  '淡青',
  'オリーブ',
  'ブラウン',
]);

export function scanDirForPrivatePhotos(dir, errors) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForPrivatePhotos(fullPath, errors);
    } else if (photoRegex.test(entry.name)) {
      const relPath = path.relative(projectRoot, fullPath);
      errors.push(`[Privacy Guard] Forbidden private photo file at ${relPath}. Photos must be stored in private Google Drive ("SmartCloset_Photos"), not committed to the repository.`);
    }
  }
}

export function scanDirForEscapeHatches(dir, errors) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForEscapeHatches(fullPath, errors);
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

export function scanFilesForSecrets(targetPaths, errors) {
  for (const targetPath of targetPaths) {
    if (!fs.existsSync(targetPath)) continue;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        scanFilesForSecrets([path.join(targetPath, entry.name)], errors);
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

export function validateDocLinksAndPaths(docPath, content, projectRootDir) {
  const fileErrors = [];
  const relDoc = path.relative(projectRootDir, docPath);

  // 1. Markdown link verification: [label](target)
  const markdownLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let mdMatch;
  while ((mdMatch = markdownLinkRegex.exec(content)) !== null) {
    let rawTarget = mdMatch[2].trim();

    // Check for forbidden file:/// local absolute links
    if (rawTarget.startsWith('file:///')) {
      fileErrors.push(`[Broken Path Guard] Forbidden local absolute link "${rawTarget}" found in ${relDoc}. Use repository-relative links instead.`);
      continue;
    }

    // Skip web URLs, mailto, and pure anchor links
    if (/^(https?:|\/\/|mailto:|#)/.test(rawTarget)) continue;

    // Strip anchor and query params
    const cleanTarget = rawTarget.split('#')[0].split('?')[0].trim();
    if (!cleanTarget) continue;

    // Skip placeholders like <ID> or {ID}
    if (cleanTarget.includes('<') || cleanTarget.includes('>') || cleanTarget.includes('{') || cleanTarget.includes('*')) continue;
    if (allowedNonexistentPaths.has(cleanTarget)) continue;

    const resolvedPath = path.resolve(path.dirname(docPath), cleanTarget);
    if (!fs.existsSync(resolvedPath)) {
      fileErrors.push(`[Broken Path Guard] Broken markdown link "${rawTarget}" in ${relDoc} (resolved to: ${path.relative(projectRootDir, resolvedPath)})`);
    }
  }

  // 2. Mentioned repository directory/file paths: `src/...`, `docs/...`, etc.
  // Strip markdown link targets so paths inside [label](target) are not double-reported
  const contentForMentionCheck = content.replace(markdownLinkRegex, '[$1]');
  const mentionedPathRegex = /(?:(?:\.\/|\.\.\/)?\b)((?:src|docs|gas|scripts|functions|public|\.agents)\/[A-Za-z0-9_./-]+)/g;
  let pathMatch;
  while ((pathMatch = mentionedPathRegex.exec(contentForMentionCheck)) !== null) {
    let rawPath = pathMatch[1].replace(/[,\.:)\]"'`]+$/, '');
    if (rawPath.includes('<') || rawPath.includes('>') || rawPath.includes('{') || rawPath.includes('*')) continue;
    if (allowedNonexistentPaths.has(rawPath)) continue;

    let targetPath = path.resolve(path.dirname(docPath), rawPath);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.resolve(projectRootDir, rawPath);
    }

    if (!fs.existsSync(targetPath)) {
      fileErrors.push(`[Broken Path Guard] Non-existent path reference "${rawPath}" found in ${relDoc}.`);
    }
  }

  return fileErrors;
}

export function runValidation() {
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

    if (item.imageUrl && typeof item.imageUrl !== 'string') {
      errors.push(`[${item.id}] imageUrl must be a string path`);
    }

    if (!item.color) {
      errors.push(`[${item.id}] Missing required color`);
    } else if (!validGarmentColors.has(item.color)) {
      errors.push(`[${item.id}] Invalid color "${item.color}". Must be one of: ${Array.from(validGarmentColors).join(', ')}`);
    }

    if (item.measurements !== undefined) {
      if (typeof item.measurements !== 'object' || item.measurements === null) {
        errors.push(`[${item.id}] measurements must be an object if present`);
      } else {
        for (const [key, val] of Object.entries(item.measurements)) {
          if (typeof val !== 'number' || val < 10 || val > 200 || !Number.isFinite(val)) {
            errors.push(`[${item.id}] measurements.${key} must be a number between 10 and 200 (got ${val})`);
          }
        }
      }
    }

    if (item.archived !== undefined && typeof item.archived !== 'boolean') {
      errors.push(`[${item.id}] archived must be a boolean if present`);
    }
  }

  // Check private photos in public/
  scanDirForPrivatePhotos(publicDir, errors);

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

    const recommendSet = new Set([...(item.officeRecommendIds || []), ...(item.remoteRecommendIds || [])]);
    for (const ngId of (item.ngIds || [])) {
      if (recommendSet.has(ngId)) {
        errors.push(`[${item.id}] Conflict: ID ${ngId} appears in both recommendation and ngIds!`);
      }
    }
  }

  // 3. Check for escape hatches in src/ and functions/
  if (fs.existsSync(srcDir)) scanDirForEscapeHatches(srcDir, errors);
  if (fs.existsSync(functionsDir)) scanDirForEscapeHatches(functionsDir, errors);

  // 4. Secret Guard
  scanFilesForSecrets([
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'functions'),
    path.join(projectRoot, 'docs'),
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'AGENTS.md'),
  ], errors);

  // 5. Broken Path Guard
  const docFilesToVerify = [
    path.join(projectRoot, 'AGENTS.md'),
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'docs/OPERATIONS.md'),
    path.join(projectRoot, 'docs/SPECIFICATION.md'),
    path.join(projectRoot, 'docs/STYLING_RULES.md'),
    path.join(projectRoot, '.agents/skills/manage-wardrobe/SKILL.md'),
  ];

  for (const docPath of docFilesToVerify) {
    if (!fs.existsSync(docPath)) continue;
    const content = fs.readFileSync(docPath, 'utf-8');
    const pathErrors = validateDocLinksAndPaths(docPath, content, projectRoot);
    errors.push(...pathErrors);
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
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  runValidation();
}
