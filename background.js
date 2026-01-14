// Background service worker for Webpage Monitor

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Webpage Monitor installed');
  initializeMonitors();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Webpage Monitor started');
  initializeMonitors();
});

// Initialize monitors from storage
async function initializeMonitors() {
  const result = await chrome.storage.local.get(['monitors']);
  const monitors = result.monitors || {};
  
  // Clear all existing alarms
  await chrome.alarms.clearAll();
  
  // Create alarms for enabled monitors
  Object.entries(monitors).forEach(([id, monitor]) => {
    if (monitor.enabled) {
      createAlarm(id, monitor.interval);
      // Also do an initial check
      setTimeout(() => checkMonitor(id), 1000);
    }
  });
  
  console.log('Initialized monitors:', Object.keys(monitors).length);
}

// Create an alarm for a monitor
function createAlarm(id, intervalSeconds) {
  const alarmName = `monitor_${id}`;
  // Minimum alarm interval in Chrome is 1 minute for production
  // But for testing, we'll use a workaround for shorter intervals
  const periodMinutes = Math.max(intervalSeconds / 60, 0.5);
  
  chrome.alarms.create(alarmName, {
    delayInMinutes: Math.max(intervalSeconds / 60, 0.1),
    periodInMinutes: periodMinutes
  });
  
  // For intervals less than 1 minute, we'll use setTimeout as backup
  if (intervalSeconds < 60) {
    scheduleQuickCheck(id, intervalSeconds);
  }
}

// For quick intervals (< 1 minute), use setTimeout
const quickCheckTimers = new Map();

function scheduleQuickCheck(id, intervalSeconds) {
  // Clear any existing timer
  if (quickCheckTimers.has(id)) {
    clearTimeout(quickCheckTimers.get(id));
  }
  
  // Add jitter to interval (±20%) to avoid looking like a bot
  const intervalMs = addJitter(intervalSeconds * 1000);
  
  const timer = setTimeout(async () => {
    const result = await chrome.storage.local.get(['monitors']);
    const monitors = result.monitors || {};
    const monitor = monitors[id];
    
    if (monitor && monitor.enabled) {
      await checkMonitor(id);
      scheduleQuickCheck(id, intervalSeconds);
    }
  }, intervalMs);
  
  quickCheckTimers.set(id, timer);
}

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('monitor_')) {
    const id = alarm.name.replace('monitor_', '');
    await checkMonitor(id);
  }
});

// In-memory cache to prevent race conditions
const alertCache = new Map(); // monitorId -> Set of hashes
const checkLocks = new Map(); // monitorId -> boolean (is checking)

// User agents to rotate through (modern browsers)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

// Get a random user agent
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Add random jitter to intervals (±10%)
function addJitter(baseMs) {
  const jitter = baseMs * 0.1; // 10% jitter
  return baseMs + (Math.random() * jitter * 2) - jitter;
}

