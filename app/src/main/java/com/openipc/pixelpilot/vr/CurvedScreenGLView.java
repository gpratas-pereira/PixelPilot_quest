package com.openipc.pixelpilot.vr;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.opengl.GLES11Ext;
import android.opengl.GLES30;
import android.opengl.GLSurfaceView;
import android.view.Surface;

import androidx.annotation.MainThread;

import com.openipc.videonative.VideoPlayer;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

public class CurvedScreenGLView extends GLSurfaceView {

    private final RendererImpl renderer;

    public CurvedScreenGLView(Context context) {
        super(context);
        setEGLContextClientVersion(3);
        renderer = new RendererImpl();
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    @MainThread
    public void attachVideoPlayer(VideoPlayer player) {
        renderer.setVideoPlayer(player, this);
    }

    @MainThread
    public void setVideoAspect(int w, int h) {
        renderer.setVideoAspect(w, h);
    }

    private static class RendererImpl implements GLSurfaceView.Renderer {
        // External texture + Surface
        private int oesTex = 0;
        private SurfaceTexture surfaceTexture = null;
        private Surface surface = null;
        private volatile boolean surfaceAttached = false;
        private volatile long framesUpdated = 0;

        // Shader program
        private int prog3D = 0;
        private int uMvpLoc = -1;
        private int uTexLoc = -1;

        // Mesh (cylinder)
        private int vao = 0, vbo = 0, ibo = 0;
        private int indexCount = 0;

        // Parameters
        private volatile float screenSpanDeg = 120.0f; // horizontal FOV of screen
        private volatile float radius = 1.5f;          // meters
        private volatile float aspect = 16f / 9f;      // updated from stream
        private volatile boolean meshDirty = true;

        // Video player
        private VideoPlayer videoPlayer;
        private GLSurfaceView parentView;

        void setVideoPlayer(VideoPlayer vp, GLSurfaceView view) {
            this.videoPlayer = vp;
            this.parentView = view;
            // If surface already created, attach now on UI thread
            if (surface != null && !surfaceAttached && vp != null) {
                surfaceAttached = true;
                view.post(() -> vp.addAndStartDecoderReceiver(surface, 0));
            }
        }

        void setVideoAspect(int w, int h) {
            if (w > 0 && h > 0) {
                aspect = (float) w / (float) h;
                meshDirty = true;
            }
        }

        @Override
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            // Create external OES texture
            int[] tex = new int[1];
            GLES30.glGenTextures(1, tex, 0);
            oesTex = tex[0];
            GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0);

            // Build shader
            String vs = "#version 300 es\n" +
                    "layout(location=0) in vec3 aPos;\n" +
                    "layout(location=1) in vec2 aUV;\n" +
                    "uniform mat4 uMVP;\n" +
                    "out vec2 vUV;\n" +
                    "void main(){ vUV = vec2(aUV.x, 1.0 - aUV.y); gl_Position = uMVP * vec4(aPos,1.0); }\n";
            String fs = "#version 300 es\n" +
                    "#extension GL_OES_EGL_image_external_essl3 : require\n" +
                    "precision mediump float;\n" +
                    "in vec2 vUV;\n" +
                    "layout(location=0) out vec4 oColor;\n" +
                    "uniform samplerExternalOES uTex;\n" +
                    "void main(){ oColor = texture(uTex, vUV); }\n";
            int vsId = compile(GLES30.GL_VERTEX_SHADER, vs);
            int fsId = compile(GLES30.GL_FRAGMENT_SHADER, fs);
            prog3D = GLES30.glCreateProgram();
            GLES30.glAttachShader(prog3D, vsId);
            GLES30.glAttachShader(prog3D, fsId);
            GLES30.glLinkProgram(prog3D);
            int[] link = new int[1];
            GLES30.glGetProgramiv(prog3D, GLES30.GL_LINK_STATUS, link, 0);
            if (link[0] == 0) {
                String log = GLES30.glGetProgramInfoLog(prog3D);
                throw new RuntimeException("Program link failed: " + log);
            }
            uMvpLoc = GLES30.glGetUniformLocation(prog3D, "uMVP");
            uTexLoc = GLES30.glGetUniformLocation(prog3D, "uTex");

            // Create SurfaceTexture and Surface
            surfaceTexture = new SurfaceTexture(oesTex);
            surfaceTexture.setDefaultBufferSize(1920, 1080);
            surface = new Surface(surfaceTexture);
            if (videoPlayer != null && !surfaceAttached) {
                surfaceAttached = true;
                if (parentView != null) parentView.post(() -> {
                    videoPlayer.addAndStartDecoderReceiver(surface, 0);
                    if (!videoPlayer.isRunning()) {
                        videoPlayer.start();
                        videoPlayer.startAudio();
                    }
                });
            }

            // Initial mesh
            rebuildMesh();
        }

