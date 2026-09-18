import { describe, it, expect } from 'vitest';
import {
  HISTORIQUE_VIDE,
  cible,
  cleCase,
  copier,
  defaire,
  deplacement,
  empiler,
  lireCle,
  rectangle,
  refaire,
} from './selection.js';

const grille = {
  sujets: ['A', 'B', 'C'],
  creneaux: ['S1', 'S2', 'S3', 'S4'],
  periode: 'jour',
};

describe('cleCase / lireCle', () => {
  it('font l’aller-retour', () => {
    const cle = cleCase('A', 'Lundi', 'S1');
    expect(lireCle(cle)).toEqual({ sujet: 'A', jour: 'Lundi', creneau: 'S1', periode: 'jour' });
  });
});

describe('rectangle', () => {
  it('⚠️ prend un RECTANGLE, pas la suite des cases', () => {
    /*
     * Sélectionner du mardi S1 au mercredi S3 doit prendre 2 lignes × 6
     * colonnes, pas tout ce qui se trouve entre les deux dans l'ordre de
     * lecture. C'est ce qu'on attend d'une grille, et ce que fait un tableur.
     */
    const cles = rectangle(
      { sujet: 'A', jour: 'Mardi', creneau: 'S1' },
      { sujet: 'B', jour: 'Mardi', creneau: 'S3' },
      grille
    );

    expect(cles).toHaveLength(6);
    expect(cles).toContain(cleCase('A', 'Mardi', 'S1'));
    expect(cles).toContain(cleCase('B', 'Mardi', 'S3'));
    // La case du lundi S4, qui précède mardi S1 dans l'ordre de lecture, N'EST
    // PAS dedans.
    expect(cles).not.toContain(cleCase('A', 'Lundi', 'S4'));
  });

  it('marche dans les DEUX sens de glissement', () => {
    const depuis = { sujet: 'C', jour: 'Mardi', creneau: 'S3' };
    const jusqu = { sujet: 'A', jour: 'Lundi', creneau: 'S1' };

    expect(rectangle(depuis, jusqu, grille)).toEqual(rectangle(jusqu, depuis, grille));
  });

  it('traverse les jours', () => {
    const cles = rectangle(
      { sujet: 'A', jour: 'Lundi', creneau: 'S3' },
      { sujet: 'A', jour: 'Mardi', creneau: 'S2' },
      grille
    );
    // Lundi S3, S4 puis mardi S1, S2 : les colonnes s'enchaînent d'un jour à
    // l'autre, comme à l'écran.
    expect(cles).toHaveLength(4);
  });

  it('⚠️ ne sélectionne RIEN si un coin est hors grille', () => {
    // Sans ce garde, l'index -1 ferait partir la sélection du début et
    // prendrait tout.
    expect(
      rectangle(
        { sujet: 'DISPARU', jour: 'Lundi', creneau: 'S1' },
        { sujet: 'A', jour: 'Lundi', creneau: 'S1' },
        grille
      )
    ).toEqual([]);
  });
});

describe('copier / cible', () => {
  const seances = {
    [cleCase('A', 'Lundi', 'S1')]: { module: 'M1' },
    [cleCase('A', 'Lundi', 'S2')]: { module: 'M2' },
  };
  const seanceDe = (cle) => seances[cle];

  it('retient la FORME du bloc, pas les cases d’origine', () => {
    // Le collage se fait ailleurs : garder l'origine ferait recoller au même
    // endroit.
    const presse = copier(
      [cleCase('A', 'Lundi', 'S1'), cleCase('A', 'Lundi', 'S2')],
      seanceDe
    );

    expect(presse).toMatchObject({ lignes: 1, colonnes: 2 });
    expect(presse.contenu[0]).toEqual({ ligne: 0, colonne: 0, seance: { module: 'M1' } });
  });

  it('colle le bloc à partir de l’ancrage', () => {
    const presse = copier(
      [cleCase('A', 'Lundi', 'S1'), cleCase('A', 'Lundi', 'S2')],
      seanceDe
    );
    const cases = cible(presse, { sujet: 'B', jour: 'Mardi', creneau: 'S1' }, grille);

    expect(cases).toEqual([
      { cle: cleCase('B', 'Mardi', 'S1'), seance: { module: 'M1' } },
      { cle: cleCase('B', 'Mardi', 'S2'), seance: { module: 'M2' } },
    ]);
  });

  it('⚠️ ÉCARTE ce qui déborde, sans le replier', () => {
    /*
     * Coller un bloc de trois colonnes à partir de la dernière ne doit pas
     * revenir au début de la ligne : on écraserait le lundi sans le voir.
     */
    const presse = copier(
      [cleCase('A', 'Lundi', 'S1'), cleCase('A', 'Lundi', 'S2')],
      seanceDe
    );
    const cases = cible(presse, { sujet: 'C', jour: 'Samedi', creneau: 'S4' }, grille);

    expect(cases).toHaveLength(1);
    expect(cases[0].cle).toBe(cleCase('C', 'Samedi', 'S4'));
  });

  it('une case VIDE copiée reste une case vide collée', () => {
    // Sinon un bloc à trous laisserait en place ce qu'il devait remplacer.
    const presse = copier([cleCase('A', 'Lundi', 'S1'), cleCase('A', 'Lundi', 'S4')], seanceDe);
    const cases = cible(presse, { sujet: 'B', jour: 'Lundi', creneau: 'S1' }, grille);

    expect(cases[1].seance).toBeNull();
  });

  it('ne copie rien d’une sélection vide', () => {
    expect(copier([], seanceDe)).toBeNull();
    expect(cible(null, { sujet: 'A', jour: 'Lundi', creneau: 'S1' }, grille)).toEqual([]);
  });
});

