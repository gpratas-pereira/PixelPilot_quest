package com.openipc.pixelpilot.vr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.os.Bundle
import android.util.Log
import android.view.Surface
import com.openipc.pixelpilot.WfbLinkManager
import com.openipc.videonative.DecodingInfo
import com.openipc.videonative.IVideoParamsChanged
import com.openipc.videonative.VideoPlayer
import com.openipc.wfbngrtl8812.WfbNGStats
import com.openipc.wfbngrtl8812.WfbNGStatsChanged
import com.openipc.wfbngrtl8812.WfbNgLink
import org.rajawali3d.lights.DirectionalLight
import org.rajawali3d.materials.Material
import org.rajawali3d.materials.textures.ATexture
import org.rajawali3d.materials.textures.StreamingTexture
import org.rajawali3d.materials.textures.Texture
import org.rajawali3d.math.Matrix4
import org.rajawali3d.math.vector.Vector3
import org.rajawali3d.primitives.Plane
import org.rajawali3d.primitives.Sphere
import org.rajawali3d.vr.VRActivity
import org.rajawali3d.vr.renderer.VRRenderer

class VRMainActivity : VRActivity(), IVideoParamsChanged, WfbNGStatsChanged {
    private lateinit var vrRenderer: PixelPilotVRRenderer
    private var videoPlayer: VideoPlayer? = null
    private var wfbLinkManager: WfbLinkManager? = null
    private var wfbNgLink: WfbNgLink? = null

    companion object {
        private const val TAG = "PixelPilotVR"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "VR Activity Created")

        vrRenderer = PixelPilotVRRenderer(this)
        setRenderer(vrRenderer)

        vrRenderer.setOnSurfaceReadyListener { surface ->
            initializeVideoAndWfb(surface)
        }
    }

    private fun initializeVideoAndWfb(videoSurface: Surface) {
        videoPlayer = VideoPlayer(this).apply {
            addSurface(videoSurface, false)
            start()
        }

        wfbNgLink = WfbNgLink(this).apply {
            setStatsChanged(this@VRMainActivity)
        }
        wfbLinkManager = WfbLinkManager(this, wfbNgLink).apply {
            refreshKey()
            refreshAdapters()
            startAdapters()
        }
        Log.d(TAG, "Video and WFB Initialized")
    }

    override fun onVideoParamsChanged(info: DecodingInfo) {
        Log.d(TAG, "Video params changed: ${info.width}x${info.height}")
    }

    override fun onNewWfbNGStats(stats: WfbNGStats) {
        vrRenderer.updateTelemetry(stats)
    }

    override fun onResume() {
        super.onResume()
        wfbLinkManager?.startAdapters()
        videoPlayer?.start()
    }

    override fun onPause() {
        super.onPause()
        wfbLinkManager?.stopAdapters()
        videoPlayer?.stop()
    }

    override fun onDestroy() {
        super.onDestroy()
        videoPlayer?.stop()
        wfbNgLink?.stop()
        wfbLinkManager?.stopAdapters()
    }
}

class PixelPilotVRRenderer(context: Context) : VRRenderer(context) {
    private lateinit var videoSphere: Sphere
    private lateinit var telemetryPanel: Plane
    private lateinit var videoTexture: StreamingTexture
    private lateinit var telemetryTexture: Texture
    private var videoSurfaceTexture: SurfaceTexture? = null

    private var onSurfaceReadyListener: ((Surface) -> Unit)? = null
    private val inputHandler = VRInputHandler()
    private var currentTelemetry: WfbNGStats? = null

    fun setOnSurfaceReadyListener(listener: (Surface) -> Unit) {
        onSurfaceReadyListener = listener
    }

    override fun initScene() {
        val light = DirectionalLight(1.0, 0.2, -1.0)
        light.setColor(1.0f, 1.0f, 1.0f)
        light.setPower(2f)
        currentScene.addLight(light)

        createVideoSphere()
        createTelemetryPanel()

        currentCamera.setPosition(0.0, 0.0, 0.0)
        currentCamera.setLookAt(0.0, 0.0, -1.0)

        inputHandler.initialize(this)
    }

    private fun createVideoSphere() {
        videoSurfaceTexture = SurfaceTexture(0).apply {
            setDefaultBufferSize(1280, 720) // Default resolution
        }
        videoTexture = StreamingTexture("videoTexture", videoSurfaceTexture)

        videoSphere = Sphere(50f, 64, 32).apply {
            isDoubleSided = true
            material = Material().apply {
                addTexture(videoTexture)
                colorInfluence = 0f
            }
        }
        currentScene.addChild(videoSphere)

        val surface = Surface(videoSurfaceTexture)
        onSurfaceReadyListener?.invoke(surface)
    }

    private fun createTelemetryPanel() {
        telemetryPanel = Plane(1f, 0.5f, 1, 1).apply {
            material = Material().apply {
                telemetryTexture = Texture("telemetryTexture", createTelemetryBitmap())
                addTexture(telemetryTexture)
            }
            setPosition(0.0, -1.5, -4.0)
        }
        currentScene.addChild(telemetryPanel)
    }

    fun updateTelemetry(stats: WfbNGStats) {
        currentTelemetry = stats
        queueEvent {
            updateTelemetryTexture(stats)
        }
    }

    private fun updateTelemetryTexture(stats: WfbNGStats) {
        telemetryTexture.setBitmap(createTelemetryBitmap(stats))
        mTextureManager.replaceTexture(telemetryTexture)
    }

    override fun onRender(ellapsedRealtime: Long, deltaTime: Double) {
        super.onRender(ellapsedRealtime, deltaTime)
        videoSurfaceTexture?.updateTexImage()
        inputHandler.update(deltaTime)
    }

    private fun createTelemetryBitmap(stats: WfbNGStats? = null): Bitmap {
        val bitmap = Bitmap.createBitmap(512, 256, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        val paint = android.graphics.Paint().apply {
            color = android.graphics.Color.WHITE
            textSize = 24f
        }

        canvas.drawColor(android.graphics.Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)

        if (stats != null) {
            canvas.drawText("RSSI: ${stats.adapterRssiDBM} dBm", 20f, 40f, paint)
            canvas.drawText("CPU Load: ${stats.cpuload}%%", 20f, 80f, paint)
            canvas.drawText("Temp: ${stats.temp} C", 20f, 120f, paint)
            canvas.drawText("Good/Lost: ${stats.count_p_dec_ok}/${stats.count_p_lost}", 20f, 160f, paint)
        } else {
            canvas.drawText("Waiting for telemetry...", 20f, 40f, paint)
        }

        return bitmap
    }
}

class VRInputHandler {
    private var renderer: VRRenderer? = null

    companion object {
        private const val TAG = "VRInputHandler"
    }

    fun initialize(renderer: VRRenderer) {
        this.renderer = renderer
    }

    fun update(deltaTime: Double) {
        if (renderer == null) return
        // Placeholder for input handling logic
    }
}

object VRUtils {
    private const val TAG = "VRUtils"

    fun checkVRSupport(context: Context): Boolean {
        return try {
            val packageManager = context.packageManager
            packageManager.hasSystemFeature("android.hardware.vr.headtracking")
        } catch (e: Exception) {
            Log.e(TAG, "Error checking VR support", e)
            false
        }
    }
}