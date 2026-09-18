import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { CalendarRange, ChevronDown, Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ENTREES, RACCOURCIS } from '@/components/layout/navigation';
import { basculerFavori, useFavoris } from '@/lib/favoris';
import { depuis } from '@/lib/derniereModification';
import { useVisites } from '@/lib/visites';
import { api } from '@/lib/apiClient';
import { apparenceMeteo } from './meteo';
import { cn } from '@/lib/utils';
import { recupererSession } from '@/features/auth/api';
import { chargerContexte, chargerSemaines } from '@/features/emploi/api';
import { chargerAbsences } from '@/features/absences/api';
import { chargerGroupesChronogramme } from '@/features/chronogramme/api';
import { chargerStatistiquesStagiaires } from '@/features/documents/api';
import ProgressionAccueil from './ProgressionAccueil';

/**
 * Accueil de l'espace applicatif.
 * ← la page d'accueil de Plane, dont le porteur a fourni la maquette
 *
 * ═══ TROIS SECTIONS, ET RIEN D'AUTRE ═══
 * Un tableau de bord, les liens rapides, les pages récentes. La maquette portait
 * en plus un encart d'assistant conversationnel : écarté à la demande du
 * porteur, remplacé par les chiffres de l'établissement — ce qu'on vient
 * réellement vérifier en ouvrant l'application.
 *
 * ⚠️ AUCUNE ROUTE NOUVELLE. Les quatre chiffres viennent d'endpoints qui
 * existent et que les écrans métier interrogent déjà : ils sont donc en cache
 * dès qu'on a ouvert l'un d'eux, et l'accueil ne coûte alors rien.
 */
