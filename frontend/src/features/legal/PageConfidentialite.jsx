import { Link } from 'react-router-dom';

/**
 * ═══ RÈGLES DE CONFIDENTIALITÉ (2026-11-02, exigées par Google Play) ═══
 * Page publique, accessible sans compte, à l'adresse https://edtpro.tech/confidentialite — celle
 * qui est déclarée dans la Play Console. Elle décrit ce que l'application fait RÉELLEMENT (modèles
 * `User`, `Stagiaire`, `RefreshToken`, `AuditLog`, `AbonnementPush`, `config/mailer`,
 * `notifications/push.service`) : à tenir à jour dès qu'une donnée ou un service tiers change.
 *
 * ⚠️ TOUJOURS EN CLAIR, comme la page d'accueil : couleurs écrites en dur.
 */
const CONTACT = 'edtproservice@gmail.com';
const MISE_A_JOUR = '2 novembre 2026';

function Section({ titre, children }) {
  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-slate-900">{titre}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-7 text-slate-700">{children}</div>
    </section>
  );
}

const Liste = ({ elements }) => (
  <ul className="list-disc space-y-1.5 pl-6">
    {elements.map((e) => (
      <li key={e}>{e}</li>
    ))}
  </ul>
);

export default function PageConfidentialite() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased [color-scheme:light]">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-5">
          <Link to="/" className="shrink-0">
            <img src="/logo_edtpro.png" alt="eDTpro" className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-[36px] font-semibold tracking-[-0.02em]">Règles de confidentialité</h1>
        <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : {MISE_A_JOUR}</p>

        <p className="mt-6 text-[16px] leading-7 text-slate-700">
          eDTpro est une application de gestion des emplois du temps pour les établissements de formation
          professionnelle, disponible sur le web (edtpro.tech), sous Windows et sous Android. Cette page explique
          quelles données l’application traite, pourquoi, avec qui elles sont partagées et comment exercer vos
          droits.
        </p>

        <Section titre="1. Qui est responsable">
          <p>
            L’établissement qui utilise eDTpro décide des données qu’il y saisit (formateurs, groupes, stagiaires,
            emplois du temps) et en reste responsable. eDTpro les traite pour son compte, uniquement pour faire
            fonctionner le service. Pour toute question : <a className="text-[#0071DB] underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </Section>

        <Section titre="2. Les données traitées">
          <p><strong>Comptes</strong> (direction, gestionnaires, formateurs, stagiaires) :</p>
          <Liste
            elements={[
              'nom, adresse e-mail, identifiant (matricule ou CEF), téléphone s’il est renseigné ;',
              'mot de passe, enregistré uniquement sous forme chiffrée (jamais en clair) ;',
              'rôle, établissement de rattachement, date de dernière connexion.',
            ]}
          />
          <p><strong>Données de l’établissement</strong>, saisies ou importées par lui :</p>
          <Liste
            elements={[
              'formateurs, groupes, modules, salles, affectations et masses horaires ;',
              'emplois du temps, chronogrammes et avancement des modules ;',
              'stagiaires : nom, prénom, matricule, groupe et filière, et, si l’établissement les importe, e-mail, téléphone, CIN, date et lieu de naissance ;',
              'appels, absences, retards et notes de discipline ;',
              'messages et annonces échangés dans l’application.',
            ]}
          />
          <p><strong>Données techniques</strong> :</p>
          <Liste
            elements={[
              'les sessions de connexion : adresse IP, type d’appareil et navigateur, pour sécuriser le compte et permettre de déconnecter un appareil ;',
              'un journal des actions sensibles (adresse IP comprise), pour la sécurité ;',
              'l’identifiant de notification de l’appareil, si vous acceptez les notifications.',
            ]}
          />
          <p>
            <strong>Caméra</strong> : sur Android, la caméra sert uniquement à scanner le QR code de la carte de
            stagiaire, au moment où vous le demandez. Aucune image n’est enregistrée ni envoyée.
          </p>
          <p>
            eDTpro ne collecte pas votre position, vos contacts ni vos fichiers, et n’utilise ni publicité ni outil de
            mesure d’audience.
          </p>
        </Section>

        <Section titre="3. Pourquoi">
          <Liste
            elements={[
              'faire fonctionner le service : construire, publier et consulter les emplois du temps, suivre l’avancement et les absences, produire les documents ;',
              'vous connecter et protéger votre compte ;',
              'vous prévenir d’un changement (publication d’un emploi du temps, message, annonce) par notification ou par e-mail ;',
              'répondre à vos demandes d’assistance.',
            ]}
          />
          <p>Vos données ne sont jamais vendues ni utilisées à des fins publicitaires.</p>
        </Section>

        <Section titre="4. Avec qui elles sont partagées">
          <p>
            Au sein de l’établissement, chacun ne voit que ce que son rôle permet. En dehors, les données ne sont
            transmises qu’aux prestataires techniques nécessaires au service :
          </p>
          <Liste
            elements={[
              'l’hébergeur des serveurs et de la base de données ;',
              'Google Firebase Cloud Messaging, pour acheminer les notifications sur Android (identifiant de l’appareil et contenu de la notification) ;',
              'les services de notification des navigateurs (Web Push) ;',
              'le prestataire d’envoi des e-mails (codes de vérification, réinitialisation du mot de passe).',
            ]}
          />
          <p>Les données peuvent aussi être communiquées si la loi l’exige.</p>
        </Section>

        <Section titre="5. Sécurité">
          <p>
            Les échanges sont chiffrés (HTTPS), les mots de passe sont chiffrés, la base de données n’est pas
            accessible depuis Internet, et chaque établissement travaille dans son propre espace, isolé des autres.
          </p>
        </Section>

        <Section titre="6. Durée de conservation">
          <p>
            Les données sont conservées tant que l’établissement utilise eDTpro. Les sessions de connexion expirent
            automatiquement. À la fin de l’abonnement, ou sur demande de l’établissement, ses données sont
            supprimées. Les copies créées par la démo en ligne sont effacées automatiquement après 24 heures.
          </p>
        </Section>

        <Section titre="7. Vos droits et la suppression de vos données">
          <p>
            Vous pouvez demander l’accès à vos données, leur correction ou leur suppression, ainsi que la suppression
            de votre compte. Écrivez à <a className="text-[#0071DB] underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>{' '}
            depuis l’adresse liée à votre compte, ou adressez-vous à la direction de votre établissement. La demande
            est traitée sous 30 jours.
          </p>
          <p>
            Au Maroc, ces droits s’exercent dans le cadre de la loi 09-08 relative à la protection des personnes
            physiques à l’égard du traitement des données à caractère personnel.
          </p>
        </Section>

        <Section titre="8. Enfants">
          <p>
            eDTpro s’adresse aux établissements de formation professionnelle, à leurs équipes et à leurs stagiaires.
            L’application n’est pas destinée aux enfants de moins de 13 ans.
          </p>
        </Section>

        <Section titre="9. Modifications">
          <p>
            Cette page peut évoluer. La date de dernière mise à jour figure en haut ; en cas de changement important,
            les utilisateurs en sont informés dans l’application.
          </p>
        </Section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} eDTpro · <Link to="/" className="hover:underline">Accueil</Link>
      </footer>
    </div>
  );
}
