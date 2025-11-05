package com.openipc.videonative;

public final class VideoPlayerHolder {
    private static volatile VideoPlayer instance;

    private VideoPlayerHolder() {}

    public static synchronized void setInstance(VideoPlayer vp) {
        instance = vp;
    }

    public static synchronized VideoPlayer getInstance() {
        return instance;
    }
}

