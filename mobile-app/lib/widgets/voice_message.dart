import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/i18n.dart';
import '../core/theme.dart';
import 'common.dart';

/*
 * Team chat voice messages: recording (AAC .m4a, up to three minutes) and the
 * player shown in a chat bubble. iPhones can't play WebM/Ogg voice notes
 * recorded in a desktop browser; those show "can't play" with an Open link.
 */

/// A voice message is at most three minutes long (same as the server).
const kVoiceMaxSeconds = 180;

/// "0:12", "2:05".
String fmtVoice(num seconds) {
  final s = max(0, seconds.round());
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// One finished recording.
class VoiceClip {
  const VoiceClip(this.file, this.seconds);
  final File file;
  final int seconds;
}

/// Records one voice message at a time. [onAutoStop] gets the clip when the
/// three-minute limit stops it.
class VoiceRecorder extends ChangeNotifier {
  VoiceRecorder({required this.onAutoStop});
  final void Function(VoiceClip clip) onAutoStop;

  AudioRecorder? _rec;
  Timer? _timer;
  DateTime? _startedAt;
  String? _path;
  int seconds = 0;
  bool get recording => _startedAt != null;

  /// Starts recording; false when the microphone is not allowed.
  Future<bool> start() async {
    if (recording) return true;
    final rec = _rec ??= AudioRecorder();
    if (!await rec.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    _path = '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await rec.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 64000, sampleRate: 44100, numChannels: 1),
      path: _path!,
    );
    _startedAt = DateTime.now();
    seconds = 0;
    _timer = Timer.periodic(const Duration(milliseconds: 250), (_) async {
      final s = DateTime.now().difference(_startedAt!).inSeconds;
      if (s != seconds) {
        seconds = s;
        notifyListeners();
      }
      if (s >= kVoiceMaxSeconds) {
        final clip = await finish();
        if (clip != null) onAutoStop(clip);
      }
    });
    notifyListeners();
    return true;
  }

  /// Stops and returns the recording (null if there was nothing).
  Future<VoiceClip?> finish() async {
    if (!recording) return null;
    final started = _startedAt!;
    _stopTimer();
    final path = await _rec?.stop() ?? _path;
    notifyListeners();
    if (path == null) return null;
    final file = File(path);
    if (!await file.exists() || await file.length() == 0) return null;
    final secs = (DateTime.now().difference(started).inMilliseconds / 1000).round().clamp(1, kVoiceMaxSeconds);
    return VoiceClip(file, secs);
  }

  /// Throws the recording away.
  Future<void> cancel() async {
    if (!recording) return;
    _stopTimer();
    notifyListeners();
    await _rec?.cancel();
  }

  void _stopTimer() {
    _timer?.cancel();
    _timer = null;
    _startedAt = null;
  }

  @override
  void dispose() {
    _timer?.cancel();
    if (recording) _rec?.cancel();
    _rec?.dispose();
    super.dispose();
  }
}

/// Composer row while recording: cancel ✕, red dot + timer, send ✓.
class RecordingBar extends StatelessWidget {
  const RecordingBar({super.key, required this.seconds, required this.sending, required this.onCancel, required this.onSend});
  final int seconds;
  final bool sending;
  final VoidCallback onCancel;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      IconButton(
        tooltip: t('Cancel recording'),
        onPressed: sending ? null : onCancel,
        icon: const Icon(Icons.close_rounded),
        color: AppColors.muted,
      ),
      Expanded(
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: AppColors.dangerSoft, borderRadius: BorderRadius.circular(22)),
          child: Row(children: [
            const _BlinkingDot(),
            const SizedBox(width: 10),
            Expanded(
              child: Text(t('Recording'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.dangerFg, fontWeight: FontWeight.w600)),
            ),
            Text(fmtVoice(seconds),
                style: const TextStyle(fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()])),
            Text(' / ${fmtVoice(kVoiceMaxSeconds)}', style: const TextStyle(color: AppColors.muted)),
          ]),
        ),
      ),
      const SizedBox(width: 6),
      IconButton.filled(
        tooltip: t('Send voice message'),
        onPressed: sending ? null : onSend,
        style: IconButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
        icon: sending
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Icon(Icons.check_rounded),
      ),
    ]);
  }
}

class _BlinkingDot extends StatefulWidget {
  const _BlinkingDot();
  @override
  State<_BlinkingDot> createState() => _BlinkingDotState();
}

class _BlinkingDotState extends State<_BlinkingDot> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: Tween(begin: 0.35, end: 1.0).animate(_c),
        child: Container(
            width: 10, height: 10, decoration: const BoxDecoration(color: Color(0xFFDC2626), shape: BoxShape.circle)),
      );
}

/// Bar heights (0.25–1) that stay the same for one message.
List<double> voiceBars(String seed, [int count = 28]) {
  var h = 2166136261;
  for (final c in seed.codeUnits) {
    h = ((h ^ c) * 16777619) & 0xffffffff;
  }
  return List.generate(count, (i) {
    h = ((h ^ (h >> 15)) * 2246822507) & 0xffffffff;
    final wave = 0.55 + 0.35 * sin(i / 2.6);
    return (wave * (0.55 + (h % 1000) / 1100)).clamp(0.25, 1.0);
  });
}

