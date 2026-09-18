import { describe, it, expect } from 'vitest';
import { COORDONNEES, CHEFS_LIEUX, localiserEtablissement } from './localisation.js';

describe('localiserEtablissement', () => {
  /*
   * Le cas RÉEL de l'établissement du dépôt : la ville est le dernier mot du
   * nom, sans accent, et la région la porte aussi.
   */
  it('reconnaît la ville écrite dans le nom', () => {
    expect(
      localiserEtablissement({
        nom: 'Centre de Formation dans les métiers du Bâtiment Fes',
        region: 'Fès-Meknès',
      })
    ).toEqual({ ville: 'fes', latitude: 34.04, longitude: -5.0 });
  });

  it('ignore accents, casse et apostrophes', () => {
    expect(localiserEtablissement({ nom: 'ISTA Tétouan' }).ville).toBe('tetouan');
    expect(localiserEtablissement({ nom: 'CFP LAÂYOUNE' }).ville).toBe('laayoune');
  });

  /*
   * ⚠️ UNE VILLE EN DEUX MOTS N'EN EST UNE QU'UNE FOIS RECOLLÉE : sans
   * l'appariement par paires, « Beni » seul ne veut rien dire et la ville
   * passerait inaperçue.
   */
  it('recolle les villes écrites en deux mots', () => {
    expect(localiserEtablissement({ nom: 'ISTA Beni Mellal' }).ville).toBe('benimellal');
    expect(localiserEtablissement({ nom: 'CFP El Jadida' }).ville).toBe('eljadida');
  });

  /*
   * ⚠️ LE NOM PRIME SUR LA RÉGION : « Casablanca-Settat » couvre les deux, et le
   * nom est le seul à trancher.
   */
  it('préfère la ville du nom au chef-lieu de la région', () => {
    expect(
      localiserEtablissement({ nom: 'ISTA Settat', region: 'Casablanca-Settat' }).ville
    ).toBe('settat');
  });

  it('retombe sur le chef-lieu quand le nom ne dit rien', () => {
    expect(localiserEtablissement({ nom: 'ISTA NTIC', region: 'Souss-Massa' }).ville).toBe(
      'agadir'
    );
  });

  /*
   * ⚠️ `null` PLUTÔT QU'UN POINT PAR DÉFAUT : une météo affichée pour une ville
   * qui n'est pas la bonne est pire qu'une absence de météo — elle se lit comme
   * une information, et rien ne dirait qu'elle est fausse.
   */
  it('rend null quand ni le nom ni la région ne sont reconnus', () => {
    expect(localiserEtablissement({ nom: 'ISTA Quelque Part', region: 'Ailleurs' })).toBeNull();
    expect(localiserEtablissement({})).toBeNull();
    expect(localiserEtablissement()).toBeNull();
  });

  /* Un chef-lieu qui ne serait pas dans la table de coordonnées rendrait `null`
     sans que rien ne le signale : les deux tables doivent rester en phase. */
  it('chaque chef-lieu a ses coordonnées', () => {
    for (const ville of Object.values(CHEFS_LIEUX)) {
      expect(COORDONNEES[ville], `coordonnées manquantes pour ${ville}`).toBeDefined();
    }
  });
});
