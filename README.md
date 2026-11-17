# Screenshot Guardian 🛡️

**Privacy-first screenshot analyzer & screen capture tool for Windows**

Screenshot Guardian automatically detects and blurs sensitive information in screenshots before you share them on Slack, Discord, email, or social media.

---

## 🌟 Key Features

- 📸 **Inbuilt Screenshotter & Snipping Tool**
  - **`Win+S`** global hotkey activates interactive snipping from anywhere on Windows (also supports **`Alt+S`** and **`Ctrl+Shift+S`**).
  - Dimmed screen overlay with click-and-drag rectangular region snip, live coordinate tooltips, `Enter` for full screen, and `Esc` to cancel.
  - Automatically loads the captured screenshot into the privacy scanner.

- 🔒 **Password & Secret Field Detection**
  - **Masked Password Characters**: Detects bullet dots (`••••••••`, `●●●●●●●●`) and asterisks (`********`).
  - **Form Input Fields**: Detects login/password labels (`"Password"`, `"Confirm Password"`, `"PIN"`, `"Passcode"`) and identifies adjacent input fields even when dots aren't transcribed.
  - **Credentials & API Secrets**: Captures `password: ...`, `DB_PASSWORD=...`, API keys, client secrets, auth tokens, and bearer tokens.
  - **Computer Vision Dot Scanner**: Analyzes image pixels directly for sequences of password masking dots.

- 🔍 **Comprehensive Privacy Detectors**
  - 📧 **Emails**: RFC-compliant email detection.
  - 📞 **Phone Numbers**: International, US, and regional telephone numbers.
  - 📱 **QR Codes**: In-browser decoding via jsQR.
  - 🪪 **Sensitive IDs**: SSN, Aadhaar, PAN, Passport, Credit Cards, API Keys, JWT tokens, UUIDs, AWS Keys, hashes, IBAN, Private Keys.
  - 💰 **Crypto Wallets**: Bitcoin, Ethereum, and Monero wallet addresses.
  - 🌐 **IP Addresses**: IPv4 and IPv6 network addresses.

- 🎨 **Privacy Redaction Engine**
  - **3 Blur Styles**: Pixelate, Black Bar (solid redaction), and Gaussian Blur.
  - **One-Click Auto-Blur**: Redacts all detected sensitive items simultaneously.
  - **Manual Redaction**: Click & drag custom blur boxes directly on the canvas.
  - **Multi-Level Undo (`Ctrl+Z`)**: Easily revert any manual or automated blur.

- 📋 **Seamless Sharing & Export**
  - **Copy to Clipboard (`Ctrl+C`)**: Instantly copies the safe, blurred screenshot to the Windows clipboard ready to paste into chat or documents.
  - **Save Safe Copy (`Ctrl+S`)**: Export the clean redacted PNG to your chosen folder.
  - **System Tray**: Runs unobtrusively in the background with quick access to snipping and window controls.

---

## ⌨️ Shortcuts Reference

| Shortcut | Action |
|---|---|
| **`Win+S`** / **`Alt+S`** / **`Ctrl+Shift+S`** | Activate Inbuilt Screen Sniper |
| **`Ctrl+V`** | Paste image from clipboard |
| **`Ctrl+C`** | Copy safe blurred screenshot to clipboard |
| **`Ctrl+Z`** | Undo last blur |
| **`Ctrl+S`** | Save safe PNG to disk |
| **`Enter`** (during snip) | Capture full screen |
| **`Esc`** (during snip) | Cancel snipping |

---

## 🚀 Running & Building

### Development
```bash
npm install
npm start
```

### Production Build
```bash
npm run build
```

Generates production-ready Windows binaries in `dist/`:
- **Portable App**: `dist/Screenshot Guardian 1.0.0.exe` (run directly without installation)
- **Setup Installer**: `dist/Screenshot Guardian Setup 1.0.0.exe` (NSIS installer with customizable directory)

---

## 🛠️ Tech Stack

- **Electron 28** — Native Windows desktop application runtime
- **screenshot-desktop** — High-performance native screen capture engine
- **Tesseract.js v5** — Local on-device OCR engine
- **jsQR** — High-speed client-side QR code scanner
- **Vanilla Modern HTML5 / CSS3 / ES6** — Zero heavy frontend framework overhead