describe('deplacement', () => {
  const seance = { formateurMatricule: '15688', groupe: 'GM101', module: 'M101', salle: 'A12' };
  const depuis = cleCase('15688', 'Lundi', 'S1');
  const vers = cleCase('15688', 'Mardi', 'S3');

  it('⚠️ rend UN SEUL ordre, qui porte aussi le départ', () => {
    /*
     * Deux écritures indépendantes — poser, puis vider — perdraient la séance si
     * la pose était refusée : le vidage partirait quand même.
     */
    const operations = deplacement(depuis, vers, seance);

    expect(operations).toHaveLength(1);
    expect(operations[0].type).toBe('deplacer');
    expect(operations[0].seance).toMatchObject({ jour: 'Mardi', seance: 'S3', module: 'M101', salle: 'A12' });
    expect(operations[0].source).toMatchObject({ jour: 'Lundi', seance: 'S1', formateurMatricule: '15688' });
  });

  it('avec Ctrl, COPIE : rien n’est retiré au départ', () => {
    const [operation] = deplacement(depuis, vers, seance, { copie: true });

    expect(operation.type).toBe('poser');
    expect(operation.source).toBeUndefined();
  });

  it('⚠️ le sujet de la case d’ARRIVÉE l’emporte', () => {
    // Déposer sur la ligne d'un autre formateur doit changer de formateur :
    // garder celui du départ reposerait la séance là d'où elle vient.
    const [operation] = deplacement(depuis, cleCase('18494', 'Mardi', 'S3'), seance, {
      sujetDe: () => ({ formateurMatricule: '18494' }),
    });

    expect(operation.seance.formateurMatricule).toBe('18494');
    // Le départ, lui, reste celui de la séance d'origine — sinon on viderait la
    // case d'un collègue.
    expect(operation.source.formateurMatricule).toBe('15688');
  });

  it('ne fait rien sur une case vide ou sur elle-même', () => {
    expect(deplacement(depuis, vers, undefined)).toEqual([]);
    expect(deplacement(depuis, depuis, seance)).toEqual([]);
  });
});

describe('historique', () => {
  it('⚠️ empile l’état D’AVANT, et défaire y ramène', () => {
    /*
     * Empiler la valeur courante rendrait l'annulation sans effet : « défaire »
     * doit ramener à ce qui était là.
     */
    const h1 = empiler(HISTORIQUE_VIDE, 'avant');
    const resultat = defaire(h1, 'apres');

    expect(resultat.etat).toBe('avant');
    expect(resultat.historique.futur).toEqual(['apres']);
  });

  it('refaire ramène ce qu’on vient de défaire', () => {
    const h1 = empiler(HISTORIQUE_VIDE, 'avant');
    const { etat, historique } = defaire(h1, 'apres');

    expect(etat).toBe('avant');
    expect(refaire(historique, 'avant').etat).toBe('apres');
  });

  it('un nouveau geste EFFACE la branche « refaire »', () => {
    // On ne peut pas refaire ce qu'on vient de remplacer.
    const { historique } = defaire(empiler(HISTORIQUE_VIDE, 'a'), 'b');
    expect(historique.futur).toEqual(['b']);

    expect(empiler(historique, 'c').futur).toEqual([]);
  });

  /*
   * ⚠️ COLLABORATION : défaire ne doit rétablir que les cases de SON geste, sinon
   * il écraserait celles qu'un collègue a modifiées entre-temps.
   */
  it('reporte la portée d’un geste sur l’état rangé de l’autre côté', () => {
    const h1 = empiler(HISTORIQUE_VIDE, { etat: ['avant'], cles: ['A', 'B'] });
    const annule = defaire(h1, ['apres']);

    expect(annule.etat).toEqual({ etat: ['avant'], cles: ['A', 'B'] });
    expect(annule.historique.futur[0]).toEqual({ etat: ['apres'], cles: ['A', 'B'] });

    const refait = refaire(annule.historique, ['avant']);
    expect(refait.etat).toEqual({ etat: ['apres'], cles: ['A', 'B'] });
    expect(refait.historique.passe.at(-1)).toEqual({ etat: ['avant'], cles: ['A', 'B'] });
  });

  it('rend null quand il n’y a rien à défaire', () => {
    expect(defaire(HISTORIQUE_VIDE, 'a')).toBeNull();
    expect(refaire(HISTORIQUE_VIDE, 'a')).toBeNull();
  });

  it('BORNE la pile', () => {
    // Une pile sans borne garderait toute la session en mémoire, et chaque état
    // est une semaine entière.
    let historique = HISTORIQUE_VIDE;
    for (let rang = 0; rang < 60; rang += 1) historique = empiler(historique, rang, 50);

    expect(historique.passe).toHaveLength(50);
    expect(historique.passe[0]).toBe(10);
  });
});
