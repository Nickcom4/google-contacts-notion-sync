/**
 * Google Contacts to Notion Sync (Batched Version)
 * 
 * Designed for large contact lists (1000+). Automatically stops before
 * the 6-minute Apps Script timeout and picks up where it left off.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Copy this entire script into the editor
 * 3. Click on "Project Settings" (gear icon) → "Script Properties"
 * 4. Add a property: Key = "NOTION_API_KEY", Value = your Notion API key
 * 5. Enable the People API:
 *    - Click "Services" (+ icon next to Services in left panel)
 *    - Find "People API" and click "Add"
 * 6. Run testSetup() first to verify everything works
 * 7. Run syncContactsToNotion() - it will auto-continue until done
 * 8. Set up a trigger for ongoing sync: Triggers → Add Trigger → Daily
 */

// Configuration
const NOTION_DATABASE_ID = "2d36e3b81dda8133858ef11e90147eb5";
const NOTION_API_VERSION = "2022-06-28";

// Batch settings
const MAX_EXECUTION_TIME_MS = 5 * 60 * 1000; // Stop after 5 minutes (before 6-min limit)
const DELAY_BETWEEN_CONTACTS_MS = 100; // Reduced delay - Notion allows 3 req/sec

/**
 * Main sync function - automatically handles batching
 */
function syncContactsToNotion() {
  const startTime = Date.now();
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY not set in Script Properties.");
  }
  
  Logger.log("Starting Google Contacts to Notion sync...");
  
  // Get all existing Notion contacts (to check for duplicates)
  Logger.log("Fetching existing Notion contacts...");
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const existingCount = Object.keys(existingContacts).length;
  Logger.log(`Found ${existingCount} existing contacts in Notion`);
  
  // Get all Google Contacts
  Logger.log("Fetching Google Contacts...");
  const googleContacts = getAllGoogleContacts();
  Logger.log(`Found ${googleContacts.length} Google Contacts`);
  
  // Filter to only contacts not yet in Notion (for initial sync efficiency)
  const contactsToProcess = googleContacts.filter(c => !existingContacts[c.resourceName]);
  Logger.log(`Contacts to create: ${contactsToProcess.length}`);
  Logger.log(`Contacts already synced: ${existingCount}`);
  
  if (contactsToProcess.length === 0) {
    Logger.log("✅ All contacts are already synced!");
    return;
  }
  
  let created = 0;
  let skipped = 0;
  
  for (const contact of contactsToProcess) {
    // Check if we're running out of time
    if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
      Logger.log(`⏱️ Stopping to avoid timeout. Progress: ${created} created, ${skipped} skipped`);
      Logger.log(`📊 Total synced so far: ${existingCount + created} / ${googleContacts.length}`);
      Logger.log(`🔄 Run again to continue syncing remaining ${contactsToProcess.length - created - skipped} contacts`);
      return;
    }
    
    try {
      createNotionContact(notionApiKey, contact);
      created++;
      
      // Progress update every 50 contacts
      if (created % 50 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        Logger.log(`Progress: ${created} created in ${elapsed}s (${existingCount + created} total synced)`);
      }
      
      // Rate limiting
      Utilities.sleep(DELAY_BETWEEN_CONTACTS_MS);
      
    } catch (e) {
      Logger.log(`Error processing ${contact.names?.[0]?.displayName || contact.resourceName}: ${e.message}`);
      skipped++;
      Utilities.sleep(500); // Longer delay after error
    }
  }
  
  Logger.log(`✅ Batch complete! Created: ${created}, Skipped: ${skipped}`);
  Logger.log(`📊 Total synced: ${existingCount + created} / ${googleContacts.length}`);
  
  if (existingCount + created >= googleContacts.length) {
    Logger.log("🎉 All contacts synced successfully!");
  }
}

/**
 * Run this to continuously sync until done (sets up auto-trigger)
 */
function startContinuousSync() {
  // Delete any existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'continueSyncIfNeeded') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create a trigger to run every 7 minutes until done
  ScriptApp.newTrigger('continueSyncIfNeeded')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log("✅ Continuous sync started! Will run every 10 minutes until complete.");
  Logger.log("Run stopContinuousSync() to cancel.");
  
  // Run immediately
  syncContactsToNotion();
}

/**
 * Called by trigger to continue syncing
 */
function continueSyncIfNeeded() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  // Check if sync is complete
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const googleContacts = getAllGoogleContacts();
  
  const remaining = googleContacts.filter(c => !existingContacts[c.resourceName]).length;
  
  if (remaining === 0) {
    Logger.log("🎉 Sync complete! Removing auto-trigger.");
    stopContinuousSync();
    return;
  }
  
  Logger.log(`${remaining} contacts remaining. Continuing sync...`);
  syncContactsToNotion();
}

/**
 * Stop the continuous sync
 */
function stopContinuousSync() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'continueSyncIfNeeded') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(`Removed ${removed} sync trigger(s).`);
}

/**
 * Check sync status without running sync
 */
