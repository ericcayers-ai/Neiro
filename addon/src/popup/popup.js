document.getElementById('open').addEventListener('click', async () => {
  const windowId = (await chrome.windows.getCurrent()).id
  const response = await chrome.runtime.sendMessage({
    target: 'background',
    op: 'panel:open',
    windowId,
  })
  if (response?.ok) window.close()
})
