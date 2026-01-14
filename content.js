// Content script for visual element selection
(function() {
  'use strict';

  let isSelecting = false;
  let selectedElements = [];
  let ignoredElements = new Set();
  let highlightedElement = null;
  let selectorPanel = null;
  let currentUrl = window.location.href;

  // Generate a unique CSS selector for an element - SIMPLIFIED VERSION
  function generateSelector(element) {
    // If has ID, use it (simplest and most reliable)
    if (element.id && !element.id.match(/^\d/) && element.id.length < 50) {
      return `#${element.id}`;
    }

    // Try to build a simple, reliable selector
    const tag = element.tagName.toLowerCase();
    
    // Get clean class names (filter out dynamic/generated ones)
    const goodClasses = Array.from(element.classList)
      .filter(c => {
        // Filter out classes that look auto-generated
        if (c.startsWith('wm-')) return false;
        if (c.length > 30) return false;
        if (/^[a-z]{20,}$/.test(c)) return false; // Long random strings
        if (/^[a-zA-Z]+-[a-f0-9]{6,}/.test(c)) return false; // Hash suffixes
        if (/^\d/.test(c)) return false; // Starts with number
        return true;
      })
      .slice(0, 2); // Max 2 classes
    
    // Build selector with tag and classes
    let selector = tag;
    if (goodClasses.length > 0) {
      selector += '.' + goodClasses.join('.');
    }
    
    // Check if this selector is unique enough on the page
    try {
      const matches = document.querySelectorAll(selector);
      if (matches.length === 1) {
        return selector;
      }
    } catch (e) {
      // Invalid selector, continue
    }
    
    // If not unique, try adding parent context
    const parent = element.parentElement;
    if (parent && parent !== document.body) {
      let parentSelector = parent.tagName.toLowerCase();
      
      // Add parent's ID if available
      if (parent.id && !parent.id.match(/^\d/) && parent.id.length < 50) {
        parentSelector = `#${parent.id}`;
      } else {
        // Add parent's most useful class
        const parentClasses = Array.from(parent.classList)
          .filter(c => c.length < 30 && !c.startsWith('wm-') && !/^[a-z]{20,}$/.test(c))
          .slice(0, 1);
        if (parentClasses.length > 0) {
          parentSelector += '.' + parentClasses[0];
        }
      }
      
      const combinedSelector = `${parentSelector} ${selector}`;
      try {
        const combinedMatches = document.querySelectorAll(combinedSelector);
        if (combinedMatches.length >= 1 && combinedMatches.length <= 10) {
          return combinedSelector;
        }
      } catch (e) {
        // Invalid selector
      }
    }
    
    // If still not specific enough, try grandparent
    const grandparent = parent?.parentElement;
    if (grandparent && grandparent !== document.body) {
      let gpSelector = grandparent.tagName.toLowerCase();
      if (grandparent.id && grandparent.id.length < 50) {
        gpSelector = `#${grandparent.id}`;
      } else {
        const gpClasses = Array.from(grandparent.classList)
          .filter(c => c.length < 30 && !/^[a-z]{20,}$/.test(c))
          .slice(0, 1);
        if (gpClasses.length > 0) {
          gpSelector += '.' + gpClasses[0];
        }
      }
      
      return `${gpSelector} ${selector}`;
    }
    
    return selector;
  }

  // Generate a simpler, more readable selector
  function generateSimpleSelector(element) {
    const tag = element.tagName.toLowerCase();
    
    // If has ID, use it
    if (element.id) {
      return `#${element.id}`;
    }

    // Check for useful classes
    const classes = Array.from(element.classList)
      .filter(c => !c.startsWith('wm-') && c.length < 30 && !/^[a-z]{20,}$/.test(c));
    
    if (classes.length > 0) {
      return `${tag}.${classes[0]}`;
    }

    // Check for data attributes
    const dataAttr = Array.from(element.attributes)
      .find(attr => attr.name.startsWith('data-') && attr.value.length < 30);
    
    if (dataAttr) {
      return `${tag}[${dataAttr.name}="${dataAttr.value}"]`;
    }

    // Fall back to tag with parent context
    const parent = element.parentElement;
    if (parent && parent.tagName) {
      const parentTag = parent.tagName.toLowerCase();
      if (parent.classList.length > 0) {
        return `${parentTag}.${parent.classList[0]} ${tag}`;
      }
      return `${parentTag} ${tag}`;
    }

    return tag;
  }

  // Create the selector panel UI
  function createSelectorPanel() {
    if (selectorPanel) return;

    selectorPanel = document.createElement('div');
    selectorPanel.id = 'wm-selector-panel';
    selectorPanel.innerHTML = `
      <div class="wm-panel-header">
        <div class="wm-select-btn active">
          <span class="wm-icon">☰</span> Select elements
        </div>
        <div class="wm-save-btn">
          <span class="wm-icon">💾</span> Save selections
        </div>
        <div class="wm-close-btn">✕</div>
      </div>
      <div class="wm-panel-info">
        Select one or more elements on the page to monitor for changes. Ignore a child element by clicking on the element within a selection. Ignored elements are shown in a red box.
      </div>
      <div class="wm-panel-sections">
        <div class="wm-section">
          <div class="wm-section-header">
            <span class="wm-expand">▼</span> Page options
          </div>
        </div>
        <div class="wm-section">
          <div class="wm-section-header">
            <span class="wm-selected-indicator">●</span> Selected <span class="wm-selected-count">0</span>
            <span class="wm-frame-info">frame: 0</span>
          </div>
          <div class="wm-selected-list"></div>
        </div>
        <div class="wm-section">
          <div class="wm-section-header">
            <span class="wm-deselected-indicator">●</span> Deselected <span class="wm-deselected-count">0</span>
            <span class="wm-frame-info">frame: 0</span>
          </div>
        </div>
      </div>
      <div class="wm-panel-preview">
        <div class="wm-preview-header">Preview</div>
        <div class="wm-preview-content"></div>
      </div>
      <div class="wm-panel-footer">
        <div class="wm-regex-filter">
          <span class="wm-expand">▶</span> Regex Text Filter - <span class="wm-regex-value">&lt;not set&gt;</span>
        </div>
      </div>
      <div class="wm-url-bar">${currentUrl}</div>
    `;

    document.body.appendChild(selectorPanel);

    // Event listeners
    selectorPanel.querySelector('.wm-close-btn').addEventListener('click', stopSelecting);
    selectorPanel.querySelector('.wm-save-btn').addEventListener('click', saveSelections);
    selectorPanel.querySelector('.wm-select-btn').addEventListener('click', () => {
      isSelecting = true;
      selectorPanel.querySelector('.wm-select-btn').classList.add('active');
    });
  }

  // Update the selected elements list in the panel
  function updateSelectedList() {
    if (!selectorPanel) return;

    const listContainer = selectorPanel.querySelector('.wm-selected-list');
    const countSpan = selectorPanel.querySelector('.wm-selected-count');
    const previewContent = selectorPanel.querySelector('.wm-preview-content');

    countSpan.textContent = selectedElements.length;
    listContainer.innerHTML = '';
    previewContent.innerHTML = '';

    selectedElements.forEach((item, index) => {
      // Add to list
      const row = document.createElement('div');
      row.className = 'wm-selector-row';
      row.innerHTML = `
        <span class="wm-selector-label">CSS Selector</span>
        <input type="text" class="wm-selector-input" value="${item.selector}" data-index="${index}">
        <span class="wm-element-count">1 element</span>
        <select class="wm-extract-type">
          <option value="text" ${item.type === 'text' ? 'selected' : ''}>text</option>
          <option value="html" ${item.type === 'html' ? 'selected' : ''}>html</option>
          <option value="attr" ${item.type === 'attr' ? 'selected' : ''}>attribute</option>
        </select>
        <button class="wm-remove-btn" data-index="${index}">✕</button>
      `;
      listContainer.appendChild(row);

      // Add to preview
      const previewItem = document.createElement('div');
      previewItem.className = 'wm-preview-item';
      previewItem.textContent = item.element.textContent.trim().substring(0, 100);
      previewContent.appendChild(previewItem);

      // Event listeners for row
      row.querySelector('.wm-selector-input').addEventListener('change', (e) => {
        selectedElements[index].selector = e.target.value;
      });
      row.querySelector('.wm-extract-type').addEventListener('change', (e) => {
        selectedElements[index].type = e.target.value;
      });
      row.querySelector('.wm-remove-btn').addEventListener('click', () => {
        removeSelection(index);
      });
    });
  }

  // Highlight element on hover
  function highlightElement(element) {
    if (!isSelecting || !element || element === selectorPanel || selectorPanel?.contains(element)) {
      return;
    }

    // Remove previous highlight
    if (highlightedElement) {
      highlightedElement.classList.remove('wm-highlight');
    }

    // Add highlight to new element
    element.classList.add('wm-highlight');
    highlightedElement = element;

    // Show tooltip with selector
    showSelectorTooltip(element);
  }

  // Show tooltip with CSS selector info
  function showSelectorTooltip(element) {
    let tooltip = document.getElementById('wm-selector-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'wm-selector-tooltip';
      document.body.appendChild(tooltip);
    }

    const selector = generateSimpleSelector(element);
    const classes = Array.from(element.classList)
      .filter(c => !c.startsWith('wm-'))
      .join('.');
    
    tooltip.innerHTML = `
      <div class="wm-tooltip-tag">${element.tagName.toLowerCase()}${classes ? '.' + classes : ''}</div>
    `;

    const rect = element.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 25}px`;
    tooltip.style.display = 'block';
  }

  // Hide tooltip
  function hideSelectorTooltip() {
    const tooltip = document.getElementById('wm-selector-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  // Select an element
  function selectElement(element) {
    if (!element || element === selectorPanel || selectorPanel?.contains(element)) {
      return;
    }

    // Check if already selected
    const existingIndex = selectedElements.findIndex(item => item.element === element);
    if (existingIndex !== -1) {
      // Already selected - maybe ignore as child?
      return;
    }

    const selector = generateSelector(element);
    
    selectedElements.push({
      element: element,
      selector: selector,
      type: 'text'
    });

    // Add visual indicator
    element.classList.add('wm-selected');

    updateSelectedList();
  }

  // Remove a selection
  function removeSelection(index) {
    const item = selectedElements[index];
    if (item && item.element) {
      item.element.classList.remove('wm-selected');
    }
    selectedElements.splice(index, 1);
    updateSelectedList();
  }

  // Save selections and send to extension
  function saveSelections() {
    const selectorsData = selectedElements.map(item => ({
      selector: item.selector,
      type: item.type,
      preview: item.element.textContent.trim().substring(0, 200)
    }));

    // Store directly in chrome.storage for popup to retrieve
    const pendingMonitor = {
      url: currentUrl,
      name: document.title || new URL(currentUrl).hostname,
      selectors: selectorsData,
      timestamp: Date.now()
    };

    chrome.storage.local.set({ pendingMonitor }, () => {
      // Also send message to background
      chrome.runtime.sendMessage({
        action: 'saveSelectors',
        url: currentUrl,
        selectors: selectorsData
      }, (response) => {
        stopSelecting();
        alert('Selections saved! Open the extension popup to configure monitoring options.');
      });
    });
  }

  // Start element selection mode
  function startSelecting() {
    isSelecting = true;
    selectedElements = [];
    ignoredElements.clear();
    
    createSelectorPanel();
    
    document.body.classList.add('wm-selecting-mode');
  }

  // Stop element selection mode
  function stopSelecting() {
    isSelecting = false;
    
    // Remove all highlights and selections
    document.querySelectorAll('.wm-highlight, .wm-selected').forEach(el => {
      el.classList.remove('wm-highlight', 'wm-selected');
    });
    
    // Remove panel and tooltip
    if (selectorPanel) {
      selectorPanel.remove();
      selectorPanel = null;
    }
    
    const tooltip = document.getElementById('wm-selector-tooltip');
    if (tooltip) tooltip.remove();
    
    document.body.classList.remove('wm-selecting-mode');
    
    selectedElements = [];
    highlightedElement = null;
  }

  // Event listeners
  document.addEventListener('mouseover', (e) => {
    if (isSelecting) {
      highlightElement(e.target);
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (isSelecting && highlightedElement === e.target) {
      e.target.classList.remove('wm-highlight');
      hideSelectorTooltip();
    }
  });

  document.addEventListener('click', (e) => {
    if (isSelecting) {
      // Don't interfere with panel clicks
      if (selectorPanel && selectorPanel.contains(e.target)) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      selectElement(e.target);
    }
  }, true);

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startSelecting') {
      startSelecting();
      sendResponse({ success: true });
    } else if (message.action === 'stopSelecting') {
      stopSelecting();
      sendResponse({ success: true });
    } else if (message.action === 'getPageContent') {
      // Get content based on selectors
      const selectors = message.selectors || [];
      const content = [];
      
      selectors.forEach(sel => {
        const elements = document.querySelectorAll(sel.selector);
        elements.forEach(el => {
          if (sel.type === 'text') {
            content.push(el.textContent.trim());
          } else if (sel.type === 'html') {
            content.push(el.innerHTML);
          } else if (sel.type === 'attr' && sel.attribute) {
            content.push(el.getAttribute(sel.attribute) || '');
          }
        });
      });
      
      sendResponse({ content: content.join('\n') });
    }
    return true;
  });

})();
