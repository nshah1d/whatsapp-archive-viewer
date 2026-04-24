
import { SCAN_TOKEN, MY_NAME } from './config.js';
const DATE_REGEX = /\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?)\]\s*(.*?):\s*(.*)/;
const ATTACHMENT_REGEX = /<attached: (.*?)>/;
const MSG_CHUNK_SIZE = 50;
const MEDIA_CHUNK_SIZE = 30;
const MAX_DOM_MSGS = 200;

let allChats = {};
let currentChatID = null;
let currentTab = 'images';
let globalChatFolders = [];
let globalValidGroups = {};
let globalFolderStats = {};
let globalSidebarEntries = [];
let lastRenderedSourceFolder = null;

let renderState = {
    msgStartIndex: 0,
    msgEndIndex: 0,
    mediaIndex: 0,
    isSearching: false,
    isHistoryView: false
};

const getSafeId = (str) => {
    const bytes = new TextEncoder().encode(str);
    const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
    return btoa(binString).replace(/[^a-zA-Z0-9]/g, '');
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    document.getElementById('contactSearch').addEventListener('input', (e) => filterContacts(e.target.value));

    let timeout = null;
    document.getElementById('msgSearch').addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => handleSearch(e.target.value), 300);
    });

    document.getElementById('messageContainer').addEventListener('scroll', handleMessageScroll);
    document.getElementById('drawerContent').addEventListener('scroll', handleMediaScroll);
});

async function initApp() {
    try {
        const response = await fetch('scan.php', {
            headers: {
                'X-Chronicle-Token': SCAN_TOKEN
            }
        });
        const chatFolders = await response.json();
        globalChatFolders = chatFolders;

        const promises = chatFolders.map(async (chatObj) => {
            const folderName = chatObj.id;
            const fileInventory = chatObj.files;

            const safeFolder = encodeURIComponent(folderName);
            const txtRes = await fetch(`${safeFolder}/_chat.txt`, {
                headers: {
                    'X-Chronicle-Token': SCAN_TOKEN
                }
            });
            if (txtRes.ok) {
                const text = await txtRes.text();
                const parsed = parseChat(text, folderName, fileInventory);

                let timestamp = 0;
                let lastMsg = '';
                let lastDate = '';
                if (parsed.messages.length > 0) {
                    const msg = parsed.messages[parsed.messages.length - 1];
                    timestamp = parseDateString(msg.date, msg.time);
                    lastMsg = msg.text;
                    lastDate = msg.date;
                }

                return {
                    id: folderName,
                    timestamp: timestamp,
                    lastMsg: lastMsg,
                    lastDate: lastDate
                };
            }
            return null;
        });

        const results = await Promise.allSettled(promises);

        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
                globalFolderStats[result.value.id] = result.value;
            }
        });

        const baseMap = {};
        chatFolders.forEach(chatObj => {
            let baseName = chatObj.id;
            let suffix = null;
            const underscoreMatch = chatObj.id.match(/^(.+?)_(\d{2})$/);
            const parenMatch = chatObj.id.match(/^(.+?)\((\d+)\)$/);
            if (underscoreMatch) {
                baseName = underscoreMatch[1];
                suffix = parseInt(underscoreMatch[2], 10);
            } else if (parenMatch) {
                baseName = parenMatch[1];
                suffix = parseInt(parenMatch[2], 10);
            }
            if (!baseMap[baseName]) baseMap[baseName] = [];
            baseMap[baseName].push({ suffix, chatObj });
        });

        const standalones = [];

        for (const baseName in baseMap) {
            const items = baseMap[baseName];
            const numbered = items.filter(i => i.suffix !== null).sort((a, b) => a.suffix - b.suffix);
            const baseEntry = items.find(i => i.suffix === null);

            if (numbered.length < 2) {
                items.forEach(item => standalones.push(item.chatObj));
                continue;
            }

            let isGapless = true;
            for (let i = 1; i < numbered.length; i++) {
                if (numbered[i].suffix !== numbered[i - 1].suffix + 1) {
                    isGapless = false;
                    break;
                }
            }

            if (!isGapless) {
                items.forEach(item => standalones.push(item.chatObj));
                continue;
            }

            const orderedGroup = baseEntry ? [baseEntry, ...numbered] : numbered;
            globalValidGroups[baseName] = orderedGroup.map(item => item.chatObj);
        }

        globalSidebarEntries = [];

        standalones.forEach(chatObj => {
            const stats = globalFolderStats[chatObj.id];
            if (stats) {
                globalSidebarEntries.push({
                    type: 'standalone',
                    id: chatObj.id,
                    timestamp: stats.timestamp,
                    lastMsg: stats.lastMsg
                });
            }
        });

        for (const baseName in globalValidGroups) {
            const groupFoldersList = globalValidGroups[baseName];
            let maxTime = 0;
            let latestMsg = '';
            groupFoldersList.forEach(chatObj => {
                const stats = globalFolderStats[chatObj.id];
                if (stats && stats.timestamp > maxTime) {
                    maxTime = stats.timestamp;
                    latestMsg = stats.lastMsg;
                }
            });
            globalSidebarEntries.push({
                type: 'group',
                id: baseName,
                folders: groupFoldersList,
                timestamp: maxTime,
                lastMsg: latestMsg
            });
        }

        globalSidebarEntries.sort((a, b) => b.timestamp - a.timestamp);
        renderSidebar(globalSidebarEntries);

    } catch (err) {
    }
}

