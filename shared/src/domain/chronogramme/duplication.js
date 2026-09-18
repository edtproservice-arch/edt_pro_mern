import { anneeDuNomGroupe } from '../carte/reconstruction.js';

/**
 * À quels groupes le chronogramme d'un groupe peut-il être recopié ?
 * ← api/profile/get_chrono_duplicate_targets.php
 *   + chrono_modules_signature() / chrono_describe_incompatibility()
 *
 * ═══ POURQUOI UNE RÈGLE, ET PAS UNE COPIE AU MIEUX ═══
 * La version précédente recopiait ce que la cible possédait et ignorait
 * silencieusement le reste. C'est le pire des deux mondes : la grille arrivée
 * paraît complète — les heures s'affichent — alors qu'il en manque, et
 * l'écart ne se découvre qu'au moment où l'avancement ne tombe pas juste.
 *
 * L'existant, lui, exigeait l'égalité STRICTE des maquettes et affichait les
 * groupes refusés AVEC LEUR RAISON. C'est cette règle qui est portée ici.
 *
 * ⚠️ ET LA RAISON COMPTE AUTANT QUE LE REFUS. « Incompatible » seul envoie
 * chercher un défaut dans le chronogramme ; « module EGTS105 absent » envoie
 * corriger la carte d'établissement, là où est vraiment le problème.
 */

/** Semestre d'un module : '1' (S1 seul), '2' (S2 seul), 'A' (annuel). */
function semestre(module) {
  const s1 = arrondir(module.masses?.s1 ?? module.s1 ?? 0);
  const s2 = arrondir(module.masses?.s2 ?? module.s2 ?? 0);

  if (s1 > 0 && s2 === 0) return '1';
  if (s1 === 0 && s2 > 0) return '2';
  return 'A';
}

/*
 * ⚠️ Le SEMESTRE se déduit ici de `semestre` quand la source ne porte pas le
 * détail S1/S2 : c'est le cas de la route du chronogramme, qui rend déjà
 * « S1 » / « S2 » / « annuel ». Les deux formes disent la même chose, et
 * exiger l'une aurait obligé la route à en fabriquer une seconde.
 */
function codeSemestre(module) {
  if (module.semestre === 'S1') return '1';
  if (module.semestre === 'S2') return '2';
  if (module.semestre === 'annuel') return 'A';
  return semestre(module);
}

/**
 * Empreinte d'une maquette : ce qui doit être identique pour qu'une copie ait
 * un sens.
 *
 * ← `chrono_modules_signature()`, à l'identique : code du module, masse
 * présentielle, masse synchrone, semestre — TRIÉS, parce que l'ordre des
 * modules dans la base n'a aucune signification et ferait échouer des groupes
 * pourtant jumeaux.
 */
export function signatureMaquette(modules = []) {
  return modules
    .map((module) =>
      [
        String(module.code ?? '').trim().toUpperCase(),
        arrondir(module.masses?.presentiel ?? 0).toFixed(2),
        arrondir(module.masses?.synchrone ?? 0).toFixed(2),
        codeSemestre(module),
      ].join(':')
    )
    .sort()
    .join('|');
}

/**
 * Filière d'un groupe, lue dans son nom : « DEVOWFS201 » → « DEVOWFS ».
 *
 * ⚠️ Le suffixe fait PARTIE de l'identité. « ACADA101 » et « ACADA101 (FQ) »
 * sont deux formations distinctes — l'une diplômante, l'autre qualifiante —
 * qui peuvent partager des modules sans partager leur rythme. Les confondre
 * recopierait le chronogramme de l'une sur l'autre.
 */
export function filiereDuNomGroupe(nom) {
  const brut = String(nom ?? '').trim();
  const suffixes = [...brut.matchAll(/\(([^)]*)\)/g)].map((trouve) => trouve[1].toUpperCase());
  const sansSuffixe = brut.replace(/\([^)]*\)/g, '').trim();

  // Le numéro final — 101, 201, 2011 — est l'année et le rang, pas la filière.
  const prefixe = sansSuffixe.replace(/\d{3,4}\s*$/, '').trim().toUpperCase();

  return [prefixe, ...suffixes.sort()].join(' ');
}

