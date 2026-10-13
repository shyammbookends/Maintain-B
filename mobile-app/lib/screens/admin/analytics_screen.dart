import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Analytics for managers: trends, mix, cost, restaurants, technicians, assets,
/// vendors, parts and inspections for a chosen period (same data as the web reports).
class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});
  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

const _palette = [
  AppColors.primary,
  AppColors.success,
  AppColors.warning,
  AppColors.danger,
  AppColors.info,
  AppColors.brandTo,
  Color(0xFF14B8A6),
  Color(0xFFF97316),
];

class _Data {
  _Data(this.trends, this.dash, this.reports);
  final Json trends;
  final Json dash;
  final Map<String, Json?> reports;
  List rows(String key) => (reports[key]?['rows'] as List?) ?? const [];
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  int _days = 30;
  String? _restaurantId;
  final _key = GlobalKey<DataViewState<_Data>>();

  static const _reportKeys = [
    'work-order-summary',
    'technician-performance',
    'asset-downtime',
    'vendor-spend',
    'parts-consumption',
    'requests-summary',
    'inspection-results',
    'maintenance-mix',
  ];

  Future<_Data> _load() async {
    final api = apiOf(context);
    final to = DateTime.now();
    final from = to.subtract(Duration(days: _days - 1));
    final q = {
      'from': DateFormat('yyyy-MM-dd').format(from),
      'to': DateFormat('yyyy-MM-dd').format(to),
      'restaurantId': _restaurantId,
    };
    final results = await Future.wait([
      api.getData<Json>('/reports/analytics/trends', q),
      api.getData<Json>('/dashboard', {'restaurantId': _restaurantId}),
      for (final k in _reportKeys) api.getData<Json>('/reports/$k', q).then<Json?>((v) => v).catchError((_) => null),
    ]);
    return _Data(results[0] as Json, results[1] as Json, {
      for (var i = 0; i < _reportKeys.length; i++) _reportKeys[i]: results[i + 2],
    });
  }

