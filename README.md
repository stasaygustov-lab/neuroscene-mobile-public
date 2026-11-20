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
- `EXPO_PUBLIC_TERMS_URL`: public HTTPS URL of the current Terms of Use document.
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`: public HTTPS URL of the current Privacy Policy document.

The mobile app only enables new account registration and VK ID sign-in after both legal-document URLs are configured, the user confirms they are 18 or older, and accepts the Terms and Privacy Policy. Email sign-in for existing accounts remains available. The app sends `age_confirmed`, `terms_accepted`, and `privacy_policy_accepted` with registration and VK completion requests. The backend **must independently validate these fields and persist the consent timestamp and document versions**; client-side checks alone are not an enforceable age gate or consent record. Do not publish placeholder or example URLs.

Do not add worker tokens, signing keys, SMTP credentials, database credentials, or backend secrets here.

If `EXPO_PUBLIC_API_URL` is unset, the APK still builds, but API-backed sign-in, credits, gallery, support, and generation cannot connect.

## Scope
Only the mobile app and build resources are included. The backend must be deployed and configured separately. Review third-party asset and dependency licensing before commercial distribution.
