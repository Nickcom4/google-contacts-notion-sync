/**
 * Google Contacts to Notion Sync (Optimized with Caching)
 * 
 * Caches progress between runs to avoid re-fetching 5000+ contacts each time.
 */

// Configuration
const NOTION_DATABASE_ID = "YOUR_DATABASE_ID_HERE";
const NOTION_API_VERSION = "2022-06-28";

// Performance settings
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 400;
const MAX_EXECUTION_TIME_MS = 4.5 * 60 * 1000; // 4.5 min (more buffer)

/**
 * Main sync function - optimized to skip already-synced contacts
 */
function syncContactsToNotion() {
  const startTime = Date.now();
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY not set in Script Properties.");
  }
  
  Logger.log("🚀 Starting sync...");
  
  // Get the set of already-synced Google Contact IDs (from cache or Notion)
  const syncedIds = getSyncedContactIds(notionApiKey);
  Logger.log(`Already synced: ${syncedIds.size} contacts`);
  
  // Get Google Contacts
  Logger.log("Fetching Google Contacts...");
  const googleContacts = getAllGoogleContacts();
  Logger.log(`Found ${googleContacts.length} Google Contacts`);
  
  // Filter to unsynced only
  const contactsToSync = googleContacts.filter(c => !syncedIds.has(c.resourceName));
  Logger.log(`Contacts to sync: ${contactsToSync.length}`);
  
  if (contactsToSync.length === 0) {
    Logger.log("✅ All contacts are already synced!");
    clearSyncCache(); // Clean up cache
    return;
  }
  
  let created = 0;
  let failed = 0;
  let batchNum = 0;
  const newlySynced = [];
  
  // Process in parallel batches
  for (let i = 0; i < contactsToSync.length; i += BATCH_SIZE) {
    // Check timeout
    if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
      // Save progress before exiting
      saveSyncProgress(newlySynced);
      logProgress(startTime, created, failed, syncedIds.size, googleContacts.length, contactsToSync.length - i);
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
    
    // Execute batch
    try {
      const responses = UrlFetchApp.fetchAll(requests);
      
      responses.forEach((response, idx) => {
        const code = response.getResponseCode();
        if (code === 200) {
          created++;
          newlySynced.push(batch[idx].resourceName);
        } else {
          failed++;
          if (code !== 429) { // Don't log rate limits
            const body = JSON.parse(response.getContentText());
            Logger.log(`Error: ${batch[idx].names?.[0]?.displayName || 'Unknown'}: ${body.message || code}`);
          }
        }
      });
    } catch (e) {
      // Network error - skip this batch, will retry next run
      Logger.log(`Batch ${batchNum} network error: ${e.message}`);
      failed += batch.length;
    }
    
    // Progress update every 10 batches
    if (batchNum % 10 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = Math.round(created / (elapsed / 60));
      Logger.log(`Batch ${batchNum}: ${created} created, ${rate}/min`);
    }
    
    Utilities.sleep(DELAY_BETWEEN_BATCHES_MS);
  }
  
  // Save final progress
  saveSyncProgress(newlySynced);
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const rate = created > 0 ? Math.round(created / (elapsed / 60)) : 0;
  
  Logger.log(`✅ Sync complete! Created: ${created}, Failed: ${failed}, Rate: ${rate}/min`);
  Logger.log(`📊 Total synced: ${syncedIds.size + created} / ${googleContacts.length}`);
  
  if (syncedIds.size + created >= googleContacts.length) {
    Logger.log("🎉 All contacts synced!");
    clearSyncCache();
  }
}

/**
 * Get set of already-synced contact IDs (uses cache when available)
 */
function getSyncedContactIds(apiKey) {
  const cache = CacheService.getScriptCache();
  const syncedIds = new Set();
  
  // Check if we have cached IDs from previous runs
  const cachedCount = cache.get("syncedCount");
  if (cachedCount) {
    const count = parseInt(cachedCount);
    // Retrieve cached IDs in chunks
    for (let i = 0; i < Math.ceil(count / 500); i++) {
      const chunk = cache.get(`synced_${i}`);
      if (chunk) {
        JSON.parse(chunk).forEach(id => syncedIds.add(id));
      }
    }
    Logger.log(`Loaded ${syncedIds.size} IDs from cache`);
  }
  
  // If cache is empty or small, fetch from Notion
  if (syncedIds.size === 0) {
    Logger.log("Fetching existing contacts from Notion...");
    const notionContacts = getExistingNotionContacts(apiKey);
    Object.keys(notionContacts).forEach(id => syncedIds.add(id));
    
    // Cache these IDs for next run
    saveSyncedIdsToCache(syncedIds);
  }
  
  return syncedIds;
}