  @override
  Widget build(BuildContext context) {
    final rs = context.watch<Session>().restaurants;
    return Scaffold(
      appBar: AppBar(title: Text(t('Analytics'))),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
          child: Column(children: [
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<int>(
                segments: [
                  ButtonSegment(value: 7, label: Text(t('7 days'))),
                  ButtonSegment(value: 30, label: Text(t('30 days'))),
                  ButtonSegment(value: 90, label: Text(t('90 days'))),
                ],
                selected: {_days},
                showSelectedIcon: false,
                onSelectionChanged: (v) {
                  setState(() => _days = v.first);
                  _key.currentState?.reload();
                },
              ),
            ),
            if (rs.length > 1) ...[
              const SizedBox(height: 8),
              DropdownButtonFormField<String?>(
                initialValue: _restaurantId,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.storefront_outlined)),
                items: [
                  DropdownMenuItem(value: null, child: Text(t('All restaurants'))),
                  for (final r in rs) DropdownMenuItem(value: r['id'].toString(), child: Text(r['name'].toString())),
                ],
                onChanged: (v) {
                  setState(() => _restaurantId = v);
                  _key.currentState?.reload();
                },
              ),
            ],
          ]),
        ),
        const Divider(),
        Expanded(
          child: DataView<_Data>(
            key: _key,
            load: _load,
            builder: (context, d, _) => _Body(d: d, days: _days),
          ),
        ),
      ]),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.d, required this.days});
  final _Data d;
  final int days;

  @override
  Widget build(BuildContext context) {
    final totals = (d.trends['totals'] as Map?) ?? const {};
    final points = ((d.trends['points'] as List?) ?? const []).cast<Map>();
    final cost = (totals['cost'] as Map?) ?? const {};
    final byStatus = ((d.dash['byStatus'] as List?) ?? const []).cast<Map>();
    final byPriority = (d.dash['byPriority'] as Map?) ?? const {};
    final wide = MediaQuery.sizeOf(context).width >= 600;

    final kpis = <(String, String, IconData, String)>[
      (t('Work orders created'), '${totals['created'] ?? 0}', Icons.add_task, 'info'),
      (t('Completed'), '${totals['completed'] ?? 0}', Icons.task_alt, 'success'),
      (t('Avg. repair time (MTTR)'), totals['mttrHours'] == null ? '—' : '${totals['mttrHours']} h', Icons.timer_outlined, 'warning'),
      (t('Time between failures'), totals['mtbfHours'] == null ? '—' : '${totals['mtbfHours']} h', Icons.av_timer, 'info'),
      (t('PM compliance'), totals['pmCompliance'] == null ? '—' : '${totals['pmCompliance']}%', Icons.build_circle_outlined, 'success'),
      (t('On-time completion'), d.dash['onTimeRate'] == null ? '—' : '${d.dash['onTimeRate']}%', Icons.schedule, 'info'),
      (t('Downtime'), '${d.dash['downtimeHours'] ?? 0} h', Icons.report_problem_outlined, 'danger'),
      (t('Maintenance cost'), fmtMoney(cost['total'] ?? 0), Icons.currency_rupee, 'warning'),
    ];

    return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 32), children: [
      GridView.count(
        crossAxisCount: wide ? 4 : 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: wide ? 1.7 : 1.55,
        children: [
          for (final k in kpis)
            AppCard(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                IconChip(k.$3, tone: k.$4, size: 30),
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  FittedBox(child: Text(k.$2, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700))),
                  Text(k.$1, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ]),
              ]),
            ),
        ],
      ),
      _Chart(
        title: t('Work orders over time'),
        subtitle: t('Created vs completed ({bucket})', {'bucket': d.trends['bucket'] == 'week' ? t('per week') : t('per day')}),
        legend: [(t('Created'), AppColors.primary), (t('Completed'), AppColors.success)],
        child: _TrendLine(points: points),
      ),
      _Chart(
        title: t('Reactive vs preventive'),
        subtitle: t('Breakdowns compared with planned maintenance'),
        legend: [(t('Reactive'), AppColors.danger), (t('Preventive'), AppColors.info)],
        child: _StackedBars(points: points),
      ),
      _Chart(
        title: t('Open work by status'),
        child: _Donut(values: [
          for (final s in byStatus) (label(s['status']), (s['count'] as num).toDouble()),
        ]),
      ),
      _Chart(
        title: t('Open work by priority'),
        child: _Bars(
          items: [
            for (final p in kPriorities) (label(p), (byPriority[p] as num? ?? 0).toDouble()),
          ],
          colors: const [AppColors.muted, AppColors.info, AppColors.warning, AppColors.danger],
        ),
      ),
      _Chart(
        title: t('Where the money went'),
        subtitle: t('Total {amount}', {'amount': fmtMoney(cost['total'] ?? 0)}),
        child: _Donut(money: true, values: [
          (t('Parts'), (cost['parts'] as num? ?? 0).toDouble()),
          (t('Labour'), (cost['labour'] as num? ?? 0).toDouble()),
          (t('Vendors'), (cost['vendor'] as num? ?? 0).toDouble()),
          (t('Other'), (cost['other'] as num? ?? 0).toDouble()),
        ]),
      ),
      _Chart(
        title: t('Restaurants'),
        subtitle: t('Work orders created, completed and overdue'),
        legend: [(t('Created'), AppColors.primary), (t('Completed'), AppColors.success), (t('Overdue'), AppColors.danger)],
        child: _GroupedBars(
          rows: d.rows('work-order-summary'),
          labelKey: 'restaurant',
          keys: const ['created', 'completed', 'overdue'],
          colors: const [AppColors.primary, AppColors.success, AppColors.danger],
        ),
      ),
      _Chart(
        title: t('Maintenance mix by restaurant'),
        subtitle: t('Share of planned (preventive) work'),
        child: _HBars(rows: d.rows('maintenance-mix'), labelKey: 'restaurant', valueKey: 'preventivePct', suffix: '%', color: AppColors.info, max: 100),
      ),
      _Chart(
        title: t('Technician performance'),
        subtitle: t('Jobs completed (on-time % shown)'),
        child: _HBars(
          rows: d.rows('technician-performance'),
          labelKey: 'technician',
          valueKey: 'completed',
          note: (r) => t('{rate}% on time · {hours} h', {'rate': r['onTimeRate'] ?? '—', 'hours': r['hoursWorked'] ?? 0}),
          color: AppColors.success,
        ),
      ),
      _Chart(
        title: t('Machine downtime'),
        subtitle: t('Hours out of service'),
        child: _HBars(
          rows: d.rows('asset-downtime'),
          labelKey: 'asset',
          valueKey: 'downtimeHours',
          suffix: ' h',
          note: (r) => '${r['restaurant'] ?? ''} · ${t('{n} incidents', {'n': r['incidents'] ?? 0})}',
          color: AppColors.danger,
        ),
      ),
      _Chart(
        title: t('Vendor spend'),
        child: _HBars(
          rows: d.rows('vendor-spend'),
          labelKey: 'vendor',
          valueKey: 'invoiced',
          money: true,
          note: (r) => (r['unpaid'] ?? 0) > 0 ? t('{amount} unpaid', {'amount': fmtMoney(r['unpaid'])}) : t('All paid'),
          color: AppColors.brandTo,
        ),
      ),
      _Chart(
        title: t('Parts used'),
        child: _HBars(
          rows: d.rows('parts-consumption'),
          labelKey: 'part',
          valueKey: 'cost',
          money: true,
          note: (r) => t('{qty} {unit} used', {'qty': r['quantityUsed'], 'unit': r['unit'] ?? ''}),
          color: AppColors.warning,
        ),
      ),
      _Chart(
        title: t('Problem reports by restaurant'),
        legend: [(t('Reported'), AppColors.primary), (t('Converted'), AppColors.success), (t('Pending'), AppColors.warning)],
        child: _GroupedBars(
          rows: d.rows('requests-summary'),
          labelKey: 'restaurant',
          keys: const ['reported', 'converted', 'pending'],
          colors: const [AppColors.primary, AppColors.success, AppColors.warning],
        ),
      ),
      _Chart(
        title: t('Checklist pass rate'),
        child: _HBars(
          rows: d.rows('inspection-results'),
          labelKey: 'checklist',
          valueKey: 'passRate',
          suffix: '%',
          max: 100,
          note: (r) => '${r['restaurant'] ?? ''} · ${t('{n} done', {'n': r['inspections']})}',
          color: AppColors.success,
        ),
      ),
    ]);
  }
}

