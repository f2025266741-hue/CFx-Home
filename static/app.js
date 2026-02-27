let STATE = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user')),
    theme: localStorage.getItem('theme') || 'dark',
    socket: null,
    currentPortal: '3',
    targetAdminId: null,
    availableAdmins: []
};

const dom = {
    entryGate: document.getElementById('entry-gate'),
    dashboard: document.getElementById('dashboard'),
    adminGateBtn: document.getElementById('btn-admin-gate'),
    userGateBtn: document.getElementById('btn-user-gate'),
    adminForm: document.getElementById('admin-form'),
    userForm: document.getElementById('user-form'),
    loginAdminBtn: document.getElementById('login-admin-btn'),
    loginUserBtn: document.getElementById('login-user-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    messages: document.getElementById('messages'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    displayRole: document.getElementById('display-role'),
    displayName: document.getElementById('display-name'),
    navItems: document.querySelectorAll('.nav-item'),
    portalTitle: document.getElementById('portal-title'),
    adminControls: document.getElementById('admin-controls'),
    announcementList: document.getElementById('announcement-list'),
    linkList: document.getElementById('link-list'),
    toggleAvailability: document.getElementById('toggle-availability'),
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleEntry: document.getElementById('theme-toggle-entry'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalContent: document.getElementById('modal-content'),
    modalSave: document.getElementById('modal-save'),
    modalClose: document.getElementById('modal-close')
};

// --- Entry Logic ---

dom.adminGateBtn.onclick = () => {
    dom.adminGateBtn.classList.add('active');
    dom.userGateBtn.classList.remove('active');
    dom.adminForm.classList.remove('hidden');
    dom.userForm.classList.add('hidden');
};

dom.userGateBtn.onclick = () => {
    dom.userGateBtn.classList.add('active');
    dom.adminGateBtn.classList.remove('active');
    dom.userForm.classList.remove('hidden');
    dom.adminForm.classList.add('hidden');
};

function toggleTheme() {
    STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', STATE.theme);
    localStorage.setItem('theme', STATE.theme);
}

dom.themeToggle.onclick = toggleTheme;
dom.themeToggleEntry.onclick = toggleTheme;

// Apply initial theme
document.body.setAttribute('data-theme', STATE.theme);

async function login(role, data) {
    try {
        const resp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, ...data })
        });
        if (!resp.ok) throw new Error(await resp.text());
        const result = await resp.json();
        STATE.token = result.access_token;
        STATE.user = result.user;
        localStorage.setItem('token', STATE.token);
        localStorage.setItem('user', JSON.stringify(STATE.user));
        initDashboard();
    } catch (err) {
        alert("Login failed: " + err.message);
    }
}

dom.loginAdminBtn.onclick = () => {
    const slot = document.getElementById('admin-slot').value;
    const password = document.getElementById('admin-password').value;
    login('Admin', { slot: parseInt(slot), password });
};

dom.loginUserBtn.onclick = () => {
    const real_name = document.getElementById('user-name').value;
    const code = document.getElementById('user-code').value;
    login('User', { real_name, code });
};

dom.logoutBtn.onclick = () => {
    localStorage.clear();
    location.reload();
};

// --- Dashboard Logic ---

function initDashboard() {
    dom.entryGate.classList.add('hidden');
    dom.dashboard.classList.remove('hidden');

    dom.displayRole.innerText = STATE.user.role;
    dom.displayName.innerText = STATE.user.real_name;

    // Show/Hide based on role
    if (STATE.user.role === 'Admin') {
        dom.adminControls.classList.remove('hidden');
        document.getElementById('nav-portal1').classList.remove('hidden');
        document.getElementById('nav-portal4').classList.remove('hidden');
    } else if (STATE.user.role === 'Agent') {
        document.getElementById('nav-portal4').classList.remove('hidden');
        // Agents cannot see 1, 2, 3 as per specs? 
        // Spec: "Agents cannot see Portals 1, 2, or 3."
        document.getElementById('nav-portal2').classList.add('hidden');
        document.querySelector('[data-portal="3"]').classList.add('hidden');
        switchPortal('4');
    }

    initWebSocket();
    fetchResources();
}

function initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    STATE.socket = new WebSocket(`${protocol}//${location.host}/ws/${STATE.token}`);

    STATE.socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.portal === STATE.currentPortal) {
            renderMessage(msg);
        }
    };

    STATE.socket.onclose = () => {
        console.log("Socket closed");
    };
}

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMe = msg.sender === STATE.user.real_name || msg.sender === STATE.user.alias;
    div.className = `message ${isMe ? 'sent' : 'received'}`;

    const roleClass = msg.sender.includes('Admin') ? 'admin-badge' : (msg.icon ? 'agent-badge' : 'user-badge');
    const icon = msg.icon || '';

    div.innerHTML = `
        <span class="sender-name ${roleClass}">${icon} ${msg.sender}</span>
        <div class="content">${msg.content}</div>
    `;
    dom.messages.appendChild(div);
    dom.messages.scrollTop = dom.messages.scrollHeight;
}

dom.sendBtn.onclick = sendMessage;
dom.messageInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