async function loadChat(folderID) {
    currentChatID = folderID;

    if (!allChats[folderID]) {
        const container = document.getElementById('messageContainer');
        container.innerHTML = '<div class="loading-indicator">Loading chat...</div>';

        const chatObj = globalChatFolders.find(c => c.id === folderID);
        if (!chatObj) return;

        const safeFolder = encodeURIComponent(folderID);
        const txtRes = await fetch(`${safeFolder}/_chat.txt`, {
            headers: {
                'X-Chronicle-Token': SCAN_TOKEN
            }
        });
        if (txtRes.ok) {
            const text = await txtRes.text();
            allChats[folderID] = parseChat(text, folderID, chatObj.files);
        } else {
            container.innerHTML = '<div class="loading-indicator">Failed to load chat.</div>';
            return;
        }
    }

    const data = allChats[folderID];
    renderState.isSearching = false;
    renderState.isHistoryView = false;
    lastRenderedSourceFolder = null;

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));

    const safeFolderId = getSafeId(folderID);
    const activeItem = document.getElementById(`chat-item-${safeFolderId}`);
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.getElementById('chatTitle').innerText = folderID;
    document.getElementById('jumpToPresentBtn').style.display = 'none';

    const searchBox = document.getElementById('msgSearch');
    searchBox.style.display = 'block';
    searchBox.value = '';

    currentTab = 'images';
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.classList.remove('active'));
    if(tabs.length > 0) tabs[0].classList.add('active');

    const totalMsgs = data.messages.length;
    renderState.msgEndIndex = totalMsgs;
    renderState.msgStartIndex = Math.max(0, totalMsgs - MSG_CHUNK_SIZE);
    renderState.mediaIndex = 0;

    const container = document.getElementById('messageContainer');
    container.innerHTML = '';
    renderMessageChunk(data.messages.slice(renderState.msgStartIndex, renderState.msgEndIndex), 'bottom');

    container.scrollTop = container.scrollHeight;

    setTimeout(() => {
        renderMediaDrawer(true);
    }, 100);
}

