import { describe, expect, it } from 'vitest';
import { arbreDeLaCarte, libelleAnnee } from './structureCarte.js';

const groupes = [
  { nom: 'DEV102', codeFiliere: 'DEVOWFS', intituleFiliere: 'Développement', anneeFormation: 1 },
  { nom: 'DEV101', codeFiliere: 'DEVOWFS', intituleFiliere: 'Développement', anneeFormation: 1 },
  { nom: 'DEV201', codeFiliere: 'DEVOWFS', intituleFiliere: 'Développement', anneeFormation: 2 },
  { nom: 'GE201', codeFiliere: 'GE', intituleFiliere: 'Gestion', anneeFormation: 2 },
];

describe('arbreDeLaCarte', () => {
  it('⚠️ une année sans filière n’a pas de branche', () => {
    expect(arbreDeLaCarte([])).toEqual([]);
    // Ni 1ère ni 3ème année ici : seule la 2ème porte un groupe.
    const arbre = arbreDeLaCarte([{ nom: 'DEV201', codeFiliere: 'DEV', anneeFormation: 2 }]);
    expect(arbre.map((a) => a.libelle)).toEqual(['2ème année']);
  });

  it('range chaque groupe sous son année et sa filière, groupes triés naturellement', () => {
    const [premiere, deuxieme] = arbreDeLaCarte(groupes);

    expect(premiere.filieres).toMatchObject([
      { code: 'DEVOWFS', intitule: 'Développement', groupes: ['DEV101', 'DEV102'] },
    ]);
    // Le gabarit d'un groupe ajouté : le premier de l'ensemble, dans l'ordre reçu.
    expect(premiere.filieres[0].modele.nom).toBe('DEV102');
    expect(deuxieme.filieres.map((f) => f.code)).toEqual(['DEVOWFS', 'GE']);
  });

  it('⚠️ une filière de deux années figure sous chacune, avec SES groupes seulement', () => {
    const [premiere, deuxieme] = arbreDeLaCarte(groupes);
    expect(premiere.filieres[0].groupes).toEqual(['DEV101', 'DEV102']);
    expect(deuxieme.filieres[0].groupes).toEqual(['DEV201']);
  });

  it('compte les groupes de chaque année', () => {
    expect(arbreDeLaCarte(groupes).map((a) => a.groupes)).toEqual([2, 2]);
  });

  it('classe les années dans l’ordre, quelle que soit celle des groupes', () => {
    const arbre = arbreDeLaCarte([
      { nom: 'X301', codeFiliere: 'X', anneeFormation: 3 },
      { nom: 'X101', codeFiliere: 'X', anneeFormation: 1 },
      { nom: 'X401', codeFiliere: 'X', anneeFormation: 4 },
    ]);
    expect(arbre.map((a) => a.annee)).toEqual([1, 3, 4]);
    expect(arbre[2].libelle).toBe('4ème année');
  });

  it('un groupe sans filière connue est rangé sous « Sans filière »', () => {
    const [premiere] = arbreDeLaCarte([{ nom: 'Z101', anneeFormation: 1 }]);
    expect(premiere.filieres[0].code).toBe('Sans filière');
  });

  it('libellés des années', () => {
    expect([1, 2, 3].map(libelleAnnee)).toEqual(['1ère année', '2ème année', '3ème année']);
  });
});

describe('arbreDeLaCarte — avancement de chaque groupe', () => {
  const module = (formateur, extra = {}) => ({ code: 'M', formateurPresentiel: formateur, ...extra });

  it('⚠️ compte les modules actifs et ceux qui ont un formateur, comme la matrice', () => {
    const [premiere] = arbreDeLaCarte([
      { nom: 'A101', codeFiliere: 'A', anneeFormation: 1, modules: [module('X'), module(''), module('Y')] },
      { nom: 'A102', codeFiliere: 'A', anneeFormation: 1, modules: [module('')] },
      // Un module désactivé n'est pas dispensé : ni au total, ni parmi les affectés.
      { nom: 'A103', codeFiliere: 'A', anneeFormation: 1, modules: [module('X'), module('Z', { actif: false })] },
      { nom: 'A104', codeFiliere: 'A', anneeFormation: 1, modules: [] },
    ]);

    expect(premiere.filieres[0].avancement).toEqual({
      A101: { affectes: 2, total: 3 },
      A102: { affectes: 0, total: 1 },
      A103: { affectes: 1, total: 1 },
      A104: { affectes: 0, total: 0 },
    });
  });
});
