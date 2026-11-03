import { describe, it, expect, vi } from 'vitest';
import { ETAT_INITIAL, creerSuiviMiseAJour, plusRecente, verifierPlay, versionDuCode } from './miseAJourDesktop';

/** Une mise à jour factice : `evenements` sont rejoués pendant le téléchargement. */
const fausseMiseAJour = (version, { evenements = [], echec = null } = {}) => ({
  version,
  currentVersion: '0.1.0',
  body: 'Corrections et nouveautés',
  date: '2026-10-30T12:00:00Z',
  downloadAndInstall: vi.fn(async (suivre) => {
    for (const evenement of evenements) suivre(evenement);
    if (echec) throw new Error(echec);
  }),
});

describe('creerSuiviMiseAJour (2026-10-30)', () => {
  it('sans version plus récente, rien ne s’affiche', async () => {
    const suivi = creerSuiviMiseAJour({ verifier: async () => null, relancer: vi.fn() });
    await suivi.verifier();
    expect(suivi.lire()).toEqual(ETAT_INITIAL);
  });

  it('une version trouvée ouvre la fenêtre ; « Plus tard » la ferme, l’icône reste', async () => {
    const suivi = creerSuiviMiseAJour({ verifier: async () => fausseMiseAJour('0.2.0'), relancer: vi.fn() });
    await suivi.verifier();
    expect(suivi.lire()).toMatchObject({ etat: 'disponible', version: '0.2.0', versionActuelle: '0.1.0', fenetreOuverte: true });

    suivi.fermer();
    expect(suivi.lire()).toMatchObject({ etat: 'disponible', fenetreOuverte: false });

    // La même version, revue plus tard, ne rouvre pas la fenêtre…
    await suivi.verifier();
    expect(suivi.lire().fenetreOuverte).toBe(false);
    // …l'icône, si.
    suivi.ouvrir();
    expect(suivi.lire().fenetreOuverte).toBe(true);
  });

  it('une version PLUS récente que celle déjà proposée rouvre la fenêtre', async () => {
    let version = '0.2.0';
    const suivi = creerSuiviMiseAJour({ verifier: async () => fausseMiseAJour(version), relancer: vi.fn() });
    await suivi.verifier();
    suivi.fermer();
    version = '0.3.0';
    await suivi.verifier();
    expect(suivi.lire()).toMatchObject({ version: '0.3.0', fenetreOuverte: true });
  });

  it('suit la progression, puis redémarre', async () => {
    const relancer = vi.fn();
    const progressions = [];
    const suivi = creerSuiviMiseAJour({
      verifier: async () =>
        fausseMiseAJour('0.2.0', {
          evenements: [
            { event: 'Started', data: { contentLength: 200 } },
            { event: 'Progress', data: { chunkLength: 50 } },
            { event: 'Progress', data: { chunkLength: 150 } },
          ],
        }),
      relancer,
    });
    suivi.abonner(() => progressions.push(suivi.lire().progression));
    await suivi.verifier();
    await suivi.installer();

    expect(progressions).toContain(25);
    expect(suivi.lire()).toMatchObject({ etat: 'redemarrage', progression: 100 });
    expect(relancer).toHaveBeenCalledTimes(1);
  });

  it('un échec se dit dans la fenêtre, et on peut réessayer', async () => {
    const miseAJour = fausseMiseAJour('0.2.0', { echec: 'réseau coupé' });
    const suivi = creerSuiviMiseAJour({ verifier: async () => miseAJour, relancer: vi.fn() });
    await suivi.verifier();
    await suivi.installer();
    expect(suivi.lire()).toMatchObject({ etat: 'erreur', erreur: 'réseau coupé', fenetreOuverte: true });

    await suivi.installer();
    expect(miseAJour.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it('une vérification impossible (hors ligne) est avalée', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const suivi = creerSuiviMiseAJour({
      verifier: async () => {
        throw new Error('hors ligne');
      },
      relancer: vi.fn(),
    });
    await expect(suivi.verifier()).resolves.toBeUndefined();
    expect(suivi.lire()).toEqual(ETAT_INITIAL);
    avertir.mockRestore();
  });
});

describe('Android (2026-10-30)', () => {
  it('compare les versions nombre par nombre', () => {
    expect(plusRecente('0.10.0', '0.9.3')).toBe(true);
    expect(plusRecente('0.2.0', '0.2.0')).toBe(false);
    expect(plusRecente('0.1.9', '0.2.0')).toBe(false);
    expect(plusRecente('1.0.0', '0.99.99')).toBe(true);
  });

  it('« installer » ouvre l’APK sans redémarrer ; la proposition reste dans l’icône', async () => {
    const relancer = vi.fn();
    const miseAJour = fausseMiseAJour('0.3.0');
    const suivi = creerSuiviMiseAJour({ verifier: async () => miseAJour, relancer, mobile: () => true });
    await suivi.verifier();
    await suivi.installer();

    expect(miseAJour.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relancer).not.toHaveBeenCalled();
    expect(suivi.lire()).toMatchObject({ etat: 'disponible', fenetreOuverte: false, version: '0.3.0' });
  });
});

/** Le pont Kotlin `window.EdtproPlay`, factice : `etats` sont rendus l'un après l'autre par `lire`. */
const fauxPont = (...etats) => {
  let i = 0;
  return {
    lire: vi.fn(() => JSON.stringify(etats[Math.min(i++, etats.length - 1)])),
    verifier: vi.fn(),
    lancer: vi.fn(),
    terminer: vi.fn(),
  };
};

describe('Google Play In-App Updates (2026-11-03)', () => {
  it('retrouve la version depuis le versionCode de Tauri', () => {
    expect(versionDuCode(2021)).toBe('0.2.21');
    expect(versionDuCode(1002003)).toBe('1.2.3');
  });

  it('attend la réponse de Play, puis annonce la version qu’il propose', async () => {
    const pont = fauxPont({ etat: 'inconnu' }, { etat: 'disponible', versionCode: 2021, progression: -1 });
    const trouvee = await verifierPlay(pont, '0.2.20', { pas: 1 });
    expect(pont.verifier).toHaveBeenCalledTimes(1);
    expect(trouvee).toMatchObject({ version: '0.2.21', currentVersion: '0.2.20', via: 'play' });
  });

  it('rien sur Play (version encore en examen) : aucune annonce', async () => {
    expect(await verifierPlay(fauxPont({ etat: 'aucune', versionCode: 2020 }), '0.2.20')).toBeNull();
  });

  it('installée hors Play : `undefined`, la page retombe sur android.json', async () => {
    expect(await verifierPlay(fauxPont({ etat: 'indisponible' }), '0.2.20')).toBeUndefined();
  });

  it('accepte, télécharge, puis installe : l’application redémarre', async () => {
    const pont = fauxPont(
      { etat: 'disponible', versionCode: 2021 },
      { etat: 'disponible', versionCode: 2021 },
      { etat: 'telechargement', versionCode: 2021, progression: 40 },
      { etat: 'telechargee', versionCode: 2021, progression: 100 }
    );
    const suivi = creerSuiviMiseAJour({ verifier: () => verifierPlay(pont, '0.2.20', { pas: 1 }), relancer: vi.fn(), mobile: true });
    await suivi.verifier();
    await suivi.installer();
    expect(pont.lancer).toHaveBeenCalledTimes(1);
    expect(pont.terminer).toHaveBeenCalledTimes(1);
    expect(suivi.lire()).toMatchObject({ etat: 'redemarrage', via: 'play' });
  });

  it('refusée dans la fenêtre de Google : la proposition reste dans l’icône', async () => {
    const pont = fauxPont({ etat: 'disponible', versionCode: 2021 });
    const suivi = creerSuiviMiseAJour({ verifier: () => verifierPlay(pont, '0.2.20', { pas: 1 }), relancer: vi.fn(), mobile: true });
    await suivi.verifier();
    await suivi.installer();
    expect(pont.terminer).not.toHaveBeenCalled();
    expect(suivi.lire()).toMatchObject({ etat: 'disponible', fenetreOuverte: false });
  });
});
