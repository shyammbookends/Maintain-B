import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import '../core/i18n.dart';
import '../core/theme.dart';

// UI text (kept together for translation later).
String get _tHint => t('Sign here with your finger');
String get _tClear => t('Clear');
String get _tSave => t('Save signature');

const _ink = Color(0xFF111827);
const _inkWidth = 2.5;

/// Sign with a finger (same as the web SignaturePad): white background, dark ink,
/// saved as a PNG that is uploaded as the step's signature.
class SignaturePad extends StatefulWidget {
  const SignaturePad({super.key, required this.onSave, this.enabled = true, this.height = 150});
  final Future<void> Function(File png) onSave;
  final bool enabled;
  final double height;

  /// Where the PNG is written before upload (tests point it at a temp folder).
  @visibleForTesting
  static Future<Directory> Function() tempDir = getTemporaryDirectory;

  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  final _strokes = <List<Offset>>[];
  Size _size = Size.zero;
  bool _saving = false;
  final _repaint = ValueNotifier<int>(0);

  bool get _dirty => _strokes.any((s) => s.isNotEmpty);

  @override
  void dispose() {
    _repaint.dispose();
    super.dispose();
  }

  void _start(Offset p) {
    if (!widget.enabled || _saving) return;
    final wasDirty = _dirty;
    _strokes.add([p]);
    _repaint.value++;
    if (!wasDirty) setState(() {});
  }

  void _move(Offset p) {
    if (!widget.enabled || _saving || _strokes.isEmpty) return;
    _strokes.last.add(p);
    _repaint.value++;
  }

  void _clear() => setState(() {
    _strokes.clear();
    _repaint.value++;
  });

  /// Draws the strokes at device resolution so the signature stays sharp.
  Future<File> _export() async {
    final ratio = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0);
    final w = (_size.width * ratio).round().clamp(1, 4000);
    final h = (_size.height * ratio).round().clamp(1, 4000);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(ratio);
    canvas.drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _SignaturePainter.paintStrokes(canvas, _strokes);
    final image = await recorder.endRecording().toImage(w, h);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final dir = await SignaturePad.tempDir();
    final file = File('${dir.path}${Platform.pathSeparator}signature_${DateTime.now().millisecondsSinceEpoch}.png');
    await file.writeAsBytes(bytes!.buffer.asUint8List(), flush: true);
    return file;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.onSave(await _export());
      if (mounted) _clear();
    } catch (_) {
      // Not saved (the caller showed why): keep the drawing to try again.
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LayoutBuilder(
              builder: (context, c) {
                _size = Size(c.maxWidth, c.maxHeight);
                // Claims the touch so the page doesn't scroll while signing.
                return RawGestureDetector(
                  gestures: {
                    EagerGestureRecognizer: GestureRecognizerFactoryWithHandlers<EagerGestureRecognizer>(
                      EagerGestureRecognizer.new,
                      (_) {},
                    ),
                  },
                  child: Listener(
                    behavior: HitTestBehavior.opaque,
                    onPointerDown: (e) => _start(e.localPosition),
                    onPointerMove: (e) => _move(e.localPosition),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (!_dirty)
                          Center(
                            child: Text(_tHint, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                          ),
                        RepaintBoundary(
                          child: CustomPaint(painter: _SignaturePainter(_strokes, _repaint)),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: _dirty && !_saving ? _clear : null,
              icon: const Icon(Icons.cleaning_services_outlined, size: 18),
              label: Text(_tClear),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: _dirty && widget.enabled && !_saving ? _save : null,
                icon: _saving
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.draw_outlined, size: 18),
                label: Text(_tSave),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 42)),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes, Listenable repaint) : super(repaint: repaint);
  final List<List<Offset>> strokes;

  static void paintStrokes(Canvas canvas, List<List<Offset>> strokes) {
    final paint = Paint()
      ..color = _ink
      ..strokeWidth = _inkWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.length == 1) {
        canvas.drawCircle(s.first, _inkWidth / 2, paint..style = PaintingStyle.fill);
        paint.style = PaintingStyle.stroke;
        continue;
      }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final p in s.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  void paint(Canvas canvas, Size size) => paintStrokes(canvas, strokes);

  @override
  bool shouldRepaint(_SignaturePainter old) => true;
}
