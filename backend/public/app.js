class FPVueDeviceManager {
    constructor() {
        this.devices = [];
        this.sessions = [];
        this.startLineState = null;
        this.loadingStartLine = false;
        this.serverTimeOffset = 0;
        this.currentEditingDevice = null;
        this.currentViewingSession = null;
        this.supabaseClient = null;
        this.currentSession = null;
        this.serverSession = null;
        this.userGroups = [];
        this.rbacUnsubscribe = null;
        this.autoRefreshInterval = null;
        this.sessionTimerInterval = null;
        this.startLineInterval = null;
        this.init();
    }

    init() {
        // Only setup UI listeners and authentication on init
        // Don't load data until authenticated
        this.setupEventListeners();
        this.setupModal();
        this.setupSessionModal();
        this.setupChannelModal();
        this.setupDisplayModeModal();
        this.setupStartSessionModal();
        this.setupStartLineControls();
        this.initializeAuthentication();
    }

    startAutoRefresh() {
        // Start auto-refresh intervals only after authentication
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
        }
        if (this.startLineInterval) {
            clearInterval(this.startLineInterval);
        }

        // Auto-refresh every 10 seconds for real-time status updates
        this.autoRefreshInterval = setInterval(() => {
            this.loadDevices();
            this.loadSessions();
        }, 10000);

        // Update session timers every second
        this.sessionTimerInterval = setInterval(() => {
            this.updateSessionTimers();
        }, 1000);

        // Refresh start line state once per second
        this.startLineInterval = setInterval(() => {
            this.loadStartLineState(false);
        }, 1000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
            this.sessionTimerInterval = null;
        }
        if (this.startLineInterval) {
            clearInterval(this.startLineInterval);
            this.startLineInterval = null;
        }
    }

    async initializeAuthentication() {
        try {
            // Load public configuration including Supabase credentials
            const config = await this.loadPublicConfig();
            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                this.showError('Authentication system not configured');
                return;
            }

            // Initialize Supabase client
            if (typeof window.supabase !== 'undefined') {
                this.supabaseClient = window.supabase.createClient(config.supabase.url, config.supabase.anonKey);

                if (window.FPVRBAC) {
                    window.FPVRBAC.setSupabaseClient(this.supabaseClient);
                    if (this.rbacUnsubscribe) {
                        this.rbacUnsubscribe();
                    }
                    this.rbacUnsubscribe = window.FPVRBAC.onChange(({ groups, serverSession }) => {
                        this.userGroups = groups || [];
                        this.serverSession = serverSession || null;
                        if (serverSession?.user) {
                            this.updateAuthUI(serverSession.user);
                        }
                        this.applyGroupVisibility();
                    });
                }

                // Check for existing session
                const { data } = await this.supabaseClient.auth.getSession();
                await this.handleAuthStateChange(data?.session ?? null);

                // Listen for auth state changes
                this.supabaseClient.auth.onAuthStateChange(async (_event, session) => {
                    await this.handleAuthStateChange(session ?? null);
                });
            } else {
                this.showError('Supabase library not loaded');
            }
        } catch (err) {
            console.error('Failed to initialize authentication:', err);
            this.showError('Failed to initialize authentication system');
        }
    }

    async loadPublicConfig() {
        const response = await fetch('/api/public-config');
        if (!response.ok) {
            throw new Error('Failed to load public configuration');
        }
        return response.json();
    }

    async authenticatedRequest(url, options = {}) {
        if (!this.currentSession?.access_token) {
            throw new Error('Authentication required');
        }
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${this.currentSession.access_token}`
        };
        const response = await fetch(url, { ...options, headers });
        const payload = await this.safeParseJson(response);
        if (!response.ok) {
            const message = payload?.error || response.statusText || 'Request failed';
            throw new Error(message);
        }
        return payload ?? {};
    }

    async safeParseJson(response) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }

    async handleAuthStateChange(session) {
        this.currentSession = session;
        const isAuthenticated = !!session;

        // Toggle UI visibility based on authentication state
        const loginCard = document.getElementById('dashboard-auth-card');
        const dashboardContent = document.getElementById('dashboard-content');

        if (loginCard && dashboardContent) {
            if (isAuthenticated) {
                loginCard.classList.add('hidden');
                dashboardContent.classList.remove('hidden');
                this.updateAuthUI(session.user);
                await this.syncServerSession(session);
                this.loadAdminPilotData();
                this.onAuthenticated();
            } else {
                loginCard.classList.remove('hidden');
                dashboardContent.classList.add('hidden');
                this.resetAuthUI();
                if (window.FPVRBAC) {
                    window.FPVRBAC.clearSession();
                }
                
                // Stop auto-refresh when logged out
                this.stopAutoRefresh();
                
                // Clear data
                this.devices = [];
                this.sessions = [];
                this.startLineState = null;
            }
        }
    }

    updateAuthUI(user) {
        const userEmailElement = document.getElementById('dashboard-user-email');
        if (userEmailElement && user?.email) {
            userEmailElement.textContent = user.email;
        }
    }

    resetAuthUI() {
        const userEmailElement = document.getElementById('dashboard-user-email');
        if (userEmailElement) {
            userEmailElement.textContent = 'Guest';
        }
        const loginForm = document.getElementById('dashboard-login-form');
        if (loginForm) {
            loginForm.reset();
        }
        this.hideAuthAlert();
    }

    async syncServerSession(session) {
        if (window.FPVRBAC) {
            await window.FPVRBAC.setSupabaseSession(session);
            this.userGroups = window.FPVRBAC.getGroups();
            this.serverSession = window.FPVRBAC.getServerSession();
        } else {
            this.userGroups = [];
            this.serverSession = null;
        }
        this.applyGroupVisibility();
    }

    applyGroupVisibility() {
        if (window.FPVRBAC) {
            window.FPVRBAC.refreshVisibility();
        }
    }

    hasGroup(group) {
        const normalized = typeof group === 'string' ? group.trim().toLowerCase() : '';
        if (!normalized) {
            return false;
        }
        if (window.FPVRBAC) {
            return window.FPVRBAC.hasGroup(normalized);
        }
        return this.userGroups.includes(normalized);
    }

    onAuthenticated() {
        if (!this.hasGroup('ops')) {
            this.showError('Your account does not have FPVue Ops access.');
            this.stopAutoRefresh();
            this.devices = [];
            this.sessions = [];
            this.startLineState = null;
            this.applyGroupVisibility();
            return;
        }

        // Load data and start auto-refresh after successful authentication
        this.loadDevices();
        this.loadSessions();
        this.loadStartLineState();
        this.startAutoRefresh();
    }

    hideAuthAlert() {
        const authAlert = document.getElementById('dashboard-auth-alert');
        if (authAlert) {
            authAlert.classList.add('hidden');
        }
    }

    setupEventListeners() {
        // Authentication listeners
        const loginForm = document.getElementById('dashboard-login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        const logoutBtn = document.getElementById('dashboard-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // User avatar dropdown
        const userAvatarToggle = document.getElementById('user-avatar-toggle');
        if (userAvatarToggle) {
            userAvatarToggle.addEventListener('click', (e) => this.handleAvatarDropdown(e));
        }

        // Header logout button
        const headerLogoutBtn = document.getElementById('header-logout-btn');
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Close avatar dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const dropdown = document.getElementById('user-avatar-dropdown');
            if (dropdown && !dropdown.contains(event.target)) {
                this.closeAvatarDropdown();
            }
        });

        const registerBtn = document.getElementById('dashboard-register-btn');
        if (registerBtn) {
            registerBtn.addEventListener('click', () => this.handleRegister());
        }

        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadDevices();
        });

        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.filterDevices(e.target.value);
        });

        // Lap timing controls
        document.getElementById('refresh-sessions-btn').addEventListener('click', () => {
            this.loadSessions();
        });

        document.getElementById('driver-filter').addEventListener('input', (e) => {
            this.filterSessions();
        });

        document.getElementById('track-filter').addEventListener('input', (e) => {
            this.filterSessions();
        });

        // Edit device form
        document.getElementById('edit-device-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveDeviceChanges();
        });

        // Delete device button
        document.getElementById('delete-device-btn').addEventListener('click', () => {
            this.deleteDevice();
        });
    }

    async handleLogin(event) {
        event.preventDefault();
        if (!this.supabaseClient) {
            this.showAuthError('Authentication not initialized');
            return;
        }

        const email = document.getElementById('dashboard-login-email').value.trim();
        const password = document.getElementById('dashboard-login-password').value;

        if (!email || !password) {
            this.showAuthError('Email and password are required');
            return;
        }

        this.showAuthInfo('Signing in...');
        try {
            const { error } = await this.supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                this.showAuthError(error.message);
            } else {
                this.hideAuthAlert();
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showAuthError('Login failed');
        }
    }

    async handleRegister() {
        if (!this.supabaseClient) {
            this.showAuthError('Authentication not initialized');
            return;
        }

        const email = document.getElementById('dashboard-login-email').value.trim();
        const password = document.getElementById('dashboard-login-password').value;

        if (!email || !password) {
            this.showAuthError('Email and password are required');
            return;
        }

        if (password.length < 6) {
            this.showAuthError('Password must be at least 6 characters');
            return;
        }

        this.showAuthInfo('Creating account...');
        try {
            const { error } = await this.supabaseClient.auth.signUp({
                email,
                password
            });

            if (error) {
                this.showAuthError(error.message);
            } else {
                this.showAuthSuccess('Account created. Check your email to confirm, then sign in.');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showAuthError('Registration failed');
        }
    }

    async handleLogout() {
        if (!this.supabaseClient) {
            return;
        }
        try {
            await this.supabaseClient.auth.signOut();
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    showAuthError(message) {
        this.showAuthAlert(message, 'error');
    }

    showAuthInfo(message) {
        this.showAuthAlert(message, 'info');
    }

    showAuthSuccess(message) {
        this.showAuthAlert(message, 'success');
    }

    showAuthAlert(message, type = 'info') {
        const alert = document.getElementById('dashboard-auth-alert');
        if (!alert) return;

        alert.classList.remove('hidden', 'pf-m-info', 'pf-m-success', 'pf-m-error', 'pf-m-warning');
        alert.classList.add(`pf-m-${type}`);

        const content = alert.querySelector('.pf-c-alert__title, .pf-c-alert__description');
        if (content) {
            if (content.classList.contains('pf-c-alert__title')) {
                content.textContent = message;
            } else {
                content.textContent = message;
            }
        } else {
            alert.innerHTML = `<div class="pf-c-alert__title">${message}</div>`;
        }

        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(alert);
        }
    }

    toggleSection(element, show) {
        if (!element) {
            return;
        }
        element.classList.toggle('hidden', !show);
    }

    showError(message) {
        const container = document.getElementById('notification-container');
        if (!container) {
            console.error(message);
            return;
        }
        const notification = this.createNotification(message, 'error');
        container.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    showSuccess(message) {
        const container = document.getElementById('notification-container');
        if (!container) {
            console.log(message);
            return;
        }
        const notification = this.createNotification(message, 'success');
        container.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    createNotification(message, type = 'info') {
        const alert = document.createElement('div');
        alert.className = `pf-v5-c-alert pf-m-${type} pf-m-toast`;
        alert.setAttribute('role', 'alert');
        alert.innerHTML = `
            <div class="pf-v5-c-alert__icon">
                <i class="pf-icon ${type === 'error' ? 'pf-icon-error-circle-o' : type === 'success' ? 'pf-icon-check-circle-o' : 'pf-icon-info'}"></i>
            </div>
            <div class="pf-v5-c-alert__title">${this.escapeHtml(message)}</div>
        `;
        return alert;
    }


    setupModal() {
        const modal = document.getElementById('edit-modal');
        if (!modal) {
            return;
        }

        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal(modal));
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideModal(modal);
            }
        });
    }

    showModal(modal) {
        if (!modal) {
            return;
        }
        modal.classList.remove('hidden');
    }

    hideModal(modal) {
        if (!modal) {
            return;
        }
        modal.classList.add('hidden');
    }

    updateLabel(element, text, variant = 'outline') {
        if (!element) {
            return;
        }

        const label = element;
        const modifiers = [
            'pf-m-blue',
            'pf-m-cyan',
            'pf-m-gold',
            'pf-m-green',
            'pf-m-orange',
            'pf-m-purple',
            'pf-m-red',
            'pf-m-teal',
            'pf-m-gray',
            'pf-m-outline'
        ];
        label.classList.remove(...modifiers);

        if (variant) {
            const normalized = variant.startsWith('pf-m-') ? variant : `pf-m-${variant}`;
            label.classList.add(normalized);
        }

        const content = label.querySelector('.pf-c-label__content');
        if (content) {
            content.textContent = text;
        } else {
            label.textContent = text;
        }

        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(label);
        }
    }

    setupStartLineControls() {
        const armButton = document.getElementById('arm-start-line');
        const startButton = document.getElementById('start-start-line');

        if (armButton) {
            armButton.addEventListener('click', () => this.armStartLine());
        }

        if (startButton) {
            startButton.addEventListener('click', () => this.startStartLine());
        }
    }

    async loadStartLineState(showErrors = true) {
        if (this.loadingStartLine) {
            return;
        }

        this.loadingStartLine = true;
        try {
            const payload = await this.authenticatedRequest('/api/system/start-line');
            this.startLineState = payload?.state || null;
            this.serverTimeOffset = payload?.server_time_ms ? Date.now() - payload.server_time_ms : 0;
            this.updateStartLineDisplay();
        } catch (error) {
            console.error('Error loading start line state:', error);
            if (showErrors) {
                this.showError('Unable to load start line status');
            }
        } finally {
            this.loadingStartLine = false;
        }
    }

    updateStartLineDisplay() {
        const statusLabel = document.getElementById('start-line-status-label');
        const countdownLabel = document.getElementById('start-line-countdown');
        const armButton = document.getElementById('arm-start-line');
        const startButton = document.getElementById('start-start-line');

        if (!statusLabel || !countdownLabel) {
            return;
        }

        const state = this.startLineState || {
            status: 'idle',
            armed_at: null,
            countdown_started_at: null,
            step_interval_ms: 1000,
            led_count: 5
        };

        const statusMap = {
            idle: 'Idle',
            armed: 'Armed',
            countdown: 'Counting down',
            go: 'Go'
        };

        const statusText = statusMap[state.status] || state.status;
        const statusVariantMap = {
            idle: 'outline',
            armed: 'gold',
            countdown: 'orange',
            go: 'green'
        };
        this.updateLabel(statusLabel, statusText, statusVariantMap[state.status] || 'outline');

        if (armButton) {
            armButton.disabled = state.status === 'countdown';
        }
        if (startButton) {
            startButton.disabled = state.status !== 'armed';
        }

        if (state.status === 'countdown' && state.countdown_started_at) {
            const stepInterval = state.step_interval_ms || 1000;
            const ledCount = state.led_count || 5;
            const now = Date.now() - (this.serverTimeOffset || 0);
            const elapsed = Math.max(0, now - state.countdown_started_at);
            const totalDuration = ledCount * stepInterval;
            const stepsCompleted = Math.min(ledCount, Math.floor(elapsed / stepInterval) + 1);
            const remainingMs = Math.max(totalDuration - elapsed, 0);

            if (remainingMs <= 0) {
                this.updateLabel(countdownLabel, 'GO!', 'green');
            } else {
                const seconds = Math.ceil(remainingMs / 1000);
                this.updateLabel(countdownLabel, `T-${seconds}s (${stepsCompleted}/${ledCount})`, 'gold');
            }
        } else if (state.status === 'armed') {
            this.updateLabel(countdownLabel, 'Ready', 'green');
        } else {
            this.updateLabel(countdownLabel, '--', 'outline');
        }
    }

    async armStartLine() {
        const armButton = document.getElementById('arm-start-line');
        const previousState = armButton ? armButton.disabled : false;

        try {
            if (armButton) {
                armButton.disabled = true;
            }
            const payload = await this.authenticatedRequest('/api/system/start-line/arm', { method: 'POST' });
            this.startLineState = payload?.state || null;
            this.updateStartLineDisplay();
            this.showSuccess('Start line armed');
        } catch (error) {
            console.error('Error arming start line:', error);
            this.showError('Failed to arm start line');
        } finally {
            if (armButton) {
                armButton.disabled = previousState;
            }
        }
    }

    async startStartLine() {
        const startButton = document.getElementById('start-start-line');
        const previousState = startButton ? startButton.disabled : false;

        try {
            if (startButton) {
                startButton.disabled = true;
            }
            const payload = await this.authenticatedRequest('/api/system/start-line/start', { method: 'POST' });
            this.startLineState = payload?.state || null;
            this.updateStartLineDisplay();
            this.showSuccess('Countdown started');
        } catch (error) {
            console.error('Error starting start line countdown:', error);
            this.showError(error.message || 'Failed to start countdown');
        } finally {
            if (startButton) {
                startButton.disabled = previousState;
            }
        }
    }

    async loadDevices() {

        try {
            const data = await this.authenticatedRequest('/api/devices');
            this.devices = Array.isArray(data?.devices) ? data.devices : [];
            this.renderDevices();
            
            // Update last updated timestamp
            const now = new Date().toLocaleString();
            const lastUpdatedEl = document.getElementById('last-updated');
            if (lastUpdatedEl) {
                lastUpdatedEl.textContent = `Last updated: ${now}`;
            }
        } catch (error) {
            console.error('Error loading devices:', error);
            this.showError('Failed to load devices');
            const lastUpdatedEl = document.getElementById('last-updated');
            if (lastUpdatedEl) {
                lastUpdatedEl.textContent = 'Error loading data';
            }
        }
    }

    renderDevices() {
        const devicesList = document.getElementById('devices-list');

        if (!devicesList) {
            return;
        }

        if (!this.devices || this.devices.length === 0) {
            devicesList.innerHTML = `
                <div class="pf-c-empty-state pf-m-sm">
                    <div class="pf-c-empty-state__content">
                        <h3 class="pf-c-title pf-m-lg">No devices found</h3>
                        <p class="pf-c-content pf-m-sm">Add your first FPVue device to get started.</p>
                    </div>
                </div>
            `;
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(devicesList);
            }
            this.updateDeviceSummary();
            return;
        }

        devicesList.innerHTML = this.devices.map(device => this.createDeviceCard(device)).join('');
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(devicesList);
        }

        this.devices.forEach(device => {
            this.loadSessionInfo(device.device_id || device.mac_address);
        });

        this.updateDeviceSummary();
    }

    createDeviceCard(device) {
        const identifier = device.device_id || device.mac_address || 'unknown';
        const sessionPlaceholderId = `session-${identifier}`;
        const isOnline = device.status === 'online';
        const connectionInfo = this.formatConnectionStatus(device);
        const wifiChannelValue = Number.parseInt(device.wifi_channel, 10);
        const wifiChannel = Number.isNaN(wifiChannelValue) ? 'N/A' : wifiChannelValue;
        const displayModeText = (device.display_mode === 'flat' || device.display_mode === 'single') ? 'Flat Screen' : 'Curved Screen';
        const lastSeenText = device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Unknown';
        const sessionControls = this.buildSessionControls(device);

        return `
        <ul class="pf-v6-c-data-list" role="list" aria-label="Checkbox and action data list example" id="data-list-checkboxes-actions-addl-cells" class="pf-c-card pf-m-flat device-card ${isOnline ? 'device-card--online' : 'device-card--offline'}" data-device="${this.escapeHtml(identifier)}">
  <li class="pf-v6-c-data-list__item">
    <div class="pf-v6-c-data-list__item-row">
      <div class="pf-v6-c-data-list__item-control">
      </div>
      <div class="pf-v6-c-data-list__item-content">
        <div class="pf-v6-c-data-list__cell">
          <span id="data-list-checkboxes-actions-addl-cells-item-1">${this.escapeHtml(device.device_name || 'Unnamed Device')}</span></br>
          <span class="pf-v6-c-label ${isOnline ? 'pf-m-green' : 'pf-m-red'}">
                            <span class="pf-v6-c-label__content">${this.escapeHtml(connectionInfo)}</span>
        </span>
                        <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Last Seen</dt>
                                <dd class="pf-v6-c-description-list__description" style="font-weight: bold;">${this.escapeHtml(lastSeenText)}</dd>
                            </div>
        </div>
        <div class="pf-v6-c-data-list__cell">
                    <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">WiFi Channel</dt>
                                <dd class="pf-v6-c-description-list__description" style="font-weight: bold;">${this.escapeHtml(String(wifiChannel))}</dd>
                            </div>
                    <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Headset Battery</dt>
                                <dd class="pf-v6-c-description-list__description" style="font-weight: bold;">${this.formatBatteryStatus(device)}</dd>
                            </div>  
                    <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Display Mode</dt>
                                <dd class="pf-c-description-list__description" style="font-weight: bold;">${this.escapeHtml(displayModeText)}</dd>
                    </div>
                </div>
        <div class="pf-v6-c-data-list__cell">
           <div class="pf-v6-c-description-list__group">
                <dt class="pf-v6-c-description-list__term">Pilot</dt>
                <dd class="pf-v6-c-description-list__description" style="font-weight: bold;">${this.renderPilotLabel(device)}</dd>
            </div>
            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Session</dt>
                                <dd class="pf-c-description-list__description">
                                    <span id="${this.escapeHtml(sessionPlaceholderId)}" class="pf-c-label pf-m-outline session-indicator" style="font-weight: bold;">
                                        <span class="pf-c-label__content">Loading...</span>
                                    </span>
                                </dd>
            </div>
        </div>
      </div>
      <div class="pf-v6-c-data-list__item-action pf-m-hidden pf-m-visible-on-xl">
      <div class="device-actions" aria-label="Device actions">
                            <button type="button" class="pf-v6-c-button pf-m-link" onclick="deviceManager.editDevice('${this.escapeJsString(identifier)}')">Edit</button>
                            <button type="button" class="pf-v6-c-button pf-m-link" data-action="quick-channel" data-device="${this.escapeJsString(identifier)}" data-channel="${Number.isNaN(wifiChannelValue) ? 1 : wifiChannelValue}" data-device-name="${this.escapeJsString(device.device_name || 'Unnamed Device')}">Quick Channel</button>
                            <button type="button" class="pf-v6-c-button pf-m-link" data-action="display-mode" data-device="${this.escapeJsString(identifier)}" data-mode="${this.escapeJsString(device.display_mode || 'curved')}" data-device-name="${this.escapeJsString(device.device_name || 'Unnamed Device')}">Switch Mode</button>
                           </div>
        <div class="pf-v6-c-data-list__item-action pf-m-hidden pf-m-visible-on-xl">                 
                           <div class="device-actions" aria-label="Device actions">
                            ${sessionControls}
                            </div>
                    </div>
            </div>
        </div>
      </div>
    </div>
  </li>
</ul>
        `;
    }

    buildSessionControls(device) {
        const identifier = device.device_id || device.mac_address;
        const deviceName = device.device_name || 'Unnamed Device';
        const sessionState = device.current_session || null;
        const buttons = [];

        if (sessionState && sessionState.is_active && !sessionState.is_paused) {
            buttons.push(`<button type="button" class="pf-v6-c-button pf-m-warning pf-m-link" onclick="deviceManager.pauseSession('${this.escapeJsString(identifier)}')">Pause</button>`);
            buttons.push(`<button type="button" class="pf-v6-c-button pf-m-danger pf-m-link" onclick="deviceManager.stopSession('${this.escapeJsString(identifier)}')">Stop</button>`);
        } else if (sessionState && sessionState.is_paused) {
            buttons.push(`<button type="button" class="pf-v6-c-button pf-m-primary pf-m-control" onclick="deviceManager.resumeSession('${this.escapeJsString(identifier)}')">Resume</button>`);
            buttons.push(`<button type="button" class="pf-v6-c-button pf-m-danger pf-m-link" onclick="deviceManager.stopSession('${this.escapeJsString(identifier)}')">Stop</button>`);
        } else {
            buttons.push(`<button type="button" class="pf-v6-c-button pf-m-primary pf-m-small" data-action="start-session" data-device="${this.escapeJsString(identifier)}" data-device-name="${this.escapeJsString(deviceName)}">Start Session</button>`);
        }

        return buttons.join('\n');
    }

    formatConnectionStatus(device) {
        const isOnline = device.status === 'online';
        const timeSince = Number(device.time_since_last_seen) || 0;

        if (isOnline) {
            return 'Connected';
        }

        if (timeSince < 60) {
            return `Disconnected (${timeSince}s ago)`;
        }
        if (timeSince < 3600) {
            return `Disconnected (${Math.floor(timeSince / 60)}m ago)`;
        }

        return `Disconnected (${Math.floor(timeSince / 3600)}h ago)`;
    }

    updateDeviceSummary() {
        const totalElement = document.getElementById('summary-total');
        const onlineElement = document.getElementById('summary-online');
        const offlineElement = document.getElementById('summary-offline');
        const sessionsElement = document.getElementById('summary-sessions');

        if (!totalElement || !onlineElement || !offlineElement || !sessionsElement) {
            return;
        }

        const total = Array.isArray(this.devices) ? this.devices.length : 0;
        const online = Array.isArray(this.devices)
            ? this.devices.filter(device => device.status === 'online').length
            : 0;
        const offline = Math.max(total - online, 0);
        const activeSessionsFromSessions = Array.isArray(this.sessions)
            ? this.sessions.filter(session => Number(session.status) === 1).length
            : 0;
        const activeSessionsFromDevices = Array.isArray(this.devices)
            ? this.devices.filter(device => device.current_session?.is_active && !device.current_session.is_paused).length
            : 0;
        const activeSessions = activeSessionsFromSessions || activeSessionsFromDevices;

        totalElement.textContent = total;
        onlineElement.textContent = online;
        offlineElement.textContent = offline;
        sessionsElement.textContent = activeSessions;
    }

    formatBatteryStatus(device) {
        const level = Number(device.battery_level);
        if (Number.isNaN(level) || level < 0) {
            return '<span class="pf-u-color-200">Unknown</span>';
        }

        let variant = 'green';
        if (level <= 15) {
            variant = 'red';
        } else if (level <= 30) {
            variant = 'orange';
        } else if (level <= 50) {
            variant = 'gold';
        }

        const suffix = device.battery_charging ? ' charging' : '';
        const label = `${level}%${suffix}`;
        return `<span class="pf-c-label pf-m-${variant}"><span class="pf-c-label__content">${this.escapeHtml(label)}</span></span>`;
    }

    renderPilotLabel(device) {
        // Try to parse current_assignment if it's a string
        let assignment = device.current_assignment;
        if (typeof assignment === 'string') {
            try {
                assignment = JSON.parse(assignment);
            } catch (e) {
                console.error('Error parsing current_assignment:', e);
            }
        }
        
        // Get pilot name with fallbacks
        const pilotName = device.current_pilot_name || 
                         device.current_pilot?.display_name || 
                         (assignment?.pilot_display_name || assignment?.pilot_name) || 
                         'Unknown pilot';
                         
        if (!pilotName || pilotName === 'Unknown pilot') {
            return '<span class="pf-u-color-200">No pilot assigned</span>';
        }

        const session = device.current_session || {};
        const ticket = device.current_ticket || {};
        const packageMinutes = session.allocated_minutes || ticket.package_minutes || 0;
        const packageLabel = session.package_label || ticket.package_label || '';
        const packageInfo = packageLabel ? packageLabel : (packageMinutes ? `${packageMinutes} min` : '');
        const safeName = this.escapeHtml(pilotName);

        if (packageInfo) {
            const safePackage = this.escapeHtml(packageInfo);
            return `${safeName} <span class="pf-u-color-200">(${safePackage})</span>`;
        }

        return safeName;
    }

    escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeJsString(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, '\\\'');
    }

    filterDevices(searchTerm) {
        const cards = document.querySelectorAll('.device-card');
        const term = searchTerm.toLowerCase();

        cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            card.classList.toggle('hidden', !text.includes(term));
        });
    }



    editDevice(identifier) {
        const device = this.devices.find(d => d.device_id === identifier || d.mac_address === identifier);
        if (!device) return;

        this.currentEditingDevice = device;
        
        document.getElementById('edit-device-name').value = device.device_name;
        document.getElementById('edit-wifi-channel').value = device.wifi_channel;

        const modal = document.getElementById('edit-modal');
        this.showModal(modal);
    }

    async saveDeviceChanges() {
        if (!this.currentEditingDevice) return;

        const deviceName = document.getElementById('edit-device-name').value;
        const wifiChannel = parseInt(document.getElementById('edit-wifi-channel').value);
        const identifier = this.currentEditingDevice.device_id || this.currentEditingDevice.mac_address;

        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/name`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ device_name: deviceName })
            });

            await this.authenticatedRequest(`/api/devices/${identifier}/wifi-channel`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ wifi_channel: wifiChannel })
            });

            this.showSuccess('Device updated successfully');
            this.hideModal(document.getElementById('edit-modal'));
            this.loadDevices();
        } catch (error) {
            console.error('Error updating device:', error);
            this.showError('Failed to update device');
        }
    }

    async deleteDevice() {
        if (!this.currentEditingDevice) return;

        if (!confirm(`Are you sure you want to delete device "${this.currentEditingDevice.device_name}"?`)) {
            return;
        }

        try {
            const identifier = this.currentEditingDevice.device_id || this.currentEditingDevice.mac_address;
            await this.authenticatedRequest(`/api/devices/${identifier}`, {
                method: 'DELETE'
            });

            this.showSuccess('Device deleted successfully');
            this.hideModal(document.getElementById('edit-modal'));
            this.loadDevices();
        } catch (error) {
            console.error('Error deleting device:', error);
            this.showError('Failed to delete device');
        }
    }

    async quickChannelChange(identifier, currentChannel) {
        const newChannel = prompt(`Enter new WiFi channel (1-200):`, currentChannel);
        
        if (newChannel === null) return;
        
        const channel = parseInt(newChannel);
        if (isNaN(channel) || channel < 1 || channel > 200) {
            this.showError('Invalid channel number. Please enter a number between 1 and 200.');
            return;
        }

        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/wifi-channel`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ wifi_channel: channel })
            });

            this.showSuccess(`WiFi channel updated to ${channel}`);
            this.loadDevices();
        } catch (error) {
            console.error('Error updating WiFi channel:', error);
            this.showError('Failed to update WiFi channel');
        }
    }

    async toggleDisplayMode(identifier, currentMode) {
        const normalizedCurrent = (() => {
            if (!currentMode) {
                return 'curved';
            }
            const lower = String(currentMode).toLowerCase();
            if (lower === 'single') {
                return 'flat';
            }
            if (lower === 'triple') {
                return 'curved';
            }
            return ['flat', 'curved'].includes(lower) ? lower : 'curved';
        })();

        const newMode = normalizedCurrent === 'flat' ? 'curved' : 'flat';
        const modeText = newMode === 'flat' ? 'Flat Screen' : 'Curved Screen';
        
        if (!confirm(`Switch display mode to ${modeText}?`)) {
            return;
        }

        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/display-mode`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ display_mode: newMode })
            });

            this.showSuccess(`Display mode updated to ${modeText}`);
            this.loadDevices();
        } catch (error) {
            console.error('Error updating display mode:', error);
            this.showError('Failed to update display mode');
        }
    }

    async loadSessionInfo(identifier) {
        try {
            const sessionInfo = await this.authenticatedRequest(`/api/devices/${identifier}/session`);
            const info = sessionInfo || {};

            const sessionElement = document.getElementById(`session-${identifier}`);
            if (!sessionElement) {
                return;
            }

            if (info.is_paused) {
                const remaining = Number(info.remaining || info.duration || 0);
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                this.updateLabel(sessionElement, `${timeStr} paused`, 'gold');
            } else if (info.is_active) {
                const remaining = Number(info.remaining || 0);
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                if (info.expired) {
                    this.updateLabel(sessionElement, 'Expired', 'red');
                } else {
                    this.updateLabel(sessionElement, `${timeStr} remaining`, 'green');
                }
            } else {
                const duration = Number(info.duration || 0);
                const minutes = Math.floor(duration / 60);
                this.updateLabel(sessionElement, `${minutes}m ready`, 'outline');
            }
        } catch (error) {
            console.error('Error loading session info:', error);
            const sessionElement = document.getElementById(`session-${identifier}`);
            if (sessionElement) {
                this.updateLabel(sessionElement, 'Error', 'red');
            }
        }
    }

    async manageSession(identifier) {
        try {
            const sessionInfo = await this.authenticatedRequest(`/api/devices/${identifier}/session`);
            const info = sessionInfo || {};
            const remainingSeconds = Number(info.remaining || info.duration || 0);

            if (info.is_active) {
                const choice = window.prompt(`Session is active with ${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60).toString().padStart(2, '0')} remaining. Type "pause" to pause or "stop" to end the session.`, 'pause');
                if (!choice) {
                    return;
                }
                const normalized = choice.trim().toLowerCase();
                if (normalized === 'pause') {
                    await this.pauseSession(identifier);
                } else if (normalized === 'stop') {
                    await this.stopSession(identifier);
                }
            } else if (info.is_paused) {
                const choice = window.prompt(`Session is paused with ${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60).toString().padStart(2, '0')} remaining. Type "resume" to continue or "stop" to end the session.`, 'resume');
                if (!choice) {
                    return;
                }
                const normalized = choice.trim().toLowerCase();
                if (normalized === 'resume') {
                    await this.resumeSession(identifier);
                } else if (normalized === 'stop') {
                    await this.stopSession(identifier);
                }
            } else {
                const defaultMinutes = Math.floor((info.duration || 1800) / 60);
                const duration = prompt(`Start session for how many minutes? (Default: ${defaultMinutes}m)`, defaultMinutes);
                if (duration && duration > 0) {
                    await this.startSession(identifier, duration * 60);
                }
            }
        } catch (error) {
            console.error('Error managing session:', error);
            this.showError('Failed to manage session');
        }
    }

    async startSession(identifier, duration) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ duration: duration })
            });

            this.showSuccess(`Session started for ${Math.floor(duration / 60)} minutes`);
            await this.loadDevices();
        } catch (error) {
            console.error('Error starting session:', error);
            this.showError(error.message || 'Failed to start session');
        }
    }

    async stopSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            this.showSuccess('Session stopped');
            await this.loadDevices();
        } catch (error) {
            console.error('Error stopping session:', error);
            this.showError(error.message || 'Failed to stop session');
        }
    }

    async pauseSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/pause`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            this.showSuccess('Session paused');
            await this.loadDevices();
        } catch (error) {
            console.error('Error pausing session:', error);
            this.showError(error.message || 'Failed to pause session');
        }
    }

    async resumeSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/resume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            this.showSuccess('Session resumed');
            await this.loadDevices();
        } catch (error) {
            console.error('Error resuming session:', error);
            this.showError(error.message || 'Failed to resume session');
        }
    }

    updateSessionTimers() {
        this.devices.forEach(device => {
            const identifier = device.device_id || device.mac_address;
            this.loadSessionInfo(identifier);
        });
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const container = document.getElementById('notification-container');
        if (!container) {
            console.warn('Notification container missing');
            return;
        }

        const variantMap = {
            success: { modifier: 'success', icon: 'pf-icon-ok' },
            error: { modifier: 'danger', icon: 'pf-icon-error-circle-o' },
            warning: { modifier: 'warning', icon: 'pf-icon-warning-triangle' },
            info: { modifier: 'info', icon: 'pf-icon-info' }
        };

        const { modifier, icon } = variantMap[type] || variantMap.info;

        const alert = document.createElement('div');
        alert.className = `pf-c-alert pf-m-${modifier}`;
        alert.setAttribute('role', 'alert');

        alert.innerHTML = `
            <div class="pf-c-alert__icon">
                <i class="pf-icon ${icon}" aria-hidden="true"></i>
            </div>
            <div class="pf-c-alert__title">${this.escapeHtml(message)}</div>
            <div class="pf-c-alert__action">
                <button type="button" class="pf-c-button pf-m-plain" aria-label="Close notification">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        `;

        const closeButton = alert.querySelector('button');
        if (closeButton) {
            closeButton.addEventListener('click', () => alert.remove());
        }

        container.appendChild(alert);
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(alert);
        }

        setTimeout(() => {
            alert.remove();
        }, 4000);
    }

    // ==================== LAP TIMING METHODS ====================

    async loadSessions() {
        try {
            const data = await this.authenticatedRequest('/api/sessions?limit=20');
            this.sessions = data?.sessions || [];
            this.renderSessions();

            // Update last updated timestamp
            const now = new Date().toLocaleString();
            const lastUpdatedEl = document.getElementById('last-updated');
            if (lastUpdatedEl) {
                lastUpdatedEl.textContent = `Last updated: ${now}`;
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            const sessionsListEl = document.getElementById('sessions-list');
            if (sessionsListEl) {
                sessionsListEl.innerHTML = '<div class="error">Error loading sessions</div>';
            }
        }
    }

    renderSessions() {
        const container = document.getElementById('sessions-list');

        if (!container) {
            return;
        }
        
        if (!this.sessions || this.sessions.length === 0) {
            container.innerHTML = `
                <div class="pf-c-empty-state pf-m-sm">
                    <div class="pf-c-empty-state__content">
                        <h3 class="pf-c-title pf-m-lg">No lap timing sessions found</h3>
                    </div>
                </div>
            `;
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(container);
            }
            this.updateDeviceSummary();
            return;
        }

        container.innerHTML = this.sessions.map(session => this.createSessionCard(session)).join('');
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(container);
        }
        this.updateDeviceSummary();
    }

    createSessionCard(session) {
        const statusLabels = {
            0: { text: 'Inactive', variant: 'outline' },
            1: { text: 'Active', variant: 'green' },
            2: { text: 'Paused', variant: 'gold' },
            3: { text: 'Completed', variant: 'blue' }
        };

        const status = statusLabels[session.status] || { text: 'Unknown', variant: 'gray' };
        const sessionDate = new Date(session.created_at).toLocaleDateString();
        const sessionTime = new Date(session.created_at).toLocaleTimeString();

        return `
            <div class="pf-l-gallery__item">
                <article class="pf-c-card pf-m-flat session-card" tabindex="0" role="button" onclick="deviceManager.viewSessionDetails('${this.escapeJsString(session.session_id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); deviceManager.viewSessionDetails('${this.escapeJsString(session.session_id)}'); }">
                    <header class="pf-c-card__header">
                        <div class="pf-c-card__title">${this.escapeHtml(session.driver_name || 'Unknown Driver')}</div>
                        <span class="pf-c-label pf-m-${status.variant}">
                            <span class="pf-c-label__content">${status.text}</span>
                        </span>
                    </header>
                    <div class="pf-c-card__body">
                        <dl class="pf-c-description-list pf-m-horizontal session-details">
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Track</dt>
                                <dd class="pf-c-description-list__description">${this.escapeHtml(session.track_name || 'Unknown Track')}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Device</dt>
                                <dd class="pf-c-description-list__description">${this.escapeHtml(session.device_name || 'Unknown')}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Laps</dt>
                                <dd class="pf-c-description-list__description">${session.total_laps || 0}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Best</dt>
                                <dd class="pf-c-description-list__description">${session.best_lap_ms ? this.escapeHtml(this.formatLapTime(session.best_lap_ms)) : 'N/A'}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Average</dt>
                                <dd class="pf-c-description-list__description">${session.avg_lap_ms ? this.escapeHtml(this.formatLapTime(session.avg_lap_ms)) : 'N/A'}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Package</dt>
                                <dd class="pf-c-description-list__description">${session.allocated_minutes ? `${session.allocated_minutes} min` : 'N/A'}</dd>
                            </div>
                        </dl>
                    </div>
                    <footer class="pf-c-card__footer">
                        <div class="pf-c-content pf-m-sm session-meta">${sessionDate} ${sessionTime}</div>
                    </footer>
                </article>
            </div>
        `;
    }

    formatLapTime(milliseconds) {
        if (!milliseconds) return '-';
        
        const totalMs = Math.round(milliseconds);
        const minutes = Math.floor(totalMs / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const ms = totalMs % 1000;
        
        if (minutes > 0) {
            return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
        } else {
            return `${seconds}.${ms.toString().padStart(3, '0')}s`;
        }
    }

    filterSessions() {
        const driverFilter = document.getElementById('driver-filter').value.toLowerCase();
        const trackFilter = document.getElementById('track-filter').value.toLowerCase();
        
        const filtered = this.sessions.filter(session => {
            const matchesDriver = !driverFilter || (session.driver_name && session.driver_name.toLowerCase().includes(driverFilter));
            const matchesTrack = !trackFilter || (session.track_name && session.track_name.toLowerCase().includes(trackFilter));
            return matchesDriver && matchesTrack;
        });
        
        this.renderFilteredSessions(filtered);
    }

    renderFilteredSessions(filteredSessions) {
        const container = document.getElementById('sessions-list');
        if (!container) {
            return;
        }
        
        if (!filteredSessions || filteredSessions.length === 0) {
            container.innerHTML = `
                <div class="pf-c-empty-state pf-m-sm">
                    <div class="pf-c-empty-state__content">
                        <h3 class="pf-c-title pf-m-lg">No sessions match the current filters</h3>
                    </div>
                </div>
            `;
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(container);
            }
            return;
        }

        container.innerHTML = filteredSessions.map(session => this.createSessionCard(session)).join('');
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(container);
        }
    }

    setupSessionModal() {
        const modal = document.getElementById('session-modal');
        if (!modal) {
            return;
        }

        const closeBtn = modal.querySelector('.session-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal(modal));
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideModal(modal);
            }
        });
    }

    setupChannelModal() {
        const modal = document.getElementById('channel-modal');
        if (!modal) {
            return;
        }

        const form = document.getElementById('channel-change-form');
        const closeBtns = modal.querySelectorAll('.channel-close');

        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.hideModal(modal));
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideModal(modal);
            }
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const deviceId = form.dataset.deviceId;
                const channelInput = document.getElementById('channel-input');
                const newChannel = parseInt(channelInput.value, 10);

                if (!deviceId || isNaN(newChannel)) {
                    this.showError('Invalid channel value');
                    return;
                }

                await this.updateDeviceChannel(deviceId, newChannel);
                this.hideModal(modal);
            });
        }

        // Listen for button clicks with data-action="quick-channel"
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="quick-channel"]');
            if (btn) {
                const deviceId = btn.dataset.device;
                const currentChannel = btn.dataset.channel;
                const deviceName = btn.dataset.deviceName || 'Unknown Device';
                this.openChannelModal(deviceId, currentChannel, deviceName);
            }
        });
    }

    setupDisplayModeModal() {
        const modal = document.getElementById('display-mode-modal');
        if (!modal) {
            return;
        }

        const form = document.getElementById('display-mode-form');
        const closeBtns = modal.querySelectorAll('.display-mode-close');

        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.hideModal(modal));
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideModal(modal);
            }
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const deviceId = form.dataset.deviceId;
                const selectedMode = form.querySelector('input[name="display-mode"]:checked')?.value;

                if (!deviceId || !selectedMode) {
                    this.showError('Please select a display mode');
                    return;
                }

                await this.updateDeviceDisplayMode(deviceId, selectedMode);
                this.hideModal(modal);
            });
        }

        // Listen for button clicks with data-action="display-mode"
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="display-mode"]');
            if (btn) {
                const deviceId = btn.dataset.device;
                const currentMode = btn.dataset.mode;
                const deviceName = btn.dataset.deviceName || 'Unknown Device';
                this.openDisplayModeModal(deviceId, currentMode, deviceName);
            }
        });
    }

    setupStartSessionModal() {
        const modal = document.getElementById('start-session-modal');
        if (!modal) {
            return;
        }

        const form = document.getElementById('start-session-form');
        const closeBtns = modal.querySelectorAll('.start-session-close');

        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.hideModal(modal));
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.hideModal(modal);
            }
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const deviceId = form.dataset.deviceId;
                const durationSelect = document.getElementById('session-duration');
                const duration = parseInt(durationSelect.value, 10);

                if (!deviceId || isNaN(duration)) {
                    this.showError('Please select a session duration');
                    return;
                }

                await this.startSession(deviceId, duration);
                this.hideModal(modal);
            });
        }

        // Listen for button clicks with data-action="start-session"
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="start-session"]');
            if (btn) {
                const deviceId = btn.dataset.device;
                const deviceName = btn.dataset.deviceName || 'Unknown Device';
                this.openStartSessionModal(deviceId, deviceName);
            }
        });
    }

    async viewSessionDetails(sessionId) {
        try {
            this.currentViewingSession = sessionId;
            
            // Find session in our current data
            const session = this.sessions.find(s => s.session_id === sessionId);
            if (!session) {
                this.showError('Session not found');
                return;
            }

            // Get detailed session data with lap times
            const data = await this.authenticatedRequest(`/api/devices/${session.device_id}/sessions/${sessionId}`);
            if (!data) {
                throw new Error('Failed to load session details');
            }

            this.displaySessionDetails(data);

            this.showModal(document.getElementById('session-modal'));
        } catch (error) {
            console.error('Error viewing session details:', error);
            this.showError('Failed to load session details');
        }
    }

    displaySessionDetails(sessionData) {
        const { session, laps } = sessionData;
        
        // Update session info
        document.getElementById('session-driver').textContent = session.driver_name || 'Unknown';
        document.getElementById('session-track').textContent = session.track_name || 'Unknown';
        document.getElementById('session-device').textContent = session.device_name || session.device_id || 'Unknown';
        
        const statusLabels = {
            0: { text: 'Inactive', variant: 'outline' },
            1: { text: 'Active', variant: 'green' },
            2: { text: 'Paused', variant: 'gold' },
            3: { text: 'Completed', variant: 'blue' }
        };
        const statusInfo = statusLabels[session.status] || { text: 'Unknown', variant: 'gray' };
        this.updateLabel(document.getElementById('session-status'), statusInfo.text, statusInfo.variant);
        
        // Calculate and display statistics
        const validLaps = laps.filter(lap => lap.is_valid);
        const totalLaps = validLaps.length;
        
        document.getElementById('total-laps').textContent = totalLaps;
        
        if (totalLaps > 0) {
            const bestLap = Math.min(...validLaps.map(lap => lap.duration_ms));
            const avgLap = validLaps.reduce((sum, lap) => sum + lap.duration_ms, 0) / totalLaps;
            
            document.getElementById('best-lap').textContent = this.formatLapTime(bestLap);
            document.getElementById('avg-lap').textContent = this.formatLapTime(avgLap);
        } else {
            document.getElementById('best-lap').textContent = '-';
            document.getElementById('avg-lap').textContent = '-';
        }
        
        // Display lap times table
        this.displayLapTimes(laps);
    }

    displayLapTimes(laps) {
        const container = document.getElementById('lap-times-list');

        if (!container) {
            return;
        }

        if (!laps || laps.length === 0) {
            container.innerHTML = `
                <div class="pf-c-empty-state pf-m-sm">
                    <div class="pf-c-empty-state__content">
                        <h3 class="pf-c-title pf-m-md">No lap times recorded</h3>
                    </div>
                </div>
            `;
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(container);
            }
            return;
        }

        const tableHtml = `
            <table class="pf-c-table pf-m-grid-md lap-times-table" role="grid">
                <thead>
                    <tr>
                        <th scope="col">Lap</th>
                        <th scope="col">Time</th>
                        <th scope="col">Delta Best</th>
                        <th scope="col">Valid</th>
                        <th scope="col">Notes</th>
                    </tr>
                </thead>
                <tbody>
                    ${laps.map(lap => this.createLapTimeRow(lap, laps)).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = tableHtml;
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(container);
        }
    }

    createLapTimeRow(lap, allLaps) {
        const validLaps = allLaps.filter(l => l.is_valid);
        const bestLapTime = validLaps.length > 0 ? Math.min(...validLaps.map(l => l.duration_ms)) : lap.duration_ms;
        const delta = lap.duration_ms - bestLapTime;
        const deltaStr = delta === 0 ? '-' : (delta > 0 ? `+${this.formatLapTime(delta)}` : this.formatLapTime(Math.abs(delta)));
        
        const deltaClass = delta === 0 ? 'lap-delta-best' : (delta > 0 ? 'lap-delta-slower' : 'lap-delta-faster');
        const validityVariant = lap.is_valid ? 'green' : 'red';
        const validityText = lap.is_valid ? 'Yes' : 'No';

        return `
            <tr class="${lap.is_valid ? '' : 'lap-row-invalid'}">
                <td data-label="Lap">${lap.lap_number}</td>
                <td data-label="Time" class="lap-time">${this.escapeHtml(this.formatLapTime(lap.duration_ms))}</td>
                <td data-label="Delta Best" class="${deltaClass}">${this.escapeHtml(deltaStr)}</td>
                <td data-label="Valid">
                    <span class="pf-c-label pf-m-${validityVariant}">
                        <span class="pf-c-label__content">${validityText}</span>
                    </span>
                </td>
                <td data-label="Notes">${lap.notes ? this.escapeHtml(lap.notes) : 'N/A'}</td>
            </tr>
        `;
    }

    updateSessionTimers() {
        // Update session timers for devices that have active sessions
        this.devices.forEach(device => {
            if (device.current_session?.is_active && !device.current_session.is_paused) {
                this.loadSessionInfo(device.device_id || device.mac_address);
            }
        });
    }

    openChannelModal(deviceId, currentChannel, deviceName) {
        const modal = document.getElementById('channel-modal');
        const form = document.getElementById('channel-change-form');
        const channelInput = document.getElementById('channel-input');
        const deviceNameElement = document.getElementById('channel-device-name');

        if (!modal || !form || !channelInput) {
            return;
        }

        // Set form data
        form.dataset.deviceId = deviceId;
        channelInput.value = currentChannel;
        if (deviceNameElement) {
            deviceNameElement.textContent = deviceName;
        }

        this.showModal(modal);
    }

    openDisplayModeModal(deviceId, currentMode, deviceName) {
        const modal = document.getElementById('display-mode-modal');
        const form = document.getElementById('display-mode-form');
        const deviceNameElement = document.getElementById('display-mode-device-name');
        const flatRadio = document.getElementById('display-mode-flat');
        const curvedRadio = document.getElementById('display-mode-curved');

        if (!modal || !form) {
            return;
        }

        // Set form data
        form.dataset.deviceId = deviceId;
        if (deviceNameElement) {
            deviceNameElement.textContent = deviceName;
        }

        // Set current mode
        if (currentMode === 'flat' || currentMode === 'single') {
            if (flatRadio) flatRadio.checked = true;
        } else {
            if (curvedRadio) curvedRadio.checked = true;
        }

        this.showModal(modal);
    }

    openStartSessionModal(deviceId, deviceName) {
        const modal = document.getElementById('start-session-modal');
        const form = document.getElementById('start-session-form');
        const deviceNameElement = document.getElementById('start-session-device-name');
        const durationSelect = document.getElementById('session-duration');

        if (!modal || !form) {
            return;
        }

        // Set form data
        form.dataset.deviceId = deviceId;
        if (deviceNameElement) {
            deviceNameElement.textContent = deviceName;
        }
        if (durationSelect) {
            durationSelect.value = ''; // Reset selection
        }

        this.showModal(modal);
    }

    async updateDeviceChannel(deviceId, newChannel) {
        try {
            await this.authenticatedRequest(`/api/devices/${deviceId}/wifi-channel`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ wifi_channel: newChannel })
            });

            this.showSuccess(`WiFi channel updated to ${newChannel}`);
            await this.loadDevices();
        } catch (error) {
            console.error('Error updating channel:', error);
            this.showError(error.message || 'Failed to update channel');
        }
    }

    async updateDeviceDisplayMode(deviceId, newMode) {
        try {
            await this.authenticatedRequest(`/api/devices/${deviceId}/display-mode`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ display_mode: newMode })
            });

            const modeText = newMode === 'flat' ? 'Flat Screen' : 'Curved Screen';
            this.showSuccess(`Display mode changed to ${modeText}`);
            await this.loadDevices();
        } catch (error) {
            console.error('Error updating display mode:', error);
            this.showError(error.message || 'Failed to update display mode');
        }
    }

    async pauseSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/pause`, {
                method: 'POST'
            });

            this.showSuccess('Session paused');
            await this.loadDevices();
        } catch (error) {
            console.error('Error pausing session:', error);
            this.showError(error.message || 'Failed to pause session');
        }
    }

    async resumeSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/resume`, {
                method: 'POST'
            });

            this.showSuccess('Session resumed');
            await this.loadDevices();
        } catch (error) {
            console.error('Error resuming session:', error);
            this.showError(error.message || 'Failed to resume session');
        }
    }

    async stopSession(identifier) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/stop`, {
                method: 'POST'
            });

            this.showSuccess('Session stopped');
            await this.loadDevices();
        } catch (error) {
            console.error('Error stopping session:', error);
            this.showError(error.message || 'Failed to stop session');
        }
    }

    async startSession(identifier, duration) {
        try {
            await this.authenticatedRequest(`/api/devices/${identifier}/session/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ duration: duration })
            });

            this.showSuccess(`Session started for ${Math.floor(duration / 60)} minutes`);
            await this.loadDevices();
        } catch (error) {
            console.error('Error starting session:', error);
            this.showError(error.message || 'Failed to start session');
        }
    }

    handleAvatarDropdown(event) {
        event.stopPropagation();
        
        const dropdown = document.getElementById('user-avatar-dropdown');
        const menu = dropdown?.querySelector('.pf-v6-c-menu__list');
        const toggle = document.getElementById('user-avatar-toggle');
        const menuContent = dropdown?.querySelector('.pf-v6-c-menu__content');
        
        if (menu && toggle && menuContent) {
            const isHidden = menu.hasAttribute('hidden');
            
            if (isHidden) {
                // Position the menu below the avatar button
                const toggleRect = toggle.getBoundingClientRect();
                menuContent.style.top = (toggleRect.bottom + 5) + 'px';
                menuContent.style.right = (window.innerWidth - toggleRect.right) + 'px';
                
                menu.removeAttribute('hidden');
                toggle.setAttribute('aria-expanded', 'true');
            } else {
                menu.setAttribute('hidden', '');
                toggle.setAttribute('aria-expanded', 'false');
            }
        }
    }

    closeAvatarDropdown() {
        const dropdown = document.getElementById('user-avatar-dropdown');
        const menu = dropdown?.querySelector('.pf-v6-c-menu__list');
        const toggle = document.getElementById('user-avatar-toggle');
        
        if (menu && toggle) {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
        }
    }

    updateHeaderAvatar(displayName, photoUrl) {
        console.log('updateHeaderAvatar called with:', { displayName, photoUrl });
        
        // Update header avatar image
        const headerAvatar = document.getElementById('header-user-avatar');
        const dropdownAvatar = document.getElementById('dropdown-user-avatar');
        
        console.log('Avatar elements found:', { 
            headerAvatar: !!headerAvatar, 
            dropdownAvatar: !!dropdownAvatar 
        });
        
        if (headerAvatar && photoUrl) {
            headerAvatar.src = photoUrl;
            console.log('Updated header avatar src to:', photoUrl);
        }
        if (dropdownAvatar && photoUrl) {
            dropdownAvatar.src = photoUrl;
            console.log('Updated dropdown avatar src to:', photoUrl);
        }

        // Update user name in header
        const headerUserName = document.getElementById('header-user-name');
        const dropdownUserName = document.getElementById('dropdown-user-name');
        
        console.log('Name elements found:', { 
            headerUserName: !!headerUserName, 
            dropdownUserName: !!dropdownUserName 
        });
        
        if (headerUserName && displayName) {
            headerUserName.textContent = displayName;
            console.log('Updated header user name to:', displayName);
        }
        if (dropdownUserName && displayName) {
            dropdownUserName.textContent = displayName;
            console.log('Updated dropdown user name to:', displayName);
        }

        // Update user email in dropdown
        const dropdownUserEmail = document.getElementById('dropdown-user-email');
        const userEmail = this.currentSession?.user?.email;
        
        console.log('Email elements found:', { 
            dropdownUserEmail: !!dropdownUserEmail,
            userEmail: userEmail 
        });
        
        if (dropdownUserEmail && userEmail) {
            dropdownUserEmail.textContent = userEmail;
            console.log('Updated dropdown user email to:', userEmail);
        }

        // Show avatar dropdown when authenticated
        const avatarDropdown = document.getElementById('user-avatar-dropdown');
        if (avatarDropdown && this.currentSession) {
            avatarDropdown.classList.remove('hidden');
            console.log('Avatar dropdown shown');
        }
        
        console.log('updateHeaderAvatar completed');
    }

    async loadAdminPilotData() {
        console.log('🔧 Loading admin pilot data...');
        if (!this.currentSession) {
            console.log('🔧 No session available for pilot data loading');
            return;
        }

        try {
            // Load pilot profile data using the same endpoint as profile.js
            const profileData = await this.authenticatedRequest('/api/pilots/me');
            
            console.log('🔧 Admin pilot profile loaded:', profileData);
            
            const pilotProfile = profileData?.pilot ?? null;
            console.log('🔧 Final admin pilot profile:', pilotProfile);
            
            this.renderPilotProfile(pilotProfile);
        } catch (err) {
            console.error('Failed to load admin pilot data:', err);
            // Don't show error to user, just use defaults
            this.renderPilotProfile(null);
        }
    }

    renderPilotProfile(pilot) {
        console.log('🔧 Rendering admin pilot profile:', pilot);
        
        if (!pilot) {
            console.log('🔧 No pilot data available, using defaults');
            // Use email as fallback
            const email = this.currentSession?.user?.email || 'Admin';
            this.updateHeaderAvatar(email, null);
            return;
        }

        try {
            // Update header avatar with pilot data
            console.log('🔧 Updating header avatar with pilot data:', { 
                displayName: pilot.display_name, 
                photoUrl: pilot.photo_url 
            });
            this.updateHeaderAvatar(pilot.display_name, pilot.photo_url);
        } catch (err) {
            console.warn('Some elements not available for admin pilot profile rendering:', err);
        }
    }
}









