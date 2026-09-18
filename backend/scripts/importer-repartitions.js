#!/usr/bin/env node
/**
 * Reprise du référentiel DRIF depuis MySQL vers MongoDB.
 *
 *   node --env-file=.env scripts/importer-repartitions.js [--verifier]
 *
 * ═══ POURQUOI CE SCRIPT EXISTE, ALORS QUE L'ETL A ÉTÉ ABANDONNÉ ═══
 * La décision du 2026-08-15 (démarrage sur une base vide) porte sur les données
 * des établissements et sur les comptes. La répartition DRIF n'est ni l'un ni
 * l'autre : c'est un catalogue NATIONAL, identique pour tous, sans lequel la
 * carte d'établissement ne peut pas être construite. La ressaisir, ce serait
 * 13 359 lignes à retaper.
 *
 * Idempotent : il n'écrit que ce qui manque (`ordered: false` + index unique),
 * et peut donc être rejoué après une mise à jour du référentiel.
 *
 * La lecture MySQL passe par le fichier JSON produit par
 * `outils/exporter-repartitions.php` — le backend Node n'a pas de dépendance
 * MySQL, et n'en aura jamais : c'est une reprise ponctuelle, pas une synchro.
 */
import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { Repartition } from '../src/models/Repartition.js';

const CHEMIN_DEFAUT = new URL('../../outils/repartitions.json', import.meta.url);

/** Colonnes du JSON exporté → champs du modèle. */
function convertir(ligne) {
  const nombre = (valeur) => {
    const converti = Number.parseFloat(valeur);
    return Number.isFinite(converti) ? converti : 0;
  };

  return {
    secteur: String(ligne.secteur ?? '').trim(),
    niveauFormation: String(ligne.niveau_formation ?? '').trim(),
    typeFormation: String(ligne.type_formation ?? '').trim(),
    creneau: String(ligne.creneau ?? '').trim(),
    codeFiliereDrif: String(ligne.code_filiere_drif ?? '').trim(),
    intituleFiliere: String(ligne.intitule_filiere ?? '').trim(),
    codeFiliereCarte: String(ligne.code_filiere_carte ?? '').trim(),
    filiere: String(ligne.filiere ?? '').trim(),
    anneeFormation: Number.parseInt(ligne.annee_formation, 10) || 1,
    codeModule: String(ligne.code_module ?? '').trim(),
    module: String(ligne.module ?? '').trim(),
    mhpS1: nombre(ligne.mhp_s1),
    mhsynS1: nombre(ligne.mhsyn_s1),
    mhasynS1: nombre(ligne.mhasyn_s1),
    mhpS2: nombre(ligne.mhp_s2),
    mhsynS2: nombre(ligne.mhsyn_s2),
    mhasynS2: nombre(ligne.mhasyn_s2),
    mhpTotale: nombre(ligne.mhp_totale),
    mhdTotale: nombre(ligne.mhd_totale),
    // Le champ MySQL est un « O »/« N », le modèle un booléen.
    efmRegional: String(ligne.efm_regional ?? '').toUpperCase() === 'O',
    metier: String(ligne.metier ?? '').trim(),
  };
}

async function principal() {
  const verifierSeulement = argv.includes('--verifier');
  await connectDatabase();

  if (verifierSeulement) {
    const total = await Repartition.estimatedDocumentCount();
    const secteurs = await Repartition.distinct('secteur');
    console.log(`Répartitions en base : ${total} ligne(s), ${secteurs.length} secteur(s)`);
    await disconnectDatabase();
    return;
  }

  const chemin = argv.find((valeur) => valeur.endsWith('.json')) ?? CHEMIN_DEFAUT;
  const brut = JSON.parse(await readFile(chemin, 'utf8'));
  const lignes = Array.isArray(brut) ? brut : (brut.lignes ?? []);

  if (lignes.length === 0) {
    console.error('Aucune ligne dans le fichier source.');
    exit(1);
  }

  // Les lignes sans code filière NI code module ne servent à rien et
  // s'écraseraient toutes sur la même clé unique. Le PHP les écartait aussi
  // (repartition_import.php:334).
  const documents = lignes
    .map(convertir)
    .filter((ligne) => ligne.codeFiliereDrif !== '' || ligne.codeModule !== '');

  await Repartition.syncIndexes();

  let inseres = 0;
  const TAILLE_LOT = 1000;

  for (let debut = 0; debut < documents.length; debut += TAILLE_LOT) {
    const lot = documents.slice(debut, debut + TAILLE_LOT);
    try {
      const resultat = await Repartition.insertMany(lot, { ordered: false });
      inseres += resultat.length;
    } catch (erreur) {
      // Doublons attendus au rejeu : l'index unique les refuse un par un et
      // laisse passer le reste du lot (`ordered: false`).
      inseres += erreur.insertedDocs?.length ?? erreur.result?.nInserted ?? 0;
      const autres = (erreur.writeErrors ?? []).filter((e) => e.err?.code !== 11000);
      if (autres.length > 0) throw erreur;
    }
  }

  const total = await Repartition.estimatedDocumentCount();
  console.log(`${inseres} ligne(s) insérée(s) · ${total} en base au total`);

  await disconnectDatabase();
}

principal().catch(async (erreur) => {
  console.error('Import des répartitions en échec :', erreur.message);
  await disconnectDatabase().catch(() => {});
  exit(1);
});
