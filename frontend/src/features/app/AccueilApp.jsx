import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Star } from 'lucide-react';
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
import { api } from '@/lib/apiClient';
import { apparenceMeteo } from './meteo';
import { recupererSession } from '@/features/auth/api';
import TableauDeBordAccueil from './TableauDeBordAccueil';

/**
 * Accueil de l'espace applicatif.
 * ← la page d'accueil de Plane, dont le porteur a fourni la maquette
 *
 * ═══ DEUX SECTIONS, ET RIEN D'AUTRE ═══
 * Un tableau de bord et les liens rapides (« Récents » retiré le 2026-09-30,
 * demande du porteur). La maquette portait
 * en plus un encart d'assistant conversationnel : écarté à la demande du
 * porteur, remplacé par les chiffres de l'établissement — ce qu'on vient
 * réellement vérifier en ouvrant l'application.
 *
 * Le tableau de bord du directeur vit dans `TableauDeBordAccueil` : tuiles,
 * « À traiter », trajectoire, statut des groupes, modules à risque, service
 * des formateurs (2026-09-28).
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
      <TableauDeBordAccueil />
      <LiensRapides />
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
export function Salutation({ nom }) {
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
 * Les favoris, en cartes.
 *
 * ⚠️ CE SONT LES MÊMES QUE L'ÉTOILE DE L'EN-TÊTE, pas une seconde liste. Deux
 * listes de raccourcis à tenir à jour, c'est la garantie qu'elles divergent —
 * et la barre latérale les affiche déjà en tête.
 */
export function LiensRapides() {
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
 * Une page, en carte : son icône, son nom et sa section.
 */
function CartePage({ chemin }) {
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
          {sectionDe(chemin)}
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

export function Etat({ children }) {
  // Un `div` : l'écran vit dans la coquille, qui porte le `<main>`.
  return (
    <div className="flex items-center justify-center py-24">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
