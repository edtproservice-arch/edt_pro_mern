import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { CalendarX2, CircleCheck, Clock, Mail, Split, UserX, Waypoints, X } from 'lucide-react';
import { SEUIL_HEBDOMADAIRE } from 'shared/domain';
import { chargerSemaines } from '@/features/emploi/api';
import { chargerAbsences } from '@/features/absences/api';
import {
  chargerCharge,
  chargerCompletude,
  chargerFormateursChronogramme,
  chargerGroupesChronogramme,
  chargerPartagesParType,
} from '@/features/chronogramme/api';
import { compterNonLus } from '@/features/messagerie/api';
import { cn } from '@/lib/utils';

/**
 * « À traiter » : ce qui demande une action, et le lien qui y mène.
 * (Demande du porteur, 2026-09-28 — le bloc du tableau de bord proposé.)
 *
 * ═══ ⚠️ LES TUILES DISENT UN ÉTAT, CE BLOC DIT UN TRAVAIL ═══
 * « 20 groupes » ne demande rien. « 4 groupes sans chronogramme » demande qu'on
 * ouvre le chronogramme. Seule une ligne qui APPELLE un geste a sa place ici —
 * et une ligne à zéro n'en appelle aucun : elle disparaît.
 *
 * ⚠️ AUCUNE ROUTE NOUVELLE, et les MÊMES clés de cache que les écrans métier
 * (`['emploi', 'semaines']`, `['absences', 'toutes']`, `['chronogrammes']`,
 * `['messages', 'non-lus']`…) : ce que l'accueil ou la barre latérale a déjà
 * demandé ne coûte rien de plus.
 *
 * ⚠️ CHAQUE LIGNE MÈNE À L'ENDROIT EXACT (2026-09-28, demande du porteur :
 * « groupe sans chronogramme → le chronogramme de ce groupe ») : la semaine
 * dans l'Emploi avec son rapport d'écarts ouvert, le registre filtré sur les
 * absences en attente, le chronogramme du groupe ou du formateur, les messages
 * non lus. Quand la ligne en réunit plusieurs, CHAQUE NOM est un lien — la
 * ligne entière mène au premier.
 *
 * ⚠️ UNE SOURCE MUETTE N'EST PAS UNE BONNE NOUVELLE. Une requête en échec ne
 * produit AUCUNE ligne — mais ne permet pas non plus de dire « rien à
 * traiter » : on tairait un problème qu'on n'a simplement pas pu voir.
 */

/** Au-delà de quinze jours, un rattrapage en attente devient un retard. */
const JOURS_RETARD = 15;

/**
 * Lignes ignorées : clé de ligne → signature de ce qui a été ignoré.
 *
 * ⚠️ ON IGNORE UN ÉTAT, PAS UNE CATÉGORIE (2026-10-01) : la signature décrit
 * les partages vus au moment du clic. Qu'un nouveau partage apparaisse, elle ne
 * correspond plus et la ligne revient — sinon « Ignorer » tairait pour
 * toujours des cas que personne n'a jamais lus.
 *
 * Préférence de CE navigateur seulement (localStorage), sans route nouvelle.
 */
const CLE_IGNORES = 'accueil.aTraiter.ignores';

