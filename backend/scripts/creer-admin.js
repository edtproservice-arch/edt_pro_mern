import readline from 'node:readline/promises';
import mongoose from 'mongoose';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { User } from '../src/models/User.js';

/**
 * Création du premier compte administrateur.
 *
 *   npm run creer:admin --workspace=backend
 *
 * Le mot de passe est demandé de façon interactive et n'apparaît donc ni dans
 * l'historique du shell, ni dans les arguments du processus. Il n'y a
 * volontairement AUCUNE route HTTP pour créer un admin : ce serait une porte
 * d'entrée permanente pour un privilège maximal.
 */
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('✖ MONGODB_URI absent. Renseigne backend/.env');
  process.exit(1);
}

const question = readline.createInterface({ input: process.stdin, output: process.stdout });

try {
  await mongoose.connect(uri);

  const email = (await question.question('E-mail de l\'administrateur : ')).trim().toLowerCase();
  const existant = await User.findOne({ email });

  if (existant) {
    console.error(`✖ Un compte existe déjà avec ${email} (rôle : ${existant.role}).`);
    process.exit(1);
  }

  const nomComplet = (await question.question('Nom complet : ')).trim();
  const motDePasse = (await question.question('Mot de passe (8+, 1 maj, 1 min, 1 chiffre) : ')).trim();

  const politiqueRespectee =
    motDePasse.length >= 8 &&
    /[A-Z]/.test(motDePasse) &&
    /[a-z]/.test(motDePasse) &&
    /[0-9]/.test(motDePasse);

  if (!politiqueRespectee) {
    console.error('✖ Mot de passe trop faible.');
    process.exit(1);
  }

  await User.create({
    nomComplet,
    email,
    motDePasse,
    role: ROLES.ADMIN,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    estActif: true,
    dateApprobation: new Date(),
  });

  console.log(`✔ Administrateur créé : ${email}`);
} catch (erreur) {
  console.error(`✖ ${erreur.message}`);
  process.exitCode = 1;
} finally {
  question.close();
  await mongoose.disconnect();
}
