package com.katiehuang.audiorecordermvp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode

class FFmpegWrapper(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "FFmpegWrapper"

    @ReactMethod
    fun run(command: String, promise: Promise) {
        try {
            FFmpegKit.executeAsync(command, { session ->
                if (ReturnCode.isSuccess(session.returnCode)) {
                    promise.resolve("Success")
                } else {
                    promise.reject("FFMPEG_ERROR", session.failStackTrace ?: "Unknown error")
                }
            })
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message)
        }
    }
}