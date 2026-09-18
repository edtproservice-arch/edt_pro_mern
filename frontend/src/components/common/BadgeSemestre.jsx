import { cn } from '@/lib/utils';

/**
 * Le semestre d'un module, en badge — LE MÊME dans toute l'application.
 *
 * ═══ ⚠️ POURQUOI IL EST PARTAGÉ ═══
 * Il en existait TROIS copies — carte d'affectations, chronogramme, emploi du
 * temps — avec des valeurs d'entrée différentes (« S1 » ici, « 1 » là) et des
 * classes recopiées. Une teinte ajustée dans l'une n'atteignait pas les autres :
 * c'est le constat §4.2 du plan, appliqué à un badge d'une lettre.
 *
 * ═══ ⚠️ FOND FONCÉ, TEXTE BLANC ═══
 * Les aplats pâles d'origine (`bg-accent-sky/20 text-accent-sky`) tombaient à
 * 2:1 de contraste : sur un badge d'UNE LETTRE, posé lui-même sur une cellule
 * déjà colorée, le caractère disparaissait. Le fond plein tranche sur n'importe
 * quel fond de cellule.
 *
 * Les teintes restent celles des masses horaires — S1 bleu ciel, S2 vert — pour
 * qu'un semestre se reconnaisse partout à sa couleur. Un module ANNUEL prend
 * l'orange : il n'est ni l'un ni l'autre, et sa contrainte de planification
 * diffère puisqu'il court sur toute l'année.
 */
const SEMESTRES = {
  1: { court: '1', libelle: 'Semestre 1', classe: 'bg-accent-sky-deep text-white' },
  2: { court: '2', libelle: 'Semestre 2', classe: 'bg-accent-green-deep text-white' },
  A: { court: 'A', libelle: 'Module annuel', classe: 'bg-accent-orange text-white' },
};

/**
 * ⚠️ DEUX VOCABULAIRES D'ENTRÉE, un seul rendu. La carte et le chronogramme
 * disent « S1 » / « S2 » / « annuel » ; l'emploi du temps dit « 1 » / « 2 » /
 * « A ». Les faire converger ICI évite de retoucher trois appelants — et de
 * découvrir la divergence le jour où l'un d'eux n'affiche plus rien.
 */
export function normaliserSemestre(valeur) {
  const brut = String(valeur ?? '').trim().toUpperCase();
  if (brut === 'S1' || brut === '1') return '1';
  if (brut === 'S2' || brut === '2') return '2';
  if (brut === 'ANNUEL' || brut === 'A') return 'A';
  return null;
}

/*
 * ⚠️ AUCUN `title` NATIF (retiré le 2026-08-25, demande du porteur). Ces badges
 * sont posés dans une grille qu'on parcourt à la souris : l'infobulle noire du
 * système se dépliait à chaque case franchie, par-dessus la grille, et sans le
 * moindre moyen de la faire taire. Ce qu'elle disait se lit désormais dans la
 * carte au survol du module.
 */
export default function BadgeSemestre({ semestre, long = false, className }) {
  const cle = normaliserSemestre(semestre);
  // Aucun badge sans semestre : « annuel » y serait un mensonge.
  if (!cle) return null;

  const { court, libelle, classe } = SEMESTRES[cle];

  return (
    <span
      className={cn(
        /*
         * ⚠️ `whitespace-nowrap` (2026-09-05, correction du porteur) : en forme
         * LONGUE, « Module annuel » se coupait en deux lignes dès que sa colonne
         * était un peu étroite — un pavé orange de deux étages au milieu d'une
         * rangée de badges d'une ligne. Un badge ne se replie pas : il rétrécit
         * sa colonne ou il déborde, jamais il ne s'empile.
         */
        'inline-block shrink-0 whitespace-nowrap rounded px-1 text-[0.65rem] font-semibold leading-4',
        classe,
        className
      )}
    >
      {long ? libelle : court}
    </span>
  );
}