async function loadMergedChat(baseName) {
    const foldersList = globalValidGroups[baseName];
    currentChatID = baseName;

    if (!allChats[baseName]) {
        const container = document.getElementById('messageContainer');
        container.innerHTML = '<div class="loading-indicator">Merging chats...</div>';

        let mergedMessages = [];
        let mergedMedia = { images: [], videos: [], docs: [] };

        for (const f of foldersList) {
            const safeFolder = encodeURIComponent(f.id);
            const txtRes = await fetch(`${safeFolder}/_chat.txt`, {
                headers: { 'X-Chronicle-Token': SCAN_TOKEN }
            });
            if (txtRes.ok) {
                const text = await txtRes.text();
                const parsed = parseChat(text, f.id, f.files);
                parsed.messages.forEach(m => m.sourceFolder = f.id);
                mergedMessages = mergedMessages.concat(parsed.messages);
                mergedMedia.images = mergedMedia.images.concat(parsed.media.images);
                mergedMedia.videos = mergedMedia.videos.concat(parsed.media.videos);
                mergedMedia.docs = mergedMedia.docs.concat(parsed.media.docs);
            }
        }

        mergedMessages.sort((a, b) => {
            const timeA = parseDateString(a.date, a.time);
            const timeB = parseDateString(b.date, b.time);
            if (timeA !== timeB) return timeA - timeB;
            if (a.text < b.text) return -1;
            if (a.text > b.text) return 1;
            return 0;
        });

        const finalMessages = [];
        for (let i = 0; i < mergedMessages.length; i++) {
            const m = mergedMessages[i];
            if (i > 0) {
                const prev = finalMessages[finalMessages.length - 1];
                if (m.date === prev.date && m.time === prev.time && m.sender === prev.sender && m.text === prev.text) {
                    continue;
                }
            }
            finalMessages.push(m);
        }

        finalMessages.forEach((m, idx) => m.originalIndex = idx);

        allChats[baseName] = { messages: finalMessages, media: mergedMedia };
    }

    const data = allChats[baseName];
    renderState.isSearching = false;
    renderState.isHistoryView = false;
    lastRenderedSourceFolder = null;

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));

    const safeFolderId = getSafeId(baseName);
    const activeItem = document.getElementById(`chat-item-${safeFolderId}`);
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.getElementById('chatTitle').innerText = baseName;
    document.getElementById('jumpToPresentBtn').style.display = 'none';

    const searchBox = document.getElementById('msgSearch');
    searchBox.style.display = 'block';
    searchBox.value = '';

    currentTab = 'images';
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.classList.remove('active'));
    if(tabs.length > 0) tabs[0].classList.add('active');

    const totalMsgs = data.messages.length;
    renderState.msgEndIndex = totalMsgs;
    renderState.msgStartIndex = Math.max(0, totalMsgs - MSG_CHUNK_SIZE);
    renderState.mediaIndex = 0;

    const container = document.getElementById('messageContainer');
    container.innerHTML = '';
    renderMessageChunk(data.messages.slice(renderState.msgStartIndex, renderState.msgEndIndex), 'bottom');

    container.scrollTop = container.scrollHeight;

    setTimeout(() => {
        renderMediaDrawer(true);
    }, 100);
}

window.jumpToLatest = () => {
    if (!currentChatID) return;
    if (globalValidGroups[currentChatID]) {
        loadMergedChat(currentChatID);
    } else {
        loadChat(currentChatID);
    }
}

window.jumpToMessage = (index) => {
    if (!currentChatID) return;
    const data = allChats[currentChatID];
    if (!data) return;
    const totalMsgs = data.messages.length;

    renderState.isSearching = false;
    renderState.isHistoryView = true;

    document.getElementById('msgSearch').value = '';

    const windowSize = MSG_CHUNK_SIZE;
    let start = Math.max(0, index - Math.floor(windowSize / 2));
    let end = Math.min(totalMsgs, start + windowSize);

    if (end - start < windowSize && start > 0) {
        start = Math.max(0, end - windowSize);
    }

    renderState.msgStartIndex = start;
    renderState.msgEndIndex = end;

    const container = document.getElementById('messageContainer');
    container.innerHTML = '';

    renderMessageChunk(data.messages.slice(start, end), 'bottom');

    const targetEl = document.getElementById(`msg-${index}`);
    if (targetEl) {
        targetEl.scrollIntoView({ block: 'center', behavior: 'auto' });
        targetEl.classList.add('flash-highlight');
        setTimeout(() => targetEl.classList.remove('flash-highlight'), 2000);
    }

    updateJumpButton();
};

