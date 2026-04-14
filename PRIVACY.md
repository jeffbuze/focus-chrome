# Privacy Policy — Timed Focus

_Last updated: April 14, 2026_

Timed Focus is a Chrome extension that helps you block distracting websites and manage browsing time against schedules you configure. This policy explains what the extension stores, where it stores it, and what it does not do.

## Summary

- **No data leaves your device.** The extension makes no network requests to any server we operate or any third party.
- **No accounts, sign-in, or identifiers.** There is nothing to create, log in to, or opt into.
- **No analytics, telemetry, tracking, or advertising.** The extension does not report usage, errors, or behavior to anyone.
- **No data is sold, shared, or transmitted.**

## What is stored on your device

All settings and usage data are kept in Chrome's local extension storage (`chrome.storage.local`) on your machine only. The extension does not use `chrome.storage.sync`, so data is not uploaded to your Google account or synced across devices.

The following is stored locally:

- **Groups you create** — group names and the list of site patterns (e.g. `youtube.com`) you choose to block.
- **Schedules** — the time windows, days of the week, and allowed-minute budgets you configure for each group.
- **Time tracking** — per-group, per-day counters of seconds spent on sites in that group during the current day's schedule window. Used to enforce your own time budgets.
- **Pause state** — if you pause blocking for a group, the timestamp until which the pause is active, and a daily count of how many times you've paused.
- **Internal bookkeeping** — identifiers the extension uses to manage Chrome's declarative blocking rules and a small settings object.

This data stays on your device until you remove it (by deleting a group, uninstalling the extension, or clearing Chrome's extension storage).

## Permissions and why they are needed

- **`storage`** — Save your groups, schedules, and tracking data locally on your device.
- **`tabs` / `activeTab`** — Read the URL of the current tab to determine whether it matches one of your blocked site patterns and whether to track time against it.
- **`alarms`** — Run periodic checks (e.g. when a time window ends, when paused time expires) without needing the extension's popup to be open.
- **`idle`** — Pause time tracking when your computer is idle so that leaving a tab open while you step away does not burn your time budget.
- **`declarativeNetRequest`** — Redirect requests to sites that are currently blocked to the extension's local "blocked" page. Redirection is handled by Chrome using rules the extension generates from your configuration; the extension does not see or log individual requests.
- **`host_permissions: <all_urls>`** — Required so that the blocking rules above can redirect any site you choose to add to a group. The extension does not read page content; it only matches URLs against the patterns you configured.

## What the extension does not do

- It does not read the content of pages you visit.
- It does not record or transmit your browsing history.
- It does not connect to any remote server, CDN, or analytics service. Fonts and inspirational quotes shown on the blocked page are bundled with the extension.
- It does not use cookies, fingerprinting, or any form of user identification.

## Data removal

To remove all data created by the extension, uninstall it from `chrome://extensions`. Uninstalling clears the extension's local storage.

## Changes to this policy

If this policy changes, the updated version will be published in this repository and the "Last updated" date above will reflect the change.

## Contact

Questions about this policy or the extension can be opened as an issue on the project's GitHub repository.
