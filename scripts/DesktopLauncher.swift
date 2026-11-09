import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
    var opening = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit " + (Bundle.main.infoDictionary!["CFBundleName"] as! String), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        NSApp.mainMenu = menu
        openApp()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        openApp()
        return true
    }
    func openApp() {
        guard !opening else { return }
        opening = true
        DispatchQueue.global().async {
            let process = Process()
            let errors = Pipe()
            process.executableURL = URL(fileURLWithPath: Bundle.main.infoDictionary!["AppNodePath"] as! String)
            process.arguments = [(Bundle.main.infoDictionary!["AppProjectPath"] as! String) + "/scripts/desktop-server.js", (Bundle.main.infoDictionary!["AppMode"] as? String) ?? "personal"]
            process.standardError = errors
            var message: String? = nil
            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    message = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
                }
            } catch { message = error.localizedDescription }
            DispatchQueue.main.async {
                self.opening = false
                if let message = message {
                    NSApp.activate(ignoringOtherApps: true)
                    let alert = NSAlert()
                    alert.messageText = "\(Bundle.main.infoDictionary!["CFBundleName"] as! String) could not open"
                    alert.informativeText = message
                    alert.runModal()
                    return
                }
                let url = URL(string: "http://127.0.0.1:" + ((Bundle.main.infoDictionary!["AppPort"] as? String) ?? "3000") + "/")!
                if let dia = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "company.thebrowser.dia") {
                    NSWorkspace.shared.open([url], withApplicationAt: dia, configuration: NSWorkspace.OpenConfiguration())
                } else { NSWorkspace.shared.open(url) }
            }
        }
    }
}
let app = NSApplication.shared
let delegate = Launcher()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
