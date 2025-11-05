(() => {
    // Enhanced browser extension error prevention
    if (typeof window !== 'undefined') {
        // Create safe browser API objects before any other code runs
        window.chrome = window.chrome || {};
        window.browser = window.browser || {};

        // Override chrome APIs that extensions commonly use
        if (!window.chrome.runtime) {
            window.chrome.runtime = {
                onMessage: { addListener: () => {}, removeListener: () => {} },
                sendMessage: () => Promise.resolve(),
                onConnect: { addListener: () => {}, removeListener: () => {} },
                connect: () => ({}),
                getManifest: () => ({}),
                getURL: (path) => path,
                id: 'mock-extension-id'
            };
        }

        if (!window.browser.runtime) {
            window.browser.runtime = window.chrome.runtime;
        }

        // Override storage APIs
        if (!window.chrome.storage) {
            window.chrome.storage = {
                local: {
                    get: () => Promise.resolve({}),
                    set: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    clear: () => Promise.resolve()
                },
                sync: {
                    get: () => Promise.resolve({}),
                    set: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    clear: () => Promise.resolve()
                }
            };
        }

        if (!window.browser.storage) {
            window.browser.storage = window.chrome.storage;
        }

        // Override tabs API
        if (!window.chrome.tabs) {
            window.chrome.tabs = {
                query: () => Promise.resolve([]),
                create: () => Promise.resolve({}),
                update: () => Promise.resolve({}),
                remove: () => Promise.resolve(),
                onUpdated: { addListener: () => {}, removeListener: () => {} }
            };
        }

        if (!window.browser.tabs) {
            window.browser.tabs = window.chrome.tabs;
        }

        // Override other common APIs
        if (!window.chrome.extension) {
            window.chrome.extension = {
                getURL: (path) => path,
                getBackgroundPage: () => null,
                getViews: () => []
            };
        }

        if (!window.chrome.windows) {
            window.chrome.windows = {
                getCurrent: () => Promise.resolve({}),
                create: () => Promise.resolve({}),
                update: () => Promise.resolve({}),
                remove: () => Promise.resolve()
            };
        }

        // Enhanced error handling with more specific detection
        const originalErrorHandler = window.onerror;
        window.onerror = function(message, source, lineno, colno, error) {
            // Check if this is an extension-related error
            if (message && (
                message.includes('Cannot read properties of undefined') ||
                message.includes('Cannot read property') ||
                message.includes('enabled') ||
                source?.includes('popup.js') ||
                source?.includes('extension') ||
                source?.includes('chrome-extension') ||
                source?.includes('moz-extension') ||
                source?.includes('safari-extension') ||
                (source && !source.includes(window.location.hostname))
            )) {
                console.warn('Browser extension error suppressed:', {
                    message,
                    source,
                    lineno,
                    colno
                });
                return true; // Prevent the error from being logged
            }

            // Call original handler if it exists
            if (originalErrorHandler) {
                return originalErrorHandler.call(this, message, source, lineno, colno, error);
            }
            return false;
        };

        // Enhanced promise rejection handling
        const originalUnhandledRejection = window.onunhandledrejection;
        window.onunhandledrejection = function(event) {
            if (event.reason && (
                event.reason.message?.includes('Cannot read properties of undefined') ||
                event.reason.message?.includes('Cannot read property') ||
                event.reason.message?.includes('enabled') ||
                event.reason.stack?.includes('popup.js') ||
                event.reason.stack?.includes('extension')
            )) {
                console.warn('Browser extension promise rejection suppressed:', event.reason);
                event.preventDefault();
                return true;
            }

            if (originalUnhandledRejection) {
                return originalUnhandledRejection.call(this, event);
            }
            return false;
        };

        // Override console.error to filter out extension errors
        const originalConsoleError = console.error;
        console.error = function(...args) {
            const message = args.join(' ');
            if (message.includes('Cannot read properties of undefined') ||
                message.includes('Cannot read property') ||
                message.includes('enabled') ||
                args.some(arg => arg?.includes?.('popup.js') ||
                                arg?.includes?.('extension') ||
                                arg?.includes?.('chrome-extension'))) {
                console.warn('Browser extension error filtered from console:', ...args);
                return;
            }
            originalConsoleError.apply(console, args);
        };
    }

    let supabaseClient = null;
    let currentSession = null;
    let pilotProfile = null;
    let pilotPoints = null;
    let currentTab = 'overview';
    let serverSession = null;
    let userGroups = [];
    let rbacUnsubscribe = null;
    const REQUIRED_GROUP = 'pilot';

    const POINTS_PER_USDT = 100;

    // Initialize on DOM load
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            const config = await loadPublicConfig();

            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                showError('Supabase is not configured. Rewards system unavailable.');
                return;
            }

            supabaseClient = window.supabase.createClient(config.supabase.url, config.supabase.anonKey);
            if (window.FPVRBAC) {
                window.FPVRBAC.setSupabaseClient(supabaseClient);
                if (rbacUnsubscribe) {
                    rbacUnsubscribe();
                }
                rbacUnsubscribe = window.FPVRBAC.onChange(({ groups, serverSession: snapshotSession }) => {
                    userGroups = groups || [];
                    serverSession = snapshotSession || null;
                    applyGroupVisibility();
                    // Note: Don't update header-user-name here as it will be updated by updateHeaderAvatar
                });
            }

            // Check existing session
            const { data } = await supabaseClient.auth.getSession();
            await handleSessionChange(data?.session ?? null);

            // Listen for auth changes
            supabaseClient.auth.onAuthStateChange(async (_event, session) => {
                await handleSessionChange(session ?? null);
            });

            setupEventListeners();
        } catch (err) {
            console.error('Failed to initialize rewards system:', err);
            showError('Failed to initialize. Please refresh the page.');
        }
    }

    function setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('rewards-login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', handleLogin);
        }

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Tab navigation
        const tabButtons = document.querySelectorAll('[data-tab]');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Buy points button
        const buyPointsBtn = document.getElementById('buy-points-btn');
        if (buyPointsBtn) {
            buyPointsBtn.addEventListener('click', () => showModal('buy-points-modal'));
        }

        // Buy points form
        const buyPointsForm = document.getElementById('buy-points-form');
        if (buyPointsForm) {
            buyPointsForm.addEventListener('submit', handleBuyPoints);
        }

        // Ticket purchase form
        const ticketPurchaseForm = document.getElementById('purchase-ticket-form');
        if (ticketPurchaseForm) {
            ticketPurchaseForm.addEventListener('submit', handleTicketPurchase);
        }

        // Payment form
        const paymentForm = document.getElementById('wallet-payment-form');
        if (paymentForm) {
            paymentForm.addEventListener('submit', handlePaymentSubmit);
        }

        // USDT amount input for preview
        const usdtInput = document.getElementById('usdt-amount');
        if (usdtInput) {
            usdtInput.addEventListener('input', updatePointsPreview);
        }

        // Refresh payments button
        const refreshPaymentsBtn = document.getElementById('refresh-payments-btn');
        if (refreshPaymentsBtn) {
            refreshPaymentsBtn.addEventListener('click', () => {
                console.log('Refreshing payments data...');
                loadWalletData();
            });
        }

        // User avatar dropdown
        const userAvatarToggle = document.getElementById('user-avatar-toggle');
        if (userAvatarToggle) {
            userAvatarToggle.addEventListener('click', handleAvatarDropdown);
        }

        // Header logout button
        const headerLogoutBtn = document.getElementById('header-logout-btn');
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', handleLogout);
        }

        // Close avatar dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const dropdown = document.getElementById('user-avatar-dropdown');
            const toggle = document.getElementById('user-avatar-toggle');
            if (dropdown && !dropdown.contains(event.target)) {
                closeAvatarDropdown();
            }
        });

        // Modal close buttons
        setupModalCloseButtons();

        // Marketplace filter and search
        const marketplaceFilter = document.getElementById('marketplace-filter');
        if (marketplaceFilter) {
            marketplaceFilter.addEventListener('change', loadMarketplaceItems);
        }

        const marketplaceSearch = document.getElementById('marketplace-search');
        if (marketplaceSearch) {
            marketplaceSearch.addEventListener('input', debounce(loadMarketplaceItems, 300));
        }

        // Refresh purchases button
        const refreshPurchasesBtn = document.getElementById('refresh-purchases-btn');
        if (refreshPurchasesBtn) {
            refreshPurchasesBtn.addEventListener('click', loadPurchases);
        }

        // Refresh wallet button
        const refreshWalletBtn = document.getElementById('refresh-wallet-btn');
        if (refreshWalletBtn) {
            refreshWalletBtn.addEventListener('click', loadWalletData);
        }
    }

    function setupModalCloseButtons() {
        // Buy points modal
        document.querySelectorAll('.buy-points-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('buy-points-modal'));
        });

        // Purchase item modal
        document.querySelectorAll('.purchase-item-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('purchase-item-modal'));
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close, .pf-c-button[aria-label*="Close"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Find the parent modal and hide it
                const modal = e.target.closest('.pf-v6-c-backdrop, .pf-c-backdrop');
                if (modal && modal.id) {
                    hideModal(modal.id);
                }
            });
        });
    }

    async function handleLogin(event) {
        event.preventDefault();
        const email = document.getElementById('rewards-email').value.trim();
        const password = document.getElementById('rewards-password').value;

        if (!email || !password) {
            showAuthError('Email and password are required.');
            return;
        }

        showAuthInfo('Signing in...');

        try {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                showAuthError(error.message);
            } else {
                hideAuthAlert();
            }
        } catch (err) {
            showAuthError('Failed to sign in. Please try again.');
        }
    }

    async function handleLogout() {
        if (!supabaseClient) return;
        await supabaseClient.auth.signOut();
    }

    function applyGroupVisibility() {
        if (window.FPVRBAC) {
            window.FPVRBAC.refreshVisibility();
        }
    }

    function hasGroup(group) {
        const normalized = typeof group === 'string' ? group.trim().toLowerCase() : '';
        if (!normalized) {
            return false;
        }
        if (window.FPVRBAC) {
            return window.FPVRBAC.hasGroup(normalized);
        }
        return userGroups.includes(normalized);
    }

    async function handleSessionChange(session) {
        currentSession = session;
        const isAuthenticated = !!session;

        if (window.FPVRBAC) {
            await window.FPVRBAC.setSupabaseSession(session);
            userGroups = window.FPVRBAC.getGroups();
            serverSession = window.FPVRBAC.getServerSession();
        } else {
            userGroups = [];
            serverSession = null;
        }

        applyGroupVisibility();
        const hasAccess = hasGroup(REQUIRED_GROUP) || hasGroup('admin');

        // Toggle auth card and main content
        const authCard = document.getElementById('rewards-auth-card');
        const content = document.getElementById('rewards-content');

        if (authCard) authCard.classList.toggle('hidden', isAuthenticated);
        if (content) content.classList.toggle('hidden', !isAuthenticated || !hasAccess);

        if (isAuthenticated) {
            const displayName =
                serverSession?.user?.user_metadata?.display_name ||
                serverSession?.user?.email ||
                session.user?.user_metadata?.display_name ||
                session.user?.email ||
                'Pilot';
            // Note: Don't update header-user-name here as it will be updated by updateHeaderAvatar

            // Show pilot info in header
            const pilotInfo = document.getElementById('pilot-info');
            if (pilotInfo) pilotInfo.classList.remove('hidden');

            // Initialize header avatar with basic info (will be updated when pilot data loads)
            const email =
                serverSession?.user?.email ||
                session.user?.email ||
                'Unknown email';
            updateHeaderAvatar(email, null);

            if (!hasAccess) {
                pilotProfile = null;
                pilotPoints = null;
                showError('Your account does not have access to the pilot rewards portal yet.');
                return;
            }

            // Load pilot data
            console.log('🔧 User authenticated, loading pilot data');
            loadPilotData();
        } else {
            if (window.FPVRBAC) {
                window.FPVRBAC.clearSession();
            }
            pilotProfile = null;
            pilotPoints = null;

            // Hide pilot info
            const pilotInfo = document.getElementById('pilot-info');
            if (pilotInfo) pilotInfo.classList.add('hidden');

            // Hide user menu when logged out
            const userMenu = document.getElementById('user-menu');
            if (userMenu) userMenu.classList.add('hidden');

            // Hide user avatar dropdown when logged out
            const userAvatarDropdown = document.getElementById('user-avatar-dropdown');
            if (userAvatarDropdown) userAvatarDropdown.classList.add('hidden');
        }
    }

    async function loadPilotData() {
        console.log('🔧 Loading pilot data...');
        try {
            // Try to load pilot profile and points
            let profileData = null;
            let pointsData = null;

            try {
                profileData = await authenticatedRequest('/api/pilots/me');
                console.log('🔧 Pilot profile loaded:', profileData);
            } catch (profileErr) {
                console.warn('🔧 Pilot profile endpoint not available:', profileErr.message);
            }

            try {
                pointsData = await authenticatedRequest('/api/rewards/points');
                console.log('🔧 Pilot points loaded:', pointsData);
            } catch (pointsErr) {
                console.warn('🔧 Pilot points endpoint not available:', pointsErr.message);
            }

            pilotProfile = profileData?.pilot ?? null;
            pilotPoints = pointsData ?? { current_points: 0, lifetime_earned: 0, total_spent: 0 };

            console.log('🔧 Final pilot profile:', pilotProfile);
            console.log('🔧 Final pilot points:', pilotPoints);
            

            updatePointsDisplay();
            renderPilotProfile(pilotProfile);
            updateUserMenu(pilotProfile);
            updateOverviewCounters();
            loadCurrentTabData();
        } catch (err) {
            console.error('Failed to load pilot data:', err);
            // Don't show error to user, just use defaults
            pilotProfile = null;
            pilotPoints = { current_points: 0, lifetime_earned: 0, total_spent: 0 };
            updatePointsDisplay();
            renderPilotProfile(null);
            updateUserMenu(null);
            updateOverviewCounters();
            loadCurrentTabData();
        }
    }

    function renderPilotProfile(pilot) {
        if (!pilot) {
            return;
        }


        try {
            // Update header avatar
            updateHeaderAvatar(pilot.display_name, pilot.photo_url);
        } catch (err) {
            console.warn('Some elements not available for pilot profile rendering:', err);
        }
    }

    function updatePointsDisplay() {
        if (!pilotPoints) return;

        // Header points
        const headerPoints = document.getElementById('pilot-points');
        if (headerPoints) {
            headerPoints.textContent = pilotPoints.current_points || 0;
        }

        // Overview tab points
        const overviewPoints = document.getElementById('overview-points');
        if (overviewPoints) {
            overviewPoints.textContent = pilotPoints.current_points || 0;
        }

        const lifetimePoints = document.getElementById('lifetime-points');
        if (lifetimePoints) {
            lifetimePoints.textContent = pilotPoints.lifetime_earned || 0;
        }

        const spentPoints = document.getElementById('spent-points');
        if (spentPoints) {
            spentPoints.textContent = pilotPoints.total_spent || 0;
        }
    }


    async function updateOverviewCounters() {
        console.log('🔧 Updating overview counters...');
        
        try {
            // Load achievements data and update counter
            console.log('🔧 Calling achievements API...');
            const achievementsData = await authenticatedRequest('/api/rewards/achievements/mine');
            console.log('🔧 Achievements API response:', achievementsData);
            const achievements = achievementsData.achievements || [];
            console.log('🔧 Achievements array:', achievements);
            const unlockedCount = achievements.filter(a => a.unlocked).length;
            console.log('🔧 Unlocked achievements count:', unlockedCount);
            
            const achievementsCount = document.getElementById('achievements-count');
            if (achievementsCount) {
                achievementsCount.textContent = unlockedCount;
                console.log('🔧 Updated achievements counter to:', unlockedCount);
            }
        } catch (err) {
            console.error('🔧 Failed to load achievements for counter:', err);
            console.error('🔧 Achievements error details:', err.message, err.stack);
            const achievementsCount = document.getElementById('achievements-count');
            if (achievementsCount) {
                achievementsCount.textContent = '0';
            }
        }

        try {
            // Load purchases data and update counter
            const purchasesData = await authenticatedRequest('/api/rewards/purchases');
            const purchases = purchasesData.purchases || [];
            
            const purchasesCount = document.getElementById('purchases-count');
            if (purchasesCount) {
                purchasesCount.textContent = purchases.length;
            }
        } catch (err) {
            console.warn('🔧 Failed to load purchases for counter:', err.message);
            const purchasesCount = document.getElementById('purchases-count');
            if (purchasesCount) {
                purchasesCount.textContent = '0';
            }
        }
    }

    function switchTab(tabName) {
        console.log('🔧 Switching to tab:', tabName);
        currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.pf-v6-c-tabs__item').forEach(item => {
            item.classList.remove('pf-m-current');
        });
        const activeTab = document.querySelector(`[data-tab="${tabName}"]`)?.closest('.pf-v6-c-tabs__item');
        if (activeTab) {
            activeTab.classList.add('pf-m-current');
        }

        // Update tab content
        document.querySelectorAll('.rewards-tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        const activeContent = document.getElementById(`tab-${tabName}`);
        if (activeContent) {
            activeContent.classList.remove('hidden');
            console.log('🔧 Tab content shown:', tabName);
        }

        loadCurrentTabData();
    }

    async function loadCurrentTabData() {
        console.log('🔧 Loading data for tab:', currentTab);
        switch (currentTab) {
            case 'overview':
                await loadRecentActivity();
                break;
            case 'marketplace':
                console.log('🔧 Loading marketplace items');
                await loadMarketplaceItems();
                break;
            case 'achievements':
                await loadAchievements();
                break;
            case 'purchases':
                await loadPurchases();
                break;
            case 'wallet':
                await loadWalletData();
                break;
        }
    }

    async function loadRecentActivity() {
        try {
            const data = await authenticatedRequest('/api/rewards/activity?limit=10');
            const activityList = document.getElementById('recent-activity-list');

            if (!activityList) return;

            if (!data?.transactions || data.transactions.length === 0) {
                activityList.innerHTML = `
                    <div class="pf-v6-c-empty-state pf-m-sm">
                        <div class="pf-v6-c-empty-state__content">
                            <h3 class="pf-v6-c-title pf-m-md">No recent activity</h3>
                        </div>
                    </div>
                `;
                return;
            }

            activityList.innerHTML = `
                <ul class="activity-timeline">
                    ${data.transactions.map(renderActivityItem).join('')}
                </ul>
            `;
        } catch (err) {
            console.warn('Failed to load activity:', err.message);
            // Show empty state instead of error
            const activityList = document.getElementById('recent-activity-list');
            if (activityList) {
                activityList.innerHTML = `
                    <div class="pf-v6-c-empty-state pf-m-sm">
                        <div class="pf-v6-c-empty-state__content">
                            <h3 class="pf-v6-c-title pf-m-md">Activity unavailable</h3>
                            <p class="pf-v6-c-content pf-m-sm">Activity tracking is not available at this time.</p>
                        </div>
                    </div>
                `;
            }
        }
    }

    async function loadMarketplaceItems() {
        console.log('🔧 === MARKETPLACE LOADING START ===');

        try {
            const filter = document.getElementById('marketplace-filter')?.value || 'all';
            const search = document.getElementById('marketplace-search')?.value || '';
            const container = document.getElementById('marketplace-items');

            console.log('🔧 Filter:', filter);
            console.log('🔧 Search:', search);
            console.log('🔧 Container found:', !!container);

            if (!container) {
                console.error('🔧 Marketplace container not found!');
                container.innerHTML = `
                    <div class="pf-v6-l-gallery__item">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">Marketplace Error</h3>
                                <p class="pf-v6-c-content pf-m-sm">Marketplace container not found. Please refresh the page.</p>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            // Start with hardcoded ticket items (always available)
            console.log('🔧 Creating hardcoded ticket items...');
            
            const ticketItems = [
                {
                    item_id: 'ticket-PKG-S10',
                    name: 'Sprint 10 minutos',
                    description: 'Reserve 10 minutes of track time for your racing session.',
                    item_type: 'ticket',
                    usdt_price: 10,
                    points_price: 1000,
                    stock: -1,
                    is_active: true,
                    is_locked: false, // Tickets are never locked
                    metadata: {
                        minutes: 10,
                        package_id: 'PKG-S10',
                        type: 'ticket'
                    }
                },
                {
                    item_id: 'ticket-PKG-S20',
                    name: 'Endurance 20 minutos',
                    description: 'Reserve 20 minutes of track time for extended practice.',
                    item_type: 'ticket',
                    usdt_price: 18,
                    points_price: 1800,
                    stock: -1,
                    is_active: true,
                    is_locked: false, // Tickets are never locked
                    metadata: {
                        minutes: 20,
                        package_id: 'PKG-S20',
                        type: 'ticket'
                    }
                },
                {
                    item_id: 'ticket-PKG-S30',
                    name: 'Maratona 30 minutos',
                    description: 'Reserve 30 minutes of track time for championship racing.',
                    item_type: 'ticket',
                    usdt_price: 25,
                    points_price: 2500,
                    stock: -1,
                    is_active: true,
                    is_locked: false, // Tickets are never locked
                    metadata: {
                        minutes: 30,
                        package_id: 'PKG-S30',
                        type: 'ticket'
                    }
                }
            ];

            let allItems = [...ticketItems];
            console.log('🔧 Created ticket items:', allItems.length);

            // Try to fetch additional marketplace items from rewards API (with unlock logic)
            try {
                console.log('🔧 Fetching marketplace items from rewards API...');
                const data = await authenticatedRequest('/api/rewards/marketplace');
                console.log('🔧 API marketplace response:', data);
                console.log('🔧 API marketplace item names:', (data.items || []).map(i => i.name));
                console.log('🔧 Unlocked items:', (data.items || []).filter(i => !i.is_locked).map(i => i.name));
                console.log('🔧 Locked items:', (data.items || []).filter(i => i.is_locked).map(i => i.name));
                
                if (data.items && data.items.length > 0) {
                    allItems = [...allItems, ...data.items];
                    console.log('🔧 Combined items:', allItems.length);
                    console.log('🔧 All item names:', allItems.map(i => i.name));
                }
            } catch (apiError) {
                console.warn('🔧 Failed to fetch marketplace items:', apiError.message);
                console.warn('🔧 Continuing with ticket items only...');
            }

            // Apply search filter
            if (search) {
                const searchLower = search.toLowerCase();
                allItems = allItems.filter(item =>
                    item.name.toLowerCase().includes(searchLower) ||
                    item.description.toLowerCase().includes(searchLower) ||
                    item.item_type.toLowerCase().includes(searchLower)
                );
                console.log('🔧 After search filter:', allItems);
            }

            // Apply type filter
            if (filter !== 'all') {
                if (filter === 'tickets') {
                    // Only show ticket items when tickets filter is selected
                    allItems = allItems.filter(item => item.item_type === 'ticket');
                } else {
                    // Show non-ticket items for other filters
                    allItems = allItems.filter(item => item.item_type === filter);
                }
                console.log('🔧 After type filter:', allItems);
            }

            // Sort items: unlocked first, then locked
            allItems.sort((a, b) => {
                if (a.is_locked === b.is_locked) {
                    return (a.points_price || 0) - (b.points_price || 0);
                }
                return a.is_locked ? 1 : -1; // Unlocked items first
            });

            const unlockedCount = allItems.filter(i => !i.is_locked).length;
            const lockedCount = allItems.filter(i => i.is_locked).length;
            console.log(`🔧 Displaying ${allItems.length} items (${unlockedCount} unlocked, ${lockedCount} locked)`);

            if (allItems.length === 0) {
                container.innerHTML = `
                    <div class="pf-v6-l-gallery__item">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">No items found</h3>
                                <p class="pf-v6-c-content pf-m-sm">Try adjusting your filters or search terms.</p>
                            </div>
                        </div>
                    </div>
                `;
                console.log('🔧 === MARKETPLACE LOADING END (empty) ===');
                return;
            }

            container.innerHTML = allItems.map(renderMarketplaceItem).join('');
            console.log('🔧 Rendered marketplace items');

            // Add click handlers
            const buttons = container.querySelectorAll('[data-item-id]');
            console.log('🔧 Found buttons:', buttons.length);

            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const itemId = btn.dataset.itemId;
                    const item = allItems.find(i => i.item_id === itemId);
                    if (item) {
                        if (item.is_locked) {
                            showNotification('This item is currently unavailable for purchase', 'warning');
                            console.log('🔧 Blocked purchase attempt for locked item:', item.name);
                        } else {
                            console.log('🔧 Opening purchase modal for unlocked item:', item.name);
                            openPurchaseModal(item);
                        }
                    }
                });
            });

            console.log('🔧 === MARKETPLACE LOADING END (success) ===');
        } catch (err) {
            console.error('🔧 Marketplace loading error:', err);
            const container = document.getElementById('marketplace-items');
            if (container) {
                container.innerHTML = `
                    <div class="pf-v6-l-gallery__item">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">Marketplace Error</h3>
                                <p class="pf-v6-c-content pf-m-sm">Failed to load marketplace. Error: ${err.message}</p>
                            </div>
                        </div>
                    </div>
                `;
            }
            console.log('🔧 === MARKETPLACE LOADING END (error) ===');
        }
    }

    async function loadPurchases() {
        console.log('🔧 Loading purchases');
        try {
            const data = await authenticatedRequest('/api/rewards/purchases');
            console.log('🔧 Purchases data:', data);
            console.log('🔧 Number of purchases:', data.purchases ? data.purchases.length : 0);
            console.log('🔧 Purchases breakdown:', data.purchases);
            
            const container = document.getElementById('purchases-list');
            if (!container) {
                console.error('🔧 Purchases container not found');
                return;
            }

            const purchases = data.purchases || [];
            
            if (purchases.length === 0) {
                container.innerHTML = `
                    <div class="pf-v6-c-empty-state pf-m-sm">
                        <div class="pf-v6-c-empty-state__content">
                            <h3 class="pf-v6-c-title pf-m-md">No purchases yet</h3>
                            <p class="pf-v6-c-content">Your race passes and marketplace purchases will appear here!</p>
                        </div>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="pf-v6-l-grid pf-m-gutter">
                    ${purchases.map(renderPurchaseItem).join('')}
                </div>
            `;
            
        } catch (err) {
            console.error('🔧 Failed to load purchases:', err);
            const container = document.getElementById('purchases-list');
            if (container) {
                container.innerHTML = `
                    <div class="pf-v6-c-empty-state pf-m-sm">
                        <div class="pf-v6-c-empty-state__content">
                            <h3 class="pf-v6-c-title pf-m-md">Error Loading Purchases</h3>
                            <p class="pf-v6-c-content pf-m-sm">Failed to load purchases: ${err.message}</p>
                        </div>
                    </div>
                `;
            }
        }
    }

    function renderPurchaseItem(purchase) {
        const purchaseDate = new Date(purchase.purchased_at).toLocaleDateString();
        const purchaseTime = new Date(purchase.purchased_at).toLocaleTimeString();
        const isTicket = purchase.purchase_type === 'ticket';
        const status = purchase.status || (isTicket ? 'pending' : 'completed');
        
        // Get status label with appropriate color
        const getStatusLabel = (status) => {
            const statusMap = {
                'completed': { color: 'pf-m-green', text: 'Completed' },
                'paid': { color: 'pf-m-green', text: 'Paid' },
                'pending': { color: 'pf-m-gold', text: 'Pending Payment' },
                'failed': { color: 'pf-m-red', text: 'Payment Failed' },
                'canceled': { color: 'pf-m-red', text: 'Canceled' },
                'refunded': { color: 'pf-m-purple', text: 'Refunded' }
            };
            const statusInfo = statusMap[status] || { color: 'pf-m-grey', text: status };
            return `<span class="pf-v6-c-label ${statusInfo.color}"><span class="pf-v6-c-label__content">${statusInfo.text}</span></span>`;
        };
        
        // Build payment amount display
        const getPaymentAmount = () => {
            if (isTicket) {
                const amount = purchase.points_paid || purchase.usdt_paid || 0;
                const currency = purchase.payment_method?.toUpperCase() || 'USDT';
                return `${amount} ${currency}`;
            } else {
                return purchase.points_paid > 0 ? `${purchase.points_paid} points` : 'Free';
            }
        };
        
        return `
         <div class="pf-v6-l-grid__item pf-m-12-col pf-m-6-col-on-lg">
            <div class="pf-v6-c-card pf-m-plain">
                <div class="pf-v6-c-card__header">
                    <div class="pf-v6-c-card__title">
                        <h3 class="pf-v6-c-title pf-m-md">${escapeHtml(purchase.item_name || 'Unknown Item')}</h3>
                    </div>
                    <div class="pf-v6-c-card__actions">
                        ${getStatusLabel(status)}
                        ${isTicket ? '<span class="pf-v6-c-label pf-m-outline"><span class="pf-v6-c-label__content">Race Pass</span></span>' : ''}
                    </div>
                </div>
                <div class="pf-v6-c-card__body">
                    <dl class="pf-v6-c-description-list pf-m-horizontal pf-m-2-col">
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Purchase Date</dt>
                            <dd class="pf-v6-c-description-list__description">${purchaseDate} at ${purchaseTime}</dd>
                        </div>
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Payment Method</dt>
                            <dd class="pf-v6-c-description-list__description">${escapeHtml(purchase.payment_method || 'Points')}</dd>
                        </div>
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Amount Paid</dt>
                            <dd class="pf-v6-c-description-list__description">${getPaymentAmount()}</dd>
                        </div>
                        ${isTicket && purchase.package_minutes ? `
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Duration</dt>
                                <dd class="pf-v6-c-description-list__description">${purchase.package_minutes} minutes</dd>
                            </div>
                        ` : ''}
                        ${isTicket && purchase.redeemed ? `
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Redeemed</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    <span class="pf-v6-c-label pf-m-green"><span class="pf-v6-c-label__content">Yes</span></span>
                                </dd>
                            </div>
                        ` : ''}
                        ${purchase.verification_error ? `
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Issue</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    <span class="pf-v6-u-color-danger-200" title="${escapeHtml(purchase.verification_error)}">${escapeHtml(purchase.verification_error)}</span>
                                </dd>
                            </div>
                        ` : ''}
                        ${purchase.admin_reason ? `
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Admin Note</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    <span class="pf-v6-u-color-200">${escapeHtml(purchase.admin_reason)}</span>
                                </dd>
                            </div>
                        ` : ''}
                        ${isTicket && purchase.payment_reference ? `
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Transaction</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    <code class="pf-v6-u-font-family-monospace-sm">${purchase.payment_reference.slice(0, 20)}...</code>
                                </dd>
                            </div>
                        ` : ''}
                    </dl>
                </div>
            </div>
         </div>
        `;
    }

    async function loadWalletData() {
        console.log('[wallet] loading data');
        try {
            const data = await authenticatedRequest('/api/rewards/wallet');
            console.log('[wallet] payload:', data);

            updateWalletDisplay(data);
            updateRecentPayments(data.recent_payments || data.transactions || []);
        } catch (err) {
            console.error('[wallet] failed to load data:', err);
            // Show error but don't fail completely
            updateWalletDisplay({ usdt_balance: 0, usdt_pending: 0 });
            updateRecentPayments([]);
        }
    }

    function updateWalletDisplay(walletData) {
        console.log('[wallet] update display with:', walletData);

        // Update wallet balance
        const walletBalance = document.getElementById('wallet-balance');
        console.log('[wallet] balance element present:', !!walletBalance);

        if (walletBalance) {
            const numericBalance = walletData.usdt_balance ?? walletData.balance ?? 0;
            const balance = Number(numericBalance || 0).toFixed(2);
            walletBalance.textContent = balance;
        }

        // Update pending amount if we add that to UI later
        const pendingBalance = document.getElementById('wallet-pending');
        if (pendingBalance) {
            const pendingValue = Number(walletData.usdt_pending ?? walletData.pending ?? 0).toFixed(2);
            pendingBalance.textContent = pendingValue;
        }

        const walletAddressEl = document.getElementById('wallet-address');
        if (walletAddressEl) {
            const address = walletData.wallet_address || walletData.address || '';
            walletAddressEl.textContent = address || 'Not set';
        }
    }
    function updateRecentPayments(payments) {
        const container = document.getElementById('recent-payments-list');
        if (!container) {
            return;
        }

        if (!payments.length) {
            container.innerHTML = `
                <div class="pf-v6-c-empty-state pf-m-sm">
                    <div class="pf-v6-c-empty-state__content">
                        <div class="pf-v6-c-empty-state__icon">
                            <i class="fas fa-wallet pf-v6-u-color-200" aria-hidden="true"></i>
                        </div>
                        <h3 class="pf-v6-c-title pf-m-md">No payments yet</h3>
                        <div class="pf-v6-c-empty-state__body">
                            Submit a payment using a transaction hash to add funds to your wallet.
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <ul class="activity-timeline">
                ${payments.map(renderPaymentActivityItem).join('')}
            </ul>
        `;
    }

    function renderPaymentActivityItem(payment) {
        const statusColor = {
            'pending': 'blue',
            'verified': 'green', 
            'failed': 'red',
            'admin_approved': 'green'
        }[payment.payment_status] || 'grey';

        // Determine activity icon and class based on payment status
        let iconClass, iconName;
        switch (payment.payment_status) {
            case 'verified':
            case 'admin_approved':
                iconClass = 'earned';
                iconName = 'fa-check';
                break;
            case 'failed':
                iconClass = 'failed';
                iconName = 'fa-times';
                break;
            case 'pending':
            default:
                iconClass = 'pending';
                iconName = 'fa-clock';
                break;
        }

        const statusLabel = payment.payment_status.replace('_', ' ').toUpperCase();
        const shortTxHash = payment.transaction_hash ? 
            payment.transaction_hash.slice(0, 10) + '...' + payment.transaction_hash.slice(-8) : 
            'N/A';
        const paymentDate = payment.created_at ? 
            new Date(payment.created_at).toLocaleDateString() : 
            'Unknown date';
        const paymentTime = payment.created_at ? 
            new Date(payment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
            '';

        return `
            <li class="activity-timeline-item">
                <div class="activity-icon ${iconClass}">
                    <i class="fas ${iconName}" aria-hidden="true"></i>
                </div>
                <div class="activity-details">
                    <div class="pf-v6-l-flex pf-m-justify-content-space-between pf-m-align-items-start">
                        <div class="pf-v6-l-flex__item">
                            <div class="pf-v6-u-font-weight-bold pf-v6-u-mb-xs">
                                ${payment.payment_amount} ${payment.payment_currency || 'USDT'} Payment
                            </div>
                            <div class="pf-v6-u-font-size-sm pf-v6-u-color-200 pf-v6-u-mb-xs">
                                Transaction: <code>${shortTxHash}</code>
                            </div>
                            ${payment.verification_error ? `
                                <div class="pf-v6-u-font-size-sm pf-v6-u-color-danger-200 pf-v6-u-mb-xs">
                                    ${escapeHtml(payment.verification_error)}
                                </div>
                            ` : ''}
                            ${payment.description ? `
                                <div class="pf-v6-u-font-size-sm pf-v6-u-color-200">
                                    ${escapeHtml(payment.description)}
                                </div>
                            ` : ''}
                        </div>
                        <div class="pf-v6-l-flex__item">
                            <span class="pf-v6-c-label pf-m-${statusColor}">
                                <span class="pf-v6-c-label__content">${statusLabel}</span>
                            </span>
                        </div>
                    </div>
                    <div class="activity-time">
                        ${paymentDate} ${paymentTime}
                    </div>
                </div>
            </li>
        `;
    }

    async function loadAchievements() {
        console.log('[achievements] loading data');
        try {
            console.log('[achievements] calling API /api/rewards/achievements/mine');
            const data = await authenticatedRequest('/api/rewards/achievements/mine');
            console.log('[achievements] API response:', data);

            const achievementsList = document.getElementById('achievements-list');
            const achievementsCount = document.getElementById('achievements-count');
            
            const achievements = data.achievements || [];
            console.log('[achievements] total achievements:', achievements.length);
            const unlockedCount = achievements.filter(a => a.unlocked).length;
            console.log('[achievements] unlocked count:', unlockedCount);
            
            // Update counter
            if (achievementsCount) {
                achievementsCount.textContent = unlockedCount;
            }

            // Update achievements display
            if (achievementsList) {
                if (achievements.length === 0) {
                    achievementsList.innerHTML = `
                        <div class="pf-v6-l-grid__item pf-m-12-col">
                            <div class="pf-v6-c-empty-state pf-m-sm">
                                <div class="pf-v6-c-empty-state__content">
                                    <h3 class="pf-v6-c-title pf-m-md">No achievements available</h3>
                                    <p class="pf-v6-c-content pf-m-sm">Complete races and activities to unlock achievements.</p>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    achievementsList.innerHTML = achievements.map(renderAchievementCard).join('');
                }
            }
        } catch (err) {
            console.error('[achievements] failed to load data:', err);
            const achievementsList = document.getElementById('achievements-list');
            const achievementsCount = document.getElementById('achievements-count');
            
            if (achievementsCount) {
                achievementsCount.textContent = '0';
            }
            
            if (achievementsList) {
                achievementsList.innerHTML = `
                    <div class="pf-v6-l-grid__item pf-m-12-col">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">Achievements unavailable</h3>
                                <p class="pf-v6-c-content pf-m-sm">Achievement tracking is not available at this time.</p>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }

    function renderAchievementCard(achievement) {
        const isUnlocked = !!achievement.unlocked;
        const progress = achievement.progress || 0;
        const requirement = achievement.requirement || 1;
        const progressPercent = Math.min(100, (progress / requirement) * 100);
        
        return `
            <div class="pf-v6-l-grid__item pf-m-12-col pf-m-6-col-on-md pf-m-4-col-on-lg">
                <div class="pf-v6-c-card achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
                    <div class="pf-v6-c-card__body">
                        <div class="pf-v6-l-flex pf-m-gap-md pf-m-align-items-start">
                            <div class="pf-v6-l-flex__item pf-m-flex-none">
                                <div class="achievement-icon ${isUnlocked ? 'unlocked' : ''}">
                                    <i class="${achievement.icon || 'fas fa-trophy'}" aria-hidden="true"></i>
                                </div>
                            </div>
                            <div class="pf-v6-l-flex__item">
                                <h3 class="pf-v6-c-title pf-m-md">${escapeHtml(achievement.name)}</h3>
                                <p class="pf-v6-c-content pf-m-sm">${escapeHtml(achievement.description)}</p>
                                ${!isUnlocked ? `
                                    <div class="achievement-progress">
                                        <div class="pf-v6-c-progress pf-m-sm">
                                            <div class="pf-v6-c-progress__bar" style="width: ${progressPercent}%"></div>
                                        </div>
                                        <div class="pf-v6-u-font-size-sm pf-v6-u-color-200">
                                            ${progress} / ${requirement}
                                        </div>
                                    </div>
                                ` : `
                                    <div class="pf-v6-u-font-size-sm pf-v6-u-success-color-100">
                                        <i class="fas fa-check pf-v6-u-mr-xs" aria-hidden="true"></i>
                                        Unlocked ${achievement.unlocked_at ? new Date(achievement.unlocked_at).toLocaleDateString() : ''}
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function loadPurchases() {
        console.log('[purchases] loading data');
        try {
            const data = await authenticatedRequest('/api/rewards/purchases');
            console.log('[purchases] payload:', data);

            const purchasesList = document.getElementById('purchases-list');
            const purchasesCount = document.getElementById('purchases-count');
            
            const purchases = data.purchases || [];
            
            // Update counter
            if (purchasesCount) {
                purchasesCount.textContent = purchases.length;
            }

            // Update purchases display
            if (purchasesList) {
                if (purchases.length === 0) {
                    purchasesList.innerHTML = `
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">No purchases yet</h3>
                                <p class="pf-v6-c-content pf-m-sm">Visit the Marketplace to purchase items with your points!</p>
                            </div>
                        </div>
                    `;
                } else {
                    purchasesList.innerHTML = `
                        <div class="pf-v6-l-grid pf-m-gutter">
                            ${purchases.map(renderPurchaseCard).join('')}
                        </div>
                    `;
                }
            }
        } catch (err) {
            console.error('[purchases] failed to load data:', err);
            const purchasesList = document.getElementById('purchases-list');
            const purchasesCount = document.getElementById('purchases-count');
            
            if (purchasesCount) {
                purchasesCount.textContent = '0';
            }
            
            if (purchasesList) {
                purchasesList.innerHTML = `
                    <div class="pf-v6-c-empty-state pf-m-sm">
                        <div class="pf-v6-c-empty-state__content">
                            <h3 class="pf-v6-c-title pf-m-md">Purchases unavailable</h3>
                            <p class="pf-v6-c-content pf-m-sm">Purchase history is not available at this time.</p>
                        </div>
                    </div>
                `;
            }
        }
    }

    function renderPurchaseCard(purchase) {
        const purchaseDate = new Date(purchase.purchased_at).toLocaleString();
        const isTicket = purchase.purchase_type === 'ticket';
        const iconClass = isTicket ? 'fas fa-ticket-alt' : 'fas fa-shopping-bag';
        const typeLabel = isTicket ? 'Race Ticket' : 'Marketplace Item';
        
        return `
            <div class="pf-v6-l-grid__item pf-m-12-col pf-m-6-col-on-lg">
                <div class="pf-v6-c-card pf-m-flat">
                    <div class="pf-v6-c-card__header">
                        <div class="pf-v6-l-flex pf-m-align-items-center pf-m-gap-sm">
                            <div class="pf-v6-l-flex__item">
                                <i class="${iconClass} pf-v6-u-color-200" aria-hidden="true"></i>
                            </div>
                            <div class="pf-v6-l-flex__item">
                                <h3 class="pf-v6-c-title pf-m-md">${escapeHtml(purchase.item_name)}</h3>
                                <span class="pf-v6-c-label pf-m-outline">${typeLabel}</span>
                            </div>
                        </div>
                    </div>
                    <div class="pf-v6-c-card__body">
                        <dl class="pf-v6-c-description-list pf-m-horizontal-on-sm">
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Payment Method</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    ${purchase.payment_method === 'points' ? 'Reward Points' : 'USDT'}
                                </dd>
                            </div>
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Amount</dt>
                                <dd class="pf-v6-c-description-list__description">
                                    ${purchase.payment_method === 'points' ? 
                                        `${purchase.points_paid} Points` : 
                                        `${purchase.payment_amount} ${purchase.payment_currency}`
                                    }
                                </dd>
                            </div>
                            <div class="pf-v6-c-description-list__group">
                                <dt class="pf-v6-c-description-list__term">Purchase Date</dt>
                                <dd class="pf-v6-c-description-list__description">${purchaseDate}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </div>
        `;
    }

    async function handlePaymentSubmit(event) {
        event.preventDefault();
        
        const paymentAmount = document.getElementById('payment-amount').value;
        const transactionHash = document.getElementById('payment-transaction-hash').value;
        const description = document.getElementById('payment-description').value;

        if (!paymentAmount || !transactionHash) {
            showAlert('payment-alert', 'Payment amount and transaction hash are required.', 'error');
            return;
        }

        try {
            showAlert('payment-alert', 'Submitting payment for verification...', 'info');
            
            const response = await authenticatedRequest('/api/rewards/wallet/payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payment_amount: parseFloat(paymentAmount),
                    transaction_hash: transactionHash.trim(),
                    description: description
                })
            });

            showAlert('payment-alert', response.message || 'Payment submitted successfully!', 'success');
            
            // Reset form
            document.getElementById('wallet-payment-form').reset();
            
            // Reload wallet data
            await loadWalletData();
            
        } catch (err) {
            console.error('Payment submission error:', err);
            showAlert('payment-alert', err.message || 'Failed to submit payment', 'error');
        }
    }

    async function handleBuyPoints(event) {
        event.preventDefault();
        
        const usdtAmount = document.getElementById('usdt-amount').value;
        
        if (!usdtAmount || parseFloat(usdtAmount) <= 0) {
            showAlert('buy-points-alert', 'Please enter a valid USDT amount.', 'error');
            return;
        }

        try {
            showAlert('buy-points-alert', 'Processing point purchase...', 'info');
            
            const response = await authenticatedRequest('/api/rewards/wallet/buy-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usdt_amount: parseFloat(usdtAmount)
                })
            });

            showAlert('buy-points-alert', response.message || 'Points purchased successfully!', 'success');
            
            // Reset form and close modal
            document.getElementById('buy-points-form').reset();
            hideModal('buy-points-modal');
            
            // Reload wallet and points data
            await loadWalletData();
            await loadPilotData(); // Refresh points display
            
        } catch (err) {
            console.error('Buy points error:', err);
            showAlert('buy-points-alert', err.message || 'Failed to purchase points', 'error');
        }
    }

    function showAlert(alertId, message, type) {
        const alertEl = document.getElementById(alertId);
        if (!alertEl) return;
        
        alertEl.className = `pf-v6-c-alert pf-m-inline pf-m-${type}`;
        alertEl.innerHTML = `
            <div class="pf-v6-c-alert__icon">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}" aria-hidden="true"></i>
            </div>
            <p class="pf-v6-c-alert__title">${escapeHtml(message)}</p>
        `;
        alertEl.classList.remove('hidden');
        
        if (type === 'success') {
            setTimeout(() => {
                alertEl.classList.add('hidden');
            }, 5000);
        }
    }

    function renderActivityItem(transaction) {
        const isEarned = transaction.amount > 0;
        const iconClass = isEarned ? 'earned' : 'spent';
        const icon = isEarned ? '+' : '-';
        const timeAgo = formatTimeAgo(transaction.created_at);

        return `
            <li class="activity-timeline-item">
                <div class="activity-icon ${iconClass}">
                    ${icon}
                </div>
                <div class="activity-details">
                    <div><strong>${escapeHtml(transaction.description || 'Transaction')}</strong></div>
                    <div>${icon}${Math.abs(transaction.amount)} points</div>
                    <div class="activity-time">${timeAgo}</div>
                </div>
            </li>
        `;
    }

    function renderMarketplaceItem(item) {
        const typeIcon = getItemTypeIcon(item.item_type);
        const hasStock = item.stock === -1 || item.stock > 0;
        const stockText = item.stock === -1 ? 'Unlimited' : `${item.stock} left`;
        const isLocked = item.is_locked === true;
        const isAvailable = hasStock && !isLocked;
        
        // Add locked class and styling for locked items
        const cardClasses = `pf-v6-c-card marketplace-item-card${isLocked ? ' marketplace-item-locked' : ''}`;
        const lockBadge = isLocked ? `<span class="pf-v6-c-label pf-m-gold item-badge">🔒 Unavailable</span>` : '';
        
        // Determine button state and text
        let buttonText, buttonClass, buttonDisabled;
        if (isLocked) {
            buttonText = 'Unavailable';
            buttonClass = 'pf-v6-c-button pf-m-secondary pf-m-block';
            buttonDisabled = 'disabled';
        } else if (!hasStock) {
            buttonText = 'Out of Stock';
            buttonClass = 'pf-v6-c-button pf-m-secondary pf-m-block';
            buttonDisabled = 'disabled';
        } else {
            buttonText = 'Purchase';
            buttonClass = 'pf-v6-c-button pf-m-primary pf-m-block';
            buttonDisabled = '';
        }

        return `
            <div class="pf-v6-l-gallery__item pf-m-12-col pf-m-6-col-on-md pf-m-4-col-on-lg">
                <div class="${cardClasses}" ${isLocked ? 'style="opacity: 0.6;"' : ''}>
                    ${item.item_type ? `<span class="pf-v6-c-label item-badge item-type-${item.item_type}">${escapeHtml(item.item_type)}</span>` : ''}
                    ${lockBadge}
                    <div class="item-image">
                        ${item.photo_url ? 
                            `<img src="${item.photo_url}" alt="${escapeHtml(item.name)}" class="marketplace-item-photo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` +
                            `<div class="item-icon-fallback" style="display: none;">${typeIcon}</div>` :
                            typeIcon
                        }
                    </div>
                    <div class="pf-v6-c-card__body">
                        <h3 class="pf-v6-c-title pf-m-md">${escapeHtml(item.name)}</h3>
                        <p class="pf-v6-c-content pf-m-sm">${escapeHtml(item.description || '')}</p>
                        <div class="item-price pf-v6-u-mt-md">
                            ${item.points_price ? `<span>${item.points_price} points</span>` : ''}
                            ${item.usdt_price ? `<span>or ${item.usdt_price} USDT</span>` : ''}
                        </div>
                        <div class="item-stock pf-v6-u-mt-sm">${stockText}</div>
                        ${isLocked ? '<div class="pf-v6-u-mt-sm"><small class="pf-v6-u-color-200">This item is currently locked by administrators</small></div>' : ''}
                    </div>
                    <div class="pf-v6-c-card__footer">
                        <button type="button" class="${buttonClass}"
                                data-item-id="${item.item_id}"
                                ${buttonDisabled}>
                            ${buttonText}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function openPurchaseModal(item) {
        console.log('🔧 Opening purchase modal for item:', item);
        // Check if this is a ticket item
        if (item.item_type === 'ticket') {
            console.log('🔧 Item is a ticket, opening ticket modal');
            openTicketPurchaseModal(item);
            return;
        }

        const modal = document.getElementById('purchase-item-modal');
        const title = document.getElementById('purchase-item-title');
        const details = document.getElementById('purchase-item-details');
        const confirmBtn = document.getElementById('confirm-purchase-btn');

        if (!modal || !title || !details || !confirmBtn) {
            console.error('🔧 Missing modal elements:', { modal: !!modal, title: !!title, details: !!details, confirmBtn: !!confirmBtn });
            return;
        }

        console.log('🔧 All modal elements found, setting up modal');

        title.textContent = `Purchase ${item.name}`;

        const currentPoints = pilotPoints?.current_points || 0;
        const canAffordPoints = item.points_price ? currentPoints >= item.points_price : false;

        details.innerHTML = `
            <div class="pf-v6-c-content">
                <p>${escapeHtml(item.description || '')}</p>
                <dl class="pf-v6-c-description-list pf-v6-u-mt-md">
                    ${item.points_price ? `
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Price (Points)</dt>
                            <dd class="pf-v6-c-description-list__description">${item.points_price} points</dd>
                        </div>
                    ` : ''}
                    ${item.usdt_price ? `
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Price (USDT)</dt>
                            <dd class="pf-v6-c-description-list__description">${item.usdt_price} USDT</dd>
                        </div>
                    ` : ''}
                    <div class="pf-v6-c-description-list__group">
                        <dt class="pf-v6-c-description-list__term">Your Balance</dt>
                        <dd class="pf-v6-c-description-list__description">${currentPoints} points</dd>
                    </div>
                </dl>
                ${!canAffordPoints && item.points_price ? '<p class="pf-v6-u-danger-color-100 pf-v6-u-mt-md">Insufficient points</p>' : ''}
            </div>
        `;

        confirmBtn.disabled = !canAffordPoints && !item.usdt_price;
        confirmBtn.onclick = () => handlePurchaseItem(item);

        showModal('purchase-item-modal');
    }

    function openTicketPurchaseModal(item) {
        console.log('🔧 Opening ticket purchase modal for item:', item);
        const modal = document.getElementById('purchase-ticket-modal');
        const title = document.getElementById('purchase-ticket-title');
        const details = document.getElementById('ticket-item-details');

        if (!modal || !title || !details) {
            console.error('🔧 Missing ticket modal elements:', { modal: !!modal, title: !!title, details: !!details });
            return;
        }

        console.log('🔧 All ticket modal elements found, setting up modal');

        // Store the item ID in the modal for later use
        modal.dataset.currentItemId = item.item_id;

        title.textContent = `Purchase ${item.name}`;
        details.innerHTML = `
            <div class="pf-v6-c-content">
                <p>${escapeHtml(item.description || '')}</p>
                <dl class="pf-v6-c-description-list pf-v6-u-mt-md">
                    <div class="pf-v6-c-description-list__group">
                        <dt class="pf-v6-c-description-list__term">Duration</dt>
                        <dd class="pf-v6-c-description-list__description">${item.metadata?.minutes || 0} minutes</dd>
                    </div>
                    ${item.points_price ? `
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Price (Points)</dt>
                            <dd class="pf-v6-c-description-list__description">${item.points_price} points</dd>
                        </div>
                    ` : ''}
                    ${item.usdt_price ? `
                        <div class="pf-v6-c-description-list__group">
                            <dt class="pf-v6-c-description-list__term">Price (USDT)</dt>
                            <dd class="pf-v6-c-description-list__description">${item.usdt_price} USDT</dd>
                        </div>
                    ` : ''}
                </dl>
            </div>
        `;

        // Pre-fill pilot name from profile
        const pilotNameInput = document.getElementById('ticket-pilot-name');
        if (pilotNameInput && pilotProfile?.display_name) {
            pilotNameInput.value = pilotProfile.display_name;
        }

        console.log('🔧 Showing ticket modal');
        showModal('purchase-ticket-modal');
    }

    function getItemTypeIcon(type) {
        const icons = {
            vehicle: '🏎️',
            feature: '⚙️',
            cosmetic: '🎨',
            boost: '⚡',
            ticket: '🎫'
        };
        return icons[type] || '📦';
    }

    async function handlePurchaseItem(item) {
        try {
            showNotification('Processing purchase...', 'info');

            await authenticatedRequest('/api/rewards/purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: item.item_id,
                    payment_method: 'points'
                })
            });

            hideModal('purchase-item-modal');
            showNotification('Purchase successful!', 'success');

            // Reload data
            await loadPilotData();
        } catch (err) {
            console.error('Purchase failed:', err);
            showNotification(err.message || 'Purchase failed', 'danger');
        }
    }

    async function loadAchievements() {
        try {
            const data = await authenticatedRequest('/api/rewards/achievements');
            const container = document.getElementById('achievements-list');

            if (!container) return;

            if (!data?.achievements || data.achievements.length === 0) {
                container.innerHTML = `
                    <div class="pf-v6-l-grid__item pf-m-12-col">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">No achievements available</h3>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            container.innerHTML = data.achievements.map(renderAchievement).join('');
        } catch (err) {
            console.warn('Failed to load achievements:', err.message);
            // Show empty state instead of error
            const container = document.getElementById('achievements-list');
            if (container) {
                container.innerHTML = `
                    <div class="pf-v6-l-grid__item pf-m-12-col">
                        <div class="pf-v6-c-empty-state pf-m-sm">
                            <div class="pf-v6-c-empty-state__content">
                                <h3 class="pf-v6-c-title pf-m-md">Achievements unavailable</h3>
                                <p class="pf-v6-c-content pf-m-sm">Achievement system is not available at this time.</p>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }

    function renderAchievement(achievement) {
        const unlocked = achievement.unlocked_at != null;
        const progress = achievement.progress || 0;
        const requirement = achievement.requirement_value?.target || 100;
        const progressPercent = Math.min((progress / requirement) * 100, 100);

        return `
            <div class="pf-v6-l-grid__item pf-m-12-col pf-m-6-col-on-lg">
                <div class="pf-v6-c-card achievement-card ${unlocked ? 'unlocked' : 'locked'}">
                    <div class="pf-v6-c-card__body">
                        <div class="pf-v6-l-flex pf-m-space-items-md">
                            <div class="achievement-icon ${unlocked ? 'unlocked' : ''}">
                                ${achievement.icon || '🏆'}
                            </div>
                            <div class="pf-v6-l-flex__item pf-m-flex-1">
                                <h3 class="pf-v6-c-title pf-m-md">${escapeHtml(achievement.name)}</h3>
                                <p class="pf-v6-c-content pf-m-sm">${escapeHtml(achievement.description || '')}</p>
                                ${achievement.points_reward ? `<p class="pf-v6-u-font-weight-bold pf-v6-u-color-200">Reward: ${achievement.points_reward} points</p>` : ''}
                                ${!unlocked ? `
                                    <div class="achievement-progress">
                                        <div class="pf-v6-c-progress pf-m-sm">
                                            <div class="pf-v6-c-progress__bar" style="width: ${progressPercent}%"></div>
                                        </div>
                                        <div class="pf-v6-u-font-size-sm pf-v6-u-color-200">${progress} / ${requirement}</div>
                                    </div>
                                ` : `<span class="pf-v6-c-label pf-m-green">Unlocked</span>`}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }


    function updatePointsPreview() {
        const usdtInput = document.getElementById('usdt-amount');
        const preview = document.getElementById('points-preview');

        if (!usdtInput || !preview) return;

        const usdtAmount = parseFloat(usdtInput.value) || 0;
        const points = Math.floor(usdtAmount * POINTS_PER_USDT);

        preview.textContent = points.toLocaleString();
    }

    async function handleBuyPoints(event) {
        event.preventDefault();

        const usdtAmount = parseFloat(document.getElementById('usdt-amount').value);

        if (!usdtAmount || usdtAmount <= 0) {
            showNotification('Please enter a valid USDT amount', 'warning');
            return;
        }

        try {
            showNotification('Processing purchase...', 'info');

            await authenticatedRequest('/api/rewards/points/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usdt_amount: usdtAmount })
            });

            hideModal('buy-points-modal');
            showNotification(`Successfully purchased ${usdtAmount * POINTS_PER_USDT} points!`, 'success');

            // Reload data
            await loadPilotData();

            // Reset form
            document.getElementById('buy-points-form').reset();
            updatePointsPreview();
        } catch (err) {
            console.error('Failed to buy points:', err);
            showNotification(err.message || 'Failed to purchase points', 'danger');
        }
    }

    async function handleTicketPurchase(event) {
        event.preventDefault();

        const pilotName = document.getElementById('ticket-pilot-name').value.trim();
        const eventName = document.getElementById('ticket-event-name').value.trim();
        const eventDate = document.getElementById('ticket-event-date').value;
        const paymentAmount = parseFloat(document.getElementById('ticket-payment-amount').value);
        const transactionHash = document.getElementById('ticket-transaction-hash').value.trim();

        if (!pilotName || !eventName || !transactionHash || !paymentAmount) {
            showNotification('Please fill in all required fields', 'warning');
            return;
        }

        if (paymentAmount <= 0) {
            showNotification('Payment amount must be greater than 0', 'warning');
            return;
        }

        try {
            showNotification('Processing ticket purchase...', 'info');

            // Get the current ticket item from the modal context
            const ticketModal = document.getElementById('purchase-ticket-modal');
            const itemId = ticketModal.dataset.currentItemId;

            await authenticatedRequest('/api/tickets/purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticket_type: 'race-pass',
                    pilot_name: pilotName,
                    event_name: eventName,
                    event_date: eventDate || null,
                    payment_amount: paymentAmount,
                    payment_currency: 'USDT',
                    payment_reference: transactionHash,
                    package_id: itemId ? itemId.replace('ticket-', '') : '',
                    wallet_address: pilotProfile?.wallet_address || ''
                })
            });

            hideModal('purchase-ticket-modal');
            showNotification('Ticket submitted successfully! Payment will be verified by race control.', 'success');

            // Reset form
            document.getElementById('purchase-ticket-form').reset();

            // Reload pilot data to show new ticket
            await loadPilotData();
        } catch (err) {
            console.error('Ticket purchase failed:', err);
            showNotification(err.message || 'Failed to submit ticket purchase', 'danger');
        }
    }

    async function handlePaymentSubmit(event) {
        event.preventDefault();

        const amount = parseFloat(document.getElementById('payment-amount').value);
        const transactionHash = document.getElementById('payment-transaction-hash').value.trim();
        const description = document.getElementById('payment-description').value.trim();

        if (!amount || !transactionHash) {
            showPaymentAlert('Please fill in amount and transaction hash', 'warning');
            return;
        }

        if (amount <= 0) {
            showPaymentAlert('Payment amount must be greater than 0', 'warning');
            return;
        }

        try {
            showPaymentAlert('Processing payment verification...', 'info');

            await authenticatedRequest('/api/rewards/wallet/payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payment_amount: amount,
                    transaction_hash: transactionHash,
                    description: description || 'Wallet payment',
                    currency: 'USDT'
                })
            });

            showPaymentAlert('Payment submitted for verification!', 'success');

            // Reset form
            document.getElementById('wallet-payment-form').reset();
        } catch (err) {
            console.error('Payment submission failed:', err);
            showPaymentAlert(err.message || 'Failed to submit payment', 'danger');
        }
    }

    function showPaymentAlert(message, type = 'info') {
        const alert = document.getElementById('payment-alert');
        if (!alert) return;

        const variantMap = {
            success: 'success',
            error: 'danger',
            warning: 'warning',
            info: 'info'
        };
        const variant = variantMap[type] || variantMap.info;

        alert.className = `pf-v6-c-alert pf-m-inline pf-m-${variant}`;
        alert.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;
        alert.classList.remove('hidden');
    }

    function hidePaymentAlert() {
        const alert = document.getElementById('payment-alert');
        if (alert) {
            alert.innerHTML = '';
            alert.className = 'pf-v6-c-alert pf-m-inline hidden';
        }
    }

    // Utility functions
    async function loadPublicConfig() {
        console.log('🔧 Loading public config...');
        try {
            const response = await fetch('/api/public-config');
            if (!response.ok) {
                console.error('🔧 Public config request failed:', response.status, response.statusText);
                throw new Error('Failed to load configuration');
            }
            const config = await response.json();
            console.log('🔧 Public config response:', config);
            return config;
        } catch (err) {
            console.warn('🔧 Public config not available, using defaults:', err.message);
            // Return default config with fallback minute packages
            return {
                payments: {
                    minutePackages: [
                        { id: 'PKG-S10', label: 'Sprint 10 minutos', minutes: 10 },
                        { id: 'PKG-S20', label: 'Endurance 20 minutos', minutes: 20 },
                        { id: 'PKG-S30', label: 'Maratona 30 minutos', minutes: 30 }
                    ]
                },
                supabase: null
            };
        }
    }

    async function authenticatedRequest(url, options = {}) {
        if (!currentSession?.access_token) {
            throw new Error('Authentication required');
        }

        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${currentSession.access_token}`
        };

        const response = await fetch(url, { ...options, headers });

        let result = null;
        try {
            result = await response.json();
        } catch (err) {
            result = null;
        }

        if (!response.ok) {
            console.error('Request failed:', result);
            throw new Error(result?.error || response.statusText || 'Request failed');
        }

        return result ?? {};
    }

    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            console.log('🔧 Showing modal:', modalId);
            console.log('🔧 Modal element:', modal);
            console.log('🔧 Modal tag name:', modal.tagName);
            console.log('🔧 Modal classes before:', modal.className);
            console.log('🔧 Modal children:', modal.children.length);
            for (let i = 0; i < modal.children.length; i++) {
                console.log('🔧 Child', i, ':', modal.children[i].tagName, modal.children[i].className);
            }

            modal.classList.remove('hidden');
            console.log('🔧 Modal classes after:', modal.className);

            // Try multiple approaches to make it visible
            modal.style.display = 'flex !important';
            modal.style.position = 'fixed !important';
            modal.style.top = '0 !important';
            modal.style.left = '0 !important';
            modal.style.width = '100% !important';
            modal.style.height = '100% !important';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5) !important';
            modal.style.zIndex = '9999 !important';
            modal.style.alignItems = 'center !important';
            modal.style.justifyContent = 'center !important';

            // Also try setting visibility and opacity
            modal.style.visibility = 'visible !important';
            modal.style.opacity = '1 !important';

            // Also style the modal content
            const modalContent = modal.querySelector('.pf-v6-c-modal-box') || modal.querySelector('.pf-c-modal-box');
            if (modalContent) {
                console.log('🔧 Found modal content, styling it');
                modalContent.style.display = 'block !important';
                modalContent.style.background = 'white !important';
                modalContent.style.borderRadius = '4px !important';
                modalContent.style.boxShadow = '0 8px 24px rgba(3, 3, 3, 0.12) !important';
                modalContent.style.maxHeight = '90vh !important';
                modalContent.style.overflowY = 'auto !important';
                modalContent.style.zIndex = '10000 !important';
                modalContent.style.position = 'relative !important';
                modalContent.style.width = '40% !important';
                modalContent.style.maxWidth = '40% !important';
                modalContent.style.minWidth = '400px !important';
                modalContent.style.visibility = 'visible !important';
                modalContent.style.opacity = '1 !important';
            } else {
                console.log('🔧 Modal content not found with .pf-v6-c-modal-box or .pf-c-modal-box');
                // Try alternative selectors
                const alternativeContent = modal.querySelector('.pf-v6-l-bullseye') || modal.querySelector('.pf-l-bullseye') || modal.querySelector('div');
                if (alternativeContent) {
                    console.log('🔧 Found alternative modal content:', alternativeContent.className);
                    alternativeContent.style.display = 'flex !important';
                    alternativeContent.style.alignItems = 'center !important';
                    alternativeContent.style.justifyContent = 'center !important';
                    alternativeContent.style.width = '100% !important';
                    alternativeContent.style.height = '100% !important';
                }
            }

            console.log('🔧 Applied forced styles');
            console.log('🔧 Modal visibility after show:', modal.classList.contains('hidden'));
            console.log('🔧 Modal computed display:', window.getComputedStyle(modal).display);
        } else {
            console.error('🔧 Modal not found:', modalId);
            console.log('🔧 Available modals:');
            document.querySelectorAll('[id*="modal"]').forEach(el => {
                console.log('🔧 -', el.id, el.className);
            });
            alert(`Modal ${modalId} not found! Check console for available modals.`);
        }
    }

    function hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            console.log('🔧 Hiding modal:', modalId);
            modal.classList.add('hidden');

            // Also remove modal content styles
            const modalContent = modal.querySelector('.pf-v6-c-modal-box') || modal.querySelector('.pf-c-modal-box');
            if (modalContent) {
                modalContent.style.display = '';
                modalContent.style.background = '';
                modalContent.style.borderRadius = '';
                modalContent.style.boxShadow = '';
                modalContent.style.maxHeight = '';
                modalContent.style.overflowY = '';
                modalContent.style.zIndex = '';
                modalContent.style.position = '';
                modalContent.style.width = '';
                modalContent.style.maxWidth = '';
                modalContent.style.minWidth = '';
                modalContent.style.visibility = '';
                modalContent.style.opacity = '';
            }

            // Also clean up alternative content styles
            const alternativeContent = modal.querySelector('.pf-v6-l-bullseye') || modal.querySelector('.pf-l-bullseye') || modal.querySelector('div');
            if (alternativeContent) {
                alternativeContent.style.display = '';
                alternativeContent.style.alignItems = '';
                alternativeContent.style.justifyContent = '';
                alternativeContent.style.width = '';
                alternativeContent.style.height = '';
            }

            // Remove inline styles
            modal.style.display = '';
            modal.style.position = '';
            modal.style.top = '';
            modal.style.left = '';
            modal.style.width = '';
            modal.style.height = '';
            modal.style.backgroundColor = '';
            modal.style.zIndex = '';
            modal.style.alignItems = '';
            modal.style.justifyContent = '';
            modal.style.visibility = '';
            modal.style.opacity = '';

            console.log('🔧 Modal hidden, visibility after hide:', !modal.classList.contains('hidden'));
        } else {
            console.error('🔧 Modal not found for hiding:', modalId);
        }
    }

    // Show notification to user
    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to notifications container
        const container = document.getElementById('notifications') || document.body;
        container.appendChild(notification);
        
        // Auto-remove after delay
        setTimeout(() => {
            notification.classList.add('show');
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 5000);
        }, 100);
    }

    // Utility functions
    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    function formatTimeAgo(dateString) {
        if (!dateString) return 'Unknown time';

        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
        return `${Math.floor(diffInSeconds / 86400)} days ago`;
    }

    // User menu dropdown handling
    function initializeUserMenu() {
        const userMenuToggle = document.getElementById('user-menu-toggle');
        const userMenuDropdown = document.getElementById('user-menu');
        const dropdownLogoutBtn = document.getElementById('dropdown-logout-btn');

        if (userMenuToggle && userMenuDropdown) {
            userMenuToggle.addEventListener('click', function(event) {
                event.preventDefault();
                const menu = userMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                const isExpanded = userMenuToggle.getAttribute('aria-expanded') === 'true';
                
                userMenuToggle.setAttribute('aria-expanded', !isExpanded);
                menu.hidden = isExpanded;
                
                if (!isExpanded) {
                    // Focus first menu item when opening
                    const firstItem = menu.querySelector('a, button');
                    if (firstItem) {
                        setTimeout(() => firstItem.focus(), 0);
                    }
                }
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', function(event) {
                if (!userMenuDropdown.contains(event.target)) {
                    const menu = userMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                    userMenuToggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                }
            });

            // Handle keyboard navigation
            userMenuDropdown.addEventListener('keydown', function(event) {
                const menu = userMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                const isOpen = userMenuToggle.getAttribute('aria-expanded') === 'true';
                
                if (event.key === 'Escape' && isOpen) {
                    userMenuToggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                    userMenuToggle.focus();
                }
            });
        }

        // Handle dropdown logout button
        if (dropdownLogoutBtn) {
            dropdownLogoutBtn.addEventListener('click', function(event) {
                event.preventDefault();
                handleLogout();
            });
        }

        // Also handle legacy logout button for fallback
        const legacyLogoutBtn = document.getElementById('logout-btn');
        if (legacyLogoutBtn) {
            legacyLogoutBtn.addEventListener('click', function(event) {
                event.preventDefault();
                handleLogout();
            });
        }
    }

    function handleLogout() {
        if (window.sessionManager) {
            window.sessionManager.signOut();
        } else {
            // Fallback
            window.location.href = '/';
        }
    }

    function updateUserMenu(pilotData) {
        const userMenu = document.getElementById('user-menu');
        const userMenuName = document.getElementById('user-menu-name');
        const userMenuPoints = document.getElementById('user-menu-points');
        const authFallback = document.getElementById('auth-fallback');

        // Avatar elements (checking both old and new user menu systems)
        const userAvatar = document.getElementById('user-avatar');
        const rewardsDropdownAvatar = document.getElementById('rewards-dropdown-avatar');
        const rewardsDropdownName = document.getElementById('rewards-dropdown-name');
        const rewardsDropdownEmail = document.getElementById('rewards-dropdown-email');

        if (pilotData && userMenu && userMenuName && userMenuPoints) {
            // Update user menu with pilot data
            userMenuName.textContent = pilotData.display_name || 'Pilot';
            userMenuPoints.textContent = (pilotData.points || 0).toLocaleString();
            
            // Update avatars with profile photo (for old user menu system)
            if (pilotData.photo_url) {
                if (userAvatar) {
                    userAvatar.src = pilotData.photo_url;
                }
                if (rewardsDropdownAvatar) {
                    rewardsDropdownAvatar.src = pilotData.photo_url;
                }
            }
            
            // Update dropdown user info (for old user menu system)
            if (rewardsDropdownName) {
                rewardsDropdownName.textContent = pilotData.display_name || 'Pilot';
            }
            if (rewardsDropdownEmail && currentSession?.user?.email) {
                rewardsDropdownEmail.textContent = currentSession.user.email;
            }
            
            // Update header avatar dropdown (for new system) - this is now handled by renderPilotProfile
            // updateHeaderAvatar(pilotData.display_name, pilotData.photo_url);
            
            // Show user menu, hide fallback
            userMenu.classList.remove('hidden');
            if (authFallback) authFallback.classList.add('hidden');
        } else {
            // Hide user menu, show fallback
            if (userMenu) userMenu.classList.add('hidden');
            if (authFallback) authFallback.classList.remove('hidden');
            
            // Only hide header avatar dropdown if user is not authenticated
            // If user is authenticated but pilot data is missing, keep avatar dropdown visible
            if (!currentSession) {
                const avatarDropdown = document.getElementById('user-avatar-dropdown');
                if (avatarDropdown) {
                    avatarDropdown.classList.add('hidden');
                }
            } else {
                // User is authenticated but pilot data is missing
                // Note: Don't call updateHeaderAvatar here as it's handled by renderPilotProfile
                // User authenticated but no pilot data or missing user menu elements
            }
        }
    }

    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) {
            return '';
        }
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function handleAvatarDropdown(event) {
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

    function closeAvatarDropdown() {
        const dropdown = document.getElementById('user-avatar-dropdown');
        const menu = dropdown?.querySelector('.pf-v6-c-menu__list');
        const toggle = document.getElementById('user-avatar-toggle');
        
        if (menu && toggle) {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
        }
    }

    function updateHeaderAvatar(displayName, photoUrl) {
        // Update header avatar image
        const headerAvatar = document.getElementById('header-user-avatar');
        const dropdownAvatar = document.getElementById('dropdown-user-avatar');
        
        if (headerAvatar && photoUrl) {
            headerAvatar.src = photoUrl;
        }
        if (dropdownAvatar && photoUrl) {
            dropdownAvatar.src = photoUrl;
        }

        // Update user name in header
        const headerUserName = document.getElementById('header-user-name');
        const dropdownUserName = document.getElementById('dropdown-user-name');
        
        if (headerUserName && displayName) {
            headerUserName.textContent = displayName;
        }
        if (dropdownUserName && displayName) {
            dropdownUserName.textContent = displayName;
        }

        // Update user email in dropdown
        const dropdownUserEmail = document.getElementById('dropdown-user-email');
        if (dropdownUserEmail && currentSession?.user?.email) {
            dropdownUserEmail.textContent = currentSession.user.email;
        }

        // Show avatar dropdown when authenticated
        const avatarDropdown = document.getElementById('user-avatar-dropdown');
        if (avatarDropdown && currentSession) {
            avatarDropdown.classList.remove('hidden');
        }
    }

    function initializeUserMenu() {
        // Set up user menu dropdown functionality
        const userMenuToggle = document.getElementById('user-menu-toggle');
        const userMenu = document.getElementById('user-menu');
        
        if (userMenuToggle && userMenu) {
            userMenuToggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const menu = userMenu.querySelector('.pf-v6-c-dropdown__menu');
                if (menu) {
                    const isHidden = menu.hasAttribute('hidden');
                    if (isHidden) {
                        menu.removeAttribute('hidden');
                        userMenuToggle.setAttribute('aria-expanded', 'true');
                    } else {
                        menu.setAttribute('hidden', '');
                        userMenuToggle.setAttribute('aria-expanded', 'false');
                    }
                }
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            if (userMenu) {
                const menu = userMenu.querySelector('.pf-v6-c-dropdown__menu');
                if (menu && !menu.hasAttribute('hidden')) {
                    menu.setAttribute('hidden', '');
                    if (userMenuToggle) {
                        userMenuToggle.setAttribute('aria-expanded', 'false');
                    }
                }
            }
        });

        // Handle logout button
        const logoutBtn = document.getElementById('dropdown-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if (supabaseClient) {
                    await supabaseClient.auth.signOut();
                }
            });
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        initializeUserMenu();
        if (typeof initializeApp === 'function') {
            initializeApp();
        }
    });
})();








