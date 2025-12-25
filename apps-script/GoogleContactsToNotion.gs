/**
 * Google Contacts to Notion Sync
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Copy this entire script into the editor
 * 3. Click on "Project Settings" (gear icon) → "Script Properties"
 * 4. Add a property: Key = "NOTION_API_KEY", Value = your Notion API key
 * 5. Enable the People API:
 *    - Click "Services" (+ icon next to Services in left panel)
 *    - Find "People API" and click "Add"
 * 6. Run the syncContactsToNotion() function manually first to authorize
 * 7. Set up a trigger: Triggers (clock icon) → Add Trigger → syncContactsToNotion → Time-driven → Daily
 */

// Configuration
const NOTION_DATABASE_ID = "YOUR_DATABASE_ID_HERE"; // Replace with your Notion database ID
const NOTION_API_VERSION = "2022-06-28";

/**
 * Main sync function - call this to sync all contacts
 */
function syncContactsToNotion() {
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  
  if (!notionApiKey) {
    throw new Error("NOTION_API_KEY not set in Script Properties. Go to Project Settings → Script Properties and add it.");
  }
  
  Logger.log("Starting Google Contacts to Notion sync...");
  
  // Get all existing Notion contacts (to check for duplicates)
  const existingContacts = getExistingNotionContacts(notionApiKey);
  Logger.log(`Found ${Object.keys(existingContacts).length} existing contacts in Notion`);
  
  // Get all Google Contacts
  const googleContacts = getAllGoogleContacts();
  Logger.log(`Found ${googleContacts.length} Google Contacts`);
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const contact of googleContacts) {
    try {
      const googleContactId = contact.resourceName; // e.g., "people/c1234567890"
      
      if (existingContacts[googleContactId]) {
        // Update existing contact
        const pageId = existingContacts[googleContactId];
        updateNotionContact(notionApiKey, pageId, contact);
        updated++;
      } else {
        // Create new contact
        createNotionContact(notionApiKey, contact);
        created++;
      }
      
      // Rate limiting - Notion API has limits
      Utilities.sleep(350);
      
    } catch (e) {
      Logger.log(`Error processing contact ${contact.resourceName}: ${e.message}`);
      skipped++;
    }
  }
  
  Logger.log(`Sync complete! Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
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
 * Update an existing contact in Notion
 */
function updateNotionContact(apiKey, pageId, googleContact) {
  const properties = buildNotionProperties(googleContact);
  
  const payload = {
    properties: properties
  };
  
  const response = UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
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
  // Format: https://contacts.google.com/person/{id}
  // resourceName is like "people/c1234567890", we need just the ID part
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
      // Format: YYYY-MM-DD (use 1900 if year not specified)
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
    
    // Also set Country separately if available
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
  // Test Notion API key
  const notionApiKey = PropertiesService.getScriptProperties().getProperty("NOTION_API_KEY");
  if (!notionApiKey) {
    Logger.log("❌ NOTION_API_KEY not found in Script Properties");
    return;
  }
  Logger.log("✅ NOTION_API_KEY found");
  
  // Test Notion connection
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
  
  // Test Google Contacts API
  try {
    const response = People.People.Connections.list("people/me", {
      pageSize: 1,
      personFields: "names"
    });
    Logger.log(`✅ Google Contacts API working. Total contacts: ${response.totalItems || "unknown"}`);
  } catch (e) {
    Logger.log(`❌ Google Contacts API failed: ${e.message}`);
    Logger.log("Make sure you've enabled the People API in Services");
  }
}

/**
 * Manual trigger to run sync once
 */
function runSyncNow() {
  syncContactsToNotion();
}
