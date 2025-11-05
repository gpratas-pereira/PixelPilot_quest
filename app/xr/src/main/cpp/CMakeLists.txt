cmake_minimum_required(VERSION 3.10)
project(openxr_app)

add_library(${CMAKE_PROJECT_NAME} SHARED
    openxr_app.cpp
    deviceclient/DeviceClient.cpp
)

set(NATIVE_APP_GLUE_DIR "${CMAKE_ANDROID_NDK}/sources/android/native_app_glue")
include_directories(${NATIVE_APP_GLUE_DIR})
# OpenXR headers (vendored at repo root).
# Prefer external/OpenXR-SDK/include which contains openxr_platform_defines.h
include_directories(${CMAKE_SOURCE_DIR}/../../../../../external/OpenXR-SDK/include)
# Fallback: headers repo (if present)
include_directories(${CMAKE_SOURCE_DIR}/../../../../../external/OpenXR-Headers/include)
add_library(native_app_glue STATIC ${NATIVE_APP_GLUE_DIR}/android_native_app_glue.c)

target_link_libraries(${CMAKE_PROJECT_NAME}
    native_app_glue
    android
    log
    EGL
    GLESv3
    dl)

target_link_options(${CMAKE_PROJECT_NAME} PRIVATE -u ANativeActivity_onCreate)
set_property(TARGET ${CMAKE_PROJECT_NAME} PROPERTY CXX_STANDARD 17)