function updateJumpButton() {
    const container = document.getElementById('messageContainer');
    const data = allChats[currentChatID];
    if (!data) return;

    const totalMsgs = data.messages.length;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    const isAtVirtualEnd = renderState.msgEndIndex >= totalMsgs - 20;
    const isAtVisualBottom = distFromBottom < 300;

    if (isAtVirtualEnd && isAtVisualBottom) {
        document.getElementById('jumpToPresentBtn').style.display = 'none';
    } else {
        document.getElementById('jumpToPresentBtn').style.display = 'flex';
    }
}

function handleMessageScroll() {
    if (renderState.isSearching) return;
    if (!currentChatID || !allChats[currentChatID]) return;
    const container = document.getElementById('messageContainer');
    const data = allChats[currentChatID];
    const totalMsgs = data.messages.length;

    if (container.scrollTop === 0 && renderState.msgStartIndex > 0) {
        const currentStart = renderState.msgStartIndex;
        const newStart = Math.max(0, currentStart - MSG_CHUNK_SIZE);
        const chunk = data.messages.slice(newStart, currentStart);

        renderMessageChunk(chunk, 'top');
        renderState.msgStartIndex = newStart;

        pruneDOM('bottom');
    }

    if (container.scrollHeight - container.scrollTop <= container.clientHeight + 100) {
        if (renderState.msgEndIndex < totalMsgs) {
            const currentEnd = renderState.msgEndIndex;
            const newEnd = Math.min(totalMsgs, currentEnd + MSG_CHUNK_SIZE);
            const chunk = data.messages.slice(currentEnd, newEnd);

            renderMessageChunk(chunk, 'bottom');
            renderState.msgEndIndex = newEnd;

            pruneDOM('top');
        }
    }

    updateJumpButton();
}

function pruneDOM(direction) {
    const container = document.getElementById('messageContainer');
    const children = Array.from(container.children);
    const count = children.length;

    if (count <= MAX_DOM_MSGS) return;

    const toRemove = count - MAX_DOM_MSGS;

    if (direction === 'top') {
        let removedHeight = 0;
        let msgCount = 0;
        for (let i = 0; i < toRemove; i++) {
            if (children[i]) {
                removedHeight += children[i].offsetHeight;
                if (children[i].classList.contains('msg')) msgCount++;
                children[i].remove();
            }
        }
        container.scrollTop = Math.max(0, container.scrollTop - removedHeight);
        renderState.msgStartIndex += msgCount;

    } else if (direction === 'bottom') {
        let msgCount = 0;
        for (let i = count - 1; i >= count - toRemove; i--) {
            if (children[i]) {
                if (children[i].classList.contains('msg')) msgCount++;
                children[i].remove();
            }
        }
        renderState.msgEndIndex -= msgCount;
    }
}

function renderMessageChunk(chunk, position) {
    const container = document.getElementById('messageContainer');
    const oldScrollHeight = container.scrollHeight;

    let html = '';
    let lastDate = '';

    chunk.forEach(msg => {
        if (msg.date !== lastDate) {
            html += `<div class="date-divider">${escapeHTML(msg.date)}</div>`;
            lastDate = msg.date;
        }

        if (msg.sourceFolder && lastRenderedSourceFolder !== null && msg.sourceFolder !== lastRenderedSourceFolder) {
            html += `<div class="source-boundary">Continued from: ${escapeHTML(msg.sourceFolder)}</div>`;
        }
        lastRenderedSourceFolder = msg.sourceFolder || null;

        const isMe = msg.sender.includes(MY_NAME);

        let senderColor = isMe ? 'var(--bubble-text-me)' : stringToColor(msg.sender);
        const senderHtml = `<span class="sender-name ${isMe ? 'sender-me' : ''}" style="color:${isMe ? 'inherit' : senderColor}; opacity: ${isMe ? 0.8 : 1}">${escapeHTML(msg.sender)}</span>`;

        html += `
            <div class="msg ${isMe ? 'msg-me' : 'msg-them'}" id="msg-${msg.originalIndex}">
                ${senderHtml}
                ${formatMessageContent(msg)}
                <div class="msg-meta">${msg.time}</div>
            </div>
        `;
    });

    if (position === 'bottom') {
        container.insertAdjacentHTML('beforeend', html);
    } else {
        container.insertAdjacentHTML('afterbegin', html);
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - oldScrollHeight;
    }
}

