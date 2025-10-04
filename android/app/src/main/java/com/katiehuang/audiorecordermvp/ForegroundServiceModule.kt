package com.katiehuang.audiorecordermvp

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ForegroundServiceModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "ForegroundService"

  @ReactMethod
  fun start(title: String?, text: String?, promise: Promise) {
    val i = Intent(ctx, RecordingForegroundService::class.java).apply {
      action = RecordingForegroundService.ACTION_START
      putExtra(RecordingForegroundService.EXTRA_TITLE, title ?: "Recording…")
      putExtra(RecordingForegroundService.EXTRA_TEXT, text ?: "Recording in background")
    }
    if (android.os.Build.VERSION.SDK_INT >= 26) {
      ctx.startForegroundService(i)
    } else {
      ctx.startService(i)
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    val i = Intent(ctx, RecordingForegroundService::class.java).apply {
      action = RecordingForegroundService.ACTION_STOP
    }
    ctx.startService(i)
    promise.resolve(true)
  }
}
