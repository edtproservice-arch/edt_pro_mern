/**
 * ═══ DÉTECTEUR DE RÉFÉRENCES LIBRES DANS LE JS INLINE ═══
 *
 * Une « référence libre » est une variable LUE mais jamais déclarée. Elle ne
 * lève `X is not defined` qu'à l'instant où la ligne s'exécute : aucun build,
 * aucun `vite build`, aucune relecture rapide ne la voit. C'est la famille de
 * défauts qui a coûté le plus cher à ce projet — `AXES`, `memo`, `jour`,
 * `subGroups` (qui cassait l'import d'une semaine), `isSlotValidForSingle`.
 *
 * Les pages PHP portent leur métier en JS INLINE (`emploi.html` : ~19 000
 * lignes), sans lint ni bundler : c'est le seul contrôle qui attrape ces
 * défauts avant l'utilisateur.
 *
 *   node outils/references-libres.mjs ../gestion_edt/public/emploi.html
 *   node outils/references-libres.mjs ../gestion_edt/public/*.html
 *
 * Sortie : 0 si rien de dangereux, 1 sinon (utilisable en CI).
 *
 * ⚠️ IL QUALIFIE, IL NE SE CONTENTE PAS DE LISTER. Un détecteur qui crie au
 * loup sur cinq faux positifs ne sert plus à rien au bout de deux passages.
 * Trois cas sont INOFFENSIFS et reconnus comme tels :
 *   · un `id` HTML — le navigateur l'expose sur `window` (`id="monBouton"`
 *     rend `monBouton` lisible en JS) ;
 *   · une lecture protégée par `typeof x === '...'`, qui est la façon correcte
 *     de tester une dépendance optionnelle ;
 *   · une variable ASSIGNÉE sans `let`/`const` — globale implicite, valide
 *     hors mode strict. Fragile, pas cassée : signalée à part.
 * Ne reste DANGEREUX que ce qui est lu sans jamais être ni déclaré, ni
 * assigné, ni protégé.
 *
 * ⚠️ ET IL DIT SI LA FONCTION PORTEUSE EST APPELÉE. C'est ce qui départage une
 * bombe d'un vestige : `subGroups` plantait à chaque import, `isSlotValidForSingle`
 * dormait dans une fonction que personne n'appelait. Le correctif n'est pas le
 * même — écrire la variable manquante d'un côté, supprimer le code mort de
 * l'autre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GLOBALES_FOURNIES as FOURNIS } from './globales-fournies.mjs';

let parse;
let traverse;
try {
  ({ parse } = await import('@babel/parser'));
  const module = await import('@babel/traverse');
  traverse = module.default?.default ?? module.default ?? module;
} catch {
  console.error(
    'Il manque @babel/parser ou @babel/traverse.\n' +
      'Lancez « npm install » à la racine du monorepo : ils y sont déclarés en devDependencies.'
  );
  process.exit(2);
}


const SEPARATEUR = `${String.fromCharCode(10)};${String.fromCharCode(10)}`;

function blocsInline(html) {
  const blocs = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) blocs.push(m[1]);
  return blocs;
}

/** Les `id` du document : le navigateur les expose comme globales. */
function identifiantsHtml(html) {
  const ids = new Set();
  const re = /\sid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return ids;
}

/**
 * Les fonctions nommées dans un attribut `onclick="f()"`, `onchange="g(this)"`…
 *
 * ⚠️ CE SONT DE VRAIES RACINES, que rien dans le JS ne nomme : le navigateur
 * les appelle depuis le HTML. Les oublier ferait passer pour « code mort »
 * des fonctions qui tournent à chaque clic.
 */
function gestionnairesHtml(html) {
  const noms = new Set();
  const re = /\son[a-z]+\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    for (const appel of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) noms.add(appel[1]);
  }
  return [...noms];
}

