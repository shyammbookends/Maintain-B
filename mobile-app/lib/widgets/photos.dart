import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import 'common.dart';

/// Takes a photo or picks from the gallery (compressed like the web app does).
Future<List<File>> pickPhotos(BuildContext context, {bool multiple = true}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.photo_camera_outlined),
          title: Text(t('Take photo')),
          onTap: () => Navigator.pop(ctx, ImageSource.camera),
        ),
        ListTile(
          leading: const Icon(Icons.photo_library_outlined),
          title: Text(t('Choose from gallery')),
          onTap: () => Navigator.pop(ctx, ImageSource.gallery),
        ),
        const SizedBox(height: 8),
      ]),
    ),
  );
  if (source == null) return [];
  final picker = ImagePicker();
  try {
    if (source == ImageSource.gallery && multiple) {
      final files = await picker.pickMultiImage(maxWidth: 1600, imageQuality: 80, limit: 6);
      return [for (final f in files) File(f.path)];
    }
    final f = await picker.pickImage(source: source, maxWidth: 1600, imageQuality: 80);
    return f == null ? [] : [File(f.path)];
  } catch (e) {
    if (context.mounted) toast(context, t('Could not open the camera or gallery: {error}', {'error': e}), error: true);
    return [];
  }
}

/// Grid of attachment thumbnails; tap to open full screen.
class PhotoGrid extends StatelessWidget {
  const PhotoGrid(this.items, {super.key, this.columns = 3});
  final List? items;
  final int columns;

  @override
  Widget build(BuildContext context) {
    final photos = [
      for (final a in items ?? const [])
        if ((a as Map)['kind'] == 'PHOTO' && a['removed'] != true) a
    ];
    if (photos.isEmpty) return const SizedBox.shrink();
    final api = apiOf(context);
    return GridView.count(
      crossAxisCount: columns,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      children: [
        for (final p in photos)
          GestureDetector(
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => PhotoViewer(
                url: api.fileUrl(p['url'] as String?),
                localPath: p['localPath'] as String?,
                caption: [
                  if (p['stage'] != null) label(p['stage']),
                  if (p['caption'] != null) p['caption'].toString(),
                ].join(' · '),
              ),
            )),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Stack(fit: StackFit.expand, children: [
                AppImage(
                  url: api.fileUrl((p['thumbUrl'] ?? p['url']) as String?),
                  localPath: p['localPath'] as String?,
                  fit: BoxFit.cover,
                  // Thumbnails are decoded small: much less memory on long lists.
                  cacheWidth: 360,
                ),
                if (p['localPath'] != null)
                  const Positioned(
                    right: 6,
                    bottom: 6,
                    child: Icon(Icons.cloud_upload_outlined, size: 18, color: Colors.white, shadows: [Shadow(blurRadius: 4)]),
                  ),
                if (p['stage'] != null)
                  Positioned(
                    left: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(6)),
                      child: Text(label(p['stage']),
                          style: const TextStyle(color: Colors.white, fontSize: 10.5)),
                    ),
                  ),
              ]),
            ),
          ),
      ],
    );
  }
}

/// Signed file links change on every load; the storage key in them doesn't,
/// so the photo is downloaded once and also shows offline.
String imageCacheKey(String url) {
  final uri = Uri.tryParse(url);
  final key = uri?.queryParameters['key'];
  if (key != null && key.isNotEmpty) return key;
  return uri == null ? url : uri.replace(query: '').toString();
}

/// A photo from the server (cached on the phone) or one waiting to be uploaded.
class AppImage extends StatelessWidget {
  const AppImage({super.key, required this.url, this.localPath, this.fit, this.cacheWidth, this.dark = false});
  final String url;
  final String? localPath;
  final BoxFit? fit;
  final int? cacheWidth;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    Widget broken(BuildContext _, Object _, Object? _) => dark
        ? const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48)
        : Container(color: AppColors.neutralSoft, child: const Icon(Icons.broken_image_outlined, color: AppColors.muted));
    final local = localPath;
    if (local != null) {
      return Image.file(File(local), fit: fit, cacheWidth: cacheWidth, errorBuilder: (c, e, s) => broken(c, e, s));
    }
    if (url.isEmpty) return broken(context, '', null);
    return CachedNetworkImage(
      imageUrl: url,
      cacheKey: imageCacheKey(url),
      fit: fit,
      memCacheWidth: cacheWidth,
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: (_, _) => dark ? const SizedBox.shrink() : Container(color: AppColors.neutralSoft),
      errorWidget: (c, _, e) => broken(c, e, null),
    );
  }
}

/// The saved signature of a step (white background like the web).
class SignatureImage extends StatelessWidget {
  const SignatureImage(this.attachment, {super.key});
  final Map attachment;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: AppImage(
        url: api.fileUrl((attachment['url'] ?? attachment['thumbUrl']) as String?),
        localPath: attachment['localPath'] as String?,
        fit: BoxFit.contain,
      ),
    );
  }
}

class PhotoViewer extends StatelessWidget {
  const PhotoViewer({super.key, required this.url, this.caption = '', this.localPath});
  final String url;
  final String caption;
  final String? localPath;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(caption, style: const TextStyle(color: Colors.white, fontSize: 15)),
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 5,
          child: AppImage(url: url, localPath: localPath, dark: true),
        ),
      ),
    );
  }
}
