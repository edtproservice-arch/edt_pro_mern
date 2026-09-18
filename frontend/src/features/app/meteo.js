import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
} from 'lucide-react';

/**
 * Le temps qu'il fait → une icône et un mot.
 *
 * ═══ ⚠️ LES CODES SONT CEUX DE L'OMM (WMO 4677), pas ceux d'Open-Meteo ═══
 * C'est une nomenclature publique : changer de fournisseur n'obligerait pas à
 * réécrire cette table, tant que le suivant rend des codes WMO. C'est aussi ce
 * qui permet de la tenir ici, côté écran, sans que le serveur ait à décider de
 * l'apparence.
 *
 * ⚠️ DES ICÔNES lucide, PAS DES ÉMOJIS : le reste de l'application n'en emploie
 * pas, et un émoji est rendu par la police du système — il change d'aspect d'un
 * poste à l'autre et ne suit pas le thème. L'emblème HORAIRE, lui, reste un
 * émoji : c'est le repli, et il doit se distinguer d'une vraie mesure.
 */

/**
 * @param {number} code   code WMO rendu par l'API
 * @param {boolean} estJour  le jour se lit dans la RÉPONSE, jamais dans l'heure
 *   du navigateur : le lever et le coucher se déplacent de plus d'une heure
 *   dans l'année.
 * @returns {{Icone: Function, libelle: string}}
 */
export function apparenceMeteo(code, estJour = true) {
  const entree = TABLE.find((ligne) => ligne.codes.includes(code));

  /* ⚠️ UN CODE INCONNU N'EST PAS UN CIEL CLAIR : on rend le nuage neutre plutôt
     qu'un soleil, qui affirmerait quelque chose de faux. */
  if (!entree) return { Icone: Cloud, libelle: 'Temps couvert' };

  return {
    Icone: estJour ? entree.jour : (entree.nuit ?? entree.jour),
    libelle: entree.libelle,
  };
}

const TABLE = [
  { codes: [0], jour: Sun, nuit: Moon, libelle: 'Ciel dégagé' },
  { codes: [1, 2], jour: CloudSun, nuit: CloudMoon, libelle: 'Peu nuageux' },
  { codes: [3], jour: Cloud, libelle: 'Couvert' },
  { codes: [45, 48], jour: CloudFog, libelle: 'Brouillard' },
  { codes: [51, 53, 55, 56, 57], jour: CloudDrizzle, libelle: 'Bruine' },
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], jour: CloudRain, libelle: 'Pluie' },
  { codes: [71, 73, 75, 77, 85, 86], jour: CloudSnow, libelle: 'Neige' },
  { codes: [95, 96, 99], jour: CloudLightning, libelle: 'Orage' },
];
