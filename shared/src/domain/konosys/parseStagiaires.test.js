import { describe, it, expect } from 'vitest';
import { decomposerLibelle, lireStagiaires } from './parseStagiaires.js';

function ligne(surcharges = {}) {
  return {
    MatriculeEtudiant: 'S001',
    Nom: 'BENANI',
    Prenom: 'Salma',
    Nom_Arabe: 'بناني',
    Prenom_arabe: 'سلمى',
    CIN: 'BE12345',
    DateNaissance: '2004-03-12',
    CodeDiplome: 'DEVOWFS201',
    Site: 'CASABLANCA',
    LibelleLong: 'ISTA_NTIC_TS-Développement Digital (2A)',
    ...surcharges,
  };
}

describe('decomposerLibelle', () => {
  it('extrait le niveau, l’année et la filière', () => {
    expect(decomposerLibelle('ISTA_NTIC_TS-Développement Digital (2A)')).toEqual({
      niveau: 'TS',
      annee: '2A',
      filiere: 'Développement Digital',
    });
  });

  it('découpe au PREMIER tiret — une filière peut en contenir', () => {
    const resultat = decomposerLibelle('ISTA_NTIC_T-Gestion-Comptabilité (1A)');
    expect(resultat.niveau).toBe('T');
    expect(resultat.filiere).toBe('Gestion-Comptabilité');
  });

  it('rend des champs vides plutôt que de lever, sur un libellé absent', () => {
    // La colonne est facultative dans les faits : une ligne sans elle doit
    // rester importable, sinon un fichier partiel bloque tout l'import.
    expect(decomposerLibelle('')).toEqual({ niveau: '', annee: '', filiere: '' });
    expect(decomposerLibelle(null)).toEqual({ niveau: '', annee: '', filiere: '' });
  });

  it('supporte un libellé sans tiret', () => {
    expect(decomposerLibelle('FORMATION (1A)')).toEqual({
      niveau: '',
      annee: '1A',
      filiere: '',
    });
  });
});

describe('lireStagiaires', () => {
  it('lit une ligne complète', () => {
    const { stagiaires } = lireStagiaires([ligne()]);

    expect(stagiaires).toHaveLength(1);
    expect(stagiaires[0]).toMatchObject({
      matricule: 'S001',
      nom: 'BENANI',
      prenom: 'Salma',
      nomArabe: 'بناني',
      cin: 'BE12345',
      site: 'CASABLANCA',
      groupes: ['DEVOWFS201'],
      groupePrincipal: 'DEVOWFS201',
      niveau: 'TS',
      annee: '2A',
      filiere: 'Développement Digital',
    });
  });

  it('FABRIQUE l’adresse à partir du matricule', () => {
    // ⚠️ Konosys n'en fournit pas : `upload.php:74` la compose. Une colonne
    // « email » du fichier ne doit donc pas être attendue.
    const { stagiaires } = lireStagiaires([ligne({ EmailStagiaire: 'autre@ailleurs.ma' })]);
    expect(stagiaires[0].email).toBe('S001@ofppt-edu.ma');
  });

  it('REGROUPE les inscriptions d’un même stagiaire', () => {
    /*
     * Le cœur du portage : Konosys rend une ligne par inscription. MySQL les
     * gardait séparées, d'où le tri TS/FQ à chaque lecture. Ici un stagiaire
     * est un document, avec la liste de ses groupes.
     */
    const { stagiaires } = lireStagiaires([
      ligne(),
      ligne({
        CodeDiplome: 'ACADA101 (FQ)',
        LibelleLong: 'CFP_HAY_FQ-Anglais professionnel (1A)',
      }),
    ]);

    expect(stagiaires).toHaveLength(1);
    expect(stagiaires[0].groupes).toEqual(['DEVOWFS201', 'ACADA101 (FQ)']);
  });

  it('retient la ligne DIPLÔMANTE pour l’identité scolaire, même arrivée en second', () => {
    // Sa carte imprimée porterait sinon « FQ » comme niveau, et sa vraie
    // filière serait perdue.
    const { stagiaires } = lireStagiaires([
      ligne({
        CodeDiplome: 'ACADA101 (FQ)',
        LibelleLong: 'CFP_HAY_FQ-Anglais professionnel (1A)',
      }),
      ligne(),
    ]);

    expect(stagiaires[0]).toMatchObject({
      groupePrincipal: 'DEVOWFS201',
      niveau: 'TS',
      annee: '2A',
      filiere: 'Développement Digital',
    });
    expect(stagiaires[0].groupes).toEqual(['ACADA101 (FQ)', 'DEVOWFS201']);
  });

  it('accepte « codediplome1 » comme second intitulé de colonne', () => {
    const { CodeDiplome, ...sansCode } = ligne();
    const { stagiaires } = lireStagiaires([{ ...sansCode, codediplome1: 'GM101' }]);

    expect(stagiaires[0].groupes).toEqual(['GM101']);
  });

  it('ne compte pas deux fois le même groupe', () => {
    const { stagiaires } = lireStagiaires([ligne(), ligne()]);
    expect(stagiaires[0].groupes).toEqual(['DEVOWFS201']);
  });

  it('COMPTE les lignes sans matricule au lieu de les taire', () => {
    // Les passer sous silence ferait croire à un import complet ; le directeur
    // doit savoir que N lignes de son fichier n'ont rattaché personne.
    const { stagiaires, ignorees } = lireStagiaires([
      ligne(),
      ligne({ MatriculeEtudiant: '' }),
      ligne({ MatriculeEtudiant: '   ' }),
    ]);

    expect(stagiaires).toHaveLength(1);
    expect(ignorees).toBe(2);
  });

  it('laisse un stagiaire uniquement FQ sans groupe principal', () => {
    // Cas réel : rien ne garantit qu'une ligne diplômante existe. Le signaler
    // par un champ vide vaut mieux que de promouvoir la ligne FQ en douce.
    const { stagiaires } = lireStagiaires([
      ligne({
        CodeDiplome: 'ACADA101 (FQ)',
        LibelleLong: 'CFP_HAY_FQ-Anglais professionnel (1A)',
      }),
    ]);

    expect(stagiaires[0].groupePrincipal).toBe('');
    expect(stagiaires[0].groupes).toEqual(['ACADA101 (FQ)']);
  });

  it('rend une liste vide sur un fichier vide', () => {
    expect(lireStagiaires([])).toEqual({ stagiaires: [], ignorees: 0 });
    expect(lireStagiaires()).toEqual({ stagiaires: [], ignorees: 0 });
  });
});
