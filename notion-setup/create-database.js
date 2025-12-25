/**
 * Create Notion Contacts Database
 * 
 * This script creates a properly configured Notion database for syncing Google Contacts.
 * 
 * Usage:
 *   npm install
 *   node create-database.js
 */

const { Client } = require("@notionhq/client");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log("\n🔧 Google Contacts → Notion Database Setup\n");
  console.log("This script will create a Notion database with all the fields needed");
  console.log("for syncing your Google Contacts.\n");

  // Get API key
  const apiKey = await question("Enter your Notion API key (starts with 'ntn_' or 'secret_'): ");
  
  if (!apiKey || (!apiKey.startsWith("ntn_") && !apiKey.startsWith("secret_"))) {
    console.error("\n❌ Invalid API key format. Get your key from https://notion.so/my-integrations");
    rl.close();
    process.exit(1);
  }

  // Get parent page
  console.log("\n📄 Where should the database be created?");
  console.log("   Open the parent page in Notion, copy the URL, and paste it below.");
  console.log("   Make sure the page is shared with your integration!\n");
  
  const pageUrl = await question("Enter the Notion page URL: ");
  
  // Extract page ID from URL
  const pageIdMatch = pageUrl.match(/([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  
  if (!pageIdMatch) {
    console.error("\n❌ Could not extract page ID from URL. Make sure you copied the full URL.");
    rl.close();
    process.exit(1);
  }
  
  const parentPageId = pageIdMatch[0].replace(/-/g, "");
  
  // Initialize Notion client
  const notion = new Client({ auth: apiKey });
  
  console.log("\n⏳ Creating database...\n");

  try {
    const database = await notion.databases.create({
      parent: {
        type: "page_id",
        page_id: parentPageId,
      },
      icon: {
        type: "emoji",
        emoji: "👥",
      },
      title: [
        {
          type: "text",
          text: {
            content: "Contacts",
          },
        },
      ],
      properties: {
        // Title property (required)
        Name: {
          title: {},
        },
        // Email
        Email: {
          email: {},
        },
        // Phone
        Phone: {
          phone_number: {},
        },
        // Company
        Company: {
          rich_text: {},
        },
        // Job Title
        "Job Title": {
          rich_text: {},
        },
        // Birthdate
        Birthdate: {
          date: {},
        },
        // Full Address
        "Full Address": {
          rich_text: {},
        },
        // Country
        Country: {
          rich_text: {},
        },
        // Contact Link
        "Contact Link": {
          url: {},
        },
        // Google Contact ID (for sync tracking)
        "Google Contact ID": {
          rich_text: {},
        },
        // Relationship (manual field)
        Relationship: {
          select: {
            options: [
              { name: "Friend", color: "green" },
              { name: "Family", color: "red" },
              { name: "Colleague", color: "blue" },
              { name: "Business", color: "yellow" },
              { name: "Acquaintance", color: "gray" },
            ],
          },
        },
        // Comms Channel (manual field)
        "Comms Channel": {
          multi_select: {
            options: [
              { name: "Email", color: "pink" },
              { name: "Phone", color: "green" },
              { name: "WhatsApp", color: "green" },
              { name: "LinkedIn", color: "blue" },
              { name: "Twitter/X", color: "default" },
              { name: "Instagram", color: "purple" },
              { name: "WeChat", color: "green" },
            ],
          },
        },
        // Contact info (manual notes)
        "Contact info": {
          rich_text: {},
        },
        // Archived
        Archived: {
          checkbox: {},
        },
      },
    });

    console.log("✅ Database created successfully!\n");
    console.log("📋 Database Details:");
    console.log(`   Name: ${database.title[0]?.plain_text}`);
    console.log(`   URL: ${database.url}`);
    console.log(`   ID: ${database.id.replace(/-/g, "")}\n`);
    
    console.log("📝 Next Steps:");
    console.log("   1. Copy the Database ID above");
    console.log("   2. Open apps-script/GoogleContactsToNotion.gs");
    console.log("   3. Replace YOUR_DATABASE_ID_HERE with your Database ID");
    console.log("   4. Follow the README instructions to set up Google Apps Script\n");
    
  } catch (error) {
    console.error("\n❌ Error creating database:");
    
    if (error.code === "unauthorized") {
      console.error("   The API key is invalid or the integration doesn't have access.");
      console.error("   Make sure the parent page is shared with your integration.");
    } else if (error.code === "object_not_found") {
      console.error("   Could not find the parent page.");
      console.error("   Make sure the page exists and is shared with your integration.");
    } else {
      console.error(`   ${error.message}`);
    }
    
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
