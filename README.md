# DropMusic

DropMusic is a Windows-first desktop music hub built with Tauri 2, Rust, React, TypeScript, and Tailwind CSS.

## Requirements

- Windows 10 or 11
- Node.js and npm
- Rust stable and the MSVC C++ build tools
- WebView2 Runtime
- An internet connection for Spotify and Jamendo catalogs and playback

## Start developing

```powershell
npm install
npm run tauri:dev
```

Run `npm run tauri:build` to create the Windows installers, `npm run build` to build the frontend, and `npm run lint` to check the code.

## Included

- Responsive library with Explore, Collection, Favorites, and Settings sections
- Spotify personalized suggestions and full-track in-app playback for Premium accounts
- Searchable Jamendo catalog with full-track streaming and official track links
- Rotating Listen-page feature card with one-click in-app playback of available tracks
- Favorites and audio preferences stored on this device
- Five-band Web Audio equalizer, sound presets, player volume, repeat, shuffle, and queue controls
- Tauri 2 desktop shell with a restricted content security policy for the catalog media

## Account connections

Spotify and Google account authorization use OAuth Authorization Code with PKCE in the system browser and a temporary loopback callback. Configure the public client IDs in an ignored `.env.local` file (see `.env.example`) before running or building the desktop app. In Spotify Developer Dashboard, register `http://127.0.0.1/callback` (without a port); the app supplies its temporary port at sign-in. The Google OAuth client must be of type **Desktop app**, which supports a temporary `http://127.0.0.1:<port>` redirect.

Spotify access and refresh tokens are stored in the Windows Credential Manager and refreshed automatically; DropMusic checks the saved access token against Spotify's `/v1/me` endpoint at startup and retries once after a 401. Passwords are never stored. Search sends Spotify's `q` query parameter, `type=track`, `limit=10`, and `offset`; search results are paged by 10. Spotify suggestions come from the user's medium-term top tracks and require the `user-top-read` permission. Selecting Spotify tracks starts playback on DropMusic's in-app Spotify Web Playback SDK device; pause, skip, seek, progress, and volume use the embedded player rather than opening Spotify. This requires Spotify Premium, the `streaming` and `user-modify-playback-state` scopes, and Web Playback SDK access enabled for the app in Spotify Developer Dashboard. Existing users must select **Actualizar permisos Spotify** in Settings and accept the additional permissions; Spotify may require reconnecting the account. The SDK is loaded from Spotify's official `sdk.scdn.co` domain. Use **Desvincular cuenta** in Settings to remove saved tokens. Google OAuth only confirms the Google account: YouTube Music does not offer a public playback SDK/API, and that Google session is not persisted. Apple Music still requires a separate MusicKit integration and developer credentials.

Jamendo catalog search and playback use the official Jamendo API. Create a free application Client ID at [Jamendo Developer Portal](https://devportal.jamendo.com/) and enter it in **Ajustes** (or set `VITE_JAMENDO_CLIENT_ID` in `.env.local`). The public Client ID is stored only in this device's DropMusic settings. Jamendo results stream from their API and link back to each track's official page. DropMusic does not preload sample songs; the rotating feature card uses tracks returned by Spotify suggestions, Spotify search, or Jamendo search.

## Your own Spotify Client ID

Spotify limits how many accounts can sign in through one developer app, so each user can connect DropMusic with their own free Client ID: create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add `http://127.0.0.1/callback` as Redirect URI, enable **Web API** and **Web Playback SDK**, and paste the Client ID in **Ajustes → Spotify → Configura tu Client ID**. It is stored only in this device's settings. The step-by-step guide is also on the [website](https://kirpulrbx-max.github.io/DropMusic/#conectar).

## Accounts and DropMusic Pro

Accounts and the Pro plan run on [Supabase](https://supabase.com) (free tier). Without it the app hides sign-in and leaves every Pro feature unlocked, which is how development builds behave.

1. Create a Supabase project and run `supabase/setup.sql` in its SQL Editor. Then run your private `supabase/admin.sql` (git-ignored) to make your own account an admin with permanent Pro.
2. In PayPal Developer > Apps & Credentials create a REST app. Deploy `supabase/functions/paypal-capture` and set its secrets `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV` (`live` or `sandbox`) and `PRO_PRICE` (for example `5.00`). The PayPal Secret never goes in the app or the website.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local` and fill the same values, plus the PayPal Client ID, in `docs/config.js`.
4. In Supabase > Authentication > URL Configuration add `https://kirpulrbx-max.github.io/DropMusic/comprar.html` as a redirect URL.

Free accounts get the standard interface and Spotify playback. Pro (USD 5 per payment, one month each, no automatic renewal) unlocks themes and layouts, local songs and the Vinilo and Pulso full-screen modes. Payments happen on the website (`docs/comprar.html`); the `paypal-capture` function checks the order with PayPal before it extends the account.

## License

DropMusic is open source under the [MIT License](LICENSE).

## Other platforms

- **Android TV and Android phones:** `powershell -ExecutionPolicy Bypass -File scripts\compilar-android.ps1 -Variante tv` (or `-Variante movil`). Needs the Android SDK and NDK 27, and signs with the key in `~/.android-keys`. The APK lands in `src-tauri/target/android/`. Spotify's Web Playback SDK does not run on Android, so there DropMusic plays local music and Jamendo.
- **macOS and Linux:** built on GitHub's machines by `.github/workflows/escritorio-mac-linux.yml` whenever a release is published. It needs the `TAURI_SIGNING_PRIVATE_KEY` and `VITE_SPOTIFY_CLIENT_ID` repository secrets.
- **iPhone/iPad:** requires a Mac with Xcode and an Apple Developer account to sign and distribute through TestFlight.
