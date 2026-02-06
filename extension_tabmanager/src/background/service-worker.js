chrome.action.onClicked.addListener(async () => {
  const packagedUrl = chrome.runtime.getURL('src/pages/ui/ui.html');
  const tabs = await chrome.tabs.query({ url: packagedUrl });

  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    chrome.tabs.create({ url: packagedUrl });
  }
});