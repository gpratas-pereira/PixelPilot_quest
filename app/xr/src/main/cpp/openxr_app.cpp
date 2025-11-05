#include <android/log.h>
#include <android_native_app_glue.h>
#include <android/input.h>
#ifndef AKEYCODE_BUTTON_APP1
#define AKEYCODE_BUTTON_APP1 193
#endif
#ifndef AKEYCODE_BUTTON_APP2
#define AKEYCODE_BUTTON_APP2 194
#endif
#ifndef AKEYCODE_BUTTON_START
#define AKEYCODE_BUTTON_START 108
#endif
#ifndef AKEYCODE_BUTTON_MENU
#define AKEYCODE_BUTTON_MENU 82
#endif
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <GLES3/gl3ext.h>
#include <GLES2/gl2ext.h>
#include <dlfcn.h>
#include <cmath>
#include <string.h>
#include <unistd.h>
#include <vector>
#include <algorithm>
#include <string>
#include <array>

#include "deviceclient/DeviceClient.h"
#include "deviceclient/config.h"
#include <memory>
#include <atomic>
#include <functional>
#include <cstdlib>
#include <cstring>
#ifndef XR_USE_PLATFORM_ANDROID
#define XR_USE_PLATFORM_ANDROID 1
#endif
#ifndef XR_USE_GRAPHICS_API_OPENGL_ES
#define XR_USE_GRAPHICS_API_OPENGL_ES 1
#endif

#include "openxr/openxr.h"
#include "openxr/openxr_platform.h"

#define TAG "openxr_app"
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define ALOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#ifndef XR_TRACE_LOGGING
#define XR_TRACE_LOGGING 0
#endif

#if XR_TRACE_LOGGING
#define XR_TRACE_I(...) ALOGI(__VA_ARGS__)
#define XR_TRACE_W(...) ALOGW(__VA_ARGS__)
#else
#define XR_TRACE_I(...)
#define XR_TRACE_W(...)
#endif
constexpr float kPi = 3.14159265358979323846f;
constexpr bool kEnableVideoPipeline = true;
constexpr float kLensSensorWidthMm = 19.0f;
constexpr float kLensSensorHeightMm = 19.0f;
constexpr float kLensFovHorizontalDeg = 160.0f;
constexpr float kScreenAspect = 16.0f / 9.0f;

// Global variables for VR UI
static JavaVM* g_jvm = nullptr;
static ANativeActivity* g_nativeActivity = nullptr;
static std::unique_ptr<DeviceClient> g_deviceClient;
static std::atomic<int> g_backendChannel{-1};

static GLuint CreateProgram(const char* vsSrc, const char* fsSrc);
static void RunWithActivity(const std::function<void(JNIEnv*, jobject)>& fn) {
    if (!fn || g_jvm == nullptr || g_nativeActivity == nullptr) {
        return;
    }

    JNIEnv* env = nullptr;
    bool didAttach = false;
    if (g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK || env == nullptr) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) != JNI_OK || env == nullptr) {
            return;
        }
        didAttach = true;
    }

    jobject activityObj = g_nativeActivity->clazz;
    if (activityObj != nullptr) {
        fn(env, activityObj);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    if (didAttach) {
        g_jvm->DetachCurrentThread();
    }
}

static void ApplyBackendChannelToJava(int channel) {
    if (channel <= 0) {
        return;
    }

    RunWithActivity([channel](JNIEnv* env, jobject activity) {
        jclass activityClass = env->GetObjectClass(activity);
        if (activityClass == nullptr) {
            return;
        }

        jmethodID method = env->GetMethodID(activityClass, "applyBackendChannel", "(I)V");
        if (method != nullptr) {
            env->CallVoidMethod(activity, method, static_cast<jint>(channel));
        }
        env->DeleteLocalRef(activityClass);
    });
}

static void UpdateJavaBackendStatus(bool connected, const std::string& deviceId, const std::string& displayMode, bool sessionActive, const std::string& sessionRemaining, int wifiChannel, int batteryLevel, bool batteryCharging) {
    RunWithActivity([connected, deviceId, displayMode, sessionActive, sessionRemaining, wifiChannel, batteryLevel, batteryCharging](JNIEnv* env, jobject activity) {
        jclass activityClass = env->GetObjectClass(activity);
        if (activityClass == nullptr) {
            return;
        }

        jmethodID method = env->GetMethodID(activityClass, "updateBackendStatus", "(ZLjava/lang/String;Ljava/lang/String;ZLjava/lang/String;IIZ)V");
        if (method != nullptr) {
            jstring jDeviceId = env->NewStringUTF(deviceId.c_str());
            jstring jDisplay = env->NewStringUTF(displayMode.c_str());
            jstring jSession = env->NewStringUTF(sessionRemaining.c_str());
            env->CallVoidMethod(activity, method,
                               static_cast<jboolean>(connected),
                               jDeviceId,
                               jDisplay,
                               static_cast<jboolean>(sessionActive),
                               jSession,
                               static_cast<jint>(wifiChannel),
                               static_cast<jint>(batteryLevel),
                               static_cast<jboolean>(batteryCharging));
            env->DeleteLocalRef(jDeviceId);
            env->DeleteLocalRef(jDisplay);
            env->DeleteLocalRef(jSession);
        }
        env->DeleteLocalRef(activityClass);
    });
}


static void UpdateJavaStartLineState(const DeviceClient::StartLineState& state) {
    RunWithActivity([state](JNIEnv* env, jobject activity) {
        jclass activityClass = env->GetObjectClass(activity);
        if (activityClass == nullptr) {
            return;
        }

        jmethodID method = env->GetMethodID(activityClass, "updateStartLineStateFromNative", "(Ljava/lang/String;JJII)V");
        if (method != nullptr) {
            jstring jStatus = env->NewStringUTF(state.status.c_str());
            env->CallVoidMethod(activity, method,
                                jStatus,
                                static_cast<jlong>(state.armed_at),
                                static_cast<jlong>(state.countdown_started_at),
                                static_cast<jint>(state.step_interval_ms),
                                static_cast<jint>(state.led_count));
            env->DeleteLocalRef(jStatus);
        }
        env->DeleteLocalRef(activityClass);
    });
}

#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static void handle_cmd(struct android_app* app, int32_t cmd) {
    (void)app;
    (void)cmd;
}


static int32_t handle_input(struct android_app* app, AInputEvent* event) {
    if (AInputEvent_getType(event) == AINPUT_EVENT_TYPE_KEY) {
        const int32_t keyCode = AKeyEvent_getKeyCode(event);
        const int32_t action = AKeyEvent_getAction(event);
        ALOGI("handle_input key=%d action=%d", keyCode, action);
        switch (keyCode) {
            case AKEYCODE_BUTTON_B:
            case AKEYCODE_BACK:
            case AKEYCODE_BUTTON_APP1:
            case AKEYCODE_BUTTON_APP2:
            case AKEYCODE_BUTTON_START:
                if (action == AKEY_EVENT_ACTION_UP) {
                    RunWithActivity([](JNIEnv* env, jobject activity) {
                        jclass activityClass = env->GetObjectClass(activity);
                        if (activityClass == nullptr) {
                            return;
                        }
                        jmethodID method = env->GetMethodID(activityClass, "returnToVideoActivityFromNative", "()V");
                        if (method != nullptr) {
                            env->CallVoidMethod(activity, method);
                        }
                        env->DeleteLocalRef(activityClass);
                    });
                }
                return 1;
            default:
                break;
        }
    }
    return 0;
}

typedef PFN_xrGetInstanceProcAddr PFN_xrGetInstanceProcAddrDyn;

template <typename T>
static XrResult LoadFn(PFN_xrGetInstanceProcAddr getProc, XrInstance inst, const char* name, T* out) {
    return getProc(inst, name, reinterpret_cast<PFN_xrVoidFunction*>(out));
}

struct Matrix4x4 {
    float m[16];
};

struct Vec3 {
    float x, y, z;
    
    Vec3() : x(0), y(0), z(0) {}
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
};

static Matrix4x4 Identity() {
    Matrix4x4 r{};
    memset(r.m, 0, sizeof(r.m));
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
    return r;
}

static Matrix4x4 Multiply(const Matrix4x4& a, const Matrix4x4& b) {
    Matrix4x4 r{};
    for (int c = 0; c < 4; ++c) {
        for (int rIdx = 0; rIdx < 4; ++rIdx) {
            r.m[c * 4 + rIdx] =
                a.m[0 * 4 + rIdx] * b.m[c * 4 + 0] +
                a.m[1 * 4 + rIdx] * b.m[c * 4 + 1] +
                a.m[2 * 4 + rIdx] * b.m[c * 4 + 2] +
                a.m[3 * 4 + rIdx] * b.m[c * 4 + 3];
        }
    }
    return r;
}

static Matrix4x4 ProjectionFromFov(const XrFovf& fov, float nearZ, float farZ) {
    const float tanLeft = tanf(fov.angleLeft);
    const float tanRight = tanf(fov.angleRight);
    const float tanDown = tanf(fov.angleDown);
    const float tanUp = tanf(fov.angleUp);

    const float width = tanRight - tanLeft;
    const float height = tanUp - tanDown;

    Matrix4x4 r{};
    memset(r.m, 0, sizeof(r.m));
    r.m[0] = 2.0f / width;
    r.m[5] = 2.0f / height;
    r.m[8] = (tanRight + tanLeft) / width;
    r.m[9] = (tanUp + tanDown) / height;
    r.m[10] = -(farZ + nearZ) / (farZ - nearZ);
    r.m[11] = -1.0f;
    r.m[14] = -(2.0f * farZ * nearZ) / (farZ - nearZ);
    return r;
}

static Matrix4x4 ViewFromPose(const XrPosef& pose) {
    const XrQuaternionf& q = pose.orientation;
    const XrVector3f& p = pose.position;

    const float xx = q.x * q.x;
    const float yy = q.y * q.y;
    const float zz = q.z * q.z;
    const float xy = q.x * q.y;
    const float xz = q.x * q.z;
    const float yz = q.y * q.z;
    const float wx = q.w * q.x;
    const float wy = q.w * q.y;
    const float wz = q.w * q.z;

    Matrix4x4 rot = Identity();
    rot.m[0] = 1.0f - 2.0f * (yy + zz);
    rot.m[1] = 2.0f * (xy + wz);
    rot.m[2] = 2.0f * (xz - wy);

    rot.m[4] = 2.0f * (xy - wz);
    rot.m[5] = 1.0f - 2.0f * (xx + zz);
    rot.m[6] = 2.0f * (yz + wx);

    rot.m[8] = 2.0f * (xz + wy);
    rot.m[9] = 2.0f * (yz - wx);
    rot.m[10] = 1.0f - 2.0f * (xx + yy);

    Matrix4x4 trans = Identity();
    trans.m[12] = -p.x;
    trans.m[13] = -p.y;
    trans.m[14] = -p.z;

    Matrix4x4 rotT = Identity();
    rotT.m[0] = rot.m[0];
    rotT.m[1] = rot.m[4];
    rotT.m[2] = rot.m[8];
    rotT.m[4] = rot.m[1];
    rotT.m[5] = rot.m[5];
    rotT.m[6] = rot.m[9];
    rotT.m[8] = rot.m[2];
    rotT.m[9] = rot.m[6];
    rotT.m[10] = rot.m[10];

    Matrix4x4 view = Multiply(rotT, trans);
    return view;
}

struct Swapchain {
    XrSwapchain handle = XR_NULL_HANDLE;
    int32_t width = 0;
    int32_t height = 0;
    std::vector<XrSwapchainImageOpenGLESKHR> images;
};

constexpr size_t kHandCount = 2;
static constexpr XrHandEXT kHandIds[kHandCount] = {XR_HAND_LEFT_EXT, XR_HAND_RIGHT_EXT};

static const char* HandName(size_t index) {
    return index == 0 ? "left" : "right";
}

struct HandTrackingContext {
    bool supported = false;
    bool aimSupported = false;
    PFN_xrCreateHandTrackerEXT createTracker = nullptr;
    PFN_xrDestroyHandTrackerEXT destroyTracker = nullptr;
    PFN_xrLocateHandJointsEXT locateJoints = nullptr;
    bool trackersInitialized = false;
    bool loggedMissingFunctions = false;
    bool loggedLocateFailure = false;
    bool loggedPermissionFailure = false;
    std::array<bool, kHandCount> loggedHandActive{{false, false}};
    std::array<XrHandTrackerEXT, kHandCount> trackers{{XR_NULL_HANDLE, XR_NULL_HANDLE}};
    std::array<std::array<XrHandJointLocationEXT, XR_HAND_JOINT_COUNT_EXT>, kHandCount> jointBuffers{};
    std::array<XrHandJointLocationsEXT, kHandCount> jointLocations{};
    std::array<XrHandTrackingAimStateFB, kHandCount> aimStates{};
};

static HandTrackingContext g_handTracking;

static void InitializeHandTrackingForSession(XrSession session) {
    if (!g_handTracking.supported || g_handTracking.trackersInitialized) {
        return;
    }
    if (g_handTracking.createTracker == nullptr ||
        g_handTracking.destroyTracker == nullptr ||
        g_handTracking.locateJoints == nullptr) {
        if (!g_handTracking.loggedMissingFunctions) {
            ALOGW("Hand tracking extension reported but function pointers are missing");
            g_handTracking.loggedMissingFunctions = true;
        }
        return;
    }

    for (size_t i = 0; i < kHandCount; ++i) {
        XrHandTrackerCreateInfoEXT createInfo{XR_TYPE_HAND_TRACKER_CREATE_INFO_EXT};
        createInfo.hand = kHandIds[i];
        createInfo.handJointSet = XR_HAND_JOINT_SET_DEFAULT_EXT;

        XrResult res = g_handTracking.createTracker(session, &createInfo, &g_handTracking.trackers[i]);
        if (XR_FAILED(res)) {
            if (res == XR_ERROR_PERMISSION_INSUFFICIENT) {
                if (!g_handTracking.loggedPermissionFailure) {
                    ALOGW("Hand tracking permission insufficient; enable com.oculus.permission.HAND_TRACKING");
                    g_handTracking.loggedPermissionFailure = true;
                }
            } else {
                ALOGW("xrCreateHandTrackerEXT(%s) failed: %d", HandName(i), res);
            }
            g_handTracking.trackers[i] = XR_NULL_HANDLE;
            continue;
        }

        XrHandJointLocationsEXT locations{XR_TYPE_HAND_JOINT_LOCATIONS_EXT};
        locations.jointCount = XR_HAND_JOINT_COUNT_EXT;
        locations.jointLocations = g_handTracking.jointBuffers[i].data();
        if (g_handTracking.aimSupported) {
            XrHandTrackingAimStateFB aim{XR_TYPE_HAND_TRACKING_AIM_STATE_FB};
            g_handTracking.aimStates[i] = aim;
            locations.next = &g_handTracking.aimStates[i];
        } else {
            locations.next = nullptr;
        }
        g_handTracking.jointLocations[i] = locations;
    }
    g_handTracking.trackersInitialized = true;
}

static void UpdateHandTracking(XrSpace baseSpace, XrTime time) {
    if (!g_handTracking.supported || !g_handTracking.trackersInitialized ||
        g_handTracking.locateJoints == nullptr) {
        return;
    }

    for (size_t i = 0; i < kHandCount; ++i) {
        if (g_handTracking.trackers[i] == XR_NULL_HANDLE) {
            continue;
        }

        XrHandJointsLocateInfoEXT locateInfo{XR_TYPE_HAND_JOINTS_LOCATE_INFO_EXT};
        locateInfo.baseSpace = baseSpace;
        locateInfo.time = time;

        XrResult res = g_handTracking.locateJoints(
            g_handTracking.trackers[i],
            &locateInfo,
            &g_handTracking.jointLocations[i]);

        if (XR_FAILED(res)) {
            if (!g_handTracking.loggedLocateFailure) {
                ALOGW("xrLocateHandJointsEXT failed: %d", res);
                g_handTracking.loggedLocateFailure = true;
            }
            continue;
        }

        if (g_handTracking.jointLocations[i].isActive && !g_handTracking.loggedHandActive[i]) {
            ALOGI("Hand tracking active for %s hand", HandName(i));
            g_handTracking.loggedHandActive[i] = true;
        }
    }
}

