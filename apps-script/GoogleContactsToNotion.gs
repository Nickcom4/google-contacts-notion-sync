/**
 * Google Contacts to Notion Sync (Parallel + Retry)
 * 
 * Uses parallel HTTP requests with retry logic for reliability.
 * Handles transient network errors gracefully.
 */

// Configuration
const NOTION_DATABASE_ID = "YOUR_DATABASE_ID_HERE";
const NOTION_API_VERSION = "2022-06-28";

// Performance settings
const BATCH_SIZE = 5;                     // Smaller batches = more reliable
const DELAY_BETWEEN_BATCHES_MS = 600;     // Slightly longer delay
const MAX_EXECUTION_TIME_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

/**
 * Main sync function with error handling
 */
function syncContactsToNotion() {
  const startTime = Date.now();
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY not set in Script Properties.");
  }
  
  Logger.log("🚀 Starting sync...");
  
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
  
  // Process in batches
  for (let i = 0; i < contactsToSync.length; i += BATCH_SIZE) {
    // Check timeout
    if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
      logProgress(startTime, created, failed, existingCount, googleContacts.length, contactsToSync.length - i);
      return;
    }
    
    batchNum++;
    const batch = contactsToSync.slice(i, i + BATCH_SIZE);
    
    // Process batch with retry
    const result = processBatchWithRetry(notionApiKey, batch);
    created += result.created;
    failed += result.failed;
    
    // Progress update every 20 batches (100 contacts)
    if (batchNum % 20 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = Math.round(created / (elapsed / 60));
      Logger.log(`Batch ${batchNum}: ${created} created, ${failed} failed, ${rate}/min`);
    }
    
    // Pause between batches
    if (i + BATCH_SIZE < contactsToSync.length) {
      Utilities.sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const rate = created > 0 ? Math.round(created / (elapsed / 60)) : 0;
  
  Logger.log(`✅ Sync complete!`);
  Logger.log(`📊 Created: ${created}, Failed: ${failed}, Rate: ${rate}/min`);
  Logger.log(`📊 Total synced: ${existingCount + created} / ${googleContacts.length}`);
}

/**
 * Process a batch with retry logic
 */
function processBatchWithRetry(apiKey, batch) {
  let created = 0;
  let failed = 0;
  let contactsToRetry = [...batch];
  
  for (let attempt = 1; attempt <= MAX_RETRIES && contactsToRetry.length > 0; attempt++) {
    const results = processBatch(apiKey, contactsToRetry);
    
    created += results.created;
    
    // Collect failed contacts for retry
    contactsToRetry = results.failedContacts;
    
    if (contactsToRetry.length > 0 && attempt < MAX_RETRIES) {
      Logger.log(`Retry attempt ${attempt + 1} for ${contactsToRetry.length} contacts...`);
      Utilities.sleep(1000 * attempt); // Exponential backoff
    }
  }
  
  failed = contactsToRetry.length;
  
  return { created, failed };
}

/**
 * Process a batch of contacts (single attempt)
 */
function processBatch(apiKey, batch) {
  let created = 0;
  const failedContacts = [];
  
  // Try parallel first
  try {
    const requests = batch.map(contact => ({
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: buildNotionProperties(contact)
      }),
      muteHttpExceptions: true
    }));
    
    const responses = UrlFetchApp.fetchAll(requests);
    
    responses.forEach((response, idx) => {
      const code = response.getResponseCode();
      if (code === 200) {
        created++;
      } else {
        failedContacts.push(batch[idx]);
      }
    });
    
  } catch (e) {
    // If parallel fails, fall back to sequential
    Logger.log(`Parallel request failed: ${e.message}. Trying sequential...`);
    
    for (const contact of batch) {
      try {
        const response = UrlFetchApp.fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json"
          },
          payload: JSON.stringify({
            parent: { database_id: NOTION_DATABASE_ID },
            properties: buildNotionProperties(contact)
          }),
          muteHttpExceptions: true
        });
        
        if (response.getResponseCode() === 200) {
          created++;
        } else {
          failedContacts.push(contact);
        }
        
        Utilities.sleep(200);
      } catch (e2) {
        failedContacts.push(contact);
      }
    }
  }
  
  return { created, failedContacts };
}

function logProgress(startTime, created, failed, existingCount, total, remaining) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const rate = created > 0 ? Math.round(created / (elapsed / 60)) : 0;
  Logger.log(`⏱️ Stopping at ${elapsed}s to avoid timeout`);
  Logger.log(`📊 Created: ${created}, Failed: ${failed}, Rate: ${rate}/min`);
  Logger.log(`📊 Total synced: ${existingCount + created} / ${total}`);
  Logger.log(`🔄 Run again to continue (${remaining} remaining)`);
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
    const runsNeeded = Math.ceil(remaining / 400); // Conservative estimate
    Logger.log(`   Estimated runs needed: ${runsNeeded}`);
  } else {
    Logger.log(`✅ All contacts synced!`);
  }
}

/**
 * Auto-sync until complete
 */
function startContinuousSync() {
  stopContinuousSync();
  
  ScriptApp.newTrigger('continueSyncIfNeeded')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log("✅ Auto-sync started (every 10 min). Run stopContinuousSync() to cancel.");
  
  // Run first sync
  try {
    syncContactsToNotion();
  } catch (e) {
    Logger.log(`⚠️ First run had error: ${e.message}`);
    Logger.log("Will retry automatically in 10 minutes.");
  }
}

function continueSyncIfNeeded() {
  try {
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
  } catch (e) {
    Logger.log(`⚠️ Error in continueSyncIfNeeded: ${e.message}`);
    Logger.log("Will retry in 10 minutes.");
  }
}

function stopContinuousSync() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'continueSyncIfNeeded') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) {
    Logger.log(`Auto-sync stopped (${removed} trigger(s) removed).`);
  }
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
 * Get existing Notion contacts
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
 * Build Notion properties
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
  
  if (contact.emailAddresses?.[0]?.value) {
    props["Email"] = { email: contact.emailAddresses[0].value };
  }
  
  if (contact.phoneNumbers?.[0]?.value) {
    props["Phone"] = { phone_number: contact.phoneNumbers[0].value };
  }
  
  const org = contact.organizations?.[0];
  if (org?.name) {
    props["Company"] = { rich_text: [{ text: { content: org.name } }] };
  }
  if (org?.title) {
    props["Job Title"] = { rich_text: [{ text: { content: org.title } }] };
  }
  
  const bday = contact.birthdays?.[0]?.date;
  if (bday) {
    const year = bday.year || 1900;
    const month = String(bday.month).padStart(2, "0");
    const day = String(bday.day).padStart(2, "0");
    props["Birthdate"] = { date: { start: `${year}-${month}-${day}` } };
  }
  
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