/**
 * Le JavaScript d'un fichier référencé par `<script src>`.
 *
 * ⚠️ UN `.php` PEUT RENDRE DU JAVASCRIPT — c'est ainsi que ce projet sert sa
 * table d'horaires aux pages HTML statiques (`api/data/creneaux.js.php`), pour
 * n'avoir qu'UNE définition côté serveur et côté navigateur. Sans ce traitement,
 * l'outil déclarait « DANGEREUSES » les quatre fonctions que ce fichier expose,
 * alors qu'elles sont parfaitement chargées.
 *
 * On garde tout ce qui suit le premier `?>` — l'en-tête PHP s'y arrête — et on
 * neutralise les `<?= … ?>` restants, qui sont des VALEURS interpolées : leur
 * contenu exact est sans importance ici, seuls comptent les noms déclarés.
 */
function sourceJavascript(chemin) {
  const brut = fs.readFileSync(chemin, 'utf8');
  if (!chemin.toLowerCase().endsWith('.php')) return brut;

  const finEnTete = brut.indexOf('?>');
  const corps = finEnTete === -1 ? brut : brut.slice(finEnTete + 2);
  return corps.replace(/<\?[\s\S]*?\?>/g, 'null');
}

/**
 * Ce que les `<script src>` LOCAUX déclarent au niveau global.
 *
 * ⚠️⚠️ SANS CELA, L'OUTIL EST INUTILISABLE. `edition.html` charge son métier
 * depuis `assets/js/edition.js` : sans lire ce fichier, les dix fonctions
 * qu'il définit passent pour des références libres « qui plantent au
 * chargement » — un mur de faux positifs, et on cesse de lancer l'outil.
 *
 * ⚠️ LES CDN NE SONT PAS RÉSOLUS (pas d'accès réseau, et ce n'est pas le rôle
 * de cet outil) : ce qu'ils exposent doit figurer dans FOURNIS.
 */
function declarationsExternes(html, fichierHtml) {
  const base = path.dirname(path.resolve(fichierHtml));
  const noms = new Set();
  const distants = [];
  const re = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi;
  let m;

  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src)) {
      distants.push(src);
      continue;
    }
    // `fichier.js?v=4` : la chaîne de cache n'est pas dans le nom du fichier.
    const chemin = path.resolve(base, src.split('?')[0]);
    if (!fs.existsSync(chemin)) continue;
    try {
      const ast = parse(sourceJavascript(chemin), {
        sourceType: 'script',
        errorRecovery: true,
      });
      traverse(ast, {
        Program(racine) {
          for (const nom of Object.keys(racine.scope.bindings)) noms.add(nom);
          // `window.X = ...` : une globale posée explicitement.
          racine.traverse({
            AssignmentExpression(cheminAffectation) {
              const gauche = cheminAffectation.node.left;
              /* ⚠️ PAS SEULEMENT `window.X`. Un script enveloppé dans une IIFE
                 reçoit l'objet global sous un autre nom — `formateur-compat.js`
                 écrit `global.FormateurCompat = ...`. Ne guetter que `window`
                 faisait passer ces exports pour des références libres. */
              const porteurGlobal = new Set(['window', 'globalThis', 'self', 'global', 'root']);
              if (
                gauche.type === 'MemberExpression' &&
                porteurGlobal.has(gauche.object?.name) &&
                gauche.property?.name
              ) {
                noms.add(gauche.property.name);
              }
            },
          });
        },
      });
    } catch {
      /* Illisible (minifié exotique) : on n'en tire rien, tant pis. */
    }
  }
  return { noms, distants };
}

/**
 * Le nom de la fonction NOMMÉE qui contient ce chemin.
 *
 * ⚠️ ON REMONTE JUSQU'À EN TROUVER UNE. `getFunctionParent()` seul rend la
 * fonction la plus proche — souvent une flèche anonyme (`.then(r => {...})`) —
 * et l'outil concluait alors « hors de toute fonction, plante au CHARGEMENT »
 * pour du code qui vit en réalité dans une fonction nommée, appelée ou non.
 * Un diagnostic faux sur la gravité est pire qu'une absence de diagnostic.
 */
function nomFonctionEnglobante(chemin) {
  let parent = chemin.getFunctionParent();
  while (parent) {
    const nom = parent.node?.id?.name ?? parent.parent?.id?.name ?? null;
    if (nom) return nom;
    parent = parent.parentPath?.getFunctionParent?.() ?? null;
  }
  return null;
}

