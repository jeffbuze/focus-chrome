// ─────────────────────────────────────────────────────────────────────────────
// Timed Focus — Dashboard Seed Data
// ─────────────────────────────────────────────────────────────────────────────
// Paste this entire snippet into DevTools → Console (on the extension's
// dashboard page, or any page where the extension is active) to populate
// a realistic demo state for screenshots.
//
// Open the dashboard first:
//   1. Click the Timed Focus icon → "Open Dashboard"
//   2. Right-click the page → Inspect → Console tab
//   3. Paste this snippet and press Enter
//   4. Reload the dashboard page — the groups will appear
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  const TODAY = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  // ── Group & Site IDs ───────────────────────────────────────────────────────
  const IDS = {
    social: {
      group:   'g-social-001',
      twitter: 's-twitter-001',
      instagram: 's-instagram-001',
      reddit:  's-reddit-001',
      tiktok:  's-tiktok-001',
      blk0:    'b-social-wkday',
      blk1:    'b-social-wkend',
    },
    news: {
      group:   'g-news-001',
      hn:      's-hn-001',
      cnn:     's-cnn-001',
      bbc:     's-bbc-001',
      blk0:    'b-news-lunch',
    },
    shopping: {
      group:   'g-shopping-001',
      amazon:  's-amazon-001',
      ebay:    's-ebay-001',
      blk0:    'b-shop-eve',
    },
  };

  // ── Groups array ───────────────────────────────────────────────────────────
  const groups = [
    {
      id: IDS.social.group,
      name: 'Social Media',
      enabled: true,
      pauseLimitPerDay: 2,
      sites: [
        { id: IDS.social.twitter,    pattern: 'twitter.com' },
        { id: IDS.social.instagram,  pattern: 'instagram.com' },
        { id: IDS.social.reddit,     pattern: 'reddit.com' },
        { id: IDS.social.tiktok,     pattern: 'tiktok.com' },
      ],
      allowedTimeBlocks: [
        {
          id: IDS.social.blk0,
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          startTime: '12:00',
          endTime: '13:00',
          allDay: false,
          allowedMinutes: 15,
        },
        {
          id: IDS.social.blk1,
          days: ['sat', 'sun'],
          startTime: '10:00',
          endTime: '20:00',
          allDay: false,
          allowedMinutes: 45,
        },
      ],
    },
    {
      id: IDS.news.group,
      name: 'News & Media',
      enabled: true,
      pauseLimitPerDay: 3,
      sites: [
        { id: IDS.news.hn,   pattern: 'news.ycombinator.com' },
        { id: IDS.news.cnn,  pattern: 'cnn.com' },
        { id: IDS.news.bbc,  pattern: 'bbc.com' },
      ],
      allowedTimeBlocks: [
        {
          id: IDS.news.blk0,
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          startTime: '12:30',
          endTime: '13:00',
          allDay: false,
          allowedMinutes: 20,
        },
      ],
    },
    {
      id: IDS.shopping.group,
      name: 'Shopping',
      enabled: true,
      pauseLimitPerDay: 1,
      sites: [
        { id: IDS.shopping.amazon, pattern: 'amazon.com' },
        { id: IDS.shopping.ebay,   pattern: 'ebay.com' },
      ],
      allowedTimeBlocks: [
        {
          id: IDS.shopping.blk0,
          days: ['sat', 'sun'],
          startTime: '18:00',
          endTime: '21:00',
          allDay: false,
          allowedMinutes: 30,
        },
      ],
    },
  ];

  // ── Today's usage (makes the usage bars look populated) ───────────────────
  // Social Media — weekday lunch window: used 9 of 15 minutes (60%)
  const trackingSocial = {
    usedSeconds: 9 * 60, // 540s = 9 min used of 15 min budget
  };
  // News — lunch window: used 14 of 20 minutes (70%)
  const trackingNews = {
    usedSeconds: 14 * 60,
  };
  // Shopping — no weekend window active today (weekday), so no tracking key needed

  // ── Pause counts (shows some pauses have been used today) ─────────────────
  const pauseCountSocial   = { count: 1 }; // 1 of 2 pauses used
  const pauseCountNews     = { count: 2 }; // 2 of 3 pauses used

  // ── Settings ──────────────────────────────────────────────────────────────
  const settings = {
    showBadge: true,
    firstRun: false,
  };

  // ── Build the storage payload ─────────────────────────────────────────────
  const payload = {
    groups,
    settings,
    // Tracking keys: "tracking::{groupId}::{date}::{blockId}"
    [`tracking::${IDS.social.group}::${TODAY}::${IDS.social.blk0}`]:    trackingSocial,
    [`tracking::${IDS.news.group}::${TODAY}::${IDS.news.blk0}`]:        trackingNews,
    // Pause count keys: "pause-count::{groupId}::{date}"
    [`pause-count::${IDS.social.group}::${TODAY}`]:   pauseCountSocial,
    [`pause-count::${IDS.news.group}::${TODAY}`]:     pauseCountNews,
  };

  // ── Write to storage ─────────────────────────────────────────────────────
  await chrome.storage.local.clear();
  await chrome.storage.local.set(payload);

  console.log('✅ Timed Focus seed data written successfully!');
  console.log('   Groups:', groups.map(g => g.name).join(', '));
  console.log('   Today:', TODAY);
  console.log('   → Reload the dashboard to see the changes.');
})();
