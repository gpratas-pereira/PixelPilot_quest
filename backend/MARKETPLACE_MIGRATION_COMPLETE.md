# Marketplace Migration to Supabase - Status

## ✅ Completed Tasks

1. **Removed hardcoded MINUTE_PACKAGES** from server.js
2. **Updated API endpoints** to fetch marketplace data from Supabase
3. **Created getMarketplaceItems() function** that fetches from `marketplace_items` table

## ⏳ Remaining Task

### Add `is_locked` field to Supabase

You need to manually add the `is_locked` field to your `marketplace_items` table in Supabase:

1. Go to your Supabase dashboard: https://vsqxljjsdaatrdvljost.supabase.co
2. Navigate to **Table Editor** → **marketplace_items**
3. Click **Add Column** and add:
   - **Name**: `is_locked`
   - **Type**: `boolean`
   - **Default value**: `false`
   - **Description**: "When true, item is locked and not available for purchase"

## 🔄 Current Table Structure

The system expects the following structure in `marketplace_items`:

```sql
marketplace_items (
  item_id,          -- Primary key (maps to old 'id')
  name,             -- Item name (maps to old 'label')
  description,      -- Item description
  item_type,        -- Type of item
  points_price,     -- Price in points
  usdt_price,       -- Price in USDT
  stock,            -- Available stock
  is_active,        -- Whether item is active
  is_locked,        -- ⚠️ NEEDS TO BE ADDED
  image_url,        -- Image URL
  metadata,         -- JSON metadata (should contain 'minutes' field)
  created_at,       -- Creation timestamp
  updated_at        -- Update timestamp
)
```

## 🚀 How the New System Works

1. **getMarketplaceItems()** function fetches from Supabase
2. Filters for `is_active = true` AND `is_locked != true`
3. Orders by `points_price` ascending
4. Transforms data to match old MINUTE_PACKAGES format:
   - `item_id` → `id`
   - `name` → `label`
   - `metadata.minutes` → `minutes`
   - Adds `points_price`, `usdt_price`, `stock`

## 🧪 Testing

After adding the `is_locked` field, test the integration:

```bash
# Start the server
npm run dev

# Test the API endpoint
curl http://localhost:3000/api/public-config

# Check that marketplace items are returned instead of hardcoded data
```

## 🎯 Benefits

- ✅ Marketplace items now stored in Supabase (centralized)
- ✅ Can lock/unlock items dynamically
- ✅ Rewards system continues to work with Supabase
- ✅ Backward compatibility maintained
- ✅ No hardcoded data in server.js

## 📝 Next Steps

1. Add the `is_locked` field as described above
2. Test the API endpoints
3. Optionally populate the marketplace_items table with your desired products
4. Configure item metadata to include `minutes` field for FPV racing packages