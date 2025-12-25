# Google Contacts to Notion Sync

Automatically sync your Google Contacts to a Notion database using Google Apps Script. Uses parallel HTTP requests for fast syncing (~100-150 contacts/minute).

## Features

- **Fast parallel sync**: Uses `UrlFetchApp.fetchAll()` for ~3-4x faster syncing
- **Auto-resume**: Stops before timeout, picks up where it left off
- **No duplicates**: Tracks contacts by Google Contact ID
- **Automatic mode**: Set-and-forget continuous sync until complete
- **Direct links**: Each Notion entry links back to Google Contacts

## Synced Fields

| Notion Field | Source | Description |
|--------------|--------|-------------|
| Name | Google | Contact's display name |
| Email | Google | Primary email address |
| Phone | Google | Primary phone number |
| Company | Google | Organization name |
| Job Title | Google | Job title at organization |
| Birthdate | Google | Birthday (uses 1900 if year unknown) |
| Full Address | Google | Complete address |
| Country | Google | Country (for filtering) |
| Contact Link | Generated | URL to open in Google Contacts |
| Google Contact ID | Generated | Internal ID for sync tracking |
| Relationship | Manual | Your custom categorization |
| Comms Channel | Manual | Preferred communication method |
| Contact info | Manual | Additional notes |
| Archived | Manual | Mark inactive contacts |

---

## Quick Start

### 1. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Name it "Google Contacts Sync"
4. Copy the **Internal Integration Token** (starts with `ntn_` or `secret_`)

### 2. Create the Notion Database

**Option A: Run the setup script**
```bash
cd notion-setup
npm install
node create-database.js
```

**Option B: Create manually** — see [Database Schema](#database-schema) below

### 3. Share the Database with Your Integration

1. Open your Notion database
2. Click **"..."** menu → **"Connections"**
3. Find your integration → **"Confirm"**

### 4. Set Up Google Apps Script

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Delete any existing code
3. Copy contents of `apps-script/GoogleContactsToNotion.gs` and paste
4. Update the database ID:
   ```javascript
   const NOTION_DATABASE_ID = "your-32-character-database-id";
   ```

### 5. Add Your API Key (Secure Storage)

1. Click ⚙️ **Project Settings** (gear icon)
2. Scroll to **Script Properties** → **Add script property**
3. Property: `NOTION_API_KEY`
4. Value: Your Notion integration token
5. Click **Save**

### 6. Enable Google People API

1. In left sidebar, click ➕ next to **"Services"**
2. Find **"People API"** → **Add**

### 7. Test & Run

1. Select `testSetup` from dropdown → **Run** → Authorize when prompted
2. Check logs for ✅ confirmations
3. Select `syncContactsToNotion` → **Run**

---

## Available Functions

| Function | Description |
|----------|-------------|
| `testSetup()` | Verify API connections are working |
| `syncContactsToNotion()` | Sync one batch (~600 contacts in 5 min) |
| `checkSyncStatus()` | Show progress: synced vs remaining |
| `startContinuousSync()` | Auto-run every 10 min until complete |
| `stopContinuousSync()` | Cancel the automatic sync |

---

## Usage Guide

### Initial Sync (Large Contact Lists)

For lists over 500 contacts, the script runs in batches to avoid the 6-minute Apps Script timeout.

**Recommended: Automatic mode**
```
1. Run startContinuousSync()
2. Close the tab — it runs in the background
3. Check back in 1-2 hours
4. Sync stops automatically when complete
```

**Alternative: Manual mode**
```
1. Run syncContactsToNotion()
2. Wait for completion (~5 min)
3. Run checkSyncStatus() to see progress
4. Repeat until done
```

### Performance

| Contacts | Estimated Time |
|----------|----------------|
| 500 | ~5 minutes (1 run) |
| 2,000 | ~20 minutes (3-4 runs) |
| 5,000 | ~45 minutes (8-9 runs) |
| 10,000 | ~90 minutes (15-17 runs) |

*Based on ~100-150 contacts/minute. Actual speed depends on Notion API responsiveness.*

### Ongoing Sync

After initial sync, set up a daily trigger to keep contacts updated:

1. Click ⏰ **Triggers** in left sidebar
2. **+ Add Trigger**
3. Function: `syncContactsToNotion`
4. Event source: **Time-driven**
5. Type: **Day timer**
6. Time: Choose off-peak hours (e.g., 2-3 AM)
7. **Save**

### Checking Progress

Run `checkSyncStatus()` anytime to see:
```
📊 Sync Status:
   Total Google Contacts: 5854
   Synced to Notion: 2341
   Remaining: 3513
   Progress: 40%
   Estimated runs needed: 6
```

---

## Database Schema

If creating the database manually, use these property types:

| Property | Type |
|----------|------|
| Name | Title |
| Email | Email |
| Phone | Phone |
| Company | Text |
| Job Title | Text |
| Birthdate | Date |
| Full Address | Text |
| Country | Text |
| Contact Link | URL |
| Google Contact ID | Text |
| Relationship | Select |
| Comms Channel | Multi-select |
| Contact info | Text |
| Archived | Checkbox |

---

## Troubleshooting

### "NOTION_API_KEY not found"
→ Add it in Project Settings → Script Properties

### "Could not find database"
→ Check database ID (32 chars, no dashes) and that it's shared with your integration

### "Google Contacts API failed"
→ Enable People API in Services menu

### Sync is slow
→ Normal rate is 100-150/min. Notion rate-limits API requests.

### "Exceeded maximum execution time"
→ Expected for large lists. Just run again — it resumes automatically.

### Some contacts missing
→ Contacts without names may be skipped. Check execution logs for errors.

---

## How It Works

1. **Fetches all Google Contacts** via People API
2. **Queries Notion** for existing contacts (by Google Contact ID)
3. **Filters** to only unsynced contacts
4. **Sends parallel requests** in batches of 10
5. **Stops at 5 minutes** to avoid timeout
6. **Resumes** on next run (already-synced contacts are skipped)

---

## File Structure

```
google-contacts-notion-sync/
├── README.md
├── apps-script/
│   └── GoogleContactsToNotion.gs   # Main sync script
└── notion-setup/
    ├── package.json
    └── create-database.js          # Database creation helper
```

---

## Security

⚠️ **Never commit API keys to version control**

- Notion API key is stored in Apps Script's encrypted Script Properties
- If exposed, regenerate immediately at [notion.so/my-integrations](https://www.notion.so/my-integrations)

---

## License

MIT License — use and modify freely.
