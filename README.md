# BlankSlate Focus

A Chrome extension that blocks distracting websites and helps you manage your browsing time with configurable time budgets.

## Features

- **Website blocking** — Block sites by domain (e.g., `facebook.com`) or specific paths (e.g., `reddit.com/r/funny`)
- **Site groups** — Organize blocked sites into groups like "Social Media" or "News"
- **Allowed time windows** — Set specific days and hours when you're allowed limited access (e.g., 15 minutes of Reddit between 2–5 PM on weekdays)
- **Live time tracking** — See remaining time in the extension badge as it counts down
- **Daily usage stats** — View per-window usage bars on the dashboard
- **Mindful pause** — Temporarily bypass blocking by typing a mindfulness phrase, with 5/10/25 minute options
- **Blocked page** — Displays an inspirational quote and the reason access was denied
- **All data stays local** — No accounts, no telemetry, no external network calls

## Installation

1. Clone or download this repository:
   ```
   git clone https://github.com/jeffbuze/focus-chrome.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `focus-chrome` folder you cloned

The extension icon will appear in your toolbar. Click it to get started.

## Usage

### Creating a group

1. Click the extension icon and select **Open Dashboard**
2. Click **+ New Group** in the sidebar
3. Name your group (e.g., "Social Media")

### Adding sites to block

1. In the group detail panel, enter a domain under **Blocked Sites** (e.g., `twitter.com`)
2. Press Enter or click **Add** — subdomains are included automatically
3. You can also block specific paths (e.g., `youtube.com/shorts`)

### Setting allowed time windows

By default, sites in a group are blocked at all times. To allow limited access:

1. Click **Add Time Block** under **Allowed Time Windows**
2. Select the days of the week
3. Set a start and end time (or choose **All Day**)
4. Set how many minutes of access are allowed during that window

### Pausing a block

If you need temporary access to a blocked site:

1. Click the extension icon while on the blocked page
2. Type the mindfulness phrase shown on screen
3. Choose a pause duration (5, 10, or 25 minutes)

You'll be redirected to the site. When the pause expires, blocking resumes automatically.

## Project Structure

```
focus-chrome/
├── manifest.json          # Extension manifest (v3)
├── background/            # Service worker — blocking rules, time tracking, alarms
├── popup/                 # Extension popup UI
├── dashboard/             # Full-page settings and usage dashboard
├── blocked/               # Page shown when a site is blocked
├── shared/                # Storage and group management utilities
├── assets/                # Inspirational quotes
└── icons/                 # Extension icons
```

## License

See [LICENSE](LICENSE) for details.
