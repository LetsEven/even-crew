package com.even.crew

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import com.google.firebase.messaging.FirebaseMessaging
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Kiosk: pantalla siempre encendida
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // Kiosk: bloquear botón back
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {}
    })

    // Kiosk: fijar la app en pantalla (lock task)
    startLockTask()

    createNotificationChannel()
    startForegroundService()
    requestBatteryOptimizationExemption()

    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
      if (task.isSuccessful) {
        val token = task.result
        saveFcmTokenToFile(token)
      }
    }
  }

  private fun startForegroundService() {
    val intent = Intent(this, EvenForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      startForegroundService(intent)
    } else {
      startService(intent)
    }
  }

  private fun requestBatteryOptimizationExemption() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      if (!pm.isIgnoringBatteryOptimizations(packageName)) {
        val intent = Intent(
          android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:$packageName")
        )
        startActivity(intent)
      }
    }
  }

  fun saveFcmTokenToFile(token: String) {
    // Escribir en filesDir (ruta canónica para Rust)
    try { File(filesDir, "fcm_token.txt").writeText(token) } catch (_: Exception) {}
    // Escribir también en getExternalFilesDir por si la ruta interna difiere
    try { File(getExternalFilesDir(null), "fcm_token.txt")?.writeText(token) } catch (_: Exception) {}
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "kitchen_orders",
        "Órdenes de cocina",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Notificaciones de nuevas órdenes"
        enableVibration(true)
      }
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }
}
