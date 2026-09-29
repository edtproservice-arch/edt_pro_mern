import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';

import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { cascader, compterReferences } from '../../src/modules/base/cascadeGroupes.js';

/**
 * Migration : retrait COMPLET du groupe `ACADA101 (FQ)`.
 *
 *   node --env-file=.env scripts/migrations/2026-09-26-retrait-acada101-fq.js
 *   node --env-file=.env scripts/migrations/2026-09-26-retrait-acada101-fq.js --appliquer
 *
 * Sans `--appliquer`, le script mesure et sauvegarde — aucune écriture.
 *
 * ═══ CONTEXTE ═══ (2026-09-26, décision du porteur, après mesure)
 * `ACADA101 (FQ)` portait un chronogramme de 30 h sans exister dans la carte. Il
 * avait d'abord été ÉPARGNÉ par la migration `…-chronogrammes-orphelins.js` du même
 * jour, parce qu'il était le seul des cinq orphelins à porter une composition FQ
 * déclarée. Le porteur a ensuite demandé son retrait, puis — la composition mesurée —
 * son retrait ENTIER, liens compris.
 *
 * ═══ ⚠️⚠️ CE QUE CE SCRIPT DÉTRUIT, ET QUI NE SE DEVINE PAS ═══
 * Les 4 liens `ACADA101 (FQ) ← GM101 / GM102 / SMP201 / SMP202` sont **la seule et
 * unique configuration FQ de l'établissement**, et les quatre constituants sont
 * vivants dans la carte, chacun avec son chronogramme. Après ce script, plus rien ne
 * lie ces quatre groupes entre eux : rétablir la composition demandera de la
 * ressaisir. Le porteur en a été informé chiffres en main avant de trancher.
 *
 * ⚠️ ON APPELLE `cascader()`, LA FONCTION DE LA CASCADE, pas une réécriture : c'est
 *    elle qui définit ce qu'emporte le retrait d'un groupe, elle est testée, et une
 *    seconde copie de la règle divergerait — le défaut §4.2 que la migration corrige.
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

/** ⚠️ Un seul nom, en toutes lettres. Jamais un critère. */
const GROUPE = 'ACADA101 (FQ)';

await mongoose.connect(uri);

const chrono = await Chronogramme.findOne({ groupe: GROUPE })
  .select('etablissementId anneeScolaire')
  .lean();

if (!chrono) {
  console.log(`« ${GROUPE} » n’a plus de chronogramme — rien à faire.`);
  await mongoose.disconnect();
  process.exit(0);
}

const { etablissementId, anneeScolaire } = chrono;
const etablissement = await Etablissement.findById(etablissementId)
  .select('nomAbrege groupesFq')
  .lean();

console.log(`Établissement : ${etablissement?.nomAbrege} · année ${anneeScolaire}`);

const [detail] = await compterReferences(etablissementId, anneeScolaire, [GROUPE], null);
console.log(
  `\n« ${GROUPE} » emporterait :\n` +
    `  chronogramme : ${detail.chronogramme} (${detail.heuresPlanifiees} h)\n` +
    `  séances      : ${detail.seances}\n` +
    `  non placées  : ${detail.nonPlacees}\n` +
    `  stagiaires   : ${detail.stagiairesADetacher} (détachés, jamais supprimés)\n` +
    `  absences     : ${detail.absencesConservees} (CONSERVÉES — historique d’une personne)\n` +
    `  stages       : ${detail.stages}\n` +
    `  liens FQ     : ${detail.liensFq}`
);

/*
 * ⚠️ LE GARDE : la mesure qui a servi à décider date de quelques minutes. Une
 *    génération lancée entre-temps changerait la donne — et supprimer alors le
 *    chronogramme laisserait des séances sans planification de référence.
 */
if (detail.seances > 0 || detail.stagiairesADetacher > 0 || detail.nonPlacees > 0) {
  console.error(
    '\n✖ REFUS : ce groupe a acquis des références depuis la mesure (séances, stagiaires' +
      ' ou non placées). Rien n’a été supprimé — reprendre la mesure avant de relancer.'
  );
  await mongoose.disconnect();
  process.exit(1);
}

/*
 * ⚠️ LA SAUVEGARDE PORTE LES DEUX CHOSES, et s'écrit AVANT toute suppression : le
 *    chronogramme SEUL ne permettrait pas de rétablir la composition FQ, qui est la
 *    partie la plus coûteuse à ressaisir.
 */
const planningComplet = await Chronogramme.findOne({
  etablissementId,
  anneeScolaire,
  groupe: GROUPE,
}).lean();

const liensFq = (etablissement?.groupesFq ?? []).filter(
  (lien) => lien.groupeFq === GROUPE || lien.groupeConstituant === GROUPE
);

const horodatage = new Date().toISOString().replace(/[:.]/gu, '-');
const fichier = `sauvegarde-acada101-fq-${horodatage}.json`;
writeFileSync(
  fichier,
  JSON.stringify({ etablissementId, anneeScolaire, chronogramme: planningComplet, liensFq }, null, 2),
  'utf8'
);
console.log(`\nSauvegarde écrite (chronogramme + ${liensFq.length} liens FQ) : ${fichier}`);

if (!appliquer) {
  console.log('\nSimulation — rien n’a été supprimé. Relancer avec --appliquer pour écrire.');
  await mongoose.disconnect();
  process.exit(0);
}

/*
 * ⚠️ DANS UNE TRANSACTION, comme l'enregistrement de la carte : le chronogramme et
 *    les liens FQ doivent partir ensemble ou pas du tout. Un échec au milieu
 *    laisserait une composition qui désigne un groupe sans planification.
 */
const session = await mongoose.startSession();
let resultat;
try {
  await session.withTransaction(async () => {
    resultat = await cascader(etablissementId, anneeScolaire, [GROUPE], session);
  });
} finally {
  await session.endSession();
}

console.log(
  `\n✔ Retiré : ${resultat.chronogrammes} chronogramme(s), ${resultat.seances} séance(s),` +
    ` ${resultat.nonPlacees} non placée(s), ${resultat.stagiaires} stagiaire(s) détaché(s).`
);

const apres = await Etablissement.findById(etablissementId).select('groupesFq').lean();
console.log(`  liens FQ restants dans l’établissement : ${(apres?.groupesFq ?? []).length}`);

const restant = await Base.findOne({ etablissementId, anneeScolaire }).select('groupes').lean();
console.log(`  groupes dans la carte : ${(restant?.groupes ?? []).length} (inchangé)`);

await mongoose.disconnect();