function analyser(fichier) {
  const html = fs.readFileSync(fichier, 'utf8');
  const blocs = blocsInline(html);
  const ids = identifiantsHtml(html);

  /* Les blocs inline PARTAGENT la portée globale du document : les analyser
     séparément ferait passer pour « libre » toute fonction déclarée dans l'un
     et appelée depuis l'autre. */
  const code = blocs.join(SEPARATEUR);

  let ast;
  try {
    ast = parse(code, { sourceType: 'script', errorRecovery: true });
  } catch (erreur) {
    return { fichier, blocs: blocs.length, erreurSyntaxe: erreur.message, trouvailles: [] };
  }

  /* UNE SEULE TRAVERSÉE. Ces pages font des dizaines de milliers de nœuds :
     repartir de la racine pour chaque nom suspect coûterait le carré. */
  const libres = new Map(); // nom -> { typeofTeste, assignee, porteuses:Set }
  const externes = declarationsExternes(html, fichier);
  const suspect = (nom) => !FOURNIS.has(nom) && !externes.noms.has(nom);

  /* ═══ GRAPHE D'APPEL, POUR SAVOIR CE QUI TOURNE VRAIMENT ═══
     `qui` associe chaque fonction aux noms qu'elle référence, et `null` au
     code de plus haut niveau. Une simple « cette fonction est-elle nommée
     quelque part ? » ne suffit pas : `toggleListening` EST nommée — mais dans
     `setupVoiceAssistant`, que personne n'appelle. Sans fermeture transitive,
     l'outil déclare vivante toute une chaîne morte. */
  const qui = new Map();
  const referencer = (porteuse, nom) => {
    if (!qui.has(porteuse)) qui.set(porteuse, new Set());
    qui.get(porteuse).add(nom);
  };

  traverse(ast, {
    Identifier(chemin) {
      const nom = chemin.node.name;

      if (chemin.isReferencedIdentifier() && !chemin.parentPath?.isFunctionDeclaration()) {
        referencer(nomFonctionEnglobante(chemin), nom);
      }

      if (!suspect(nom)) return;
      if (chemin.scope.hasBinding(nom, { noGlobals: true })) return;

      const parent = chemin.parentPath;
      const estCible = parent?.isAssignmentExpression() && parent.node.left === chemin.node;
      if (!chemin.isReferencedIdentifier() && !estCible) return;

      if (!libres.has(nom)) {
        libres.set(nom, { typeofTeste: false, assignee: false, porteuses: new Set() });
      }
      const info = libres.get(nom);

      if (parent?.isUnaryExpression({ operator: 'typeof' })) {
        info.typeofTeste = true;
        return;
      }
      if (estCible) {
        info.assignee = true;
        return;
      }
      const porteuse = nomFonctionEnglobante(chemin);
      if (porteuse) info.porteuses.add(porteuse);
    },
  });

  /* Fermeture transitive depuis les VRAIES racines : le code de plus haut
     niveau (qui s'exécute au chargement) et les attributs `onclick="..."` du
     HTML, que le navigateur appelle sans qu'aucun JS ne les nomme. */
  const atteignables = new Set();
  const aExplorer = [...(qui.get(null) ?? []), ...gestionnairesHtml(html)];
  while (aExplorer.length > 0) {
    const nom = aExplorer.pop();
    if (atteignables.has(nom)) continue;
    atteignables.add(nom);
    for (const suivant of qui.get(nom) ?? []) aExplorer.push(suivant);
  }

  const trouvailles = [];
  for (const [nom, info] of libres) {
    let niveau;
    let motif;

    if (ids.has(nom)) {
      niveau = 'sur';
      motif = "id HTML — le navigateur l'expose sur window";
    } else if (info.typeofTeste) {
      niveau = 'sur';
      motif = 'lecture protégée par un test `typeof`';
    } else if (info.assignee) {
      niveau = 'fragile';
      motif = 'assignée sans let/const — globale implicite (invalide en mode strict)';
    } else {
      const porteuses = [...info.porteuses];
      const vivantes = porteuses.filter((f) => atteignables.has(f));

      if (porteuses.length === 0) {
        niveau = 'danger';
        motif = 'lue hors de toute fonction — plante au CHARGEMENT de la page';
      } else if (vivantes.length > 0) {
        niveau = 'danger';
        motif = `lue dans ${vivantes.join(', ')}() — ATTEIGNABLE, donc plante à l'usage`;
      } else {
        /* ⚠️ PAS « DANGEREUSE », MAIS PAS ANODINE : la variable manque
           réellement ; seule l'absence d'appelant l'empêche de plancher. Elle
           s'armera le jour où l'on rebranchera la fonction. Le bon correctif
           est presque toujours de SUPPRIMER le code mort — pas d'inventer la
           variable manquante pour un appelant qui n'existe pas. */
        niveau = 'latent';
        motif = `lue dans ${porteuses.join(', ')}() — hors de toute chaîne d'appel : code mort`;
      }
    }

    trouvailles.push({ nom, niveau, motif });
  }

  return {
    fichier,
    blocs: blocs.length,
    erreurSyntaxe: null,
    trouvailles,
    externesLus: externes.noms.size,
    distants: externes.distants,
  };
}

