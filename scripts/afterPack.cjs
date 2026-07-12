const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Ad-hoc signs the packaged macOS app.
 *
 * We have no Apple Developer ID certificate in CI, so electron-builder skips
 * code signing. An unsigned arm64 (Apple Silicon) app is rejected outright by
 * macOS and reported as "damaged". An ad-hoc signature makes the app runnable;
 * it is not notarization, so a downloaded copy still carries the quarantine flag
 * and shows the ordinary "unidentified developer" prompt (right-click → Open, or
 * `xattr -cr` to clear), instead of failing to launch at all.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
