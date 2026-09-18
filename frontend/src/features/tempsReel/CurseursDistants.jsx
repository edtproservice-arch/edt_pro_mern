import { useEffect, useReducer } from 'react';
import { useCurseurs } from '@/lib/tempsReel';
import { cn } from '@/lib/utils';
import { couleurPresence } from './couleurs';
import { englober, etiquetteCurseur, memeVue, pointDansConteneur, rognerBoite } from './positions';

/** Le rectangle d'une case chez SOI — ses trois lignes réunies. */
/*
 * `unique` (2026-09-13, chronogramme) : une cellule n'y occupe qu'UN élément,
 * mais peut apparaître dans DEUX blocs — un module co-enseigné figure dans la
 * grille de chacun de ses formateurs. Englober les deux dessinerait une case
 * géante entre les deux blocs : on prend la première VISIBLE. L'emploi du temps,
 * lui, englobe — sa case s'étale sur trois lignes du tableau.
 */
/*
 * Rend `{ pleine, visible }` : la case entière (pour y reprojeter un curseur) et
 * sa part visible (pour le cadre, et pour masquer un curseur qui tomberait hors
 * d'elle).
 */
function boiteDe(conteneur, cle, unique = false) {
  const cases = [...conteneur.querySelectorAll(`[data-case="${CSS.escape(cle)}"]`)];
  if (!unique) {
    const boite = englober(cases.map((element) => element.getBoundingClientRect()));
    return boite && { pleine: boite, visible: boite };
  }

  for (const element of cases) {
    const r = element.getBoundingClientRect();
    const pleine = { left: r.left, top: r.top, width: r.width, height: r.height };
    const visible = rognerBoite(pleine, zoneLibre(element));
    if (visible) return { pleine, visible };
  }
  return null;
}

/*
 * ⚠️ UNE CELLULE DÉFILÉE HORS DE SA GRILLE N'EST PAS VISIBLE, même si elle
 * reste dans le cadre de la page : le calque des curseurs couvre la PAGE, pas
 * chaque tableau. Sans ce contrôle, le curseur d'un collègue sur la S40 se
 * dessinerait par-dessus la colonne S8 de celui qui n'a pas défilé.
 *
 * ⚠️ ET LES COLONNES COLLANTES DE SA LIGNE LA RECOUVRENT (trouvé à l'écran,
 * 2026-09-13) : une semaine glissée sous « Formateur » ou sous « MHP » est
 * cachée, mais reste dans le cadre de défilement — le cadre « X modifie » se
 * peignait par-dessus les masses. Les deux cellules qui bordent les semaines
 * portent `data-colle` ; la zone libre s'arrête à elles.
 */
function zoneLibre(element) {
  const defile = element.closest('[data-defile]');
  if (!defile) return null;
  const d = defile.getBoundingClientRect();
  const zone = { left: d.left, right: d.right, top: d.top, bottom: d.bottom };
  for (const colle of element.closest('tr')?.querySelectorAll('[data-colle]') ?? []) {
    const c = colle.getBoundingClientRect();
    if (colle.dataset.colle === 'gauche') zone.left = Math.max(zone.left, c.right);
    else zone.right = Math.min(zone.right, c.left);
  }
  return zone;
}

const dedans = (point, repere, boite) => {
  const x = point.left + repere.left;
  const y = point.top + repere.top;
  return x >= boite.left && x <= boite.left + boite.width && y >= boite.top && y <= boite.top + boite.height;
};

/**
 * Les curseurs et les cases ouvertes des AUTRES, par-dessus la grille — la
 * couche « multijoueur » de Notion et Figma (Phase 5bis, étape b).
 *
 * ═══ ⚠️ UNE COUCHE À PART, ABONNÉE À SON PROPRE MAGASIN ═══
 * Les curseurs arrivent jusqu'à vingt fois par seconde et par collègue. Seule
 * cette couche se re-rend à ce rythme ; la grille et ses 1 224 cases n'en
 * savent rien. Posée en `absolute` dans le conteneur de la grille, elle défile
 * avec elle, et `pointer-events-none` la rend transparente aux clics.
 *
 * ⚠️ LA POSITION EST REPROJETÉE SUR NOTRE GRILLE à chaque rendu : on relit le
 * rectangle de la case chez nous. Un redimensionnement de fenêtre, un zoom ou
 * une barre latérale repliée déplacent les cases — d'où l'écoute du `resize` et
 * la dépendance au zoom.
 *
 * ⚠️ LA COULEUR EST CELLE DE L'AVATAR (`couleurPresence`) : c'est ce qui
 * rattache la flèche au visage de la pile, et l'étiquette le nomme en toutes
 * lettres.
 */
