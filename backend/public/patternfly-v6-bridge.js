(function () {
    const PREFIX_MAP = [
        { legacy: 'pf-c-', modern: 'pf-v6-c-' },
        { legacy: 'pf-l-', modern: 'pf-v6-l-' },
        { legacy: 'pf-u-', modern: 'pf-v6-u-' },
        { legacy: 'pf-t-', modern: 'pf-v6-t-' },
        { legacy: 'pf-m-', modern: 'pf-v6-m-' }
    ];

    function upgradeElement(element) {
        if (!element || !element.classList) {
            return;
        }

        element.classList.forEach(cls => {
            for (const { legacy, modern } of PREFIX_MAP) {
                if (cls.startsWith(legacy) && !cls.startsWith('pf-v6-')) {
                    const v5Class = cls.replace(legacy, modern);
                    if (!element.classList.contains(v5Class)) {
                        element.classList.add(v5Class);
                    }
                }
            }
        });
    }

    function upgradeTree(root) {
        if (!root) {
            return;
        }

        if (root.classList) {
            upgradeElement(root);
        }

        if (root.querySelectorAll) {
            root.querySelectorAll('[class]').forEach(upgradeElement);
        }
    }

    window.applyPatternFlyV6Bridge = function (scope) {
        upgradeTree(scope || document.body);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => upgradeTree(document.body));
    } else {
        upgradeTree(document.body);
    }
})();
