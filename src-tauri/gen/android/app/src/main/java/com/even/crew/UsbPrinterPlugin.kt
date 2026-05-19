package com.even.crew

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.starmicronics.stario10.InterfaceType
import com.starmicronics.stario10.StarConnectionSettings
import com.starmicronics.stario10.StarDeviceDiscoveryManager
import com.starmicronics.stario10.StarDeviceDiscoveryManagerFactory
import com.starmicronics.stario10.StarPrinter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val STAR_PREFIX = "star:"
private const val ACTION_USB_PERMISSION = "com.even.crew.USB_PERMISSION"

@InvokeArg
class PrintRawArgs {
    lateinit var deviceName: String
    lateinit var data: List<Int>
}

@InvokeArg
class PrintTestArgs {
    lateinit var deviceName: String
}

@TauriPlugin
class UsbPrinterPlugin(private val activity: Activity) : Plugin(activity) {

    private var discoveryManager: StarDeviceDiscoveryManager? = null

    private val usbManager: UsbManager
        get() = activity.getSystemService(Context.USB_SERVICE) as UsbManager

    // ── Discovery ────────────────────────────────────────────

    @Command
    fun listDevices(invoke: Invoke) {
        // Raw USB: devuelve todos los dispositivos conectados (cualquier marca)
        val rawDevices = mutableListOf<JSObject>()
        for ((_, dev) in usbManager.deviceList) {
            val isPrinter = (0 until dev.interfaceCount).any { i ->
                dev.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_PRINTER
            }
            rawDevices.add(JSObject().apply {
                put("device_name", dev.deviceName)
                put("vendor_id", dev.vendorId)
                put("product_id", dev.productId)
                put("is_printer_class", isPrinter)
            })
        }

        // Star SDK: descubre impresoras Star Micronics y las agrega con prefijo "star:"
        val starDevices = mutableListOf<JSObject>()
        activity.runOnUiThread {
            try {
                val manager = StarDeviceDiscoveryManagerFactory.create(
                    listOf(InterfaceType.Usb),
                    activity
                )
                discoveryManager = manager
                manager.discoveryTime = 10000
                manager.callback = object : StarDeviceDiscoveryManager.Callback {
                    override fun onPrinterFound(printer: StarPrinter) {
                        val identifier = printer.connectionSettings.identifier
                        starDevices.add(JSObject().apply {
                            put("device_name", "$STAR_PREFIX$identifier")
                            put("vendor_id", 1305) // Star Micronics vendor ID
                            put("product_id", 0)
                            put("is_printer_class", true)
                        })
                    }
                    override fun onDiscoveryFinished() {
                        discoveryManager = null
                        // Star toma prioridad; los raw que no estén en Star se agregan también
                        val starIdentifiers = starDevices
                            .map { it.getString("device_name").removePrefix(STAR_PREFIX) }
                            .toSet()
                        val combined = JSArray()
                        for (d in starDevices) combined.put(d)
                        for (d in rawDevices) {
                            if (d.getString("device_name") !in starIdentifiers) {
                                combined.put(d)
                            }
                        }
                        invoke.resolveObject(JSObject("{\"devices\":$combined}"))
                    }
                }
                manager.startDiscovery()
            } catch (e: Exception) {
                // Si el SDK falla, devolver solo los raw
                discoveryManager = null
                val combined = JSArray()
                for (d in rawDevices) combined.put(d)
                invoke.resolveObject(JSObject("{\"devices\":$combined}"))
            }
        }
    }

    // ── Printing ─────────────────────────────────────────────

    @Command
    fun printRaw(invoke: Invoke) {
        val args = invoke.parseArgs(PrintRawArgs::class.java)
        val data = args.data.map { it.toByte() }.toByteArray()
        if (args.deviceName.startsWith(STAR_PREFIX)) {
            printWithStarSdk(args.deviceName.removePrefix(STAR_PREFIX), data, invoke)
        } else {
            printWithRawUsb(args.deviceName, data, invoke)
        }
    }

    @Command
    fun printTest(invoke: Invoke) {
        val args = invoke.parseArgs(PrintTestArgs::class.java)
        val ticket = buildTestTicket()
        if (args.deviceName.startsWith(STAR_PREFIX)) {
            printWithStarSdk(args.deviceName.removePrefix(STAR_PREFIX), ticket, invoke)
        } else {
            printWithRawUsb(args.deviceName, ticket, invoke)
        }
    }

