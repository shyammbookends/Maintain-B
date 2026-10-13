import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// App palette: indigo brand with clear status colours on a cool slate base
/// (contrast checked for text on white and on the soft tints).
class AppColors {
  // Brand
  static const primary = Color(0xFF4F46E5); // indigo 600
  static const primaryDark = Color(0xFF4338CA); // indigo 700 (pressed)
  static const brandFrom = Color(0xFF4338CA);
  static const brandTo = Color(0xFF7C3AED); // violet 600
  static const brandPink = Color(0xFFDB2777); // pink 600 (hero accent)

  // Neutrals (slate)
  static const foreground = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);
  static const border = Color(0xFFE2E8F0);
  static const borderSoft = Color(0xFFEDF0F6);
  static const app = Color(0xFFF3F5FB);
  static const card = Colors.white;
  static const neutralSoft = Color(0xFFF1F5F9);

  // Status
  static const info = Color(0xFF0EA5E9);
  static const infoSoft = Color(0xFFEEF2FF);
  static const infoFg = Color(0xFF4338CA);
  static const success = Color(0xFF10B981);
  static const successSoft = Color(0xFFECFDF5);
  static const successFg = Color(0xFF047857);
  static const warning = Color(0xFFF59E0B);
  static const warningSoft = Color(0xFFFFFBEB);
  static const warningFg = Color(0xFFB45309);
  static const danger = Color(0xFFE11D48);
  static const dangerSoft = Color(0xFFFFF1F2);
  static const dangerFg = Color(0xFFBE123C);

  static const brand = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [brandFrom, brandTo]);

  /// Richer three-stop gradient for the big greeting banners.
  static const hero = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF3730A3), Color(0xFF6D28D9), Color(0xFFBE185D)],
    stops: [0, 0.6, 1],
  );
}

const _font = 'Inter';

/// Inter has no Hindi or Gujarati letters: these bundled fonts draw them (not the phone's own font).
const kFontFallback = ['NotoSansDevanagari', 'NotoSansGujarati'];

/// Dark status-bar icons, white navigation bar with dark buttons (Android and iPhone).
const kSystemBars = SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.dark,
  statusBarBrightness: Brightness.light,
  systemNavigationBarColor: Colors.white,
  systemNavigationBarIconBrightness: Brightness.dark,
  systemNavigationBarDividerColor: AppColors.border,
  systemNavigationBarContrastEnforced: false,
);

/// Same, with light status-bar icons for screens with a coloured header.
final kSystemBarsOnColor = kSystemBars.copyWith(statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark);

TextStyle _t(double size, FontWeight weight, [Color? color]) =>
    TextStyle(fontFamily: _font, fontFamilyFallback: kFontFallback, fontSize: size, fontWeight: weight, color: color);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.primary,
    primary: AppColors.primary,
    onPrimary: Colors.white,
    secondary: AppColors.brandTo,
    surface: Colors.white,
    onSurface: AppColors.foreground,
    error: AppColors.danger,
    outline: AppColors.border,
  );
  final radius = BorderRadius.circular(12);
  final border = OutlineInputBorder(
    borderRadius: radius,
    borderSide: const BorderSide(color: AppColors.border),
  );
  const buttonSize = Size(64, 52);
  final buttonShape = RoundedRectangleBorder(borderRadius: radius);
  final buttonText = _t(15, FontWeight.w600);

  return ThemeData(
    useMaterial3: true,
    // Bundled, so phones with a custom system font still look like the web app.
    fontFamily: _font,
    fontFamilyFallback: kFontFallback,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.app,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.foreground,
      elevation: 0,
      scrolledUnderElevation: 1,
      shadowColor: AppColors.border,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      systemOverlayStyle: kSystemBars,
      titleTextStyle: _t(20, FontWeight.w700, AppColors.foreground).copyWith(letterSpacing: -0.3),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(borderSide: const BorderSide(color: AppColors.primary, width: 1.8)),
      errorBorder: border.copyWith(borderSide: const BorderSide(color: AppColors.danger)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
      labelStyle: _t(14, FontWeight.w500, AppColors.muted),
      floatingLabelStyle: _t(14, FontWeight.w600, AppColors.primary),
      hintStyle: _t(14, FontWeight.w400, const Color(0xFF94A3B8)),
      helperStyle: _t(12, FontWeight.w400, AppColors.muted),
      prefixIconColor: AppColors.muted,
      suffixIconColor: AppColors.muted,
    ),
    // Primary action: solid indigo.
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFC7D2FE),
        disabledForegroundColor: Colors.white,
        minimumSize: buttonSize,
        shape: buttonShape,
        textStyle: buttonText,
        elevation: 0,
      ),
    ),
    // Secondary action: white with a border, indigo text.
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        backgroundColor: Colors.white,
        minimumSize: buttonSize,
        shape: buttonShape,
        side: const BorderSide(color: Color(0xFFC7D2FE), width: 1.2),
        textStyle: buttonText,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.infoSoft,
        foregroundColor: AppColors.primary,
        minimumSize: buttonSize,
        shape: buttonShape,
        elevation: 0,
        textStyle: buttonText,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.primary,
        textStyle: _t(14, FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: AppColors.foreground)),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: AppColors.primary,
      foregroundColor: Colors.white,
      elevation: 3,
      highlightElevation: 6,
      extendedTextStyle: _t(15, FontWeight.w600),
      shape: const StadiumBorder(),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: AppColors.infoSoft,
      checkmarkColor: AppColors.primary,
      side: const BorderSide(color: AppColors.border),
      labelStyle: _t(13, FontWeight.w500, AppColors.foreground),
      secondaryLabelStyle: _t(13, FontWeight.w600, AppColors.primary),
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: AppColors.primary,
      unselectedLabelColor: AppColors.muted,
      indicatorColor: AppColors.primary,
      labelStyle: _t(15, FontWeight.w600),
      unselectedLabelStyle: _t(15, FontWeight.w500),
      dividerColor: AppColors.border,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: AppColors.primary.withValues(alpha: 0.12),
      indicatorShape: const StadiumBorder(),
      elevation: 8,
      shadowColor: AppColors.border,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => _t(
          11.5,
          s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
          s.contains(WidgetState.selected) ? AppColors.primary : AppColors.muted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 23, color: s.contains(WidgetState.selected) ? AppColors.primary : AppColors.muted),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : null),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.primary : null),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.primary : null),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: AppColors.primary,
      titleTextStyle: _t(15, FontWeight.w500, AppColors.foreground),
      subtitleTextStyle: _t(13, FontWeight.w400, AppColors.muted),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      titleTextStyle: _t(18, FontWeight.w600, AppColors.foreground),
      contentTextStyle: _t(14.5, FontWeight.w400, AppColors.foreground),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: _t(14.5, FontWeight.w500, AppColors.foreground),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.foreground,
      contentTextStyle: _t(14, FontWeight.w500, Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.primary),
    badgeTheme: BadgeThemeData(backgroundColor: AppColors.danger, textStyle: _t(10.5, FontWeight.w700, Colors.white)),
    dividerTheme: const DividerThemeData(color: AppColors.border, space: 1),
  );
}
