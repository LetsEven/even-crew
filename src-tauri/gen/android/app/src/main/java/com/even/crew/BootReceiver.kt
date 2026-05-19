package com.even.crew

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            launch?.let { context.startActivity(it) }
        }
    }
}
