package com.openipc.pixelpilot.vr.ui;

import android.content.Context;
import android.opengl.GLES30;
import android.util.Log;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * VRQuadPanel - A quad panel component for VR UI rendering
 * Based on JavaForQuest architecture for OpenXR quad layers
 * Provides textured quad rendering for UI elements in 3D space
 */
public class VRQuadPanel {
    private static final String TAG = "VRQuadPanel";
    private static final int GL_FRAMEBUFFER_SRGB_EXT = 0x8DB9;
    
    // OpenGL resources
    private int vaoId;
    private int vboId;
    private int shaderProgram;
    
    // Shader uniform locations
    private int mvpMatrixLocation;
    private int textureLocation;
    private int positionLocation;
    private int texCoordLocation;
    
    // Panel properties
    private float width = 1.0f;
    private float height = 0.6f;
    private float[] position = {2.0f, 0.0f, -1.0f}; // 2m right, 1m away
    private float[] orientation = {0.0f, 0.0f, 0.0f, 1.0f}; // Quaternion (identity)
    
    // Texture
    private int textureId;
    private boolean hasTexture = false;
    private int renderViewportWidth = 1024;
    private int renderViewportHeight = 512;
    private boolean framebufferSrgb = true;
    private boolean srgbAvailable = true;
    
    private boolean initialized = false;
    
    // Vertex data for a quad
    private static final float[] QUAD_VERTICES = {
        // Position (x, y, z)    // Texture coords (s, t)
        -0.5f, -0.5f, 0.0f,     0.0f, 1.0f,  // Bottom-left
         0.5f, -0.5f, 0.0f,     1.0f, 1.0f,  // Bottom-right
        -0.5f,  0.5f, 0.0f,     0.0f, 0.0f,  // Top-left
         0.5f,  0.5f, 0.0f,     1.0f, 0.0f   // Top-right
    };
    
    // Vertex shader source
    private static final String VERTEX_SHADER =
        "#version 300 es\n" +
        "uniform mat4 uMVPMatrix;\n" +
        "in vec3 aPosition;\n" +
        "in vec2 aTexCoord;\n" +
        "out vec2 vTexCoord;\n" +
        "void main() {\n" +
        "    gl_Position = uMVPMatrix * vec4(aPosition, 1.0);\n" +
        "    vTexCoord = aTexCoord;\n" +
        "}\n";
    
    // Fragment shader source
    private static final String FRAGMENT_SHADER =
        "#version 300 es\n" +
        "precision highp float;\n" +
        "uniform sampler2D uTexture;\n" +
        "in vec2 vTexCoord;\n" +
        "out vec4 fragColor;\n" +
        "void main() {\n" +
        "    fragColor = texture(uTexture, vTexCoord);\n" +
        "}\n";
    
    public VRQuadPanel() {
        // Initialize will be called when OpenGL context is available
    }
    
    public void initialize(Context context) {
        if (initialized) {
            return;
        }
        
        try {
            // Create shader program
            shaderProgram = createShaderProgram(VERTEX_SHADER, FRAGMENT_SHADER);
            if (shaderProgram == 0) {
                throw new RuntimeException("Failed to create shader program");
            }
            
            // Get uniform locations
            mvpMatrixLocation = GLES30.glGetUniformLocation(shaderProgram, "uMVPMatrix");
            textureLocation = GLES30.glGetUniformLocation(shaderProgram, "uTexture");
            positionLocation = GLES30.glGetAttribLocation(shaderProgram, "aPosition");
            texCoordLocation = GLES30.glGetAttribLocation(shaderProgram, "aTexCoord");
            
            // Create VAO and VBO
            int[] vaoIds = new int[1];
            GLES30.glGenVertexArrays(1, vaoIds, 0);
            vaoId = vaoIds[0];
            
            int[] vboIds = new int[1];
            GLES30.glGenBuffers(1, vboIds, 0);
            vboId = vboIds[0];
            
            // Bind VAO
            GLES30.glBindVertexArray(vaoId);
            
            // Bind VBO and upload vertex data
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vboId);
            
            ByteBuffer bb = ByteBuffer.allocateDirect(QUAD_VERTICES.length * 4);
            bb.order(ByteOrder.nativeOrder());
            FloatBuffer vertexBuffer = bb.asFloatBuffer();
            vertexBuffer.put(QUAD_VERTICES);
            vertexBuffer.position(0);
            
            GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, vertexBuffer.capacity() * 4, 
                              vertexBuffer, GLES30.GL_STATIC_DRAW);
            
            // Set up vertex attributes
            // Position attribute (3 floats)
            GLES30.glVertexAttribPointer(positionLocation, 3, GLES30.GL_FLOAT, false, 
                                       5 * 4, 0);
            GLES30.glEnableVertexAttribArray(positionLocation);
            
            // Texture coordinate attribute (2 floats)
            GLES30.glVertexAttribPointer(texCoordLocation, 2, GLES30.GL_FLOAT, false, 
                                       5 * 4, 3 * 4);
            GLES30.glEnableVertexAttribArray(texCoordLocation);
            