static void ShutdownHandTracking() {
    if (!g_handTracking.supported || g_handTracking.destroyTracker == nullptr) {
        g_handTracking.trackersInitialized = false;
        return;
    }

    for (size_t i = 0; i < kHandCount; ++i) {
        if (g_handTracking.trackers[i] != XR_NULL_HANDLE) {
            g_handTracking.destroyTracker(g_handTracking.trackers[i]);
            g_handTracking.trackers[i] = XR_NULL_HANDLE;
        }
    }
    g_handTracking.trackersInitialized = false;
    g_handTracking.loggedLocateFailure = false;
    g_handTracking.loggedHandActive.fill(false);
}

struct VideoResources {
    GLuint oesTex = 0;
    GLuint vao = 0;
    GLuint planeVao = 0;   // flat plane mesh for debugging
    GLuint planeVbo = 0;
    GLuint vbo = 0;
    GLuint program = 0;
    GLuint fbo = 0;
    GLint uViewProj = -1;
    GLint uTexMatrix = -1;
    GLint uSpan = -1;
    GLint uFovH = -1;
    GLint uFovV = -1;
    GLint uSampler = -1;
    GLint uTexelSize = -1;
    GLint uQualityTier = -1;
    GLint uEnhancementModeLoc = -1;
    GLint uEnhancementStrengthLoc = -1;
    GLint uBypass = -1; // diagnostic: bypass rectilinear mapping
    GLint uTime = -1; // for grid background animation
    float texMatrix[16] = {0};
    float texelWidth = 1.0f / 1920.0f;
    float texelHeight = 1.0f / 1080.0f;
    // IMX415 Camera Configuration
    // Sensor: IMX415, FOV: 160° horizontal, Resolution: 1080P@60FPS
    // No fisheye lens - only horizontal correction needed for curved screen
    float spanRad = kLensFovHorizontalDeg * kPi / 180.0f;  // Match lens HFOV on curved surface
    float camFovH = kLensFovHorizontalDeg * kPi / 180.0f;  // Camera horizontal FOV
    float camFovV = 2.0f * static_cast<float>(std::atan((std::min(kLensSensorHeightMm, kLensSensorWidthMm / kScreenAspect) / kLensSensorWidthMm) * std::tan(camFovH * 0.5f)));
    bool usePlane = false; // toggled via backend or JNI requests
    int qualityTier = 1;
    jobject surfaceTextureGlobal = nullptr;
    jobject surfaceGlobal = nullptr;
    jobject videoPlayerGlobal = nullptr;
    jfloatArray texMatrixArray = nullptr;
    jmethodID updateTexImage = nullptr;
    jmethodID getTransformMatrix = nullptr;
    jmethodID addAndStart = nullptr;
    jmethodID isRunning = nullptr;
    jmethodID startVideo = nullptr;
    jmethodID startAudio = nullptr;
    // Debug overlay resources
    GLuint dbgProgram = 0;
    GLuint dbgVao = 0;
    GLuint dbgVbo = 0;
    GLint dbgColorLoc = -1;
    GLint dbgOffsetLoc = -1;
    float dbgFrame = 0.0f;
    bool dbgReady = false;
    bool stubReady = false;
    GLuint stubProgram = 0;
    GLuint stubVao = 0;
    GLuint stubVbo = 0;
    GLint stubTimeLoc = -1;
    GLint stubViewProjLoc = -1;
    float stubTime = 0.0f;
    GLsizei stubVertexCount = 0;
    GLsizei curvedVertexCount = 0;
    float videoTime = 0.0f; // for video grid background animation
    int enhancementMode = 1;
    float enhancementStrength = 0.6f;
    
    // UI Panel resources
    XrSwapchain uiSwapchain = XR_NULL_HANDLE;
    std::vector<XrSwapchainImageOpenGLESKHR> uiSwapchainImages;
    bool uiReady = false;
    XrSpace uiSpace = XR_NULL_HANDLE;
    
    // UI OpenGL resources
    GLuint uiTexture = 0;
    GLuint uiFbo = 0;
    GLuint uiProgram = 0;
    GLuint uiVao = 0;
    GLuint uiVbo = 0;
    GLint uiColorLoc = -1;
    GLint uiViewProjLoc = -1;

    // Secondary UI panel resources
    XrSwapchain overheadSwapchain = XR_NULL_HANDLE;
    std::vector<XrSwapchainImageOpenGLESKHR> overheadSwapchainImages;
    bool overheadReady = false;
    XrSpace overheadSpace = XR_NULL_HANDLE;

    // Overhead UI layer data
    XrCompositionLayerQuad overheadLayer{XR_TYPE_COMPOSITION_LAYER_QUAD};
    bool overheadLayerInitialized = false;
    bool overheadVisible = true;
    uint32_t overheadWidth = 1024;
    uint32_t overheadHeight = 512;

    // UI status information
    std::string uiStatusText;
    float wifiChannel = 0.0f;
    float fps = 0.0f;
    float resolution = 0.0f;
    float signalStrength = 0.0f;
    
    // Java UI Manager class reference
    jclass uiManagerClass = nullptr;
    
    // UI layer data (replaces static variable to prevent memory corruption)
    XrCompositionLayerQuad uiLayer{XR_TYPE_COMPOSITION_LAYER_QUAD};
    bool uiLayerInitialized = false;
    
    // OpenXR function pointers
    PFN_xrCreateSwapchain pfnCreateSwapchain = nullptr;
    PFN_xrDestroySwapchain pfnDestroySwapchain = nullptr;
    PFN_xrEnumerateSwapchainImages pfnEnumerateSwapchainImages = nullptr;
    PFN_xrAcquireSwapchainImage pfnAcquireSwapchainImage = nullptr;
    PFN_xrWaitSwapchainImage pfnWaitSwapchainImage = nullptr;
    PFN_xrReleaseSwapchainImage pfnReleaseSwapchainImage = nullptr;
    PFN_xrCreateReferenceSpace pfnCreateReferenceSpace = nullptr;
    PFN_xrDestroySpace pfnDestroySpace = nullptr;
};

static VideoResources* g_videoRes = nullptr;

struct DebugSceneResources {
    GLuint vao = 0;
    GLuint vbo = 0;
    GLuint program = 0;
    GLuint fbo = 0;
    GLint uViewProj = -1;
    GLint planeFirst = 0;
    GLsizei planeCount = 0;
    GLint axisFirst = 0;
    GLsizei axisCount = 0;
    GLint gridFirst = 0;
    GLsizei gridCount = 0;
    bool ready = false;
};

static void DestroyDebugScene(DebugSceneResources& scene) {
    if (scene.vbo) {
        glDeleteBuffers(1, &scene.vbo);
        scene.vbo = 0;
    }
    if (scene.vao) {
        glDeleteVertexArrays(1, &scene.vao);
        scene.vao = 0;
    }
    if (scene.fbo) {
        glDeleteFramebuffers(1, &scene.fbo);
        scene.fbo = 0;
    }
    if (scene.program) {
        glDeleteProgram(scene.program);
        scene.program = 0;
    }
    scene.uViewProj = -1;
    scene.planeFirst = 0;
    scene.planeCount = 0;
    scene.axisFirst = 0;
    scene.axisCount = 0;
    scene.gridFirst = 0;
    scene.gridCount = 0;
    scene.ready = false;
}

static bool InitDebugScene(DebugSceneResources& scene) {
    DestroyDebugScene(scene);

    static const char* vsSrc = R"(#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main() {
    vColor = aColor;
    gl_Position = uViewProj * vec4(aPos, 1.0);
}
)";

    static const char* fsSrc = R"(#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 oColor;
void main() {
    oColor = vec4(vColor, 1.0);
}
)";

    scene.program = CreateProgram(vsSrc, fsSrc);
    if (!scene.program) {
        return false;
    }

    scene.uViewProj = glGetUniformLocation(scene.program, "uViewProj");
    if (scene.uViewProj == -1) {
        DestroyDebugScene(scene);
        return false;
    }

    struct DebugVertex {
        float pos[3];
        float color[3];
    };

    std::vector<DebugVertex> vertices;
    vertices.reserve(256);

    auto pushVertex = [&](float px, float py, float pz, float cr, float cg, float cb) {
        DebugVertex v{};
        v.pos[0] = px;
        v.pos[1] = py;
        v.pos[2] = pz;
        v.color[0] = cr;
        v.color[1] = cg;
        v.color[2] = cb;
        vertices.push_back(v);
    };

    const float panelZ = -2.5f;
    const float panelHalfWidth = 1.6f;
    const float panelHalfHeight = 1.0f;
    scene.planeFirst = 0;
    pushVertex(-panelHalfWidth, -panelHalfHeight, panelZ, 0.05f, 0.10f, 0.22f);
    pushVertex(panelHalfWidth, -panelHalfHeight, panelZ, 0.12f, 0.15f, 0.30f);
    pushVertex(-panelHalfWidth, panelHalfHeight, panelZ, 0.16f, 0.22f, 0.40f);
    pushVertex(panelHalfWidth, -panelHalfHeight, panelZ, 0.12f, 0.15f, 0.30f);
    pushVertex(panelHalfWidth, panelHalfHeight, panelZ, 0.20f, 0.32f, 0.50f);
    pushVertex(-panelHalfWidth, panelHalfHeight, panelZ, 0.16f, 0.22f, 0.40f);
    scene.planeCount = static_cast<GLsizei>(vertices.size());

    const float axisLen = 1.5f;
    scene.axisFirst = static_cast<GLint>(vertices.size());
    pushVertex(0.0f, 0.0f, 0.0f, 1.0f, 0.15f, 0.15f);
    pushVertex(axisLen, 0.0f, 0.0f, 1.0f, 0.4f, 0.3f);
    pushVertex(0.0f, 0.0f, 0.0f, 0.15f, 1.0f, 0.15f);
    pushVertex(0.0f, axisLen, 0.0f, 0.3f, 1.0f, 0.3f);
    pushVertex(0.0f, 0.0f, 0.0f, 0.15f, 0.35f, 1.0f);
    pushVertex(0.0f, 0.0f, -axisLen, 0.3f, 0.6f, 1.0f);
    scene.axisCount = static_cast<GLsizei>(vertices.size() - scene.axisFirst);

    const float gridExtent = 4.0f;
    const float gridY = -1.0f;
    const float spacing = 0.4f;
    const int gridLines = 10;
    scene.gridFirst = static_cast<GLint>(vertices.size());
    for (int i = -gridLines; i <= gridLines; ++i) {
        float pos = static_cast<float>(i) * spacing;
        float tone = (i % 5 == 0) ? 0.35f : 0.22f;
        pushVertex(-gridExtent, gridY, pos, tone, tone, tone);
        pushVertex(gridExtent, gridY, pos, tone, tone, tone);
        pushVertex(pos, gridY, -gridExtent, tone, tone, tone);
        pushVertex(pos, gridY, gridExtent, tone, tone, tone);
    }
    scene.gridCount = static_cast<GLsizei>(vertices.size() - scene.gridFirst);

    glGenVertexArrays(1, &scene.vao);
    glGenBuffers(1, &scene.vbo);
    glBindVertexArray(scene.vao);
    glBindBuffer(GL_ARRAY_BUFFER, scene.vbo);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(DebugVertex), vertices.data(), GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(DebugVertex), reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(DebugVertex), reinterpret_cast<void*>(sizeof(float) * 3));
    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    glGenFramebuffers(1, &scene.fbo);
    scene.ready = scene.vao != 0 && scene.vbo != 0 && scene.fbo != 0;
    if (!scene.ready) {
        DestroyDebugScene(scene);
        return false;
    }
    return true;
}

static bool RenderDebugScene(const DebugSceneResources& scene, const Matrix4x4& viewProj, int32_t width, int32_t height, GLuint colorTex) {
    if (!scene.ready) {
        return false;
    }
    glBindFramebuffer(GL_FRAMEBUFFER, scene.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex, 0);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        ALOGE("Debug scene framebuffer incomplete: 0x%x", status);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return false;
    }
    glViewport(0, 0, width, height);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glClearColor(0.02f, 0.02f, 0.04f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    glUseProgram(scene.program);
    glUniformMatrix4fv(scene.uViewProj, 1, GL_FALSE, viewProj.m);
    glBindVertexArray(scene.vao);

    if (scene.planeCount > 0) {
        glDrawArrays(GL_TRIANGLES, scene.planeFirst, scene.planeCount);
    }
    if (scene.gridCount > 0) {
        glDrawArrays(GL_LINES, scene.gridFirst, scene.gridCount);
    }
    if (scene.axisCount > 0) {
        glDrawArrays(GL_LINES, scene.axisFirst, scene.axisCount);
    }

    glBindVertexArray(0);
    glUseProgram(0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    GLenum err = glGetError();
    if (err != GL_NO_ERROR) {
        ALOGE("Debug scene GL error: 0x%x", err);
        return false;
    }
    return true;
}


static GLuint CompileShader(GLenum type, const char* src) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, nullptr);
    glCompileShader(shader);
    GLint status = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
    if (!status) {
        GLint len = 0;
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(len);
        glGetShaderInfoLog(shader, len, nullptr, log.data());
        ALOGE("Shader compile error: %s", log.data());
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

static GLuint CreateProgram(const char* vsSrc, const char* fsSrc) {
    GLuint vs = CompileShader(GL_VERTEX_SHADER, vsSrc);
    if (!vs) return 0;
    GLuint fs = CompileShader(GL_FRAGMENT_SHADER, fsSrc);
    if (!fs) {
        glDeleteShader(vs);
        return 0;
    }
    GLuint program = glCreateProgram();
    glAttachShader(program, vs);
    glAttachShader(program, fs);
    glLinkProgram(program);
    GLint status = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &status);
    if (!status) {
        GLint len = 0;
        glGetProgramiv(program, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(len);
        glGetProgramInfoLog(program, len, nullptr, log.data());
        ALOGE("Program link error: %s", log.data());
        glDeleteProgram(program);
        program = 0;
    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    return program;
}

static void CreateCurvedMesh(VideoResources& vr) {
    const int segments = 64;
    const float radius = 1.0f; // position curved screen 0.5m closer to the viewer
    const float span = vr.spanRad;
    const float aspect = kScreenAspect;
    // Enforce 16:9 using arc length to height, preserving the full 160° capture
    const float activeSensorHeightMm = std::min(kLensSensorHeightMm, kLensSensorWidthMm / aspect);
    const float halfSensorWidthMm = kLensSensorWidthMm * 0.5f;
    const float halfSensorHeightMm = activeSensorHeightMm * 0.5f;
    float lensFocalMm = 0.0f;
    if (std::abs(span) > 1e-4f) {
        lensFocalMm = halfSensorWidthMm / static_cast<float>(std::tan(span * 0.5f));
    }
    const float cameraVerticalFov = (lensFocalMm > 0.0f)
        ? 2.0f * static_cast<float>(std::atan(halfSensorHeightMm / lensFocalMm))
        : 0.0f;
    const float tanHalfVertical = (span > 0.0f)
        ? span / (2.0f * aspect)
        : 0.0f;
    float verticalSpan = 2.0f * static_cast<float>(std::atan(tanHalfVertical));
    if (cameraVerticalFov > 0.0f) {
        verticalSpan = std::min(verticalSpan, cameraVerticalFov);
    }
    const float halfHeight = radius * static_cast<float>(std::tan(verticalSpan * 0.5f));

    std::vector<float> vertices;
    vertices.reserve((segments + 1) * 2 * 5);

    const float verticalOffset = -0.3f; // lower curved surface by 30cm

    for (int i = 0; i <= segments; ++i) {
        float u = static_cast<float>(i) / static_cast<float>(segments);
        float angle = (-span * 0.5f) + u * span;
        float x = sinf(angle) * radius;
        float z = -cosf(angle) * radius;

        vertices.push_back(x);
        vertices.push_back(halfHeight + verticalOffset);
        vertices.push_back(z);
        vertices.push_back(u);
        vertices.push_back(1.0f);  // Top edge: V=1.0 (flipped)

        vertices.push_back(x);
        vertices.push_back(-halfHeight + verticalOffset);
        vertices.push_back(z);
        vertices.push_back(u);
        vertices.push_back(0.0f);  // Bottom edge: V=0.0 (flipped)
    }

    glGenVertexArrays(1, &vr.vao);
    glGenBuffers(1, &vr.vbo);
    glBindVertexArray(vr.vao);
    glBindBuffer(GL_ARRAY_BUFFER, vr.vbo);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(float), vertices.data(), GL_STATIC_DRAW);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 5 * sizeof(float), reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 5 * sizeof(float), reinterpret_cast<void*>(3 * sizeof(float)));

    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    vr.curvedVertexCount = static_cast<GLsizei>(vertices.size() / 5);
}