export default function AccueilApp() {
  const navigate = useNavigate();

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  if (session.isLoading) return <Etat>Chargement de la session…</Etat>;

  if (session.isError) {
    return (
      <Etat>
        Session expirée.{' '}
        <Button variant="link" className="px-1" onClick={() => navigate('/connexion')}>
          Se reconnecter
        </Button>
      </Etat>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 py-4">
      <Salutation nom={session.data.utilisateur.nomComplet} />
      <TableauDeBord />
      {/* ⚠️ APRÈS LES TUILES : celles-ci disent un ÉTAT — combien de formateurs,
          de groupes, de séances. Le graphe dit une TENDANCE, et se lit une fois
          qu'on sait de quoi il parle. */}
      <ProgressionAccueil />
      <LiensRapides />
      <Recents />
    </div>
  );
}

/**
 * ⚠️ `/api/v2` EN ENTIER : `api.get` ne préfixe RIEN, chaque module écrit le
 * chemin complet. Omis, Vite répond 200 avec `index.html` et la requête se
 * présente comme une réponse vide légitime — le piège déjà payé deux fois.
 */
const chargerMeteo = () => api.get('/api/v2/meteo');

/**
 * Le moment de la journée — la salutation ET son emblème, décidés ENSEMBLE.
 *
 * ⚠️ « BONSOIR » DÈS 17 H (correction du porteur, 2026-09-01 : à 17 h 14 l'écran
 * disait encore « Bonjour »). Le seuil de 18 h est celui des dictionnaires ; ce
 * n'est pas celui de l'usage, et encore moins celui d'un établissement dont la
 * journée de cours s'achève en fin d'après-midi.
 *
 * ⚠️ UNE SEULE TABLE POUR LES DEUX : le mot et l'emoji vivaient sur deux
 * échelles différentes — un seuil à 18 h pour l'image, aucun pour le mot. Les
 * séparer laissait « Bonsoir » à côté d'un plein soleil pendant une heure. Le
 * crépuscule couvre 17 h → 21 h, la nuit prend ensuite : l'image ne contredit la
 * salutation à aucune heure.
 */
function momentDuJour(heure) {
  if (heure < 12) return { salutation: 'Bonjour', emoji: '🌤️' };
  if (heure < 17) return { salutation: 'Bonjour', emoji: '☀️' };
  if (heure < 21) return { salutation: 'Bonsoir', emoji: '🌆' };
  return { salutation: 'Bonsoir', emoji: '🌙' };
}

/**
 * « Bonjour, Mouad » et la date du jour.
 *
 * ⚠️ L'HEURE SE RAFRAÎCHIT CHAQUE MINUTE. Affichée une fois au montage, elle
 * resterait figée sur un onglet laissé ouvert toute la journée — et une heure
 * fausse en tête de page est pire que pas d'heure du tout.
 */
function Salutation({ nom }) {
  const [maintenant, setMaintenant] = useState(() => new Date());

  useEffect(() => {
    const minuterie = setInterval(() => setMaintenant(new Date()), 60000);
    return () => clearInterval(minuterie);
  }, []);

  const { salutation, emoji } = momentDuJour(maintenant.getHours());

  /*
   * ⚠️ LA MÉTÉO EST UN AGRÉMENT, JAMAIS UNE CONDITION. `retry: false` et un
   * repli sur l'emblème horaire : ni un lieu non reconnu, ni une API muette ne
   * doivent laisser un trou en tête de l'accueil. C'est aussi pourquoi elle ne
   * suspend rien — la ligne s'affiche tout de suite avec l'émoji, et l'icône la
   * remplace quand la réponse arrive.
   */
  const meteo = useQuery({
    queryKey: ['meteo'],
    queryFn: chargerMeteo,
    retry: false,
    /* Le service tient déjà un cache d'une demi-heure : le redemander à chaque
       retour sur l'accueil ne rendrait rien de neuf. */
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return (
    <header className="space-y-1 text-center">
      <h2 className="text-2xl font-semibold">
        {salutation}, {prenom(nom)}
      </h2>
      <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
        <Embleme meteo={meteo.data?.meteo} emoji={emoji} />
        {/* ⚠️ Le français rend « mardi » en minuscule ; en tête de ligne, la
            capitale est ce qu'on attend d'une date. */}
        {capitale(
          maintenant.toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })
        )}{' '}
        {maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </header>
  );
}

/**
 * Ce qui ouvre la ligne de date : le temps qu'il fait, ou l'heure qu'il est.
 *
 * ═══ ⚠️ DEUX CHOSES DE NATURES DIFFÉRENTES, ET ELLES SE DISTINGUENT ═══
 * L'icône lucide est une MESURE — le ciel de la ville de l'établissement, à
 * l'instant. L'émoji est un EMBLÈME horaire, déduit de la pendule. Les rendre
 * pareils laisserait croire que le repli est une information ; l'écart de forme
 * suffit à dire lequel des deux on regarde, sans rien écrire.
 *
 * ⚠️ LA TEMPÉRATURE ACCOMPAGNE L'ICÔNE, sans la remplacer : « 24 °C » se lit
 * d'un coup et lève l'ambiguïté d'un nuage — couvert et doux, ou couvert et
 * froid. Elle disparaît si l'API ne l'a pas rendue.
 */
function Embleme({ meteo, emoji }) {
  if (!meteo) return <span aria-hidden="true">{emoji}</span>;

  const { Icone, libelle } = apparenceMeteo(meteo.code, meteo.estJour);

  return (
    <span
      className="inline-flex items-center gap-1"
      /* Le lieu est NOMMÉ : sans lui, on rapporterait la météo à l'endroit où
         l'on se trouve, qui n'est pas forcément celui de l'établissement. */
      title={`${libelle} à ${capitale(meteo.ville)}`}
    >
      <Icone className="size-4" aria-label={libelle} />
      {typeof meteo.temperature === 'number' && (
        <span className="tabular-nums">{meteo.temperature} °C</span>
      )}
      <span aria-hidden="true">·</span>
    </span>
  );
}

/**
 * Les quatre chiffres de l'établissement.
 *
 * ⚠️ CHAQUE TUILE MÈNE À L'ÉCRAN QUI LA CORRIGE. Un chiffre qu'on ne peut pas
 * suivre n'est qu'une décoration : « 3 sans rattrapage » n'a d'intérêt que si le
 * registre est à un clic.
 */
function TableauDeBord() {
  const [contexte, semaines, absences, chronogrammes, stagiaires] = useQueries({
    queries: [
      { queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, retry: false },
      { queryKey: ['emploi', 'semaines'], queryFn: chargerSemaines, retry: false },
      { queryKey: ['absences', 'toutes'], queryFn: () => chargerAbsences({}), retry: false },
      { queryKey: ['chronogrammes'], queryFn: chargerGroupesChronogramme, retry: false },
      {
        queryKey: ['stagiaires', 'statistiques'],
        queryFn: chargerStatistiquesStagiaires,
        retry: false,
      },
    ],
  });

  /*
   * ⚠️ SANS BASE, PAS DE CHIFFRES — ET ON LE DIT. Le contexte répond 404 tant
   * qu'aucune base n'a été importée : afficher « 0 formateur » laisserait croire
   * à un établissement vide alors que la configuration n'a pas commencé.
   */
  if (contexte.isError) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Votre établissement n’a pas encore de base</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les chiffres apparaîtront ici dès que vos formateurs et vos groupes seront connus.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/app/parametres/affectations">Construire la carte</Link>
        </Button>
      </section>
    );
  }

  const groupes = chronogrammes.data?.groupes ?? [];
  const remplies = (semaines.data?.semaines ?? []).filter((entree) => entree.seances > 0).length;
  const sansRattrapage = (absences.data?.absences ?? []).filter((a) => !a.dateRattrapage).length;

  return (
    /* ⚠️ TROIS PAR RANGÉE, pas quatre : à six tuiles, quatre colonnes laissaient
       une seconde rangée à moitié vide. Deux rangées pleines se lisent mieux. */
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tuile
        libelle="Formateurs"
        valeur={contexte.data?.formateurs?.length}
        chargement={contexte.isLoading}
        vers="/app/parametres/formateurs"
      />
      <Tuile
        libelle="Groupes"
        valeur={contexte.data?.groupes?.length}
        chargement={contexte.isLoading}
        vers="/app/parametres/affectations"
      />
      {/*
        ⚠️ LES STAGIAIRES NE VIENNENT PAS DE LA BASE E-NOTE mais de l'import
        KONOSYS (une base par année scolaire) : leur tuile mène donc à
        « Documents », pas aux « Affectations ». Les envoyer ailleurs ferait
        chercher un import qui ne s'y trouve pas.
      */}
      <Tuile
        libelle="Stagiaires"
        valeur={stagiaires.data?.total}
        detail={
          stagiaires.data?.nombreGroupes
            ? `${stagiaires.data.nombreGroupes} groupe(s) pourvu(s)`
            : undefined
        }
        chargement={stagiaires.isLoading}
        vers="/app/documents"
      />
      <Tuile
        libelle="Salles"
        valeur={contexte.data?.salles?.length}
        chargement={contexte.isLoading}
        vers="/app/parametres/espaces"
      />
      <Tuile
        libelle="Semaines saisies"
        valeur={remplies}
        detail={
          groupes.length > 0
            ? `${groupes.filter((g) => g.planifie).length} / ${groupes.length} chronogrammes`
            : undefined
        }
        chargement={semaines.isLoading}
        vers="/app/emploi"
      />
      <Tuile
        libelle="Sans rattrapage"
        valeur={sansRattrapage}
        /* Le seul chiffre qui APPELLE une action : les autres décrivent un état. */
        alerte={sansRattrapage > 0}
        chargement={absences.isLoading}
        vers="/app/absences"
      />
    </section>
  );
}

