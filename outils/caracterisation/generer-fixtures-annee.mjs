import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FIXTURES DE CARACTÉRISATION — année scolaire et semaines (Phase 2).
 *
 *   node outils/caracterisation/generer-fixtures-annee.mjs <fichier-semaines.txt>
 *
 * Ces règles sont en JavaScript dans le navigateur (public/emploi.html), pas en
 * PHP : le générateur est donc en Node. Les fonctions ci-dessous sont des
 * COPIES CONFORMES — ne pas les corriger, l'objectif est de figer ce que fait
 * le code en production.
 *
 * Le plan (§2) relève trois représentations concurrentes de l'année scolaire :
 * INT en base, VARCHAR « 2025-2026 » ailleurs, et filtrage sur `date_upload`.
 * Il en existe une quatrième, moins visible : la RÈGLE elle-même diffère entre
 * le PHP et le JavaScript. C'est ce que ce fichier met en évidence.
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const sortie = path.join(ici, '../../shared/src/domain/planning/__fixtures__');
fs.mkdirSync(sortie, { recursive: true });

// ─── Copies conformes de public/emploi.html ─────────────────────────────────

/** ← emploi.html, getSchoolYear() */
function getSchoolYear(date) {
  const annee = date.getFullYear();
  const sep1 = new Date(annee, 8, 1);
  const ancre = new Date(sep1);
  ancre.setDate(sep1.getDate() - ((sep1.getDay() + 6) % 7));
  ancre.setHours(0, 0, 0, 0);

  const jour = new Date(date);
  jour.setHours(0, 0, 0, 0);
  return jour >= ancre ? annee : annee - 1;
}

/** ← emploi.html, getWeekInfo() — numéro de semaine seulement */
function getWeekNumber(date) {
  const schoolYear = getSchoolYear(date);

  const firstDayOfSeptember = new Date(schoolYear, 8, 1);
  const firstMonday = new Date(firstDayOfSeptember);
  firstMonday.setDate(firstDayOfSeptember.getDate() - ((firstDayOfSeptember.getDay() + 6) % 7));

  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);
  firstMonday.setHours(0, 0, 0, 0);

  let weekNumber = 1;
  if (startOfWeek >= firstMonday) {
    const timeDiff = startOfWeek.getTime() - firstMonday.getTime();
    weekNumber = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 7)) + 1;
  }
  return { schoolYear, weekNumber, lundi: iso(startOfWeek) };
}

/** ← emploi.html, parseWeekValue() */
function parseWeekValue(weekValue) {
  const [year, week] = weekValue.split('-W');
  if (!year || !week) return null;

  const schoolYear = parseInt(year, 10);
  const weekNumber = parseInt(week, 10);

  const firstDayOfSeptember = new Date(schoolYear, 8, 1);
  const firstMonday = new Date(firstDayOfSeptember);
  firstMonday.setDate(firstDayOfSeptember.getDate() - ((firstDayOfSeptember.getDay() + 6) % 7));

  const startOfWeek = new Date(firstMonday);
  startOfWeek.setDate(firstMonday.getDate() + (weekNumber - 1) * 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  return { schoolYear, weekNumber, debut: iso(startOfWeek), fin: iso(endOfWeek) };
}

/** ← la règle PHP, telle qu'écrite dans schema_annee_scolaire.sql et morocco_holidays.php */
function anneeScolairePhp(date) {
  const mois = date.getMonth() + 1;
  return mois >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

function iso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// ─── 1. Balayage de dates : où les deux règles divergent-elles ? ────────────

const dates = [];
const curseur = new Date(2024, 7, 1); // 1er août 2024
const fin = new Date(2027, 9, 1); // 1er octobre 2027

while (curseur < fin) {
  const date = new Date(curseur);
  dates.push({
    date: iso(date),
    js: getSchoolYear(date),
    php: anneeScolairePhp(date),
    ...getWeekNumber(date),
  });
  curseur.setDate(curseur.getDate() + 1);
}

const divergences = dates.filter((d) => d.js !== d.php);

// ─── 2. Semaines réellement enregistrées en production ──────────────────────

const fichierSemaines = process.argv[2];
const semaines = fichierSemaines
  ? fs
      .readFileSync(fichierSemaines, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d{4}-W\d+$/.test(l))
  : [];

const semainesResolues = semaines.map((valeur) => ({ valeur, ...parseWeekValue(valeur) }));

// ─── 3. Écriture ────────────────────────────────────────────────────────────

fs.writeFileSync(
  path.join(sortie, 'annee-scolaire.json'),
  JSON.stringify(
    {
      genereLe: new Date().toISOString(),
      source: 'public/emploi.html (getSchoolYear, getWeekInfo, parseWeekValue)',
      totalDates: dates.length,
      totalDivergences: divergences.length,
      dates,
      divergences,
      semaines: semainesResolues,
    },
    null,
    2
  )
);

console.log(`dates balayées        : ${dates.length}`);
console.log(`divergences JS vs PHP : ${divergences.length}`);
for (const d of divergences.slice(0, 12)) {
  console.log(`   ${d.date}  JS=${d.js}  PHP=${d.php}  (S${d.weekNumber})`);
}
console.log(`semaines de production: ${semainesResolues.length}`);