static void CreatePlaneMesh(VideoResources& vr) {
    // Create a plane mesh with 2m width, 16:9 aspect ratio, positioned at 1m from user
    float width = 2.0f;      // 2 meters wide
    float height = width / (16.0f / 9.0f);  // 16:9 aspect ratio = 1.125m tall
    float distance = 1.0f;   // 1 meter from user
    float yOffset = -0.3f;   // Offset downward by 30cm to position below eye level
    
    std::vector<float> vertices = {
        // Position (x, y, z)  // UV (flipped vertically to fix upside down)
        -width/2,  height/2 + yOffset,  -distance,  0.0f, 1.0f,  // Top-left
         width/2,  height/2 + yOffset,  -distance,  1.0f, 1.0f,  // Top-right
        -width/2, -height/2 + yOffset,  -distance,  0.0f, 0.0f,  // Bottom-left
         width/2, -height/2 + yOffset,  -distance,  1.0f, 0.0f   // Bottom-right
    };

    glGenVertexArrays(1, &vr.planeVao);
    glGenBuffers(1, &vr.planeVbo);
    glBindVertexArray(vr.planeVao);
    glBindBuffer(GL_ARRAY_BUFFER, vr.planeVbo);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(float), vertices.data(), GL_STATIC_DRAW);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 5 * sizeof(float), reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 5 * sizeof(float), reinterpret_cast<void*>(3 * sizeof(float)));

    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
}

static bool InitDebugOverlay(VideoResources& vr) {
    static const char* vsSrc =
        "#version 300 es\n"
        "layout(location = 0) in vec2 aPos;\n"
        "uniform vec2 uOffset;\n"
        "void main() {\n"
        "    gl_Position = vec4(aPos + uOffset, 0.0, 1.0);\n"
        "}\n";
    static const char* fsSrc =
        "#version 300 es\n"
        "precision mediump float;\n"
        "uniform vec3 uColor;\n"
        "out vec4 oColor;\n"
        "void main() {\n"
        "    oColor = vec4(uColor, 1.0);\n"
        "}\n";
    vr.dbgProgram = CreateProgram(vsSrc, fsSrc);
    if (!vr.dbgProgram) {
        return false;
    }
    float vertices[] = {
        -0.9f, 0.8f,
        -0.7f, 0.8f,
        -0.9f, 0.6f,
        -0.7f, 0.6f
    };
    glGenVertexArrays(1, &vr.dbgVao);
    glGenBuffers(1, &vr.dbgVbo);
    glBindVertexArray(vr.dbgVao);
    glBindBuffer(GL_ARRAY_BUFFER, vr.dbgVbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), reinterpret_cast<void*>(0));
    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    glUseProgram(vr.dbgProgram);
    vr.dbgColorLoc = glGetUniformLocation(vr.dbgProgram, "uColor");
    vr.dbgOffsetLoc = glGetUniformLocation(vr.dbgProgram, "uOffset");
    glUseProgram(0);

    vr.dbgReady = true;
    vr.dbgFrame = 0.0f;
    return true;
}

static jclass LoadApplicationClass(JNIEnv* env, ANativeActivity* activity, const char* className) {
    if (!activity || !activity->clazz) {
        ALOGE("Activity reference missing while loading %s", className);
        return nullptr;
    }
    jclass activityCls = env->GetObjectClass(activity->clazz);
    if (!activityCls) {
        ALOGE("Failed to get activity class while loading %s", className);
        return nullptr;
    }
    jmethodID getClassLoader =
        env->GetMethodID(activityCls, "getClassLoader", "()Ljava/lang/ClassLoader;");
    if (!getClassLoader) {
        ALOGE("getClassLoader not found while loading %s", className);
        env->DeleteLocalRef(activityCls);
        return nullptr;
    }
    jobject classLoaderObj = env->CallObjectMethod(activity->clazz, getClassLoader);
    env->DeleteLocalRef(activityCls);
    if (!classLoaderObj) {
        ALOGE("ClassLoader instance missing while loading %s", className);
        return nullptr;
    }
    jclass classLoaderCls = env->FindClass("java/lang/ClassLoader");
    if (!classLoaderCls) {
        ALOGE("java.lang.ClassLoader class not found while loading %s", className);
        env->DeleteLocalRef(classLoaderObj);
        return nullptr;
    }
    jmethodID loadClass =
        env->GetMethodID(classLoaderCls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
    env->DeleteLocalRef(classLoaderCls);
    if (!loadClass) {
        ALOGE("loadClass method not found while loading %s", className);
        env->DeleteLocalRef(classLoaderObj);
        return nullptr;
    }
    jstring jName = env->NewStringUTF(className);
    if (!jName) {
        ALOGE("Failed to allocate class name for %s", className);
        env->DeleteLocalRef(classLoaderObj);
        return nullptr;
    }
    jclass targetCls = static_cast<jclass>(env->CallObjectMethod(classLoaderObj, loadClass, jName));
    env->DeleteLocalRef(jName);
    env->DeleteLocalRef(classLoaderObj);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        ALOGE("Exception while loading class %s", className);
        return nullptr;
    }
    return targetCls;
}

static bool InitStubPattern(VideoResources& vr) {
    static const char* vsSrc =
        "#version 300 es\n"
        "uniform mat4 uViewProj;\n"
        "layout(location = 0) in vec3 aPosition;\n"
        "out vec3 vPosition;\n"
        "void main() {\n"
        "    vPosition = aPosition;\n"
        "    gl_Position = uViewProj * vec4(aPosition, 1.0);\n"
        "}\n";
    static const char* fsSrc =
        "#version 300 es\n"
        "precision mediump float;\n"
        "in vec3 vPosition;\n"
        "uniform float uTime;\n"
        "out vec4 oColor;\n"
        "void main() {\n"
        "    // Create grid lines based on X and Z positions (horizontal plane)\n"
        "    float gridX = fract(vPosition.x * 0.1); // Grid every 10 units\n"
        "    float lineX = step(gridX, 0.02) + step(0.98, gridX);\n"
        "    \n"
        "    float gridZ = fract(vPosition.z * 0.1); // Grid every 10 units\n"
        "    float lineZ = step(gridZ, 0.02) + step(0.98, gridZ);\n"
        "    \n"
        "    float line = max(lineX, lineZ);\n"
        "    \n"
        "    // Animated color for the grid lines\n"
        "    float pulse = 0.5 + 0.5 * sin(uTime * 2.0);\n"
        "    vec3 gridColor = vec3(0.2, 0.6, 1.0) * (0.5 + 0.5 * pulse);\n"
        "    \n"
        "    // Fade out with distance from center\n"
        "    float distance = length(vec2(vPosition.x, vPosition.z));\n"
        "    float alpha = exp(-distance * 0.02);\n"
        "    \n"
        "    vec3 color = mix(vec3(0.0, 0.0, 0.0), gridColor, line * alpha);\n"
        "    oColor = vec4(color, alpha * 0.8);\n"
        "}\n";
    vr.stubProgram = CreateProgram(vsSrc, fsSrc);
    if (!vr.stubProgram) {
        return false;
    }
    
    // Create grid vertices for a large plane in world space
    const float gridSize = 100.0f;
    const float gridStep = 10.0f;
    std::vector<Vec3> vertices;
    
    // Create vertices for a horizontal grid plane at Y=-1.5f (ground level), extending in X and Z directions
    for (float x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(Vec3(x, -1.5f, -gridSize));
        vertices.push_back(Vec3(x, -1.5f, gridSize));
    }
    
    for (float z = -gridSize; z <= gridSize; z += gridStep) {
        vertices.push_back(Vec3(-gridSize, -1.5f, z));
        vertices.push_back(Vec3(gridSize, -1.5f, z));
    }
    
    // Create vertices for a horizontal grid plane at Y=3.0f (ceiling level), extending in X and Z directions
    for (float x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(Vec3(x, 3.0f, -gridSize));
        vertices.push_back(Vec3(x, 3.0f, gridSize));
    }
    
    for (float z = -gridSize; z <= gridSize; z += gridStep) {
        vertices.push_back(Vec3(-gridSize, 3.0f, z));
        vertices.push_back(Vec3(gridSize, 3.0f, z));
    }
    
    // Create vertices for a vertical grid plane at Z=-11.0f (left side, 10m from screen at Z=-1.0f)
    for (float x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(Vec3(x, -1.5f, -11.0f));
        vertices.push_back(Vec3(x, 3.0f, -11.0f));
    }
    
    for (float y = -1.5f; y <= 3.0f; y += gridStep) {
        vertices.push_back(Vec3(-gridSize, y, -11.0f));
        vertices.push_back(Vec3(gridSize, y, -11.0f));
    }
    
    // Create vertices for a vertical grid plane at Z=9.0f (right side, 10m from screen at Z=-1.0f)
    for (float x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(Vec3(x, -1.5f, 9.0f));
        vertices.push_back(Vec3(x, 3.0f, 9.0f));
    }
    
    for (float y = -1.5f; y <= 3.0f; y += gridStep) {
        vertices.push_back(Vec3(-gridSize, y, 9.0f));
        vertices.push_back(Vec3(gridSize, y, 9.0f));
    }
    
    glGenVertexArrays(1, &vr.stubVao);
    glBindVertexArray(vr.stubVao);
    
    glGenBuffers(1, &vr.stubVbo);
    glBindBuffer(GL_ARRAY_BUFFER, vr.stubVbo);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vec3), vertices.data(), GL_STATIC_DRAW);
    
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vec3), (void*)0);
    
    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    
    vr.stubVertexCount = vertices.size();
    
    if (vr.fbo == 0) {
        glGenFramebuffers(1, &vr.fbo);
    }
    if (vr.fbo == 0) {
        glDeleteProgram(vr.stubProgram);
        vr.stubProgram = 0;
        if (vr.stubVao) {
            glDeleteVertexArrays(1, &vr.stubVao);
            vr.stubVao = 0;
        }
        if (vr.stubVbo) {
            glDeleteBuffers(1, &vr.stubVbo);
            vr.stubVbo = 0;
        }
        ALOGE("Failed to allocate framebuffer for stub renderer");
        return false;
    }
    vr.stubTimeLoc = glGetUniformLocation(vr.stubProgram, "uTime");
    vr.stubViewProjLoc = glGetUniformLocation(vr.stubProgram, "uViewProj");
    vr.stubTime = 0.0f;
    vr.stubReady = true;
    return true;
}

static void RenderStubPattern(VideoResources& vr, const Matrix4x4& viewProj, int32_t width, int32_t height, GLuint colorTex) {
    if (!vr.stubReady) return;
    if (vr.fbo == 0) {
        ALOGE("Stub renderer missing framebuffer");
        return;
    }
    glBindFramebuffer(GL_FRAMEBUFFER, vr.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex, 0);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        ALOGE("Stub framebuffer incomplete: 0x%x", status);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return;
    }
    glViewport(0, 0, width, height);
    
    // Enable depth testing for proper 3D rendering
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    
    glUseProgram(vr.stubProgram);
    vr.stubTime += 0.016f;
    
    // Set uniforms
    if (vr.stubTimeLoc >= 0) {
        glUniform1f(vr.stubTimeLoc, vr.stubTime);
    }
    if (vr.stubViewProjLoc >= 0) {
        glUniformMatrix4fv(vr.stubViewProjLoc, 1, GL_FALSE, viewProj.m);
    }
    
    // Draw the grid lines
    glBindVertexArray(vr.stubVao);
    glDrawArrays(GL_LINES, 0, vr.stubVertexCount);
    glBindVertexArray(0);
    
    glUseProgram(0);
    glDisable(GL_BLEND);
    glDisable(GL_DEPTH_TEST);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

