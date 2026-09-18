import { describe, expect, it } from 'vitest';
import { grouperParGroupe } from './regroupementStagiaires';

const marquage = (id, groupe) => ({ id, groupe, matricule: id, type: 'absence' });

describe('grouperParGroupe', () => {
  it('réunit les marquages d’un même groupe, triés par nom de groupe', () => {
    const groupes = grouperParGroupe([marquage('a', 'SMP201'), marquage('b', 'GM101'), marquage('c', 'SMP201')]);
    expect(groupes.map((g) => g.groupe)).toEqual(['GM101', 'SMP201']);
  });

  it('garde l’ordre du serveur à l’intérieur d’un groupe', () => {
    const [groupe] = grouperParGroupe([marquage('a', 'GM101'), marquage('b', 'GM101')]);
    expect(groupe.absences.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('range un marquage sans groupe sous un tiret plutôt que de le perdre', () => {
    expect(grouperParGroupe([marquage('a', '')])[0].groupe).toBe('—');
  });

  it('rend une liste vide sans marquage', () => {
    expect(grouperParGroupe()).toEqual([]);
  });
});
