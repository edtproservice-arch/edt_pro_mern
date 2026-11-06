#[cfg(desktop)]
mod bureau {
    //! ═══ L'APPLICATION DE BUREAU RESTE À L'ÉCOUTE (2026-11-01, demande du porteur) ═══
    //! « Des notifications dans Windows, comme Facebook » : pour qu'elles arrivent même fenêtre
    //! fermée, l'application ne s'arrête plus — comme Teams ou WhatsApp, elle se range dans la
    //! zone de notification (près de l'horloge), démarre avec Windows, en arrière-plan, et ne
    //! s'ouvre qu'une fois (relancée, elle ramène la fenêtre existante).
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{App, AppHandle, Manager};
    use tauri_plugin_autostart::ManagerExt;

    /// L'argument du lancement automatique : démarrer caché, dans la zone de notification.
    pub const ARGUMENT_ARRIERE_PLAN: &str = "--arriere-plan";

    /// Ramène la fenêtre au premier plan.
    pub fn montrer(app: &AppHandle) {
        if let Some(fenetre) = app.get_webview_window("main") {
            let _ = fenetre.unminimize();
            let _ = fenetre.show();
            let _ = fenetre.set_focus();
        }
    }

    pub fn installer(app: &mut App) -> tauri::Result<()> {
        // L'icône de la zone de notification : clic → la fenêtre ; menu → Ouvrir / Quitter.
        let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir eDTpro", true, None::<&str>)?;
        let quitter = MenuItem::with_id(app, "quitter", "Quitter eDTpro", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&ouvrir, &quitter])?;
        let mut icone = TrayIconBuilder::with_id("principale")
            .tooltip("eDTpro")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, evenement| match evenement.id.as_ref() {
                "ouvrir" => montrer(app),
                // Le seul moyen d'arrêter vraiment l'application : la croix ne fait que la ranger.
                "quitter" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|icone, evenement| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evenement {
                    montrer(icone.app_handle());
                }
            });
        if let Some(image) = app.default_window_icon() {
            icone = icone.icon(image.clone());
        }
        icone.build(app)?;

        // Démarrer avec Windows — reposé à CHAQUE lancement s'il manque (2026-11-01) : chaque mise
        // à jour désinstalle l'ancienne version, et le désinstalleur efface l'inscription.
        // ⚠️ SAUF SI LA PERSONNE L'A DÉSACTIVÉ dans Windows : `is_enabled` le compte comme « absent »,
        //    et `enable` réécrirait par-dessus son choix.
        let demarrage = app.autolaunch();
        if !demarrage.is_enabled().unwrap_or(true) && !demarrage_refuse() {
            let _ = demarrage.enable();
        }

        // Lancé par Windows au démarrage : la fenêtre reste cachée, l'icône suffit.
        if std::env::args().any(|argument| argument == ARGUMENT_ARRIERE_PLAN) {
            if let Some(fenetre) = app.get_webview_window("main") {
                let _ = fenetre.hide();
            }
        }
        Ok(())
    }

    /// Le démarrage désactivé par la personne (Gestionnaire des tâches → Démarrage, ou
    /// Paramètres → Applications → Démarrage) : Windows le note dans `StartupApproved\Run`, une
    /// valeur dont les 8 derniers octets ne sont plus nuls — survit à la désinstallation.
    #[cfg(windows)]
    fn demarrage_refuse() -> bool {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
                KEY_READ,
            )
            // ⚠️ LE NOM DE L'APPLICATION (productName) : c'est sous lui que le lancement automatique
            //    s'inscrit — « eDTpro » depuis le 2026-11-06, « EDT Pro » avant.
            .and_then(|cle| cle.get_raw_value("eDTpro"))
            .map(|valeur| valeur.bytes.len() >= 8 && valeur.bytes.iter().rev().take(8).any(|octet| *octet != 0))
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    fn demarrage_refuse() -> bool {
        false
    }
}

#[cfg(desktop)]
mod telechargement {
    //! ═══ LES DOCUMENTS TÉLÉCHARGÉS, ENREGISTRÉS PAR L'APPLICATION (2026-11-06) ═══
    //! Retour du porteur : « en desktop, ni notification ni signe que le document est
    //! téléchargé ». Le lien `download` de la page laissait WebView2 enregistrer en silence, sans
    //! dire où. L'application écrit donc elle-même le fichier dans Téléchargements et rend son
    //! chemin : la page l'annonce, avec « Ouvrir » et « Dossier » (`src/lib/telechargementApplication.js`).
    use std::path::{Path, PathBuf};
    use tauri::ipc::{InvokeBody, Request};
    use tauri::{AppHandle, Manager};

