import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/session.dart';
import '../core/theme.dart';

ApiClient apiOf(BuildContext context) => context.read<Session>().api;

void toast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: error ? AppColors.dangerFg : AppColors.foreground,
      ),
    );
}

String errorText(Object e) => e is ApiException ? e.display : e.toString();

/// Runs an action, shows its error as a toast. Returns true on success.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (success != null && context.mounted) toast(context, success);
    return true;
  } catch (e) {
    // Kept on the phone without a network: it will be sent later, so it counts as done.
    if (e is ApiException && e.queued) {
      if (context.mounted) toast(context, e.message);
      return true;
    }
    if (context.mounted) toast(context, errorText(e), error: true);
    return false;
  }
}

/// Loads data, shows a spinner / error with retry, and supports pull-to-refresh.
class DataView<T> extends StatefulWidget {
  const DataView({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  @override
  State<DataView<T>> createState() => DataViewState<T>();
}

class DataViewState<T> extends State<DataView<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  ValueNotifier<int>? _revision;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Refetch after offline changes were sent or the connection came back.
    ValueNotifier<int>? rev;
    try {
      rev = context.read<Session>().api.offline?.revision;
    } catch (_) {
      rev = null; // no session above (e.g. widget tests)
    }
    if (rev != _revision) {
      _revision?.removeListener(_onRevision);
      _revision = rev?..addListener(_onRevision);
    }
  }

  void _onRevision() {
    if (mounted) reload();
  }

  @override
  void dispose() {
    _revision?.removeListener(_onRevision);
    super.dispose();
  }

  Future<void> reload() async {
    // First load: show the saved copy at once (if any), then fetch fresh data below.
    if (_data == null) {
      ApiClient? api;
      try {
        api = context.read<Session>().api;
      } catch (_) {
        api = null; // no session above (e.g. widget tests)
      }
      if (api?.offline != null) {
        final hits = CacheHits();
        try {
          final d = await api!.cacheFirst(widget.load, hits);
          if (!mounted) return;
          setState(() {
            _data = d;
            _loading = false;
          });
          // Everything came from the server already: nothing more to fetch.
          if (hits.count == 0) return;
        } catch (e) {
          // Nothing saved and the server failed: asking it again would only wait twice.
          if (mounted) {
            setState(() {
              _error = e;
              _loading = false;
            });
          }
          return;
        }
      }
    }
    if (!mounted) return;
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _data == null) {
      return ErrorView(error: _error!, onRetry: reload);
    }
    return RefreshIndicator(onRefresh: reload, child: widget.builder(context, _data as T, reload));
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiException && (error as ApiException).status == 0;
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        const SizedBox(height: 60),
        Center(
          child: Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(14),
              color: Colors.white,
            ),
            child: Icon(offline ? Icons.wifi_off_rounded : Icons.error_outline, color: AppColors.muted),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          offline ? t('Can’t reach the server') : t('Something went wrong'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        Text(
          errorText(error),
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted),
        ),
        const SizedBox(height: 20),
        Center(
          child: FilledButton(onPressed: onRetry, child: Text(t('Retry'))),
        ),
      ],
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body});
  final IconData icon;
  final String title;
  final String? body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(color: AppColors.infoSoft, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: AppColors.infoFg),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          if (body != null) ...[
            const SizedBox(height: 4),
            Text(
              body!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted),
            ),
          ],
        ],
      ),
    );
  }
}

({Color bg, Color fg}) toneColors(String tone) => switch (tone) {
  'danger' => (bg: AppColors.dangerSoft, fg: AppColors.dangerFg),
  'warning' => (bg: AppColors.warningSoft, fg: AppColors.warningFg),
  'success' => (bg: AppColors.successSoft, fg: AppColors.successFg),
  'info' => (bg: AppColors.infoSoft, fg: AppColors.infoFg),
  _ => (bg: AppColors.neutralSoft, fg: AppColors.muted),
};

