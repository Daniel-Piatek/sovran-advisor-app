// Build locally; the bundle points to this checkout, and contains no personal data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const demo = process.argv.includes('--demo');
const name = demo ? 'Sovran Advisor Demo' : 'Sovran Advisor';
const bundle = path.join(root, `build/${name}.app`);
if (demo) execFileSync(process.execPath, [path.join(root, 'scripts/demo-icon.js')], { stdio: 'inherit' });
fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
fs.mkdirSync(path.join(bundle, 'Contents/Resources'), { recursive: true });
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.sovran.advisor${demo ? '-demo' : ''}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleDisplayName</key><string>${name}</string>
<key>CFBundleExecutable</key><string>${name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>app.icns</string>
<key>CFBundleVersion</key><string>1</string>
<key>AppMode</key><string>${demo ? 'demo' : 'personal'}</string>
<key>AppPort</key><string>${demo ? '3100' : '3300'}</string>
<key>AppProjectPath</key><string>${xml(root.replace(/\/$/, ''))}</string>
<key>AppNodePath</key><string>${xml(process.execPath)}</string>
</dict></plist>`);
fs.copyFileSync(path.join(root, demo ? 'build/demo.icns' : 'public/icons/app.icns'), path.join(bundle, 'Contents/Resources/app.icns'));
execFileSync('/usr/bin/xcrun', ['swiftc', path.join(root, 'scripts/DesktopLauncher.swift'), '-o', path.join(bundle, `Contents/MacOS/${name}`), '-framework', 'AppKit', '-module-cache-path', '/private/tmp/sovran-advisor-swift-cache']);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
console.log(bundle);
