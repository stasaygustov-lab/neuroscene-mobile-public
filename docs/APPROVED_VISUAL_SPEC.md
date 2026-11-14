# NeuroScene mobile — visual reference and acceptance criteria

## Reference assets

- Primary five-screen reference: `docs/reference/neuroscene-ui-reference.jpg` (source: Library asset `НейроСцена_ синяя галактика творчества-3(1).png`, 2026-11-14).
- Standalone splash artwork: `assets/neuroscene-splash.jpg` (source: `neuroscene_splash_reference(1).png`, 2026-11-13).

The five-screen reference is the current implementation baseline because it includes the agreed create screen with four feature tiles, the 2/2 gallery limit, the 500/1500/5000 credit packs, and the full profile menu. The prices visible in the concept image are obsolete and MUST NOT be copied into the app.

## Visual system

- Mobile-first portrait layout.
- Background: deep navy / near-black space tone (`#020817`).
- Primary accent: electric blue and cyan glow; white/light-blue typography.
- Cards: dark navy translucent surfaces, thin blue borders, rounded corners.
- Credits: gold coin artwork and restrained gold accents.
- Bottom navigation: persistent four tabs — Создать, Галерея, Кредиты, Профиль.
- Use the supplied portrait splash artwork as-is; do not crop a landscape montage to simulate the splash.

## Screen acceptance criteria

1. **Splash** — standalone film-reel artwork, НейроСцена title and tagline, subtle progress line; transition to the app within 3–4 seconds and never leave an overlay covering the app.
2. **Login** — VK ID and email entry; terms and privacy links; no Google/Yandex sign-in.
3. **Создать** — title, cinematic mountain hero with a person silhouette, primary «Создать видео» action, and four feature tiles: «Текст в видео», «Изображение в видео», «Добавить звук», «Улучшить промпт». Composer supports T2V/I2V, 5/10 seconds, 16:9/9:16, JPG/PNG up to 10 MB.
4. **Галерея** — «Мои видео» and «Избранное», two-column cards, duration labels, refresh/filter action, storage limit exactly 2 completed videos per user, visible 2/2 counter.
5. **Кредиты** — balance, gold coin illustration, packs of 500/1500/5000, 1500 visually highlighted, credits never expire. No invented or hardcoded prices; display prices only when confirmed by backend/payment configuration. No subscriptions or promo codes.
6. **Профиль** — account identity, VK/email access, notifications, purchases/credits, settings, app info, support and sign out.

## Functional acceptance criteria

- Every visible control must navigate, submit, open a real screen/action, or be clearly disabled with an explanation. No decorative buttons.
- The app must render its navigation and screens even when the API is unavailable; show a clear connection state instead of an empty screen or an infinite splash.
- Login, balance, gallery, purchases, generation and support require a configured reachable HTTPS API. A local `127.0.0.1` address is not a valid Android-device API endpoint.
- Video generation is performed on the user's PC; the mobile app is a client. Do not claim cloud AI generation.
- No ads without separate user permission.
- Do not mark the app release-ready until CI builds an APK and the user has verified it on POCO M7.
