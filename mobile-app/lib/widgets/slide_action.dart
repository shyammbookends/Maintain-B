import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/i18n.dart';

/// "Swipe to start" button (like food-delivery apps): drag the knob to the end to
/// confirm, so an important step can't be triggered by a stray tap.
class SlideAction extends StatefulWidget {
  const SlideAction({
    super.key,
    required this.label,
    required this.onSubmit,
    this.icon = Icons.arrow_forward_rounded,
    this.color = AppColors.primary,
    this.busy = false,
    this.enabled = true,
  });

  final String label;
  final Future<void> Function() onSubmit;
  final IconData icon;
  final Color color;
  final bool busy;
  final bool enabled;

  @override
  State<SlideAction> createState() => _SlideActionState();
}

class _SlideActionState extends State<SlideAction> with SingleTickerProviderStateMixin {
  static const _height = 58.0;
  static const _pad = 5.0;
  double _dx = 0;
  bool _submitting = false;
  late final AnimationController _back = AnimationController(vsync: this, duration: const Duration(milliseconds: 260))
    ..addListener(() => setState(() => _dx = _from * (1 - Curves.easeOut.transform(_back.value))));
  double _from = 0;

  @override
  void dispose() {
    _back.dispose();
    super.dispose();
  }

  bool get _active => widget.enabled && !widget.busy && !_submitting;

  Future<void> _release(double max) async {
    if (_dx >= max * 0.88) {
      setState(() {
        _dx = max;
        _submitting = true;
      });
      HapticFeedback.mediumImpact();
      try {
        await widget.onSubmit();
      } finally {
        if (mounted) {
          _submitting = false;
          _snapBack();
        }
      }
    } else {
      _snapBack();
    }
  }

  void _snapBack() {
    _from = _dx;
    _back.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.enabled ? widget.color : AppColors.muted;
    return LayoutBuilder(builder: (context, c) {
      final knob = _height - _pad * 2;
      final max = (c.maxWidth - knob - _pad * 2).clamp(0.0, double.infinity);
      final progress = max == 0 ? 0.0 : (_dx / max).clamp(0.0, 1.0);
      final loading = widget.busy || _submitting;
      return Semantics(
        button: true,
        label: widget.label,
        // Screen readers: a double tap confirms.
        onTap: _active ? () => widget.onSubmit() : null,
        child: Container(
          height: _height,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(_height / 2),
            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 6))],
          ),
          child: Stack(alignment: Alignment.centerLeft, children: [
            // Filled track behind the knob.
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: _dx + knob + _pad * 2,
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(_height / 2),
                ),
              ),
            ),
            Center(
              child: Opacity(
                opacity: (1 - progress * 1.4).clamp(0.0, 1.0),
                child: Padding(
                  padding: EdgeInsets.only(left: knob),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Flexible(
                      child: Text(
                        loading ? t('Please wait…') : widget.label,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: 0.2),
                      ),
                    ),
                    if (!loading) ...[
                      const SizedBox(width: 6),
                      Icon(Icons.keyboard_double_arrow_right_rounded, color: Colors.white.withValues(alpha: 0.75), size: 22),
                    ],
                  ]),
                ),
              ),
            ),
            Positioned(
              left: _pad + _dx,
              child: GestureDetector(
                onHorizontalDragUpdate: _active
                    ? (d) => setState(() => _dx = (_dx + d.delta.dx).clamp(0.0, max))
                    : null,
                onHorizontalDragEnd: _active ? (_) => _release(max) : null,
                child: Container(
                  width: knob,
                  height: knob,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: Color(0x33000000), blurRadius: 6, offset: Offset(0, 2))],
                  ),
                  child: loading
                      ? Padding(padding: const EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2.4, color: color))
                      : Icon(widget.icon, color: color, size: 26),
                ),
              ),
            ),
          ]),
        ),
      );
    });
  }
}
