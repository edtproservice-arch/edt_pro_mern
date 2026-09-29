import { describe, expect, it } from 'vitest';

import {
  NATURES,
  NIVEAUX_PLACEMENT,
  RAISONS_NON_PLACEE,
  SEUIL_CONFORME,
  SEUIL_PROCHE,
  couleurCompletude,
  libelleNature,
  libelleNiveau,
  libelleRaison,
  tonCompletude,
} from './completudeApparence';
import {
  NIVEAUX_PLACEMENT as NIVEAUX_DOMAINE,
  RAISONS_NON_PLACEE as RAISONS_DOMAINE,
} from 'shared/domain';

describe('tonCompletude', () => {
  it('⚠️ `null` est NEUTRE, jamais « écarté »', () => {
    // Rien n'est prévu cette semaine-là, donc rien n'est en retard. Le rouge
    // dirait « raté » là où il n'y a pas de plan.
    expect(tonCompletude(null)).toBe('neutre');
    expect(tonCompletude(undefined)).toBe('neutre');
  });

  it('⚠️ ZÉRO est ÉCARTÉ, lui — et ce n’est pas la même chose que `null`', () => {
    expect(tonCompletude(0)).toBe('ecarte');
  });

  it('suit les seuils, bornes comprises', () => {
    expect(tonCompletude(SEUIL_CONFORME)).toBe('conforme');
    expect(tonCompletude(SEUIL_CONFORME - 1)).toBe('proche');
    expect(tonCompletude(SEUIL_PROCHE)).toBe('proche');
    expect(tonCompletude(SEUIL_PROCHE - 1)).toBe('ecarte');
  });
});

describe('couleurCompletude', () => {
  it('rend un jeu complet pour chaque ton', () => {
    for (const taux of [null, 100, 95, 10]) {
      const jeu = couleurCompletude(taux);
      expect(Object.keys(jeu).sort()).toEqual(['barre', 'fond', 'texte']);
    }
  });

  it('⚠️ n’emploie AUCUN hex — seulement des jetons du système', () => {
    /*
     * L'ancien posait `#16a34a`, `#d97706`, `#dc2626` en dur : invisibles au
     * thème sombre, et hors du système de design du projet.
     */
    for (const taux of [null, 100, 95, 10]) {
      for (const classe of Object.values(couleurCompletude(taux))) {
        expect(classe).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });
});

describe('libelleNature', () => {
  it('nomme les trois natures', () => {
    expect(libelleNature('manquante')).toBe('À placer');
    expect(libelleNature('en_trop')).toBe('En trop');
    expect(libelleNature('hors_chronogramme')).toBe('Hors chronogramme');
  });

  it('⚠️ rend le code brut plutôt que rien sur une nature inconnue', () => {
    // Un serveur qui ajouterait une nature ne doit pas produire une case vide :
    // un code affiché tel quel se voit, une case vide ne se voit pas.
    expect(libelleNature('greve')).toBe('greve');
  });

  it('couvre exactement les natures que le serveur produit', () => {
    expect(Object.keys(NATURES).sort()).toEqual(['en_trop', 'hors_chronogramme', 'manquante']);
  });
});

describe('placement des séances manquantes — libellés', () => {
  it('couvre exactement les niveaux que le domaine produit', () => {
    expect(Object.keys(NIVEAUX_PLACEMENT).sort()).toEqual(
      Object.values(NIVEAUX_DOMAINE).sort()
    );
  });

  it('couvre chaque raison du domaine, plus le refus du serveur', () => {
    expect(Object.keys(RAISONS_NON_PLACEE).sort()).toEqual(
      [...Object.values(RAISONS_DOMAINE), 'refusee'].sort()
    );
  });

  it('rend le code brut plutôt que rien sur une valeur inconnue', () => {
    expect(libelleNiveau('autre')).toBe('autre');
    expect(libelleRaison('autre')).toBe('autre');
    expect(libelleNiveau('sans_salle')).toBe('Sans salle');
  });
});
