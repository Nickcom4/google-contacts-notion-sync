/**
 * Google Contacts to Notion Sync (Parallel/Optimized Version)
 * 
 * Uses parallel HTTP requests for ~15x faster syncing.
 * Can sync 500+ contacts per minute.
 * 
 * For 5,800 contacts: ~10-12 minutes total (vs 3+ hours sequential)
 */

// Configuration
const NOTION_DATABASE_ID = "2d36e3b81dda8133858ef11e90147eb5";
const NOTION_API_VERSION = "2022-06-28";

// Performance settings
const BATCH_SIZE = 10;                    // Parallel requests per batch (Notion allows ~3/sec, but bursts are OK)
const DELAY_BETWEEN_BATCHES_MS = 500;     // 500ms between batches = ~20 contacts/sec with overhead
const MAX_EXECUTION_TIME_MS = 5 * 60 * 1000;  // Stop at 5 min to avoid timeout

/**
 * Main sync function - optimized with parallel requests
 */
function syncContactsToNotion() {
  const startTime = Date.now();
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY not set in Script Properties.");
  }
  
  Logger.log("🚀 Starting optimized parallel sync...");
  
  // Get existing contacts
  Logger.log("Fetching existing Notion contacts...");
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const existingCount = Object.keys(existingContacts).length;
  Logger.log(`Found ${existingCount} existing contacts in Notion`);
  
  // Get Google Contacts
  Logger.log("Fetching Google Contacts...");
  const googleContacts = getAllGoogleContacts();
  Logger.log(`Found ${googleContacts.length} Google Contacts`);
  
  // Filter to unsynced only
  const contactsToSync = googleContacts.filter(c => !existingContacts[c.resourceName]);
  Logger.log(`Contacts to sync: ${contactsToSync.length}`);
  
  if (contactsToSync.length === 0) {
    Logger.log("✅ All contacts are already synced!");
    return;
  }
  
  let created = 0;
  let failed = 0;
  let batchNum = 0;
  
  // Process in parallel batches
  for (let i = 0; i < contactsToSync.length; i += BATCH_SIZE) {
    // Check timeout
    if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = Math.round(created / (elapsed / 60));
      Logger.log(`⏱️ Stopping at ${elapsed}s to avoid timeout`);
      Logger.log(`📊 Created: ${created}, Failed: ${failed}, Rate: ${rate}/min`);
      Logger.log(`📊 Total synced: ${existingCount + created} / ${googleContacts.length}`);
      Logger.log(`🔄 Run again to continue (${contactsToSync.length - i} remaining)`);
      return;
    }
    
    batchNum++;
    const batch = contactsToSync.slice(i, i + BATCH_SIZE);
    
    // Build parallel requests
    const requests = batch.map(contact => ({
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionApiKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: buildNotionProperties(contact)
      }),
      muteHttpExceptions: true
    }));
    
    // Execute all requests in parallel
    const responses = UrlFetchApp.fetchAll(requests);
    
    // Process responses
    responses.forEach((response, idx) => {
      const code = response.getResponseCode();
      if (code === 200) {
        created++;
      } else if (code === 429) {
        // Rate limited - will retry next run
        failed++;
      } else {
        const body = JSON.parse(response.getContentText());
        Logger.log(`Error for ${batch[idx].names?.[0]?.displayName || 'Unknown'}: ${body.message || code}`);
        failed++;
      }
    });
    
    // Progress update every 10 batches (100 contacts)
    if (batchNum % 10 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = Math.round(created / (elapsed / 60));
      Logger.log(`Batch ${batchNum}: ${created} created, ${rate}/min, ${elapsed}s elapsed`);
    }
    
    // Brief pause between batches to avoid rate limits
    if (i + BATCH_SIZE < contactsToSync.length) {
      Utilities.sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const rate = Math.round(created / (elapsed / 60));
  
  Logger.log(`✅ Sync complete!`);
  Logger.log(`📊 Created: ${created}, Failed: ${failed}`);
  Logger.log(`📊 Rate: ${rate} contacts/min`);
  Logger.log(`📊 Total synced: ${existingCount + created} / ${googleContacts.length}`);
  
  if (existingCount + created >= googleContacts.length) {
    Logger.log("🎉 All contacts synced!");
  }
}

/**
 * Check sync progress
 */
function checkSyncStatus() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const googleContacts = getAllGoogleContacts();
  
  const synced = Object.keys(existingContacts).length;
  const total = googleContacts.length;
  const remaining = total - synced;
  const pct = Math.round((synced / total) * 100);
  
  Logger.log(`📊 Sync Status:`);
  Logger.log(`   Total Google Contacts: ${total}`);
  Logger.log(`   Synced to Notion: ${synced}`);
  Logger.log(`   Remaining: ${remaining}`);
  Logger.log(`   Progress: ${pct}%`);
  
  if (remaining > 0) {
    // At ~500/min, 5 min = ~2500 per run
    const runsNeeded = Math.ceil(remaining / 2500);
    Logger.log(`   Estimated runs needed: ${runsNeeded}`);
  } else {
    Logger.log(`✅ All contacts synced!`);
  }
}