String statusTone(String? s) => switch (s) {
  'OPEN' || 'NEW' || 'ASSIGNED' || 'SCHEDULED' || 'APPROVED' || 'ORDERED' => 'info',
  'IN_PROGRESS' || 'REVIEW' || 'PENDING_APPROVAL' || 'WARNING' || 'UNDER_MAINTENANCE' || 'PARTIALLY_RECEIVED' => 'warning',
  'ON_HOLD' || 'REOPENED' || 'REJECTED' || 'BROKEN' || 'FAIL' => 'danger',
  'COMPLETED' || 'VERIFIED' || 'CLOSED' || 'CONVERTED' || 'OPERATIONAL' || 'RECEIVED' || 'SUBMITTED' || 'PASS' || 'ACTIVE' => 'success',
  _ => 'neutral',
};

String priorityTone(String? p) => switch (p) {
  'CRITICAL' => 'danger',
  'HIGH' => 'warning',
  'MEDIUM' => 'info',
  _ => 'neutral',
};

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = 'neutral', this.icon, this.color});
  final String text;
  final String tone;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    final fg = color ?? c.fg;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color != null ? color!.withValues(alpha: 0.12) : c.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 4)],
          Text(
            text,
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg),
          ),
        ],
      ),
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});
  final String? status;
  @override
  Widget build(BuildContext context) => Pill(label(status), tone: statusTone(status));
}

/// Work order status; follows the "simple statuses" setting.
class WorkOrderStatusBadge extends StatelessWidget {
  const WorkOrderStatusBadge(this.status, {super.key});
  final String? status;
  @override
  Widget build(BuildContext context) {
    final shown = woStatusShown(status);
    final text = shown == 'REVIEW' && simpleStatuses ? t('Awaiting approval') : label(shown);
    return Pill(text, tone: statusTone(shown == 'DONE' ? 'CLOSED' : shown));
  }
}

class PriorityBadge extends StatelessWidget {
  const PriorityBadge(this.priority, {super.key});
  final String? priority;
  @override
  Widget build(BuildContext context) =>
      Pill(label(priority), tone: priorityTone(priority), icon: priority == 'CRITICAL' ? Icons.local_fire_department : null);
}

Color hexColor(String? hex) {
  final h = (hex ?? '#64748b').replaceAll('#', '');
  return Color(int.tryParse('FF$h', radix: 16) ?? 0xFF64748B);
}

class LabelChips extends StatelessWidget {
  const LabelChips(this.labels, {super.key});
  final List? labels;
  @override
  Widget build(BuildContext context) {
    final l = labels ?? const [];
    if (l.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [for (final x in l) Pill((x as Map)['name'].toString(), color: hexColor(x['color'] as String?))],
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8, bottom: 10),
    child: Row(
      children: [
        // Small brand accent before the heading.
        Container(
          width: 4,
          height: 18,
          decoration: BoxDecoration(gradient: AppColors.brand, borderRadius: BorderRadius.circular(4)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(title, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, letterSpacing: -0.2)),
        ),
        ?trailing,
      ],
    ),
  );
}

class Callout extends StatelessWidget {
  const Callout({super.key, required this.text, this.title, this.tone = 'info'});
  final String text;
  final String? title;
  final String tone;
  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null)
            Text(
              title!,
              style: TextStyle(fontWeight: FontWeight.w600, color: c.fg),
            ),
          Text(text, style: TextStyle(color: c.fg)),
        ],
      ),
    );
  }
}

/// White rounded card with a border (the web's `rounded-xl border bg-card shadow-card`).
class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.onTap, this.padding, this.borderColor});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;
  final Color? borderColor;
  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      // Soft lift so cards stand out from the tinted background.
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: const Color(0xFF312E81).withValues(alpha: 0.06), blurRadius: 18, offset: const Offset(0, 6))],
      ),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: borderColor ?? AppColors.borderSoft),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          splashColor: AppColors.primary.withValues(alpha: 0.06),
          highlightColor: AppColors.primary.withValues(alpha: 0.04),
          child: Padding(padding: padding ?? const EdgeInsets.all(14), child: child),
        ),
      ),
    );
  }
}

