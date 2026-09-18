import { Router } from 'express';
import { REGIONS_OFPPT } from 'shared/constants';
import * as service from './reseau.service.js';

/**
 * Réseau OFPPT — LECTURE PUBLIQUE.
 * ← public/data/etablissements.json, servi en clair par le serveur web.
 *
 * ═══ ⚠️ AUCUN `authenticate` ICI, ET C'EST VOULU ═══
 * L'inscription d'un directeur se fait SANS être connecté : la cascade
 * région → complexe → établissement doit donc être servie à un visiteur. Y
 * poser un garde rendrait le formulaire d'inscription impossible à remplir.
 *
 * ⚠️ CE QUI SORT EST DÉJÀ PUBLIC : ce sont les noms officiels des établissements
 * du réseau, la même liste que le fichier JSON exposait. Aucune donnée
 * d'établissement — ni compte, ni emploi du temps — ne transite par ici.
 *
 * ⚠️ L'ÉCRITURE, elle, vit dans `reseau.admin.routes.js`.
 */
const router = Router();

/** Les dix régions, figées dans le code (décision du 2026-09-02). */
router.get('/regions', (req, res) => {
  res.json({ success: true, regions: REGIONS_OFPPT });
});

/**
 * Tout le réseau, dans la forme que l'écran d'inscription attend :
 * `{ région: { complexe: [noms] } }`.
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, reseau: await service.arborescence() });
  } catch (error) {
    next(error);
  }
});

export default router;
