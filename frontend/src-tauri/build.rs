fn main() {
    // ⚠️ L'ICÔNE DE L'EXÉCUTABLE VIENT DE `icons/icon.ico`, compilée en ressource Windows par ce
    // script (2026-11-01) : sans cette ligne, un cache de compilation (GitHub Actions) gardait
    // l'ANCIENNE icône après un changement de logo — le script ne se relançait pas.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
