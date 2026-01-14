# Webpage Monitor - Chrome Extension

A Chrome extension for monitoring webpages for changes with visual element selection, similar to Distill.io.

## Features

- **Visual Element Selector**: Hover over and click elements on any webpage to select exactly what you want to monitor
- **CSS Selector Support**: Automatically generates CSS selectors, with ability to edit manually
- **Discord Webhooks**: Send notifications to Discord channels when changes are detected
- **Browser Notifications**: Native Chrome notifications for changes
- **Configurable Intervals**: From 5 seconds to daily checks
- **Multiple Monitors**: Track as many webpages as you need

## Installation

### Developer Mode Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome_extension` folder
5. The extension icon should appear in your toolbar

## Usage

### Selecting Elements to Monitor

1. Navigate to the webpage you want to monitor
2. Click the extension icon and click **"Select Elements to Monitor"**
3. The page will enter selection mode:
   - **Hover** over elements to see them highlighted (pink border)
   - **Click** an element to select it (green border)
   - Selected elements appear in the bottom panel
   - You can select multiple elements
4. Click **"Save selections"** in the bottom panel
5. Configure your monitor settings in the popup:
   - Set the check interval
   - Add a Discord webhook URL (optional)
   - Enable/disable notifications
6. Click **Save Monitor**

### Element Selection Panel

When in selection mode, the panel at the bottom shows:

- **Selected elements**: List of CSS selectors for chosen elements
- **Preview**: Text content of selected elements
- **Extract type**: Choose to extract `text`, `html`, or a specific `attribute`
- **Regex filter**: Optional filter for matched content

### Managing Monitors

- **Toggle on/off**: Use the switch next to each monitor
- **Check now**: Click the 🔄 button to check immediately
- **Edit**: Click the ✏️ button to modify settings
- **Delete**: Click the 🗑️ button to remove

### Discord Webhook Setup

1. In Discord, go to **Server Settings → Integrations → Webhooks**
2. Click **New Webhook** and configure it
3. Copy the webhook URL
4. Paste it in the monitor's webhook URL field

When changes are detected, you'll receive messages like:
```
FT News Feed was updated | View on distill.io
UAE cuts funds for citizens keen to study in UK over Muslim Brotherhood tensions
```

## Tips

- **Be specific**: Select the smallest element that contains what you want to monitor
- **Test selectors**: Edit the CSS selector if the auto-generated one is too broad
- **Use text extraction**: Best for headlines and article titles
- **Use attribute extraction**: Good for monitoring links (`href`) or images (`src`)

## Files

```
chrome_extension/
├── manifest.json      # Extension configuration
├── background.js      # Service worker for monitoring
├── content.js         # Element selection on pages
├── selector.css       # Styles for selection UI
├── popup.html         # Extension popup interface
├── popup.js           # Popup functionality
└── icons/             # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Permissions

The extension requires:
- `activeTab`: To interact with the current page for element selection
- `storage`: To save monitor configurations
- `alarms`: To schedule periodic checks
- `notifications`: To show browser notifications
- `<all_urls>`: To fetch monitored pages for change detection

## Troubleshooting

**"Please refresh the page first"**
- The content script needs to be injected. Refresh the page and try again.

**Selectors not matching**
- Some pages generate dynamic class names. Try editing the selector to use more stable attributes like `data-*` or element hierarchy.

**Webhook not working**
- Verify the webhook URL is correct
- Check Discord's rate limits (30 requests per minute per webhook)

**Changes not detected**
- Very dynamic pages may change constantly. Use more specific selectors.
- Some content loads via JavaScript after initial page load.
