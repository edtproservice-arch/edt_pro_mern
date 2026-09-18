import { envoyerEmail, verifierSmtp } from '../src/config/mailer.js';
import { env } from '../src/config/env.js';

/**
 * Diagnostic SMTP.
 *
 *   npm run tester:email --workspace=backend -- destinataire@exemple.ma
 *
 * Vérifie la connexion puis envoie un message de test. N'affiche jamais le mot
 * de passe, y compris dans les messages d'erreur.
 */
const destinataire = process.argv[2] || env.SMTP_USER;

if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
  console.error('✖ SMTP incomplet dans backend/.env (SMTP_HOST, SMTP_USER, SMTP_PASS).');
  console.error('  Sans cela, les codes sont seulement journalisés dans la console.');
  process.exit(1);
}

console.log(`→ Serveur      : ${env.SMTP_HOST}:${env.SMTP_PORT}`);
console.log(`→ Compte       : ${env.SMTP_USER}`);
console.log(`→ Expéditeur   : ${env.SMTP_FROM || env.SMTP_USER}`);
console.log(`→ Destinataire : ${destinataire}`);

try {
  await verifierSmtp();
  console.log('✔ Connexion et authentification SMTP acceptées');

  const resultat = await envoyerEmail({
    destinataire,
    sujet: 'EDT Pro — Test de configuration',
    texte:
      'Ceci est un message de test.\n\n' +
      '123456\n\n' +
      "Si vous le recevez avec le code ci-dessus en évidence, l'envoi des codes de " +
      'vérification et de réinitialisation fonctionne.',
  });

  if (resultat.envoye) {
    console.log(`✔ Message envoyé (id : ${resultat.id})`);
    console.log('  Vérifie la boîte de réception ET le dossier spam.');
  } else {
    console.error(`✖ Envoi refusé : ${resultat.erreur}`);
    process.exitCode = 1;
  }
} catch (erreur) {
  console.error(`✖ Échec : ${erreur.message}`);

  // Les deux causes qui reviennent systématiquement avec Gmail.
  if (/Username and Password not accepted|BadCredentials|535/i.test(erreur.message)) {
    console.error(
      '\n  Gmail refuse le mot de passe du compte depuis la fermeture des\n' +
        '  « applications moins sécurisées ». Il faut un MOT DE PASSE D\'APPLICATION :\n' +
        '    1. activer la validation en deux étapes sur le compte Google\n' +
        '    2. générer un mot de passe sur myaccount.google.com/apppasswords\n' +
        '    3. le coller dans SMTP_PASS (16 caractères, les espaces sont ignorés)'
    );
  }
  if (/self.signed|unable to verify|certificate/i.test(erreur.message)) {
    console.error(
      "\n  Le certificat du serveur n'est pas validé : ta connexion TLS est\n" +
        '  INTERCEPTÉE localement (antivirus ou pare-feu qui « analyse » le trafic\n' +
        '  chiffré et resigne avec sa propre autorité, inconnue de Node).\n\n' +
        '  Constaté sur ce poste : AVG Web/Mail Shield intercepte le port 465.\n' +
        '  Solution retenue : utiliser SMTP_PORT=587 (STARTTLS), qui passe sans\n' +
        '  interception. Sinon, exclure smtp.gmail.com dans les réglages de\n' +
        "  l'antivirus. Ne JAMAIS désactiver la vérification du certificat : les\n" +
        '  identifiants SMTP deviendraient lisibles par celui qui intercepte.'
    );
  }
  if (/ETIMEDOUT|ECONNREFUSED/i.test(erreur.message)) {
    console.error('\n  Port injoignable : un pare-feu bloque la sortie sur ce port.');
  }
  process.exitCode = 1;
}