function Tuile({ libelle, valeur, detail, alerte, chargement, vers }) {
  return (
    <Link
      to={vers}
      className="rounded-lg border p-4 transition-colors hover:border-input hover:bg-muted/40"
    >
      <p className="text-xs text-muted-foreground">{libelle}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          alerte && 'text-destructive'
        )}
      >
        {chargement ? '—' : (valeur ?? 0)}
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Link>
  );
}

/**
 * Les favoris, en cartes.
 *
 * ⚠️ CE SONT LES MÊMES QUE L'ÉTOILE DE L'EN-TÊTE, pas une seconde liste. Deux
 * listes de raccourcis à tenir à jour, c'est la garantie qu'elles divergent —
 * et la barre latérale les affiche déjà en tête.
 */
function LiensRapides() {
  const favoris = useFavoris();
  const restants = ENTREES.filter((entree) => !favoris.includes(entree.url));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Liens rapides</h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <Plus className="size-3.5" />
              Ajouter un lien rapide
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Les pages déjà en favori n’y figurent plus
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {restants.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs">
                Toutes les pages sont déjà en lien rapide
              </DropdownMenuItem>
            ) : (
              restants.map((entree) => (
                <DropdownMenuItem
                  key={entree.url}
                  className="text-xs"
                  onClick={() => basculerFavori(entree.url)}
                >
                  {entree.icone && <entree.icone className="size-3.5" />}
                  {entree.titre}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {favoris.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Star className="mx-auto mb-2 size-5 opacity-50" />
          Aucun lien rapide. L’étoile en haut de chaque page en ajoute un.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {favoris.map((chemin) => (
            <CartePage key={chemin} chemin={chemin} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Les pages récemment ouvertes.
 *
 * ⚠️ OUVERTES, PAS ENREGISTRÉES — voir `lib/visites.js`. On revient dix fois sur
 * l'emploi du temps pour une saisie : le lier à l'écriture ferait disparaître
 * d'ici les pages qu'on regarde le plus.
 */
function Recents() {
  const visites = useVisites();
  const [section, setSection] = useState(null);

  const entrees = Object.entries(visites)
    .map(([chemin, horodatage]) => ({ chemin, horodatage, entree: entreeDe(chemin) }))
    .filter(({ entree }) => entree)
    .sort((a, b) => b.horodatage - a.horodatage);

  const sections = [...new Set(entrees.map(({ chemin }) => sectionDe(chemin)))];
  const visibles = section ? entrees.filter(({ chemin }) => sectionDe(chemin) === section) : entrees;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Récents</h3>

        {/* Le filtre n'apparaît QUE s'il y a plus d'une section à distinguer :
            un menu à une seule entrée ne fait que prendre la place. */}
        {sections.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                {section ?? 'Tous'}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="text-xs" onClick={() => setSection(null)}>
                Tous
              </DropdownMenuItem>
              {sections.map((nom) => (
                <DropdownMenuItem key={nom} className="text-xs" onClick={() => setSection(nom)}>
                  {nom}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-lg border bg-muted/40 p-10 text-center text-sm text-muted-foreground">
          <CalendarRange className="mx-auto mb-2 size-6 opacity-40" />
          Vous n’avez pas encore ouvert d’écran.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map(({ chemin, horodatage }) => (
            <CartePage key={chemin} chemin={chemin} horodatage={horodatage} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Une page, en carte : son icône, son nom, et quand on y est passé.
 *
 * ⚠️ SANS HORODATAGE, ON NOMME LA SECTION plutôt qu'une date inventée. Un
 * favori posé avant que l'historique n'existe n'a pas de date : « il y a
 * longtemps » serait faux, et une ligne vide laisserait croire à un défaut.
 */
function CartePage({ chemin, horodatage }) {
  const entree = entreeDe(chemin);
  if (!entree) return null;

  const Icone = entree.icone;

  return (
    <Link
      to={chemin}
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-input hover:bg-muted/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {Icone ? <Icone className="size-4 text-muted-foreground" /> : null}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{entree.titre}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {horodatage ? depuis(horodatage) : sectionDe(chemin)}
        </span>
      </span>
    </Link>
  );
}

/** L'entrée de navigation d'un chemin — la plus SPÉCIFIQUE, comme la coquille. */
function entreeDe(chemin) {
  return [...ENTREES, ...RACCOURCIS]
    .sort((a, b) => b.url.length - a.url.length)
    .find((entree) => chemin.startsWith(entree.url));
}

/** « Paramètres » ou « Espace de travail » — ce qui coiffe la page. */
function sectionDe(chemin) {
  return chemin.startsWith('/app/parametres') ? 'Paramètres' : 'Espace de travail';
}

/**
 * Le prénom seul.
 *
 * ⚠️ LE PREMIER MOT, pas le dernier : « MOUAD NOUZRI » se salue par « Mouad ».
 * Les noms de la base sont en capitales — on rend une casse lisible, sinon la
 * salutation crie.
 */
const capitale = (texte) => (texte ? texte[0].toUpperCase() + texte.slice(1) : texte);

function prenom(nomComplet) {
  const premier = String(nomComplet ?? '').trim().split(/\s+/)[0] ?? '';
  return premier ? premier[0].toUpperCase() + premier.slice(1).toLowerCase() : '';
}

function Etat({ children }) {
  // Un `div` : l'écran vit dans la coquille, qui porte le `<main>`.
  return (
    <div className="flex items-center justify-center py-24">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
