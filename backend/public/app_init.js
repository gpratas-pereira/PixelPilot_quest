// Initialize the device manager when DOM is ready
let deviceManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        deviceManager = new FPVueDeviceManager();
    });
} else {
    // DOM already loaded
    deviceManager = new FPVueDeviceManager();
}
