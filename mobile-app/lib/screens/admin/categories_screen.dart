import 'package:flutter/material.dart';

import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'editors.dart';

/// Asset categories (Fridge, Oven, AC unit…): add, rename and remove.
/// A category with assets in it can't be removed until they are moved.
class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});
  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  final _key = GlobalKey<DataViewState<List>>();

  Future<void> _add() async {
    final name = await askText(context, title: t('New category'), hint: t('e.g. Tandoor'), action: t('Add'), minLength: 2);
    if (name == null || !mounted) return;
    if (await runAction(context, () => apiOf(context).post('/asset-categories', {'name': name}), success: t('Category added'))) {
      _key.currentState?.reload();
    }
  }

  Future<void> _rename(Map c) async {
    final name = await askText(context, title: t('Rename category'), hint: c['name'].toString(), action: t('Save'), minLength: 2);
    if (name == null || !mounted) return;
    if (await runAction(context, () => apiOf(context).put('/asset-categories/${c['id']}', {'name': name}),
        success: t('Category renamed'))) {
      _key.currentState?.reload();
    }
  }

  Future<void> _remove(Map c) async {
    final count = (c['assetCount'] ?? 0) as int;
    if (count > 0) {
      toast(context, t('{name} has {n} asset(s). Move them to another category first.', {'name': c['name'], 'n': count}), error: true);
      return;
    }
    if (!await confirm(context, t('Remove {name}?', {'name': c['name']}), action: t('Remove')) || !mounted) return;
    if (await runAction(context, () => apiOf(context).delete('/asset-categories/${c['id']}'), success: t('Category removed'))) {
      _key.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final canAdd = canManage(context, 'assets:create');
    final canEdit = canManage(context, 'assets:edit');
    final canRemove = canManage(context, 'assets:delete');
    return Scaffold(
      appBar: AppBar(title: Text(t('Asset categories'))),
      floatingActionButton: canAdd
          ? FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add), label: Text(t('Add category')))
          : null,
      body: DataView<List>(
        key: _key,
        load: () => api.getData<List>('/asset-categories'),
        builder: (context, items, _) => items.isEmpty
            ? ListView(children: [EmptyState(icon: Icons.category_outlined, title: t('No categories yet'))])
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final c = items[i] as Map;
                  return AppCard(
                    padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
                    child: Row(children: [
                      const IconChip(Icons.category_outlined, size: 36),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(c['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                          Text(t('{n} assets', {'n': c['assetCount'] ?? 0}), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                        ]),
                      ),
                      if (canEdit)
                        IconButton(tooltip: t('Rename'), icon: const Icon(Icons.edit_outlined), onPressed: () => _rename(c)),
                      if (canRemove)
                        IconButton(
                          tooltip: t('Remove'),
                          icon: const Icon(Icons.delete_outline, color: AppColors.dangerFg),
                          onPressed: () => _remove(c),
                        ),
                    ]),
                  );
                },
              ),
      ),
    );
  }
}
