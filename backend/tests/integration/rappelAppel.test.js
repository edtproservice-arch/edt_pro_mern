import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { HORAIRES_COURANTS_PAR_DEFAUT } from 'shared/domain';
import { AppelValidation } from '../../src/models/AppelValidation.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { User } from '../../src/models/User.js';

const { notifier, estPubliee } = vi.hoisted(() => ({ notifier: vi.fn(), estPubliee: vi.fn(async () => true) }));
vi.mock('../../src/modules/notifications/notifications.service.js', () => ({ notifier }));
vi.mock('../../src/modules/seances/seances.service.js', () => ({ estPubliee }));

const { creneauxAVenir, envoyerRappelsAppel, instantMaroc, oublierRappels } = await import(
  '../../src/modules/notifications/rappelAppel.service.js'
);

/**
 * Le rappel d'appel au formateur, 30 min avant la fin de sa séance (2026-11-03).
 * Le mardi 3 novembre 2026, le Maroc est à UTC+1 : 11:35Z = 12:35, S2 (10:30–13:00) finit dans 25 min.
 */
const PENDANT_S2 = new Date('2026-11-03T11:35:00Z');

let etablissement;
let formateur;

const seance = (champs = {}) =>
  Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: 2026,
    semaine: '2026-W10',
    jour: 'Mardi',
    seance: 'S2',
    date: new Date('2026-11-03T00:00:00'),
    formateurMatricule: '9863',
    groupe: 'GM101',
    ...champs,
  });

beforeEach(async () => {
  oublierRappels();
  notifier.mockClear();
  estPubliee.mockClear();
  estPubliee.mockResolvedValue(true);
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
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
  });
  formateur = await User.create({
    nomComplet: 'BRAHIM LOURID',
    email: 'formateur@edtpro.ma',
    identifiant: '9863',
    motDePasse: 'MotDePasse2026',
    role: ROLES.FORMATEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds: [etablissement.id],
  });
});

describe('Rappel d’appel (2026-11-03)', () => {
  it('lit l’heure du Maroc, quel que soit le fuseau du serveur', () => {
    expect(instantMaroc(PENDANT_S2)).toEqual({ jour: '2026-11-03', nomJour: 'Mardi', minute: 12 * 60 + 35 });
  });

  it('retient les créneaux qui finissent dans 30 minutes au plus', () => {
    const { semaine } = HORAIRES_COURANTS_PAR_DEFAUT;
    expect(creneauxAVenir(HORAIRES_COURANTS_PAR_DEFAUT, 'Mardi', 12 * 60 + 30).map((c) => c.seance)).toEqual(['S2']);
    expect(creneauxAVenir(HORAIRES_COURANTS_PAR_DEFAUT, 'Mardi', 12 * 60 + 29)).toEqual([]);
    expect(creneauxAVenir(HORAIRES_COURANTS_PAR_DEFAUT, 'Mardi', 13 * 60)).toEqual([]);
    expect(semaine.S2.fin).toBe('13:00');
  });

  it('prévient le formateur, une seule fois, avec les groupes d’une fusion réunis', async () => {
    await seance({ groupe: 'GM101 GM102' });

    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 1 });
    expect(notifier).toHaveBeenCalledTimes(1);
    const [ids, notification] = notifier.mock.calls[0];
    expect(ids).toEqual([formateur.id]);
    expect(notification).toMatchObject({ genre: 'appel', lien: '/app/absences' });
    expect(notification.corps).toContain('GM101, GM102');
    expect(notification.corps).toContain('13:00');

    // Le passage suivant, 5 minutes plus tard : rien de plus.
    expect(await envoyerRappelsAppel(new Date(PENDANT_S2.getTime() + 5 * 60 * 1000))).toEqual({ rappels: 0 });
  });

  it('rien si l’appel est déjà validé', async () => {
    await seance();
    await AppelValidation.create({
      etablissementId: etablissement.id,
      anneeScolaire: 2026,
      date: '2026-11-03',
      jour: 'Mardi',
      seance: 'S2',
      groupe: 'GM101',
      valideLe: new Date(),
    });
    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 0 });
  });

  it('rien pour une semaine non publiée, un formateur absent ou la démo', async () => {
    await seance();
    estPubliee.mockResolvedValue(false);
    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 0 });

    estPubliee.mockResolvedValue(true);
    await Seance.updateMany({}, { statut: 'absent' });
    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 0 });

    await Seance.updateMany({}, { statut: 'planifie' });
    await Etablissement.updateOne({ _id: etablissement.id }, { demo: true });
    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 0 });
    expect(notifier).not.toHaveBeenCalled();
  });

  it('rien pour une séance du mardi précédent', async () => {
    await seance({ date: new Date('2026-10-27T00:00:00') });
    expect(await envoyerRappelsAppel(PENDANT_S2)).toEqual({ rappels: 0 });
  });
});
