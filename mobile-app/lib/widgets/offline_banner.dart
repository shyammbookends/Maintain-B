import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/i18n.dart';
import '../core/offline.dart';
import '../core/theme.dart';
import 'common.dart';
import 'voice_message.dart';

// UI text for offline mode (kept together for translation later).
String get _tOffline => t('Offline – showing saved data');
String get _tOfflineNoData => t('Offline – changes are saved on this phone');
String _tWaiting(int n) => n == 1 ? t('1 change waiting to send') : t('{n} changes waiting to send', {'n': n});
String _tSending(int n) => n == 1 ? t('Sending 1 saved change…') : t('Sending {n} saved changes…', {'n': n});
String _tFailed(int n) =>
    n == 1 ? t('1 change could not be saved – tap to see') : t('{n} changes could not be saved – tap to see', {'n': n});
String get _tScreenTitle => t('Unsent changes');
String get _tPendingTitle => t('Waiting to send');
String get _tFailedTitle => t('Could not be saved');
String get _tFailedHelp => t(
    'The server refused these changes (for example the job was reassigned or closed). Check the reason, redo the change if needed, then discard it.');
String get _tNothing => t('Everything is saved.');
String get _tSendNow => t('Send now');
String get _tDiscard => t('Discard');
String get _tDiscardAll => t('Discard all');
String get _tDiscardAsk => t('Discard this change?');
String get _tDiscardAllAsk => t('Discard all changes that could not be saved?');

/// What a queued write does, in words.
String describeWrite(QueuedWrite w) {
  final p = w.path;
  final body = w.json is Map ? w.json as Map : const {};
  final String what;
  if (p.endsWith('/start')) {
    what = t('Start task');
  } else if (p.endsWith('/resume')) {
    what = t('Resume task');
  } else if (p.endsWith('/hold')) {
    what = t('Put on hold');
  } else if (p.endsWith('/complete')) {
    what = t('Complete task');
  } else if (p.endsWith('/messages')) {
    what = t('Message: “{text}”', {'text': body['body'] ?? ''});
  } else if (p.endsWith('/parts')) {
    final name = ((w.meta?['part'] as Map?)?['name'] ?? '').toString();
    what = name.isEmpty ? t('Part used') : '${t('Part used')}: $name × ${body['quantity'] ?? ''}';
  } else if (p.endsWith('/time')) {
    what = body['minutes'] is num ? '${t('Time entry')}: ${fmtDuration(body['minutes'])}' : t('Time entry');
  } else if (p.contains('/checklist/') || p.contains('/items/')) {
    what = p.endsWith('/attachments') ? t('Checklist photo / signature') : t('Checklist answer');
  } else if (p.endsWith('/submit')) {
    what = t('Submit checklist');
  } else if (p.contains('/readings')) {
    what = t('Meter reading');
  } else if (p == '/requests') {
    final title = (body['title'] ?? '').toString();
    what = t('Problem report: {text}', {'text': title.isNotEmpty ? title : (body['description'] ?? '').toString()});
  } else if (p.startsWith('/chats/') && p.endsWith('/voice')) {
    what = t('Voice message ({duration})', {'duration': fmtVoice(int.tryParse(w.fields['durationSec'] ?? '') ?? 0)});
  } else if (p.endsWith('/attachments')) {
    final n = w.files.length;
    what = n == 1 ? t('1 photo') : t('{n} photos', {'n': n});
  } else {
    what = t('Change');
  }
  return w.ref.isEmpty ? what : '${w.ref} · $what';
}

/// Strip shown while offline, while saved changes wait, or when some were refused.
/// Tap it to see the unsent changes.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final off = apiOf(context).offline;
    if (off == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: off,
      builder: (context, _) {
        final failed = off.failed.length;
        final pending = off.pending;
        final offline = !off.online;
        if (!offline && pending == 0 && failed == 0) return const SizedBox.shrink();
        final (String text, IconData icon, String tone) = failed > 0
            ? (_tFailed(failed), Icons.error_outline, 'danger')
            : offline
            ? (
                [off.showingSaved ? _tOffline : _tOfflineNoData, if (pending > 0) _tWaiting(pending)].join(' · '),
                Icons.cloud_off_rounded,
                'warning',
              )
            : (off.syncing ? _tSending(pending) : _tWaiting(pending), Icons.cloud_upload_outlined, 'info');
        final c = toneColors(tone);
        return Material(
          color: c.bg,
          child: InkWell(
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OfflineQueueScreen())),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
              decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.fg.withValues(alpha: 0.18)))),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: c.fg),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.fg)),
                  ),
                  if (pending > 0 || failed > 0) Icon(Icons.chevron_right, size: 18, color: c.fg),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Changes waiting to be sent, and those the server refused (with its reason).
class OfflineQueueScreen extends StatelessWidget {
  const OfflineQueueScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final off = apiOf(context).offline;
    return Scaffold(
      appBar: AppBar(title: Text(_tScreenTitle)),
      body: off == null
          ? EmptyState(icon: Icons.cloud_done_outlined, title: _tNothing)
          : ListenableBuilder(
              listenable: off,
              builder: (context, _) {
                final queue = off.queue;
                final failed = off.failed.reversed.toList();
                if (queue.isEmpty && failed.isEmpty) {
                  return ListView(children: [EmptyState(icon: Icons.cloud_done_outlined, title: _tNothing)]);
                }
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (queue.isNotEmpty) ...[
                      SectionTitle(
                        _tPendingTitle,
                        trailing: TextButton.icon(
                          onPressed: off.syncing ? null : () => off.flush(),
                          icon: off.syncing
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.sync, size: 18),
                          label: Text(_tSendNow),
                        ),
                      ),
                      AppCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            for (final w in queue)
                              ListTile(
                                leading: const Icon(Icons.schedule, color: AppColors.muted),
                                title: Text(describeWrite(w), maxLines: 2, overflow: TextOverflow.ellipsis),
                                subtitle: Text(fmtDateTime(DateTime.fromMillisecondsSinceEpoch(w.createdAt).toIso8601String())),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (failed.isNotEmpty) ...[
                      SectionTitle(
                        _tFailedTitle,
                        trailing: TextButton(
                          style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
                          onPressed: () async {
                            if (await confirm(context, _tDiscardAllAsk, action: _tDiscardAll)) await off.dismissFailed();
                          },
                          child: Text(_tDiscardAll),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Callout(tone: 'danger', text: _tFailedHelp),
                      ),
                      for (final f in failed)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AppCard(
                            borderColor: AppColors.danger.withValues(alpha: 0.35),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.error_outline, color: AppColors.dangerFg),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(describeWrite(f.write), style: const TextStyle(fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 2),
                                      Text(f.error, style: const TextStyle(fontSize: 13, color: AppColors.dangerFg)),
                                      const SizedBox(height: 2),
                                      Text(
                                        fmtDateTime(DateTime.fromMillisecondsSinceEpoch(f.write.createdAt).toIso8601String()),
                                        style: const TextStyle(fontSize: 12, color: AppColors.muted),
                                      ),
                                    ],
                                  ),
                                ),
                                TextButton(
                                  style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
                                  onPressed: () async {
                                    if (await confirm(context, _tDiscardAsk, action: _tDiscard)) {
                                      await off.dismissFailed(f.write.id);
                                    }
                                  },
                                  child: Text(_tDiscard),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ],
                );
              },
            ),
    );
  }
}
