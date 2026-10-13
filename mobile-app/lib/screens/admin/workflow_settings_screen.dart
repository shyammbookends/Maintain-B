import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// How a work order moves (Super Admin): who approves and what a technician
/// must add before finishing. Same settings as the web app.
class WorkflowSettingsScreen extends StatefulWidget {
  const WorkflowSettingsScreen({super.key});
  @override
  State<WorkflowSettingsScreen> createState() => _WorkflowSettingsScreenState();
}

class _WorkflowSettingsScreenState extends State<WorkflowSettingsScreen> {
  Json? _s;
  Object? _error;
  bool _saving = false;

  static List<(String, String, String, IconData)> get _toggles => [
        ('requireVerification', t('Manager approves finished work'),
            t('Technician completes → a manager checks and approves before it closes.'), Icons.verified_outlined),
        ('requireBeforePhoto', t('Before photo required'), t('Technician must add a photo before starting the repair.'),
            Icons.photo_camera_outlined),
        ('requireAfterPhoto', t('After photo required'), t('Technician must add a photo of the finished work.'),
            Icons.add_photo_alternate_outlined),
        ('requireRepairReport', t('Repair report required'), t('Problem found, work done and final condition on every job.'),
            Icons.description_outlined),
        ('simpleStatuses', t('Simple statuses'), t('Show Open, On hold, In progress and Done instead of every stage.'),
            Icons.label_outline),
      ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await apiOf(context).getData<Json>('/settings/workflow');
      if (mounted) setState(() => _s = s);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _set(String key, bool value) async {
    final next = {..._s!, key: value};
    setState(() => _saving = true);
    try {
      final r = await apiOf(context).putData<Json>('/settings/workflow', next);
      simpleStatuses = r['simpleStatuses'] != false;
      if (mounted) setState(() => _s = r);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return Scaffold(
      appBar: AppBar(title: Text(t('Work order flow'))),
      body: s == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : ListView(padding: const EdgeInsets.all(16), children: [
              AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(t('How a job moves'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                  const SizedBox(height: 10),
                  for (final (i, step) in [
                    (t('Manager'), t('Creates the work order and assigns a technician')),
                    (t('Technician'), t('Starts the task, can put it on hold, completes it')),
                    (t('Manager'), t('Checks the work and approves (or sends it back)')),
                  ].indexed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        CircleAvatar(
                          radius: 12,
                          backgroundColor: AppColors.infoSoft,
                          child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.primary)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text.rich(TextSpan(children: [
                            TextSpan(text: '${step.$1}: ', style: const TextStyle(fontWeight: FontWeight.w600)),
                            TextSpan(text: step.$2),
                          ])),
                        ),
                      ]),
                    ),
                  if (s['requireVerification'] != true)
                    Callout(tone: 'warning', text: t('Step 3 is off: jobs close as soon as the technician completes them.')),
                ]),
              ),
              const SizedBox(height: 12),
              AppCard(
                padding: EdgeInsets.zero,
                child: Column(children: [
                  for (final (i, tg) in _toggles.indexed) ...[
                    if (i > 0) const Divider(indent: 56),
                    SwitchListTile(
                      secondary: Icon(tg.$4, color: AppColors.primary),
                      title: Text(tg.$2, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(tg.$3),
                      value: s[tg.$1] == true,
                      onChanged: _saving ? null : (v) => _set(tg.$1, v),
                    ),
                  ],
                ]),
              ),
            ]),
    );
  }
}