/// One tappable shortcut inside [BrandHero] (glass-style chip).
typedef HeroAction = ({IconData icon, String label, VoidCallback onTap});

/// Gradient greeting banner (homes and dashboard): soft glowing shapes, the
/// person's avatar and optional one-tap shortcuts.
class BrandHero extends StatelessWidget {
  const BrandHero({super.key, this.overline, required this.title, this.subtitle, this.person, this.actions = const []});
  final String? overline;
  final String title;
  final String? subtitle;
  final dynamic person;
  final List<HeroAction> actions;
  @override
  Widget build(BuildContext context) {
    Widget glow(double size, double alpha) => Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white.withValues(alpha: alpha),
      ),
    );
    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: AppColors.hero,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: AppColors.brandTo.withValues(alpha: 0.35), blurRadius: 28, offset: const Offset(0, 12))],
      ),
      child: Stack(
        children: [
          Positioned(top: -60, right: -40, child: glow(170, 0.10)),
          Positioned(bottom: -70, right: 60, child: glow(130, 0.07)),
          Positioned(top: 30, left: -30, child: glow(70, 0.06)),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (overline != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.16),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                overline!,
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            ),
                          const SizedBox(height: 10),
                          Text(
                            title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 25,
                              fontWeight: FontWeight.w700,
                              height: 1.15,
                              letterSpacing: -0.4,
                            ),
                          ),
                          if (subtitle != null) ...[
                            const SizedBox(height: 6),
                            Text(subtitle!, style: TextStyle(color: Colors.white.withValues(alpha: 0.88), fontSize: 13.5, height: 1.35)),
                          ],
                        ],
                      ),
                    ),
                    if (person != null) ...[
                      const SizedBox(width: 12),
                      Container(
                        padding: const EdgeInsets.all(2.5),
                        decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.35)),
                        child: Container(
                          width: 46,
                          height: 46,
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.white),
                          child: Text(
                            initials(person),
                            style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700, fontSize: 17),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      for (final (i, a) in actions.indexed) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: _HeroButton(a))],
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroButton extends StatelessWidget {
  const _HeroButton(this.a);
  final HeroAction a;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white.withValues(alpha: 0.16),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: BorderSide(color: Colors.white.withValues(alpha: 0.22)),
    ),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: a.onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(a.icon, color: Colors.white, size: 18),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                a.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Solid accent colour of a tone (icons, stripes).
Color toneAccent(String tone) => switch (tone) {
  'danger' => AppColors.danger,
  'warning' => AppColors.warning,
  'success' => AppColors.success,
  'info' => AppColors.primary,
  'violet' => AppColors.brandTo,
  'sky' => AppColors.info,
  _ => AppColors.muted,
};

/// Colourful number tile for dashboards: tinted gradient, solid icon bubble.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.tone = 'info',
    this.onTap,
    this.alert = false,
  });
  final String label;
  final Object? value;
  final IconData icon;
  final String tone;
  final VoidCallback? onTap;
  final bool alert;
  @override
  Widget build(BuildContext context) {
    final accent = toneAccent(tone);
    return Material(
      color: Colors.white,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: alert ? AppColors.danger.withValues(alpha: 0.45) : accent.withValues(alpha: 0.14)),
      ),
      child: InkWell(
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [accent.withValues(alpha: 0.13), accent.withValues(alpha: 0.03)],
            ),
          ),
          child: Stack(
            children: [
              // Faint big icon in the corner for depth.
              Positioned(right: -14, bottom: -16, child: Icon(icon, size: 78, color: accent.withValues(alpha: 0.07))),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: accent,
                            borderRadius: BorderRadius.circular(11),
                            boxShadow: [BoxShadow(color: accent.withValues(alpha: 0.35), blurRadius: 10, offset: const Offset(0, 4))],
                          ),
                          child: Icon(icon, size: 19, color: Colors.white),
                        ),
                        const Spacer(),
                        if (alert)
                          Container(
                            width: 9,
                            height: 9,
                            decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.danger),
                          )
                        else if (onTap != null)
                          Icon(Icons.arrow_outward_rounded, size: 17, color: accent.withValues(alpha: 0.7)),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${value ?? 0}',
                          style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1, letterSpacing: -0.5),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Grid of [StatTile]s: fixed tile height so big system fonts never stretch them.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 600;
    final scale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.3);
    return GridView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: wide ? 4 : 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        mainAxisExtent: 118 * scale,
      ),
      children: children,
    );
  }
}

