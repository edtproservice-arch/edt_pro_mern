import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import JSZip from 'jszip';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { FORMULAIRES_EXAMEN } from '../../src/modules/absencesStagiaires/exportFormulairesExamen.service.js';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/** Les formulaires d'examen vierges de la page Documents (2026-10-11). */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
let cookies;

beforeEach(async () => {
  // ⚠️ Aucun appel réseau réel pendant les tests — comme `avancement.test.js`.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

const telecharger = (cle, format = 'docx') =>
  request(app)
    .post('/api/v2/absences-stagiaires/formulaires-examen')
    .set('Cookie', cookies)
    .send({ cle, format })
    .responseType('blob');

describe('POST /absences-stagiaires/formulaires-examen', () => {
  it.each(Object.entries(FORMULAIRES_EXAMEN))('%s : le canevas, logo OFPPT en en-tête', async (cle, nom) => {
    const reponse = await telecharger(cle);
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain(`${nom}.docx`);

    const zip = await JSZip.loadAsync(reponse.body);
    expect(zip.file('word/media/logo-ofppt.png')).not.toBeNull();
    expect(await zip.file('word/document.xml').async('string')).toContain('w:headerReference');
    expect(await zip.file('[Content_Types].xml').async('string')).toContain('/word/headerLogo.xml');
    // Aptos remplacée : elle n'existe pas sur le serveur.
    expect(await zip.file('word/styles.xml').async('string')).not.toContain('Aptos');
  });

  it('refuse un formulaire inconnu', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/formulaires-examen')
      .set('Cookie', cookies)
      .send({ cle: 'inconnu', format: 'docx' });
    expect(reponse.status).toBe(400);
  });
});