/// Card with a title, optional legend and a chart.
class _Chart extends StatelessWidget {
  const _Chart({required this.title, this.subtitle, this.legend = const [], required this.child});
  final String title;
  final String? subtitle;
  final List<(String, Color)> legend;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            if (legend.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 14, runSpacing: 4, children: [for (final l in legend) _LegendDot(l.$1, l.$2)]),
            ],
            const SizedBox(height: 14),
            child,
          ]),
        ),
      );
}

class _LegendDot extends StatelessWidget {
  const _LegendDot(this.text, this.color);
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 5),
        Text(text, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      ]);
}

Widget get _empty => Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Center(child: Text(t('No data for this period'), style: const TextStyle(color: AppColors.muted))),
    );

String _shortDate(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? '' : DateFormat('d MMM').format(d);
}

double _niceMax(double v) => v <= 4 ? 4 : (v * 1.2).ceilToDouble();

FlTitlesData _titles({required Widget Function(double) bottom, double? leftInterval, bool showBottom = true}) => FlTitlesData(
      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      leftTitles: AxisTitles(
        sideTitles: SideTitles(
          showTitles: true,
          reservedSize: 30,
          interval: leftInterval,
          getTitlesWidget: (v, meta) => v == meta.max && v != 0
              ? const SizedBox.shrink()
              : Text(v.toInt().toString(), style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ),
      ),
      bottomTitles: AxisTitles(
        sideTitles: SideTitles(
          showTitles: showBottom,
          reservedSize: 24,
          getTitlesWidget: (v, meta) => Padding(padding: const EdgeInsets.only(top: 6), child: bottom(v)),
        ),
      ),
    );

FlGridData get _grid => FlGridData(
      drawVerticalLine: false,
      getDrawingHorizontalLine: (_) => const FlLine(color: AppColors.border, strokeWidth: 1),
    );

class _TrendLine extends StatelessWidget {
  const _TrendLine({required this.points});
  final List<Map> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return _empty;
    final created = [for (var i = 0; i < points.length; i++) FlSpot(i.toDouble(), (points[i]['created'] as num).toDouble())];
    final completed = [for (var i = 0; i < points.length; i++) FlSpot(i.toDouble(), (points[i]['completed'] as num).toDouble())];
    final maxY = _niceMax([...created, ...completed].map((s) => s.y).fold(0.0, math.max));
    final every = math.max(1, (points.length / 5).ceil());
    LineChartBarData line(List<FlSpot> s, Color c) => LineChartBarData(
          spots: s,
          color: c,
          isCurved: true,
          preventCurveOverShooting: true,
          barWidth: 2.6,
          dotData: FlDotData(show: points.length <= 14),
          belowBarData: BarAreaData(show: true, color: c.withValues(alpha: 0.08)),
        );
    return SizedBox(
      height: 200,
      child: LineChart(LineChartData(
        minY: 0,
        maxY: maxY,
        gridData: _grid,
        borderData: FlBorderData(show: false),
        titlesData: _titles(
          leftInterval: math.max(1, (maxY / 4).ceilToDouble()),
          bottom: (v) {
            final i = v.toInt();
            if (i < 0 || i >= points.length || i % every != 0) return const SizedBox.shrink();
            return Text(_shortDate(points[i]['start'] as String), style: const TextStyle(fontSize: 10, color: AppColors.muted));
          },
        ),
        lineTouchData: LineTouchData(
          touchTooltipData: LineTouchTooltipData(getTooltipColor: (_) => AppColors.foreground),
        ),
        lineBarsData: [line(created, AppColors.primary), line(completed, AppColors.success)],
      )),
    );
  }
}

