// Déploiement EduKraft web sur Vercel via l'API REST (token limité non accepté par le CLI)
// Usage : node vercel-deploy.mjs <dossier-export> <nom-projet> <token>
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const [, , DIST_DIR, PROJECT_NAME, TOKEN] = process.argv;
if (!DIST_DIR || !PROJECT_NAME || !TOKEN) {
  console.error('Usage: node vercel-deploy.mjs <dossier> <nom-projet> <token>');
  process.exit(1);
}

const API = 'https://api.vercel.com';
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...HEADERS, ...extraHeaders },
    body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

// 1. Lister récursivement les fichiers
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

const files = walk(DIST_DIR);
console.log(`Fichiers à déployer : ${files.length}`);

// 2. Créer le projet (idempotent)
let projRes = await api('POST', '/v9/projects', JSON.stringify({
  name: PROJECT_NAME,
  framework: null,
}), { 'Content-Type': 'application/json' });
if (projRes.status === 200 || projRes.status === 201) {
  console.log(`Projet OK (créé/récupéré) : ${projRes.data?.name}`);
} else if (projRes.status === 409) {
  console.log('Projet déjà existant — OK');
} else {
  console.error('Erreur projet :', projRes.status, JSON.stringify(projRes.data).slice(0, 300));
  process.exit(1);
}

// 3. Uploader chaque fichier (POST /v2/files, contenu brut)
const fileRefs = [];
for (const f of files) {
  const content = readFileSync(join(DIST_DIR, f));
  const sha = createHash('sha1').update(content).digest('hex');
  const size = content.length;
  const up = await api('POST', '/v2/files', content, {
    'Content-Type': 'application/octet-stream',
    'x-vercel-daily-rc-deployment-limit': '20',
    'x-vercel-deploy-filename': f,
    'x-vercel-deploy-size': String(size),
  });
  if (!up.ok && up.status !== 200) {
    // Certains tokens limités renvoient 200 sans corps — on logguer les vraies erreurs
    console.error(`  Upload ÉCHEC ${f} → ${up.status}: ${JSON.stringify(up.data).slice(0, 200)}`);
    process.exit(1);
  }
  fileRefs.push({ file: f, sha, size });
  console.log(`  Upload OK : ${f} (${(size / 1024).toFixed(1)} Ko)`);
}

// 4. Créer le deployment en production
const depRes = await api('POST', '/v13/deployments?skipAutoDetectionConfirmation=1', JSON.stringify({
  name: PROJECT_NAME,
  target: 'production',
  files: fileRefs,
  projectSettings: {
    framework: null,
    buildCommand: null,
    outputDirectory: null,
    installCommand: null,
  },
}), { 'Content-Type': 'application/json' });

if (!depRes.ok) {
  console.error('Deployment ÉCHEC :', depRes.status, JSON.stringify(depRes.data).slice(0, 500));
  process.exit(1);
}

const dep = depRes.data;
console.log('\n=== DÉPLOIEMENT CRÉÉ ===');
console.log('ID      :', dep.id);
console.log('URL     :', dep.url);
console.log('Statut  :', dep.readyState);
console.log('Inspect :', dep.inspectorUrl);