/// Menu list in a card: each row has a colourful icon bubble.
class MenuList extends StatelessWidget {
  const MenuList({super.key, required this.items});
  final List<({IconData icon, String title, VoidCallback onTap})> items;
  static const _tones = ['info', 'violet', 'success', 'warning', 'sky', 'danger'];
  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Column(
      children: [
        for (final (i, it) in items.indexed) ...[
          if (i > 0) const Divider(indent: 64, endIndent: 16, color: AppColors.borderSoft),
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 14),
            leading: Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: toneAccent(_tones[i % _tones.length]).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(it.icon, size: 20, color: toneAccent(_tones[i % _tones.length])),
            ),
            title: Text(it.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            trailing: Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(color: AppColors.neutralSoft, borderRadius: BorderRadius.circular(9)),
              child: const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.muted),
            ),
            onTap: it.onTap,
          ),
        ],
      ],
    ),
  );
}

/// Profile summary at the top of Menu / More.
class ProfileBanner extends StatelessWidget {
  const ProfileBanner({super.key, required this.person, required this.name, required this.role, this.onTap});
  final dynamic person;
  final String name;
  final String role;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    padding: const EdgeInsets.all(16),
    child: Row(
      children: [
        Avatar(person, size: 52),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17, letterSpacing: -0.2)),
              const SizedBox(height: 4),
              Pill(role, tone: 'info', icon: Icons.verified_user_outlined),
            ],
          ),
        ),
        if (onTap != null) const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
      ],
    ),
  );
}

class IconChip extends StatelessWidget {
  const IconChip(this.icon, {super.key, this.tone = 'info', this.size = 38, this.brand = false});
  final IconData icon;
  final String tone;
  final double size;
  final bool brand;
  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: brand ? null : c.bg,
        gradient: brand ? AppColors.brand : null,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Icon(icon, size: size * 0.5, color: brand ? Colors.white : c.fg),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.person, {super.key, this.size = 36});
  final dynamic person;
  final double size;
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: const BoxDecoration(shape: BoxShape.circle, gradient: AppColors.brand),
    child: Text(
      initials(person),
      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: size * 0.38),
    ),
  );
}

/// Task card used by the worker lists and admin work order lists.
class TaskCard extends StatelessWidget {
  const TaskCard({super.key, required this.task, required this.onTap, this.showAssignee = false});
  final Map task;
  final VoidCallback onTap;
  final bool showAssignee;