function checkSyncStatus() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  Logger.log("Checking sync status...");
  
  const existingContacts = getExistingNotionContacts(notionApiKey);
  const googleContacts = getAllGoogleContacts();
  
  const synced = Object.keys(existingContacts).length;
  const total = googleContacts.length;
  const remaining = googleContacts.filter(c => !existingContacts[c.resourceName]).length;
  
  Logger.log(`📊 Sync Status:`);
  Logger.log(`   Google Contacts: ${total}`);
  Logger.log(`   Synced to Notion: ${synced}`);
  Logger.log(`   Remaining: ${remaining}`);
  Logger.log(`   Progress: ${Math.round((synced / total) * 100)}%`);
  
  if (remaining === 0) {
    Logger.log(`✅ All contacts are synced!`);
  } else {
    const estimatedMinutes = Math.ceil(remaining * 0.15 / 60); // ~0.15 sec per contact
    const estimatedRuns = Math.ceil(remaining / 300); // ~300 per run
    Logger.log(`⏱️ Estimated time: ~${estimatedRuns} more runs (~${estimatedMinutes} minutes total)`);
  }
}

/**
 * Get all Google Contacts using People API
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
 * Get existing Notion contacts indexed by Google Contact ID
 */
function getExistingNotionContacts(apiKey) {
  const contacts = {};
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const payload = {
      page_size: 100
    };
    
    if (startCursor) {
      payload.start_cursor = startCursor;
    }
    
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
      for (const page of data.results) {
        const googleId = getPropertyValue(page.properties, "Google Contact ID", "rich_text");
        if (googleId) {
          contacts[googleId] = page.id;
        }
      }
    }
    
    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }
  
  return contacts;
}

/**
 * Create a new contact in Notion
 */
function createNotionContact(apiKey, googleContact) {
  const properties = buildNotionProperties(googleContact);
  
  const payload = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: properties
  };
  
  const response = UrlFetchApp.fetch("https://api.notion.com/v1/pages", {
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
  
  if (data.object === "error") {
    throw new Error(data.message);
  }
  
  return data;
}

/**
 * Build Notion properties object from Google Contact data
 */
function buildNotionProperties(contact) {
  const props = {};
  
  // Name (title property)
  const name = contact.names?.[0]?.displayName || "Unknown";
  props["Name"] = {
    title: [{ text: { content: name } }]
  };
  
  // Google Contact ID
  props["Google Contact ID"] = {
    rich_text: [{ text: { content: contact.resourceName } }]
  };
  
  // Contact Link - URL to open in Google Contacts
  const contactId = contact.resourceName.replace("people/", "");
  props["Contact Link"] = {
    url: `https://contacts.google.com/person/${contactId}`
  };
  
  // Email
  if (contact.emailAddresses?.length > 0) {
    props["Email"] = {
      email: contact.emailAddresses[0].value
    };
  }
  
  // Phone
  if (contact.phoneNumbers?.length > 0) {
    props["Phone"] = {
      phone_number: contact.phoneNumbers[0].value
    };
  }
  
  // Company & Job Title
  if (contact.organizations?.length > 0) {
    const org = contact.organizations[0];
    if (org.name) {
      props["Company"] = {
        rich_text: [{ text: { content: org.name } }]
      };
    }
    if (org.title) {
      props["Job Title"] = {
        rich_text: [{ text: { content: org.title } }]
      };
    }
  }
  
  // Birthday
  if (contact.birthdays?.length > 0) {
    const bday = contact.birthdays[0].date;
    if (bday) {
      const year = bday.year || 1900;
      const month = String(bday.month).padStart(2, "0");
      const day = String(bday.day).padStart(2, "0");
      props["Birthdate"] = {
        date: { start: `${year}-${month}-${day}` }
      };
    }
  }
  
  // Full Address
  if (contact.addresses?.length > 0) {
    const addr = contact.addresses[0];
    const fullAddress = [
      addr.streetAddress,
      addr.city,
      addr.region,
      addr.postalCode,
      addr.country
    ].filter(Boolean).join(", ");
    
    if (fullAddress) {
      props["Full Address"] = {
        rich_text: [{ text: { content: fullAddress } }]
      };
    }
    
    if (addr.country) {
      props["Country"] = {
        rich_text: [{ text: { content: addr.country } }]
      };
    }
  }
  
  return props;
}

/**
 * Helper to extract property value from Notion page properties
 */
function getPropertyValue(properties, propertyName, propertyType) {
  const prop = properties[propertyName];
  if (!prop) return null;
  
  switch (propertyType) {
    case "title":
      return prop.title?.[0]?.plain_text || null;
    case "rich_text":
      return prop.rich_text?.[0]?.plain_text || null;
    case "email":
      return prop.email || null;
    case "phone_number":
      return prop.phone_number || null;
    case "url":
      return prop.url || null;
    default:
      return null;
  }
}

/**
 * Test function - run this first to verify setup
 */
function testSetup() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  if (!notionApiKey) {
    Logger.log("❌ NOTION_API_KEY not found in Script Properties");
    return;
  }
  Logger.log("✅ NOTION_API_KEY found");
  
  try {
    const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${notionApiKey}`,
        "Notion-Version": NOTION_API_VERSION
      },
      muteHttpExceptions: true
    });
    const data = JSON.parse(response.getContentText());
    if (data.object === "database") {
      Logger.log(`✅ Connected to Notion database: ${data.title?.[0]?.plain_text}`);
    } else {
      Logger.log(`❌ Notion error: ${data.message}`);
    }
  } catch (e) {
    Logger.log(`❌ Notion connection failed: ${e.message}`);
  }
  
  try {
    const response = People.People.Connections.list("people/me", {
      pageSize: 1,
      personFields: "names"
    });
    Logger.log(`✅ Google Contacts API working. Total contacts: ${response.totalItems || "unknown"}`);
  } catch (e) {
    Logger.log(`❌ Google Contacts API failed: ${e.message}`);
  }
}