class _StackedBars extends StatelessWidget {
  const _StackedBars({required this.points});
  final List<Map> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return _empty;
    final totals = [for (final p in points) (p['reactive'] as num).toDouble() + (p['preventive'] as num).toDouble()];
    final maxY = _niceMax(totals.fold(0.0, math.max));
    final every = math.max(1, (points.length / 5).ceil());
    final width = math.max(3.0, math.min(16.0, 220 / points.length));
    return SizedBox(
      height: 190,
      child: BarChart(BarChartData(
        maxY: maxY,
        gridData: _grid,
        borderData: FlBorderData(show: false),
        titlesData: _titles(
          leftInterval: math.max(1, (maxY / 4).ceilToDouble()),
          bottom: (v) {
            final i = v.toInt();
            if (i < 0 || i >= points.length || i % every != 0) return const SizedBox.shrink();
            return Text(_shortDate(points[i]['start'] as String), style: const TextStyle(fontSize: 10, color: AppColors.muted));
          },
        ),
        barGroups: [
          for (var i = 0; i < points.length; i++)
            BarChartGroupData(x: i, barRods: [
              BarChartRodData(
                toY: totals[i],
                width: width,
                borderRadius: BorderRadius.circular(3),
                rodStackItems: [
                  BarChartRodStackItem(0, (points[i]['reactive'] as num).toDouble(), AppColors.danger),
                  BarChartRodStackItem((points[i]['reactive'] as num).toDouble(), totals[i], AppColors.info),
                ],
                color: Colors.transparent,
              ),
            ]),
        ],
      )),
    );
  }
}

class _Bars extends StatelessWidget {
  const _Bars({required this.items, required this.colors});
  final List<(String, double)> items;
  final List<Color> colors;

  @override
  Widget build(BuildContext context) {
    if (items.every((i) => i.$2 == 0)) return _empty;
    final maxY = _niceMax(items.map((i) => i.$2).fold(0.0, math.max));
    return SizedBox(
      height: 180,
      child: BarChart(BarChartData(
        maxY: maxY,
        gridData: _grid,
        borderData: FlBorderData(show: false),
        titlesData: _titles(
          leftInterval: math.max(1, (maxY / 4).ceilToDouble()),
          bottom: (v) => Text(items[v.toInt()].$1, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
        ),
        barGroups: [
          for (var i = 0; i < items.length; i++)
            BarChartGroupData(x: i, barRods: [
              BarChartRodData(toY: items[i].$2, width: 28, color: colors[i % colors.length], borderRadius: BorderRadius.circular(6)),
            ]),
        ],
      )),
    );
  }
}

class _GroupedBars extends StatelessWidget {
  const _GroupedBars({required this.rows, required this.labelKey, required this.keys, required this.colors});
  final List rows;
  final String labelKey;
  final List<String> keys;
  final List<Color> colors;

