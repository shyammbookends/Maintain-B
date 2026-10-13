import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/i18n.dart';
import '../core/theme.dart';
import 'common.dart';

/// Small building blocks for the add / edit screens.

class Field extends StatelessWidget {
  const Field(this.controller, this.label,
      {super.key, this.hint, this.lines = 1, this.keyboard, this.required = false, this.helper, this.obscure = false});
  final TextEditingController controller;
  final String label;
  final String? hint;
  final String? helper;
  final int lines;
  final TextInputType? keyboard;
  final bool required;
  final bool obscure;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: controller,
          minLines: lines,
          maxLines: obscure ? 1 : lines + 2,
          obscureText: obscure,
          keyboardType: keyboard,
          decoration: InputDecoration(
            labelText: required ? '$label *' : label,
            hintText: hint,
            helperText: helper,
            alignLabelWithHint: lines > 1,
          ),
        ),
      );
}

class Pick<T> extends StatelessWidget {
  const Pick({super.key, required this.label, required this.value, required this.items, required this.onChanged, this.required = false});
  final String label;
  final T? value;
  final List<(T?, String)> items;
  final ValueChanged<T?> onChanged;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final has = items.any((i) => i.$1 == value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<T?>(
        key: ValueKey('$label-${items.length}-$value'),
        initialValue: has ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: required ? '$label *' : label),
        items: [for (final i in items) DropdownMenuItem<T?>(value: i.$1, child: Text(i.$2, overflow: TextOverflow.ellipsis))],
        onChanged: onChanged,
      ),
    );
  }
}

/// Date as YYYY-MM-DD ('' = not set).
class DateField extends StatelessWidget {
  const DateField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final d = DateTime.tryParse(value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () async {
          final picked = await showDatePicker(
            context: context,
            firstDate: DateTime(2000),
            lastDate: DateTime(2100),
            initialDate: d ?? DateTime.now(),
          );
          if (picked != null) onChanged(DateFormat('yyyy-MM-dd').format(picked));
        },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: value.isEmpty
                ? const Icon(Icons.event_outlined)
                : IconButton(icon: const Icon(Icons.clear), onPressed: () => onChanged('')),
          ),
          child: Text(d == null ? t('Not set') : DateFormat('d MMM yyyy').format(d),
              style: TextStyle(color: d == null ? AppColors.muted : AppColors.foreground)),
        ),
      ),
    );
  }
}

/// Opening hours as HH:mm ('' = not set).
class TimeField extends StatelessWidget {
  const TimeField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () async {
          final parts = value.split(':');
          final t = await showTimePicker(
            context: context,
            initialTime: parts.length == 2
                ? TimeOfDay(hour: int.tryParse(parts[0]) ?? 9, minute: int.tryParse(parts[1]) ?? 0)
                : const TimeOfDay(hour: 9, minute: 0),
          );
          if (t != null) {
            onChanged('${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
          }
        },
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.schedule)),
          child: Text(value.isEmpty ? t('Not set') : value,
              style: TextStyle(color: value.isEmpty ? AppColors.muted : AppColors.foreground)),
        ),
      ),
    );
  }
}

/// Picks several options (restaurants, members, categories…).
class MultiPick extends StatelessWidget {
  const MultiPick({super.key, required this.label, required this.options, required this.selected, required this.onChanged, this.emptyText});
  final String label;
  final List<(String, String)> options;
  final Set<String> selected;
  final ValueChanged<Set<String>> onChanged;
  final String? emptyText;

  @override
  Widget build(BuildContext context) {
    final names = [for (final o in options) if (selected.contains(o.$1)) o.$2];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () async {
          final result = await showModalBottomSheet<Set<String>>(
            context: context,
            isScrollControlled: true,
            showDragHandle: true,
            builder: (ctx) => _MultiSheet(title: label, options: options, initial: selected),
          );
          if (result != null) onChanged(result);
        },
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.arrow_drop_down)),
          child: Text(names.isEmpty ? (emptyText ?? t('None')) : names.join(', '),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: names.isEmpty ? AppColors.muted : AppColors.foreground)),
        ),
      ),
    );
  }
}

class _MultiSheet extends StatefulWidget {
  const _MultiSheet({required this.title, required this.options, required this.initial});
  final String title;
  final List<(String, String)> options;
  final Set<String> initial;
  @override
  State<_MultiSheet> createState() => _MultiSheetState();
}

class _MultiSheetState extends State<_MultiSheet> {
  late final Set<String> _sel = {...widget.initial};
  @override
  Widget build(BuildContext context) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.75),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 12, 4),
              child: Row(children: [
                Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
                FilledButton(
                  style: FilledButton.styleFrom(minimumSize: const Size(80, 40)),
                  onPressed: () => Navigator.pop(context, _sel),
                  child: Text(t('Done')),
                ),
              ]),
            ),
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                for (final o in widget.options)
                  CheckboxListTile(
                    value: _sel.contains(o.$1),
                    title: Text(o.$2),
                    onChanged: (v) => setState(() => v == true ? _sel.add(o.$1) : _sel.remove(o.$1)),
                  ),
              ]),
            ),
          ]),
        ),
      );
}

/// Full-width save button with a spinner.
class SaveButton extends StatelessWidget {
  const SaveButton({super.key, required this.busy, required this.onPressed, this.text});
  final bool busy;
  final VoidCallback onPressed;
  final String? text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: FilledButton.icon(
          onPressed: busy ? null : onPressed,
          icon: busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.check),
          label: Text(text ?? t('Save')),
        ),
      );
}

/// Runs a save and pops with `true` on success (shows the server's error otherwise).
Future<void> saveAndClose(BuildContext context, void Function(bool) setBusy, Future<void> Function() save, String done) async {
  setBusy(true);
  try {
    await save();
    if (!context.mounted) return;
    toast(context, done);
    Navigator.of(context).pop(true);
  } catch (e) {
    if (context.mounted) toast(context, errorText(e), error: true);
  } finally {
    if (context.mounted) setBusy(false);
  }
}

String numText(dynamic v) => v == null ? '' : (v is num && v == v.roundToDouble() ? v.toInt().toString() : v.toString());
String dateText(dynamic v) => v == null ? '' : v.toString().split('T').first;
