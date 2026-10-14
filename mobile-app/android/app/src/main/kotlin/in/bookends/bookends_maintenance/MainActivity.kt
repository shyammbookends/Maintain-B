package `in`.bookends.bookends_maintenance

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/** Shares downloaded app updates with the system installer (see res/xml/update_paths.xml). */
class UpdateFileProvider : FileProvider()

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // In-app updates (lib/core/updater.dart): the APK is downloaded and checked in Dart,
        // then handed to Android's installer, which only accepts it when it is signed with
        // the same key as the installed app.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "in.bookends/updates")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "canInstall" -> result.success(
                        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls(),
                    )
                    "openInstallSettings" -> {
                        startActivity(
                            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")),
                        )
                        result.success(null)
                    }
                    "install" -> {
                        val file = File(call.argument<String>("path") ?: "")
                        val updates = File(cacheDir, "updates").canonicalPath + File.separator
                        if (!file.canonicalPath.startsWith(updates) || !file.isFile) {
                            result.error("BAD_PATH", "Not a downloaded update", null)
                        } else {
                            val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
                            startActivity(
                                Intent(Intent.ACTION_VIEW)
                                    .setDataAndType(uri, "application/vnd.android.package-archive")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                            result.success(true)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