/*
 * `repli(cle)` (2026-09-13, affectations) : la clé à essayer quand la case
 * ouverte d'un collègue n'existe pas chez soi. Sur la carte, les ensembles sont
 * REPLIÉS d'office : la cellule qu'il saisit n'est pas montée, mais l'en-tête de
 * son ensemble l'est — le cadre « X modifie » s'y pose, et on sait où il
 * travaille. Seul le CADRE se replie : un curseur reprojeté sur un en-tête
 * désignerait un endroit où la souris n'est pas.
 */
export default function CurseursDistants({ page, vue, conteneurRef, zoom, unique = false, repli }) {
  const curseurs = useCurseurs(page);
  const [, remesurer] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    window.addEventListener('resize', remesurer);
    /*
     * ⚠️ ET AU DÉFILEMENT, DE LA PAGE COMME D'UNE GRILLE : les positions sont
     * mesurées à l'écran, et sans remesure un curseur resterait accroché là où la
     * cellule SE TROUVAIT. En capture, pour entendre les grilles qui défilent
     * d'elles-mêmes ; au plus une fois par image.
     */
    let image = null;
    const auDefilement = () => {
      if (image) return;
      image = requestAnimationFrame(() => {
        image = null;
        remesurer();
      });
    };
    document.addEventListener('scroll', auDefilement, true);
    return () => {
      window.removeEventListener('resize', remesurer);
      document.removeEventListener('scroll', auDefilement, true);
      if (image) cancelAnimationFrame(image);
    };
  }, []);

  // Le zoom change la taille des cases sans rien envoyer : on remesure après.
  useEffect(() => {
    const minuteur = setTimeout(remesurer, 50);
    return () => clearTimeout(minuteur);
  }, [zoom]);

  const conteneur = conteneurRef.current;
  if (!conteneur || curseurs.size === 0) return null;
  const repere = conteneur.getBoundingClientRect();

  const elements = [];
  for (const [connexion, { utilisateur, position, focus }] of curseurs) {
    const couleur = couleurPresence(utilisateur.id);
    const etiquette = etiquetteCurseur(utilisateur.nom);

    /*
     * La case OUVERTE d'abord, dessous : le cadre dit « ne touche pas à
     * celle-ci, elle est en train d'être saisie ». Sans lui, deux personnes
     * rempliraient la même case sans le savoir, et la seconde écraserait la
     * première.
     */
    if (memeVue(focus, vue)) {
      const cleRepli = repli?.(focus.cle);
      const boite = (
        boiteDe(conteneur, focus.cle, unique) ?? (cleRepli ? boiteDe(conteneur, cleRepli, unique) : null)
      )?.visible;
      if (boite) {
        elements.push(
          <div
            key={`focus-${connexion}`}
            className={cn('absolute rounded-sm border-2', couleur.bordure)}
            style={{
              left: boite.left - repere.left,
              top: boite.top - repere.top,
              width: boite.width,
              height: boite.height,
            }}
          >
            <span
              className={cn(
                'absolute -top-4 left-[-2px] whitespace-nowrap rounded-t-sm px-1 text-[0.6rem] font-semibold leading-4 text-white',
                couleur.fond
              )}
            >
              {etiquette} modifie
            </span>
          </div>
        );
      }
    }

    if (memeVue(position, vue)) {
      const boite = boiteDe(conteneur, position.cle, unique);
      const point = boite && pointDansConteneur(boite.pleine, repere, position);
      if (point && dedans(point, repere, boite.visible)) {
        elements.push(
          <div
            key={`curseur-${connexion}`}
            className="absolute transition-[left,top] duration-75 ease-linear"
            style={{ left: point.left, top: point.top }}
          >
            {/* La flèche : le bout est à (0, 0), là où la souris se trouve. */}
            <svg
              viewBox="0 0 16 16"
              className={cn('size-4 drop-shadow-sm', couleur.texte)}
              aria-hidden="true"
            >
              <path
                d="M1 1 L1 13.5 L4.6 10 L7.2 15.2 L9.4 14.2 L6.9 9.1 L12 9.1 Z"
                fill="currentColor"
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className={cn(
                'absolute left-3 top-3.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold text-white shadow-sm',
                couleur.fond
              )}
            >
              {etiquette}
            </span>
          </div>
        );
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {elements}
    </div>
  );
}
