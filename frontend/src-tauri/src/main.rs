// Pas de console noire derrière la fenêtre en release sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    edt_pro_lib::run()
}
