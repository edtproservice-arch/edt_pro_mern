/**
 * Export du chronogramme : les listes déroulantes d'un groupe du cours du soir
 * (2026-10-09). Le classeur doit proposer ce que la grille et l'import
 * acceptent — sinon on saisit hors ligne ce que l'import refusera.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { semainesChronogramme } from 'shared/domain';

import { construireClasseur } from '../../src/modules/chronogramme/classeur.service.js';

const module = {
  code: 'M101',
  intitule: 'Algorithmique',
  masses: { presentiel: 60, synchrone: 20 },
  formateurs: ['BRAHIM LOURID'],
  formateursPresentiel: ['BRAHIM LOURID'],
  formateursSynchrone: ['BRAHIM LOURID'],
  semestre: 'S1',
  estRegional: false,
};

async function validations(sujet) {
  const tampon = await construireClasseur({
    mode: 'groupe',
    anneeScolaire: '2026-2027',
    feuilles: [
      {
        sujet,
        modules: [module],
        planning: { M101: { 3: { heures: 5, type: 'P' }, 4: { heures: 5, type: 'S' } } },
        semaines: semainesChronogramme(2026, {}),
        stagesParGroupe: {},
      },
    ],
  });
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(tampon);
  const feuille = classeur.worksheets.find((f) => f.name.startsWith(sujet.slice(0, 5)));

  // La ligne d'un type : celle dont une cellule porte « P » ou « S » en colonne Type.
  const parType = {};
  feuille.eachRow((rangee) => {
    const valeurs = rangee.values.map((v) => (typeof v === 'object' && v ? v.result ?? v.text : v));
    const type = valeurs.find((v) => v === 'P' || v === 'S');
    if (!type || parType[type]) return;
    rangee.eachCell((cellule) => {
      if (!parType[type] && cellule.dataValidation?.type) parType[type] = cellule.dataValidation;
    });
  });
  return parType;
}

describe('export — validations d’un groupe du cours du soir', () => {
  it('présentiel : la liste du soir ; synchrone : rien', async () => {
    const { P, S } = await validations('GM101 (CDS)');
    expect(P.type).toBe('list');
    expect(P.formulae[0]).toMatch(/\$B\$1:\$B\$9/);
    expect(S.type).toBe('textLength');
  });

  it('un autre groupe garde la liste par pas de 2,5 h, synchrone compris', async () => {
    const { P, S } = await validations('GM101');
    expect(P.formulae[0]).toMatch(/\$A\$1:\$A\$8/);
    expect(S.type).toBe('list');
  });
});