  @override
  Widget build(BuildContext context) {
    final status = task['status']?.toString();
    final active = kActiveStatuses.contains(status);
    final due = active ? describeDue(task['dueDate']) : null;
    final overdue = task['overdue'] == true;
    final where = [
      (task['asset'] as Map?)?['name'],
      (task['location'] as Map?)?['name'],
      (task['restaurant'] as Map?)?['name'],
    ].whereType<String>().join(' · ');
    final team = (task['team'] ?? task['assignedTeam']) as Map?;
    final assignee = task['assignedUser'] ?? task['assignee'];
    final priority = task['priority']?.toString();
    final stripe = toneAccent(priorityTone(priority));
    final dueTone = overdue ? 'danger' : due?.tone ?? 'neutral';
    Widget meta(IconData icon, String text, {Color color = AppColors.muted, FontWeight weight = FontWeight.w500}) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12.5, color: color, fontWeight: weight),
          ),
        ),
      ],
    );
    return AppCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      borderColor: overdue ? AppColors.danger.withValues(alpha: 0.35) : null,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Priority colour at a glance.
            Container(width: 5, color: stripe),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.neutralSoft, borderRadius: BorderRadius.circular(6)),
                          child: Text(
                            task['code']?.toString() ?? '',
                            style: const TextStyle(fontSize: 11.5, color: AppColors.muted, fontWeight: FontWeight.w600, letterSpacing: 0.2),
                          ),
                        ),
                        if (task['type'] == 'PREVENTIVE') ...[
                          const SizedBox(width: 6),
                          const Pill('PM', tone: 'info', icon: Icons.build_circle_outlined),
                        ],
                        const Spacer(),
                        WorkOrderStatusBadge(status),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      task['title']?.toString() ?? '',
                      style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, height: 1.25, letterSpacing: -0.2),
                    ),
                    if (where.isNotEmpty) ...[const SizedBox(height: 6), meta(Icons.place_outlined, where)],
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        PriorityBadge(priority),
                        if (due != null && due.label.isNotEmpty) ...[const SizedBox(width: 10)],
                        // Due date fills the middle; the assignee sits on the right.
                        Expanded(
                          child: due != null && due.label.isNotEmpty
                              ? Align(
                                  alignment: Alignment.centerLeft,
                                  child: meta(
                                    overdue ? Icons.alarm_rounded : Icons.event_outlined,
                                    due.label,
                                    color: dueTone == 'neutral' ? AppColors.muted : toneColors(dueTone).fg,
                                    weight: FontWeight.w600,
                                  ),
                                )
                              : const SizedBox.shrink(),
                        ),
                        if (showAssignee && assignee != null) ...[
                          Avatar(assignee, size: 22),
                          const SizedBox(width: 6),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 110),
                            child: Text(
                              personName(assignee),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5, color: AppColors.foreground, fontWeight: FontWeight.w500),
                            ),
                          ),
                        ] else if (showAssignee)
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 140),
                            child: meta(Icons.group_outlined, team != null ? team['name'].toString() : t('Unassigned')),
                          )
                        else if (team != null)
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 140),
                            child: meta(Icons.group_outlined, t('via {team}', {'team': team['name']})),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Small key/value row for detail screens.
class InfoRow extends StatelessWidget {
  const InfoRow(this.k, this.v, {super.key});
  final String k;
  final String? v;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(k, style: const TextStyle(color: AppColors.muted, fontSize: 13.5)),
        ),
        Expanded(
          child: Text(v == null || v!.isEmpty ? '—' : v!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
        ),
      ],
    ),
  );
}

/// Asks for a text (reason / note). Returns null when cancelled.
Future<String?> askText(BuildContext context, {required String title, String? hint, String? action, int minLength = 0}) {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final ok = ctrl.text.trim().length >= minLength;
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: ctrl,
            autofocus: true,
            maxLines: 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(hintText: hint),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text(t('Cancel'))),
            FilledButton(onPressed: ok ? () => Navigator.pop(ctx, ctrl.text.trim()) : null, child: Text(action ?? t('Save'))),
          ],
        );
      },
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, {String? body, String? action}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t('Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(action ?? t('Yes'))),
      ],
    ),
  );
  return r == true;
}

/// Picks one option from a bottom sheet.
Future<T?> pickOption<T>(BuildContext context, String title, List<(T, String)> options) {
  return showModalBottomSheet<T>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [for (final o in options) ListTile(title: Text(o.$2), onTap: () => Navigator.pop(ctx, o.$1))],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
