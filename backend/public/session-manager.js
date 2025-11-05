(() => {
    const STATE = {
        supabaseClient: null,
        supabaseSession: null,
        serverSession: null,
        groups: [],
        listeners: new Set(),
        domReady: document.readyState !== 'loading',
        visibilityDirty: false
    };

    function normalizeGroup(group) {
        if (!group) {
            return null;
        }
        const normalized = String(group).trim().toLowerCase();
        return normalized || null;
    }

    function notifyListeners() {
        const snapshot = {
            supabaseClient: STATE.supabaseClient,
            supabaseSession: STATE.supabaseSession,
            serverSession: STATE.serverSession,
            groups: [...STATE.groups]
        };
        for (const listener of STATE.listeners) {
            try {
                listener(snapshot);
            } catch (err) {
                console.error('Auth listener failed:', err);
            }
        }
    }

    function collectGroupRequirements(element) {
        const raw = element.getAttribute('data-required-group');
        if (!raw) {
            return [];
        }
        return raw
            .split(',')
            .map(normalizeGroup)
            .filter(Boolean);
    }

    function elementShouldBeVisible(requiredGroups) {
        if (requiredGroups.length === 0) {
            return true;
        }
        return requiredGroups.some(required => STATE.groups.includes(required));
    }

    function applyGroupVisibility() {
        if (!STATE.domReady) {
            STATE.visibilityDirty = true;
            return;
        }
        const elements = document.querySelectorAll('[data-required-group]');
        elements.forEach((element) => {
            const requiredGroups = collectGroupRequirements(element);
            const shouldShow = elementShouldBeVisible(requiredGroups);
            element.classList.toggle('hidden', !shouldShow);
            element.toggleAttribute('aria-hidden', !shouldShow);
            element.dataset.groupActive = shouldShow ? 'true' : 'false';
        });
        STATE.visibilityDirty = false;
    }

    if (!STATE.domReady) {
        document.addEventListener('DOMContentLoaded', () => {
            STATE.domReady = true;
            if (STATE.visibilityDirty) {
                applyGroupVisibility();
            }
        });
    }

    async function fetchServerSession(accessToken) {
        if (!accessToken) {
            STATE.serverSession = null;
            STATE.groups = [];
            applyGroupVisibility();
            notifyListeners();
            return null;
        }

        try {
            const response = await fetch('/api/session', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const message = response.status === 401
                    ? 'Supabase session is no longer valid.'
                    : `Failed to load session info (${response.status})`;
                console.warn(message);
                STATE.serverSession = null;
                STATE.groups = [];
                applyGroupVisibility();
                notifyListeners();
                return null;
            }

            const payload = await response.json();
            STATE.serverSession = payload || null;
            const groups = Array.isArray(payload?.groups) ? payload.groups : [];
            STATE.groups = Array.from(new Set(groups.map(normalizeGroup).filter(Boolean)));
            applyGroupVisibility();
            notifyListeners();
            return STATE.serverSession;
        } catch (err) {
            console.error('Failed to fetch server session:', err);
            STATE.serverSession = null;
            STATE.groups = [];
            applyGroupVisibility();
            notifyListeners();
            return null;
        }
    }

    function setSupabaseSession(session) {
        STATE.supabaseSession = session || null;
        const accessToken = session?.access_token;
        if (!accessToken) {
            STATE.serverSession = null;
            STATE.groups = [];
            applyGroupVisibility();
            notifyListeners();
            return Promise.resolve(null);
        }
        return fetchServerSession(accessToken);
    }

    function clearSession() {
        STATE.supabaseSession = null;
        STATE.serverSession = null;
        STATE.groups = [];
        applyGroupVisibility();
        notifyListeners();
    }

    function hasGroup(group) {
        const normalized = normalizeGroup(group);
        if (!normalized) {
            return false;
        }
        return STATE.groups.includes(normalized);
    }

    function onChange(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        STATE.listeners.add(listener);
        // Emit current snapshot immediately for convenience
        try {
            listener({
                supabaseClient: STATE.supabaseClient,
                supabaseSession: STATE.supabaseSession,
                serverSession: STATE.serverSession,
                groups: [...STATE.groups]
            });
        } catch (err) {
            console.error('Auth listener failed:', err);
        }
        return () => STATE.listeners.delete(listener);
    }

    function setSupabaseClient(client) {
        STATE.supabaseClient = client || null;
        notifyListeners();
    }

    function getGroups() {
        return [...STATE.groups];
    }

    function getServerSession() {
        return STATE.serverSession;
    }

    function getSupabaseSession() {
        return STATE.supabaseSession;
    }

    function refreshVisibility() {
        applyGroupVisibility();
    }

    window.FPVRBAC = Object.freeze({
        setSupabaseClient,
        setSupabaseSession,
        clearSession,
        getGroups,
        hasGroup,
        getServerSession,
        getSupabaseSession,
        onChange,
        refreshVisibility
    });

    applyGroupVisibility();
})();
