import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ExternalLink, FileText, PenLine, PlayCircle, Search } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { ThinkingOrb } from 'thinking-orbs';
import Alerte from '@/components/common/Alerte';
import { chargerRessourcesModule } from './api';

/**
 * Tiroir de droite — les ressources en ligne d'un module du programme.
 * ← le tiroir de `tableMatieres.html` (onglets vidéos / cours / exercices).
 *
 * La recherche est faite par le SERVEUR (DuckDuckGo + YouTube, mots-clés
 * « ofppt », « ofppt life », « ofppt info ») : le navigateur ne pourrait pas
 * lire ces pages lui-même, et le résultat est mis en cache pour tous.
 *
 * ⚠️ `enabled` SUIT L'OUVERTURE : la requête ne part qu'au clic sur un module,
 * jamais pour les dix-sept lignes du tableau au chargement de la page.
 */
const TYPES = [
  { cle: 'videos', libelle: 'Vidéos', Icone: PlayCircle },
  { cle: 'cours', libelle: 'Cours', Icone: BookOpen },
  { cle: 'exercices', libelle: 'Exercices', Icone: PenLine },
];

export default function TiroirRessources({ module, onFermer }) {
  const [type, setType] = useState('videos');
  const intitule = module?.intitule || module?.module || '';

  const requete = useQuery({
    /* ⚠️ LE GROUPE EST DANS LA CLÉ : c'est lui qui fixe la filière, donc la
       recherche — un même module suivi en FQ n'a pas les mêmes ressources. */
    queryKey: ['consultation', 'ressources', intitule, module?.groupe ?? ''],
    queryFn: () =>
      chargerRessourcesModule({ intitule, code: module?.module ?? '', groupe: module?.groupe ?? '' }),
    enabled: Boolean(module && intitule),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const videos = requete.data?.videos ?? [];
  const cours = requete.data?.cours ?? [];
  const exercices = requete.data?.exercices ?? [];
  const filiere = requete.data?.filiere ?? '';
  const listes = { videos, cours, exercices };
  const rechercheWeb = `https://duckduckgo.com/?q=${encodeURIComponent(
    [intitule, filiere, 'ofppt'].filter(Boolean).join(' ')
  )}`;

  return (
    <Sheet open={Boolean(module)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      {/* ⚠️ PLUS LARGE QUE LA VARIANTE (`sm:max-w-sm`) : une miniature de vidéo
          et son titre ne tiennent pas dans 384 px. */}
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-5 pr-12 text-left">
          <SheetTitle className="leading-snug">{intitule}</SheetTitle>
          <SheetDescription>
            {module?.intitule && module?.module ? `${module.module} · ` : ''}
            Ressources trouvées sur le web
          </SheetDescription>
          {filiere && (
            <p className="text-xs text-muted-foreground">
              Filière : <span className="font-medium text-foreground">{filiere}</span>
            </p>
          )}
        </SheetHeader>

        {/* ⚠️ UN `ButtonGroup`, PAS DES ONGLETS (2026-09-28, demande du porteur) :
            un choix exclusif, la forme que la charte réserve à ce composant. */}
        <ButtonGroup className="mx-5 mt-4 w-auto">
          {TYPES.map(({ cle, libelle, Icone }) => (
            <Button
              key={cle}
              type="button"
              variant={type === cle ? 'default' : 'outline'}
              size="sm"
              aria-pressed={type === cle}
              className="h-8 flex-1 gap-1.5 text-xs"
              onClick={() => setType(cle)}
            >
              <Icone className="size-3.5" />
              {libelle}
              {!requete.isLoading && <Compte n={listes[cle].length} actif={type === cle} />}
            </Button>
          ))}
        </ButtonGroup>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
          {requete.isLoading ? (
            <Chargement />
          ) : requete.isError ? (
            <Alerte type="erreur" titre="Recherche impossible">
              {requete.error.message}
            </Alerte>
          ) : listes[type].length === 0 ? (
            <Vide />
          ) : type === 'videos' ? (
            <div className="space-y-3">
              {videos.map((video) => (
                <CarteVideo key={video.id} video={video} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {listes[type].map((page) => (
                <CartePage key={page.url} page={page} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3">
          <a
            href={rechercheWeb}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Search className="size-4" /> Poursuivre la recherche sur le web
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Compte({ n, actif }) {
  return (
    <span
      className={`rounded-full px-1.5 text-[0.65rem] tabular-nums ${
        actif ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
      }`}
    >
      {n}
    </span>
  );
}

function CarteVideo({ video }) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 rounded-lg border p-2 transition-colors hover:bg-muted/50"
    >
      <div className="relative w-40 shrink-0 overflow-hidden rounded-md bg-muted">
        <img
          src={video.miniature}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-video w-full object-cover"
        />
        {video.duree && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[0.65rem] font-medium text-white">
            {video.duree}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="line-clamp-2 text-sm font-medium group-hover:text-primary">{video.titre}</div>
        {video.chaine && <div className="mt-1 truncate text-xs text-muted-foreground">{video.chaine}</div>}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[video.vues && `${video.vues} vues`, video.publiee].filter(Boolean).join(' · ')}
        </div>
      </div>
    </a>
  );
}

function CartePage({ page }) {
  const Icone = page.format === 'pdf' ? FileText : ExternalLink;
  return (
    <a
      href={page.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start gap-2">
        <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium group-hover:text-primary">{page.titre}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{page.source}</span>
            {page.format === 'pdf' && (
              <span className="rounded bg-destructive/10 px-1 text-[0.6rem] font-semibold text-destructive">PDF</span>
            )}
            {/* EFM / EFF : un examen se distingue d'un simple exercice. */}
            {(page.etiquette === 'EFM' || page.etiquette === 'EFF') && (
              <span className="rounded bg-primary/10 px-1 text-[0.6rem] font-semibold text-primary">
                {page.etiquette}
              </span>
            )}
          </div>
          {page.extrait && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{page.extrait}</p>}
        </div>
      </div>
    </a>
  );
}

/**
 * ⚠️ L'ORBE `searching`, DANS L'HABILLAGE DE LA GÉNÉRATION (`DialogueGeneration`) :
 * disque `bg-primary/5`, encre `#0075de` recopiée littéralement — la librairie
 * peint sur un canevas, où une variable CSS ne résout pas. La durée est
 * inconnue (quelques secondes, selon les moteurs) : d'où le texte scintillant
 * plutôt qu'une barre de progression.
 */
function Chargement() {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <div className="rounded-full bg-primary/5 p-5">
        <ThinkingOrb state="searching" size={64} color="#0075de" aria-label="Recherche des ressources en cours" />
      </div>
      <p className="text-center text-base font-medium texte-scintillant [--scintille-base:var(--primary)/0.45] [--scintille-eclat:var(--primary)]">
        Recherche sur le web…
      </p>
    </div>
  );
}

function Vide() {
  return <p className="py-8 text-center text-sm text-muted-foreground">Aucune ressource trouvée pour ce module.</p>;
}
