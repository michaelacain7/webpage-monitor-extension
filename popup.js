// Popup script for Webpage Monitor extension

document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  const contents = {
    monitors: document.getElementById('monitors-content'),
    edit: document.getElementById('edit-content'),
    options: document.getElementById('options-content')
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      Object.values(contents).forEach(c => c.classList.remove('active'));
      const tabName = tab.dataset.tab;
      if (tabName === 'monitors') {
        contents.monitors.style.display = 'block';
        contents.edit.style.display = 'none';
        contents.options.style.display = 'none';
      } else if (tabName === 'edit') {
        contents.monitors.style.display = 'none';
        contents.edit.style.display = 'block';
        contents.edit.classList.add('active');
        contents.options.style.display = 'none';
      } else if (tabName === 'options') {
        contents.monitors.style.display = 'none';
        contents.edit.style.display = 'none';
        contents.options.style.display = 'block';
        contents.options.classList.add('active');
      }
    });
  });

  // Current edit state
  let currentEditId = null;
  let currentSelectors = [];

  // Default webhook URL
  const DEFAULT_WEBHOOK_URL = 'https://discord.com/api/webhooks/919672540237017138/Zga2QHBVwPUKXbCMNQ6hRXSsJaW8d136pOZNheRz1SK0YS5GIRnpjsGdN7trPul-zeXo';

  // Check for pending monitor from element selection
  function checkPendingMonitor() {
    chrome.storage.local.get(['pendingMonitor'], (result) => {
      if (result.pendingMonitor) {
        const pending = result.pendingMonitor;
        
        // Only use if recent (within last 5 minutes)
        if (Date.now() - pending.timestamp < 300000) {
          currentEditId = null; // New monitor
          currentSelectors = pending.selectors || [];
          
          document.getElementById('editName').value = pending.name || '';
          document.getElementById('editUrl').value = pending.url || '';
          document.getElementById('editInterval').value = 30;
          document.getElementById('editWebhook').value = DEFAULT_WEBHOOK_URL;
          updateIntervalDisplay(30);
          updateSelectorPreview();
          
          // Switch to edit tab
          tabs.forEach(t => t.classList.remove('active'));
          document.querySelector('[data-tab="edit"]').classList.add('active');
          contents.monitors.style.display = 'none';
          contents.edit.style.display = 'block';
          contents.edit.classList.add('active');
          contents.options.style.display = 'none';
          
          // Clear pending data
          chrome.storage.local.remove('pendingMonitor');
        } else {
          // Too old, clear it
          chrome.storage.local.remove('pendingMonitor');
        }
      }
    });
  }

  // Load and display monitors
  function loadMonitors() {
    chrome.storage.local.get(['monitors', 'monitorStatus'], (result) => {
      const monitors = result.monitors || {};
      const status = result.monitorStatus || {};
      const listContainer = document.getElementById('monitorList');
      
      if (Object.keys(monitors).length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state">
            <div class="icon">📋</div>
            <div>No monitors yet</div>
            <div style="font-size: 11px; margin-top: 5px;">Click above to start monitoring a webpage</div>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = '';
      
      Object.entries(monitors).forEach(([id, monitor]) => {
        const monitorStatus = status[id] || { state: 'idle' };
        const statusText = getStatusText(monitorStatus, monitor);
        const statusClass = getStatusClass(monitorStatus.state);
        
        const item = document.createElement('div');
        item.className = `monitor-item ${monitor.enabled ? '' : 'disabled'}`;
        item.innerHTML = `
          <label class="toggle-switch">
            <input type="checkbox" ${monitor.enabled ? 'checked' : ''} data-id="${id}">
            <span class="toggle-slider"></span>
          </label>
          <div class="monitor-info">
            <div class="monitor-name">${escapeHtml(monitor.name)}</div>
            <div class="monitor-url">${escapeHtml(monitor.url)}</div>
            <div class="monitor-meta">
              <span class="monitor-interval">${monitor.enabled ? `Every ${formatInterval(monitor.interval)}` : 'Disabled'}</span>
              <span class="monitor-status ${statusClass}">${statusText}</span>
            </div>
          </div>
          <div class="monitor-actions">
            <button class="action-btn" data-action="check" data-id="${id}" title="Check now">🔄</button>
            <button class="action-btn" data-action="edit" data-id="${id}" title="Edit">✏️</button>
            <button class="action-btn delete" data-action="delete" data-id="${id}" title="Delete">🗑️</button>
          </div>
        `;
        listContainer.appendChild(item);
      });
      
      // Add event listeners
      listContainer.querySelectorAll('.toggle-switch input').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
          toggleMonitor(e.target.dataset.id, e.target.checked);
        });
      });
      
      listContainer.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.target.dataset.action;
          const id = e.target.dataset.id;
          
          if (action === 'edit') {
            editMonitor(id);
          } else if (action === 'delete') {
            deleteMonitor(id);
          } else if (action === 'check') {
            checkMonitor(id);
          }
        });
      });
    });
  }

  // Get status text based on state
  function getStatusText(status, monitor) {
    if (!monitor.enabled) return 'Disabled';
    
    switch (status.state) {
      case 'checking':
        return '⟳ Checking...';
      case 'error':
        return `⚠ Error: ${status.error || 'Failed'}`;
      case 'success':
        // Show last check time
        if (monitor.lastCheck) {
          const lastCheck = new Date(monitor.lastCheck);
          const now = new Date();
          const diffMs = now - lastCheck;
          const diffSec = Math.floor(diffMs / 1000);
          if (diffSec < 60) return `✓ ${diffSec}s ago`;
          const diffMin = Math.floor(diffSec / 60);
          if (diffMin < 60) return `✓ ${diffMin}m ago`;
          return `✓ ${lastCheck.toLocaleTimeString()}`;
        }
        return '✓ Idle';
      default:
        if (monitor.lastCheck) {
          const lastCheck = new Date(monitor.lastCheck);
          const now = new Date();
          const diffMs = now - lastCheck;
          const diffSec = Math.floor(diffMs / 1000);
          if (diffSec < 60) return `Idle · ${diffSec}s ago`;
          const diffMin = Math.floor(diffSec / 60);
          if (diffMin < 60) return `Idle · ${diffMin}m ago`;
          return `Idle · ${lastCheck.toLocaleTimeString()}`;
        }
        return 'Idle';
    }
  }

  // Get CSS class for status
  function getStatusClass(state) {
    switch (state) {
      case 'checking': return 'status-checking';
      case 'error': return 'status-error';
      case 'success': return 'status-success';
      default: return 'status-idle';
    }
  }

  // Toggle monitor enabled state
  function toggleMonitor(id, enabled) {
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      if (monitors[id]) {
        monitors[id].enabled = enabled;
        chrome.storage.local.set({ monitors }, () => {
          chrome.runtime.sendMessage({ action: 'updateMonitors' });
          loadMonitors();
        });
      }
    });
  }

  // Edit monitor
  function editMonitor(id) {
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      const monitor = monitors[id];
      
      if (!monitor) return;
      
      currentEditId = id;
      currentSelectors = monitor.selectors || [];
      
      document.getElementById('editName').value = monitor.name || '';
      document.getElementById('editUrl').value = monitor.url || '';
      document.getElementById('editInterval').value = monitor.interval || 30;
      document.getElementById('editWebhook').value = monitor.webhookUrl || '';
      document.getElementById('editAudio').checked = monitor.audioEnabled !== false;
      document.getElementById('editPopup').checked = monitor.popupEnabled !== false;
      
      updateIntervalDisplay(monitor.interval || 30);
      updateSelectorPreview();
      
      // Switch to edit tab
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="edit"]').classList.add('active');
      contents.monitors.style.display = 'none';
      contents.edit.style.display = 'block';
      contents.edit.classList.add('active');
      contents.options.style.display = 'none';
    });
  }

  // Delete monitor
  function deleteMonitor(id) {
    if (!confirm('Delete this monitor?')) return;
    
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      delete monitors[id];
      chrome.storage.local.set({ monitors }, () => {
        chrome.runtime.sendMessage({ action: 'updateMonitors' });
        loadMonitors();
      });
    });
  }

  // Check monitor now
  function checkMonitor(id) {
    chrome.runtime.sendMessage({ action: 'checkNow', id }, (response) => {
      showToast(response?.success ? 'Checking...' : 'Error checking monitor');
    });
  }

  // Update selector preview
  function updateSelectorPreview() {
    const preview = document.getElementById('selectorPreview');
    
    if (currentSelectors.length === 0) {
      preview.innerHTML = '<div style="color: #888; text-align: center;">No selectors defined</div>';
      return;
    }
    
    preview.innerHTML = currentSelectors.map((sel, i) => `
      <div class="selector-item">
        <span class="selector-text">${escapeHtml(sel.selector)} (${sel.type})</span>
        <span class="selector-remove" data-index="${i}">✕</span>
      </div>
    `).join('');
    
    preview.querySelectorAll('.selector-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentSelectors.splice(parseInt(e.target.dataset.index), 1);
        updateSelectorPreview();
      });
    });
  }

  // Format interval for display
  function formatInterval(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }

  // Update interval display
  function updateIntervalDisplay(value) {
    const display = document.getElementById('intervalValue');
    if (value < 60) {
      display.textContent = `${value} seconds`;
    } else if (value < 3600) {
      display.textContent = `${Math.round(value / 60)} minutes`;
    } else if (value < 86400) {
      display.textContent = `${Math.round(value / 3600)} hours`;
    } else {
      display.textContent = `${Math.round(value / 86400)} days`;
    }
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Show toast message
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // Select elements button
  document.getElementById('selectElements').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'startSelecting' }, (response) => {
          if (chrome.runtime.lastError) {
            showToast('Please refresh the page first');
            return;
          }
          window.close();
        });
      }
    });
  });

  // Pick selectors button (in edit form)
  document.getElementById('pickSelectors').addEventListener('click', () => {
    const url = document.getElementById('editUrl').value;
    if (!url) {
      showToast('Please enter a URL first');
      return;
    }
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Navigate to URL if different
        if (tabs[0].url !== url) {
          chrome.tabs.update(tabs[0].id, { url }, () => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'startSelecting' });
              window.close();
            }, 2000);
          });
        } else {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'startSelecting' });
          window.close();
        }
      }
    });
  });

  // Interval slider change
  document.getElementById('editInterval').addEventListener('input', (e) => {
    updateIntervalDisplay(parseInt(e.target.value));
  });

  // Cancel edit
  document.getElementById('cancelEdit').addEventListener('click', () => {
    currentEditId = null;
    currentSelectors = [];
    
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="monitors"]').classList.add('active');
    contents.monitors.style.display = 'block';
    contents.edit.style.display = 'none';
    contents.options.style.display = 'none';
  });

  // Save edit
  document.getElementById('saveEdit').addEventListener('click', () => {
    const name = document.getElementById('editName').value.trim();
    const url = document.getElementById('editUrl').value.trim();
    const interval = parseInt(document.getElementById('editInterval').value);
    const webhookUrl = document.getElementById('editWebhook').value.trim();
    const audioEnabled = document.getElementById('editAudio').checked;
    const popupEnabled = document.getElementById('editPopup').checked;
    
    if (!url) {
      showToast('Please enter a URL');
      return;
    }
    
    const monitor = {
      name: name || new URL(url).hostname,
      url,
      selectors: currentSelectors,
      interval,
      webhookUrl,
      audioEnabled,
      popupEnabled,
      enabled: true,
      lastCheck: null,
      lastContent: null
    };
    
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      const id = currentEditId || Date.now().toString();
      monitors[id] = monitor;
      
      chrome.storage.local.set({ monitors }, () => {
        chrome.runtime.sendMessage({ action: 'updateMonitors' });
        currentEditId = null;
        currentSelectors = [];
        
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="monitors"]').classList.add('active');
        contents.monitors.style.display = 'block';
        contents.edit.style.display = 'none';
        contents.options.style.display = 'none';
        
        loadMonitors();
        showToast('Monitor saved!');
      });
    });
  });

  // Save settings
  document.getElementById('saveSettings').addEventListener('click', () => {
    const settings = {
      defaultWebhook: document.getElementById('defaultWebhook').value.trim(),
      defaultInterval: parseInt(document.getElementById('defaultInterval').value),
      defaultAudio: document.getElementById('defaultAudio').checked,
      defaultPopup: document.getElementById('defaultPopup').checked
    };
    
    chrome.storage.local.set({ settings }, () => {
      showToast('Settings saved!');
    });
  });

  // Load settings
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    document.getElementById('defaultWebhook').value = settings.defaultWebhook || DEFAULT_WEBHOOK_URL;
    document.getElementById('defaultInterval').value = settings.defaultInterval || 30;
    document.getElementById('defaultAudio').checked = settings.defaultAudio !== false;
    document.getElementById('defaultPopup').checked = settings.defaultPopup !== false;
  });

  // Export monitors
  document.getElementById('exportMonitors').addEventListener('click', () => {
    chrome.storage.local.get(['monitors', 'settings'], (result) => {
      const exportData = {
        monitors: result.monitors || {},
        settings: result.settings || {},
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `webpage-monitors-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      showToast('Monitors exported!');
    });
  });

  // Import monitors
  document.getElementById('importMonitors').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);
        
        if (!importData.monitors) {
          showToast('Invalid backup file');
          return;
        }
        
        // Ask user whether to merge or replace
        const monitorCount = Object.keys(importData.monitors).length;
        if (confirm(`Import ${monitorCount} monitor(s)?\n\nClick OK to add to existing monitors.\nThis will not delete your current monitors.`)) {
          chrome.storage.local.get(['monitors'], (result) => {
            const existingMonitors = result.monitors || {};
            const mergedMonitors = { ...existingMonitors, ...importData.monitors };
            
            chrome.storage.local.set({ 
              monitors: mergedMonitors,
              settings: importData.settings || {}
            }, () => {
              chrome.runtime.sendMessage({ action: 'updateMonitors' });
              loadMonitors();
              showToast(`Imported ${monitorCount} monitor(s)!`);
            });
          });
        }
      } catch (err) {
        showToast('Error reading file');
        console.error('Import error:', err);
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    e.target.value = '';
  });

  // Refresh all button
  document.getElementById('refreshAll').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'checkAll' }, () => {
      showToast('Checking all monitors...');
    });
  });

  // Toggle all monitors on/off
  document.getElementById('toggleAll').addEventListener('click', () => {
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      const monitorIds = Object.keys(monitors);
      
      if (monitorIds.length === 0) {
        showToast('No monitors to toggle');
        return;
      }
      
      // Check if any are enabled
      const anyEnabled = monitorIds.some(id => monitors[id].enabled);
      
      // Toggle all to opposite state
      monitorIds.forEach(id => {
        monitors[id].enabled = !anyEnabled;
      });
      
      chrome.storage.local.set({ monitors }, () => {
        chrome.runtime.sendMessage({ action: 'updateMonitors' });
        loadMonitors();
        updateToggleButton(!anyEnabled);
        showToast(anyEnabled ? 'All monitors paused' : 'All monitors resumed');
      });
    });
  });

  // Update toggle button appearance
  function updateToggleButton(anyEnabled) {
    const btn = document.getElementById('toggleAll');
    if (anyEnabled) {
      btn.textContent = '⏸️';
      btn.title = 'Pause all monitors';
    } else {
      btn.textContent = '▶️';
      btn.title = 'Resume all monitors';
    }
  }

  // Check toggle state on load
  function checkToggleState() {
    chrome.storage.local.get(['monitors'], (result) => {
      const monitors = result.monitors || {};
      const anyEnabled = Object.values(monitors).some(m => m.enabled);
      updateToggleButton(anyEnabled);
    });
  }

  // Listen for selector saves from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'selectorsReady') {
      currentEditId = null;
      currentSelectors = message.selectors || [];
      document.getElementById('editUrl').value = message.url || '';
      document.getElementById('editName').value = message.name || new URL(message.url).hostname;
      
      updateSelectorPreview();
      
      // Switch to edit tab
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="edit"]').classList.add('active');
      contents.monitors.style.display = 'none';
      contents.edit.style.display = 'block';
      contents.edit.classList.add('active');
      contents.options.style.display = 'none';
      
      sendResponse({ success: true });
    }
    return true;
  });

  // Initial load
  loadMonitors();
  checkPendingMonitor();
  checkToggleState();
  checkForUpdate();
  
  // Auto-refresh monitors every 2 seconds to show status changes
  setInterval(loadMonitors, 2000);
  
  // Check for available update
  function checkForUpdate() {
    chrome.storage.local.get(['updateAvailable'], (result) => {
      if (result.updateAvailable) {
        const updateBtn = document.getElementById('updateBtn');
        updateBtn.style.display = 'inline-block';
        updateBtn.title = `Update to v${result.updateAvailable.version}`;
      }
    });
  }
  
  // Update button click
  document.getElementById('updateBtn').addEventListener('click', () => {
    chrome.storage.local.get(['updateAvailable'], (result) => {
      if (result.updateAvailable && result.updateAvailable.downloadUrl) {
        chrome.tabs.create({ url: result.updateAvailable.downloadUrl });
      } else {
        chrome.tabs.create({ url: 'chrome://extensions/' });
      }
    });
  });
});
