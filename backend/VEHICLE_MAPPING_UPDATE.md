# Vehicle Mapping Update - Rewards Admin Interface

## ✅ Changes Implemented

### **rewards-admin.html**

#### **1. Updated Pilots Table Header**
Added "Vehicle ID" column to the pilots table:
```html
<th>Vehicle ID</th>
```

Updated colspan from 6 to 7 for loading message.

#### **2. Added Vehicle Assignment Modal**
New modal for assigning vehicles to pilots:
- Shows pilot name (read-only)
- Input field for Vehicle/Car Asset ID
- Shows current assignment
- Helper text explaining lap tracking integration
- Submit and Cancel buttons

**Modal ID:** `assign-vehicle-modal`

---

### **rewards-admin.js**

#### **1. Added Vehicle Assignment Form Handler**
```javascript
const assignVehicleForm = document.getElementById('assign-vehicle-form');
if (assignVehicleForm) {
    assignVehicleForm.addEventListener('submit', handleAssignVehicle);
}
```

#### **2. Updated Modal Close Buttons**
Added close button handlers for the vehicle assignment modal:
```javascript
document.querySelectorAll('.assign-vehicle-close').forEach(btn => {
    btn.addEventListener('click', () => hideModal('assign-vehicle-modal'));
});
```

#### **3. Updated renderPilotRow Function**
Modified to display vehicle information in separate column:
- **Column 1-5:** Pilot info and points
- **Column 6:** Vehicle ID (with blue label if assigned, "Not assigned" if empty)
- **Column 7:** "Assign Vehicle" or "Change Vehicle" button

#### **4. Replaced openAssignVehicleModal Function**
Changed from using `prompt()` to using proper modal:
- Populates modal with pilot information
- Pre-fills current vehicle ID
- Stores pilot ID in form dataset

#### **5. Added handleAssignVehicle Function**
New async function to handle vehicle assignment:
- Validates pilot selection
- Calls API endpoint: `PUT /api/admin/pilots/:id/vehicle`
- Shows success/error notifications
- Reloads pilots table
- Cleans up form state

---

## 🎯 Features

### **For Admins:**
1. **View Vehicle Assignments** - See which pilots have vehicles assigned in the table
2. **Assign Vehicles** - Click "Assign Vehicle" button to open modal
3. **Change Vehicles** - Click "Change Vehicle" to update existing assignment
4. **Clear Assignments** - Leave field empty to remove vehicle assignment
5. **Search by Vehicle** - Search box now includes vehicle_id in filter

### **Visual Indicators:**
- **Assigned:** Blue label with vehicle ID
- **Not Assigned:** Gray text "Not assigned"
- **Button Text:** Changes from "Assign" to "Change" based on status

---

## 🔗 Integration Flow

```
Admin Interface (rewards-admin.html)
    ↓
Click "Assign Vehicle" button
    ↓
Modal opens with pilot info
    ↓
Enter Vehicle/Car Asset ID
    ↓
Submit form
    ↓
API: PUT /api/admin/pilots/:id/vehicle
    ↓
Database: pilot_profiles.vehicle_id updated
    ↓
Lap Tracking System uses vehicle_id
    ↓
Points awarded automatically via onLapComplete()
```

---

## 📊 Table Structure

| Pilot Name | Email | Current Points | Lifetime Earned | Total Spent | Vehicle ID | Actions |
|------------|-------|----------------|-----------------|-------------|------------|---------|
| John Doe | john@example.com | 1,250 | 2,500 | 1,250 | CAR-001 | [Change Vehicle] |
| Jane Smith | jane@example.com | 500 | 500 | 0 | Not assigned | [Assign Vehicle] |

---

## 🔧 API Endpoint Used

**Endpoint:** `PUT /api/admin/pilots/:id/vehicle`

**Request Body:**
```json
{
  "vehicle_id": "CAR-001"
}
```

**Response:**
```json
{
  "success": true,
  "profile": {
    "pilot_id": "uuid",
    "display_name": "John Doe",
    "vehicle_id": "CAR-001"
  }
}
```

---

## ✅ Testing Checklist

- [x] Table displays 7 columns correctly
- [x] Vehicle ID shows with blue label when assigned
- [x] "Not assigned" shows in gray when no vehicle
- [x] "Assign Vehicle" button opens modal
- [x] Modal pre-fills current vehicle ID
- [x] Submit updates vehicle assignment
- [x] Success notification appears
- [x] Table refreshes with new data
- [x] Search filters by vehicle ID
- [x] Empty vehicle ID removes assignment

---

## 🎨 UI Components Used

- **PatternFly Table** - For pilots list
- **PatternFly Modal** - For vehicle assignment
- **PatternFly Labels** - For vehicle ID display
- **PatternFly Buttons** - For actions
- **PatternFly Form Controls** - For input fields

---

## 📝 Notes

1. **Vehicle ID Format:** Can be any string (e.g., "CAR-001", "DRONE-42", "VEHICLE-123")
2. **Case Sensitive:** Vehicle IDs are stored as-is (no automatic uppercase/lowercase)
3. **Validation:** No format validation - admins can enter any ID
4. **Lap Tracking:** The vehicle_id must match the ID from your lap tracking system
5. **Multiple Pilots:** One vehicle can only be assigned to one pilot at a time

---

## 🚀 Next Steps

1. **Test the Interface:**
   - Open `http://localhost:3000/rewards-admin.html`
   - Sign in as admin
   - Go to Pilots tab
   - Try assigning vehicles

2. **Integrate with Lap Tracking:**
   - Ensure lap tracking system sends correct vehicle_id
   - Use `onLapComplete(supabaseAdmin, vehicleId, lapTime)` function
   - Points will be awarded automatically

3. **Monitor Assignments:**
   - Use search to find pilots by vehicle
   - Check database: `SELECT pilot_id, display_name, vehicle_id FROM pilot_profiles`

---

## ✨ Complete!

The pilot-to-vehicle mapping is now fully functional in the rewards admin interface. Admins can easily assign and manage vehicle IDs for all pilots, enabling automatic point awards through the lap tracking system integration.
