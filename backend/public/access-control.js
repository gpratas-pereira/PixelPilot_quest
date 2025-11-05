(() => {
    const NAV_ITEM_SELECTOR = '[data-required-group]';
    const HIDDEN_CLASS = 'rbac-hidden';

    function normalizeGroups(groups) {
        if (!Array.isArray(groups)) {
            return [];
        }
        return groups
            .map(value => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
            .filter(Boolean);
    }

    function applyAccessControl(groups = []) {
        const normalized = new Set(normalizeGroups(groups));
        const navItems = document.querySelectorAll(NAV_ITEM_SELECTOR);

        navItems.forEach(item => {
            const required = (item.getAttribute('data-required-group') || '')
                .split(',')
                .map(value => value.trim().toLowerCase())
                .filter(Boolean);

            if (required.length === 0) {
                item.classList.remove(HIDDEN_CLASS);
                return;
            }

            const allowed = required.some(group => normalized.has(group));
            item.classList.toggle(HIDDEN_CLASS, !allowed);
        });
    }

    window.applyAccessControl = applyAccessControl;
})();