function sendMessage() {
    const content = dom.messageInput.value.trim();
    if (!content) return;

    const msg = {
        portal: STATE.currentPortal,
        content: content
    };

    if (STATE.currentPortal === '2' && STATE.targetAdminId) {
        msg.target_id = STATE.targetAdminId;
    }

    STATE.socket.send(JSON.stringify(msg));
    dom.messageInput.value = '';
}

// --- Navigation ---

dom.navItems.forEach(item => {
    item.onclick = () => {
        dom.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        switchPortal(item.dataset.portal);
    };
});

function switchPortal(portalId) {
    STATE.currentPortal = portalId;
    dom.messages.innerHTML = '';

    const titles = {
        '1': 'Portal 1: Core Admin',
        '2': 'Portal 2: Direct Comms',
        '3': 'Portal 3: Public Void',
        '4': 'Portal 4: Agent Ops'
    };
    const descs = {
        '1': 'Exclusive channel for administrators only.',
        '2': 'Private interaction with active administrators.',
        '3': 'Anonymous peer-to-peer interaction.',
        '4': 'Confidential channel for Agents and Admins.'
    };

    dom.portalTitle.innerText = titles[portalId];
    document.getElementById('portal-desc').innerText = descs[portalId];

    if (portalId === '2' && STATE.user.role !== 'Admin') {
        showAdminSelection();
    }
}

async function showAdminSelection() {
    const resp = await fetch('/api/admins/status');
    const admins = await resp.json();
    const available = admins.filter(a => a.is_available);

    if (available.length === 0) {
        dom.messages.innerHTML = '<div class="list-item">No admins are currently available for private chat.</div>';
        return;
    }

    dom.messages.innerHTML = '<h3>Select an Admin to start chatting:</h3>';
    available.forEach(a => {
        const btn = document.createElement('button');
        btn.className = 'primary-btn';
        btn.style.margin = '10px 0';
        btn.innerText = `Connect with Admin ${a.slot}`;
        btn.onclick = () => {
            STATE.targetAdminId = `admin_${a.slot}`; // This is a placeholder, real logic needs to mapping
            // In our simplified backend, we'd need the actual user_id of the admin.
            // For this demo, let's assume we can broadcast to "all admins" or specific ones.
            dom.messages.innerHTML = `<div class="list-item">Connected to Admin ${a.slot}. Start typing below.</div>`;
        };
        dom.messages.appendChild(btn);
    });
}

// --- Admin Resources ---

async function fetchResources() {
    const [linksResp, annResp] = await Promise.all([
        fetch('/api/links'),
        fetch('/api/announcements')
    ]);

    const links = await linksResp.json();
    dom.linkList.innerHTML = links.map(l => `
        <div class="list-item">
            <a href="${l.url}" target="_blank">${l.title}</a>
            <p>${l.description || ''}</p>
        </div>
    `).join('');

    const ann = await annResp.json();
    dom.announcementList.innerHTML = ann.map(a => `
        <div class="list-item">
            <p>${a.content}</p>
            <small>${new Date(a.created_at).toLocaleString()}</small>
        </div>
    `).join('');
}

// Admin Tools Events
document.getElementById('btn-link-store').onclick = () => showModal('Link Store', 'link');
document.getElementById('btn-announcements').onclick = () => showModal('New Announcement', 'ann');
document.getElementById('btn-change-pw').onclick = () => showModal('Change Password', 'pw');

function showModal(title, type) {
    dom.modalTitle.innerText = title;
    dom.modalOverlay.classList.remove('hidden');

    if (type === 'link') {
        dom.modalContent.innerHTML = `
            <input type="text" id="m-link-title" placeholder="Title">
            <input type="text" id="m-link-url" placeholder="URL">
            <textarea id="m-link-desc" placeholder="Description"></textarea>
        `;
        dom.modalSave.onclick = async () => {
            await fetch('/api/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: document.getElementById('m-link-title').value,
                    url: document.getElementById('m-link-url').value,
                    description: document.getElementById('m-link-desc').value
                })
            });
            dom.modalOverlay.classList.add('hidden');
            fetchResources();
        };
    } else if (type === 'ann') {
        dom.modalContent.innerHTML = `<textarea id="m-ann-content" placeholder="Content"></textarea>`;
        dom.modalSave.onclick = async () => {
            await fetch('/api/announcements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: document.getElementById('m-ann-content').value })
            });
            dom.modalOverlay.classList.add('hidden');
            fetchResources();
        };
    } else if (type === 'pw') {
        dom.modalContent.innerHTML = `<input type="password" id="m-new-pw" placeholder="New Shared Password">`;
        dom.modalSave.onclick = async () => {
            await fetch('/api/admins/change-password?new_password=' + document.getElementById('m-new-pw').value, {
                method: 'POST'
            });
            dom.modalOverlay.classList.add('hidden');
        };
    }
}

dom.modalClose.onclick = () => dom.modalOverlay.classList.add('hidden');

dom.toggleAvailability.onchange = async (e) => {
    await fetch(`/api/admins/toggle?slot=${STATE.user.slot}&available=${e.target.checked}`, {
        method: 'POST'
    });
};

// Check for existing session
if (STATE.token) initDashboard();
