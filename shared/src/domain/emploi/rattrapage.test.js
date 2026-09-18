import { describe, it, expect } from 'vitest';
import { DUREE_RATTRAPAGE, groupesConcernes, reporterRattrapage } from './rattrapage.js';

const planning = { M101: { 12: { heures: 5, type: 'P' } } };

describe('groupesConcernes', () => {
  it('⚠️ SÉPARE une fusion : chaque groupe a SON chronogramme', () => {
    // N'en reporter qu'un laisserait les autres avec des heures qui ne seront
    // jamais données.
    expect(groupesConcernes('GM101 GM102')).toEqual(['GM101', 'GM102']);
    expect(groupesConcernes('GM101 GM102 GM103')).toEqual(['GM101', 'GM102', 'GM103']);
    /*
     * ⚠️ L'ESPACE EST LE SEUL SÉPARATEUR — c'est ce que fait
     * `chrono_ratt_groupes()` (chrono_modules.php:483), et ce que contiennent les
     * données. Ma première version acceptait aussi virgules et points-virgules :
     * une tolérance inventée, qui masquait surtout le vrai sujet — les suffixes.
     */
  });

  it('⚠️⚠️ NE COUPE PAS un nom de groupe SUFFIXÉ', () => {
    /*
     * « ACADA101 (FQ) » est UN groupe, pas deux. Découpé sur les espaces, le
     * report cherchait les chronogrammes de « ACADA101 » et de « (FQ) », n'en
     * trouvait aucun, et le vrai groupe ne recevait jamais ses heures.
     */
    expect(groupesConcernes('ACADA101 (FQ)')).toEqual(['ACADA101 (FQ)']);
    expect(groupesConcernes('GE101 (CDS) (GE)')).toEqual(['GE101 (CDS) (GE)']);
    // Et une VRAIE fusion de groupes suffixés se sépare toujours bien.
    expect(groupesConcernes('ACADA101 (FQ) ACADI101 (FQ)')).toEqual([
      'ACADA101 (FQ)',
      'ACADI101 (FQ)',
    ]);
  });

  it('rend un seul groupe quand il n’y a pas de fusion, et rien sur du vide', () => {
    expect(groupesConcernes('GM101')).toEqual(['GM101']);
    expect(groupesConcernes('')).toEqual([]);
    expect(groupesConcernes(null)).toEqual([]);
  });
});

describe('reporterRattrapage', () => {
  it('AJOUTE les heures du rattrapage dans la semaine visée', () => {
    const { planning: apres, etat } = reporterRattrapage({
      planning,
      module: 'M101',
      numeroSemaine: 12,
      delta: DUREE_RATTRAPAGE,
    });

    expect(etat).toBe('ajoute');
    expect(apres.M101[12]).toEqual({ heures: 7.5, type: 'P' });
  });

  it('les REPREND quand le rattrapage est déplacé ou annulé', () => {
    const { planning: apres, etat } = reporterRattrapage({
      planning,
      module: 'M101',
      numeroSemaine: 12,
      delta: -DUREE_RATTRAPAGE,
    });

    expect(etat).toBe('retire');
    expect(apres.M101[12]).toEqual({ heures: 2.5, type: 'P' });
  });

  it('⚠️ CONSERVE le type de la cellule', () => {
    // Rattraper du synchrone dans une case présentielle en changerait la nature
    // sans le dire.
    const { planning: apres } = reporterRattrapage({
      planning: { M101: { 12: { heures: 5, type: 'S' } } },
      module: 'M101',
      numeroSemaine: 12,
      delta: DUREE_RATTRAPAGE,
    });

    expect(apres.M101[12].type).toBe('S');
  });

  it('⚠️ REFUSE une cellule qui dépasserait 20 h, sans rogner', () => {
    // Tronquer ferait disparaître des heures que personne ne viendrait chercher.
    const { planning: apres, etat } = reporterRattrapage({
      planning: { M101: { 12: { heures: 20, type: 'P' } } },
      module: 'M101',
      numeroSemaine: 12,
      delta: DUREE_RATTRAPAGE,
    });

    expect(etat).toBe('cellule_pleine');
    expect(apres.M101[12].heures).toBe(20);
  });

  it('une cellule ramenée à zéro est RETIRÉE, pas conservée à 0', () => {
    const { planning: apres } = reporterRattrapage({
      planning: { M101: { 12: { heures: 2.5, type: 'P' } } },
      module: 'M101',
      numeroSemaine: 12,
      delta: -DUREE_RATTRAPAGE,
    });

    expect(apres.M101[12]).toBeUndefined();
  });

  it('crée la cellule quand la semaine était vide', () => {
    const { planning: apres, etat } = reporterRattrapage({
      planning: {},
      module: 'M101',
      numeroSemaine: 30,
      delta: DUREE_RATTRAPAGE,
    });

    expect(etat).toBe('ajoute');
    expect(apres.M101[30]).toEqual({ heures: 2.5, type: 'P' });
  });

  it('⚠️ apparie le module SANS TENIR COMPTE DE LA CASSE', () => {
    // Une clé qui ne correspond pas créerait un module fantôme à côté du vrai.
    const { planning: apres } = reporterRattrapage({
      planning,
      module: 'm101',
      numeroSemaine: 12,
      delta: DUREE_RATTRAPAGE,
    });

    expect(apres.M101[12].heures).toBe(7.5);
    expect(apres.m101).toBeUndefined();
  });

  it('⚠️ DIT qu’une absence sans module ne peut pas être reportée', () => {
    // Le chronogramme est indexé par module ; ne rien faire en silence
    // laisserait croire le rattrapage enregistré.
    expect(reporterRattrapage({ planning, module: '', numeroSemaine: 12, delta: 2.5 }).etat).toBe(
      'sans_module'
    );
  });

  it('DIT qu’une date hors de l’année scolaire ne tombe dans aucune semaine', () => {
    expect(
      reporterRattrapage({ planning, module: 'M101', numeroSemaine: null, delta: 2.5 }).etat
    ).toBe('hors_annee');
  });

  it('ne touche à rien quand le report ne change aucune valeur', () => {
    const resultat = reporterRattrapage({ planning, module: 'M101', numeroSemaine: 12, delta: 0 });

    expect(resultat.etat).toBe('inchange');
    expect(resultat.planning).toBe(planning);
  });
});