/**
 * Le chronogramme de `source` peut-il être recopié sur `cible` ?
 *
 * @returns {{compatible: boolean, raisons: string[]}}
 */
export function comparerMaquettes(source, cible) {
  const raisons = [];

  if ((cible.modules ?? []).length === 0) {
    return { compatible: false, raisons: ['aucun module affecté'] };
  }

  /*
   * ═══ 1. MÊME FILIÈRE, MÊME ANNÉE ═══
   * L'existant ne vérifiait que la maquette, en tenant pour acquis que deux
   * maquettes identiques appartiennent à la même filière. Ce n'est pas garanti :
   * deux filières voisines peuvent partager leur liste de modules et leurs
   * masses. On le contrôle donc explicitement — et cela donne surtout une raison
   * de refus LISIBLE, là où la comparaison de maquettes n'aurait produit qu'une
   * liste de codes.
   */
  if (filiereDuNomGroupe(source.groupe) !== filiereDuNomGroupe(cible.groupe)) {
    raisons.push(`filière différente (${filiereDuNomGroupe(cible.groupe) || '—'})`);
  }

  const anneeSource = anneeDuNomGroupe(source.groupe);
  const anneeCible = anneeDuNomGroupe(cible.groupe);
  if (anneeSource !== anneeCible) {
    raisons.push(`année différente (${anneeCible}ᵉ au lieu de ${anneeSource}ᵉ)`);
  }

  // ═══ 2. MÊMES MODULES, MÊMES MASSES, MÊMES SEMESTRES ═══
  if (signatureMaquette(source.modules) !== signatureMaquette(cible.modules)) {
    raisons.push(...ecartsDeMaquette(source.modules ?? [], cible.modules ?? []));
  }

  return { compatible: raisons.length === 0, raisons };
}

/**
 * Ce qui diffère entre deux maquettes, dit en clair.
 * ← `chrono_describe_incompatibility()`
 */
function ecartsDeMaquette(source, cible) {
  const parCode = (modules) =>
    new Map(modules.map((module) => [String(module.code ?? '').trim().toUpperCase(), module]));

  const src = parCode(source);
  const tgt = parCode(cible);

  const manquants = [...src.keys()].filter((code) => !tgt.has(code));
  const enPlus = [...tgt.keys()].filter((code) => !src.has(code));

  const raisons = [];
  if (manquants.length > 0) raisons.push(`module(s) absent(s) : ${abreger(manquants)}`);
  if (enPlus.length > 0) raisons.push(`module(s) en plus : ${abreger(enPlus)}`);

  /*
   * Même liste de modules : c'est donc une masse horaire ou un semestre qui
   * diffère. On ne cherche ces écarts QUE dans ce cas — les énumérer en plus
   * d'une liste de modules manquants noierait la cause première.
   */
  if (raisons.length > 0) return raisons;

  const ecarts = [];
  for (const [code, moduleSource] of src) {
    const moduleCible = tgt.get(code);

    const totalSource = arrondir(
      (moduleSource.masses?.presentiel ?? 0) + (moduleSource.masses?.synchrone ?? 0)
    );
    const totalCible = arrondir(
      (moduleCible.masses?.presentiel ?? 0) + (moduleCible.masses?.synchrone ?? 0)
    );

    if (
      arrondir(moduleSource.masses?.presentiel ?? 0) !==
        arrondir(moduleCible.masses?.presentiel ?? 0) ||
      arrondir(moduleSource.masses?.synchrone ?? 0) !== arrondir(moduleCible.masses?.synchrone ?? 0)
    ) {
      ecarts.push(`${code} (${totalSource} h ≠ ${totalCible} h)`);
    } else if (codeSemestre(moduleSource) !== codeSemestre(moduleCible)) {
      ecarts.push(`${code} (semestre différent)`);
    }
  }

  if (ecarts.length > 0) raisons.push(`masse horaire différente : ${abreger(ecarts, 3)}`);
  return raisons;
}

/** Quatre exemples suffisent à comprendre ; vingt codes ne se lisent plus. */
function abreger(valeurs, maximum = 4) {
  return valeurs.slice(0, maximum).join(', ') + (valeurs.length > maximum ? '…' : '');
}

const arrondir = (valeur) => Math.round(Number(valeur ?? 0) * 100) / 100;
