(() => {
    let supabaseClient = null;
    let currentSession = null;
    let serverSession = null;
    let userGroups = [];
    let rbacUnsubscribe = null;
    let tickets = [];
    let devices = [];
    let registrations = [];
    let pilots = [];
    let purchases = [];
    let walletPayments = [];
    let paymentSettings = { wallet_address: '' };
    const ticketFilters = {
        status: 'all',
        includeArchived: false
    };
    const purchasesFilters = {
        pilotId: 'all'
    };
    const walletPaymentsFilters = {
        status: 'all'
    };
    const REQUIRED_GROUP = 'pitlane';

    const els = {
        loginForm: document.getElementById('admin-login-form'),
        loginEmail: document.getElementById('admin-login-email'),
        loginPassword: document.getElementById('admin-login-password'),
        registerBtn: document.getElementById('admin-register-btn'),
        logoutBtn: document.getElementById('admin-logout-btn'),
        authAlert: document.getElementById('admin-auth-alert'),
        authEmail: document.getElementById('admin-auth-email'),
        authEmailInline: document.getElementById('admin-auth-email-inline'),
        loggedInActions: document.getElementById('admin-logged-in-actions'),
        toolsSection: document.getElementById('admin-tools-section'),
        refreshAllBtn: document.getElementById('refresh-admin-data'),
        refreshRegistrationsBtn: document.getElementById('refresh-registrations'),
        ticketsTableBody: document.getElementById('tickets-table-body'),
        ticketsAlert: document.getElementById('admin-tickets-alert'),
        ticketsSummary: document.getElementById('tickets-summary'),
        ticketsStatusFilter: document.getElementById('ticket-status-filter'),
        ticketsArchivedToggle: document.getElementById('ticket-show-archived'),
        walletForm: document.getElementById('wallet-settings-form'),
        walletInput: document.getElementById('payment-wallet-address'),
        walletAlert: document.getElementById('wallet-settings-alert'),
        walletAddressDisplay: document.getElementById('wallet-address-display'),
        walletQrCanvas: document.getElementById('wallet-qr-canvas'),
        assignmentForm: document.getElementById('assignment-form'),
        assignmentTicket: document.getElementById('assignment-ticket'),
        assignmentDevice: document.getElementById('assignment-device'),
        assignmentNotes: document.getElementById('assignment-notes'),
        assignmentAlert: document.getElementById('assignment-alert'),
        assignmentsSummary: document.getElementById('assignments-summary'),
        registrationsList: document.getElementById('registrations-list'),
        registrationsAlert: document.getElementById('registrations-alert'),
        refreshPurchasesBtn: document.getElementById('refresh-admin-purchases'),
        purchasesTableBody: document.getElementById('admin-purchases-table-body'),
        purchasesAlert: document.getElementById('admin-purchases-alert'),
        purchasesSummary: document.getElementById('purchases-summary'),
        purchasesPilotFilter: document.getElementById('purchases-pilot-filter'),
        refreshWalletPaymentsBtn: document.getElementById('refresh-wallet-payments'),
        walletPaymentsTableBody: document.getElementById('wallet-payments-table-body'),
        walletPaymentsAlert: document.getElementById('wallet-payments-alert'),
        walletPaymentsSummary: document.getElementById('wallet-payments-summary'),
        walletPaymentsStatusFilter: document.getElementById('wallet-payments-status-filter')
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        attachListeners();
        loadConfiguration();
    }

    function attachListeners() {
        if (els.loginForm) {
            els.loginForm.addEventListener('submit', handleSignIn);
        }

        if (els.registerBtn) {
            els.registerBtn.addEventListener('click', handleRegister);
        }

        if (els.logoutBtn) {
            els.logoutBtn.addEventListener('click', handleLogout);
        }

        if (els.refreshAllBtn) {
            els.refreshAllBtn.addEventListener('click', () => refreshAdminData(true));
        }

        if (els.refreshRegistrationsBtn) {
            els.refreshRegistrationsBtn.addEventListener('click', () => loadRegistrations(true));
        }

        if (els.refreshPurchasesBtn) {
            els.refreshPurchasesBtn.addEventListener('click', () => loadPurchases(true));
        }

        if (els.purchasesPilotFilter) {
            els.purchasesPilotFilter.addEventListener('change', () => {
                purchasesFilters.pilotId = els.purchasesPilotFilter.value;
                renderPurchases();
            });
        }

        if (els.refreshWalletPaymentsBtn) {
            els.refreshWalletPaymentsBtn.addEventListener('click', () => loadWalletPayments(true));
        }

        if (els.walletPaymentsStatusFilter) {
            els.walletPaymentsStatusFilter.addEventListener('change', () => {
                walletPaymentsFilters.status = els.walletPaymentsStatusFilter.value;
                renderWalletPayments();
            });
        }

        if (els.walletForm) {
            els.walletForm.addEventListener('submit', handleWalletSubmit);
        }

        if (els.ticketsStatusFilter) {
            els.ticketsStatusFilter.addEventListener('change', () => {
                ticketFilters.status = els.ticketsStatusFilter.value;
                reloadTickets(true);
            });
        }

        if (els.ticketsArchivedToggle) {
            els.ticketsArchivedToggle.addEventListener('change', () => {
                ticketFilters.includeArchived = els.ticketsArchivedToggle.checked;
                reloadTickets(true);
            });
        }

        if (els.assignmentForm) {
            els.assignmentForm.addEventListener('submit', handleAssignmentSubmit);
        }

        if (els.ticketsTableBody) {
            els.ticketsTableBody.addEventListener('click', (event) => {
                // Handle all ticket actions with unified system
                const button = event.target.closest('.ticket-action, .ticket-admin-action');
                if (!button) {
                    return;
                }
                
                const ticketId = button.dataset.ticketId;
                if (!ticketId) {
                    return;
                }

                // Handle archive actions
                const archiveAction = button.dataset.archiveAction;
                if (archiveAction) {
                    const shouldArchive = archiveAction === 'archive';
                    toggleTicketArchive(ticketId, shouldArchive);
                    return;
                }

                // Handle all other actions (regular status changes and admin approvals)
                const action = button.dataset.action;
                const isAdminApproval = button.dataset.adminApproval === 'true';
                
                if (!action) {
                    return;
                }

                if (isAdminApproval) {
                    // Handle admin approval/rejection with reason prompt
                    handleTicketAdminAction(ticketId, action);
                } else {
                    // Handle regular status changes
                    updateTicketStatus(ticketId, action);
                }
            });
        }

        if (els.registrationsList) {
            els.registrationsList.addEventListener('click', (event) => {
                const button = event.target.closest('.registration-action');
                if (!button) {
                    return;
                }
                const { registrationId, action } = button.dataset;
                if (!registrationId || !action) {
                    return;
                }
                updateRegistrationStatus(registrationId, action);
            });
        }

        // Add event delegation for copy buttons
        document.addEventListener('click', (event) => {
            const copyButton = event.target.closest('.copy-button');
            if (copyButton) {
                event.preventDefault();
                const copyValue = copyButton.getAttribute('data-copy-value');
                if (copyValue) {
                    copyToClipboard(copyValue, copyButton);
                }
            }
        });
    }

    async function loadConfiguration() {
        try {
            const config = await loadPublicConfig();
            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                setAlert(els.authAlert, 'Supabase credentials are missing. Configure environment variables before using admin tools.', 'error');
                disableAdminUI();
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
                    const sessionEmail = snapshotSession?.user?.email;
                    if (sessionEmail) {
                        if (els.authEmail) {
                            els.authEmail.textContent = sessionEmail;
                        }
                        if (els.authEmailInline) {
                            els.authEmailInline.textContent = sessionEmail;
                        }
                    }
                });
            }

            const { data } = await supabaseClient.auth.getSession();
            await handleSessionChange(data?.session ?? null);

            supabaseClient.auth.onAuthStateChange(async (_event, session) => {
                await handleSessionChange(session ?? null);
            });
        } catch (err) {
            console.error('Failed to load admin configuration:', err);
            setAlert(els.authAlert, 'Unable to initialise admin console. Refresh the page or check the server logs.', 'error');
            disableAdminUI();
        }
    }

    function disableAdminUI() {
        if (els.loginForm) {
            Array.from(els.loginForm.elements).forEach(el => el.disabled = true);
        }
        if (els.assignmentForm) {
            Array.from(els.assignmentForm.elements).forEach(el => el.disabled = true);
        }
        if (els.refreshAllBtn) {
            els.refreshAllBtn.disabled = true;
        }
        if (els.refreshRegistrationsBtn) {
            els.refreshRegistrationsBtn.disabled = true;
        }
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

        toggleSection(els.loginForm, !isAuthenticated);
        toggleSection(els.loggedInActions, isAuthenticated && hasAccess);
        toggleSection(els.toolsSection, isAuthenticated && hasAccess);

        if (els.authAlert) {
            hideAlert(els.authAlert);
        }

        if (isAuthenticated) {
            syncTicketFiltersToUI();
            const email =
                serverSession?.user?.email ||
                session.user?.email ||
                'Unknown email';
            if (els.authEmail) {
                els.authEmail.textContent = email;
            }
            if (els.authEmailInline) {
                els.authEmailInline.textContent = email;
            }
            if (!hasAccess) {
                setAlert(els.authAlert, 'Your account does not have Pitlane access.', 'warning');
                toggleSection(els.authAlert, true);
                return;
            }
            refreshAdminData(false);
            loadAdminPilotData();
        } else {
            if (window.FPVRBAC) {
                window.FPVRBAC.clearSession();
            }
            ticketFilters.status = 'all';
            ticketFilters.includeArchived = false;
            purchasesFilters.pilotId = 'all';
            walletPaymentsFilters.status = 'all';
            syncTicketFiltersToUI();
            tickets = [];
            devices = [];
            registrations = [];
            pilots = [];
            purchases = [];
            walletPayments = [];
            paymentSettings = { wallet_address: '' };
            renderTickets();
            renderWalletSettings();
            renderAssignmentOptions();
            renderRegistrations();
            renderPurchases();
            renderWalletPayments();
            if (els.loginForm) {
                els.loginForm.reset();
            }
            els.authEmail.textContent = 'guest';
            if (els.authEmailInline) {
                els.authEmailInline.textContent = 'guest';
            }
        }
    }

    async function handleSignIn(event) {
        event.preventDefault();
        if (!supabaseClient) {
            return;
        }

        const email = els.loginEmail.value.trim();
        const password = els.loginPassword.value;
        if (!email || !password) {
            setAlert(els.authAlert, 'Email and password are required.', 'error');
            return;
        }

        setAlert(els.authAlert, 'Signing in...', 'info');
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            setAlert(els.authAlert, error.message, 'error');
        } else {
            hideAlert(els.authAlert);
        }
    }

    async function handleRegister() {
        if (!supabaseClient) {
            return;
        }

        const email = els.loginEmail.value.trim();
        const password = els.loginPassword.value;
        if (!email || !password) {
            setAlert(els.authAlert, 'Enter an email and password (minimum 6 characters) to register.', 'error');
            return;
        }
        if (password.length < 6) {
            setAlert(els.authAlert, 'Password must be at least 6 characters long.', 'error');
            return;
        }

        setAlert(els.authAlert, 'Creating Supabase user...', 'info');
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) {
            setAlert(els.authAlert, error.message, 'error');
            return;
        }
        setAlert(els.authAlert, 'User created. Confirm the email to finish setup, then sign in.', 'success');
    }

    async function handleLogout() {
        if (!supabaseClient) {
            return;
        }
        await supabaseClient.auth.signOut();
    }

    async function refreshAdminData(showToast) {
        if (!currentSession) {
            return;
        }
        try {
            if (showToast) {
                setAlert(els.ticketsAlert, 'Refreshing data...', 'info');
            }

            const [ticketsData, pilotsData, devicesData, paymentData] = await Promise.all([
                fetchTicketsData(),
                authenticatedRequest('/api/admin/rewards/pilots'),
                loadDevices(),
                authenticatedRequest('/api/admin/rewards/payment-settings')
            ]);

            tickets = ticketsData?.tickets ?? [];
            pilots = pilotsData?.pilots ?? [];
            devices = devicesData ?? [];
            paymentSettings = paymentData ?? { wallet_address: '' };

            renderTickets();
            renderWalletSettings();
            renderAssignmentOptions();
            await loadRegistrations(false);
            await loadPurchases(false);
            await loadWalletPayments(false);

            if (showToast) {
                setAlert(els.ticketsAlert, 'Data refreshed.', 'success');
            } else {
                hideAlert(els.ticketsAlert);
            }
        } catch (err) {
            console.error('Failed to refresh admin data:', err);
            setAlert(els.ticketsAlert, err.message || 'Unable to refresh data.', 'error');
        }
    }

    function buildTicketsQueryString() {
        const params = new URLSearchParams();
        if (ticketFilters.status && ticketFilters.status !== 'all') {
            params.set('status', ticketFilters.status);
        }
        if (ticketFilters.includeArchived) {
            params.set('include_archived', 'true');
        }
        const query = params.toString();
        return query ? `?${query}` : '';
    }

    function syncTicketFiltersToUI() {
        if (els.ticketsStatusFilter) {
            els.ticketsStatusFilter.value = ticketFilters.status;
        }
        if (els.ticketsArchivedToggle) {
            els.ticketsArchivedToggle.checked = ticketFilters.includeArchived;
        }
    }

    function fetchTicketsData() {
        const query = buildTicketsQueryString();
        return authenticatedRequest(`/api/admin/rewards/tickets${query}`);
    }

    async function reloadTickets(showToast) {
        if (!currentSession) {
            return;
        }
        try {
            if (showToast) {
                setAlert(els.ticketsAlert, 'Updating tickets...', 'info');
            }
            const data = await fetchTicketsData();
            tickets = data?.tickets ?? [];
            renderTickets();
            renderAssignmentOptions();
            if (showToast) {
                setAlert(els.ticketsAlert, 'Tickets updated.', 'success');
            } else {
                hideAlert(els.ticketsAlert);
            }
        } catch (err) {
            console.error('Failed to reload tickets:', err);
            setAlert(els.ticketsAlert, err.message || 'Unable to load tickets.', 'error');
        }
    }

    function renderWalletSettings() {
        const walletAddress = paymentSettings?.wallet_address?.trim() ?? '';
        hideAlert(els.walletAlert);
        if (els.walletInput) {
            els.walletInput.value = walletAddress;
        }
        if (els.walletAddressDisplay) {
            els.walletAddressDisplay.textContent = walletAddress || 'Not configured';
            els.walletAddressDisplay.classList.toggle('muted', !walletAddress);
        }
        drawWalletQr(walletAddress);
    }

    function drawWalletQr(walletAddress) {
        if (!els.walletQrCanvas || typeof QRCode === 'undefined') {
            return;
        }
        const canvas = els.walletQrCanvas;
        if (!walletAddress) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        QRCode.toCanvas(canvas, walletAddress, {
            width: canvas.width,
            margin: 1,
            color: {
                dark: '#0f172a',
                light: '#ffffffff'
            }
        }, (error) => {
            if (error) {
                console.error('Failed to render wallet QR code:', error);
            }
        });
    }

    async function loadRegistrations(showToast) {
        if (!currentSession) {
            return;
        }
        try {
            if (showToast) {
                setAlert(els.registrationsAlert, 'Refreshing registrations...', 'info');
            }
            console.log('Fetching assignments...');
            const data = await authenticatedRequest('/api/admin/rewards/assignments');
            console.log('Assignments API response:', data);
            const allRegistrations = data?.assignments ?? [];
            // Filter out completed registrations
            registrations = allRegistrations.filter(reg => reg.status !== 'completed');
            console.log('Active registrations to render:', registrations);
            renderRegistrations();
            if (showToast) {
                setAlert(els.registrationsAlert, 'Registrations updated.', 'success');
            } else {
                hideAlert(els.registrationsAlert);
            }
        } catch (err) {
            console.error('Failed to load registrations:', err);
            setAlert(els.registrationsAlert, err.message || 'Unable to load registrations.', 'error');
        }
    }

    function renderRegistrations() {
        if (!els.registrationsList) {
            return;
        }

        if (!registrations.length) {
            els.registrationsList.innerHTML = `
                <div class="registrations-list empty-state">
                    <p class="pf-v5-c-content pf-m-sm">No active pilot assignments.</p>
                </div>
            `;
            return;
        }

        const registrationsHtml = registrations.map(registration => renderRegistrationItem(registration)).join('');
        els.registrationsList.innerHTML = `
            <div class="pf-v5-l-grid pf-m-gutter">
                ${registrationsHtml}
            </div>
        `;

        // Add event listeners for status change buttons
        registrations.forEach(registration => {
            const completeBtn = document.getElementById(`complete-${registration.registration_id}`);
            if (completeBtn) {
                completeBtn.addEventListener('click', () => updateRegistrationStatus(registration.registration_id, 'completed'));
            }
        });
    }

    function renderRegistrationItem(registration) {
        const pilotName = escapeHtml(registration.pilot_display_name || registration.pilot_name || 'Unknown pilot');
        const deviceName = escapeHtml(registration.device_name || 'Unknown device');
        const packageInfo = registration.package_minutes ? ` (${registration.package_minutes} min)` : '';
        const checkInTime = registration.check_in_time ? new Date(registration.check_in_time).toLocaleString() : 'Not checked in';
        const status = escapeHtml(registration.status || 'active').toLowerCase();
        const statusLabel = buildLabel(status.toUpperCase(), status === 'active' ? 'blue' : 'green');
        
        return `
            <div class="pf-v5-l-grid__item pf-m-12-col pf-m-6-col-on-lg">
                <div class="pf-v5-c-card pf-m-plain">
                    <div class="pf-v5-c-card__header">
                        <div class="pf-v5-c-card__title">
                            <h4 class="pf-v5-c-title pf-m-md">${pilotName}${packageInfo}</h4>
                        </div>
                        <div class="pf-v5-c-card__actions">
                            ${statusLabel}
                        </div>
                    </div>
                    <div class="pf-v5-c-card__body">
                        <dl class="pf-v5-c-description-list pf-m-vertical">
                            <div class="pf-v5-c-description-list__group">
                                <dt class="pf-v5-c-description-list__term">Device</dt>
                                <dd class="pf-v5-c-description-list__description">${deviceName}</dd>
                            </div>
                            <div class="pf-v5-c-description-list__group">
                                <dt class="pf-v5-c-description-list__term">Check-in</dt>
                                <dd class="pf-v5-c-description-list__description">${checkInTime}</dd>
                            </div>
                            ${registration.notes ? `
                                <div class="pf-v5-c-description-list__group">
                                    <dt class="pf-v5-c-description-list__term">Notes</dt>
                                    <dd class="pf-v5-c-description-list__description">${escapeHtml(registration.notes)}</dd>
                                </div>
                            ` : ''}
                        </dl>
                        ${status !== 'completed' ? `
                            <div class="pf-v5-u-mt-md">
                                <button type="button" class="pf-v5-c-button pf-m-primary pf-m-small" id="complete-${registration.registration_id}">
                                    Mark Complete
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    async function loadPurchases(showToast) {
        if (!currentSession) {
            return;
        }
        try {
            if (showToast) {
                setAlert(els.purchasesAlert, 'Refreshing purchases...', 'info');
            }
            console.log('Fetching purchases...');
            const data = await authenticatedRequest('/api/admin/rewards/purchases');
            console.log('Purchases API response:', data);
            purchases = data?.purchases ?? [];
            console.log('Purchases to render:', purchases);
            renderPurchases();
            if (showToast) {
                setAlert(els.purchasesAlert, 'Purchases updated.', 'success');
            } else {
                hideAlert(els.purchasesAlert);
            }
        } catch (err) {
            console.error('Failed to load purchases:', err);
            setAlert(els.purchasesAlert, err.message || 'Unable to load purchases.', 'error');
        }
    }

    function renderPurchases() {
        if (!els.purchasesTableBody) {
            return;
        }

        // Update pilot filter dropdown
        updatePurchasesPilotFilter();

        // Filter purchases based on selected pilot
        const filteredPurchases = purchases.filter(purchase => {
            if (purchasesFilters.pilotId !== 'all') {
                return purchase.pilot_id === purchasesFilters.pilotId;
            }
            return true;
        });

        if (!filteredPurchases.length) {
            const message = purchasesFilters.pilotId !== 'all' 
                ? 'No purchases found for the selected pilot.' 
                : 'No purchases to display.';
            els.purchasesTableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">${message}</td>
                </tr>
            `;
            updatePurchasesSummary(filteredPurchases);
            return;
        }

        const rowsHtml = filteredPurchases.map(purchase => renderPurchaseRow(purchase)).join('');
        els.purchasesTableBody.innerHTML = rowsHtml;
        updatePurchasesSummary(filteredPurchases);
    }

    function updatePurchasesPilotFilter() {
        if (!els.purchasesPilotFilter) {
            return;
        }

        // Get unique pilots from purchases
        const uniquePilots = purchases.reduce((acc, purchase) => {
            if (purchase.pilot_id && purchase.pilot_display_name) {
                acc[purchase.pilot_id] = purchase.pilot_display_name;
            }
            return acc;
        }, {});

        // Create options
        const options = Object.entries(uniquePilots)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([pilotId, pilotName]) => 
                `<option value="${pilotId}">${escapeHtml(pilotName)}</option>`
            )
            .join('');

        els.purchasesPilotFilter.innerHTML = `
            <option value="all">All pilots</option>
            ${options}
        `;

        // Restore filter selection
        els.purchasesPilotFilter.value = purchasesFilters.pilotId;
    }

    function renderPurchaseRow(purchase) {
        const pilotName = escapeHtml(purchase.pilot_display_name || 'Unknown pilot');
        const pilotEmail = purchase.pilot_email ? ` <span class="pf-u-color-200">(${escapeHtml(purchase.pilot_email)})</span>` : '';
        const itemName = escapeHtml(purchase.item_name || 'Unknown item');
        const paymentMethod = escapeHtml(purchase.payment_method || 'points').toUpperCase();
        const amountPaid = purchase.payment_method === 'points' 
            ? `${purchase.points_paid || 0} points` 
            : `${(purchase.usdt_paid || 0).toFixed(2)} USDT`;
        const status = escapeHtml(purchase.status || 'completed').toLowerCase();
        const purchased = purchase.purchased_at ? new Date(purchase.purchased_at).toLocaleString() : 'Unknown';
        const statusLabel = buildLabel(status.toUpperCase(), status === 'completed' ? 'green' : 'outline');

        return `
        <ul class="pf-v6-c-data-list" role="list" aria-label="With headings data list example"
                                            id="data-list-with-headings"
                                            >
                                            <li class="pf-v6-c-data-list__item">
                                                <div class="pf-v6-c-data-list__item-row">
                                                <div class="pf-v6-c-data-list__item-content">
                                                    <div class="pf-v6-c-data-list__cell">
                                                    <h2 id="data-list-with-headings-item-1">${pilotName}${pilotEmail}</h2>
                                                    </div>
                                                    <div class="pf-v6-c-data-list__cell">${itemName}</div>
                                                    <div class="pf-v6-c-data-list__cell">${paymentMethod}</div>
                                                    <div class="pf-v6-c-data-list__cell">${amountPaid}</div>
                                                    <div class="pf-v6-c-data-list__cell">${statusLabel}</div>
                                                    <div class="pf-v6-c-data-list__cell">${purchased}</div>
                                                </div>
                                                </div>
                                            </li>
                                            </ul>
        `;
    }

    function updatePurchasesSummary(filteredPurchases = purchases) {
        if (!els.purchasesSummary) {
            return;
        }
        const total = filteredPurchases.length;
        const pointsPurchases = filteredPurchases.filter(p => p.payment_method === 'points').length;
        const usdtPurchases = filteredPurchases.filter(p => p.payment_method === 'usdt').length;
        const totalPointsSpent = filteredPurchases.reduce((sum, p) => sum + (p.points_paid || 0), 0);
        const totalUsdtSpent = filteredPurchases.reduce((sum, p) => sum + (p.usdt_paid || 0), 0);
        
        const filterInfo = purchasesFilters.pilotId !== 'all' ? ' (filtered)' : '';
        els.purchasesSummary.textContent = `Total: ${total}${filterInfo} | Points: ${pointsPurchases} (${totalPointsSpent} pts) | USDT: ${usdtPurchases} ($${totalUsdtSpent.toFixed(2)})`;
    }

    async function loadWalletPayments(showToast) {
        if (!currentSession) {
            return;
        }
        try {
            if (showToast) {
                setAlert(els.walletPaymentsAlert, 'Refreshing wallet payments...', 'info');
            }
            console.log('Fetching wallet payments...');
            const data = await authenticatedRequest('/api/admin/rewards/wallet-payments');
            console.log('Wallet payments API response:', data);
            walletPayments = data?.payments ?? [];
            console.log('Wallet payments to render:', walletPayments);
            renderWalletPayments();
            if (showToast) {
                setAlert(els.walletPaymentsAlert, 'Wallet payments updated.', 'success');
            } else {
                hideAlert(els.walletPaymentsAlert);
            }
        } catch (err) {
            console.error('Failed to load wallet payments:', err);
            setAlert(els.walletPaymentsAlert, err.message || 'Unable to load wallet payments.', 'error');
        }
    }

    function renderWalletPayments() {
        if (!els.walletPaymentsTableBody) {
            return;
        }

        // Filter payments based on selected status
        const filteredPayments = walletPayments.filter(payment => {
            if (walletPaymentsFilters.status !== 'all') {
                return payment.payment_status === walletPaymentsFilters.status;
            }
            return true;
        });

        if (!filteredPayments.length) {
            const message = walletPaymentsFilters.status !== 'all' 
                ? 'No payments found with the selected status.' 
                : 'No wallet payments to display.';
            els.walletPaymentsTableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">${message}</td>
                </tr>
            `;
            updateWalletPaymentsSummary(filteredPayments);
            return;
        }

        const rowsHtml = filteredPayments.map(payment => renderWalletPaymentRow(payment)).join('');
        els.walletPaymentsTableBody.innerHTML = rowsHtml;
        updateWalletPaymentsSummary(filteredPayments);

        // Add event listeners for approve/reject buttons
        filteredPayments.forEach(payment => {
            const approveBtn = document.getElementById(`approve-${payment.payment_id}`);
            const rejectBtn = document.getElementById(`reject-${payment.payment_id}`);
            
            if (approveBtn) {
                approveBtn.addEventListener('click', () => handlePaymentAction(payment.payment_id, 'approve'));
            }
            if (rejectBtn) {
                rejectBtn.addEventListener('click', () => handlePaymentAction(payment.payment_id, 'reject'));
            }
        });
    }

    function renderWalletPaymentRow(payment) {
        const pilotName = escapeHtml(payment.pilot_display_name || 'Unknown pilot');
        const pilotEmail = payment.pilot_email ? ` <span class="pf-u-color-200">(${escapeHtml(payment.pilot_email)})</span>` : '';
        const amount = `${payment.payment_amount} ${payment.payment_currency}`;
        const hashDisplay = createReferenceWithCopy(payment.transaction_hash, 'hash');
        const status = escapeHtml(payment.payment_status || 'pending').toLowerCase();
        const paymentDate = payment.created_at ? new Date(payment.created_at).toLocaleDateString() : 'Unknown';
        
        const statusColor = {
            'pending': 'blue',
            'verified': 'green',
            'admin_approved': 'green',
            'failed': 'red'
        }[status] || 'grey';
        
        const statusLabel = buildLabel(status.replace('_', ' ').toUpperCase(), statusColor);

        const canApprove = status === 'pending' || status === 'failed';
        const actionsHtml = canApprove ? `
            <button type="button" class="pf-v6-c-button pf-m-primary pf-m-small" id="approve-${payment.payment_id}">
                Approve
            </button>
            <button type="button" class="pf-v6-c-button pf-m-danger pf-m-small pf-v5-u-ml-sm" id="reject-${payment.payment_id}">
                Reject
            </button>
        ` : '<span class="pf-v5-u-color-200">NO ACTION REQUIRED</span>';

        return `
        <ul class="pf-v6-c-data-list" role="list" aria-label="With headings data list example"
                                            id="data-list-with-headings"
                                            >
                                            <li class="pf-v6-c-data-list__item">
                                                <div class="pf-v6-c-data-list__item-row">
                                                <div class="pf-v6-c-data-list__item-content">
                                                    <div class="pf-v6-c-data-list__cell">
                                                    <h2 id="data-list-with-headings-item-1">${pilotName}${pilotEmail}</h2>
                                                    </div>
                                                    <div class="pf-v6-c-data-list__cell">${amount}</div>
                                                    <div class="pf-v6-c-data-list__cell">${hashDisplay}</div>
                                                    <div class="pf-v6-c-data-list__cell">${statusLabel}${payment.verification_error ? `<br><small class="pf-v5-u-color-danger-200">${escapeHtml(payment.verification_error)}</small>` : ''}</div>
                                                    <div class="pf-v6-c-data-list__cell">${paymentDate}</div>
                                                    <div class="pf-v6-c-data-list__cell">${actionsHtml}</div>
                                                </div>
                                                </div>
                                            </li>
                                            </ul>
        `;
    }

    function updateWalletPaymentsSummary(filteredPayments = walletPayments) {
        if (!els.walletPaymentsSummary) {
            return;
        }
        const total = filteredPayments.length;
        const pending = filteredPayments.filter(p => p.payment_status === 'pending').length;
        const verified = filteredPayments.filter(p => p.payment_status === 'verified').length;
        const approved = filteredPayments.filter(p => p.payment_status === 'admin_approved').length;
        const failed = filteredPayments.filter(p => p.payment_status === 'failed').length;
        const totalAmount = filteredPayments.reduce((sum, p) => sum + (p.payment_amount || 0), 0);
        
        const filterInfo = walletPaymentsFilters.status !== 'all' ? ' (filtered)' : '';
        els.walletPaymentsSummary.textContent = `Total: ${total}${filterInfo} | Pending: ${pending} | Verified: ${verified} | Approved: ${approved} | Failed: ${failed} | Amount: $${totalAmount.toFixed(2)}`;
    }

    async function handlePaymentAction(paymentId, action) {
        if (!currentSession) {
            return;
        }

        let reason = '';
        if (action === 'reject') {
            reason = prompt('Enter reason for rejection (optional):') || 'Rejected by admin';
        }

        try {
            setAlert(els.walletPaymentsAlert, `${action === 'approve' ? 'Approving' : 'Rejecting'} payment...`, 'info');
            
            const response = await authenticatedRequest(`/api/admin/rewards/wallet-payments/${paymentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: action,
                    reason: reason
                })
            });

            setAlert(els.walletPaymentsAlert, response.message || `Payment ${action}ed successfully`, 'success');
            
            // Reload wallet payments
            await loadWalletPayments(false);
            
        } catch (err) {
            console.error(`Failed to ${action} payment:`, err);
            setAlert(els.walletPaymentsAlert, err.message || `Failed to ${action} payment`, 'error');
        }
    }

    async function handleWalletSubmit(event) {
        event.preventDefault();
        if (!currentSession) {
            return;
        }
        const wallet = els.walletInput ? els.walletInput.value.trim() : '';
        try {
            setAlert(els.walletAlert, wallet ? 'Saving wallet...' : 'Clearing wallet...', 'info');
            const response = await authenticatedRequest('/api/admin/rewards/payment-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet_address: wallet })
            });
            paymentSettings = response;
            renderWalletSettings();
            setAlert(els.walletAlert, 'Wallet settings updated.', 'success');
        } catch (err) {
            console.error('Failed to update wallet:', err);
            setAlert(els.walletAlert, err.message || 'Unable to update wallet address.', 'error');
        }
    }

    async function loadDevices() {
        const response = await fetch('/api/devices');
        if (!response.ok) {
            throw new Error('Failed to load device list');
        }
        const data = await response.json();
        return data?.devices ?? [];
    }

    function renderTickets() {
        if (!els.ticketsTableBody) {
            return;
        }

        if (!tickets.length) {
            els.ticketsTableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="8">No tickets match the current filters.</td>
                </tr>
            `;
            updateTicketSummary();
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(els.ticketsTableBody);
            }
            return;
        }

        const rowsHtml = tickets.map(ticket => renderTicketRow(ticket)).join('');
        els.ticketsTableBody.innerHTML = rowsHtml;
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(els.ticketsTableBody);
        }
        updateTicketSummary();
    }

    function renderTicketRow(ticket) {
        const pilotName = escapeHtml(ticket.pilot_display_name || 'Unknown pilot');
        const pilotEmail = ticket.pilot_email ? ` <span class="pf-u-color-200">(${escapeHtml(ticket.pilot_email)})</span>` : '';
        const ticketType = escapeHtml(ticket.ticket_type || 'race-pass');
        const amount = formatAmount(ticket.payment_amount, ticket.payment_currency);
        const status = (ticket.payment_status || 'pending').toLowerCase();
        const purchased = ticket.purchased_at ? new Date(ticket.purchased_at).toLocaleString() : 'N/A';
        const reference = ticket.payment_reference
            ? createReferenceWithCopy(ticket.payment_reference, 'reference')
            : '<span class="pf-u-color-200">-</span>';
        const packageMinutes = Number(ticket.package_minutes || 0);
        const packageLabel = ticket.package_label ? escapeHtml(ticket.package_label) : '';
        const packageDisplay = packageLabel
            ? `${packageLabel}${packageMinutes ? ' (' + packageMinutes + ' min)' : ''}`
            : (packageMinutes ? `${packageMinutes} min` : ticketType);
        const redeemedLabel = ticket.redeemed ? buildLabel('Yes', 'green') : buildLabel('No', 'gold');
        const verificationError = ticket.verification_error;
        const statusLabel = buildLabel(status.toUpperCase(), mapTicketStatusVariant(status), verificationError || '');
        const verificationErrorDisplay = verificationError 
            ? `<br><small class="pf-v5-u-color-danger-200">${escapeHtml(verificationError)}</small>` 
            : '';
        const statusWithError = statusLabel + verificationErrorDisplay;
        const isArchived = Boolean(ticket.archived);
        const archivedLabel = isArchived ? ` ${buildLabel('ARCHIVED', 'outline')}` : '';
        const rowClass = isArchived ? ' class="ticket-row-archived"' : '';

        return `
                <ul class="pf-v6-c-data-list" role="list" aria-label="With headings data list example"
                                            id="data-list-with-headings"
                                            >
                                            <li class="pf-v6-c-data-list__item">
                                                <div class="pf-v6-c-data-list__item-row">
                                                <div class="pf-v6-c-data-list__item-content">
                                                    <div class="pf-v6-c-data-list__cell">
                                                    <h2 id="data-list-with-headings-item-1">${pilotName}${pilotEmail}</h2>
                                                    </div>
                                                    <div class="pf-v6-c-data-list__cell">${packageDisplay}</div>
                                                    <div class="pf-v6-c-data-list__cell">${amount}</div>
                                                    <div class="pf-v6-c-data-list__cell">${statusWithError}${archivedLabel}</div>
                                                    <div class="pf-v6-c-data-list__cell">${redeemedLabel}</div>
                                                    <div class="pf-v6-c-data-list__cell">${reference}</div>
                                                    <div class="pf-v6-c-data-list__cell">${escapeHtml(purchased)}</div>
                                                    <div class="pf-v6-c-data-list__cell"${renderTicketActions(ticket)}</div>
                                                </div>
                                                </div>
                                            </li>
                                            </ul>
        `;
    }

    function renderTicketActions(ticket) {
        const status = (ticket.payment_status || 'pending').toLowerCase();
        const isArchived = Boolean(ticket.archived);
        const hasVerificationError = Boolean(ticket.verification_error);
        const actions = [];

        if (isArchived) {
            actions.push(createArchiveButton('Restore', false, ticket.ticket_id));
            return actions.length
                ? `<div class="pf-v6-c-button-group pf-m-compact">${actions.join('')}</div>`
                : '<span class="pf-u-color-200">No actions</span>';
        }

        // Smart status change buttons
        if (status !== 'paid') {
            // If there's a verification error, the Mark Paid button becomes an admin approval
            const buttonLabel = hasVerificationError ? 'Approve Payment' : 'Mark Paid';
            const buttonClass = hasVerificationError ? 'pf-m-primary' : 'pf-m-tertiary';
            actions.push(createSmartActionButton(buttonLabel, 'paid', ticket.ticket_id, buttonClass, hasVerificationError));
        }
        
        // Only show reject button for tickets with verification errors
        if (hasVerificationError && ['pending', 'failed'].includes(status)) {
            actions.push(createSmartActionButton('Reject Payment', 'reject', ticket.ticket_id, 'pf-m-danger', true));
        }

        if (status !== 'pending') {
            actions.push(createActionButton('Mark Pending', 'pending', ticket.ticket_id));
        }
        if (status !== 'canceled') {
            actions.push(createActionButton('Cancel', 'canceled', ticket.ticket_id));
        }
        if (status !== 'refunded') {
            actions.push(createActionButton('Refund', 'refunded', ticket.ticket_id));
        }

        if (ticket.redeemed) {
            actions.push(createArchiveButton('Archive', true, ticket.ticket_id));
        }

        return actions.length
            ? `<div class="pf-v6-c-button-group pf-m-compact">${actions.join('')}</div>`
            : '<span class="pf-u-color-200">No actions</span>';
    }

    function createActionButton(label, action, ticketId) {
        return `<button type="button" class="pf-v6-c-button pf-m-tertiary pf-m-small ticket-action" data-ticket-id="${ticketId}" data-action="${action}" style="
    margin-bottom: 4px;
">${escapeHtml(label)}</button>`;
    }

    function createArchiveButton(label, shouldArchive, ticketId) {
        const archiveAction = shouldArchive ? 'archive' : 'restore';
        return `<button type="button" class="pf-v6-c-button pf-m-secondary pf-m-small ticket-action" data-ticket-id="${ticketId}" data-archive-action="${archiveAction}" style="
    margin-bottom: 4px;
">${escapeHtml(label)}</button>`;
    }

    function createSmartActionButton(label, action, ticketId, buttonClass = 'pf-m-tertiary', isAdminApproval = false) {
        const cssClass = isAdminApproval ? 'ticket-admin-action' : 'ticket-action';
        return `<button type="button" class="pf-v6-c-button ${buttonClass} pf-m-small ${cssClass}" data-ticket-id="${ticketId}" data-action="${action}" data-admin-approval="${isAdminApproval}" style="
    margin-bottom: 4px;
">${escapeHtml(label)}</button>`;
    }

    function updateTicketSummary() {
        if (!els.ticketsSummary) {
            return;
        }
        const total = tickets.length;
        const paid = tickets.filter(t => (t.payment_status || '').toLowerCase() === 'paid').length;
        const pending = tickets.filter(t => (t.payment_status || '').toLowerCase() === 'pending').length;
        const canceled = tickets.filter(t => (t.payment_status || '').toLowerCase() === 'canceled').length;
        const refunded = tickets.filter(t => (t.payment_status || '').toLowerCase() === 'refunded').length;
        const redeemed = tickets.filter(t => t.redeemed).length;
        const archived = tickets.filter(t => t.archived).length;
        els.ticketsSummary.textContent = `Total: ${total} | Paid: ${paid} | Pending: ${pending} | Canceled: ${canceled} | Refunded: ${refunded} | Redeemed: ${redeemed} | Archived: ${archived}`;
    }

    function renderAssignmentOptions() {
        if (!els.assignmentTicket || !els.assignmentDevice) {
            return;
        }

        const paidTickets = tickets.filter(t => {
            const status = (t.payment_status || '').toLowerCase();
            return status === 'paid' && !t.redeemed && !t.archived;
        });

        if (!paidTickets.length) {
            els.assignmentTicket.innerHTML = '<option value="">No paid tickets available</option>';
        } else {
            const options = paidTickets
                .map(ticket => {
                    const pilotName = escapeHtml(ticket.pilot_display_name || ticket.pilot_name || 'Unknown pilot');
                    const packageMinutes = Number(ticket.package_minutes || 0);
                    const packageLabel = ticket.package_label ? escapeHtml(ticket.package_label) : '';
                    const packageDisplay = packageLabel
                        ? `${packageLabel}${packageMinutes ? ' (' + packageMinutes + ' min)' : ''}`
                        : (packageMinutes ? `${packageMinutes} min` : 'Package n/a');
                    return `<option value="${ticket.ticket_id}">${pilotName} - ${packageDisplay}</option>`;
                })
                .join('');
            els.assignmentTicket.innerHTML = `<option value="">Select a paid ticket...</option>${options}`;
        }

        if (!devices.length) {
            els.assignmentDevice.innerHTML = '<option value="">No devices registered</option>';
        } else {
            const options = devices
                .slice()
                .sort((a, b) => (a.device_name || '').localeCompare(b.device_name || ''))
                .map(device => `<option value="${device.device_id}">${buildDeviceLabel(device)}</option>`)
                .join('');
            els.assignmentDevice.innerHTML = `<option value="">Select a device...</option>${options}`;
        }

        updateAssignmentFormState(paidTickets.length, devices.length);
        updateAssignmentsSummary(paidTickets.length);
    }

    function buildDeviceLabel(device) {
        const name = device.device_name ? escapeHtml(device.device_name) : escapeHtml(device.device_id || 'Unknown device');
        const status = device.status ? device.status.toUpperCase() : 'UNKNOWN';
        const pilot = device.current_pilot?.display_name ? ` - ${escapeHtml(device.current_pilot.display_name)} onboard` : '';
        return `${name} (${status})${pilot}`;
    }

    function updateAssignmentFormState(paidTicketCount, deviceCount) {
        const submitBtn = els.assignmentForm?.querySelector('button[type="submit"]');
        const disable = !paidTicketCount || !deviceCount;
        if (submitBtn) {
            submitBtn.disabled = disable;
        }
        if (els.assignmentTicket) {
            els.assignmentTicket.disabled = paidTicketCount === 0;
        }
        if (els.assignmentDevice) {
            els.assignmentDevice.disabled = deviceCount === 0;
        }
        if (disable) {
            setAlert(els.assignmentAlert, 'Mark at least one ticket as paid (and not redeemed) and ensure a headset is online before assignment.', 'info');
        } else {
            hideAlert(els.assignmentAlert);
        }
    }

    function updateAssignmentsSummary(paidTicketCount) {
        if (!els.assignmentsSummary) {
            return;
        }
        const activeDevices = devices.filter(d => (d.status || '').toLowerCase() === 'online').length;
        const availableMinutes = tickets
            .filter(t => {
                const status = (t.payment_status || '').toLowerCase();
                return status === 'paid' && !t.redeemed && !t.archived;
            })
            .reduce((total, ticket) => total + Number(ticket.package_minutes || 0), 0);
        els.assignmentsSummary.textContent = `${registrations.length} active | ${paidTicketCount} available tickets | ${availableMinutes} minutes ready | ${activeDevices} headsets online`;
    }

    function renderRegistrations() {
        if (!els.registrationsList) {
            return;
        }

        if (!registrations.length) {
            els.registrationsList.classList.add('empty-state');
            els.registrationsList.innerHTML = '<p class="pf-c-content pf-m-sm">No pilots currently mapped to headsets.</p>';
            updateAssignmentsSummary(tickets.filter(t => {
                const status = (t.payment_status || '').toLowerCase();
                return status === 'paid' && !t.redeemed && !t.archived;
            }).length);
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(els.registrationsList);
            }
            return;
        }

        els.registrationsList.classList.remove('empty-state');
        const cards = registrations.map(reg => {
            const status = (reg.status || 'active').toLowerCase();
            const checkIn = reg.check_in_time ? new Date(reg.check_in_time).toLocaleString() : 'Unknown';
            
            // Get pilot name with fallbacks - prioritize display_name_combined from the server
            const pilotName = escapeHtml(
                reg.display_name_combined !== 'Unknown Pilot' ? reg.display_name_combined :
                reg.pilot_display_name_from_profile ||
                reg.pilot_display_name || 
                reg.pilot_name || 
                'Unknown Pilot'
            );
            
            // Debug pilot name resolution
            console.log('Pilot name resolution:', {
                display_name_combined: reg.display_name_combined,
                pilot_display_name_from_profile: reg.pilot_display_name_from_profile,
                pilot_display_name: reg.pilot_display_name,
                pilot_name: reg.pilot_name,
                finalName: pilotName
            });
            
            // Get device name with fallbacks
            const deviceName = escapeHtml(
                reg.device_name || 
                reg.device_id || 
                reg.mac_address || 
                'Unknown device'
            );
            
            // Device type information not available in the database
            
            // Notes display
            const notesMarkup = reg.notes
                ? `<div class="registration-notes pf-c-helper-text pf-m-dynamic">${escapeHtml(reg.notes)}</div>`
                : '';
                
            // Ticket info
            const ticketType = reg.ticket_type || reg.event_name || 'n/a';
            const ticketMarkup = ticketType !== 'n/a' 
                ? `Ticket: ${escapeHtml(ticketType)}` 
                : 'Ticket: n/a';
                
            // Package and timing info
            const allocatedMinutes = Number(reg.allocated_minutes || reg.session_allocated_minutes || 0);
            const packageLabel = reg.session_package_label || 
                               (reg.event_name ? `${reg.event_name} Package` : 'N/A');
            const packageSummary = packageLabel
                ? `${packageLabel}${allocatedMinutes ? ' (' + allocatedMinutes + ' min)' : ''}`
                : (allocatedMinutes ? `${allocatedMinutes} min` : 'N/A');
            const canComplete = status !== 'completed';
            const actionButton = canComplete
                ? `<button type="button" class="pf-c-button pf-m-primary pf-m-small registration-action" data-registration-id="${reg.registration_id}" data-action="completed">Mark Complete</button>`
                : '';

            return `
                <article class="pf-c-card pf-m-flat registration-card">
                    <header class="pf-c-card__header">
                        <div>
                            <h4 class="pf-c-title pf-m-md">${pilotName}</h4>
                            <span class="pf-u-color-200">${deviceName}</span>
                        </div>
                        ${buildLabel(status.toUpperCase(), mapRegistrationStatusVariant(status))}
                    </header>
                    <div class="pf-c-card__body">
                        <dl class="pf-c-description-list pf-m-vertical registration-meta">
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Check-in</dt>
                                <dd class="pf-c-description-list__description">${escapeHtml(checkIn)}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Ticket</dt>
                                <dd class="pf-c-description-list__description">${escapeHtml(ticketType)}</dd>
                            </div>
                            <div class="pf-c-description-list__group">
                                <dt class="pf-c-description-list__term">Package</dt>
                                <dd class="pf-c-description-list__description">${packageSummary}</dd>
                            </div>
                        </dl>
                        ${notesMarkup}
                    </div>
                    <footer class="pf-c-card__footer">
                        ${actionButton ? `<div class="pf-c-button-group pf-m-compact">${actionButton}</div>` : '<span class="pf-u-color-200">No actions</span>'}
                    </footer>
                </article>
            `;
        }).join('');

        els.registrationsList.innerHTML = cards;
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(els.registrationsList);
        }
        updateAssignmentsSummary(tickets.filter(t => {
            const status = (t.payment_status || '').toLowerCase();
            return status === 'paid' && !t.redeemed && !t.archived;
        }).length);
    }

    async function handleAssignmentSubmit(event) {
        event.preventDefault();
        if (!currentSession) {
            setAlert(els.assignmentAlert, 'Not authenticated. Please sign in.', 'error');
            return;
        }

        const ticketSelect = document.getElementById('assignment-ticket');
        const deviceSelect = document.getElementById('assignment-device');
        const notesInput = document.getElementById('assignment-notes');
        
        if (!ticketSelect || !deviceSelect || !notesInput) {
            setAlert(els.assignmentAlert, 'Form elements not found. Please refresh the page.', 'error');
            return;
        }

        const ticketId = ticketSelect.value;
        const deviceId = deviceSelect.value;
        const notes = notesInput.value.trim();

        if (!ticketId || ticketId === '') {
            setAlert(els.assignmentAlert, 'Please select a paid ticket.', 'error');
            return;
        }

        if (!deviceId || deviceId === '') {
            setAlert(els.assignmentAlert, 'Please select a device.', 'error');
            return;
        }

        const ticket = tickets.find(t => t.ticket_id === ticketId);
        if (!ticket) {
            setAlert(els.assignmentAlert, 'Selected ticket not found. Refresh and try again.', 'error');
            return;
        }

        if ((ticket.payment_status || '').toLowerCase() !== 'paid') {
            setAlert(els.assignmentAlert, 'Ticket must be marked as paid before assignment.', 'error');
            return;
        }

        if (ticket.redeemed) {
            setAlert(els.assignmentAlert, 'Ticket already redeemed. Choose another ticket.', 'error');
            return;
        }

        try {
            setAlert(els.assignmentAlert, 'Assigning pilot to headset...', 'info');
            
            console.log('Submitting assignment with:', {
                device_id: deviceId,
                ticket_id: ticket.ticket_id,
                pilot_id: ticket.pilot_id,
                pilot_name: ticket.pilot_display_name,
                notes: notes || ''
            });

            const response = await authenticatedRequest('/api/admin/rewards/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: deviceId,
                    ticket_id: ticket.ticket_id,
                    pilot_id: ticket.pilot_id,
                    pilot_name: ticket.pilot_display_name,
                    notes: notes || ''
                })
            });

            console.log('Assignment response:', response);
            setAlert(els.assignmentAlert, 'Pilot assigned successfully!', 'success');
            
            // Reset the form
            const form = document.getElementById('assignment-form');
            if (form) form.reset();
            
            // Refresh the data
            await refreshAdminData(false);
        } catch (err) {
            console.error('Assignment failed:', err);
            let errorMessage = 'Failed to assign pilot to headset.';
            
            if (err.response) {
                try {
                    const errorData = JSON.parse(err.response);
                    errorMessage = errorData.error || errorData.message || errorMessage;
                } catch (e) {
                    // If we can't parse the error response, use the raw response
                    errorMessage = err.response || errorMessage;
                }
            } else if (err.message) {
                errorMessage = err.message;
            }
            
            setAlert(els.assignmentAlert, errorMessage, 'error');
        }
    }

    async function updateTicketStatus(ticketId, newStatus) {
        if (!currentSession) {
            return;
        }
        try {
            setAlert(els.ticketsAlert, `Updating ticket to ${newStatus.toUpperCase()}...`, 'info');
            const data = await authenticatedRequest(`/api/admin/rewards/tickets/${ticketId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_status: newStatus })
            });

            tickets = tickets.map(t => (t.ticket_id === ticketId ? data.ticket : t));
            renderTickets();
            renderAssignmentOptions();
            setAlert(els.ticketsAlert, 'Ticket status updated.', 'success');
        } catch (err) {
            console.error('Failed to update ticket status:', err);
            setAlert(els.ticketsAlert, err.message || 'Failed to update ticket.', 'error');
        }
    }

    async function toggleTicketArchive(ticketId, shouldArchive) {
        if (!currentSession) {
            return;
        }
        try {
            setAlert(els.ticketsAlert, shouldArchive ? 'Archiving ticket...' : 'Restoring ticket...', 'info');
            await authenticatedRequest(`/api/admin/rewards/tickets/${ticketId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived: shouldArchive })
            });
            await reloadTickets(false);
            setAlert(els.ticketsAlert, shouldArchive ? 'Ticket archived.' : 'Ticket restored.', 'success');
        } catch (err) {
            console.error('Failed to update ticket archive state:', err);
            setAlert(els.ticketsAlert, err.message || 'Failed to update ticket archive.', 'error');
        }
    }

    async function handleTicketAdminAction(ticketId, action) {
        if (!currentSession) {
            return;
        }

        // Convert 'paid' action to 'approve' for admin approval API
        const adminAction = action === 'paid' ? 'approve' : action;
        
        let reason = '';
        if (adminAction === 'reject') {
            reason = prompt('Enter reason for rejection (optional):') || 'Rejected by admin';
        } else if (adminAction === 'approve') {
            reason = 'Approved by admin after verification failure';
        }

        try {
            setAlert(els.ticketsAlert, `${adminAction === 'approve' ? 'Approving' : 'Rejecting'} ticket payment...`, 'info');
            
            const response = await authenticatedRequest(`/api/admin/rewards/tickets/${ticketId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: adminAction,
                    reason: reason
                })
            });

            setAlert(els.ticketsAlert, response.message || `Ticket payment ${adminAction}d successfully`, 'success');
            
            // Reload tickets to show updated status
            await reloadTickets(false);
            
        } catch (err) {
            console.error(`Failed to ${adminAction} ticket:`, err);
            setAlert(els.ticketsAlert, err.message || `Failed to ${adminAction} ticket payment`, 'error');
        }
    }

    async function updateRegistrationStatus(registrationId, newStatus) {
        if (!currentSession) {
            return;
        }
        try {
            setAlert(els.registrationsAlert, 'Updating registration...', 'info');
            await authenticatedRequest(`/api/admin/rewards/assignments/${registrationId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            await loadRegistrations(false);
            setAlert(els.registrationsAlert, 'Registration updated.', 'success');
        } catch (err) {
            console.error('Failed to update registration:', err);
            setAlert(els.registrationsAlert, err.message || 'Failed to update registration.', 'error');
        }
    }

    async function loadPublicConfig() {
        const response = await fetch('/api/public-config');
        if (!response.ok) {
            throw new Error('Failed to load public configuration');
        }
        return response.json();
    }

    async function authenticatedRequest(url, options = {}) {
        if (!currentSession?.access_token) {
            throw new Error('Administrator authentication required');
        }
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${currentSession.access_token}`
        };
        const response = await fetch(url, { ...options, headers });
        const payload = await safeParseJson(response);
        if (!response.ok) {
            const message = payload?.error || response.statusText || 'Request failed';
            throw new Error(message);
        }
        return payload ?? {};
    }

    async function safeParseJson(response) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }

    function toggleSection(element, show) {
        if (!element) {
            return;
        }
        element.classList.toggle('hidden', !show);
    }

    function setAlert(element, message, type = 'info') {
        if (!element) {
            return;
        }

        const variantMap = {
            success: 'success',
            error: 'danger',
            warning: 'warning',
            info: 'info'
        };
        const variant = variantMap[type] || variantMap.info;

        element.className = `pf-c-alert pf-m-inline pf-m-${variant}`;
        element.setAttribute('role', 'alert');
        element.innerHTML = `<div class="pf-c-alert__title">${escapeHtml(message)}</div>`;
        element.classList.remove('hidden');
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(element);
        }
    }

    function hideAlert(element) {
        if (!element) {
            return;
        }
        element.innerHTML = '';
        element.className = 'pf-c-alert pf-m-inline hidden';
    }

    function buildLabel(text, variant = 'outline', title = '') {
        const modifier = variant ? ` pf-m-${variant}` : '';
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<span class="pf-c-label pf-v5-c-label${modifier}"${titleAttr}><span class="pf-c-label__content">${escapeHtml(text)}</span></span>`;
    }

    function mapTicketStatusVariant(status) {
        switch (status) {
            case 'paid':
                return 'green';
            case 'pending':
                return 'gold';
            case 'canceled':
                return 'red';
            case 'refunded':
                return 'purple';
            default:
                return 'outline';
        }
    }

    function mapRegistrationStatusVariant(status) {
        switch (status) {
            case 'completed':
                return 'green';
            case 'active':
                return 'blue';
            case 'waiting':
                return 'gold';
            case 'canceled':
                return 'red';
            default:
                return 'outline';
        }
    }

    function formatAmount(amount, currency = 'USDT') {
        if (amount === null || amount === undefined) {
            return `0 ${currency}`;
        }
        if (Number.isNaN(Number(amount))) {
            return `${escapeHtml(String(amount))} ${escapeHtml(currency)}`;
        }
        return `${Number(amount).toFixed(2)} ${escapeHtml(currency)}`;
    }

    function escapeHtml(value) {
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

    function createReferenceWithCopy(fullValue, type = 'reference') {
        if (!fullValue) {
            return '<span class="pf-v6-u-color-200">-</span>';
        }

        // Trim the value for display
        const trimmedValue = fullValue.length > 16 
            ? fullValue.slice(0, 8) + '...' + fullValue.slice(-8)
            : fullValue;

        // Generate unique ID for this copy button
        const copyId = `copy-${type}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="pf-v6-c-code-block pf-m-inline">
                <div class="pf-v6-c-code-block__content">
                    <code class="pf-v6-c-code-block__content-code" title="${escapeHtml(fullValue)}">${escapeHtml(trimmedValue)}</code>
                </div>
                <div class="pf-v6-c-code-block__actions">
                    <button class="pf-v6-c-button pf-m-plain copy-button" type="button" data-copy-value="${escapeHtml(fullValue)}" title="Copy full ${type}">
                        <i class="fas fa-copy" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        `;
    }

    async function copyToClipboard(text, buttonElement) {
        // Decode HTML entities to get the original text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text;
        const decodedText = tempDiv.textContent || tempDiv.innerText || text;
        
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(decodedText);
                showCopyFeedback(buttonElement, true);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = decodedText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                showCopyFeedback(buttonElement, successful);
            }
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
            showCopyFeedback(buttonElement, false);
        }
    }

    function showCopyFeedback(buttonElement, success) {
        const icon = buttonElement.querySelector('i');
        const originalClass = icon.className;
        
        if (success) {
            icon.className = 'fas fa-check pf-v6-u-color-success';
            buttonElement.title = 'Copied!';
        } else {
            icon.className = 'fas fa-exclamation-triangle pf-v6-u-color-danger';
            buttonElement.title = 'Copy failed';
        }
        
        // Reset after 2 seconds
        setTimeout(() => {
            icon.className = originalClass;
            buttonElement.title = buttonElement.title.includes('reference') ? 'Copy full reference' : 'Copy full hash';
        }, 2000);
    }

    // Avatar Dropdown Functions
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
        console.log('updateHeaderAvatar called with:', { displayName, photoUrl });
        
        // Update header avatar image
        const headerAvatar = document.getElementById('header-user-avatar');
        console.log('Avatar element found:', { headerAvatar: !!headerAvatar });
        
        if (headerAvatar && photoUrl) {
            headerAvatar.src = photoUrl;
            console.log('Updated header avatar src to:', photoUrl);
        }

        // Update user name in header
        const headerUserName = document.getElementById('header-user-name');
        console.log('Name element found:', { headerUserName: !!headerUserName });
        
        if (headerUserName && displayName) {
            headerUserName.textContent = displayName;
            console.log('Updated header user name to:', displayName);
        }

        // Show avatar dropdown when authenticated
        const avatarDropdown = document.getElementById('user-avatar-dropdown');
        if (avatarDropdown && currentSession) {
            avatarDropdown.classList.remove('hidden');
            console.log('Avatar dropdown shown');
        }
        
        console.log('updateHeaderAvatar completed');
    }

    async function loadAdminPilotData() {
        console.log('🔧 Loading admin pilot data...');
        if (!currentSession) {
            console.log('🔧 No session available for pilot data loading');
            return;
        }

        try {
            // Load pilot profile data using the consistent authenticatedRequest pattern
            const profileData = await authenticatedRequest('/api/pilots/me');
            console.log('🔧 Admin pilot profile loaded:', profileData);
            
            const pilotProfile = profileData?.pilot ?? null;
            console.log('🔧 Final admin pilot profile:', pilotProfile);
            
            renderPilotProfile(pilotProfile);
        } catch (err) {
            console.error('Failed to load admin pilot data:', err);
            // Don't show error to user, just use defaults
            renderPilotProfile(null);
        }
    }

    function renderPilotProfile(pilot) {
        console.log('🔧 Rendering admin pilot profile:', pilot);
        
        if (!pilot) {
            console.log('🔧 No pilot data available, using defaults');
            // Use email as fallback
            const email = currentSession?.user?.email || 'Admin';
            updateHeaderAvatar(email, null);
            return;
        }

        try {
            // Update header avatar with pilot data
            console.log('🔧 Updating header avatar with pilot data:', { 
                displayName: pilot.display_name, 
                photoUrl: pilot.photo_url 
            });
            updateHeaderAvatar(pilot.display_name, pilot.photo_url);
        } catch (err) {
            console.warn('Some elements not available for admin pilot profile rendering:', err);
        }
    }

    // Avatar Event Listeners Setup
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
        if (dropdown && !dropdown.contains(event.target)) {
            closeAvatarDropdown();
        }
    });
})();

















