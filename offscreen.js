// Offscreen script for playing notification sounds and parsing HTML

// Create audio context for generating notification sounds
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Generate a pleasant notification sound using Web Audio API
function playNotificationBeep() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Create oscillator for the tone
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Pleasant bell-like tone
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now); // A5
    oscillator.frequency.setValueAtTime(1100, now + 0.1); // C#6
    oscillator.frequency.setValueAtTime(880, now + 0.2); // A5
    
    // Envelope for natural sound
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.1, now + 0.15);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    
    oscillator.start(now);
    oscillator.stop(now + 0.4);
    
    // Play a second tone for a more complete sound
    const oscillator2 = ctx.createOscillator();
    const gainNode2 = ctx.createGain();
    
    oscillator2.connect(gainNode2);
    gainNode2.connect(ctx.destination);
    
    oscillator2.type = 'sine';
    oscillator2.frequency.setValueAtTime(1320, now + 0.15); // E6
    
    gainNode2.gain.setValueAtTime(0, now + 0.15);
    gainNode2.gain.linearRampToValueAtTime(0.2, now + 0.17);
    gainNode2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    
    oscillator2.start(now + 0.15);
    oscillator2.stop(now + 0.5);
    
    console.log('Notification sound played');
  } catch (e) {
    console.error('Error playing sound:', e);
  }
}

// Parse HTML with CSS selectors using DOMParser
function parseHTMLWithSelectors(html, selectors) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const parts = [];
    
    for (const sel of selectors) {
      try {
        // Try the full selector first
        let elements = doc.querySelectorAll(sel.selector);
        
        // If no results, try simplifying the selector
        if (elements.length === 0) {
          const simplified = simplifySelector(sel.selector);
          if (simplified !== sel.selector) {
            elements = doc.querySelectorAll(simplified);
            console.log(`Simplified selector "${sel.selector}" to "${simplified}", found ${elements.length} elements`);
          }
        }
        
        elements.forEach(el => {
          let content = '';
          if (sel.type === 'text') {
            content = el.textContent.trim();
          } else if (sel.type === 'html') {
            content = el.innerHTML;
          } else if (sel.type === 'attr' && sel.attribute) {
            content = el.getAttribute(sel.attribute) || '';
          } else {
            content = el.textContent.trim();
          }
          
          if (content) {
            parts.push(content);
          }
        });
      } catch (selectorError) {
        console.error('Selector error:', sel.selector, selectorError);
        // Try to extract with simplified selector
        const simplified = simplifySelector(sel.selector);
        try {
          const elements = doc.querySelectorAll(simplified);
          elements.forEach(el => {
            const content = el.textContent.trim();
            if (content) parts.push(content);
          });
        } catch (e) {
          console.error('Simplified selector also failed:', e);
        }
      }
    }
    
    return parts.join('\n');
  } catch (e) {
    console.error('HTML parsing error:', e);
    return '';
  }
}

// Simplify complex selectors to more basic ones
function simplifySelector(selector) {
  // Remove attribute selectors with complex values
  let simplified = selector.replace(/\[[^\]]*["'][^\]]*\]/g, '');
  
  // Remove :nth-child and similar pseudo-selectors
  simplified = simplified.replace(/:nth-child\([^)]*\)/g, '');
  simplified = simplified.replace(/:first-child|:last-child/g, '');
  
  // Extract the most important parts (tag.class combinations)
  const parts = simplified.split(/\s*>\s*|\s+/);
  const importantParts = parts.filter(p => p.length > 0).slice(-2); // Take last 2 parts
  
  if (importantParts.length > 0) {
    return importantParts.join(' ');
  }
  
  return selector;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'playSound') {
    playNotificationBeep();
    sendResponse({ success: true });
  } else if (message.action === 'parseHTML') {
    const content = parseHTMLWithSelectors(message.html, message.selectors);
    sendResponse({ content: content });
  }
  return true;
});

console.log('Offscreen document ready (audio + HTML parsing)');