function handleMediaScroll() {
    const container = document.getElementById('drawerContent');
    if (container.scrollHeight > container.clientHeight && container.scrollHeight - container.scrollTop <= container.clientHeight + 200) {
        renderMediaDrawer(false);
    }
}

function renderMediaDrawer(reset = false) {
    if (!currentChatID) return;
    const media = allChats[currentChatID].media;
    const container = document.getElementById('drawerContent');

    if (reset) {
        container.innerHTML = '';
        renderState.mediaIndex = 0;
        if (currentTab === 'images' || currentTab === 'videos') {
            container.className = 'drawer-content media-grid';
        } else {
            container.className = 'drawer-content doc-list';
        }
    }

    const start = renderState.mediaIndex;
    const end = start + MEDIA_CHUNK_SIZE;
    let targetArray = [];

    if (currentTab === 'images') targetArray = media.images;
    else if (currentTab === 'videos') targetArray = media.videos;
    else targetArray = media.docs;

    if (start >= targetArray.length) return;

    const chunk = targetArray.slice(start, end);
    let html = '';

    chunk.forEach(item => {
        if(item.isMissing) return;

        const safeId = getSafeId(item.filename);

        if (currentTab === 'images') {
            html += `<div class="grid-item">
                        <div class="grid-content">
                            <img src="${item.path}" loading="lazy" onclick="window.open('${item.path}')">
                        </div>
                     </div>`;
        } else if (currentTab === 'videos') {
            html += `<div class="grid-item video-item" id="vid-${safeId}">
                        <div class="grid-content">
                            <video src="${item.path}#t=0.1" preload="metadata" muted playsinline></video>
                            <div class="mini-play-btn" onclick="window.playPreview('${safeId}')">▶</div>
                        </div>
                        <button class="item-menu-btn video-menu-btn" onclick="window.toggleMenu(event, '${safeId}')">⋮</button>
                        <div class="ctx-menu" id="menu-${safeId}" style="display:none;">
                            <button class="ctx-menu-item" onclick="window.openVideo('${item.path}')">Full Screen</button>
                            <button class="ctx-menu-item" onclick="window.downloadFile('${item.path}', '${item.filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">Download</button>
                        </div>
                     </div>`;
        } else {
            html += `<a href="${item.path}" target="_blank" class="doc-card">
                        <div class="doc-icon">${escapeHTML(item.ext)}</div>
                        <span>${escapeHTML(item.filename)}</span>
                     </a>`;
        }
    });

    container.insertAdjacentHTML('beforeend', html);
    renderState.mediaIndex = end;
}

window.playPreview = (id) => {
    const container = document.getElementById(`vid-${id}`);
    if (!container) return;
    const video = container.querySelector('video');
    const btn = container.querySelector('.mini-play-btn');

    if (video.paused) {
        document.querySelectorAll('video').forEach(v => {
            if(v !== video) {
                v.pause();
                v.currentTime = 0;
                if(v.nextElementSibling) v.nextElementSibling.style.display = 'flex';
            }
        });

        video.currentTime = 0;
        video.muted = true;
        video.play().then(() => {
            btn.style.display = 'none';
            setTimeout(() => {
                video.pause();
                video.currentTime = 0;
                btn.style.display = 'flex';
            }, 5000);
        }).catch(e => {});
    } else {
        video.pause();
        btn.style.display = 'flex';
    }
};

