(() => {
    let supabaseClient = null;
    let currentSession = null;
    let paymentCurrency = 'USDT';
    let pilotProfile = null;
    let ownedVehicles = [];
    let minutePackages = [];
    let serverSession = null;
    let userGroups = [];
    let rbacUnsubscribe = null;
    const REQUIRED_GROUP = 'pilot';
    let storageHelper = null;
    let pilotPhotoUpload = null;

    const els = {
        authSection: document.getElementById('auth-section'),
        loginForm: document.getElementById('login-form'),
        loginEmail: document.getElementById('login-email'),
        loginPassword: document.getElementById('login-password'),
        registerBtn: document.getElementById('register-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        authAlert: document.getElementById('auth-alert'),
        authEmail: document.getElementById('auth-email'),
        loggedInActions: document.getElementById('logged-in-actions'),
        pilotSection: document.getElementById('pilot-profile-section'),
        pilotForm: document.getElementById('pilot-profile-form'),
        pilotName: document.getElementById('pilot-name'),
        pilotWallet: document.getElementById('pilot-wallet'),
        pilotVehicleId: document.getElementById('pilot-vehicle-id'),
        pilotAlert: document.getElementById('profile-alert'),
        rewardsSection: document.getElementById('rewards-access-section'),
        selectedVehicleSection: document.getElementById('selected-vehicle-section'),
        ticketsSection: document.getElementById('tickets-list-section'),
        ticketsList: document.getElementById('tickets-list'),
        currencyLabel: document.getElementById('currency-label'),
        amountCurrencyLabel: document.getElementById('amount-currency-label'),
        amountCurrencyLabelInline: document.getElementById('amount-currency-label-inline'),
        ticketPackage: document.getElementById('ticket-package'),
        walletInfo: document.getElementById('wallet-info'),
        walletAddress: document.getElementById('wallet-address'),
        walletQr: document.getElementById('wallet-qr'),
        walletAlert: document.getElementById('wallet-alert')
    };

    document.addEventListener('DOMContentLoaded', init);

    function initializePhotoUploadComponents() {
        if (window.PhotoUploadComponent && storageHelper) {
            // Initialize pilot profile photo upload
            pilotPhotoUpload = new window.PhotoUploadComponent('pilot-photo-upload', {
                category: 'pilotProfiles',
                entityId: null, // Will be set when user logs in
                multiple: false,
                showPreview: true,
                onUploadSuccess: (results) => {
                    console.log('Pilot photo uploaded:', results);
                    // Update pilot profile with photo URL
                    if (results.length > 0) {
                        updatePilotPhotoInProfile(results[0].publicUrl);
                    }
                },
                onUploadError: (error) => {
                    console.error('Pilot photo upload failed:', error);
                }
            });
            pilotPhotoUpload.setStorageHelper(storageHelper);
        }
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
        if (els.pilotForm) {
            els.pilotForm.addEventListener('submit', handleProfileSave);
        }

        // Change photo button
        const changePhotoBtn = document.getElementById('change-photo-btn');
        if (changePhotoBtn) {
            changePhotoBtn.addEventListener('click', handleChangePhoto);
        }

        // Avatar dropdown
        const avatarToggle = document.getElementById('user-avatar-toggle');
        if (avatarToggle) {
            avatarToggle.addEventListener('click', handleAvatarDropdown);
        }

        // Header logout button
        const headerLogoutBtn = document.getElementById('header-logout-btn');
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', handleLogout);
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const dropdown = document.getElementById('user-avatar-dropdown');
            const toggle = document.getElementById('user-avatar-toggle');
            if (dropdown && !dropdown.contains(event.target)) {
                closeAvatarDropdown();
            }
        });
    }

    function handleChangePhoto() {
        const uploadDiv = document.getElementById('pilot-photo-upload');
        if (uploadDiv) {
            uploadDiv.style.display = 'block';
            // Scroll to upload component
            uploadDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function handleAvatarDropdown(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('user-avatar-dropdown');
        const menu = dropdown?.querySelector('.pf-v6-c-menu__list');
        const toggle = document.getElementById('user-avatar-toggle');
        
        if (menu && toggle) {
            const isHidden = menu.hasAttribute('hidden');
            if (isHidden) {
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

    async function init() {
        attachListeners();
        try {
            const config = await loadPublicConfig();
            if (config?.payments?.defaultCurrency) {
                paymentCurrency = config.payments.defaultCurrency;
            }
            updateCurrencyLabels();

            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                setAlert(els.authAlert, 'Supabase is not configured on this server. Please contact support.', 'error');
                disableForms();
                return;
            }

            supabaseClient = window.supabase.createClient(config.supabase.url, config.supabase.anonKey);
            
            // Initialize storage helper for photo uploads
            if (window.SupabaseStorageHelper) {
                storageHelper = new window.SupabaseStorageHelper(supabaseClient);
                initializePhotoUploadComponents();
            }
            
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
                    if (sessionEmail && els.authEmail) {
                        els.authEmail.textContent = sessionEmail;
                    }
                });
            }
            const { data } = await supabaseClient.auth.getSession();
            await handleSessionChange(data?.session ?? null);

            supabaseClient.auth.onAuthStateChange(async (_event, session) => {
                await handleSessionChange(session ?? null);
            });
        } catch (err) {
            console.error('Failed to bootstrap pilot profile UI:', err);
            setAlert(els.authAlert, 'Unable to initialise pilot profile interface. Please refresh or try again later.', 'error');
        }
    }

    function updateCurrencyLabels() {
        if (els.currencyLabel) {
            els.currencyLabel.textContent = paymentCurrency;
        }
        if (els.amountCurrencyLabel) {
            els.amountCurrencyLabel.textContent = paymentCurrency;
        }
        if (els.amountCurrencyLabelInline) {
            els.amountCurrencyLabelInline.textContent = paymentCurrency;
        }
    }

    function populateMinutePackages() {
        if (!els.ticketPackage) {
            return;
        }

        const select = els.ticketPackage;
        select.innerHTML = '<option value="">Select a package...</option>';

        if (!minutePackages.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No packages configured';
            option.disabled = true;
            select.appendChild(option);
            if (els.ticketPackage) {
                els.ticketPackage.disabled = true;
            }
            const submitBtn = els.ticketForm?.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
            }
            setAlert(els.ticketAlert, 'Minute packages are not configured yet. Please contact race control.', 'error');
            return;
        }

        minutePackages.forEach(pkg => {
            const option = document.createElement('option');
            option.value = pkg.id;
            const minutes = pkg.minutes || 0;
            const label = pkg.label || `${minutes} min`;
            option.textContent = `${label}`;
            select.appendChild(option);
        });
        select.disabled = false;
        const submitBtn = els.ticketForm?.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
        }
    }

    function renderWalletInfo(walletAddress) {
        hideAlert(els.walletAlert);

        if (!els.walletInfo) {
            return;
        }

        const trimmed = walletAddress ? String(walletAddress).trim() : '';

        if (!trimmed) {
            els.walletInfo.classList.add('hidden');
            if (els.walletAddress) {
                els.walletAddress.textContent = '';
                els.walletAddress.classList.add('muted');
            }
            clearWalletQr();
            setAlert(els.walletAlert, 'Race wallet address is not configured yet. Please contact race control.', 'info');
            return;
        }

        els.walletInfo.classList.remove('hidden');
        if (els.walletAddress) {
            els.walletAddress.textContent = trimmed;
            els.walletAddress.classList.remove('muted');
        }
        hideAlert(els.walletAlert);
        drawWalletQr(trimmed);
    }

    function clearWalletQr() {
        if (els.walletQr && els.walletQr.getContext) {
            const ctx = els.walletQr.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, els.walletQr.width, els.walletQr.height);
            }
        }
    }

    function drawWalletQr(walletAddress) {
        if (!els.walletQr || typeof QRCode === 'undefined') {
            return;
        }
        QRCode.toCanvas(els.walletQr, walletAddress, {
            width: els.walletQr.width,
            margin: 1,
            color: {
                dark: '#0f172a',
                light: '#ffffffff'
            }
        }, (error) => {
            if (error) {
                console.error('Failed to render wallet QR code:', error);
                setAlert(els.walletAlert, 'Unable to render wallet QR code.', 'error');
            }
        });
    }

    async function loadPublicConfig() {
        const response = await fetch('/api/public-config');
        if (!response.ok) {
            throw new Error('Failed to load public configuration');
        }
        return response.json();
    }

    function disableForms() {
        if (els.loginForm) {
            Array.from(els.loginForm.elements).forEach(el => el.disabled = true);
        }
        if (els.pilotForm) {
            Array.from(els.pilotForm.elements).forEach(el => el.disabled = true);
        }
        if (els.ticketForm) {
            Array.from(els.ticketForm.elements).forEach(el => el.disabled = true);
        }
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
        const hasAccess = hasGroup(REQUIRED_GROUP) || hasGroup('pilot_portal') || hasGroup('admin');

        toggleSection(els.loginForm, !isAuthenticated);
        toggleSection(els.loggedInActions, isAuthenticated && hasAccess);
        toggleSection(els.pilotSection, isAuthenticated && hasAccess);
        toggleSection(els.selectedVehicleSection, isAuthenticated && hasAccess);
        toggleSection(els.rewardsSection, isAuthenticated && hasAccess);
        toggleSection(els.ticketsSection, isAuthenticated && hasAccess);

        if (els.authAlert) {
            hideAlert(els.authAlert);
        }

        if (isAuthenticated) {
            const email =
                serverSession?.user?.email ||
                session.user?.email ||
                'Unknown email';
            if (els.authEmail) {
                els.authEmail.textContent = email;
            }
            
            // Set user ID for photo upload component
            if (pilotPhotoUpload && session?.user?.id) {
                pilotPhotoUpload.setEntityId(session.user.id);
            }
            
            // Initialize header avatar with basic info (will be updated when pilot data loads)
            updateHeaderAvatar(email, null);
            
            if (!hasAccess) {
                setAlert(els.authAlert, 'Your account does not have access to the pilot portal yet.', 'warning');
                return;
            }
            refreshPilotData();
        } else {
            if (window.FPVRBAC) {
                window.FPVRBAC.clearSession();
            }
            pilotProfile = null;
            if (els.loginForm) {
                els.loginForm.reset();
            }
            if (els.pilotForm) {
                els.pilotForm.reset();
            }
            if (els.ticketsList) {
                els.ticketsList.innerHTML = '<p>Sign in to see your tickets.</p>';
            }
            ownedVehicles = [];
            populateOwnedVehicleOptions();
            
            // Hide avatar dropdown when logged out
            const avatarDropdown = document.getElementById('user-avatar-dropdown');
            if (avatarDropdown) {
                avatarDropdown.classList.add('hidden');
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
            setAlert(els.authAlert, 'Enter your email and a password (minimum 6 characters) to register.', 'error');
            return;
        }
        if (password.length < 6) {
            setAlert(els.authAlert, 'Password must be at least 6 characters long.', 'error');
            return;
        }
        setAlert(els.authAlert, 'Creating your account...', 'info');
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) {
            setAlert(els.authAlert, error.message, 'error');
            return;
        }
        setAlert(els.authAlert, 'Check your inbox to confirm your email before signing in.', 'success');
    }

    async function handleLogout() {
        if (!supabaseClient) {
            return;
        }
        await supabaseClient.auth.signOut();
    }

    async function refreshPilotData() {
        if (!currentSession) {
            return;
        }
        try {
            const response = await authenticatedRequest('/api/pilots/me');
            pilotProfile = response?.pilot ?? null;
            await loadOwnedVehicles();
            renderPilotProfile(pilotProfile);
            renderTickets(response?.tickets ?? []);
        } catch (err) {
            console.error('Failed to refresh pilot data:', err);
            setAlert(els.pilotAlert, 'Unable to load pilot profile. Please refresh.', 'error');
        }
    }

    function renderPilotProfile(pilot) {
        if (!pilot) {
            if (els.pilotForm) {
                els.pilotForm.reset();
            }
            // Hide photo display if no pilot
            const currentPhotoDiv = document.getElementById('current-pilot-photo');
            if (currentPhotoDiv) {
                currentPhotoDiv.classList.add('hidden');
            }
            return;
        }

        try {
            if (els.pilotName && 'value' in els.pilotName) {
                els.pilotName.value = pilot.display_name || '';
            }
            if (els.pilotWallet && 'value' in els.pilotWallet) {
                els.pilotWallet.value = pilot.wallet_address || '';
            }
            if (els.pilotVehicleId && 'value' in els.pilotVehicleId) {
                els.pilotVehicleId.value = pilot.vehicle_id || '';
            }

            // Handle profile photo display
            updatePilotPhotoDisplay(pilot.photo_url);
            
            // Update header avatar
            updateHeaderAvatar(pilot.display_name, pilot.photo_url);

            // Handle selected vehicle display
            renderSelectedVehicle(pilot.vehicle_id);

        } catch (err) {
            console.warn('Some form elements not available for pilot profile rendering:', err);
        }
    }

    function renderSelectedVehicle(vehicleId) {
        const noVehicleState = document.getElementById('no-vehicle-state');
        const selectedVehicleDisplay = document.getElementById('selected-vehicle-display');
        
        if (!noVehicleState || !selectedVehicleDisplay) return;

        if (!vehicleId) {
            // No vehicle selected
            noVehicleState.classList.remove('hidden');
            selectedVehicleDisplay.classList.add('hidden');
            return;
        }

        // Find the selected vehicle from owned vehicles
        const selectedVehicle = ownedVehicles.find(v => v.vehicle_id === vehicleId);
        console.log('Looking for vehicle ID:', vehicleId);
        console.log('Available vehicles:', ownedVehicles);
        console.log('Selected vehicle:', selectedVehicle);
        
        if (!selectedVehicle) {
            // Vehicle ID set but not found in owned vehicles
            noVehicleState.classList.remove('hidden');
            selectedVehicleDisplay.classList.add('hidden');
            return;
        }

        // Show selected vehicle
        noVehicleState.classList.add('hidden');
        selectedVehicleDisplay.classList.remove('hidden');

        // Populate vehicle details
        const nameEl = document.getElementById('selected-vehicle-name');
        const typeEl = document.getElementById('selected-vehicle-type');
        const idEl = document.getElementById('selected-vehicle-id');
        const sourceEl = document.getElementById('selected-vehicle-source');
        const photoEl = document.getElementById('selected-vehicle-photo');

        if (nameEl) nameEl.textContent = selectedVehicle.vehicle_name || selectedVehicle.item_name || 'Unknown Vehicle';
        if (typeEl) typeEl.textContent = selectedVehicle.vehicle_type || 'Racing Vehicle';
        if (idEl) idEl.textContent = selectedVehicle.vehicle_id;
        
        // Update source label
        if (sourceEl) {
            const sourceSpan = sourceEl.querySelector('.pf-v6-c-label__text');
            if (sourceSpan) {
                sourceSpan.textContent = selectedVehicle.source === 'purchase' ? 'Purchased' : 'Unlocked';
            }
            sourceEl.className = `pf-v6-c-label ${selectedVehicle.source === 'purchase' ? 'pf-m-blue' : 'pf-m-green'}`;
        }

        // Handle vehicle photo
        const photoUrl = selectedVehicle.photo_url || selectedVehicle.metadata?.photo_url;
        const fallbackEl = document.getElementById('vehicle-photo-fallback');
        console.log('Vehicle photo URL:', photoUrl, 'for vehicle:', selectedVehicle.vehicle_id);
        console.log('Photo element found:', !!photoEl, 'Fallback element found:', !!fallbackEl);
        
        if (photoEl && photoUrl) {
            photoEl.src = photoUrl;
            photoEl.style.display = 'block';
            photoEl.style.visibility = 'visible';
            photoEl.style.opacity = '1';
            
            // Hide the fallback when photo is present
            if (fallbackEl) {
                fallbackEl.style.display = 'none';
            }
            
            console.log('Displaying vehicle photo:', photoUrl);
            console.log('Photo element after update - src:', photoEl.src, 'display:', photoEl.style.display);
        } else {
            // No photo URL, show fallback
            if (photoEl) {
                photoEl.src = '';
                photoEl.style.display = 'none';
            }
            if (fallbackEl) {
                fallbackEl.style.display = 'flex';
            }
            console.log('No vehicle photo URL found, showing fallback');
        }
    }

    function updatePilotPhotoDisplay(photoUrl) {
        const currentPhotoDiv = document.getElementById('current-pilot-photo');
        const photoImage = document.getElementById('pilot-photo-image');
        const uploadDiv = document.getElementById('pilot-photo-upload');

        if (!currentPhotoDiv || !photoImage) return;

        if (photoUrl) {
            // Show current photo
            photoImage.src = photoUrl;
            currentPhotoDiv.classList.remove('hidden');
            
            // Hide upload component initially when photo exists
            if (uploadDiv) {
                uploadDiv.style.display = 'none';
            }
        } else {
            // No photo, hide current photo display and show upload
            currentPhotoDiv.classList.add('hidden');
            if (uploadDiv) {
                uploadDiv.style.display = 'block';
            }
        }
    }

    async function updatePilotPhotoInProfile(photoUrl) {
        if (!currentSession || !photoUrl) {
            return;
        }
        
        try {
            // Update the pilot profile with the new photo URL
            const response = await authenticatedRequest('/api/pilots/me', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    photo_url: photoUrl
                })
            });
            
            if (response.success) {
                // Update local pilot profile
                if (pilotProfile) {
                    pilotProfile.photo_url = photoUrl;
                }
                
                // Update the photo display immediately
                updatePilotPhotoDisplay(photoUrl);
                
                console.log('Pilot profile photo updated successfully');
            }
        } catch (error) {
            console.error('Failed to update pilot profile photo:', error);
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

    function populateOwnedVehicleOptions() {
        const select = document.getElementById('pilot-vehicle-id');
        if (!select) {
            return;
        }

        const previousValue = select.value || '';

        if (!Array.isArray(ownedVehicles) || ownedVehicles.length === 0) {
            select.innerHTML = `<option value="">No purchased vehicles available</option>`;
            select.disabled = true;
            return;
        }

        select.disabled = false;
        const optionMarkup = ['<option value="">Select a purchased vehicle...</option>'];

        for (const vehicle of ownedVehicles) {
            const vehicleIdRaw = vehicle?.vehicle_id;
            if (!vehicleIdRaw) {
                continue;
            }
            const vehicleId = escapeHtml(String(vehicleIdRaw));
            const labelParts = [];
            if (vehicle.vehicle_name && vehicle.vehicle_name !== vehicleIdRaw) {
                labelParts.push(vehicle.vehicle_name);
            }
            if (vehicle.vehicle_type) {
                labelParts.push(vehicle.vehicle_type);
            }
            if (!labelParts.length && vehicle.item_name) {
                labelParts.push(vehicle.item_name);
            }
            const labelText = labelParts.length ? escapeHtml(labelParts.join(' - ')) : vehicleId;
            optionMarkup.push(`<option value="${vehicleId}">${labelText}</option>`);
        }

        if (pilotProfile?.vehicle_id && !ownedVehicles.some(vehicle => vehicle.vehicle_id === pilotProfile.vehicle_id)) {
            const fallback = escapeHtml(String(pilotProfile.vehicle_id));
            optionMarkup.splice(1, 0, `<option value="${fallback}">${fallback}</option>`);
        }

        select.innerHTML = optionMarkup.join('');

        const desiredValue = pilotProfile?.vehicle_id || previousValue;
        if (desiredValue && Array.from(select.options).some(opt => opt.value === desiredValue)) {
            select.value = desiredValue;
        } else {
            select.value = '';
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

    async function loadOwnedVehicles() {
        if (!currentSession) {
            ownedVehicles = [];
            populateOwnedVehicleOptions();
            return ownedVehicles;
        }

        try {
            const response = await authenticatedRequest('/api/pilots/vehicles');
            ownedVehicles = Array.isArray(response?.vehicles) ? response.vehicles : [];
        } catch (err) {
            console.error('Failed to load owned vehicles:', err);
            ownedVehicles = [];
        }

        populateOwnedVehicleOptions();
        return ownedVehicles;
    }

    function renderTickets(tickets) {
        if (!els.ticketsList) {
            return;
        }

        if (!tickets.length) {
            els.ticketsList.innerHTML = `
                <div class="pf-v5-c-empty-state pf-m-sm">
                    <div class="pf-v5-c-empty-state__content">
                        <h3 class="pf-v5-c-title pf-m-md">No tickets yet</h3>
                        <p class="pf-v5-c-content pf-m-sm">Purchase race tickets from the rewards marketplace.</p>
                        <div class="pf-v5-c-content pf-v5-u-text-align-center pf-v5-u-mt-md">
                            <a href="rewards.html" class="pf-v5-c-button pf-c-button pf-m-secondary">
                                Visit Marketplace
                            </a>
                        </div>
                    </div>
                </div>
            `;
            els.ticketsList.classList.add('empty-state');
            if (typeof window.applyPatternFlyV5Bridge === 'function') {
                window.applyPatternFlyV5Bridge(els.ticketsList);
            }
            return;
        }

        els.ticketsList.classList.remove('empty-state');
        els.ticketsList.innerHTML = tickets.map(renderTicketCard).join('');
        if (typeof window.applyPatternFlyV5Bridge === 'function') {
            window.applyPatternFlyV5Bridge(els.ticketsList);
        }
    }

    function renderTicketCard(ticket) {
        const status = (ticket.payment_status || 'pending').toLowerCase();
        const ticketType = escapeHtml(ticket.ticket_type || 'race-pass');
        const eventName = escapeHtml(ticket.event_name || 'Unassigned event');
        const amountValue = typeof ticket.payment_amount === 'number'
            ? ticket.payment_amount.toFixed(2)
            : escapeHtml(String(ticket.payment_amount ?? '0'));
        const currency = escapeHtml(ticket.payment_currency || paymentCurrency);
        const eventDate = ticket.event_date
            ? new Date(ticket.event_date).toLocaleDateString()
            : 'TBD';
        const purchaseDate = ticket.purchased_at
            ? new Date(ticket.purchased_at).toLocaleString()
            : 'N/A';
        const reference = escapeHtml(ticket.payment_reference || 'Provided at pit lane');
        const packageMinutes = Number(ticket.package_minutes || 0);
        const packageLabel = ticket.package_label ? escapeHtml(ticket.package_label) : '';
        const packageDisplay = packageLabel
            ? `${packageLabel}${packageMinutes ? ' (' + packageMinutes + ' min)' : ''}`
            : (packageMinutes ? `${packageMinutes} min` : ticketType);
        const statusLabel = buildLabel(status.toUpperCase(), mapTicketStatusVariant(status));
        const redeemedLabel = ticket.redeemed
            ? buildLabel('Redeemed', 'green')
            : buildLabel('Pending Redemption', 'gold');

        return `
            <article class="pf-c-card pf-m-flat ticket-card">
                <header class="pf-c-card__header">
                    <div>
                        <h3 class="pf-c-title pf-m-md">${ticketType}</h3>
                        <span class="pf-u-color-200">${eventName}</span>
                    </div>
                    ${statusLabel}
                </header>
                <div class="pf-c-card__body">
                    <dl class="pf-c-description-list pf-m-vertical ticket-meta">
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Event Date</dt>
                            <dd class="pf-c-description-list__description">${eventDate}</dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Package</dt>
                            <dd class="pf-c-description-list__description">${packageDisplay}</dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Redeemed</dt>
                            <dd class="pf-c-description-list__description">${redeemedLabel}</dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Amount</dt>
                            <dd class="pf-c-description-list__description">${amountValue} ${currency}</dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Transaction</dt>
                            <dd class="pf-c-description-list__description"><code class="pf-u-font-family-monospace">${reference}</code></dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">Purchased</dt>
                            <dd class="pf-c-description-list__description">${purchaseDate}</dd>
                        </div>
                    </dl>
                </div>
            </article>
        `;
    }

    async function handleProfileSave(event) {
        event.preventDefault();
        if (!currentSession) {
            return;
        }

        try {
            const payload = {
                display_name: (els.pilotName && 'value' in els.pilotName) ? els.pilotName.value.trim() : '',
                wallet_address: (els.pilotWallet && 'value' in els.pilotWallet) ? els.pilotWallet.value.trim() : '',
                vehicle_id: (els.pilotVehicleId && 'value' in els.pilotVehicleId) ? els.pilotVehicleId.value.trim() : ''
            };
            setAlert(els.pilotAlert, 'Saving profile...', 'info');
            const response = await authenticatedRequest('/api/pilots/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            pilotProfile = response?.pilot ?? pilotProfile;
            renderPilotProfile(pilotProfile);
            setAlert(els.pilotAlert, 'Profile updated successfully.', 'success');
        } catch (err) {
            console.error('Failed to update pilot profile:', err);
            setAlert(els.pilotAlert, err.message || 'Failed to update profile.', 'error');
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

    async function authenticatedRequest(url, options = {}) {
        if (!currentSession?.access_token) {
            console.error('No access token in session:', currentSession);
            throw new Error('Authentication required');
        }
        
        console.log('Making request to:', url);
        console.log('Session structure:', Object.keys(currentSession || {}));
        console.log('Access token present:', !!currentSession.access_token);
        
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${currentSession.access_token}`
        };
        const response = await fetch(url, { ...options, headers });
        console.log('Response status:', response.status, response.statusText);
        
        const payload = await safeParseJson(response);
        if (!response.ok) {
            console.error('Request failed with payload:', payload);
            const message = payload?.error || response.statusText || 'Request failed';
            throw new Error(message);
        }
        return payload ?? {};
    }

    async function safeParseJson(response) {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    function buildLabel(text, variant = 'outline') {
        const modifier = variant ? ` pf-m-${variant}` : '';
        return `<span class="pf-c-label pf-v5-c-label${modifier}"><span class="pf-c-label__content">${escapeHtml(text)}</span></span>`;
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

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
        const dropdown = document.getElementById('user-avatar-dropdown');
        if (dropdown && !dropdown.contains(event.target)) {
            const menu = dropdown.querySelector('.pf-v6-c-menu__list');
            const toggle = document.getElementById('user-avatar-toggle');
            if (menu && toggle) {
                menu.setAttribute('hidden', '');
                toggle.setAttribute('aria-expanded', 'false');
            }
        }
    });
})();

