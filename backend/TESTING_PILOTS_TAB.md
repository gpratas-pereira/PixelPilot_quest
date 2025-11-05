# Testing the Pilots Tab in Rewards Admin

## 🔍 How to Access the Pilots Tab

The Pilots tab is labeled **"Pilot Points"** in the rewards-admin interface.

### **Step-by-Step:**

1. **Open the admin page:**
   ```
   http://localhost:3000/rewards-admin.html
   ```

2. **Sign in with admin credentials**
   - Use an email that's in your `ADMIN_EMAILS` environment variable
   - Enter your password

3. **Look for the tabs at the top:**
   - Marketplace Items (default/active)
   - Achievements
   - Point Rules
   - **Pilot Points** ← Click this one!

4. **Click on "Pilot Points" tab**
   - This will load the pilots table
   - You should see columns: Pilot Name, Email, Current Points, Lifetime Earned, Total Spent, Vehicle ID, Actions

---

## 🐛 Troubleshooting

### **Issue: Tab doesn't appear**

**Check:**
1. Make sure you're signed in as admin
2. Check browser console for errors (F12)
3. Verify the HTML file has the tab button

**Verify tab exists:**
```javascript
// Open browser console (F12) and run:
document.querySelector('[data-tab="pilots"]')
// Should return the button element
```

### **Issue: Tab is there but content doesn't load**

**Check:**
1. Browser console for API errors
2. Server logs for authentication issues
3. Database has pilot_profiles and pilot_points tables

**Test API endpoint:**
```bash
# Get your auth token from browser (F12 > Application > Local Storage > supabase.auth.token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/admin/rewards/pilots
```

### **Issue: "Not authorized" error**

**Fix:**
1. Check `.env` file has your email in `ADMIN_EMAILS`
2. Restart server after changing `.env`
3. Sign out and sign in again

---

## ✅ Expected Behavior

### **When you click "Pilot Points" tab:**

1. **Loading state appears:**
   ```
   Loading...
   ```

2. **Then pilots table loads with:**
   - All registered pilots
   - Their point balances
   - Vehicle assignments (if any)
   - "Assign Vehicle" or "Change Vehicle" buttons

3. **Example table:**
   ```
   ┌──────────────┬─────────────────┬────────┬──────────┬───────┬────────────┬──────────────────┐
   │ Pilot Name   │ Email           │ Points │ Earned   │ Spent │ Vehicle ID │ Actions          │
   ├──────────────┼─────────────────┼────────┼──────────┼───────┼────────────┼──────────────────┤
   │ John Doe     │ john@test.com   │ 1,250  │ 2,500    │ 1,250 │ CAR-001    │ [Change Vehicle] │
   │ Jane Smith   │ jane@test.com   │ 500    │ 500      │ 0     │ Not assign │ [Assign Vehicle] │
   └──────────────┴─────────────────┴────────┴──────────┴───────┴────────────┴──────────────────┘
   ```

---

## 🧪 Quick Test

### **1. Check if tab button exists:**

Open browser console (F12) and run:
```javascript
console.log('Tab button:', document.querySelector('[data-tab="pilots"]'));
console.log('Tab content:', document.getElementById('tab-pilots'));
```

Should output:
```
Tab button: <button class="pf-v5-c-tabs__link" data-tab="pilots">...</button>
Tab content: <div id="tab-pilots" class="admin-tab-content hidden">...</div>
```

### **2. Manually trigger tab switch:**

```javascript
// In browser console:
document.querySelector('[data-tab="pilots"]').click();
```

### **3. Check if pilots are loading:**

```javascript
// In browser console after clicking tab:
console.log('Pilots table body:', document.getElementById('pilots-table-body').innerHTML);
```

---

## 📸 Visual Guide

### **Tab Location:**

```
┌─────────────────────────────────────────────────────────────┐
│ FPVue Admin                                    Admin | Logout│
├─────────────────────────────────────────────────────────────┤
│ Rewards System Management                                   │
│ Manage marketplace items, achievements, point rules...      │
│                                                             │
│ ┌───────────────┬──────────────┬────────────┬─────────────┐│
│ │ Marketplace   │ Achievements │ Point Rules│ Pilot Points││ ← Click here!
│ │ Items (active)│              │            │             ││
│ └───────────────┴──────────────┴────────────┴─────────────┘│
│                                                             │
│ [Content area shows based on selected tab]                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Manual Fix (if tab is missing)

If the "Pilot Points" tab button is somehow missing from your HTML:

1. Open `rewards-admin.html`
2. Find the tabs section (around line 103)
3. Verify this exists:

```html
<li class="pf-v5-c-tabs__item">
    <button class="pf-v5-c-tabs__link" data-tab="pilots">
        <span class="pf-v5-c-tabs__item-text">Pilot Points</span>
    </button>
</li>
```

4. Verify the tab content exists (around line 230):

```html
<div id="tab-pilots" class="admin-tab-content hidden">
    <!-- Pilots table here -->
</div>
```

---

## 🎯 What You Should See

### **Before clicking tab:**
- "Marketplace Items" tab is active (blue/highlighted)
- Items table is visible

### **After clicking "Pilot Points" tab:**
- "Pilot Points" tab becomes active (blue/highlighted)
- Items table disappears
- Pilots table appears with:
  - Search box
  - "Award Points" button
  - Table with 7 columns
  - "Assign Vehicle" buttons in Actions column

---

## 📞 Still Not Working?

If you still don't see the Pilots tab:

1. **Clear browser cache** (Ctrl+Shift+Delete)
2. **Hard refresh** (Ctrl+F5)
3. **Check server is running** (`node server.js`)
4. **Check browser console** for JavaScript errors
5. **Verify file was saved** (check file timestamp)

---

## ✨ Success Indicators

You'll know it's working when:
- ✅ You can click "Pilot Points" tab
- ✅ Tab becomes highlighted/active
- ✅ Pilots table loads with data
- ✅ You can click "Assign Vehicle" buttons
- ✅ Modal opens when you click the button
- ✅ You can assign a vehicle ID and save

---

The tab is definitely there in the code! It's the **4th tab** labeled **"Pilot Points"**. Just click on it after signing in as admin. 🎯
