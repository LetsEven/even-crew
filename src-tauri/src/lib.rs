use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, State};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn mobile_main() {
    run();
}

struct AppState {
    has_orders: Mutex<bool>,
}

#[tauri::command]
fn set_has_orders(state: State<AppState>, has_orders: bool) {
    *state.has_orders.lock().unwrap() = has_orders;
}

#[tauri::command]
fn notify_new_order(title: String, body: String) {
    #[cfg(windows)]
    {
        // PowerShell toast notification — funciona siempre en Windows sin instalador
        let script = format!(
            r#"
$app = '{title}'
$msg = '{body}'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$template.SelectSingleNode('//text[@id=1]').InnerText = $app
$template.SelectSingleNode('//text[@id=2]').InnerText = $msg
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Even Crew').Show($toast)
"#,
            title = title.replace('\'', ""),
            body = body.replace('\'', "")
        );
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        // set_always_on_top momentáneo para forzar foco en Windows
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
    }
    #[cfg(not(desktop))]
    let _ = app;
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}

// ============================================================
// Impresoras WiFi — Detección
// ============================================================

#[derive(serde::Serialize)]
pub struct PrinterFound {
    ip: String,
    port: u16,
}

/// Escanea el subnet local buscando dispositivos con puerto 9100 abierto.
#[tauri::command]
async fn scan_printers() -> Result<Vec<PrinterFound>, String> {
    let subnet = get_local_subnet().ok_or("No se pudo detectar la red local")?;

    let timeout = Duration::from_millis(500);
    let port: u16 = 9100;

    let mut handles = vec![];
    for i in 1u8..=254 {
        let ip = Ipv4Addr::new(subnet[0], subnet[1], subnet[2], i);
        handles.push(tokio::task::spawn_blocking(move || {
            let addr = SocketAddr::new(IpAddr::V4(ip), port);
            match TcpStream::connect_timeout(&addr, timeout) {
                Ok(_) => Some(PrinterFound { ip: ip.to_string(), port }),
                Err(_) => None,
            }
        }));
    }

    let mut found = vec![];
    for handle in handles {
        if let Ok(Some(printer)) = handle.await {
            found.push(printer);
        }
    }
    Ok(found)
}

fn is_private_lan(ip: &Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31)
}

fn get_local_subnet() -> Option<[u8; 3]> {
    if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in &ifaces {
            if let IpAddr::V4(ipv4) = ip {
                if is_private_lan(ipv4) {
                    let octets = ipv4.octets();
                    return Some([octets[0], octets[1], octets[2]]);
                }
            }
        }
    }
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local = socket.local_addr().ok()?;
    if let IpAddr::V4(ipv4) = local.ip() {
        if is_private_lan(&ipv4) {
            let octets = ipv4.octets();
            return Some([octets[0], octets[1], octets[2]]);
        }
    }
    None
}

// ============================================================
// Impresoras WiFi — Impresión ESC/POS
// ============================================================