/// Formats an iPhone can't play (recorded by a desktop browser).
bool cantPlayHere(String mime) => Platform.isIOS && (mime.contains('webm') || mime.contains('ogg'));

/// Voice message inside a bubble: play / pause, bars filling as it plays, duration.
class VoicePlayer extends StatefulWidget {
  const VoicePlayer({super.key, required this.voice, required this.seed, required this.mine, required this.url});
  final Map voice;
  final String seed;
  final bool mine;

  /// Absolute signed link.
  final String url;

  @override
  State<VoicePlayer> createState() => _VoicePlayerState();
}

class _VoicePlayerState extends State<VoicePlayer> {
  AudioPlayer? _player;
  StreamSubscription? _subs;
  StreamSubscription? _posSub;
  bool _playing = false;
  bool _loading = false;
  bool _failed = false;
  Duration _pos = Duration.zero;

  int get _total => ((widget.voice['durationSec'] as num?) ?? 0).toInt();

  /// Only one voice message plays at a time.
  static _VoicePlayerState? _current;

  @override
  void initState() {
    super.initState();
    _failed = cantPlayHere((widget.voice['mimeType'] ?? '').toString());
  }

  @override
  void dispose() {
    if (_current == this) _current = null;
    _subs?.cancel();
    _posSub?.cancel();
    _player?.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _player?.pause();
      return;
    }
    if (_current != null && _current != this) await _current!._player?.pause();
    _current = this;
    try {
      var p = _player;
      if (p == null) {
        p = _player = AudioPlayer();
        setState(() => _loading = true);
        _subs = p.playerStateStream.listen((s) {
          if (!mounted) return;
          if (s.processingState == ProcessingState.completed) {
            p!.pause();
            p.seek(Duration.zero);
            setState(() {
              _playing = false;
              _pos = Duration.zero;
            });
            return;
          }
          setState(() => _playing = s.playing);
        });
        _posSub = p.positionStream.listen((d) {
          if (mounted) setState(() => _pos = d);
        });
        await p.setUrl(widget.url);
        if (mounted) setState(() => _loading = false);
      }
      unawaited(p.play());
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = widget.mine;
    final fg = mine ? Colors.white : AppColors.foreground;
    final sub = mine ? Colors.white70 : AppColors.muted;
    if (widget.voice['removed'] == true) {
      return Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.mic_none_rounded, size: 16, color: sub),
        const SizedBox(width: 6),
        Flexible(
          child: Text(t('Voice message removed (storage clean-up)'),
              style: TextStyle(color: sub, fontStyle: FontStyle.italic, fontSize: 13)),
        ),
      ]);
    }
    if (_failed) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.mic_rounded, size: 18, color: fg),
          const SizedBox(width: 6),
          Text(t('Voice message ({duration})', {'duration': fmtVoice(_total)}),
              style: TextStyle(color: fg, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 2),
        Text(t('This voice message can’t play on this phone.'), style: TextStyle(color: sub, fontSize: 12.5)),
        TextButton.icon(
          style: TextButton.styleFrom(
              foregroundColor: mine ? Colors.white : AppColors.primary,
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact),
          onPressed: () => launchUrl(Uri.parse(widget.url), mode: LaunchMode.externalApplication),
          icon: const Icon(Icons.open_in_new_rounded, size: 16),
          label: Text(t('Open')),
        ),
      ]);
    }
    final total = _total > 0 ? _total : 1;
    final progress = (_pos.inMilliseconds / 1000 / total).clamp(0.0, 1.0);
    final bars = voiceBars(widget.seed);
    final shown = _playing || _pos > Duration.zero ? _pos.inSeconds : _total;
    return SizedBox(
      width: 230,
      child: Row(children: [
        Semantics(
          button: true,
          label: _playing ? t('Pause') : t('Play voice message'),
          child: InkWell(
            onTap: _loading ? null : _toggle,
            customBorder: const CircleBorder(),
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: mine ? Colors.white : AppColors.primary, shape: BoxShape.circle),
              child: _loading
                  ? Padding(
                      padding: const EdgeInsets.all(11),
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: mine ? AppColors.primary : Colors.white))
                  : Icon(_playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      color: mine ? AppColors.primary : Colors.white, size: 26),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            SizedBox(
              height: 26,
              child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                for (var i = 0; i < bars.length; i++)
                  Expanded(
                    child: Center(
                      child: Container(
                        width: 3,
                        height: 26 * bars[i],
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(2),
                          color: (i + 0.5) / bars.length <= progress
                              ? (mine ? Colors.white : AppColors.primary)
                              : (mine ? Colors.white38 : AppColors.primary.withValues(alpha: 0.25)),
                        ),
                      ),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 2),
            Text(fmtVoice(shown),
                style: TextStyle(
                    fontSize: 11, color: sub, fontWeight: FontWeight.w500, fontFeatures: const [FontFeature.tabularFigures()])),
          ]),
        ),
      ]),
    );
  }
}

/// "Allow the microphone" message for a refused permission.
void micDenied(BuildContext context) =>
    toast(context, t('Allow the microphone for this app in your phone settings to record voice messages.'), error: true);
