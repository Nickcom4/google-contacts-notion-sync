# Google Contacts to Notion Sync

Automatically sync your Google Contacts to a Notion database using Google Apps Script. Keep your contacts organized in Notion with a clickable link back to the full contact in Google Contacts.

## Features

- **One-way sync**: Google Contacts → Notion (prevents accidental overwrites)
- **Automatic deduplication**: Uses Google Contact ID to avoid duplicates
- **Daily sync**: Set up a trigger to keep contacts updated automatically
- **Direct links**: Each Notion entry includes a link to open the contact in Google Contacts

## Synced Fields

| Notion Field | Source | Description |
|--------------|--------|-------------|
| Name | Google | Contact's display name |
| Email | Google | Primary email address |
| Phone | Google | Primary phone number |
| Company | Google | Organization name |
| Job Title | Google | Job title at organization |
| Birthdate | Google | Birthday (uses 1900 if year unknown) |
| Full Address | Google | Complete address (street, city, state, zip, country) |
| Country | Google | Country (separate field for filtering) |
| Contact Link | Generated | URL to open contact in Google Contacts |
| Google Contact ID | Generated | Internal ID for sync tracking |
| Relationship | Manual | Your custom categorization |
| Comms Channel | Manual | Preferred communication method |
| Contact info | Manual | Additional notes |
| Archived | Manual | Mark inactive contacts |

---

## Setup Instructions

### Step 1: Create the Notion Database

You have two options:

#### Option A: Run the Setup Script (Recommended)

1. Get a Notion API key:
   - Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Click "New integration"
   - Name it "Google Contacts Sync"
   - Copy the "Internal Integration Token"

2. Share a Notion page with your integration:
   - Open the Notion page where you want the database
   - Click "..." menu → "Connections" → Find your integration → "Confirm"

3. Install Node.js if you don't have it: [nodejs.org](https://nodejs.org)

4. Run the setup script:
   ```bash
   cd notion-setup
   npm install
   node create-database.js
   ```

5. Follow the prompts to enter your API key and parent page URL

#### Option B: Create Manually in Notion

Create a new database in Notion with these properties:

| Property Name | Type |
|---------------|------|
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

### Step 2: Set Up Google Apps Script

1. **Create a new Apps Script project**
   - Go to [script.google.com](https://script.google.com)
   - Click "New project"
   - Name it "Google Contacts to Notion Sync"

2. **Copy the script**
   - Delete any existing code in the editor
   - Copy the entire contents of `apps-script/GoogleContactsToNotion.gs`
   - Paste into the editor

3. **Update the database ID**
   - Find your Notion database URL (it looks like `notion.so/workspace/abc123...`)
   - Copy the 32-character ID from the URL
   - In the script, replace the `NOTION_DATABASE_ID` value:
     ```javascript
     const NOTION_DATABASE_ID = "your-database-id-here";
     ```

4. **Add your Notion API key securely**
   - Click ⚙️ "Project Settings" (gear icon in left sidebar)
   - Scroll down to "Script Properties"
   - Click "Add script property"
   - Property: `NOTION_API_KEY`
   - Value: Your Notion integration token (from Step 1)
   - Click "Save script properties"

5. **Enable the People API**
   - In the left sidebar, click ➕ next to "Services"
   - Scroll to find "People API"
   - Click "Add"

6. **Save the project**
   - Press `Ctrl+S` or `Cmd+S`

---

### Step 3: Test the Setup

1. In the Apps Script editor, select `testSetup` from the function dropdown
2. Click "Run"
3. If prompted, authorize the script to access your Google Contacts
4. Check the "Execution log" at the bottom for results:
   - ✅ NOTION_API_KEY found
   - ✅ Connected to Notion database: [Your Database Name]
   - ✅ Google Contacts API working

If you see any ❌ errors, check:
- API key is correct in Script Properties
- Database is shared with your integration
- People API is enabled in Services

---

### Step 4: Run Your First Sync

1. Select `syncContactsToNotion` from the function dropdown
2. Click "Run"
3. Wait for it to complete (may take a few minutes for large contact lists)
4. Check your Notion database!

---

### Step 5: Set Up Automatic Daily Sync

1. In the left sidebar, click ⏰ "Triggers"
2. Click "+ Add Trigger" (bottom right)
3. Configure:
   - Function: `syncContactsToNotion`
   - Deployment: `Head`
   - Event source: `Time-driven`
   - Type: `Day timer`
   - Time: Choose a time (e.g., 2am-3am)
4. Click "Save"

---

## Usage

### Viewing Contacts in Google

Each contact in Notion has a "Contact Link" field. Click it to open the full contact details in Google Contacts.

### Manual Fields

These fields are not synced from Google and are for your own organization:

- **Relationship**: Categorize contacts (Friend, Business, etc.)
- **Comms Channel**: Track preferred communication method
- **Contact info**: Add your own notes
- **Archived**: Hide inactive contacts from your main view

### Re-running Sync

- **Manual**: Go to Apps Script → Run `syncContactsToNotion`
- **Automatic**: Happens daily if you set up a trigger

### Adding New Contacts

1. Add the contact in Google Contacts
2. Wait for the next automatic sync, or run manually
3. The contact will appear in Notion

---

## Troubleshooting

### "NOTION_API_KEY not found"
- Go to Project Settings → Script Properties
- Make sure `NOTION_API_KEY` is set correctly

### "Could not find database"
- Make sure the database ID is correct (32 characters, no dashes)
- Make sure the database is shared with your integration

### "Google Contacts API failed"
- Make sure People API is added in Services
- Re-authorize the script if needed

### Contacts not appearing
- Check the Execution log for errors
- Verify the contact exists in Google Contacts (not just Gmail)
- Some contacts may be skipped if they have no name

### Rate limiting
- The script includes a 350ms delay between API calls
- For very large contact lists (1000+), the script may take 10+ minutes

---

## File Structure

```
google-contacts-notion-sync/
├── README.md                 # This file
├── apps-script/
│   └── GoogleContactsToNotion.gs   # The main sync script
└── notion-setup/
    ├── package.json          # Node.js dependencies
    └── create-database.js    # Script to create Notion database
```

---

## Security Notes

⚠️ **Never commit API keys to version control**

- The Notion API key is stored in Google Apps Script's "Script Properties" (encrypted)
- If you accidentally expose your API key, regenerate it immediately at [notion.so/my-integrations](https://www.notion.so/my-integrations)

---

## Future Enhancements

Want to extend this? Here are some ideas:

- **Two-way sync**: Push Notion changes back to Google Contacts
- **Selective sync**: Only sync contacts with specific labels
- **Additional fields**: Sync notes, websites, custom fields
- **Conflict resolution**: Handle cases where both sides changed

---

## License

MIT License - Feel free to use and modify as needed.
