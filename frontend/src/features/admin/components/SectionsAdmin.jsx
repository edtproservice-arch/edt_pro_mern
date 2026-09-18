import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Les sections de l'espace d'administration.
 *
 * ═══ ⚠️ ELLE NAVIGUE ENTRE DES PAGES, PAS ENTRE DES FILTRES ═══
 * Une rangée sous la barre portait d'abord les statuts (En attente, Approuvés…)
 * : ce sont des FILTRES d'une liste, pas des endroits. Depuis qu'une seconde
 * page existe (2026-09-02), ce sont les PAGES qui sont navigables, et le filtre
 * par statut est redescendu là où vit la liste qu'il filtre.
 *
 * ═══ ⚠️ NI SOULIGNEMENT NI CADRE : UNE SURFACE ═══ (maquette fournie par le
 * porteur, 2026-09-02.) Un soulignement dit « onglet », donc un contenu qui
 * change SOUS lui ; au milieu d'une barre, entre une marque et des actions, ces
 * entrées se lisent comme un MENU. La page courante s'y marque par une pastille
 * de fond, et le survol par la même — c'est ce que fait la maquette.
 *
 * ═══ ⚠️ DES `NavLink`, PAS DES BOUTONS ═══
 * Ce sont de vraies adresses : elles doivent s'ouvrir dans un nouvel onglet, se
 * mettre en favori et répondre au bouton « précédent ». Un `<button>` qui pousse
 * l'historique à la main perd les trois.
 */
const SECTIONS = [
  { to: '/admin', libelle: 'Directeurs', exact: true },
  { to: '/admin/statistiques', libelle: 'Statistiques' },
  /*
   * ⚠️ LE RÉFÉRENTIEL DRIF EST ICI ET NULLE PART AILLEURS (décision du porteur,
   * 2026-09-02) : ses 13 359 lignes valent pour TOUS les établissements, une
   * correction s'y propage à tout le pays. Les directeurs continuent de le LIRE
   * — leur carte en dépend — mais ne le modifient pas.
   */
  // ⚠️ « Répartition », SANS « DRIF » (demande du porteur, 2026-09-03) : la
  // barre tient déjà à l'étroit à cinq entrées, et le titre de la page elle-même
  // — « Répartition DRIF » — continue de nommer le référentiel en entier.
  { to: '/admin/repartitions', libelle: 'Répartition' },
  /*
   * ⚠️ « RÉSEAU » ET NON « ÉTABLISSEMENTS » : le mot désignerait aussi les
   * LOCATAIRES du SaaS, qui se lisent dans « Statistiques ». Celui-ci est le
   * CATALOGUE officiel — la liste dans laquelle un directeur se désigne en
   * s'inscrivant.
   */
  // ⚠️ « Réseau », SANS « OFPPT » (demande du porteur, 2026-09-03) : même
  // raison que « Répartition » — la page se nomme elle-même en entier.
  { to: '/admin/reseau', libelle: 'Réseau' },
  /*
   * ⚠️ « CALENDRIER » SANS PLUS : ce qui s'y saisit — vacances du réseau, dates
   * de rentrée — vaut pour TOUS les établissements. Celui d'un directeur, qui
   * n'engage que lui, vit dans ses Paramètres.
   */
  { to: '/admin/calendrier', libelle: 'Calendrier' },
];

/**
 * ⚠️ LE MÊME COMPOSANT SERT LES DEUX EMPLACEMENTS — la barre sur grand écran, le
 * panneau plein écran sous `md`. En écrire deux, ce serait deux listes de pages
 * à tenir en phase, et celle du téléphone serait la première à prendre du
 * retard. Seule l'APPARENCE change, pas le contenu.
 *
 * @param {'barre'|'panneau'} variante
 * @param {Function} [onNavigation]  Appelé après un clic — c'est ce qui referme
 *   le panneau. Sans lui, on naviguerait derrière un voile resté ouvert.
 */
export default function SectionsAdmin({ variante = 'barre', onNavigation }) {
  const panneau = variante === 'panneau';

  return (
    <nav aria-label="Sections de l'administration">
      <ul className={cn('flex', panneau ? 'flex-col gap-2' : 'items-center gap-1')}>
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <NavLink
              to={section.to}
              /* `end` : sans lui, « Directeurs » resterait actif sur
                 /admin/statistiques, qui commence par la même adresse. */
              end={section.exact}
              onClick={onNavigation}
              className={({ isActive }) =>
                cn(
                  'block whitespace-nowrap rounded-md transition-colors',
                  panneau
                    ? 'py-1 text-3xl font-semibold tracking-tight'
                    : 'px-3 py-1.5 text-sm font-medium hover:bg-accent',
                  isActive
                    ? panneau
                      ? 'text-foreground'
                      : 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {section.libelle}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
