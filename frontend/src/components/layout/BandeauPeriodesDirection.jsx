import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Briefcase, GraduationCap, Info, Megaphone, Siren, X } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { cn } from '@/lib/utils';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import { chargerMesPeriodes } from '@/features/consultation/api';
import { chargerMesAnnonces } from '@/features/annonces/api';

/**
 * ═══ LE BANDEAU PASSANT ═══ — stages, formations et ANNONCES, sous l'en-tête,
 * sur toutes les pages (2026-10-10, demandes successives du porteur).
 *
 * Ce qui y défile :
 *   - DIRECTEUR / GESTIONNAIRE : tous les stages de groupe et formations de
 *     formateur qui commencent dans les 7 jours — ou durent aujourd'hui ;
 *   - FORMATEUR / STAGIAIRE (`session`) : SES périodes seulement, lues sur
 *     `/consultation/periodes` (scopé par le serveur), à la 2ᵉ personne ;
 *   - et, pour le directeur, le formateur et le stagiaire, les ANNONCES en
 *     cours qui leur sont adressées (`/annonces/mes`) : de l'administrateur au
 *     directeur, du directeur aux formateurs, du gestionnaire aux stagiaires.
 *
 * ═══ L'IMPORTANCE DONNE SA COULEUR AU BANDEAU ═══ Une annonce URGENTE le
 * passe au rouge, une IMPORTANTE à l'ambre ; une simple information, seule, le
 * laisse bleu. Les annonces défilent EN TÊTE, les plus graves d'abord — avant
 * les stages et formations, qui sont prévus de longue date.
 *
 * ⚠️ PASSANT, MAIS LISIBLE : le défilement s'arrête au survol, et sa vitesse
 * suit la longueur. ⚠️ TOUJOURS ANIMÉ : il se figeait sous `motion-reduce`, que
 * Windows coche dès qu'on coupe les effets visuels.
 *
 * ⚠️ MASQUABLE POUR LA JOURNÉE — mais une annonce NOUVELLE le fait revenir : la
 * croix retient ce qui défilait au moment du clic, pas seulement la date.
 *
 * @param {boolean} [lien] — l'étiquette mène à la page de saisie des stages.
 *   ⚠️ FAUX pour le gestionnaire : Stages n'est pas l'une de ses pages.
 * @param {string} [session] — le rôle d'une session formateur ou stagiaire.
 * @param {boolean} [annonces] — lire les annonces adressées au compte. ⚠️ FAUX
 *   pour le gestionnaire : il en publie, il n'en reçoit pas.
 */
const HORIZON_JOURS = 7;
const KEYFRAMES =
  '@keyframes bandeau-periodes-defilement { from { transform: translateX(0); } to { transform: translateX(-50%); } }';
const CLE_MASQUE = 'bandeauPeriodesDirection.masqueLe';

const ORDRE_IMPORTANCE = { urgente: 0, importante: 1, info: 2 };
const STYLES_IMPORTANCE = {
  urgente: { icone: Siren, teinte: 'text-destructive', bandeau: 'border-destructive/40 bg-destructive/10', etiquette: 'border-destructive/40 bg-destructive/20 hover:bg-destructive/30' },
  importante: { icone: AlertTriangle, teinte: 'text-warning', bandeau: 'border-warning/40 bg-warning/15', etiquette: 'border-warning/40 bg-warning/25 hover:bg-warning/35' },
  info: { icone: Info, teinte: 'text-primary', bandeau: 'border-primary/30 bg-primary/10', etiquette: 'border-primary/30 bg-primary/15 hover:bg-primary/25' },
};

function lireMasque() {
  try {
    return localStorage.getItem(CLE_MASQUE) ?? '';
  } catch {
    return '';
  }
}

