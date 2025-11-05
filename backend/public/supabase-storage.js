/**
 * Supabase Storage Helper for Photo Uploads
 * Handles image uploads for pilot profiles, marketplace items, and vehicles
 */

(() => {
    'use strict';

    // Storage bucket configurations
    const STORAGE_CONFIG = {
        pilotProfiles: {
            bucket: 'pilot-photos',
            maxSize: 5 * 1024 * 1024, // 5MB
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
            path: (userId) => userId // Direct user ID folder for RLS policy compatibility
        },
        marketplaceItems: {
            bucket: 'marketplace-photos', 
            maxSize: 10 * 1024 * 1024, // 10MB
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
            path: (itemId) => `items/${itemId}`
        },
        vehicles: {
            bucket: 'vehicle-photos',
            maxSize: 8 * 1024 * 1024, // 8MB
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'], 
            path: (vehicleId) => `vehicles/${vehicleId}`
        }
    };

    class SupabaseStorageHelper {
        constructor(supabaseClient) {
            this.client = supabaseClient;
        }

        /**
         * Validate file before upload
         */
        validateFile(file, category) {
            const config = STORAGE_CONFIG[category];
            if (!config) {
                throw new Error(`Invalid category: ${category}`);
            }

            if (!file) {
                throw new Error('No file selected');
            }

            if (file.size > config.maxSize) {
                const maxSizeMB = Math.round(config.maxSize / (1024 * 1024));
                throw new Error(`File size must be less than ${maxSizeMB}MB`);
            }

            if (!config.allowedTypes.includes(file.type)) {
                throw new Error(`File type must be one of: ${config.allowedTypes.join(', ')}`);
            }

            return true;
        }

        /**
         * Generate unique filename with timestamp
         */
        generateFilename(originalName) {
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 8);
            const extension = originalName.split('.').pop().toLowerCase();
            return `${timestamp}_${randomId}.${extension}`;
        }

        /**
         * Upload photo to Supabase storage
         */
        async uploadPhoto(file, category, entityId, options = {}) {
            try {
                console.log(`Starting photo upload for ${category}, entityId: ${entityId}`);
                this.validateFile(file, category);
                const config = STORAGE_CONFIG[category];
                
                const filename = this.generateFilename(file.name);
                const filePath = `${config.path(entityId)}/${filename}`;
                
                console.log(`Upload details:`, {
                    bucket: config.bucket,
                    filePath,
                    fileSize: file.size,
                    fileType: file.type
                });

                // Check if user is authenticated
                const { data: { user } } = await this.client.auth.getUser();
                if (!user) {
                    throw new Error('User must be authenticated to upload photos');
                }
                console.log('User authenticated:', user.id);

                // Upload to storage
                const { data, error } = await this.client.storage
                    .from(config.bucket)
                    .upload(filePath, file, {
                        cacheControl: '3600',
                        upsert: options.replace || false
                    });

                if (error) {
                    console.error('Storage upload error:', error);
                    throw error;
                }

                console.log('Upload successful:', data);

                // Get public URL
                const { data: { publicUrl } } = this.client.storage
                    .from(config.bucket)
                    .getPublicUrl(filePath);

                return {
                    path: data.path,
                    publicUrl,
                    filename,
                    size: file.size,
                    type: file.type
                };

            } catch (error) {
                console.error(`Photo upload failed for ${category}:`, error);
                console.error('Error details:', {
                    message: error.message,
                    hint: error.hint,
                    details: error.details,
                    code: error.code
                });
                throw error;
            }
        }

        /**
         * Delete photo from storage
         */
        async deletePhoto(category, filePath) {
            try {
                const config = STORAGE_CONFIG[category];
                const { error } = await this.client.storage
                    .from(config.bucket)
                    .remove([filePath]);

                if (error) {
                    throw error;
                }

                return true;
            } catch (error) {
                console.error(`Photo deletion failed for ${category}:`, error);
                throw error;
            }
        }

        /**
         * Get public URL for existing photo
         */
        getPublicUrl(category, filePath) {
            const config = STORAGE_CONFIG[category];
            const { data: { publicUrl } } = this.client.storage
                .from(config.bucket)
                .getPublicUrl(filePath);
            
            return publicUrl;
        }

        /**
         * List photos for an entity
         */
        async listPhotos(category, entityId) {
            try {
                const config = STORAGE_CONFIG[category];
                const folderPath = config.path(entityId);
                
                const { data, error } = await this.client.storage
                    .from(config.bucket)
                    .list(folderPath);

                if (error) {
                    throw error;
                }

                return data.map(file => ({
                    name: file.name,
                    path: `${folderPath}/${file.name}`,
                    publicUrl: this.getPublicUrl(category, `${folderPath}/${file.name}`),
                    size: file.metadata?.size || 0,
                    lastModified: file.updated_at
                }));

            } catch (error) {
                console.error(`Photo listing failed for ${category}:`, error);
                throw error;
            }
        }

        /**
         * Resize image on client side before upload (optional optimization)
         */
        async resizeImage(file, maxWidth = 800, maxHeight = 600, quality = 0.8) {
            return new Promise((resolve) => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();
                
                img.onload = () => {
                    // Calculate new dimensions maintaining aspect ratio
                    let { width, height } = img;
                    
                    if (width > height) {
                        if (width > maxWidth) {
                            height = (height * maxWidth) / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = (width * maxHeight) / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    
                    // Draw and compress
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(resolve, 'image/jpeg', quality);
                };
                
                img.src = URL.createObjectURL(file);
            });
        }
    }

    // Photo Upload UI Component
    class PhotoUploadComponent {
        constructor(containerId, options = {}) {
            this.container = document.getElementById(containerId);
            this.options = {
                category: options.category || 'pilotProfiles',
                entityId: options.entityId || null,
                multiple: options.multiple || false,
                showPreview: options.showPreview !== false,
                onUploadSuccess: options.onUploadSuccess || (() => {}),
                onUploadError: options.onUploadError || (() => {}),
                ...options
            };
            
            this.storageHelper = null;
            this.currentFiles = [];
            
            this.render();
            this.attachEventListeners();
        }

        setStorageHelper(storageHelper) {
            this.storageHelper = storageHelper;
        }

        setEntityId(entityId) {
            this.options.entityId = entityId;
            console.log(`PhotoUploadComponent: Set entityId to "${entityId}" for category "${this.options.category}"`);
        }
        
        getDebugInfo() {
            return {
                category: this.options.category,
                entityId: this.options.entityId,
                storageHelper: !!this.storageHelper,
                currentFiles: this.currentFiles.length,
                containerId: this.container.id
            };
        }

        render() {
            const multiple = this.options.multiple ? 'multiple' : '';
            const accept = STORAGE_CONFIG[this.options.category]?.allowedTypes.join(',') || 'image/*';
            
            this.container.innerHTML = `
                <div class="photo-upload-component">
                    <div class="pf-v6-c-file-upload">
                        <div class="pf-v6-c-file-upload__file-select">
                            <div class="pf-v6-c-input-group">
                                <input type="file" 
                                       class="pf-v6-c-file-upload__file-select-input" 
                                       id="${this.container.id}-input"
                                       accept="${accept}" 
                                       ${multiple}
                                       style="display: none;">
                                <div class="pf-v6-c-input-group__text">
                                    <input type="text" 
                                           class="pf-v6-c-form-control pf-m-readonly" 
                                           id="${this.container.id}-filename"
                                           placeholder="No file selected" 
                                           readonly>
                                </div>
                                <button class="pf-v6-c-button pf-m-control" 
                                        type="button" 
                                        id="${this.container.id}-browse">
                                    <i class="fas fa-folder-open pf-v6-u-mr-sm" aria-hidden="true"></i>
                                    Browse
                                </button>
                            </div>
                        </div>
                        <div class="pf-v6-c-file-upload__file-details" id="${this.container.id}-details" style="display: none;">
                            <div class="pf-v6-c-progress pf-m-sm" id="${this.container.id}-progress" style="display: none;">
                                <div class="pf-v6-c-progress__description" id="${this.container.id}-progress-text">
                                    Uploading...
                                </div>
                                <div class="pf-v6-c-progress__status" aria-hidden="true">
                                    <span class="pf-v6-c-progress__measure" id="${this.container.id}-progress-percent">0%</span>
                                </div>
                                <div class="pf-v6-c-progress__bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                                    <div class="pf-v6-c-progress__indicator" style="width: 0%" id="${this.container.id}-progress-bar"></div>
                                </div>
                            </div>
                            <button class="pf-v6-c-button pf-m-primary pf-m-small" 
                                    type="button" 
                                    id="${this.container.id}-upload"
                                    style="display: none;">
                                <i class="fas fa-upload pf-v6-u-mr-sm" aria-hidden="true"></i>
                                Upload Photo
                            </button>
                            <button class="pf-v6-c-button pf-m-link pf-m-small" 
                                    type="button" 
                                    id="${this.container.id}-clear">
                                Clear
                            </button>
                        </div>
                    </div>
                    ${this.options.showPreview ? `
                    <div class="photo-preview-container pf-v6-u-mt-md" id="${this.container.id}-preview" style="display: none;">
                        <div class="pf-v6-c-card">
                            <div class="pf-v6-c-card__title">
                                <h4 class="pf-v6-c-title pf-m-md">Photo Preview</h4>
                            </div>
                            <div class="pf-v6-c-card__body">
                                <img id="${this.container.id}-preview-img" 
                                     class="photo-preview-image" 
                                     style="max-width: 100%; max-height: 200px; border-radius: 4px;"
                                     alt="Photo preview">
                            </div>
                        </div>
                    </div>` : ''}
                    <div class="pf-v6-c-alert pf-m-inline pf-m-hidden" 
                         id="${this.container.id}-alert" 
                         role="alert" 
                         style="margin-top: 1rem;">
                    </div>
                </div>
            `;
        }

        attachEventListeners() {
            const fileInput = document.getElementById(`${this.container.id}-input`);
            const browseBtn = document.getElementById(`${this.container.id}-browse`);
            const uploadBtn = document.getElementById(`${this.container.id}-upload`);
            const clearBtn = document.getElementById(`${this.container.id}-clear`);

            browseBtn?.addEventListener('click', () => fileInput?.click());
            fileInput?.addEventListener('change', (e) => this.handleFileSelect(e));
            uploadBtn?.addEventListener('click', () => this.handleUpload());
            clearBtn?.addEventListener('click', () => this.clearSelection());
        }

        handleFileSelect(event) {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            this.currentFiles = files;
            const filename = files.length === 1 ? files[0].name : `${files.length} files selected`;
            
            document.getElementById(`${this.container.id}-filename`).value = filename;
            document.getElementById(`${this.container.id}-details`).style.display = 'block';
            document.getElementById(`${this.container.id}-upload`).style.display = 'inline-block';

            // Show preview for single image
            if (files.length === 1 && this.options.showPreview) {
                this.showPreview(files[0]);
            }

            this.hideAlert();
        }

        showPreview(file) {
            if (!file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const previewContainer = document.getElementById(`${this.container.id}-preview`);
                const previewImg = document.getElementById(`${this.container.id}-preview-img`);
                
                if (previewContainer && previewImg) {
                    previewImg.src = e.target.result;
                    previewContainer.style.display = 'block';
                }
            };
            reader.readAsDataURL(file);
        }

        async handleUpload() {
            // Better error checking with specific messages
            if (!this.storageHelper) {
                this.showAlert('Storage helper not initialized. Please refresh the page.', 'danger');
                return;
            }
            
            if (!this.options.entityId) {
                this.showAlert('Entity ID not set. Please close and reopen the form.', 'warning');
                console.error('PhotoUploadComponent: entityId not set', {
                    category: this.options.category,
                    entityId: this.options.entityId
                });
                return;
            }
            
            if (this.currentFiles.length === 0) {
                this.showAlert('Please select a file to upload.', 'warning');
                return;
            }

            const uploadBtn = document.getElementById(`${this.container.id}-upload`);
            const progressContainer = document.getElementById(`${this.container.id}-progress`);
            const progressBar = document.getElementById(`${this.container.id}-progress-bar`);
            const progressPercent = document.getElementById(`${this.container.id}-progress-percent`);

            try {
                uploadBtn.disabled = true;
                progressContainer.style.display = 'block';
                
                const results = [];
                
                for (let i = 0; i < this.currentFiles.length; i++) {
                    const file = this.currentFiles[i];
                    const progress = ((i + 1) / this.currentFiles.length) * 100;
                    
                    progressBar.style.width = `${progress}%`;
                    progressPercent.textContent = `${Math.round(progress)}%`;
                    
                    const result = await this.storageHelper.uploadPhoto(
                        file, 
                        this.options.category, 
                        this.options.entityId
                    );
                    results.push(result);
                }

                this.showAlert('Photo(s) uploaded successfully!', 'success');
                this.options.onUploadSuccess(results);
                this.clearSelection();

            } catch (error) {
                console.error('Upload failed:', error);
                this.showAlert(error.message || 'Upload failed. Please try again.', 'danger');
                this.options.onUploadError(error);
            } finally {
                uploadBtn.disabled = false;
                progressContainer.style.display = 'none';
            }
        }

        clearSelection() {
            this.currentFiles = [];
            document.getElementById(`${this.container.id}-input`).value = '';
            document.getElementById(`${this.container.id}-filename`).value = '';
            document.getElementById(`${this.container.id}-details`).style.display = 'none';
            
            const previewContainer = document.getElementById(`${this.container.id}-preview`);
            if (previewContainer) {
                previewContainer.style.display = 'none';
            }
            
            this.hideAlert();
        }

        showAlert(message, type = 'info') {
            const alert = document.getElementById(`${this.container.id}-alert`);
            if (alert) {
                alert.className = `pf-v6-c-alert pf-m-inline pf-m-${type}`;
                alert.innerHTML = `
                    <div class="pf-v6-c-alert__icon">
                        <i class="fas fa-${this.getAlertIcon(type)}" aria-hidden="true"></i>
                    </div>
                    <div class="pf-v6-c-alert__title">
                        <strong>${message}</strong>
                    </div>
                `;
                alert.style.display = 'block';
            }
        }

        hideAlert() {
            const alert = document.getElementById(`${this.container.id}-alert`);
            if (alert) {
                alert.style.display = 'none';
            }
        }

        getAlertIcon(type) {
            const icons = {
                success: 'check-circle',
                danger: 'exclamation-circle', 
                warning: 'exclamation-triangle',
                info: 'info-circle'
            };
            return icons[type] || icons.info;
        }
    }

    // Export to global scope
    window.SupabaseStorageHelper = SupabaseStorageHelper;
    window.PhotoUploadComponent = PhotoUploadComponent;
    window.STORAGE_CONFIG = STORAGE_CONFIG;

})();