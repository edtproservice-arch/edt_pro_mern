import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Loader2, QrCode, X } from 'lucide-react';
import Alerte from '@/components/common/Alerte';
import { Button } from '@/components/ui/button';
import { estApplicationAndroid } from '@/lib/miseAJourDesktop';
import { annulerScan, jetonDuQr, ouvrirReglagesApplication, scannerQr } from '@/lib/scanCarte';

/**
 * « Scanner ma carte » — APPLICATION MOBILE SEULEMENT (2026-10-31, demande du porteur).
 * La caméra lit le QR de la carte de stagiaire ; l'application suit `/carte/<jeton>`, qui ouvre
 * la session de ce compte — sans identifiant ni mot de passe. Voir `lib/scanCarte.js`.
 * Dans un navigateur, le téléphone scanne la carte avec son propre appareil photo : rien ici.
 *
 * ⚠️ LA CAMÉRA EST DERRIÈRE LA PAGE (mode fenêtré, même jour : le plein écran se refermait
 *    aussitôt). Pendant le scan, `html.scan-qr-actif` rend la page transparente et cache
 *    l'application ; le cadre de visée et « Annuler » sont montés HORS de #root, sur `body`.
 */
function CadreDeVisee({ onAnnuler }) {
  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 p-6 text-white">
      {/* Le carré de visée ; l'ombre immense assombrit tout le reste de l'écran. */}
      <div className="relative aspect-square w-64 max-w-[75vw] rounded-2xl border-4 border-white shadow-[0_0_0_200vmax_rgba(0,0,0,0.55)]" />
      <p className="relative text-center text-sm font-medium drop-shadow">Visez le QR code de votre carte</p>
      <button
        type="button"
        onClick={onAnnuler}
        className="relative flex items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-sm font-medium text-black"
      >
        <X className="size-4" />
        Annuler
      </button>
    </div>,
    document.body
  );
}

export default function BoutonScannerCarte() {
  const navigate = useNavigate();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const annuleParUtilisateur = useRef(false);

  // La page redevient opaque quoi qu'il arrive : fin du scan, erreur, ou départ de la page.
  useEffect(() => {
    document.documentElement.classList.toggle('scan-qr-actif', enCours);
    return () => document.documentElement.classList.remove('scan-qr-actif');
  }, [enCours]);

  if (!estApplicationAndroid()) return null;

  const annuler = () => {
    annuleParUtilisateur.current = true;
    annulerScan().catch(() => {});
  };

  const scanner = async () => {
    setErreur(null);
    annuleParUtilisateur.current = false;
    setEnCours(true);
    try {
      const contenu = await scannerQr();
      setEnCours(false);
      if (!contenu) return;
      const jeton = jetonDuQr(contenu);
      if (!jeton) {
        setErreur({ message: 'Ce QR code n’est pas celui d’une carte EDT Pro.' });
        return;
      }
      navigate(`/carte/${encodeURIComponent(jeton)}`);
    } catch (probleme) {
      setEnCours(false);
      if (annuleParUtilisateur.current) return;
      if (probleme?.code === 'PERMISSION') {
        setErreur({ message: 'Autorisez l’appareil photo pour scanner votre carte.', reglages: true });
      } else {
        // Le message réel du scanner : sans lui, un échec sur un téléphone ne se diagnostique pas.
        setErreur({ message: `Le scan s’est arrêté : ${String(probleme?.message ?? probleme)}` });
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full gap-2" onClick={scanner} disabled={enCours}>
        {enCours ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
        Scanner ma carte
      </Button>
      {erreur && (
        <Alerte type="erreur" titre="Connexion par carte impossible">
          {erreur.message}
          {erreur.reglages && (
            <button
              type="button"
              onClick={() => ouvrirReglagesApplication().catch(() => {})}
              className="mt-1 block font-medium underline underline-offset-2"
            >
              Ouvrir les réglages de l’application
            </button>
          )}
        </Alerte>
      )}
      {enCours && <CadreDeVisee onAnnuler={annuler} />}
    </div>
  );
}
