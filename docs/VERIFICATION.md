# Production readiness: Google and Microsoft

Status as of 2026-10-24: **not verified.** Pilot runs in Google's *Testing* mode, and no Microsoft app is registered yet. Nothing here claims compliance; this is the checklist for getting there.

## Google (Gmail)

**Current state**
- Project `inbox-pilot-512603`, consent screen *External*, publishing status *Testing*, 1 test user.
- Scope on the consent screen: `gmail.modify`. Add `gmail.readonly` too if you want to offer read-only connections.
- Testing mode limits:
  - only listed test users (up to 100, counted over the app's lifetime)
  - refresh tokens expire after 7 days, which means reconnecting weekly; Pilot shows a clear "reconnect" message when that happens

**Which requirements apply** (checked against Google's docs on 2026-10-24)

`gmail.modify` and `gmail.readonly` are **restricted** scopes. To go beyond Testing for people outside a personal circle:

| Requirement | Applies? | Notes |
|---|---|---|
| Brand verification (app name, logo, support email) | Yes | |
| Public homepage on a domain you own | Yes | Must be reachable without signing in. A template is in `docs/site/`. |
| Privacy policy on the **same domain** as the homepage | Yes | A draft is in `docs/PRIVACY_POLICY.md`. It must disclose how Google data is accessed, used, stored and shared, and include the Limited Use statement. |
| Domain ownership verified in Google Search Console | Yes | |
| Unlisted YouTube demo video showing how users grant each scope | Yes | Show the consent flow and the features that use `gmail.modify`. |
| Scope justification | Yes | Explain why `gmail.modify` is needed (archive, labels, drafts, approved replies) and offer `gmail.readonly` for people who only want summaries. |
| **Annual third-party security assessment (CASA)** | **Probably not, but confirm with Google** | Google requires it for apps that can access restricted data "from or through a third-party server" and when you "store or transmit restricted scope data on servers". Pilot has no server: mail is processed on the user's PC. **Exception risk:** phone notifications at the Sender or Full level transmit email subjects through ntfy.sh or Telegram. For verification, keep phone channels at Minimal, or argue they're user-chosen. Google's wording isn't fully consistent across pages, so ask the OAuth verification team to confirm in writing. |
| Annual recertification | Yes, if verified | |

**Exemptions that may be enough on their own**
- **Personal use:** an app used only by a few people "all of whom are known personally to you" doesn't need verification, though the unverified-app cap and warning still apply.
- **Internal use:** if everyone is in one Google Workspace organization, set the audience to *Internal*.

**Sources**
- [Restricted scope verification (Google for Developers)](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Restricted scopes list (Google Cloud Help)](https://support.google.com/cloud/answer/13464325)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

## Microsoft (Outlook / Microsoft 365)

**Blocked:** needs an Azure app registration. Your school account has no access to register apps; use a personal Microsoft account with a free Azure account. Steps are in the README.

**When registered**
- **Supported accounts:** "any organizational directory and personal Microsoft accounts", public client, redirect `http://localhost`.
- **Delegated permissions:** full mode needs `Mail.ReadWrite`, `Mail.Send`, `User.Read` and `offline_access`; read-only mode needs `Mail.Read`, `User.Read` and `offline_access`. These permissions don't require tenant admin consent by default, but some organizations block user consent to unverified apps.
- **Publisher verification:** links the app to a verified Microsoft Partner Network ID and removes the "unverified" label on the consent screen. This is recommended before giving the app to others, and some tenants require it.

## Before distributing to anyone else

1. Buy a code-signing certificate and configure `build.win` so SmartScreen doesn't warn.
2. Host the homepage and privacy policy on your domain, and fill in the placeholders.
3. Publish releases (for example on GitHub Releases) and set the update feed URL in Settings.
4. Complete Google brand and restricted-scope verification (and confirm the CASA question), plus Microsoft publisher verification.
5. Keep phone notifications at Minimal by default (they already are).
