import java.io.FileInputStream
import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// `flutter build ... --dart-define=ALLOW_LAN_HTTP=true` makes a LAN test build that
// may use plain http to the office PC; a normal release build is HTTPS only.
val dartDefines: Map<String, String> =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.mapNotNull { runCatching { String(Base64.getDecoder().decode(it)) }.getOrNull() }
        ?.mapNotNull { d -> d.split("=", limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }
        ?.toMap() ?: emptyMap()
val allowLanHttp = dartDefines["ALLOW_LAN_HTTP"] == "true"

// Release signing: android/key.properties (git-ignored) points at the upload keystore.
// Without it (a local build on a PC without the key) the debug key is used and a
// warning is printed — such an APK must not be published to the Play Store.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}
val hasReleaseKey = keystorePropertiesFile.exists()

android {
    namespace = "in.bookends.bookends_maintenance"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "in.bookends.bookends_maintenance"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // HTTPS only (see res/xml/network_security_config.xml).
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        debug {
            // Development against the API on this PC / office Wi-Fi (http://<LAN IP>:4000).
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config_lan"
        }
        release {
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "WARNING: android/key.properties not found - this release build is signed with " +
                        "the DEBUG key. Fine for a local test APK, never for the Play Store.",
                )
                signingConfig = signingConfigs.getByName("debug")
            }
            if (allowLanHttp) {
                manifestPlaceholders["usesCleartextTraffic"] = "true"
                manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config_lan"
            }
            // Smaller, faster APK: R8 removes unused code and resources (Flutter's default, made explicit).
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    // FileProvider for in-app updates (MainActivity.kt).
    implementation("androidx.core:core:1.13.1")
}