    // ── Star SDK printing ────────────────────────────────────

    private fun printWithStarSdk(identifier: String, data: ByteArray, invoke: Invoke) {
        CoroutineScope(Dispatchers.IO).launch {
            val printer = StarPrinter(
                StarConnectionSettings(InterfaceType.Usb, identifier),
                activity
            )
            try {
                printer.openAsync().await()
                printer.printRawDataAsync(data.toList()).await()
                withContext(Dispatchers.Main) { invoke.resolve() }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    invoke.reject(e.message ?: "Error imprimiendo (Star SDK)")
                }
            } finally {
                try { printer.closeAsync().await() } catch (_: Exception) {}
            }
        }
    }

    // ── Raw USB printing (cualquier marca) ───────────────────

    private fun printWithRawUsb(deviceName: String, data: ByteArray, invoke: Invoke) {
        val dev = usbManager.deviceList[deviceName]
            ?: return invoke.reject("Dispositivo no encontrado: $deviceName")

        if (!usbManager.hasPermission(dev)) {
            requestUsbPermission(dev)
            return invoke.reject("USB_PERMISSION_REQUESTED")
        }
        sendBytesRaw(dev, data, invoke)
    }

    private fun requestUsbPermission(dev: UsbDevice) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else
            PendingIntent.FLAG_UPDATE_CURRENT
        val intent = PendingIntent.getBroadcast(activity, 0, Intent(ACTION_USB_PERMISSION), flags)
        usbManager.requestPermission(dev, intent)
    }

    private fun sendBytesRaw(dev: UsbDevice, data: ByteArray, invoke: Invoke) {
        var endpoint: UsbEndpoint? = null
        var usbInterface: UsbInterface? = null

        outer@ for (i in 0 until dev.interfaceCount) {
            val intf = dev.getInterface(i)
            for (j in 0 until intf.endpointCount) {
                val ep = intf.getEndpoint(j)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                    ep.direction == UsbConstants.USB_DIR_OUT
                ) {
                    endpoint = ep
                    usbInterface = intf
                    break@outer
                }
            }
        }

        if (endpoint == null || usbInterface == null) {
            return invoke.reject("No se encontró endpoint bulk-OUT en el dispositivo")
        }

        val connection = usbManager.openDevice(dev)
            ?: return invoke.reject("No se pudo abrir el dispositivo USB")

        try {
            if (!connection.claimInterface(usbInterface, true)) {
                return invoke.reject("No se pudo reclamar la interfaz USB")
            }
            val transferred = connection.bulkTransfer(endpoint, data, data.size, 5000)
            if (transferred < 0) {
                invoke.reject("Error al enviar datos USB (código $transferred)")
            } else {
                invoke.resolve()
            }
        } finally {
            connection.close()
        }
    }

    // ── Ticket de prueba ─────────────────────────────────────

    private fun buildTestTicket(): ByteArray {
        val ts = java.text.SimpleDateFormat("dd/MM/yyyy HH:mm:ss", java.util.Locale.getDefault())
            .format(java.util.Date())
        val buf = mutableListOf<Byte>()
        buf += listOf(0x1B, 0x40).map { it.toByte() }
        buf += listOf(0x1B, 0x61, 0x00).map { it.toByte() }
        buf += listOf(0x1B, 0x21, 0x30).map { it.toByte() }
        buf += "\n== CUENTA NUEVA ==\n".toByteArray(Charsets.US_ASCII).toList()
        buf += listOf(0x1B, 0x21, 0x10).map { it.toByte() }
        buf += "\nEVEN PRINT USB\n".toByteArray(Charsets.US_ASCII).toList()
        buf += "$ts\n".toByteArray(Charsets.US_ASCII).toList()
        buf += "========================\n".toByteArray(Charsets.US_ASCII).toList()
        buf += "Asigna nombre y rol\n".toByteArray(Charsets.US_ASCII).toList()
        buf += "desde Impresoras.\n".toByteArray(Charsets.US_ASCII).toList()
        buf += "========================\n".toByteArray(Charsets.US_ASCII).toList()
        buf += listOf(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00).map { it.toByte() }
        return buf.toByteArray()
    }
}
