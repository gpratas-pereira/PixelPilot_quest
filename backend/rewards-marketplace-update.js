// This is a patch to update the loadMarketplaceItems function in rewards.js
// You can manually copy this function and replace the existing one in rewards.js

async function loadMarketplaceItems() {
    console.log('🔧 === MARKETPLACE LOADING START (Supabase) ===');

    try {
        const filter = document.getElementById('marketplace-filter')?.value || 'all';
        const search = document.getElementById('marketplace-search')?.value || '';
        const container = document.getElementById('marketplace-items');

        console.log('🔧 Filter:', filter);
        console.log('🔧 Search:', search);
        console.log('🔧 Container found:', !!container);

        if (!container) {
            console.error('🔧 Marketplace container not found!');
            return;
        }

        // Fetch all marketplace items from Supabase via our new API
        console.log('🔧 Fetching marketplace items from Supabase API...');
        
        try {
            const response = await fetch('/api/rewards/marketplace');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('🔧 API marketplace response:', data);
            
            let allItems = data.items || [];
            console.log('🔧 Raw items from Supabase:', allItems.length);
            
            // Apply search filter
            if (search) {
                const searchLower = search.toLowerCase();
                allItems = allItems.filter(item =>
                    item.name.toLowerCase().includes(searchLower) ||
                    (item.description && item.description.toLowerCase().includes(searchLower)) ||
                    item.item_type.toLowerCase().includes(searchLower)
                );
                console.log('🔧 After search filter:', allItems.length);
            }

            // Apply type filter
            if (filter !== 'all') {
                allItems = allItems.filter(item => {
                    if (filter === 'tickets') {
                        // Show both 'ticket' and items with minutes in metadata for backward compatibility
                        return item.item_type === 'ticket' || (item.metadata && item.metadata.minutes);
                    }
                    return item.item_type === filter;
                });
                console.log('🔧 After type filter:', allItems.length);
            }

            if (allItems.length === 0) {
                container.innerHTML = `
                    <div class="pf-v5-l-gallery__item">
                        <div class="pf-v5-c-empty-state pf-m-sm">
                            <div class="pf-v5-c-empty-state__content">
                                <h3 class="pf-v5-c-title pf-m-md">No items found</h3>
                                <p class="pf-v5-c-content pf-m-sm">Try adjusting your filters or search terms, or add items in the admin panel.</p>
                            </div>
                        </div>
                    </div>
                `;
                console.log('🔧 === MARKETPLACE LOADING END (empty) ===');
                return;
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
        } catch (apiErr) {
            console.error('🔧 Failed to fetch marketplace items:', apiErr);
            container.innerHTML = `
                <div class="pf-v5-l-gallery__item">
                    <div class="pf-v5-c-empty-state pf-m-sm">
                        <div class="pf-v5-c-empty-state__content">
                            <h3 class="pf-v5-c-title pf-m-md">Marketplace Error</h3>
                            <p class="pf-v5-c-content pf-m-sm">Failed to load marketplace: ${apiErr.message}</p>
                            <p class="pf-v5-c-content pf-m-sm">Please try refreshing the page or contact support.</p>
                        </div>
                    </div>
                </div>
            `;
        }

    } catch (err) {
        console.error('🔧 Marketplace loading error:', err);
        const container = document.getElementById('marketplace-items');
        if (container) {
            container.innerHTML = `
                <div class="pf-v5-l-gallery__item">
                    <div class="pf-v5-c-empty-state pf-m-sm">
                        <div class="pf-v5-c-empty-state__content">
                            <h3 class="pf-v5-c-title pf-m-md">Marketplace Error</h3>
                            <p class="pf-v5-c-content pf-m-sm">Unexpected error: ${err.message}</p>
                        </div>
                    </div>
                </div>
            `;
        }
        console.log('🔧 === MARKETPLACE LOADING END (error) ===');
    }
}