const ETIQUETTES = {
  danger: '  X DANGEREUSE ',
  latent: '  ! latente    ',
  fragile: '  ~ fragile    ',
  sur: '  . sans risque',
};
const ORDRE = { danger: 0, latent: 1, fragile: 2, sur: 3 };

/**
 * Développe les motifs `dossier/*.html`.
 *
 * ⚠️ NÉCESSAIRE : `npm run` passe par cmd.exe sous Windows, qui ne développe
 * PAS les globs — le script recevait l'étoile telle quelle et échouait sur un
 * ENOENT. Un shell POSIX, lui, l'aurait développée : l'outil doit marcher des
 * deux côtés, sans que la commande change.
 */
function developper(motifs) {
  const sortie = [];
  for (const motif of motifs) {
    if (!motif.includes('*')) {
      sortie.push(motif);
      continue;
    }
    const dossier = path.dirname(motif);
    const modele = new RegExp(
      `^${path.basename(motif).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      'i'
    );
    if (!fs.existsSync(dossier)) continue;
    for (const nom of fs.readdirSync(dossier).sort()) {
      if (modele.test(nom)) sortie.push(path.join(dossier, nom));
    }
  }
  return sortie;
}

const fichiers = developper(process.argv.slice(2)).filter((f) => {
  if (fs.existsSync(f)) return true;
  console.error(`  (ignoré, introuvable : ${f})`);
  return false;
});

if (fichiers.length === 0) {
  console.error('Usage : node outils/references-libres.mjs <page.html|dossier/*.html> ...');
  process.exit(2);
}

let dangers = 0;
let latentes = 0;
for (const fichier of fichiers) {
  const resultat = analyser(fichier);
  const externes = resultat.externesLus
    ? `, ${resultat.externesLus} nom(s) repris des <script src> locaux`
    : '';
  console.log(
    `\n${path.basename(resultat.fichier)} — ${resultat.blocs} bloc(s) <script> inline${externes}`
  );

  if (resultat.erreurSyntaxe) {
    console.log(`  X SYNTAXE : ${resultat.erreurSyntaxe}`);
    dangers += 1;
    continue;
  }
  if (resultat.trouvailles.length === 0) {
    console.log('  aucune référence libre.');
    continue;
  }

  resultat.trouvailles.sort(
    (a, b) => ORDRE[a.niveau] - ORDRE[b.niveau] || a.nom.localeCompare(b.nom)
  );
  for (const t of resultat.trouvailles) {
    console.log(`${ETIQUETTES[t.niveau]}  ${t.nom.padEnd(24)} ${t.motif}`);
    if (t.niveau === 'danger') dangers += 1;
    if (t.niveau === 'latent') latentes += 1;
  }
}

/* ⚠️ SEULES LES DANGEREUSES FONT ÉCHOUER. Une latente dort dans du code que
   personne n'appelle : la faire échouer laisserait l'outil rouge en
   permanence à cause de vestiges, et on cesserait de le lancer. */
const reste = latentes > 0 ? ` (${latentes} latente(s), dans du code mort)` : '';
console.log(
  dangers === 0
    ? `\nOK — aucune référence libre dangereuse${reste}.`
    : `\nECHEC — ${dangers} référence(s) dangereuse(s)${reste}.`
);
process.exit(dangers === 0 ? 0 : 1);
