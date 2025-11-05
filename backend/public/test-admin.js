(() => {
    let supabaseClient = null;
    let currentSession = null;
    let serverSession = null;
    let userGroups = [];
    let rbacUnsubscribe = null;
    const REQUIRED_GROUP = 'admin';

    const els = {
        loginForm: document.getElementById('admin-login-form'),
        loginEmail: document.getElementById('admin-login-email'),
        loginPassword: document.getElementById('admin-login-password'),
        logoutBtn: document.getElementById('admin-logout-btn'),
        authAlert: document.getElementById('admin-auth-alert'),
        authEmail: document.getElementById('admin-auth-email'),
        toolsSection: document.getElementById('admin-tools-section'),
        authSection: document.getElementById('admin-auth-section')
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        console.log('Test admin initializing...');
        attachListeners();
        loadConfiguration();
    }

    function attachListeners() {
        if (els.loginForm) {
            els.loginForm.addEventListener('submit', handleSignIn);
        }

        if (els.logoutBtn) {
            els.logoutBtn.addEventListener('click', handleLogout);
        }

        // Advanced testing buttons
        const testAuthBtn = document.getElementById('test-authenticated-request');
        if (testAuthBtn) {
            testAuthBtn.addEventListener('click', testAuthenticatedRequest);
        }

        const testSessionBtn = document.getElementById('test-session-details');
        if (testSessionBtn) {
            testSessionBtn.addEventListener('click', showSessionDetails);
        }

        const testDataBtn = document.getElementById('test-data-loading');
        if (testDataBtn) {
            testDataBtn.addEventListener('click', testDataLoading);
        }
    }

    async function loadConfiguration() {
        try {
            console.log('Loading public config...');
            const config = await loadPublicConfig();
            console.log('Config loaded:', config);
            
            if (!config?.supabase?.url || !config?.supabase?.anonKey) {
                setAlert(els.authAlert, 'Supabase credentials are missing. Configure environment variables before using admin tools.', 'error');
                return;
            }

            console.log('Creating Supabase client...');
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
                    if (snapshotSession?.user?.email && els.authEmail) {
                        els.authEmail.textContent = snapshotSession.user.email;
                    }
                });
            }
            
            console.log('Getting initial session...');
            const { data } = await supabaseClient.auth.getSession();
            console.log('Initial session:', data);
            await handleSessionChange(data?.session ?? null);

            console.log('Setting up auth state change listener...');
            supabaseClient.auth.onAuthStateChange(async (_event, session) => {
                console.log('Auth state changed:', session ? 'session exists' : 'no session');
                await handleSessionChange(session ?? null);
            });
            
            console.log('Test admin initialization complete');
        } catch (err) {
            console.error('Failed to load admin configuration:', err);
            setAlert(els.authAlert, 'Unable to initialise admin console. Refresh the page or check the server logs.', 'error');
        }
    }

    async function handleSessionChange(session) {
        console.log('handleSessionChange called with session:', session);
        currentSession = session;
        const isAuthenticated = !!session;

        console.log('Is authenticated:', isAuthenticated);

        if (window.FPVRBAC) {
            await window.FPVRBAC.setSupabaseSession(session);
            userGroups = window.FPVRBAC.getGroups();
            serverSession = window.FPVRBAC.getServerSession();
        } else {
            userGroups = [];
            serverSession = null;
        }

        applyGroupVisibility();
        const hasAccess = hasGroup(REQUIRED_GROUP) || hasGroup('rewards_admin');

        if (isAuthenticated) {
            const email =
                serverSession?.user?.email ||
                session.user?.email ||
                'Unknown email';
            console.log('User email:', email);
            els.authEmail.textContent = email;
            
            // Hide login form, show tools
            toggleSection(els.authSection, false);
            toggleSection(els.toolsSection, hasAccess);

            if (!hasAccess) {
                setAlert(els.authAlert, 'Your account does not have admin access for this test panel.', 'warning');
                return;
            }

            hideAlert(els.authAlert);
            console.log('Login successful, showing tools section');
        } else {
            console.log('Not authenticated, showing login form');
            toggleSection(els.authSection, true);
            toggleSection(els.toolsSection, false);
            if (window.FPVRBAC) {
                window.FPVRBAC.clearSession();
            }
        }
    }

    async function handleSignIn(event) {
        event.preventDefault();
        console.log('Sign in attempt...');
        
        const email = els.loginEmail.value.trim();
        const password = els.loginPassword.value;

        console.log('Login attempt for email:', email);

        if (!email || !password) {
            setAlert(els.authAlert, 'Email and password required.', 'error');
            return;
        }

        setAlert(els.authAlert, 'Signing in...', 'info');

        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            console.log('Supabase sign in result:', { data, error });
            
            if (error) {
                console.error('Supabase auth error:', error);
                setAlert(els.authAlert, error.message, 'error');
            } else if (data?.session) {
                console.log('Login successful for user:', data.session.user?.email);
                hideAlert(els.authAlert);
                // Session will be handled by the onAuthStateChange listener
            } else {
                setAlert(els.authAlert, 'Login failed - no session returned', 'error');
            }
        } catch (err) {
            console.error('Login error:', err);
            setAlert(els.authAlert, 'Failed to sign in. Please check your connection and try again.', 'error');
        }
    }

    async function handleLogout() {
        console.log('Logout requested...');
        if (!supabaseClient) return;
        await supabaseClient.auth.signOut();
        console.log('Logout complete');
    }

    async function loadPublicConfig() {
        const response = await fetch('/api/public-config');
        if (!response.ok) throw new Error('Failed to load configuration');
        return response.json();
    }

    function toggleSection(element, show) {
        if (!element) return;
        if (show) {
            element.classList.remove('hidden');
            element.style.display = '';
        } else {
            element.classList.add('hidden');
            element.style.display = 'none';
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

    function setAlert(element, message, type = 'info') {
        if (!element) return;
        element.className = `pf-v5-c-alert pf-c-alert pf-m-inline pf-m-${type}`;
        element.innerHTML = `<div class="pf-v5-c-alert__title">${escapeHtml(message)}</div>`;
        element.classList.remove('hidden');
    }

    function hideAlert(element) {
        if (element) {
            element.classList.add('hidden');
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

    // Advanced testing functions
    async function testAuthenticatedRequest() {
        const resultEl = document.getElementById('api-test-result');
        if (!resultEl) return;

        resultEl.innerHTML = 'Testing authenticated request...';
        resultEl.className = 'pf-v5-c-content pf-m-sm pf-v5-u-color-blue-200';

        try {
            console.log('Testing authenticated API request...');
            console.log('Current session:', currentSession);

            if (!currentSession?.access_token) {
                throw new Error('No access token found');
            }

            const response = await fetch('/api/admin/rewards/items', {
                headers: {
                    'Authorization': `Bearer ${currentSession.access_token}`
                }
            });

            console.log('Response status:', response.status);
            // Security: Avoid logging response headers

            if (!response.ok) {
                const errorText = await response.text();
                console.log('Error response:', errorText);
                throw new Error(`API request failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('API response data:', data);

            resultEl.innerHTML = `✅ API request successful! Got ${data.items?.length || 0} items`;
            resultEl.className = 'pf-v5-c-content pf-m-sm pf-v5-u-color-success';
        } catch (err) {
            console.error('API test failed:', err);
            resultEl.innerHTML = `❌ API request failed: ${err.message}`;
            resultEl.className = 'pf-v5-c-content pf-m-sm pf-v5-u-color-danger';
        }
    }

    function showSessionDetails() {
        const resultEl = document.getElementById('session-details');
        if (!resultEl || !currentSession) return;

        const details = {
            'User Email': currentSession.user?.email,
            'Access Token Present': !!currentSession.access_token,
            // Security: Don't expose token information
            'Expires At': currentSession.expires_at ? new Date(currentSession.expires_at * 1000).toLocaleString() : 'Unknown',
            'User Role': currentSession.user?.app_metadata?.role || 'Not specified',
            'User ID': currentSession.user?.id
        };

        console.log('Full session object:', currentSession);

        let html = '<div class="pf-v5-c-description-list pf-m-horizontal">';
        for (const [key, value] of Object.entries(details)) {
            html += `
                <div class="pf-v5-c-description-list__group">
                    <dt class="pf-v5-c-description-list__term">${escapeHtml(key)}</dt>
                    <dd class="pf-v5-c-description-list__description">
                        <div class="pf-v5-c-description-list__text">${escapeHtml(String(value))}</div>
                    </dd>
                </div>
            `;
        }
        html += '</div>';

        resultEl.innerHTML = html;
        resultEl.className = 'pf-v5-c-content pf-m-sm';
    }

    async function testDataLoading() {
        const resultEl = document.getElementById('data-loading-results');
        if (!resultEl) return;

        resultEl.innerHTML = '<div class="pf-v5-c-spinner" role="progressbar"><span class="pf-v5-c-spinner__clipper"></span><span class="pf-v5-c-spinner__lead-ball"></span><span class="pf-v5-c-spinner__tail-ball"></span></div>';

        console.log('Testing data loading like rewards-admin...');

        const tests = [
            { name: 'Items', url: '/api/admin/rewards/items' },
            { name: 'Achievements', url: '/api/admin/rewards/achievements' },
            { name: 'Rules', url: '/api/admin/rewards/rules' },
            { name: 'Pilots', url: '/api/admin/rewards/pilots' }
        ];

        let html = '<div class="pf-v5-l-grid pf-m-gutter">';

        for (const test of tests) {
            try {
                console.log(`Testing ${test.name} API...`);
                
                const response = await fetch(test.url, {
                    headers: {
                        'Authorization': `Bearer ${currentSession.access_token}`
                    }
                });

                const status = response.ok ? 'success' : 'danger';
                const icon = response.ok ? '✅' : '❌';
                const message = response.ok 
                    ? `Status: ${response.status}` 
                    : `Failed: ${response.status} ${response.statusText}`;

                let details = '';
                if (response.ok) {
                    try {
                        const data = await response.json();
                        const keys = Object.keys(data);
                        details = `<br><small>Response keys: ${keys.join(', ')}</small>`;
                        if (data.items) details += `<br><small>Items count: ${data.items.length}</small>`;
                        if (data.achievements) details += `<br><small>Achievements count: ${data.achievements.length}</small>`;
                        if (data.rules) details += `<br><small>Rules count: ${data.rules.length}</small>`;
                        if (data.pilots) details += `<br><small>Pilots count: ${data.pilots.length}</small>`;
                    } catch (e) {
                        details = '<br><small>Could not parse response JSON</small>';
                    }
                } else {
                    try {
                        const errorText = await response.text();
                        details = `<br><small>Error: ${errorText.substring(0, 100)}...</small>`;
                    } catch (e) {
                        details = '<br><small>Could not read error response</small>';
                    }
                }

                html += `
                    <div class="pf-v5-l-grid__item pf-m-6-col">
                        <div class="pf-v5-c-card pf-m-plain">
                            <div class="pf-v5-c-card__body">
                                <h4 class="pf-v5-c-title pf-m-md">${icon} ${test.name}</h4>
                                <p class="pf-v5-c-content pf-m-sm pf-v5-u-color-${status}">${message}${details}</p>
                            </div>
                        </div>
                    </div>
                `;
            } catch (err) {
                console.error(`${test.name} test failed:`, err);
                html += `
                    <div class="pf-v5-l-grid__item pf-m-6-col">
                        <div class="pf-v5-c-card pf-m-plain">
                            <div class="pf-v5-c-card__body">
                                <h4 class="pf-v5-c-title pf-m-md">❌ ${test.name}</h4>
                                <p class="pf-v5-c-content pf-m-sm pf-v5-u-color-danger">Error: ${err.message}</p>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';
        resultEl.innerHTML = html;
    }
})();