/**
 * Save synced IDs to cache (in chunks due to size limits)
 */
function saveSyncedIdsToCache(syncedIds) {
  const cache = CacheService.getScriptCache();
  const ids = Array.from(syncedIds);
  const chunkSize = 500;
  const chunks = {};
  
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunkIndex = Math.floor(i / chunkSize);
    chunks[`synced_${chunkIndex}`] = JSON.stringify(ids.slice(i, i + chunkSize));
  }
  
  chunks["syncedCount"] = ids.length.toString();
  cache.putAll(chunks, 21600); // 6 hour cache
}

/**
 * Save newly synced IDs to cache (append to existing)
 */
function saveSyncProgress(newIds) {
  if (newIds.length === 0) return;
  
  const cache = CacheService.getScriptCache();
  const currentCount = parseInt(cache.get("syncedCount") || "0");
  
  // Get existing IDs
  const allIds = [];
  for (let i = 0; i < Math.ceil(currentCount / 500); i++) {
    const chunk = cache.get(`synced_${i}`);
    if (chunk) {
      allIds.push(...JSON.parse(chunk));
    }
  }
  
  // Add new IDs
  allIds.push(...newIds);
  
  // Save back to cache
  saveSyncedIdsToCache(new Set(allIds));
  Logger.log(`Saved progress: ${allIds.length} total synced`);
}

/**
 * Clear sync cache (call when sync is complete)
 */
function clearSyncCache() {
  const cache = CacheService.getScriptCache();
  const count = parseInt(cache.get("syncedCount") || "0");
  
  const keysToRemove = ["syncedCount"];
  for (let i = 0; i < Math.ceil(count / 500); i++) {
    keysToRemove.push(`synced_${i}`);
  }
  
  cache.removeAll(keysToRemove);
  Logger.log("Cache cleared");
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
  
  Logger.log("Checking status...");
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
  
  Logger.log("✅ Auto-sync started (every 10 min)");
  syncContactsToNotion();
}

function continueSyncIfNeeded() {
  try {
    const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
    
    // Quick check using cache
    const cache = CacheService.getScriptCache();
    const cachedCount = parseInt(cache.get("syncedCount") || "0");
    
    // Get Google contact count (faster than full fetch)
    const response = People.People.Connections.list("people/me", {
      pageSize: 1,
      personFields: "names"
    });
    const totalContacts = response.totalPeople || response.totalItems || 0;
    
    if (cachedCount > 0 && cachedCount >= totalContacts) {
      // Verify with Notion
      const existing = getExistingNotionContacts(notionApiKey);
      if (Object.keys(existing).length >= totalContacts) {
        Logger.log("🎉 Initial sync complete! Switching to hourly maintenance.");
        stopContinuousSync();
        clearSyncCache();
        startMaintenanceSync(); // Start hourly maintenance
        return;
      }
    }
    
    syncContactsToNotion();
  } catch (e) {
    Logger.log(`⚠️ Error: ${e.message}. Will retry in 10 min.`);
  }
}

function stopContinuousSync() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'continueSyncIfNeeded') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) Logger.log("Auto-sync stopped.");
}

/**
 * Start hourly maintenance sync (for ongoing updates after initial sync)
 */
function startMaintenanceSync() {
  stopMaintenanceSync(); // Clear existing
  
  ScriptApp.newTrigger('maintenanceSync')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log("✅ Hourly maintenance sync started.");
}

/**
 * Stop hourly maintenance sync
 */
function stopMaintenanceSync() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'maintenanceSync') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) Logger.log("Maintenance sync stopped.");
}

/**
 * Hourly maintenance - syncs new/updated contacts
 */
function maintenanceSync() {
  try {
    Logger.log("🔄 Running hourly maintenance sync...");
    clearSyncCache(); // Always fetch fresh for maintenance
    syncContactsToNotion();
  } catch (e) {
    Logger.log(`⚠️ Maintenance error: ${e.message}`);
  }
}

/**
 * Force refresh - clears cache and re-syncs from scratch
 */
function forceRefresh() {
  clearSyncCache();
  Logger.log("Cache cleared. Run syncContactsToNotion() to start fresh.");
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
