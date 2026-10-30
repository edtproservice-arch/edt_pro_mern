import { useQuery } from '@tanstack/react-query';
import { MonitorDown, Smartphone } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { estAndroid, estApplicationTauri } from '@/lib/miseAJourDesktop';

/**
 * ═══ TÉLÉCHARGER L'APPLICATION — BUREAU ET ANDROID (2026-10-30, demande du porteur) ═══
 * En pied de la barre latérale, au-dessus du compte : l'installeur Windows et l'APK Android de
 * la DERNIÈRE version publiée.
 *
 * ⚠️ TÉLÉCHARGÉS DEPUIS edtpro.tech, PAS DEPUIS GITHUB (même jour, demande du porteur : « je ne
 *    veux pas qu'il dirige vers GitHub ») : nginx sert `/opt/edtpro/telechargements/` en
 *    pièce jointe. Des noms SANS version, remplacés à chaque publication par
 *    `.github/workflows/application-bureau.yml` : les liens ne changent jamais.
 * ⚠️ DANS LE NAVIGATEUR SEULEMENT : dans une application installée, on l'a déjà — elle propose
 *    elle-même ses mises à jour. Sur un téléphone Android, seule l'APK est proposée.
 * ⚠️ PAS DE LIEN VERS UN FICHIER ABSENT (même jour : « échec de téléchargement » avant la
 *    première publication) : chaque bouton vérifie que son fichier existe, et se cache sur un
 *    404. Une erreur réseau — le site local, qui interroge edtpro.tech — le laisse affiché.
 */
export const URL_INSTALLEUR_BUREAU = 'https://edtpro.tech/telechargements/EDT-Pro_x64-setup.exe';
export const URL_APK_ANDROID = 'https://edtpro.tech/telechargements/EDT-Pro.apk';

/** Le fichier est-il publié ? `false` seulement sur un 404 franc. */
function usePublie(href) {
  const requete = useQuery({
    queryKey: ['telechargement-publie', href],
    queryFn: async () => (await fetch(href, { method: 'HEAD', cache: 'no-store' })).status !== 404,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Affiché une fois le fichier trouvé — ou si la vérification échoue (réseau) ; caché sinon.
  return requete.isError || requete.data === true;
}

function Lien({ href, Icone, titre, etiquette, infobulle }) {
  const publie = usePublie(href);
  if (!publie) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={infobulle}>
        <a href={href} download>
          <Icone className="stroke-[1.7]" />
          <span>{titre}</span>
          <span className="ml-auto rounded border px-1.5 text-[0.65rem] text-muted-foreground">{etiquette}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function BoutonApplicationBureau() {
  if (estApplicationTauri()) return null;
  const android = estAndroid();

  return (
    <SidebarMenu>
      {!android && (
        <Lien
          href={URL_INSTALLEUR_BUREAU}
          Icone={MonitorDown}
          titre="Application bureau"
          etiquette="Windows"
          infobulle="Télécharger l’application Windows"
        />
      )}
      <Lien
        href={URL_APK_ANDROID}
        Icone={Smartphone}
        titre="Application mobile"
        etiquette="Android"
        infobulle="Télécharger l’application Android"
      />
    </SidebarMenu>
  );
}