#[tauri::command]
async fn print_raw(ip: String, port: u16, data: Vec<u8>) -> Result<(), String> {
    let addr: SocketAddr = format!("{}:{}", ip, port)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;

    tokio::task::spawn_blocking(move || {
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
            .map_err(|e| format!("No se pudo conectar a {}: {}", addr, e))?;
        stream.write_all(&data).map_err(|e| format!("Error enviando datos: {}", e))?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn print_test(ip: String, port: u16) -> Result<(), String> {
    let now = chrono_simple();
    let ticket = build_test_ticket(&ip, port, &now);
    print_raw(ip, port, ticket).await
}

fn chrono_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let mins = (secs / 60) % 60;
    let hours = (secs / 3600) % 24;
    let days = secs / 86400;
    format!("{:02}h{:02} (dia {})", hours, mins, days)
}

fn build_test_ticket(ip: &str, port: u16, fecha: &str) -> Vec<u8> {
    let mut buf: Vec<u8> = vec![];
    buf.extend_from_slice(&[0x1b, 0x40]);
    buf.extend_from_slice(&[0x1b, 0x61, 0x00]);
    buf.extend_from_slice(&[0x1b, 0x21, 0x30]);
    buf.extend_from_slice(b"\n== CUENTA NUEVA ==\n");
    buf.extend_from_slice(&[0x1b, 0x21, 0x10]);
    buf.extend_from_slice(format!("\nEVEN PRINT\n").as_bytes());
    buf.extend_from_slice(format!("{}\n", fecha).as_bytes());
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(format!("IP: {}\n", ip).as_bytes());
    buf.extend_from_slice(format!("Puerto: {}\n", port).as_bytes());
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(b"Asigna nombre y rol\n");
    buf.extend_from_slice(b"desde el portal admin.\n");
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(&[0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]);
    buf
}

// ============================================================
// Impresoras USB — Windows
// ============================================================

#[cfg(windows)]
mod usb_windows {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW,
        StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };
    use windows::core::{PCWSTR, PWSTR};

    pub fn list_local_printers() -> Result<Vec<String>, String> {
        // Combina impresoras instaladas en el spooler + dispositivos USB reconocidos como impresoras
        let script = r#"
$names = [System.Collections.Generic.List[string]]::new()
# 1. Impresoras instaladas en el spooler de Windows (tienen driver)
try {
    Get-WmiObject Win32_Printer | ForEach-Object { $names.Add($_.Name) }
} catch {}
# 2. Dispositivos PnP reconocidos como impresoras (incluye sin driver completo)
try {
    Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.FriendlyName -and -not $names.Contains($_.FriendlyName)) {
            $names.Add($_.FriendlyName)
        }
    }
} catch {}
$names | Where-Object { $_ -ne $null -and $_.Trim() -ne '' }
"#;

        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Error ejecutando powershell: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell falló: {}", err.trim()));
        }

        let raw = &output.stdout;
        let text = if raw.len() >= 2 && raw[0] == 0xff && raw[1] == 0xfe {
            let u16_data: Vec<u16> = raw[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16_data)
        } else {
            String::from_utf8_lossy(raw).to_string()
        };

        Ok(text
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    }

    pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<(), String> {
        let name: Vec<u16> = printer_name.encode_utf16().chain(std::iter::once(0)).collect();
        let datatype: Vec<u16> = "RAW\0".encode_utf16().collect();
        let docname: Vec<u16> = "ESCPOS\0".encode_utf16().collect();
        unsafe {
            let mut handle = HANDLE::default();
            OpenPrinterW(PCWSTR(name.as_ptr()), &mut handle, None)
                .map_err(|e| format!("OpenPrinterW: {}", e))?;
            let doc = DOC_INFO_1W {
                pDocName: PWSTR(docname.as_ptr() as *mut u16),
                pOutputFile: PWSTR::null(),
                pDatatype: PWSTR(datatype.as_ptr() as *mut u16),
            };
            let job = StartDocPrinterW(handle, 1, &doc as *const _ as *const _);
            if job == 0 {
                ClosePrinter(handle).ok();
                return Err("StartDocPrinterW falló".into());
            }
            if !StartPagePrinter(handle).as_bool() {
                ClosePrinter(handle).ok();
                return Err("StartPagePrinter falló".into());
            }
            let mut written = 0u32;
            if !WritePrinter(handle, data.as_ptr() as _, data.len() as u32, &mut written).as_bool() {
                let _ = EndDocPrinter(handle).ok();
                ClosePrinter(handle).ok();
                return Err("WritePrinter falló".into());
            }
            let _ = EndPagePrinter(handle).ok();
            let _ = EndDocPrinter(handle).ok();
            ClosePrinter(handle).ok();
            Ok(())
        }
    }
}

// ============================================================
// Impresoras USB — Plugin Android (handle almacenado en estado)
// ============================================================

struct UsbPluginState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<tauri::plugin::PluginHandle<tauri::Wry>>>,
}

fn usb_printer_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("usbPrinter")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.even.crew", "UsbPrinterPlugin")?;
                app.manage(UsbPluginState {
                    handle: Mutex::new(Some(handle)),
                });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(UsbPluginState {});
            }
            Ok(())
        })
        .build()
}

// ============================================================
// Impresoras USB — Comandos Tauri
// ============================================================

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UsbPrinterInfo {
    pub device_name: String,
    pub vendor_id: u32,
    pub product_id: u32,
    #[serde(default)]
    pub is_printer_class: bool,
}

#[derive(serde::Deserialize)]
struct ListDevicesResult {
    #[serde(default)]
    devices: Vec<UsbPrinterInfo>,
}

#[tauri::command]
async fn list_usb_printers(
    state: State<'_, UsbPluginState>,
) -> Result<Vec<UsbPrinterInfo>, String> {
    #[cfg(windows)]
    {
        let _ = state;
        return tokio::task::spawn_blocking(|| {
            usb_windows::list_local_printers().map(|names| {
                names
                    .into_iter()
                    .map(|n| UsbPrinterInfo { device_name: n, vendor_id: 0, product_id: 0, is_printer_class: false })
                    .collect()
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "android")]
    {
        let guard = state.handle.lock().unwrap();
        if let Some(h) = &*guard {
            return h
                .run_mobile_plugin::<ListDevicesResult>("listDevices", ())
                .map(|r| r.devices)
                .map_err(|e| e.to_string());
        }
        return Ok(vec![]);
    }

    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = state;
        Ok(vec![])
    }
}

#[tauri::command]
async fn print_raw_usb(
    printer_name: String,
    data: Vec<u8>,
    state: State<'_, UsbPluginState>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = state;
        let n = printer_name.clone();
        let d = data.clone();
        return tokio::task::spawn_blocking(move || usb_windows::print_raw(&n, &d))
            .await
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "android")]
    {
        let guard = state.handle.lock().unwrap();
        if let Some(h) = &*guard {
            let int_data: Vec<i32> = data.iter().map(|&b| b as i32).collect();
            return h
                .run_mobile_plugin::<()>(
                    "printRaw",
                    serde_json::json!({ "deviceName": printer_name, "data": int_data }),
                )
                .map_err(|e| e.to_string());
        }
        return Ok(());
    }

    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (printer_name, data, state);
        Ok(())
    }
}

