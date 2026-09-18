import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import * as modeles from '../../src/models/index.js';
import { Seance } from '../../src/models/Seance.js';
import { Base } from '../../src/models/Base.js';
import { Etablissement } from '../../src/models/Etablissement.js';

/**
 * Vérifie que les schémas se chargent, que leurs contraintes mordent réellement,
 * et que les index déclarés sont bien créés dans la base.
 *
 * Sans typage statique, ce sont ces contrôles qui remplacent la compilation :
 * un `enum` mal orthographié ou un index oublié ne se verrait qu'en production
 * (§5bis, garde-fou n°3).
 */

const MODELES_ATTENDUS = [
  'User',
  'Etablissement',
  'Base',
  'Seance',
  'EnoteImport',
  'Chronogramme',
  'AbsenceFormateur',
  'AbsenceStagiaire',
  'Stagiaire',
  'Message',
  'RefreshToken',
  'CodeVerification',
  'AutoGenConfig',
  'UnplacedSession',
  'AuditLog',
];

async function etablissementDeTest() {
  return Etablissement.create({
    proprietaireId: new mongoose.Types.ObjectId(),
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
  });
}

const seanceValide = (etablissementId, surcharge = {}) => ({
  etablissementId,
  anneeScolaire: 2026,
  semaine: '2026-W3',
  jour: 'Lundi',
  seance: 'S1',
  date: new Date(2026, 8, 14),
  formateurMatricule: '9863',
  groupe: 'DEVOWFS201',
  module: 'EGTSA206',
  salle: 'A12',
  ...surcharge,
});

describe('Modèles — chargement', () => {
  it('expose les 15 collections cibles', () => {
    for (const nom of MODELES_ATTENDUS) {
      expect(modeles[nom], `modèle ${nom} manquant`).toBeDefined();
    }
  });

  it('déclare tous les schémas en mode strict', () => {
    // `strict: true` refuse les champs inconnus plutôt que de les stocker
    // silencieusement — garde-fou n°3 du §5bis.
    for (const nom of MODELES_ATTENDUS) {
      expect(modeles[nom].schema.options.strict, `${nom} n'est pas strict`).toBe(true);
    }
  });
});

describe('Seance — la contrainte structurante', () => {
  it("refuse une séance sans formateur, sans groupe ou sans module", async () => {
    const etablissement = await etablissementDeTest();

    for (const champ of ['formateurMatricule', 'groupe', 'module']) {
      const invalide = seanceValide(etablissement.id, { [champ]: undefined });
      await expect(Seance.create(invalide)).rejects.toThrow();
    }
  });

  it('refuse un jour ou une séance hors nomenclature', async () => {
    const etablissement = await etablissementDeTest();

    await expect(
      Seance.create(seanceValide(etablissement.id, { jour: 'Lundi ' }))
    ).rejects.toThrow();
    await expect(Seance.create(seanceValide(etablissement.id, { seance: 'S9' }))).rejects.toThrow();
  });

  it("empêche un formateur d'être à deux endroits au même créneau", async () => {
    const etablissement = await etablissementDeTest();
    await Seance.init(); // attend la création effective des index

    await Seance.create(seanceValide(etablissement.id));

    // Même formateur, même créneau, autre groupe : c'est la garantie que le
    // blob JSON assurait par construction et qu'il fallait redéclarer.
    await expect(
      Seance.create(seanceValide(etablissement.id, { groupe: 'GEOCF201', module: 'M202' }))
    ).rejects.toThrow(/duplicate key/i);
  });

  it('autorise le même créneau pour un autre formateur', async () => {
    const etablissement = await etablissementDeTest();
    await Seance.init();

    await Seance.create(seanceValide(etablissement.id));
    const autre = await Seance.create(
      seanceValide(etablissement.id, { formateurMatricule: '10039', groupe: 'GEOCF201' })
    );

    expect(autre.id).toBeDefined();
  });

  it('crée les index de détection de conflits', async () => {
    await Seance.init();
    const index = await Seance.collection.indexes();
    const cles = index.map((i) => Object.keys(i.key).join(','));

    // Conflit de salle et conflit de groupe : ce sont eux qui permettent au
    // serveur de répondre, là où l'existant parcourait les grilles en JS.
    expect(cles.some((c) => c.includes('groupe'))).toBe(true);
    expect(cles.some((c) => c.includes('salle'))).toBe(true);
  });
});

describe('Base — une seule par établissement et par année', () => {
  it('rejette un doublon', async () => {
    const etablissement = await etablissementDeTest();
    await Base.init();

    await Base.create({ etablissementId: etablissement.id, anneeScolaire: 2026 });

    await expect(
      Base.create({ etablissementId: etablissement.id, anneeScolaire: 2026 })
    ).rejects.toThrow(/duplicate key/i);
  });

  it("accepte la même année pour un autre établissement", async () => {
    const premier = await etablissementDeTest();
    const second = await etablissementDeTest();
    await Base.init();

    await Base.create({ etablissementId: premier.id, anneeScolaire: 2026 });
    const autre = await Base.create({ etablissementId: second.id, anneeScolaire: 2026 });

    expect(autre.id).toBeDefined();
  });

  it("refuse une affectation dont le type n'est pas reconnu", async () => {
    const etablissement = await etablissementDeTest();

    await expect(
      Base.create({
        etablissementId: etablissement.id,
        anneeScolaire: 2026,
        affectations: [
          { formateur: '9863', groupe: 'G1', module: 'M1', type: 'hybride' },
        ],
      })
    ).rejects.toThrow();
  });
});
