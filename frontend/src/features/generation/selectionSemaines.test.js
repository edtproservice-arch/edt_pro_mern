import { describe, expect, it } from 'vitest';

import { MOTEURS } from 'shared/constants';

import {
  bilanRemplacement,
  causesRencontrees,
  dureeMaximale,
  FIN_SEMESTRE_1,
  NOMBRE_SEMAINES,
  raccourci,
  semainesDeLAnnee,
  semainesIncompletes,
  valeurDe,
} from './selectionSemaines';

/**
 * ⚠️ CETTE LISTE DÉCIDE DE CE QUI SERA ÉCRASÉ. Une borne fausse remplacerait
 *    des semaines que personne n'a cochées — et la perte ne se verrait qu'après
 *    coup, sur une grille déjà réécrite.
 */

describe('semainesDeLAnnee', () => {
  it('rend les 45 semaines de l’année', () => {
    const semaines = semainesDeLAnnee(2026);
    expect(semaines).toHaveLength(NOMBRE_SEMAINES);
    expect(semaines[0]).toMatchObject({ numero: 1, valeur: '2026-W1', semestre: 1 });
    expect(semaines.at(-1)).toMatchObject({ numero: 45, valeur: '2026-W45', semestre: 2 });
  });

  it('reporte ce que chaque semaine porte déjà', () => {
    // Sans ce nombre, on coche sans savoir ce qui sera remplacé.
    const semaines = semainesDeLAnnee(2026, [{ semaine: '2026-W3', seances: 42 }]);
    expect(semaines.find((s) => s.numero === 3).seances).toBe(42);
    expect(semaines.find((s) => s.numero === 4).seances).toBe(0);
  });

  it('place la bascule de semestre sur FIN_SEMESTRE_1', () => {
    const semaines = semainesDeLAnnee(2026);
    expect(semaines.find((s) => s.numero === FIN_SEMESTRE_1).semestre).toBe(1);
    expect(semaines.find((s) => s.numero === FIN_SEMESTRE_1 + 1).semestre).toBe(2);
  });
});

describe('raccourci', () => {
  it('découpe les deux semestres sans trou ni recouvrement', () => {
    const s1 = raccourci('semestre1', 2026);
    const s2 = raccourci('semestre2', 2026);

    expect(s1).toHaveLength(FIN_SEMESTRE_1);
    expect(s1.at(-1)).toBe(valeurDe(2026, FIN_SEMESTRE_1));
    expect(s2[0]).toBe(valeurDe(2026, FIN_SEMESTRE_1 + 1));
    // Réunis, ils font exactement l'année : ni semaine perdue, ni comptée deux fois.
    expect(new Set([...s1, ...s2]).size).toBe(NOMBRE_SEMAINES);
  });

  it('rend l’année entière', () => {
    expect(raccourci('tout', 2026)).toHaveLength(NOMBRE_SEMAINES);
  });

  it('rend une liste vide pour un raccourci inconnu', () => {
    // ⚠️ Jamais « tout » par défaut : un libellé mal orthographié générerait
    //    l'année entière au lieu de ne rien faire.
    expect(raccourci('nimporte', 2026)).toEqual([]);
  });
});

describe('bilanRemplacement', () => {
  const apercu = [
    { semaine: '2026-W1', remplacees: 10, preservees: 2 },
    { semaine: '2026-W2', remplacees: 5, preservees: 0 },
    { semaine: '2026-W3', remplacees: 0, preservees: 1 },
  ];

  it('additionne ce qui sera remplacé et ce qui sera gardé', () => {
    const bilan = bilanRemplacement(apercu, ['2026-W1', '2026-W2', '2026-W3']);
    expect(bilan).toEqual({ remplacees: 15, preservees: 3, semainesTouchees: 2 });
  });

  it('NE COMPTE QUE les semaines encore cochées', () => {
    /*
     * La prévisualisation peut porter sur une sélection plus large si
     * l'utilisateur a décoché entre-temps : afficher son total annoncerait une
     * perte qui n'aura pas lieu.
     */
    const bilan = bilanRemplacement(apercu, ['2026-W2']);
    expect(bilan).toEqual({ remplacees: 5, preservees: 0, semainesTouchees: 1 });
  });

  it('ne compte pas une semaine sans rien à remplacer', () => {
    expect(bilanRemplacement(apercu, ['2026-W3']).semainesTouchees).toBe(0);
  });

  it('tient sur une prévisualisation absente', () => {
    expect(bilanRemplacement(undefined, ['2026-W1'])).toEqual({
      remplacees: 0,
      preservees: 0,
      semainesTouchees: 0,
    });
  });
});

describe('semainesIncompletes', () => {
  it('ne retient que celles qui ont laissé des séances non placées ou échoué', () => {
    /*
     * ⚠️ RELANCER TOUT SERAIT PIRE QUE NE RIEN FAIRE : les semaines réussies
     *    seraient réécrites, donc redistribuées — et le directeur perdrait des
     *    placements peut-être ajustés à la main depuis.
     */
    const rapport = {
      semaines: [
        { semaine: '2026-W1', nonPlacees: [] },
        { semaine: '2026-W2', nonPlacees: [{ cause: 'formateur_occupe' }] },
        { semaine: '2026-W3', echec: true },
        { semaine: '2026-W4', vide: true, nonPlacees: [] },
      ],
    };
    expect(semainesIncompletes(rapport)).toEqual(['2026-W2', '2026-W3']);
  });

  it('rend une liste vide sur un rapport absent', () => {
    expect(semainesIncompletes(null)).toEqual([]);
  });
});

describe('causesRencontrees', () => {
  it('dédoublonne les codes de cause', () => {
    // Ils décident des assouplissements proposés : en proposer un qui ne
    // débloquerait rien ferait croire que l'outil ne sert à rien.
    const rapport = {
      semaines: [
        { nonPlacees: [{ cause: 'salle_occupee' }, { cause: 'formateur_occupe' }] },
        { nonPlacees: [{ cause: 'salle_occupee' }] },
      ],
    };
    expect(causesRencontrees(rapport).sort()).toEqual(['formateur_occupe', 'salle_occupee']);
  });
});

describe('dureeMaximale', () => {
  it('ne dit RIEN au glouton', () => {
    /*
     * ⚠️ L'année entière se génère en une seconde : annoncer une durée là où
     *    il n'y en a pas fait passer l'outil pour lent avant même d'avoir servi.
     */
    expect(dureeMaximale(45, MOTEURS.GLOUTON)).toBeNull();
    expect(dureeMaximale(0, MOTEURS.CPSAT)).toBeNull();
  });

  it('AVERTIT avant le clic, en minutes, sur une année entière', () => {
    /*
     * ═══ ⚠️ LE DÉFAUT QUE CE TEST INTERDIT ═══
     * 45 semaines à 22 secondes font un quart d'heure. Sans ce chiffre AVANT
     * le clic, le directeur lance, voit une barre immobile, ferme l'onglet —
     * et la génération continue sans lui, puisque le flux restitue sans
     * piloter. Le mot « minutes » doit apparaître : c'est lui qui fait
     * renoncer, ou accepter d'attendre.
     */
    const texte = dureeMaximale(45, MOTEURS.CPSAT);
    expect(texte).toMatch(/minute/);
    expect(texte).toMatch(/17/); // 45 × 22 s = 990 s → 17 min
  });

  it('parle en secondes pour une poignée de semaines', () => {
    // Annoncer « jusqu'à 1 minute » pour deux semaines serait faux dans le
    // sens qui décourage.
    expect(dureeMaximale(2, MOTEURS.CPSAT)).toMatch(/seconde/);
  });
});
