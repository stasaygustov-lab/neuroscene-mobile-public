# NeuroScene — Android mobile app

An isolated export of the NeuroScene mobile client. It excludes the private backend, GPU agent, model workflows, audio worker, deployment files, and original repository history.

## Build requirements
- Node.js 24
- Java 17
- Android SDK platform 36 and NDK 27.1.12297006
- Python 3 and Pillow

```bash
npm ci
python3 -m pip install --user Pillow
python3 scripts/fit-android-icon.py
npx expo prebuild --platform android --no-install --clean
cd android
./gradlew --no-daemon assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`.

## GitHub Actions variables
Configure repository **Settings → Secrets and variables → Actions → Variables**:
- `EXPO_PUBLIC_API_URL`: deployed HTTPS API base URL, without a trailing slash.
- `EXPO_PUBLIC_VK_CLIENT_ID`: public VK ID application identifier.

Do not add worker tokens, signing keys, SMTP credentials, database credentials, or backend secrets here.

If `EXPO_PUBLIC_API_URL` is unset, the APK still builds, but API-backed sign-in, credits, gallery, support, and generation cannot connect.

## Scope
Only the mobile app and build resources are included. The backend must be deployed and configured separately. Review third-party asset and dependency licensing before commercial distribution.
