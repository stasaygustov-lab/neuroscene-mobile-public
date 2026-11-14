# NeuroScene mobile — selected visual reference and acceptance criteria

## Selected source images

The user selected only two source images for the app's visual identity. This file records them as the current working baseline; it does **not** claim that the final screen-by-screen implementation has received formal approval.

- **Main visual reference:** `docs/reference/neuroscene-ui-reference.jpg`, derived from the user's image `НейроСцена: синяя галактика творчества` (Library filename: `НейроСцена_ синяя галактика творчества-3(1).png`).
- **App icon / monogram:** `assets/neuroscene-brand.png`, the silver-blue Н+С monogram.

Do not introduce a third visual concept or substitute unrelated artwork. The five-screen reference is the layout and styling baseline. The prices visible in the concept image are obsolete and MUST NOT be copied into the app.

## Visual system

- Mobile-first portrait layout.
- Background: deep navy / near-black space tone (`#020817`).
- Primary accent: electric blue and cyan glow; white/light-blue typography.
- Cards: dark navy translucent surfaces, thin blue borders, rounded corners.
- Credits: gold coin illustration and restrained gold accents.
- Bottom navigation: four tabs — Создать, Галерея, Кредиты, Профиль.
- Native Android splash uses the selected Н+С monogram on the dark background.
- In-app splash recreates the selected reference's film reel, film strip, blue glow, title and tagline using native vector views.

## Screen acceptance criteria

1. **Splash** — film-reel / film-strip motif, blue cosmic glow, НейроСцена title, «КИНО НАЧИНАЕТСЯ С ТЕБЯ» tagline and progress line; transition to the app within 3–4 seconds and never leave an overlay covering the app.
2. **Login** — VK ID and email entry; terms and privacy links; no Google/Yandex sign-in.
3. **Создать** — title, cinematic hero, primary «Создать видео» action, and four feature tiles: «Текст в видео», «Изображение в видео», «Добавить звук», «Улучшить промпт». Composer supports T2V/I2V, 5/10 seconds, 16:9/9:16, JPG/PNG up to 10 MB.
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