  String _short(String s) {
    // "Bookends Café – CG Road" → "CG Road"
    final parts = s.split(RegExp(r'\s[–-]\s'));
    final tail = parts.length > 1 ? parts.last : s;
    return tail.length > 12 ? '${tail.substring(0, 11)}…' : tail;
  }

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return _empty;
    final values = [
      for (final r in rows) [for (final k in keys) ((r as Map)[k] as num? ?? 0).toDouble()]
    ];
    final maxY = _niceMax(values.expand((v) => v).fold(0.0, math.max));
    return SizedBox(
      height: 210,
      child: BarChart(BarChartData(
        maxY: maxY,
        gridData: _grid,
        borderData: FlBorderData(show: false),
        titlesData: _titles(
          leftInterval: math.max(1, (maxY / 4).ceilToDouble()),
          bottom: (v) => SizedBox(
            width: 64,
            child: Text(_short(((rows[v.toInt()] as Map)[labelKey] ?? '').toString()),
                textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
          ),
        ),
        barGroups: [
          for (var i = 0; i < rows.length; i++)
            BarChartGroupData(x: i, barsSpace: 3, barRods: [
              for (var j = 0; j < keys.length; j++)
                BarChartRodData(toY: values[i][j], width: 9, color: colors[j], borderRadius: BorderRadius.circular(3)),
            ]),
        ],
      )),
    );
  }
}

/// Horizontal bars with labels — good for long names (technicians, assets, vendors).
class _HBars extends StatelessWidget {
  const _HBars({
    required this.rows,
    required this.labelKey,
    required this.valueKey,
    required this.color,
    this.suffix = '',
    this.money = false,
    this.max,
    this.note,
  });
  final List rows;
  final String labelKey;
  final String valueKey;
  final Color color;
  final String suffix;
  final bool money;
  final double? max;
  final String Function(Map)? note;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return _empty;
    final sorted = [...rows.cast<Map>()]
      ..sort((a, b) => ((b[valueKey] as num?) ?? 0).compareTo((a[valueKey] as num?) ?? 0));
    final top = sorted.take(8).toList();
    final double maxV = max ?? top.map((r) => ((r[valueKey] as num?) ?? 0).toDouble()).fold<double>(0, math.max);
    return Column(children: [
      for (final r in top)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text((r[labelKey] ?? '').toString(),
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
              ),
              const SizedBox(width: 8),
              Text(money ? fmtMoney(r[valueKey] ?? 0) : '${r[valueKey] ?? 0}$suffix',
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
            ]),
            const SizedBox(height: 5),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: maxV <= 0 ? 0 : (((r[valueKey] as num?) ?? 0) / maxV).clamp(0, 1).toDouble(),
                minHeight: 9,
                color: color,
                backgroundColor: color.withValues(alpha: 0.12),
              ),
            ),
            if (note != null) ...[
              const SizedBox(height: 3),
              Text(note!(r), style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
            ],
          ]),
        ),
    ]);
  }
}

class _Donut extends StatelessWidget {
  const _Donut({required this.values, this.money = false});
  final List<(String, double)> values;
  final bool money;

  @override
  Widget build(BuildContext context) {
    final items = values.where((v) => v.$2 > 0).toList();
    final total = items.fold<double>(0, (a, b) => a + b.$2);
    if (total <= 0) return _empty;
    return Row(children: [
      SizedBox(
        width: 140,
        height: 140,
        child: PieChart(PieChartData(
          sectionsSpace: 2,
          centerSpaceRadius: 38,
          sections: [
            for (var i = 0; i < items.length; i++)
              PieChartSectionData(
                value: items[i].$2,
                color: _palette[i % _palette.length],
                radius: 26,
                showTitle: false,
              ),
          ],
        )),
      ),
      const SizedBox(width: 16),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (var i = 0; i < items.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: _palette[i % _palette.length], borderRadius: BorderRadius.circular(3))),
                const SizedBox(width: 6),
                Expanded(child: Text(items[i].$1, style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis)),
                Text(
                  money ? fmtMoney(items[i].$2) : '${items[i].$2.toInt()} · ${(items[i].$2 / total * 100).round()}%',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ]),
            ),
        ]),
      ),
    ]);
  }
}
