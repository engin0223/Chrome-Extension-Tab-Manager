// Background: simplified. UI (`ui.html`) now provides all merge/split functionality.
// The action just opens the packaged UI in a new tab when clicked.
/**
 * Handles the extension action button click event.
 * Opens the extension's UI page (ui.html) in a new tab when the user clicks
 * the extension icon in the browser toolbar.
 */
chrome.action.onClicked.addListener(async () => {
  const packagedUrl = chrome.runtime.getURL('ui.html');
  // Query to see if the tab is already open
  const tabs = await chrome.tabs.query({ url: packagedUrl });

  if (tabs.length > 0) {
    // If found, update the window and tab to focus it
    const tab = tabs[0];
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    // Otherwise create it
    chrome.tabs.create({ url: packagedUrl });
  }
});
