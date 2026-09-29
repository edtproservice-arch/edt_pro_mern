import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dateDuJour, rentreesRetenues } from 'shared/domain';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { retenirToutesLesRentrees } from '../../src/modules/calendrierNational/calendrierNational.service.js';
import { semaine } from '../../src/modules/seances/seances.service.js';

/**
 * S1 est la semaine de la rentrée — partout (2026-09-28, défaut signalé par le
 * porteur : la barre annonçait « S1 du 7 au 13 sept », l'en-tête de la grille
 * « lundi 31/08 »).
 */
const ANNEE = 2026;
const RENTREES = [
  { anneeFormation: 1, date: '2026-09-11' },
  { anneeFormation: 2, date: '2026-09-07' },
  { anneeFormation: 3, date: '2026-09-07' },
];
const enTexte = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

let etablissement;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: 'MotDePasse2026',
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Test',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
  });
  await CalendrierNational.create({ anneeScolaire: ANNEE, rentrees: RENTREES, vacances: [] });
});

describe('L’ancre de S1 suit la rentrée', () => {
  it('⚠️ l’en-tête de la grille date le lundi de S1 au 7 septembre, plus au 31/08', async () => {
    const grille = await semaine(etablissement.id, ANNEE, `${ANNEE}-W1`);
    expect(grille.jours[0]).toMatchObject({ jour: 'Lundi', date: '2026-09-07' });
    expect(grille.jours[5]).toMatchObject({ jour: 'Samedi', date: '2026-09-12' });
  });

  it('les rentrées sont retenues au démarrage : un calcul sans rentrée explicite les suit', async () => {
    expect(rentreesRetenues(ANNEE)).toEqual([]);

    const annees = await retenirToutesLesRentrees();

    expect(annees).toBe(1);
    // `poser()` date ainsi ses séances : c'était l'un des ~45 appels sans rentrée.
    expect(enTexte(dateDuJour(`${ANNEE}-W4`, 'Lundi'))).toBe('2026-09-28');
  });

  it('sans rentrée saisie, rien ne change : S1 reste la semaine du 1er septembre', async () => {
    await CalendrierNational.deleteMany({});
    const grille = await semaine(etablissement.id, ANNEE, `${ANNEE}-W1`);
    expect(grille.jours[0].date).toBe('2026-08-31');
  });
});