window.toggleMenu = (event, id) => {
    if (event) event.stopPropagation();

    const allMenus = document.querySelectorAll('.ctx-menu');
    const targetMenu = document.getElementById(`menu-${id}`);

    allMenus.forEach(m => {
        if(m !== targetMenu) m.style.display = 'none';
    });

    if (targetMenu.style.display === 'none') {
        if (event && event.currentTarget) {
            const btnRect = event.currentTarget.getBoundingClientRect();
            targetMenu.style.top = (btnRect.bottom + 5) + 'px';
            targetMenu.style.right = (window.innerWidth - btnRect.right) + 'px';
            targetMenu.style.left = 'auto';
        }

        targetMenu.style.display = 'block';
        const menuRect = targetMenu.getBoundingClientRect();
        if (menuRect.bottom > window.innerHeight) {
            targetMenu.style.top = (window.innerHeight - menuRect.height) + 'px';
        }
        if (menuRect.left < 0) {
            targetMenu.style.right = (window.innerWidth - menuRect.width) + 'px';
        }
    } else {
        targetMenu.style.display = 'none';
    }
};

window.openVideo = (path) => {
    window.open(path, '_blank');
};

window.downloadFile = (path, name) => {
    const link = document.createElement('a');
    link.href = path;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.switchTab = (el, tab) => {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderMediaDrawer(true);
};

window.toggleMerge = (event, baseName) => {
    event.stopPropagation();
    const key = `chronicle_merge_${baseName}`;
    const isMerged = localStorage.getItem(key) === 'true';
    localStorage.setItem(key, isMerged ? 'false' : 'true');

    if (isMerged) {
        if (allChats[baseName]) {
            delete allChats[baseName];
        }
        if (currentChatID === baseName) {
            document.getElementById('messageContainer').innerHTML = '';
            document.getElementById('chatTitle').innerText = 'Select a Chat';
            currentChatID = null;
        }
    }

    renderSidebar(globalSidebarEntries);
};

function handleSearch(query) {
    if (!currentChatID) return;
    const container = document.getElementById('messageContainer');

    if (!query) {
        renderState.isSearching = false;
        if (globalValidGroups[currentChatID]) {
            loadMergedChat(currentChatID);
        } else {
            loadChat(currentChatID);
        }
        return;
    }

    renderState.isSearching = true;
    container.innerHTML = '<div class="loading-indicator">Searching history...</div>';

    if (!allChats[currentChatID]) return;
    const msgs = allChats[currentChatID].messages;
    const lowerQ = query.toLowerCase();

    const matches = [];
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.text.toLowerCase().includes(lowerQ) || m.sender.toLowerCase().includes(lowerQ)) {
            matches.push(m);
            if (matches.length >= 250) break;
        }
    }

    container.innerHTML = '';
    if (matches.length === 0) {
        container.innerHTML = '<div class="loading-indicator">No matches found.</div>';
        return;
    }

    let html = '';
    matches.forEach(msg => {
        const isMe = msg.sender.includes(MY_NAME);
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        let content = formatMessageContent(msg);

        if (!msg.isMedia) {
            content = content.replace(regex, '<span class="highlight">$1</span>');
        }

        let senderColor = isMe ? 'var(--bubble-text-me)' : stringToColor(msg.sender);
        const senderHtml = `<span class="sender-name ${isMe ? 'sender-me' : ''}" style="color:${isMe ? 'inherit' : senderColor}; opacity: ${isMe ? 0.8 : 1}">${escapeHTML(msg.sender)}</span>`;

        html += `
            <div class="msg ${isMe ? 'msg-me' : 'msg-them'} search-result-item" onclick="window.jumpToMessage(${msg.originalIndex})">
                ${senderHtml}
                ${content}
                <div class="msg-meta">${msg.time} - ${escapeHTML(msg.date)}</div>
            </div>
        `;
    });
    container.innerHTML += html;

    if (matches.length >= 250) {
        const notice = document.createElement('div');
        notice.textContent = 'Only the first 250 matches are shown. Please refine your search.';
        notice.style.padding = '12px';
        notice.style.margin = '16px auto';
        notice.style.textAlign = 'center';
        notice.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        notice.style.color = 'var(--text-secondary)';
        notice.style.borderRadius = '8px';
        notice.style.fontSize = '13px';
        notice.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        notice.style.width = '80%';
        container.appendChild(notice);
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatMessageContent(msg) {
    const safeText = escapeHTML(msg.text);
    const safeCleanText = escapeHTML(msg.cleanText);

    if (!msg.isMedia) return safeText.replace(/\n/g, '<br>');

    if (msg.isMissing) {
        return `
            <div class="media-container">
                <div class="missing-file">
                    <div style="font-size:20px">⚠️</div>
                    <div style="font-weight:bold; font-size:11px; margin-top:4px">MISSING</div>
                    <div style="font-size:9px; opacity:0.7">${escapeHTML(msg.filename)}</div>
                </div>
            </div>
            ${safeCleanText}
        `;
    }

    const fullPath = `${encodeURIComponent(msg.folder)}/${encodeURIComponent(msg.filename)}`;

    if (msg.mediaType === 'image') {
        return `
            <div class="media-container">
                <img src="${fullPath}" loading="lazy" onclick="window.open('${fullPath}')">
            </div>
            ${safeCleanText}
        `;
    }

    if (msg.mediaType === 'video') {
        return `
            <div class="media-container">
                <video controls preload="metadata" src="${fullPath}#t=0.1"></video>
            </div>
             ${safeCleanText}
        `;
    }

    return `
        ${safeCleanText}
        <a href="${fullPath}" target="_blank" class="doc-card">
            <div class="doc-icon">${escapeHTML(msg.filename.split('.').pop())}</div>
            <div style="overflow:hidden; text-overflow:ellipsis;">${escapeHTML(msg.filename)}</div>
        </a>
    `;
}

function parseChat(rawText, folderName, fileInventory) {
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    const messages = [];
    const media = { images: [], videos: [], docs: [] };
    let currentMsg = null;
    let globalIndex = 0;

    lines.forEach(line => {
        const cleanLine = line.replace(/^[​-‏‪-‮\s]+/, '');
        const match = cleanLine.match(DATE_REGEX);

        if (match) {
            if (currentMsg) {
                currentMsg.originalIndex = globalIndex++;
                messages.push(currentMsg);
            }
            const [_, date, time, sender, content] = match;
            currentMsg = {
                date, time, sender: sender.trim(), text: content.trim(), folder: folderName, sourceFolder: folderName, isMedia: false
            };
            checkForMedia(currentMsg, media, fileInventory);
        } else {
            if (currentMsg) {
                currentMsg.text += '\n' + line.trim();
                checkForMedia(currentMsg, media, fileInventory);
            }
        }
    });
    if (currentMsg) {
        currentMsg.originalIndex = globalIndex++;
        messages.push(currentMsg);
    }
    return { messages, media };
}

function checkForMedia(msg, mediaStore, fileInventory) {
    const attachMatch = msg.text.match(ATTACHMENT_REGEX);
    if (attachMatch) {
        msg.isMedia = true;
        msg.filename = attachMatch[1].trim();
        msg.cleanText = msg.text.replace(attachMatch[0], '').trim();

        if (!fileInventory.includes(msg.filename)) {
            msg.isMissing = true;
            return;
        }

        const ext = msg.filename.split('.').pop().toLowerCase();
        const fullPath = `${encodeURIComponent(msg.folder)}/${encodeURIComponent(msg.filename)}`;

        const mediaItem = { path: fullPath, filename: msg.filename, ext: ext, isMissing: false };

        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            msg.mediaType = 'image';
            mediaStore.images.push(mediaItem);
        } else if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
            msg.mediaType = 'video';
            mediaStore.videos.push(mediaItem);
        } else {
            msg.mediaType = 'doc';
            mediaStore.docs.push(mediaItem);
        }
    }
}