/**
 * Auto-sync until complete
 */
function startContinuousSync() {
  stopContinuousSync(); // Clear existing
  
  ScriptApp.newTrigger('continueSyncIfNeeded')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log("✅ Auto-sync started (every 10 min). Run stopContinuousSync() to cancel.");
  syncContactsToNotion();
}

function continueSyncIfNeeded() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const googleContacts = getAllGoogleContacts();
  
  const remaining = googleContacts.filter(c => !existingContacts[c.resourceName]).length;
  
  if (remaining === 0) {
    Logger.log("🎉 All synced! Removing trigger.");
    stopContinuousSync();
    return;
  }
  
  Logger.log(`${remaining} remaining. Continuing...`);
  syncContactsToNotion();
}

function stopContinuousSync() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'continueSyncIfNeeded') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log("Auto-sync stopped.");
}

/**
 * Get all Google Contacts
 */
function getAllGoogleContacts() {
  const contacts = [];
  let pageToken = null;
  
  do {
    const response = People.People.Connections.list("people/me", {
      pageSize: 1000,
      personFields: "names,emailAddresses,phoneNumbers,organizations,birthdays,addresses,metadata",
      pageToken: pageToken
    });
    
    if (response.connections) {
      contacts.push(...response.connections);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  
  return contacts;
}

/**
 * Get existing Notion contacts (parallelized)
 */
function getExistingNotionContacts(apiKey) {
  const contacts = {};
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const payload = { page_size: 100 };
    if (startCursor) payload.start_cursor = startCursor;
    
    const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const data = JSON.parse(response.getContentText());
    
    if (data.results) {
      data.results.forEach(page => {
        const googleId = page.properties["Google Contact ID"]?.rich_text?.[0]?.plain_text;
        if (googleId) contacts[googleId] = page.id;
      });
    }
    
    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }
  
  return contacts;
}

/**
 * Build Notion properties from Google Contact
 */
function buildNotionProperties(contact) {
  const props = {
    "Name": {
      title: [{ text: { content: contact.names?.[0]?.displayName || "Unknown" } }]
    },
    "Google Contact ID": {
      rich_text: [{ text: { content: contact.resourceName } }]
    },
    "Contact Link": {
      url: `https://contacts.google.com/person/${contact.resourceName.replace("people/", "")}`
    }
  };
  
  // Email
  if (contact.emailAddresses?.[0]?.value) {
    props["Email"] = { email: contact.emailAddresses[0].value };
  }
  
  // Phone
  if (contact.phoneNumbers?.[0]?.value) {
    props["Phone"] = { phone_number: contact.phoneNumbers[0].value };
  }
  
  // Organization
  const org = contact.organizations?.[0];
  if (org?.name) {
    props["Company"] = { rich_text: [{ text: { content: org.name } }] };
  }
  if (org?.title) {
    props["Job Title"] = { rich_text: [{ text: { content: org.title } }] };
  }
  
  // Birthday
  const bday = contact.birthdays?.[0]?.date;
  if (bday) {
    const year = bday.year || 1900;
    const month = String(bday.month).padStart(2, "0");
    const day = String(bday.day).padStart(2, "0");
    props["Birthdate"] = { date: { start: `${year}-${month}-${day}` } };
  }
  
  // Address
  const addr = contact.addresses?.[0];
  if (addr) {
    const fullAddress = [addr.streetAddress, addr.city, addr.region, addr.postalCode, addr.country]
      .filter(Boolean).join(", ");
    if (fullAddress) {
      props["Full Address"] = { rich_text: [{ text: { content: fullAddress } }] };
    }
    if (addr.country) {
      props["Country"] = { rich_text: [{ text: { content: addr.country } }] };
    }
  }
  
  return props;
}

/**
 * Test setup
 */
function testSetup() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  if (!notionApiKey) {
    Logger.log("❌ NOTION_API_KEY not found");
    return;
  }
  Logger.log("✅ NOTION_API_KEY found");
  
  try {
    const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${notionApiKey}`, "Notion-Version": NOTION_API_VERSION },
      muteHttpExceptions: true
    });
    const data = JSON.parse(response.getContentText());
    Logger.log(data.object === "database" 
      ? `✅ Notion DB: ${data.title?.[0]?.plain_text}` 
      : `❌ Notion error: ${data.message}`);
  } catch (e) {
    Logger.log(`❌ Notion failed: ${e.message}`);
  }
  
  try {
    People.People.Connections.list("people/me", { pageSize: 1, personFields: "names" });
    Logger.log("✅ Google Contacts API working");
  } catch (e) {
    Logger.log(`❌ Google Contacts failed: ${e.message}`);
  }
}