    /// Le fichier arrive EN BINAIRE (pas en JSON : un tableur de 4 Mo y pèserait le quadruple) ;
    /// son nom, dans l'en-tête `x-nom`, encodé comme une URL (les accents ne passent pas tels quels).
    #[tauri::command]
    pub fn enregistrer_telechargement(app: AppHandle, requete: Request<'_>) -> Result<String, String> {
        let InvokeBody::Raw(contenu) = requete.body() else {
            return Err("Le document doit arriver en binaire.".into());
        };
        let nom = requete
            .headers()
            .get("x-nom")
            .and_then(|valeur| valeur.to_str().ok())
            .map(decoder_url)
            .map(|nom| nettoyer(&nom))
            .filter(|nom| !nom.is_empty())
            .unwrap_or_else(|| "document".into());
        let dossier = app.path().download_dir().map_err(|erreur| erreur.to_string())?;
        std::fs::create_dir_all(&dossier).map_err(|erreur| erreur.to_string())?;
        let chemin = chemin_libre(&dossier, &nom);
        std::fs::write(&chemin, contenu).map_err(|erreur| erreur.to_string())?;
        Ok(chemin.to_string_lossy().into_owned())
    }

    /// « %C3%A9 » → « é ». Un octet mal formé est gardé tel quel.
    fn decoder_url(texte: &str) -> String {
        let octets = texte.as_bytes();
        let mut sortie = Vec::with_capacity(octets.len());
        let mut i = 0;
        while i < octets.len() {
            if octets[i] == b'%' && i + 2 < octets.len() {
                if let Ok(valeur) = u8::from_str_radix(&texte[i + 1..i + 3], 16) {
                    sortie.push(valeur);
                    i += 3;
                    continue;
                }
            }
            sortie.push(octets[i]);
            i += 1;
        }
        String::from_utf8_lossy(&sortie).into_owned()
    }

    /// Un NOM, jamais un chemin : ni dossier, ni caractère interdit par Windows.
    fn nettoyer(nom: &str) -> String {
        let feuille = nom.rsplit(['/', '\\']).next().unwrap_or(nom);
        feuille
            .chars()
            .map(|c| if "<>:\"|?*".contains(c) || c.is_control() { '_' } else { c })
            .collect::<String>()
            .trim()
            .trim_matches('.')
            .to_string()
    }

    /// « Bilan.xlsx » déjà là → « Bilan (1).xlsx » : un téléchargement n'écrase jamais l'autre.
    fn chemin_libre(dossier: &Path, nom: &str) -> PathBuf {
        let chemin = dossier.join(nom);
        if !chemin.exists() {
            return chemin;
        }
        let (base, extension) = match nom.rfind('.') {
            Some(position) if position > 0 => (&nom[..position], &nom[position..]),
            _ => (nom, ""),
        };
        (1..)
            .map(|rang| dossier.join(format!("{base} ({rang}){extension}")))
            .find(|candidat| !candidat.exists())
            .expect("un nom libre finit toujours par se trouver")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Une seule instance : la relancer ramène la fenêtre de celle qui tourne (2026-11-01).
    // ⚠️ EN PREMIER, comme le demande le module : avant lui, la seconde instance démarrerait.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _arguments, _dossier| bureau::montrer(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![bureau::ARGUMENT_ARRIERE_PLAN]),
        ));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // Les documents téléchargés, enregistrés dans Téléchargements (2026-11-06).
        .invoke_handler(gestionnaire_commandes())
        // Message, annonce, emploi du temps : la notification du système (2026-10-31).
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // La vérification elle-même est lancée par le frontend
            // (`src/lib/miseAJourDesktop.js`), qui sait la présenter à l'utilisateur.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            bureau::installer(app)?;
            // Le scan du QR de la carte de stagiaire : connexion directe (2026-10-31).
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            Ok(())
        })
        .on_window_event(|_fenetre, _evenement| {
            // La croix RANGE la fenêtre dans la zone de notification au lieu d'arrêter
            // l'application : les notifications continuent d'arriver (2026-11-01).
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _evenement {
                let _ = _fenetre.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'eDTpro");
}

/// Les commandes de l'application. Sur Android, l'enregistrement passe par le pont natif de
/// `MainActivity` (`scripts/preparer-android.mjs`) : le stockage partagé y a ses propres règles.
#[cfg(desktop)]
fn gestionnaire_commandes() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![telechargement::enregistrer_telechargement]
}

#[cfg(mobile)]
fn gestionnaire_commandes() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![]
}
