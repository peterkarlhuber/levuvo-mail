# Levuvo Mail 2.2.0 – Windows ARM64 and x64

The keychain module is native: **always build on the target architecture**.

```powershell
node -p "process.platform + ' ' + process.arch"   # expected: win32 arm64 or win32 x64
npm.cmd ci
npm.cmd run release:check
npm.cmd run desktop:win:check:vault
npm.cmd run desktop:win:arm64                      # or desktop:win:x64
```

Result: `release\Levuvo-Mail-Setup-2.2.0-arm64.exe` or `-x64.exe`.
Build the project locally (e.g. `C:\Users\<Name>\Levuvo\levuvo-mail`), not from a network drive.

Signed build with auto-update: `npm.cmd run release:signed:win:x64` – requirements in `RELEASE-KIT.md`.

Notes:
- Passwords are stored in Windows Credential Manager (service `at.levuvo.mail`).
- The installer installs per user, without administrator rights, and shows the license.
- Unsigned test installers trigger a SmartScreen warning. Do not disable protection features globally.
