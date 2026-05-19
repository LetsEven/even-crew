package com.even.crew

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class EvenFirebaseService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        (application as? MainActivity)?.saveFcmTokenToFile(token)
            ?: try { java.io.File(filesDir, "fcm_token.txt").writeText(token) } catch (_: Exception) {}
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // FCM en background es manejado automáticamente por Android
        // Este método solo se llama cuando la app está en primer plano
    }
}