#[tauri::command]
async fn print_test_usb(
    printer_name: String,
    state: State<'_, UsbPluginState>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = state;
        let now = chrono_simple();
        let ticket = build_test_ticket_usb(&printer_name, &now);
        let n = printer_name.clone();
        return tokio::task::spawn_blocking(move || usb_windows::print_raw(&n, &ticket))
            .await
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "android")]
    {
        let guard = state.handle.lock().unwrap();
        if let Some(h) = &*guard {
            return h
                .run_mobile_plugin::<()>(
                    "printTest",
                    serde_json::json!({ "deviceName": printer_name }),
                )
                .map_err(|e| e.to_string());
        }
        return Ok(());
    }

    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (printer_name, state);
        Ok(())
    }
}

fn build_test_ticket_usb(printer_name: &str, fecha: &str) -> Vec<u8> {
    let mut buf: Vec<u8> = vec![];
    buf.extend_from_slice(&[0x1b, 0x40]);
    buf.extend_from_slice(&[0x1b, 0x61, 0x00]);
    buf.extend_from_slice(&[0x1b, 0x21, 0x30]);
    buf.extend_from_slice(b"\n== CUENTA NUEVA ==\n");
    buf.extend_from_slice(&[0x1b, 0x21, 0x10]);
    buf.extend_from_slice(b"\nEVEN PRINT USB\n");
    buf.extend_from_slice(format!("{}\n", fecha).as_bytes());
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(format!("Impresora: {}\n", printer_name).as_bytes());
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(b"Asigna nombre y rol\n");
    buf.extend_from_slice(b"desde Impresoras.\n");
    buf.extend_from_slice(b"========================\n");
    buf.extend_from_slice(&[0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]);
    buf
}

// ============================================================
// FCM Token (Android)
// ============================================================

#[tauri::command]
fn get_fcm_token(app: tauri::AppHandle) -> Option<String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let candidates = [
            "/data/data/com.even.crew/files/fcm_token.txt".to_string(),
            "/data/user/0/com.even.crew/files/fcm_token.txt".to_string(),
        ];
        for path in &candidates {
            if let Ok(token) = std::fs::read_to_string(path) {
                let t = token.trim().to_string();
                if !t.is_empty() {
                    return Some(t);
                }
            }
        }
        if let Ok(data_dir) = app.path().app_data_dir() {
            let path = data_dir.join("fcm_token.txt");
            if let Ok(token) = std::fs::read_to_string(&path) {
                let t = token.trim().to_string();
                if !t.is_empty() {
                    return Some(t);
                }
            }
        }
        return None;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        None
    }
}

// ============================================================
// Registro AppUserModelID (necesario para notificaciones en portable .exe)
// ============================================================

#[cfg(windows)]
fn register_app_user_model_id() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from("com.even.crew")) };
}

// ============================================================
// App entry point
// ============================================================

pub fn run() {
    #[cfg(windows)]
    register_app_user_model_id();

    tauri::Builder::default()
        .manage(AppState { has_orders: Mutex::new(false) })
        .plugin(tauri_plugin_notification::init())
        .plugin(usb_printer_plugin())
        .invoke_handler(tauri::generate_handler![
            set_has_orders,
            show_main_window,
            notify_new_order,
            open_devtools,
            get_fcm_token,
            scan_printers,
            print_raw,
            print_test,
            list_usb_printers,
            print_raw_usb,
            print_test_usb,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri_plugin_autostart::ManagerExt;

                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec!["--autostart"]),
                ))?;

                let autolaunch = app.autolaunch();
                if !autolaunch.is_enabled().unwrap_or(false) {
                    let _ = autolaunch.enable();
                }

                let show_item = MenuItem::with_id(app, "show", "Abrir", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Even Crew");

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let tray = tray_builder
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false)
                                    && !window.is_minimized().unwrap_or(true)
                                {
                                    let _ = window.minimize();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                let _ = tray;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let state = window.state::<AppState>();
                let has_orders = *state.has_orders.lock().unwrap();
                if has_orders {
                    let _ = window.minimize();
                } else {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
