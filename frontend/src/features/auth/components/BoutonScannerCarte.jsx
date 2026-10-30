import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Loader2, QrCode, X } from 'lucide-react';
import Alerte from '@/components/common/Alerte';
import { Button } from '@/components/ui/button';
import { estApplicationAndroid } from '@/lib/miseAJourDesktop';
import {
  creerDecodeur,
  demanderCamera,
  fermerCamera,
  jetonDuQr,
  ouvrirCamera,
  ouvrirReglagesApplication,
} from '@/lib/scanCarte';

/**
 * « Scanner ma carte » — APPLICATION MOBILE SEULEMENT (2026-10-31, demande du porteur).
 * La caméra lit le QR de la carte de stagiaire ; l'application suit `/carte/<jeton>`, qui ouvre
 * la session de ce compte — sans identifiant ni mot de passe. Voir `lib/scanCarte.js`.
 * Dans un navigateur, le téléphone scanne la carte avec son propre appareil photo : rien ici.
 *
 * ⚠️ LE SCAN EST DANS LA PAGE : le module natif plantait sous Android. La caméra remplit l'écran
 *    (`<video>`), un cadre de visée et « Annuler » par-dessus ; le décodage tourne ~6 fois/s.
 */
const INTERVALLE_MS = 160;

function FenetreScan({ onLu, onErreur, onAnnuler }) {
  const video = useRef(null);
  // Les rappels dans des références : la caméra ne redémarre pas à chaque rendu de la page.
  const rappels = useRef({ onLu, onErreur });
  rappels.current = { onLu, onErreur };

  useEffect(() => {
    let flux = null;
    let fini = false;
    let minuterie = null;

    (async () => {
      try {
        flux = await ouvrirCamera(video.current);
        if (fini) return fermerCamera(flux);
        const decoder = await creerDecodeur();
        const essayer = async () => {
          if (fini) return;
          try {
            const contenu = await decoder(video.current);
            if (contenu && !fini) {
              fini = true;
              rappels.current.onLu(contenu);
              return;
            }
          } catch {
            // Une image illisible n'arrête pas le scan : on réessaie à la suivante.
          }
          minuterie = setTimeout(essayer, INTERVALLE_MS);
        };
        essayer();
      } catch (erreur) {
        if (!fini) rappels.current.onErreur(erreur);
      }
    })();

    // En quittant la fenêtre — QR lu, annulation, erreur —, la caméra s'éteint.
    return () => {
      fini = true;
      clearTimeout(minuterie);
      fermerCamera(flux ?? video.current?.srcObject);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black text-white">
      <video ref={video} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
        {/* Le carré de visée ; l'ombre immense assombrit tout le reste de l'écran. */}
        <div className="aspect-square w-64 max-w-[75vw] rounded-2xl border-4 border-white shadow-[0_0_0_200vmax_rgba(0,0,0,0.5)]" />
        <p className="relative text-center text-sm font-medium drop-shadow">Visez le QR code de votre carte</p>
        <button
          type="button"
          onClick={onAnnuler}
          className="relative flex items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-sm font-medium text-black"
        >
          <X className="size-4" />
          Annuler
        </button>
      </div>
    </div>,
    document.body
  );
}

export default function BoutonScannerCarte() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState('repos'); // repos | autorisation | scan
  const [erreur, setErreur] = useState(null);

  if (!estApplicationAndroid()) return null;

  const commencer = async () => {
    setErreur(null);
    setEtat('autorisation');
    try {
      await demanderCamera();
      setEtat('scan');
    } catch (probleme) {
      setEtat('repos');
      signaler(probleme);
    }
  };

  function signaler(probleme) {
    if (probleme?.code === 'PERMISSION') {
      setErreur({ message: 'Autorisez l’appareil photo pour scanner votre carte.', reglages: true });
    } else {
      // Le message réel : sans lui, un échec sur un téléphone ne se diagnostique pas.
      setErreur({ message: `Le scan s’est arrêté : ${String(probleme?.message ?? probleme)}` });
    }
  }

  const lu = (contenu) => {
    setEtat('repos');
    const jeton = jetonDuQr(contenu);
    if (!jeton) {
      setErreur({ message: 'Ce QR code n’est pas celui d’une carte EDT Pro.' });
      return;
    }
    navigate(`/carte/${encodeURIComponent(jeton)}`);
  };

  const echec = (probleme) => {
    setEtat('repos');
    signaler(probleme);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full gap-2" onClick={commencer} disabled={etat !== 'repos'}>
        {etat === 'repos' ? <QrCode className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
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
      {etat === 'scan' && <FenetreScan onLu={lu} onErreur={echec} onAnnuler={() => setEtat('repos')} />}
    </div>
  );
}