export default function BandeauPeriodesDirection({ lien = true, session = null, annonces: avecAnnonces = false }) {
  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    enabled: !session,
    retry: false,
  });
  const miennes = useQuery({ queryKey: ['mes-periodes'], queryFn: chargerMesPeriodes, enabled: Boolean(session), retry: false });
  const recues = useQuery({
    queryKey: ['mes-annonces'],
    queryFn: chargerMesAnnonces,
    enabled: avecAnnonces,
    retry: false,
    // Une annonce publiée pendant la journée arrive sans recharger la page.
    refetchInterval: 5 * 60 * 1000,
  });
  const aujourdhui = enTexte(new Date());
  const [masque, setMasque] = useState(lireMasque);
  const [survol, setSurvol] = useState(false);

  const estStagiaire = session === ROLES.STAGIAIRE;
  const limite = enTexte(new Date(Date.now() + HORIZON_JOURS * 86400000));
  const concerne = (p) => p.fin >= aujourdhui && p.debut <= limite;
  const { stages = [], formations = [] } = session
    ? { [estStagiaire ? 'stages' : 'formations']: miennes.data?.periodes ?? [] }
    : contexte.data?.etablissement ?? {};

  const periodes = [
    ...stages
      .filter(concerne)
      .map((p) => ({ ...p, type: 'stage', nom: session ? `Votre stage${p.groupe ? ` (${p.groupe})` : ''}` : p.groupe })),
    ...formations
      .filter(concerne)
      .map((p) => ({ ...p, type: 'formation', nom: session ? 'Votre formation' : p.nomFormateur || p.matriculeFormateur })),
  ].sort((a, b) => a.debut.localeCompare(b.debut) || a.nom.localeCompare(b.nom, 'fr', { numeric: true }));

  const annonces = [...(recues.data?.annonces ?? [])].sort(
    (a, b) => (ORDRE_IMPORTANCE[a.importance] ?? 9) - (ORDRE_IMPORTANCE[b.importance] ?? 9)
  );

  /*
   * ═══ UNE ANNONCE EN COURS S'AFFICHE SEULE (2026-10-10, demande du porteur :
   * « si une annonce est programmée, elle doit s'afficher toute seule jusqu'à
   * l'écoulement de son délai ; après, les messages à venir apparaissent ») ═══
   * Les stages et formations attendent : mêlés à une annonce urgente, ils la
   * noieraient. Le serveur ne rend que les annonces EN COURS (début ≤ aujourd'hui
   * ≤ fin) : à sa date de fin, elle sort, et les périodes reviennent d'elles-mêmes.
   */
  if (annonces.length > 0) periodes.length = 0;
  const total = annonces.length + periodes.length;
  // Ce qui défile aujourd'hui : la croix ne masque que CELA.
  const signature = `${aujourdhui}|${annonces.map((a) => a.id).join(',')}|${periodes.length}`;
  if (total === 0 || masque === signature) return null;

  // La couleur : la plus grave des annonces ; à défaut, l'ambre des stages et formations.
  const ton = annonces[0]?.importance === 'urgente' ? 'urgente' : annonces.some((a) => a.importance === 'importante') || periodes.length > 0 ? 'importante' : 'info';
  const style = STYLES_IMPORTANCE[ton];
  const vers = session ? (estStagiaire ? '/app/mes-stages' : '/app/mes-formations') : '/app/parametres/stages';
  const titreEtiquette = annonces.length > 0 ? 'À la une' : 'Cette semaine';

  const masquer = () => {
    setMasque(signature);
    try {
      localStorage.setItem(CLE_MASQUE, signature);
    } catch {
      // Stockage refusé : le bandeau reviendra au prochain chargement.
    }
  };

  const liste = (doublon) => (
    <ul aria-hidden={doublon || undefined} className="flex shrink-0 items-center gap-8 pr-8">
      {annonces.map((annonce) => {
        const { icone: Icone, teinte } = STYLES_IMPORTANCE[annonce.importance] ?? STYLES_IMPORTANCE.info;
        return (
          <li key={`annonce-${annonce.id}`} className="flex items-center gap-1.5 whitespace-nowrap">
            <Icone className={cn('size-3.5', teinte)} />
            {annonce.importance !== 'info' && (
              <strong className={cn('font-semibold uppercase', teinte)}>
                {annonce.importance === 'urgente' ? 'Urgent' : 'Important'}
              </strong>
            )}
            <span className="font-medium">{annonce.texte.replace(/\s+/g, ' ')}</span>
            {annonce.auteur?.nom && <span className="text-muted-foreground">— {annonce.auteur.nom}</span>}
          </li>
        );
      })}
      {periodes.map((periode) => (
        <li key={`${periode.type}-${periode.nom}-${periode.debut}`} className="flex items-center gap-1.5 whitespace-nowrap">
          {periode.type === 'stage' ? (
            <Briefcase className="size-3.5 text-warning" />
          ) : (
            <GraduationCap className="size-3.5 text-primary" />
          )}
          <strong className="font-semibold">{periode.nom}</strong>
          <span>{session ? phraseSession(periode, aujourdhui) : phrase(periode, aujourdhui)}</span>
          <span className="tabular-nums text-muted-foreground">
            ({afficher(periode.debut)} → {afficher(periode.fin)})
          </span>
        </li>
      ))}
    </ul>
  );

  const contenuEtiquette = (
    <>
      {annonces.length > 0 && <Megaphone className={cn('size-3.5', style.teinte)} />}
      {titreEtiquette}
      <span className="rounded bg-background/70 px-1 tabular-nums">{total}</span>
    </>
  );

  return (
    <div
      role="status"
      aria-label={`${total} annonce(s), stage(s) ou formation(s)`}
      className={cn('flex h-8 shrink-0 items-center border-b text-xs print:hidden', style.bandeau)}
    >
      {lien ? (
        <Link
          to={vers}
          className={cn('flex h-full shrink-0 items-center gap-1.5 border-r px-3 font-semibold', style.etiquette)}
          title={session ? 'Voir le détail' : 'Ouvrir les stages'}
        >
          {contenuEtiquette}
        </Link>
      ) : (
        <span className={cn('flex h-full shrink-0 items-center gap-1.5 border-r px-3 font-semibold', style.etiquette)}>
          {contenuEtiquette}
        </span>
      )}

      {/*
        ⚠️ L'ANIMATION EST DÉCLARÉE ICI, PAS DANS `tailwind.config.js` : la classe
        dépendait d'une config que le serveur de dev ne relit qu'au redémarrage,
        et le bandeau restait figé. De DROITE à GAUCHE : la piste, doublée, glisse
        de 0 à -50 % — la copie prend alors pile la place de l'original.
      */}
      <style>{KEYFRAMES}</style>
      <div
        className="relative min-w-0 flex-1 overflow-hidden"
        onMouseEnter={() => setSurvol(true)}
        onMouseLeave={() => setSurvol(false)}
      >
        <div
          className="flex w-max"
          style={{
            animation: `bandeau-periodes-defilement ${Math.max(20, total * 8)}s linear infinite`,
            animationPlayState: survol ? 'paused' : 'running',
            willChange: 'transform',
          }}
        >
          {liste(false)}
          {liste(true)}
        </div>
      </div>

      <button
        type="button"
        onClick={masquer}
        className="mx-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground"
        title="Masquer jusqu’à demain (une nouvelle annonce le fera revenir)"
        aria-label="Masquer jusqu’à demain"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** À la 2ᵉ personne, pour le formateur ou le stagiaire concerné. */
function phraseSession({ type, debut, fin }, aujourdhui) {
  const suite = type === 'stage' ? 'aucune séance pour votre groupe' : 'aucune séance ne vous est placée';
  if (debut <= aujourdhui) return `en cours jusqu'au ${afficher(fin)} — ${suite}`;
  const dans = ecart(aujourdhui, debut);
  return `commence ${dans === 1 ? 'demain' : `dans ${dans} j`} — ${suite}`;
}

function phrase({ type, debut, fin }, aujourdhui) {
  if (debut <= aujourdhui) {
    return type === 'stage' ? `en stage jusqu'au ${afficher(fin)}` : `en formation jusqu'au ${afficher(fin)}`;
  }
  const dans = ecart(aujourdhui, debut);
  const quand = dans === 1 ? 'demain' : `dans ${dans} j`;
  return type === 'stage' ? `part en stage ${quand}` : `part en formation ${quand}`;
}

/** « AAAA-MM-JJ » en heure LOCALE. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const afficher = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

const ecart = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