function lireIgnores() {
  try {
    return JSON.parse(window.localStorage.getItem(CLE_IGNORES) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function ecrireIgnores(ignores) {
  try {
    window.localStorage.setItem(CLE_IGNORES, JSON.stringify(ignores));
  } catch {
    /* Stockage indisponible : la ligne disparaît jusqu'au rechargement. */
  }
}

export default function ATraiter() {
  const [ignores, setIgnores] = useState(lireIgnores);
  const [semaines, absences, chronogrammes, completude, charge, messages, formateurs, partagesType] = useQueries({
    queries: [
      { queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false },
      { queryKey: ['absences', 'toutes'], queryFn: () => chargerAbsences({}), retry: false },
      { queryKey: ['chronogrammes'], queryFn: chargerGroupesChronogramme, retry: false },
      /* La même clé que les pastilles du sélecteur de semaine de l'Emploi. */
      {
        queryKey: ['chronogramme-completude-annee'],
        queryFn: () => chargerCompletude(),
        retry: false,
      },
      /*
       * ⚠️ LE CALCUL LE PLUS LOURD DE L'ACCUEIL — il parcourt tous les
       * chronogrammes de l'année. Gardé cinq minutes : un aller-retour entre
       * l'accueil et un écran ne doit pas le relancer.
       */
      {
        queryKey: ['chronogrammes', 'charge'],
        queryFn: chargerCharge,
        retry: false,
        staleTime: 5 * 60 * 1000,
      },
      { queryKey: ['messages', 'non-lus'], queryFn: compterNonLus, retry: false },
      /*
       * Les identifiants des formateurs, pour ouvrir LEUR chronogramme : la
       * charge les nomme, la page les attend par identifiant. La même clé que
       * la page Chronogramme en mode formateur.
       */
      {
        queryKey: ['chronogrammes', 'formateurs'],
        queryFn: chargerFormateursChronogramme,
        retry: false,
      },
      { queryKey: ['chronogrammes', 'partages-type'], queryFn: chargerPartagesParType, retry: false },
    ],
  });

  const requetes = [semaines, absences, chronogrammes, completude, charge, messages, partagesType];
  const numero = numeroDeSemaine(semaines.data?.courante);
  const lignes = [
    ...lignesCompletude(completude.data?.semaines, numero),
    ligneAbsences(absences.data?.absences),
    ligneChronogrammes(chronogrammes.data?.groupes),
    ligneCharge(charge.data?.formateurs, numero, formateurs.data?.formateurs),
    ligneMessages(messages.data?.nonLus),
    lignePartagesType(partagesType.data?.partages),
  ]
    .filter(Boolean)
    .filter((ligne) => !ligne.signature || ignores[ligne.cle] !== ligne.signature);

  const ignorer = (ligne) => {
    const suivants = { ...lireIgnores(), [ligne.cle]: ligne.signature };
    ecrireIgnores(suivants);
    setIgnores(suivants);
  };

  const enCours = requetes.some((requete) => requete.isLoading);
  const incomplet = requetes.some((requete) => requete.isError);

  return (
    <div className="space-y-2">
      {/*
        ⚠️ LE TITRE HORS DE LA CARTE (2026-09-29, demande du porteur : « je
        veux que le titre à traiter être en externe du card ») — revient sur
        l'en-tête intérieur : le titre et son compte sont désormais au-dessus
        du cadre, comme le nom d'une catégorie au-dessus d'une tuile.
      */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">À traiter</h2>
        {lignes.length > 0 && (
          <span className="rounded-md bg-warning/15 px-2 py-0.5 text-xs tabular-nums text-warning">
            {lignes.length}
          </span>
        )}
      </div>

      <section className="rounded-lg border p-4">
        {lignes.length > 0 ? (
          <ul className="divide-y">
            {lignes.map((ligne) => (
              <Ligne
                key={ligne.cle}
                {...ligne}
                onIgnorer={ligne.signature ? () => ignorer(ligne) : undefined}
              />
            ))}
          </ul>
        ) : (
          <Vide enCours={enCours} incomplet={incomplet} />
        )}
      </section>
    </div>
  );
}

/**
 * Une ligne : toute sa surface mène à `vers`, et chaque nom de `cibles` à sa
 * propre destination.
 *
 * ⚠️ UN LIEN ÉTIRÉ, PAS DES LIENS IMBRIQUÉS : un `<a>` dans un `<a>` est
 * invalide, et le navigateur le « répare » en cassant la ligne. Le lien
 * principal couvre la ligne par un pseudo-élément ; les noms passent au-dessus.
 */
function Ligne({ Icone, niveau, texte, detail, cibles, reste, action, vers, onIgnorer }) {
  return (
    <li className="relative -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40">
      <Icone
        className={cn(
          'size-4 shrink-0',
          niveau === 'alerte' && 'text-destructive',
          niveau === 'attention' && 'text-warning',
          niveau === 'info' && 'text-muted-foreground'
        )}
      />
      <span className="min-w-0 flex-1">
        <Link to={vers} className="block truncate after:absolute after:inset-0 after:content-['']">
          {texte}
        </Link>
        {(detail || cibles?.length > 0) && (
          <span className="block truncate text-xs text-muted-foreground">
            {detail}
            {detail && cibles?.length > 0 && ' · '}
            {cibles?.map((cible, rang) => (
              <span key={cible.vers}>
                {rang > 0 && ', '}
                <Link
                  to={cible.vers}
                  className="relative z-10 underline-offset-2 hover:text-primary hover:underline"
                >
                  {cible.libelle}
                </Link>
              </span>
            ))}
            {reste > 0 && ` +${reste}`}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs text-primary">{action}</span>
      {onIgnorer && (
        <button
          type="button"
          onClick={onIgnorer}
          title="Ignorer — la ligne reviendra si un nouveau cas apparaît"
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
          Ignorer
        </button>
      )}
    </li>
  );
}

function Vide({ enCours, incomplet }) {
  if (enCours) {
    return <p className="mt-2 py-4 text-center text-sm text-muted-foreground">Vérification en cours…</p>;
  }

  if (incomplet) {
    return (
      <p className="mt-2 py-4 text-center text-sm text-muted-foreground">
        Rien de signalé, mais certaines vérifications n’ont pas pu aboutir.
      </p>
    );
  }

  return (
    <p className="mt-2 flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
      <CircleCheck className="size-4 text-success" />
      Rien à traiter pour le moment.
    </p>
  );
}

/** « 2026-W4 » → 4. `null` si la semaine n'est pas connue. */
function numeroDeSemaine(semaine) {
  const correspondance = /-W(\d{1,3})$/.exec(String(semaine ?? ''));
  return correspondance ? Number.parseInt(correspondance[1], 10) : null;
}

/**
 * La semaine en cours et la suivante, si l'emploi du temps n'y couvre pas le
 * chronogramme.
 *
 * ⚠️ DEUX SEMAINES, PAS L'ANNÉE : un écart en S30 n'a rien d'urgent en S4, et
 * trente-neuf lignes noieraient les autres. Les semaines passées ne comptent
 * pas non plus — ce qui n'a pas été posé relève des absences, pas de la saisie.
 */
function lignesCompletude(semaines, numero) {
  if (!semaines || !numero) return [];

  return [numero, numero + 1]
    .map((cible) => semaines.find((entree) => entree.numero === cible))
    .filter((entree) => entree && entree.prevu > 0 && entree.taux !== null && entree.taux < 100)
    .map((entree) => ({
      cle: `completude-${entree.numero}`,
      Icone: CalendarX2,
      niveau: entree.numero === numero ? 'alerte' : 'attention',
      texte: `S${entree.numero}${entree.numero === numero ? ' (en cours)' : ''} : ${
        entree.taux
      } % du chronogramme posé`,
      detail:
        entree.ecarts > 0 ? `${entree.ecarts} écart(s) avec le chronogramme` : undefined,
      action: entree.ecarts > 0 ? 'Corriger' : 'Saisir',
      vers: `/app/emploi?${new URLSearchParams({ semaine: entree.semaine, rapport: '1' })}`,
    }));
}

function ligneAbsences(absences) {
  const enAttente = (absences ?? []).filter((absence) => !absence.dateRattrapage);
  if (enAttente.length === 0) return null;

  const limite = new Date();
  limite.setDate(limite.getDate() - JOURS_RETARD);
  /* `dateAbsence` est un « AAAA-MM-JJ » : la comparaison de chaînes suffit. */
  const borne = enJour(limite);
  const anciennes = enAttente.filter((absence) => absence.dateAbsence < borne).length;

  return {
    cle: 'absences',
    Icone: UserX,
    niveau: 'alerte',
    texte: `${enAttente.length} absence(s) formateur sans rattrapage`,
    detail: anciennes > 0 ? `dont ${anciennes} depuis plus de ${JOURS_RETARD} jours` : undefined,
    action: 'Registre',
    vers: '/app/absences?filtre=attente',
  };
}

function ligneChronogrammes(groupes) {
  const manquants = (groupes ?? []).filter((groupe) => !groupe.planifie);
  if (manquants.length === 0) return null;

  return {
    cle: 'chronogrammes',
    Icone: Waypoints,
    niveau: 'attention',
    texte: `${manquants.length} groupe(s) sans chronogramme`,
    ...apercu(
      manquants.map((groupe) => ({ libelle: groupe.groupe, vers: chronogrammeDuGroupe(groupe.groupe) }))
    ),
    action: 'Planifier',
    vers: chronogrammeDuGroupe(manquants[0].groupe),
  };
}

/**
 * Les formateurs au-delà du seuil hebdomadaire, en semaine en cours ou
 * suivante — le même seuil que le tableau « Charge formateurs ».
 */
function ligneCharge(formateurs, numero, identites) {
  if (!formateurs || !numero) return null;

  const surcharges = Object.entries(formateurs)
    .filter(([, charge]) =>
      [numero, numero + 1].some((cible) => (charge.semaines?.[cible]?.total ?? 0) > SEUIL_HEBDOMADAIRE)
    )
    .map(([nom]) => nom);

  if (surcharges.length === 0) return null;

  /* Nom → identifiant, sans tenir compte de la casse ni des espaces. */
  const parNom = new Map(
    (identites ?? []).map((formateur) => [normaliser(formateur.nom), formateur.identifiant])
  );
  const cibles = surcharges.map((nom) => {
    const identifiant = parNom.get(normaliser(nom));
    return {
      libelle: nom,
      /* Introuvable : le chronogramme en mode groupe, où « Charge formateurs » le montre. */
      vers: identifiant
        ? `/app/parametres/chronogramme?${new URLSearchParams({ formateur: identifiant })}`
        : '/app/parametres/chronogramme',
    };
  });

  return {
    cle: 'charge',
    Icone: Clock,
    niveau: 'attention',
    texte: `${surcharges.length} formateur(s) au-delà de ${SEUIL_HEBDOMADAIRE} h`,
    detail: `S${numero} ou S${numero + 1}`,
    ...apercu(cibles),
    action: 'Voir',
    vers: cibles[0].vers,
  };
}

function ligneMessages(nonLus) {
  if (!nonLus) return null;

  return {
    cle: 'messages',
    Icone: Mail,
    niveau: 'info',
    texte: `${nonLus} message(s) non lu(s)`,
    action: 'Ouvrir',
    vers: '/app/messagerie?nonlus=1',
  };
}

/**
 * Modules partagés entre présentiel et synchrone : le message de la vue
 * formateur du chronogramme, remonté à l'accueil (2026-10-01, demande du
 * porteur). Rien n'est faux — c'est une information à lire une fois, d'où
 * « Ignorer ».
 */
function lignePartagesType(partages) {
  if (!partages?.length) return null;

  /* Chaque personne concernée mène à SA grille, où le détail est affiché. */
  const personnes = new Map();
  for (const partage of partages) {
    for (const personne of [...partage.presentiel, ...partage.synchrone]) {
      personnes.set(personne.identifiant, personne.nom);
    }
  }
  const cibles = [...personnes]
    .sort(([, a], [, b]) => a.localeCompare(b, 'fr'))
    .map(([identifiant, nom]) => ({
      libelle: nom,
      vers: `/app/parametres/chronogramme?${new URLSearchParams({ formateur: identifiant })}`,
    }));

  const modules = partages.map((partage) => `${partage.code} (${partage.groupe})`);
  const signature = partages
    .map(
      (partage) =>
        `${partage.groupe}|${partage.code}|${partage.presentiel.map((p) => p.identifiant).join(',')}|${partage.synchrone.map((p) => p.identifiant).join(',')}`
    )
    .join(';');

  return {
    cle: 'partages-type',
    Icone: Split,
    niveau: 'info',
    texte: `${partages.length} module(s) partagé(s) entre présentiel et synchrone`,
    detail: modules.slice(0, 3).join(', ') + (modules.length > 3 ? ` +${modules.length - 3}` : ''),
    ...apercu(cibles),
    action: 'Voir',
    vers: cibles[0].vers,
    signature,
  };
}

/** Les trois premières cibles, puis « +N » : la ligne doit tenir sur une ligne. */
function apercu(cibles) {
  return { cibles: cibles.slice(0, 3), reste: Math.max(0, cibles.length - 3) };
}

const chronogrammeDuGroupe = (groupe) =>
  `/app/parametres/chronogramme?${new URLSearchParams({ groupe })}`;

const normaliser = (nom) => String(nom ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Date LOCALE en « AAAA-MM-JJ » — `toISOString()` rendrait le jour UTC. */
function enJour(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
