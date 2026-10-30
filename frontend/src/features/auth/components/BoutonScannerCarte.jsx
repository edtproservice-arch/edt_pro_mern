import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, QrCode } from 'lucide-react';
import Alerte from '@/components/common/Alerte';
import { Button } from '@/components/ui/button';
import { estApplicationAndroid } from '@/lib/miseAJourDesktop';
import { jetonDuQr, ouvrirReglagesApplication, scannerQr } from '@/lib/scanCarte';

/**
 * « Scanner ma carte » — APPLICATION MOBILE SEULEMENT (2026-10-31, demande du porteur).
 * La caméra lit le QR de la carte de stagiaire ; l'application suit `/carte/<jeton>`, qui ouvre
 * la session de ce compte — sans identifiant ni mot de passe. Voir `lib/scanCarte.js`.
 * Dans un navigateur, le téléphone scanne la carte avec son propre appareil photo : rien ici.
 */
export default function BoutonScannerCarte() {
  const navigate = useNavigate();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  if (!estApplicationAndroid()) return null;

  const scanner = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      const contenu = await scannerQr();
      if (!contenu) return; // Scan annulé (retour) : rien à dire.
      const jeton = jetonDuQr(contenu);
      if (!jeton) {
        setErreur({ message: 'Ce QR code n’est pas celui d’une carte EDT Pro.' });
        return;
      }
      navigate(`/carte/${encodeURIComponent(jeton)}`);
    } catch (probleme) {
      if (probleme?.code === 'PERMISSION') {
        setErreur({ message: 'Autorisez l’appareil photo pour scanner votre carte.', reglages: true });
      } else if (!/cancel/i.test(String(probleme?.message ?? probleme))) {
        setErreur({ message: 'Le scan n’a pas abouti. Réessayez.' });
      }
    } finally {
      setEnCours(false);
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
    </div>
  );
}
