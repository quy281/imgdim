package com.img.dim;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.Config;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.UnavailableApkTooOldException;
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException;
import com.google.ar.core.exceptions.UnavailableSdkTooOldException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * AR room scan activity.
 * Auto-detects the largest horizontal floor plane each frame and extracts its boundary polygon.
 * The user can drag corner handles to refine the boundary.
 * Once satisfied, taps "Dùng mặt bằng này" → returns corners (metres) + ceiling height.
 */
public class ARRoomScanActivity extends AppCompatActivity implements GLSurfaceView.Renderer {

    private static final String TAG = "ARRoomScan";
    private static final int CAMERA_PERMISSION = 100;
    private static final float DRAG_THRESHOLD_PX = 60f;

    // ── AR session ──────────────────────────────────────────────────────────
    private Session arSession;
    private boolean sessionCreated = false;
    private boolean sessionPaused = true;
    private boolean cameraTextureSet = false;
    private boolean userRequestedInstall = true;

    // ── OpenGL ───────────────────────────────────────────────────────────────
    private GLSurfaceView glSurfaceView;
    private int bgProgram, bgPositionAttr, bgTexCoordAttr, bgTextureUniform;
    private int bgTextureId;
    private FloatBuffer bgPositions;
    private FloatBuffer bgTexInput;
    private FloatBuffer bgTexOutput;
    private boolean glReady = false;
    private int viewWidth, viewHeight;

    // ── Corner data (guarded by cornersLock) ────────────────────────────────
    private final Object cornersLock = new Object();
    private final List<float[]> corners = new ArrayList<>(); // {worldX, worldZ}
    private boolean userEdited = false; // once true, auto-update from ARCore stops

    // ── Projected screen positions (set on GL thread, read on UI thread) ────
    private volatile float[][] projectedCorners = null;

    // ── Drag state (written from UI touch thread, read on GL thread) ────────
    private volatile int activeDragIndex = -1;
    private volatile boolean hasPendingDrag = false;
    private volatile float pendingDragX, pendingDragY;

    // ── UI ───────────────────────────────────────────────────────────────────
    private CornerOverlayView overlayView;
    private TextView statusText;
    private TextView cornerCountText;
    private Button doneBtn;

    // ── Shaders ──────────────────────────────────────────────────────────────
    private static final String VERT = ""
        + "attribute vec2 a_Position;\n"
        + "attribute vec2 a_TexCoord;\n"
        + "varying vec2 v_TexCoord;\n"
        + "void main() {\n"
        + "    v_TexCoord = a_TexCoord;\n"
        + "    gl_Position = vec4(a_Position, 0.0, 1.0);\n"
        + "}";

    private static final String FRAG = ""
        + "#extension GL_OES_EGL_image_external : require\n"
        + "precision mediump float;\n"
        + "varying vec2 v_TexCoord;\n"
        + "uniform samplerExternalOES sTexture;\n"
        + "void main() {\n"
        + "    gl_FragColor = texture2D(sTexture, v_TexCoord);\n"
        + "}";

    // ────────────────────────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        setContentView(root);

        // GL surface — camera feed
        glSurfaceView = new GLSurfaceView(this);
        glSurfaceView.setPreserveEGLContextOnPause(true);
        glSurfaceView.setEGLContextClientVersion(2);
        glSurfaceView.setRenderer(this);
        glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        root.addView(glSurfaceView, matchParent());

        // Transparent overlay for polygon / handles
        overlayView = new CornerOverlayView(this);
        overlayView.setClickable(false);
        root.addView(overlayView, matchParent());

