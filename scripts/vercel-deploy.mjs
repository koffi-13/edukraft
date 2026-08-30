// Déploiement EduKraft web sur Vercel via l'API REST (token limité non accepté par le CLI)
// Usage : node scripts/vercel-deploy.mjs <dossier-export> <nom-projet> <token>
//
// NOTE DIGEST (v1.1.3) : l'API Vercel exige l'en-tête x-vercel-digest = SHA-1 hex
// du contenu du fichier (formats "sha256-<hex>" et "<sha256-hex>" refusés — testé).
// Le vercel.json du repo est inclus dans l'upload pour que les rewrites SPA
// et les headers de cache s'appliquent au déploiement.
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const [, , DIST_DIR, PROJECT_NAME, TOKEN] = process.argv;
if (!DIST_DIR || !PROJECT_NAME || !TOKEN) {
  console.error('Usage: node scripts/vercel-deploy.mjs <dossier> <nom-projet> <token>');
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

// 1bis. Inclure vercel.json (repo root) dans le jeu de fichiers uploadés
//       → rewrites SPA + headers de cache appliqués à CE déploiement.
const vercelJsonPath = join(process.cwd(), 'vercel.json');
if (existsSync(vercelJsonPath)) files.push('vercel.json');

// 2. Créer le projet (idempotent)
let projRes = await api('POST', '/v9/projects', JSON.stringify({
  name: PROJECT_NAME,
  framework: null,
}), { 'Content-Type': 'application/json' });
if (projRes.status === 200 || projRes.status === 201) {
  console.log(`Projet OK (créé/récupéré) : ${projRes.data?.name}`);
} else if (projRes.status === 409) {
  console.log('Projet déjà existant — OK');
} else if (projRes.status === 403) {
  console.error('\n[403] Le token n\'a PAS le scope de création de projet.');
  console.error('    → Créez le projet dans le dashboard Vercel (Add New → Project),');
  console.error('      ou générez un token avec le scope « Deployment ».');
  process.exit(1);
} else {
  console.error('Erreur projet :', projRes.status, JSON.stringify(projRes.data).slice(0, 300));
  process.exit(1);
}

// 3. Uploader chaque fichier (POST /v2/files, contenu brut + digest SHA-1 hex)
const fileRefs = [];
for (const f of files) {
  const isVercelJson = f === 'vercel.json';
  const content = isVercelJson
    ? readFileSync(vercelJsonPath)
    : readFileSync(join(DIST_DIR, f));
  const sha1 = createHash('sha1').update(content).digest('hex');
  const size = content.length;
  const up = await api('POST', '/v2/files', content, {
    'Content-Type': 'application/octet-stream',
    'x-vercel-daily-rc-deployment-limit': '20',
    'x-vercel-deploy-filename': f,
    'x-vercel-deploy-size': String(size),
    'x-vercel-digest': sha1,
  });
  if (!up.ok && up.status !== 200) {
    if (up.status === 403) {
      console.error(`\n[403] Le token n'a PAS le scope d'upload de fichiers (fichier ${f}).`);
      console.error('    → Générez un token avec le scope « Deployment » (Settings → Tokens).');
    } else {
      console.error(`  Upload ÉCHEC ${f} → ${up.status}: ${JSON.stringify(up.data).slice(0, 200)}`);
    }
    process.exit(1);
  }
  fileRefs.push({ file: f, sha: sha1, size });
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

// 5. Attendre que le déploiement soit prêt (max ~3 min)
const depId = dep.id;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 6000));
  const st = await api('GET', `/v13/deployments/${depId}`);
  const state = st.data?.readyState;
  process.stdout.write(`  [${i * 6 + 6}s] ${state}\n`);
  if (state === 'READY') {
    console.log('\n✓ DÉPLOYÉ EN PRODUCTION :', st.data.url ? `https://${st.data.url}` : dep.url);
    process.exit(0);
  }
  if (state === 'ERROR' || state === 'CANCELED') {
    console.error('\n✗ Déploiement échoué :', JSON.stringify(st.data).slice(0, 400));
    process.exit(1);
  }
}
console.log('\n(Toujours en cours — vérifiez', dep.inspectorUrl, ')');