// Check a specific monitor by injecting content script
async function checkMonitor(id) {
  // Prevent concurrent checks for the same monitor
  if (checkLocks.get(id)) {
    return;
  }
  checkLocks.set(id, true);
  
  try {
    const result = await chrome.storage.local.get(['monitors']);
    const monitors = result.monitors || {};
    const monitor = monitors[id];
    
    if (!monitor || !monitor.enabled) {
      checkLocks.set(id, false);
      return;
    }
    
    // Initialize in-memory cache from storage if needed
    if (!alertCache.has(id)) {
      alertCache.set(id, new Set(monitor.alertHistory || []));
    }
    const monitorCache = alertCache.get(id);
  
    // Use fetch to get the page content - fast, single attempt
    let html = '';
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(monitor.url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Upgrade-Insecure-Requests': '1'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        html = await response.text();
      }
    } catch (e) {
      // Silent fail - will retry on next scheduled check
    }
    
    if (!html) {
      checkLocks.set(id, false);
      return;
    }
    
    // Use offscreen document for proper DOM parsing
    let content = '';
    
    if (monitor.selectors && monitor.selectors.length > 0) {
      content = await parseHTMLWithSelectors(html, monitor.selectors);
    } else {
      // Extract all text content (strip HTML tags)
      content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
    }
    
    // Check for changes using smarter comparison
    const oldContent = monitor.lastContent || '';
    
    // Normalize and compare content
    const oldNormalized = normalizeContent(oldContent);
    const newNormalized = normalizeContent(content);
    
    // Find genuinely new items (not just reordered)
    const newItems = findNewItems(oldNormalized, newNormalized);
    
    const hasChanged = newItems.length > 0 && oldContent !== '';
    
    // Update monitor
    monitor.lastCheck = new Date().toISOString();
    
    if (hasChanged) {
      // Filter out items we've already alerted on (using in-memory cache)
      const trulyNewItems = newItems.filter(item => {
        const normalizedItem = item.toLowerCase().replace(/\s+/g, ' ').trim();
        const hash = hashContent(normalizedItem);
        
        // Check BOTH in-memory cache and storage history
        if (monitorCache.has(hash)) {
          return false;
        }
        return true;
      });
      
      if (trulyNewItems.length === 0) {
        monitor.lastContent = content;
        monitors[id] = monitor;
        await chrome.storage.local.set({ monitors });
        checkLocks.set(id, false);
        return;
      }
      
      // Add to in-memory cache IMMEDIATELY (before sending webhook)
      trulyNewItems.forEach(item => {
        const normalizedItem = item.toLowerCase().replace(/\s+/g, ' ').trim();
        const hash = hashContent(normalizedItem);
        monitorCache.add(hash);
      });
      
      // Also update storage history
      monitor.alertHistory = Array.from(monitorCache).slice(-100);
      monitor.lastChange = new Date().toISOString();
      monitor.lastContent = content;
      
      // Save to storage BEFORE sending notifications
      monitors[id] = monitor;
      await chrome.storage.local.set({ monitors });
      
      const newItemsText = trulyNewItems.join('\n');
      console.log('📢 Change detected:', monitor.name, '-', newItemsText.substring(0, 100));
      
      // NOW send notifications (after cache and storage are updated)
      if (monitor.popupEnabled !== false) {
        showNotification(monitor, newItemsText);
      }
      
      if (monitor.webhookUrl) {
        await sendWebhook(monitor, newItemsText, content);
      }
    } else {
      monitor.lastContent = content;
      monitors[id] = monitor;
      await chrome.storage.local.set({ monitors });
    }
    
  } catch (error) {
    // Silent error handling
  } finally {
    checkLocks.set(id, false);
  }
}

// Parse HTML with CSS selectors using offscreen document
async function parseHTMLWithSelectors(html, selectors) {
  try {
    // Ensure offscreen document exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: 'Parse HTML with CSS selectors for webpage monitoring'
      });
    }
    
    // Send HTML and selectors to offscreen document for parsing
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'parseHTML',
        html: html,
        selectors: selectors
      }, (response) => {
        if (response && response.content) {
          resolve(response.content);
        } else {
          // Fallback to basic extraction
          resolve(extractBySelectorsBasic(html, selectors));
        }
      });
    });
  } catch (e) {
    console.log('Offscreen parsing failed, using basic extraction:', e.message);
    return extractBySelectorsBasic(html, selectors);
  }
}

// Basic selector extraction fallback
function extractBySelectorsBasic(html, selectors) {
  const parts = [];
  
  for (const sel of selectors) {
    const extracted = extractBySelector(html, sel.selector, sel.type);
    if (extracted) {
      parts.push(extracted);
    }
  }
  
  return parts.join('\n');
}