            // Unbind VAO
            GLES30.glBindVertexArray(0);
            
            initialized = true;

            try {
                String extensions = GLES30.glGetString(GLES30.GL_EXTENSIONS);
                if (extensions != null) {
                    srgbAvailable = extensions.contains("GL_EXT_sRGB") || extensions.contains("GL_KHR_gl3");
                }
            } catch (Exception e) {
                srgbAvailable = true;
                Log.w(TAG, "Unable to determine sRGB support, assuming available", e);
            }

            Log.d(TAG, "VRQuadPanel initialized successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize VRQuadPanel", e);
            dispose();
            throw e;
        }
    }
    
    public void setTexture(int textureId) {
        this.textureId = textureId;
        this.hasTexture = true;
    }
    
    public void setTextureDimensions(int width, int height) {
        if (width > 0) {
            this.renderViewportWidth = width;
        }
        if (height > 0) {
            this.renderViewportHeight = height;
        }
    }

    public void setFramebufferSrgbEnabled(boolean enabled) {
        this.framebufferSrgb = enabled;
    }

    public void setPosition(float x, float y, float z) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
    }
    
    public void setSize(float width, float height) {
        this.width = width;
        this.height = height;
    }
    
    public void render(float[] viewMatrix, float[] projectionMatrix) {
        if (!initialized || !hasTexture) {
            Log.w(TAG, "Panel not initialized or no texture set");
            return;
        }
        
        try {
            // Use shader program
            GLES30.glUseProgram(shaderProgram);
            
            // Bind VAO
            GLES30.glBindVertexArray(vaoId);
            
            // Bind texture
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId);
            GLES30.glUniform1i(textureLocation, 0);
            
            // Create model matrix (position and scale)
            float[] modelMatrix = createModelMatrix();
            
            // Calculate MVP matrix
            float[] mvpMatrix = multiplyMatrices(
                multiplyMatrices(projectionMatrix, viewMatrix),
                modelMatrix
            );
            
            // Set MVP matrix uniform
            GLES30.glUniformMatrix4fv(mvpMatrixLocation, 1, false, mvpMatrix, 0);
            
            // Enable blending for transparency
            GLES30.glEnable(GLES30.GL_BLEND);
            GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA);
            
            // Draw the quad
            GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4);
            
            // Disable blending
            GLES30.glDisable(GLES30.GL_BLEND);
            
            // Unbind VAO
            GLES30.glBindVertexArray(0);
            
            // Unbind shader program
            GLES30.glUseProgram(0);
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to render quad panel", e);
        }
    }
    
    private float[] createModelMatrix() {
        float[] matrix = new float[16];
        
        // Identity matrix
        for (int i = 0; i < 16; i++) {
            matrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
        }
        
        // Apply translation
        matrix[12] = position[0];
        matrix[13] = position[1];
        matrix[14] = position[2];
        
        // Apply scale
        matrix[0] *= width;
        matrix[5] *= height;
        matrix[10] *= 1.0f; // No depth scaling
        
        return matrix;
    }
    
    private float[] multiplyMatrices(float[] a, float[] b) {
        float[] result = new float[16];
        
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                result[i * 4 + j] = 0;
                for (int k = 0; k < 4; k++) {
                    result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
        
        return result;
    }
    
    private int createShaderProgram(String vertexSource, String fragmentSource) {
        // Create vertex shader
        int vertexShader = GLES30.glCreateShader(GLES30.GL_VERTEX_SHADER);
        GLES30.glShaderSource(vertexShader, vertexSource);
        GLES30.glCompileShader(vertexShader);
        
        // Check vertex shader compilation
        int[] compiled = new int[1];
        GLES30.glGetShaderiv(vertexShader, GLES30.GL_COMPILE_STATUS, compiled, 0);
        if (compiled[0] == 0) {
            String log = GLES30.glGetShaderInfoLog(vertexShader);
            Log.e(TAG, "Vertex shader compilation error: " + log);
            GLES30.glDeleteShader(vertexShader);
            return 0;
        }
        
        // Create fragment shader
        int fragmentShader = GLES30.glCreateShader(GLES30.GL_FRAGMENT_SHADER);
        GLES30.glShaderSource(fragmentShader, fragmentSource);
        GLES30.glCompileShader(fragmentShader);
        
        // Check fragment shader compilation
        GLES30.glGetShaderiv(fragmentShader, GLES30.GL_COMPILE_STATUS, compiled, 0);
        if (compiled[0] == 0) {
            String log = GLES30.glGetShaderInfoLog(fragmentShader);
            Log.e(TAG, "Fragment shader compilation error: " + log);
            GLES30.glDeleteShader(vertexShader);
            GLES30.glDeleteShader(fragmentShader);
            return 0;
        }
        
        // Create shader program
        int program = GLES30.glCreateProgram();
        GLES30.glAttachShader(program, vertexShader);
        GLES30.glAttachShader(program, fragmentShader);
        GLES30.glLinkProgram(program);
        
        // Check program linking
        int[] linked = new int[1];
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0);
        if (linked[0] == 0) {
            String log = GLES30.glGetProgramInfoLog(program);
            Log.e(TAG, "Shader program linking error: " + log);
            GLES30.glDeleteShader(vertexShader);
            GLES30.glDeleteShader(fragmentShader);
            GLES30.glDeleteProgram(program);
            return 0;
        }
        
        // Clean up shaders
        GLES30.glDeleteShader(vertexShader);
        GLES30.glDeleteShader(fragmentShader);
        
        return program;
    }
    
    public boolean isInitialized() {
        return initialized;
    }
    
    /**
     * Renders the quad panel content directly to a provided texture.
     * This method is used by the OpenXR quad layer integration to render
     * UI content to a texture that can be displayed in the VR environment.
     * 
     * @param targetTextureId The OpenGL texture ID to render to
     * @param imageIndex The swapchain image index (for debugging/logging)
     */
    public void renderToTexture(int targetTextureId, int imageIndex) {
        if (!initialized || !hasTexture) {
            Log.w(TAG, "Panel not initialized or no texture set for renderToTexture");
            return;
        }
        
        try {
            // Create framebuffer for offscreen rendering
            int[] framebuffer = new int[1];
            GLES30.glGenFramebuffers(1, framebuffer, 0);
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer[0]);
            
            // Attach the target texture to the framebuffer
            GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, 
                                         GLES30.GL_TEXTURE_2D, targetTextureId, 0);
            
            // Check framebuffer status
            int status = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER);
            if (status != GLES30.GL_FRAMEBUFFER_COMPLETE) {
                Log.e(TAG, "Framebuffer not complete for renderToTexture: " + status);
                GLES30.glDeleteFramebuffers(1, framebuffer, 0);
                return;
            }
            
            // Set viewport to match the target texture dimensions
            GLES30.glViewport(0, 0, renderViewportWidth, renderViewportHeight);

            boolean srgbEnabled = framebufferSrgb && srgbAvailable;
            if (srgbEnabled) {
                GLES30.glEnable(GL_FRAMEBUFFER_SRGB_EXT);
            }
            
            // Clear with transparent background
            GLES30.glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
            
            // Enable blending for transparency
            GLES30.glEnable(GLES30.GL_BLEND);
            GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA);
            
            // Use shader program
            GLES30.glUseProgram(shaderProgram);
            
            // Bind VAO
            GLES30.glBindVertexArray(vaoId);
            
            // Bind the panel's texture
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId);
            GLES30.glUniform1i(textureLocation, 0);
            
            // Create a simple orthographic projection matrix for 2D rendering
            float[] projectionMatrix = {
                2.0f, 0.0f, 0.0f, 0.0f,
                0.0f, 2.0f, 0.0f, 0.0f,
                0.0f, 0.0f, -1.0f, 0.0f,
                0.0f, 0.0f, 0.0f, 1.0f
            };
            
            // Create identity view matrix
            float[] viewMatrix = {
                1.0f, 0.0f, 0.0f, 0.0f,
                0.0f, 1.0f, 0.0f, 0.0f,
                0.0f, 0.0f, 1.0f, 0.0f,
                0.0f, 0.0f, 0.0f, 1.0f
            };
            
            // Create model matrix (center the quad in the viewport)
            float[] modelMatrix = new float[16];
            for (int i = 0; i < 16; i++) {
                modelMatrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
            }
            modelMatrix[0] = 1.0f;
            modelMatrix[5] = 1.0f;
            
            // Calculate MVP matrix
            float[] mvpMatrix = multiplyMatrices(
                multiplyMatrices(projectionMatrix, viewMatrix),
                modelMatrix
            );
            
            // Set MVP matrix uniform
            GLES30.glUniformMatrix4fv(mvpMatrixLocation, 1, false, mvpMatrix, 0);
            
            // Draw the quad
            GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4);
            
            // Clean up
            GLES30.glBindVertexArray(0);
            GLES30.glUseProgram(0);
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
            if (srgbEnabled) {
                GLES30.glDisable(GL_FRAMEBUFFER_SRGB_EXT);
            }
            GLES30.glDeleteFramebuffers(1, framebuffer, 0);
            
            Log.d(TAG, "Rendered quad panel to texture " + targetTextureId + " for image index " + imageIndex);
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to render quad panel to texture", e);
        }
    }
    
    public void dispose() {
        if (initialized) {
            if (vaoId != 0) {
                int[] vaos = {vaoId};
                GLES30.glDeleteVertexArrays(1, vaos, 0);
                vaoId = 0;
            }
            
            if (vboId != 0) {
                int[] vbos = {vboId};
                GLES30.glDeleteBuffers(1, vbos, 0);
                vboId = 0;
            }
            
            if (shaderProgram != 0) {
                GLES30.glDeleteProgram(shaderProgram);
                shaderProgram = 0;
            }
            
            initialized = false;
            Log.d(TAG, "VRQuadPanel disposed");
        }
    }
}

