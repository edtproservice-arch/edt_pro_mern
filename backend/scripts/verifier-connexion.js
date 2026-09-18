import mongoose from 'mongoose';

/**
 * Diagnostic de connexion MongoDB.
 *
 *   npm run verifier:db --workspace=backend
 *
 * Vérifie l'accès au cluster et signale les prérequis du projet (replica set
 * pour les transactions). N'affiche JAMAIS les identifiants : l'URI est
 * masquée avant tout affichage, y compris dans les messages d'erreur.
 */

function masquer(uri) {
  return String(uri).replace(/\/\/([^:]+):([^@]+)@/, '//$1:••••••@');
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI est vide. Renseigne-la dans backend/.env');
  process.exit(1);
}

console.log(`→ Connexion à ${masquer(uri)}`);

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });

  const admin = mongoose.connection.db.admin();
  const info = await admin.command({ hello: 1 });
  const collections = await mongoose.connection.db.listCollections().toArray();

  console.log('✔ Connexion établie');
  console.log(`  base            : ${mongoose.connection.name}`);
  console.log(`  version serveur : ${(await admin.serverInfo()).version}`);
  console.log(`  replica set     : ${info.setName ?? 'AUCUN'}`);
  console.log(
    `  collections     : ${collections.length ? collections.map((c) => c.name).join(', ') : '(base vide)'}`
  );

  if (!info.setName) {
    console.warn(
      "\n⚠ Pas de replica set : les transactions multi-collections échoueront.\n" +
        '  Requis par les Phases 5 (emploi du temps + absences) et 9 (propositions).\n' +
        '  Atlas en fournit un par défaut — une installation locale doit être configurée.'
    );
  }

  await mongoose.disconnect();
  process.exit(0);
} catch (erreur) {
  console.error(`✖ Échec : ${masquer(erreur.message)}`);

  // Les trois causes qui reviennent systématiquement avec Atlas.
  if (/authentication failed/i.test(erreur.message)) {
    console.error(
      "\n  Authentification refusée. Cause la plus fréquente : un caractère spécial\n" +
        '  du mot de passe non encodé dans l\'URI. Un @ doit devenir %40, un # %23,\n' +
        '  un / %2F, un : %3A. Atlas propose aussi de régénérer un mot de passe\n' +
        '  alphanumérique, ce qui évite le problème.'
    );
  }
  if (/timed out|ETIMEDOUT|ENOTFOUND|querySrv/i.test(erreur.message)) {
    console.error(
      "\n  Cluster injoignable. Vérifie dans Atlas > Network Access que ton adresse IP\n" +
        '  actuelle est autorisée (elle change si tu es en IP dynamique).'
    );
  }

  process.exit(1);
}
