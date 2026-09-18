import mongoose from 'mongoose';
import * as modeles from '../src/models/index.js';

/**
 * Crée les collections et leurs index, sans aucune donnée.
 *
 *   npm run init:db --workspace=backend
 *   npm run init:db --workspace=backend -- --verifier   (lecture seule)
 *
 * Remplace l'ETL initialement prévu en Phase 2 : décision du 2026-08-15 de
 * repartir d'une base vide plutôt que de reprendre l'historique MySQL.
 *
 * `syncIndexes()` fait deux choses : il crée les index déclarés dans les
 * schémas, et il SUPPRIME ceux qui ne le sont plus. C'est ce qui garantit que
 * la base suit le code — l'existant accumulait au contraire des index morts,
 * `formateurs_details` en portait trois identiques
 * (`etablissement_id`, `unique_etablissement_formateur`, `unique_formateur_etablissement`).
 *
 * Le script est IDEMPOTENT : le relancer ne casse rien et ne duplique rien.
 */
const verificationSeule = process.argv.includes('--verifier');
const vidementDemande = process.argv.includes('--vider');
const vidementConfirme = vidementDemande && process.argv.includes('--confirmer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent. Renseigne backend/.env');
  process.exit(1);
}

/** Modèles exportés par src/models/index.js, dans l'ordre de déclaration. */
const listeModeles = Object.entries(modeles).filter(
  ([, valeur]) => valeur?.prototype instanceof mongoose.Model
);

console.log(`→ ${listeModeles.length} collections à ${verificationSeule ? 'vérifier' : 'créer'}`);
console.log('');

try {
  await mongoose.connect(uri);

  // ─── Videment : irréversible, donc en deux temps ───────────────────────────
  // `--vider` seul ne fait qu'ANNONCER ce qui serait supprimé. Il faut ajouter
  // `--confirmer` pour que quoi que ce soit soit effacé. Une commande
  // destructive ne doit jamais partir d'une faute de frappe.
  if (vidementDemande) {
    console.log(vidementConfirme ? '⚠ SUPPRESSION EN COURS' : '· Simulation de videment');
    console.log('');

    let totalSupprimes = 0;

    for (const [nom, Modele] of listeModeles) {
      const documents = await Modele.estimatedDocumentCount();
      if (documents === 0) continue;

      totalSupprimes += documents;
      if (vidementConfirme) await Modele.deleteMany({});

      console.log(`  ${nom.padEnd(18)} ${documents} document(s) ${vidementConfirme ? 'supprimé(s)' : 'seraient supprimés'}`);
    }

    console.log('');
    if (!vidementConfirme) {
      console.log(
        totalSupprimes === 0
          ? 'Base déjà vide.'
          : `${totalSupprimes} document(s) au total. Ajoute --confirmer pour supprimer.`
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`${totalSupprimes} document(s) supprimé(s). Les index sont conservés.`);
    console.log('');
  }

  let totalIndex = 0;

  for (const [nom, Modele] of listeModeles) {
    if (verificationSeule) {
      const existe = await mongoose.connection.db
        .listCollections({ name: Modele.collection.name })
        .hasNext();
      const index = existe ? await Modele.collection.indexes() : [];
      const documents = existe ? await Modele.estimatedDocumentCount() : 0;

      console.log(
        `${existe ? '✔' : '·'} ${nom.padEnd(18)} ${Modele.collection.name.padEnd(20)} ` +
          `${String(index.length).padStart(2)} index · ${documents} document(s)`
      );
      totalIndex += index.length;
      continue;
    }

    // Crée la collection si besoin, puis aligne ses index sur le schéma.
    await Modele.createCollection().catch(() => {}); // existe déjà : sans effet
    await Modele.syncIndexes();

    const index = await Modele.collection.indexes();
    totalIndex += index.length;

    const uniques = index.filter((i) => i.unique).length;
    console.log(
      `✔ ${nom.padEnd(18)} ${Modele.collection.name.padEnd(20)} ` +
        `${String(index.length).padStart(2)} index (dont ${uniques} unique·s)`
    );
  }

  console.log('');
  console.log(`${totalIndex} index au total.`);

  if (!verificationSeule) {
    console.log('Base prête, et vide : aucune donnée n\'a été écrite.');
  }
} catch (erreur) {
  // L'URI peut contenir le mot de passe : on ne l'affiche jamais.
  console.error(`✖ ${String(erreur.message).replace(/\/\/([^:]+):([^@]+)@/, '//$1:••••••@')}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
