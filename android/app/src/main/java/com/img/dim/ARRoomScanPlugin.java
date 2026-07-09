package com.img.dim;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.ar.core.ArCoreApk;

@CapacitorPlugin(name = "ARRoomScan")
public class ARRoomScanPlugin extends Plugin {

    @PluginMethod
    public void checkAvailability(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ArCoreApk.Availability availability =
                    ArCoreApk.getInstance().checkAvailability(getContext());
                JSObject ret = new JSObject();
                ret.put("available", availability.isSupported());
                ret.put("status", availability.name());
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("available", false);
                ret.put("status", "ERROR");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        Intent intent = new Intent(getActivity(), ARRoomScanActivity.class);
        startActivityForResult(call, intent, "scanCompleted");
    }

    @ActivityCallback
    private void scanCompleted(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String json = result.getData().getStringExtra("result");
            try {
                JSObject ret = new JSObject(json);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("parse_error: " + e.getMessage());
            }
        } else {
            call.reject("cancelled");
        }
    }
}