        @Override
        public void onSurfaceChanged(GL10 gl, int width, int height) {
            GLES30.glViewport(0, 0, width, height);
        }

        @Override
        public void onDrawFrame(GL10 gl) {
            if (meshDirty) rebuildMesh();
            if (surfaceTexture != null) {
                try {
                    surfaceTexture.updateTexImage();
                    framesUpdated++;
                } catch (Throwable ignored) {}
            }

            GLES30.glClearColor(0, 0, 0, 1);
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);

            // Simple head-locked view: MVP = identity (screen already modeled around origin)
            float[] mvp = identity();

            if (framesUpdated == 0) {
                // No frames yet: show a debug gradient so screen isn't pure black
                float t = (System.nanoTime() / 100000000L % 20) / 20f;
                GLES30.glClearColor(t, 0.1f, 0.2f, 1f);
                GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
            } else {
                GLES30.glUseProgram(prog3D);
                GLES30.glUniformMatrix4fv(uMvpLoc, 1, false, mvp, 0);
                GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
                GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex);
                GLES30.glUniform1i(uTexLoc, 0);
                GLES30.glBindVertexArray(vao);
                GLES30.glDrawElements(GLES30.GL_TRIANGLES, indexCount, GLES30.GL_UNSIGNED_SHORT, 0);
            }
            GLES30.glBindVertexArray(0);
            GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0);
        }

        private void rebuildMesh() {
            meshDirty = false;
            // Build cylinder centered at origin facing -Z
            final float PI = (float) Math.PI;
            float span = screenSpanDeg * PI / 180.0f;
            float arcLen = radius * span;
            float height = arcLen / Math.max(0.1f, aspect);
            int segX = 64, segY = 32;
            int vertCount = (segX + 1) * (segY + 1);
            FloatBuffer vb = ByteBuffer.allocateDirect(vertCount * 5 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
            for (int y = 0; y <= segY; y++) {
                float v = (float) y / segY;
                float yPos = (v - 0.5f) * height;
                for (int x = 0; x <= segX; x++) {
                    float u = (float) x / segX;
                    float theta = (u - 0.5f) * span;
                    float px = (float) Math.sin(theta) * radius;
                    float pz = (float) -Math.cos(theta) * radius;
                    vb.put(px).put(yPos).put(pz).put(u).put(v);
                }
            }
            vb.position(0);

            int idxCount = segX * segY * 6;
            ShortBuffer ib = ByteBuffer.allocateDirect(idxCount * 2).order(ByteOrder.nativeOrder()).asShortBuffer();
            for (int y = 0; y < segY; y++) {
                for (int x = 0; x < segX; x++) {
                    short i0 = (short) (y * (segX + 1) + x);
                    short i1 = (short) (i0 + 1);
                    short i2 = (short) (i0 + (segX + 1));
                    short i3 = (short) (i2 + 1);
                    ib.put(i0).put(i2).put(i1);
                    ib.put(i1).put(i2).put(i3);
                }
            }
            ib.position(0);

            int[] ids = new int[1];
            if (vao == 0) { GLES30.glGenVertexArrays(1, ids, 0); vao = ids[0]; }
            if (vbo == 0) { GLES30.glGenBuffers(1, ids, 0); vbo = ids[0]; } else { ids[0] = vbo; }
            GLES30.glBindVertexArray(vao);
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbo);
            GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, vb.capacity() * 4, vb, GLES30.GL_STATIC_DRAW);
            GLES30.glEnableVertexAttribArray(0);
            GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 5 * 4, 0);
            GLES30.glEnableVertexAttribArray(1);
            GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 5 * 4, 3 * 4);

            if (ibo == 0) { GLES30.glGenBuffers(1, ids, 0); ibo = ids[0]; } else { ids[0] = ibo; }
            GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, ibo);
            GLES30.glBufferData(GLES30.GL_ELEMENT_ARRAY_BUFFER, ib.capacity() * 2, ib, GLES30.GL_STATIC_DRAW);
            GLES30.glBindVertexArray(0);
            indexCount = idxCount;
        }

        private static int compile(int type, String src) {
            int s = GLES30.glCreateShader(type);
            GLES30.glShaderSource(s, src);
            GLES30.glCompileShader(s);
            int[] ok = new int[1];
            GLES30.glGetShaderiv(s, GLES30.GL_COMPILE_STATUS, ok, 0);
            if (ok[0] == 0) {
                String log = GLES30.glGetShaderInfoLog(s);
                throw new RuntimeException("Shader compile error: " + log);
            }
            return s;
        }

        private static float[] identity() {
            return new float[]{
                    1,0,0,0,
                    0,1,0,0,
                    0,0,1,0,
                    0,0,0,1
            };
        }
    }
}