static bool InitVideoPipeline(JNIEnv* env, ANativeActivity* activity, VideoResources& vr) {
    auto clearGlobals = [&]() {
        if (vr.videoPlayerGlobal) {
            env->DeleteGlobalRef(vr.videoPlayerGlobal);
            vr.videoPlayerGlobal = nullptr;
        }
        if (vr.surfaceGlobal) {
            env->DeleteGlobalRef(vr.surfaceGlobal);
            vr.surfaceGlobal = nullptr;
        }
        if (vr.surfaceTextureGlobal) {
            env->DeleteGlobalRef(vr.surfaceTextureGlobal);
            vr.surfaceTextureGlobal = nullptr;
        }
        if (vr.texMatrixArray) {
            env->DeleteGlobalRef(vr.texMatrixArray);
            vr.texMatrixArray = nullptr;
        }
    };

    vr.stubReady = false;
    vr.stubProgram = 0;
    vr.stubVao = 0;
    vr.stubVbo = 0;
    vr.stubTimeLoc = -1;
    vr.stubViewProjLoc = -1;
    vr.stubTime = 0.0f;
    vr.stubVertexCount = 0;


    glGenTextures(1, &vr.oesTex);
    glBindTexture(GL_TEXTURE_EXTERNAL_OES, vr.oesTex);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    
    // Add anisotropic filtering for better quality at angles
    GLfloat maxAnisotropy = 1.0f;
    glGetFloatv(GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT, &maxAnisotropy);
    glTexParameterf(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
    
    glBindTexture(GL_TEXTURE_EXTERNAL_OES, 0);

    CreateCurvedMesh(vr);

    static const char* vsSrc =
        "#version 300 es\n"
        "layout(location = 0) in vec3 aPos;\n"
        "layout(location = 1) in vec2 aUV;\n"
        "uniform mat4 uViewProj;\n"
        "out vec2 vUV;\n"
        "void main() {\n"
        "    vUV = aUV;\n"
        "    gl_Position = uViewProj * vec4(aPos, 1.0);\n"
        "}\n";

    static const char* fsSrc =
        "#version 300 es\n"
        "#extension GL_OES_EGL_image_external_essl3 : require\n"
        "precision highp float;\n"
        "in vec2 vUV;\n"
        "uniform samplerExternalOES uVideoTex;\n"
        "uniform mat4 uTexMatrix;\n"
        "uniform vec2 uTexelSize;\n"
        "uniform int uQualityTier;\n"
        "uniform int uEnhancementMode;\n"
        "uniform float uEnhancementStrength;\n"
        "out vec4 oColor;\n"
        "vec3 sampleAt(vec2 offset) {\n"
        "    vec4 uv = uTexMatrix * vec4(vUV + offset, 0.0, 1.0);\n"
        "    return texture(uVideoTex, uv.xy).rgb;\n"
        "}\n"
        "void main() {\n"
        "    vec4 extUv = uTexMatrix * vec4(vUV, 0.0, 1.0);\n"
        "    vec2 baseUv = extUv.xy;\n"
        "    vec4 baseSample = texture(uVideoTex, baseUv);\n"
        "    vec3 baseColor = baseSample.rgb;\n"
        "    vec3 result = baseColor;\n"
        "\n"
        "    vec3 axial = sampleAt(vec2(uTexelSize.x, 0.0)) +\n"
        "                 sampleAt(vec2(-uTexelSize.x, 0.0)) +\n"
        "                 sampleAt(vec2(0.0, uTexelSize.y)) +\n"
        "                 sampleAt(vec2(0.0, -uTexelSize.y));\n"
        "    axial *= 0.25;\n"
        "\n"
        "    vec3 diagonals = sampleAt(vec2(uTexelSize.x, uTexelSize.y)) +\n"
        "                     sampleAt(vec2(-uTexelSize.x, uTexelSize.y)) +\n"
        "                     sampleAt(vec2(uTexelSize.x, -uTexelSize.y)) +\n"
        "                     sampleAt(vec2(-uTexelSize.x, -uTexelSize.y));\n"
        "    diagonals *= 0.25;\n"
        "\n"
        "    vec3 gentleBlur = mix(baseColor, axial, 0.6);\n"
        "    vec3 wideBlur = mix(gentleBlur, diagonals, 0.5);\n"
        "    vec3 sharpen = clamp(baseColor * 1.8 - wideBlur * 0.8, 0.0, 1.0);\n"
        "\n"
        "    float strength = clamp(uEnhancementStrength, 0.0, 1.0);\n"
        "    if (uEnhancementMode == 1) {\n"
        "        result = mix(baseColor, wideBlur, strength);\n"
        "    } else if (uEnhancementMode == 2) {\n"
        "        result = mix(baseColor, sharpen, strength);\n"
        "    } else if (uEnhancementMode == 3) {\n"
        "        vec3 intermediate = mix(baseColor, wideBlur, strength * 0.5);\n"
        "        result = mix(intermediate, sharpen, strength * 0.5);\n"
        "    } else {\n"
        "        result = baseColor;\n"
        "    }\n"
        "\n"
        "    if (uQualityTier <= 0) {\n"
        "        result = mix(result, wideBlur, 0.2);\n"
        "    } else if (uQualityTier >= 2) {\n"
        "        result = mix(result, sharpen, 0.15);\n"
        "    }\n"
        "\n"
        "    oColor = vec4(result, baseSample.a);\n"
        "}\n";

    vr.program = CreateProgram(vsSrc, fsSrc);
    if (!vr.program) {
        clearGlobals();
        return false;
    }
    glUseProgram(vr.program);
    vr.uViewProj = glGetUniformLocation(vr.program, "uViewProj");
    vr.uTexMatrix = glGetUniformLocation(vr.program, "uTexMatrix");
    vr.uSampler = glGetUniformLocation(vr.program, "uVideoTex");
    vr.uTexelSize = glGetUniformLocation(vr.program, "uTexelSize");
    vr.uQualityTier = glGetUniformLocation(vr.program, "uQualityTier");
    vr.uEnhancementModeLoc = glGetUniformLocation(vr.program, "uEnhancementMode");
    vr.uEnhancementStrengthLoc = glGetUniformLocation(vr.program, "uEnhancementStrength");

    if (vr.uSampler >= 0) {
        glUniform1i(vr.uSampler, 0);
    }
    if (vr.uTexelSize >= 0) {
        glUniform2f(vr.uTexelSize, vr.texelWidth, vr.texelHeight);
    }
    if (vr.uQualityTier >= 0) {
        glUniform1i(vr.uQualityTier, vr.qualityTier);
    }
    if (vr.uEnhancementModeLoc >= 0) {
        glUniform1i(vr.uEnhancementModeLoc, vr.enhancementMode);
    }
    if (vr.uEnhancementStrengthLoc >= 0) {
        glUniform1f(vr.uEnhancementStrengthLoc, vr.enhancementStrength);
    }
    glUseProgram(0);

    glGenFramebuffers(1, &vr.fbo);

    CreatePlaneMesh(vr);

    jclass surfaceTextureCls = env->FindClass("android/graphics/SurfaceTexture");
    if (!surfaceTextureCls) {
        ALOGE("SurfaceTexture class not found");
        clearGlobals();
        return false;
    }
    jmethodID surfaceTextureCtor = env->GetMethodID(surfaceTextureCls, "<init>", "(I)V");
    jmethodID setDefaultBufferSize = env->GetMethodID(surfaceTextureCls, "setDefaultBufferSize", "(II)V");
    vr.updateTexImage = env->GetMethodID(surfaceTextureCls, "updateTexImage", "()V");
    vr.getTransformMatrix = env->GetMethodID(surfaceTextureCls, "getTransformMatrix", "([F)V");
    if (!surfaceTextureCtor || !setDefaultBufferSize || !vr.updateTexImage || !vr.getTransformMatrix) {
        ALOGE("SurfaceTexture methods missing");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    jobject surfaceTextureLocal = env->NewObject(surfaceTextureCls, surfaceTextureCtor, static_cast<jint>(vr.oesTex));
    if (!surfaceTextureLocal) {
        ALOGE("Failed to create SurfaceTexture");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    env->CallVoidMethod(surfaceTextureLocal, setDefaultBufferSize, 3840, 2160);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        ALOGE("SurfaceTexture.setDefaultBufferSize threw");
        env->DeleteLocalRef(surfaceTextureLocal);
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    vr.surfaceTextureGlobal = env->NewGlobalRef(surfaceTextureLocal);
    if (!vr.surfaceTextureGlobal) {
        ALOGE("Failed to create global SurfaceTexture reference");
        env->DeleteLocalRef(surfaceTextureLocal);
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    env->DeleteLocalRef(surfaceTextureLocal);

    jfloatArray texMatrixLocal = env->NewFloatArray(16);
    if (!texMatrixLocal) {
        ALOGE("Failed to allocate tex matrix array");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    vr.texMatrixArray = reinterpret_cast<jfloatArray>(env->NewGlobalRef(texMatrixLocal));
    env->DeleteLocalRef(texMatrixLocal);
    if (!vr.texMatrixArray) {
        ALOGE("Failed to create global tex matrix array");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }

    jclass surfaceCls = env->FindClass("android/view/Surface");
    if (!surfaceCls) {
        ALOGE("Surface class not found");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    jmethodID surfaceCtor = env->GetMethodID(surfaceCls, "<init>", "(Landroid/graphics/SurfaceTexture;)V");
    if (!surfaceCtor) {
        ALOGE("Surface constructor not found");
        env->DeleteLocalRef(surfaceCls);
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    jobject surfaceLocal = env->NewObject(surfaceCls, surfaceCtor, vr.surfaceTextureGlobal);
    if (!surfaceLocal) {
        ALOGE("Failed to create Surface");
        env->DeleteLocalRef(surfaceCls);
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }
    vr.surfaceGlobal = env->NewGlobalRef(surfaceLocal);
    env->DeleteLocalRef(surfaceLocal);
    env->DeleteLocalRef(surfaceCls);
    if (!vr.surfaceGlobal) {
        ALOGE("Failed to create global Surface reference");
        env->DeleteLocalRef(surfaceTextureCls);
        clearGlobals();
        return false;
    }

    env->DeleteLocalRef(surfaceTextureCls);

    jclass holderCls = LoadApplicationClass(env, activity, "com.openipc.videonative.VideoPlayerHolder");
    if (!holderCls) {
        clearGlobals();
        return false;
    }
    jmethodID getInstance =
        env->GetStaticMethodID(holderCls, "getInstance", "()Lcom/openipc/videonative/VideoPlayer;");
    if (!getInstance) {
        ALOGE("VideoPlayerHolder#getInstance not found");
        env->DeleteLocalRef(holderCls);
        clearGlobals();
        return false;
    }
    jobject vpLocal = nullptr;
    const int kMaxAttempts = 50;
    for (int attempt = 0; attempt < kMaxAttempts && !vpLocal; ++attempt) {
        vpLocal = env->CallStaticObjectMethod(holderCls, getInstance);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
            ALOGE("Exception while calling VideoPlayerHolder.getInstance");
            env->DeleteLocalRef(holderCls);
            clearGlobals();
            return false;
        }
        if (!vpLocal) {
            if (attempt == 0) {
                ALOGI("Waiting for VideoPlayerHolder instance (ensure 2D video activity has started)");
            }
            usleep(100000);
        }
    }
    if (!vpLocal) {
        env->DeleteLocalRef(holderCls);
        clearGlobals();
        if (InitStubPattern(vr)) {
            ALOGI("Video pipeline unavailable; using debug stub renderer");
            return false;
        }
        ALOGW("VideoPlayerHolder returned null after waiting - start the 2D video first");
        return false;
    }
    vr.videoPlayerGlobal = env->NewGlobalRef(vpLocal);
    env->DeleteLocalRef(vpLocal);
    env->DeleteLocalRef(holderCls);
    if (!vr.videoPlayerGlobal) {
        ALOGE("Failed to create global VideoPlayer reference");
        clearGlobals();
        return false;
    }

    jclass videoPlayerCls = env->GetObjectClass(vr.videoPlayerGlobal);
    if (!videoPlayerCls) {
        ALOGE("Failed to resolve VideoPlayer class");
        clearGlobals();
        return false;
    }
    vr.addAndStart = env->GetMethodID(videoPlayerCls, "addAndStartDecoderReceiver", "(Landroid/view/Surface;I)V");
    vr.isRunning = env->GetMethodID(videoPlayerCls, "isRunning", "()Z");
    vr.startVideo = env->GetMethodID(videoPlayerCls, "start", "()V");
    vr.startAudio = env->GetMethodID(videoPlayerCls, "startAudio", "()V");
    env->DeleteLocalRef(videoPlayerCls);
    if (!vr.addAndStart || !vr.isRunning || !vr.startVideo || !vr.startAudio) {
        ALOGE("VideoPlayer methods missing");
        clearGlobals();
        return false;
    }

    env->CallVoidMethod(vr.videoPlayerGlobal, vr.addAndStart, vr.surfaceGlobal, 0);
    if (!env->CallBooleanMethod(vr.videoPlayerGlobal, vr.isRunning)) {
        env->CallVoidMethod(vr.videoPlayerGlobal, vr.startVideo);
    }
    env->CallVoidMethod(vr.videoPlayerGlobal, vr.startAudio);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        ALOGE("Exception while initializing VR video pipeline");
        clearGlobals();
        return false;
    }

    // Initialize stub pattern background
    if (!InitStubPattern(vr)) {
        ALOGW("Failed to initialize stub pattern background");
    }

    return true;
}
static void ReleaseVideoPipeline(JNIEnv* env, VideoResources& vr) {
    if (vr.videoPlayerGlobal) {
        env->DeleteGlobalRef(vr.videoPlayerGlobal);
        vr.videoPlayerGlobal = nullptr;
    }
    if (vr.surfaceGlobal) {
        env->DeleteGlobalRef(vr.surfaceGlobal);
        vr.surfaceGlobal = nullptr;
    }
    if (vr.surfaceTextureGlobal) {
        env->DeleteGlobalRef(vr.surfaceTextureGlobal);
        vr.surfaceTextureGlobal = nullptr;
    }
    if (vr.texMatrixArray) {
        env->DeleteGlobalRef(vr.texMatrixArray);
        vr.texMatrixArray = nullptr;
    }

    if (vr.program) glDeleteProgram(vr.program);
    if (vr.vbo) glDeleteBuffers(1, &vr.vbo);
    if (vr.vao) glDeleteVertexArrays(1, &vr.vao);
    if (vr.oesTex) glDeleteTextures(1, &vr.oesTex);
    if (vr.fbo) glDeleteFramebuffers(1, &vr.fbo);
    if (vr.dbgProgram) glDeleteProgram(vr.dbgProgram);
    if (vr.dbgVao) glDeleteVertexArrays(1, &vr.dbgVao);
    if (vr.dbgVbo) glDeleteBuffers(1, &vr.dbgVbo);
    if (vr.stubProgram) glDeleteProgram(vr.stubProgram);
    if (vr.stubVao) glDeleteVertexArrays(1, &vr.stubVao);
    if (vr.stubVbo) glDeleteBuffers(1, &vr.stubVbo);
    
    // UI panel cleanup
    if (vr.uiProgram) glDeleteProgram(vr.uiProgram);
    if (vr.uiVao) glDeleteVertexArrays(1, &vr.uiVao);
    if (vr.uiVbo) glDeleteBuffers(1, &vr.uiVbo);
    if (vr.uiTexture) glDeleteTextures(1, &vr.uiTexture);
    if (vr.uiFbo) glDeleteFramebuffers(1, &vr.uiFbo);

    vr.program = 0;
    vr.vbo = 0;
    vr.vao = 0;
    vr.oesTex = 0;
    vr.fbo = 0;
    vr.dbgProgram = 0;
    vr.dbgVao = 0;
    vr.dbgVbo = 0;
    vr.dbgReady = false;
    vr.stubProgram = 0;
    vr.stubVao = 0;
    vr.stubVbo = 0;
    vr.stubTimeLoc = -1;
    vr.stubViewProjLoc = -1;
    vr.stubTime = 0.0f;
    vr.stubVertexCount = 0;
    vr.stubReady = false;
    
    // Reset UI panel resources
    vr.uiProgram = 0;
    vr.uiVao = 0;
    vr.uiVbo = 0;
    vr.uiTexture = 0;
    vr.uiFbo = 0;
    vr.uiColorLoc = -1;
    vr.uiViewProjLoc = -1;
    vr.uiReady = false;
    vr.uiSwapchain = XR_NULL_HANDLE;
    vr.uiSpace = XR_NULL_HANDLE;
    vr.uiSwapchainImages.clear();
    vr.overheadReady = false;
    vr.overheadSwapchain = XR_NULL_HANDLE;
    vr.overheadSwapchainImages.clear();
    vr.overheadSpace = XR_NULL_HANDLE;
    vr.overheadLayer = {XR_TYPE_COMPOSITION_LAYER_QUAD};
    vr.overheadLayerInitialized = false;
    vr.overheadVisible = true;
    vr.uiStatusText.clear();
    vr.wifiChannel = 0.0f;
    vr.fps = 0.0f;
    vr.resolution = 0.0f;
    vr.signalStrength = 0.0f;
    vr.qualityTier = 1;
    vr.texelWidth = 1.0f / 1920.0f;
    vr.texelHeight = 1.0f / 1080.0f;
    vr.enhancementMode = 1;
    vr.enhancementStrength = 0.6f;
    
    // Reset UI layer fields
    vr.uiLayerInitialized = false;
    vr.uiLayer = {XR_TYPE_COMPOSITION_LAYER_QUAD};
}

static bool InitUIPanel(VideoResources& vr, XrInstance instance, XrSession session, XrSpace appSpace, android_app* app) {
    ALOGI("Initializing UI panel...");
    
    // Get UIManager class reference for Java integration
    if (g_jvm) {
        JNIEnv* env = nullptr;
        JavaVMAttachArgs args = {JNI_VERSION_1_6, "NativeThread", nullptr};
        if (g_jvm->AttachCurrentThread(&env, &args) == JNI_OK) {
            jobject activityObj = app->activity->clazz;
            if (activityObj != nullptr) {
                jclass nativeActivityClass = env->GetObjectClass(activityObj);
                if (nativeActivityClass != nullptr) {
                    jmethodID initializeMethod = env->GetMethodID(nativeActivityClass, "initializeVRUIManager", "()V");
                    if (initializeMethod != nullptr) {
                        env->CallVoidMethod(activityObj, initializeMethod);
                        if (env->ExceptionCheck()) {
                            env->ExceptionDescribe();
                            env->ExceptionClear();
                            ALOGE("initializeVRUIManager threw an exception");
                        }
                    } else {
                        ALOGW("initializeVRUIManager method not found on activity");
                    }
                    env->DeleteLocalRef(nativeActivityClass);
                } else {
                    ALOGW("Failed to get OpenXrNativeActivity class");
                }
            } else {
                ALOGW("Activity object unavailable for VRUIManager initialization");
            }

            // Get the VRUIManager class using the application's class loader
            jclass activityClass = env->FindClass("android/app/Activity");
            if (activityClass) {
                jmethodID getClassLoader = env->GetMethodID(activityClass, "getClassLoader", "()Ljava/lang/ClassLoader;");
                if (getClassLoader) {
                    jobject classLoader = env->CallObjectMethod(app->activity->clazz, getClassLoader);
                    if (classLoader) {
                        jclass classLoaderClass = env->FindClass("java/lang/ClassLoader");
                        if (classLoaderClass) {
                            jmethodID loadClass = env->GetMethodID(classLoaderClass, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
                            if (loadClass) {
                                jstring className = env->NewStringUTF("com.openipc.pixelpilot.vr.ui.VRUIManager");
                                jclass uiManagerClassLocal = reinterpret_cast<jclass>(env->CallObjectMethod(classLoader, loadClass, className));
                                env->DeleteLocalRef(className);

                                if (uiManagerClassLocal) {
                                    // Create a global reference to the class
                                    vr.uiManagerClass = reinterpret_cast<jclass>(env->NewGlobalRef(uiManagerClassLocal));
                                    env->DeleteLocalRef(uiManagerClassLocal);
                                    ALOGI("Successfully obtained VRUIManager class reference");

                                    jmethodID initializeFromNative = env->GetStaticMethodID(vr.uiManagerClass, "initializeUIFromNative", "()V");
                                    if (initializeFromNative) {
                                        env->CallStaticVoidMethod(vr.uiManagerClass, initializeFromNative);
                                        if (env->ExceptionCheck()) {
                                            env->ExceptionDescribe();
                                            env->ExceptionClear();
                                            ALOGE("initializeUIFromNative threw an exception");
                                        }
                                    }

                                    jmethodID isOverheadVisibleMethod = env->GetStaticMethodID(vr.uiManagerClass, "isOverheadPanelVisible", "()Z");
                                    if (isOverheadVisibleMethod) {
                                        jboolean visible = env->CallStaticBooleanMethod(vr.uiManagerClass, isOverheadVisibleMethod);
                                        if (env->ExceptionCheck()) {
                                            env->ExceptionDescribe();
                                            env->ExceptionClear();
                                            ALOGE("isOverheadPanelVisible threw an exception");
                                        } else {
                                            vr.overheadVisible = (visible == JNI_TRUE);
                                            ALOGI("Overhead panel default visibility: %s", vr.overheadVisible ? "true" : "false");
                                        }
                                    } else {
                                        ALOGW("Failed to find initializeUIFromNative method");
                                    }
                                } else {
                                    ALOGW("Failed to load VRUIManager class through class loader");
                                }
                            } else {
                                ALOGW("Failed to get loadClass method");
                            }
                            env->DeleteLocalRef(classLoaderClass);
                        } else {
                            ALOGW("Failed to find ClassLoader class");
                        }
                        env->DeleteLocalRef(classLoader);
                    } else {
                        ALOGW("Failed to get class loader");
                    }
                } else {
                    ALOGW("Failed to get getClassLoader method");
                }
                env->DeleteLocalRef(activityClass);
            } else {
                ALOGW("Failed to find Activity class");
            }
            g_jvm->DetachCurrentThread();
        } else {
            ALOGW("Failed to attach thread to JVM for UIManager class");
        }
    } else {
        ALOGW("JVM not available for UIManager class initialization");
    }
    // Create UI panel space (positioned ~2m in front of and slightly below the viewer)
    XrReferenceSpaceCreateInfo spaceCreateInfo{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    spaceCreateInfo.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
    spaceCreateInfo.poseInReferenceSpace.orientation = XrQuaternionf{0.0f, 0.0f, 0.0f, 1.0f};
    spaceCreateInfo.poseInReferenceSpace.position = XrVector3f{0.0f, -0.9f, -2.0f};
    
    XrResult result = vr.pfnCreateReferenceSpace(session, &spaceCreateInfo, &vr.uiSpace);
    if (XR_FAILED(result)) {
        ALOGE("Failed to create UI panel space");
        return false;
    }
    
    // Create UI swapchain
    XrSwapchainCreateInfo swapchainCreateInfo{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    swapchainCreateInfo.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT;
    swapchainCreateInfo.format = GL_RGBA8;
    swapchainCreateInfo.sampleCount = 1;
    swapchainCreateInfo.width = 1024;  // UI panel width
    swapchainCreateInfo.height = 512; // UI panel height
    swapchainCreateInfo.faceCount = 1;
    swapchainCreateInfo.arraySize = 1;
    swapchainCreateInfo.mipCount = 1;
    
    result = vr.pfnCreateSwapchain(session, &swapchainCreateInfo, &vr.uiSwapchain);
    if (XR_FAILED(result)) {
        ALOGE("Failed to create UI swapchain");
        return false;
    }
    
    // Get swapchain images
    uint32_t imageCount = 0;
    result = vr.pfnEnumerateSwapchainImages(vr.uiSwapchain, 0, &imageCount, nullptr);
    if (XR_FAILED(result) || imageCount == 0) {
        ALOGE("Failed to enumerate UI swapchain images");
        return false;
    }
    
    vr.uiSwapchainImages.resize(imageCount);
    for (uint32_t i = 0; i < imageCount; i++) {
        vr.uiSwapchainImages[i] = {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR};
    }
    
    result = vr.pfnEnumerateSwapchainImages(vr.uiSwapchain, imageCount, &imageCount, 
                                      reinterpret_cast<XrSwapchainImageBaseHeader*>(vr.uiSwapchainImages.data()));
    if (XR_FAILED(result)) {
        ALOGE("Failed to get UI swapchain images");
        return false;
    }

    // Create overhead panel reference space positioned above the primary panel
    XrReferenceSpaceCreateInfo overheadSpaceInfo{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    overheadSpaceInfo.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
    overheadSpaceInfo.poseInReferenceSpace.orientation = XrQuaternionf{0.0f, 0.0f, 0.0f, 1.0f};
    overheadSpaceInfo.poseInReferenceSpace.position = XrVector3f{0.0f, 0.5f, -1.0f};

    result = vr.pfnCreateReferenceSpace(session, &overheadSpaceInfo, &vr.overheadSpace);
    if (XR_FAILED(result)) {
        ALOGW("Failed to create overhead UI panel space");
        vr.overheadSpace = XR_NULL_HANDLE;
    }

    if (vr.overheadSpace != XR_NULL_HANDLE) {
        XrSwapchainCreateInfo overheadSwapchainInfo{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        overheadSwapchainInfo.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT;
        overheadSwapchainInfo.format = GL_RGBA8;
        overheadSwapchainInfo.sampleCount = 1;
        overheadSwapchainInfo.width = static_cast<int32_t>(vr.overheadWidth);
        overheadSwapchainInfo.height = static_cast<int32_t>(vr.overheadHeight);
        overheadSwapchainInfo.faceCount = 1;
        overheadSwapchainInfo.arraySize = 1;
        overheadSwapchainInfo.mipCount = 1;

        result = vr.pfnCreateSwapchain(session, &overheadSwapchainInfo, &vr.overheadSwapchain);
        if (XR_FAILED(result)) {
            ALOGW("Failed to create overhead UI swapchain");
            vr.overheadSwapchain = XR_NULL_HANDLE;
        } else {
            uint32_t overheadImageCount = 0;
            result = vr.pfnEnumerateSwapchainImages(vr.overheadSwapchain, 0, &overheadImageCount, nullptr);
            if (XR_SUCCEEDED(result) && overheadImageCount > 0) {
                vr.overheadSwapchainImages.resize(overheadImageCount, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR});
                result = vr.pfnEnumerateSwapchainImages(
                    vr.overheadSwapchain,
                    overheadImageCount,
                    &overheadImageCount,
                    reinterpret_cast<XrSwapchainImageBaseHeader*>(vr.overheadSwapchainImages.data()));
                if (XR_FAILED(result)) {
                    ALOGW("Failed to enumerate overhead UI swapchain images");
                    vr.overheadSwapchainImages.clear();
                } else {
                    vr.overheadReady = true;
                    ALOGI("Overhead UI swapchain initialized with %u images", overheadImageCount);
                }
            } else {
                ALOGW("Failed to query overhead UI swapchain image count");
            }
        }
    }

    // Initialize status text
    vr.uiStatusText = "WiFi: -- FPS: -- Res: -- Sig: --";
    
    // TEMPORARY: Disable VRUIManager initialization to test if app starts without it
    // TODO: Fix VRUIManager class loading issue
    ALOGW("VRUIManager initialization temporarily disabled for testing");
    
    ALOGI("UI panel initialized successfully");
    vr.uiReady = true;
    return true;
}

static void UpdateUIPanelStats(VideoResources& vr, float wifiChannel, float fps, float resolution, float signalStrength) {
    vr.wifiChannel = wifiChannel;
    vr.fps = fps;
    vr.resolution = resolution;
    vr.signalStrength = signalStrength;
    
    // Format status text
    char statusBuffer[256];
    snprintf(statusBuffer, sizeof(statusBuffer), 
            "WiFi: %.1f | FPS: %.1f | Res: %.0f | Signal: %.0f%%",
            vr.wifiChannel, vr.fps, vr.resolution, vr.signalStrength);
    vr.uiStatusText = statusBuffer;
    
    ALOGI("UI panel stats updated: %s", vr.uiStatusText.c_str());
}

static void RenderUIPanel(VideoResources& vr, XrSession session) {
    if (!vr.uiReady || !vr.uiSwapchain) {
        return;
    }
    
    // Acquire swapchain image
    uint32_t imageIndex;
    XrSwapchainImageAcquireInfo acquireInfo{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
    XrResult result = vr.pfnAcquireSwapchainImage(vr.uiSwapchain, &acquireInfo, &imageIndex);
    if (XR_FAILED(result)) {
        ALOGW("Failed to acquire UI swapchain image");
        return;
    }
    
    // Wait for swapchain image
    XrSwapchainImageWaitInfo waitInfo{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
    waitInfo.timeout = XR_INFINITE_DURATION;
    result = vr.pfnWaitSwapchainImage(vr.uiSwapchain, &waitInfo);
    if (XR_FAILED(result)) {
        ALOGW("Failed to wait for UI swapchain image");
        return;
    }
    
    // Get the OpenGL texture ID from swapchain
    GLuint uiTexture = vr.uiSwapchainImages[imageIndex].image;
    
    // Call Java VRUIManager.renderToTexture to render UI to the swapchain texture
    if (g_jvm && vr.uiManagerClass) {
        JNIEnv* env = nullptr;
        JavaVMAttachArgs args = {JNI_VERSION_1_6, "NativeThread", nullptr};
        if (g_jvm->AttachCurrentThread(&env, &args) == JNI_OK) {
            // Call the static renderToTexture method
            jmethodID renderToTextureMethod = env->GetStaticMethodID(
                vr.uiManagerClass, "renderToTexture", "(II)V");
            if (renderToTextureMethod) {
                env->CallStaticVoidMethod(vr.uiManagerClass, renderToTextureMethod, 
                                        (jint)uiTexture, (jint)imageIndex);
                ALOGI("Successfully called VRUIManager.renderToTexture with texture %d, index %d", 
                      uiTexture, imageIndex);
            } else {
                ALOGE("Failed to find renderToTexture method");
            }
            g_jvm->DetachCurrentThread();
        } else {
            ALOGW("Failed to attach thread to JVM for UI rendering");
        }
    } else {
        ALOGW("JVM or UIManager class not available for UI rendering");
    }
    
    // Release swapchain image
    XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
    result = vr.pfnReleaseSwapchainImage(vr.uiSwapchain, &releaseInfo);
    if (XR_FAILED(result)) {
        ALOGW("Failed to release UI swapchain image");
    }
}

static XrCompositionLayerQuad* RenderUIPanelPass(VideoResources& vr, XrSession session) {
    // Comprehensive safety checks
    if (!vr.uiReady || !vr.uiSwapchain) {
        ALOGW("RenderUIPanelPass: UI not ready or swapchain null");
        return nullptr;
    }
    
    if (vr.uiSpace == XR_NULL_HANDLE) {
        ALOGW("RenderUIPanelPass: UI space is null");
        return nullptr;
    }
    
    try {
        // Render the UI panel content with error handling
        RenderUIPanel(vr, session);
        
        // Use VideoResources member instead of static variable to avoid memory corruption
        if (!vr.uiLayerInitialized) {
            vr.uiLayer = {XR_TYPE_COMPOSITION_LAYER_QUAD};
            vr.uiLayer.space = vr.uiSpace;  // Uses LOCAL reference space for world coordinates
            vr.uiLayer.subImage.swapchain = vr.uiSwapchain;
            vr.uiLayer.subImage.imageRect.offset = {0, 0};
            vr.uiLayer.subImage.imageRect.extent = {1024, 512};
            vr.uiLayer.pose.orientation = {0.0f, 0.0f, 0.0f, 1.0f};
            vr.uiLayer.pose.position = {0.0f, 0.0f, 1.0f};
            vr.uiLayer.size = {1.0f, 0.5f};
            vr.uiLayerInitialized = true;
            ALOGI("RenderUIPanelPass: UI layer initialized successfully");
        } else {
            // Update the swapchain in case it changed
            vr.uiLayer.subImage.swapchain = vr.uiSwapchain;
            vr.uiLayer.space = vr.uiSpace;
        }
        
        return &vr.uiLayer;
    } catch (...) {
        ALOGE("RenderUIPanelPass: Exception occurred during UI panel rendering");
        return nullptr;
    }
}

static void RenderOverheadPanel(VideoResources& vr, XrSession session) {
    if (!vr.overheadReady || vr.overheadSwapchain == XR_NULL_HANDLE || !vr.overheadVisible) {
        return;
    }

    uint32_t imageIndex = 0;
    XrSwapchainImageAcquireInfo acquireInfo{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
    XrResult result = vr.pfnAcquireSwapchainImage(vr.overheadSwapchain, &acquireInfo, &imageIndex);
    if (XR_FAILED(result)) {
        ALOGW("Failed to acquire overhead UI swapchain image");
        return;
    }

    XrSwapchainImageWaitInfo waitInfo{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
    waitInfo.timeout = XR_INFINITE_DURATION;
    result = vr.pfnWaitSwapchainImage(vr.overheadSwapchain, &waitInfo);
    if (XR_FAILED(result)) {
        ALOGW("Failed to wait for overhead UI swapchain image");
        XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
        vr.pfnReleaseSwapchainImage(vr.overheadSwapchain, &releaseInfo);
        return;
    }

    if (imageIndex >= vr.overheadSwapchainImages.size()) {
        ALOGW("Overhead swapchain image index out of range");
        XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
        vr.pfnReleaseSwapchainImage(vr.overheadSwapchain, &releaseInfo);
        return;
    }

    GLuint texture = vr.overheadSwapchainImages[imageIndex].image;

    if (g_jvm && vr.uiManagerClass) {
        JNIEnv* env = nullptr;
        JavaVMAttachArgs args = {JNI_VERSION_1_6, "OverheadThread", nullptr};
        if (g_jvm->AttachCurrentThread(&env, &args) == JNI_OK) {
            jmethodID method = env->GetStaticMethodID(vr.uiManagerClass, "renderOverheadToTexture", "(II)V");
            if (method) {
                env->CallStaticVoidMethod(vr.uiManagerClass, method, static_cast<jint>(texture), static_cast<jint>(imageIndex));
                if (env->ExceptionCheck()) {
                    env->ExceptionDescribe();
                    env->ExceptionClear();
                    ALOGE("renderOverheadToTexture threw an exception");
                }
            } else {
                ALOGE("Failed to find renderOverheadToTexture method");
            }
            g_jvm->DetachCurrentThread();
        } else {
            ALOGW("Failed to attach thread to JVM for overhead UI rendering");
        }
    } else {
        ALOGW("JVM or UIManager class not available for overhead UI rendering");
    }

    XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
    result = vr.pfnReleaseSwapchainImage(vr.overheadSwapchain, &releaseInfo);
    if (XR_FAILED(result)) {
        ALOGW("Failed to release overhead UI swapchain image");
    }
}

static XrCompositionLayerQuad* RenderOverheadPanelPass(VideoResources& vr, XrSession session) {
    if (!vr.overheadVisible || !vr.overheadReady || vr.overheadSwapchain == XR_NULL_HANDLE) {
        return nullptr;
    }

    if (vr.overheadSpace == XR_NULL_HANDLE) {
        ALOGW("RenderOverheadPanelPass: overhead space is null");
        return nullptr;
    }

    try {
        RenderOverheadPanel(vr, session);

        if (!vr.overheadLayerInitialized) {
            vr.overheadLayer = {XR_TYPE_COMPOSITION_LAYER_QUAD};
            vr.overheadLayer.space = vr.overheadSpace;
            vr.overheadLayer.subImage.swapchain = vr.overheadSwapchain;
            vr.overheadLayer.subImage.imageRect.offset = {0, 0};
            vr.overheadLayer.subImage.imageRect.extent = {static_cast<int32_t>(vr.overheadWidth), static_cast<int32_t>(vr.overheadHeight)};
            vr.overheadLayer.pose.orientation = {0.0f, 0.0f, 0.0f, 1.0f};
            vr.overheadLayer.pose.position = {0.0f, 0.0f, 0.0f};
            vr.overheadLayer.size = {2.4f, 1.2f};
            vr.overheadLayerInitialized = true;
            ALOGI("RenderOverheadPanelPass: overhead UI layer initialized successfully");
        } else {
            vr.overheadLayer.subImage.swapchain = vr.overheadSwapchain;
            vr.overheadLayer.space = vr.overheadSpace;
        }

        return &vr.overheadLayer;
    } catch (...) {
        ALOGE("RenderOverheadPanelPass: Exception occurred during overhead UI panel rendering");
        return nullptr;
    }
}

static bool UpdateVideoTexture(JNIEnv* env, VideoResources& vr) {
    if (!vr.surfaceTextureGlobal) return false;
    env->CallVoidMethod(vr.surfaceTextureGlobal, vr.updateTexImage);
    env->CallVoidMethod(vr.surfaceTextureGlobal, vr.getTransformMatrix, vr.texMatrixArray);
    env->GetFloatArrayRegion(vr.texMatrixArray, 0, 16, vr.texMatrix);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        return false;
    }
    return true;
}

static void RenderBackground(VideoResources& vr, const Matrix4x4& viewProj, int32_t width, int32_t height, GLuint colorTex) {
    glBindFramebuffer(GL_FRAMEBUFFER, vr.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex, 0);
    glViewport(0, 0, width, height);
    
    // Enable depth testing for background
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    
    // Clear both color and depth buffers
    glClearColor(0.1f, 0.1f, 0.1f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    
    // Render the stub pattern background
    RenderStubPattern(vr, viewProj, width, height, colorTex);
    
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

static void RenderEye(VideoResources& vr, const Matrix4x4& viewProj, int32_t width, int32_t height, GLuint colorTex) {
    RenderBackground(vr, viewProj, width, height, colorTex);

    glBindFramebuffer(GL_FRAMEBUFFER, vr.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex, 0);
    glViewport(0, 0, width, height);

    glClear(GL_DEPTH_BUFFER_BIT);

    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    vr.videoTime += 0.016f;

    glUseProgram(vr.program);
    if (vr.uViewProj >= 0) {
        glUniformMatrix4fv(vr.uViewProj, 1, GL_FALSE, viewProj.m);
    }
    if (vr.uTexMatrix >= 0) {
        glUniformMatrix4fv(vr.uTexMatrix, 1, GL_FALSE, vr.texMatrix);
    }
    if (vr.uTexelSize >= 0) {
        glUniform2f(vr.uTexelSize, vr.texelWidth, vr.texelHeight);
    }
    if (vr.uQualityTier >= 0) {
        glUniform1i(vr.uQualityTier, vr.qualityTier);
    }
    if (vr.uEnhancementModeLoc >= 0) {
        glUniform1i(vr.uEnhancementModeLoc, vr.enhancementMode);
    }
    if (vr.uEnhancementStrengthLoc >= 0) {
        glUniform1f(vr.uEnhancementStrengthLoc, vr.enhancementStrength);
    }

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_EXTERNAL_OES, vr.oesTex);

    GLuint targetVao = (vr.usePlane || vr.curvedVertexCount <= 0 || vr.vao == 0) ? vr.planeVao : vr.vao;
    if (targetVao == 0) {
        targetVao = vr.planeVao;
    }
    GLsizei vertexCount = (targetVao == vr.planeVao || vr.curvedVertexCount <= 0) ? 4 : vr.curvedVertexCount;

    glBindVertexArray(targetVao);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, vertexCount);
    glBindVertexArray(0);

    glBindTexture(GL_TEXTURE_EXTERNAL_OES, 0);
    glUseProgram(0);
    glDisable(GL_BLEND);
    glEnable(GL_DEPTH_TEST);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void android_main(struct android_app* app) {
    app->onAppCmd = handle_cmd;
    app->onInputEvent = handle_input;
    ALOGI("android_main started");

    EGLDisplay dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    eglInitialize(dpy, nullptr, nullptr);
    eglBindAPI(EGL_OPENGL_ES_API);
    const EGLint cfgAttribs[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
    EGLConfig cfg;
    EGLint num = 0;
    eglChooseConfig(dpy, cfgAttribs, &cfg, 1, &num);
    const EGLint ctxAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttribs);
    const EGLint pbAttribs[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
    EGLSurface surf = eglCreatePbufferSurface(dpy, cfg, pbAttribs);
    eglMakeCurrent(dpy, surf, surf, ctx);
    ALOGI("EGL context ready");

    void* loader = dlopen("libopenxr_loader.so", RTLD_NOW | RTLD_LOCAL);
    if (!loader) {
        ALOGE("Failed to dlopen libopenxr_loader.so: %s", dlerror());
        return;
    }
    auto xrGetInstanceProcAddrDyn = reinterpret_cast<PFN_xrGetInstanceProcAddrDyn>(dlsym(loader, "xrGetInstanceProcAddr"));
    if (!xrGetInstanceProcAddrDyn) {
        ALOGE("Failed to resolve xrGetInstanceProcAddr");
        dlclose(loader);
        return;
    }

    PFN_xrInitializeLoaderKHR pfnInitializeLoader = nullptr;
    if (XR_FAILED(xrGetInstanceProcAddrDyn(XR_NULL_HANDLE, "xrInitializeLoaderKHR", reinterpret_cast<PFN_xrVoidFunction*>(&pfnInitializeLoader)))) {
        ALOGE("xrInitializeLoaderKHR not found");
        dlclose(loader);
        return;
    }
    XrLoaderInitInfoAndroidKHR loaderInit{XR_TYPE_LOADER_INIT_INFO_ANDROID_KHR};
    loaderInit.applicationVM = app->activity->vm;
    loaderInit.applicationContext = app->activity->clazz;
    if (XR_FAILED(pfnInitializeLoader(reinterpret_cast<const XrLoaderInitInfoBaseHeaderKHR*>(&loaderInit)))) {
        ALOGE("xrInitializeLoaderKHR failed");
        dlclose(loader);
        return;
    }
    ALOGI("xrInitializeLoaderKHR OK");
    
    // Initialize global JavaVM for JNI operations
    g_jvm = app->activity->vm;
    g_nativeActivity = app->activity;

    if (!g_deviceClient) {
        try {
            const char* urlOverride = std::getenv("PIXELPILOT_BACKEND_URL");
            std::string backendUrl = (urlOverride && std::strlen(urlOverride) > 0) ? urlOverride : std::string(DEFAULT_BACKEND_URL);
            std::string deviceName = DEVICE_NAME_PREFIX;

            g_deviceClient = std::make_unique<DeviceClient>(backendUrl, deviceName, g_jvm);
            DeviceClient* devicePtr = g_deviceClient.get();

            g_deviceClient->setChannelChangeCallback([devicePtr](int channel) {
                if (channel <= 0) {
                    return;
                }
                g_backendChannel.store(channel);
                if (devicePtr->isConnected()) {
                    ApplyBackendChannelToJava(channel);
                }
                UpdateJavaBackendStatus(devicePtr->isConnected(), devicePtr->getDeviceIdentifier(), devicePtr->getCurrentDisplayMode(), devicePtr->isSessionActive(), devicePtr->getSessionTimeString(), channel, devicePtr->getBatteryLevel(), devicePtr->isBatteryCharging());
            });

            g_deviceClient->setDisplayModeChangeCallback([devicePtr](const std::string& mode) {
                UpdateJavaBackendStatus(devicePtr->isConnected(), devicePtr->getDeviceIdentifier(), mode, devicePtr->isSessionActive(), devicePtr->getSessionTimeString(), g_backendChannel.load(), devicePtr->getBatteryLevel(), devicePtr->isBatteryCharging());
            });

            g_deviceClient->setStartLineCallback([](const DeviceClient::StartLineState& state) {
                UpdateJavaStartLineState(state);
            });

            g_deviceClient->setStatusCallback([devicePtr](bool connected, int channel, const std::string& mode) {
                if (channel > 0) {
                    int previous = g_backendChannel.exchange(channel);
                    if (connected && previous != channel) {
                        ApplyBackendChannelToJava(channel);
                    }
                }
                UpdateJavaBackendStatus(connected, devicePtr->getDeviceIdentifier(), mode, devicePtr->isSessionActive(), devicePtr->getSessionTimeString(), channel,
                                        devicePtr->getBatteryLevel(), devicePtr->isBatteryCharging());
            });

            g_deviceClient->start();
            UpdateJavaStartLineState(g_deviceClient->getStartLineState());
            int initialChannel = g_deviceClient->getCurrentWifiChannel();
            if (initialChannel > 0) {
                g_backendChannel.store(initialChannel);
                if (g_deviceClient->isConnected()) {
                    ApplyBackendChannelToJava(initialChannel);
                }
            }
            UpdateJavaBackendStatus(g_deviceClient->isConnected(), g_deviceClient->getDeviceIdentifier(), g_deviceClient->getCurrentDisplayMode(), g_deviceClient->isSessionActive(), g_deviceClient->getSessionTimeString(), initialChannel, g_deviceClient->getBatteryLevel(), g_deviceClient->isBatteryCharging());
        } catch (...) {
            ALOGE("Failed to initialize DeviceClient integration");
        }
    }
    
    auto pfnEnumerateExtensions = reinterpret_cast<PFN_xrEnumerateInstanceExtensionProperties>(dlsym(loader, "xrEnumerateInstanceExtensionProperties"));
    if (!pfnEnumerateExtensions) {
        ALOGE("Failed to resolve xrEnumerateInstanceExtensionProperties");
        dlclose(loader);
        return;
    }

    uint32_t extCount = 0;
    pfnEnumerateExtensions(nullptr, 0, &extCount, nullptr);
    std::vector<XrExtensionProperties> extProps(extCount, {XR_TYPE_EXTENSION_PROPERTIES});
    pfnEnumerateExtensions(nullptr, extCount, &extCount, extProps.data());
    ALOGI("Runtime reports %u extensions", extCount);

    for (const auto& ext : extProps) {
        ALOGI(" Extension: %s", ext.extensionName);
    }

    auto hasExtension = [&](const char* name) {
        for (const auto& ext : extProps) {
            if (strcmp(ext.extensionName, name) == 0) {
                return true;
            }
        }
        return false;
    };

    std::vector<const char*> requiredExtensions = {
        XR_KHR_OPENGL_ES_ENABLE_EXTENSION_NAME,
        XR_EXT_PERFORMANCE_SETTINGS_EXTENSION_NAME,
        XR_KHR_ANDROID_THREAD_SETTINGS_EXTENSION_NAME,
        XR_KHR_COMPOSITION_LAYER_CUBE_EXTENSION_NAME,
        XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME,
        XR_KHR_COMPOSITION_LAYER_EQUIRECT2_EXTENSION_NAME,
        XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME,
        XR_FB_COLOR_SPACE_EXTENSION_NAME,
        XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME,
        XR_FB_SWAPCHAIN_UPDATE_STATE_OPENGL_ES_EXTENSION_NAME,
        XR_FB_FOVEATION_EXTENSION_NAME,
        XR_FB_FOVEATION_CONFIGURATION_EXTENSION_NAME
    };

    for (const char* required : requiredExtensions) {
        if (!hasExtension(required)) {
            ALOGE("Required OpenXR extension missing: %s", required);
            dlclose(loader);
            return;
        }
    }

    std::vector<const char*> enabledExtensions = requiredExtensions;

    g_handTracking.supported = hasExtension(XR_EXT_HAND_TRACKING_EXTENSION_NAME);
    g_handTracking.aimSupported = hasExtension(XR_FB_HAND_TRACKING_AIM_EXTENSION_NAME);

    if (g_handTracking.supported) {
        enabledExtensions.push_back(XR_EXT_HAND_TRACKING_EXTENSION_NAME);
        if (g_handTracking.aimSupported) {
            enabledExtensions.push_back(XR_FB_HAND_TRACKING_AIM_EXTENSION_NAME);
        } else {
            ALOGW("XR_FB_hand_tracking_aim extension not available; aim poses disabled");
        }
    } else {
        ALOGW("XR_EXT_hand_tracking extension not available; controllers required");
    }

    XrApplicationInfo appInfo{};
    strncpy(appInfo.applicationName, "PixelPilotXR", sizeof(appInfo.applicationName) - 1);
    appInfo.applicationVersion = 1;
    strncpy(appInfo.engineName, "PixelPilot", sizeof(appInfo.engineName) - 1);
    appInfo.engineVersion = 1;
    appInfo.apiVersion = XR_MAKE_VERSION(1, 0, 68);

    XrInstanceCreateInfo createInfo{XR_TYPE_INSTANCE_CREATE_INFO};
    createInfo.next = nullptr;
    createInfo.applicationInfo = appInfo;
    createInfo.enabledExtensionCount = static_cast<uint32_t>(enabledExtensions.size());
    createInfo.enabledExtensionNames = enabledExtensions.data();

    auto pfnCreateInstance = reinterpret_cast<PFN_xrCreateInstance>(dlsym(loader, "xrCreateInstance"));
    if (!pfnCreateInstance) {
        ALOGE("Failed to resolve xrCreateInstance");
        dlclose(loader);
        return;
    }

    XrInstance instance = XR_NULL_HANDLE;
    XrResult createRes = pfnCreateInstance(&createInfo, &instance);
    if (XR_FAILED(createRes)) {
        auto pfnResultToStringDirect = reinterpret_cast<PFN_xrResultToString>(dlsym(loader, "xrResultToString"));
        if (pfnResultToStringDirect) {
            char buf[XR_MAX_RESULT_STRING_SIZE];
            pfnResultToStringDirect(XR_NULL_HANDLE, createRes, buf);
            ALOGE("xrCreateInstance failed: %d (%s)", createRes, buf);
        } else {
            ALOGE("xrCreateInstance failed: %d", createRes);
        }
        dlclose(loader);
        return;
    }
    ALOGI("OpenXR instance created");

    PFN_xrPollEvent pfnPollEvent = nullptr;
    PFN_xrDestroyInstance pfnDestroyInstance = nullptr;
    PFN_xrResultToString pfnResultToString = nullptr;
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrPollEvent", &pfnPollEvent);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrDestroyInstance", &pfnDestroyInstance);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrResultToString", &pfnResultToString);

    PFN_xrGetSystem pfnGetSystem = nullptr;
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrGetSystem", &pfnGetSystem);
    PFN_xrGetOpenGLESGraphicsRequirementsKHR pfnGetGLESReq = nullptr;
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrGetOpenGLESGraphicsRequirementsKHR", &pfnGetGLESReq);

    XrSystemGetInfo systemInfo{XR_TYPE_SYSTEM_GET_INFO};
    systemInfo.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
    XrSystemId systemId = XR_NULL_SYSTEM_ID;
    if (XR_FAILED(pfnGetSystem(instance, &systemInfo, &systemId))) {
        ALOGE("xrGetSystem failed");
        pfnDestroyInstance(instance);
        dlclose(loader);
        return;
    }
    ALOGI("System acquired: %lld", (long long)systemId);

    if (pfnGetGLESReq) {
        XrGraphicsRequirementsOpenGLESKHR glesReq{XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_ES_KHR};
        if (XR_FAILED(pfnGetGLESReq(instance, systemId, &glesReq))) {
            ALOGE("xrGetOpenGLESGraphicsRequirementsKHR failed");
            pfnDestroyInstance(instance);
            dlclose(loader);
            return;
        }
        ALOGI("OpenGL ES requirements: min=0x%lx max=0x%lx", (long)glesReq.minApiVersionSupported, (long)glesReq.maxApiVersionSupported);
    } else {
        ALOGE("xrGetOpenGLESGraphicsRequirementsKHR not available");
    }

    PFN_xrEnumerateViewConfigurationViews pfnEnumerateViewConfigurationViews = nullptr;
    PFN_xrEnumerateEnvironmentBlendModes pfnEnumerateEnvironmentBlendModes = nullptr;
    PFN_xrCreateSession pfnCreateSession = nullptr;
    PFN_xrDestroySession pfnDestroySession = nullptr;
    PFN_xrBeginSession pfnBeginSession = nullptr;
    PFN_xrEndSession pfnEndSession = nullptr;
    PFN_xrCreateSwapchain pfnCreateSwapchain = nullptr;
    PFN_xrDestroySwapchain pfnDestroySwapchain = nullptr;
    PFN_xrEnumerateSwapchainFormats pfnEnumerateSwapchainFormats = nullptr;
    PFN_xrEnumerateSwapchainImages pfnEnumerateSwapchainImages = nullptr;
    PFN_xrWaitFrame pfnWaitFrame = nullptr;
    PFN_xrBeginFrame pfnBeginFrame = nullptr;
    PFN_xrEndFrame pfnEndFrame = nullptr;
    PFN_xrLocateViews pfnLocateViews = nullptr;
    PFN_xrCreateReferenceSpace pfnCreateReferenceSpace = nullptr;
    PFN_xrDestroySpace pfnDestroySpace = nullptr;
    PFN_xrAcquireSwapchainImage pfnAcquire = nullptr;
    PFN_xrWaitSwapchainImage pfnWait = nullptr;
    PFN_xrReleaseSwapchainImage pfnRelease = nullptr;

    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEnumerateViewConfigurationViews", &pfnEnumerateViewConfigurationViews);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEnumerateEnvironmentBlendModes", &pfnEnumerateEnvironmentBlendModes);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrCreateSession", &pfnCreateSession);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrDestroySession", &pfnDestroySession);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrBeginSession", &pfnBeginSession);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEndSession", &pfnEndSession);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrCreateSwapchain", &pfnCreateSwapchain);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrDestroySwapchain", &pfnDestroySwapchain);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEnumerateSwapchainFormats", &pfnEnumerateSwapchainFormats);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEnumerateSwapchainImages", &pfnEnumerateSwapchainImages);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrWaitFrame", &pfnWaitFrame);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrBeginFrame", &pfnBeginFrame);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrEndFrame", &pfnEndFrame);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrLocateViews", &pfnLocateViews);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrCreateReferenceSpace", &pfnCreateReferenceSpace);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrDestroySpace", &pfnDestroySpace);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrAcquireSwapchainImage", &pfnAcquire);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrWaitSwapchainImage", &pfnWait);
    LoadFn(xrGetInstanceProcAddrDyn, instance, "xrReleaseSwapchainImage", &pfnRelease);

    if (g_handTracking.supported) {
        XrResult createFnRes = LoadFn(xrGetInstanceProcAddrDyn, instance, "xrCreateHandTrackerEXT", &g_handTracking.createTracker);
        XrResult destroyFnRes = LoadFn(xrGetInstanceProcAddrDyn, instance, "xrDestroyHandTrackerEXT", &g_handTracking.destroyTracker);
        XrResult locateFnRes = LoadFn(xrGetInstanceProcAddrDyn, instance, "xrLocateHandJointsEXT", &g_handTracking.locateJoints);
        if (XR_FAILED(createFnRes) || XR_FAILED(destroyFnRes) || XR_FAILED(locateFnRes) ||
            g_handTracking.createTracker == nullptr ||
            g_handTracking.destroyTracker == nullptr ||
            g_handTracking.locateJoints == nullptr) {
            ALOGW("Hand tracking functions unavailable; disabling hand tracking support");
            g_handTracking.supported = false;
            g_handTracking.aimSupported = false;
            g_handTracking.createTracker = nullptr;
            g_handTracking.destroyTracker = nullptr;
            g_handTracking.locateJoints = nullptr;
        } else {
            ALOGI("Hand tracking extension ready%s",
                  g_handTracking.aimSupported ? " with aim support" : "");
        }
    }

    auto logXrError = [&](const char* label, XrResult result) {
        if (pfnResultToString) {
            char buf[XR_MAX_RESULT_STRING_SIZE];
            pfnResultToString(instance, result, buf);
            ALOGE("%s failed: %d (%s)", label, result, buf);
        } else {
            ALOGE("%s failed: %d", label, result);
        }
    };

    XrEnvironmentBlendMode environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    if (pfnEnumerateEnvironmentBlendModes) {
        uint32_t blendCount = 0;
        if (XR_SUCCEEDED(pfnEnumerateEnvironmentBlendModes(
                instance,
                systemId,
                XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
                0,
                &blendCount,
                nullptr)) && blendCount > 0) {
            std::vector<XrEnvironmentBlendMode> blendModes(blendCount);
            if (XR_SUCCEEDED(pfnEnumerateEnvironmentBlendModes(
                    instance,
                    systemId,
                    XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
                    blendCount,
                    &blendCount,
                    blendModes.data()))) {
                environmentBlendMode = blendModes[0];
            }
        }
    }
    ALOGI("Using environment blend mode %d", environmentBlendMode);


    XrGraphicsBindingOpenGLESAndroidKHR graphicsBinding{XR_TYPE_GRAPHICS_BINDING_OPENGL_ES_ANDROID_KHR};
    graphicsBinding.display = dpy;
    graphicsBinding.config = cfg;
    graphicsBinding.context = ctx;

    XrSessionCreateInfo sessionInfo{XR_TYPE_SESSION_CREATE_INFO};
    sessionInfo.next = &graphicsBinding;
    sessionInfo.systemId = systemId;
    XrSession session = XR_NULL_HANDLE;
    XrResult res = pfnCreateSession(instance, &sessionInfo, &session);
    if (XR_FAILED(res)) {
        if (pfnResultToString) {
            char buf[XR_MAX_RESULT_STRING_SIZE];
            pfnResultToString(instance, res, buf);
            ALOGE("xrCreateSession failed: %d (%s)", res, buf);
        } else {
            ALOGE("xrCreateSession failed");
        }
        pfnDestroyInstance(instance);
        dlclose(loader);
        return;
    }
    ALOGI("Session created");

    int64_t colorSwapchainFormat = GL_SRGB8_ALPHA8;
    if (pfnEnumerateSwapchainFormats) {
        uint32_t formatCount = 0;
        if (XR_SUCCEEDED(pfnEnumerateSwapchainFormats(session, 0, &formatCount, nullptr)) && formatCount > 0) {
            std::vector<int64_t> formats(formatCount);
            if (XR_SUCCEEDED(pfnEnumerateSwapchainFormats(session, formatCount, &formatCount, formats.data()))) {
                for (int64_t fmt : formats) {
                    XR_TRACE_I("Swapchain format candidate 0x%llx", (long long)fmt);
                }
                const int64_t preferredFormats[] = {GL_SRGB8_ALPHA8, GL_RGBA8, GL_RGBA16F, GL_RGB10_A2};
                bool matched = false;
                for (int64_t candidate : preferredFormats) {
                    if (std::find(formats.begin(), formats.end(), candidate) != formats.end()) {
                        colorSwapchainFormat = candidate;
                        matched = true;
                        break;
                    }
                }
                if (!matched && !formats.empty()) {
                    colorSwapchainFormat = formats[0];
                }
            }
        } else {
            ALOGW("Swapchain format enumeration returned 0 entries");
        }
    } else {
        ALOGW("xrEnumerateSwapchainFormats unavailable; using default format");
    }
    XR_TRACE_I("Using swapchain format 0x%llx", (long long)colorSwapchainFormat);

    uint32_t viewCount = 0;
    pfnEnumerateViewConfigurationViews(instance, systemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, 0, &viewCount, nullptr);
    std::vector<XrViewConfigurationView> viewConfigs(viewCount, {XR_TYPE_VIEW_CONFIGURATION_VIEW});
    pfnEnumerateViewConfigurationViews(instance, systemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, viewCount, &viewCount, viewConfigs.data());

    std::vector<Swapchain> swapchains(viewCount);
    for (uint32_t i = 0; i < viewCount; ++i) {
        XrSwapchainCreateInfo sci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        sci.arraySize = 1;
        sci.faceCount = 1;
        sci.mipCount = 1;
        sci.sampleCount = viewConfigs[i].recommendedSwapchainSampleCount;
        sci.width = viewConfigs[i].recommendedImageRectWidth;
        sci.height = viewConfigs[i].recommendedImageRectHeight;
        sci.format = colorSwapchainFormat;
        sci.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
        Swapchain& sc = swapchains[i];
        if (XR_FAILED(pfnCreateSwapchain(session, &sci, &sc.handle))) {
            ALOGE("xrCreateSwapchain failed for view %u (format 0x%llx)", i, (long long)colorSwapchainFormat);
            continue;
        }
        sc.width = sci.width;
        sc.height = sci.height;
        uint32_t imageCount = 0;
        XrResult imageCountRes = pfnEnumerateSwapchainImages(sc.handle, 0, &imageCount, nullptr);
        if (XR_FAILED(imageCountRes) || imageCount == 0) {
            logXrError("xrEnumerateSwapchainImages (count)", imageCountRes);
            pfnDestroySwapchain(sc.handle);
            sc.handle = XR_NULL_HANDLE;
            continue;
        }
        sc.images.resize(imageCount, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR});
        XrResult enumImagesRes = pfnEnumerateSwapchainImages(sc.handle, imageCount, &imageCount, reinterpret_cast<XrSwapchainImageBaseHeader*>(sc.images.data()));
        if (XR_FAILED(enumImagesRes)) {
            logXrError("xrEnumerateSwapchainImages", enumImagesRes);
            pfnDestroySwapchain(sc.handle);
            sc.handle = XR_NULL_HANDLE;
            continue;
        }
    }

    XrReferenceSpaceCreateInfo spaceInfo{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    spaceInfo.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
    spaceInfo.poseInReferenceSpace = {{0, 0, 0, 1}, {0, 0, 0}};
    XrSpace appSpace = XR_NULL_HANDLE;
    XrResult spaceResult = pfnCreateReferenceSpace(session, &spaceInfo, &appSpace);
    if (XR_FAILED(spaceResult)) {
        logXrError("xrCreateReferenceSpace", spaceResult);
        if (g_deviceClient) {
            std::string deviceId = g_deviceClient->getDeviceIdentifier();
            g_deviceClient->stop();
            UpdateJavaBackendStatus(false, deviceId, "", false, "00:00", -1, g_deviceClient->getBatteryLevel(), g_deviceClient->isBatteryCharging());
            g_deviceClient.reset();
        }

        pfnDestroySession(session);
        pfnDestroyInstance(instance);
        dlclose(loader);
        eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        eglDestroySurface(dpy, surf);
        eglDestroyContext(dpy, ctx);
        eglTerminate(dpy);
        return;
    }
    XrViewLocateInfo locateInfo{XR_TYPE_VIEW_LOCATE_INFO};
    locateInfo.viewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
    locateInfo.space = appSpace;

    std::vector<XrView> views(viewCount, {XR_TYPE_VIEW});
    XrViewState viewState{XR_TYPE_VIEW_STATE};
    XrFrameState frameState{XR_TYPE_FRAME_STATE};

    JNIEnv* env = nullptr;
    app->activity->vm->AttachCurrentThread(&env, nullptr);
    VideoResources videoRes{};
    g_videoRes = &videoRes;
    
    // Assign OpenXR function pointers to VideoResources
    videoRes.pfnCreateSwapchain = pfnCreateSwapchain;
    videoRes.pfnDestroySwapchain = pfnDestroySwapchain;
    videoRes.pfnEnumerateSwapchainImages = pfnEnumerateSwapchainImages;
    videoRes.pfnAcquireSwapchainImage = pfnAcquire;
    videoRes.pfnWaitSwapchainImage = pfnWait;
    videoRes.pfnReleaseSwapchainImage = pfnRelease;
    videoRes.pfnCreateReferenceSpace = pfnCreateReferenceSpace;
    videoRes.pfnDestroySpace = pfnDestroySpace;
    
    bool videoReady = false;
    if (kEnableVideoPipeline) {
        JNIEnv* env = nullptr;
        JavaVMAttachArgs args = {JNI_VERSION_1_6, "InitThread", nullptr};
        if (g_jvm && g_jvm->AttachCurrentThread(&env, &args) == JNI_OK) {
            videoReady = InitVideoPipeline(env, app->activity, videoRes);
            g_jvm->DetachCurrentThread();
        } else {
            ALOGW("Failed to attach thread for video pipeline initialization");
        }
    }
    
    // Initialize UI panel
    if (!InitUIPanel(videoRes, instance, session, appSpace, app)) {
        ALOGW("Failed to initialize UI panel");
    }
    if (!InitDebugOverlay(videoRes)) {
        ALOGE("Failed to initialize debug overlay");
    }
    if (!videoRes.stubReady) {
        if (InitStubPattern(videoRes)) {
            XR_TRACE_I("Stub pattern renderer ready");
        } else {
            ALOGW("Stub pattern renderer unavailable");
        }
    }
    DebugSceneResources debugScene{};
    bool debugSceneReady = InitDebugScene(debugScene);
    XR_TRACE_I("Debug scene init %s (vao=%u vbo=%u fbo=%u)",
          debugSceneReady ? "OK" : "FAILED",
          static_cast<unsigned int>(debugScene.vao),
          static_cast<unsigned int>(debugScene.vbo),
          static_cast<unsigned int>(debugScene.fbo));
    if (!debugSceneReady) {
        ALOGW("Failed to initialize troubleshooting debug scene");
    }

    InitializeHandTrackingForSession(session);

    XrSessionState sessionState = XR_SESSION_STATE_UNKNOWN;
    bool sessionRunning = false;
    bool exitRequested = false;
#if XR_TRACE_LOGGING
    bool loggedFirstFrame = false;
    bool loggedWaitFrame = false;
    bool loggedSkipShouldRender = false;
    bool loggedNoViews = false;
    bool loggedNullSwapchain = false;
    bool loggedNoRenderLayer = false;
    bool loggedEndFrame = false;
#endif

    auto pumpEvents = [&](bool& exitFlag) {
        XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};
        while (pfnPollEvent(instance, &event) == XR_SUCCESS) {
            if (event.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) {
                auto* state = reinterpret_cast<XrEventDataSessionStateChanged*>(&event);
                sessionState = state->state;
                XR_TRACE_I("Session state: %d", sessionState);
                if (sessionState == XR_SESSION_STATE_READY && !sessionRunning) {
                    XrSessionBeginInfo beginInfo{XR_TYPE_SESSION_BEGIN_INFO};
                    beginInfo.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
                    XrResult beginRes = pfnBeginSession(session, &beginInfo);
                    if (XR_SUCCEEDED(beginRes)) {
                        sessionRunning = true;
                        XR_TRACE_I("Session begun");
                    } else if (pfnResultToString) {
                        char buf[XR_MAX_RESULT_STRING_SIZE];
                        pfnResultToString(instance, beginRes, buf);
                        ALOGE("xrBeginSession failed: %d (%s)", beginRes, buf);
                    } else {
                        ALOGE("xrBeginSession failed: %d", beginRes);
                    }
                } else if (sessionState == XR_SESSION_STATE_STOPPING && sessionRunning) {
                    pfnEndSession(session);
                    sessionRunning = false;
                } else if (sessionState == XR_SESSION_STATE_EXITING || sessionState == XR_SESSION_STATE_LOSS_PENDING) {
                    exitFlag = true;
                }
            }
            event = {XR_TYPE_EVENT_DATA_BUFFER};
        }
    };

    while (!exitRequested) {
        pumpEvents(exitRequested);
        if (exitRequested) {
            break;
        }

        int events = 0;
        struct android_poll_source* source = nullptr;
        while (true) {
            int timeout = 0;
            int ident = ALooper_pollAll(timeout, nullptr, &events, reinterpret_cast<void**>(&source));
            if (ident < 0) {
                break;
            }
            if (source) {
                source->process(app, source);
            }
            pumpEvents(exitRequested);
            if (exitRequested) {
                break;
            }
            if (app->destroyRequested) {
                ALOGI("Destroy requested by Android");
                exitRequested = true;
                break;
            }
        }

        if (exitRequested) {
            break;
        }

        if (!sessionRunning) {
            usleep(1000);
            continue;
        }

        XrFrameWaitInfo waitInfo{XR_TYPE_FRAME_WAIT_INFO};
        XrResult waitResult = pfnWaitFrame(session, &waitInfo, &frameState);
        if (XR_FAILED(waitResult)) {
            logXrError("xrWaitFrame", waitResult);
            continue;
        }
#if XR_TRACE_LOGGING
        if (!loggedWaitFrame) {
            XR_TRACE_I("WaitFrame -> shouldRender=%d", frameState.shouldRender ? 1 : 0);
            loggedWaitFrame = true;
        }
#endif

        XrFrameBeginInfo beginInfo{XR_TYPE_FRAME_BEGIN_INFO};
        XrResult beginResult = pfnBeginFrame(session, &beginInfo);
        if (XR_FAILED(beginResult)) {
            logXrError("xrBeginFrame", beginResult);
            continue;
        }

        if (!frameState.shouldRender) {
#if XR_TRACE_LOGGING
            if (!loggedSkipShouldRender) {
                XR_TRACE_I("Skipping frame: shouldRender=0");
                loggedSkipShouldRender = true;
            }
#endif
            XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
            fei.displayTime = frameState.predictedDisplayTime;
            fei.environmentBlendMode = environmentBlendMode;
            fei.layerCount = 0;
            fei.layers = nullptr;
            pfnEndFrame(session, &fei);
            continue;
        }

        locateInfo.displayTime = frameState.predictedDisplayTime;
        uint32_t viewCountOutput = 0;
        XrResult locateResult = pfnLocateViews(session, &locateInfo, &viewState, viewCount, &viewCountOutput, views.data());
        if (XR_FAILED(locateResult) || viewCountOutput == 0) {
            if (XR_FAILED(locateResult)) {
                logXrError("xrLocateViews", locateResult);
            }
#if XR_TRACE_LOGGING
            if (XR_SUCCEEDED(locateResult) && viewCountOutput == 0 && !loggedNoViews) {
                XR_TRACE_W("xrLocateViews returned zero views");
                loggedNoViews = true;
            }
#endif
            XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
            fei.displayTime = frameState.predictedDisplayTime;
            fei.environmentBlendMode = environmentBlendMode;
            fei.layerCount = 0;
            fei.layers = nullptr;
            pfnEndFrame(session, &fei);
            continue;
        }

        bool orientationValid = (viewState.viewStateFlags & XR_VIEW_STATE_ORIENTATION_VALID_BIT) != 0;
        bool positionValid = (viewState.viewStateFlags & XR_VIEW_STATE_POSITION_VALID_BIT) != 0;
        if (!orientationValid) {
            ALOGW("View orientation invalid; using identity orientation");
        }
        if (!positionValid) {
            ALOGW("View position invalid; using zero translation");
        }

        UpdateHandTracking(appSpace, frameState.predictedDisplayTime);

        if (kEnableVideoPipeline && videoReady) {
            JNIEnv* env = nullptr;
            JavaVMAttachArgs args = {JNI_VERSION_1_6, "RenderThread", nullptr};
            if (g_jvm && g_jvm->AttachCurrentThread(&env, &args) == JNI_OK) {
                UpdateVideoTexture(env, videoRes);
                g_jvm->DetachCurrentThread();
            } else {
                ALOGW("Failed to attach thread for video texture update");
            }
        }

        std::vector<XrCompositionLayerProjectionView> projViews;
        projViews.reserve(viewCountOutput);

        for (uint32_t i = 0; i < viewCountOutput; ++i) {
            Swapchain& sc = swapchains[i];
#if XR_TRACE_LOGGING
            if (sc.handle == XR_NULL_HANDLE) {
                if (!loggedNullSwapchain) {
                    XR_TRACE_W("Swapchain handle null for view %u", i);
                    loggedNullSwapchain = true;
                }
                continue;
            }
#else
            if (sc.handle == XR_NULL_HANDLE) {
                continue;
            }
#endif

            XrSwapchainImageAcquireInfo acquireInfo{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
            uint32_t imageIdx = 0;
            XrResult acquireResult = pfnAcquire(sc.handle, &acquireInfo, &imageIdx);
            if (XR_FAILED(acquireResult)) {
                logXrError("xrAcquireSwapchainImage", acquireResult);
                continue;
            }

            XrSwapchainImageWaitInfo waitSwapInfo{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
            waitSwapInfo.timeout = XR_INFINITE_DURATION;
            XrResult waitSwapResult = pfnWait(sc.handle, &waitSwapInfo);
            if (XR_FAILED(waitSwapResult)) {
                logXrError("xrWaitSwapchainImage", waitSwapResult);
                XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
                pfnRelease(sc.handle, &releaseInfo);
                continue;
            }

            Matrix4x4 proj = ProjectionFromFov(views[i].fov, 0.05f, 100.0f);
            XrPosef pose = views[i].pose;
            if (!orientationValid) {
                pose.orientation = {0.0f, 0.0f, 0.0f, 1.0f};
            }
            if (!positionValid) {
                pose.position = {0.0f, 0.0f, 0.0f};
            }
            Matrix4x4 view = ViewFromPose(pose);
            Matrix4x4 viewProj = Multiply(proj, view);

            GLuint colorTex = sc.images[imageIdx].image;
            bool rendered = false;
            if (kEnableVideoPipeline && videoReady) {
                RenderEye(videoRes, viewProj, sc.width, sc.height, colorTex);
                rendered = true;
            }
            if (!rendered) {
                // Clear to black if no video is available
                glBindFramebuffer(GL_FRAMEBUFFER, colorTex);
                glViewport(0, 0, sc.width, sc.height);
                glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
                glClear(GL_COLOR_BUFFER_BIT);
                rendered = true;
            }

            if (!rendered) {
                XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
                XrResult releaseResult = pfnRelease(sc.handle, &releaseInfo);
                if (XR_FAILED(releaseResult)) {
                    logXrError("xrReleaseSwapchainImage", releaseResult);
                }
#if XR_TRACE_LOGGING
                if (!loggedNoRenderLayer) {
                    XR_TRACE_W("No renderer produced output for view %u", i);
                    loggedNoRenderLayer = true;
                }
#endif
                continue;
            }

#if XR_TRACE_LOGGING
            if (!loggedFirstFrame) {
                XR_TRACE_I("First XR frame content prepared (view=%u, debug=%d, stub=%d, video=%d)",
                      i, debugSceneReady ? 1 : 0, videoRes.stubReady ? 1 : 0, videoReady ? 1 : 0);
                loggedFirstFrame = true;
            }
#endif

            XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
            XrResult releaseResult = pfnRelease(sc.handle, &releaseInfo);
            if (XR_FAILED(releaseResult)) {
                logXrError("xrReleaseSwapchainImage", releaseResult);
            }

            XrCompositionLayerProjectionView projView{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW};
            projView.pose = pose;
            projView.fov = views[i].fov;
            projView.subImage.swapchain = sc.handle;
            projView.subImage.imageRect.offset = {0, 0};
            projView.subImage.imageRect.extent = {sc.width, sc.height};
            projViews.push_back(projView);
        }

        if (projViews.empty()) {
            XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
            fei.displayTime = frameState.predictedDisplayTime;
            fei.environmentBlendMode = environmentBlendMode;
            fei.layerCount = 0;
            fei.layers = nullptr;
            pfnEndFrame(session, &fei);
            continue;
        }

        // UI stats are supplied from Java (see OpenXrNativeActivity); skip synthetic updates here.
        // Render UI panel and get layer
        XrCompositionLayerQuad* uiLayer = RenderUIPanelPass(videoRes, session);
        XrCompositionLayerQuad* overheadLayer = RenderOverheadPanelPass(videoRes, session);
        
        XrCompositionLayerProjection layer{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
        layer.space = appSpace;
        layer.viewCount = static_cast<uint32_t>(projViews.size());
        layer.views = projViews.data();
        
        // Create layer vector
        std::vector<const XrCompositionLayerBaseHeader*> layers;
        layers.push_back(reinterpret_cast<const XrCompositionLayerBaseHeader*>(&layer));
        
        // Add UI layers if available
        if (uiLayer) {
            layers.push_back(reinterpret_cast<const XrCompositionLayerBaseHeader*>(uiLayer));
        }
        if (overheadLayer) {
            layers.push_back(reinterpret_cast<const XrCompositionLayerBaseHeader*>(overheadLayer));
        }

        XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
        fei.displayTime = frameState.predictedDisplayTime;
        fei.environmentBlendMode = environmentBlendMode;
        fei.layerCount = static_cast<uint32_t>(layers.size());
        fei.layers = layers.data();
        XrResult endResult = pfnEndFrame(session, &fei);
        if (XR_FAILED(endResult)) {
            logXrError("xrEndFrame", endResult);
        }
#if XR_TRACE_LOGGING
        if (XR_SUCCEEDED(endResult) && !loggedEndFrame) {
            XR_TRACE_I("Submitted XR frame with %zu views", projViews.size());
            loggedEndFrame = true;
        }
#endif
    }

    if (kEnableVideoPipeline) {
        ReleaseVideoPipeline(env, videoRes);
    }
    if (videoRes.overheadSwapchain != XR_NULL_HANDLE) {
        videoRes.pfnDestroySwapchain(videoRes.overheadSwapchain);
        videoRes.overheadSwapchain = XR_NULL_HANDLE;
    }
    if (videoRes.uiSwapchain != XR_NULL_HANDLE) {
        videoRes.pfnDestroySwapchain(videoRes.uiSwapchain);
        videoRes.uiSwapchain = XR_NULL_HANDLE;
    }
    if (videoRes.overheadSpace != XR_NULL_HANDLE) {
        videoRes.pfnDestroySpace(videoRes.overheadSpace);
        videoRes.overheadSpace = XR_NULL_HANDLE;
    }
    if (videoRes.uiSpace != XR_NULL_HANDLE) {
        videoRes.pfnDestroySpace(videoRes.uiSpace);
        videoRes.uiSpace = XR_NULL_HANDLE;
    }
    g_videoRes = nullptr;

    DestroyDebugScene(debugScene);
    app->activity->vm->DetachCurrentThread();

    ShutdownHandTracking();

    if (sessionRunning) {
        pfnEndSession(session);
        sessionRunning = false;
    }
    pfnDestroySpace(appSpace);
    for (auto& sc : swapchains) {
        if (sc.handle != XR_NULL_HANDLE) {
            pfnDestroySwapchain(sc.handle);
        }
    }
    pfnDestroySession(session);
    pfnDestroyInstance(instance);
    dlclose(loader);

    eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroySurface(dpy, surf);
    eglDestroyContext(dpy, ctx);
    eglTerminate(dpy);
}

// VRUIManager JNI methods
extern "C" {

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeUpdateBackendBattery(JNIEnv*, jclass, jint level, jboolean charging) {
        if (!g_deviceClient) {
            return;
        }
        g_deviceClient->updateBatteryStatus(static_cast<int>(level), charging == JNI_TRUE);
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeReportWifiChannel(JNIEnv*, jclass, jint channel) {
        if (!g_deviceClient) {
            return;
        }
        g_deviceClient->reportLocalWifiChannel(static_cast<int>(channel));
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeSetDisplaySurfaceMode(JNIEnv*, jclass, jint mode) {
        if (!g_videoRes) {
            return;
        }
        g_videoRes->usePlane = (mode == 0);
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeSetQualityTier(JNIEnv*, jclass, jint tier) {
        if (!g_videoRes) {
            return;
        }
        int clamped = tier;
        if (clamped < 0) clamped = 0;
        if (clamped > 2) clamped = 2;
        g_videoRes->qualityTier = clamped;
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeSetEnhancementParameters(JNIEnv*, jclass, jint mode, jfloat strength) {
        if (!g_videoRes) {
            return;
        }
        g_videoRes->enhancementMode = mode;
        float clamped = strength;
        if (clamped < 0.0f) clamped = 0.0f;
        if (clamped > 1.0f) clamped = 1.0f;
        g_videoRes->enhancementStrength = clamped;
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_OpenXrNativeActivity_nativeUpdateTexelScale(JNIEnv*, jclass, jfloat texelWidth, jfloat texelHeight) {
        if (!g_videoRes) {
            return;
        }
        if (texelWidth > 0.0f) {
            g_videoRes->texelWidth = texelWidth;
        }
        if (texelHeight > 0.0f) {
            g_videoRes->texelHeight = texelHeight;
        }
    }

    static std::string g_wifiChannel = "Unknown";
    static std::string g_fps = "0";
    static std::string g_resolution = "0x0";
    static std::string g_signalStrength = "Unknown";

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_vr_ui_VRUIManager_nativeSetOverheadPanelVisible(JNIEnv*, jclass, jboolean visible) {
        bool isVisible = (visible == JNI_TRUE);
        if (g_videoRes) {
            g_videoRes->overheadVisible = isVisible;
            ALOGI("Overhead panel visibility set to %s", isVisible ? "true" : "false");
        } else {
            ALOGW("nativeSetOverheadPanelVisible called before VideoResources initialized");
        }
    }

    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_vr_ui_VRUIManager_nativeUpdateUI(JNIEnv* env, jclass clazz,
                                                                 jstring wifiChannel, jstring fps, 
                                                                 jstring resolution, jstring signalStrength) {
        ALOGI("VRUIManager nativeUpdateUI called");
        
        const char* wifiChannelStr = env->GetStringUTFChars(wifiChannel, nullptr);
        const char* fpsStr = env->GetStringUTFChars(fps, nullptr);
        const char* resolutionStr = env->GetStringUTFChars(resolution, nullptr);
        const char* signalStrengthStr = env->GetStringUTFChars(signalStrength, nullptr);
        
        // Store the UI status information for logging
        g_wifiChannel = wifiChannelStr ? wifiChannelStr : "Unknown";
        g_fps = fpsStr ? fpsStr : "0";
        g_resolution = resolutionStr ? resolutionStr : "0x0";
        g_signalStrength = signalStrengthStr ? signalStrengthStr : "Unknown";
        
        ALOGI("VR UI Updated - Channel: %s, FPS: %s, Resolution: %s, Signal: %s", 
              g_wifiChannel.c_str(), g_fps.c_str(), g_resolution.c_str(), g_signalStrength.c_str());
        
        // Note: The actual UI rendering is now handled by the Java VRUIManager
        // This method is called for logging and compatibility purposes
        // The Java side will handle the text rendering via VRTextRenderer
        
        if (wifiChannelStr) env->ReleaseStringUTFChars(wifiChannel, wifiChannelStr);
        if (fpsStr) env->ReleaseStringUTFChars(fps, fpsStr);
        if (resolutionStr) env->ReleaseStringUTFChars(resolution, resolutionStr);
        if (signalStrengthStr) env->ReleaseStringUTFChars(signalStrength, signalStrengthStr);
    }
    
    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_vr_ui_VRUIManager_nativeUpdateUIPanelStats(JNIEnv* env, jclass clazz,
                                                                           jfloat wifiChannel, jfloat fps, 
                                                                           jfloat resolution, jfloat signalStrength) {
        ALOGI("VRUIManager nativeUpdateUIPanelStats called");
        
        // Convert floats to strings for Java UI
        char wifiChannelStr[32];
        char fpsStr[32];
        char resolutionStr[32];
        char signalStrengthStr[32];
        
        snprintf(wifiChannelStr, sizeof(wifiChannelStr), "%.1f", wifiChannel);
        snprintf(fpsStr, sizeof(fpsStr), "%.1f", fps);
        snprintf(resolutionStr, sizeof(resolutionStr), "%.0f", resolution);
        snprintf(signalStrengthStr, sizeof(signalStrengthStr), "%.0f%%", signalStrength);
        
        // Call Java updateStats method
        jclass uiManagerClass = env->FindClass("com/openipc/pixelpilot/vr/ui/VRUIManager");
        if (uiManagerClass) {
            jmethodID updateStatsMethod = env->GetStaticMethodID(uiManagerClass, "updateStats", 
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
            if (updateStatsMethod) {
                jstring jWifiChannel = env->NewStringUTF(wifiChannelStr);
                jstring jFps = env->NewStringUTF(fpsStr);
                jstring jResolution = env->NewStringUTF(resolutionStr);
                jstring jSignalStrength = env->NewStringUTF(signalStrengthStr);
                
                env->CallStaticVoidMethod(uiManagerClass, updateStatsMethod, 
                    jWifiChannel, jFps, jResolution, jSignalStrength);
                
                env->DeleteLocalRef(jWifiChannel);
                env->DeleteLocalRef(jFps);
                env->DeleteLocalRef(jResolution);
                env->DeleteLocalRef(jSignalStrength);
                
                ALOGI("Successfully called VRUIManager.updateStats");
            } else {
                ALOGE("Failed to find updateStats method");
            }
            env->DeleteLocalRef(uiManagerClass);
        } else {
            ALOGE("Failed to find VRUIManager class");
        }
        
        ALOGI("UI Panel Stats - Channel: %.1f, FPS: %.1f, Resolution: %.1f, Signal: %.1f", 
              wifiChannel, fps, resolution, signalStrength);
    }
    
    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_vr_ui_VRUIManager_nativeInitializeUI(JNIEnv* env, jclass clazz) {
        ALOGI("VRUIManager nativeInitializeUI called");
        
        // Initialize global video resources pointer
        // This would typically be set during the main initialization
        ALOGI("VR UI initialized successfully");
    }
    
    JNIEXPORT void JNICALL
    Java_com_openipc_pixelpilot_vr_ui_VRUIManager_nativeDisposeUI(JNIEnv* env, jclass clazz) {
        ALOGI("VRUIManager nativeDisposeUI called");
        
        // Clean up UI resources
        g_videoRes = nullptr;
        g_wifiChannel = "Unknown";
        g_fps = "0";
        g_resolution = "0x0";
        g_signalStrength = "Unknown";
        
        ALOGI("VR UI disposed successfully");
    }
    
} // extern "C"