        // ── Status bar (top) ─────────────────────────────────────────────────
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.VERTICAL);
        topBar.setBackgroundColor(0xCC000000);
        topBar.setPadding(dp(16), dp(12), dp(16), dp(12));

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        statusText.setText("Đang khởi động AR...");
        topBar.addView(statusText);

        cornerCountText = new TextView(this);
        cornerCountText.setTextColor(0xFF00E5FF);
        cornerCountText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        cornerCountText.setText("Đang quét sàn nhà...");
        topBar.addView(cornerCountText);

        FrameLayout.LayoutParams topParams = matchParent();
        topParams.gravity = Gravity.TOP;
        topParams.height = FrameLayout.LayoutParams.WRAP_CONTENT;
        root.addView(topBar, topParams);

        // ── Button bar (bottom) ───────────────────────────────────────────────
        LinearLayout botBar = new LinearLayout(this);
        botBar.setOrientation(LinearLayout.HORIZONTAL);
        botBar.setGravity(Gravity.CENTER);
        botBar.setBackgroundColor(0xCC000000);
        botBar.setPadding(dp(16), dp(12), dp(16), dp(24));

        Button cancelBtn = makeButton("✕ Hủy", 0xFFEF5350);
        cancelBtn.setOnClickListener(v -> { setResult(Activity.RESULT_CANCELED); finish(); });

        // Reset: go back to auto-polygon mode
        Button resetBtn = makeButton("↺ Tự động", 0xFFFF9800);
        resetBtn.setOnClickListener(v -> {
            synchronized (cornersLock) { userEdited = false; }
            runOnUiThread(() -> cornerCountText.setText("Đang cập nhật tự động..."));
        });

        doneBtn = makeButton("✓ Dùng mặt bằng này", 0xFF4CAF50);
        doneBtn.setEnabled(false);
        doneBtn.setOnClickListener(v -> onDone());

        botBar.addView(cancelBtn);
        botBar.addView(spacer(dp(10)));
        botBar.addView(resetBtn);
        botBar.addView(spacer(dp(10)));
        botBar.addView(doneBtn);

        FrameLayout.LayoutParams botParams = matchParent();
        botParams.gravity = Gravity.BOTTOM;
        botParams.height = FrameLayout.LayoutParams.WRAP_CONTENT;
        root.addView(botBar, botParams);

        // ── Touch: drag corner handles ────────────────────────────────────────
        glSurfaceView.setOnTouchListener((v, event) -> {
            int action = event.getActionMasked();
            if (event.getPointerCount() > 1) {
                // Multi-finger: cancel any drag (user is pinching/zooming the preview)
                activeDragIndex = -1;
                return true;
            }
            float tx = event.getX(), ty = event.getY();
            if (action == MotionEvent.ACTION_DOWN) {
                activeDragIndex = findNearestCorner(tx, ty);
            } else if (action == MotionEvent.ACTION_MOVE && activeDragIndex >= 0) {
                pendingDragX = tx;
                pendingDragY = ty;
                hasPendingDrag = true;
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                activeDragIndex = -1;
            }
            return true;
        });

        // ── Camera permission ────────────────────────────────────────────────
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
        }
    }

    /** Find index of the projected corner nearest to (tx, ty), or -1 if none within threshold. */
    private int findNearestCorner(float tx, float ty) {
        float[][] sc = projectedCorners;
        if (sc == null) return -1;
        int best = -1;
        float bestDist = DRAG_THRESHOLD_PX;
        for (int i = 0; i < sc.length; i++) {
            if (sc[i] == null) continue;
            float dx = sc[i][0] - tx, dy = sc[i][1] - ty;
            float d = (float) Math.sqrt(dx * dx + dy * dy);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_PERMISSION
                && (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED)) {
            Toast.makeText(this, "Cần quyền Camera để quét AR", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    protected void onResume() {
        super.onResume();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) return;
        try {
            if (ArCoreApk.getInstance().requestInstall(this, userRequestedInstall)
                    == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                userRequestedInstall = false;
                return;
            }
            if (arSession == null) {
                ArCoreApk.Availability av = ArCoreApk.getInstance().checkAvailability(this);
                if (!av.isSupported()) {
                    Toast.makeText(this, "Thiết bị không hỗ trợ ARCore", Toast.LENGTH_LONG).show();
                    setResult(Activity.RESULT_CANCELED);
                    finish();
                    return;
                }
                arSession = new Session(this);
                Config cfg = new Config(arSession);
                cfg.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                cfg.setFocusMode(Config.FocusMode.AUTO);
                arSession.configure(cfg);
                sessionCreated = true;
            }
            arSession.resume();
            sessionPaused = false;
        } catch (UnavailableArcoreNotInstalledException | UnavailableUserDeclinedInstallationException e) {
            Toast.makeText(this, "ARCore chưa được cài đặt", Toast.LENGTH_LONG).show(); finish();
        } catch (UnavailableApkTooOldException e) {
            Toast.makeText(this, "ARCore cần cập nhật", Toast.LENGTH_LONG).show(); finish();
        } catch (UnavailableSdkTooOldException e) {
            Toast.makeText(this, "SDK quá cũ cho ARCore", Toast.LENGTH_LONG).show(); finish();
        } catch (CameraNotAvailableException e) {
            Toast.makeText(this, "Camera không khả dụng", Toast.LENGTH_LONG).show(); finish();
        } catch (Exception e) {
            Log.e(TAG, "Session resume error", e); finish();
        }
        glSurfaceView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        glSurfaceView.onPause();
        if (arSession != null) { arSession.pause(); sessionPaused = true; }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (arSession != null) { arSession.close(); arSession = null; }
    }

    // ── GLSurfaceView.Renderer ────────────────────────────────────────────────

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        GLES20.glClearColor(0f, 0f, 0f, 1f);

        int[] texIds = new int[1];
        GLES20.glGenTextures(1, texIds, 0);
        bgTextureId = texIds[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, bgTextureId);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);

        bgProgram        = linkProgram(VERT, FRAG);
        bgPositionAttr   = GLES20.glGetAttribLocation(bgProgram, "a_Position");
        bgTexCoordAttr   = GLES20.glGetAttribLocation(bgProgram, "a_TexCoord");
        bgTextureUniform = GLES20.glGetUniformLocation(bgProgram, "sTexture");

        bgPositions = floatBuf(new float[]{ -1f,-1f, -1f,1f, 1f,-1f, 1f,1f });
        bgTexInput  = floatBuf(new float[]{ -1f,-1f, -1f,1f, 1f,-1f, 1f,1f });
        bgTexOutput = floatBuf(new float[8]);

        glReady = true;
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
        viewWidth = width; viewHeight = height;
        if (arSession != null) {
            arSession.setDisplayGeometry(
                getWindowManager().getDefaultDisplay().getRotation(), width, height);
        }
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        if (!glReady || !sessionCreated || arSession == null || sessionPaused) return;

        if (!cameraTextureSet) {
            arSession.setCameraTextureName(bgTextureId);
            if (viewWidth > 0 && viewHeight > 0) {
                arSession.setDisplayGeometry(
                    getWindowManager().getDefaultDisplay().getRotation(), viewWidth, viewHeight);
            }
            cameraTextureSet = true;
        }

        Frame frame;
        try { frame = arSession.update(); }
        catch (CameraNotAvailableException e) { Log.e(TAG, "Camera not available", e); return; }

        Camera camera = frame.getCamera();

        bgTexInput.rewind(); bgTexOutput.rewind();
        frame.transformCoordinates2d(
            Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, bgTexInput,
            Coordinates2d.TEXTURE_NORMALIZED, bgTexOutput);
        drawBackground();

        if (camera.getTrackingState() != TrackingState.TRACKING) {
            updateStatusText("Di chuyển điện thoại chậm để khởi động AR...", null);
            return;
        }

        // Handle pending drag: hit-test at drag position → move corner
        if (hasPendingDrag && activeDragIndex >= 0) {
            hasPendingDrag = false;
            List<HitResult> hits = frame.hitTest(pendingDragX, pendingDragY);
            for (HitResult hit : hits) {
                if (hit.getTrackable() instanceof Plane) {
                    Plane p = (Plane) hit.getTrackable();
                    if (p.getType() == Plane.Type.HORIZONTAL_UPWARD_FACING) {
                        float[] t = hit.getHitPose().getTranslation();
                        synchronized (cornersLock) {
                            if (activeDragIndex < corners.size()) {
                                corners.set(activeDragIndex, new float[]{t[0], t[2]});
                            }
                            userEdited = true;
                        }
                        break;
                    }
                }
            }
        }

        // Auto-update corners from the largest detected floor plane (when not user-edited)
        boolean isUserEdited;
        synchronized (cornersLock) { isUserEdited = userEdited; }
        if (!isUserEdited) {
            updateCornersFromBestPlane();
        }

        // Project world corners → screen coords for overlay
        int cornerCount;
        synchronized (cornersLock) { cornerCount = corners.size(); }
        if (cornerCount > 0) {
            float[] proj = new float[16], view = new float[16];
            camera.getProjectionMatrix(proj, 0, 0.05f, 100f);
            camera.getViewMatrix(view, 0);
            projectCornersToScreen(proj, view);
        } else {
            projectedCorners = null;
            overlayView.postInvalidate();
            updateStatusText("Hướng camera xuống sàn nhà để phát hiện mặt phẳng", null);
        }
    }

    // ── AR logic ──────────────────────────────────────────────────────────────

    /** Find the largest tracked HORIZONTAL plane and extract its boundary polygon. */
    private void updateCornersFromBestPlane() {
        Collection<Plane> allPlanes = arSession.getAllTrackables(Plane.class);
        Plane bestPlane = null;
        float maxArea = 0f;
        for (Plane plane : allPlanes) {
            if (plane.getSubsumedBy() != null) continue;
            if (plane.getType() != Plane.Type.HORIZONTAL_UPWARD_FACING) continue;
            if (plane.getTrackingState() != TrackingState.TRACKING) continue;
            float area = plane.getExtentX() * plane.getExtentZ();
            if (area > maxArea) { maxArea = area; bestPlane = plane; }
        }
        if (bestPlane == null) return;

        FloatBuffer poly = bestPlane.getPolygon(); // plane-local XZ pairs
        int n = poly.limit() / 2;
        if (n < 3) return;
        Pose planePose = bestPlane.getCenterPose();
        List<float[]> newCorners = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            float lx = poly.get(i * 2);
            float lz = poly.get(i * 2 + 1);
            float[] world = planePose.transformPoint(new float[]{lx, 0f, lz});
            newCorners.add(new float[]{world[0], world[2]}); // XZ world coords
        }

        synchronized (cornersLock) {
            corners.clear();
            corners.addAll(newCorners);
        }

        final int count = n;
        final float areaSqM = maxArea;
        runOnUiThread(() -> {
            cornerCountText.setText(count + " góc phát hiện · ~" + String.format("%.1f", areaSqM) + " m² · Kéo để chỉnh");
            doneBtn.setEnabled(count >= 3);
        });
        updateStatusText("Mặt bằng phát hiện tự động · Kéo góc để điều chỉnh", null);
    }

    private void projectCornersToScreen(float[] proj, float[] view) {
        float[] mvp = new float[16];
        Matrix.multiplyMM(mvp, 0, proj, 0, view, 0);

        float[][] sc;
        synchronized (cornersLock) {
            sc = new float[corners.size()][2];
            for (int i = 0; i < corners.size(); i++) {
                float[] c = corners.get(i);
                float[] world = {c[0], 0f, c[1], 1f};
                float[] clip = new float[4];
                Matrix.multiplyMV(clip, 0, mvp, 0, world, 0);
                if (clip[3] <= 0f) { sc[i] = null; continue; }
                float nx = clip[0] / clip[3];
                float ny = clip[1] / clip[3];
                sc[i] = new float[]{
                    (nx + 1f) / 2f * viewWidth,
                    (1f - ny) / 2f * viewHeight
                };
            }
        }
        projectedCorners = sc;
        overlayView.postInvalidate();
    }

    private void updateStatusText(String msg, String sub) {
        runOnUiThread(() -> {
            statusText.setText(msg);
            if (sub != null) cornerCountText.setText(sub);
        });
    }

    // ── Done / result ─────────────────────────────────────────────────────────

    private void onDone() {
        int count;
        synchronized (cornersLock) { count = corners.size(); }
        if (count < 3) {
            Toast.makeText(this, "Cần ít nhất 3 góc phòng!", Toast.LENGTH_SHORT).show();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Chiều cao trần (m)");
        EditText input = new EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        input.setText("2.7");
        input.selectAll();
        int pad = dp(16);
        input.setPadding(pad, pad / 2, pad, pad / 2);
        builder.setView(input);
        builder.setPositiveButton("Xác nhận", (d, w) -> {
            float h = 2.7f;
            try { h = Float.parseFloat(input.getText().toString().trim()); } catch (NumberFormatException ignored) {}
            returnResult(h);
        });
        builder.setNegativeButton("Hủy", null);
        builder.show();
    }

    private void returnResult(float ceilingHeight) {
        try {
            JSONObject result = new JSONObject();
            JSONArray arr = new JSONArray();
            synchronized (cornersLock) {
                for (float[] c : corners) {
                    JSONObject pt = new JSONObject();
                    pt.put("x", (double) c[0]);
                    pt.put("y", (double) c[1]);
                    arr.put(pt);
                }
            }
            result.put("corners", arr);
            result.put("ceilingHeight", (double) ceilingHeight);
            Intent data = new Intent();
            data.putExtra("result", result.toString());
            setResult(Activity.RESULT_OK, data);
        } catch (Exception e) {
            setResult(Activity.RESULT_CANCELED);
        }
        finish();
    }

    // ── OpenGL background ─────────────────────────────────────────────────────

    private void drawBackground() {
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glUseProgram(bgProgram);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, bgTextureId);
        GLES20.glUniform1i(bgTextureUniform, 0);
        bgPositions.rewind();
        GLES20.glEnableVertexAttribArray(bgPositionAttr);
        GLES20.glVertexAttribPointer(bgPositionAttr, 2, GLES20.GL_FLOAT, false, 0, bgPositions);
        bgTexOutput.rewind();
        GLES20.glEnableVertexAttribArray(bgTexCoordAttr);
        GLES20.glVertexAttribPointer(bgTexCoordAttr, 2, GLES20.GL_FLOAT, false, 0, bgTexOutput);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glDisableVertexAttribArray(bgPositionAttr);
        GLES20.glDisableVertexAttribArray(bgTexCoordAttr);
        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }

    // ── OpenGL helpers ────────────────────────────────────────────────────────

    private static int linkProgram(String vert, String frag) {
        int vs = compileShader(GLES20.GL_VERTEX_SHADER, vert);
        int fs = compileShader(GLES20.GL_FRAGMENT_SHADER, frag);
        int prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, vs);
        GLES20.glAttachShader(prog, fs);
        GLES20.glLinkProgram(prog);
        return prog;
    }

    private static int compileShader(int type, String src) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, src);
        GLES20.glCompileShader(shader);
        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] == 0) Log.e(TAG, "Shader compile error: " + GLES20.glGetShaderInfoLog(shader));
        return shader;
    }

    private static FloatBuffer floatBuf(float[] data) {
        FloatBuffer buf = ByteBuffer.allocateDirect(data.length * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer();
        buf.put(data).position(0);
        return buf;
    }

    // ── Layout helpers ────────────────────────────────────────────────────────

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private Button makeButton(String label, int bgColor) {
        Button btn = new Button(this);
        btn.setText(label);
        btn.setTextColor(Color.WHITE);
        btn.setBackgroundColor(bgColor);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(44));
        btn.setLayoutParams(lp);
        btn.setPadding(dp(14), 0, dp(14), 0);
        return btn;
    }

    private View spacer(int widthPx) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(widthPx, 1));
        return v;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    // ── CornerOverlayView ─────────────────────────────────────────────────────

    class CornerOverlayView extends View {
        private final Paint fillPaint   = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint linePaint   = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint numPaint    = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint handleRing  = new Paint(Paint.ANTI_ALIAS_FLAG);

        CornerOverlayView(android.content.Context ctx) {
            super(ctx);

            fillPaint.setColor(0xFF00E5FF);
            fillPaint.setStyle(Paint.Style.FILL);

            strokePaint.setColor(0xFF00E5FF);
            strokePaint.setStyle(Paint.Style.STROKE);
            strokePaint.setStrokeWidth(dp(3));

            // semi-transparent polygon fill
            linePaint.setColor(0x3300E5FF);
            linePaint.setStyle(Paint.Style.FILL);

            numPaint.setColor(Color.WHITE);
            numPaint.setTextSize(dp(14));
            numPaint.setTextAlign(Paint.Align.CENTER);
            numPaint.setFakeBoldText(true);

            handleRing.setColor(Color.WHITE);
            handleRing.setStyle(Paint.Style.STROKE);
            handleRing.setStrokeWidth(dp(2));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float[][] sc = projectedCorners;
            if (sc == null || sc.length == 0) return;

            // Count visible points
            int visCount = 0;
            for (float[] pt : sc) if (pt != null) visCount++;
            if (visCount == 0) return;

            // Build polygon path
            Path path = new Path();
            boolean started = false;
            for (float[] pt : sc) {
                if (pt == null) continue;
                if (!started) { path.moveTo(pt[0], pt[1]); started = true; }
                else           { path.lineTo(pt[0], pt[1]); }
            }
            if (visCount >= 3) path.close();

            // Semi-transparent fill
            canvas.drawPath(path, linePaint);
            // Polygon outline
            canvas.drawPath(path, strokePaint);

            float circleR   = dp(16);
            float handleR   = dp(22); // larger touch target visualisation

            // Draw handles and numbers
            for (int i = 0; i < sc.length; i++) {
                if (sc[i] == null) continue;
                float x = sc[i][0], y = sc[i][1];

                boolean isDragging = (i == activeDragIndex);
                // Outer drag ring when actively dragging
                if (isDragging) canvas.drawCircle(x, y, handleR, handleRing);

                canvas.drawCircle(x, y, circleR, fillPaint);
                canvas.drawCircle(x, y, circleR, handleRing);
                canvas.drawText(String.valueOf(i + 1), x, y + dp(5), numPaint);
            }
        }
    }
}