// Simple selector-based extraction (handles basic CSS selectors)
function extractBySelector(html, selector, type) {
  try {
    // Handle ID selectors: #something
    if (selector.startsWith('#')) {
      const id = selector.substring(1).split(/[.\s\[]/)[0];
      const regex = new RegExp(`id=["']${id}["'][^>]*>([\\s\\S]*?)<`, 'i');
      const match = html.match(regex);
      if (match) {
        return cleanText(match[1]);
      }
    }
    
    // Handle class selectors: .something or tag.something
    const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch) {
      const className = classMatch[1];
      // Find elements with this class
      const regex = new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\/`, 'gi');
      const matches = [...html.matchAll(regex)];
      if (matches.length > 0) {
        return matches.map(m => cleanText(m[1])).join('\n');
      }
    }
    
    // Handle tag selectors
    const tagMatch = selector.match(/^([a-zA-Z0-9]+)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
      const matches = [...html.matchAll(regex)];
      if (matches.length > 0) {
        return matches.slice(0, 10).map(m => cleanText(m[1])).join('\n');
      }
    }
    
    return '';
  } catch (e) {
    console.error('Selector extraction error:', e);
    return '';
  }
}

// Clean extracted text
function cleanText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Normalize content for comparison - split into clean items
function normalizeContent(content) {
  if (!content) return [];
  
  // Split by newlines and common separators
  let items = content
    .split(/[\n\r]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10) // Ignore very short strings
    .map(s => {
      // Remove common noise: timestamps, "Advertisement", etc.
      return s
        .replace(/\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\b/g, '') // Times
        .replace(/\b(Advertisement|Sponsored|Ad)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(s => s.length > 10);
  
  return items;
}

// Simple hash for deduplication - more robust version
function hashContent(str) {
  if (!str) return '0';
  
  // Normalize string before hashing
  const normalized = str.toLowerCase().replace(/\s+/g, ' ').trim();
  
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

// Find genuinely new items (in new but not in old)
function findNewItems(oldItems, newItems) {
  // Create a set of normalized old items for fast lookup
  const oldSet = new Set(oldItems.map(s => s.toLowerCase()));
  
  // Find items that are truly new (not just reordered)
  const genuinelyNew = newItems.filter(item => {
    const normalized = item.toLowerCase();
    
    // Check exact match
    if (oldSet.has(normalized)) return false;
    
    // Check fuzzy match (80% similarity) to catch minor text changes
    for (const oldItem of oldItems) {
      if (similarity(normalized, oldItem.toLowerCase()) > 0.8) {
        return false;
      }
    }
    
    return true;
  });
  
  return genuinelyNew;
}

// Calculate similarity between two strings (0-1)
function similarity(str1, str2) {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;
  
  // Use longest common subsequence ratio
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  // Quick check: if lengths are very different, low similarity
  if (longer.length > shorter.length * 2) return 0;
  
  // Count matching words
  const words1 = new Set(shorter.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(longer.split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0) return 0;
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  return matches / Math.max(words1.size, words2.size);
}

// Show browser notification with optional audio
async function showNotification(monitor, content) {
  const preview = content.substring(0, 100).replace(/\s+/g, ' ');
  
  chrome.notifications.create(`monitor_${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${monitor.name} was updated`,
    message: preview || 'Content changed',
    priority: 2,
    requireInteraction: false
  });
  
  // Play audio if enabled
  if (monitor.audioEnabled !== false) {
    await playNotificationSound();
  }
}

// Play notification sound using offscreen document
async function playNotificationSound() {
  try {
    // Check if offscreen document exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      // Create offscreen document for audio playback
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play notification sound for webpage changes'
      });
    }
    
    // Send message to play sound
    chrome.runtime.sendMessage({ action: 'playSound' });
  } catch (e) {
    // Offscreen API might not be available, that's okay
    console.log('Audio notification not available:', e.message);
  }
}

// Webhook rate limiting - only to prevent Discord 429 errors
const webhookLastSent = new Map(); // URL -> timestamp
const WEBHOOK_MIN_INTERVAL = 500; // Minimum 0.5 second between webhooks

// Send Discord webhook - fast and clean
async function sendWebhook(monitor, newItems, fullContent) {
  // Quick rate limit check
  const now = Date.now();
  const lastSent = webhookLastSent.get(monitor.webhookUrl) || 0;
  if (now - lastSent < WEBHOOK_MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, WEBHOOK_MIN_INTERVAL - (now - lastSent)));
  }
  
  try {
    // Clean up the new items text
    let changeText = newItems || '';
    changeText = changeText.replace(/\s+/g, ' ').trim();
    
    // Decode HTML entities
    changeText = changeText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // Skip if empty
    if (!changeText || changeText.length < 5) {
      return;
    }
    
    // Limit length
    if (changeText.length > 300) {
      changeText = changeText.substring(0, 300) + '...';
    }
    
    const data = {
      content: `**${monitor.name} was updated** | <${monitor.url}>\n\n> ${changeText}`,
      username: 'Webpage Monitor'
    };
    
    const response = await fetch(monitor.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    webhookLastSent.set(monitor.webhookUrl, Date.now());
    
    // If rate limited, wait and retry once
    if (response.status === 429) {
      const errorData = await response.json().catch(() => ({}));
      const retryAfter = ((errorData.retry_after || 1) * 1000) + 100;
      await new Promise(r => setTimeout(r, retryAfter));
      
      await fetch(monitor.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      webhookLastSent.set(monitor.webhookUrl, Date.now());
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'saveSelectors') {
    handleSaveSelectors(message, sender);
    sendResponse({ success: true });
    
  } else if (message.action === 'updateMonitors') {
    initializeMonitors();
    sendResponse({ success: true });
    
  } else if (message.action === 'checkNow') {
    checkMonitor(message.id);
    sendResponse({ success: true });
    
  } else if (message.action === 'checkAll') {
    checkAllMonitors();
    sendResponse({ success: true });
  }
  
  return true;
});

// Handle selector save from content script
async function handleSaveSelectors(message, sender) {
  const { url, selectors } = message;
  
  await chrome.storage.local.set({
    pendingMonitor: {
      url,
      selectors,
      name: sender.tab?.title || new URL(url).hostname,
      timestamp: Date.now()
    }
  });
}

// Check all enabled monitors
async function checkAllMonitors() {
  const result = await chrome.storage.local.get(['monitors']);
  const monitors = result.monitors || {};
  
  for (const id of Object.keys(monitors)) {
    if (monitors[id].enabled) {
      await checkMonitor(id);
      // Small delay between checks
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Notification click handler
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === 'update_available') {
    // Open extensions page for manual reload
    chrome.tabs.create({ url: 'chrome://extensions/' });
  }
  chrome.notifications.clear(notificationId);
});

// ============================================
// AUTO-UPDATE SYSTEM
// ============================================

// GitHub raw URL for version.json
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/Michaelcain7/webpage-monitor-extension/main/version.json';
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

// Get current version from manifest
function getCurrentVersion() {
  return chrome.runtime.getManifest().version;
}

// Compare version strings (returns true if remote is newer)
function isNewerVersion(current, remote) {
  const currentParts = current.split('.').map(Number);
  const remoteParts = remote.split('.').map(Number);
  
  for (let i = 0; i < Math.max(currentParts.length, remoteParts.length); i++) {
    const c = currentParts[i] || 0;
    const r = remoteParts[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

// Check for updates
async function checkForUpdates() {
  try {
    const response = await fetch(UPDATE_CHECK_URL + '?t=' + Date.now(), {
      cache: 'no-store'
    });
    
    if (!response.ok) return;
    
    const data = await response.json();
    const currentVersion = getCurrentVersion();
    
    if (isNewerVersion(currentVersion, data.version)) {
      console.log(`Update available: ${currentVersion} -> ${data.version}`);
      
      // Store update info
      await chrome.storage.local.set({
        updateAvailable: {
          version: data.version,
          changelog: data.changelog || '',
          downloadUrl: data.downloadUrl || '',
          checkedAt: Date.now()
        }
      });
      
      // Show notification
      chrome.notifications.create('update_available', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Webpage Monitor Update Available',
        message: `Version ${data.version} is available. Click to update.`,
        priority: 2,
        requireInteraction: true
      });
    }
  } catch (e) {
    // Silent fail - will retry later
  }
}

// Start update checker
function startUpdateChecker() {
  // Check on startup (after 30 seconds)
  setTimeout(checkForUpdates, 30000);
  
  // Check periodically
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
}

// Initialize update checker
startUpdateChecker();
