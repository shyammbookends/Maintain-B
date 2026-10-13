// Shared setup for the widget tests that run against a live API (API_TEST_URL).
// The test runner has no native plugins, so screens that cache photos or keep
// data on the phone (path_provider, shared_preferences) get a temporary folder
// and in-memory settings instead of failing after the test with
// MissingPluginException.
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Call from `setUpAll` (after the binding is initialised).
void mockPhonePlugins() {
  SharedPreferences.setMockInitialValues({});
  final dir = Directory.systemTemp.createTempSync('bookends_live_test_');
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/path_provider'),
    (call) async => dir.path,
  );
}
