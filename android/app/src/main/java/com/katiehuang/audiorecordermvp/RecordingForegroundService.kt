package com.katiehuang.audiorecordermvp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class RecordingForegroundService : Service() {

  companion object {
    const val CHANNEL_ID = "recording_channel"
    const val NOTIFICATION_ID = 2025
    const val ACTION_START = "ACTION_START"
    const val ACTION_STOP = "ACTION_STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        createChannel()
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pending = PendingIntent.getActivity(
          this, 0, launchIntent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Recording…"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Recording in background"

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
          .setSmallIcon(android.R.drawable.ic_btn_speak_now)
          .setContentTitle(title)
          .setContentText(text)
          .setContentIntent(pending)
          .setOnlyAlertOnce(true)
          .setOngoing(true)
          .build()

        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(CHANNEL_ID, "Recording", NotificationManager.IMPORTANCE_LOW)
      manager.createNotificationChannel(channel)
    }
  }
}