function parseDateString(dateStr, timeStr) {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length < 3) return 0;
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    let year = parseInt(parts[2]);
    if (year < 100) year += 2000;
    const timeParts = timeStr.split(':');
    const hour = parseInt(timeParts[0]);
    const min = parseInt(timeParts[1] || 0);
    const sec = parseInt(timeParts[2] || 0);
    return new Date(year, month, day, hour, min, sec).getTime();
}

function renderSidebar(entries) {
    const listContainer = document.getElementById('chatList');
    listContainer.innerHTML = '';
    entries.forEach(entry => {
        if (entry.type === 'standalone') {
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.id = `chat-item-${getSafeId(entry.id)}`;
            div.onclick = () => loadChat(entry.id);
            let preview = entry.lastMsg;
            if (preview.length > 50) preview = preview.substring(0, 50) + '...';
            const stats = globalFolderStats[entry.id];
            const dateStr = stats ? stats.lastDate : '';
            div.innerHTML = `
                <div class="chat-info"><h4>${escapeHTML(entry.id)}</h4><p>${escapeHTML(preview)}</p></div>
                <div style="font-size:11px; color:#666;">${escapeHTML(dateStr)}</div>
            `;
            listContainer.appendChild(div);
        } else if (entry.type === 'group') {
            const isMerged = localStorage.getItem(`chronicle_merge_${entry.id}`) === 'true';

            const groupContainer = document.createElement('div');
            groupContainer.className = 'group-container';

            const headerDiv = document.createElement('div');
            headerDiv.className = `chat-item group-header ${isMerged ? 'clickable' : 'unclickable'}`;
            headerDiv.id = `chat-item-${getSafeId(entry.id)}`;

            if (isMerged) {
                headerDiv.onclick = (e) => {
                    if (e.target.closest('.merge-toggle')) return;
                    loadMergedChat(entry.id);
                };
            }

            let preview = entry.lastMsg;
            if (preview.length > 50) preview = preview.substring(0, 50) + '...';

            const btnHtml = `<button class="merge-toggle ${isMerged ? 'on' : 'off'}" onclick="window.toggleMerge(event, '${escapeHTML(entry.id)}')">${isMerged ? 'Merged' : 'Merge'}</button>`;

            headerDiv.innerHTML = `
                <div class="chat-info" style="width:100%;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <h4 style="margin:0; font-size:15px; color:var(--text-highlight); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(entry.id)}</h4>
                        ${btnHtml}
                    </div>
                    <p style="margin:0; font-size:13px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(preview)}</p>
                </div>
            `;
            groupContainer.appendChild(headerDiv);

            if (!isMerged) {
                const siblingsContainer = document.createElement('div');
                siblingsContainer.className = 'group-siblings';
                entry.folders.forEach(f => {
                    const stats = globalFolderStats[f.id];
                    if (stats) {
                        const siblingDiv = document.createElement('div');
                        siblingDiv.className = 'chat-item sibling-item';
                        siblingDiv.id = `chat-item-${getSafeId(f.id)}`;
                        siblingDiv.onclick = () => loadChat(f.id);
                        let sibPreview = stats.lastMsg;
                        if (sibPreview.length > 50) sibPreview = sibPreview.substring(0, 50) + '...';
                        siblingDiv.innerHTML = `
                            <div class="chat-info"><h4>${escapeHTML(f.id)}</h4><p>${escapeHTML(sibPreview)}</p></div>
                            <div style="font-size:11px; color:#666;">${escapeHTML(stats.lastDate)}</div>
                        `;
                        siblingsContainer.appendChild(siblingDiv);
                    }
                });
                groupContainer.appendChild(siblingsContainer);
            }

            listContainer.appendChild(groupContainer);
        }
    });
}

function filterContacts(query) {
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const h4 = item.querySelector('h4');
        if (h4) {
            const name = h4.innerText.toLowerCase();
            item.style.display = name.includes(query.toLowerCase()) ? 'flex' : 'none';
        }
    });
}

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
}

window.loadChat = loadChat;
window.loadMergedChat = loadMergedChat;
window.resetSearchState = () => { renderState.isSearching = false; };
