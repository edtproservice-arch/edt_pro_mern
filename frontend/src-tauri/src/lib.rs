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
        let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir EDT Pro", true, None::<&str>)?;
        let quitter = MenuItem::with_id(app, "quitter", "Quitter EDT Pro", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&ouvrir, &quitter])?;
        let mut icone = TrayIconBuilder::with_id("principale")
            .tooltip("EDT Pro")
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

        // Démarrer avec Windows — proposé UNE fois, au premier lancement : si la personne le
        // retire ensuite (Paramètres → Applications → Démarrage), on ne le remet pas.
        if let Ok(dossier) = app.path().app_config_dir() {
            let marque = dossier.join("demarrage-automatique-propose");
            if !marque.exists() {
                let _ = app.autolaunch().enable();
                let _ = std::fs::create_dir_all(&dossier);
                let _ = std::fs::write(&marque, b"1");
            }
        }

        // Lancé par Windows au démarrage : la fenêtre reste cachée, l'icône suffit.
        if std::env::args().any(|argument| argument == ARGUMENT_ARRIERE_PLAN) {
            if let Some(fenetre) = app.get_webview_window("main") {
                let _ = fenetre.hide();
            }
        }
        Ok(())
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
        .expect("erreur au lancement d'EDT Pro");
}
