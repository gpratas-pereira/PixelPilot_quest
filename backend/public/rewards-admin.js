console.log('rewards-admin.js loading...');

try {
    console.log('About to start IIFE...');
    
    (() => {
        console.log('rewards-admin.js IIFE starting...');
    
    // Enhanced browser extension error prevention
    if (typeof window !== 'undefined') {
        console.log('Window object exists, setting up browser extension prevention...');
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
            console.log('Error intercepted:', { message, source, lineno, colno, error });
            
            // Check if this is an extension-related error
            if (message && (
                message.includes('Cannot read properties of undefined') ||
                message.includes('Cannot read property') ||
                message.includes('enabled') ||
                message.includes('popup.js') ||
                source?.includes('popup.js') ||
                source?.includes('extension') ||
                source?.includes('chrome-extension') ||
                source?.includes('moz-extension') ||
                source?.includes('safari-extension') ||
                (source && source !== window.location.href && !source.includes(window.location.hostname))
            )) {
                console.log('Suppressing browser extension error:', message);
                // Silently suppress browser extension errors
                return true; // Prevent the error from being logged
            }

            console.log('Allowing error to propagate:', message);
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
                event.reason.message?.includes('popup.js') ||
                event.reason.stack?.includes('popup.js') ||
                event.reason.stack?.includes('extension')
            )) {
                // Silently suppress browser extension promise rejections
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
                message.includes('popup.js') ||
                args.some(arg => arg?.includes?.('popup.js') ||
                                arg?.includes?.('extension') ||
                                arg?.includes?.('chrome-extension'))) {
                // Silently suppress browser extension console errors
                return;
            }
            originalConsoleError.apply(console, args);
        };
    }

    let currentSession = null;
    let currentTab = 'items';
    let allPilots = [];
    let allVehicles = [];
    let adminItems = [];
    let supabaseClient = null;
    let pilotProfile = null;
    let serverSession = null;
    let userGroups = [];
    let rbacUnsubscribe = null;
    const REQUIRED_GROUP = 'rewards_admin';
    let storageHelper = null;
    let itemPhotoUpload = null;
    let vehiclePhotoUpload = null;

    // Initialize the application when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, starting rewards-admin initialization...');
        init();
    });

    // Also add a fallback in case DOMContentLoaded already fired
    if (document.readyState === 'loading') {
        console.log('Document still loading, waiting for DOMContentLoaded...');
    } else {
        console.log('Document already loaded, initializing immediately...');
        setTimeout(() => init(), 100);
    }

    async function init() {
        console.log('Initializing rewards admin...');
        try {
            console.log('Loading public config...');
            const config = await loadPublicConfig();
            console.log('Config loaded:', config);
            
            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                console.error('Supabase config missing:', config);
                showAuthError('Supabase is not configured on the server. Please check the environment variables.');
                return;
            }

            console.log('Creating supabase client...');
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
                    if (sessionEmail) {
                        const adminEmail = document.getElementById('admin-email');
                        if (adminEmail) {
                            adminEmail.textContent = sessionEmail;
                        }
                    }
                });
            }
            
            console.log('Getting initial session...');
            const { data } = await supabaseClient.auth.getSession();
            // Security: Don't log session data containing tokens
            console.log('Session exists:', !!data?.session);
            await handleSessionChange(data?.session ?? null);

            console.log('Setting up auth state change listener...');
            supabaseClient.auth.onAuthStateChange(async (event, session) => {
                console.log('Auth state change:', event, session ? 'session exists' : 'no session');
                await handleSessionChange(session ?? null);
            });

            console.log('Setting up event listeners...');
            setupEventListeners();
            console.log('Rewards admin initialization complete');
        } catch (err) {
            console.error('Failed to initialize admin:', err);
            console.error('Error stack:', err.stack);
            showAuthError('Failed to initialize. Please refresh the page or check server configuration.');
        }
    }

    function initializePhotoUploadComponents() {
        if (window.PhotoUploadComponent && storageHelper) {
            console.log('Initializing photo upload components...');
            
            // Initialize marketplace item photo upload
            itemPhotoUpload = new window.PhotoUploadComponent('item-photo-upload', {
                category: 'marketplaceItems',
                entityId: `temp-item-${Date.now()}`, // Set initial temporary ID
                multiple: false,
                showPreview: true,
                onUploadSuccess: (results) => {
                    console.log('Item photo uploaded:', results);
                    if (results.length > 0) {
                        // Store the photo URL to include when saving the item
                        const currentForm = document.getElementById('item-form');
                        if (currentForm) {
                            currentForm.dataset.photoUrl = results[0].publicUrl;
                            console.log('Stored photo URL in form:', results[0].publicUrl);
                            showNotification('Photo uploaded successfully!', 'success');
                        }
                    }
                },
                onUploadError: (error) => {
                    console.error('Item photo upload failed:', error);
                }
            });
            itemPhotoUpload.setStorageHelper(storageHelper);
            
            // Initialize vehicle photo upload
            vehiclePhotoUpload = new window.PhotoUploadComponent('vehicle-photo-upload', {
                category: 'vehicles',
                entityId: `temp-vehicle-${Date.now()}`, // Set initial temporary ID
                multiple: false,
                showPreview: true,
                onUploadSuccess: (results) => {
                    console.log('Vehicle photo uploaded:', results);
                    if (results.length > 0) {
                        // Store the photo URL to include when saving the vehicle
                        const currentForm = document.getElementById('vehicle-form');
                        if (currentForm) {
                            currentForm.dataset.photoUrl = results[0].publicUrl;
                            console.log('Stored photo URL in form:', results[0].publicUrl);
                            showNotification('Vehicle photo uploaded successfully!', 'success');
                        }
                    }
                },
                onUploadError: (error) => {
                    console.error('Vehicle photo upload failed:', error);
                }
            });
            vehiclePhotoUpload.setStorageHelper(storageHelper);
            
            console.log('Photo upload components initialized successfully');
        } else {
            console.warn('Photo upload components not initialized:', {
                PhotoUploadComponent: !!window.PhotoUploadComponent,
                storageHelper: !!storageHelper
            });
        }
    }

    // Modal management functions
    function openItemModal(itemData = null) {
        const modal = document.getElementById('item-modal');
        const form = document.getElementById('item-form');
        const title = document.getElementById('item-modal-title') || document.querySelector('#item-modal .pf-v6-c-modal-box__title');
        
        if (title) {
            title.textContent = itemData ? 'Edit Item' : 'Add Item';
        }
        
        // Generate temporary ID for new items or use existing ID
        const entityId = itemData?.item_id || `temp-item-${Date.now()}`;
        
        // Set entity ID for photo upload
        if (itemPhotoUpload) {
            itemPhotoUpload.setEntityId(entityId);
            console.log('Set item photo upload entity ID:', entityId);
        }
        
        // Populate form if editing
        if (itemData && form) {
            form.querySelector('#item-name').value = itemData.name || '';
            form.querySelector('#item-description').value = itemData.description || '';
            form.querySelector('#item-type').value = itemData.item_type || '';
            form.querySelector('#item-points-price').value = itemData.points_price || '';
            form.querySelector('#item-usdt-price').value = itemData.usdt_price || '';
            form.querySelector('#item-stock').value = itemData.stock || -1;
            form.querySelector('#item-active').checked = itemData.is_active !== false;
            form.querySelector('#item-locked').checked = itemData.is_locked === true;
            // Set photo URL if available
            form.dataset.photoUrl = itemData.photo_url || '';
        } else if (form) {
            form.reset();
            form.querySelector('#item-stock').value = -1;
            form.querySelector('#item-active').checked = true;
            // Clear photo URL for new items (will be set by upload component)
            form.dataset.photoUrl = '';
        }
        
        modal.classList.remove('hidden');
    }
    
    function openVehicleModal(vehicleData = null) {
        const modal = document.getElementById('vehicle-modal');
        const form = document.getElementById('vehicle-form');
        const title = document.getElementById('vehicle-modal-title');
        
        if (title) {
            title.textContent = vehicleData ? 'Edit Vehicle' : 'Add Vehicle';
        }
        
        // Generate temporary ID for new vehicles or use existing ID
        const entityId = vehicleData?.vehicle_id || `temp-vehicle-${Date.now()}`;
        
        // Set entity ID for photo upload
        if (vehiclePhotoUpload) {
            vehiclePhotoUpload.setEntityId(entityId);
            console.log('Set vehicle photo upload entity ID:', entityId);
        }
        
        // Populate form if editing
        if (vehicleData && form) {
            form.querySelector('#vehicle-id').value = vehicleData.vehicle_id || '';
            form.querySelector('#vehicle-name').value = vehicleData.vehicle_name || vehicleData.name || '';
            form.querySelector('#vehicle-type').value = vehicleData.vehicle_type || vehicleData.type || '';
            form.querySelector('#vehicle-metadata').value = vehicleData.metadata ? JSON.stringify(vehicleData.metadata, null, 2) : '';
            // Set photo URL if available
            form.dataset.photoUrl = vehicleData.photo_url || vehicleData.metadata?.photo_url || '';
            // Disable ID field when editing
            form.querySelector('#vehicle-id').disabled = true;
        } else if (form) {
            form.reset();
            form.querySelector('#vehicle-id').disabled = false;
            // Clear photo URL for new vehicles
            form.dataset.photoUrl = '';
        }
        
        modal.classList.remove('hidden');
    }
    
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('hidden');
        
        // Clear photo upload components
        if (modalId === 'item-modal' && itemPhotoUpload) {
            itemPhotoUpload.clearSelection();
        }
        if (modalId === 'vehicle-modal' && vehiclePhotoUpload) {
            vehiclePhotoUpload.clearSelection();
        }
    }
    
    async function handleItemFormSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        
        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            
            const formData = {
                name: form.querySelector('#item-name').value,
                description: form.querySelector('#item-description').value,
                type: form.querySelector('#item-type').value,
                points_price: parseInt(form.querySelector('#item-points-price').value) || 0,
                usdt_price: parseFloat(form.querySelector('#item-usdt-price').value) || 0,
                stock: parseInt(form.querySelector('#item-stock').value) || -1,
                is_active: form.querySelector('#item-active').checked,
                is_locked: form.querySelector('#item-locked').checked,
                photo_url: form.dataset.photoUrl || null
            };

            // Handle vehicle ID for vehicle type items
            const vehicleSelect = form.querySelector('#item-vehicle-id');
            const selectedVehicleId = vehicleSelect ? vehicleSelect.value.trim() : '';
            
            if (formData.type === 'vehicle') {
                if (!selectedVehicleId) {
                    showNotification('Please select a vehicle for this marketplace item.', 'error');
                    return;
                }
                formData.vehicle_id = selectedVehicleId;
            }
            
            // Check if this is an edit operation
            const itemId = form.dataset.itemId;
            const isEdit = !!itemId;
            
            console.log('Submitting item data:', formData);
            console.log('Is edit operation:', isEdit, 'Item ID:', itemId);
            
            // Make API call to save the item
            let url = '/api/admin/rewards/items';
            let method = 'POST';
            
            if (isEdit) {
                url = `/api/admin/rewards/items/${itemId}`;
                method = 'PUT';
                formData.item_id = itemId; // Include item ID in the data for updates
            }
            
            const result = await authenticatedRequest(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            console.log('Item saved successfully!', result);
            showNotification(`Item ${isEdit ? 'updated' : 'created'} successfully!`, 'success');
            
            // Clear the photo URL from form data
            form.dataset.photoUrl = '';
            
            // Refresh items table
            await loadMarketplaceItems();
            
            closeModal('item-modal');
            
        } catch (error) {
            console.error('Error saving item:', error);
            const errorMessage = error.message || 'Failed to save item. Please try again.';
            showNotification(`Error: ${errorMessage}`, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Item';
        }
    }
    
    async function handleVehicleFormSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        
        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            
            const formData = {
                vehicle_id: form.querySelector('#vehicle-id').value,
                name: form.querySelector('#vehicle-name').value,
                type: form.querySelector('#vehicle-type').value,
                metadata: form.querySelector('#vehicle-metadata').value,
                photo_url: form.dataset.photoUrl || null
            };
            
            console.log('Submitting vehicle data:', formData);
            
            // Make API call to save the vehicle
            const result = await authenticatedRequest('/api/admin/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            console.log('Vehicle saved successfully!', result);
            showNotification('Vehicle saved successfully!', 'success');
            
            // Clear the photo URL from form data
            form.dataset.photoUrl = '';
            
            // Refresh vehicles table
            await loadVehicles();
            
            closeModal('vehicle-modal');
            
        } catch (error) {
            console.error('Error saving vehicle:', error);
            const errorMessage = error.message || 'Failed to save vehicle. Please try again.';
            showNotification(`Error: ${errorMessage}`, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Vehicle';
        }
    }

    function setupEventListeners() {
        console.log('Setting up event listeners...');
        
        // Login form
        const loginForm = document.getElementById('admin-login-form');
        console.log('Login form element:', loginForm ? 'found' : 'NOT FOUND');
        if (loginForm) {
            console.log('Attaching submit event listener to login form');
            loginForm.addEventListener('submit', handleLogin);
            
            // Also add debugging for form submission
            loginForm.addEventListener('submit', (e) => {
                console.log('Form submit event fired!', e);
            }, true); // Use capture phase to ensure this runs first
        } else {
            console.error('Could not find login form with ID: admin-login-form');
        }

        // Logout
        const logoutBtn = document.getElementById('admin-logout-btn');
        console.log('Logout button element:', logoutBtn ? 'found' : 'NOT FOUND');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
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

        // Add Rule button
        const addRuleBtn = document.getElementById('add-rule-btn');
        if (addRuleBtn) {
            addRuleBtn.addEventListener('click', () => openRuleModal());
        }

        // Tab navigation
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Add buttons
        const addItemBtn = document.getElementById('add-item-btn');
        if (addItemBtn) {
            addItemBtn.addEventListener('click', () => openItemModal());
        }

        const addAchievementBtn = document.getElementById('add-achievement-btn');
        if (addAchievementBtn) {
            addAchievementBtn.addEventListener('click', () => openAchievementModal());
        }

        const itemTypeSelect = document.getElementById('item-type');
        if (itemTypeSelect) {
            itemTypeSelect.addEventListener('change', () => {
                handleItemTypeChange();
            });
        }

        const addVehicleBtn = document.getElementById('add-vehicle-btn');
        if (addVehicleBtn) {
            addVehicleBtn.addEventListener('click', () => openVehicleModal());
        }
        
        // Modal close handlers
        document.querySelectorAll('.item-close').forEach(btn => {
            btn.addEventListener('click', () => closeModal('item-modal'));
        });
        
        document.querySelectorAll('.vehicle-close').forEach(btn => {
            btn.addEventListener('click', () => closeModal('vehicle-modal'));
        });
        
        // Form submissions
        const itemForm = document.getElementById('item-form');
        if (itemForm) {
            itemForm.addEventListener('submit', handleItemFormSubmit);
        }
        
        const vehicleForm = document.getElementById('vehicle-form');
        if (vehicleForm) {
            vehicleForm.addEventListener('submit', handleVehicleFormSubmit);
        }
        
        // Debug button for upload components
        const debugUploadsBtn = document.getElementById('debug-uploads-btn');
        if (debugUploadsBtn) {
            debugUploadsBtn.addEventListener('click', () => {
                console.log('=== Photo Upload Debug Info ===');
                console.log('Storage Helper:', !!storageHelper);
                if (itemPhotoUpload) {
                    console.log('Item Photo Upload:', itemPhotoUpload.getDebugInfo());
                } else {
                    console.log('Item Photo Upload: NOT INITIALIZED');
                }
                if (vehiclePhotoUpload) {
                    console.log('Vehicle Photo Upload:', vehiclePhotoUpload.getDebugInfo());
                } else {
                    console.log('Vehicle Photo Upload: NOT INITIALIZED');
                }
                console.log('Current session:', currentSession);
                console.log('User groups:', userGroups);
                console.log('==============================');
            });
        }

        const awardPointsBtn = document.getElementById('award-points-btn');
        if (awardPointsBtn) {
            awardPointsBtn.addEventListener('click', () => openAwardPointsModal());
        }

        // Forms (itemForm already handled above in modal section)

        const achievementForm = document.getElementById('achievement-form');
        if (achievementForm) {
            achievementForm.addEventListener('submit', handleAchievementSave);
        }

        const assignAchievementForm = document.getElementById('assign-achievement-form');
        if (assignAchievementForm) {
            assignAchievementForm.addEventListener('submit', handleAssignAchievement);
        }

        const pointRuleForm = document.getElementById('point-rule-form');
        if (pointRuleForm) {
            pointRuleForm.addEventListener('submit', handleRuleSave);
        }

        // vehicleForm already handled above in modal section

        // Search
        const pilotSearch = document.getElementById('pilot-search');
        if (pilotSearch) {
            pilotSearch.addEventListener('input', debounce(filterPilots, 300));
        }

        const vehicleSearch = document.getElementById('vehicle-search');
        if (vehicleSearch) {
            vehicleSearch.addEventListener('input', debounce(filterVehicles, 300));
        }

        // Vehicle assignment form
        const assignVehicleForm = document.getElementById('assign-vehicle-form');
        if (assignVehicleForm) {
            assignVehicleForm.addEventListener('submit', handleAssignVehicle);
        }

        // Award points form
        const awardPointsForm = document.getElementById('award-points-form');
        if (awardPointsForm) {
            awardPointsForm.addEventListener('submit', handleAwardPoints);
        }

        // Modal close buttons
        document.querySelectorAll('.point-rule-close, .point-rule-cancel').forEach(btn => {
            btn.addEventListener('click', () => hideModal('point-rule-modal'));
        });

        document.querySelectorAll('.assign-vehicle-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('assign-vehicle-modal'));
        });

        document.querySelectorAll('.achievement-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('achievement-modal'));
        });

        document.querySelectorAll('.assign-achievement-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('assign-achievement-modal'));
        });

        document.querySelectorAll('.vehicle-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('vehicle-modal'));
        });

        document.querySelectorAll('.item-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('item-modal'));
        });

        document.querySelectorAll('.award-points-close').forEach(btn => {
            btn.addEventListener('click', () => hideModal('award-points-modal'));
        });

        document.querySelectorAll('.modal-close, .pf-c-button[aria-label*="Close"], .pf-v6-c-button[aria-label*="Close"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.pf-v6-c-backdrop, .pf-c-backdrop');
                if (modal && modal.id) {
                    hideModal(modal.id);
                }
            });
        });
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
        const userEmail = currentSession?.user?.email;
        
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
            // Load pilot profile data using the same endpoint as profile.js
            const profileData = await authenticatedRequest('/api/pilots/me');
            
            console.log('🔧 Admin pilot profile loaded:', profileData);
            
            pilotProfile = profileData?.pilot ?? null;
            console.log('🔧 Final admin pilot profile:', pilotProfile);
            
            renderPilotProfile(pilotProfile);
        } catch (err) {
            console.error('Failed to load admin pilot data:', err);
            // Don't show error to user, just use defaults
            pilotProfile = null;
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

    async function handleLogin(event) {
        event.preventDefault();
        const email = document.getElementById('admin-login-email').value.trim();
        const password = document.getElementById('admin-login-password').value;

        console.log('Login attempt for email:', email);

        if (!email || !password) {
            showAuthError('Email and password required.');
            return;
        }

        showAuthInfo('Signing in...');

        try {
            console.log('Calling supabaseClient.auth.signInWithPassword...');
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            console.log('Supabase sign in result:', { data, error });
            
            if (error) {
                console.error('Supabase auth error:', error);
                showAuthError(error.message);
            } else if (data?.session) {
                console.log('Login successful for user:', data.session.user?.email);
                console.log('Session token present:', !!data.session.access_token);
                // Security: Don't log actual token values
                hideAuthAlert();
                // Session will be handled by the onAuthStateChange listener
            } else {
                console.log('No session in response data');
                showAuthError('Login failed - no session returned');
            }
        } catch (err) {
            console.error('Login error:', err);
            console.error('Login error stack:', err.stack);
            showAuthError('Failed to sign in. Please check your connection and try again.');
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
        console.log('handleSessionChange called with session:', session ? 'exists' : 'null');
        if (session) {
            console.log('Session user email:', session.user?.email);
            console.log('Session access_token present:', !!session.access_token);
            console.log('Session expires_at:', session.expires_at);
        }
        
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

        const authCard = document.getElementById('admin-auth-card');
        const content = document.getElementById('admin-content');
        
        console.log('Auth card element:', authCard ? 'found' : 'not found');
        console.log('Content element:', content ? 'found' : 'not found');
        console.log('Is authenticated:', isAuthenticated);
        
        if (authCard) {
            console.log('Setting auth card hidden:', isAuthenticated);
            authCard.classList.toggle('hidden', isAuthenticated);
        }
        if (content) {
            console.log('Setting content hidden:', !isAuthenticated || !hasAccess);
            content.classList.toggle('hidden', !isAuthenticated || !hasAccess);
        }

        hideAuthAlert();

        if (isAuthenticated) {
            const email =
                serverSession?.user?.email ||
                session.user?.email ||
                'Admin';
            const adminEmail = document.getElementById('admin-email');
            if (adminEmail) {
                adminEmail.textContent = email;
                console.log('Set admin email display to:', email);
            }

            // Load pilot profile data for admin user
            await loadAdminPilotData();

            if (!hasAccess) {
                showAuthError('Your account does not have Rewards Admin access.');
                return;
            }
            
            console.log('Authentication successful, showing content for:', email);
            
            // Show success notification
            showNotification(`Successfully logged in as ${email}`, 'success');
            
            // Load the initial tab data
            console.log('Loading initial tab data...');
            loadCurrentTabData();
        } else {
            console.log('Not authenticated, showing login form');
            if (window.FPVRBAC) {
                window.FPVRBAC.clearSession();
            }
        }
    }

    function switchTab(tabName) {
        currentTab = tabName;

        document.querySelectorAll('.pf-v6-c-tabs__item').forEach(item => {
            item.classList.remove('pf-m-current');
        });
        const activeTab = document.querySelector(`[data-tab="${tabName}"]`)?.closest('.pf-v6-c-tabs__item');
        if (activeTab) activeTab.classList.add('pf-m-current');

        document.querySelectorAll('.admin-tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        const activeContent = document.getElementById(`tab-${tabName}`);
        if (activeContent) activeContent.classList.remove('hidden');

        loadCurrentTabData();
    }

    async function loadCurrentTabData() {
        console.log('loadCurrentTabData called for tab:', currentTab);
        
        if (!currentSession) {
            console.log('No session available, skipping data load');
            return;
        }

        console.log('Session available, access_token present:', !!currentSession.access_token);

        try {
            console.log(`Loading data for tab: ${currentTab}`);
            switch (currentTab) {
                case 'items':
                    console.log('Loading marketplace items...');
                    await loadMarketplaceItems();
                    break;
                case 'achievements':
                    console.log('Loading achievements...');
                    await loadAchievements();
                    break;
                case 'vehicles':
                    console.log('Loading vehicles...');
                    await loadVehicles();
                    break;
                case 'rules':
                    console.log('Loading rules...');
                    await loadRules();
                    break;
                case 'pilots':
                    console.log('Loading pilots...');
                    await loadPilots();
                    // await loadVehicles(); // Vehicles not implemented yet
                    break;
            }
            console.log(`Successfully loaded data for tab: ${currentTab}`);
        } catch (err) {
            console.error('Failed to load data for tab:', currentTab, err);
            console.error('Data loading error stack:', err.stack);
            // Show a user-friendly error without causing authentication loops
            showNotification(`Failed to load ${currentTab} data. Please try refreshing or check permissions.`, 'warning');
            // Don't clear session or redirect to login - keep user logged in even if data loading fails
        }
    }

    async function loadItems() {
        try {
            const data = await authenticatedRequest('/api/admin/rewards/items');
            const tbody = document.getElementById('items-table-body');
            
            if (!tbody) return;

            adminItems = Array.isArray(data?.items) ? data.items : [];

            if (adminItems.length === 0) {
                tbody.innerHTML = '<tr class="pf-v6-c-table__tr><td colspan="7" class="pf-v6-c-table__th">No items found</td></tr>';
                return;
            }

            tbody.innerHTML = adminItems.map(renderItemRow).join('');
            
            // Add event listeners
            tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const itemId = btn.dataset.itemId;
                    const item = adminItems.find(i => i.item_id === itemId);
                    if (item) openItemModal(item);
                });
            });

            tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Delete this item?')) {
                        deleteItem(btn.dataset.itemId);
                    }
                });
            });
        } catch (err) {
            console.error('Failed to load items:', err);
        }
    }

    function renderItemRow(item) {
        const statusLabel = item.is_active 
            ? '<span class="pf-v6-c-label pf-m-green">Active</span>'
            : '<span class="pf-v6-c-label pf-m-red">Inactive</span>';

        const lockLabel = item.is_locked === true
            ? '<span class="pf-v6-c-label pf-m-gold">Locked</span>'
            : '<span class="pf-v6-c-label pf-m-outline">Unlocked</span>';

        const typeDisplay = escapeHtml(item.item_type || '');
        const vehicleDetail = (item.item_type === 'vehicle' && item.metadata && item.metadata.vehicle_id)
            ? `<div class="pf-v6-u-font-size-sm pf-v6-u-color-200">Vehicle: ${escapeHtml(item.metadata.vehicle_id)}</div>`
            : '';

        return `
            <tr class="pf-v6-c-table__tr">
                <td class="pf-v6-c-table__th">${escapeHtml(item.name)}</td>
                <td class="pf-v6-c-table__th">${typeDisplay}${vehicleDetail}</td>
                <td class="pf-v6-c-table__th">${item.points_price || '-'}</td>
                <td class="pf-v6-c-table__th">${item.usdt_price || '-'}</td>
                <td class="pf-v6-c-table__th">${item.stock === -1 ? 'Unlimited' : item.stock}</td>
                <td class="pf-v6-c-table__th">${statusLabel} ${lockLabel}</td>
                <td>
                    <button class="pf-v6-c-button pf-m-secondary pf-m-small" data-action="edit" data-item-id="${item.item_id}">Edit</button>
                    <button class="pf-v6-c-button pf-m-danger pf-m-small" data-action="delete" data-item-id="${item.item_id}">Delete</button>
                </td>
            </tr>
        `;
    }
    async function openItemModal(item = null) {
        const modal = document.getElementById('item-modal');
        const title = document.getElementById('item-modal-title');
        const form = document.getElementById('item-form');
        const typeSelect = document.getElementById('item-type');
        const vehicleGroup = document.getElementById('item-vehicle-group');
        const vehicleSelect = document.getElementById('item-vehicle-id');
        
        if (!modal || !form || !typeSelect || !vehicleGroup || !vehicleSelect) return;

        title.textContent = item ? 'Edit Item' : 'Add Item';
        vehicleGroup.classList.add('hidden');
        
        if (item) {
            form.dataset.itemId = item.item_id;
            document.getElementById('item-name').value = item.name || '';
            document.getElementById('item-description').value = item.description || '';
            typeSelect.value = item.item_type || '';
            document.getElementById('item-points-price').value = item.points_price || '';
            document.getElementById('item-usdt-price').value = item.usdt_price || '';
            document.getElementById('item-stock').value = item.stock ?? -1;
            document.getElementById('item-active').checked = item.is_active ?? true;
            document.getElementById('item-locked').checked = item.is_locked === true;
        } else {
            delete form.dataset.itemId;
            form.reset();
            // Ensure default states for new items
            document.getElementById('item-active').checked = true;
            document.getElementById('item-locked').checked = false;
            typeSelect.value = '';
            vehicleSelect.value = '';
            vehicleSelect.disabled = false;
        }

        const preselectedVehicleId = (item && item.metadata && item.metadata.vehicle_id)
            ? item.metadata.vehicle_id
            : '';

        await handleItemTypeChange({ preselectedVehicleId });

        showModal('item-modal');
    }

    async function handleItemSave(event) {
        event.preventDefault();
        const form = event.target;
        const itemId = form.dataset.itemId;

        const lockedCheckbox = document.getElementById('item-locked');
        const lockedValue = lockedCheckbox ? lockedCheckbox.checked : false;
        
        const payload = {
            name: document.getElementById('item-name').value.trim(),
            description: document.getElementById('item-description').value.trim(),
            item_type: document.getElementById('item-type').value,
            points_price: parseInt(document.getElementById('item-points-price').value) || null,
            usdt_price: parseFloat(document.getElementById('item-usdt-price').value) || null,
            stock: parseInt(document.getElementById('item-stock').value) || -1,
            is_active: document.getElementById('item-active').checked,
            is_locked: lockedValue
        };

        const vehicleSelect = document.getElementById('item-vehicle-id');
        const selectedVehicleId = vehicleSelect ? vehicleSelect.value.trim() : '';
        const originalItem = itemId ? adminItems.find(i => i.item_id === itemId) : null;
        let metadataPayload;

        if (payload.item_type === 'vehicle') {
            try {
                await ensureVehiclesLoaded({ silent: true, skipRender: true });
            } catch (loadErr) {
                console.error('Failed to refresh vehicle list before saving item:', loadErr);
            }

            if (!Array.isArray(allVehicles) || allVehicles.length === 0) {
                showNotification('Create a vehicle in the Vehicles tab before adding a vehicle marketplace item.', 'warning');
                return;
            }

            if (!selectedVehicleId) {
                showNotification('Select a vehicle to link with this marketplace item.', 'warning');
                return;
            }

            const vehicleExists = allVehicles.some(vehicle => vehicle.vehicle_id === selectedVehicleId);
            if (!vehicleExists) {
                showNotification('Selected vehicle is no longer available. Refresh the Vehicles tab and try again.', 'danger');
                return;
            }

            const baseMetadata = (originalItem && originalItem.metadata && typeof originalItem.metadata === 'object')
                ? { ...originalItem.metadata }
                : {};

            metadataPayload = { ...baseMetadata, vehicle_id: selectedVehicleId };
        } else if (originalItem && originalItem.metadata && typeof originalItem.metadata === 'object') {
            const baseMetadata = { ...originalItem.metadata };
            delete baseMetadata.vehicle_id;
            if (Object.keys(baseMetadata).length > 0) {
                metadataPayload = baseMetadata;
            }
        }

        if (metadataPayload !== undefined) {
            payload.metadata = metadataPayload;
        }

        console.log('ðŸ› DEBUG - Save item payload:', JSON.stringify(payload, null, 2));
        console.log('ðŸ› DEBUG - is_locked checkbox element:', lockedCheckbox);
        console.log('ðŸ› DEBUG - is_locked value:', lockedValue);

        try {
            const url = itemId 
                ? `/api/admin/rewards/items/${itemId}`
                : '/api/admin/rewards/items';
            
            const method = itemId ? 'PUT' : 'POST';
            
            console.log('ðŸ› DEBUG - Making request:', method, url);

            const response = await authenticatedRequest(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            console.log('ðŸ› DEBUG - Save response:', response);

            hideModal('item-modal');
            showNotification(itemId ? 'Item updated' : 'Item created', 'success');
            loadItems();
        } catch (err) {
            console.error('Failed to save item:', err);
            showNotification(err.message || 'Failed to save item', 'danger');
        }
    }

    async function deleteItem(itemId) {
        try {
            await authenticatedRequest(`/api/admin/rewards/items/${itemId}`, {
                method: 'DELETE'
            });

            showNotification('Item deleted', 'success');
            loadItems();
        } catch (err) {
            console.error('Failed to delete item:', err);
            showNotification(err.message || 'Failed to delete item', 'danger');
        }
    }

    async function loadVehicles(options = {}) {
        const { skipRender = false, silent = false } = options;

        if (!silent) {
            hideVehiclesAlert();
        }

        try {
            const data = await authenticatedRequest('/api/admin/rewards/vehicles');
            allVehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];

            populateVehicleDatalist();
            const vehicleGroupEl = document.getElementById('item-vehicle-group');
            if (vehicleGroupEl && !vehicleGroupEl.classList.contains('hidden')) {
                const currentSelection = document.getElementById('item-vehicle-id')?.value || '';
                populateVehicleSelect(currentSelection);
            }

            if (!skipRender) {
                const searchInput = document.getElementById('vehicle-search');
                if (searchInput && searchInput.value.trim()) {
                    filterVehicles();
                } else {
                    renderVehiclesTable(allVehicles);
                }
            } else {
                updateVehiclesSummary(allVehicles.length, allVehicles.length);
            }

            return allVehicles;
        } catch (err) {
            console.error('Failed to load vehicles:', err);
            if (!silent) {
                showVehiclesAlert(err.message || 'Failed to load vehicles');
            }
            throw err;
        }
    }

    async function ensureVehiclesLoaded(options = {}) {
        const { force = false, skipRender = true, silent = true } = options;

        if (!force && allVehicles.length > 0) {
            populateVehicleDatalist();
            return allVehicles;
        }

        return loadVehicles({ skipRender, silent });
    }

    function renderVehiclesTable(vehicles, options = {}) {
        const tbody = document.getElementById('vehicles-table-body');
        if (!tbody) {
            return;
        }

        const totalCount = options.totalCount ?? allVehicles.length;
        const searchTerm = options.searchTerm ?? '';

        if (!vehicles || vehicles.length === 0) {
            tbody.innerHTML = `
                <tr class="pf-v6-c-table__tr">
                    <td colspan="6" class="pf-v6-c-table__th pf-v6-u-text-align-center">No vehicles found</td>
                </tr>
            `;
            updateVehiclesSummary(0, totalCount, searchTerm);
            return;
        }

        tbody.innerHTML = vehicles.map(renderVehicleRow).join('');

        tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const vehicleId = btn.dataset.vehicleId;
                const vehicle = allVehicles.find(v => v.vehicle_id === vehicleId);
                if (vehicle) {
                    openVehicleModal(vehicle);
                }
            });
        });

        tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const vehicleId = btn.dataset.vehicleId;
                if (!vehicleId) {
                    return;
                }

                const confirmed = confirm(`Delete vehicle "${vehicleId}"? This will remove its assignments.`);
                if (confirmed) {
                    deleteVehicle(vehicleId);
                }
            });
        });

        updateVehiclesSummary(vehicles.length, totalCount, searchTerm);
    }

    function renderVehicleRow(vehicle) {
        const nameCell = vehicle.vehicle_name
            ? escapeHtml(vehicle.vehicle_name)
            : '<span class="pf-v6-u-color-200">None</span>';

        const typeCell = vehicle.vehicle_type
            ? escapeHtml(vehicle.vehicle_type)
            : '<span class="pf-v6-u-color-200">Unknown</span>';

        const metadataCell = formatVehicleMetadata(vehicle.metadata);
        const updatedCell = formatVehicleTimestamp(vehicle.updated_at || vehicle.created_at);

        const vehicleIdHtml = escapeHtml(vehicle.vehicle_id);

        return `
            <tr class="pf-v6-c-table__tr">
                <td class="pf-v6-c-table__th">${vehicleIdHtml}</td>
                <td class="pf-v6-c-table__th">${nameCell}</td>
                <td class="pf-v6-c-table__th">${typeCell}</td>
                <td class="pf-v6-c-table__th">${metadataCell}</td>
                <td class="pf-v6-c-table__th">${updatedCell}</td>
                <td class="pf-v6-c-table__th">
                    <div class="pf-v6-c-overflow-menu">
                        <div class="pf-v6-c-overflow-menu__content">
                            <div class="pf-v6-c-overflow-menu__group pf-m-button-group">
                            <div class="pf-v6-c-overflow-menu__item">
                                <button class="pf-v6-c-button pf-m-secondary pf-m-small" data-action="edit" data-vehicle-id="${vehicleIdHtml}">Edit</button>
                                </div>
                                <div class="pf-v6-c-overflow-menu__item">
                                <button class="pf-v6-c-button pf-m-danger pf-m-small" data-action="delete" data-vehicle-id="${vehicleIdHtml}">Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    function formatVehicleMetadata(metadata) {
        if (!metadata || (typeof metadata === 'object' && Object.keys(metadata).length === 0)) {
            return '<span class="pf-v6-u-color-200">None</span>';
        }

        try {
            const json = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
            const trimmed = json.length > 70 ? `${json.slice(0, 67)}...` : json;
            return `<code class="pf-v6-u-font-size-sm">${escapeHtml(trimmed)}</code>`;
        } catch (_) {
            return `<code class="pf-v6-u-font-size-sm">${escapeHtml(String(metadata))}</code>`;
        }
    }

    function formatVehicleTimestamp(value) {
        if (!value) {
            return '<span class="pf-v6-u-color-200">-</span>';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return `<span class="pf-v6-u-color-200">${escapeHtml(String(value))}</span>`;
        }

        return escapeHtml(date.toLocaleString());
    }

    function updateVehiclesSummary(displayCount, totalCount, searchTerm = '') {
        const summary = document.getElementById('vehicles-summary');
        if (!summary) {
            return;
        }

        if (totalCount === 0) {
            summary.textContent = 'No vehicles have been registered yet.';
            return;
        }

        if (searchTerm) {
            if (displayCount === 0) {
                summary.textContent = `No vehicles match "${searchTerm}".`;
            } else {
                summary.textContent = `Showing ${displayCount} of ${totalCount} vehicles matching "${searchTerm}".`;
            }
            return;
        }

        summary.textContent = `Total vehicles: ${totalCount}`;
    }

    function filterVehicles() {
        const searchInput = document.getElementById('vehicle-search');
        if (!searchInput) {
            return;
        }

        const term = searchInput.value.trim().toLowerCase();
        if (!term) {
            renderVehiclesTable(allVehicles);
            return;
        }

        const filtered = allVehicles.filter(vehicle => {
            const fields = [
                vehicle.vehicle_id,
                vehicle.vehicle_name,
                vehicle.vehicle_type,
                vehicle.metadata ? JSON.stringify(vehicle.metadata) : ''
            ];

            return fields.some(value =>
                typeof value === 'string' && value.toLowerCase().includes(term)
            );
        });

        renderVehiclesTable(filtered, {
            totalCount: allVehicles.length,
            searchTerm: term
        });
    }

    function populateVehicleDatalist() {
        const datalist = document.getElementById('vehicle-id-options');
        if (!datalist) {
            return;
        }

        const options = allVehicles
            .slice(0, 200)
            .map(vehicle => {
                const labelParts = [];
                if (vehicle.vehicle_name) {
                    labelParts.push(vehicle.vehicle_name);
                }
                if (vehicle.vehicle_type) {
                    labelParts.push(vehicle.vehicle_type);
                }
                const label = labelParts.join(' - ');
                const optionText = label ? escapeHtml(label) : '';
                return `<option value="${escapeHtml(vehicle.vehicle_id)}">${optionText}</option>`;
            })
            .join('');

        datalist.innerHTML = options;
    }

    function populateVehicleSelect(selectedValue = '') {
        const select = document.getElementById('item-vehicle-id');
        if (!select) {
            return;
        }

        const placeholder = '<option value="">Select a vehicle...</option>';

        if (!Array.isArray(allVehicles) || allVehicles.length === 0) {
            select.innerHTML = `${placeholder}<option value="">No vehicles available</option>`;
            select.value = '';
            select.disabled = true;
            return;
        }

        const options = allVehicles
            .map(vehicle => {
                const name = vehicle.vehicle_name ? `${vehicle.vehicle_name} (${vehicle.vehicle_id})` : vehicle.vehicle_id;
                const typeSuffix = vehicle.vehicle_type ? ` - ${vehicle.vehicle_type}` : '';
                const label = `${name}${typeSuffix}`;
                return `<option value="${escapeHtml(vehicle.vehicle_id)}">${escapeHtml(label)}</option>`;
            })
            .join('');

        select.innerHTML = `${placeholder}${options}`;
        select.disabled = false;

        if (selectedValue && allVehicles.some(vehicle => vehicle.vehicle_id === selectedValue)) {
            select.value = selectedValue;
        } else {
            select.value = '';
        }
    }

    async function handleItemTypeChange(options = {}) {
        const { preselectedVehicleId = '' } = options;
        const typeSelect = document.getElementById('item-type');
        const vehicleGroup = document.getElementById('item-vehicle-group');
        const vehicleSelect = document.getElementById('item-vehicle-id');

        if (!typeSelect || !vehicleGroup || !vehicleSelect) {
            return;
        }

        const showVehicleFields = typeSelect.value === 'vehicle';

        if (!showVehicleFields) {
            vehicleGroup.classList.add('hidden');
            vehicleSelect.value = '';
            return;
        }

        try {
            await ensureVehiclesLoaded({ silent: true, skipRender: true });
        } catch (err) {
            console.error('Failed to load vehicles for marketplace item modal:', err);
        }

        populateVehicleSelect(preselectedVehicleId);
        vehicleGroup.classList.remove('hidden');

        if (preselectedVehicleId) {
            vehicleSelect.value = preselectedVehicleId;
        }
    }

    function openVehicleModal(vehicle = null) {
        const form = document.getElementById('vehicle-form');
        const title = document.getElementById('vehicle-modal-title');
        const idInput = document.getElementById('vehicle-id');
        const nameInput = document.getElementById('vehicle-name');
        const typeInput = document.getElementById('vehicle-type');
        const metadataInput = document.getElementById('vehicle-metadata');

        if (!form || !title || !idInput || !nameInput || !typeInput || !metadataInput) {
            return;
        }

        clearVehicleFormError();

        if (vehicle) {
            title.textContent = 'Edit Vehicle';
            form.dataset.vehicleId = vehicle.vehicle_id;
            idInput.value = vehicle.vehicle_id;
            idInput.readOnly = true;
            idInput.setAttribute('aria-readonly', 'true');
            nameInput.value = vehicle.vehicle_name || '';
            typeInput.value = vehicle.vehicle_type || '';
            metadataInput.value = vehicle.metadata && Object.keys(vehicle.metadata || {}).length > 0
                ? JSON.stringify(vehicle.metadata, null, 2)
                : '';
        } else {
            title.textContent = 'Add Vehicle';
            delete form.dataset.vehicleId;
            form.reset();
            idInput.readOnly = false;
            idInput.removeAttribute('aria-readonly');
            metadataInput.value = '';
        }

        populateVehicleDatalist();
        showModal('vehicle-modal');
    }

    function clearVehicleFormError() {
        const errorEl = document.getElementById('vehicle-form-error');
        if (!errorEl) {
            return;
        }

        errorEl.classList.add('hidden');
        errorEl.textContent = '';
    }

    function showVehicleFormError(message) {
        const errorEl = document.getElementById('vehicle-form-error');
        if (!errorEl) {
            return;
        }

        errorEl.className = 'pf-v6-c-alert pf-m-inline pf-m-danger';
        errorEl.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;
        errorEl.classList.remove('hidden');
    }

    async function handleVehicleSave(event) {
        event.preventDefault();
        clearVehicleFormError();

        const form = event.target;
        const idInput = document.getElementById('vehicle-id');
        const nameInput = document.getElementById('vehicle-name');
        const typeInput = document.getElementById('vehicle-type');
        const metadataInput = document.getElementById('vehicle-metadata');

        if (!form || !idInput || !nameInput || !typeInput || !metadataInput) {
            return;
        }

        const isEdit = Boolean(form.dataset.vehicleId);

        const vehicleId = idInput.value.trim();
        if (!vehicleId) {
            showVehicleFormError('Vehicle ID is required.');
            return;
        }

        const payload = {
            vehicle_name: nameInput.value.trim() || null,
            vehicle_type: typeInput.value.trim() || null
        };

        const metadataRaw = metadataInput.value.trim();
        if (metadataRaw) {
            try {
                payload.metadata = JSON.parse(metadataRaw);
            } catch (_) {
                showVehicleFormError('Metadata must be valid JSON.');
                return;
            }
        } else if (isEdit) {
            payload.metadata = '';
        }

        if (!isEdit) {
            payload.vehicle_id = vehicleId;
        }

        try {
            const url = isEdit
                ? `/api/admin/rewards/vehicles/${encodeURIComponent(form.dataset.vehicleId)}`
                : '/api/admin/rewards/vehicles';
            const method = isEdit ? 'PUT' : 'POST';

            await authenticatedRequest(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            showNotification(isEdit ? 'Vehicle updated' : 'Vehicle created', 'success');
            hideModal('vehicle-modal');
            await loadVehicles();
        } catch (err) {
            console.error('Failed to save vehicle:', err);
            const message = err.message || 'Failed to save vehicle';
            if (message.toLowerCase().includes('already exists')) {
                showVehicleFormError('Vehicle ID already exists. Please choose a different ID.');
            } else {
                showVehicleFormError(message);
            }
        }
    }

    async function deleteVehicle(vehicleId) {
        try {
            await authenticatedRequest(`/api/admin/rewards/vehicles/${encodeURIComponent(vehicleId)}`, {
                method: 'DELETE'
            });

            showNotification('Vehicle deleted', 'success');
            await loadVehicles();
        } catch (err) {
            console.error('Failed to delete vehicle:', err);
            showNotification(err.message || 'Failed to delete vehicle', 'danger');
        }
    }

    function showVehiclesAlert(message, variant = 'danger') {
        const alertEl = document.getElementById('vehicles-alert');
        if (!alertEl) {
            return;
        }

        alertEl.className = `pf-v6-c-alert pf-m-inline pf-m-${variant}`;
        alertEl.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;
        alertEl.classList.remove('hidden');
    }

    function hideVehiclesAlert() {
        const alertEl = document.getElementById('vehicles-alert');
        if (!alertEl) {
            return;
        }

        alertEl.className = 'pf-v6-c-alert pf-m-inline hidden';
        alertEl.textContent = '';
    }

    async function loadAchievements() {
        try {
            const data = await authenticatedRequest('/api/admin/rewards/achievements');
            const tbody = document.getElementById('achievements-table-body');
            
            if (!tbody) return;

            if (!data?.achievements || data.achievements.length === 0) {
                tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td class="pf-v6-c-table__th" colspan="6">No achievements found</td></tr>';
                return;
            }
            
            // Render achievements here
            tbody.innerHTML = data.achievements.map(renderAchievementRow).join('');

            // Add event listeners
            tbody.querySelectorAll('.edit-achievement-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const achievementId = btn.dataset.id;
                    const achievement = data.achievements.find(a => a.achievement_id === achievementId);
                    if (achievement) openAchievementModal(achievement);
                });
            });

            tbody.querySelectorAll('.delete-achievement-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Delete this achievement?')) {
                        deleteAchievement(btn.dataset.id);
                    }
                });
            });

            tbody.querySelectorAll('.assign-achievement-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const achievementId = btn.dataset.id;
                    const achievement = data.achievements.find(a => a.achievement_id === achievementId);
                    if (achievement) openAssignAchievementModal(achievement);
                });
            });
        } catch (err) {
            console.error('Failed to load achievements:', err);
            const tbody = document.getElementById('achievements-table-body');
            if (tbody) {
                tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td colspan="6" class="pf-v6-c-table__th pf-v6-u-text-align-center pf-v6-u-color-danger">Failed to load achievements</td></tr>';
            }
        }
    }
    
    async function openAchievementModal(achievement = null) {
        const modal = document.getElementById('achievement-modal');
        const form = document.getElementById('achievement-form');
        const unlockItemSelect = document.getElementById('achievement-unlock-item');
        
        if (!modal || !form || !unlockItemSelect) {
            console.error('Achievement modal, form, or unlock item dropdown not found');
            return;
        }
        
        // Reset form
        form.reset();
        
        // Populate unlock item dropdown with marketplace items
        try {
            const itemsData = await authenticatedRequest('/api/admin/rewards/items');
            unlockItemSelect.innerHTML = '<option value="">No item to unlock</option>';
            
            if (itemsData?.items && itemsData.items.length > 0) {
                const marketplaceOptions = itemsData.items.map(item => 
                    `<option value="${item.item_id}">${escapeHtml(item.name)} (${item.item_type})</option>`
                ).join('');
                unlockItemSelect.innerHTML += marketplaceOptions;
            }
        } catch (err) {
            console.error('Failed to load marketplace items for unlock dropdown:', err);
        }
        
        // Set form action based on whether we're creating or editing
        if (achievement) {
            form.dataset.achievementId = achievement.achievement_id;
            document.getElementById('achievement-name').value = achievement.name || '';
            document.getElementById('achievement-description').value = achievement.description || '';
            document.getElementById('achievement-points').value = achievement.points_reward || 0;
            document.getElementById('achievement-requirement-type').value = achievement.requirement_type || '';
            document.getElementById('achievement-requirement-value').value = achievement.requirement_value || '';
            document.getElementById('achievement-unlock-item').value = achievement.unlock_item_id || '';
            document.getElementById('achievement-icon').value = achievement.icon || '';
            document.getElementById('achievement-tier').value = achievement.tier || 'bronze';
            document.getElementById('achievement-is-active').checked = achievement.is_active !== false;
        } else {
            delete form.dataset.achievementId;
            // Set default values for new achievement
            document.getElementById('achievement-points').value = '100';
            document.getElementById('achievement-tier').value = 'bronze';
            document.getElementById('achievement-is-active').checked = true;
        }
        
        showModal('achievement-modal');
    }

    async function openAssignAchievementModal(achievement) {
        const modal = document.getElementById('assign-achievement-modal');
        const form = document.getElementById('assign-achievement-form');
        const pilotSelect = document.getElementById('assign-achievement-pilot');
        
        if (!modal || !form || !pilotSelect) {
            console.error('Assign achievement modal, form, or pilot dropdown not found');
            return;
        }
        
        // Reset form
        form.reset();
        form.dataset.achievementId = achievement.achievement_id;
        
        // Populate achievement info
        document.getElementById('assign-achievement-name').textContent = achievement.name;
        document.getElementById('assign-achievement-description').textContent = achievement.description || '';
        
        // Populate pilot dropdown
        try {
            const pilotsData = await authenticatedRequest('/api/admin/rewards/pilots');
            pilotSelect.innerHTML = '<option value="">Choose a pilot...</option>';
            
            if (pilotsData?.pilots && pilotsData.pilots.length > 0) {
                const pilotOptions = pilotsData.pilots.map(pilot => 
                    `<option value="${pilot.pilot_id}">${escapeHtml(pilot.display_name || pilot.email)}</option>`
                ).join('');
                pilotSelect.innerHTML += pilotOptions;
            }
        } catch (err) {
            console.error('Failed to load pilots for assignment:', err);
            showNotification('Failed to load pilots', 'danger');
        }
        
        showModal('assign-achievement-modal');
    }

    async function handleAssignAchievement(event) {
        event.preventDefault();
        
        const form = event.target;
        const achievementId = form.dataset.achievementId;
        const pilotId = form.elements['pilot_id'].value;
        const reason = form.elements['reason'].value.trim() || 'Manual assignment by admin';
        
        if (!pilotId) {
            showNotification('Please select a pilot', 'warning');
            return;
        }
        
        try {
            const response = await authenticatedRequest(`/api/admin/rewards/achievements/${achievementId}/trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pilot_id: pilotId,
                    reason: reason
                })
            });
            
            if (response.success || response.message) {
                showNotification('Achievement assigned successfully!', 'success');
                hideModal('assign-achievement-modal');
                
                // Optionally reload achievements or update UI
                console.log('Achievement assigned:', response);
            } else {
                throw new Error(response.error || 'Failed to assign achievement');
            }
        } catch (err) {
            console.error('Error assigning achievement:', err);
            showNotification(err.message || 'Failed to assign achievement', 'danger');
        }
    }
    
    async function handleAchievementSave(event) {
        event.preventDefault();
        
        const form = event.target;
        const achievementId = form.dataset.achievementId;
        const isEdit = !!achievementId;
        
        const achievementData = {
            name: form.elements['achievement-name'].value.trim(),
            description: form.elements['achievement-description'].value.trim(),
            points_reward: parseInt(form.elements['achievement-points'].value) || 0,
            requirement_type: form.elements['achievement-requirement-type'].value,
            requirement_value: form.elements['achievement-requirement-value'].value,
            unlock_item_id: form.elements['achievement-unlock-item'].value || null,
            icon: form.elements['achievement-icon'].value || null,
            tier: form.elements['achievement-tier'].value,
            is_active: form.elements['achievement-is-active'].checked
        };
        
        // Basic validation
        if (!achievementData.name) {
            showNotification('Achievement name is required', 'danger');
            return;
        }
        
        if (achievementData.points_reward < 0) {
            showNotification('Points reward cannot be negative', 'danger');
            return;
        }
        
        try {
            const url = isEdit 
                ? `/api/admin/rewards/achievements/${achievementId}`
                : '/api/admin/rewards/achievements';
                
            const method = isEdit ? 'PUT' : 'POST';
            
            const response = await authenticatedRequest(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(achievementData)
            });
            
            // Check if response has achievement data (success case)
            if (response.achievement) {
                showNotification(
                    `Achievement ${isEdit ? 'updated' : 'created'} successfully`,
                    'success'
                );
                
                hideModal('achievement-modal');
                loadAchievements();
            } else {
                // If no achievement data but no error was thrown, it's still a success
                showNotification(
                    `Achievement ${isEdit ? 'updated' : 'created'} successfully`,
                    'success'
                );
                
                hideModal('achievement-modal');
                loadAchievements();
            }
        } catch (err) {
            console.error('Error saving achievement:', err);
            showNotification(
                err.message || 'Failed to save achievement',
                'danger'
            );
        }
    }
    
    async function deleteAchievement(achievementId) {
        if (!achievementId) {
            showNotification('Invalid achievement ID', 'danger');
            return;
        }
        
        try {
            const response = await authenticatedRequest(
                `/api/admin/rewards/achievements/${achievementId}`,
                { method: 'DELETE' }
            );
            
            if (response.success) {
                showNotification('Achievement deleted successfully', 'success');
                loadAchievements();
            } else {
                throw new Error(response.error || 'Failed to delete achievement');
            }
        } catch (err) {
            console.error('Error deleting achievement:', err);
            showNotification(
                err.message || 'Failed to delete achievement',
                'danger'
            );
        }
    }

    function renderAchievementRow(achievement) {
        return `
            <tr class="pf-v6-c-table__tr" data-achievement-id="${achievement.achievement_id}">
                <td class="pf-v6-c-table__th">${escapeHtml(achievement.name)}</td>
                <td class="pf-v6-c-table__th">${escapeHtml(achievement.description || '')}</td>
                <td class="pf-v6-c-table__th">${achievement.points_reward || 0}</td>
                <td class="pf-v6-c-table__th">${achievement.unlock_item_name || '-'}</td>
                <td class="pf-v6-c-table__th">${escapeHtml(achievement.requirement_type || '')}</td>
                <td>
                <div class="pf-v6-c-overflow-menu">
                <div class="pf-v6-c-overflow-menu__content">
                <div class="pf-v6-c-overflow-menu__item">
                    <button type="button" class="pf-v6-c-button pf-m-primary pf-m-small assign-achievement-btn" data-id="${achievement.achievement_id}" title="Assign to Pilot">Assign</button>
                </div>
                <div class="pf-v6-c-overflow-menu__item">
                    <button type="button" class="pf-v6-c-button pf-m-secondary pf-m-small edit-achievement-btn" data-id="${achievement.achievement_id}">Edit</button>
                </div>
                <div class="pf-v6-c-overflow-menu__item">
                    <button type="button" class="pf-v6-c-button pf-m-danger pf-m-small delete-achievement-btn" data-id="${achievement.achievement_id}">Delete</button>
                </div>
                </div>
                </div>
                </td>
            </tr>
        `;
    }

    async function loadRules() {
        const tbody = document.getElementById('rules-table-body');
        if (!tbody) return;
        
        // Show loading state
        tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td colspan="5" class="pf-v6-c-table__th pf-v6-u-text-align-center"><div class="pf-v6-c-spinner" role="progressbar" aria-valuetext="Loading rules..."><span class="pf-v6-c-spinner__clipper"></span><span class="pf-v6-c-spinner__lead-ball"></span><span class="pf-v6-c-spinner__tail-ball"></span></div></td></tr>';
        
        try {
            const data = await authenticatedRequest('/api/admin/rewards/rules');

            if (!data?.rules || data.rules.length === 0) {
                tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td colspan="5" class="pf-v6-c-table__th pf-v6-u-text-align-center pf-v6-u-color-200">No rules found. Click "Add Rule" to create one.</td></tr>';
                return;
            }

            // Sort rules by event_type for better organization
            const sortedRules = [...data.rules].sort((a, b) => 
                a.event_type.localeCompare(b.event_type)
            );
            
            tbody.innerHTML = sortedRules.map(renderRuleRow).join('');
            
            // Add event listeners directly to the buttons (following achievements pattern)
            tbody.querySelectorAll('.edit-rule-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ruleId = btn.dataset.id;
                    const rule = sortedRules.find(r => r.rule_id === ruleId);
                    if (rule) {
                        openRuleModal(rule);
                    }
                });
            });

            tbody.querySelectorAll('.delete-rule-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this rule?')) {
                        const ruleId = btn.dataset.id;
                        deletePointRule(ruleId);
                    }
                });
            });
        } catch (err) {
            console.error('Failed to load rules:', err);
        }
    }


    function renderRuleRow(rule) {
        const statusIcon = rule.is_active ? 'âœ“' : 'âœ—';
        const statusClass = rule.is_active ? 'rule-active' : 'rule-inactive';

        return `
            <tr class="pf-v6-c-table__tr" data-rule-id="${rule.rule_id}">
                <td class="pf-v6-c-table__th">${escapeHtml(rule.event_type)}</td>
                <td class="pf-v6-c-table__th">${escapeHtml(rule.description || '')}</td>
                <td class="pf-v6-c-table__th">${rule.points}</td>
                <td class="pf-v6-c-table__th">${statusIcon}</td>
                <td>
                    <button type="button" class="pf-v6-c-button pf-m-secondary pf-m-small edit-rule-btn" data-id="${rule.rule_id}">Edit</button>
                    <button type="button" class="pf-v6-c-button pf-m-danger pf-m-small delete-rule-btn" data-id="${rule.rule_id}">Delete</button>
                </td>
            </tr>
        `;
    }

    async function loadPilots() {
        try {
            await ensureVehiclesLoaded({ silent: true });
            const data = await authenticatedRequest('/api/admin/rewards/pilots');
            allPilots = data?.pilots || [];
            renderPilotsTable(allPilots);
        } catch (err) {
            console.error('Failed to load pilots:', err);
        }
    }

    function renderPilotsTable(pilots) {
        const tbody = document.getElementById('pilots-table-body');
        
        if (!tbody) return;

        if (!pilots || pilots.length === 0) {
            tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td colspan="6" class="pf-v6-c-table__th pf-v6-u-text-align-center">No pilots found</td></tr>';
            return;
        }

        tbody.innerHTML = pilots.map(renderPilotRow).join('');
        
        // Add event listeners
        tbody.querySelectorAll('[data-action="assign-vehicle"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pilotId = btn.dataset.pilotId;
                openAssignVehicleModal(pilotId);
            });
        });
    }

    function renderPilotRow(pilot) {
        const vehicleInfo = pilot.vehicle_id 
            ? `<span class="pf-v6-c-label pf-m-blue">${escapeHtml(pilot.vehicle_id)}</span>`
            : '<span class="pf-v6-u-color-200">Not assigned</span>';

        return `
            <tr class="pf-v6-c-table__tr">
                <td class="pf-v6-c-table__th">${escapeHtml(pilot.display_name || 'N/A')}</td>
                <td class="pf-v6-c-table__th">${escapeHtml(pilot.email || 'N/A')}</td>
                <td class="pf-v6-c-table__th">${pilot.current_points || 0}</td>
                <td class="pf-v6-c-table__th">${pilot.lifetime_earned || 0}</td>
                <td class="pf-v6-c-table__th">${pilot.total_spent || 0}</td>
                <td class="pf-v6-c-table__th">${vehicleInfo}</td>
                <td>
                    <button class="pf-v6-c-button pf-m-secondary pf-m-small" 
                            data-action="assign-vehicle" 
                            data-pilot-id="${pilot.pilot_id}">
                        ${pilot.vehicle_id ? 'Change' : 'Assign'} Vehicle
                    </button>
                </td>
            </tr>
        `;
    }

    async function openAssignVehicleModal(pilotId) {
        const pilot = allPilots.find(p => p.pilot_id === pilotId);
        if (!pilot) return;

        const modal = document.getElementById('assign-vehicle-modal');
        const form = document.getElementById('assign-vehicle-form');
        const pilotNameEl = document.getElementById('assign-vehicle-pilot-name');
        const vehicleIdInput = document.getElementById('assign-vehicle-id');
        const currentEl = document.getElementById('assign-vehicle-current');

        if (!modal || !form || !pilotNameEl || !vehicleIdInput || !currentEl) return;

        try {
            await ensureVehiclesLoaded({ silent: true });
        } catch (err) {
            console.warn('Unable to refresh vehicles before assignment modal:', err);
        }
        populateVehicleDatalist();

        // Set pilot info
        pilotNameEl.textContent = pilot.display_name || pilot.email || 'Unknown Pilot';
        vehicleIdInput.value = pilot.vehicle_id || '';
        currentEl.textContent = pilot.vehicle_id || 'None';
        
        // Store pilot ID in form
        form.dataset.pilotId = pilotId;

        showModal('assign-vehicle-modal');
    }

    async function handleAssignVehicle(event) {
        event.preventDefault();
        const form = event.target;
        const pilotId = form.dataset.pilotId;
        const vehicleId = document.getElementById('assign-vehicle-id').value.trim();

        if (!pilotId) {
            showNotification('Invalid pilot selection', 'warning');
            return;
        }

        try {
            await authenticatedRequest(`/api/admin/pilots/${pilotId}/vehicle`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicle_id: vehicleId || null })
            });

            hideModal('assign-vehicle-modal');
            showNotification('Vehicle assigned successfully', 'success');
            loadPilots();
            
            form.reset();
            delete form.dataset.pilotId;
        } catch (err) {
            console.error('Failed to assign vehicle:', err);
            showNotification(err.message || 'Failed to assign vehicle', 'danger');
        }
    }

    function filterPilots() {
        const search = document.getElementById('pilot-search')?.value.toLowerCase() || '';
        
        if (!search) {
            renderPilotsTable(allPilots);
            return;
        }

        const filtered = allPilots.filter(pilot => 
            (pilot.display_name || '').toLowerCase().includes(search) ||
            (pilot.email || '').toLowerCase().includes(search) ||
            (pilot.vehicle_id || '').toLowerCase().includes(search)
        );

        renderPilotsTable(filtered);
    }

    function openAwardPointsModal() {
        const modal = document.getElementById('award-points-modal');
        const select = document.getElementById('award-pilot-select');
        
        if (!modal || !select) return;

        // Populate pilot dropdown
        select.innerHTML = '<option value="">Choose a pilot...</option>' +
            allPilots.map(p => 
                `<option value="${p.pilot_id}">${escapeHtml(p.display_name || p.email)}</option>`
            ).join('');

        showModal('award-points-modal');
    }

    async function handleAwardPoints(event) {
        event.preventDefault();

        const pilotId = document.getElementById('award-pilot-select').value;
        const amount = parseInt(document.getElementById('award-points-amount').value);
        const reason = document.getElementById('award-reason').value.trim();

        if (!pilotId || !amount || !reason) {
            showNotification('All fields are required', 'warning');
            return;
        }

        try {
            await authenticatedRequest('/api/admin/rewards/award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pilot_id: pilotId, amount, reason })
            });

            hideModal('award-points-modal');
            showNotification('Points awarded successfully', 'success');
            loadPilots();
            
            document.getElementById('award-points-form').reset();
        } catch (err) {
            console.error('Failed to award points:', err);
            showNotification(err.message || 'Failed to award points', 'danger');
        }
    }

    // Utility functions
    async function loadPublicConfig() {
        const response = await fetch('/api/public-config');
        if (!response.ok) throw new Error('Failed to load configuration');
        return response.json();
    }

    async function authenticatedRequest(url, options = {}) {
        if (!currentSession?.access_token) {
            console.error('No access token in session:', currentSession);
            throw new Error('Authentication required');
        }
        
        console.log('Making authenticated request to:', url);
        console.log('User email:', currentSession.user?.email);
        
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${currentSession.access_token}`
        };
        
        const response = await fetch(url, { ...options, headers });
        
        if (!response.ok) {
            console.error('API request failed:', response.status, response.statusText);
            const data = await response.json().catch(() => ({}));
            console.error('Error response:', data);
            throw new Error(data.error || response.statusText || 'Request failed');
        }
        
        return response.json();
    }

    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('hidden');
    }

    function hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
    }

    function showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const alert = document.createElement('div');
        alert.className = `pf-v6-c-alert pf-m-${type}`;
        alert.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;

        container.appendChild(alert);

        setTimeout(() => alert.remove(), 5000);
    }

    function showAuthError(message) {
        const alert = document.getElementById('admin-auth-alert');
        if (!alert) return;
        alert.className = 'pf-v6-c-alert pf-m-inline pf-m-danger';
        alert.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;
        alert.classList.remove('hidden');
    }

    function showAuthInfo(message) {
        const alert = document.getElementById('admin-auth-alert');
        if (!alert) return;
        alert.className = 'pf-v6-c-alert pf-m-inline pf-m-info';
        alert.innerHTML = `<div class="pf-v6-c-alert__title">${escapeHtml(message)}</div>`;
        alert.classList.remove('hidden');
    }

    function hideAuthAlert() {
        const alert = document.getElementById('admin-auth-alert');
        if (alert) alert.classList.add('hidden');
    }

    // Point Rules Functions
    async function openRuleModal(rule = null) {
        const modal = document.getElementById('point-rule-modal');
        const titleElement = document.getElementById('point-rule-modal-title');
        
        if (!modal || !titleElement) {
            console.error('Modal or title element not found');
            return;
        }
        
        if (rule) {
            document.getElementById('point-rule-id').value = rule.rule_id || '';
            document.getElementById('point-rule-event-type').value = rule.event_type || '';
            document.getElementById('point-rule-description').value = rule.description || '';
            document.getElementById('point-rule-points').value = rule.points || 0;
            document.getElementById('point-rule-is-active').checked = rule.is_active !== false;
            titleElement.textContent = 'Edit Point Rule';
        } else {
            document.getElementById('point-rule-form').reset();
            document.getElementById('point-rule-is-active').checked = true;
            titleElement.textContent = 'Add Point Rule';
        }
        
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    async function deletePointRule(ruleId) {
        if (!ruleId) {
            showNotification('Invalid rule ID', 'danger');
            return;
        }

        if (!confirm('Are you sure you want to delete this point rule? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await authenticatedRequest(
                `/api/admin/rewards/rules/${ruleId}`,
                { method: 'DELETE' }
            );

            if (response.success) {
                showNotification('Point rule deleted successfully', 'success');
                loadRules();
            } else {
                throw new Error(response.error || 'Failed to delete point rule');
            }
        } catch (err) {
            console.error('Error deleting point rule:', err);
            showNotification(
                `Failed to delete point rule: ${err.message || 'Unknown error'}`,
                'danger'
            );
        }
    }

    async function handleRuleSave(event) {
        event.preventDefault();

        const form = event.target;
        const ruleId = form.elements['point-rule-id'].value;
        const isEdit = !!ruleId;

        const ruleData = {
            event_type: form.elements['point-rule-event-type'].value.trim(),
            description: form.elements['point-rule-description'].value.trim(),
            points: parseInt(form.elements['point-rule-points'].value) || 0,
            is_active: form.elements['point-rule-is-active'].checked
        };

        // Basic validation
        if (!ruleData.event_type) {
            showNotification('Event type is required', 'danger');
            return;
        }

        if (ruleData.points <= 0) {
            showNotification('Points must be a positive number', 'danger');
            return;
        }

        try {
            const url = isEdit
                ? `/api/admin/rewards/rules/${ruleId}`
                : '/api/admin/rewards/rules';

            const method = isEdit ? 'PUT' : 'POST';

            const response = await authenticatedRequest(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(ruleData)
            });

            // Check if response has rule data (success case)
            if (response.rule) {
                showNotification(
                    `Point rule ${isEdit ? 'updated' : 'created'} successfully`,
                    'success'
                );

                hideModal('point-rule-modal');
                loadRules();
            } else if (response.error) {
                throw new Error(response.error);
            } else {
                // If no rule data but no error was thrown, it's still a success
                showNotification(
                    `Point rule ${isEdit ? 'updated' : 'created'} successfully`,
                    'success'
                );

                hideModal('point-rule-modal');
                loadRules();
            }
        } catch (err) {
            console.error('Error saving point rule:', err);
            showNotification(
                `Failed to ${isEdit ? 'update' : 'create'} point rule: ${err.message || 'Unknown error'}`,
                'danger'
            );
        }
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Admin user menu dropdown handling
    function initializeAdminUserMenu() {
        const adminUserMenuToggle = document.getElementById('admin-user-menu-toggle');
        const adminUserMenuDropdown = document.getElementById('admin-user-menu');
        const adminDropdownLogoutBtn = document.getElementById('admin-dropdown-logout-btn');

        if (adminUserMenuToggle && adminUserMenuDropdown) {
            adminUserMenuToggle.addEventListener('click', function(event) {
                event.preventDefault();
                const menu = adminUserMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                const isExpanded = adminUserMenuToggle.getAttribute('aria-expanded') === 'true';
                
                adminUserMenuToggle.setAttribute('aria-expanded', !isExpanded);
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
                if (!adminUserMenuDropdown.contains(event.target)) {
                    const menu = adminUserMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                    adminUserMenuToggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                }
            });

            // Handle keyboard navigation
            adminUserMenuDropdown.addEventListener('keydown', function(event) {
                const menu = adminUserMenuDropdown.querySelector('.pf-v6-c-dropdown__menu');
                const isOpen = adminUserMenuToggle.getAttribute('aria-expanded') === 'true';
                
                if (event.key === 'Escape' && isOpen) {
                    adminUserMenuToggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                    adminUserMenuToggle.focus();
                }
            });
        }

        // Handle dropdown logout button
        if (adminDropdownLogoutBtn) {
            adminDropdownLogoutBtn.addEventListener('click', function(event) {
                event.preventDefault();
                handleAdminLogout();
            });
        }

        // Also handle legacy logout button for fallback
        const legacyLogoutBtn = document.getElementById('admin-logout-btn');
        if (legacyLogoutBtn) {
            legacyLogoutBtn.addEventListener('click', function(event) {
                event.preventDefault();
                handleAdminLogout();
            });
        }
    }

    function handleAdminLogout() {
        if (window.sessionManager) {
            window.sessionManager.signOut();
        } else {
            // Fallback
            window.location.href = '/';
        }
    }

    function updateAdminUserMenu(adminData) {
        const adminUserMenu = document.getElementById('admin-user-menu');
        const adminUserName = document.getElementById('admin-user-name');
        const adminAuthFallback = document.getElementById('admin-auth-fallback');

        if (adminData && adminUserMenu && adminUserName) {
            // Update admin user menu with admin data
            adminUserName.textContent = adminData.email || 'Admin';
            
            // Show admin user menu, hide fallback
            adminUserMenu.classList.remove('hidden');
            if (adminAuthFallback) adminAuthFallback.classList.add('hidden');
        } else {
            // Hide admin user menu, show fallback
            if (adminUserMenu) adminUserMenu.classList.add('hidden');
            if (adminAuthFallback) adminAuthFallback.classList.remove('hidden');
        }
    }

    async function handleDeleteItem(item) {
        if (!item?.item_id) return;

        const confirmed = confirm(`Are you sure you want to delete "${item.name}"?`);
        if (!confirmed) return;

        try {
            await authenticatedRequest(`/api/admin/rewards/items/${item.item_id}`, {
                method: 'DELETE'
            });

            showNotification('Item deleted successfully!', 'success');
            await loadMarketplaceItems();
        } catch (error) {
            console.error('Error deleting item:', error);
            showNotification('Failed to delete item. Please try again.', 'error');
        }
    }

    async function loadMarketplaceItems() {
        try {
            const data = await authenticatedRequest('/api/admin/rewards/items');
            const items = data?.items || [];
            renderMarketplaceItemsTable(items);
            
            console.log('Loaded marketplace items:', items.length);
        } catch (error) {
            console.error('Failed to load marketplace items:', error);
            showNotification('Failed to load marketplace items', 'error');
        }
    }

    function renderMarketplaceItemsTable(items) {
        const tbody = document.getElementById('items-table-body');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = '<tr class="pf-v6-c-table__tr"><td colspan="7" class="pf-v6-c-table__th pf-v6-u-text-align-center">No items found</td></tr>';
            return;
        }

        tbody.innerHTML = items.map(item => `
            <tr class="pf-v6-c-table__tr" data-item-id="${item.item_id}">
                <td class="pf-v6-c-table__th">${escapeHtml(item.name || '')}</td>
                <td class="pf-v6-c-table__th">${escapeHtml(item.item_type || '')}</td>
                <td class="pf-v6-c-table__th">${item.points_price || 0}</td>
                <td class="pf-v6-c-table__th">$${item.usdt_price || 0}</td>
                <td class="pf-v6-c-table__th">${item.stock === -1 ? 'Unlimited' : (item.stock || 0)}</td>
                <td class="pf-v6-c-table__td pf-v6-c-table__action">
                <div class="pf-v6-c-overflow-menu">
                    <div class="pf-v6-c-overflow-menu__content">
                        <div class="pf-v6-c-overflow-menu__group pf-m-button-group">
                        <div class="pf-v6-c-overflow-menu__item">
                                        <span class="pf-v6-c-label ${item.is_active ? 'pf-m-green' : 'pf-m-red'}">
                                            <span class="pf-v6-c-label__content">
                                                <span class="pf-v6-c-label__text">${item.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </span>
                                        </span>
                        </div>
                        ${item.is_locked ? `
                            <div class="pf-v6-c-overflow-menu__item">
                                <span class="pf-v6-c-label pf-m-orange pf-v6-u-ml-sm">
                                    <span class="pf-v6-c-label__content">
                                        <span class="pf-v6-c-label__text">Locked</span>
                                    </span>
                                </span>
                            </div>
                        ` : ''}
                        </div>
                    </div>
                </div>
                </td>
                <td class="pf-v6-c-table__th">
                <div class="pf-v6-c-overflow-menu">
                <div class="pf-v6-c-overflow-menu__content">
                <div class="pf-v6-c-overflow-menu__group pf-m-button-group">
                 <div class="pf-v6-c-overflow-menu__content">
                 <div class="pf-v6-c-overflow-menu__group pf-m-button-group">
                    <div class="pf-v6-c-overflow-menu__item">
                    <button type="button" class="pf-v6-c-button pf-m-secondary pf-m-small edit-item-btn" data-item-id="${item.item_id}">
                        <i class="fas fa-edit" aria-hidden="true"></i> Edit
                    </button>
                    </div>
                    <div class="pf-v6-c-overflow-menu__item">
                    <button type="button" class="pf-v6-c-button pf-m-danger pf-m-small pf-v6-u-ml-sm delete-item-btn" data-item-id="${item.item_id}">
                        <i class="fas fa-trash" aria-hidden="true"></i> Delete
                    </button>
                </div>
                </div>
                </td>
            </tr>
        `).join('');

        // Add event listeners for action buttons
        tbody.querySelectorAll('.edit-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const itemId = e.target.closest('button').dataset.itemId;
                const item = items.find(i => i.item_id === itemId);
                if (item) {
                    openItemModal(item);
                }
            });
        });

        tbody.querySelectorAll('.delete-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const itemId = e.target.closest('button').dataset.itemId;
                const item = items.find(i => i.item_id === itemId);
                if (item) {
                    handleDeleteItem(item);
                }
            });
        });
    }

    // Initialize admin dropdown on DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        initializeAdminUserMenu();
    });

    })();
} catch (error) {
    console.error('Error in rewards-admin.js:', error);
    console.error('Error stack:', error.stack);
}

